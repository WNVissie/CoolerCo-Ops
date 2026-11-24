-- ============================================================================
-- CoolerCo 048 (TEST only) - second demo client "Demo Foods" + demo cases for both
-- demo clients. All fictional. Needs 041, 045, 047. Safe to run again.
-- Rollback: coolerco_048_rollback_TEST.sql
--
--   * client DEMOFOODS (CoolerCo is the master, like Tiger), in the SAME two demo
--     warehouses as the Demo client -> demo warehouse staff see both clients,
--     each client user sees only their own
--   * Demo Foods: 3 models, 12 outlets (DF-OUT-...), 30 assets (DF...), 2 reps
--     (PIN 1234), customer portal link per outlet
--   * 65 demo cases (45 Demo, 20 Demo Foods), 1 Oct - 24 Nov 2026: every case type,
--     waiting for approval / open / in progress / on hold / completed on time and
--     late / cancelled / rejected, one repeat repair; each with its history events
--   * service levels per case type for both demo clients (app case type names)
-- The Demo Foods client login is in 048b (not in GitHub: password).
-- ============================================================================
do $$ begin
  if not exists (select 1 from public.coolerco_clients where code = 'DEMO') then raise exception 'Run 041 first'; end if;
  if not exists (select 1 from public.coolerco_warehouse_settings where warehouse_code = 'WH-DM-JHB') then raise exception 'Run 047 first'; end if;
  if exists (select 1 from information_schema.schemata where schema_name = 'coolerco_export') then raise exception 'This is production - demo data is for TEST only'; end if;
end $$;

-- 1. Client
insert into public.coolerco_clients (code, name, system_of_record, external_system, can_close_cases, repair_needs_approval, share_feedback, active)
values ('DEMOFOODS', 'Demo Foods', 'coolerco', null, true, false, true, true)
on conflict (code) do nothing;

-- 2. Demo Foods models, outlets, assets
insert into public.coolerco_asset_models (client_code, model_code, description, asset_type, manufacturer, capacity_litres, doors, product_family) values

  ('DEMOFOODS', 'DF-UC450', 'Demo Foods upright cooler 450 L, glass door', 'Upright cooler', 'Demo Cooling Co', 450, 1, 'Upright cooler'),
  ('DEMOFOODS', 'DF-CF400', 'Demo Foods chest freezer 400 L, solid lid', 'Chest freezer', 'Demo Cooling Co', 400, 1, 'Chest freezer large'),
  ('DEMOFOODS', 'DF-CT60', 'Demo Foods countertop cooler 60 L', 'Countertop cooler', 'Demo Cooling Co', 60, 1, 'Countertop cooler')
on conflict (client_code, model_code) do nothing;

insert into public.coolerco_outlets (client_code, outlet_code, name, outlet_type, contact_person, mobile_number, street_address, suburb, town, province, latitude, longitude, warehouse_code, rep_code, opening_time, closing_time, receiving_from, receiving_to, active) values
  ('DEMOFOODS', 'DF-OUT-001', 'Mama Thandi Kitchen (Demo Foods)', 'Food retail', 'Demo Foods Contact 1', '000 001 0001', '40 Demo Road', 'Diepkloof', 'Soweto', 'Gauteng', -26.247, 27.951, 'WH-DM-JHB', 'REP-DF01', '07:00', '19:00', '08:00', '14:00', true),
  ('DEMOFOODS', 'DF-OUT-002', 'Ekasi Butchery (Demo Foods)', 'Food retail', 'Demo Foods Contact 2', '000 001 0002', '41 Demo Road', 'Orlando East', 'Soweto', 'Gauteng', -26.236, 27.918, 'WH-DM-JHB', 'REP-DF01', '07:00', '19:00', '08:00', '14:00', true),
  ('DEMOFOODS', 'DF-OUT-003', 'Jozi Bakery Corner (Demo Foods)', 'Food retail', 'Demo Foods Contact 3', '000 001 0003', '42 Demo Road', 'Braamfontein', 'Johannesburg', 'Gauteng', -26.193, 28.034, 'WH-DM-JHB', 'REP-DF01', '07:00', '19:00', '08:00', '14:00', true),
  ('DEMOFOODS', 'DF-OUT-004', 'Northgate Deli (Demo Foods)', 'Food retail', 'Demo Foods Contact 4', '000 001 0004', '43 Demo Road', 'Northriding', 'Randburg', 'Gauteng', -26.06, 27.951, 'WH-DM-JHB', 'REP-DF01', '07:00', '19:00', '08:00', '14:00', true),
  ('DEMOFOODS', 'DF-OUT-005', 'Ivory Park Superette (Demo Foods)', 'Food retail', 'Demo Foods Contact 5', '000 001 0005', '44 Demo Road', 'Ivory Park', 'Midrand', 'Gauteng', -25.991, 28.183, 'WH-DM-JHB', 'REP-DF01', '07:00', '19:00', '08:00', '14:00', true),
  ('DEMOFOODS', 'DF-OUT-006', 'Eastrand Butchery (Demo Foods)', 'Food retail', 'Demo Foods Contact 6', '000 001 0006', '45 Demo Road', 'Boksburg', 'Boksburg', 'Gauteng', -26.212, 28.259, 'WH-DM-JHB', 'REP-DF01', '07:00', '19:00', '08:00', '14:00', true),
  ('DEMOFOODS', 'DF-OUT-007', 'Vaal Corner Cafe (Demo Foods)', 'Food retail', 'Demo Foods Contact 7', '000 001 0007', '46 Demo Road', 'Vereeniging', 'Vereeniging', 'Gauteng', -26.673, 27.926, 'WH-DM-JHB', 'REP-DF01', '07:00', '19:00', '08:00', '14:00', true),
  ('DEMOFOODS', 'DF-OUT-008', 'Pretoria West Deli (Demo Foods)', 'Food retail', 'Demo Foods Contact 8', '000 001 0008', '47 Demo Road', 'Pretoria West', 'Pretoria', 'Gauteng', -25.75, 28.15, 'WH-DM-JHB', 'REP-DF01', '07:00', '19:00', '08:00', '14:00', true),
  ('DEMOFOODS', 'DF-OUT-009', 'Berea Bakery (Demo Foods)', 'Food retail', 'Demo Foods Contact 9', '000 001 0009', '48 Demo Road', 'Berea', 'Durban', 'KwaZulu-Natal', -29.846, 30.995, 'WH-DM-DBN', 'REP-DF02', '07:00', '19:00', '08:00', '14:00', true),
  ('DEMOFOODS', 'DF-OUT-010', 'Phoenix Butchery (Demo Foods)', 'Food retail', 'Demo Foods Contact 10', '000 001 0010', '49 Demo Road', 'Phoenix', 'Durban', 'KwaZulu-Natal', -29.703, 30.976, 'WH-DM-DBN', 'REP-DF02', '07:00', '19:00', '08:00', '14:00', true),
  ('DEMOFOODS', 'DF-OUT-011', 'Amanzimtoti Superette (Demo Foods)', 'Food retail', 'Demo Foods Contact 11', '000 001 0011', '50 Demo Road', 'Amanzimtoti', 'Amanzimtoti', 'KwaZulu-Natal', -30.05, 30.885, 'WH-DM-DBN', 'REP-DF02', '07:00', '19:00', '08:00', '14:00', true),
  ('DEMOFOODS', 'DF-OUT-012', 'Westville Deli (Demo Foods)', 'Food retail', 'Demo Foods Contact 12', '000 001 0012', '51 Demo Road', 'Westville', 'Westville', 'KwaZulu-Natal', -29.836, 30.926, 'WH-DM-DBN', 'REP-DF02', '07:00', '19:00', '08:00', '14:00', true)
on conflict (client_code, outlet_code) do nothing;

insert into public.coolerco_assets (client_code, asset_number, serial_number, model_code, branding, condition, status, location_type, location_code, placement_date, has_label) values
  ('DEMOFOODS', 'DF000001', 'DF-SN-310000', 'DF-UC450', 'Demo Foods', 'Fair', 'At outlet', 'Outlet', 'DF-OUT-001', '2025-01-15', true),
  ('DEMOFOODS', 'DF000002', 'DF-SN-310037', 'DF-CF400', 'Demo Foods', 'Good', 'At outlet', 'Outlet', 'DF-OUT-001', '2025-02-15', true),
  ('DEMOFOODS', 'DF000003', 'DF-SN-310074', 'DF-CT60', 'Demo Foods', 'Fair', 'At outlet', 'Outlet', 'DF-OUT-002', '2025-03-15', true),
  ('DEMOFOODS', 'DF000004', 'DF-SN-310111', 'DF-UC450', 'Demo Foods', 'Good', 'At outlet', 'Outlet', 'DF-OUT-002', '2025-04-15', true),
  ('DEMOFOODS', 'DF000005', 'DF-SN-310148', 'DF-CF400', 'Demo Foods', 'New', 'At outlet', 'Outlet', 'DF-OUT-003', '2025-05-15', true),
  ('DEMOFOODS', 'DF000006', 'DF-SN-310185', 'DF-CT60', 'Demo Foods', 'Good', 'At outlet', 'Outlet', 'DF-OUT-003', '2025-06-15', true),
  ('DEMOFOODS', 'DF000007', 'DF-SN-310222', 'DF-UC450', 'Demo Foods', 'Good', 'At outlet', 'Outlet', 'DF-OUT-004', '2025-07-15', true),
  ('DEMOFOODS', 'DF000008', 'DF-SN-310259', 'DF-CF400', 'Demo Foods', 'Good', 'At outlet', 'Outlet', 'DF-OUT-004', '2025-08-15', true),
  ('DEMOFOODS', 'DF000009', 'DF-SN-310296', 'DF-CT60', 'Demo Foods', 'New', 'At outlet', 'Outlet', 'DF-OUT-005', '2025-09-15', true),
  ('DEMOFOODS', 'DF000010', 'DF-SN-310333', 'DF-UC450', 'Demo Foods', 'Good', 'At outlet', 'Outlet', 'DF-OUT-005', '2025-01-15', true),
  ('DEMOFOODS', 'DF000011', 'DF-SN-310370', 'DF-CF400', 'Demo Foods', 'Good', 'At outlet', 'Outlet', 'DF-OUT-006', '2025-02-15', true),
  ('DEMOFOODS', 'DF000012', 'DF-SN-310407', 'DF-CT60', 'Demo Foods', 'Good', 'At outlet', 'Outlet', 'DF-OUT-006', '2025-03-15', true),
  ('DEMOFOODS', 'DF000013', 'DF-SN-310444', 'DF-UC450', 'Demo Foods', 'New', 'At outlet', 'Outlet', 'DF-OUT-007', '2025-04-15', true),
  ('DEMOFOODS', 'DF000014', 'DF-SN-310481', 'DF-CF400', 'Demo Foods', 'Good', 'At outlet', 'Outlet', 'DF-OUT-007', '2025-05-15', true),
  ('DEMOFOODS', 'DF000015', 'DF-SN-310518', 'DF-CT60', 'Demo Foods', 'Good', 'At outlet', 'Outlet', 'DF-OUT-008', '2025-06-15', true),
  ('DEMOFOODS', 'DF000016', 'DF-SN-310555', 'DF-UC450', 'Demo Foods', 'Good', 'At outlet', 'Outlet', 'DF-OUT-008', '2025-07-15', true),
  ('DEMOFOODS', 'DF000017', 'DF-SN-310592', 'DF-CF400', 'Demo Foods', 'New', 'At outlet', 'Outlet', 'DF-OUT-009', '2025-08-15', true),
  ('DEMOFOODS', 'DF000018', 'DF-SN-310629', 'DF-CT60', 'Demo Foods', 'Good', 'At outlet', 'Outlet', 'DF-OUT-010', '2025-09-15', true),
  ('DEMOFOODS', 'DF000019', 'DF-SN-310666', 'DF-UC450', 'Demo Foods', 'Good', 'At outlet', 'Outlet', 'DF-OUT-011', '2025-01-15', true),
  ('DEMOFOODS', 'DF000020', 'DF-SN-310703', 'DF-CF400', 'Demo Foods', 'New', 'At outlet', 'Outlet', 'DF-OUT-012', '2025-02-15', true),
  ('DEMOFOODS', 'DF000021', 'DF-SN-310740', 'DF-CT60', 'Demo Foods', 'Good', 'In warehouse, ready to work', 'Warehouse', 'WH-DM-JHB', null, true),
  ('DEMOFOODS', 'DF000022', 'DF-SN-310777', 'DF-UC450', 'Demo Foods', 'Good', 'In warehouse, ready to work', 'Warehouse', 'WH-DM-JHB', null, true),
  ('DEMOFOODS', 'DF000023', 'DF-SN-310814', 'DF-CF400', 'Demo Foods', 'Good', 'In warehouse, ready to work', 'Warehouse', 'WH-DM-JHB', null, true),
  ('DEMOFOODS', 'DF000024', 'DF-SN-310851', 'DF-CT60', 'Demo Foods', 'Good', 'In warehouse, ready to work', 'Warehouse', 'WH-DM-JHB', null, true),
  ('DEMOFOODS', 'DF000025', 'DF-SN-310888', 'DF-UC450', 'Demo Foods', 'Good', 'In warehouse, ready to work', 'Warehouse', 'WH-DM-DBN', null, true),
  ('DEMOFOODS', 'DF000026', 'DF-SN-310925', 'DF-CF400', 'Demo Foods', 'Good', 'In warehouse, ready to work', 'Warehouse', 'WH-DM-DBN', null, true),
  ('DEMOFOODS', 'DF000027', 'DF-SN-310962', 'DF-CT60', 'Demo Foods', 'Poor', 'In warehouse, awaiting repair', 'Warehouse', 'WH-DM-JHB', null, true),
  ('DEMOFOODS', 'DF000028', 'DF-SN-310999', 'DF-UC450', 'Demo Foods', 'Not working', 'In warehouse, awaiting repair', 'Warehouse', 'WH-DM-DBN', null, true),
  ('DEMOFOODS', 'DF000029', 'DF-SN-311036', 'DF-CF400', 'Demo Foods', 'Fair', 'In repair', 'Warehouse', 'WH-DM-JHB', null, true),
  ('DEMOFOODS', 'DF000030', 'DF-SN-311073', 'DF-CT60', 'Demo Foods', 'Fair', 'In repair', 'Warehouse', 'WH-DM-JHB', null, true)
