-- Phase 7: Security & Operations.
-- Adds: audit_log, mess_settings, login_attempts.
-- Adds RLS policies, indexes, and helper functions used by the new client code.

-- ============================================================================
-- 1. audit_log
-- ============================================================================
create table if not exists public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  occurred_at  timestamptz not null default now(),
  actor_id     uuid references public.users(id) on delete set null,
  actor_role   text,
  action       text not null,
  target_table text,
  target_id    text,
  old_values   jsonb,
  new_values   jsonb,
  meta         jsonb
);

create index if not exists audit_log_occurred_at_idx on public.audit_log(occurred_at desc);
create index if not exists audit_log_actor_idx      on public.audit_log(actor_id);
create index if not exists audit_log_action_idx     on public.audit_log(action);

-- Authenticated staff may insert (direct client writes). Only administrators may read.
alter table public.audit_log enable row level security;

drop policy if exists audit_log_staff_insert on public.audit_log;
create policy audit_log_staff_insert on public.audit_log
  for insert to authenticated
  with check (public.is_staff());

drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log
  for select to authenticated
  using (public.is_administrator());

-- Append-only: no client-side update or delete. Truncate is admin-DDL only.
drop policy if exists audit_log_no_update on public.audit_log;
drop policy if exists audit_log_no_delete on public.audit_log;

-- ============================================================================
-- 2. mess_settings (singleton)
-- ============================================================================
create table if not exists public.mess_settings (
  id                    integer primary key default 1,
  opening_float         numeric(14,2) not null default 0,
  recovery_target_pct   numeric(5,2)  not null default 30.00,
  vat_pct               numeric(5,2)  not null default 0.00,
  holiday_mode          boolean       not null default false,
  mess_name             text          not null default 'Officers Mess',
  currency_code         text          not null default 'ZMW',
  updated_by            uuid          references public.users(id) on delete set null,
  updated_at            timestamptz   not null default now(),
  constraint mess_settings_single_row check (id = 1)
);

-- Seed default row so reads always return one record.
insert into public.mess_settings (id) values (1) on conflict (id) do nothing;

alter table public.mess_settings enable row level security;

-- Any authenticated user may READ the settings (so the cashier app can show opening float).
drop policy if exists mess_settings_read on public.mess_settings;
create policy mess_settings_read on public.mess_settings
  for select to authenticated
  using (true);

-- Only the administrator may update.
drop policy if exists mess_settings_admin_update on public.mess_settings;
create policy mess_settings_admin_update on public.mess_settings
  for update to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

-- Keep updated_at fresh.
create or replace function public.set_mess_settings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_mess_settings_updated_at on public.mess_settings;
create trigger trg_mess_settings_updated_at
  before update on public.mess_settings
  for each row execute function public.set_mess_settings_updated_at();

-- ============================================================================
-- 3. login_attempts (rate limiting)
-- ============================================================================
create table if not exists public.login_attempts (
  id              bigserial primary key,
  service_number  text        not null,
  success         boolean     not null,
  failure_reason  text,
  remote_addr     inet,
  user_agent      text,
  attempted_at    timestamptz not null default now()
);

create index if not exists login_attempts_service_idx on public.login_attempts(service_number, attempted_at desc);
create index if not exists login_attempts_time_idx   on public.login_attempts(attempted_at desc);

alter table public.login_attempts enable row level security;

-- No client reads. Only the anon role may INSERT (so failed-logins are still
-- recorded even before a successful login). We allow inserts to anon and
-- authenticated, but explicitly DENY selects to anyone via no policy.
drop policy if exists login_attempts_anon_insert on public.login_attempts;
create policy login_attempts_anon_insert on public.login_attempts
  for insert to anon, authenticated
  with check (true);

-- Administrators may read for auditing; everyone else is blocked.
drop policy if exists login_attempts_admin_read on public.login_attempts;
create policy login_attempts_admin_read on public.login_attempts
  for select to authenticated
  using (public.is_administrator());

-- Helper: count failed attempts for a service_number within the last `minutes`.
create or replace function public.count_recent_failed_logins(p_service_number text, p_minutes integer default 15)
returns integer
language sql
stable
as $$
  select count(*)::integer
  from public.login_attempts
  where service_number = p_service_number
    and success = false
    and attempted_at >= now() - make_interval(mins => p_minutes);
$$;

-- Helper: is a service_number currently locked out?
create or replace function public.is_service_locked(p_service_number text, p_threshold integer default 5, p_window_minutes integer default 15)
returns boolean
language sql
stable
as $$
  select public.count_recent_failed_logins(p_service_number, p_window_minutes) >= p_threshold;
$$;