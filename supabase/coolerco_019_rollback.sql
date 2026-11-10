-- CoolerCo-Ops · 019 · ROLLBACK — removes the three inbox functions 019 added. Nothing else is touched.
drop function if exists public.coolerco_inbox_counts();
drop function if exists public.coolerco_query_inbox(boolean, int);
drop function if exists public.coolerco_contact_update_captured(uuid);