on conflict (client_code, asset_number) do nothing;

-- 3. Demo Foods reps (PIN 1234) + outlets linked to rep and warehouse + customer portal links
do $$
declare cid uuid;
begin
  select id into cid from public.coolerco_concessionaires where display_name = 'Demo Foods Rep Gauteng' and client_code = 'DEMOFOODS';
  if cid is null then
    insert into public.coolerco_concessionaires (display_name, active, notes, client_code, kind)
    values ('Demo Foods Rep Gauteng', true, 'Demo representative (048), rep code REP-DF01', 'DEMOFOODS', 'representative') returning id into cid;
  end if;
  insert into public.coolerco_concessionaire_names (rop_name, concessionaire_id)
  select 'DEMO FOODS REP GAUTENG', cid where not exists (select 1 from public.coolerco_concessionaire_names where rop_name = 'DEMO FOODS REP GAUTENG');
  if not exists (select 1 from public.coolerco_concessionaire_users where concessionaire_id = cid) then
    insert into public.coolerco_concessionaire_users (concessionaire_id, name, email, pin_hash, active, created_by)
    values (cid, 'Demo Foods Rep Gauteng', 'rep-df01@demo.coolerco.test', extensions.crypt('1234', extensions.gen_salt('bf')), true, 'demo 048');
  end if;
end $$;
do $$
declare cid uuid;
begin
  select id into cid from public.coolerco_concessionaires where display_name = 'Demo Foods Rep KZN' and client_code = 'DEMOFOODS';
  if cid is null then
    insert into public.coolerco_concessionaires (display_name, active, notes, client_code, kind)
    values ('Demo Foods Rep KZN', true, 'Demo representative (048), rep code REP-DF02', 'DEMOFOODS', 'representative') returning id into cid;
  end if;
  insert into public.coolerco_concessionaire_names (rop_name, concessionaire_id)
  select 'DEMO FOODS REP KZN', cid where not exists (select 1 from public.coolerco_concessionaire_names where rop_name = 'DEMO FOODS REP KZN');
  if not exists (select 1 from public.coolerco_concessionaire_users where concessionaire_id = cid) then
    insert into public.coolerco_concessionaire_users (concessionaire_id, name, email, pin_hash, active, created_by)
    values (cid, 'Demo Foods Rep KZN', 'rep-df02@demo.coolerco.test', extensions.crypt('1234', extensions.gen_salt('bf')), true, 'demo 048');
  end if;
end $$;
insert into public.coolerco_pos_warehouse (pos_local_code, point_of_sale, concessionaire, warehouse_code, source, needs_review, review_note, updated_at, updated_by) values
  ('DF-OUT-001', 'Mama Thandi Kitchen (Demo Foods)', 'DEMO FOODS REP GAUTENG', 'WH-DM-JHB', 'demo', false, 'Demo outlet (048)', now(), 'demo 048'),
  ('DF-OUT-002', 'Ekasi Butchery (Demo Foods)', 'DEMO FOODS REP GAUTENG', 'WH-DM-JHB', 'demo', false, 'Demo outlet (048)', now(), 'demo 048'),
  ('DF-OUT-003', 'Jozi Bakery Corner (Demo Foods)', 'DEMO FOODS REP GAUTENG', 'WH-DM-JHB', 'demo', false, 'Demo outlet (048)', now(), 'demo 048'),
  ('DF-OUT-004', 'Northgate Deli (Demo Foods)', 'DEMO FOODS REP GAUTENG', 'WH-DM-JHB', 'demo', false, 'Demo outlet (048)', now(), 'demo 048'),
  ('DF-OUT-005', 'Ivory Park Superette (Demo Foods)', 'DEMO FOODS REP GAUTENG', 'WH-DM-JHB', 'demo', false, 'Demo outlet (048)', now(), 'demo 048'),
  ('DF-OUT-006', 'Eastrand Butchery (Demo Foods)', 'DEMO FOODS REP GAUTENG', 'WH-DM-JHB', 'demo', false, 'Demo outlet (048)', now(), 'demo 048'),
  ('DF-OUT-007', 'Vaal Corner Cafe (Demo Foods)', 'DEMO FOODS REP GAUTENG', 'WH-DM-JHB', 'demo', false, 'Demo outlet (048)', now(), 'demo 048'),
  ('DF-OUT-008', 'Pretoria West Deli (Demo Foods)', 'DEMO FOODS REP GAUTENG', 'WH-DM-JHB', 'demo', false, 'Demo outlet (048)', now(), 'demo 048'),
  ('DF-OUT-009', 'Berea Bakery (Demo Foods)', 'DEMO FOODS REP KZN', 'WH-DM-DBN', 'demo', false, 'Demo outlet (048)', now(), 'demo 048'),
  ('DF-OUT-010', 'Phoenix Butchery (Demo Foods)', 'DEMO FOODS REP KZN', 'WH-DM-DBN', 'demo', false, 'Demo outlet (048)', now(), 'demo 048'),
  ('DF-OUT-011', 'Amanzimtoti Superette (Demo Foods)', 'DEMO FOODS REP KZN', 'WH-DM-DBN', 'demo', false, 'Demo outlet (048)', now(), 'demo 048'),
  ('DF-OUT-012', 'Westville Deli (Demo Foods)', 'DEMO FOODS REP KZN', 'WH-DM-DBN', 'demo', false, 'Demo outlet (048)', now(), 'demo 048')
on conflict (pos_local_code) do nothing;

insert into public.coolerco_portal_links (token, pos_local_code, point_of_sale, contact_name, contact_number, mobile_number, notify_email, notify_whatsapp, trading_hours, active, otp_required, client_code, created_by)
select replace(replace(replace(encode(extensions.gen_random_bytes(18), 'base64'), '/', '_'), '+', '-'), '=', ''), o.outlet_code, o.name, o.contact_person, o.mobile_number, o.mobile_number, false, false,
       'Open ' || o.opening_time || '-' || o.closing_time || ', deliveries ' || o.receiving_from || '-' || o.receiving_to, true, false, 'DEMOFOODS', 'demo 048'
  from public.coolerco_outlets o
 where o.client_code = 'DEMOFOODS' and not exists (select 1 from public.coolerco_portal_links l where l.pos_local_code = o.outlet_code);

-- 4. Service levels with the app's case type names (working days; case calendar uses them)
insert into public.coolerco_sla_rules (client_code, case_type, warehouse_workshop, working_days, clock_starts, note)
select c, t, null, d, s, 'Demo target (048)' from (values ('Deliver an Asset', 3, 'approved'), ('Repair at Shopper POS', 1, 'logged'), ('Repair at Workshop', 3, 'logged'),
     ('Removal of Asset', 5, 'approved'), ('Replacement of Asset', 3, 'approved'), ('Decal @WH', 5, 'logged')) x(t, d, s)
cross join (values ('DEMO'), ('DEMOFOODS')) y(c)
where not exists (select 1 from public.coolerco_sla_rules r where r.client_code = y.c and r.case_type = x.t);

-- 5. Demo cases (asset type and requested model description come from the registers)
insert into public.coolerco_cases (case_number, client_code, case_type, status_reason, motive, originator, origin, priority, warehouse_code, warehouse_workshop,
  responsible_ordering_party, point_of_sale, pos_local_code, latitude, longitude, address, case_contact_name, case_mobile_number,
  asset_type, mapped_asset, asset_delivered, asset_removed, asset_repaired, asset_condition, requested_product_base, description,
  begin_date, end_date, service_closure_date, sla_days, created_by_label, approved_by, approved_at, created_on, updated_at, tenant_id,
  symptom_code, product_impact, priority_source, repeat_of_case, repeat_days)
