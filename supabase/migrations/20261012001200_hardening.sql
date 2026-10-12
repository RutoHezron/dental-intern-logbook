-- Hardening from the Supabase security advisors on the first hosted project.
--
-- * sync_table: RLS on. sync_push / sync_pull run as the caller and read it,
--   so signed-in users keep read access through a policy.
-- * Anonymous visitors get nothing, also on tables created after the RLS
--   migration (Supabase's default privileges grant them to anon).
-- * Trigger functions are not API endpoints. Revoking EXECUTE does not stop
--   the triggers firing: the privilege is checked only when a trigger is created.
-- * Functions without SECURITY DEFINER still get a fixed search_path.

alter table public.sync_table enable row level security;
alter table public.sync_table force row level security;
create policy read_registry on public.sync_table for select to authenticated using (true);

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

revoke execute on function public.tg_sync_stamp() from public, anon, authenticated;
revoke execute on function public.tg_child_owner() from public, anon, authenticated;
revoke execute on function public.tg_entry_guard() from public, anon, authenticated;
revoke execute on function public.tg_append_only() from public, anon, authenticated;
revoke execute on function public.tg_audit() from public, anon, authenticated;
revoke execute on function public.tg_verification_applies() from public, anon, authenticated;
revoke execute on function public.tg_case_report_guard() from public, anon, authenticated;
revoke execute on function public.tg_supervisor_link_guard() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

alter function public.tg_sync_stamp() set search_path = public;
alter function public.tg_child_owner() set search_path = public;
alter function public.tg_entry_guard() set search_path = public;
alter function public.tg_append_only() set search_path = public;
alter function public.tg_case_report_guard() set search_path = public;
alter function public.tg_supervisor_link_guard() set search_path = public;
alter function public._invite_hash(text) set search_path = public;
alter function public._new_invite_code() set search_path = public;
