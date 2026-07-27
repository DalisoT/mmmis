-- =============================================================================
-- MMMIS - Military Mess Management Information System
-- Initial schema migration
-- =============================================================================
-- Run this in the Supabase SQL Editor.
-- Designed to be idempotent where reasonable; safe to re-run in dev.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Helper: updated_at trigger function
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =============================================================================
-- ROLES
-- =============================================================================
-- Static enum-like table. The 4 system roles defined by the spec.
-- =============================================================================
create table if not exists public.roles (
  id          smallint primary key,
  code        text unique not null check (code in ('administrator','treasurer','barman','member')),
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

insert into public.roles (id, code, name, description) values
  (1, 'administrator', 'Administrator', 'Full system access'),
  (2, 'treasurer',     'Treasurer',     'Financial oversight, CHIT recovery, expenses'),
  (3, 'barman',        'Barman',        'Records sales, stock, expenses'),
  (4, 'member',        'Member',        'Mess member, can view own ledger')
on conflict (id) do nothing;

-- =============================================================================
-- USERS
-- =============================================================================
-- One row per authenticated user. Login identifier = service_number (unique).
-- We mirror auth.users so RLS / joins / role checks don't need multiple lookups.
-- =============================================================================
create table if not exists public.users (
  id              uuid primary key default gen_random_uuid(),
  -- Supabase auth.users.id (1:1 with the auth account)
  auth_id         uuid unique references auth.users(id) on delete cascade,
  service_number  text unique not null,
  full_name       text not null,
  email           text unique,
  phone           text,
  role_id         smallint not null references public.roles(id),
  rank            text,
  unit            text,
  is_active       boolean not null default true,
  must_reset_pw   boolean not null default false,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists users_role_idx     on public.users(role_id);
create index if not exists users_active_idx   on public.users(is_active) where deleted_at is null;

drop trigger if exists trg_users_updated_at on public.users;
create trigger trg_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

-- =============================================================================
-- MEMBERS (extended profile for role='member')
-- =============================================================================
create table if not exists public.members (
  user_id          uuid primary key references public.users(id) on delete cascade,
  service_number   text unique not null,
  first_name       text not null,
  last_name        text not null,
  rank             text,
  unit             text,
  chit_balance     numeric(14,2) not null default 0 check (chit_balance >= 0),
  credit_limit     numeric(14,2) not null default 0,
  is_blacklisted   boolean not null default false,
  joined_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

drop trigger if exists trg_members_updated_at on public.members;
create trigger trg_members_updated_at
before update on public.members
for each row execute function public.set_updated_at();

-- =============================================================================
-- PRODUCTS
-- =============================================================================
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  category        text not null check (category in ('Beer','Soft Drinks','Water','Food','Other')),
  buying_price    numeric(12,2) not null default 0 check (buying_price >= 0),
  selling_price   numeric(12,2) not null check (selling_price >= 0),
  unit            text not null default 'bottle', -- bottle, can, crate, plate, etc.
  opening_stock   integer not null default 0 check (opening_stock >= 0),
  minimum_stock   integer not null default 0 check (minimum_stock >= 0),
  barcode         text unique,
  status          text not null default 'active' check (status in ('active','inactive')),
  -- Make product name unique so seed migrations and the admin UI can rely on it.
  constraint products_name_unique unique (name),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists products_category_idx on public.products(category);
create index if not exists products_status_idx   on public.products(status) where deleted_at is null;

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

-- =============================================================================
-- STOCK RECEIPTS (Stock RCV)
-- =============================================================================
create table if not exists public.stock_receipts (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.products(id),
  received_by     uuid not null references public.users(id),
  quantity        integer not null check (quantity > 0),
  supplier        text,
  invoice_number  text,
  unit_cost       numeric(12,2) check (unit_cost >= 0),
  received_at     timestamptz not null default now(),
  remarks         text,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists stock_receipts_product_idx on public.stock_receipts(product_id);

-- =============================================================================
-- STOCK SHEET (Daily)
-- =============================================================================
-- One row per product per day. The field names match the paper form exactly:
--   stock_bf, stock_rcv, total_stock, allergy, sold, stock_cf, price, total
-- =============================================================================
create table if not exists public.stock_sheet (
  id              uuid primary key default gen_random_uuid(),
  sheet_date      date not null,
  product_id      uuid not null references public.products(id),
  stock_bf        integer not null default 0 check (stock_bf >= 0),
  stock_rcv       integer not null default 0 check (stock_rcv >= 0),
  total_stock     integer generated always as (stock_bf + stock_rcv) stored,
  allergy         integer not null default 0 check (allergy >= 0),
  sold            integer not null default 0 check (sold >= 0),
  stock_cf        integer not null default 0 check (stock_cf >= 0),
  price           numeric(12,2) not null default 0 check (price >= 0),
  total           numeric(14,2) generated always as (sold * price) stored,
  recorded_by     uuid references public.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (sheet_date, product_id)
);

create index if not exists stock_sheet_date_idx on public.stock_sheet(sheet_date);

drop trigger if exists trg_stock_sheet_updated_at on public.stock_sheet;
create trigger trg_stock_sheet_updated_at
before update on public.stock_sheet
for each row execute function public.set_updated_at();

-- =============================================================================
-- SALES
-- =============================================================================
create table if not exists public.sales (
  id              uuid primary key default gen_random_uuid(),
  sale_date       date not null default current_date,
  sold_at         timestamptz not null default now(),
  sale_type       text not null check (sale_type in ('cash','chit')),
  barman_id       uuid not null references public.users(id),
  member_id       uuid references public.members(user_id),  -- required for chit
  total_amount    numeric(14,2) not null check (total_amount >= 0),
  payment_status  text not null default 'paid' check (payment_status in ('paid','pending','voided')),
  remarks         text,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists sales_date_idx    on public.sales(sale_date);
create index if not exists sales_barman_idx  on public.sales(barman_id);
create index if not exists sales_member_idx  on public.sales(member_id);

create table if not exists public.sale_items (
  id              uuid primary key default gen_random_uuid(),
  sale_id         uuid not null references public.sales(id) on delete cascade,
  product_id      uuid not null references public.products(id),
  quantity        integer not null check (quantity > 0),
  unit_price      numeric(12,2) not null check (unit_price >= 0),
  line_total      numeric(14,2) generated always as (quantity * unit_price) stored
);

create index if not exists sale_items_sale_idx    on public.sale_items(sale_id);
create index if not exists sale_items_product_idx on public.sale_items(product_id);

-- =============================================================================
-- CHIT PAYMENTS (Recovery)
-- =============================================================================
create table if not exists public.chit_payments (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.members(user_id),
  amount          numeric(14,2) not null check (amount > 0),
  payment_method  text not null check (payment_method in ('cash','payslip_deduction','manual_recovery')),
  received_by     uuid not null references public.users(id),
  paid_at         timestamptz not null default now(),
  reference       text,    -- payslip month, receipt #, etc.
  remarks         text,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists chit_payments_member_idx on public.chit_payments(member_id);

-- =============================================================================
-- EXPENSES
-- =============================================================================
create table if not exists public.expenses (
  id              uuid primary key default gen_random_uuid(),
  expense_date    date not null default current_date,
  description     text not null,
  amount          numeric(14,2) not null check (amount > 0),
  released_by     uuid not null references public.users(id),
  purpose         text not null,
  remarks         text,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists expenses_date_idx on public.expenses(expense_date);

-- =============================================================================
-- LEDGER (per member)
-- =============================================================================
-- Auto-appended from sales, chit_payments, and adjustments.
-- balance is the running balance AFTER the transaction is applied.
-- =============================================================================
create table if not exists public.ledger (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.members(user_id),
  txn_date        date not null default current_date,
  txn_at          timestamptz not null default now(),
  description     text not null,
  debit           numeric(14,2) not null default 0 check (debit >= 0),  -- purchases add to balance
  payment         numeric(14,2) not null default 0 check (payment >= 0),-- payments reduce balance
  balance         numeric(14,2) not null,
  source_type     text not null check (source_type in ('sale','payment','adjustment')),
  source_id       uuid,
  created_at      timestamptz not null default now()
);

create index if not exists ledger_member_idx on public.ledger(member_id);
create index if not exists ledger_date_idx   on public.ledger(txn_date);

-- =============================================================================
-- DAILY SUMMARY
-- =============================================================================
create table if not exists public.daily_summary (
  id                  uuid primary key default gen_random_uuid(),
  summary_date        date unique not null,
  cash_sales          numeric(14,2) not null default 0,
  chit_sales          numeric(14,2) not null default 0,
  chit_recovery       numeric(14,2) not null default 0,
  expenses            numeric(14,2) not null default 0,
  cash_at_hand_open   numeric(14,2) not null default 0,
  cash_at_hand_close  numeric(14,2) not null default 0,
  stock_value_close   numeric(14,2) not null default 0,
  computed_at         timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

-- =============================================================================
-- AUDIT LOGS
-- =============================================================================
-- Append-only. Never updated or deleted.
-- =============================================================================
create table if not exists public.audit_logs (
  id            bigserial primary key,
  actor_id      uuid references public.users(id),
  action        text not null,           -- e.g. 'user.create', 'sale.void'
  target_table  text,
  target_id     text,
  old_values    jsonb,
  new_values    jsonb,
  ip_address    inet,
  user_agent    text,
  device        text,
  occurred_at   timestamptz not null default now()
);

create index if not exists audit_actor_idx  on public.audit_logs(actor_id);
create index if not exists audit_action_idx on public.audit_logs(action);
create index if not exists audit_time_idx   on public.audit_logs(occurred_at desc);

-- =============================================================================
-- SETTINGS
-- =============================================================================
create table if not exists public.settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.users(id)
);

-- Default settings
insert into public.settings (key, value) values
  ('mess_name',           '"Unit Mess"'::jsonb),
  ('opening_cash',        '0'::jsonb),
  ('currency',            '"ZMW"'::jsonb),
  ('theme_default',       '"dark"'::jsonb),
  ('auto_logout_minutes', '30'::jsonb)
on conflict (key) do nothing;

-- =============================================================================
-- VIEWS
-- =============================================================================
create or replace view public.v_user_roles as
  select u.id, u.service_number, u.full_name, u.is_active,
         r.code as role_code, r.name as role_name
  from public.users u
  join public.roles r on r.id = u.role_id
  where u.deleted_at is null;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
alter table public.roles            enable row level security;
alter table public.users            enable row level security;
alter table public.members          enable row level security;
alter table public.products         enable row level security;
alter table public.stock_receipts   enable row level security;
alter table public.stock_sheet      enable row level security;
alter table public.sales            enable row level security;
alter table public.sale_items       enable row level security;
alter table public.chit_payments    enable row level security;
alter table public.expenses         enable row level security;
alter table public.ledger           enable row level security;
alter table public.daily_summary    enable row level security;
alter table public.audit_logs       enable row level security;
alter table public.settings         enable row level security;

-- Helper: returns the current user's role code, or null.
create or replace function public.current_role_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.code
  from public.users u
  join public.roles r on r.id = u.role_id
  where u.auth_id = auth.uid()
    and u.deleted_at is null
  limit 1;
$$;

create or replace function public.is_administrator() returns bool
language sql stable as $$ select public.current_role_code() = 'administrator' $$;
create or replace function public.is_treasurer()     returns bool
language sql stable as $$ select public.current_role_code() = 'treasurer' $$;
create or replace function public.is_barman()        returns bool
language sql stable as $$ select public.current_role_code() = 'barman' $$;
create or replace function public.is_member()        returns bool
language sql stable as $$ select public.current_role_code() = 'member' $$;
create or replace function public.is_staff()         returns bool
language sql stable as $$
  select public.current_role_code() in ('administrator','treasurer','barman');
$$;

-- ----- roles: readable by anyone authenticated
drop policy if exists roles_read on public.roles;
create policy roles_read on public.roles
  for select to authenticated using (true);

-- ----- users
drop policy if exists users_self_read      on public.users;
create policy users_self_read on public.users
  for select to authenticated
  using (auth_id = auth.uid() or public.is_staff());

drop policy if exists users_admin_all       on public.users;
create policy users_admin_all on public.users
  for all to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

drop policy if exists users_staff_read      on public.users;
create policy users_staff_read on public.users
  for select to authenticated
  using (public.is_staff());

-- ----- members
drop policy if exists members_self_read on public.members;
create policy members_self_read on public.members
  for select to authenticated
  using (user_id = (select id from public.users where auth_id = auth.uid())
         or public.is_staff());

drop policy if exists members_admin_write on public.members;
create policy members_admin_write on public.members
  for all to authenticated
  using (public.is_administrator() or public.is_treasurer())
  with check (public.is_administrator() or public.is_treasurer());

-- ----- products
drop policy if exists products_read on public.products;
create policy products_read on public.products
  for select to authenticated using (deleted_at is null);

drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products
  for all to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

-- ----- stock_receipts
drop policy if exists stock_receipts_read    on public.stock_receipts;
create policy stock_receipts_read on public.stock_receipts
  for select to authenticated using (public.is_staff());

drop policy if exists stock_receipts_write   on public.stock_receipts;
create policy stock_receipts_write on public.stock_receipts
  for insert to authenticated
  with check (public.is_administrator() or public.is_treasurer());

-- ----- stock_sheet
drop policy if exists stock_sheet_read    on public.stock_sheet;
create policy stock_sheet_read on public.stock_sheet
  for select to authenticated using (public.is_staff());

drop policy if exists stock_sheet_write   on public.stock_sheet;
create policy stock_sheet_write on public.stock_sheet
  for all to authenticated
  using (public.is_administrator() or public.is_barman() or public.is_treasurer())
  with check (public.is_administrator() or public.is_barman() or public.is_treasurer());

-- ----- sales / sale_items
drop policy if exists sales_read    on public.sales;
create policy sales_read on public.sales
  for select to authenticated
  using (public.is_staff());

drop policy if exists sales_member_read on public.sales;
create policy sales_member_read on public.sales
  for select to authenticated
  using (member_id = (select id from public.users where auth_id = auth.uid()));

drop policy if exists sales_write   on public.sales;
create policy sales_write on public.sales
  for insert to authenticated
  with check (public.is_barman() or public.is_administrator());

drop policy if exists sale_items_rw on public.sale_items;
create policy sale_items_rw on public.sale_items
  for all to authenticated
  using (public.is_staff())
  with check (public.is_barman() or public.is_administrator());

-- ----- chit_payments
drop policy if exists chit_payments_read    on public.chit_payments;
create policy chit_payments_read on public.chit_payments
  for select to authenticated
  using (
    member_id = (select id from public.users where auth_id = auth.uid())
    or public.is_treasurer() or public.is_administrator() or public.is_barman()
  );

drop policy if exists chit_payments_write   on public.chit_payments;
create policy chit_payments_write on public.chit_payments
  for insert to authenticated
  with check (public.is_treasurer() or public.is_administrator());

-- ----- expenses
drop policy if exists expenses_read    on public.expenses;
create policy expenses_read on public.expenses
  for select to authenticated
  using (public.is_treasurer() or public.is_administrator() or public.is_barman());

drop policy if exists expenses_write   on public.expenses;
create policy expenses_write on public.expenses
  for insert to authenticated
  with check (public.is_treasurer() or public.is_administrator() or public.is_barman());

-- ----- ledger
drop policy if exists ledger_self_read on public.ledger;
create policy ledger_self_read on public.ledger
  for select to authenticated
  using (member_id = (select id from public.users where auth_id = auth.uid())
         or public.is_treasurer() or public.is_administrator());

-- Inserts to ledger should come from server-side logic (service role) or triggers.

-- ----- daily_summary
drop policy if exists daily_summary_read on public.daily_summary;
create policy daily_summary_read on public.daily_summary
  for select to authenticated using (public.is_staff());

-- ----- audit_logs: read by admin/treasurer only; inserts from service role
drop policy if exists audit_logs_read    on public.audit_logs;
create policy audit_logs_read on public.audit_logs
  for select to authenticated
  using (public.is_administrator() or public.is_treasurer());

-- ----- settings: admin read/write, others read
drop policy if exists settings_read    on public.settings;
create policy settings_read on public.settings
  for select to authenticated using (true);

drop policy if exists settings_write   on public.settings;
create policy settings_write on public.settings
  for all to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

-- =============================================================================
-- TRIGGERS: maintain members.chit_balance and append to ledger
-- =============================================================================
create or replace function public.apply_member_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric(14,2);
begin
  -- find current balance
  select coalesce(balance,0) into v_balance
    from public.ledger
    where member_id = new.member_id
    order by txn_at desc, id desc
    limit 1;

  if v_balance is null then
    select coalesce(chit_balance,0) into v_balance from public.members where user_id = new.member_id;
  end if;

  new.balance := v_balance + coalesce(new.debit,0) - coalesce(new.payment,0);

  if tg_op = 'INSERT' then
    update public.members
       set chit_balance = new.balance
     where user_id = new.member_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ledger_balance on public.ledger;
create trigger trg_ledger_balance
before insert on public.ledger
for each row execute function public.apply_member_ledger();

-- =============================================================================
-- TRIGGER: seed users row on signup (so RLS has a row to join)
-- =============================================================================
-- We bind to auth.users via the auth_id column. A server-side trigger on
-- auth.users is intentionally NOT created here because Supabase recommends
-- using a webhook / Edge Function for that flow. The application code in
-- src/features/users will handle user provisioning via service-role calls.

-- =============================================================================
-- SEED: nothing business-data-wise yet. The administrator creates the first
-- users and products through the app.
-- =============================================================================

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
