-- 060b · TEST ONLY: demo "last seen" history so the not-scanned report has amber / orange / red coolers to show.
-- Every Demo / Demo Foods cooler at a store gets one sighting 0-130 days ago (fixed pattern, not random, so the demo repeats);
-- a few get none (never seen). Source 'seed' so it can be removed: delete from coolerco_asset_sightings where source = 'seed'.
do $s$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'coolerco_export') then raise exception 'TEST only'; end if;
  delete from public.coolerco_asset_sightings where source = 'seed';
  insert into public.coolerco_asset_sightings (client_code, asset_number, outlet_code, seen_at, source, by_label)
  select a.client_code, a.asset_number, a.location_code,
         now() - make_interval(days => (array[3, 12, 20, 34, 41, 55, 63, 70, 85, 95, 110, 130])[1 + (row_number() over (order by a.asset_number))::int % 12]),
         'seed', 'demo history'
    from public.coolerco_assets a
   where a.client_code in ('DEMO', 'DEMOFOODS') and a.location_type = 'Outlet' and right(a.asset_number, 1) <> '7';
end $s$;
