-- Offline-first sync (blueprint §20.2).
--
-- push: the device sends a batch of changes from its outbox. Each change is
--       applied in its own savepoint, so one rejected record (for example an
--       attempt to edit a verified entry) never blocks the rest.
-- pull: the device asks for everything changed since its cursor
--       (server_seq), including soft-deleted rows as tombstones.
--
-- Both run as the caller (security invoker), so row-level security applies.

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
begin
  base := rec - 'procedures' - 'findings' - 'investigations' - 'owner_id' - 'server_seq' - 'server_received_at';
  if op = 'delete' then
    base := base || jsonb_build_object('deleted_at', coalesce(base ->> 'deleted_at', now()::text));
  end if;

  -- Only columns that exist on the table and are present in the record.
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

  execute format(
    'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) on conflict (id) do update set %3$s',
    tbl, cols, coalesce(sets, 'id = excluded.id')
  ) using base;

  -- An encounter carries its procedures, findings and investigations; replace them.
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
    'activity', 'logbook_entry', 'reflection', 'report_snapshot'
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
    'logbook_entry', 'verification', 'reflection', 'report_snapshot'
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

grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_pull(bigint) to authenticated;
revoke execute on function public._sync_upsert(text, jsonb, text) from public, anon;
grant execute on function public._sync_upsert(text, jsonb, text) to authenticated;
