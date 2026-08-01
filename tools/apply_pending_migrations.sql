-- =============================================================================
-- tools/apply_pending_migrations.sql
-- -----------------------------------------------------------------------------
-- Applies migrations 0028 (CHIT expiry cron) and 0029 (create_sale product
-- validation) to the live database. Both migrations are idempotent — they
-- drop-and-recreate (cron job) or create-or-replace (function) — so this
-- script is safe to re-run.
--
-- CONTEXT — these were documented as "deferred to operator action" in
-- CONTINUE_HERE.md. Without them:
--   * 0028: chit_authorization_requests rows with status='pending' whose
--     expires_at has passed never get flipped to 'expired' (the function is
--     defined but never scheduled).
--   * 0029: create_sale() doesn't reject carts that reference soft-deleted
--     or inactive products, so discontinued SKUs can still be sold.
--
-- RUN: Supabase dashboard → SQL editor → paste this file → Run.
-- VERIFY: scroll to the bottom — each step raises a NOTICE on success.
-- =============================================================================

-- NOTE: This script is intended for the Supabase SQL editor, which speaks
-- plain PostgreSQL via pg_query. psql meta-commands like \set ON_ERROR_STOP
-- are NOT supported — if you adapt this for psql, add \set ON_ERROR_STOP on
-- at the top.

-- Re-apply migration 0028. This block is a verbatim copy of
-- supabase/migrations/0028_chit_expiry_cron.sql so it can be run without
-- requiring the CLI / migration runner. Keep them in sync if you change one.
set search_path = public;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron extension not installed — skipping schedule. Install pg_cron (Database → Extensions) and re-run this script to enable.';
    return;
  end if;

  perform cron.unschedule('expire-chit-authorizations')
    where exists (
      select 1 from cron.job where jobname = 'expire-chit-authorizations'
    );

  perform cron.schedule(
    'expire-chit-authorizations',
    '* * * * *',
    $job$ select public.expire_chit_authorizations(); $job$
  );

  raise notice '0028 applied — expire_chit_authorizations() now runs every minute';
end
$$;

-- Re-apply migration 0029. Same approach: include the body inline so a
-- single SQL editor paste is enough. create or replace handles re-runs.
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
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select u.id, r.code into v_caller_public, v_role_code
    from public.users u
    join public.roles r on r.id = u.role_id
   where u.auth_id = v_caller
     and u.deleted_at is null
     and u.is_active = true;
  if v_caller_public is null or v_role_code not in ('administrator','treasurer','barman') then
    raise exception 'Forbidden: only staff can create sales' using errcode = '42501';
  end if;

  if p_sale_type not in ('cash','chit') then
    raise exception 'Invalid sale_type: %', p_sale_type using errcode = '22023';
  end if;

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

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty' using errcode = '22000';
  end if;

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

  insert into public.sales (
    sale_type, barman_id, member_id, total_amount, payment_status, remarks
  ) values (
    p_sale_type, v_caller_public, p_member_id, 0, 'paid', p_remarks
  )
  returning id into v_sale_id;

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

  update public.sales
     set total_amount = v_total
   where id = v_sale_id;

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

revoke all on function public.create_sale(text, uuid, jsonb, text) from public;
grant execute on function public.create_sale(text, uuid, jsonb, text) to authenticated;

comment on function public.create_sale(text, uuid, jsonb, text) is
  'Atomic sale creation (0029). Inserts sale, sale_items, and (for CHIT) ledger
   in one transaction. SECURITY DEFINER so the barman POS does not need direct
   INSERT grants. Caller must be staff. Validates every cart product_id against
   public.products (missing / soft-deleted / inactive SKUs are rejected with
   errcode 23503).';

do $$ begin raise notice '0029 applied — create_sale() now validates products exist and are active'; end $$;

-- =============================================================================
-- Verification block — re-runs are safe; this just reads state and NOTICEs it.
-- =============================================================================

do $$
declare
  v_cron_count   int;
  v_function_oid  oid;
  v_comment_ok   boolean;
begin
  -- 0028
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select count(*) into v_cron_count
      from cron.job
     where jobname = 'expire-chit-authorizations';
    if v_cron_count = 1 then
      raise notice 'VERIFY 0028 OK — cron.job has 1 row for expire-chit-authorizations';
    else
      raise notice 'VERIFY 0028 FAIL — expected 1 cron.job row, got %', v_cron_count;
    end if;
  else
    raise notice 'VERIFY 0028 SKIPPED — pg_cron not installed';
  end if;

  -- 0029
  select oid into v_function_oid
    from pg_proc
   where proname = 'create_sale'
     and pronamespace = 'public'::regnamespace;

  if v_function_oid is null then
    raise notice 'VERIFY 0029 FAIL — public.create_sale() does not exist';
  else
    select (description like '%0029%' or description like '%validates products exist and are active%')
      into v_comment_ok
      from pg_description
     where objoid = v_function_oid;
    if v_comment_ok then
      raise notice 'VERIFY 0029 OK — public.create_sale() is present and carries the 0029 comment';
    else
      raise notice 'VERIFY 0029 WARN — function exists but comment did not match expected 0029 text';
    end if;
  end if;
end
$$;
