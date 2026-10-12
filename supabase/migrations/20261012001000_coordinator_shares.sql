-- Coordinator cohort view: an intern may share their progress with their
-- internship coordinator (opt-in, revocable). In personal mode the intern
-- controls their data, so sharing starts from a one-time code the intern
-- creates, exactly like a supervisor invite.
--
-- A coordinator never reads entries, patients or visits. coordinator_cohort()
-- returns counts per logbook code (from statuses only a verification can
-- set), rotation dates, whether each assessment was held with its overall
-- grade and outcome, and case-report statuses.

create table public.coordinator_invite (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id)
);

create table public.coordinator_share (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  coordinator_id uuid not null references auth.users (id) on delete cascade,
  -- Shown to the intern so they always know who can see their progress.
  coordinator_email text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index coordinator_share_active on public.coordinator_share (owner_id, coordinator_id) where revoked_at is null;

alter table public.coordinator_invite enable row level security;
alter table public.coordinator_invite force row level security;
alter table public.coordinator_share enable row level security;
alter table public.coordinator_share force row level security;
create policy owner_select on public.coordinator_invite for select to authenticated using (owner_id = auth.uid());
create policy owner_select on public.coordinator_share for select to authenticated using (owner_id = auth.uid());
create policy coordinator_select on public.coordinator_share for select to authenticated using (coordinator_id = auth.uid());
grant select on public.coordinator_invite, public.coordinator_share to authenticated;

-- Twelve characters from a 32-letter alphabet without look-alikes (60 bits).
create or replace function public._new_invite_code() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
  code text := '';
  i int;
begin
  foreach i in array array[0, 1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 21] loop
    code := code || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return code;
end;
$$;

create or replace function public.create_coordinator_invite()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  code text := public._new_invite_code();
  inv public.coordinator_invite;
begin
  if auth.uid() is null then
    raise exception 'Sign in to share your progress' using errcode = '28000';
  end if;
  if not exists (select 1 from public.internship i where i.owner_id = auth.uid() and i.deleted_at is null) then
    raise exception 'Sync your logbook first: there is no internship on the server yet' using errcode = 'P0002';
  end if;
  delete from public.coordinator_invite where owner_id = auth.uid() and accepted_at is null;
  insert into public.coordinator_invite (owner_id, code_hash) values (auth.uid(), public._invite_hash(code)) returning * into inv;
  return jsonb_build_object(
    'code', substr(code, 1, 4) || '-' || substr(code, 5, 4) || '-' || substr(code, 9, 4),
    'expires_at', inv.expires_at
  );
end;
$$;

create or replace function public.accept_coordinator_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.coordinator_invite;
  intern text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to accept the invite' using errcode = '28000';
  end if;
  select * into inv from public.coordinator_invite i where i.code_hash = public._invite_hash(p_code) for update;
  if not found or inv.accepted_at is not null or inv.expires_at < now() then
    raise exception 'This invite code is not valid. Ask the intern for a new one.' using errcode = 'P0002';
  end if;
  if inv.owner_id = auth.uid() then
    raise exception 'You cannot coordinate your own logbook.' using errcode = '42501';
  end if;
  insert into public.coordinator_share (owner_id, coordinator_id, coordinator_email)
  select inv.owner_id, auth.uid(), u.email from auth.users u where u.id = auth.uid()
  on conflict (owner_id, coordinator_id) where revoked_at is null do nothing;
  update public.coordinator_invite set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  select i.intern_name into intern from public.internship i where i.owner_id = inv.owner_id and i.deleted_at is null order by i.period_from desc limit 1;
  return jsonb_build_object('intern_name', intern);
end;
$$;

-- The intern sees who can see their progress, and can stop sharing at any time.
create or replace function public.my_coordinator_shares()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'coordinator_email', s.coordinator_email, 'created_at', s.created_at) order by s.created_at), '[]'::jsonb)
    from public.coordinator_share s
   where s.owner_id = auth.uid() and s.revoked_at is null
$$;

create or replace function public.revoke_coordinator_share(p_share uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.coordinator_share set revoked_at = now()
   where id = p_share and owner_id = auth.uid() and revoked_at is null;
  if not found then
    raise exception 'Share not found' using errcode = 'P0002';
  end if;
end;
$$;

-- The cohort: aggregates only, for interns who share with the caller.
create or replace function public.coordinator_cohort()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to view your cohort' using errcode = '28000';
  end if;
  select coalesce(jsonb_agg(m order by m ->> 'intern_name'), '[]'::jsonb) into result
  from (
    select jsonb_build_object(
      'owner_id', s.owner_id,
      'shared_at', s.created_at,
      'intern_name', i.intern_name,
      'licence_no', i.licence_no,
      'institution', i.institution,
      'facility_name', (select f.name from public.facility f where f.id = i.facility_id),
      'period_from', i.period_from,
      'period_to', i.period_to,
      'rotations', (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', r.id, 'internship_id', r.internship_id, 'rotation', r.rotation, 'starts_on', r.starts_on,
                       'ends_on', r.ends_on, 'extended_by_days', r.extended_by_days, 'outcome', r.outcome) order by r.starts_on), '[]'::jsonb)
                      from public.rotation r where r.internship_id = i.id and r.deleted_at is null),
      'counts', (select coalesce(jsonb_agg(jsonb_build_object(
                    'code', c.code, 'logged', c.logged, 'verified', c.verified, 'pending', c.pending, 'returned', c.returned, 'last_on', c.last_on)), '[]'::jsonb)
                   from (select e.requirement_code as code,
                                count(*)::int as logged,
                                count(*) filter (where e.status in ('verified', 'locked'))::int as verified,
                                count(*) filter (where e.status not in ('verified', 'locked'))::int as pending,
                                count(*) filter (where e.status = 'returned')::int as returned,
                                max(e.performed_on) as last_on
                           from public.logbook_entry e
                          where e.internship_id = i.id and e.deleted_at is null and e.status <> 'withdrawn'
                          group by e.requirement_code) c),
      'assessments', (select coalesce(jsonb_agg(jsonb_build_object(
                         'rotation_id', a.rotation_id, 'kind', a.kind, 'sequence', a.sequence, 'held_on', a.held_on,
                         'overall_grade', a.overall_grade, 'outcome', a.outcome)), '[]'::jsonb)
                        from public.assessment a where a.internship_id = i.id and a.deleted_at is null),
      'case_reports', (select coalesce(jsonb_agg(jsonb_build_object('rotation_id', c.rotation_id, 'status', c.status)), '[]'::jsonb)
                         from public.case_report c where c.internship_id = i.id and c.deleted_at is null)
    ) as m
    from public.coordinator_share s
    join lateral (
      select * from public.internship x where x.owner_id = s.owner_id and x.deleted_at is null order by x.period_from desc limit 1
    ) i on true
    where s.coordinator_id = auth.uid() and s.revoked_at is null
  ) q;
  return result;
end;
$$;

revoke execute on function public.create_coordinator_invite() from public, anon;
revoke execute on function public.accept_coordinator_invite(text) from public, anon;
revoke execute on function public.my_coordinator_shares() from public, anon;
revoke execute on function public.revoke_coordinator_share(uuid) from public, anon;
revoke execute on function public.coordinator_cohort() from public, anon;
grant execute on function public.create_coordinator_invite() to authenticated;
grant execute on function public.accept_coordinator_invite(text) to authenticated;
grant execute on function public.my_coordinator_shares() to authenticated;
grant execute on function public.revoke_coordinator_share(uuid) to authenticated;
grant execute on function public.coordinator_cohort() to authenticated;
