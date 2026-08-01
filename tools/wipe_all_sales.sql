-- =============================================================================
-- tools/wipe_all_sales.sql
-- -----------------------------------------------------------------------------
-- Global wipe of every sales transaction in the database, across all users
-- and all time. Walk-ins, CHIT, cash, member purchases — everything.
--
-- What this deletes:
--   * public.sale_items        (every row; children of sales)
--   * public.sales             (every row)
--   * public.ledger            (rows where source_type = 'sale')
--   * chit_authorization_requests.consumed_sale_id is nulled so the FK
--     doesn't block the sales delete.
--
-- What this does NOT touch:
--   * products, members, users, roles, mess_settings
--   * chit_authorization_requests rows themselves (only their back-pointer)
--   * chit_payments, expenses, stock_sheet, stock_receipts
--   * audit_log / audit_logs (kept for traceability)
--   * login_attempts
--
-- Side effects to be aware of:
--   * member balances drop to whatever the payments-only state was (ledger
--     source_type='payment' rows are kept). For a true reset, also clear
--     chit_payments or accept that balances will only reflect payments.
--   * daily_summary.cash_sales and .chit_sales columns will be stale until
--     the daily-summary recompute runs.
--
-- Run in the Supabase SQL editor. Single transaction, fails-closed.
-- =============================================================================

begin;

-- 1. Null the back-pointer on chit_authorization_requests so the FK doesn't
--    block the sales delete. The chit_authorization_requests rows themselves
--    are kept so the "who was authorized" audit trail remains.
update public.chit_authorization_requests
   set consumed_sale_id = null
 where consumed_sale_id is not null;

-- 2. Children first.
delete from public.sale_items;

-- 3. Sales themselves.
delete from public.sales;

-- 4. Ledger entries that originated from a sale. Safe: ledger.source_id has
--    no FK constraint (see 0001_init.sql:268), so deleting by source_type is
--    straightforward.
delete from public.ledger where source_type = 'sale';

commit;

-- =============================================================================
-- Sanity checks (run separately, not in the transaction):
--   select count(*) from public.sales;       -- expect 0
--   select count(*) from public.sale_items;  -- expect 0
--   select count(*) from public.ledger where source_type = 'sale';  -- expect 0
--   select count(*) from public.chit_authorization_requests where consumed_sale_id is not null;  -- expect 0
-- =============================================================================
