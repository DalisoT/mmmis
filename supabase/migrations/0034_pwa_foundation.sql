-- =============================================================================
-- 0034 — PWA foundation (Phase 19)
--
-- The browser now owns the offline action queue (IndexedDB) and a service
-- worker. This migration adds the server-side tables they need:
--
--   1. `public.offline_action_log` — idempotency log for actions replayed
--      by the offline queue. The client_id is a UUID minted in the
--      browser. If a request carrying the same client_id is replayed
--      (network blip, app restart, double-tap), the server can detect
--      the duplicate and return the original result instead of doing
--      the work twice. Indexed on (actor_id, created_at desc) so the
--      "show me my recent offline replays" admin query is cheap.
--
--   2. `public.push_subscriptions` — Web Push subscription records. One
--      row per (user, endpoint) pair. When a CHIT authorization request
--      is created we look up the member's active subscriptions and
--      push a notification. VAPID keys are kept as Supabase secrets,
--      not in this table.
--
-- Both tables are RLS-protected. The PWA subscription insert/select
-- happens via SECURITY DEFINER RPCs added in 0035 (kept separate so
-- this migration can apply cleanly if you skip push for now).
-- =============================================================================

set search_path = public;

-- ---------------------------------------------------------------------------
-- 0. Helper: public.current_user_id()
--
-- Translates the JWT subject (auth.users.id) into the corresponding
-- public.users.id, which is what the FK targets in offline_action_log /
-- push_subscriptions. Wrapping the auth_id→id lookup in a SQL function
-- lets RLS policy expressions stay readable and avoids repeating the
-- subselect everywhere.
--
-- This DB didn't have it before Phase 19 (the rest of the codebase
-- spells out `(select id from public.users where auth_id = auth.uid())`
-- inline). Keeping a function here means 0034 / 0035 are self-contained
-- even on a fresh project.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_user_id'
  ) then
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
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. offline_action_log
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

comment on table public.offline_action_log is
  'Idempotency log for actions replayed by the PWA offline queue. The
   client_id is minted in the browser (crypto.randomUUID). If the same
   client_id appears twice the server returns the original result_id
   without doing the work again, so a flush retry is safe.';

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
-- 2. push_subscriptions
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

comment on table public.push_subscriptions is
  'Web Push API subscription records. One row per device/browser that
   has granted push permission to a signed-in MMMIS user. Revoked rows
   are kept (soft-deleted) so a user re-subscribing from the same
   device gets a fresh record instead of a unique-constraint conflict.';

alter table public.push_subscriptions enable row level security;

-- Users can see + manage their own subscriptions only. The Edge Function
-- that actually sends pushes runs as service_role so it bypasses RLS.
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
-- 3. Sanity check
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'offline_action_log'
  ) then
    raise exception 'offline_action_log not created — investigate.';
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'push_subscriptions'
  ) then
    raise exception 'push_subscriptions not created — investigate.';
  end if;
  raise notice 'PWA foundation tables installed (0034)';
end
$$;