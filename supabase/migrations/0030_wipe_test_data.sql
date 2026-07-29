-- =============================================================================
-- MMMIS 0030 — wipe all test data ahead of self-register rollout
-- -----------------------------------------------------------------------------
-- Pre-requisite: 0029 must have applied. This migration is destructive and
-- irreversible. It deletes every row of test data from the public schema
-- (operations history, members, products, stock, audit trail, etc.) but
-- keeps:
--   * the schema itself (tables, triggers, RLS policies)
--   * the public.roles enum (4 system roles)
--
-- auth.users rows are NOT touched here — SQL cannot reach auth.users from
-- the public schema without the service-role key. Run the
-- `admin-wipe-auth-users` Edge Function AFTER this migration to scrub the
-- auth.users rows that corresponded to the deleted public.users accounts.
--
-- The DELETE order matters: parents last, children first. Each leaf has
-- either `on delete cascade` or no FK back to its parent (e.g. sale_items →
-- sales cascade, sales.barman_id → users NOT NULL no-cascade, so we delete
-- sales before users).
--
-- This entire block runs in a single transaction. If any DELETE raises the
-- whole operation aborts and nothing is wiped. We omit `returning` so the
-- script runs as plain SQL rather than PL/pgSQL (which would require a
-- `do $$ ... $$` block and `into` variables).
--
-- After this script commits, run the smoke diagnostic to verify expected
-- counts:
--   * active_members      = 0
--   * active_barmen       = 0
--   * active_products     = 0
--   * stale_pending_chits = 0 (cron will have done this already)
-- =============================================================================

begin;

-- 1. Operations history — leaf tables that reference products/users/members.
--    chit_authorization_requests.consumed_sale_id is a back-pointer FK to
--    sales(id) with no ON DELETE clause. To wipe sales we either (a) delete
--    chit_authorization_requests first, OR (b) null the back-pointer first.
--    We do (b) so the FK constraint can't fire regardless of trigger or RLS
--    surprises; the rows are about to be deleted anyway.
update public.chit_authorization_requests set consumed_sale_id = null;

delete from public.sale_items;
delete from public.sales;
delete from public.chit_authorization_requests;
delete from public.chit_payments;
delete from public.expenses;
delete from public.ledger;
delete from public.daily_summary;
delete from public.stock_sheet;
delete from public.stock_receipts;

-- 2. Catalogue.
delete from public.products;

-- 3. Audit/settings/login — keep schema, drop rows. These are nullable FKs
--    on public.users, so deleting rows by id is safe; with no rows to begin
--    with for a fresh test install this is a no-op.
delete from public.audit_log;
delete from public.audit_logs;
delete from public.mess_settings;
delete from public.settings;
delete from public.login_attempts;
delete from public.bulk_member_seed;

-- 4. Members then users. members.user_id is on delete cascade from
--    public.users, so deleting public.users alone would be enough — but
--    we issue both for clarity.
delete from public.members;
delete from public.users;

-- 5. Roles survive — they are configuration, not data.
--    public.roles rows remain intact: the 4 system roles are mandatory
--    for the next user creation to succeed.

-- After commit: run the admin-wipe-auth-users Edge Function (via curl,
-- see supabase/functions/README.md) to remove the auth.users rows that
-- linked to the deleted public.users rows above.

commit;
