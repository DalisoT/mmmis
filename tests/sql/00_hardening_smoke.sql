-- =============================================================================
-- MMMIS hardening batch smoke tests (migrations 0027 / 0028 / 0029)
--
-- Run this in the Supabase SQL Editor after applying 0028 + 0029.
--
-- All output is emitted via `raise notice` from inside `do $$ ... $$` blocks.
-- The Supabase SQL Editor surfaces those notices in the **Messages** tab
-- (always visible, top-to-bottom, in execution order). The result-grid
-- rows that come back from `select ...` are unreliable in multi-statement
-- scripts because the editor only shows the last few, so this script avoids
-- `select '...' as banner;` entirely.
--
-- IMPORTANT:
--   * You must be signed in as a STAFF user (administrator / treasurer /
--     barman) for create_sale() tests. Otherwise every create_sale() call
--     will return SKIP. The Supabase SQL Editor runs as the service role
--     and bypasses auth.uid(), so create_sale()'s SECURITY DEFINER check
--     will see auth.uid() IS NULL and SKIP cleanly.
--     To actually exercise create_sale(), run from a psql session
--     authenticated as a staff JWT.
--
--   * Block 2 inserts a fake stale pending row. The cleanup block does NOT
--     remove it (you want to verify pg_cron flipped it to 'expired').
--     Delete manually when done:
--         delete from chit_authorization_requests where status = 'pending';
--
--   * Block 3c flips one product to status='inactive' and restores it.
-- =============================================================================

do $$
begin
  raise notice '=== MMMIS hardening smoke tests ===';
  raise notice 'Run this after applying migrations 0028 and 0029.';
  raise notice '';
end $$;

-- ---------------------------------------------------------------------------
-- Block 1 — Verify the migrations are actually installed
-- ---------------------------------------------------------------------------

do $$
declare
  v_has_cron      boolean;
  v_has_schedule  boolean;
  v_has_create    boolean;
  v_create_args   text;
