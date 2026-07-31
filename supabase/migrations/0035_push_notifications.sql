-- =============================================================================
-- 0035 — Push notification outbox (Phase 19)
--
-- The web-push fan-out lives in an Edge Function (supabase/functions/
-- push-dispatch). That function needs to be triggered when something
-- noteworthy happens:
--
--   - A CHIT authorization request is created → notify the member.
--   - A CHIT authorization request is approved / rejected → notify the
--     barman who initiated it.
--   - Daily cash-up window opens → notify the treasurer (optional).
--
-- Rather than relying on pg_net (not enabled on every Supabase plan) we
-- use a Postgres trigger that inserts a row into `push_outbox` and let
-- a Supabase Database Webhook (configured in the dashboard) call the
-- Edge Function for each INSERT.
--
-- The outbox has a `sent_at` column so the webhook query can ignore
-- already-dispatched rows, and a `last_error` column so the dispatcher
-- can record why a particular delivery failed (expired subscription,
-- 404, 410 → soft-revoke).
-- =============================================================================

set search_path = public;

-- ---------------------------------------------------------------------------
-- 1. push_outbox
-- ---------------------------------------------------------------------------

create table if not exists public.push_outbox (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references public.users(id) on delete cascade,
  kind            text        not null,
  title           text        not null,
  body            text        not null,
  url             text,                                       -- where to navigate on click
  tag             text,                                       -- collapse duplicates (e.g. "chit-<request_id>")
  payload         jsonb       not null default '{}'::jsonb,   -- extra data for the SW
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  last_error      text
);

create index if not exists push_outbox_unsent_idx
  on public.push_outbox (created_at)
  where sent_at is null;

comment on table public.push_outbox is
  'Queue of push notifications to be dispatched by the push-dispatch
   Edge Function. The Database Webhook listens for INSERTs and calls
   the function once per row. The function marks sent_at on success
   or last_error on failure.';

alter table public.push_outbox enable row level security;

-- Users can see their own outbox rows (e.g. for "what notifications
-- have I missed"). The dispatcher runs as service_role.
drop policy if exists push_outbox_own_read on public.push_outbox;
create policy push_outbox_own_read on public.push_outbox
  for select to authenticated
  using (user_id = public.current_user_id());

drop policy if exists push_outbox_admin_read on public.push_outbox;
create policy push_outbox_admin_read on public.push_outbox
  for select to authenticated
  using (public.is_administrator());

-- ---------------------------------------------------------------------------
-- 2. Trigger: CHIT authorization request created → enqueue for member
-- ---------------------------------------------------------------------------

create or replace function public.trg_chit_auth_request_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_user_id uuid;
  v_barman_name    text;
  v_total_text     text;
begin
  -- Look up the member's user_id (members.user_id -> users.id) and the
  -- barman's display name for the notification body.
  select m.user_id into v_member_user_id
    from public.members m
   where m.id = NEW.member_id;
  if v_member_user_id is null then
    return NEW;  -- orphaned member; nothing to do
  end if;

  select u.full_name into v_barman_name
    from public.users u
   where u.id = NEW.created_by;

  v_total_text := format('K%s', to_char(coalesce(NEW.total_amount, 0), 'FM999,990.00'));

  insert into public.push_outbox (user_id, kind, title, body, url, tag, payload)
  values (
    v_member_user_id,
    'chit.authorization_requested',
    'Approve a CHIT purchase',
    coalesce(v_barman_name, 'The barman') || ' is requesting ' || v_total_text || ' on your CHIT account.',
    '/portal/authorize/' || NEW.id::text,
    'chit-' || NEW.id::text,
    jsonb_build_object('request_id', NEW.id, 'total_amount', NEW.total_amount)
  );

  return NEW;
end;
$$;

drop trigger if exists trg_chit_auth_request_notify on public.chit_authorization_requests;
create trigger trg_chit_auth_request_notify
  after insert on public.chit_authorization_requests
  for each row execute function public.trg_chit_auth_request_notify();

-- ---------------------------------------------------------------------------
-- 3. Trigger: CHIT authorization request resolved → enqueue for barman
-- ---------------------------------------------------------------------------
-- Fires on UPDATE of status to authorized / manual_override / rejected /
-- cancelled. Uses WHEN so we only fire when status actually changes (not
-- on every UPDATE).
-- ---------------------------------------------------------------------------

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

  -- Resolve member display name for the barman-facing copy.
  select concat_ws(' ', u.first_name, u.last_name) into v_member_name
    from public.members m
    join public.users u on u.id = m.user_id
   where m.id = NEW.member_id;

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
end;
$$;

drop trigger if exists trg_chit_auth_request_resolved on public.chit_authorization_requests;
create trigger trg_chit_auth_request_resolved
  after update on public.chit_authorization_requests
  for each row execute function public.trg_chit_auth_request_resolved();

-- ---------------------------------------------------------------------------
-- 4. mark_push_outbox_dispatched() RPC
-- ---------------------------------------------------------------------------
-- Called by the Edge Function with a batch of outbox row ids + their
-- per-recipient delivery result. SECURITY DEFINER so the Edge Function
-- can update rows it can't normally see (the dispatcher runs as
-- service_role, but we want the RPC to work even if invoked with a
-- user's JWT for admin tooling).
-- ---------------------------------------------------------------------------

create or replace function public.mark_push_outbox_dispatched(
  p_results jsonb  -- [{ id: uuid, ok: bool, error?: string }]
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

comment on function public.mark_push_outbox_dispatched(jsonb) is
  'Called by the push-dispatch Edge Function to record per-recipient
   delivery success/failure. Takes a JSON array of {id, ok, error?}.';

-- ---------------------------------------------------------------------------
-- 5. Sanity check
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_chit_auth_request_notify') then
    raise exception 'trg_chit_auth_request_notify not created — investigate.';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_chit_auth_request_resolved') then
    raise exception 'trg_chit_auth_request_resolved not created — investigate.';
  end if;
  raise notice 'Push outbox + triggers installed (0035)';
end
$$;