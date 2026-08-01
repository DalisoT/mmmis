-- =============================================================================
-- tools/wipe_user_106759.sql
-- -----------------------------------------------------------------------------
-- Scoped wipe of all transactions tied to the test user with service_number
-- '106759'. The user account itself (public.users + auth.users) is KEPT so the
-- tester can still log in.
--
-- Run in the Supabase SQL editor on project gkegnmshivmgqhenqkzr.
-- Safe to re-run: every statement is idempotent against an already-clean user.
-- Wrapped in a single transaction so any FK surprise aborts the whole thing.
--
-- Order matters: leaf tables first, then rows that have FKs back to them.
--   1. sale_items (FK -> sales)
--   2. sales (FK -> users as barman, members as member)
--   3. chit_authorization_requests (back-pointer to sales via consumed_sale_id)
--   4. chit_payments  (FK -> users as receiver, members as member)
--   5. expenses       (FK -> users as releaser)
--   6. ledger         (FK -> members; orphaned when member row is deleted)
--   7. stock_sheet    (FK -> users as recorder)
--   8. stock_receipts (FK -> users as receiver)
--   9. audit_log / audit_logs: null actor_id so the audit trail stays intact
--      but no longer points at a deleted user.
--  10. members        (FK -> users via user_id)
--  11. login_attempts (keyed by service_number text, no FK)
-- =============================================================================

begin;

do $$
declare
  uid uuid;
  mid uuid;  -- members.user_id == users.id (1:1)
begin
  ------------------------------------------------------------------
  -- Resolve the user
  ------------------------------------------------------------------
  select id into uid from public.users where service_number = '106759';
  if uid is null then
    raise exception 'No user with service_number=106759 — nothing to wipe';
  end if;
  mid := uid;  -- members.user_id mirrors users.id

  ------------------------------------------------------------------
  -- 1. Null the chit_authorization_requests -> sales back-pointer FIRST,
  --    for every sale this user is involved in on either side. The FK
  --    has no ON DELETE clause, so any sales delete without this step
  --    raises 23503. Run once, before any sales delete.
  ------------------------------------------------------------------
  update public.chit_authorization_requests
     set consumed_sale_id = null
   where consumed_sale_id in (
     select id from public.sales where barman_id = uid or member_id = mid
   );

  ------------------------------------------------------------------
  -- 2. Sale line items + sales where this user was the barman
  ------------------------------------------------------------------
  delete from public.sale_items
    where sale_id in (select id from public.sales where barman_id = uid);
  delete from public.sales where barman_id = uid;

  ------------------------------------------------------------------
  -- 3. Sale line items + sales where this user was the buyer (CHIT member)
  ------------------------------------------------------------------
  delete from public.sale_items
    where sale_id in (select id from public.sales where member_id = mid);
  delete from public.sales where member_id = mid;

  ------------------------------------------------------------------
  -- 4. CHIT authorisations this user requested as a member
  ------------------------------------------------------------------
  delete from public.chit_authorization_requests where member_id = mid;

  ------------------------------------------------------------------
  -- 5. CHIT payments: as receiver AND as member
  ------------------------------------------------------------------
  delete from public.chit_payments where received_by = uid;
  delete from public.chit_payments where member_id   = mid;

  ------------------------------------------------------------------
  -- 6. Expenses released by this user
  ------------------------------------------------------------------
  delete from public.expenses where released_by = uid;

  ------------------------------------------------------------------
  -- 7. Ledger entries for the member row (if any)
  ------------------------------------------------------------------
  delete from public.ledger where member_id = mid;

  ------------------------------------------------------------------
  -- 8. Stock sheets and receipts recorded/received by this user
  ------------------------------------------------------------------
  delete from public.stock_sheet    where recorded_by = uid;
  delete from public.stock_receipts where received_by = uid;

  ------------------------------------------------------------------
  -- 9. Audit trail: null the actor. Rows are KEPT so the audit log
  --    is still a faithful record of what happened — only the FK
  --    is dropped, so a future users delete doesn't cascade here.
  ------------------------------------------------------------------
  update public.audit_log  set actor_id = null where actor_id = uid;
  update public.audit_logs set actor_id = null where actor_id = uid;

  ------------------------------------------------------------------
  -- 10. Member row (if any). Safe: ledger was already cleared above.
  ------------------------------------------------------------------
  delete from public.members where user_id = mid;

  ------------------------------------------------------------------
  -- 11. Login attempts keyed by service_number text
  ------------------------------------------------------------------
  delete from public.login_attempts where service_number = '106759';

  raise notice 'Wiped transactions for user % (service_number=106759).', uid;
end $$;

commit;

-- =============================================================================
-- Sanity checks (run separately after the wipe, not in the transaction):
--   select count(*) from public.sales           where barman_id   = (select id from public.users where service_number='106759');
--   select count(*) from public.chit_payments   where received_by = (select id from public.users where service_number='106759');
--   select count(*) from public.expenses        where released_by = (select id from public.users where service_number='106759');
--   select count(*) from public.stock_sheet     where recorded_by = (select id from public.users where service_number='106759');
--   select count(*) from public.stock_receipts  where received_by = (select id from public.users where service_number='106759');
--   select count(*) from public.login_attempts  where service_number='106759';
-- All should return 0.
-- =============================================================================
