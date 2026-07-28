-- =============================================================================
-- 0028 — Schedule expire_chit_authorizations() via pg_cron
--
-- Migration 0022 defined public.expire_chit_authorizations() (the SQL helper
-- that flips status='pending' rows whose expires_at has passed to 'expired')
-- but never scheduled it. Without a scheduler the function is dead code,
-- and 'pending' CHIT authorization rows accumulate indefinitely.
--
-- We bind the schedule to cron.job via pg_cron's standard cron.schedule()
-- helper. The job name is unique so we can drop+create idempotently.
--
-- Frequency: every minute. The function is cheap (single UPDATE against a
-- partial index `chit_auth_pending_expiry_idx`) and the row count will
-- normally be zero, so this is fine for production traffic.
--
-- pg_cron is enabled by default on Supabase projects. If it isn't, run:
--   create extension if not exists pg_cron;
-- and re-run this migration.
--
-- Verify in psql:
--   select * from cron.job where jobname = 'expire-chit-authorizations';
--   select * from cron.job_run_details order by start_time desc limit 5;
-- =============================================================================

set search_path = public;

do $$
begin
  -- pg_cron may not be enabled on every Supabase plan. Bail with a notice
  -- rather than failing the whole migration so 0028 can ship alongside
  -- other hardening even on plans without pg_cron.
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron extension not installed — skipping schedule. Install pg_cron and re-run 0028 to enable.';
    return;
  end if;

  -- Idempotent: drop any existing job with this name, then re-create.
  perform cron.unschedule('expire-chit-authorizations')
    where exists (
      select 1 from cron.job where jobname = 'expire-chit-authorizations'
    );

  perform cron.schedule(
    'expire-chit-authorizations',     -- jobname (unique key for unschedule)
    '* * * * *',                       -- every minute
    $job$ select public.expire_chit_authorizations(); $job$
  );

  raise notice '0028 installed — expire_chit_authorizations() now runs every minute';
end
$$;