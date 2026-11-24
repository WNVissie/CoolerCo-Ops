-- CoolerCo 042 rollback: the portal's "My store" tab hides itself again.
drop function if exists public.coolerco_portal_store_details(text);
