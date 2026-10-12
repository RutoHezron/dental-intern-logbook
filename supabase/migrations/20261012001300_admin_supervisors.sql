-- Administrator route: register supervisors and link them to interns directly.
--
-- Until now a supervisor reached an intern's logbook only through a one-time
-- invite code the intern created. An administrator (training-centre staff)
-- can now register supervisors by email and link each one to their interns.
-- The invite code still works; both paths set the same supervisor.user_id the
-- read and sign rules already use.
--
--   * app_admin           who may administer (by email; the first one is
--                          added with SQL, see docs/04-deployment.md).
--   * supervisor_account  supervisors the administrator registered.
--   * supervisor.account_id  which registered supervisor an intern's
--                          supervisor record belongs to. When that person has
--                          signed in, user_id is set too; if they have not,
--                          it is set the first time they sign in.
--
-- An administrator sees interns' names, emails and supervisor names, never
-- entries, patients or visits. A linked supervisor sees only what interns
-- submitted to them (unchanged), plus a feed of those entries' statuses.
-- The intern always sees who is linked and can still disconnect them.

create table public.app_admin (
  email text primary key check (email = lower(email) and position('@' in email) > 1),
  added_at timestamptz not null default now(),
  added_by uuid references auth.users (id)
);
alter table public.app_admin enable row level security;
alter table public.app_admin force row level security;

create table public.supervisor_account (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and position('@' in email) > 1),
  name text not null check (char_length(name) between 1 and 200),
  role text,
  kmpdc_reg_no text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  removed_at timestamptz
);
create unique index supervisor_account_email on public.supervisor_account (email) where removed_at is null;
alter table public.supervisor_account enable row level security;
alter table public.supervisor_account force row level security;

alter table public.supervisor add column account_id uuid references public.supervisor_account (id);
create index on public.supervisor (account_id) where account_id is not null;

-- Everything goes through the functions below; no direct table access.
revoke all on public.app_admin, public.supervisor_account from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Links stay server-controlled (account_id joins user_id and linked_at).
-- ---------------------------------------------------------------------------

create or replace function public.tg_supervisor_link_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.linking', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- An upsert fires this before resolving the conflict: keep the stored link.
    select s.user_id, s.linked_at, s.account_id into new.user_id, new.linked_at, new.account_id from public.supervisor s where s.id = new.id;
    return new;
  end if;
  new.user_id := old.user_id;
  new.linked_at := old.linked_at;
  new.account_id := old.account_id;
  return new;
end;
$$;

-- An administrator adds a supervisor record to an intern's logbook; it must
-- belong to the intern (and sync to their phone), not to the administrator.
create or replace function public.tg_sync_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.server_seq := nextval('public.sync_seq');
  new.server_received_at := now();
  if tg_op = 'INSERT' then
    -- A verification belongs to the intern who owns the entry, not to the
    -- supervisor who signs it; verify_entry() sets it explicitly.
    if auth.uid() is not null and tg_table_name <> 'verification'
       and not (tg_table_name = 'supervisor' and coalesce(current_setting('app.linking', true), '') = 'on') then
      new.owner_id := auth.uid();
    end if;
  else
    new.owner_id := old.owner_id;
  end if;
  return new;
end;
$$;

-- An intern disconnecting a supervisor also clears the administrator's link.
create or replace function public.unlink_supervisor_account(p_supervisor uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (select 1 from public.supervisor s where s.id = p_supervisor and s.owner_id = auth.uid()) then
    raise exception 'Supervisor not found' using errcode = 'P0002';
  end if;
  perform set_config('app.linking', 'on', true);
  update public.supervisor set user_id = null, linked_at = null, account_id = null where id = p_supervisor;
  perform set_config('app.linking', '', true);
end;
$$;

-- A registered supervisor who signs in for the first time picks up their links.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profile (id) values (new.id) on conflict do nothing;
  if new.email is not null then
    perform set_config('app.linking', 'on', true);
    update public.supervisor s set user_id = new.id, linked_at = now()
      from public.supervisor_account a
     where s.account_id = a.id and a.removed_at is null and a.email = lower(new.email)
       and s.user_id is null and s.owner_id <> new.id and s.deleted_at is null;
    perform set_config('app.linking', '', true);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who is an administrator
-- ---------------------------------------------------------------------------

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_admin a join auth.users u on a.email = lower(u.email)
     where u.id = auth.uid()
  )
