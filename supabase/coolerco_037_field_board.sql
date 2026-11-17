-- CoolerCo-Ops · 037 · RUN ON TEST FIRST — ⭐ My board in the Field app (Wanda 2026-11-17)
-- One read-only call: the driver's / technician's own work for a DAY, WEEK (Mon–Sun) or MONTH, plus the warehouse team.
--   Work:       cases routed by case type and by current status; routed vs done on the App vs done in COM; best day.
--   Compliance: where the trip-sheet rules were not followed (past + today's stops only):
--     no_outcome   stop day is over, nothing recorded           arrived  done, but no 📍 Arrived tap
--     left         done, but no 🚪 Left store tap               job_card done, but no job card (photos + signature; not for Removals)
--     late_start   route left the warehouse after 08:00, or no 🏭 Start tap      com_open  done on the App > 1 day, COM still open
-- "Done on the App" = RouteIQ trip-sheet outcome Solved OR Field app Completed. Taps / job cards count from BOTH
-- RouteIQ (routing_route_events, routing_job_cards) and the CoolerCo Field app (coolerco_field_*).
-- "Done in COM" = case status Solved (CoolerCo / Tiger cases: Solved, Completed or Resolved).
-- Mine = routes linked to me (the slot's usual login, or set for me in Field crew). Staff without a slot see the warehouse.
-- Requires 028, 031, 033, 034. Read-only. Rollback: coolerco_037_rollback.sql
create or replace function public.coolerco_field_board(p_period text default 'month', p_date date default null, p_warehouse text default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
  v_day   date := coalesce(p_date, (now() at time zone 'Africa/Johannesburg')::date);
  v_per   text := case when p_period in ('day', 'week', 'month') then p_period else 'month' end;
  v_from  date; v_to date;
  v_slot public.coolerco_field_slots; v_wh text; v_group text; v_mine uuid[] := '{}'; v_team uuid[]; v jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  v_from := case v_per when 'day' then v_day when 'week' then date_trunc('week', v_day)::date else date_trunc('month', v_day)::date end;
  v_to   := case v_per when 'day' then v_day + 1 when 'week' then v_from + 7 else (v_from + interval '1 month')::date end;
  select * into v_slot from public.coolerco_field_slots where user_id = auth.uid() and active limit 1;
  v_wh := upper(coalesce(v_slot.warehouse_code, p_warehouse, 'JHB'));
  v_group := public.coolerco_wh_group(v_wh);

  select coalesce(array_agg(id), '{}') into v_team from public.routing_routes
   where warehouse_group = v_group and route_date >= v_from and route_date < v_to
     and status not in ('not_used', 'cancelled', 'suggested', 'saved_draft');
  if v_slot.id is not null then
    select coalesce(array_agg(distinct e.route_id), '{}') into v_mine from public.coolerco_route_crew_effective(v_team) e where e.user_id = auth.uid();
  end if;

  with stops as (
    select s.id stop_id, s.route_id, s.case_number, s.service_date, s.outcome_status, s.point_of_sale, s.route_id = any (v_mine) mine
      from public.routing_route_stops s join public.routing_route_versions rv on rv.id = s.route_version_id and rv.is_current
     where s.route_id = any (v_team) and s.outcome_status <> 'removed'),
  fapp as (   -- Field app: latest outcome tap per stop
    select distinct on (e.stop_id) e.stop_id, e.event_type, (e.occurred_at at time zone 'Africa/Johannesburg')::date d, e.occurred_at
      from public.coolerco_field_stop_events e where e.stop_id in (select stop_id from stops) and e.event_type in ('completed', 'not_completed')
     order by e.stop_id, e.occurred_at desc),
  st as (
    select s.*, (s.outcome_status = 'solved' or f.event_type = 'completed') app_done,
           (s.outcome_status <> 'planned' or f.stop_id is not null) recorded,
           coalesce(f.d, s.service_date) done_day, f.occurred_at f_done_at,
           exists (select 1 from public.routing_route_events x where x.route_stop_id = s.stop_id and x.event_type = 'driver_arrived')
             or exists (select 1 from public.coolerco_field_stop_events x where x.stop_id = s.stop_id and x.event_type = 'arrived') has_arrived,
           exists (select 1 from public.routing_route_events x where x.route_stop_id = s.stop_id and x.event_type = 'driver_left_pos')
             or exists (select 1 from public.coolerco_field_stop_events x where x.stop_id = s.stop_id and x.event_type = 'left') has_left,
           exists (select 1 from public.routing_job_cards j where j.route_stop_id = s.stop_id or (j.route_id = s.route_id and j.case_number = s.case_number))
             or exists (select 1 from public.coolerco_field_job_cards j where j.stop_id = s.stop_id) has_card
      from stops s left join fapp f on f.stop_id = s.stop_id),
  stc as (
    select st.*, c.case_type, c.status_reason, coalesce(c.status_reason in ('Solved', 'Completed', 'Resolved'), false) com_done
      from st left join public.coolerco_all_cases c on c.case_number = st.case_number),
  cs as (    -- one row per case (a carried-over case counts once)
    select case_number, bool_or(mine) mine, bool_or(app_done) app_done, bool_or(com_done) com_done,
           max(done_day) filter (where app_done) done_day, max(case_type) case_type, max(status_reason) status_reason,
           bool_or(app_done and not com_done and done_day < v_today - 1) com_open
      from stc group by case_number),
  rts as (   -- warehouse start per route: RouteIQ or Field app
    select r.id, r.id = any (v_mine) mine, r.route_date,
           least((select min(x.created_at) from public.routing_route_events x where x.route_id = r.id and x.event_type = 'driver_left_warehouse'),
                 (select min(x.occurred_at) from public.coolerco_field_route_events x where x.route_id = r.id and x.event_type = 'left_warehouse')) left_at
      from public.routing_routes r where r.id = any (v_team) and r.route_date <= v_today),
  sc as (select 'team'::text scope union all select 'mine'),
  agg as (
    select sc.scope, jsonb_build_object(
      'routed',   (select count(*) from cs where sc.scope = 'team' or mine),
      'app_done', (select count(*) from cs where (sc.scope = 'team' or mine) and app_done),
      'com_done', (select count(*) from cs where (sc.scope = 'team' or mine) and com_done),
      'by_type',  coalesce((select jsonb_object_agg(k, n) from (select coalesce(case_type, 'Other') k, count(*) n from cs where sc.scope = 'team' or mine group by 1) t), '{}'),
      'by_status',coalesce((select jsonb_object_agg(k, n) from (select coalesce(status_reason, 'Unknown') k, count(*) n from cs where sc.scope = 'team' or mine group by 1) t), '{}'),
      'days_worked', (select count(distinct done_day) from cs where (sc.scope = 'team' or mine) and app_done),
      'best_day', (select jsonb_build_object('date', d, 'done', n) from (select done_day d, count(*) n from cs where (sc.scope = 'team' or mine) and app_done group by 1 order by 2 desc, 1 desc limit 1) b),
      'routes', (select count(*) from rts where sc.scope = 'team' or mine),
      'checks', jsonb_build_object(
        'stops',      (select count(*) from stc where (sc.scope = 'team' or mine) and service_date <= v_today),
        'done_stops', (select count(*) from stc where (sc.scope = 'team' or mine) and app_done),
        'no_outcome', (select count(*) from stc where (sc.scope = 'team' or mine) and service_date < v_today and not recorded),
        'arrived',    (select count(*) from stc where (sc.scope = 'team' or mine) and app_done and not has_arrived),
        'left',       (select count(*) from stc where (sc.scope = 'team' or mine) and app_done and not has_left),
        'job_card',   (select count(*) from stc where (sc.scope = 'team' or mine) and app_done and not has_card and coalesce(case_type, '') <> 'Removal of Asset'),
        'late_start', (select count(*) from rts where (sc.scope = 'team' or mine)
                         and (left_at is null and route_date < v_today
                              or (left_at at time zone 'Africa/Johannesburg')::time > time '08:00')),
        'com_open',   (select count(*) from cs where (sc.scope = 'team' or mine) and com_open)),
      'issues', (select coalesce(jsonb_agg(i order by i->>'day' desc), '[]') from (
          select jsonb_build_object('kind', k, 'case', case_number, 'day', service_date, 'pos', point_of_sale) i from (
            select 'no_outcome' k, case_number, service_date, point_of_sale from stc where sc.scope = 'mine' and mine and service_date < v_today and not recorded
            union all select 'arrived', case_number, service_date, point_of_sale from stc where sc.scope = 'mine' and mine and app_done and not has_arrived
            union all select 'left', case_number, service_date, point_of_sale from stc where sc.scope = 'mine' and mine and app_done and not has_left
            union all select 'job_card', case_number, service_date, point_of_sale from stc where sc.scope = 'mine' and mine and app_done and not has_card and coalesce(case_type, '') <> 'Removal of Asset'
          ) z order by service_date desc limit 60) q)
    ) j from sc)
  select jsonb_build_object(
    'period', v_per, 'from', v_from, 'to', v_to - 1, 'today', v_today,
    'warehouse', v_wh, 'warehouse_name', v_group,
    'person', coalesce(v_slot.person_name, public.coolerco_person_name(auth.uid())),
    'worker_type', v_slot.worker_type, 'has_slot', v_slot.id is not null,
    'mine', (select j from agg where scope = 'mine'), 'team', (select j from agg where scope = 'team'),
    'today_stops', (select jsonb_build_object('stops', count(*), 'done', count(*) filter (where app_done))
                      from st where service_date = v_today and (v_slot.id is null or mine)))
  into v;
  return v;
end $$;
revoke all on function public.coolerco_field_board(text, date, text) from public, anon;
grant execute on function public.coolerco_field_board(text, date, text) to authenticated;
