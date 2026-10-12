-- Supervisor accounts (V1): supervisors review and sign from their own device.
--
-- An intern invites a supervisor (a one-time code, shown as a link and QR
-- code). The supervisor signs in and accepts it, which links the intern's
-- supervisor record to the supervisor's account. From then on the supervisor
-- can read, and only read, what was submitted to them, and sign it.
--
-- Rules kept from earlier migrations:
--   * only a verification changes an entry's or case report's status;
--   * verifications are append-only and hash-chained.
-- Account sign-offs form one chain per supervisor (verifier_id), separate from
-- the chain on the intern's phone. The supervisor's device builds the records
-- (the same code the phone uses); the server appends them only if they extend
-- the chain head it holds, under a lock, so concurrent devices cannot fork it.

-- ---------------------------------------------------------------------------
-- 'account' sign-off method
-- ---------------------------------------------------------------------------

alter table public.verification drop constraint verification_method_check;
alter table public.verification add constraint verification_method_check
  check (method in ('passkey', 'pin', 'wet_signature_scan', 'co_located_qr', 'demo', 'account'));
create index on public.verification (verifier_id, method, signed_at);

-- ---------------------------------------------------------------------------
-- Linking: only the invite flow sets supervisor.user_id.
-- ---------------------------------------------------------------------------

alter table public.supervisor add column linked_at timestamptz;
create index on public.supervisor (user_id) where user_id is not null;

create or replace function public.tg_supervisor_link_guard() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.linking', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- An upsert fires this before resolving the conflict: keep the stored link.
    select s.user_id, s.linked_at into new.user_id, new.linked_at from public.supervisor s where s.id = new.id;
    return new;
  end if;
  new.user_id := old.user_id;
  new.linked_at := old.linked_at;
  return new;
end;
$$;

create trigger supervisor_link_guard before insert or update on public.supervisor
  for each row execute function public.tg_supervisor_link_guard();

-- ---------------------------------------------------------------------------
-- Invites: a one-time code; only its SHA-256 is stored.
-- ---------------------------------------------------------------------------

create table public.supervisor_invite (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  supervisor_id uuid not null references public.supervisor (id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id)
);

alter table public.supervisor_invite enable row level security;
alter table public.supervisor_invite force row level security;
create policy owner_select on public.supervisor_invite for select to authenticated using (owner_id = auth.uid());
grant select on public.supervisor_invite to authenticated;

