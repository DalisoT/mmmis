-- =============================================================================
-- 0029 — Validate products in create_sale() cart
--
-- create_sale() (0017) validates cart shape (positive quantity, numeric
-- price, non-empty array) but does not check that the product_id values
-- actually resolve to rows in public.products. Combined with the FK on
-- sale_items.product_id (-> public.products.id), the INSERT would raise
-- 23503, but only after we'd already inserted the sales header row and
-- started inserting line items. That partial failure left orphaned sale
-- rows (or half-complete sales) until 0017's atomicity guarantee kicked
-- in. Worse, soft-deleted products (deleted_at IS NOT NULL) or inactive
-- products (status='inactive') pass the FK check because the row still
-- exists -- so a barman could still sell against a discontinued SKU.
--
-- Fix: add an upfront validation step in create_sale() that gathers all
-- referenced product_ids into a single query and rejects the call if any
-- are missing, soft-deleted, or inactive. Re-raise with errcode 23503 so
-- the SPA sees the same code it would have seen for the FK violation,
-- and include the offending product_id(s) in the message for triage.
--
-- Idempotent: create or replace.
-- =============================================================================

set search_path = public;

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
  v_caller          uuid := auth.uid();
  v_caller_public   uuid;
  v_sale_id         uuid;
  v_total           numeric(14,2) := 0;
  v_item            jsonb;
  v_product_id      uuid;
  v_qty             integer;
  v_price           numeric(12,2);
  v_role_code       text;
  v_member_user     uuid;
  v_product_ids     uuid[];
  v_bad_ids         uuid[];
begin
  -- 1.1 Caller must be signed in.
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- 1.2 Caller must be staff (administrator / treasurer / barman).
  --     Also resolves v_caller_public (public.users.id) for the sales FK.
  select u.id, r.code into v_caller_public, v_role_code
    from public.users u
    join public.roles r on r.id = u.role_id
   where u.auth_id = v_caller
     and u.deleted_at is null
     and u.is_active = true;
  if v_caller_public is null or v_role_code not in ('administrator','treasurer','barman') then
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

  -- 1.6 (new in 0029) Validate every product_id resolves to a live product.
  --     Rejects cart lines that reference a missing, soft-deleted, or
  --     inactive SKU before any INSERT fires. Without this the FK on
  --     sale_items.product_id would catch missing ids but only after the
  --     sales header had been written, leaving an inconsistent state on
  --     partial failure (the 0017 atomicity guarantee would roll back,
  --     but with a less helpful error).
  select array_agg(distinct (item ->> 'product_id')::uuid)
    into v_product_ids
    from jsonb_array_elements(p_items) as item;

  select array_agg(p.id)
    into v_bad_ids
    from unnest(v_product_ids) as pid
    left join public.products p
      on p.id = pid
     and p.deleted_at is null
     and p.status = 'active'
   where p.id is null;

  if v_bad_ids is not null then
    raise exception 'Invalid products in cart: %', v_bad_ids
      using errcode = '23503';
  end if;

  -- 1.7 Insert sale header. RLS is bypassed because the function is
  -- SECURITY DEFINER and we already authorized the caller above.
  -- barman_id takes public.users.id (v_caller_public), NOT auth.uid().
  insert into public.sales (
    sale_type, barman_id, member_id, total_amount, payment_status, remarks
  ) values (
    p_sale_type, v_caller_public, p_member_id, 0, 'paid', p_remarks
  )
  returning id into v_sale_id;

  -- 1.8 Insert each line item, recomputing the total.
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

  -- 1.9 Persist the authoritative total on the sale row.
  update public.sales
     set total_amount = v_total
   where id = v_sale_id;

  -- 1.10 For CHIT sales, append a ledger row. The apply_member_ledger
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

-- Privileges unchanged from 0017/0027 — re-affirm for clarity.
revoke all on function public.create_sale(text, uuid, jsonb, text) from public;
grant execute on function public.create_sale(text, uuid, jsonb, text) to authenticated;

comment on function public.create_sale(text, uuid, jsonb, text) is
  'Atomic sale creation. Inserts sale, sale_items, and (for CHIT) ledger in
   a single transaction. SECURITY DEFINER so the barman POS does not need
   direct INSERT grants on sale_items / ledger. Caller must be staff.
   v_caller (auth.uid()) is translated to public.users.id before being
   written to sales.barman_id so the FK sales_barman_id_fkey is satisfied.
   Since 0029 the cart is also validated against public.products: missing,
   soft-deleted (deleted_at), or inactive (status<>'active') SKUs are
   rejected with errcode 23503 before any INSERT fires.';

-- Sanity check — make sure the function was actually re-created.
do $$
begin
  if not exists (
    select 1 from pg_proc
    where proname = 'create_sale' and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'create_sale() was not created — investigate.';
  end if;
  raise notice '0029 installed — create_sale() now validates products exist and are active';
end
$$;