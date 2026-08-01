-- =============================================================================
-- 0036 — Atomic mess_settings update RPC + upsert for the singleton row.
--
-- The Phase 8/9 path (`useUpdateMessSettings`) is a 3-round trip:
--   1. select prev row (for the audit "before" snapshot)
--   2. update row by id=1 (raises 406/empty if the row is missing)
--   3. log_audit_event() with old/new values
--
-- Three problems with that shape:
--   a) Audit + update are not atomic. If log_audit_event() fails, the
--      settings row changes but no audit row exists for the change.
--   b) The form throws a 406 on a fresh database because row id=1 is
--      missing. seed_mess_settings.sql mitigates that but a deployment
--      that runs migrations without seeding cannot even render the page.
--   c) prev-fetch and update are separate round-trips, so a concurrent
--      edit (two admins at once) would audit against a stale snapshot.
--
-- This migration adds:
--   * public.upsert_mess_settings(p_mess_name, p_currency_code,
--                                 p_opening_float, p_recovery_target_pct,
--                                 p_vat_pct, p_holiday_mode)
--     - if id=1 missing, insert; else update.
--     - SELECTs the previous row once for the audit "before" snapshot.
--     - writes a single audit_log row containing old/new.
--     - returns the resulting row.
--     - staff-only.
--
-- It does NOT replace `mess_settings` direct UPDATEs everywhere — only
-- `useUpdateMessSettings` (the Settings page) switches over. The RLS
-- policy from 0008 still applies.
--
-- Idempotent: create or replace.
-- =============================================================================

set search_path = public;

create or replace function public.upsert_mess_settings(
  p_mess_name           text,
  p_currency_code       text,
  p_opening_float       numeric,
  p_recovery_target_pct numeric,
  p_vat_pct             numeric,
  p_holiday_mode        boolean
)
returns public.mess_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := auth.uid();
  v_role     text;
  v_old      public.mess_settings;
  v_new      public.mess_settings;
begin
  -- 1. Authenticate + authorise. Only staff can edit settings.
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select r.code into v_role
    from public.users u
    join public.roles r on r.id = u.role_id
   where u.auth_id = v_actor
     and u.deleted_at is null
     and u.is_active = true;
  if v_role not in ('administrator', 'treasurer') then
    raise exception 'Forbidden: only staff can edit mess_settings' using errcode = '42501';
  end if;

  -- 2. Validate inputs. Mirror the Zod schema in
  --    src/features/settings/settings.service.ts so the SPA and the DB
  --    agree.
  if p_mess_name is null or length(trim(p_mess_name)) = 0 then
    raise exception 'mess_name is required' using errcode = '22023';
  end if;
  if length(p_mess_name) > 120 then
    raise exception 'mess_name too long' using errcode = '22023';
  end if;
  if p_currency_code is null or length(p_currency_code) <> 3 then
    raise exception 'currency_code must be 3 characters (ISO 4217)' using errcode = '22023';
  end if;
  if p_opening_float is null or p_opening_float < 0 then
    raise exception 'opening_float must be >= 0' using errcode = '22023';
  end if;
  if p_recovery_target_pct is null
     or p_recovery_target_pct < 0
     or p_recovery_target_pct > 100 then
    raise exception 'recovery_target_pct must be between 0 and 100' using errcode = '22023';
  end if;
  if p_vat_pct is null
     or p_vat_pct < 0
     or p_vat_pct > 100 then
    raise exception 'vat_pct must be between 0 and 100' using errcode = '22023';
  end if;
  if p_holiday_mode is null then
    raise exception 'holiday_mode is required' using errcode = '22023';
  end if;

  -- 3. Snapshot the previous row. May be NULL on a fresh DB; that's fine —
  --    the audit row will record new_values with a NULL old_values field.
  select * into v_old
    from public.mess_settings
   where id = 1;

  -- 4. Upsert by id=1. The PK on mess_settings.id guarantees we land on
  --    the singleton row even if a concurrent transaction is mid-update.
  insert into public.mess_settings (
    id, mess_name, currency_code, opening_float, recovery_target_pct,
    vat_pct, holiday_mode, updated_by, updated_at
  ) values (
    1, p_mess_name, upper(p_currency_code), p_opening_float,
    p_recovery_target_pct, p_vat_pct, p_holiday_mode, v_actor, now()
  )
  on conflict (id) do update set
    mess_name           = excluded.mess_name,
    currency_code       = excluded.currency_code,
    opening_float       = excluded.opening_float,
    recovery_target_pct = excluded.recovery_target_pct,
    vat_pct             = excluded.vat_pct,
    holiday_mode        = excluded.holiday_mode,
    updated_by          = excluded.updated_by,
    updated_at          = excluded.updated_at
  returning * into v_new;

  -- 5. Append audit row. Audit + update happen in the same transaction;
  --    the trigger-based audit (Phase 8) is suppressed here because the
  --    RPC writes an explicit richer row.
  insert into public.audit_log (
    actor_id, actor_role, action, target_table, target_id,
    old_values, new_values
  ) values (
    v_actor, v_role, 'settings.update', 'mess_settings', '1',
    to_jsonb(v_old), to_jsonb(v_new)
  );

  return v_new;
end;
$$;

revoke all on function public.upsert_mess_settings(
  text, text, numeric, numeric, numeric, boolean
) from public;
grant execute on function public.upsert_mess_settings(
  text, text, numeric, numeric, numeric, boolean
) to authenticated;

comment on function public.upsert_mess_settings(
  text, text, numeric, numeric, numeric, boolean
) is 'Atomic update of the singleton mess_settings row (id=1). Performs
upsert (insert if missing), writes a single audit_log row in the same
transaction, returns the resulting row. Staff only. Replaces the
client-side 3-round-trip path used by the Settings page.';

-- Sanity check.
do $$
begin
  if not exists (
    select 1 from pg_proc
    where proname = 'upsert_mess_settings' and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'upsert_mess_settings() was not created — investigate.';
  end if;
  raise notice '0036 installed — upsert_mess_settings() now transactional; singleton row can self-heal';
end
$$;