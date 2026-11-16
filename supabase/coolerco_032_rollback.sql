-- CoolerCo-Ops · 032 · ROLLBACK — RUN ON TEST
alter table public.coolerco_field_job_cards drop column if exists service_result, drop column if exists repair_details,
  drop column if exists spares, drop column if exists customer_name, drop column if exists signature_refusal_reason;
delete from public.coolerco_field_reasons r where code in ('INCORRECT_LOCATION', 'LOCATION_CLOSED', 'REPAIR_FAILED')
  and not exists (select 1 from public.coolerco_field_stop_events e where e.reason_code = r.code)
  and not exists (select 1 from public.coolerco_field_job_cards j where j.reason_code = r.code);
update public.coolerco_field_reasons set label = 'Service denied / refused entry' where code = 'SERVICE_DENIED';
