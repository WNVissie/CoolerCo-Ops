-- CoolerCo-Ops · 010 · Bay scan = COM Asset Touch (CSV export for COM import)
-- ADDITIVE, CoolerCo objects only: new columns on coolerco_asset_touch + coolerco_warehouse_settings,
-- two new read views. COM tables (assets_live, asset_touch) are only READ.

-- 1. What the scanner found (sent to COM) + our own bay/area check (NOT sent to COM)
alter table public.coolerco_asset_touch
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
create index if not exists idx_coolerco_asset_touch_export on public.coolerco_asset_touch (com_exported_at, created_at);

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

-- 4. Export rows: scan + COM asset, one row per scan; latest_of_day flags the row to send per asset per day
create or replace view public.coolerco_com_touch_export as
select t.id, t.created_at, t.com_exported_at, t.com_export_batch, t.scanned_by, t.bay, t.expected_bay, t.bay_ok, t.location_ok,
       t.warehouse_name, w.code as warehouse_code, t.photo_paths, t.notes,
       row_number() over (partition by t.asset_name, (t.created_at at time zone 'Africa/Johannesburg')::date order by t.created_at desc) = 1 as latest_of_day,
       -- CSV fields (COM Asset Touch)
       t.created_at                                         as touched_at,
       coalesce(t.external_status,
         case when t.com_location = a.assign_account then 'Asset Found in Expected Location' else 'Asset Not in Expected Location' end) as external_status,
       coalesce(t.serial_found, a.serial_number)            as serial_number,
       a.bar_code                                           as barcode,
       a.local_code, a.external_code,
       t.com_location                                       as location,
       t.asset_name                                         as asset,
       coalesce(t.brand_found, a.brand_hierarchy)           as brand_hierarchy,
       coalesce(t.condition_found, a.condition)             as condition,
       coalesce(t.com_user, s.com_portal_user)              as portal_user,
       case when t.com_location is distinct from a.assign_account then 'Yes' else 'No' end as location_mismatch,
       coalesce(t.product_base_found, a.product_base)       as product_base,
       coalesce(t.product_variant_found, a.product_variant) as product_variant,
       -- reference: what COM holds today
       a.condition as asset_condition, a.gps_latitude as asset_gps_latitude, a.gps_longitude as asset_gps_longitude,
       a.pos_external_code as asset_pos_external_code, a.pos_local_code as asset_pos_local_code,
       a.product_base as asset_product_base, a.product_variant as asset_product_variant, a.related_case as asset_related_case,
       a.brand_hierarchy as asset_brand_hierarchy, a.serial_number as asset_serial_number, a.asset_status, a.sap_number,
       a.assign_account as asset_assign_account, t.latitude, t.longitude
from public.coolerco_asset_touch t
left join public.assets_live a on a.name = t.asset_name
left join public.warehouses w on w.id = t.warehouse_id
left join public.coolerco_warehouse_settings s on s.warehouse_code = w.code;
alter view public.coolerco_com_touch_export set (security_invoker = true);
revoke all on public.coolerco_com_touch_export from anon;
grant select on public.coolerco_com_touch_export to authenticated;

-- 5. Lock down our scan table (was RLS off + anon access; it is a CoolerCo table, 0 rows at the time)
alter table public.coolerco_asset_touch enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'coolerco_asset_touch' and policyname = 'coolerco_asset_touch_staff') then
    create policy coolerco_asset_touch_staff on public.coolerco_asset_touch for all to authenticated using (true) with check (true);
  end if;
end $$;
revoke all on public.coolerco_asset_touch from anon;
