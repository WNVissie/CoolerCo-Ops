-- Rollback for CoolerCo 029: removes the tracking admin functions, the change log and the two settings.
-- SMART Track's own switches (in schema smart_track) are left as they are.
drop function if exists public.coolerco_tracking_create_company();
drop function if exists public.coolerco_tracking_set(text, boolean);
drop function if exists public.coolerco_tracking_settings();
drop table if exists public.coolerco_tracking_log;
delete from public.coolerco_settings where key in ('field_app_tracking', 'smart_track_company_code');
