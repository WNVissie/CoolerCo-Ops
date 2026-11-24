-- ============================================================================
-- CoolerCo 044 — Client split for the remaining CoolerCo tables
-- Run on: TEST first (🟢[TEST] RTMA_Ops). Production only when Wanda says so.
-- Needs:  041 (coolerco_scope_all / my_clients / my_warehouses / can_see / can_see_magnum).
-- Rollback: coolerco_044_rollback.sql
--
-- 041 scoped cases, assets, outlets and links. These tables were still readable
-- by every signed-in user and hold Magnum data (scans, labels, COM updates,
-- Field app events, concessionaires). After 044:
--   admins / office staff with no warehouse -> everything (as before)
--   Magnum users and staff of a real warehouse -> Magnum data (as before)
--   staff of a demo warehouse / Tiger users  -> only their own warehouse / client
--   the person who created a row can always see it
-- Writes keep working for the same people (same rule as reading). Inserts that
-- were "own rows only" (Field app taps) stay exactly as they were.
--
-- Not changed: the customer and concessionaire portals and the Field app's
-- server functions (security definer); lookup lists (roles, symptoms, reasons,
-- holidays, families, locations, movement types, rules) stay readable to all
-- signed-in users.
--
-- IMPORTANT before production: every signed-in person who uses CoolerCo-Ops must
-- have a row in coolerco_user_access (role + client or warehouse), or they will see
-- nothing in the scoped tables. On TEST only Wanda (system_admin) has one.
-- ============================================================================

-- ── 1. Scans (coolerco_asset_touch): own scans, your warehouse, or Magnum viewers
drop policy if exists coolerco_asset_touch_staff on public.coolerco_asset_touch;
drop policy if exists coolerco_asset_touch_scoped on public.coolerco_asset_touch;
create policy coolerco_asset_touch_scoped on public.coolerco_asset_touch for all to authenticated
  using (public.coolerco_scope_all()
         or scanned_by_user_id = auth.uid()
         or 'MAGNUM' = any (public.coolerco_my_clients())
         or exists (select 1 from public.warehouses w
                     where w.id = coolerco_asset_touch.warehouse_id
                       and w.code = any (public.coolerco_my_warehouses())))
  with check (public.coolerco_scope_all()
         or scanned_by_user_id = auth.uid()
         or exists (select 1 from public.warehouses w
                     where w.id = coolerco_asset_touch.warehouse_id
                       and w.code = any (public.coolerco_my_warehouses())));

-- ── 2. Labels, label corrections, pick override requests (Magnum barcodes) ──
drop policy if exists coolerco_asset_labels_auth on public.coolerco_asset_labels;
drop policy if exists coolerco_asset_labels_scoped on public.coolerco_asset_labels;
create policy coolerco_asset_labels_scoped on public.coolerco_asset_labels for all to authenticated
  using (public.coolerco_can_see_magnum() or warehouse = any (public.coolerco_my_warehouses()))
  with check (public.coolerco_can_see_magnum() or warehouse = any (public.coolerco_my_warehouses()));

drop policy if exists coolerco_label_corrections_auth on public.coolerco_label_corrections;
drop policy if exists coolerco_label_corrections_scoped on public.coolerco_label_corrections;
create policy coolerco_label_corrections_scoped on public.coolerco_label_corrections for all to authenticated
  using (public.coolerco_can_see_magnum() or warehouse = any (public.coolerco_my_warehouses()))
  with check (public.coolerco_can_see_magnum() or warehouse = any (public.coolerco_my_warehouses()));

drop policy if exists coolerco_override_requests_read on public.coolerco_override_requests;
create policy coolerco_override_requests_read on public.coolerco_override_requests for select to authenticated
  using (public.coolerco_scope_all()
         or requested_by = auth.uid()
         or warehouse = any (public.coolerco_my_warehouses())
         or exists (select 1 from public.coolerco_cases k where k.case_number = coolerco_override_requests.case_number)
         or (public.coolerco_can_see_magnum()
             and not exists (select 1 from public.coolerco_cases k2 where k2.case_number = coolerco_override_requests.case_number)));

-- ── 3. COM update queue + case engine log: follow the case's client ─────────
drop policy if exists coolerco_com_updates_read on public.coolerco_com_updates;
create policy coolerco_com_updates_read on public.coolerco_com_updates for select to authenticated
  using (public.coolerco_can_see(client_code, warehouse)
         or (coalesce(client_code, 'MAGNUM') = 'MAGNUM' and public.coolerco_can_see_magnum()));

drop policy if exists coolerco_engine_log_read on public.coolerco_engine_log;
create policy coolerco_engine_log_read on public.coolerco_engine_log for select to authenticated
  using (public.coolerco_scope_all()
         or exists (select 1 from public.coolerco_cases k where k.case_number = coolerco_engine_log.case_number)
         or (public.coolerco_can_see_magnum()
             and not exists (select 1 from public.coolerco_cases k2 where k2.case_number = coolerco_engine_log.case_number)));

-- ── 4. Field app stop events, route events, outlet reports (reading only;
--      "add your own" insert policies from 031 / 033 are unchanged) ─────────
drop policy if exists coolerco_fse_read on public.coolerco_field_stop_events;
create policy coolerco_fse_read on public.coolerco_field_stop_events for select to authenticated
  using (public.coolerco_scope_all()
         or created_by = auth.uid()
         or exists (select 1 from public.coolerco_cases k where k.case_number = coolerco_field_stop_events.case_number)
         or (public.coolerco_can_see_magnum()
             and not exists (select 1 from public.coolerco_cases k2 where k2.case_number = coolerco_field_stop_events.case_number)));

