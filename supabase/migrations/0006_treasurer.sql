-- =============================================================================
-- Phase 4 — Treasurer module.
--
-- Adds:
--   * expenses.approved_at, approved_by
--   * chit_payments.receipt_number
--   * members manager write policy (treasurer/admin)
--   * expenses update policy (treasurer can change approval state)
-- =============================================================================

alter table public.expenses
  add column if not exists approved_at  timestamptz,
  add column if not exists approved_by  uuid references public.users(id);

alter table public.chit_payments
  add column if not exists receipt_number text;

-- Treasurer/admin can update members (credit limit, blacklist).
-- We reuse members_admin_write which already permits ALL for admin.
drop policy if exists members_treasurer_update on public.members;
create policy members_treasurer_update
  on public.members
  for update
  to authenticated
  using (public.is_treasurer() or public.is_administrator())
  with check (public.is_treasurer() or public.is_administrator());

-- Treasurer can approve expenses.
drop policy if exists expenses_approve on public.expenses;
create policy expenses_approve
  on public.expenses
  for update
  to authenticated
  using (public.is_treasurer() or public.is_administrator())
  with check (public.is_treasurer() or public.is_administrator());

-- Treasurer can update CHIT payments (e.g. attach receipt number, mark deleted).
drop policy if exists chit_payments_update on public.chit_payments;
create policy chit_payments_update
  on public.chit_payments
  for update
  to authenticated
  using (public.is_treasurer() or public.is_administrator())
  with check (public.is_treasurer() or public.is_administrator());
