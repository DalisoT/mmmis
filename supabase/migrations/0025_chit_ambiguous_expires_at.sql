-- =============================================================================
-- 0025 — Fix ambiguous `expires_at` in create_chit_authorization
--
-- Migration 0022 declared the function as RETURNS TABLE (request_id uuid,
-- expires_at timestamptz). That implicitly creates OUT parameters named
-- `request_id` and `expires_at` inside the function body. The INSERT in
-- line 188 used:
--
--   returning id, expires_at into v_id, v_expires;
--
-- With both the OUT parameter and the table column visible, PostgreSQL
-- raises 42702 "column reference 'expires_at' is ambiguous" the moment
-- the RPC is called. The frontend was seeing this as a toast:
--   "Could not begin CHIT checkout: column reference 'expires_at' is
--    ambiguous [42702]"
--
-- The fix:
--   1. PostgreSQL `INSERT` does not support a table alias in the form
--      `insert into ... tbl_alias`. We instead qualify the RETURNING
--      columns with the schema-qualified table name
--      (`public.chit_authorization_requests.expires_at`) so the OUT
--      parameter of the same name is no longer a candidate.
--   2. Rename the local variable from `v_expires` to `v_expires_at` so
--      it cannot shadow the OUT column name in any subsequent `select`.
--
-- Idempotent: re-running this migration just replaces the function body.
-- =============================================================================

set search_path = public;

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
  v_expires_at   timestamptz := now() + interval '5 minutes';
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

  -- Insert + capture the freshly-stamped expires_at.
  -- The INSERT target has no alias — PostgreSQL does not allow
  -- `insert into ... tbl_alias`. We instead fully qualify the
  -- RETURNING columns with the schema-qualified table name so the
  -- OUT parameter `expires_at` is no longer a candidate and the
  -- SQL parser stops raising 42702.
  insert into public.chit_authorization_requests
    (member_id, created_by, cart, total_amount, expires_at)
  values
    (p_member_id, v_caller, p_cart, v_total, v_expires_at)
  returning public.chit_authorization_requests.id,
            public.chit_authorization_requests.expires_at
     into v_id, v_expires_at;

  return query select v_id, v_expires_at;
end;
$$;

revoke all on function public.create_chit_authorization(uuid, jsonb, numeric)
  from public;
grant execute on function public.create_chit_authorization(uuid, jsonb, numeric)
  to authenticated;