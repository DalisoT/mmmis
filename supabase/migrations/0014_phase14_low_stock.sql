-- Phase 14: low-stock report.
--
-- Adds a single RPC `public.get_low_stock(p_only_active bool, p_limit int)` that
-- returns one row per product with:
--   * the most recent stock_cf from public.stock_sheet (or opening_stock if no
--     stock sheet entry exists yet)
--   * the minimum_stock threshold
--   * a status (ok | low | critical | out) and a status message
--   * the most recent sheet_date and recorded_by service number for context
--
-- Authorization: administrator + treasurer + barman (same as ProductsPage).
--
-- The page-sized result is bounded; the typical mess has < 200 active
-- products so p_limit defaults to 500 with a hard cap of 1000.

set search_path = public;

create or replace function public.get_low_stock(
  p_only_active boolean default true,
  p_limit       integer default 500
)
returns table (
  product_id        uuid,
  name              text,
  category          text,
  unit              text,
  minimum_stock     integer,
  on_hand           integer,
  last_sheet_date   date,
  last_recorded_by  text,
  status            text,           -- 'ok' | 'low' | 'critical' | 'out' | 'no_min'
  status_message    text
)
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    -- Most recent stock_cf per product. Ties broken by sheet_date desc,
    -- then created_at desc so the most recently written row wins.
    select distinct on (ss.product_id)
      ss.product_id,
      ss.stock_cf,
      ss.sheet_date,
      u.service_number as recorded_by_sn
    from public.stock_sheet ss
    left join public.users u on u.id = ss.recorded_by
    where ss.deleted_at is null
    order by ss.product_id, ss.sheet_date desc, ss.created_at desc
  )
  select
    p.id                                       as product_id,
    p.name,
    p.category,
    p.unit,
    p.minimum_stock,
    coalesce(l.stock_cf, p.opening_stock)::int as on_hand,
    l.sheet_date                               as last_sheet_date,
    l.recorded_by_sn                           as last_recorded_by,
    case
      when p.minimum_stock is null or p.minimum_stock <= 0 then 'no_min'
      when coalesce(l.stock_cf, p.opening_stock) = 0       then 'out'
      when coalesce(l.stock_cf, p.opening_stock) <= p.minimum_stock / 2 then 'critical'
      when coalesce(l.stock_cf, p.opening_stock) <= p.minimum_stock then 'low'
      else 'ok'
    end as status,
    case
      when p.minimum_stock is null or p.minimum_stock <= 0
        then 'No minimum threshold set'
      when coalesce(l.stock_cf, p.opening_stock) = 0
        then 'Out of stock'
      when coalesce(l.stock_cf, p.opening_stock) <= p.minimum_stock / 2
        then 'Critical — less than half of minimum'
      when coalesce(l.stock_cf, p.opening_stock) <= p.minimum_stock
        then 'Low — at or below minimum'
      else 'Healthy'
    end as status_message
  from public.products p
  left join latest l on l.product_id = p.id
  where p.deleted_at is null
    and (not p_only_active or p.status = 'active')
  order by
    case
      when p.minimum_stock is null or p.minimum_stock <= 0 then 3
      when coalesce(l.stock_cf, p.opening_stock) = 0       then 0
      when coalesce(l.stock_cf, p.opening_stock) <= p.minimum_stock / 2 then 1
      when coalesce(l.stock_cf, p.opening_stock) <= p.minimum_stock then 2
      else 4
    end,
    p.name asc
  limit case when p_limit is null or p_limit < 1 then 500 else least(p_limit, 1000) end;
$$;

revoke all on function public.get_low_stock(boolean, integer) from public;
grant execute on function public.get_low_stock(boolean, integer) to authenticated;

comment on function public.get_low_stock(boolean, integer)
  is 'Lists products ranked by stock health (out → critical → low → ok). Staff only.';