create or replace function public._invite_hash(code text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g')), 'UTF8')), 'hex')
$$;

-- Twelve characters from a 32-letter alphabet without look-alikes (60 bits),
-- shown as XXXX-XXXX-XXXX. Single use and valid for seven days.
create or replace function public.create_supervisor_invite(p_supervisor uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
  code text := '';
  i int;
  inv public.supervisor_invite;
begin
  if auth.uid() is null then
    raise exception 'Sign in to invite a supervisor' using errcode = '28000';
  end if;
  if not exists (select 1 from public.supervisor s where s.id = p_supervisor and s.owner_id = auth.uid() and s.deleted_at is null) then
    raise exception 'Sync your logbook first: this supervisor is not on the server yet' using errcode = 'P0002';
  end if;
  -- Bytes 0-5 and 16-21 of two random UUIDs avoid the fixed version/variant bits.
  foreach i in array array[0, 1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 21] loop
    code := code || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  -- An unused earlier invite for this supervisor stops working.
  delete from public.supervisor_invite where supervisor_id = p_supervisor and accepted_at is null;
  insert into public.supervisor_invite (supervisor_id, code_hash) values (p_supervisor, public._invite_hash(code))
  returning * into inv;
  return jsonb_build_object(
    'code', substr(code, 1, 4) || '-' || substr(code, 5, 4) || '-' || substr(code, 9, 4),
    'expires_at', inv.expires_at
  );
end;
$$;
grant insert, delete on public.supervisor_invite to authenticated;
create policy owner_insert on public.supervisor_invite for insert to authenticated with check (owner_id = auth.uid());
create policy owner_delete on public.supervisor_invite for delete to authenticated using (owner_id = auth.uid());

-- Accepting runs with the definer's rights: the supervisor cannot see the
-- intern's rows until the link exists.
create or replace function public.accept_supervisor_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.supervisor_invite;
  sup public.supervisor;
  intern text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to accept the invite' using errcode = '28000';
  end if;
  select * into inv from public.supervisor_invite i where i.code_hash = public._invite_hash(p_code) for update;
  if not found or inv.accepted_at is not null or inv.expires_at < now() then
    raise exception 'This invite code is not valid. Ask the intern for a new one.' using errcode = 'P0002';
  end if;
  if inv.owner_id = auth.uid() then
    raise exception 'You cannot supervise your own logbook.' using errcode = '42501';
  end if;
  perform set_config('app.linking', 'on', true);
  update public.supervisor set user_id = auth.uid(), linked_at = now() where id = inv.supervisor_id returning * into sup;
  perform set_config('app.linking', '', true);
  update public.supervisor_invite set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  select i.intern_name into intern from public.internship i where i.owner_id = inv.owner_id and i.deleted_at is null order by i.period_from desc limit 1;
  return jsonb_build_object('supervisor_id', sup.id, 'supervisor_name', sup.name, 'intern_name', intern);
end;
$$;

-- The intern can disconnect a supervisor's account at any time.
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
  update public.supervisor set user_id = null, linked_at = null where id = p_supervisor;
  perform set_config('app.linking', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- What a linked supervisor may read: only what was submitted to them.
-- ---------------------------------------------------------------------------

-- Supervisor records linked to the caller (their own link rows).
create policy linked_select on public.supervisor for select to authenticated
  using (user_id = auth.uid() and deleted_at is null);

create policy supervisor_select on public.logbook_entry for select to authenticated
  using (supervisor_id in (select s.id from public.supervisor s where s.user_id = auth.uid() and s.deleted_at is null and s.owner_id = logbook_entry.owner_id));

create policy supervisor_select on public.case_report for select to authenticated
  using (
    status <> 'draft'
    and supervisor_id in (select s.id from public.supervisor s where s.user_id = auth.uid() and s.deleted_at is null and s.owner_id = case_report.owner_id)
  );

create policy supervisor_select on public.internship for select to authenticated
  using (owner_id in (select s.owner_id from public.supervisor s where s.user_id = auth.uid() and s.deleted_at is null));

create policy supervisor_select on public.rotation for select to authenticated
  using (owner_id in (select s.owner_id from public.supervisor s where s.user_id = auth.uid() and s.deleted_at is null));

-- Visit context for an entry the supervisor can see.
create policy supervisor_select on public.encounter for select to authenticated
  using (exists (select 1 from public.logbook_entry e where e.encounter_id = encounter.id));
create policy supervisor_select on public.encounter_procedure for select to authenticated
  using (exists (select 1 from public.encounter x where x.id = encounter_procedure.encounter_id));
create policy supervisor_select on public.finding for select to authenticated
  using (exists (select 1 from public.encounter x where x.id = finding.encounter_id));
create policy supervisor_select on public.activity for select to authenticated
  using (exists (select 1 from public.logbook_entry e where e.activity_id = activity.id));

-- The supervisor's own sign-offs.
create policy verifier_select on public.verification for select to authenticated
  using (verifier_id in (select s.id from public.supervisor s where s.user_id = auth.uid() and s.deleted_at is null));

-- ---------------------------------------------------------------------------
-- The supervisor's queue
-- ---------------------------------------------------------------------------

create or replace function public.supervisor_queue()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  links jsonb;
  entries jsonb;
  reports jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to review' using errcode = '28000';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'supervisor_id', s.id,
           'owner_id', s.owner_id,
           'supervisor_name', s.name,
           'intern_name', i.intern_name,
           'licence_no', i.licence_no,
           'institution', i.institution,
           'tip', (select jsonb_build_object('id', v.id, 'hash', v.hash, 'signed_at', v.signed_at)
                     from public.verification v
                    where v.verifier_id = s.id and v.method = 'account'
                    order by v.signed_at desc, v.id desc limit 1)
         ) order by i.intern_name), '[]'::jsonb)
    into links
    from public.supervisor s
    left join lateral (
      select x.intern_name, x.licence_no, x.institution from public.internship x
       where x.owner_id = s.owner_id and x.deleted_at is null order by x.period_from desc limit 1
    ) i on true
   where s.user_id = auth.uid() and s.deleted_at is null;

  select coalesce(jsonb_agg(
           to_jsonb(e)
           || jsonb_build_object(
                'rotation', (select r.rotation from public.rotation r where r.id = e.rotation_id),
                'visit', (select jsonb_strip_nulls(jsonb_build_object(
                           'time', x.time, 'visit_type', x.visit_type, 'setting', x.setting,
                           'procedures', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                             'procedure_type_id', p.procedure_type_id, 'sites', p.sites, 'stage', p.stage, 'level', p.level, 'other_name', p.other_name)) order by p.ord), '[]'::jsonb)
                                          from public.encounter_procedure p where p.encounter_id = x.id),
                           'diagnoses', (select coalesce(jsonb_agg(f.term || coalesce(' (' || f.site || ')', '') order by f.ord), '[]'::jsonb)
                                          from public.finding f where f.encounter_id = x.id and f.is_diagnosis)))
                          from public.encounter x where x.id = e.encounter_id),
                'activity', (select jsonb_strip_nulls(jsonb_build_object('activity_type_id', a.activity_type_id, 'title', a.title))
                               from public.activity a where a.id = e.activity_id)
              )
           order by e.performed_on, e.id), '[]'::jsonb)
    into entries
    from public.logbook_entry e
   where e.status = 'submitted' and e.deleted_at is null;

  select coalesce(jsonb_agg(to_jsonb(c) - 'patient_id' order by c.date, c.id), '[]'::jsonb)
    into reports
    from public.case_report c
   where c.status = 'submitted' and c.deleted_at is null;

  return jsonb_build_object('links', links, 'entries', entries, 'case_reports', reports);
