-- Phase 8 patch: audit_log.actor_id FK points to public.users(id), but
-- auth.uid() returns the auth.users.id. The trigger was inserting the
-- raw auth.uid() and violating
-- audit_log_actor_id_fkey whenever the acting user had a public.users row
-- whose id differed from their auth_id (i.e. always).
--
-- Translate auth.uid() -> public.users.id before insert so the FK is satisfied.

create or replace function public.fn_audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor       uuid;
  v_actor_pk    uuid;
  v_actor_role  text;
  v_target_id   text;
  v_action      text;
  v_old         jsonb;
  v_new         jsonb;
begin
  v_actor := auth.uid();

  -- Translate auth.uid() (auth.users.id) to public.users.id (the FK target).
  select u.id, r.code
    into v_actor_pk, v_actor_role
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
    v_actor_pk, v_actor_role, v_action, tg_table_name, v_target_id, v_old, v_new
  );

  if (tg_op = 'DELETE') then
    return old;
  end if;
  return new;
end;
$$;

-- The check constraint says actor_id must equal auth.uid(). With the FK fix
-- actor_id is now public.users.id, not auth.uid(). Drop the constraint.
alter table public.audit_log
  drop constraint if exists audit_log_actor_matches_auth_uid;

-- ============================================================================
-- Same FK fix for the log_audit_event() RPC used by app-level events
-- (login, settings, sign-out). Uses the same auth.uid() -> users.id translation.
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
  v_actor_pk uuid;
  v_role  text;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  -- Translate auth.uid() -> public.users.id.
  select u.id, r.code
    into v_actor_pk, v_role
    from public.users u
    join public.roles r on r.id = u.role_id
   where u.auth_id = v_actor
   limit 1;

  insert into public.audit_log (actor_id, actor_role, action, meta)
  values (v_actor_pk, v_role, p_action, p_meta);
end;
$$;
