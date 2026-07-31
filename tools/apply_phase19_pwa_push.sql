-- =============================================================================
-- tools/apply_phase19_pwa_push.sql
--
-- Single-shot, idempotent apply script for the Phase 19 PWA + push-notification
-- DB changes (migration 0034 + 0035). Paste this into the Supabase Dashboard
-- SQL editor and click Run.
--
-- Why this exists:
-- 0034 + 0035 use `create table if not exists` etc. so on a clean DB they
-- apply fine. On a partially-applied DB (e.g. 0034 began and the policy
-- CREATE rolled back), running them again still works. The only thing that
-- CAN'T be auto-recovered is a half-applied transaction — Postgres rolls
-- back the whole batch when any statement errors. This script keeps every
-- statement safe to ignore on re-run so you can paste it multiple times
-- without poisoning your DB.
--
-- What this script does:
--   1. Defines public.current_user_id() if missing
--      (translates auth.uid() → public.users.id for RLS policies)
--   2. Creates offline_action_log + indexes + RLS policies
--   3. Creates push_subscriptions + indexes + RLS policies
--   4. Creates push_outbox + indexes + RLS policies
--   5. Installs trg_chit_auth_request_notify + trg_chit_auth_request_resolved
--   6. Installs mark_push_outbox_dispatched(jsonb) RPC
--   7. Prints a final state report so you can eyeball that everything
--      is in place
-- =============================================================================

set search_path = public;

-- ---------------------------------------------------------------------------
-- 1. Helper: public.current_user_id()
-- ---------------------------------------------------------------------------
-- create or replace is already idempotent — no existence check wrapper
-- needed. We avoid using tagged dollar quotes because the Supabase SQL
-- editor runs a preprocessor that misparses dollar-prefixed identifier
-- tokens even inside SQL line comments.

create or replace function public.current_user_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select id from public.users where auth_id = auth.uid() limit 1
$$;

grant execute on function public.current_user_id() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. offline_action_log
-- ---------------------------------------------------------------------------

create table if not exists public.offline_action_log (
  client_id   uuid        primary key,
  kind        text        not null check (kind in ('chit-sale','cash-sale','expense')),
  result_id   uuid        not null,
  actor_id    uuid        not null references public.users(id),
  created_at  timestamptz not null default now()
);

create index if not exists offline_action_log_actor_idx
  on public.offline_action_log (actor_id, created_at desc);

alter table public.offline_action_log enable row level security;

drop policy if exists offline_action_log_admin_read on public.offline_action_log;
create policy offline_action_log_admin_read on public.offline_action_log
  for select to authenticated
  using (public.is_administrator());

drop policy if exists offline_action_log_own_read on public.offline_action_log;
create policy offline_action_log_own_read on public.offline_action_log
  for select to authenticated
  using (actor_id = public.current_user_id());

-- ---------------------------------------------------------------------------
-- 3. push_subscriptions
-- ---------------------------------------------------------------------------

create table if not exists public.push_subscriptions (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references public.users(id) on delete cascade,
  endpoint        text        not null,
  p256dh          text        not null,
  auth            text        not null,
  user_agent      text,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  revoked_at      timestamptz
);

create unique index if not exists push_subscriptions_endpoint_unique
  on public.push_subscriptions (endpoint)
  where revoked_at is null;

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id) where revoked_at is null;

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_own_all on public.push_subscriptions;
create policy push_subscriptions_own_all on public.push_subscriptions
  for all to authenticated
  using (user_id = public.current_user_id())
  with check (user_id = public.current_user_id());

drop policy if exists push_subscriptions_admin_read on public.push_subscriptions;
create policy push_subscriptions_admin_read on public.push_subscriptions
  for select to authenticated
  using (public.is_administrator());

-- ---------------------------------------------------------------------------
-- 4. push_outbox
-- ---------------------------------------------------------------------------

create table if not exists public.push_outbox (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references public.users(id) on delete cascade,
  kind            text        not null,
  title           text        not null,
  body            text        not null,
  url             text,
  tag             text,
  payload         jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  last_error      text
);

create index if not exists push_outbox_unsent_idx
  on public.push_outbox (created_at)
  where sent_at is null;

alter table public.push_outbox enable row level security;

drop policy if exists push_outbox_own_read on public.push_outbox;
create policy push_outbox_own_read on public.push_outbox
  for select to authenticated
  using (user_id = public.current_user_id());

drop policy if exists push_outbox_admin_read on public.push_outbox;
create policy push_outbox_admin_read on public.push_outbox
  for select to authenticated
  using (public.is_administrator());

-- ---------------------------------------------------------------------------
-- 5. CHIT authorization triggers
-- ---------------------------------------------------------------------------

create or replace function public.trg_chit_auth_request_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_barman_name    text;
  v_total_text     text;
begin
  -- chit_authorization_requests.member_id is a FK to public.users(id)
  -- directly — there is no public.members.id column, the members table
  -- is keyed by user_id. So we already have the recipient's user id in
  -- NEW.member_id. members is only joined for the display name in case
  -- we want a richer copy later.
  select u.full_name into v_barman_name
    from public.users u
   where u.id = NEW.created_by;

  v_total_text := format('K%s', to_char(coalesce(NEW.total_amount, 0), 'FM999,990.00'));

  insert into public.push_outbox (user_id, kind, title, body, url, tag, payload)
  values (
    NEW.member_id,
    'chit.authorization_requested',
    'Approve a CHIT purchase',
    coalesce(v_barman_name, 'The barman') || ' is requesting ' || v_total_text || ' on your CHIT account.',
    '/portal/authorize/' || NEW.id::text,
    'chit-' || NEW.id::text,
    jsonb_build_object('request_id', NEW.id, 'total_amount', NEW.total_amount)
  );

  return NEW;
