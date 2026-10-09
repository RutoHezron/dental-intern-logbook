-- Treatment plans (blueprint §11): set by the clinician; items are stored as
-- JSON inside the plan. Also: sync now reads its table list from a registry,
-- so new tables need one row here rather than new copies of the functions.

create table public.treatment_plan (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  internship_id uuid not null references public.internship (id) on delete cascade,
  patient_id uuid not null references public.patient (id),
  created_on date not null,
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  consent_note text,
  handover_note text,
  handover_to text,
  handed_over_on date,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_received_at timestamptz
);

create index on public.treatment_plan (owner_id, server_seq);
create index on public.treatment_plan (patient_id);

create trigger sync_stamp before insert or update on public.treatment_plan
  for each row execute function public.tg_sync_stamp();
create trigger audit after insert or update on public.treatment_plan
  for each row execute function public.tg_audit();

alter table public.treatment_plan enable row level security;
alter table public.treatment_plan force row level security;
create policy owner_select on public.treatment_plan for select to authenticated using (owner_id = auth.uid());
create policy owner_insert on public.treatment_plan for insert to authenticated with check (owner_id = auth.uid());
create policy owner_update on public.treatment_plan for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update on public.treatment_plan to authenticated;

-- ---------------------------------------------------------------------------
-- Sync registry
-- ---------------------------------------------------------------------------

create table public.sync_table (
  name text primary key,
  pull_order smallint not null,
  device_writable boolean not null
);
-- Read by sync_push / sync_pull, which run as the signed-in user.
revoke all on public.sync_table from anon, authenticated;
grant select on public.sync_table to authenticated;

insert into public.sync_table (name, pull_order, device_writable) values
  ('facility', 1, true),
  ('internship', 2, true),
  ('supervisor', 3, true),
  ('rotation', 4, true),
  ('patient', 5, true),
  ('activity', 6, true),
  ('logbook_entry', 7, true),
  ('reflection', 8, true),
  ('report_snapshot', 9, true),
  ('assessment', 10, true),
  ('case_report', 11, true),
  ('treatment_plan', 12, true),
  ('verification', 13, true);
-- 'encounter' is handled separately (it carries its child rows).

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
  writable text[];
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
  select array_agg(name) || array['encounter'] into writable from public.sync_table where device_writable;

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

  for t in select name from public.sync_table order by pull_order loop
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