end;
$$;

-- ---------------------------------------------------------------------------
-- Signing from the supervisor's account
-- ---------------------------------------------------------------------------

create or replace function public.supervisor_sign(p_records jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec jsonb;
  sup public.supervisor;
  tip public.verification;
  target_owner uuid;
  target_status text;
  target_supervisor uuid;
  v_signed timestamptz;
  n int := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in to sign' using errcode = '28000';
  end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) = 0 then
    raise exception 'Nothing to sign';
  end if;
  if jsonb_array_length(p_records) > 200 then
    raise exception 'Sign at most 200 items at a time';
  end if;

  for rec in select value from jsonb_array_elements(p_records) loop
    select * into sup from public.supervisor s
     where s.id = (rec ->> 'verifier_id')::uuid and s.user_id = auth.uid() and s.deleted_at is null;
    if not found then
      raise exception 'You are not linked as this supervisor' using errcode = '42501';
    end if;
    if coalesce(rec ->> 'method', '') <> 'account' then
      raise exception 'Account sign-offs only';
    end if;

    if rec ->> 'entry_id' is not null and rec ->> 'case_report_id' is null then
      select e.owner_id, e.status, e.supervisor_id into target_owner, target_status, target_supervisor
        from public.logbook_entry e where e.id = (rec ->> 'entry_id')::uuid and e.deleted_at is null;
    elsif rec ->> 'case_report_id' is not null and rec ->> 'entry_id' is null then
      select c.owner_id, c.status, c.supervisor_id into target_owner, target_status, target_supervisor
        from public.case_report c where c.id = (rec ->> 'case_report_id')::uuid and c.deleted_at is null;
    else
      raise exception 'A sign-off needs exactly one entry or case report';
    end if;
    if target_owner is null or target_owner <> sup.owner_id or target_supervisor is distinct from sup.id then
      raise exception 'This item was not submitted to you' using errcode = '42501';
    end if;
    if target_status <> 'submitted' then
      raise exception 'stale: % is no longer awaiting verification', coalesce(rec ->> 'entry_id', rec ->> 'case_report_id') using errcode = '40001';
    end if;

    -- One signer at a time per chain; the record must extend the current head.
    perform pg_advisory_xact_lock(hashtextextended('verification-chain:' || sup.id::text, 0));
    select * into tip from public.verification v
     where v.verifier_id = sup.id and v.method = 'account'
     order by v.signed_at desc, v.id desc limit 1;
    v_signed := (rec ->> 'signed_at')::timestamptz;
    if (rec ->> 'prev_hash') is distinct from tip.hash then
      raise exception 'chain_moved: the chain head is now %', coalesce(tip.hash, 'empty') using errcode = '40001';
    end if;
    if tip.id is not null and v_signed <= tip.signed_at then
      raise exception 'chain_moved: a sign-off must be later than the chain head' using errcode = '40001';
    end if;
    if v_signed > now() + interval '10 minutes' or v_signed < now() - interval '1 day' then
      raise exception 'Check this device''s clock: the signing time is not plausible';
    end if;
    if coalesce(rec ->> 'hash', '') !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid hash';
    end if;

    insert into public.verification (id, owner_id, entry_id, case_report_id, verifier_id, decision, level_observed, comment, method, signed_at, prev_hash, hash)
    values (
      (rec ->> 'id')::uuid, sup.owner_id, (rec ->> 'entry_id')::uuid, (rec ->> 'case_report_id')::uuid, sup.id,
      rec ->> 'decision', (rec ->> 'level_observed')::smallint, nullif(rec ->> 'comment', ''), 'account', v_signed,
      rec ->> 'prev_hash', rec ->> 'hash'
    );
    n := n + 1;
  end loop;
  return jsonb_build_object('signed', n);
