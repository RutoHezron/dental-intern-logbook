-- Digital Dental Internship Logbook — core schema (personal mode).
--
-- Derived from the blueprint's reference schema. Personal mode stores no
-- patient names, contacts or ID numbers: the only patient identifier is the
-- hospital number the paper logbook already asks for. Identity columns for an
-- institutional deployment are added by a separate, later migration.
--
-- Every synced table carries:
--   owner_id            the intern who owns the record (auth.uid())
--   server_seq          global, monotonically increasing sync cursor
--   server_received_at  server receive time (device time is kept separately)
--   deleted_at          soft delete; rows are never hard-deleted by clients

create sequence if not exists public.sync_seq;

-- ---------------------------------------------------------------------------
-- People and structure
-- ---------------------------------------------------------------------------

create table public.profile (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);

create table public.facility (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  name text not null check (char_length(name) between 1 and 200),
  county text,
  facility_type text,
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_received_at timestamptz
);

create table public.internship (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  intern_name text not null check (char_length(intern_name) between 1 and 200),
  email text,
  licence_no text,
  facility_id uuid references public.facility (id),
  institution text,
  requirement_set_id text not null,
  period_from date not null,
  period_to date not null,
  declaration_signed_at timestamptz,
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_received_at timestamptz,
  check (period_to >= period_from)
);

create table public.supervisor (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  name text not null check (char_length(name) between 1 and 200),
  role text,
  rotation text,
  kmpdc_reg_no text,
  -- V1: link to the supervisor's own account once they sign in.
  user_id uuid references auth.users (id),
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_received_at timestamptz
);

create table public.rotation (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  internship_id uuid not null references public.internship (id) on delete cascade,
  rotation text not null,
  starts_on date not null,
  ends_on date not null,
  extended_by_days integer not null default 0 check (extended_by_days >= 0),
  facility_id uuid references public.facility (id),
  department text,
  supervisor_id uuid references public.supervisor (id),
  objectives text,
  outcome text check (outcome in ('completed', 'extended', 'irredeemable')),
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_received_at timestamptz,
  check (ends_on >= starts_on)
);

-- ---------------------------------------------------------------------------
-- Clinical record (pseudonymous)
-- ---------------------------------------------------------------------------

create table public.patient (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  ref text not null check (char_length(ref) between 1 and 24),
  birth_year smallint check (birth_year between 1900 and 2100),
  sex text check (sex in ('F', 'M', 'X')),
  systemic_condition boolean,
  alerts text[],
  created_at timestamptz,
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_received_at timestamptz,
  unique (owner_id, ref)
);
comment on table public.patient is
  'Pseudonymous: hospital number, birth year, sex and structured alerts only. No names, contacts or ID numbers in personal mode.';