$$;

create or replace function public._require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to administer' using errcode = '28000';
  end if;
  if not public.is_admin() then
    raise exception 'This account is not an administrator' using errcode = '42501';
  end if;
end;
$$;

create or replace function public._clean_email(p text) returns text
language plpgsql immutable set search_path = public as $$
declare
  e text := lower(btrim(coalesce(p, '')));
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  return e;
end;
$$;

-- ---------------------------------------------------------------------------
-- What the administrator sees
-- ---------------------------------------------------------------------------

create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  interns jsonb;
  supervisors jsonb;
  admins jsonb;
begin
  perform public._require_admin();

  -- Everyone with an internship on the server.
  select coalesce(jsonb_agg(jsonb_build_object(
           'owner_id', i.owner_id,
           'email', u.email,
           'intern_name', i.intern_name,
           'licence_no', i.licence_no,
           'institution', i.institution,
           'period_from', i.period_from,
           'period_to', i.period_to,
           'supervisors', (select coalesce(jsonb_agg(jsonb_build_object(
                              'id', s.id, 'name', s.name, 'role', s.role, 'rotation', s.rotation,
                              'account_id', s.account_id, 'linked', s.user_id is not null, 'linked_at', s.linked_at,
                              'linked_email', (select x.email from auth.users x where x.id = s.user_id)) order by s.name), '[]'::jsonb)
                             from public.supervisor s where s.owner_id = i.owner_id and s.deleted_at is null)
         ) order by i.intern_name), '[]'::jsonb)
    into interns
    from (
      select distinct on (x.owner_id) x.* from public.internship x
       where x.deleted_at is null order by x.owner_id, x.period_from desc
    ) i
    left join auth.users u on u.id = i.owner_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'email', a.email,
           'name', a.name,
           'role', a.role,
           'kmpdc_reg_no', a.kmpdc_reg_no,
           'created_at', a.created_at,
           'signed_in', exists (select 1 from auth.users u where lower(u.email) = a.email),
           'interns', (select count(distinct s.owner_id) from public.supervisor s where s.account_id = a.id and s.deleted_at is null)
         ) order by a.name), '[]'::jsonb)
    into supervisors
    from public.supervisor_account a
   where a.removed_at is null;

  select coalesce(jsonb_agg(jsonb_build_object('email', a.email, 'added_at', a.added_at) order by a.email), '[]'::jsonb)
    into admins
    from public.app_admin a;

  return jsonb_build_object('interns', interns, 'supervisors', supervisors, 'admins', admins);
end;
$$;

-- ---------------------------------------------------------------------------
-- Registering supervisors
-- ---------------------------------------------------------------------------

