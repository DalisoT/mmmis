-- Phase 13: member directory.
--
-- Adds a single RPC `public.search_members(p_query text, p_limit int, p_only_active bool)`
-- that returns one row per member joined to public.users for service_number/full_name,
-- plus the running chit_balance, credit_limit, rank, unit, and last_login_at.
--
-- This is a read-only directory view; it does not write to any table.
-- It supplements the existing MembersPage (which is a CRUD form) with a
-- fast, searchable, paged list for daily ops use.
--
-- Authorization: administrator + treasurer only (same as MembersPage).
--
-- The text search is case-insensitive across service_number, full_name,
-- first_name, last_name, rank, and unit. Empty query returns all members
-- ordered by full_name.

set search_path = public;

create or replace function public.search_members(
  p_query      text    default null,
  p_limit      integer default 200,
  p_only_active boolean default true
)
returns table (
  user_id        uuid,
  service_number text,
  full_name      text,
  first_name     text,
  last_name      text,
  email          text,
  rank           text,
  unit           text,
  is_active      boolean,
  chit_balance   numeric,
  credit_limit   numeric,
  last_login_at  timestamptz,
  ledger_count   bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      u.id,
      u.service_number,
      u.full_name,
      m.first_name,
      m.last_name,
      u.email,
      coalesce(m.rank,  u.rank)  as rank,
      coalesce(m.unit,  u.unit)  as unit,
      u.is_active,
      m.chit_balance,
      m.credit_limit,
      u.last_login_at
    from public.members m
    join public.users u on u.id = m.user_id
    where u.deleted_at is null
      and (not p_only_active or u.is_active = true)
      and (
        p_query is null
        or btrim(p_query) = ''
        or u.service_number ilike '%' || btrim(p_query) || '%'
        or u.full_name      ilike '%' || btrim(p_query) || '%'
        or m.first_name     ilike '%' || btrim(p_query) || '%'
        or m.last_name      ilike '%' || btrim(p_query) || '%'
        or coalesce(m.rank, u.rank) ilike '%' || btrim(p_query) || '%'
        or coalesce(m.unit, u.unit) ilike '%' || btrim(p_query) || '%'
      )
  )
  select
    b.id            as user_id,
    b.service_number,
    b.full_name,
    b.first_name,
    b.last_name,
    b.email,
    b.rank,
    b.unit,
    b.is_active,
    b.chit_balance,
    b.credit_limit,
    b.last_login_at,
    (select count(*) from public.ledger l where l.member_id = b.id)::bigint as ledger_count
  from base b
  order by b.full_name asc
  limit case when p_limit is null or p_limit < 1 then 200 else least(p_limit, 1000) end;
$$;

revoke all on function public.search_members(text, integer, boolean) from public;
grant execute on function public.search_members(text, integer, boolean) to authenticated;

comment on function public.search_members(text, integer, boolean)
  is 'Searchable member directory. Staff only (admin + treasurer enforced by callers).';
