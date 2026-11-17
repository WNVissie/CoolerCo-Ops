-- CoolerCo-Ops · 035 · RUN ON TEST ONLY — 🧪 Test route builder
-- Why: routing happens in RouteIQ on PRODUCTION, and RouteIQ only reads COM `cases`. Tiger / CoolerCo cases logged on
--      TEST can therefore never become a route. This lets a supervisor make TEST ROUTES on the TEST database so the whole
--      field flow (crew, My trip, job card, delays, POS reports) can be tested with any open case — Tiger, CoolerCo or COM.
-- ⚠️ REMINDER: in production, routes come from RouteIQ (the routing app). These test routes exist only on TEST.
--    Every function here REFUSES to run on production (it checks for the production-only schema coolerco_export).
-- Writes: routing_routes / routing_route_versions / routing_route_stops on TEST (route numbers start with "TEST-",
--   created_by_label "CoolerCo test route"), plus coolerco_test_routes (which routes are test routes).
--   The twice-daily copy from production never touches these rows (different ids and route numbers).
-- Requires: 028 (coolerco_all_cases), 034 (slots, planner role).
-- Rollback: coolerco_035_rollback.sql (deletes all test routes first)

create or replace function public.coolerco_is_test_db() returns boolean
language sql stable as $$ select to_regnamespace('coolerco_export') is null $$;

