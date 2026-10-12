-- Web push reminders (opt-in, per device).
--
-- A notification can appear on a locked screen, so it carries counts and
-- a link only: never a patient number, tooth, diagnosis or name.
-- At most one reminder per subscription per day. The sender is the
-- send-reminders Edge Function, run on a schedule with the service role
-- (see docs/04-deployment.md); signed-in users cannot read other people's
-- subscriptions or trigger sending.

create table public.push_subscription (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  last_sent_on date,
  failures smallint not null default 0
);

alter table public.push_subscription enable row level security;
alter table public.push_subscription force row level security;
create policy owner_select on public.push_subscription for select to authenticated using (owner_id = auth.uid());
grant select on public.push_subscription to authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to turn on reminders' using errcode = '28000';
  end if;
  -- An endpoint belongs to one browser; re-subscribing moves it to the current account.
  insert into public.push_subscription (owner_id, endpoint, p256dh, auth_key)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set owner_id = excluded.owner_id, p256dh = excluded.p256dh, auth_key = excluded.auth_key, failures = 0;
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscription where endpoint = p_endpoint and owner_id = auth.uid();
$$;

-- What a user should be reminded of today: counts only.
create or replace function public.reminder_digest(p_user uuid, p_today date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  items jsonb := '[]'::jsonb;
  n int;
  internship_live boolean;
begin
  select count(*) into n from public.logbook_entry e
   where e.owner_id = p_user and e.status = 'returned' and e.deleted_at is null;
  if n > 0 then
    items := items || jsonb_build_object('id', 'returned', 'text',
      n || ' logbook entr' || case when n = 1 then 'y was' else 'ies were' end || ' returned by your supervisor. Fix and resubmit.', 'url', '/logbook?status=returned');
  end if;

  select count(*) into n from public.case_report c
   where c.owner_id = p_user and c.status = 'returned' and c.deleted_at is null;
  if n > 0 then
    items := items || jsonb_build_object('id', 'returned-reports', 'text',
      n || ' case report' || case when n = 1 then ' was' else 's were' end || ' returned for revision.', 'url', '/case-reports');
  end if;

  select count(*) into n from public.logbook_entry e
   where e.owner_id = p_user and e.status = 'submitted' and e.deleted_at is null and e.performed_on < p_today - 7;
  if n > 0 then
    items := items || jsonb_build_object('id', 'stale', 'text',
      n || ' entr' || case when n = 1 then 'y has' else 'ies have' end || ' waited more than a week for verification.', 'url', '/sign-off');
  end if;

  select exists (select 1 from public.internship i where i.owner_id = p_user and i.deleted_at is null and p_today between i.period_from and i.period_to)
    into internship_live;
  if internship_live and extract(isodow from p_today) between 2 and 5
     and not exists (select 1 from public.logbook_entry e where e.owner_id = p_user and e.deleted_at is null and e.performed_on >= p_today - 3) then
    items := items || jsonb_build_object('id', 'quiet', 'text', 'Nothing logged for a few days. Add your recent patients while you remember the details.', 'url', '/log');
  end if;

  -- As a supervisor: items waiting for this user's verification.
  select count(*) into n
    from public.supervisor s
    join public.logbook_entry e on e.supervisor_id = s.id and e.owner_id = s.owner_id
   where s.user_id = p_user and s.deleted_at is null and e.status = 'submitted' and e.deleted_at is null;
  select n + count(*) into n
    from public.supervisor s
    join public.case_report c on c.supervisor_id = s.id and c.owner_id = s.owner_id
   where s.user_id = p_user and s.deleted_at is null and c.status = 'submitted' and c.deleted_at is null;
  if n > 0 then
    items := items || jsonb_build_object('id', 'to-verify', 'text',
      n || ' item' || case when n = 1 then ' is' else 's are' end || ' waiting for your verification.', 'url', '/supervise');
  end if;

  return items;
end;
$$;

-- For the sender (service role only): today's notifications, one per subscription.
create or replace function public.push_due(p_today date default current_date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth_key,
           'title', 'Logbook reminder',
           'body', case when jsonb_array_length(d.items) = 1 then d.items -> 0 ->> 'text'
                        else (d.items -> 0 ->> 'text') || ' (+' || (jsonb_array_length(d.items) - 1) || ' more)' end,
           'url', d.items -> 0 ->> 'url')), '[]'::jsonb)
    from public.push_subscription s
    cross join lateral (select public.reminder_digest(s.owner_id, p_today) as items) d
   where (s.last_sent_on is null or s.last_sent_on < p_today)
     and jsonb_array_length(d.items) > 0
$$;

-- The sender reports back: sent, or gone (the browser unsubscribed).
create or replace function public.push_report(p_sent uuid[], p_gone uuid[], p_failed uuid[], p_today date default current_date)
returns void
language sql
security definer
set search_path = public
as $$
  update public.push_subscription set last_sent_on = p_today, failures = 0 where id = any (p_sent);
  delete from public.push_subscription where id = any (p_gone);
  update public.push_subscription set failures = failures + 1 where id = any (p_failed);
  delete from public.push_subscription where failures >= 5;
$$;

revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
revoke execute on function public.delete_push_subscription(text) from public, anon;
revoke execute on function public.reminder_digest(uuid, date) from public, anon, authenticated;
revoke execute on function public.push_due(date) from public, anon, authenticated;
revoke execute on function public.push_report(uuid[], uuid[], uuid[], date) from public, anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- Supabase's service_role (used only by the Edge Function) may call the sender functions.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.reminder_digest(uuid, date) to service_role';
    execute 'grant execute on function public.push_due(date) to service_role';
    execute 'grant execute on function public.push_report(uuid[], uuid[], uuid[], date) to service_role';
  end if;
end;
$$;
