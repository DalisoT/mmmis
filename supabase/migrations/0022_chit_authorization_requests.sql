-- =============================================================================
-- 0022 — CHIT member-side authorization requests (Phase 22)
--
-- Adds a buyer-side authorization channel for CHIT sales. Instead of the
-- barman typing the member's password, the buyer approves the purchase from
-- /portal on their own phone. The existing `PinDialog` (barman enters the
-- password) remains as a documented `manual_override` fallback.
--
-- Lifecycle:
--   1. POS calls create_chit_authorization() -> row inserted with status='pending'.
--   2. POS subscribes to realtime on that id; the /portal page (Realtime) and
--      the buyer's push notification wake the buyer's phone.
--   3. The buyer opens /portal/authorize/<id>, re-enters their password, and
--      approve_chit_authorization() flips status='authorized' with
--      authorized_via='buyer'.
--   4. The POS sees status='authorized' via Realtime, calls
--      finalize_chit_authorization() which atomically runs create_sale()
--      and clears the request.
--   5. If the barman types the password instead, manual_override_chit_authorization()
--      stamps status='manual_override' and authorized_via='manual_override'.
--   6. If 5 minutes elapse without action, pg_cron marks the row 'expired'.
--
-- Security model:
--   - The table is not exposed to clients via RLS for write. Every mutation
--     goes through a SECURITY DEFINER RPC.
--   - The buyer can SELECT their own row via a per-row policy.
--   - Staff can SELECT rows they created or all rows when an administrator.
--   - Service role in Edge Functions can UPDATE via RPC only.
-- =============================================================================

set search_path = public;

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table if not exists public.chit_authorization_requests (
  id                uuid        primary key default gen_random_uuid(),
  member_id         uuid        not null references public.users(id) on delete cascade,
  created_by        uuid        not null references auth.users(id),   -- barman auth_id
  cart              jsonb       not null,                            -- [{product_id, quantity, unit_price}]
  total_amount      numeric(12,2) not null check (total_amount >= 0),
  status            text        not null default 'pending'
                                check (status in (
                                  'pending','authorized','manual_override',
                                  'rejected','expired','cancelled','consumed'
                                )),
  authorized_at     timestamptz,
  authorized_via    text        check (authorized_via in ('buyer','manual_override')),
  authorized_ip     inet,
  consumed_sale_id  uuid        references public.sales(id),
  rejection_reason  text,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '5 minutes')
);

comment on table public.chit_authorization_requests is
  'Pending CHIT-sale authorizations awaiting the buyer''s approval on /portal. '
  'Realtime-published so the POS can react the moment the buyer approves. The '
  'barman pin-entry dialog is preserved as a manual_override path.';

-- Realtime needs REPLICA IDENTITY FULL to emit OLD row data; we don't need
-- that here (only NEW-row UPDATEs matter) and primary-key identity is the
-- default. Leave defaults.

create index if not exists chit_auth_member_pending_idx
  on public.chit_authorization_requests (member_id, created_at desc)
  where status = 'pending';

create index if not exists chit_auth_pending_expiry_idx
  on public.chit_authorization_requests (expires_at)
  where status = 'pending';

create index if not exists chit_auth_created_by_idx
  on public.chit_authorization_requests (created_by, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. RLS — buyers read their own; staff read everything they could reasonable
--    need (admins/treasurers all, barmen their own).
-- ---------------------------------------------------------------------------

alter table public.chit_authorization_requests enable row level security;

drop policy if exists chit_auth_member_select on public.chit_authorization_requests;
create policy chit_auth_member_select on public.chit_authorization_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = chit_authorization_requests.member_id
        and u.auth_id = auth.uid()
        and u.deleted_at is null
    )
  );

drop policy if exists chit_auth_staff_select on public.chit_authorization_requests;
create policy chit_auth_staff_select on public.chit_authorization_requests
  for select to authenticated
  using (public.is_administrator() or public.is_treasurer()
         or created_by = auth.uid());

