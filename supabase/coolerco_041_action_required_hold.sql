-- ============================================================================
-- CoolerCo 041 — Case calendar: Action Required = closure (Wanda 2026-11-24)
-- Run on: TEST (after 040). Replaces 3 of 040's functions; same names and inputs.
-- Rollback: run coolerco_040_case_calendar.sql again.
--
-- Wanda: "Action Required is the closure — the flag is for the supervisors to check
-- that it has been cancelled (or rescheduled), because the asset on that case is only
-- released when the case is cancelled or rescheduled."
--   • Action Required no longer counts as open / overdue: it is closed, and on time or
--     late by COM's own SLA result (every Action Required case has a closure date).
--   • New supervisor check "action_hold": cases sitting in Action Required (asset held),
--     with the days since closure; oldest first. Rescheduled cases go back to an open
--     status in COM, cancelled ones to Canceled — both drop off the list by themselves.
--   • Error / Approval Required / Error External stay open follow-ups (no closure date).
-- ============================================================================

create or replace function public.coolerco_case_calendar_rows(
  p_since date, p_warehouse text default null, p_client text default null, p_case_type text default null)
returns table (
  case_number text, source text, client_code text, case_type text, status_reason text, priority text,
  warehouse_workshop text, point_of_sale text, pos_local_code text, responsible_ordering_party text,
  asset text, created_on timestamptz, service_closure_date timestamptz, sla_status text,
  due_date date, due_from text, bucket text, needs_action boolean, follow_up boolean,
  route_id text, route_number text, route_date date, route_outcome text, app_done_com_open boolean)
language plpgsql stable set search_path = public, pg_temp as $$
declare v_today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  return query
  with base as (
    select a.*,
           lower(trim(coalesce(a.status_reason, ''))) as st
    from public.coolerco_all_cases a
    where a.counts_as_case
      and (p_warehouse is null or a.warehouse_workshop = p_warehouse)
      and (p_client    is null or a.client_code = p_client)
      and (p_case_type is null or a.case_type = p_case_type)
      and (a.is_open
           or lower(trim(coalesce(a.status_reason, ''))) in ('action required', 'approval required', 'error', 'error external')
           or a.created_on >= (p_since - 120)
           or a.service_closure_date >= (p_since - 1))
  ),
  rt as (   -- latest route a case is on (current route version only)
    select distinct on (s.case_number) s.case_number, r.id::text as route_id, r.route_number::text as route_number,
           r.route_date::date as route_date, s.outcome_status::text as outcome_status
    from public.routing_route_stops s
    join public.routing_route_versions v on v.id = s.route_version_id and v.is_current
    join public.routing_routes r on r.id = s.route_id
    where s.case_number in (select b.case_number from base b)
    order by s.case_number, r.route_date desc
  ),
  d as (
    select b.*,
           (b.is_open or b.st in ('approval required', 'error', 'error external')) as fu,
           b.st in ('action required', 'approval required', 'error', 'error external') as na,
           coalesce((b.end_date at time zone 'Africa/Johannesburg')::date,
                    public.coolerco_sla_due_date(b.client_code, b.case_type, b.warehouse_workshop, b.created_on, b.begin_date)) as due,
           case when b.end_date is not null then 'case' else 'rule' end as due_src
    from base b
  )
  select d.case_number, d.source, d.client_code, d.case_type, d.status_reason, d.priority,
         d.warehouse_workshop, d.point_of_sale, d.pos_local_code, d.responsible_ordering_party,
         coalesce(d.asset_repaired, d.asset_delivered, d.asset_removed, d.mapped_asset),
         d.created_on, d.service_closure_date, d.sla_status,
         d.due, d.due_src,
         case
           when d.fu then case when d.due < v_today then 'late' else 'open' end
           when d.st in ('canceled', 'cancelled', 'rejected') or coalesce(d.sla_status, '') ilike 'cancel%' then 'cancelled'
           when d.sla_status in ('SLA Met', 'SLA Exceeded') then 'closed_ontime'
           when d.sla_status in ('SLA Not Met', 'Open Case SLA Not Met') then 'closed_late'
           when d.service_closure_date is not null and d.due is not null
                and (d.service_closure_date at time zone 'Africa/Johannesburg')::date > d.due then 'closed_late'
           else 'closed_ontime'
         end,
         d.na, d.fu,
         rt.route_id, rt.route_number, rt.route_date, rt.outcome_status,
         coalesce(d.source = 'COM' and d.fu and rt.outcome_status = 'solved', false)
  from d
  left join rt on rt.case_number = d.case_number;
end $$;

create or replace function public.coolerco_case_calendar(
  p_month date, p_place_by text default 'due', p_warehouse text default null,
  p_client text default null, p_case_type text default null)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_from  date := date_trunc('month', coalesce(p_month, now()::date))::date;
  v_to    date := (date_trunc('month', coalesce(p_month, now()::date)) + interval '1 month - 1 day')::date;
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_next  date := public.coolerco_add_working_days((now() at time zone 'Africa/Johannesburg')::date, 1);
  v_res   jsonb;
