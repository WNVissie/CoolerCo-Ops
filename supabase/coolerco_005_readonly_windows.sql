-- CoolerCo-Ops · 005 · Read-only "windows" onto routing preparation and COM repair lines
-- Target: RTMA_Ops PRODUCTION. ADDITIVE ONLY: two NEW functions. The existing tables
-- (routing_warehouse_preparation, routing_routes, routing_route_stops, case_repairs) and their
-- permissions are NOT changed. Functions only SELECT; signed-in staff only.

create or replace function public.coolerco_picking_queue(p_from date default (current_date - 7), p_warehouse text default null)
returns table (
  route_id uuid, route_number text, route_date date, warehouse_group text, route_status text,
  driver text, vehicle_code text,
  case_number text, case_type text, point_of_sale text, pos_local_code text, stop_sequence int,
  picked boolean, picked_at timestamptz, rtw boolean, rtw_at timestamptz, packed boolean, packed_at timestamptz,
  returned boolean, bay text, is_ncd boolean,
  selected_asset_name text, selected_bar_code text, selected_local_code text,
  selected_product_base text, selected_condition text, selected_branding text,
  returned_asset_name text, returned_bar_code text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id, r.route_number, r.route_date, r.warehouse_group, r.status,
         r.resource_display_name, r.vehicle_code,
         p.case_number, s.case_type, s.point_of_sale, s.pos_local_code, s.stop_sequence,
         p.picked, p.picked_at, p.rtw, p.rtw_at, p.packed, p.packed_at,
         p.returned, p.bay, p.is_ncd,
         p.selected_asset_name, p.selected_bar_code, p.selected_local_code,
         p.selected_product_base, p.selected_condition, p.selected_branding,
         p.returned_asset_name, p.returned_bar_code
  from public.routing_warehouse_preparation p
  join public.routing_routes r on r.id = p.route_id
  left join lateral (
    select st.case_type, st.point_of_sale, st.pos_local_code, st.stop_sequence
    from public.routing_route_stops st
    where st.route_id = p.route_id and st.case_number = p.case_number
    order by st.created_at desc
    limit 1
  ) s on true
  where r.route_date >= coalesce(p_from, current_date - 7)
    and (p_warehouse is null or r.warehouse_group = p_warehouse)
    and coalesce(r.status, '') not in ('not_used')
  order by r.route_date, r.warehouse_group, r.route_number, s.stop_sequence nulls last
  limit 2000
$$;

create or replace function public.coolerco_asset_repairs(p_asset text)
returns table (
  repair_id text, case_number text, created_on timestamptz, case_type text, case_status_reason text,
  repair_code text, repair_name text, technician text, workshop text, warehouse text,
  damage_origin text, reason text, component_type text, component_model text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.repair_id::text, r.case_number, r.created_on, r.case_type, r.case_status_reason,
         r.repair_code, r.repair_name, r.technician, r.workshop, r.warehouse,
         r.damage_origin, r.reason, r.component_type, r.component_model
  from public.case_repairs r
  where nullif(trim(p_asset), '') is not null
    and (r.asset_number = p_asset
         or r.case_number in (select c.case_number from public.cases c where c.asset_repaired = p_asset))
  order by r.created_on desc nulls last
  limit 200
$$;

revoke all on function public.coolerco_picking_queue(date, text) from public, anon;
revoke all on function public.coolerco_asset_repairs(text) from public, anon;
grant execute on function public.coolerco_picking_queue(date, text) to authenticated;
grant execute on function public.coolerco_asset_repairs(text) to authenticated;
