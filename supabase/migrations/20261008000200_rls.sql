-- Row-level security: in personal mode every row belongs to one intern, and
-- only that intern can read or write it. Clients never hard-delete parent
-- rows (soft delete via deleted_at); child rows of an encounter are replaced
-- on each push, so the owner may delete those.
--
-- Supervisor and coordinator access (V1) is added by later migrations with
-- narrower policies (entries submitted to them; counts only for coordinators).

do $$
declare
  t text;
begin
  foreach t in array array[
    'facility', 'internship', 'supervisor', 'rotation', 'patient', 'encounter',
    'activity', 'logbook_entry', 'reflection', 'report_snapshot',
    'encounter_procedure', 'finding', 'investigation'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy owner_select on public.%I for select to authenticated using (owner_id = auth.uid())', t);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (owner_id = auth.uid())', t);
    execute format('create policy owner_update on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
  foreach t in array array['encounter_procedure', 'finding', 'investigation'] loop
    execute format('create policy owner_delete on public.%I for delete to authenticated using (owner_id = auth.uid())', t);
  end loop;
end;
$$;

-- Verifications: the intern can read verifications of their own entries.
-- Writes happen only through the V1 verify_entry() function.
alter table public.verification enable row level security;
alter table public.verification force row level security;
create policy owner_select on public.verification for select to authenticated using (owner_id = auth.uid());

alter table public.profile enable row level security;
create policy own_profile_select on public.profile for select to authenticated using (id = auth.uid());
create policy own_profile_update on public.profile for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- The audit log is written by a security-definer trigger; people can read their own actions.
alter table public.audit_log enable row level security;
create policy own_audit_select on public.audit_log for select to authenticated using (actor_id = auth.uid());

-- Grants: nothing for anonymous visitors; signed-in users get exactly the
-- operations their policies allow.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update on
  public.facility, public.internship, public.supervisor, public.rotation, public.patient,
  public.encounter, public.activity, public.logbook_entry, public.reflection, public.report_snapshot
  to authenticated;
grant select, insert, update, delete on public.encounter_procedure, public.finding, public.investigation to authenticated;
grant select on public.verification, public.audit_log to authenticated;
grant select, update on public.profile to authenticated;
grant usage, select on sequence public.sync_seq to authenticated;
