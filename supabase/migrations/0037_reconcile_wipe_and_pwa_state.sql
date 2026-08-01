-- =============================================================================
-- 0037 — Reconcile wipe coverage and PWA state on a fresh DB
--
-- Migration 0030 (wipe_test_data) was authored before the PWA migrations
-- (0034 / 0035) existed, so its DELETE list omits the tables those migrations
-- introduced:
--   * public.offline_action_log  (0034) — idempotency log for offline replays
--   * public.push_subscriptions  (0035) — Web Push endpoints
--
-- If a deployment runs 0030 after 0034/0035 have applied (the normal order),
-- these tables are NOT cleared and a "wiped" database still carries the old
-- PWA state — including auth tokens in offline_action_log that link to
-- deleted auth.users rows.
--
-- This migration does two things:
--
-- 1. Adds a helper RPC, public.reset_mess_for_self_register(), that performs
--    a full wipe including the PWA tables. It mirrors 0030's transaction-
--    safe DELETE order (children first, parents last) plus the
--    `chit_authorization_requests.consumed_sale_id` null-out that 0030
--    uses to break the back-pointer FK before deleting sales.
--
-- 2. Wraps every DELETE in `if exists` guards so the RPC is safe to call
--    on a partially-applied schema (e.g. a pre-0034 project, or a project
--    where `bulk_member_seed` was already dropped).
--
-- Why not edit 0030 in place?  Supabase tracks applied migrations by filename;
-- changing a previously-applied file is invisible to existing deployments.
-- A new migration is the only way to deliver the fix to environments that
-- already have 0030 in their migration history.
--
-- Idempotent: the RPC uses CREATE OR REPLACE; the body uses
-- `delete from ... where ...` against `if exists` tables, which is a no-op
-- when the table is missing.
-- =============================================================================

set search_path = public;

create or replace function public.reset_mess_for_self_register()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1. Authenticate + authorise. Only staff can wipe the database.
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_administrator() then
    raise exception 'Forbidden: only administrators can wipe the mess database'
      using errcode = '42501';
  end if;

  -- 2. Operations history — leaf tables that reference products/users/members.
  --    chit_authorization_requests.consumed_sale_id is a back-pointer FK to
  --    sales(id) with no ON DELETE clause. Null it out before deleting sales
  --    so the FK constraint can't fire.
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'chit_authorization_requests') then
    update public.chit_authorization_requests set consumed_sale_id = null;
  end if;

  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'sale_items')         then delete from public.sale_items;         end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'sales')              then delete from public.sales;              end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'chit_authorization_requests') then delete from public.chit_authorization_requests; end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'chit_payments')      then delete from public.chit_payments;      end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'expenses')           then delete from public.expenses;           end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'ledger')             then delete from public.ledger;             end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'daily_summary')       then delete from public.daily_summary;       end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'stock_sheet')        then delete from public.stock_sheet;        end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'stock_receipts')     then delete from public.stock_receipts;     end if;

  -- 3. Catalogue.
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'products') then delete from public.products; end if;

  -- 4. PWA state (added by 0034 / 0035 — not covered by 0030).
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'offline_action_log') then delete from public.offline_action_log; end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'push_subscriptions') then delete from public.push_subscriptions; end if;

  -- 5. Audit / settings / login / staging. The audit table is `audit_log`
  --    (singular, from 0008). The plural `audit_logs` from 0001 is dead —
  --    DELETE here is best-effort.
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'audit_log')    then delete from public.audit_log;    end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'audit_logs')   then delete from public.audit_logs;   end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'mess_settings') then delete from public.mess_settings; end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'settings')      then delete from public.settings;      end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'login_attempts') then delete from public.login_attempts; end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'bulk_member_seed') then delete from public.bulk_member_seed; end if;

  -- 6. Members then users. members.user_id is on delete cascade from
  --    public.users, so deleting public.users alone would be enough — but
  --    we issue both for clarity.
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'members') then delete from public.members; end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'users')   then delete from public.users;   end if;

  -- 7. Roles survive — they are configuration, not data. The four system
  --    roles are mandatory for the next user creation to succeed.
end;
$$;

revoke all on function public.reset_mess_for_self_register() from public;
grant execute on function public.reset_mess_for_self_register() to authenticated;

comment on function public.reset_mess_for_self_register() is
  'Wipe every row of test data from the public schema, including PWA state '
  '(offline_action_log, push_subscriptions) that 0030 omits. Safe on a '
  'partially-applied schema — every DELETE is guarded by an `if exists` '
  'check. Administrator only. Replaces 0030_wipe_test_data.sql as the '
  'preferred self-register-rollout wipe path; 0030 remains for historical '
  'reference.';

-- Sanity check.
do $$
begin
  if not exists (
    select 1 from pg_proc
    where proname = 'reset_mess_for_self_register'
      and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'reset_mess_for_self_register() was not created — investigate.';
  end if;
  raise notice '0037 installed — reset_mess_for_self_register() supersedes 0030; wipe now covers PWA state';
end
$$;
