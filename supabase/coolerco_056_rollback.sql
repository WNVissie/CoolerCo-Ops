-- 056 rollback: removes the functions + trigger. Rows already written stay (RouteIQ corrections, region links);
-- to remove the two seeded Tiger regions as well, run the last two lines.
drop trigger if exists coolerco_contact_update_to_routeiq on public.coolerco_contact_update_requests;
drop function if exists public.coolerco_contact_update_to_routeiq();
drop function if exists public.coolerco_magnum_store_update(text, jsonb, text);
drop function if exists public.coolerco_outlets_set_rop(text, text[], uuid);
drop function if exists public.coolerco_rop_add(text, text, text);
drop function if exists public.coolerco_outlet_change_com_fixed(bigint[]);
alter table public.coolerco_outlet_changes drop column if exists com_fixed_at, drop column if exists com_fixed_by;
-- delete from public.coolerco_concessionaire_names where rop_name in ('TIGER INLAND', 'TIGER COASTAL');
-- delete from public.coolerco_concessionaires where display_name in ('Tiger Inland', 'Tiger Coastal') and kind = 'region';
