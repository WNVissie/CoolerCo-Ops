-- CoolerCo-Ops · 016 · ROLLBACK
-- Removes only what coolerco_016 added. Nothing of any other app is touched.
-- Note: the added columns are left in place by default (dropping columns loses data);
-- the optional block at the end removes them too.

drop trigger if exists coolerco_cases_notify on public.coolerco_cases;

drop function if exists public.coolerco_cases_notify_trg();
drop function if exists public.coolerco_feedback_submit(text, int, boolean, boolean, text);
drop function if exists public.coolerco_feedback_context(text);
drop function if exists public.coolerco_contact_update_decide(uuid, boolean, text);
drop function if exists public.coolerco_portal_propose_contact(text, jsonb);
drop function if exists public.coolerco_notify(text, text, text, text, text, text, jsonb, text);
drop function if exists public.coolerco_asset_has_open_case(text, text);
drop function if exists public.coolerco_priority_for(text, text);
drop function if exists public.coolerco_my_access();

drop table if exists public.coolerco_case_feedback;
drop table if exists public.coolerco_contact_update_requests;
drop table if exists public.coolerco_notifications;
drop table if exists public.coolerco_notification_rules;
drop table if exists public.coolerco_product_impacts;
drop table if exists public.coolerco_symptoms;
drop table if exists public.coolerco_user_access;
drop table if exists public.coolerco_contractor_technicians;
drop table if exists public.coolerco_contractors;
drop table if exists public.coolerco_roles;
drop table if exists public.coolerco_clients;

-- after the tables (their policies used it)
drop function if exists public.coolerco_has_role(text[]);

-- OPTIONAL — only if the new columns must go as well (data in them is lost):
-- alter table public.coolerco_cases drop column if exists client_code, drop column if exists symptom_code,
--   drop column if exists product_impact, drop column if exists priority_source,
--   drop column if exists priority_set_by, drop column if exists priority_set_at;
-- alter table public.coolerco_portal_links drop column if exists client_code, drop column if exists email,
--   drop column if exists notify_email, drop column if exists notify_whatsapp,
--   drop column if exists trading_hours, drop column if exists delivery_notes;
-- alter table public.coolerco_concessionaires drop column if exists client_code, drop column if exists kind;
