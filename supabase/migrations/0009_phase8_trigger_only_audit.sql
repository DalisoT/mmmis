-- Phase 8: trigger-only audit, actor_id stamping, app-level RPC, rate limit.
--
--   * Drop the Phase 7 "audit_log_staff_insert" RLS policy. Inserts are now
--     exclusively performed by SECURITY DEFINER triggers and the
--     public.log_audit_event() RPC.
--   * Add AFTER triggers on the sensitive tables. Each one stamps actor_id
--     from auth.uid() and writes a JSON snapshot of NEW (and OLD for
--     UPDATE/DELETE) into public.audit_log.
--   * Tighten the audit_log schema: lock actor_id to be set server-side
--     (a CHECK + column default is added; the trigger is the only writer).
--   * Add public.log_audit_event(p_action text, p_meta jsonb) RPC so
--     client code can still log app-level events (login, settings).
--   * Add public.count_recent_chit_verifications(p_service_number text)
--     so sales.service.verifyMemberPassword can be rate-limited.

-- ============================================================================
-- 1. Tighten audit_log: revoke client inserts, add column defaults.
-- ============================================================================
drop policy if exists audit_log_staff_insert on public.audit_log;

-- Now only the SECURITY DEFINER trigger / RPC can insert.
-- (No INSERT policy = no client inserts possible.)

alter table public.audit_log
  alter column actor_id set default auth.uid();

-- Guard: actor_id must match auth.uid() once the row lands. The trigger
-- inserts with auth.uid() so this passes; a client attempting to insert
-- directly would either lack INSERT permission OR fail this check.
alter table public.audit_log
  drop constraint if exists audit_log_actor_matches_auth_uid;
alter table public.audit_log
  add constraint audit_log_actor_matches_auth_uid
  check (actor_id IS NULL OR actor_id = auth.uid());

-- ============================================================================
-- 2. Shared trigger function. Stamps actor_id, serialises NEW/OLD, writes.
-- ============================================================================
create or replace function public.fn_audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_target_id text;
  v_action text;
  v_old jsonb;
  v_new jsonb;
begin
  -- Look up the role label (best-effort; nullable in audit_log).
  select r.code into v_actor_role
    from public.users u
    join public.roles r on r.id = u.role_id
   where u.auth_id = v_actor
   limit 1;

  -- Determine action + target_id + values to log.
  if (tg_op = 'INSERT') then
    v_action := tg_table_name || '.create';
    v_target_id := coalesce((to_jsonb(new) ->> 'id'), '');
    v_new := to_jsonb(new);
    v_old := null;
  elsif (tg_op = 'UPDATE') then
    v_action := tg_table_name || '.update';
    v_target_id := coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id'), '');
    v_new := to_jsonb(new);
    v_old := to_jsonb(old);
  elsif (tg_op = 'DELETE') then
    v_action := tg_table_name || '.delete';
    v_target_id := coalesce((to_jsonb(old) ->> 'id'), '');
    v_new := null;
    v_old := to_jsonb(old);
  end if;

  -- Special-case the users table: collapse role change into its own action.
  if tg_table_name = 'users' and tg_op = 'UPDATE' then
    if (to_jsonb(new) ->> 'role_id') is distinct from (to_jsonb(old) ->> 'role_id') then
      v_action := 'user.role_change';
    elsif coalesce((to_jsonb(new) ->> 'is_active')::boolean, true) = false
       and coalesce((to_jsonb(old) ->> 'is_active')::boolean, true) = true then
      v_action := 'user.deactivate';
    else
      v_action := 'user.update';
    end if;
  end if;

  insert into public.audit_log (
    actor_id, actor_role, action, target_table, target_id, old_values, new_values
  ) values (
    v_actor, v_actor_role, v_action, tg_table_name, v_target_id, v_old, v_new
  );

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

-- Attach to sensitive tables. AFTER triggers so they never block the write.
drop trigger if exists trg_audit_sales         on public.sales;
create trigger trg_audit_sales
  after insert or update or delete on public.sales
  for each row execute function public.fn_audit_row();

drop trigger if exists trg_audit_sale_items    on public.sale_items;
create trigger trg_audit_sale_items
  after insert or update or delete on public.sale_items
  for each row execute function public.fn_audit_row();

drop trigger if exists trg_audit_chit_payments on public.chit_payments;
create trigger trg_audit_chit_payments
  after insert or update or delete on public.chit_payments
  for each row execute function public.fn_audit_row();

drop trigger if exists trg_audit_expenses      on public.expenses;
create trigger trg_audit_expenses
  after insert or update or delete on public.expenses
  for each row execute function public.fn_audit_row();

drop trigger if exists trg_audit_ledger        on public.ledger;
create trigger trg_audit_ledger
  after insert or update or delete on public.ledger
  for each row execute function public.fn_audit_row();

drop trigger if exists trg_audit_users         on public.users;
create trigger trg_audit_users
  after insert or update or delete on public.users
  for each row execute function public.fn_audit_row();

drop trigger if exists trg_audit_stock_receipts on public.stock_receipts;
create trigger trg_audit_stock_receipts
  after insert or update or delete on public.stock_receipts
  for each row execute function public.fn_audit_row();

drop trigger if exists trg_audit_stock_sheet  on public.stock_sheet;
create trigger trg_audit_stock_sheet
  after insert or update or delete on public.stock_sheet
  for each row execute function public.fn_audit_row();

drop trigger if exists trg_audit_daily_summary on public.daily_summary;
create trigger trg_audit_daily_summary
  after insert or update or delete on public.daily_summary
  for each row execute function public.fn_audit_row();

-- ============================================================================
-- 3. log_audit_event() RPC — for app-level events that don't map to a row.
-- ============================================================================
create or replace function public.log_audit_event(
  p_action text,
  p_meta   jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role  text;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;
  select r.code into v_role
    from public.users u
    join public.roles r on r.id = u.role_id
   where u.auth_id = v_actor
   limit 1;

  insert into public.audit_log (actor_id, actor_role, action, meta)
  values (v_actor, v_role, p_action, p_meta);
end;
$$;

grant execute on function public.log_audit_event(text, jsonb) to authenticated;

-- ============================================================================
-- 4. Rate limit RPC for verifyMemberPassword
--    Trigger fires on every chit_payments insert anyway; this just
--    controls the password-verification probe specifically.
-- ============================================================================
create or replace function public.count_recent_chit_verifications(
  p_service_number text,
  p_minutes integer default 5
)
returns integer
language sql
stable
as $$
  select coalesce(sum(
    case
      when meta ->> 'service_number' = p_service_number
       and action = 'chit.verify_password'
       and occurred_at >= now() - make_interval(mins => p_minutes)
      then 1 else 0
    end
  ), 0)::integer
  from public.audit_log;
$$;

grant execute on function public.count_recent_chit_verifications(text, integer) to authenticated;