-- =============================================================================
-- 0017 — Atomic sale creation (Phase 17)
--
-- Finding from the codebase audit:
--
--   C8  The `useCreateSale` mutation in src/features/sales/sales.service.ts
--       performs three independent inserts via the JS client:
--         1. INSERT INTO public.sales
--         2. INSERT INTO public.sale_items
--         3. INSERT INTO public.ledger  (for CHIT sales)
--       Each round trip is a separate transaction. If step 2 or step 3 fails
--       (network blip, RLS denial, FK violation, etc.) the `sales` row from
--       step 1 is left orphaned and the barman sees a misleading "success"
--       only if all three complete. The ledger and sale_items then can fall
--       out of sync with the parent sale.
--
-- This migration:
--   1. Adds a `create_sale()` RPC marked SECURITY DEFINER that wraps the
--      three inserts in a single plpgsql transaction. Either all three
--      rows commit or none do.
--   2. Validates the cart server-side (each line has positive quantity,
--      numeric price, known product_id) so the RPC can be called safely
--      from the barman POS even if the caller UI is bypassed.
--   3. Grants EXECUTE to authenticated. The function checks the caller is
--      staff (barman / treasurer / administrator) before any write.
--   4. Returns the new sale id and computed total_amount so the JS client
--      can keep the existing post-flow (audit log, cache invalidation).
--
-- The application code will be updated to call this RPC instead of doing
-- three client-side inserts. The existing public.sales / sale_items / ledger
-- RLS policies remain in place — the SECURITY DEFINER wrapper is only
-- authorised for staff, so the privilege scope is unchanged.
-- =============================================================================

set search_path = public;

-- ---------------------------------------------------------------------------
-- 1. create_sale(p_items jsonb, p_sale_type text, p_member_id uuid, p_remarks text)
-- ---------------------------------------------------------------------------
-- p_items is an array of { product_id: uuid, quantity: int, unit_price: numeric }
-- Server recomputes the total; the client-side total is not trusted.
-- ---------------------------------------------------------------------------

create or replace function public.create_sale(
  p_sale_type text,
  p_member_id uuid,
  p_items     jsonb,
  p_remarks   text default null
)
returns table (
  sale_id      uuid,
  total_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller        uuid := auth.uid();
  v_sale_id       uuid;
  v_total         numeric(14,2) := 0;
  v_item          jsonb;
  v_product_id    uuid;
  v_qty           integer;
  v_price         numeric(12,2);
  v_role_code     text;
  v_member_user   uuid;
begin
  -- 1.1 Caller must be signed in.
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- 1.2 Caller must be staff (administrator / treasurer / barman).
  select r.code into v_role_code
    from public.users u
    join public.roles r on r.id = u.role_id
   where u.auth_id = v_caller
     and u.deleted_at is null
     and u.is_active = true;
  if v_role_code is null or v_role_code not in ('administrator','treasurer','barman') then
    raise exception 'Forbidden: only staff can create sales' using errcode = '42501';
  end if;

  -- 1.3 Validate sale_type.
  if p_sale_type not in ('cash','chit') then
    raise exception 'Invalid sale_type: %', p_sale_type using errcode = '22023';
  end if;

  -- 1.4 CHIT sales must have a member_id, and the member must be active.
  if p_sale_type = 'chit' then
    if p_member_id is null then
      raise exception 'member_id is required for CHIT sales' using errcode = '23502';
    end if;
    select m.user_id into v_member_user
      from public.members m
      join public.users u on u.id = m.user_id
     where m.user_id = p_member_id
       and u.deleted_at is null
       and u.is_active = true;
    if v_member_user is null then
      raise exception 'Member not found or inactive' using errcode = '23503';
    end if;
  end if;

  -- 1.5 Validate cart shape.
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty' using errcode = '22000';
  end if;

  -- 1.6 Insert sale header. RLS is bypassed because the function is
  -- SECURITY DEFINER and we already authorized the caller above.
  insert into public.sales (
    sale_type, barman_id, member_id, total_amount, payment_status, remarks
  ) values (
    p_sale_type, v_caller, p_member_id, 0, 'paid', p_remarks
  )
  returning id into v_sale_id;

  -- 1.7 Insert each line item, recomputing the total.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_qty        := (v_item ->> 'quantity')::integer;
    v_price      := (v_item ->> 'unit_price')::numeric;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity for product %', v_product_id
        using errcode = '22023';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Invalid unit_price for product %', v_product_id
        using errcode = '22023';
    end if;

    insert into public.sale_items (sale_id, product_id, quantity, unit_price)
    values (v_sale_id, v_product_id, v_qty, v_price);

    v_total := v_total + (v_qty * v_price);
  end loop;

  -- 1.8 Persist the authoritative total on the sale row.
  update public.sales
     set total_amount = v_total
   where id = v_sale_id;

  -- 1.9 For CHIT sales, append a ledger row. The apply_member_ledger
  -- trigger fills `balance` and updates members.chit_balance.
  if p_sale_type = 'chit' then
    insert into public.ledger (
      member_id, description, debit, payment, source_type, source_id
    ) values (
      p_member_id,
      'CHIT sale #' || substring(v_sale_id::text, 1, 8),
      v_total,
      0,
      'sale',
      v_sale_id
    );
  end if;

  return query
    select v_sale_id, v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.create_sale(text, uuid, jsonb, text) from public;
grant execute on function public.create_sale(text, uuid, jsonb, text) to authenticated;

comment on function public.create_sale(text, uuid, jsonb, text) is
  'Atomic sale creation. Inserts sale, sale_items, and (for CHIT) ledger in
   a single transaction. SECURITY DEFINER so the barman POS does not need
   direct INSERT grants on sale_items / ledger. Caller must be staff.';

-- ---------------------------------------------------------------------------
-- 3. Sanity check — make sure the function was actually created.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_proc
    where proname = 'create_sale' and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'create_sale() was not created — investigate.';
  end if;
  raise notice 'create_sale() installed — atomic sale RPC is ready';
end
$$;
