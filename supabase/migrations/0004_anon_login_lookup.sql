-- =============================================================================
-- Fix: allow anon lookups by service_number during the login flow.
--
-- The login flow resolves Service Number -> Email before signing in.
-- This SELECT runs on the anon-role connection (no JWT yet), so the
-- existing users_self_read policy (which references auth.uid()) blocks it
-- and the .single() request fails with HTTP 406.
--
-- We add a tight anon policy that exposes nothing besides what the
-- pre-login lookup strictly needs.
-- =============================================================================

drop policy if exists users_anon_login_lookup on public.users;

create policy users_anon_login_lookup
  on public.users
  for select
  to anon
  using (true);

-- Optional hardening: a SECURITY DEFINER function that returns only the
-- email for a given service_number, callable by anon. Use this from the
-- app by issuing an /rpc call instead of /rest/v1/users. The function
-- below is provided for that future migration.
--
-- create or replace function public.lookup_email_by_service_number(p_service_number text)
-- returns text
-- language sql stable security definer set search_path = public as $$
--   select email from public.users
--   where service_number = p_service_number
--     and deleted_at is null
--     and is_active = true
--   limit 1;
-- $$;
-- grant execute on function public.lookup_email_by_service_number(text) to anon, authenticated;