-- No INSERT / UPDATE / DELETE policies for clients. Everything goes via RPC.

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------

-- 3.1 create_chit_authorization — barman-facing, inserts a pending row.
create or replace function public.create_chit_authorization(
  p_member_id   uuid,
  p_cart        jsonb,
  p_total_amount numeric default null   -- server recomputes when null
)
returns table (
  request_id    uuid,
  expires_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller       uuid := auth.uid();
  v_role         text;
  v_member_ok    uuid;
  v_total        numeric(12,2) := 0;
  v_item         jsonb;
  v_pid          uuid;
  v_qty          integer;
  v_price        numeric(12,2);
  v_id           uuid;
  v_expires      timestamptz := now() + interval '5 minutes';
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select r.code into v_role
    from public.users u
    join public.roles r on r.id = u.role_id
   where u.auth_id = v_caller
     and u.deleted_at is null and u.is_active = true;
  if v_role is null or v_role not in ('administrator','treasurer','barman') then
    raise exception 'Forbidden: only staff can begin a CHIT sale'
      using errcode = '42501';
  end if;

  -- Member must exist, be active, and not blacklisted.
  select m.user_id into v_member_ok
    from public.members m
    join public.users u on u.id = m.user_id
   where m.user_id = p_member_id
     and u.deleted_at is null
     and u.is_active = true
     and coalesce(m.is_blacklisted, false) = false;
  if v_member_ok is null then
    raise exception 'Member not found, inactive, or blacklisted'
      using errcode = '23503';
  end if;

  -- Validate cart & recompute total server-side.
  if jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) = 0 then
    raise exception 'Cart is empty' using errcode = '22000';
  end if;

  for v_item in select * from jsonb_array_elements(p_cart)
  loop
    v_pid   := (v_item ->> 'product_id')::uuid;
    v_qty   := (v_item ->> 'quantity')::integer;
    v_price := (v_item ->> 'unit_price')::numeric;
    if v_pid is null or v_qty is null or v_qty <= 0 or v_price is null or v_price < 0 then
      raise exception 'Invalid cart line: %', v_item
        using errcode = '22023';
    end if;
    v_total := v_total + (v_qty * v_price);
  end loop;

  -- Caller-supplied total is accepted only if it matches.
  if p_total_amount is not null and abs(p_total_amount - v_total) > 0.01 then
    raise exception 'Total mismatch: client=%, server=%', p_total_amount, v_total
      using errcode = '22000';
  end if;

  insert into public.chit_authorization_requests
    (member_id, created_by, cart, total_amount, expires_at)
  values
    (p_member_id, v_caller, p_cart, v_total, v_expires)
  returning id, expires_at into v_id, v_expires;

  return query select v_id, v_expires;
end;
$$;

revoke all on function public.create_chit_authorization(uuid, jsonb, numeric)
  from public;
grant execute on function public.create_chit_authorization(uuid, jsonb, numeric)
  to authenticated;

