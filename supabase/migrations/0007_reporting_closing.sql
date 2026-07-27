-- Phase 5: reporting and cash-closing reconciliation.

alter table public.daily_summary
  add column if not exists counted_cash numeric(14,2),
  add column if not exists variance numeric(14,2),
  add column if not exists counted_by uuid references public.users(id),
  add column if not exists counted_at timestamptz,
  add column if not exists closing_status text not null default 'open',
  add column if not exists closing_notes text;

alter table public.daily_summary
  drop constraint if exists daily_summary_closing_status_check;
alter table public.daily_summary
  add constraint daily_summary_closing_status_check
  check (closing_status in ('open', 'counted', 'approved', 'disputed'));

-- Keep variance consistent for both historical rows and future writes.
create or replace function public.set_daily_summary_variance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.variance := coalesce(new.counted_cash, 0) - coalesce(new.cash_at_hand_close, 0);
  return new;
end;
$$;

drop trigger if exists trg_daily_summary_variance on public.daily_summary;
create trigger trg_daily_summary_variance
before insert or update on public.daily_summary
for each row execute function public.set_daily_summary_variance();

-- Staff may maintain daily summary snapshots; treasurer/admin may review them.
drop policy if exists daily_summary_staff_insert on public.daily_summary;
create policy daily_summary_staff_insert on public.daily_summary
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists daily_summary_staff_update on public.daily_summary;
create policy daily_summary_staff_update on public.daily_summary
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create index if not exists daily_summary_status_idx on public.daily_summary(closing_status);
create index if not exists daily_summary_date_idx on public.daily_summary(summary_date desc);
