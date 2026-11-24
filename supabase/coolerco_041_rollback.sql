-- ============================================================================
-- CoolerCo 041 rollback — puts back the access rules and views as before 041,
-- removes the registers, helpers and the Demo client + warehouses.
-- Data loaded into the registers (demo outlets / assets) is deleted with them.
-- ============================================================================

-- Access rules as before 041 (every signed-in user)
drop policy if exists coolerco_cases_scoped on public.coolerco_cases;
create policy coolerco_cases_staff on public.coolerco_cases for all to authenticated using (true) with check (true);

drop policy if exists coolerco_case_events_scoped on public.coolerco_case_events;
create policy coolerco_case_events_staff on public.coolerco_case_events for all to authenticated using (true) with check (true);

drop policy if exists coolerco_case_comments_scoped on public.coolerco_case_comments;
create policy coolerco_case_comments_staff on public.coolerco_case_comments for all to authenticated using (true) with check (true);

drop policy if exists coolerco_asset_movements_scoped on public.coolerco_asset_movements;
create policy coolerco_asset_movements_read on public.coolerco_asset_movements for select to authenticated using (true);

drop policy if exists coolerco_portal_links_scoped on public.coolerco_portal_links;
create policy coolerco_portal_links_staff on public.coolerco_portal_links for all to authenticated using (true) with check (true);

drop policy if exists coolerco_pos_warehouse_scoped on public.coolerco_pos_warehouse;
create policy coolerco_pos_warehouse_staff on public.coolerco_pos_warehouse for all to authenticated using (true) with check (true);

drop policy if exists coolerco_fjc_read on public.coolerco_field_job_cards;
create policy coolerco_fjc_read on public.coolerco_field_job_cards for select to authenticated using (true);

drop policy if exists coolerco_notifications_staff on public.coolerco_notifications;
create policy coolerco_notifications_staff on public.coolerco_notifications for select to authenticated
  using (public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier']));
drop policy if exists coolerco_notifications_read on public.coolerco_notifications;
create policy coolerco_notifications_read on public.coolerco_notifications for update to authenticated
  using (public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier']))
  with check (public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier']));

drop policy if exists coolerco_feedback_supplier on public.coolerco_case_feedback;
create policy coolerco_feedback_supplier on public.coolerco_case_feedback for select to authenticated
  using (public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier']));

-- coolerco_all_cases as in 028 (no Magnum filter)
create or replace view public.coolerco_all_cases with (security_invoker = true) as
 SELECT 'COM'::text AS source, 'MAGNUM'::text AS client_code, c.case_number, c.case_type, c.status_reason,
    lower(TRIM(BOTH FROM COALESCE(c.status_reason, ''::text))) = ANY (ARRAY['open'::text, 'in progress'::text, 'waiting'::text, 'in service'::text, 'on hold'::text]) AS is_open,
    true AS counts_as_case, c.priority, c.origin, NULL::text AS originator, c.motive, c.warehouse_workshop,
    c.responsible_ordering_party, c.point_of_sale, c.pos_local_code, c.address,
    NULLIF(c.latitude::text, ''::text)::double precision AS latitude, NULLIF(c.longitude::text, ''::text)::double precision AS longitude,
    c.case_contact_name, c.case_contact_number, c.case_mobile_number, c.asset_type, c.mapped_asset,
    c.asset_removed, c.asset_delivered, c.asset_repaired, c.asset_condition,
    c.requested_product_base, c.requested_asset_condition, c.requested_brand_hierarchy,
    c.created_on, c.begin_date, c.end_date, c.service_closure_date, c.sla_status,
    c.technician_routed_to, c.contractor, c.message AS notes, NULL::text AS com_case_number
   FROM public.cases c
UNION ALL
 SELECT 'CoolerCo'::text AS source, COALESCE(k.client_code, 'MAGNUM'::text) AS client_code, k.case_number, k.case_type, k.status_reason,
    COALESCE(k.status_reason, ''::text) <> ALL (ARRAY['Rejected'::text, 'Cancelled'::text, 'Canceled'::text, 'Completed'::text, 'Closed'::text, 'Solved'::text, 'Resolved'::text, 'Linked to COM'::text]) AS is_open,
    k.com_case_number IS NULL AS counts_as_case, k.priority, k.origin, k.originator, k.motive, k.warehouse_workshop,
    k.responsible_ordering_party, k.point_of_sale, k.pos_local_code, k.address, k.latitude, k.longitude,
    k.case_contact_name, k.case_contact_number, k.case_mobile_number, k.asset_type, k.mapped_asset,
    k.asset_removed, k.asset_delivered, k.asset_repaired, k.asset_condition,
    k.requested_product_base, k.requested_asset_condition, k.requested_brand_hierarchy,
    k.created_on, k.begin_date, k.end_date, k.service_closure_date,
    NULL::text AS sla_status, NULL::text AS technician_routed_to, NULL::boolean AS contractor, k.description AS notes, k.com_case_number
   FROM public.coolerco_cases k;
revoke all on public.coolerco_all_cases from anon, authenticated;
grant select on public.coolerco_all_cases to authenticated;

-- New objects
drop view if exists public.coolerco_all_assets;
drop view if exists public.coolerco_all_outlets;
drop table if exists public.coolerco_fault_codes;
drop table if exists public.coolerco_assets;
drop table if exists public.coolerco_asset_models;
drop table if exists public.coolerco_outlets;
drop function if exists public.coolerco_assets_set_wh();
drop function if exists public.coolerco_can_see_magnum();
drop function if exists public.coolerco_can_see(text, text);
drop function if exists public.coolerco_my_warehouses();
drop function if exists public.coolerco_my_clients();
drop function if exists public.coolerco_scope_all();

-- Demo rows (only if nothing else uses them)
delete from public.coolerco_wh_locations where warehouse_code in ('WH-DM-JHB', 'WH-DM-DBN');
delete from public.coolerco_user_access where client_code = 'DEMO' or warehouse_code in ('WH-DM-JHB', 'WH-DM-DBN');
delete from public.warehouses where code in ('WH-DM-JHB', 'WH-DM-DBN');
delete from public.coolerco_clients where code = 'DEMO'
  and not exists (select 1 from public.coolerco_cases where client_code = 'DEMO');
