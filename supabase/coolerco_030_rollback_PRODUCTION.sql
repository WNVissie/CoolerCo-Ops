-- CoolerCo-Ops · 030a · ROLLBACK — RUN ON PRODUCTION. Removes only the routing views from the read-only window.
drop view if exists coolerco_export.routing_optimization_runs;
drop view if exists coolerco_export.routing_routes;
drop view if exists coolerco_export.routing_route_versions;
drop view if exists coolerco_export.routing_route_stops;
drop view if exists coolerco_export.routing_warehouse_preparation;
drop view if exists coolerco_export.routing_case_assignments;
drop view if exists coolerco_export.routing_pos_assignments;
drop view if exists coolerco_export.routing_portal_users;
drop view if exists coolerco_export.routing_pos_contacts;
drop view if exists coolerco_export.routing_job_cards;
drop view if exists coolerco_export.routing_route_events;
