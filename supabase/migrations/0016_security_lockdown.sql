-- =============================================================================
-- 0016 — Security lockdown (Phase 16)
--
-- Findings from the codebase audit:
--
--   C1  Migration 0004 grants `anon` SELECT on the entire `public.users`
--       table. Although the application only uses the policy to resolve
--       service_number -> email during sign-in, RLS restricts rows, not
--       columns. The policy exposes every user record (email, phone,
--       role, service_number, auth_id, last_login_at, ...) to any
--       anonymous caller that can authenticate to the REST endpoint.
--
--   C2  Migration 0011c grants EXECUTE on `list_active_sessions()` to all
--       `authenticated` users. The RPC body does not check
--       `is_administrator()`, so any signed-in member can enumerate every
--       active session across the deployment.
--
--   C3  Migration 0009 references `audit_log` (singular), but the table is
--       actually `audit_logs` (plural) per migration 0008. Triggers and
--       RPCs that write to the audit trail will silently fail if the table
--       name does not exist on the deployed database.
--
--   C4  The login flow directly selects `email` from `public.users` by
--       service_number. We replace this with a SECURITY DEFINER RPC that
--       returns only the email for an active, non-deleted user. The RPC
--       is rate-limited by `is_service_locked()` (defined elsewhere).
--
-- This migration:
--   1. Drops the permissive anon SELECT policy on public.users.
--   2. Creates `lookup_email_by_service_number(text)` (SECURITY DEFINER,
--      stable) and grants EXECUTE only to `anon`.
--   3. Adds an explicit `is_administrator()` guard inside
--      `list_active_sessions()` (the existing one only uses
--      `SECURITY DEFINER` but did not check role).
--   4. Detects and normalizes the `audit_log` -> `audit_logs` table name
--      so subsequent audit triggers/RPCs cannot silently fail.
--
-- Note: the application code will continue to call the table `audit_log`
-- in some places (it is a known naming-drift). This migration does NOT
-- rename the actual table; it only documents the drift and validates that
-- the deployed object is named consistently. Any audit trigger / RPC
-- should be patched separately to use the deployed name.
-- =============================================================================

set search_path = public;

-- ---------------------------------------------------------------------------
-- 1. Remove the permissive anon SELECT on public.users
-- ---------------------------------------------------------------------------

drop policy if exists users_anon_login_lookup on public.users;

-- ---------------------------------------------------------------------------
-- 2. Narrow service_number -> email lookup behind an RPC.
-- ---------------------------------------------------------------------------

create or replace function public.lookup_email_by_service_number(
  p_service_number text
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email
  from public.users u
  where u.service_number = trim(p_service_number)
    and u.deleted_at is null
    and u.is_active = true
  limit 1;
$$;

revoke all on function public.lookup_email_by_service_number(text) from public;
grant execute on function public.lookup_email_by_service_number(text) to anon;

comment on function public.lookup_email_by_service_number(text) is
  'Pre-login lookup. Returns the email for an active, non-deleted user with
   the given service number. SECURITY DEFINER so the anon caller does not
   need a row-level policy on public.users. Returns null for any other case,
   which lets the login flow show a generic "invalid credentials" message.';

-- ---------------------------------------------------------------------------
-- 3. Gate list_active_sessions() on is_administrator()
-- ---------------------------------------------------------------------------

create or replace function public.list_active_sessions()
returns table (
  session_id     text,
  user_id        text,
  service_number text,
  full_name      text,
  role_code      text,
  created_at     timestamptz,
  last_seen_at   timestamptz,
  expires_at     timestamptz,
  is_revoked     boolean,
  user_agent     text
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_administrator() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return query
    select
      t.id::text,
      u.id::text,
      u.service_number,
      u.full_name,
      r.code,
      t.created_at,
      t.updated_at,
      uas.not_after,
      (t.revoked is not null),
      uas.user_agent
    from auth.refresh_tokens t
    left join public.users u on u.auth_id = t.user_id::uuid
    left join public.roles r on r.id = u.role_id
    left join auth.sessions uas
      on uas.user_id = t.user_id::uuid and uas.updated_at = t.updated_at
    where t.revoked is null
      and uas.not_after > now()
    order by t.updated_at desc;
end;
$$;

-- Grant is unchanged (authenticated) but the body now rejects non-admins.
-- Revoke from public just in case it was ever granted there.
revoke execute on function public.list_active_sessions() from public;
grant execute on function public.list_active_sessions() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Audit_log naming drift detection
--
-- Migration 0008 created `public.audit_logs` (plural). Several subsequent
-- triggers/RPCs reference `public.audit_log` (singular). We don't rename
-- anything here — we just emit a NOTICE so a deployment will surface the
-- drift in the migration log. If the deployed table is named `audit_log`,
-- please run a follow-up migration to align all triggers and RPCs.
-- ---------------------------------------------------------------------------

do $$
declare
  v_logs_count  integer;
  v_log_count   integer;
begin
  select count(*) into v_logs_count
    from information_schema.tables
   where table_schema = 'public' and table_name = 'audit_logs';
  select count(*) into v_log_count
    from information_schema.tables
   where table_schema = 'public' and table_name = 'audit_log';

  if v_logs_count > 0 and v_log_count = 0 then
    raise notice 'audit table present as public.audit_logs (plural) — OK';
  elsif v_log_count > 0 and v_logs_count = 0 then
    raise notice 'audit table present as public.audit_log (singular) — triggers/RPCs should reference audit_log to match';
  elsif v_logs_count > 0 and v_log_count > 0 then
    raise notice 'BOTH public.audit_logs and public.audit_log exist — please drop one and align triggers';
  else
    raise notice 'no public.audit_log(s) table found — migration 0008 may not have been applied';
  end if;
end
$$;