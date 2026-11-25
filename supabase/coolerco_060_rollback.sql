-- Rollback 060 · asset audits. Removes the audit tables (and every audit in them), sightings, triggers and functions.
drop trigger if exists coolerco_sighting_job_card on public.coolerco_field_job_cards;
drop trigger if exists coolerco_sighting_delivery on public.coolerco_asset_movements;
drop function if exists public.coolerco_trg_sighting_job_card();
drop function if exists public.coolerco_trg_sighting_delivery();
do $r$
declare f text;
begin
  foreach f in array array['coolerco_audit_create(jsonb)', 'coolerco_audit_plan(uuid, integer)', 'coolerco_audit_summary(uuid)', 'coolerco_audit_list()',
    'coolerco_audit_get(uuid)', 'coolerco_audit_people(uuid)', 'coolerco_audit_set_auditor(uuid, uuid, text, text, text)', 'coolerco_audit_move_store(uuid, uuid, date)',
    'coolerco_audit_set_status(uuid, text)', 'coolerco_audit_my_days()', 'coolerco_audit_day(uuid, date)', 'coolerco_audit_store(uuid)',
    'coolerco_audit_scan(uuid, text, text)', 'coolerco_audit_counts(uuid)', 'coolerco_audit_unscan(uuid)', 'coolerco_audit_store_finish(uuid, jsonb, text)',
    'coolerco_audit_store_fix(uuid, jsonb)', 'coolerco_audit_report(uuid)', 'coolerco_not_scanned(text, text)', 'coolerco_audit_office()',
    'coolerco_audit_can_work(uuid)', 'coolerco_last_seen(text, text, text)', 'coolerco_km(double precision, double precision, double precision, double precision)'] loop
    execute 'drop function if exists public.' || f;
  end loop;
end $r$;
drop table if exists public.coolerco_audit_items;
drop table if exists public.coolerco_audit_stores;
drop table if exists public.coolerco_audit_auditors;
drop table if exists public.coolerco_audits;
drop table if exists public.coolerco_asset_sightings;
drop table if exists public.coolerco_warehouse_pins;
