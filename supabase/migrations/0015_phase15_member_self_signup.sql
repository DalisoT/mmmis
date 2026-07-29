-- Phase 15: member self-registration
--
-- When a new row appears in auth.users, if the user was created via
-- /register (i.e. raw_user_meta_data->>'self_register' = '1') and no
-- public.users row exists for that auth_id yet, we materialise one with
-- role_id = (id of roles where code = 'member') and the matching
-- public.members record.
--
-- This lets the front-end call supabase.auth.signUp() from a public
-- /register route and have the database do the rest, without granting
-- the anon role any INSERT policy on public.users or public.members.
--
-- Admin-driven creates go through the create-user Edge Function (which
-- uses the service role key) and bypass this trigger.

create or replace function public.fn_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_selfreg   boolean := (v_meta->>'self_register')::boolean = true;
  v_existing  uuid;
  v_role_id   smallint;
  v_user_id   uuid;
  v_svc       text;
  v_name      text;
  v_first     text;
  v_last      text;
begin
  -- Only act on self-registrations.
  if not v_selfreg then
    return new;
  end if;

  -- If a public.users row already exists (e.g. admin pre-created the user)
  -- leave it alone.
  select id into v_existing from public.users where auth_id = new.id;
  if v_existing is not null then
    return new;
  end if;

  v_svc  := coalesce(nullif(v_meta->>'service_number', ''), 'ZM-' || substr(replace(new.id::text, '-', ''), 1, 6));
  v_name := coalesce(nullif(v_meta->>'full_name', ''), split_part(new.email, '@', 1));

  -- Split full name into first/last (best-effort).
  if position(' ' in v_name) > 0 then
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
    auth_id, service_number, full_name, email, role_id,
    is_active
  ) values (
    new.id, v_svc, v_name, new.email, v_role_id,
    true
  )
  returning id into v_user_id;

  insert into public.members (
    user_id, service_number, first_name, last_name
  ) values (
    v_user_id, v_svc, v_first, v_last
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.fn_handle_new_auth_user();

-- RLS: a freshly-registered member must be able to read their own row
-- and update phone on next login. This already exists
-- via the policies in 0001, but we make sure phone is writable for the
-- new self-registered account too.

drop policy if exists users_self_update on public.users;
create policy users_self_update on public.users
  for update to authenticated
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());
