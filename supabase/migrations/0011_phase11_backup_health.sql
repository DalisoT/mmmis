-- Phase 11 — Backup health snapshot
--
-- Adds a single RPC `public.get_backup_health()` that returns one row per
-- critical table with a row count, last-write timestamp (where the table
-- has a write timestamp), and a freshness verdict.
--
-- This is intended to be polled by the in-app Backup Health dashboard
-- (`src/features/admin/BackupHealthPage.tsx`) and surfaces problems that
-- the existing `scripts/backup-verify.ts` would catch but only when run
-- from a scheduled job.
--
-- Authorization: administrator + treasurer only (same as reports).

set search_path = public;

create or replace function public.get_backup_health(
  p_stale_hours integer default 36,
  p_dead_hours  integer default 72
)
returns table (
  table_name      text,
  row_count       bigint,
  last_write_at   timestamptz,
  status          text,             -- 'ok' | 'warn' | 'error' | 'empty'
  status_message  text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.current_role_code();
begin
  if v_role not in ('administrator', 'treasurer') then
    raise exception 'Backup health is restricted to staff' using errcode = '42501';
  end if;

  if p_stale_hours is null or p_stale_hours < 1 then
    p_stale_hours := 36;
  end if;
  if p_dead_hours is null or p_dead_hours <= p_stale_hours then
    p_dead_hours := p_stale_hours * 2;
  end if;

  -- Each branch computes (count, last_write) for one table. We use a
  -- generic format and normalize empty timestamps to NULL.

  return query
  with snapshot as (
    select * from (values
      ('users',           (select count(*) from public.users),           (select max(created_at) from public.users)),
      ('members',         (select count(*) from public.members),         (select max(created_at) from public.members)),
      ('products',        (select count(*) from public.products),        (select max(created_at) from public.products)),
      ('sales',           (select count(*) from public.sales),           (select max(created_at) from public.sales)),
      ('sale_items',      (select count(*) from public.sale_items),      null::timestamptz),
      ('chit_payments',   (select count(*) from public.chit_payments),   (select max(paid_at) from public.chit_payments)),
      ('expenses',        (select count(*) from public.expenses),        (select max(created_at) from public.expenses)),
      ('ledger',          (select count(*) from public.ledger),          (select max(created_at) from public.ledger)),
      ('stock_receipts',  (select count(*) from public.stock_receipts),  (select max(received_at) from public.stock_receipts)),
      ('stock_sheet',     (select count(*) from public.stock_sheet),     (select max(created_at) from public.stock_sheet)),
      ('daily_summary',   (select count(*) from public.daily_summary),   (select max(business_date) from public.daily_summary)),
      ('audit_log',       (select count(*) from public.audit_log),       (select max(occurred_at) from public.audit_log)),
      ('mess_settings',   (select count(*) from public.mess_settings),   (select max(updated_at) from public.mess_settings)),
      ('login_attempts',  (select count(*) from public.login_attempts),  (select max(attempted_at) from public.login_attempts))
    ) as s(table_name, row_count, last_write_at)
  )
  select
    s.table_name,
    s.row_count,
    s.last_write_at,
    case
      when s.table_name in ('mess_settings', 'login_attempts') and s.row_count = 0 then 'empty'::text
      when s.row_count = 0                                       then 'empty'::text
      when s.last_write_at is null                               then 'ok'::text
      when s.last_write_at < now() - make_interval(hours => p_dead_hours)  then 'error'::text
      when s.last_write_at < now() - make_interval(hours => p_stale_hours) then 'warn'::text
      else 'ok'::text
    end as status,
    case
      when s.row_count = 0 and s.table_name not in ('mess_settings','login_attempts')
        then 'Table is empty — backup will be missing this dataset'
      when s.last_write_at is null
        then 'No timestamp column tracked for this table'
      when s.last_write_at < now() - make_interval(hours => p_dead_hours)
        then 'No activity for ' || p_dead_hours::text || 'h+ — possible stalled pipeline'
      when s.last_write_at < now() - make_interval(hours => p_stale_hours)
        then 'No activity for ' || p_stale_hours::text || 'h+ — review schedule'
      else 'Healthy'
    end as status_message
  from snapshot s
  order by s.table_name;
end;
$$;

revoke all on function public.get_backup_health(integer, integer) from public;
grant execute on function public.get_backup_health(integer, integer) to authenticated;

comment on function public.get_backup_health(integer, integer)
  is 'Returns row counts and last-write timestamps for critical tables. Staff only.';