select v.no, v.client, v.ctype, v.status, v.motive, v.originator, v.origin, v.prio, v.wh, v.whw,
       v.rop, v.pos, v.posc, o.latitude, o.longitude, nullif(concat_ws(', ', o.street_address, o.suburb, o.town), ''), v.contact, v.mobile,
       coalesce(m.asset_type, rm.asset_type), coalesce(v.rep, v.rem, v.deliv), v.deliv, v.rem, v.rep, a.condition, rm.description, v.descr,
       v.begin_d::timestamptz, v.end_d::timestamptz, v.closure::timestamptz, v.sla::int, v.lab, v.appr_by, v.appr_at::timestamptz, v.created::timestamptz,
       coalesce(v.closure, v.created)::timestamptz, 'tenant_demo', v.sym, v.imp, case when v.sym is not null then 'symptom' end, v.repeat, v.repeat_days::int
  from (values

    ('CAS-151026-DMJ000901', 'DEMO', 'Decal @WH', 'Completed', null, 'Client', 'App', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG SOUTH', null, null, null, null, null, null, 'DM000050', null, 'Branding faded, rebrand before redeploy', '2026-10-15 10:58:00+02', '2026-10-22 17:00:00+02', '2026-10-21 14:40:00+02', 5, 'Demo Client Manager', null, null, '2026-10-15 10:58:00+02', null, null, null, null),
    ('CAS-301026-DMJ000901', 'DEMO', 'Replacement of Asset', 'Completed', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG NORTH', 'Lucky Fuel Stop Randburg (Demo)', 'DM-OUT-007', 'Demo Contact 7', '000 000 0007', 'DM000013', 'DM000056', null, 'DM-CT90', 'Old unit keeps breaking, please replace', '2026-10-30 15:05:00+02', '2026-11-04 17:00:00+02', '2026-11-04 10:00:00+02', 3, 'Portal: Demo Contact 7', 'Demo Rep Gauteng North', '2026-10-30 15:05:00+02', '2026-10-30 14:12:00+02', null, null, null, null),
    ('CAS-011026-DMJ000901', 'DEMO', 'Repair at Workshop', 'Completed', 'PORTAL_REQUEST', 'Concessionaire', 'Portal', 'Medium', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG NORTH', null, null, null, null, null, null, 'DM000049', null, 'Unit back at the workshop, needs repair', '2026-10-01 07:12:00+02', '2026-10-06 17:00:00+02', '2026-10-06 10:20:00+02', 3, 'Demo Rep Gauteng North (rep)', null, null, '2026-10-01 07:12:00+02', null, null, null, null),
    ('CAS-021126-DMJ000901', 'DEMO', 'Replacement of Asset', 'Completed', null, 'CoolerCo', 'App', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG SOUTH', 'Hilltop Tavern Midrand (Demo)', 'DM-OUT-016', 'Demo Contact 16', '000 000 0016', 'DM000031', 'DM000056', null, 'DM-CT90', 'Old unit keeps breaking, please replace', '2026-11-02 08:58:00+02', '2026-11-05 17:00:00+02', '2026-11-03 16:40:00+02', 3, 'Demo Supervisor', null, null, '2026-11-02 08:58:00+02', null, null, null, null),
    ('CAS-261026-DMJ000901', 'DEMO', 'Deliver an Asset', 'Completed', null, 'Client', 'App', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG SOUTH', 'Greenfield Tavern Kempton Park (Demo)', 'DM-OUT-008', 'Demo Contact 8', '000 000 0008', 'DM000016', null, null, 'DM-CF300', 'New unit needed for extra stock', '2026-10-26 12:58:00+02', '2026-10-29 17:00:00+02', '2026-10-27 12:00:00+02', 3, 'Demo Client Manager', null, null, '2026-10-26 12:58:00+02', null, null, null, null),
    ('CAS-131126-DMJ000901', 'DEMO', 'Replacement of Asset', 'Completed', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG SOUTH', 'Greenfield Tavern Kempton Park (Demo)', 'DM-OUT-008', 'Demo Contact 8', '000 000 0008', 'DM000016', 'DM000057', null, 'DM-CT90', 'Old unit keeps breaking, please replace', '2026-11-13 14:05:00+02', '2026-11-18 17:00:00+02', '2026-11-23 16:20:00+02', 3, 'Portal: Demo Contact 8', 'Demo Rep Gauteng South', '2026-11-13 14:05:00+02', '2026-11-13 13:47:00+02', null, null, null, null),
    ('CAS-301026-DMJ000902', 'DEMO', 'Repair at Shopper POS', 'Completed', null, 'CoolerCo', 'App', 'Medium', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG NORTH', 'Lucky Fuel Stop Randburg (Demo)', 'DM-OUT-007', 'Demo Contact 7', '000 000 0007', null, null, 'DM000013', null, 'Water leaking under the unit', '2026-10-30 15:05:00+02', '2026-11-02 17:00:00+02', '2026-11-04 16:40:00+02', 1, 'Demo Supervisor', null, null, '2026-10-30 15:05:00+02', 'LEAKING', null, null, null),
    ('CAS-011026-DMD000901', 'DEMO', 'Repair at Workshop', 'Completed', 'PORTAL_REQUEST', 'Concessionaire', 'Portal', 'Medium', 'WH-DM-DBN', 'Demo Durban', 'DEMO REP KZN SOUTH', null, null, null, null, null, null, 'DM000065', null, 'Unit back at the workshop, needs repair', '2026-10-01 13:05:00+02', '2026-10-06 17:00:00+02', '2026-10-09 14:20:00+02', 3, 'Demo Rep KZN South (rep)', null, null, '2026-10-01 13:05:00+02', null, null, null, null),
    ('CAS-051126-DMJ000901', 'DEMO', 'Repair at Shopper POS', 'Completed', 'PORTAL_REQUEST', 'Customer', 'Portal', 'High', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG SOUTH', 'Corner Supermarket Tembisa (Demo)', 'DM-OUT-014', 'Demo Contact 14', '000 000 0014', null, null, 'DM000028', null, 'Light not working', '2026-11-05 13:05:00+02', '2026-11-06 17:00:00+02', '2026-11-06 10:20:00+02', 1, 'Portal: Demo Contact 14', null, null, '2026-11-05 13:05:00+02', 'LIGHT', 'SPOILT', null, null),
    ('CAS-191026-DMD000901', 'DEMO', 'Repair at Shopper POS', 'Cancelled', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Medium', 'WH-DM-DBN', 'Demo Durban', 'DEMO REP KZN SOUTH', 'Unity Tavern Chatsworth (Demo)', 'DM-OUT-024', 'Demo Contact 24', '000 000 0024', null, null, 'DM000048', null, 'Water leaking under the unit', '2026-10-19 09:20:00+02', '2026-10-20 17:00:00+02', '2026-10-20 12:00:00+02', 1, 'Portal: Demo Contact 24', null, null, '2026-10-19 09:20:00+02', 'LEAKING', null, null, null),
    ('CAS-151026-DMD000901', 'DEMO', 'Repair at Shopper POS', 'Completed', null, 'Client', 'App', 'Medium', 'WH-DM-DBN', 'Demo Durban', 'DEMO REP KZN NORTH', 'Star Fuel Stop Pinetown (Demo)', 'DM-OUT-023', 'Demo Contact 23', '000 000 0023', null, null, 'DM000046', null, 'Water leaking under the unit', '2026-10-15 15:35:00+02', '2026-10-16 17:00:00+02', '2026-10-16 15:00:00+02', 1, 'Demo Client Manager', null, null, '2026-10-15 15:35:00+02', 'LEAKING', 'WILL_SPOIL', null, null),
    ('CAS-091126-DMJ000901', 'DEMO', 'Removal of Asset', 'Completed', null, 'CoolerCo', 'App', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG SOUTH', 'Family Supermarket Germiston (Demo)', 'DM-OUT-018', 'Demo Contact 18', '000 000 0018', null, 'DM000058', null, null, 'Outlet closing / no longer needs the unit', '2026-11-09 07:05:00+02', '2026-11-16 17:00:00+02', '2026-11-11 13:40:00+02', 5, 'Demo Supervisor', null, null, '2026-11-09 07:05:00+02', null, null, null, null),
    ('CAS-011026-DMJ000902', 'DEMO', 'Repair at Workshop', 'Completed', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Medium', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG NORTH', null, null, null, null, null, null, 'DM000050', null, 'Unit back at the workshop, needs repair', '2026-10-01 11:20:00+02', '2026-10-06 17:00:00+02', '2026-10-04 15:00:00+02', 3, 'Portal: Demo Contact 5', null, null, '2026-10-01 11:20:00+02', null, null, null, null),
    ('CAS-021026-DMD000901', 'DEMO', 'Deliver an Asset', 'Completed', 'PORTAL_REQUEST', 'Concessionaire', 'Portal', 'Low', 'WH-DM-DBN', 'Demo Durban', 'DEMO REP KZN NORTH', 'Star Fuel Stop Pinetown (Demo)', 'DM-OUT-011', 'Demo Contact 11', '000 000 0011', 'DM000022', null, null, 'DM-UF700', 'New unit needed for extra stock', '2026-10-02 08:35:00+02', '2026-10-07 17:00:00+02', '2026-10-07 14:40:00+02', 3, 'Demo Rep KZN North (rep)', null, null, '2026-10-02 08:35:00+02', null, null, null, null),
    ('CAS-081026-DMJ000901', 'DEMO', 'Replacement of Asset', 'Cancelled', null, 'CoolerCo', 'App', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG NORTH', 'Sunrise Spaza Soweto (Demo)', 'DM-OUT-001', 'Demo Contact 1', '000 000 0001', null, 'DM000002', null, 'DM-CF300', 'Old unit keeps breaking, please replace', '2026-10-08 15:58:00+02', '2026-10-13 17:00:00+02', '2026-10-09 12:00:00+02', 3, 'Demo Supervisor', null, null, '2026-10-08 15:58:00+02', null, null, null, null),
    ('CAS-101126-DMJ000901', 'DEMO', 'Deliver an Asset', 'Completed', null, 'Client', 'App', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG SOUTH', 'Greenfield Tavern Kempton Park (Demo)', 'DM-OUT-020', 'Demo Contact 20', '000 000 0020', 'DM000040', null, null, 'DM-CF500', 'New unit needed for extra stock', '2026-11-10 13:58:00+02', '2026-11-13 17:00:00+02', '2026-11-17 14:00:00+02', 3, 'Demo Client Manager', null, null, '2026-11-10 13:58:00+02', null, null, null, null),
    ('CAS-151026-DMJ000902', 'DEMO', 'Repair at Shopper POS', 'Completed', null, 'Client', 'App', 'Medium', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG NORTH', 'Kasi Fuel Stop Alexandra (Demo)', 'DM-OUT-015', 'Demo Contact 15', '000 000 0015', null, null, 'DM000030', null, 'Water leaking under the unit', '2026-10-15 10:35:00+02', '2026-10-16 17:00:00+02', '2026-10-16 11:20:00+02', 1, 'Demo Client Manager', null, null, '2026-10-15 10:35:00+02', 'LEAKING', null, null, null),
    ('CAS-221026-DMJ000901', 'DEMO', 'Repair at Shopper POS', 'Completed', null, 'Client', 'App', 'Medium', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG SOUTH', 'Greenfield Tavern Kempton Park (Demo)', 'DM-OUT-008', 'Demo Contact 8', '000 000 0008', null, null, 'DM000015', null, 'Not cooling, product getting warm', '2026-10-22 11:35:00+02', '2026-10-23 17:00:00+02', '2026-10-23 14:40:00+02', 1, 'Demo Client Manager', null, null, '2026-10-22 11:35:00+02', 'NOT_COOLING', null, null, null),
    ('CAS-261026-DMD000901', 'DEMO', 'Removal of Asset', 'Completed', null, 'CoolerCo', 'App', 'Low', 'WH-DM-DBN', 'Demo Durban', 'DEMO REP KZN NORTH', 'Star Fuel Stop Pinetown (Demo)', 'DM-OUT-023', 'Demo Contact 23', '000 000 0023', null, 'DM000067', null, null, 'Outlet closing / no longer needs the unit', '2026-10-26 12:05:00+02', '2026-11-02 17:00:00+02', '2026-10-31 16:20:00+02', 5, 'Demo Supervisor', null, null, '2026-10-26 12:05:00+02', null, null, null, null),
    ('CAS-081026-DMJ000902', 'DEMO', 'Replacement of Asset', 'Rejected', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG SOUTH', 'Hilltop Tavern Midrand (Demo)', 'DM-OUT-004', 'Demo Contact 4', '000 000 0004', null, 'DM000007', null, 'DM-CF500', 'Old unit keeps breaking, please replace', null, null, '2026-10-08 14:15:00+02', 3, 'Portal: Demo Contact 4', null, null, '2026-10-08 12:05:00+02', null, null, null, null),
    ('CAS-121026-DMJ000901', 'DEMO', 'Replacement of Asset', 'Completed', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG SOUTH', 'Hilltop Tavern Midrand (Demo)', 'DM-OUT-016', 'Demo Contact 16', '000 000 0016', 'DM000032', 'DM000057', null, 'DM-UC350', 'Old unit keeps breaking, please replace', '2026-10-12 09:05:00+02', '2026-10-15 17:00:00+02', '2026-10-14 14:40:00+02', 3, 'Portal: Demo Contact 16', 'Demo Rep Gauteng South', '2026-10-12 09:05:00+02', '2026-10-12 08:05:00+02', null, null, null, null),
    ('CAS-091026-DMJ000901', 'DEMO', 'Deliver an Asset', 'Completed', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG SOUTH', 'Hilltop Tavern Midrand (Demo)', 'DM-OUT-004', 'Demo Contact 4', '000 000 0004', 'DM000008', null, null, 'DM-UF700', 'New unit needed for extra stock', '2026-10-12 10:05:00+02', '2026-10-15 17:00:00+02', '2026-10-15 15:20:00+02', 3, 'Portal: Demo Contact 4', 'Demo Rep Gauteng South', '2026-10-12 10:05:00+02', '2026-10-09 13:47:00+02', null, null, null, null),
    ('CAS-091126-DMJ000902', 'DEMO', 'Repair at Workshop', 'Completed', null, 'Client', 'App', 'Medium', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG NORTH', null, null, null, null, null, null, 'DM000054', null, 'Unit back at the workshop, needs repair', '2026-11-09 12:35:00+02', '2026-11-12 17:00:00+02', '2026-11-11 10:40:00+02', 3, 'Demo Client Manager', null, null, '2026-11-09 12:35:00+02', null, null, null, null),
    ('CAS-041126-DMD000901', 'DEMO', 'Repair at Workshop', 'Completed', 'PORTAL_REQUEST', 'Concessionaire', 'Portal', 'Medium', 'WH-DM-DBN', 'Demo Durban', 'DEMO REP KZN NORTH', null, null, null, null, null, null, 'DM000064', null, 'Unit back at the workshop, needs repair', '2026-11-04 08:58:00+02', '2026-11-09 17:00:00+02', '2026-11-05 10:40:00+02', 3, 'Demo Rep KZN North (rep)', null, null, '2026-11-04 08:58:00+02', null, null, null, null),
    ('CAS-141026-DMD000901', 'DEMO', 'Repair at Workshop', 'Completed', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Medium', 'WH-DM-DBN', 'Demo Durban', 'DEMO REP KZN SOUTH', null, null, null, null, null, null, 'DM000066', null, 'Unit back at the workshop, needs repair', '2026-10-14 08:12:00+02', '2026-10-19 17:00:00+02', '2026-10-22 11:40:00+02', 3, 'Portal: Demo Contact 24', null, null, '2026-10-14 08:12:00+02', null, null, null, null),
    ('CAS-041126-DMJ000901', 'DEMO', 'Removal of Asset', 'Completed', null, 'Client', 'App', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG SOUTH', 'Family Supermarket Germiston (Demo)', 'DM-OUT-018', 'Demo Contact 18', '000 000 0018', null, 'DM000057', null, null, 'Outlet closing / no longer needs the unit', '2026-11-04 09:35:00+02', '2026-11-11 17:00:00+02', '2026-11-07 10:00:00+02', 5, 'Demo Client Manager', null, null, '2026-11-04 09:35:00+02', null, null, null, null),
    ('CAS-111126-DMD000901', 'DEMO', 'Repair at Shopper POS', 'Completed', 'PORTAL_REQUEST', 'Concessionaire', 'Portal', 'Medium', 'WH-DM-DBN', 'Demo Durban', 'DEMO REP KZN SOUTH', 'Valley Supermarket KwaMashu (Demo)', 'DM-OUT-022', 'Demo Contact 22', '000 000 0022', null, null, 'DM000043', null, 'Water leaking under the unit', '2026-11-11 15:47:00+02', '2026-11-12 17:00:00+02', '2026-11-12 10:00:00+02', 1, 'Demo Rep KZN South (rep)', null, null, '2026-11-11 15:47:00+02', 'LEAKING', null, null, null),
    ('CAS-191026-DMJ000901', 'DEMO', 'Deliver an Asset', 'Completed', null, 'CoolerCo', 'App', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG NORTH', 'Kasi Fuel Stop Alexandra (Demo)', 'DM-OUT-003', 'Demo Contact 3', '000 000 0003', 'DM000006', null, null, 'DM-UF700', 'New unit needed for extra stock', '2026-10-19 13:12:00+02', '2026-10-22 17:00:00+02', '2026-10-22 15:00:00+02', 3, 'Demo Supervisor', null, null, '2026-10-19 13:12:00+02', null, null, null, null),
    ('CAS-281026-DMJ000901', 'DEMO', 'Deliver an Asset', 'Completed', null, 'CoolerCo', 'App', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG SOUTH', 'Corner Supermarket Tembisa (Demo)', 'DM-OUT-002', 'Demo Contact 2', '000 000 0002', 'DM000003', null, null, 'DM-UC350', 'New unit needed for extra stock', '2026-10-28 13:58:00+02', '2026-11-02 17:00:00+02', '2026-11-02 13:00:00+02', 3, 'Demo Supervisor', null, null, '2026-10-28 13:58:00+02', null, null, null, null),
    ('CAS-301026-DMJ000903', 'DEMO', 'Repair at Workshop', 'Completed', 'PORTAL_REQUEST', 'Concessionaire', 'Portal', 'Medium', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG SOUTH', null, null, null, null, null, null, 'DM000049', null, 'Unit back at the workshop, needs repair', '2026-10-30 13:47:00+02', '2026-11-04 17:00:00+02', '2026-11-04 13:40:00+02', 3, 'Demo Rep Gauteng South (rep)', null, null, '2026-10-30 13:47:00+02', null, null, null, null),
    ('CAS-121126-DMD000901', 'DEMO', 'Repair at Shopper POS', 'Open', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Medium', 'WH-DM-DBN', 'Demo Durban', 'DEMO REP KZN NORTH', 'Express Spaza Umlazi (Demo)', 'DM-OUT-021', 'Demo Contact 21', '000 000 0021', null, null, 'DM000042', null, 'Door seal torn, door does not close', '2026-11-12 10:35:00+02', '2026-11-13 17:00:00+02', null, 1, 'Portal: Demo Contact 21', null, null, '2026-11-12 10:35:00+02', 'DOOR_SEAL', null, null, null),
    ('CAS-131126-DMD000901', 'DEMO', 'Deliver an Asset', 'In Progress', 'PORTAL_REQUEST', 'Concessionaire', 'Portal', 'Low', 'WH-DM-DBN', 'Demo Durban', 'DEMO REP KZN SOUTH', 'Unity Tavern Chatsworth (Demo)', 'DM-OUT-012', 'Demo Contact 12', '000 000 0012', null, null, null, 'DM-CF300', 'New unit needed for extra stock', '2026-11-13 08:47:00+02', '2026-11-18 17:00:00+02', null, 3, 'Demo Rep KZN South (rep)', null, null, '2026-11-13 08:47:00+02', null, null, null, null),
    ('CAS-111126-DMJ000901', 'DEMO', 'Repair at Workshop', 'In Progress', null, 'CoolerCo', 'App', 'Medium', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG NORTH', null, null, null, null, null, null, 'DM000059', null, 'Unit back at the workshop, needs repair', '2026-11-11 14:47:00+02', '2026-11-16 17:00:00+02', null, 3, 'Demo Supervisor', null, null, '2026-11-11 14:47:00+02', null, null, null, null),
    ('CAS-101126-DMD000901', 'DEMO', 'Removal of Asset', 'Open', null, 'Client', 'App', 'Low', 'WH-DM-DBN', 'Demo Durban', 'DEMO REP KZN NORTH', 'Star Fuel Stop Pinetown (Demo)', 'DM-OUT-011', 'Demo Contact 11', '000 000 0011', null, 'DM000021', null, null, 'Outlet closing / no longer needs the unit', '2026-11-10 11:20:00+02', '2026-11-17 17:00:00+02', null, 5, 'Demo Client Manager', null, null, '2026-11-10 11:20:00+02', null, null, null, null),
    ('CAS-201126-DMD000901', 'DEMO', 'Repair at Shopper POS', 'On Hold', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Medium', 'WH-DM-DBN', 'Demo Durban', 'DEMO REP KZN SOUTH', 'Valley Supermarket KwaMashu (Demo)', 'DM-OUT-022', 'Demo Contact 22', '000 000 0022', null, null, 'DM000043', null, 'Light not working', '2026-11-20 12:05:00+02', '2026-11-23 17:00:00+02', null, 1, 'Portal: Demo Contact 22', null, null, '2026-11-20 12:05:00+02', 'LIGHT', 'MOVED_BACKUP', null, null),
    ('CAS-191126-DMD000901', 'DEMO', 'Deliver an Asset', 'Open', null, 'Client', 'App', 'Low', 'WH-DM-DBN', 'Demo Durban', 'DEMO REP KZN SOUTH', 'Unity Tavern Chatsworth (Demo)', 'DM-OUT-024', 'Demo Contact 24', '000 000 0024', null, null, null, 'DM-UF400', 'New unit needed for extra stock', '2026-11-19 15:35:00+02', '2026-11-24 17:00:00+02', null, 3, 'Demo Client Manager', null, null, '2026-11-19 15:35:00+02', null, null, null, null),
    ('CAS-201126-DMJ000901', 'DEMO', 'Replacement of Asset', 'In Progress', 'PORTAL_REQUEST', 'Concessionaire', 'Portal', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG SOUTH', 'Corner Supermarket Tembisa (Demo)', 'DM-OUT-014', 'Demo Contact 14', '000 000 0014', null, 'DM000027', null, 'DM-CF300', 'Old unit keeps breaking, please replace', '2026-11-20 11:12:00+02', '2026-11-25 17:00:00+02', null, 3, 'Demo Rep Gauteng South (rep)', null, null, '2026-11-20 11:12:00+02', null, null, null, null),
    ('CAS-231126-DMD000901', 'DEMO', 'Repair at Shopper POS', 'Open', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Medium', 'WH-DM-DBN', 'Demo Durban', 'DEMO REP KZN SOUTH', 'Valley Supermarket KwaMashu (Demo)', 'DM-OUT-022', 'Demo Contact 22', '000 000 0022', null, null, 'DM000044', null, 'Unit does not switch on', '2026-11-23 13:58:00+02', '2026-11-24 17:00:00+02', null, 1, 'Portal: Demo Contact 22', null, null, '2026-11-23 13:58:00+02', 'NOT_SWITCHING', 'MOVED_BACKUP', null, null),
    ('CAS-241126-DMD000901', 'DEMO', 'Repair at Shopper POS', 'Open', null, 'CoolerCo', 'App', 'High', 'WH-DM-DBN', 'Demo Durban', 'DEMO REP KZN SOUTH', 'Valley Supermarket KwaMashu (Demo)', 'DM-OUT-022', 'Demo Contact 22', '000 000 0022', null, null, 'DM000044', null, 'Water leaking under the unit', '2026-11-24 14:20:00+02', '2026-11-25 17:00:00+02', null, 1, 'Demo Supervisor', null, null, '2026-11-24 14:20:00+02', 'LEAKING', 'SPOILT', null, null),
    ('CAS-231126-DMJ000901', 'DEMO', 'Repair at Workshop', 'Open', null, 'CoolerCo', 'App', 'Medium', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG NORTH', null, null, null, null, null, null, 'DM000056', null, 'Unit back at the workshop, needs repair', '2026-11-23 12:12:00+02', '2026-11-26 17:00:00+02', null, 3, 'Demo Supervisor', null, null, '2026-11-23 12:12:00+02', null, null, null, null),
    ('CAS-201126-DMJ000902', 'DEMO', 'Decal @WH', 'Open', null, 'CoolerCo', 'App', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG NORTH', null, null, null, null, null, null, 'DM000052', null, 'Branding faded, rebrand before redeploy', '2026-11-20 09:12:00+02', '2026-11-27 17:00:00+02', null, 5, 'Demo Supervisor', null, null, '2026-11-20 09:12:00+02', null, null, null, null),
    ('CAS-231126-DMJ000902', 'DEMO', 'Deliver an Asset', 'Waiting for Approval', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG SOUTH', 'Family Supermarket Germiston (Demo)', 'DM-OUT-006', 'Demo Contact 6', '000 000 0006', null, null, null, 'DM-UF700', 'New unit needed for extra stock', null, null, null, 3, 'Portal: Demo Contact 6', null, null, '2026-11-23 12:47:00+02', null, null, null, null),
    ('CAS-241126-DMJ000901', 'DEMO', 'Replacement of Asset', 'Waiting for Approval', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG NORTH', 'Sunrise Spaza Soweto (Demo)', 'DM-OUT-013', 'Demo Contact 13', '000 000 0013', null, 'DM000025', null, 'DM-UF700', 'Old unit keeps breaking, please replace', null, null, null, 3, 'Portal: Demo Contact 13', null, null, '2026-11-24 09:05:00+02', null, null, null, null),
    ('CAS-241126-DMD000902', 'DEMO', 'Removal of Asset', 'Waiting for Approval', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Low', 'WH-DM-DBN', 'Demo Durban', 'DEMO REP KZN NORTH', 'Star Fuel Stop Pinetown (Demo)', 'DM-OUT-011', 'Demo Contact 11', '000 000 0011', null, 'DM000022', null, null, 'Outlet closing / no longer needs the unit', null, null, null, 5, 'Portal: Demo Contact 11', null, null, '2026-11-24 07:20:00+02', null, null, null, null),
    ('CAS-181126-DMJ000901', 'DEMO', 'Repair at Shopper POS', 'In Progress', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Medium', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO REP GAUTENG NORTH', 'Lucky Fuel Stop Randburg (Demo)', 'DM-OUT-007', 'Demo Contact 7', '000 000 0007', null, null, 'DM000013', null, 'Very noisy compressor (again)', '2026-11-18 08:58:00+02', '2026-11-19 17:00:00+02', null, 1, 'Portal: Demo Contact 7', null, null, '2026-11-18 08:58:00+02', 'NOISY', 'WILL_SPOIL', 'CAS-301026-DMJ000902', 19),
    ('CAS-151026-DMJ000903', 'DEMOFOODS', 'Deliver an Asset', 'Completed', 'PORTAL_REQUEST', 'Concessionaire', 'Portal', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO FOODS REP GAUTENG', 'Jozi Bakery Corner (Demo Foods)', 'DF-OUT-003', 'Demo Foods Contact 3', '000 001 0003', 'DF000005', null, null, 'DF-CF400', 'New unit needed for extra stock', '2026-10-15 14:12:00+02', '2026-10-20 17:00:00+02', '2026-10-20 14:40:00+02', 3, 'Demo Foods Rep Gauteng (rep)', null, null, '2026-10-15 14:12:00+02', null, null, null, null),
    ('CAS-061026-DMD000901', 'DEMOFOODS', 'Removal of Asset', 'Completed', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Low', 'WH-DM-DBN', 'Demo Durban', 'DEMO FOODS REP KZN', 'Amanzimtoti Superette (Demo Foods)', 'DF-OUT-011', 'Demo Foods Contact 11', '000 001 0011', null, 'DF000028', null, null, 'Outlet closing / no longer needs the unit', '2026-10-07 10:05:00+02', '2026-10-14 17:00:00+02', '2026-10-13 14:40:00+02', 5, 'Portal: Demo Foods Contact 11', 'Demo Foods Rep KZN', '2026-10-07 10:05:00+02', '2026-10-06 13:12:00+02', null, null, null, null),
    ('CAS-091026-DMJ000902', 'DEMOFOODS', 'Repair at Shopper POS', 'Completed', null, 'Client', 'App', 'Medium', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO FOODS REP GAUTENG', 'Eastrand Butchery (Demo Foods)', 'DF-OUT-006', 'Demo Foods Contact 6', '000 001 0006', null, null, 'DF000012', null, 'Not cooling, product getting warm', '2026-10-09 14:58:00+02', '2026-10-12 17:00:00+02', '2026-10-12 12:40:00+02', 1, 'Demo Foods Manager', null, null, '2026-10-09 14:58:00+02', 'NOT_COOLING', 'WILL_SPOIL', null, null),
    ('CAS-061126-DMD000901', 'DEMOFOODS', 'Removal of Asset', 'Completed', null, 'Client', 'App', 'Low', 'WH-DM-DBN', 'Demo Durban', 'DEMO FOODS REP KZN', 'Phoenix Butchery (Demo Foods)', 'DF-OUT-010', 'Demo Foods Contact 10', '000 001 0010', null, 'DF000028', null, null, 'Outlet closing / no longer needs the unit', '2026-11-06 13:05:00+02', '2026-11-13 17:00:00+02', '2026-11-06 15:20:00+02', 5, 'Demo Foods Manager', null, null, '2026-11-06 13:05:00+02', null, null, null, null),
    ('CAS-261026-DMJ000902', 'DEMOFOODS', 'Decal @WH', 'Completed', 'PORTAL_REQUEST', 'Concessionaire', 'Portal', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO FOODS REP GAUTENG', null, null, null, null, null, null, 'DF000023', null, 'Branding faded, rebrand before redeploy', '2026-10-26 13:20:00+02', '2026-11-02 17:00:00+02', '2026-10-27 11:40:00+02', 5, 'Demo Foods Rep Gauteng (rep)', null, null, '2026-10-26 13:20:00+02', null, null, null, null),
    ('CAS-111126-DMD000902', 'DEMOFOODS', 'Deliver an Asset', 'Completed', null, 'CoolerCo', 'App', 'Low', 'WH-DM-DBN', 'Demo Durban', 'DEMO FOODS REP KZN', 'Phoenix Butchery (Demo Foods)', 'DF-OUT-010', 'Demo Foods Contact 10', '000 001 0010', 'DF000018', null, null, 'DF-CT60', 'New unit needed for extra stock', '2026-11-11 10:58:00+02', '2026-11-16 17:00:00+02', '2026-11-16 10:40:00+02', 3, 'Demo Supervisor', null, null, '2026-11-11 10:58:00+02', null, null, null, null),
    ('CAS-301026-DMJ000904', 'DEMOFOODS', 'Repair at Shopper POS', 'Completed', null, 'CoolerCo', 'App', 'High', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO FOODS REP GAUTENG', 'Mama Thandi Kitchen (Demo Foods)', 'DF-OUT-001', 'Demo Foods Contact 1', '000 001 0001', null, null, 'DF000002', null, 'Door seal torn, door does not close', '2026-10-30 08:12:00+02', '2026-11-02 17:00:00+02', '2026-11-05 12:40:00+02', 1, 'Demo Supervisor', null, null, '2026-10-30 08:12:00+02', 'DOOR_SEAL', 'SPOILT', null, null),
    ('CAS-221026-DMJ000902', 'DEMOFOODS', 'Repair at Shopper POS', 'Completed', null, 'Client', 'App', 'Medium', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO FOODS REP GAUTENG', 'Vaal Corner Cafe (Demo Foods)', 'DF-OUT-007', 'Demo Foods Contact 7', '000 001 0007', null, null, 'DF000014', null, 'Water leaking under the unit', '2026-10-22 11:12:00+02', '2026-10-23 17:00:00+02', '2026-10-23 16:20:00+02', 1, 'Demo Foods Manager', null, null, '2026-10-22 11:12:00+02', 'LEAKING', null, null, null),
    ('CAS-301026-DMJ000905', 'DEMOFOODS', 'Repair at Shopper POS', 'Completed', null, 'Client', 'App', 'Medium', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO FOODS REP GAUTENG', 'Vaal Corner Cafe (Demo Foods)', 'DF-OUT-007', 'Demo Foods Contact 7', '000 001 0007', null, null, 'DF000014', null, 'Very noisy compressor', '2026-10-30 15:12:00+02', '2026-11-02 17:00:00+02', '2026-10-30 11:20:00+02', 1, 'Demo Foods Manager', null, null, '2026-10-30 15:12:00+02', 'NOISY', 'MOVED_BACKUP', null, null),
    ('CAS-291026-DMJ000901', 'DEMOFOODS', 'Repair at Shopper POS', 'Completed', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Medium', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO FOODS REP GAUTENG', 'Ekasi Butchery (Demo Foods)', 'DF-OUT-002', 'Demo Foods Contact 2', '000 001 0002', null, null, 'DF000003', null, 'Ice building up inside', '2026-10-29 07:58:00+02', '2026-10-30 17:00:00+02', '2026-11-03 12:40:00+02', 1, 'Portal: Demo Foods Contact 2', null, null, '2026-10-29 07:58:00+02', 'ICE_BUILDUP', 'WILL_SPOIL', null, null),
    ('CAS-091126-DMJ000903', 'DEMOFOODS', 'Deliver an Asset', 'Completed', 'PORTAL_REQUEST', 'Concessionaire', 'Portal', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO FOODS REP GAUTENG', 'Vaal Corner Cafe (Demo Foods)', 'DF-OUT-007', 'Demo Foods Contact 7', '000 001 0007', 'DF000013', null, null, 'DF-CT60', 'New unit needed for extra stock', '2026-11-09 11:05:00+02', '2026-11-12 17:00:00+02', '2026-11-12 10:40:00+02', 3, 'Demo Foods Rep Gauteng (rep)', null, null, '2026-11-09 11:05:00+02', null, null, null, null),
    ('CAS-291026-DMJ000902', 'DEMOFOODS', 'Replacement of Asset', 'Cancelled', 'PORTAL_REQUEST', 'Concessionaire', 'Portal', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO FOODS REP GAUTENG', 'Northgate Deli (Demo Foods)', 'DF-OUT-004', 'Demo Foods Contact 4', '000 001 0004', null, 'DF000007', null, 'DF-CF400', 'Old unit keeps breaking, please replace', '2026-10-29 11:47:00+02', '2026-11-03 17:00:00+02', '2026-10-30 12:00:00+02', 3, 'Demo Foods Rep Gauteng (rep)', null, null, '2026-10-29 11:47:00+02', null, null, null, null),
    ('CAS-231026-DMD000901', 'DEMOFOODS', 'Replacement of Asset', 'Completed', null, 'Client', 'App', 'Low', 'WH-DM-DBN', 'Demo Durban', 'DEMO FOODS REP KZN', 'Phoenix Butchery (Demo Foods)', 'DF-OUT-010', 'Demo Foods Contact 10', '000 001 0010', 'DF000018', 'DF000028', null, 'DF-CF400', 'Old unit keeps breaking, please replace', '2026-10-23 08:05:00+02', '2026-10-28 17:00:00+02', '2026-10-28 15:40:00+02', 3, 'Demo Foods Manager', null, null, '2026-10-23 08:05:00+02', null, null, null, null),
    ('CAS-061126-DMD000902', 'DEMOFOODS', 'Deliver an Asset', 'Rejected', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Low', 'WH-DM-DBN', 'Demo Durban', 'DEMO FOODS REP KZN', 'Phoenix Butchery (Demo Foods)', 'DF-OUT-010', 'Demo Foods Contact 10', '000 001 0010', null, null, null, 'DF-CF400', 'New unit needed for extra stock', null, null, '2026-11-09 09:15:00+02', 3, 'Portal: Demo Foods Contact 10', null, null, '2026-11-06 13:12:00+02', null, null, null, null),
    ('CAS-131126-DMJ000902', 'DEMOFOODS', 'Repair at Shopper POS', 'Open', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Medium', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO FOODS REP GAUTENG', 'Pretoria West Deli (Demo Foods)', 'DF-OUT-008', 'Demo Foods Contact 8', '000 001 0008', null, null, 'DF000016', null, 'Water leaking under the unit', '2026-11-13 10:12:00+02', '2026-11-16 17:00:00+02', null, 1, 'Portal: Demo Foods Contact 8', null, null, '2026-11-13 10:12:00+02', 'LEAKING', null, null, null),
    ('CAS-181126-DMJ000902', 'DEMOFOODS', 'Deliver an Asset', 'In Progress', null, 'Client', 'App', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO FOODS REP GAUTENG', 'Pretoria West Deli (Demo Foods)', 'DF-OUT-008', 'Demo Foods Contact 8', '000 001 0008', null, null, null, 'DF-CF400', 'New unit needed for extra stock', '2026-11-18 12:05:00+02', '2026-11-23 17:00:00+02', null, 3, 'Demo Foods Manager', null, null, '2026-11-18 12:05:00+02', null, null, null, null),
    ('CAS-241126-DMJ000902', 'DEMOFOODS', 'Repair at Shopper POS', 'Open', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Medium', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO FOODS REP GAUTENG', 'Northgate Deli (Demo Foods)', 'DF-OUT-004', 'Demo Foods Contact 4', '000 001 0004', null, null, 'DF000008', null, 'Door seal torn, door does not close', '2026-11-24 08:58:00+02', '2026-11-25 17:00:00+02', null, 1, 'Portal: Demo Foods Contact 4', null, null, '2026-11-24 08:58:00+02', 'DOOR_SEAL', 'MOVED_BACKUP', null, null),
    ('CAS-201126-DMJ000903', 'DEMOFOODS', 'Repair at Workshop', 'In Progress', null, 'CoolerCo', 'App', 'Medium', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO FOODS REP GAUTENG', null, null, null, null, null, null, 'DF000029', null, 'Unit back at the workshop, needs repair', '2026-11-20 13:47:00+02', '2026-11-25 17:00:00+02', null, 3, 'Demo Supervisor', null, null, '2026-11-20 13:47:00+02', null, null, null, null),
    ('CAS-241126-DMJ000903', 'DEMOFOODS', 'Deliver an Asset', 'Waiting for Approval', 'PORTAL_REQUEST', 'Customer', 'Portal', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO FOODS REP GAUTENG', 'Mama Thandi Kitchen (Demo Foods)', 'DF-OUT-001', 'Demo Foods Contact 1', '000 001 0001', null, null, null, 'DF-UC450', 'New unit needed for extra stock', null, null, null, 3, 'Portal: Demo Foods Contact 1', null, null, '2026-11-24 14:05:00+02', null, null, null, null),
    ('CAS-211126-DMJ000901', 'DEMOFOODS', 'Removal of Asset', 'Open', 'PORTAL_REQUEST', 'Concessionaire', 'Portal', 'Low', 'WH-DM-JHB', 'Demo Gauteng', 'DEMO FOODS REP GAUTENG', 'Northgate Deli (Demo Foods)', 'DF-OUT-004', 'Demo Foods Contact 4', '000 001 0004', null, 'DF000007', null, null, 'Outlet closing / no longer needs the unit', '2026-11-21 15:12:00+02', '2026-11-27 17:00:00+02', null, 5, 'Demo Foods Rep Gauteng (rep)', null, null, '2026-11-21 15:12:00+02', null, null, null, null)
  ) v(no, client, ctype, status, motive, originator, origin, prio, wh, whw, rop, pos, posc, contact, mobile, deliv, rem, rep, req, descr,
       begin_d, end_d, closure, sla, lab, appr_by, appr_at, created, sym, imp, repeat, repeat_days)
  left join public.coolerco_outlets o on o.client_code = v.client and o.outlet_code = v.posc
  left join public.coolerco_assets a on a.client_code = v.client and a.asset_number = coalesce(v.rep, v.rem, v.deliv)
  left join public.coolerco_asset_models m on m.client_code = v.client and m.model_code = a.model_code
  left join public.coolerco_asset_models rm on rm.client_code = v.client and rm.model_code = v.req
on conflict (case_number) do nothing;

-- 6. Case history
insert into public.coolerco_case_events (case_number, event_type, from_status, to_status, reason_code, notes, actor_type, actor_label, created_at)
select v.no, 'status', v.f, v.t, v.r, v.n, v.act, v.lab, v.at::timestamptz
  from (values

    ('CAS-151026-DMJ000901', null, 'Open', null, null, 'client', 'Demo Client Manager', '2026-10-15 10:58:00+02'),
    ('CAS-151026-DMJ000901', 'Open', 'In Progress', null, 'Booked in at the workshop', 'staff', 'Demo Supervisor', '2026-10-16 08:30:00+02'),
    ('CAS-151026-DMJ000901', 'In Progress', 'Completed', null, 'New branding applied', 'staff', 'Demo Technician', '2026-10-21 14:40:00+02'),
    ('CAS-301026-DMJ000901', null, 'Waiting for Approval', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Contact 7', '2026-10-30 14:12:00+02'),
    ('CAS-301026-DMJ000901', 'Waiting for Approval', 'Open', 'APPROVED', 'Approved', 'concessionaire', 'Demo Rep Gauteng North', '2026-10-30 15:05:00+02'),
    ('CAS-301026-DMJ000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-11-02 08:30:00+02'),
    ('CAS-301026-DMJ000901', 'In Progress', 'Completed', null, 'New unit placed, old unit collected', 'staff', 'Demo Driver', '2026-11-04 10:00:00+02'),
    ('CAS-011026-DMJ000901', null, 'Open', 'PORTAL_REQUEST', null, 'concessionaire', 'Demo Rep Gauteng North (rep)', '2026-10-01 07:12:00+02'),
    ('CAS-011026-DMJ000901', 'Open', 'In Progress', null, 'Booked in at the workshop', 'staff', 'Demo Supervisor', '2026-10-02 08:30:00+02'),
    ('CAS-011026-DMJ000901', 'In Progress', 'Completed', null, 'Repaired, tested 24 h, ready to work', 'staff', 'Demo Technician', '2026-10-06 10:20:00+02'),
    ('CAS-021126-DMJ000901', null, 'Open', null, null, 'staff', 'Demo Supervisor', '2026-11-02 08:58:00+02'),
    ('CAS-021126-DMJ000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-11-03 08:30:00+02'),
    ('CAS-021126-DMJ000901', 'In Progress', 'Completed', null, 'New unit placed, old unit collected', 'staff', 'Demo Driver', '2026-11-03 16:40:00+02'),
    ('CAS-261026-DMJ000901', null, 'Open', null, null, 'client', 'Demo Client Manager', '2026-10-26 12:58:00+02'),
    ('CAS-261026-DMJ000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-27 08:30:00+02'),
    ('CAS-261026-DMJ000901', 'In Progress', 'Completed', null, 'Delivered and switched on; customer signed', 'staff', 'Demo Driver', '2026-10-27 12:00:00+02'),
    ('CAS-131126-DMJ000901', null, 'Waiting for Approval', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Contact 8', '2026-11-13 13:47:00+02'),
    ('CAS-131126-DMJ000901', 'Waiting for Approval', 'Open', 'APPROVED', 'Approved', 'concessionaire', 'Demo Rep Gauteng South', '2026-11-13 14:05:00+02'),
    ('CAS-131126-DMJ000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-11-13 08:30:00+02'),
    ('CAS-131126-DMJ000901', 'In Progress', 'Completed', null, 'New unit placed, old unit collected', 'staff', 'Demo Driver', '2026-11-23 16:20:00+02'),
    ('CAS-301026-DMJ000902', null, 'Open', null, null, 'staff', 'Demo Supervisor', '2026-10-30 15:05:00+02'),
    ('CAS-301026-DMJ000902', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-30 08:30:00+02'),
    ('CAS-301026-DMJ000902', 'In Progress', 'Completed', null, 'Repaired on site, cooling tested', 'staff', 'Demo Technician', '2026-11-04 16:40:00+02'),
    ('CAS-011026-DMD000901', null, 'Open', 'PORTAL_REQUEST', null, 'concessionaire', 'Demo Rep KZN South (rep)', '2026-10-01 13:05:00+02'),
    ('CAS-011026-DMD000901', 'Open', 'In Progress', null, 'Booked in at the workshop', 'staff', 'Demo Supervisor', '2026-10-02 08:30:00+02'),
    ('CAS-011026-DMD000901', 'In Progress', 'Completed', null, 'Repaired, tested 24 h, ready to work', 'staff', 'Demo Technician', '2026-10-09 14:20:00+02'),
    ('CAS-051126-DMJ000901', null, 'Open', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Contact 14', '2026-11-05 13:05:00+02'),
    ('CAS-051126-DMJ000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-11-06 08:30:00+02'),
    ('CAS-051126-DMJ000901', 'In Progress', 'Completed', null, 'Repaired on site, cooling tested', 'staff', 'Demo Technician', '2026-11-06 10:20:00+02'),
    ('CAS-191026-DMD000901', null, 'Open', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Contact 24', '2026-10-19 09:20:00+02'),
    ('CAS-191026-DMD000901', 'Open', 'Cancelled', 'CAN_NOT_NEEDED', 'Outlet asked to cancel', 'staff', 'Demo Supervisor', '2026-10-20 12:00:00+02'),
    ('CAS-151026-DMD000901', null, 'Open', null, null, 'client', 'Demo Client Manager', '2026-10-15 15:35:00+02'),
    ('CAS-151026-DMD000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-15 08:30:00+02'),
    ('CAS-151026-DMD000901', 'In Progress', 'Completed', null, 'Repaired on site, cooling tested', 'staff', 'Demo Technician', '2026-10-16 15:00:00+02'),
    ('CAS-091126-DMJ000901', null, 'Open', null, null, 'staff', 'Demo Supervisor', '2026-11-09 07:05:00+02'),
    ('CAS-091126-DMJ000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-11-09 08:30:00+02'),
    ('CAS-091126-DMJ000901', 'In Progress', 'Completed', null, 'Collected and returned to warehouse', 'staff', 'Demo Driver', '2026-11-11 13:40:00+02'),
    ('CAS-011026-DMJ000902', null, 'Open', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Contact 5', '2026-10-01 11:20:00+02'),
    ('CAS-011026-DMJ000902', 'Open', 'In Progress', null, 'Booked in at the workshop', 'staff', 'Demo Supervisor', '2026-10-02 08:30:00+02'),
    ('CAS-011026-DMJ000902', 'In Progress', 'Completed', null, 'Repaired, tested 24 h, ready to work', 'staff', 'Demo Technician', '2026-10-04 15:00:00+02'),
    ('CAS-021026-DMD000901', null, 'Open', 'PORTAL_REQUEST', null, 'concessionaire', 'Demo Rep KZN North (rep)', '2026-10-02 08:35:00+02'),
    ('CAS-021026-DMD000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-05 08:30:00+02'),
    ('CAS-021026-DMD000901', 'In Progress', 'Completed', null, 'Delivered and switched on; customer signed', 'staff', 'Demo Driver', '2026-10-07 14:40:00+02'),
    ('CAS-081026-DMJ000901', null, 'Open', null, null, 'staff', 'Demo Supervisor', '2026-10-08 15:58:00+02'),
    ('CAS-081026-DMJ000901', 'Open', 'Cancelled', 'CAN_NOT_NEEDED', 'Outlet asked to cancel', 'staff', 'Demo Supervisor', '2026-10-09 12:00:00+02'),
    ('CAS-101126-DMJ000901', null, 'Open', null, null, 'client', 'Demo Client Manager', '2026-11-10 13:58:00+02'),
    ('CAS-101126-DMJ000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-11-11 08:30:00+02'),
    ('CAS-101126-DMJ000901', 'In Progress', 'Completed', null, 'Delivered and switched on; customer signed', 'staff', 'Demo Driver', '2026-11-17 14:00:00+02'),
    ('CAS-151026-DMJ000902', null, 'Open', null, null, 'client', 'Demo Client Manager', '2026-10-15 10:35:00+02'),
    ('CAS-151026-DMJ000902', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-16 08:30:00+02'),
    ('CAS-151026-DMJ000902', 'In Progress', 'Completed', null, 'Repaired on site, cooling tested', 'staff', 'Demo Technician', '2026-10-16 11:20:00+02'),
    ('CAS-221026-DMJ000901', null, 'Open', null, null, 'client', 'Demo Client Manager', '2026-10-22 11:35:00+02'),
    ('CAS-221026-DMJ000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-23 08:30:00+02'),
    ('CAS-221026-DMJ000901', 'In Progress', 'Completed', null, 'Repaired on site, cooling tested', 'staff', 'Demo Technician', '2026-10-23 14:40:00+02'),
    ('CAS-261026-DMD000901', null, 'Open', null, null, 'staff', 'Demo Supervisor', '2026-10-26 12:05:00+02'),
    ('CAS-261026-DMD000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-26 08:30:00+02'),
    ('CAS-261026-DMD000901', 'In Progress', 'Completed', null, 'Collected and returned to warehouse', 'staff', 'Demo Driver', '2026-10-31 16:20:00+02'),
    ('CAS-081026-DMJ000902', null, 'Waiting for Approval', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Contact 4', '2026-10-08 12:05:00+02'),
    ('CAS-081026-DMJ000902', 'Waiting for Approval', 'Rejected', 'REJ_NOT_APPROVED', 'Outlet already has two units of this type', 'concessionaire', 'Demo Rep Gauteng South', '2026-10-08 14:15:00+02'),
    ('CAS-121026-DMJ000901', null, 'Waiting for Approval', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Contact 16', '2026-10-12 08:05:00+02'),
    ('CAS-121026-DMJ000901', 'Waiting for Approval', 'Open', 'APPROVED', 'Approved', 'concessionaire', 'Demo Rep Gauteng South', '2026-10-12 09:05:00+02'),
    ('CAS-121026-DMJ000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-13 08:30:00+02'),
    ('CAS-121026-DMJ000901', 'In Progress', 'Completed', null, 'New unit placed, old unit collected', 'staff', 'Demo Driver', '2026-10-14 14:40:00+02'),
    ('CAS-091026-DMJ000901', null, 'Waiting for Approval', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Contact 4', '2026-10-09 13:47:00+02'),
    ('CAS-091026-DMJ000901', 'Waiting for Approval', 'Open', 'APPROVED', 'Approved', 'concessionaire', 'Demo Rep Gauteng South', '2026-10-12 10:05:00+02'),
    ('CAS-091026-DMJ000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-13 08:30:00+02'),
    ('CAS-091026-DMJ000901', 'In Progress', 'Completed', null, 'Delivered and switched on; customer signed', 'staff', 'Demo Driver', '2026-10-15 15:20:00+02'),
    ('CAS-091126-DMJ000902', null, 'Open', null, null, 'client', 'Demo Client Manager', '2026-11-09 12:35:00+02'),
    ('CAS-091126-DMJ000902', 'Open', 'In Progress', null, 'Booked in at the workshop', 'staff', 'Demo Supervisor', '2026-11-10 08:30:00+02'),
    ('CAS-091126-DMJ000902', 'In Progress', 'Completed', null, 'Repaired, tested 24 h, ready to work', 'staff', 'Demo Technician', '2026-11-11 10:40:00+02'),
    ('CAS-041126-DMD000901', null, 'Open', 'PORTAL_REQUEST', null, 'concessionaire', 'Demo Rep KZN North (rep)', '2026-11-04 08:58:00+02'),
    ('CAS-041126-DMD000901', 'Open', 'In Progress', null, 'Booked in at the workshop', 'staff', 'Demo Supervisor', '2026-11-05 08:30:00+02'),
    ('CAS-041126-DMD000901', 'In Progress', 'Completed', null, 'Repaired, tested 24 h, ready to work', 'staff', 'Demo Technician', '2026-11-05 10:40:00+02'),
    ('CAS-141026-DMD000901', null, 'Open', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Contact 24', '2026-10-14 08:12:00+02'),
    ('CAS-141026-DMD000901', 'Open', 'In Progress', null, 'Booked in at the workshop', 'staff', 'Demo Supervisor', '2026-10-15 08:30:00+02'),
    ('CAS-141026-DMD000901', 'In Progress', 'Completed', null, 'Repaired, tested 24 h, ready to work', 'staff', 'Demo Technician', '2026-10-22 11:40:00+02'),
    ('CAS-041126-DMJ000901', null, 'Open', null, null, 'client', 'Demo Client Manager', '2026-11-04 09:35:00+02'),
    ('CAS-041126-DMJ000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-11-05 08:30:00+02'),
    ('CAS-041126-DMJ000901', 'In Progress', 'Completed', null, 'Collected and returned to warehouse', 'staff', 'Demo Driver', '2026-11-07 10:00:00+02'),
    ('CAS-111126-DMD000901', null, 'Open', 'PORTAL_REQUEST', null, 'concessionaire', 'Demo Rep KZN South (rep)', '2026-11-11 15:47:00+02'),
    ('CAS-111126-DMD000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-11-12 08:30:00+02'),
    ('CAS-111126-DMD000901', 'In Progress', 'Completed', null, 'Repaired on site, cooling tested', 'staff', 'Demo Technician', '2026-11-12 10:00:00+02'),
    ('CAS-191026-DMJ000901', null, 'Open', null, null, 'staff', 'Demo Supervisor', '2026-10-19 13:12:00+02'),
    ('CAS-191026-DMJ000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-19 08:30:00+02'),
    ('CAS-191026-DMJ000901', 'In Progress', 'Completed', null, 'Delivered and switched on; customer signed', 'staff', 'Demo Driver', '2026-10-22 15:00:00+02'),
    ('CAS-281026-DMJ000901', null, 'Open', null, null, 'staff', 'Demo Supervisor', '2026-10-28 13:58:00+02'),
    ('CAS-281026-DMJ000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-29 08:30:00+02'),
    ('CAS-281026-DMJ000901', 'In Progress', 'Completed', null, 'Delivered and switched on; customer signed', 'staff', 'Demo Driver', '2026-11-02 13:00:00+02'),
    ('CAS-301026-DMJ000903', null, 'Open', 'PORTAL_REQUEST', null, 'concessionaire', 'Demo Rep Gauteng South (rep)', '2026-10-30 13:47:00+02'),
    ('CAS-301026-DMJ000903', 'Open', 'In Progress', null, 'Booked in at the workshop', 'staff', 'Demo Supervisor', '2026-11-02 08:30:00+02'),
    ('CAS-301026-DMJ000903', 'In Progress', 'Completed', null, 'Repaired, tested 24 h, ready to work', 'staff', 'Demo Technician', '2026-11-04 13:40:00+02'),
    ('CAS-121126-DMD000901', null, 'Open', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Contact 21', '2026-11-12 10:35:00+02'),
    ('CAS-131126-DMD000901', null, 'Open', 'PORTAL_REQUEST', null, 'concessionaire', 'Demo Rep KZN South (rep)', '2026-11-13 08:47:00+02'),
    ('CAS-131126-DMD000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-11-16 08:30:00+02'),
    ('CAS-111126-DMJ000901', null, 'Open', null, null, 'staff', 'Demo Supervisor', '2026-11-11 14:47:00+02'),
    ('CAS-111126-DMJ000901', 'Open', 'In Progress', null, 'Booked in at the workshop', 'staff', 'Demo Supervisor', '2026-11-11 08:30:00+02'),
    ('CAS-101126-DMD000901', null, 'Open', null, null, 'client', 'Demo Client Manager', '2026-11-10 11:20:00+02'),
    ('CAS-201126-DMD000901', null, 'Open', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Contact 22', '2026-11-20 12:05:00+02'),
    ('CAS-201126-DMD000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-11-23 08:30:00+02'),
    ('CAS-201126-DMD000901', 'In Progress', 'On Hold', null, 'Waiting for spare part (compressor relay)', 'staff', 'Demo Technician', '2026-11-24 11:00:00+02'),
    ('CAS-191126-DMD000901', null, 'Open', null, null, 'client', 'Demo Client Manager', '2026-11-19 15:35:00+02'),
    ('CAS-201126-DMJ000901', null, 'Open', 'PORTAL_REQUEST', null, 'concessionaire', 'Demo Rep Gauteng South (rep)', '2026-11-20 11:12:00+02'),
    ('CAS-201126-DMJ000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-11-20 08:30:00+02'),
    ('CAS-231126-DMD000901', null, 'Open', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Contact 22', '2026-11-23 13:58:00+02'),
    ('CAS-241126-DMD000901', null, 'Open', null, null, 'staff', 'Demo Supervisor', '2026-11-24 14:20:00+02'),
    ('CAS-231126-DMJ000901', null, 'Open', null, null, 'staff', 'Demo Supervisor', '2026-11-23 12:12:00+02'),
    ('CAS-201126-DMJ000902', null, 'Open', null, null, 'staff', 'Demo Supervisor', '2026-11-20 09:12:00+02'),
    ('CAS-231126-DMJ000902', null, 'Waiting for Approval', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Contact 6', '2026-11-23 12:47:00+02'),
    ('CAS-241126-DMJ000901', null, 'Waiting for Approval', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Contact 13', '2026-11-24 09:05:00+02'),
    ('CAS-241126-DMD000902', null, 'Waiting for Approval', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Contact 11', '2026-11-24 07:20:00+02'),
    ('CAS-181126-DMJ000901', null, 'Open', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Contact 7', '2026-11-18 08:58:00+02'),
    ('CAS-181126-DMJ000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-11-18 08:30:00+02'),
    ('CAS-151026-DMJ000903', null, 'Open', 'PORTAL_REQUEST', null, 'concessionaire', 'Demo Foods Rep Gauteng (rep)', '2026-10-15 14:12:00+02'),
    ('CAS-151026-DMJ000903', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-16 08:30:00+02'),
    ('CAS-151026-DMJ000903', 'In Progress', 'Completed', null, 'Delivered and switched on; customer signed', 'staff', 'Demo Driver', '2026-10-20 14:40:00+02'),
    ('CAS-061026-DMD000901', null, 'Waiting for Approval', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Foods Contact 11', '2026-10-06 13:12:00+02'),
    ('CAS-061026-DMD000901', 'Waiting for Approval', 'Open', 'APPROVED', 'Approved', 'concessionaire', 'Demo Foods Rep KZN', '2026-10-07 10:05:00+02'),
    ('CAS-061026-DMD000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-08 08:30:00+02'),
    ('CAS-061026-DMD000901', 'In Progress', 'Completed', null, 'Collected and returned to warehouse', 'staff', 'Demo Driver', '2026-10-13 14:40:00+02'),
    ('CAS-091026-DMJ000902', null, 'Open', null, null, 'client', 'Demo Foods Manager', '2026-10-09 14:58:00+02'),
    ('CAS-091026-DMJ000902', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-12 08:30:00+02'),
    ('CAS-091026-DMJ000902', 'In Progress', 'Completed', null, 'Repaired on site, cooling tested', 'staff', 'Demo Technician', '2026-10-12 12:40:00+02'),
    ('CAS-061126-DMD000901', null, 'Open', null, null, 'client', 'Demo Foods Manager', '2026-11-06 13:05:00+02'),
    ('CAS-061126-DMD000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-11-06 08:30:00+02'),
    ('CAS-061126-DMD000901', 'In Progress', 'Completed', null, 'Collected and returned to warehouse', 'staff', 'Demo Driver', '2026-11-06 15:20:00+02'),
    ('CAS-261026-DMJ000902', null, 'Open', 'PORTAL_REQUEST', null, 'concessionaire', 'Demo Foods Rep Gauteng (rep)', '2026-10-26 13:20:00+02'),
    ('CAS-261026-DMJ000902', 'Open', 'In Progress', null, 'Booked in at the workshop', 'staff', 'Demo Supervisor', '2026-10-27 08:30:00+02'),
    ('CAS-261026-DMJ000902', 'In Progress', 'Completed', null, 'New branding applied', 'staff', 'Demo Technician', '2026-10-27 11:40:00+02'),
    ('CAS-111126-DMD000902', null, 'Open', null, null, 'staff', 'Demo Supervisor', '2026-11-11 10:58:00+02'),
    ('CAS-111126-DMD000902', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-11-12 08:30:00+02'),
    ('CAS-111126-DMD000902', 'In Progress', 'Completed', null, 'Delivered and switched on; customer signed', 'staff', 'Demo Driver', '2026-11-16 10:40:00+02'),
    ('CAS-301026-DMJ000904', null, 'Open', null, null, 'staff', 'Demo Supervisor', '2026-10-30 08:12:00+02'),
    ('CAS-301026-DMJ000904', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-30 08:30:00+02'),
    ('CAS-301026-DMJ000904', 'In Progress', 'Completed', null, 'Repaired on site, cooling tested', 'staff', 'Demo Technician', '2026-11-05 12:40:00+02'),
    ('CAS-221026-DMJ000902', null, 'Open', null, null, 'client', 'Demo Foods Manager', '2026-10-22 11:12:00+02'),
    ('CAS-221026-DMJ000902', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-23 08:30:00+02'),
    ('CAS-221026-DMJ000902', 'In Progress', 'Completed', null, 'Repaired on site, cooling tested', 'staff', 'Demo Technician', '2026-10-23 16:20:00+02'),
    ('CAS-301026-DMJ000905', null, 'Open', null, null, 'client', 'Demo Foods Manager', '2026-10-30 15:12:00+02'),
    ('CAS-301026-DMJ000905', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-30 08:30:00+02'),
    ('CAS-301026-DMJ000905', 'In Progress', 'Completed', null, 'Repaired on site, cooling tested', 'staff', 'Demo Technician', '2026-10-30 11:20:00+02'),
    ('CAS-291026-DMJ000901', null, 'Open', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Foods Contact 2', '2026-10-29 07:58:00+02'),
    ('CAS-291026-DMJ000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-30 08:30:00+02'),
    ('CAS-291026-DMJ000901', 'In Progress', 'Completed', null, 'Repaired on site, cooling tested', 'staff', 'Demo Technician', '2026-11-03 12:40:00+02'),
    ('CAS-091126-DMJ000903', null, 'Open', 'PORTAL_REQUEST', null, 'concessionaire', 'Demo Foods Rep Gauteng (rep)', '2026-11-09 11:05:00+02'),
    ('CAS-091126-DMJ000903', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-11-10 08:30:00+02'),
    ('CAS-091126-DMJ000903', 'In Progress', 'Completed', null, 'Delivered and switched on; customer signed', 'staff', 'Demo Driver', '2026-11-12 10:40:00+02'),
    ('CAS-291026-DMJ000902', null, 'Open', 'PORTAL_REQUEST', null, 'concessionaire', 'Demo Foods Rep Gauteng (rep)', '2026-10-29 11:47:00+02'),
    ('CAS-291026-DMJ000902', 'Open', 'Cancelled', 'CAN_NOT_NEEDED', 'Outlet asked to cancel', 'staff', 'Demo Supervisor', '2026-10-30 12:00:00+02'),
    ('CAS-231026-DMD000901', null, 'Open', null, null, 'client', 'Demo Foods Manager', '2026-10-23 08:05:00+02'),
    ('CAS-231026-DMD000901', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-10-26 08:30:00+02'),
    ('CAS-231026-DMD000901', 'In Progress', 'Completed', null, 'New unit placed, old unit collected', 'staff', 'Demo Driver', '2026-10-28 15:40:00+02'),
    ('CAS-061126-DMD000902', null, 'Waiting for Approval', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Foods Contact 10', '2026-11-06 13:12:00+02'),
    ('CAS-061126-DMD000902', 'Waiting for Approval', 'Rejected', 'REJ_NOT_APPROVED', 'Outlet already has two units of this type', 'concessionaire', 'Demo Foods Rep KZN', '2026-11-09 09:15:00+02'),
    ('CAS-131126-DMJ000902', null, 'Open', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Foods Contact 8', '2026-11-13 10:12:00+02'),
    ('CAS-181126-DMJ000902', null, 'Open', null, null, 'client', 'Demo Foods Manager', '2026-11-18 12:05:00+02'),
    ('CAS-181126-DMJ000902', 'Open', 'In Progress', null, 'Planned on route', 'staff', 'Demo Supervisor', '2026-11-19 08:30:00+02'),
    ('CAS-241126-DMJ000902', null, 'Open', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Foods Contact 4', '2026-11-24 08:58:00+02'),
    ('CAS-201126-DMJ000903', null, 'Open', null, null, 'staff', 'Demo Supervisor', '2026-11-20 13:47:00+02'),
    ('CAS-201126-DMJ000903', 'Open', 'In Progress', null, 'Booked in at the workshop', 'staff', 'Demo Supervisor', '2026-11-23 08:30:00+02'),
    ('CAS-241126-DMJ000903', null, 'Waiting for Approval', 'PORTAL_REQUEST', null, 'customer', 'Portal: Demo Foods Contact 1', '2026-11-24 14:05:00+02'),
    ('CAS-211126-DMJ000901', null, 'Open', 'PORTAL_REQUEST', null, 'concessionaire', 'Demo Foods Rep Gauteng (rep)', '2026-11-21 15:12:00+02')
  ) v(no, f, t, r, n, act, lab, at)
 where not exists (select 1 from public.coolerco_case_events e where e.case_number = v.no and e.to_status = v.t and e.created_at = v.at::timestamptz);

-- 7. The case trigger queued alerts for these old cases: clear them, so the supervisor
--    alarm only rings for cases you log live during the demo.
delete from public.coolerco_notifications n
 where n.case_number ~ '^CAS-[0-9]{6}-(DMJ|DMD)0009[0-9]{2}$';

-- Check
select client_code, status_reason, count(*) from public.coolerco_cases where tenant_id = 'tenant_demo' group by 1, 2
union all select 'DEMOFOODS outlets', null, count(*) from public.coolerco_outlets where client_code = 'DEMOFOODS'
union all select 'DEMOFOODS assets', null, count(*) from public.coolerco_assets where client_code = 'DEMOFOODS'
union all select 'case events', null, count(*) from public.coolerco_case_events e join public.coolerco_cases c using (case_number) where c.tenant_id = 'tenant_demo'
order by 1, 2;

-- Links for Demo Foods (paste after the UAT site address)
select 'Rep: ' || c.display_name as who, '/c/' || u.link_token as link, 'PIN 1234' as sign_in
  from public.coolerco_concessionaires c join public.coolerco_concessionaire_users u on u.concessionaire_id = c.id where c.client_code = 'DEMOFOODS'
union all
select 'Outlet: ' || l.pos_local_code || ' ' || l.point_of_sale, '/p/' || l.token, 'no sign-in' from public.coolerco_portal_links l where l.client_code = 'DEMOFOODS'
order by 1;
