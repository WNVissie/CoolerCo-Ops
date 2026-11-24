-- ============================================================================
-- CoolerCo 044 rollback — every signed-in user reads these tables again (as before 044).
-- ============================================================================
drop policy if exists coolerco_asset_touch_scoped on public.coolerco_asset_touch;
create policy coolerco_asset_touch_staff on public.coolerco_asset_touch for all to authenticated using (true) with check (true);

drop policy if exists coolerco_asset_labels_scoped on public.coolerco_asset_labels;
create policy coolerco_asset_labels_auth on public.coolerco_asset_labels for all to authenticated using (true) with check (true);

drop policy if exists coolerco_label_corrections_scoped on public.coolerco_label_corrections;
create policy coolerco_label_corrections_auth on public.coolerco_label_corrections for all to authenticated using (true) with check (true);

drop policy if exists coolerco_override_requests_read on public.coolerco_override_requests;
create policy coolerco_override_requests_read on public.coolerco_override_requests for select to authenticated using (true);

drop policy if exists coolerco_com_updates_read on public.coolerco_com_updates;
create policy coolerco_com_updates_read on public.coolerco_com_updates for select to authenticated using (true);

drop policy if exists coolerco_engine_log_read on public.coolerco_engine_log;
create policy coolerco_engine_log_read on public.coolerco_engine_log for select to authenticated using (true);

drop policy if exists coolerco_fse_read on public.coolerco_field_stop_events;
create policy coolerco_fse_read on public.coolerco_field_stop_events for select to authenticated using (true);

drop policy if exists coolerco_fre_read on public.coolerco_field_route_events;
create policy coolerco_fre_read on public.coolerco_field_route_events for select to authenticated using (true);

drop policy if exists coolerco_fpr_read on public.coolerco_field_pos_reports;
create policy coolerco_fpr_read on public.coolerco_field_pos_reports for select to authenticated using (true);

drop policy if exists coolerco_concessionaires_scoped on public.coolerco_concessionaires;
create policy coolerco_concessionaires_staff on public.coolerco_concessionaires for all to authenticated using (true) with check (true);

drop policy if exists coolerco_concessionaire_names_scoped on public.coolerco_concessionaire_names;
create policy coolerco_concessionaire_names_staff on public.coolerco_concessionaire_names for all to authenticated using (true) with check (true);

drop policy if exists coolerco_concessionaire_users_scoped on public.coolerco_concessionaire_users;
create policy coolerco_concessionaire_users_staff on public.coolerco_concessionaire_users for all to authenticated using (true) with check (true);

drop policy if exists coolerco_conc_sessions_scoped on public.coolerco_conc_sessions;
create policy coolerco_conc_sessions_staff on public.coolerco_conc_sessions for all to authenticated using (true) with check (true);

drop policy if exists coolerco_portal_link_history_scoped on public.coolerco_portal_link_history;
create policy coolerco_portal_link_history_staff on public.coolerco_portal_link_history for all to authenticated using (true) with check (true);

drop policy if exists coolerco_contractors_read on public.coolerco_contractors;
create policy coolerco_contractors_read on public.coolerco_contractors for select to authenticated using (true);

drop policy if exists coolerco_contractor_technicians_read on public.coolerco_contractor_technicians;
create policy coolerco_contractor_technicians_read on public.coolerco_contractor_technicians for select to authenticated using (true);

drop policy if exists coolerco_test_routes_read on public.coolerco_test_routes;
create policy coolerco_test_routes_read on public.coolerco_test_routes for select to authenticated using (true);
