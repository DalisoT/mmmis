-- =============================================================================
-- MMMIS 0031 — drop the must_reset_pw column
-- -----------------------------------------------------------------------------
-- Members now self-register at /register with their own email and password.
-- There is no admin-issued temp password, so the must_reset_pw flag has no
-- remaining purpose. Drop the column from public.users entirely.
--
-- Down-migration (if ever needed) would be:
--   alter table public.users add column if not exists must_reset_pw
--     boolean not null default false;
--
-- This migration is data-safe — it does not touch any rows.
-- =============================================================================

alter table public.users
  drop column if exists must_reset_pw;
