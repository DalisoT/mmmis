-- =============================================================================
-- 0026 — Fix ambiguous `sale_id` in finalize_chit_authorization
--
-- Migration 0022 declared `finalize_chit_authorization` as
--   RETURNS TABLE (sale_id uuid, total_amount numeric, request_id uuid, status text)
-- That implicitly creates OUT parameters named `sale_id`, `total_amount`,
-- `request_id`, `status` inside the function body.
--
-- The function then calls `create_sale(...)`, which itself is declared as
--   RETURNS TABLE (sale_id uuid, total_amount numeric)
-- Inside the SQL statement:
--
--   select sale_id, total_amount
--     into v_sale_id, v_total
--     from public.create_sale(...);
--
-- the bare column names `sale_id` and `total_amount` match BOTH:
--   - the OUT columns from `create_sale`'s table return (intended target)
--   - the OUT parameters of `finalize_chit_authorization` itself
-- and PostgreSQL raises 42702 "column reference ... is ambiguous" the moment
-- the RPC is invoked.
--
-- The frontend was seeing this as a toast on the POS:
--   "Could not finalize CHIT checkout: column reference 'sale_id' is
--    ambiguous [42702]"
--
-- Fix: alias the function call and qualify the select columns with that
-- alias, the same shape 0025 uses for `create_chit_authorization`. The OUT
-- parameters of `finalize_chit_authorization` remain — they're needed for
-- the function's return type — but the unqualified names no longer collide
-- because the source columns are explicitly `cs.sale_id` and `cs.total_amount`.
--
-- Idempotent: re-running replaces the function body.
-- =============================================================================

set search_path = public;

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
  v_caller   uuid := auth.uid();
  v_role     text;
  v_row      public.chit_authorization_requests%rowtype;
  v_sale_id  uuid;
  v_total    numeric(12,2);
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
    raise exception 'Forbidden: only staff can finalize a CHIT sale'
      using errcode = '42501';
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
  -- Alias the function call as `cs` and qualify the OUT columns with that
  -- alias to disambiguate them from this function's own OUT parameters
  -- (which happen to share the same names: sale_id, total_amount).
  select cs.sale_id, cs.total_amount
    into v_sale_id, v_total
    from public.create_sale(
      'chit',
      v_row.member_id,
      v_row.cart,
      'CHIT authorized via ' || v_row.authorized_via
    ) as cs;

  update public.chit_authorization_requests
     set status           = 'consumed',
         consumed_sale_id = v_sale_id
   where id = p_request_id;

  return query select v_sale_id, v_total, p_request_id, 'consumed';
end;
$$;

revoke all on function public.finalize_chit_authorization(uuid) from public;
grant execute on function public.finalize_chit_authorization(uuid) to authenticated;

-- Sanity check
do $$
begin
  if not exists (
    select 1 from pg_proc
    where proname = 'finalize_chit_authorization'
      and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'finalize_chit_authorization() missing after 0026';
  end if;
  raise notice '0026 installed — finalize_chit_authorization() no longer ambiguous on sale_id/total_amount';
end
$$;