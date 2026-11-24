-- ============================================================================
-- CoolerCo 047 (TEST only) — Demo sales reps + customer portal links for the demo outlets
-- Needs 041, 044, 045. Safe to run again. Rollback: coolerco_047_rollback_TEST.sql
--
-- What it adds (Wanda 2026-11-24: "add a sales rep so I can demo that"):
--   * 4 demo representatives (kind = representative, client DEMO), one rep user each
--     with PIN 1234, on the existing representative/concessionaire portal (/c/<link>)
--   * each demo outlet linked to its rep (rep code on the outlet) and to its demo
--     warehouse, so a request from that outlet goes to that rep for approval
--   * a customer portal link (/p/<token>) for every demo outlet
--   * warehouse settings for the demo warehouses (case number code, SLA days)
-- The customer portal and rep portal use coolerco_pos_warehouse to find a store's
-- warehouse and rep, so the demo outlets are added there with source = 'demo'.
-- Magnum users do not see these rows: the access rule and coolerco_all_outlets
-- below leave source = 'demo' out of the Magnum lists.
-- ============================================================================

-- 1. Demo warehouses: case number code + default SLA
insert into public.coolerco_warehouse_settings (warehouse_code, case_code, com_name, default_sla_days, notes)
values ('WH-DM-JHB', 'DMJ', 'Demo Gauteng', 2, 'Demo warehouse (047)'),
       ('WH-DM-DBN', 'DMD', 'Demo Durban', 2, 'Demo warehouse (047)')
on conflict (warehouse_code) do nothing;

-- 2. Demo representatives + one rep user each (PIN 1234)

do $$
declare cid uuid;
begin
  select id into cid from public.coolerco_concessionaires where display_name = 'Demo Rep Gauteng North' and client_code = 'DEMO';
  if cid is null then
    insert into public.coolerco_concessionaires (display_name, active, notes, client_code, kind)
    values ('Demo Rep Gauteng North', true, 'Demo representative (047), rep code REP-DM01', 'DEMO', 'representative') returning id into cid;
  end if;
  insert into public.coolerco_concessionaire_names (rop_name, concessionaire_id)
  select 'DEMO REP GAUTENG NORTH', cid where not exists (select 1 from public.coolerco_concessionaire_names where rop_name = 'DEMO REP GAUTENG NORTH');
  if not exists (select 1 from public.coolerco_concessionaire_users where concessionaire_id = cid) then
    insert into public.coolerco_concessionaire_users (concessionaire_id, name, email, phone, pin_hash, active, created_by)
    values (cid, 'Demo Rep Gauteng North', 'rep1@demo.coolerco.test', '000 100 0011', extensions.crypt('1234', extensions.gen_salt('bf')), true, 'demo 047');
  end if;
end $$;

do $$
declare cid uuid;
begin
  select id into cid from public.coolerco_concessionaires where display_name = 'Demo Rep Gauteng South' and client_code = 'DEMO';
  if cid is null then
    insert into public.coolerco_concessionaires (display_name, active, notes, client_code, kind)
    values ('Demo Rep Gauteng South', true, 'Demo representative (047), rep code REP-DM02', 'DEMO', 'representative') returning id into cid;
  end if;
  insert into public.coolerco_concessionaire_names (rop_name, concessionaire_id)
  select 'DEMO REP GAUTENG SOUTH', cid where not exists (select 1 from public.coolerco_concessionaire_names where rop_name = 'DEMO REP GAUTENG SOUTH');
  if not exists (select 1 from public.coolerco_concessionaire_users where concessionaire_id = cid) then
    insert into public.coolerco_concessionaire_users (concessionaire_id, name, email, phone, pin_hash, active, created_by)
    values (cid, 'Demo Rep Gauteng South', 'rep2@demo.coolerco.test', '000 100 0012', extensions.crypt('1234', extensions.gen_salt('bf')), true, 'demo 047');
  end if;
end $$;

do $$
declare cid uuid;
begin
  select id into cid from public.coolerco_concessionaires where display_name = 'Demo Rep KZN North' and client_code = 'DEMO';
  if cid is null then
    insert into public.coolerco_concessionaires (display_name, active, notes, client_code, kind)
    values ('Demo Rep KZN North', true, 'Demo representative (047), rep code REP-DM03', 'DEMO', 'representative') returning id into cid;
  end if;
  insert into public.coolerco_concessionaire_names (rop_name, concessionaire_id)
  select 'DEMO REP KZN NORTH', cid where not exists (select 1 from public.coolerco_concessionaire_names where rop_name = 'DEMO REP KZN NORTH');
  if not exists (select 1 from public.coolerco_concessionaire_users where concessionaire_id = cid) then
    insert into public.coolerco_concessionaire_users (concessionaire_id, name, email, phone, pin_hash, active, created_by)
    values (cid, 'Demo Rep KZN North', 'rep3@demo.coolerco.test', '000 100 0013', extensions.crypt('1234', extensions.gen_salt('bf')), true, 'demo 047');
  end if;
