-- CoolerCo-Ops · 035 · ROLLBACK — RUN ON TEST. Deletes every test route (and its stops), then the builder.
delete from public.routing_case_assignments where route_id in (select route_id from public.coolerco_test_routes);
delete from public.routing_routes where id in (select route_id from public.coolerco_test_routes);
drop function if exists public.coolerco_test_route_delete(uuid);
drop function if exists public.coolerco_test_route_list(date, text);
drop function if exists public.coolerco_test_route_create(date, text, text, text[], text);
drop function if exists public.coolerco_test_route_candidates(text, text, text);
drop table if exists public.coolerco_test_routes;
drop function if exists public.coolerco_is_test_db();
