-- =============================================================================
-- MMMIS 0032 — fix fn_handle_new_auth_user() trigger function on live DB
-- -----------------------------------------------------------------------------
-- The migration history for the trigger function:
--   * 0015 created fn_handle_new_auth_user() with INSERT ... must_reset_pw
--   * 0023 did `create or replace` to extend it with bulk_seed handling — same
--     INSERT ... must_reset_pw
--   * 0031 dropped the `must_reset_pw` column
--
-- Result: the live function body still references a non-existent column.
-- Editing the historical migration files (0015, 0023) on disk does NOT
-- re-deploy them. We need a new migration that explicitly replaces the
-- trigger function with the corrected body.
--
-- This migration is a no-op if 0031 was applied AFTER all callers were
-- already updated. It exists purely to fix the trigger for any environment
-- where 0031 ran but the trigger body was not refreshed.
-- =============================================================================

create or replace function public.fn_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_selfreg   boolean := (v_meta->>'self_register')::boolean = true;
  v_bulk      boolean := (v_meta->>'bulk_seed')     = '1';
  v_existing  uuid;
  v_role_id   smallint;
  v_user_id   uuid;
  v_svc       text;
  v_name      text;
  v_rank      text;
  v_first     text;
  v_last      text;
begin
  -- Only act on self-registrations or admin bulk-seeds.
  if not (v_selfreg or v_bulk) then
    return new;
  end if;

  -- If a public.users row already exists (e.g. admin pre-created the user)
  -- leave it alone.
  select id into v_existing from public.users where auth_id = new.id;
  if v_existing is not null then
    return new;
  end if;

  v_svc  := coalesce(nullif(v_meta->>'service_number', ''),
                     'ZM-' || substr(replace(new.id::text, '-', ''), 1, 6));
  v_name := coalesce(nullif(v_meta->>'full_name', ''),
                     split_part(new.email, '@', 1));
  v_rank := nullif(v_meta->>'rank', '');

  -- Split full name into first/last (best-effort). Trim the leading salutation
  -- token (e.g. "MR PHIRI A" -> first="PHIRI", last="A") if it matches.
  if v_name ~* '^(MR|MRS|MS|DR|CAPT|MAJ|COL|LT|LT COL|2LT|2ND LT|WO[ I]*|SGT|LCPL|SSGT|CE)\s+'
     and array_length(string_to_array(v_name, ' '), 1) >= 3 then
    v_first := split_part(v_name, ' ', 2);
    v_last  := substring(v_name from position(' ' in v_name) + 1);
    v_last  := substring(v_last from position(' ' in v_last) + 1);
  elsif position(' ' in v_name) > 0 then
    v_first := split_part(v_name, ' ', 1);
    v_last  := substring(v_name from position(' ' in v_name) + 1);
  else
    v_first := v_name;
    v_last  := '';
  end if;

  select id into v_role_id from public.roles where code = 'member';
  if v_role_id is null then
    raise exception 'member role missing from public.roles';
  end if;

  insert into public.users (
    auth_id, service_number, full_name, email, role_id, rank,
    is_active
  ) values (
    new.id, v_svc, v_name, new.email, v_role_id, v_rank,
    true
  )
  returning id into v_user_id;

  insert into public.members (
    user_id, service_number, first_name, last_name, rank
  ) values (
    v_user_id, v_svc, v_first, v_last, v_rank
  )
  on conflict (user_id) do nothing;

  -- For bulk seeds, also stamp the staging row as 'seeded'.
  if v_bulk then
    update public.bulk_member_seed
       set status = 'seeded',
           created_user_id = v_user_id,
           message = coalesce(message, '') || ' [trigger ' || extract(epoch from now())::text || ']'
     where service_number = v_svc
       and status = 'pending';
  end if;

  return new;
end;
$$;

-- The trigger itself (trg_on_auth_user_created) was already installed by 0015.
-- This CREATE OR REPLACE on the function leaves the trigger pointing at the
-- updated implementation.

do $$
begin
  if not exists (
    select 1 from pg_proc
    where proname = 'fn_handle_new_auth_user'
      and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'fn_handle_new_auth_user() missing after 0032';
  end if;
  raise notice '0032 installed — fn_handle_new_auth_user() refreshed; must_reset_pw references purged';
end $$;