begin
  with r as (
    select x.*, public.coolerco_case_calendar_place(p_place_by, x.due_date, x.created_on, x.service_closure_date, x.route_date) as place
    from public.coolerco_case_calendar_rows(v_from, p_warehouse, p_client, p_case_type) x
  ),
  days as (
    select g::date as d from generate_series(v_from, v_to, interval '1 day') g
  ),
  per_day as (
    select dd.d,
           count(r.*) filter (where r.bucket = 'late')          as late,
           count(r.*) filter (where r.bucket = 'open')          as open,
           count(r.*) filter (where r.bucket = 'closed_late')   as closed_late,
           count(r.*) filter (where r.bucket = 'closed_ontime') as closed_ontime,
           count(r.*) filter (where r.bucket = 'cancelled')     as cancelled,
           count(r.*) filter (where r.app_done_com_open)        as gap
    from days dd left join r on r.place = dd.d
    group by dd.d
  ),
  closed_in_month as (
    select * from r
    where r.bucket in ('closed_ontime', 'closed_late')
      and (r.service_closure_date at time zone 'Africa/Johannesburg')::date between v_from and v_to
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to, 'today', v_today, 'next_working_day', v_next, 'place_by', coalesce(p_place_by, 'due'),
    'days', (select jsonb_agg(jsonb_build_object('d', d, 'late', late, 'open', open, 'closed_late', closed_late,
                                                 'closed_ontime', closed_ontime, 'cancelled', cancelled, 'gap', gap) order by d) from per_day),
    'kpi', jsonb_build_object(
      'overdue',      (select count(*) from r where r.follow_up and r.due_date < v_today),
      'due_today',    (select count(*) from r where r.follow_up and r.due_date = v_today),
      'due_next',     (select count(*) from r where r.follow_up and r.due_date = v_next),
      'needs_action', (select count(*) from r where r.needs_action),
      'action_hold',  (select count(*) from r where lower(coalesce(r.status_reason, '')) = 'action required'),
      'action_hold_old', (select count(*) from r where lower(coalesce(r.status_reason, '')) = 'action required'
                            and (r.service_closure_date at time zone 'Africa/Johannesburg')::date < v_today - 2),
      'open_total',   (select count(*) from r where r.follow_up),
      'carried',      (select count(*) from r where r.follow_up and r.place < v_from),
      'not_placed',   (select count(*) from r where r.follow_up and r.place is null),
      'gap',          (select count(*) from r where r.app_done_com_open),
      'closed',       (select count(*) from closed_in_month),
      'closed_ontime',(select count(*) from closed_in_month where bucket = 'closed_ontime'),
      'holidays',     (select coalesce(jsonb_object_agg(h.holiday_date, h.name), '{}'::jsonb)
                       from public.coolerco_public_holidays h where h.holiday_date between v_from and v_to)),
    'by_type', (select coalesce(jsonb_agg(t order by t ->> 'case_type'), '[]'::jsonb) from (
                  select jsonb_build_object('case_type', r.case_type,
                           'total', count(*), 'late', count(*) filter (where r.bucket = 'late'),
                           'open', count(*) filter (where r.bucket = 'open'),
                           'closed', count(*) filter (where r.bucket in ('closed_ontime', 'closed_late')),
                           'ontime', count(*) filter (where r.bucket = 'closed_ontime')) as t
                  from r where r.place between v_from and v_to group by r.case_type) q),
    'com_data_up_to', (select max(a.created_on) from public.coolerco_all_cases a where a.source = 'COM')
  ) into v_res;
  return v_res;
end $$;

create or replace function public.coolerco_case_calendar_list(
  p_view text, p_date date default null, p_month date default null, p_place_by text default 'due',
  p_warehouse text default null, p_client text default null, p_case_type text default null, p_limit int default 500)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_from  date := date_trunc('month', coalesce(p_month, p_date, now()::date))::date;
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_next  date := public.coolerco_add_working_days((now() at time zone 'Africa/Johannesburg')::date, 1);
  v_res   jsonb;
begin
  with r as (
    select x.*, public.coolerco_case_calendar_place(p_place_by, x.due_date, x.created_on, x.service_closure_date, x.route_date) as place
    from public.coolerco_case_calendar_rows(least(v_from, coalesce(p_date, v_from)), p_warehouse, p_client, p_case_type) x
  ),
  pick as (
    select * from r
    where case coalesce(p_view, 'day')
            when 'day'          then r.place = p_date
            when 'carried'      then r.follow_up and r.place < v_from
            when 'overdue'      then r.follow_up and r.due_date < v_today
            when 'due_soon'     then r.follow_up and r.due_date in (v_today, v_next)
            when 'needs_action' then r.needs_action
            when 'action_hold'  then lower(coalesce(r.status_reason, '')) = 'action required'
            when 'gap'          then r.app_done_com_open
            when 'not_placed'   then r.follow_up and r.place is null
            else false end
  ),
  counted as (select count(*) as n from pick)
  select jsonb_build_object('total', (select n from counted), 'rows', coalesce((
    select jsonb_agg(to_jsonb(p) - 'place' || jsonb_build_object(
             'days_late', case when p.follow_up and p.due_date < v_today then v_today - p.due_date end,
             'action_hold', lower(coalesce(p.status_reason, '')) = 'action required',
             'action_days', case when lower(coalesce(p.status_reason, '')) = 'action required' and p.service_closure_date is not null
                                 then v_today - (p.service_closure_date at time zone 'Africa/Johannesburg')::date end) order by
             case p.bucket when 'late' then 0 when 'open' then 1 when 'closed_late' then 2 when 'closed_ontime' then 3 else 4 end,
             p.needs_action desc,
             case when coalesce(p_view, 'day') = 'action_hold' then p.service_closure_date end asc nulls last,
             case lower(coalesce(p.priority, '')) when 'high' then 0 when 'medium' then 1 else 2 end,
             p.due_date, p.case_number)
    from (select * from pick
          order by case when coalesce(p_view, 'day') = 'action_hold' then 0 when bucket = 'late' then 1 when bucket = 'open' then 2 else 3 end,
                   case when coalesce(p_view, 'day') = 'action_hold' then service_closure_date end asc nulls last, due_date
          limit greatest(least(coalesce(p_limit, 500), 2000), 1)) p), '[]'::jsonb)) into v_res;
  return v_res;
end $$;
