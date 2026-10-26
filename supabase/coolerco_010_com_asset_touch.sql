-- CoolerCo-Ops · 010 · Bay scan = COM Asset Touch + stock-take exceptions
-- ADDITIVE, CoolerCo objects only: new columns on coolerco_asset_touch + coolerco_warehouse_settings,
-- two read views, one read function. COM / SmartScan tables (assets_live, asset_touch,
-- asset_touch_periods, asset_touch_period_assets) are only READ — nothing in them changes.
--
-- Flow (Wanda 2026-10-26): scan → touch_status 'New' → user taps Submit → 'Submitted' → CSV sync to COM
-- with Status Reason "Submited" (starts COM's workflow) → 'Synced'. COM then Accepts / Discards; we read
-- that back from COM's asset_touch import (same asset, same touched-at time).

-- 1. What the scanner found (sent to COM) + our own bay/area check (NOT sent to COM) + flow
alter table public.coolerco_asset_touch
  add column if not exists touch_status          text not null default 'New',  -- New | Submitted | Synced
  add column if not exists submitted_at          timestamptz,
  add column if not exists submitted_by          text,
  add column if not exists com_location          text,        -- e.g. RTMA Gauteng WH / RTMA Gauteng WS
  add column if not exists external_status       text,        -- COM list, e.g. Asset Found in Expected Location
  add column if not exists condition_found       text,        -- A - New … D - Back of House only
  add column if not exists brand_found           text,        -- Brand Hierarchy
  add column if not exists product_base_found    text,
  add column if not exists product_variant_found text,
  add column if not exists serial_found          text,
  add column if not exists latitude              numeric,
  add column if not exists longitude             numeric,
  add column if not exists photo_paths           text[],      -- barcode / asset / property plate (+ extra)
  add column if not exists expected_bay          text,        -- from COM asset status (our side only)
  add column if not exists bay_ok                boolean,
  add column if not exists expected_location_id  uuid,        -- building/area rule (our side only)
  add column if not exists location_ok           boolean,
  add column if not exists com_user              text,        -- Portal User Created By
  add column if not exists com_exported_at       timestamptz,
  add column if not exists com_export_batch      text;
create index if not exists idx_coolerco_asset_touch_export on public.coolerco_asset_touch (touch_status, created_at);
create index if not exists idx_coolerco_asset_touch_asset  on public.coolerco_asset_touch (asset_name, created_at desc);

-- 2. COM portal user per warehouse (from COM's own touches; editable later)
alter table public.coolerco_warehouse_settings add column if not exists com_portal_user text;
update public.coolerco_warehouse_settings s set com_portal_user = v.u
from (values ('JHB','RTMAWH2Gauteng'),('DBN','RTMAWHDBN'),('CPT','RTMACTNWH'),('BFN','RTMAWHBLOEM'),('EL','RTMWHEL'),
             ('GEO','RTMAWHGRG'),('NEL','RTMANELWH'),('POL','RTMAWHPOL'),('PE','PortalPE')) v(w, u)
where s.warehouse_code = v.w and s.com_portal_user is null;

-- 3. Dropdown values from the COM asset register (server-side distinct — small payload)
create or replace view public.coolerco_asset_options as
select 'brand'::text as kind, brand_hierarchy as value, null::text as base, count(*) as n
  from public.assets_live where brand_hierarchy is not null group by brand_hierarchy
union all
select 'model', product_variant, min(product_base), count(*)
  from public.assets_live where product_variant is not null group by product_variant;
alter view public.coolerco_asset_options set (security_invoker = true);
revoke all on public.coolerco_asset_options from anon;
grant select on public.coolerco_asset_options to authenticated;

-- 4. Scan vs COM asset register (+ COM's own verdict once their touch comes back)
create or replace view public.coolerco_com_touch_export as
select t.id, t.created_at, t.touch_status, t.submitted_at, t.submitted_by, t.com_exported_at, t.com_export_batch,
       t.scanned_by, t.bay, t.expected_bay, t.bay_ok, t.location_ok, t.warehouse_name, w.code as warehouse_code,
       t.photo_paths, t.notes, t.latitude, t.longitude,
       row_number() over (partition by t.asset_name, (t.created_at at time zone 'Africa/Johannesburg')::date order by t.created_at desc) = 1 as latest_of_day,
       -- what we send (scan fields)
       t.created_at                                         as touched_at,
       coalesce(t.external_status,
         case when t.com_location = a.assign_account then 'Asset Found in Expected Location' else 'Asset Not in Expected Location' end) as external_status,
       coalesce(t.serial_found, a.serial_number)            as serial_number,
       coalesce(a.bar_code, t.bar_code)                     as barcode,
       coalesce(a.local_code, t.local_code)                 as local_code,
       a.external_code,
       t.com_location                                       as location,
       t.asset_name                                         as asset,
       coalesce(t.brand_found, a.brand_hierarchy)           as brand_hierarchy,
       coalesce(t.condition_found, a.condition)             as condition,
       coalesce(t.com_user, s.com_portal_user)              as portal_user,
       coalesce(t.product_base_found, a.product_base)       as product_base,
       coalesce(t.product_variant_found, a.product_variant) as product_variant,
       -- what COM holds (for our comparison only — not sent)
       a.name is not null as asset_known,
       a.serial_number as asset_serial_number, a.condition as asset_condition, a.brand_hierarchy as asset_brand_hierarchy,
       a.product_base as asset_product_base, a.product_variant as asset_product_variant, a.assign_account as asset_assign_account,
       a.asset_status, a.sap_number, a.asset_location as asset_location,
       a.gps_latitude as asset_gps_latitude, a.gps_longitude as asset_gps_longitude,
       a.pos_external_code as asset_pos_external_code, a.pos_local_code as asset_pos_local_code, a.related_case as asset_related_case,
       -- mismatch flags (scan vs assets_live)
       (t.serial_found is not null and t.serial_found is distinct from a.serial_number)                  as serial_mismatch,
       (t.condition_found is not null and t.condition_found is distinct from a.condition)                as condition_mismatch,
       (t.brand_found is not null and t.brand_found is distinct from a.brand_hierarchy)                  as brand_mismatch,
       (t.product_variant_found is not null and t.product_variant_found is distinct from a.product_variant) as model_mismatch,
       (t.com_location is distinct from a.assign_account)                                                as location_mismatch,
       (a.name is null
        or (t.serial_found is not null and t.serial_found is distinct from a.serial_number)
        or (t.condition_found is not null and t.condition_found is distinct from a.condition)
        or (t.brand_found is not null and t.brand_found is distinct from a.brand_hierarchy)
        or (t.product_variant_found is not null and t.product_variant_found is distinct from a.product_variant)
        or t.com_location is distinct from a.assign_account)                                            as any_mismatch,
       -- COM's verdict (their touch import, same asset ± 5 min)
       c.name as com_touch_name, c.status_reason as com_status_reason, c.external_status as com_external_status,
       c.processing_message as com_processing_message
from public.coolerco_asset_touch t
left join public.assets_live a on a.name = t.asset_name
left join public.warehouses w on w.id = t.warehouse_id
left join public.coolerco_warehouse_settings s on s.warehouse_code = w.code
left join lateral (
  select x.name, x.status_reason, x.external_status, x.processing_message from public.asset_touch x
  where x.asset_number = t.asset_name and x.touched_at between t.created_at - interval '5 minutes' and t.created_at + interval '5 minutes'
  order by abs(extract(epoch from x.touched_at - t.created_at)) limit 1) c on t.com_exported_at is not null;
alter view public.coolerco_com_touch_export set (security_invoker = true);
revoke all on public.coolerco_com_touch_export from anon;
grant select on public.coolerco_com_touch_export to authenticated;

-- 5. Stock-take exceptions against SmartScan's stock-take period (read only)
--    In baseline  = in the period snapshot and still in that warehouse now
--    Moved out    = in the snapshot, but no longer in that warehouse (delivered, transferred, scrapped…)
--    Moved in     = in the warehouse now, but not in the snapshot (received during the period)
--    Scanned      = a CoolerCo scan (our table) or a COM touch at an RTMA location, between start and end date
create or replace function public.coolerco_stocktake_exceptions(p_period uuid, p_warehouse text default null)
returns table (asset_number text, warehouse text, category text, scanned boolean, scan_source text, last_scan_at timestamptz,
               scan_location text, barcode text, local_code text, product_base text, condition text,
               baseline_status text, current_status text, current_location text, current_account text)
language sql stable security invoker set search_path = public, pg_temp as $$
  with p as (
    select id, scope, (start_date::timestamp at time zone 'Africa/Johannesburg') t0, ((end_date + 1)::timestamp at time zone 'Africa/Johannesburg') t1
    from public.asset_touch_periods where id = p_period and scope = 'warehouse'
  ),
  now_wh as (
    select a.*, public.asset_touch_warehouse(a.assign_account) wh from public.assets_live a
    where lower(trim(a.asset_location)) in ('warehouse','workshop') and a.assign_account ilike '%RTMA%'
  ),
  base as (
    select b.asset_number, b.warehouse, b.baseline from public.asset_touch_period_assets b join p on p.id = b.period_id
    where p_warehouse is null or b.warehouse = upper(p_warehouse)
  ),
  rows as (
    select b.asset_number, b.warehouse,
           case when n.name is not null and n.wh = b.warehouse then 'In baseline' else 'Moved out' end category,
           b.baseline->>'bar_code' barcode, b.baseline->>'local_code' local_code, b.baseline->>'product_base' product_base,
           coalesce(a.condition, b.baseline->>'condition') condition, b.baseline->>'asset_status' baseline_status,
           a.asset_status current_status, a.asset_location current_location, a.assign_account current_account
    from base b
    left join public.assets_live a on a.name = b.asset_number
    left join now_wh n on n.name = b.asset_number
    union all
    select n.name, n.wh, 'Moved in', n.bar_code, n.local_code, n.product_base, n.condition, null, n.asset_status, n.asset_location, n.assign_account
    from now_wh n
    where (p_warehouse is null or n.wh = upper(p_warehouse))
      and exists (select 1 from p)
      and not exists (select 1 from public.asset_touch_period_assets b where b.period_id = p_period and b.asset_number = n.name)
  )
  select r.asset_number, r.warehouse, r.category,
         (cc.at is not null or com.at is not null) scanned,
         case when cc.at is not null and com.at is not null then 'CoolerCo + COM' when cc.at is not null then 'CoolerCo' when com.at is not null then 'COM' end,
         greatest(cc.at, com.at), coalesce(case when cc.at >= coalesce(com.at, cc.at) then cc.loc end, com.loc),
         r.barcode, r.local_code, r.product_base, r.condition, r.baseline_status, r.current_status, r.current_location, r.current_account
  from rows r cross join p
  left join lateral (select t.created_at at, coalesce(t.com_location, t.warehouse_name) loc from public.coolerco_asset_touch t
                     where t.asset_name = r.asset_number and t.created_at >= p.t0 and t.created_at < p.t1
                     order by t.created_at desc limit 1) cc on true
  left join lateral (select x.touched_at at, x.location loc from public.asset_touch x
                     where x.asset_number = r.asset_number and x.location ilike '%RTMA%' and x.touched_at >= p.t0 and x.touched_at < p.t1
                     order by x.touched_at desc limit 1) com on true
$$;
revoke all on function public.coolerco_stocktake_exceptions(uuid, text) from public, anon;
grant execute on function public.coolerco_stocktake_exceptions(uuid, text) to authenticated;

-- 6. Lock down our scan table (was RLS off + anon access; it is a CoolerCo table, 0 rows at the time)
alter table public.coolerco_asset_touch enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'coolerco_asset_touch' and policyname = 'coolerco_asset_touch_staff') then
    create policy coolerco_asset_touch_staff on public.coolerco_asset_touch for all to authenticated using (true) with check (true);
  end if;
end $$;
revoke all on public.coolerco_asset_touch from anon;
