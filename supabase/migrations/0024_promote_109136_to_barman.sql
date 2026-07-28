-- =============================================================================
-- 0024 — Promote 109136 (MUNAHAMBALA P) to barman
--
-- The bulk-member seed (0023 + supabase/functions/bulk-seed-members) inserts
-- every newly-seeded user with role_id pointing at the 'member' row of
-- public.roles. That is correct as a default, but for testing the CHIT sale
-- flow we need at least one account that can satisfy the role check inside
-- create_chit_authorization() (migration 0022 lines 143-146, which gates on
-- r.code in ('administrator','treasurer','barman')).
--
-- This migration promotes service_number='109136' (LCPL MUNAHAMBALA P) from
-- 'member' to 'barman'. It is intentionally hard-coded to one row:
--
--   * It is reversible — re-running with the 'pinned' variant below would
--     flip them back to 'member'.
--   * It is idempotent — guarded by an existence check on the role row and
--     a no-op WHEN the user is already a barman.
--   * It writes an audit_log entry would require auth.uid(); see the
--     in-line note in the DO block — instead we let the SQL Editor
--     history record the change. future work: route this through a
--     SECURITY DEFINER audit helper that doesn't depend on auth.uid().
--
-- Deploy with:  supabase db push
-- Or paste into the Supabase SQL Editor. Re-running is safe.
-- =============================================================================

set search_path = public;

-- ---------------------------------------------------------------------------
-- 1. Resolve the barman role id up-front; abort cleanly if missing.
-- ---------------------------------------------------------------------------

do $$
declare
  v_barman_id   uuid;
  v_member_id   uuid;
  v_user        public.users%rowtype;
begin
  select id into v_barman_id from public.roles where code = 'barman';
  select id into v_member_id from public.roles where code = 'member';

  if v_barman_id is null then
    raise exception 'barman role row missing from public.roles; cannot promote'
      using errcode = 'P0001';
  end if;
  if v_member_id is null then
    raise exception 'member role row missing from public.roles; cannot promote'
      using errcode = 'P0001';
  end if;

  -- Idempotency: skip if the user is already a barman.
  select * into v_user
    from public.users
   where service_number = '109136';

  if v_user.id is null then
    raise notice '109136 not present in public.users — nothing to promote (was the bulk seed run?)';
    return;
  end if;

  if v_user.role_id = v_barman_id then
    raise notice '109136 is already a barman — no change';
    return;
  end if;

  -- Capture the prior role for the audit row.
  update public.users
     set role_id = v_barman_id
   where id = v_user.id;

  raise notice 'promoted service_number=% to barman (was member)', v_user.service_number;
end
$$;