drop policy if exists coolerco_fre_read on public.coolerco_field_route_events;
create policy coolerco_fre_read on public.coolerco_field_route_events for select to authenticated
  using (public.coolerco_scope_all()
         or created_by = auth.uid()
         or exists (select 1 from public.coolerco_cases k where k.case_number = coolerco_field_route_events.case_number)
         or public.coolerco_can_see_magnum());

drop policy if exists coolerco_fpr_read on public.coolerco_field_pos_reports;
create policy coolerco_fpr_read on public.coolerco_field_pos_reports for select to authenticated
  using (public.coolerco_scope_all()
         or created_by = auth.uid()
         or exists (select 1 from public.coolerco_outlets o
                     where o.outlet_code = coolerco_field_pos_reports.pos_local_code
                       and public.coolerco_can_see(o.client_code, o.warehouse_code))
         or (public.coolerco_can_see_magnum()
             and not exists (select 1 from public.coolerco_outlets o2 where o2.outlet_code = coolerco_field_pos_reports.pos_local_code)));

-- ── 5. Concessionaires (Magnum today; client_code on the concessionaire) ────
--      PINs, link tokens and sessions: office roles only.
drop policy if exists coolerco_concessionaires_staff on public.coolerco_concessionaires;
drop policy if exists coolerco_concessionaires_scoped on public.coolerco_concessionaires;
create policy coolerco_concessionaires_scoped on public.coolerco_concessionaires for all to authenticated
  using (public.coolerco_can_see(client_code, null)
         or (coalesce(client_code, 'MAGNUM') = 'MAGNUM' and public.coolerco_can_see_magnum()))
  with check (public.coolerco_can_see(client_code, null)
         or (coalesce(client_code, 'MAGNUM') = 'MAGNUM' and public.coolerco_can_see_magnum()));

drop policy if exists coolerco_concessionaire_names_staff on public.coolerco_concessionaire_names;
drop policy if exists coolerco_concessionaire_names_scoped on public.coolerco_concessionaire_names;
create policy coolerco_concessionaire_names_scoped on public.coolerco_concessionaire_names for all to authenticated
  using (exists (select 1 from public.coolerco_concessionaires c where c.id = coolerco_concessionaire_names.concessionaire_id))
  with check (exists (select 1 from public.coolerco_concessionaires c where c.id = coolerco_concessionaire_names.concessionaire_id));

drop policy if exists coolerco_concessionaire_users_staff on public.coolerco_concessionaire_users;
drop policy if exists coolerco_concessionaire_users_scoped on public.coolerco_concessionaire_users;
create policy coolerco_concessionaire_users_scoped on public.coolerco_concessionaire_users for all to authenticated
  using (public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier', 'supervisor'])
         and exists (select 1 from public.coolerco_concessionaires c where c.id = coolerco_concessionaire_users.concessionaire_id))
  with check (public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier', 'supervisor'])
         and exists (select 1 from public.coolerco_concessionaires c where c.id = coolerco_concessionaire_users.concessionaire_id));

drop policy if exists coolerco_conc_sessions_staff on public.coolerco_conc_sessions;
drop policy if exists coolerco_conc_sessions_scoped on public.coolerco_conc_sessions;
create policy coolerco_conc_sessions_scoped on public.coolerco_conc_sessions for all to authenticated
  using (public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier', 'supervisor'])
         and exists (select 1 from public.coolerco_concessionaires c where c.id = coolerco_conc_sessions.concessionaire_id))
  with check (public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier', 'supervisor'])
         and exists (select 1 from public.coolerco_concessionaires c where c.id = coolerco_conc_sessions.concessionaire_id));

-- ── 6. Outlet link change history: follows the link ─────────────────────────
drop policy if exists coolerco_portal_link_history_staff on public.coolerco_portal_link_history;
drop policy if exists coolerco_portal_link_history_scoped on public.coolerco_portal_link_history;
create policy coolerco_portal_link_history_scoped on public.coolerco_portal_link_history for all to authenticated
  using (exists (select 1 from public.coolerco_portal_links l where l.id = coolerco_portal_link_history.link_id))
  with check (exists (select 1 from public.coolerco_portal_links l where l.id = coolerco_portal_link_history.link_id));

-- ── 7. Contractors (CoolerCo's own subcontractors): their warehouse, or Magnum-side staff
drop policy if exists coolerco_contractors_read on public.coolerco_contractors;
create policy coolerco_contractors_read on public.coolerco_contractors for select to authenticated
  using (public.coolerco_scope_all()
         or warehouse_code = any (public.coolerco_my_warehouses())
         or public.coolerco_can_see_magnum());

drop policy if exists coolerco_contractor_technicians_read on public.coolerco_contractor_technicians;
create policy coolerco_contractor_technicians_read on public.coolerco_contractor_technicians for select to authenticated
  using (exists (select 1 from public.coolerco_contractors c where c.id = coolerco_contractor_technicians.contractor_id));

-- ── 8. Test routes (TEST only): planners who can see Magnum, or whoever made it
drop policy if exists coolerco_test_routes_read on public.coolerco_test_routes;
create policy coolerco_test_routes_read on public.coolerco_test_routes for select to authenticated
  using (public.coolerco_scope_all() or created_by = auth.uid() or public.coolerco_can_see_magnum());

-- ============================================================================
-- Check (read only): CoolerCo tables still open to every signed-in user.
-- Only lookup lists should be left.
-- ============================================================================
select tablename, policyname from pg_policies
 where schemaname = 'public' and tablename like 'coolerco_%' and qual = 'true' order by 1;