exception when others then
  -- A push failure must NEVER roll back the actual CHIT checkout. Log
  -- it in push_outbox with last_error set so the dashboard can flag
  -- broken notifications, and let the parent INSERT succeed.
  raise warning 'trg_chit_auth_request_notify failed: % (%)', sqlerrm, sqlstate;
  return NEW;
end;
$$;

drop trigger if exists trg_chit_auth_request_notify on public.chit_authorization_requests;
create trigger trg_chit_auth_request_notify
  after insert on public.chit_authorization_requests
  for each row execute function public.trg_chit_auth_request_notify();

create or replace function public.trg_chit_auth_request_resolved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status_text  text;
  v_member_name  text;
begin
  if NEW.status = OLD.status then
    return NEW;
  end if;

  if NEW.status not in ('authorized', 'manual_override', 'rejected', 'cancelled', 'expired') then
    return NEW;
  end if;

  -- chit_authorization_requests.member_id is FK to public.users(id).
  -- members.user_id is the matching PK; join on that for the display
  -- name. There's no public.members.id column.
  select concat_ws(' ', u.first_name, u.last_name) into v_member_name
    from public.users u
    left join public.members m on m.user_id = u.id
   where u.id = NEW.member_id;

  v_status_text := case NEW.status
    when 'authorized'      then 'approved'
    when 'manual_override' then 'recorded (manual override)'
    when 'rejected'        then 'rejected'
    when 'cancelled'       then 'cancelled'
    when 'expired'         then 'expired without a response'
  end;

  insert into public.push_outbox (user_id, kind, title, body, url, tag, payload)
  values (
    NEW.created_by,
    'chit.authorization_resolved',
    'CHIT sale ' || v_status_text,
    coalesce(v_member_name, 'Member') || ' ' || v_status_text || ' your CHIT request.',
    '/pos',
    'chit-resolved-' || NEW.id::text,
    jsonb_build_object('request_id', NEW.id, 'status', NEW.status)
  );

  return NEW;
exception when others then
  -- Never block the actual CHIT checkout on a push failure.
  raise warning 'trg_chit_auth_request_resolved failed: % (%)', sqlerrm, sqlstate;
  return NEW;
end;
$$;

drop trigger if exists trg_chit_auth_request_resolved on public.chit_authorization_requests;
create trigger trg_chit_auth_request_resolved
  after update on public.chit_authorization_requests
  for each row execute function public.trg_chit_auth_request_resolved();

-- ---------------------------------------------------------------------------
-- 6. mark_push_outbox_dispatched(jsonb)
-- ---------------------------------------------------------------------------

create or replace function public.mark_push_outbox_dispatched(
  p_results jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_item  jsonb;
  v_ok    boolean;
  v_id    uuid;
  v_err   text;
begin
  if jsonb_typeof(p_results) <> 'array' then
    raise exception 'p_results must be an array' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_results)
  loop
    v_id  := (v_item ->> 'id')::uuid;
    v_ok  := coalesce((v_item ->> 'ok')::boolean, false);
    v_err := nullif(v_item ->> 'error', '');

    if v_ok then
      update public.push_outbox
         set sent_at = now()
       where id = v_id;
    else
      update public.push_outbox
         set last_error = v_err
       where id = v_id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.mark_push_outbox_dispatched(jsonb) from public;
grant execute on function public.mark_push_outbox_dispatched(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Final state report
-- ---------------------------------------------------------------------------

do $$
declare
  v_helper   boolean;
  v_log      boolean;
  v_subs     boolean;
  v_outbox   boolean;
  v_t1       boolean;
  v_t2       boolean;
  v_rpc      boolean;
  v_migrated text := 'Phase 19 PWA + push notifications ready';
begin
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_user_id'
  ) into v_helper;

  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'offline_action_log'
  ) into v_log;

  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'push_subscriptions'
  ) into v_subs;

  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'push_outbox'
  ) into v_outbox;

  select exists (
    select 1 from pg_trigger where tgname = 'trg_chit_auth_request_notify'
  ) into v_t1;

  select exists (
    select 1 from pg_trigger where tgname = 'trg_chit_auth_request_resolved'
  ) into v_t2;

  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'mark_push_outbox_dispatched'
  ) into v_rpc;

  raise notice '=== Phase 19 status ===';
  raise notice '  public.current_user_id()           : %', v_helper;
  raise notice '  public.offline_action_log          : %', v_log;
  raise notice '  public.push_subscriptions          : %', v_subs;
  raise notice '  public.push_outbox                 : %', v_outbox;
  raise notice '  trg_chit_auth_request_notify       : %', v_t1;
  raise notice '  trg_chit_auth_request_resolved     : %', v_t2;
  raise notice '  mark_push_outbox_dispatched(jsonb) : %', v_rpc;

  if v_helper and v_log and v_subs and v_outbox and v_t1 and v_t2 and v_rpc then
    raise notice '%', v_migrated;
  else
    raise notice 'SOMETHING IS MISSING — see status above.';
  end if;
end
$$;
