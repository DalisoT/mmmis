-- Phase 12: audit summary aggregations.
--
-- Adds a single RPC `public.get_audit_summary(p_from, p_to)` that returns:
--   * total event count in the window
--   * a daily time series of event counts
--   * top actions
--   * top target tables
--   * top actor service numbers (joined from public.users via auth_id)
--
-- Authorization: administrator only (matches the audit_log_admin_read policy).
--
-- The aggregations are bounded — the daily series caps at 366 buckets and
-- the top-N lists cap at 10 each — so a wide date range still returns a
-- small payload.

set search_path = public;

create or replace function public.get_audit_summary(
  p_from  timestamptz default (now() - interval '7 days'),
  p_to    timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.current_role_code();
  v_total bigint;
  v_series jsonb;
  v_actions jsonb;
  v_tables  jsonb;
  v_actors  jsonb;
begin
  if v_role <> 'administrator' then
    raise exception 'Audit summary is restricted to administrators' using errcode = '42501';
  end if;

  if p_from is null then p_from := now() - interval '7 days'; end if;
  if p_to   is null then p_to   := now(); end if;
  if p_from > p_to then
    raise exception 'p_from must be earlier than p_to' using errcode = '22023';
  end if;

  -- 1. Total in window.
  select count(*)
    into v_total
    from public.audit_log
   where occurred_at >= p_from
     and occurred_at <  p_to;

  -- 2. Daily series, capped at 366 buckets. If the requested window is
  --    wider than that, we still want bounded output, so we extend the
  --    window to p_from and emit one bucket per day.
  with days as (
    select generate_series(
      date_trunc('day', p_from),
      date_trunc('day', p_to),
      interval '1 day'
    ) as day
  ),
  bucket as (
    select
      d.day::date                                          as day,
      coalesce(sum(case when al.id is null then 0 else 1 end), 0)::bigint as events
    from days d
    left join public.audit_log al
      on al.occurred_at >= d.day
     and al.occurred_at <  d.day + interval '1 day'
     and al.occurred_at >= p_from
     and al.occurred_at <  p_to
    group by d.day
    order by d.day
  )
  select coalesce(jsonb_agg(jsonb_build_object('day', day, 'events', events)), '[]'::jsonb)
    into v_series
    from (
      select * from bucket
      order by day
      limit 366
    ) b;

  -- 3. Top actions (top 10 by event count).
  select coalesce(jsonb_agg(t), '[]'::jsonb)
    into v_actions
    from (
      select action, count(*)::bigint as events
        from public.audit_log
       where occurred_at >= p_from and occurred_at < p_to
       group by action
       order by events desc, action asc
       limit 10
    ) t;

  -- 4. Top target tables (top 10; nulls aggregated as '(none)').
  select coalesce(jsonb_agg(t), '[]'::jsonb)
    into v_tables
    from (
      select coalesce(target_table, '(none)') as target_table,
             count(*)::bigint as events
        from public.audit_log
       where occurred_at >= p_from and occurred_at < p_to
       group by coalesce(target_table, '(none)')
       order by events desc, target_table asc
       limit 10
    ) t;

  -- 5. Top actors (top 10 by event count, joined to public.users for the
  --    service number). Unknown actors are reported as '(unknown)'.
  select coalesce(jsonb_agg(t), '[]'::jsonb)
    into v_actors
    from (
      select
        coalesce(u.service_number, '(unknown)') as service_number,
        coalesce(u.full_name, '(unknown)')       as full_name,
        al.actor_role                            as role_code,
        count(*)::bigint                         as events
      from public.audit_log al
      left join public.users u on u.id = al.actor_id
      where al.occurred_at >= p_from and al.occurred_at < p_to
      group by u.service_number, u.full_name, al.actor_role
      order by events desc, service_number asc
      limit 10
    ) t;

  return jsonb_build_object(
    'from',          p_from,
    'to',            p_to,
    'total',         v_total,
    'daily',         v_series,
    'top_actions',   v_actions,
    'top_tables',    v_tables,
    'top_actors',    v_actors,
    'generated_at',  now()
  );
end;
$$;

revoke all on function public.get_audit_summary(timestamptz, timestamptz) from public;
grant execute on function public.get_audit_summary(timestamptz, timestamptz) to authenticated;

comment on function public.get_audit_summary(timestamptz, timestamptz)
  is 'Returns aggregated audit-log stats (totals, daily series, top actions/tables/actors). Admin only.';
