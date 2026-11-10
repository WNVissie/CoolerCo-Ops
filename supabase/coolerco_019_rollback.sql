-- CoolerCo-Ops · 019 · ROLLBACK
-- Removes what 019 added. AFTER this, re-run coolerco_018_one_case_per_asset_queries.sql so that
-- coolerco_portal_submit_v2 goes back to its 018 version (018 is safe to run again).
drop function if exists public.coolerco_inbox_counts();
drop function if exists public.coolerco_query_inbox(boolean, int);
drop function if exists public.coolerco_contact_update_captured(uuid);
-- run 018 first if you drop this one (the 019 submit function uses it):
-- drop function if exists public.coolerco_store_open_new_request(text, uuid);