create table if not exists public.coolerco_test_routes (
  route_id   uuid primary key references public.routing_routes(id) on delete cascade,
  cases      text[] not null,
  note       text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.coolerco_test_routes enable row level security;
revoke all on public.coolerco_test_routes from public, anon, authenticated;
grant select on public.coolerco_test_routes to authenticated;           -- the app shows "🧪 test route" banners
drop policy if exists coolerco_test_routes_read on public.coolerco_test_routes;
create policy coolerco_test_routes_read on public.coolerco_test_routes for select to authenticated using (true);

-- open cases that could go on a test route (COM + CoolerCo / Tiger), for a warehouse
create or replace function public.coolerco_test_route_candidates(p_warehouse text, p_search text default null, p_source text default 'all')
returns table (case_number text, source text, client_code text, case_type text, status_reason text, point_of_sale text,
               pos_local_code text, created_on timestamptz, routed_today boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.coolerco_is_planner() then raise exception 'Only supervisors / planners can build test routes'; end if;
  return query
  select c.case_number, c.source, c.client_code, c.case_type, c.status_reason, c.point_of_sale, c.pos_local_code, c.created_on,
         exists (select 1 from public.routing_route_stops s join public.routing_routes r on r.id = s.route_id
                  where s.case_number = c.case_number and r.route_date = current_date and r.status <> 'not_used')
    from public.coolerco_all_cases c
   where c.is_open and c.warehouse_workshop = public.coolerco_wh_group(p_warehouse)
     and (p_source = 'all' or (p_source = 'com' and c.source = 'COM') or (p_source = 'coolerco' and c.source <> 'COM'))
     and (nullif(trim(p_search), '') is null or c.case_number ilike '%' || trim(p_search) || '%' or c.point_of_sale ilike '%' || trim(p_search) || '%'
          or c.pos_local_code ilike '%' || trim(p_search) || '%')
   order by (c.source <> 'COM') desc, c.created_on desc
   limit 200;
end $$;
revoke all on function public.coolerco_test_route_candidates(text, text, text) from public, anon;
grant execute on function public.coolerco_test_route_candidates(text, text, text) to authenticated;

-- make a test route: date, warehouse, the RouteIQ slot it is planned on (or a field slot), cases in visiting order
create or replace function public.coolerco_test_route_create(p_date date, p_warehouse text, p_slot text, p_cases text[], p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_route uuid := gen_random_uuid(); v_ver uuid := gen_random_uuid(); v_no text; v_group text := public.coolerco_wh_group(p_warehouse);
  v_slot public.coolerco_field_slots; v_name text; v_type text; v_case text; v_seq int := 0; v_assets int := 0;
  c record; v_bc jsonb; v_pb jsonb; v_n int; v_lat double precision; v_lng double precision; v_addr text;
begin
  if not public.coolerco_is_test_db() then raise exception 'Test routes can only be made on the TEST database. In production, routes come from RouteIQ.'; end if;
  if not public.coolerco_is_planner() then raise exception 'Only supervisors / planners can build test routes'; end if;
  if v_group is null then raise exception 'Unknown warehouse %', p_warehouse; end if;
  if coalesce(cardinality(p_cases), 0) = 0 then raise exception 'Pick at least one case'; end if;

  select * into v_slot from public.coolerco_field_slots where upper(routeiq_username) = upper(p_slot) or id::text = p_slot limit 1;
  v_type := coalesce(v_slot.worker_type, (select worker_type from public.routing_portal_users where portal_username = p_slot), 'driver');
  v_name := coalesce((select display_name from public.routing_portal_users where portal_username = coalesce(v_slot.routeiq_username, p_slot)),
                     v_slot.person_name, p_slot);
  v_no := 'TEST-' || upper(p_warehouse) || '-' || to_char(p_date, 'DDMM') || '-' ||
          (select count(*) + 1 from public.routing_routes where route_number like 'TEST-' || upper(p_warehouse) || '-' || to_char(p_date, 'DDMM') || '-%');

  insert into public.routing_routes (id, route_number, warehouse_group, route_group, route_date, status, current_version,
         resource_username, resource_display_name, planned_start_at, planned_stop_count, planned_asset_count, planning_deferred_count,
         created_by, created_by_label, finalised_by, finalised_by_label, finalised_at, is_ncd)
  values (v_route, v_no, v_group, case when v_type = 'technician' then 'repair' else 'logistics' end, p_date, 'finalised', 1,
          coalesce(v_slot.routeiq_username, p_slot), '🧪 ' || v_name, (p_date + time '08:00') at time zone 'Africa/Johannesburg',
          0, 0, 0, auth.uid(), 'CoolerCo test route', auth.uid(), 'CoolerCo test route', now(), false);
  insert into public.routing_route_versions (id, route_id, version_number, is_current, change_reason, created_by, created_by_label)
  values (v_ver, v_route, 1, true, 'CoolerCo test route (TEST database only)', auth.uid(), 'CoolerCo test route');

  foreach v_case in array p_cases loop
    select * into c from public.coolerco_all_cases where case_number = v_case;
    if c.case_number is null then raise exception 'Case % not found', v_case; end if;
    v_seq := v_seq + 1;
    -- the case's asset(s) for the stop (barcode + model), from the asset register
    select coalesce(jsonb_agg(l.bar_code) filter (where l.bar_code is not null), '[]'), coalesce(jsonb_agg(l.product_base) filter (where l.bar_code is not null), '[]'), count(l.bar_code)
      into v_bc, v_pb, v_n
      from unnest(array_remove(array[c.asset_removed, c.asset_repaired, case when c.case_type ilike '%replacement%' then null else c.asset_delivered end], null)) x(ast)
      left join public.assets_live l on l.name = x.ast;
    -- where the store is: the case's own GPS (CoolerCo cases), else the POS register
    v_lat := null; v_lng := null; v_addr := null;
    select p.latitude, p.longitude, p.address into v_lat, v_lng, v_addr from public.latest_pos_records p where p.pos_id = c.pos_local_code limit 1;
    if v_lat is null then
      select cc.latitude, cc.longitude, cc.address into v_lat, v_lng, v_addr from public.coolerco_cases cc where cc.case_number = v_case;
    end if;
    insert into public.routing_route_stops (route_id, route_version_id, stop_sequence, route_day, service_date, case_number, case_type,
           case_status_at_plan, warehouse_at_plan, pos_local_code, point_of_sale, address, latitude, longitude,
           asset_barcodes, asset_product_bases, asset_count, outcome_status, carryover_count, destination_source)
    values (v_route, v_ver, v_seq, 1, p_date, c.case_number, c.case_type, c.status_reason, v_group, c.pos_local_code, c.point_of_sale,
            v_addr, v_lat, v_lng, v_bc, v_pb, v_n, 'planned', 0, 'coolerco_test');
    v_assets := v_assets + v_n;
  end loop;
  update public.routing_routes set planned_stop_count = v_seq, planned_asset_count = v_assets where id = v_route;
  insert into public.coolerco_test_routes (route_id, cases, note) values (v_route, p_cases, p_note);
  return jsonb_build_object('route_id', v_route, 'route_number', v_no, 'stops', v_seq);
end $$;
revoke all on function public.coolerco_test_route_create(date, text, text, text[], text) from public, anon;
grant execute on function public.coolerco_test_route_create(date, text, text, text[], text) to authenticated;

create or replace function public.coolerco_test_route_list(p_date date, p_warehouse text)
returns table (route_id uuid, route_number text, slot text, slot_name text, stops int, cases text[], note text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.coolerco_is_planner() then raise exception 'Only supervisors / planners can see test routes'; end if;
  return query select r.id, r.route_number, r.resource_username, r.resource_display_name, r.planned_stop_count, t.cases, t.note, t.created_at
    from public.coolerco_test_routes t join public.routing_routes r on r.id = t.route_id
   where r.route_date = p_date and r.warehouse_group = public.coolerco_wh_group(p_warehouse) order by r.route_number;
end $$;
revoke all on function public.coolerco_test_route_list(date, text) from public, anon;
grant execute on function public.coolerco_test_route_list(date, text) to authenticated;

create or replace function public.coolerco_test_route_delete(p_route uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.coolerco_is_test_db() then raise exception 'Only on the TEST database'; end if;
  if not public.coolerco_is_planner() then raise exception 'Only supervisors / planners can delete test routes'; end if;
  if not exists (select 1 from public.coolerco_test_routes where route_id = p_route) then raise exception 'That is not a test route — real routes are managed in RouteIQ'; end if;
  delete from public.routing_case_assignments where route_id = p_route;
  delete from public.routing_routes where id = p_route;   -- versions, stops and the test-route row go with it
end $$;
revoke all on function public.coolerco_test_route_delete(uuid) from public, anon;
grant execute on function public.coolerco_test_route_delete(uuid) to authenticated;

select public.coolerco_is_test_db() as is_test_database;