create or replace function public.admin_register_supervisor(p_email text, p_name text, p_role text default null, p_reg_no text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e text := public._clean_email(p_email);
  acc public.supervisor_account;
begin
  perform public._require_admin();
  if char_length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Enter the supervisor''s name' using errcode = '22023';
  end if;
  update public.supervisor_account
     set name = btrim(p_name), role = nullif(btrim(p_role), ''), kmpdc_reg_no = nullif(btrim(p_reg_no), '')
   where email = e and removed_at is null
  returning * into acc;
  if not found then
    insert into public.supervisor_account (email, name, role, kmpdc_reg_no, created_by)
    values (e, btrim(p_name), nullif(btrim(p_role), ''), nullif(btrim(p_reg_no), ''), auth.uid())
    returning * into acc;
  end if;
  return jsonb_build_object('id', acc.id, 'email', acc.email, 'name', acc.name);
end;
$$;

-- Removing a supervisor disconnects them from every intern. Their records
-- stay in the interns' logbooks, so past sign-offs keep their names.
create or replace function public.admin_remove_supervisor(p_account uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  update public.supervisor_account set removed_at = now() where id = p_account and removed_at is null;
  if not found then
    raise exception 'Supervisor not found' using errcode = 'P0002';
  end if;
  perform set_config('app.linking', 'on', true);
  update public.supervisor set user_id = null, linked_at = null, account_id = null where account_id = p_account;
  perform set_config('app.linking', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Linking a registered supervisor to an intern
-- ---------------------------------------------------------------------------

-- p_supervisor: one of the intern's existing supervisor records (entries the
-- intern already assigned to it reach the supervisor). Null adds a new record
-- to the intern's logbook, which arrives on their phone at the next sync.
create or replace function public.admin_link_supervisor(p_account uuid, p_intern uuid, p_supervisor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  acc public.supervisor_account;
  sup public.supervisor;
  uid uuid;
begin
  perform public._require_admin();
  select * into acc from public.supervisor_account a where a.id = p_account and a.removed_at is null;
  if not found then
    raise exception 'Supervisor not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.internship i where i.owner_id = p_intern and i.deleted_at is null) then
    raise exception 'Intern not found' using errcode = 'P0002';
  end if;
  select u.id into uid from auth.users u where lower(u.email) = acc.email;
  if uid = p_intern then
    raise exception 'A supervisor cannot supervise their own logbook.' using errcode = '42501';
  end if;
  if exists (select 1 from public.supervisor s where s.owner_id = p_intern and s.account_id = acc.id and s.deleted_at is null
              and s.id is distinct from p_supervisor) then
    raise exception '% is already linked to this intern', acc.name using errcode = '23505';
  end if;

  perform set_config('app.linking', 'on', true);
  if p_supervisor is null then
    insert into public.supervisor (id, owner_id, name, role, kmpdc_reg_no, account_id, user_id, linked_at)
    values (gen_random_uuid(), p_intern, acc.name, acc.role, acc.kmpdc_reg_no, acc.id, uid, case when uid is null then null else now() end)
    returning * into sup;
  else
    update public.supervisor
       set account_id = acc.id, user_id = uid, linked_at = case when uid is null then null else now() end
     where id = p_supervisor and owner_id = p_intern and deleted_at is null
    returning * into sup;
    if not found then
      perform set_config('app.linking', '', true);
      raise exception 'That supervisor record is not in this intern''s logbook' using errcode = 'P0002';
    end if;
  end if;
  perform set_config('app.linking', '', true);
  return jsonb_build_object('supervisor_id', sup.id, 'linked', uid is not null);
end;
$$;

create or replace function public.admin_unlink_supervisor(p_supervisor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  perform public._require_admin();
  perform set_config('app.linking', 'on', true);
  update public.supervisor set user_id = null, linked_at = null, account_id = null where id = p_supervisor and deleted_at is null;
  get diagnostics n = row_count;
  perform set_config('app.linking', '', true);
  if n = 0 then
    raise exception 'Supervisor not found' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Administrators
-- ---------------------------------------------------------------------------

create or replace function public.admin_add_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  insert into public.app_admin (email, added_by) values (public._clean_email(p_email), auth.uid()) on conflict do nothing;
end;
$$;

create or replace function public.admin_remove_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if (select count(*) from public.app_admin) <= 1 then
    raise exception 'Keep at least one administrator' using errcode = '42501';
  end if;
  delete from public.app_admin where email = lower(btrim(p_email));
  if not found then
    raise exception 'Administrator not found' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The supervisor's activity feed: what each linked intern submitted to them,
-- with its status and the latest decision. Drafts stay private to the intern.
-- ---------------------------------------------------------------------------

create or replace function public.supervisor_activity()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to review' using errcode = '28000';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'supervisor_id', s.id,
           'summary', (select jsonb_build_object(
                          'total', count(*),
                          'submitted', count(*) filter (where e.status = 'submitted'),
                          'returned', count(*) filter (where e.status = 'returned'),
                          'verified', count(*) filter (where e.status in ('verified', 'locked')),
                          'last_7_days', count(*) filter (where e.performed_on > current_date - 7),
                          'last_on', max(e.performed_on))
                         from public.logbook_entry e
                        where e.supervisor_id = s.id and e.deleted_at is null and e.status not in ('draft', 'withdrawn')),
           'entries', (select coalesce(jsonb_agg(item order by item ->> 'performed_on' desc, item ->> 'id' desc), '[]'::jsonb)
                         from (
                           select to_jsonb(e) - 'patient_ref'
                                  || jsonb_build_object(
                                       'rotation', (select r.rotation from public.rotation r where r.id = e.rotation_id),
                                       'visit', (select jsonb_build_object(
                                                  'procedures', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                                                    'id', p.id, 'procedure_type_id', p.procedure_type_id, 'stage', p.stage, 'other_name', p.other_name)) order by p.ord), '[]'::jsonb)
                                                                 from public.encounter_procedure p where p.encounter_id = x.id),
                                                  'diagnoses', (select coalesce(jsonb_agg(f.term order by f.ord), '[]'::jsonb)
                                                                 from public.finding f where f.encounter_id = x.id and f.is_diagnosis))
                                                 from public.encounter x where x.id = e.encounter_id),
                                       'activity', (select jsonb_strip_nulls(jsonb_build_object('activity_type_id', a.activity_type_id, 'title', a.title))
                                                      from public.activity a where a.id = e.activity_id),
                                       'decision', (select jsonb_build_object('decision', v.decision, 'level_observed', v.level_observed, 'comment', v.comment, 'signed_at', v.signed_at)
                                                      from public.verification v where v.entry_id = e.id
                                                     order by v.signed_at desc limit 1)
                                     ) as item
                             from public.logbook_entry e
                            where e.supervisor_id = s.id and e.deleted_at is null and e.status not in ('draft', 'withdrawn')
                            order by e.performed_on desc, e.id desc
                            limit 60
                         ) recent),
           'case_reports', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'date', c.date, 'status', c.status) order by c.date desc), '[]'::jsonb)
                              from public.case_report c where c.supervisor_id = s.id and c.deleted_at is null and c.status <> 'draft')
         )), '[]'::jsonb)
    into result
    from public.supervisor s
   where s.user_id = auth.uid() and s.deleted_at is null;
  return result;
