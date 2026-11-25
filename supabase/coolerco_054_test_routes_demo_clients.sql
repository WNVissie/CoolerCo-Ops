-- 054 · Test routes: offer the Demo / Demo Foods (and later Tiger) cases too (Wanda 2026-11-25: "add the two demo clients to the test routes")
-- Their cases sit in their own warehouses ("Demo Gauteng", WH-DM-JHB), not "RTMA Gauteng", so 035 never listed them.
-- Now a case belongs to the picked warehouse when its warehouse is the RTMA group OR the same city's client warehouse.
-- TEST and production safe (read-only function). Rollback: coolerco_054_rollback.sql (puts back 035's version).
create or replace function public.coolerco_test_route_candidates(p_warehouse text, p_search text default null, p_source text default 'all')
returns table (case_number text, source text, client_code text, case_type text, status_reason text, point_of_sale text,
               pos_local_code text, created_on timestamptz, routed_today boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_group text := public.coolerco_wh_group(p_warehouse);
begin
  if not public.coolerco_is_planner() then raise exception 'Only supervisors / planners can build test routes'; end if;
  return query
  select c.case_number, c.source, c.client_code, c.case_type, c.status_reason, c.point_of_sale, c.pos_local_code, c.created_on,
         exists (select 1 from public.routing_route_stops s join public.routing_routes r on r.id = s.route_id
                  where s.case_number = c.case_number and r.route_date = current_date and r.status <> 'not_used')
    from public.coolerco_all_cases c
    left join public.coolerco_cases k on k.case_number = c.case_number
   where c.is_open
     and (c.warehouse_workshop = v_group                                   -- RTMA warehouse (COM + Magnum portal cases)
          or k.warehouse_code = 'WH-DM-' || upper(p_warehouse)             -- demo clients' warehouse in the same city
          or c.warehouse_workshop = regexp_replace(v_group, '^RTMA ', 'Demo ')
          or (k.case_number is not null and k.warehouse_code = upper(p_warehouse)))
     and (p_source = 'all' or (p_source = 'com' and c.source = 'COM') or (p_source = 'coolerco' and c.source <> 'COM'))
     and (nullif(trim(p_search), '') is null or c.case_number ilike '%' || trim(p_search) || '%' or c.point_of_sale ilike '%' || trim(p_search) || '%'
          or c.pos_local_code ilike '%' || trim(p_search) || '%')
   order by (c.source <> 'COM') desc, c.created_on desc
   limit 200;
end $$;
revoke all on function public.coolerco_test_route_candidates(text, text, text) from public, anon;
grant execute on function public.coolerco_test_route_candidates(text, text, text) to authenticated;
