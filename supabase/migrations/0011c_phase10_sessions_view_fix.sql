-- Phase 10 (fix): type cast for users.auth_id = auth.refresh_tokens.user_id
--
-- The original 0010_phase10_sessions_view.sql joined
--   public.users.auth_id  =  auth.refresh_tokens.user_id
-- without a cast. Postgres raised:
--
--   ERROR: 42883: operator does not exist: uuid = character varying
--
-- The error tells us the actual types:
--   * public.users.auth_id           = uuid
--   * auth.refresh_tokens.user_id    = text  (despite GoTrue docs saying uuid,
--                                              this Supabase project stores it as text)
--   * auth.sessions.user_id          = uuid
--
-- The fix is to cast the auth-side refresh_tokens column to uuid in every
-- join. There are three such joins in the original 0010:
--   1. auth_sessions view:  u.auth_id     = t.user_id::uuid
--   2. auth_sessions view:  uas.user_id   = t.user_id::uuid
--   3. list_active_sessions RPC: same pair as 1 and 2.
--
-- (Casting user-supplied text to uuid will raise "invalid input syntax
-- for type uuid" if a row has malformed data, but refresh_tokens.user_id
-- is always written by GoTrue and is therefore always a valid uuid
-- string in practice.)
--
-- The 0011b attempt cast in the wrong direction (text on a column that
-- was already uuid). This migration replaces that approach.
--
-- The behavior is identical to the original — only the join expression
-- changes.

set search_path = public;

-- ---------------------------------------------------------------------------
-- 1. Drop dependent objects first.
-- ---------------------------------------------------------------------------

drop view if exists public.auth_sessions;
drop function if exists public.list_active_sessions();

-- ---------------------------------------------------------------------------
-- 2. Recreate the view with the corrected cast.
-- ---------------------------------------------------------------------------

create or replace view public.auth_sessions
with (security_invoker = false) as
  select
    t.id::text                       as session_id,
    u.id::text                       as user_id,
    u.service_number,
    u.full_name,
    r.code                           as role_code,
    t.created_at                     as created_at,
    t.updated_at                     as last_seen_at,
    uas.not_after                    as expires_at,
    (t.revoked is not null)          as is_revoked,
    uas.user_agent                   as user_agent
  from auth.refresh_tokens t
  left join public.users u
    on u.auth_id = t.user_id::uuid
  left join public.roles r
    on r.id = u.role_id
  left join auth.sessions uas
    on uas.user_id = t.user_id::uuid
   and uas.updated_at = t.updated_at;

comment on view public.auth_sessions is
  'SECURITY DEFINER view joining auth.refresh_tokens to public.users for admin session enumeration.';

revoke all on public.auth_sessions from public;
grant select on public.auth_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Recreate the list_active_sessions RPC with the same cast.
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
language sql
stable
security definer
set search_path = public
as $$
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
$$;

grant execute on function public.list_active_sessions() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Recreate revoke_session and _assert_admin.
--
-- The original 0010 defined these, but it never finished — the view failed
-- to create on the uuid/text mismatch, so the functions were never reached
-- and never existed. This section makes 0011c self-contained: drop them
-- if they exist (in case a partial run left them), then recreate with
-- identical bodies to 0010, then grant execute.
-- ---------------------------------------------------------------------------

drop function if exists public.revoke_session(text);
drop function if exists public._assert_admin();

create or replace function public._assert_admin()
returns void
language plpgsql
stable
as $$
begin
  if not public.is_administrator() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.revoke_session(p_session_id text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
  v_is_admin boolean := public.is_administrator();
  v_target uuid;
begin
  if v_is_admin then
    -- Admin: revoke the named token regardless of owner.
    select user_id::uuid into v_target from auth.refresh_tokens where id = p_session_id limit 1;
    if v_target is null then
      raise exception 'Session not found';
    end if;
  else
    -- Self-revoke: only your own sessions.
    select user_id::uuid into v_target from auth.refresh_tokens where id = p_session_id and user_id::uuid = v_user limit 1;
    if v_target is null then
      raise exception 'Session not found';
    end if;
  end if;

  update auth.refresh_tokens set revoked = now(), updated_at = now() where id = p_session_id;
end;
$$;

grant execute on function public.revoke_session(text) to authenticated;
grant execute on function public._assert_admin() to authenticated;
