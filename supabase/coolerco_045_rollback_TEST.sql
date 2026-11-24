-- CoolerCo 045 rollback (TEST): removes the Demo client's data loaded by 045.
delete from public.coolerco_assets where client_code = 'DEMO';
delete from public.coolerco_asset_models where client_code = 'DEMO';
delete from public.coolerco_outlets where client_code = 'DEMO';
delete from public.coolerco_fault_codes where client_code = 'DEMO';
delete from public.coolerco_sla_rules where client_code = 'DEMO' and note = 'Demo target';