create table public.encounter (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  internship_id uuid not null references public.internship (id) on delete cascade,
  rotation_id uuid references public.rotation (id),
  rotation_overridden boolean,
  date date not null,
  time text check (time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  patient_id uuid references public.patient (id),
  visit_type text not null check (visit_type in ('new', 'review', 'continuing', 'emergency')),
  setting text check (setting in ('opd', 'ward', 'theatre', 'emergency', 'outreach', 'other')),
  supervisor_id uuid references public.supervisor (id),
  complaint text,
  referred_to text,
  follow_up_needed boolean,
  notes text,
  tags text[],
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_received_at timestamptz
);

create table public.encounter_procedure (
  id uuid primary key,
  encounter_id uuid not null references public.encounter (id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  ord integer not null default 0,
  procedure_type_id text not null,
  sites text[] not null default '{}',
  stage smallint check (stage between 1 and 10),
  is_final_stage boolean,
  level smallint not null check (level between 1 and 5),
  notes text,
  other_name text
);

create table public.finding (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounter (id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  ord integer not null default 0,
  term text not null,
  site text,
  is_diagnosis boolean not null default false,
  certainty text check (certainty in ('provisional', 'confirmed'))
);

create table public.investigation (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounter (id) on delete cascade,
  owner_id uuid not null default auth.uid(),
  ord integer not null default 0,
  kind text not null,
  site text
);

create table public.activity (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  internship_id uuid not null references public.internship (id) on delete cascade,
  rotation_id uuid references public.rotation (id),
  rotation_overridden boolean,
  date date not null,
  activity_type_id text not null,
  level smallint not null check (level between 1 and 5),
  supervisor_id uuid references public.supervisor (id),
  community_item smallint check (community_item between 1 and 16),
  case_type text,
  case_slot smallint check (case_slot between 1 and 10),
  follow_up_step text check (follow_up_step in ('identification', 'genogram', 'home_visit', 'clinic_review')),
  weekly_report_no smallint check (weekly_report_no between 1 and 8),
  title text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_received_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Logbook (derived entries) and verification (append-only, hash-chained)
-- ---------------------------------------------------------------------------

create table public.logbook_entry (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  internship_id uuid not null references public.internship (id) on delete cascade,
  requirement_code text not null,
  rotation_id uuid references public.rotation (id),
  encounter_id uuid references public.encounter (id),
  -- Child procedure rows are replaced on every push, so this is a plain reference.
  encounter_procedure_id uuid,
  activity_id uuid references public.activity (id),
  performed_on date not null,
  patient_ref text,
  site text,
  level_claimed smallint not null check (level_claimed between 1 and 5),
  status text not null check (status in ('draft', 'submitted', 'returned', 'verified', 'locked', 'withdrawn')),
  rule text not null,
  override_reason text,
  supervisor_id uuid references public.supervisor (id),
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_received_at timestamptz,
  check ((encounter_id is null) <> (activity_id is null))
);

create table public.verification (
  id uuid primary key,
  owner_id uuid not null,
  entry_id uuid not null references public.logbook_entry (id),
  verifier_id uuid not null,
  decision text not null check (decision in ('verified', 'returned')),
  level_observed smallint check (level_observed between 1 and 5),
  comment text,
  method text not null check (method in ('passkey', 'pin', 'wet_signature_scan', 'co_located_qr', 'demo')),
  signed_at timestamptz not null,
  prev_hash text,
  hash text not null,
  server_seq bigint not null default 0,
  server_received_at timestamptz,
  check (decision = 'verified' or (comment is not null and char_length(comment) > 0))
);

-- ---------------------------------------------------------------------------
-- Reflection diary and finalised reports
-- ---------------------------------------------------------------------------

create table public.reflection (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  internship_id uuid not null references public.internship (id) on delete cascade,
  date date not null,
  encounter_id uuid references public.encounter (id),
  activity_id uuid references public.activity (id),
  title text not null default '',
  interesting text,
  learned text,
  challenged text,
  do_differently text,
  revise text,
  need_exposure text,
  tags text[] not null default '{}',
  shared_with_supervisor boolean not null default false,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_received_at timestamptz
);

create table public.report_snapshot (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  kind text not null,
  label text not null,
  "from" date not null,
  "to" date not null,
  finalised_at timestamptz not null,
  payload jsonb not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_received_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Audit log: who did what to which row. Never clinical content.
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  table_name text not null,
  row_id uuid,
  at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes for sync pulls and common lookups
-- ---------------------------------------------------------------------------

create index on public.facility (owner_id, server_seq);
create index on public.internship (owner_id, server_seq);
create index on public.supervisor (owner_id, server_seq);
create index on public.rotation (owner_id, server_seq);
create index on public.patient (owner_id, server_seq);
create index on public.encounter (owner_id, server_seq);
create index on public.encounter (owner_id, date);
create index on public.encounter_procedure (encounter_id);
create index on public.finding (encounter_id);
create index on public.investigation (encounter_id);
create index on public.activity (owner_id, server_seq);
create index on public.logbook_entry (owner_id, server_seq);
create index on public.logbook_entry (owner_id, requirement_code);
create index on public.logbook_entry (supervisor_id, status);
create index on public.verification (owner_id, server_seq);
create index on public.verification (entry_id);
create index on public.reflection (owner_id, server_seq);
create index on public.report_snapshot (owner_id, server_seq);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Stamp the sync cursor and receive time; pin ownership to the caller on insert
-- and forbid ownership changes on update.
create or replace function public.tg_sync_stamp() returns trigger
language plpgsql as $$
begin
  new.server_seq := nextval('public.sync_seq');
  new.server_received_at := now();
  if tg_op = 'INSERT' then
    -- A verification belongs to the intern who owns the entry, not to the
    -- supervisor who signs it; verify_entry() sets it explicitly.
    if auth.uid() is not null and tg_table_name <> 'verification' then
      new.owner_id := auth.uid();
    end if;
  else
    new.owner_id := old.owner_id;
  end if;
  return new;
end;
$$;

-- Children inherit the caller as owner.
create or replace function public.tg_child_owner() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then
    new.owner_id := auth.uid();
  end if;
  return new;
end;
$$;

-- A verified entry is evidence: it cannot be edited, and only a supervisor
-- verification (which sets app.verifying) can mark an entry verified.
create or replace function public.tg_entry_guard() returns trigger
language plpgsql as $$
declare
  verifying boolean := coalesce(current_setting('app.verifying', true), '') = 'on';
begin
  -- An upsert fires the INSERT trigger before resolving the conflict, so
  -- check for an existing verified row first to give the right reason.
  if tg_op = 'INSERT' and not verifying and exists (
       select 1 from public.logbook_entry e where e.id = new.id and e.status in ('verified', 'locked')
     ) then
    raise exception 'Verified logbook entries cannot be changed; add a correction instead'
      using errcode = '42501';
  end if;
  if not verifying and new.status in ('verified', 'locked')
     and (tg_op = 'INSERT' or old.status not in ('verified', 'locked')) then
    raise exception 'Only a supervisor verification can mark a logbook entry as verified'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and not verifying and old.status in ('verified', 'locked') and (
       new.status is distinct from old.status
       or new.requirement_code is distinct from old.requirement_code
       or new.performed_on is distinct from old.performed_on
       or new.patient_ref is distinct from old.patient_ref
       or new.site is distinct from old.site
       or new.level_claimed is distinct from old.level_claimed
     ) then
    raise exception 'Verified logbook entries cannot be changed; add a correction instead'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.tg_append_only() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

create or replace function public.tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor_id, action, table_name, row_id)
  values (auth.uid(), lower(tg_op), tg_table_name, new.id);
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'facility', 'internship', 'supervisor', 'rotation', 'patient', 'encounter',
    'activity', 'logbook_entry', 'verification', 'reflection', 'report_snapshot'
  ] loop
    execute format('create trigger sync_stamp before insert or update on public.%I for each row execute function public.tg_sync_stamp()', t);
    execute format('create trigger audit after insert or update on public.%I for each row execute function public.tg_audit()', t);
  end loop;
  foreach t in array array['encounter_procedure', 'finding', 'investigation'] loop
    execute format('create trigger child_owner before insert on public.%I for each row execute function public.tg_child_owner()', t);
  end loop;
end;
$$;

create trigger entry_guard before insert or update on public.logbook_entry
  for each row execute function public.tg_entry_guard();
create trigger verification_append_only before update or delete on public.verification
  for each row execute function public.tg_append_only();
create trigger audit_append_only before update or delete on public.audit_log
  for each row execute function public.tg_append_only();

-- Create a profile row when someone signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profile (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
