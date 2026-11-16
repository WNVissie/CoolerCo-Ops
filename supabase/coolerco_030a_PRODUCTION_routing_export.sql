-- CoolerCo-Ops · 030a · RUN ON PRODUCTION (RTMA_Ops abgxjfeofgvimmimxvpa) — routing tables in the read-only window
-- Same as 020a: plain select * views in the private schema coolerco_export, readable ONLY by the read-only
-- login coolerco_test_reader (used by the TEST copy job). No routing table, policy or RouteIQ code is changed;
-- RouteIQ and the drivers' trip sheets work exactly as before. anon / authenticated get nothing.
-- Rollback: coolerco_030_rollback_PRODUCTION.sql

create or replace view coolerco_export.routing_optimization_runs      as select * from public.routing_optimization_runs;
create or replace view coolerco_export.routing_routes                 as select * from public.routing_routes;
create or replace view coolerco_export.routing_route_versions         as select * from public.routing_route_versions;
create or replace view coolerco_export.routing_route_stops            as select * from public.routing_route_stops;
create or replace view coolerco_export.routing_warehouse_preparation  as select * from public.routing_warehouse_preparation;
create or replace view coolerco_export.routing_case_assignments       as select * from public.routing_case_assignments;
create or replace view coolerco_export.routing_pos_assignments        as select * from public.routing_pos_assignments;
create or replace view coolerco_export.routing_portal_users           as select * from public.routing_portal_users;
create or replace view coolerco_export.routing_pos_contacts           as select * from public.routing_pos_contacts;
create or replace view coolerco_export.routing_job_cards              as select * from public.routing_job_cards;
create or replace view coolerco_export.routing_route_events           as select * from public.routing_route_events;

revoke all on all tables in schema coolerco_export from public, anon, authenticated;
grant select on all tables in schema coolerco_export to coolerco_test_reader;

select count(*) as routing_views from information_schema.views where table_schema = 'coolerco_export' and table_name like 'routing\_%';