end;
$$;

-- A supervisor reads the verifications on entries submitted to them, not only
-- their own (the feed shows a PIN sign-off made on the intern's phone too).
create policy supervisor_select on public.verification for select to authenticated
  using (entry_id in (select e.id from public.logbook_entry e
                       where e.supervisor_id in (select s.id from public.supervisor s where s.user_id = auth.uid() and s.deleted_at is null)));

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function public._require_admin() from public, anon, authenticated;
revoke execute on function public._clean_email(text) from public, anon, authenticated;
revoke execute on function public.tg_supervisor_link_guard() from public, anon, authenticated;
revoke execute on function public.tg_sync_stamp() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.admin_overview() from public, anon;
revoke execute on function public.admin_register_supervisor(text, text, text, text) from public, anon;
revoke execute on function public.admin_remove_supervisor(uuid) from public, anon;
revoke execute on function public.admin_link_supervisor(uuid, uuid, uuid) from public, anon;
revoke execute on function public.admin_unlink_supervisor(uuid) from public, anon;
revoke execute on function public.admin_add_admin(text) from public, anon;
revoke execute on function public.admin_remove_admin(text) from public, anon;
revoke execute on function public.supervisor_activity() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_register_supervisor(text, text, text, text) to authenticated;
grant execute on function public.admin_remove_supervisor(uuid) to authenticated;
grant execute on function public.admin_link_supervisor(uuid, uuid, uuid) to authenticated;
grant execute on function public.admin_unlink_supervisor(uuid) to authenticated;
grant execute on function public.admin_add_admin(text) to authenticated;
grant execute on function public.admin_remove_admin(text) to authenticated;
grant execute on function public.supervisor_activity() to authenticated;
