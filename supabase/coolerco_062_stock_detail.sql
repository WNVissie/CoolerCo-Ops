-- 062 · Asset Stock drill-down (Wanda 25 Nov): per warehouse, by model × condition × branding —
-- total in the warehouse / workshop, available (Ready to Work and not promised), pending (promised to an open case or picked).
-- One read-only function for Magnum (COM assets) and the self-managed clients (CoolerCo register). No tables touched.
-- Magnum "pending" = same rule as picking (coolerco_pick_candidates): chosen in the routing app's preparation for an open case on a
-- live route of the last 14 days, or named on an open COM case. Clients: status Picked, an unreleased pick, or delivered on an open case.
-- Rows the user may not see (coolerco_can_see) are left out. Rollback: drop function public.coolerco_stock_detail(text, text);

create or replace function public.coolerco_stock_detail(p_client text default 'MAGNUM', p_warehouse text default null)
returns table (warehouse_code text, location_type text, model text, condition text, branding text,
               total integer, available integer, pending integer, not_ready integer)
language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
declare v_open text[] := array['Open','In Progress','Waiting','In Service','On Hold'];
begin
  if auth.uid() is null then raise exception 'sign in'; end if;
  if coalesce(p_client, 'MAGNUM') = 'MAGNUM' then
    if coalesce(public.coolerco_magnum_blocked(), false) then return; end if;
    return query
    with a as (
      select w.code wh, r.loc, a.name, a.asset_status, coalesce(nullif(a.product_base, ''), 'Unknown') pb,
             coalesce(nullif(a.condition, ''), 'Unknown') cond, coalesce(nullif(a.brand_hierarchy, ''), 'Unknown') br
        from public.assets_live a
        cross join lateral (select substring(a.assign_account, '^RTMA (.+) (?:WH|WS)$') region,
                                   case when a.assign_account ~ ' WS$' then 'Workshop' else 'Warehouse' end loc) r
        join public.warehouses w on w.name = r.region and w.warehouse_type = 'regional'
       where a.asset_location in ('Warehouse', 'Workshop') and a.assign_account ~ '^RTMA .+ (WH|WS)$'
         and (p_warehouse is null or w.code = p_warehouse)
    ), f as (
      select a.*, (exists (select 1 from public.routing_warehouse_preparation p join public.routing_routes rr on rr.id = p.route_id
                            where p.selected_asset_name = a.name and coalesce(rr.status, '') not in ('not_used', 'cancelled')
                              and rr.route_date >= current_date - 14
                              and exists (select 1 from public.cases c where c.case_number = p.case_number and c.status_reason = any(v_open)))
                   or exists (select 1 from public.cases c where c.status_reason = any(v_open)
                                and a.name in (c.asset_repaired, c.asset_removed, c.asset_delivered))) promised
        from a
    )
    select f.wh, f.loc, f.pb, f.cond, f.br, count(distinct f.name)::int,
           count(distinct f.name) filter (where f.asset_status = 'Ready to Work' and not f.promised)::int,
           count(distinct f.name) filter (where f.promised)::int,
           count(distinct f.name) filter (where f.asset_status <> 'Ready to Work' and not f.promised)::int
      from f where public.coolerco_can_see('MAGNUM', f.wh)
     group by 1, 2, 3, 4, 5;
  else
    return query
    with f as (
      select a.warehouse_code wh, 'Warehouse'::text loc, a.asset_number, a.status,
             coalesce(m.display_name, m.description, a.model_code, 'Unknown') pb,
             coalesce(nullif(a.condition, ''), 'Unknown') cond, coalesce(nullif(a.branding, ''), 'Unknown') br,
             (a.status = 'Picked'
              or exists (select 1 from public.coolerco_client_picks k where k.asset_number = a.asset_number and k.client_code = a.client_code and k.released_at is null
                           and exists (select 1 from public.coolerco_cases c where c.case_number = k.case_number and not public.coolerco_case_is_closed(c.status_reason)))
              or exists (select 1 from public.coolerco_cases c where c.client_code = a.client_code and not public.coolerco_case_is_closed(c.status_reason)
                           and a.asset_number in (c.asset_delivered, c.asset_repaired))) promised
        from public.coolerco_assets a
        left join public.coolerco_asset_models m on m.client_code = a.client_code and m.model_code = a.model_code
       where a.client_code = p_client and a.location_type = 'Warehouse'
         and (p_warehouse is null or a.warehouse_code = p_warehouse)
    )
    select f.wh, f.loc, f.pb, f.cond, f.br, count(*)::int,
           count(*) filter (where f.status = 'In warehouse, ready to work' and not f.promised)::int,
           count(*) filter (where f.promised)::int,
           count(*) filter (where f.status <> 'In warehouse, ready to work' and not f.promised)::int
      from f where public.coolerco_can_see(p_client, f.wh)
     group by 1, 2, 3, 4, 5;
  end if;
end $function$;

revoke all on function public.coolerco_stock_detail(text, text) from public, anon;
grant execute on function public.coolerco_stock_detail(text, text) to authenticated;
