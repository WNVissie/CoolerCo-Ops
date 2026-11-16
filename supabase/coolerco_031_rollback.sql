-- CoolerCo-Ops · 031 · ROLLBACK — RUN ON TEST. Removes the Field app taps / job cards (and the rows in them).
drop view  if exists public.coolerco_field_stop_status;
drop table if exists public.coolerco_field_job_cards;
drop table if exists public.coolerco_field_stop_events;
drop table if exists public.coolerco_field_reasons;
