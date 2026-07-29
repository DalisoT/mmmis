-- =============================================================================
-- Phase 3 — Sales & CHIT policies.
--
-- Adds policies the barman workflow needs:
--   1. Members can self-update their own profile fields.
--   2. Members can read their own ledger entries (already covered by ledger_self_read).
--   3. Authenticated users can read products (already covered by products_read).
--   4. Authenticated users can write to ledger ONLY via the SECURITY DEFINER
--      trigger that fires from sales/sale_items/payment inserts. Direct
--      client inserts to ledger are blocked.
--   5. Authenticated users can write expenses (already covered by expenses_write).
--   6. Sales update is restricted to admin (cannot edit historical records per spec).
-- =============================================================================

-- 1. Members can self-update non-sensitive fields of their own users row (full name, phone, password).
-- (Password reset is handled via supabase.auth.updateUser on the client side.)
drop policy if exists users_self_update on public.users;
create policy users_self_update
  on public.users
  for update
  to authenticated
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

-- 2. Sales: only admin can UPDATE/DELETE historical records. Barman/admin can INSERT.
drop policy if exists sales_update on public.sales;
create policy sales_update
  on public.sales
  for update
  to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

-- 3. Sale items: same constraint.
drop policy if exists sale_items_update on public.sale_items;
create policy sale_items_update
  on public.sale_items
  for update
  to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

-- 4. Lock the ledger table to server-side writes only. The
--    apply_member_ledger trigger runs as SECURITY DEFINER so it can insert
--    even when the calling role is anon/authenticated.
-- We deny direct writes by removing any prior permissive policies and
-- letting only the trigger path execute.
drop policy if exists ledger_insert on public.ledger;
drop policy if exists ledger_update on public.ledger;
drop policy if exists ledger_delete on public.ledger;
-- No policies for INSERT/UPDATE/DELETE means RLS denies them by default,
-- but the SECURITY DEFINER trigger bypasses RLS.

-- 5. Settings cache: any authenticated user can read, only admin can write.
-- (already covered by settings_read / settings_write)

-- 6. Members can read their own profile fields (already covered by members_self_read).
-- They also need to update their own password fields. We do that via
-- supabase.auth.updateUser() on the client; no DB policy change needed.

-- 7. Authenticated users can read balance of any member (for the cashier
--    experience, the barman needs to see the running balance when serving CHIT).
drop policy if exists members_balance_read on public.members;
create policy members_balance_read
  on public.members
  for select
  to authenticated
  using (public.is_staff() or user_id = (select id from public.users where auth_id = auth.uid()));

-- 8. CHIT payments: barman can insert (the barman receives the cash).
-- The treasurer is the primary owner but the barman can also receive payment.
drop policy if exists chit_payments_barman_write on public.chit_payments;
create policy chit_payments_barman_write
  on public.chit_payments
  for insert
  to authenticated
  with check (public.is_barman() or public.is_treasurer() or public.is_administrator());
