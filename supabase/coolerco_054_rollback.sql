-- 054 rollback: 035's version of coolerco_test_route_candidates

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
