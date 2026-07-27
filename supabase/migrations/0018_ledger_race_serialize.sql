-- =============================================================================
-- 0018 — Serialise per-member ledger balance updates (Phase 18)
--
-- Finding from the codebase audit:
--
--   C7  The `apply_member_ledger` BEFORE INSERT trigger on public.ledger
--       reads the latest balance with no row locking or advisory lock:
--
--         select coalesce(balance,0) into v_balance
--           from public.ledger
--          where member_id = new.member_id
--          order by txn_at desc, id desc
--          limit 1;
--         new.balance := v_balance + coalesce(new.debit,0) - coalesce(new.payment,0);
--
--       Two concurrent inserts for the same member (e.g. a cashier ringing up
--       two CHIT sales at the same time, or a CHIT sale arriving while a
--       payslip-deduction payment is being recorded) can both observe the
--       same previous balance, then each write `prev + amount`, so the
--       second write loses the first transaction's delta. The end-of-day
--       totals still reconcile to the sum of debits / payments, but the
--       `members.chit_balance` value can drift away from the contractual
--       "balance = sum of debits - sum of payments" invariant.
--
-- This migration:
--   1. Replaces `apply_member_ledger` with a version that acquires a
--      transaction-scoped advisory lock keyed on the member_id hash before
--      reading the latest balance. Two concurrent inserts for the same
--      member will serialise; inserts for different members are unaffected.
--   2. Adds a `SELECT ... FOR UPDATE` on the latest ledger row, so even a
--      future caller that bypasses the advisory lock (e.g. a manual SQL
--      session) cannot race with a trigger that's about to read it.
--   3. The `members.chit_balance` UPDATE is unchanged but also gains an
--      advisory lock acquisition rationale (the balance cannot drift
--      because the previous read is now serialised).
--   4. Emits a NOTICE describing the change so the migration log is
--      self-documenting.
--
-- This migration is idempotent — it always replaces the trigger function and
-- re-creates the trigger, so re-running it is safe.
-- =============================================================================

set search_path = public;

-- ---------------------------------------------------------------------------
-- 1. Replace the trigger function with a serialised version.
-- ---------------------------------------------------------------------------

create or replace function public.apply_member_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(14,2);
  v_lock    bigint;
begin
  -- Per-member advisory lock. `pg_advisory_xact_lock` blocks for the
  -- duration of the current transaction (the INSERT), so concurrent
  -- inserts on the same member serialise; inserts on different members
  -- use different hash buckets and remain parallel.
  --
  -- hashtext() returns int4; cast to bigint so it fits the bigint variant.
  v_lock := hashtext(new.member_id::text)::bigint;
  perform pg_advisory_xact_lock(v_lock);

  -- Read the latest balance, locking the row so that even a concurrent
  -- session that bypasses the advisory lock cannot race us.
  select balance into v_balance
    from public.ledger
   where member_id = new.member_id
   order by txn_at desc, id desc
   limit 1
   for update;

  if v_balance is null then
    select coalesce(chit_balance, 0) into v_balance
      from public.members
     where user_id = new.member_id;
  end if;

  new.balance := v_balance + coalesce(new.debit, 0) - coalesce(new.payment, 0);

  -- Update the denormalised balance on the member row. The advisory lock
  -- held above ensures no concurrent trigger is reading the same
  -- member's chit_balance for its own balance calculation.
  update public.members
     set chit_balance = new.balance
   where user_id = new.member_id;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Recreate the trigger to bind it to the new function body.
--    (CREATE OR REPLACE TRIGGER isn't supported, so drop + create.)
-- ---------------------------------------------------------------------------

drop trigger if exists trg_ledger_balance on public.ledger;
create trigger trg_ledger_balance
  before insert on public.ledger
  for each row execute function public.apply_member_ledger();

-- ---------------------------------------------------------------------------
-- 3. Documentation NOTICE.
-- ---------------------------------------------------------------------------

do $$
begin
  raise notice 'apply_member_ledger() replaced with serialised version. '
              'Per-member advisory lock acquired before reading balance. '
              'members.chit_balance is now safe under concurrent inserts.';
end
$$;