end $$;

do $$
declare cid uuid;
begin
  select id into cid from public.coolerco_concessionaires where display_name = 'Demo Rep KZN South' and client_code = 'DEMO';
  if cid is null then
    insert into public.coolerco_concessionaires (display_name, active, notes, client_code, kind)
    values ('Demo Rep KZN South', true, 'Demo representative (047), rep code REP-DM04', 'DEMO', 'representative') returning id into cid;
  end if;
  insert into public.coolerco_concessionaire_names (rop_name, concessionaire_id)
  select 'DEMO REP KZN SOUTH', cid where not exists (select 1 from public.coolerco_concessionaire_names where rop_name = 'DEMO REP KZN SOUTH');
  if not exists (select 1 from public.coolerco_concessionaire_users where concessionaire_id = cid) then
    insert into public.coolerco_concessionaire_users (concessionaire_id, name, email, phone, pin_hash, active, created_by)
    values (cid, 'Demo Rep KZN South', 'rep4@demo.coolerco.test', '000 100 0014', extensions.crypt('1234', extensions.gen_salt('bf')), true, 'demo 047');
  end if;
end $$;

-- 3. Demo outlets -> warehouse + rep (source = 'demo')
insert into public.coolerco_pos_warehouse (pos_local_code, point_of_sale, concessionaire, warehouse_code, source, needs_review, review_note, updated_at, updated_by) values
  ('DM-OUT-001', 'Sunrise Spaza Soweto (Demo)', 'DEMO REP GAUTENG NORTH', 'WH-DM-JHB', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-002', 'Corner Supermarket Tembisa (Demo)', 'DEMO REP GAUTENG SOUTH', 'WH-DM-JHB', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-003', 'Kasi Fuel Stop Alexandra (Demo)', 'DEMO REP GAUTENG NORTH', 'WH-DM-JHB', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-004', 'Hilltop Tavern Midrand (Demo)', 'DEMO REP GAUTENG SOUTH', 'WH-DM-JHB', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-005', 'Rainbow Spaza Benoni (Demo)', 'DEMO REP GAUTENG NORTH', 'WH-DM-JHB', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-006', 'Family Supermarket Germiston (Demo)', 'DEMO REP GAUTENG SOUTH', 'WH-DM-JHB', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-007', 'Lucky Fuel Stop Randburg (Demo)', 'DEMO REP GAUTENG NORTH', 'WH-DM-JHB', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-008', 'Greenfield Tavern Kempton Park (Demo)', 'DEMO REP GAUTENG SOUTH', 'WH-DM-JHB', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-009', 'Express Spaza Umlazi (Demo)', 'DEMO REP KZN NORTH', 'WH-DM-DBN', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-010', 'Valley Supermarket KwaMashu (Demo)', 'DEMO REP KZN SOUTH', 'WH-DM-DBN', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-011', 'Star Fuel Stop Pinetown (Demo)', 'DEMO REP KZN NORTH', 'WH-DM-DBN', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-012', 'Unity Tavern Chatsworth (Demo)', 'DEMO REP KZN SOUTH', 'WH-DM-DBN', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-013', 'Sunrise Spaza Soweto (Demo)', 'DEMO REP GAUTENG NORTH', 'WH-DM-JHB', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-014', 'Corner Supermarket Tembisa (Demo)', 'DEMO REP GAUTENG SOUTH', 'WH-DM-JHB', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-015', 'Kasi Fuel Stop Alexandra (Demo)', 'DEMO REP GAUTENG NORTH', 'WH-DM-JHB', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-016', 'Hilltop Tavern Midrand (Demo)', 'DEMO REP GAUTENG SOUTH', 'WH-DM-JHB', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-017', 'Rainbow Spaza Benoni (Demo)', 'DEMO REP GAUTENG NORTH', 'WH-DM-JHB', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-018', 'Family Supermarket Germiston (Demo)', 'DEMO REP GAUTENG SOUTH', 'WH-DM-JHB', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-019', 'Lucky Fuel Stop Randburg (Demo)', 'DEMO REP GAUTENG NORTH', 'WH-DM-JHB', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-020', 'Greenfield Tavern Kempton Park (Demo)', 'DEMO REP GAUTENG SOUTH', 'WH-DM-JHB', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-021', 'Express Spaza Umlazi (Demo)', 'DEMO REP KZN NORTH', 'WH-DM-DBN', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-022', 'Valley Supermarket KwaMashu (Demo)', 'DEMO REP KZN SOUTH', 'WH-DM-DBN', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-023', 'Star Fuel Stop Pinetown (Demo)', 'DEMO REP KZN NORTH', 'WH-DM-DBN', 'demo', false, 'Demo outlet (047)', now(), 'demo 047'),
  ('DM-OUT-024', 'Unity Tavern Chatsworth (Demo)', 'DEMO REP KZN SOUTH', 'WH-DM-DBN', 'demo', false, 'Demo outlet (047)', now(), 'demo 047')