begin
  raise notice '--- Block 1: installation checks ---';

  -- pg_cron is OPTIONAL on Supabase plans. 0028 was written to degrade
  -- gracefully if it isn't installed, but this test script must NOT touch
  -- the cron.* schema when the extension is missing (it'd raise 42P01).
  select exists (select 1 from pg_extension where extname = 'pg_cron')
    into v_has_cron;

  if v_has_cron then
    select exists (
      select 1 from cron.job where jobname = 'expire-chit-authorizations'
    ) into v_has_schedule;
  else
    v_has_schedule := null;
  end if;

  select exists (
    select 1 from pg_proc
     where proname = 'create_sale'
       and pronamespace = 'public'::regnamespace
  ) into v_has_create;

  select pg_get_function_identity_arguments(p.oid)
    into v_create_args
    from pg_proc p
   where p.proname = 'create_sale'
     and p.pronamespace = 'public'::regnamespace
   limit 1;

  raise notice '  pg_cron installed: %', coalesce(v_has_cron::text, 'false');
  raise notice '  cron.job expire-chit-authorizations present: %',
    case
      when not v_has_cron  then 'N/A (pg_cron not installed)'
      when v_has_schedule  then 'true'
      else                       'false'
    end;
  raise notice '  public.create_sale() present: %', v_has_create;
  raise notice '  public.create_sale() signature: create_sale(%)', v_create_args;

  if not v_has_create then
    raise notice 'FAIL 1: create_sale() not found -- 0029 not applied';
  elsif v_has_cron is null or not v_has_cron then
    raise notice 'NOTE 1: pg_cron not installed -- 0028 cannot schedule expire_chit_authorizations()';
    raise notice '         pending CHIT rows will accumulate forever. Either enable pg_cron on the';
    raise notice '         Supabase plan and re-run 0028, OR invoke expire_chit_authorizations()';
    raise notice '         from an external scheduler (cron, GitHub Actions, etc.).';
    if v_has_create then
      raise notice 'PASS 1: 0029 installed (product validation)';
    end if;
  elsif v_has_cron and not coalesce(v_has_schedule, false) then
    raise notice 'FAIL 1: pg_cron present but expire-chit-authorizations job missing -- re-run 0028';
  else
    raise notice 'PASS 1: migrations 0028 and 0029 installed';
  end if;
  raise notice '';
end $$;

-- ---------------------------------------------------------------------------
-- Block 2 — 0028: pg_cron expiry (DESTRUCTIVE: inserts a fake stale row)
-- ---------------------------------------------------------------------------

do $$
declare
  v_member_user  uuid;
  v_barman_auth  uuid;
  v_barman_pub   uuid;
  v_request_id   uuid;
begin
  raise notice '--- Block 2: pg_cron expiry (0028) -- DESTRUCTIVE ---';

  select m.user_id into v_member_user
    from public.members m
    join public.users u on u.id = m.user_id
   where u.deleted_at is null and u.is_active = true
   limit 1;

  select u.auth_id, u.id into v_barman_auth, v_barman_pub
    from public.users u
    join public.roles r on r.id = u.role_id
   where r.code = 'barman'
     and u.deleted_at is null
     and u.is_active = true
   limit 1;

  if v_member_user is null or v_barman_auth is null then
    raise notice 'SKIP 2: no active member or barman found -- seed first';
    raise notice '';
    return;
  end if;

  begin
    insert into public.chit_authorization_requests (
      member_id, created_by, cart, total_amount, status, expires_at
    ) values (
      v_member_user, v_barman_auth, '[]'::jsonb, 1.00, 'pending',
      now() - interval '6 minutes'
    )
    returning id into v_request_id;
  exception when others then
    raise notice 'FAIL 2: insert into chit_authorization_requests failed -- %: %', sqlstate, sqlerrm;
    raise notice '       (RLS may be blocking the service-role insert. Check policies on this table.)';
    raise notice '';
    return;
  end;

  raise notice 'Inserted stale pending request % (expires_at = 6 min ago)', v_request_id;
  raise notice 'After 60-90s, run manually:';
  raise notice '  select id, status, expires_at from public.chit_authorization_requests where id = ''%'';', v_request_id;
  raise notice 'Expect: status = ''expired''. If still ''pending'' after 90s, pg_cron is not firing.';
  raise notice '';
end $$;

-- ---------------------------------------------------------------------------
-- Block 3 — 0029: create_sale() rejects bad product_id
-- Each subtest catches its own exception so a FAIL does not abort the rest.
-- All subtests use auth.uid() to decide SKIP -- service-role sessions will
-- typically see auth.uid() = NULL and skip the create_sale() calls entirely.
-- ---------------------------------------------------------------------------

do $$
begin
  raise notice '--- Block 3: create_sale() product validation (0029) ---';
  raise notice '';
end $$;

-- 3a. Missing product_id.
do $$
declare
  v_role text;
begin
  raise notice '--- 3a: missing product_id should fail with 23503 ---';

  select r.code into v_role
    from public.users u join public.roles r on r.id = u.role_id
   where u.auth_id = auth.uid();
  if v_role is null or v_role not in ('administrator','treasurer','barman') then
    raise notice 'SKIP 3a: caller is not staff (role=%, auth.uid()=%)', v_role, auth.uid();
    raise notice '';
    return;
  end if;

  begin
    perform public.create_sale(
      p_sale_type := 'cash',
      p_member_id := null,
      p_items     := jsonb_build_array(
        jsonb_build_object(
          'product_id', gen_random_uuid(),
          'quantity',   1,
          'unit_price', 1.00
        )
      ),
      p_remarks   := 'mmmis-test-3a-missing'
    );
    raise notice 'FAIL 3a: create_sale() accepted a missing product_id';
  exception
    when sqlstate '23503' then
      raise notice 'PASS 3a: create_sale() rejected missing product_id (23503)';
    when others then
      raise notice 'FAIL 3a: unexpected error %: %', sqlstate, sqlerrm;
  end;
  raise notice '';
end $$;

-- 3b. Soft-deleted product.
do $$
declare
  v_role  text;
  v_pid   uuid;
begin
  raise notice '--- 3b: soft-deleted product should fail with 23503 ---';

  select r.code into v_role
    from public.users u join public.roles r on r.id = u.role_id
   where u.auth_id = auth.uid();
  if v_role is null or v_role not in ('administrator','treasurer','barman') then
    raise notice 'SKIP 3b: caller is not staff';
    raise notice '';
    return;
  end if;

  select id into v_pid
    from public.products
   where deleted_at is not null
   limit 1;

  if v_pid is null then
    select id into v_pid
      from public.products
     where deleted_at is null
     limit 1;
    if v_pid is null then
      raise notice 'SKIP 3b: no products rows to test';
      raise notice '';
      return;
    end if;
    update public.products set deleted_at = now() where id = v_pid;
    raise notice '  Temporarily soft-deleted product %', v_pid;
  end if;

  begin
    perform public.create_sale(
      p_sale_type := 'cash',
      p_member_id := null,
      p_items     := jsonb_build_array(
        jsonb_build_object('product_id', v_pid, 'quantity', 1, 'unit_price', 1.00)
      ),
      p_remarks   := 'mmmis-test-3b-softdeleted'
    );
    raise notice 'FAIL 3b: create_sale() accepted a soft-deleted product';
  exception
    when sqlstate '23503' then
      raise notice 'PASS 3b: create_sale() rejected soft-deleted product (23503)';
    when others then
      raise notice 'FAIL 3b: unexpected error %: %', sqlstate, sqlerrm;
  end;
  raise notice '';
end $$;

-- 3c. Inactive product (status != 'active').
do $$
declare
  v_role text;
  v_pid  uuid;
  v_prev text;
begin
  raise notice '--- 3c: status=inactive product should fail with 23503 ---';

  select r.code into v_role
    from public.users u join public.roles r on r.id = u.role_id
   where u.auth_id = auth.uid();
  if v_role is null or v_role not in ('administrator','treasurer','barman') then
    raise notice 'SKIP 3c: caller is not staff';
    raise notice '';
    return;
  end if;

  select id, status into v_pid, v_prev
    from public.products
   where deleted_at is null
   limit 1;
  if v_pid is null then
    raise notice 'SKIP 3c: no products to flip';
    raise notice '';
    return;
  end if;

  update public.products set status = 'inactive' where id = v_pid;

  begin
    perform public.create_sale(
      p_sale_type := 'cash',
      p_member_id := null,
      p_items     := jsonb_build_array(
        jsonb_build_object('product_id', v_pid, 'quantity', 1, 'unit_price', 1.00)
      ),
      p_remarks   := 'mmmis-test-3c-inactive'
    );
    raise notice 'FAIL 3c: create_sale() accepted an inactive product';
  exception
    when sqlstate '23503' then
      raise notice 'PASS 3c: create_sale() rejected inactive product (23503)';
    when others then
      raise notice 'FAIL 3c: unexpected error %: %', sqlstate, sqlerrm;
  end;

  update public.products set status = v_prev where id = v_pid;
  raise notice '  Restored product % status to %', v_pid, v_prev;
  raise notice '';
end $$;

-- 3d. Happy path: active, not soft-deleted product succeeds.
do $$
declare
  v_role    text;
  v_pid     uuid;
  v_price   numeric;
  v_sale_id uuid;
  v_total   numeric;
begin
  raise notice '--- 3d: active product should succeed ---';

  select r.code into v_role
    from public.users u join public.roles r on r.id = u.role_id
   where u.auth_id = auth.uid();
  if v_role is null or v_role not in ('administrator','treasurer','barman') then
    raise notice 'SKIP 3d: caller is not staff';
    raise notice '';
    return;
  end if;

  select id, coalesce(selling_price, 0) into v_pid, v_price
    from public.products
   where deleted_at is null and status = 'active'
   limit 1;
  if v_pid is null or v_price <= 0 then
    raise notice 'SKIP 3d: no active products with a price to sell';
    raise notice '';
    return;
  end if;

  begin
    select (cs).sale_id, (cs).total_amount
      into v_sale_id, v_total
      from public.create_sale(
        p_sale_type := 'cash',
        p_member_id := null,
        p_items     := jsonb_build_array(
          jsonb_build_object('product_id', v_pid, 'quantity', 1, 'unit_price', v_price)
        ),
        p_remarks   := 'mmmis-test-3d-happy'
      ) as cs;

    if v_sale_id is null then
      raise notice 'FAIL 3d: create_sale() returned no sale_id';
    else
      raise notice 'PASS 3d: created sale % total=%', v_sale_id, v_total;
      delete from public.sales where id = v_sale_id;
    end if;
  exception
    when others then
      raise notice 'FAIL 3d: unexpected error %: %', sqlstate, sqlerrm;
  end;
  raise notice '';
end $$;

-- ---------------------------------------------------------------------------
-- Block 4 — 0027: sales.barman_id FK
-- ---------------------------------------------------------------------------

do $$
declare
  v_role      text;
  v_caller_pub uuid;
  v_pid       uuid;
  v_price     numeric;
  v_sale_id   uuid;
begin
  raise notice '--- Block 4: sales.barman_id FK (0027) ---';

  select u.id, r.code into v_caller_pub, v_role
    from public.users u join public.roles r on r.id = u.role_id
   where u.auth_id = auth.uid()
     and u.deleted_at is null and u.is_active = true;
  if v_role is null or v_role not in ('administrator','treasurer','barman') then
    raise notice 'SKIP 4: caller is not staff';
    raise notice '';
    return;
  end if;

  select id, coalesce(selling_price, 0) into v_pid, v_price
    from public.products
   where deleted_at is null and status = 'active'
   limit 1;
  if v_pid is null or v_price <= 0 then
    raise notice 'SKIP 4: no active products with a price to sell';
    raise notice '';
    return;
  end if;

  begin
    select (cs).sale_id into v_sale_id
      from public.create_sale(
        p_sale_type := 'cash',
        p_member_id := null,
        p_items     := jsonb_build_array(
          jsonb_build_object('product_id', v_pid, 'quantity', 1, 'unit_price', v_price)
        ),
        p_remarks   := 'mmmis-test-4-fk'
      ) as cs;

    perform 1 from public.sales
     where id = v_sale_id and barman_id = v_caller_pub;
    if not found then
      raise notice 'FAIL 4: sales row % has wrong barman_id (caller_pub was %)', v_sale_id, v_caller_pub;
    else
      raise notice 'PASS 4: sales.barman_id = public.users.id (%)', v_caller_pub;
    end if;
    delete from public.sales where id = v_sale_id;
  exception
    when others then
      raise notice 'FAIL 4: unexpected error %: %', sqlstate, sqlerrm;
  end;
  raise notice '';
end $$;

-- ---------------------------------------------------------------------------
-- Block 5 — Cleanup: un-soft-delete anything we flipped within the last 5 min
-- (does NOT remove the Block 2 stale pending row -- verify pg_cron first).
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  raise notice '--- Block 5: cleanup ---';
  update public.products
     set deleted_at = null
   where deleted_at is not null
     and deleted_at > now() - interval '5 minutes';
  get diagnostics v_count = row_count;
  raise notice '  Un-soft-deleted % product(s) modified in the last 5 minutes', v_count;
  raise notice '';
end $$;

do $$
begin
  raise notice '=== Smoke tests complete -- review the Messages tab above ===';
  raise notice 'Any FAIL or SKIP line that is unexpected requires investigation.';
end $$;