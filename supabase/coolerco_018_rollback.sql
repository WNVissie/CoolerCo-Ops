-- CoolerCo-Ops · 018 · ROLLBACK
-- Removes what 018 added. AFTER this, re-run coolerco_017_portal_symptoms_priority.sql so that
-- coolerco_portal_options and coolerco_portal_submit_v2 go back to their 017 versions.
-- Customer messages already saved in coolerco_case_comments are kept.
drop function if exists public.coolerco_portal_case_query(text, text, text, text);
drop function if exists public.coolerco_portal_case(text, text);

-- back to the 016 version of this helper
create or replace function public.coolerco_asset_has_open_case(p_asset text, p_except_case text default null)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select c.case_number from public.coolerco_cases c
   where p_asset is not null and p_asset in (c.mapped_asset, c.asset_repaired, c.asset_removed, c.asset_delivered)
     and c.status_reason not in ('Completed', 'Closed', 'Solved', 'Cancelled', 'Canceled', 'Rejected', 'Linked to COM')
     and c.case_number is distinct from p_except_case
   order by c.created_on limit 1;
$$;
drop function if exists public.coolerco_asset_open_case(text, text);

delete from public.coolerco_notification_rules where event_type = 'case_query';
drop table if exists public.coolerco_query_reasons;
delete from public.coolerco_settings where key in ('repeat_repair_days', 'portal_daily_query_limit');

-- coolerco_case_is_closed is left in place (harmless; drop it only after re-running 017):
-- drop function if exists public.coolerco_case_is_closed(text);

-- OPTIONAL (data in them is lost):
-- alter table public.coolerco_cases drop column if exists repeat_of_case, drop column if exists repeat_days;
