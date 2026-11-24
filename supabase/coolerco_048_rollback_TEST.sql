-- CoolerCo 048 rollback (TEST): removes all demo cases (both demo clients) and the Demo Foods client.
delete from public.coolerco_notifications where case_number in (select case_number from public.coolerco_cases where tenant_id = 'tenant_demo');
delete from public.coolerco_cases where tenant_id = 'tenant_demo';            -- case events go with them
delete from public.coolerco_sla_rules where note = 'Demo target (048)';
delete from public.coolerco_portal_links where client_code = 'DEMOFOODS';
delete from public.coolerco_pos_warehouse where pos_local_code like 'DF-OUT-%' and source = 'demo';
delete from public.coolerco_concessionaire_users where created_by = 'demo 048';
delete from public.coolerco_concessionaire_names where concessionaire_id in (select id from public.coolerco_concessionaires where client_code = 'DEMOFOODS');
delete from public.coolerco_concessionaires where client_code = 'DEMOFOODS';
delete from public.coolerco_user_access where client_code = 'DEMOFOODS';
delete from public.coolerco_assets where client_code = 'DEMOFOODS';
delete from public.coolerco_asset_models where client_code = 'DEMOFOODS';
delete from public.coolerco_outlets where client_code = 'DEMOFOODS';
delete from public.coolerco_clients where code = 'DEMOFOODS';
