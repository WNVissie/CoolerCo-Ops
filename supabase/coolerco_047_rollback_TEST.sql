-- CoolerCo 047 rollback (TEST): removes the demo reps, demo outlet links and settings.
delete from public.coolerco_portal_links where client_code = 'DEMO' and created_by = 'demo 047';
delete from public.coolerco_pos_warehouse where source = 'demo';
delete from public.coolerco_concessionaire_users where created_by = 'demo 047';
delete from public.coolerco_concessionaire_names where concessionaire_id in (select id from public.coolerco_concessionaires where client_code = 'DEMO' and kind = 'representative');
delete from public.coolerco_concessionaires where client_code = 'DEMO' and kind = 'representative'
  and not exists (select 1 from public.coolerco_cases k where k.client_code = 'DEMO');
delete from public.coolerco_warehouse_settings where warehouse_code in ('WH-DM-JHB', 'WH-DM-DBN');
-- The access rule and coolerco_all_outlets: re-run section 4e of 041 and section 3 of 041 if needed.
