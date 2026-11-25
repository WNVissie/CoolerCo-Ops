-- 055 rollback: removes the outlet edit + portal-link-for-outlet functions and the change log (outlet values already changed stay as they are)
drop function if exists public.coolerco_portal_link_for_outlet(text, text);
drop function if exists public.coolerco_outlet_update(text, text, jsonb, text);
drop table if exists public.coolerco_outlet_changes;