-- 3.2 approve_chit_authorization — buyer-facing, called from the Edge
-- Function after the buyer's password has been verified. Stamps the row.
-- Marked SECURITY DEFINER so we can use auth.uid() inside the buyer's session
-- via the Edge Function's forwarded Authorization header.
create or replace function public.approve_chit_authorization(
  p_request_id uuid
)
returns table (
  request_id     uuid,
  status         text,
  member_id      uuid,
  cart           jsonb,
  total_amount   numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller  uuid := auth.uid();
  v_row     public.chit_authorization_requests%rowtype;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_row
    from public.chit_authorization_requests
   where id = p_request_id
   for update;
  if v_row.id is null then
    raise exception 'Authorization request not found' using errcode = 'P0002';
  end if;

  -- Buyer must be the member in the request.
  if not exists (
    select 1 from public.users
    where id = v_row.member_id and auth_id = v_caller and deleted_at is null
  ) then
    raise exception 'Forbidden: only the buyer can approve'
      using errcode = '42501';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'Authorization already %', v_row.status
      using errcode = 'P0001';
  end if;

  if v_row.expires_at < now() then
    update public.chit_authorization_requests
       set status = 'expired'
     where id = p_request_id;
    raise exception 'Authorization expired' using errcode = 'P0001';
  end if;

  update public.chit_authorization_requests
     set status         = 'authorized',
         authorized_at  = now(),
         authorized_via = 'buyer'
   where id = p_request_id
   returning * into v_row;

  perform public.log_audit_event(
    'sale.create',
    jsonb_build_object(
      'event',        'chit_authorization.buyer_approve',
      'request_id',   v_row.id,
      'member_id',    v_row.member_id,
      'total_amount', v_row.total_amount
    )
  );

  return query
    select v_row.id, v_row.status, v_row.member_id, v_row.cart, v_row.total_amount;
end;
$$;

revoke all on function public.approve_chit_authorization(uuid) from public;
grant execute on function public.approve_chit_authorization(uuid) to authenticated;

-- 3.3 reject_chit_authorization — buyer-facing.
create or replace function public.reject_chit_authorization(
  p_request_id uuid,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_row    public.chit_authorization_requests%rowtype;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_row
    from public.chit_authorization_requests
   where id = p_request_id
   for update;
  if v_row.id is null then
    raise exception 'Authorization request not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.users
    where id = v_row.member_id and auth_id = v_caller and deleted_at is null
  ) then
    raise exception 'Forbidden: only the buyer can reject'
      using errcode = '42501';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'Authorization already %', v_row.status
      using errcode = 'P0001';
  end if;

  update public.chit_authorization_requests
     set status           = 'rejected',
         rejection_reason = p_reason
   where id = p_request_id;
end;
$$;

revoke all on function public.reject_chit_authorization(uuid, text) from public;
grant execute on function public.reject_chit_authorization(uuid, text) to authenticated;

-- 3.4 manual_override_chit_authorization — barman-facing fallback.
-- Verifies the member's password via the auth schema's bcrypt hash. Supabase
-- does not expose the bcrypt hash to plpgsql, so this RPC expects the
-- Edge Function to have already verified the password. The RPC only stamps
-- the row. We do still gate it to staff.
create or replace function public.manual_override_chit_authorization(
  p_request_id uuid
)
returns table (
  request_id     uuid,
  status         text,
  member_id      uuid,
  cart           jsonb,
  total_amount   numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role   text;
  v_row    public.chit_authorization_requests%rowtype;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select r.code into v_role
    from public.users u
    join public.roles r on r.id = u.role_id
   where u.auth_id = v_caller
     and u.deleted_at is null and u.is_active = true;
  if v_role is null or v_role not in ('administrator','treasurer','barman') then
    raise exception 'Forbidden: only staff can override a CHIT sale'
      using errcode = '42501';
  end if;

  select * into v_row
    from public.chit_authorization_requests
   where id = p_request_id
   for update;
  if v_row.id is null then
    raise exception 'Authorization request not found' using errcode = 'P0002';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'Authorization already %', v_row.status
      using errcode = 'P0001';
  end if;

  update public.chit_authorization_requests
     set status         = 'manual_override',
         authorized_at  = now(),
         authorized_via = 'manual_override'
   where id = p_request_id
   returning * into v_row;

  perform public.log_audit_event(
    'sale.create',
    jsonb_build_object(
      'event',      'chit_authorization.manual_override',
      'request_id', v_row.id,
      'member_id',  v_row.member_id,
      'actor',      v_caller
    )
  );

  return query
    select v_row.id, v_row.status, v_row.member_id, v_row.cart, v_row.total_amount;
end;
$$;

revoke all on function public.manual_override_chit_authorization(uuid) from public;
grant execute on function public.manual_override_chit_authorization(uuid)
  to authenticated;

-- 3.5 cancel_chit_authorization — barman-facing.
create or replace function public.cancel_chit_authorization(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role   text;
  v_row    public.chit_authorization_requests%rowtype;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select r.code into v_role
    from public.users u
    join public.roles r on r.id = u.role_id
   where u.auth_id = v_caller
     and u.deleted_at is null and u.is_active = true;
  if v_role is null or v_role not in ('administrator','treasurer','barman') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select * into v_row
    from public.chit_authorization_requests
   where id = p_request_id
   for update;

  if v_row.id is null then
    raise exception 'Authorization request not found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'Authorization already %', v_row.status
      using errcode = 'P0001';
  end if;

  update public.chit_authorization_requests
     set status = 'cancelled'
   where id = p_request_id;
end;
$$;

revoke all on function public.cancel_chit_authorization(uuid) from public;
grant execute on function public.cancel_chit_authorization(uuid) to authenticated;

-- 3.6 finalize_chit_authorization — POS-facing. Atomically runs create_sale()
-- and flips the request to 'consumed'. Idempotent on request_id.
create or replace function public.finalize_chit_authorization(p_request_id uuid)
returns table (
  sale_id      uuid,
  total_amount numeric,
  request_id   uuid,
  status       text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role   text;
  v_row    public.chit_authorization_requests%rowtype;
  v_sale_id uuid;
  v_total  numeric(12,2);
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select r.code into v_role
    from public.users u
    join public.roles r on r.id = u.role_id
   where u.auth_id = v_caller
     and u.deleted_at is null and u.is_active = true;
  if v_role is null or v_role not in ('administrator','treasurer','barman') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select * into v_row
    from public.chit_authorization_requests
   where id = p_request_id
   for update;
  if v_row.id is null then
    raise exception 'Authorization request not found' using errcode = 'P0002';
  end if;

  -- Idempotency — already consumed.
  if v_row.status = 'consumed' then
    return query
      select v_row.consumed_sale_id, v_row.total_amount, v_row.id, v_row.status;
    return;
  end if;

  if v_row.status not in ('authorized','manual_override') then
    raise exception 'Authorization not in a finalizable state: %', v_row.status
      using errcode = 'P0001';
  end if;

  -- Run the existing atomic create_sale with the same barman & member.
  select sale_id, total_amount
    into v_sale_id, v_total
    from public.create_sale(
      'chit',
      v_row.member_id,
      v_row.cart,
      'CHIT authorized via ' || v_row.authorized_via
    );

  update public.chit_authorization_requests
     set status           = 'consumed',
         consumed_sale_id = v_sale_id
   where id = p_request_id;

  return query select v_sale_id, v_total, p_request_id, 'consumed';
end;
$$;

revoke all on function public.finalize_chit_authorization(uuid) from public;
grant execute on function public.finalize_chit_authorization(uuid) to authenticated;

-- 3.7 expire_chit_authorizations — pg_cron job helper. Safe to call as anon
-- because it only ever narrows the row to status='expired'.
create or replace function public.expire_chit_authorizations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.chit_authorization_requests
     set status = 'expired'
   where status = 'pending'
     and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_chit_authorizations() from public;

-- ---------------------------------------------------------------------------
-- 4. Realtime
-- ---------------------------------------------------------------------------

-- Add the table to the supabase_realtime publication so the POS and the
-- member portal can subscribe to row updates.
do $$
begin
  -- Supabase exposes the publication as 'supabase_realtime'.
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    -- Idempotent: skip if already added.
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'chit_authorization_requests'
    ) then
      alter publication supabase_realtime
        add table public.chit_authorization_requests;
    end if;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Sanity check
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_proc
    where proname = 'create_chit_authorization'
      and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'create_chit_authorization() missing';
  end if;
  if not exists (
    select 1 from pg_proc
    where proname = 'finalize_chit_authorization'
      and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'finalize_chit_authorization() missing';
  end if;
  raise notice 'chit_authorization_requests installed — member-side CHIT authorization is live';
end
$$;