on conflict (pos_local_code) do nothing;

-- 4. Customer portal link per demo outlet
insert into public.coolerco_portal_links (token, pos_local_code, point_of_sale, contact_name, contact_number, mobile_number, email, notify_email, notify_whatsapp, trading_hours, delivery_notes, active, otp_required, client_code, created_by)
select replace(replace(replace(encode(extensions.gen_random_bytes(18), 'base64'), '/', '_'), '+', '-'), '=', ''), o.outlet_code, o.name, o.contact_person, o.mobile_number, o.mobile_number, o.email, o.email is not null, false,
       concat_ws(', ', 'Open ' || o.opening_time || '-' || o.closing_time, 'deliveries ' || o.receiving_from || '-' || o.receiving_to, case when o.days_closed is not null then 'closed ' || o.days_closed end),
       null, true, false, 'DEMO', 'demo 047'
  from public.coolerco_outlets o
 where o.client_code = 'DEMO'
   and not exists (select 1 from public.coolerco_portal_links l where l.pos_local_code = o.outlet_code);

-- 5. Keep demo outlets out of the Magnum lists; demo warehouse staff see their own
drop policy if exists coolerco_pos_warehouse_scoped on public.coolerco_pos_warehouse;
create policy coolerco_pos_warehouse_scoped on public.coolerco_pos_warehouse for all to authenticated
  using (public.coolerco_scope_all()
         or (coalesce(source, '') <> 'demo' and public.coolerco_can_see_magnum())
         or warehouse_code = any (public.coolerco_my_warehouses()))
  with check (public.coolerco_scope_all()
         or (coalesce(source, '') <> 'demo' and public.coolerco_can_see_magnum())
         or warehouse_code = any (public.coolerco_my_warehouses()));

create or replace view public.coolerco_all_outlets with (security_invoker = true) as
select 'COM'::text as source, 'MAGNUM'::text as client_code, p.pos_local_code as outlet_code, p.point_of_sale as name, null::text as outlet_type,
       null::text as contact_person, null::text as mobile_number, null::text as town, null::text as province,
       null::double precision as latitude, null::double precision as longitude, p.warehouse_code, true as active
  from public.coolerco_pos_warehouse p
 where public.coolerco_can_see_magnum() and coalesce(p.source, '') <> 'demo'
union all
select 'CoolerCo', o.client_code, o.outlet_code, o.name, o.outlet_type, o.contact_person, o.mobile_number, o.town, o.province, o.latitude, o.longitude, o.warehouse_code, o.active
  from public.coolerco_outlets o;
revoke all on public.coolerco_all_outlets from anon, authenticated;
grant select on public.coolerco_all_outlets to authenticated;

-- ============================================================================
-- Links for the demo (copy into the browser after the UAT site address)
-- ============================================================================
select 'Rep: ' || c.display_name as who, '/c/' || u.link_token as link, 'PIN 1234' as sign_in,
       (select count(*) from public.coolerco_pos_warehouse w join public.coolerco_concessionaire_names n on n.rop_name = w.concessionaire
         where n.concessionaire_id = c.id) as stores
  from public.coolerco_concessionaires c join public.coolerco_concessionaire_users u on u.concessionaire_id = c.id
 where c.client_code = 'DEMO'
union all
select 'Outlet: ' || l.pos_local_code || ' ' || l.point_of_sale, '/p/' || l.token, 'no sign-in', null
  from public.coolerco_portal_links l where l.client_code = 'DEMO'
 order by 1;
