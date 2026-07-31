-- tools/fix_chit_trigger.sql
--
-- One-shot fix for "Column m.id does not exist" on CHIT checkout.
--
-- The original Phase 19 trigger functions in 0035 looked up the
-- recipient via `from public.members m where m.id = NEW.member_id`,
-- but members has no id column — its PK is user_id. Worse,
-- chit_authorization_requests.member_id is already a FK to
-- public.users(id), so no members lookup is needed at all.
--
-- Replaces both trigger function bodies with the corrected versions
-- and re-attaches the triggers. Idempotent — safe to re-run.

set search_path = public;

-- ---------------------------------------------------------------------------
-- 1. Re-create trg_chit_auth_request_notify() — uses NEW.member_id
--    directly as the recipient's user_id (since the FK already points
--    at public.users(id)), and wraps in an exception handler so a push
--    failure can NEVER roll back the actual CHIT checkout.
-- ---------------------------------------------------------------------------

create or replace function public.trg_chit_auth_request_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_barman_name    text;
  v_total_text     text;
begin
  select u.full_name into v_barman_name
    from public.users u
   where u.id = NEW.created_by;

  v_total_text := format('K%s', to_char(coalesce(NEW.total_amount, 0), 'FM999,990.00'));

  insert into public.push_outbox (user_id, kind, title, body, url, tag, payload)
  values (
    NEW.member_id,
    'chit.authorization_requested',
    'Approve a CHIT purchase',
    coalesce(v_barman_name, 'The barman') || ' is requesting ' || v_total_text || ' on your CHIT account.',
    '/portal/authorize/' || NEW.id::text,
    'chit-' || NEW.id::text,
    jsonb_build_object('request_id', NEW.id, 'total_amount', NEW.total_amount)
  );

  return NEW;
exception when others then
  raise warning 'trg_chit_auth_request_notify failed: % (%)', sqlerrm, sqlstate;
  return NEW;
end;
$$;

drop trigger if exists trg_chit_auth_request_notify on public.chit_authorization_requests;
create trigger trg_chit_auth_request_notify
  after insert on public.chit_authorization_requests
  for each row execute function public.trg_chit_auth_request_notify();

-- ---------------------------------------------------------------------------
-- 2. Re-create trg_chit_auth_request_resolved() — same fix.
-- ---------------------------------------------------------------------------

create or replace function public.trg_chit_auth_request_resolved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status_text  text;
  v_member_name  text;
begin
  if NEW.status = OLD.status then
    return NEW;
  end if;

  if NEW.status not in ('authorized', 'manual_override', 'rejected', 'cancelled', 'expired') then
    return NEW;
  end if;

  -- chit_authorization_requests.member_id FKs public.users(id);
  -- members is keyed by user_id (no members.id column).
  select concat_ws(' ', u.first_name, u.last_name) into v_member_name
    from public.users u
    left join public.members m on m.user_id = u.id
   where u.id = NEW.member_id;

  v_status_text := case NEW.status
    when 'authorized'      then 'approved'
    when 'manual_override' then 'recorded (manual override)'
    when 'rejected'        then 'rejected'
    when 'cancelled'       then 'cancelled'
    when 'expired'         then 'expired without a response'
  end;

  insert into public.push_outbox (user_id, kind, title, body, url, tag, payload)
  values (
    NEW.created_by,
    'chit.authorization_resolved',
    'CHIT sale ' || v_status_text,
    coalesce(v_member_name, 'Member') || ' ' || v_status_text || ' your CHIT request.',
    '/pos',
    'chit-resolved-' || NEW.id::text,
    jsonb_build_object('request_id', NEW.id, 'status', NEW.status)
  );

  return NEW;
exception when others then
  raise warning 'trg_chit_auth_request_resolved failed: % (%)', sqlerrm, sqlstate;
  return NEW;
end;
$$;

drop trigger if exists trg_chit_auth_request_resolved on public.chit_authorization_requests;
create trigger trg_chit_auth_request_resolved
  after update on public.chit_authorization_requests
  for each row execute function public.trg_chit_auth_request_resolved();

-- ---------------------------------------------------------------------------
-- 3. Verify
-- ---------------------------------------------------------------------------

do $$
declare
  v_src text;
begin
  select prosrc into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'trg_chit_auth_request_notify';

  if v_src is null or v_src like '%m.id = NEW.member_id%' then
    raise exception 'notify trigger still references members.id — investigate';
  end if;

  raise notice 'CHIT notification triggers patched successfully';
end
$$;
