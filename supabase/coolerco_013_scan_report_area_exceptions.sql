-- CoolerCo-Ops 013 — Scan report: area exceptions (READ ONLY)
-- Replaces OUR OWN function coolerco_scan_report (from 012) with the same inputs, adding:
--   • per row: scanned area, belongs-in area, area ok, touch id, is this the asset's latest CoolerCo scan
--   • result filter 'wrong_area' = latest CoolerCo scan of the asset is in the wrong area (not moved yet)
--   • summary: wrong_area count per warehouse
-- Nothing else is changed; no tables, no data writes.
-- Sources (both already readable by signed-in users through their own RLS):
--   • COM touches  = public.asset_touch          (COM Asset Touch import) at an "RTMA … WH/WS" location
--   • CoolerCo scans = public.coolerco_com_touch_export (our bay scans + COM verdict)
-- Dates are South African days (Africa/Johannesburg).
-- Rollback:  re-run supabase/coolerco_012_scan_report.sql (puts the 012 version back).

create or replace function public.coolerco_scan_report(
  p_from      date,
  p_to        date,
  p_warehouse text default null,   -- app code: JHB, CPT, BFN, DBN, EL, GEO, NEL, POL, PE (null = all)
  p_source    text default 'all',  -- all | com | coolerco
  p_result    text default 'all',  -- all | accepted | discarded | pending | mismatch | wrong_area
  p_search    text default null,   -- asset / barcode / local code / model / user
  p_limit     int  default 100,
  p_offset    int  default 0
) returns json
language sql stable security invoker
set search_path = public
as $$
with wh(code, name) as (values
  ('JHB','Gauteng'),('CPT','Cape Town'),('BFN','Bloemfontein'),('DBN','Durban'),('EL','East London'),
  ('GEO','George'),('NEL','Nelspruit'),('POL','Polokwane'),('PE','Port Elizabeth')),
rng as (
  select (p_from::timestamp at time zone 'Africa/Johannesburg') as t0,
         ((p_to + 1)::timestamp at time zone 'Africa/Johannesburg') as t1),
com as (
  select 'COM'::text as source, t.touched_at as at, w.code as wh,
         case when t.location ~* ' WS$' then 'WS' else 'WH' end as wh_ws,
         coalesce(nullif(t.asset_number,''), t.barcode) as asset_key,
         t.asset_number as asset, t.barcode, t.local_code, t.product_base, t.condition,
         t.portal_user_created_by as scanned_by, null::text as bay,
         t.status_reason as result,
         (coalesce(t.condition_mismatch,'') = 'Yes' or coalesce(t.location_mismatch,'') = 'Yes'
          or coalesce(t.serial_number_mismatch,'') = 'Yes' or coalesce(t.brand_hierarchy_mismatch,'') = 'Yes'
          or coalesce(t.product_base_mismatch,'') = 'Yes' or coalesce(t.product_variant_mismatch,'') = 'Yes') as mismatch,
         null::boolean as bay_ok, t.processing_message as note,
         null::text as scanned_area, null::text as belongs_area, null::boolean as area_ok, null::uuid as touch_id, null::boolean as is_latest
  from asset_touch t
  join wh w on t.location ilike 'RTMA ' || w.name || ' W_'
  , rng
  where p_source in ('all','com') and t.touched_at >= rng.t0 and t.touched_at < rng.t1),
cc as (
  select 'CoolerCo'::text, v.created_at, v.warehouse_code,
         case when coalesce(v.location,'') ~* ' WS$' then 'WS' else 'WH' end,
         coalesce(nullif(v.asset,''), v.barcode),
         v.asset, v.barcode, v.local_code, coalesce(v.product_base, v.asset_product_base), coalesce(v.condition, v.asset_condition),
         v.scanned_by, v.bay,
         coalesce(v.com_status_reason, case v.touch_status when 'New' then 'Not submitted' else v.touch_status end),
         coalesce(v.any_mismatch, false) or v.bay_ok = false or v.location_ok = false,
         v.bay_ok, v.notes,
         sl.label, el.label, t.location_ok, t.id,
         not exists (select 1 from coolerco_asset_touch n where n.asset_name = t.asset_name and n.created_at > t.created_at)
  from coolerco_com_touch_export v
  join coolerco_asset_touch t on t.id = v.id
  left join coolerco_wh_locations sl on sl.id = t.location_id
  left join coolerco_wh_locations el on el.id = t.expected_location_id
  , rng
  where p_source in ('all','coolerco') and v.created_at >= rng.t0 and v.created_at < rng.t1),
allrows as (select * from com union all select * from cc),
f as (
  select a.* from allrows a
  where (p_warehouse is null or a.wh = p_warehouse)
    and (p_result = 'all'
         or (p_result = 'accepted'  and a.result = 'Accepted')
         or (p_result = 'discarded' and a.result = 'Discarded')
         or (p_result = 'pending'   and coalesce(a.result,'') not in ('Accepted','Discarded'))
         or (p_result = 'mismatch'  and a.mismatch)
         or (p_result = 'wrong_area' and a.area_ok = false and a.is_latest))
    and (coalesce(p_search,'') = '' or concat_ws(' ', a.asset, a.barcode, a.local_code, a.product_base, a.scanned_by) ilike '%' || p_search || '%'))
select json_build_object(
  'total', (select count(*) from f),
  'summary', coalesce((select json_agg(s order by s.scans desc) from (
      select w.code, w.name,
             count(f.at)                                              as scans,
             count(distinct f.asset_key)                              as assets,
             count(*) filter (where f.source = 'COM')                 as com_scans,
             count(*) filter (where f.source = 'CoolerCo')            as coolerco_scans,
             count(*) filter (where f.result = 'Accepted')            as accepted,
             count(*) filter (where f.result = 'Discarded')           as discarded,
             count(*) filter (where f.mismatch)                       as mismatches,
             count(*) filter (where f.wh_ws = 'WS')                   as workshop,
             count(*) filter (where f.area_ok = false and f.is_latest) as wrong_area,
             max(f.at)                                                as last_at
      from wh w join f on f.wh = w.code
      group by w.code, w.name) s), '[]'::json),
  'days', coalesce((select json_agg(d order by d.day) from (
      select (f.at at time zone 'Africa/Johannesburg')::date as day, count(*) as scans, count(distinct f.asset_key) as assets
      from f group by 1) d), '[]'::json),
  'users', coalesce((select json_agg(u order by u.scans desc) from (
      select f.wh, f.scanned_by, count(*) as scans from f group by 1, 2 order by 3 desc limit 50) u), '[]'::json),
  'rows', coalesce((select json_agg(r) from (
      select * from f order by f.at desc limit greatest(1, least(p_limit, 20000)) offset greatest(0, p_offset)) r), '[]'::json)
);
$$;

revoke all on function public.coolerco_scan_report(date, date, text, text, text, text, int, int) from public, anon;
grant execute on function public.coolerco_scan_report(date, date, text, text, text, text, int, int) to authenticated;
