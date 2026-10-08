-- Assessment and evaluation forms (KMPDC 5.x.6 / 5.x.7): monthly, mid-rotation,
-- end-of-rotation evaluation and overall assessment. Answers are stored as JSON
-- keyed by the form's item ids, versioned by form_version, so a new logbook
-- edition needs no schema change.

create table public.assessment (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  internship_id uuid not null references public.internship (id) on delete cascade,
  rotation_id uuid not null references public.rotation (id) on delete cascade,
  kind text not null check (kind in ('monthly', 'mid_rotation', 'end_of_rotation', 'overall_rotation')),
  sequence smallint not null default 1 check (sequence between 1 and 4),
  form_version text not null,
  held_on date,
  held_at text check (held_at is null or held_at ~ '^[0-2][0-9]:[0-5][0-9]$'),
  responses jsonb not null default '{}'::jsonb,
  grades jsonb not null default '{}'::jsonb,
  grade_remarks jsonb not null default '{}'::jsonb,
  overall_grade smallint check (overall_grade between 0 and 3),
  recommendation text,
  outcome text check (outcome in ('completed', 'extend', 'irredeemable')),
  extend_by text,
  progress_snapshot jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_received_at timestamptz,
  check (jsonb_typeof(responses) = 'object' and jsonb_typeof(grades) = 'object' and jsonb_typeof(grade_remarks) = 'object'),
  check (outcome is distinct from 'extend' or coalesce(char_length(extend_by), 0) > 0)
);

create index on public.assessment (owner_id, server_seq);
create unique index assessment_one_per_slot on public.assessment (rotation_id, kind, sequence) where deleted_at is null;

create trigger sync_stamp before insert or update on public.assessment
  for each row execute function public.tg_sync_stamp();
create trigger audit after insert or update on public.assessment
  for each row execute function public.tg_audit();

alter table public.assessment enable row level security;
alter table public.assessment force row level security;
create policy owner_select on public.assessment for select to authenticated using (owner_id = auth.uid());
create policy owner_insert on public.assessment for insert to authenticated with check (owner_id = auth.uid());
create policy owner_update on public.assessment for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update on public.assessment to authenticated;

-- Include assessments in sync.
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
    'activity', 'logbook_entry', 'reflection', 'report_snapshot', 'verification', 'assessment'
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
    'logbook_entry', 'verification', 'reflection', 'report_snapshot', 'assessment'
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
