-- CoolerCo-Ops · 032 · RUN ON TEST — job card matches RouteIQ's trip-sheet job card
-- Adds (to our own coolerco_field_* objects only):
--   · Service result (same 5 choices as RouteIQ): Service completed · Service Denied/Refused · Incorrect Location ·
--     Location Closed · Repair Failed
--   · repair details + spares used, customer name, reason the customer would not sign
-- The app keeps working without this script (it then saves the job card without these fields).
-- Rollback: coolerco_032_rollback.sql

alter table public.coolerco_field_job_cards add column if not exists service_result text
  check (service_result in ('service_completed', 'service_denied', 'incorrect_location', 'location_closed', 'repair_failed'));
alter table public.coolerco_field_job_cards add column if not exists repair_details text;
alter table public.coolerco_field_job_cards add column if not exists spares jsonb not null default '[]'::jsonb;   -- [{ "name": "...", "qty": 1 }]
alter table public.coolerco_field_job_cards add column if not exists customer_name text;
alter table public.coolerco_field_job_cards add column if not exists signature_refusal_reason text;

-- reason codes used for the unsuccessful service results (RouteIQ wording)
insert into public.coolerco_field_reasons (code, label, needs_note, sort_order) values
  ('INCORRECT_LOCATION', 'Incorrect Location', true, 31),
  ('LOCATION_CLOSED',    'Location Closed',    true, 21),
  ('REPAIR_FAILED',      'Repair Failed',      true, 85)
on conflict (code) do nothing;
update public.coolerco_field_reasons set label = 'Service Denied/Refused' where code = 'SERVICE_DENIED';

select count(*) filter (where column_name in ('service_result','repair_details','spares','customer_name','signature_refusal_reason')) as new_columns
  from information_schema.columns where table_name = 'coolerco_field_job_cards';
