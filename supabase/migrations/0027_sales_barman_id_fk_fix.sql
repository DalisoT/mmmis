-- =============================================================================
-- 0027 — Fix sales.barman_id FK violation in create_sale()
--
-- Symptom observed in the field:
--   "Finalize failed: insert or update on table "sales" violates foreign key
--    constraint "sales_barman_id_fkey""
--
-- Root cause:
--   create_sale() (introduced in 0017) computed
--
--       v_caller uuid := auth.uid();
--
--   and wrote `v_caller` into sales.barman_id. But:
--
--     * auth.uid()     returns auth.users.id
--     * sales.barman_id  is uuid NOT NULL REFERENCES public.users(id)
--
--   These are two different UUIDs for the same person. For the FK to succeed
--   we need to translate auth.uid() -> public.users.id before the INSERT.
--
--   Note the original schema author *did* know the distinction — see
--   chit_authorization_requests.created_by (0022:40) which correctly
--   references auth.users(id) and is documented as "barman auth_id". The
--   sales table went the other way (public.users(id)) and the RPC was
--   never updated to match.
--
-- Why it surfaced now (and not when 0017 was first deployed):
--   Before 0026, finalize_chit_authorization() raised 42702 "sale_id is
--   ambiguous" the moment the RPC was invoked — it never reached the inner
--   create_sale() call. With 0026 disambiguating the OUT parameters, the
--   INSERT into public.sales now actually fires and the FK is enforced.
--   Cash sales from the barman POS would also hit this; the field report
--   here is the first observed reproduction.
--
-- Fix:
--   Re-define create_sale() to resolve v_caller_auth (auth.uid()) to
--   v_caller_public (public.users.id) via the same auth_id lookup the role
--   check already performs, then write v_caller_public to barman_id. The
--   role check itself is unchanged — auth_id remains the lookup key.
--
--   finalize_chit_authorization() does not need to change: it only forwards
--   its caller into create_sale() via auth.uid(), so fixing create_sale()
--   is sufficient. The authorize-side call paths (chit-authorize Edge
--   Function, SPA AuthorizeChitPage) are unaffected — they don't write
--   to sales.
--
-- Idempotent: create or replace. No data migration needed — any prior
-- cash/CHIT sale that should have succeeded under this FK either:
--   (a) was inserted under a different code path we haven't found, in
--       which case this migration brings create_sale() into line with that
--       path, or
--   (b) didn't exist (every INSERT would have failed the FK). The field
--       reports match (b).
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

  -- 1.6 Insert sale header. RLS is bypassed because the function is
  -- SECURITY DEFINER and we already authorized the caller above.
  -- barman_id takes public.users.id (v_caller_public), NOT auth.uid().
  insert into public.sales (
    sale_type, barman_id, member_id, total_amount, payment_status, remarks
  ) values (
    p_sale_type, v_caller_public, p_member_id, 0, 'paid', p_remarks
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

-- Privileges are unchanged from 0017 — re-affirm for clarity.
revoke all on function public.create_sale(text, uuid, jsonb, text) from public;
grant execute on function public.create_sale(text, uuid, jsonb, text) to authenticated;

comment on function public.create_sale(text, uuid, jsonb, text) is
  'Atomic sale creation. Inserts sale, sale_items, and (for CHIT) ledger in
   a single transaction. SECURITY DEFINER so the barman POS does not need
   direct INSERT grants on sale_items / ledger. Caller must be staff.
   v_caller (auth.uid()) is translated to public.users.id before being
   written to sales.barman_id so the FK sales_barman_id_fkey is satisfied.';

-- Sanity check — make sure the function was actually re-created.
do $$
begin
  if not exists (
    select 1 from pg_proc
    where proname = 'create_sale' and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'create_sale() was not created — investigate.';
  end if;
  raise notice '0027 installed — create_sale() now writes public.users.id to sales.barman_id';
end
$$;