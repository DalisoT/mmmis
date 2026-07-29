-- MMMIS hardening diagnostic — returns ONE row with every check.
-- Use this if you can't see the Messages tab in the Supabase SQL Editor.
-- All values land in the result grid (single row, 7 columns).

with checks as (
  select
    -- 0029 — create_sale() product validation
    (select exists (
       select 1 from pg_proc
        where proname = 'create_sale'
          and pronamespace = 'public'::regnamespace
    )) as has_create_sale,

    -- 0029 — create_sale() signature
    (select pg_get_function_identity_arguments(p.oid)
       from pg_proc p
      where p.proname = 'create_sale'
        and p.pronamespace = 'public'::regnamespace
      limit 1) as create_sale_signature,

    -- 0027 — barman_id lookup helper (auth_id -> public.users.id)
    (select exists (
       select 1 from pg_proc
        where proname like '%barman%'
          and pronamespace = 'public'::regnamespace
    )) as has_barman_lookup,

    -- pg_cron installed?
    (select exists (
       select 1 from pg_extension where extname = 'pg_cron'
    )) as has_pg_cron,

    -- Seed sanity: how many active members
    (select count(*)
       from public.members m
       join public.users u on u.id = m.user_id
      where u.deleted_at is null and u.is_active = true
    ) as active_members,

    -- Seed sanity: how many active barmen
    (select count(*)
       from public.users u
       join public.roles r on r.id = u.role_id
      where r.code = 'barman'
        and u.deleted_at is null
        and u.is_active = true
    ) as active_barmen,

    -- Seed sanity: how many active products
    (select count(*) from public.products
      where deleted_at is null and status = 'active') as active_products,

    -- Pending CHIT auth requests older than 6 minutes (the cron target)
    (select count(*) from public.chit_authorization_requests
      where status = 'pending'
        and expires_at < now()) as stale_pending_chits
)
select
  has_create_sale,
  create_sale_signature,
  has_barman_lookup,
  has_pg_cron,
  active_members,
  active_barmen,
  active_products,
  stale_pending_chits,

  -- Human-readable verdict
  case
    when not has_create_sale
      then 'FAIL: 0029 NOT applied — create_sale() is missing'
    when not has_pg_cron and stale_pending_chits > 0
      then 'PARTIAL: 0029 OK, pg_cron MISSING, '
        || stale_pending_chits::text
        || ' stale CHIT request(s) will accumulate forever'
    when has_pg_cron and not has_barman_lookup
      then 'OK but verify barman_id FK manually'
    else 'OK: 0029 installed, '
  end ||
  case
    when has_pg_cron then 'pg_cron present'
    else 'pg_cron missing on this plan'
  end as verdict
from checks;