end;
$$;

-- Status is set by the verification even when the signer is not the owner.
alter function public.tg_verification_applies() security definer;
alter function public.tg_verification_applies() set search_path = public;

revoke execute on function public.supervisor_sign(jsonb) from public, anon;
revoke execute on function public.accept_supervisor_invite(text) from public, anon;
revoke execute on function public.create_supervisor_invite(uuid) from public, anon;
revoke execute on function public.unlink_supervisor_account(uuid) from public, anon;
revoke execute on function public.supervisor_queue() from public, anon;
grant execute on function public.supervisor_sign(jsonb) to authenticated;
grant execute on function public.accept_supervisor_invite(text) to authenticated;
grant execute on function public.create_supervisor_invite(uuid) to authenticated;
grant execute on function public.unlink_supervisor_account(uuid) to authenticated;
grant execute on function public.supervisor_queue() to authenticated;

-- ---------------------------------------------------------------------------
-- Sync pulls only the caller's own records, now that supervisors can read
-- some of an intern's rows (a supervisor who keeps their own logbook must not
-- receive their interns' entries into it).
-- ---------------------------------------------------------------------------

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
      'select coalesce(jsonb_agg(to_jsonb(x) order by x.server_seq), ''[]''::jsonb), max(x.server_seq) from public.%I x where x.server_seq > $1 and x.owner_id = auth.uid()',
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
   where e.server_seq > coalesce(since, 0) and e.owner_id = auth.uid();
  result := result || jsonb_build_object('encounter', rows);
  cursor_out := greatest(cursor_out, coalesce(top, 0));

  return jsonb_build_object('cursor', cursor_out, 'changes', result);
end;
$$;
