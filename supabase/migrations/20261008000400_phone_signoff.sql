-- Supervisor sign-off on the intern's phone (V1).
--
-- The logbook lives on the phone and must work offline, so a supervisor can
-- review and sign the intern's entries on the intern's own device with a
-- personal PIN. The phone creates hash-chained verification records and
-- pushes them when it next syncs.
--
-- The rule stays the same: only a verification record changes an entry's
-- status. The server now:
--   * accepts PIN verifications pushed by the intern, for the intern's own entries;
--   * sets the entry's status from each verification (trigger), and
--   * ignores any status a device tries to set directly (instead of failing
--     the push), except resubmitting a returned entry.
-- Verified entries still cannot be edited.

alter table public.verification alter column owner_id set default auth.uid();

-- ---------------------------------------------------------------------------
-- Entry guard: the server owns verified / returned / locked.
-- ---------------------------------------------------------------------------

create or replace function public.tg_entry_guard() returns trigger
language plpgsql as $$
declare
  verifying boolean := coalesce(current_setting('app.verifying', true), '') = 'on';
  existing public.logbook_entry;
begin
  if verifying then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- An upsert fires this before resolving the conflict: compare with the stored row.
    select * into existing from public.logbook_entry e where e.id = new.id;
    if found then
      if existing.status in ('verified', 'locked') and (
           new.requirement_code is distinct from existing.requirement_code
           or new.performed_on is distinct from existing.performed_on
           or new.patient_ref is distinct from existing.patient_ref
           or new.site is distinct from existing.site
           or new.level_claimed is distinct from existing.level_claimed
           or new.status not in ('verified', 'locked')
         ) then
        raise exception 'Verified logbook entries cannot be changed; add a correction instead'
          using errcode = '42501';
      end if;
      return new; -- the UPDATE trigger below settles the status
    end if;
    if new.status in ('verified', 'returned', 'locked') then
      new.status := 'submitted';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status in ('verified', 'locked') then
    if new.requirement_code is distinct from old.requirement_code
       or new.performed_on is distinct from old.performed_on
       or new.patient_ref is distinct from old.patient_ref
       or new.site is distinct from old.site
       or new.level_claimed is distinct from old.level_claimed
       or new.status is distinct from old.status then
      raise exception 'Verified logbook entries cannot be changed; add a correction instead'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status in ('verified', 'locked')
     or (new.status = 'returned' and old.status <> 'returned') then
    new.status := old.status;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- A verification sets its entry's status.
-- ---------------------------------------------------------------------------

create or replace function public.tg_verification_applies() returns trigger
language plpgsql as $$
begin
  perform set_config('app.verifying', 'on', true);
  update public.logbook_entry
     set status = case new.decision when 'verified' then 'verified' else 'returned' end
   where id = new.entry_id;
  perform set_config('app.verifying', '', true);
  return null;
end;
$$;

create trigger verification_applies after insert on public.verification
  for each row execute function public.tg_verification_applies();

-- ---------------------------------------------------------------------------
-- The intern's device may insert PIN sign-offs for its own entries.
-- ---------------------------------------------------------------------------

create policy phone_signoff_insert on public.verification
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and method = 'pin'
    and exists (select 1 from public.logbook_entry e where e.id = entry_id and e.owner_id = auth.uid())
  );
grant insert on public.verification to authenticated;

-- ---------------------------------------------------------------------------
-- Sync: verifications are append-only, so a re-sent one is simply skipped.
-- ---------------------------------------------------------------------------

create or replace function public._sync_upsert(tbl text, rec jsonb, op text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  base jsonb;
  cols text;
  sets text;
  enc_id uuid;
  conflict text;
begin
  base := rec - 'procedures' - 'findings' - 'investigations' - 'owner_id' - 'server_seq' - 'server_received_at';
  if op = 'delete' then
    if tbl = 'verification' then
      raise exception 'verifications cannot be deleted';
    end if;
    base := base || jsonb_build_object('deleted_at', coalesce(base ->> 'deleted_at', now()::text));
  end if;

  select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position),
         string_agg(format('%I = excluded.%I', c.column_name, c.column_name), ', ' order by c.ordinal_position)
           filter (where c.column_name <> 'id')
    into cols, sets
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = tbl
     and base ? c.column_name
     and c.column_name not in ('owner_id', 'server_seq', 'server_received_at');

  if cols is null then
    raise exception 'record has no known columns';
  end if;

  conflict := case when tbl = 'verification' then 'do nothing' else 'do update set ' || coalesce(sets, 'id = excluded.id') end;
  execute format(
    'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) on conflict (id) %3$s',
    tbl, cols, conflict
  ) using base;

  if tbl = 'encounter' then
    enc_id := (rec ->> 'id')::uuid;
    if rec ? 'procedures' then
      delete from public.encounter_procedure where encounter_id = enc_id;
      insert into public.encounter_procedure (id, encounter_id, ord, procedure_type_id, sites, stage, is_final_stage, level, notes, other_name)
      select (p ->> 'id')::uuid, enc_id, o::int, p ->> 'procedure_type_id',
             coalesce(array(select jsonb_array_elements_text(p -> 'sites')), '{}'),
             (p ->> 'stage')::smallint, (p ->> 'is_final_stage')::boolean, (p ->> 'level')::smallint,
             p ->> 'notes', p ->> 'other_name'
        from jsonb_array_elements(rec -> 'procedures') with ordinality as t(p, o);
    end if;
    if rec ? 'findings' then
      delete from public.finding where encounter_id = enc_id;
      insert into public.finding (encounter_id, ord, term, site, is_diagnosis, certainty)
      select enc_id, o::int, f ->> 'term', f ->> 'site', coalesce((f ->> 'is_diagnosis')::boolean, false), f ->> 'certainty'
        from jsonb_array_elements(rec -> 'findings') with ordinality as t(f, o);
    end if;
    if rec ? 'investigations' then
      delete from public.investigation where encounter_id = enc_id;
      insert into public.investigation (encounter_id, ord, kind, site)
      select enc_id, o::int, i ->> 'kind', i ->> 'site'
        from jsonb_array_elements(rec -> 'investigations') with ordinality as t(i, o);
    end if;
  end if;
end;
$$;

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
    'activity', 'logbook_entry', 'reflection', 'report_snapshot', 'verification'
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
