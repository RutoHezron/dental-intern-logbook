-- Case reports (KMPDC 5.x.5 Log of Case Reports), verified with the same
-- append-only, hash-chained verifications as logbook entries. A verification
-- now targets exactly one of: a logbook entry or a case report.

create table public.case_report (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  internship_id uuid not null references public.internship (id) on delete cascade,
  rotation_id uuid references public.rotation (id),
  date date not null,
  title text not null check (char_length(title) between 1 and 300),
  patient_id uuid references public.patient (id),
  encounter_ids uuid[] not null default '{}',
  sections jsonb not null default '{}'::jsonb check (jsonb_typeof(sections) = 'object'),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'returned', 'verified')),
  supervisor_id uuid references public.supervisor (id),
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_received_at timestamptz
);

create index on public.case_report (owner_id, server_seq);

create trigger sync_stamp before insert or update on public.case_report
  for each row execute function public.tg_sync_stamp();
create trigger audit after insert or update on public.case_report
  for each row execute function public.tg_audit();

-- Same rule as entries: status changes to verified / returned only through a
-- verification; a verified report's content cannot change.
create or replace function public.tg_case_report_guard() returns trigger
language plpgsql as $$
declare
  verifying boolean := coalesce(current_setting('app.verifying', true), '') = 'on';
  existing public.case_report;
begin
  if verifying then
    return new;
  end if;
  if tg_op = 'INSERT' then
    select * into existing from public.case_report c where c.id = new.id;
    if found then
      if existing.status = 'verified' and (
           new.title is distinct from existing.title
           or new.date is distinct from existing.date
           or new.sections is distinct from existing.sections
           or new.status <> 'verified'
         ) then
        raise exception 'Verified case reports cannot be changed' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.status in ('verified', 'returned') then
      new.status := 'submitted';
    end if;
    return new;
  end if;
  if old.status = 'verified' then
    if new.title is distinct from old.title or new.date is distinct from old.date
       or new.sections is distinct from old.sections or new.status is distinct from old.status then
      raise exception 'Verified case reports cannot be changed' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status = 'verified' or (new.status = 'returned' and old.status <> 'returned') then
    new.status := old.status;
  end if;
  return new;
end;
$$;

create trigger case_report_guard before insert or update on public.case_report
  for each row execute function public.tg_case_report_guard();

alter table public.case_report enable row level security;
alter table public.case_report force row level security;
create policy owner_select on public.case_report for select to authenticated using (owner_id = auth.uid());
create policy owner_insert on public.case_report for insert to authenticated with check (owner_id = auth.uid());
create policy owner_update on public.case_report for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update on public.case_report to authenticated;

-- ---------------------------------------------------------------------------
-- Verifications target an entry or a case report.
-- ---------------------------------------------------------------------------

alter table public.verification alter column entry_id drop not null;
alter table public.verification add column case_report_id uuid references public.case_report (id);
alter table public.verification add constraint verification_one_target check (num_nonnulls(entry_id, case_report_id) = 1);
create index on public.verification (case_report_id);

drop policy phone_signoff_insert on public.verification;
create policy phone_signoff_insert on public.verification
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and method = 'pin'
    and (
      exists (select 1 from public.logbook_entry e where e.id = entry_id and e.owner_id = auth.uid())
      or exists (select 1 from public.case_report c where c.id = case_report_id and c.owner_id = auth.uid())
    )
  );

create or replace function public.tg_verification_applies() returns trigger
language plpgsql as $$
begin
  perform set_config('app.verifying', 'on', true);
  if new.entry_id is not null then
    update public.logbook_entry
       set status = case new.decision when 'verified' then 'verified' else 'returned' end
     where id = new.entry_id;
  else
    update public.case_report
       set status = case new.decision when 'verified' then 'verified' else 'returned' end
     where id = new.case_report_id;
  end if;
  perform set_config('app.verifying', '', true);
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sync: include case reports.
-- ---------------------------------------------------------------------------

create or replace function public.sync_push(changes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  ch jsonb;
  tbl text;
  rec jsonb;
  accepted jsonb := '[]'::jsonb;
  rejected jsonb := '[]'::jsonb;
  writable constant text[] := array[
    'facility', 'internship', 'supervisor', 'rotation', 'patient', 'encounter',
    'activity', 'logbook_entry', 'reflection', 'report_snapshot', 'assessment', 'case_report', 'verification'
  ];
begin
  if auth.uid() is null then
    raise exception 'Sign in to sync' using errcode = '28000';
  end if;
  if jsonb_typeof(changes) <> 'array' then
    raise exception 'changes must be an array';
  end if;
  if jsonb_array_length(changes) > 500 then
    raise exception 'Send at most 500 changes per batch';
  end if;

  for ch in select value from jsonb_array_elements(changes) loop
    tbl := ch ->> 'table';
    rec := ch -> 'record';
    begin
      if tbl is null or not (tbl = any (writable)) then
        raise exception 'table "%" cannot be written by a device', coalesce(tbl, '?');
      end if;
      if rec ->> 'id' is null then
        raise exception 'missing id';
      end if;
      perform public._sync_upsert(tbl, rec, coalesce(ch ->> 'op', 'upsert'));
      accepted := accepted || jsonb_build_object('table', tbl, 'id', rec ->> 'id');
    exception when others then
      rejected := rejected || jsonb_build_object('table', tbl, 'id', rec ->> 'id', 'reason', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('accepted', accepted, 'rejected', rejected);
end;
$$;

create or replace function public.sync_pull(since bigint default 0)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  t text;
  rows jsonb;
  top bigint;
  cursor_out bigint := coalesce(since, 0);
  result jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to sync' using errcode = '28000';
  end if;

  foreach t in array array[
    'facility', 'internship', 'supervisor', 'rotation', 'patient', 'activity',
    'logbook_entry', 'verification', 'reflection', 'report_snapshot', 'assessment', 'case_report'
  ] loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(x) order by x.server_seq), ''[]''::jsonb), max(x.server_seq) from public.%I x where x.server_seq > $1',
      t
    ) into rows, top using coalesce(since, 0);
    result := result || jsonb_build_object(t, rows);
    cursor_out := greatest(cursor_out, coalesce(top, 0));
  end loop;

  select coalesce(jsonb_agg(
           to_jsonb(e)
           || jsonb_build_object(
                'procedures', coalesce((
                  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                           'id', p.id, 'procedure_type_id', p.procedure_type_id, 'sites', p.sites,
                           'stage', p.stage, 'is_final_stage', p.is_final_stage, 'level', p.level,
                           'notes', p.notes, 'other_name', p.other_name)) order by p.ord)
                    from public.encounter_procedure p where p.encounter_id = e.id), '[]'::jsonb),
                'findings', coalesce((
                  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                           'term', f.term, 'site', f.site, 'is_diagnosis', f.is_diagnosis, 'certainty', f.certainty)) order by f.ord)
                    from public.finding f where f.encounter_id = e.id), '[]'::jsonb),
                'investigations', coalesce((
                  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('kind', i.kind, 'site', i.site)) order by i.ord)
                    from public.investigation i where i.encounter_id = e.id), '[]'::jsonb)
              )
           order by e.server_seq), '[]'::jsonb),
         max(e.server_seq)
    into rows, top
    from public.encounter e
   where e.server_seq > coalesce(since, 0);
  result := result || jsonb_build_object('encounter', rows);
  cursor_out := greatest(cursor_out, coalesce(top, 0));

  return jsonb_build_object('cursor', cursor_out, 'changes', result);
end;
$$;
