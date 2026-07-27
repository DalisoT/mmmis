-- 0020_soft_delete_unique_index.sql
--
-- Allow soft-deleted service_numbers to be reused.
--
-- Background: 0015 et al. added a UNIQUE INDEX on public.users(service_number).
-- That index was applied to all rows including soft-deleted ones (deleted_at
-- is not null), which means deactivating a user permanently reserves their
-- service_number and a fresh self-signup with that number collides on the
-- unique constraint. The Postgres error 23505 from the auth.users trigger
-- then surfaces to the browser as a 500 / unexpected_failure from
-- /auth/v1/signup and a React #321 in the SPA.
--
-- This migration replaces the full unique index with a PARTIAL unique
-- index that only enforces uniqueness on rows where deleted_at IS NULL.
-- Soft-deleted rows no longer block reuse. Active and re-registered
-- rows still cannot share a service_number.
--
-- Idempotent: safe to run multiple times.
-- Reversible: see the `downgrade_block` commented at the bottom; rerun
-- as a normal migration to roll back if needed.

-- ---------------------------------------------------------------------------
-- UP
-- ---------------------------------------------------------------------------

-- Drop the old constraint (and its backing index). 2BP01 means we cannot
-- drop the index directly because the constraint depends on it; dropping
-- the constraint first removes both. The constraint name is the same as
-- the index name in 0001_init.sql; if you renamed it, edit below.
alter table public.users
  drop constraint if exists users_service_number_key;

-- Belt-and-braces: in case the original migration used a free-standing
-- index rather than a constraint, drop that too.
drop index if exists public.users_service_number_key;

-- Recreate as a partial unique index that ignores soft-deleted rows.
create unique index if not exists users_service_number_active_key
  on public.users (service_number)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- DOWN (commented — uncomment and rerun as a separate migration to roll back)
-- ---------------------------------------------------------------------------
-- drop index if exists public.users_service_number_active_key;
-- create unique index users_service_number_key
--   on public.users (service_number);