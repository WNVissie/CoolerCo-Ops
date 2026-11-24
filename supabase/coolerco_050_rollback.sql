-- CoolerCo 050 rollback. Removes the SLA classes, the New case functions and the SLA
-- trigger. Cases keep the class and due date they already got. Puts the customer
-- portal functions back as they were: re-run the coolerco_portal_context part of
-- 003/006 and the coolerco_portal_submit part of 003 after this.
drop trigger if exists coolerco_cases_sla on public.coolerco_cases;
drop function if exists public.coolerco_cases_sla_trg();
drop function if exists public.coolerco_case_create(jsonb);
drop function if exists public.coolerco_case_form_options();
drop function if exists public.coolerco_sla_preview(text, text, text, text, timestamptz);
drop function if exists public.coolerco_sla_class_for(text, text, text);
drop function if exists public.coolerco_add_working_hours(timestamptz, numeric);
drop table if exists public.coolerco_sla_class_rules;
drop table if exists public.coolerco_sla_classes;
delete from public.coolerco_settings where key in ('sla_work_start', 'sla_work_end', 'sla_work_days');
-- coolerco_is_self_managed is kept (harmless); the three new coolerco_cases columns are kept.
