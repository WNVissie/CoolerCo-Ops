-- ============================================================================
-- CoolerCo 045 (TEST only) — load the Demo client's data into the 041 registers
-- Source: CoolerCo-Ops_demo_data.xlsx (all fictional). Safe to run again: rows that
-- already exist are left as they are. Rollback: coolerco_045_rollback_TEST.sql
-- Needs 041 (DEMO client, demo warehouses, registers).
-- ============================================================================
do $$ begin
  if not exists (select 1 from public.coolerco_clients where code = 'DEMO') then
    raise exception 'Run 041 first: the DEMO client does not exist';
  end if;
end $$;

-- Outlets (24)
insert into public.coolerco_outlets (client_code, outlet_code, name, outlet_type, contact_person, mobile_number, email, street_address, suburb, town, province, postal_code, latitude, longitude, region, warehouse_code, rep_code, route_day, opening_time, closing_time, receiving_from, receiving_to, days_closed, active, notes) values
  ('DEMO', 'DM-OUT-001', 'Sunrise Spaza Soweto (Demo)', 'Spaza or general dealer', 'Demo Contact 1', '000 000 0001', 'outlet001@demo.coolerco.test', '10 Demo Street', 'Soweto', 'Johannesburg', 'Gauteng', null, -26.2520, 27.8470, 'Demo North', 'WH-DM-JHB', 'REP-DM01', 'Monday', '07:00', '19:00', '08:00', '15:00', 'Sunday', true, null),
  ('DEMO', 'DM-OUT-002', 'Corner Supermarket Tembisa (Demo)', 'Supermarket', 'Demo Contact 2', '000 000 0002', null, '11 Demo Street', 'Tembisa', 'Tembisa', 'Gauteng', null, -25.9934, 28.2182, 'Demo South', 'WH-DM-JHB', 'REP-DM02', 'Tuesday', '07:00', '21:00', '09:00', '15:00', null, true, null),
  ('DEMO', 'DM-OUT-003', 'Kasi Fuel Stop Alexandra (Demo)', 'Forecourt', 'Demo Contact 3', '000 000 0003', null, '12 Demo Street', 'Alexandra', 'Johannesburg', 'Gauteng', null, -26.1023, 28.0933, 'Demo North', 'WH-DM-JHB', 'REP-DM01', 'Wednesday', '06:00', '22:00', '08:00', '16:00', null, true, null),
  ('DEMO', 'DM-OUT-004', 'Hilltop Tavern Midrand (Demo)', 'Tavern or liquor', 'Demo Contact 4', '000 000 0004', 'outlet004@demo.coolerco.test', '13 Demo Street', 'Midrand', 'Midrand', 'Gauteng', null, -25.9978, 28.1281, 'Demo South', 'WH-DM-JHB', 'REP-DM02', 'Thursday', '10:00', '23:00', '10:00', '14:00', null, true, null),
  ('DEMO', 'DM-OUT-005', 'Rainbow Spaza Benoni (Demo)', 'Spaza or general dealer', 'Demo Contact 5', '000 000 0005', null, '14 Demo Street', 'Benoni', 'Benoni', 'Gauteng', null, -26.1973, 28.3197, 'Demo North', 'WH-DM-JHB', 'REP-DM01', 'Friday', '07:00', '19:00', '08:00', '15:00', 'Sunday', true, null),
  ('DEMO', 'DM-OUT-006', 'Family Supermarket Germiston (Demo)', 'Supermarket', 'Demo Contact 6', '000 000 0006', null, '15 Demo Street', 'Germiston', 'Germiston', 'Gauteng', null, -26.2266, 28.1618, 'Demo South', 'WH-DM-JHB', 'REP-DM02', 'Monday', '07:00', '21:00', '09:00', '15:00', null, true, null),
  ('DEMO', 'DM-OUT-007', 'Lucky Fuel Stop Randburg (Demo)', 'Forecourt', 'Demo Contact 7', '000 000 0007', 'outlet007@demo.coolerco.test', '16 Demo Street', 'Randburg', 'Randburg', 'Gauteng', null, -26.0955, 28.0075, 'Demo North', 'WH-DM-JHB', 'REP-DM01', 'Tuesday', '06:00', '22:00', '08:00', '16:00', null, true, null),
  ('DEMO', 'DM-OUT-008', 'Greenfield Tavern Kempton Park (Demo)', 'Tavern or liquor', 'Demo Contact 8', '000 000 0008', null, '17 Demo Street', 'Kempton Park', 'Kempton Park', 'Gauteng', null, -26.1075, 28.2275, 'Demo South', 'WH-DM-JHB', 'REP-DM02', 'Wednesday', '10:00', '23:00', '10:00', '14:00', null, true, null),
  ('DEMO', 'DM-OUT-009', 'Express Spaza Umlazi (Demo)', 'Spaza or general dealer', 'Demo Contact 9', '000 000 0009', null, '18 Demo Street', 'Umlazi', 'Durban', 'KwaZulu-Natal', null, -29.9675, 30.8890, 'Demo North', 'WH-DM-DBN', 'REP-DM03', 'Thursday', '07:00', '19:00', '08:00', '15:00', 'Sunday', true, null),
  ('DEMO', 'DM-OUT-010', 'Valley Supermarket KwaMashu (Demo)', 'Supermarket', 'Demo Contact 10', '000 000 0010', 'outlet010@demo.coolerco.test', '19 Demo Street', 'KwaMashu', 'Durban', 'KwaZulu-Natal', null, -29.7435, 30.9769, 'Demo South', 'WH-DM-DBN', 'REP-DM04', 'Friday', '07:00', '21:00', '09:00', '15:00', null, true, null),
  ('DEMO', 'DM-OUT-011', 'Star Fuel Stop Pinetown (Demo)', 'Forecourt', 'Demo Contact 11', '000 000 0011', null, '20 Demo Street', 'Pinetown', 'Pinetown', 'KwaZulu-Natal', null, -29.8075, 30.8479, 'Demo North', 'WH-DM-DBN', 'REP-DM03', 'Monday', '06:00', '22:00', '08:00', '16:00', null, true, null),
  ('DEMO', 'DM-OUT-012', 'Unity Tavern Chatsworth (Demo)', 'Tavern or liquor', 'Demo Contact 12', '000 000 0012', null, '21 Demo Street', 'Chatsworth', 'Durban', 'KwaZulu-Natal', null, -29.9028, 30.8758, 'Demo South', 'WH-DM-DBN', 'REP-DM04', 'Tuesday', '10:00', '23:00', '10:00', '14:00', null, true, null),
  ('DEMO', 'DM-OUT-013', 'Sunrise Spaza Soweto (Demo)', 'Spaza or general dealer', 'Demo Contact 13', '000 000 0013', 'outlet013@demo.coolerco.test', '22 Demo Street', 'Soweto', 'Johannesburg', 'Gauteng', null, -26.2556, 27.8464, 'Demo North', 'WH-DM-JHB', 'REP-DM01', 'Wednesday', '07:00', '19:00', '08:00', '15:00', 'Sunday', true, null),
  ('DEMO', 'DM-OUT-014', 'Corner Supermarket Tembisa (Demo)', 'Supermarket', 'Demo Contact 14', '000 000 0014', null, '23 Demo Street', 'Tembisa', 'Tembisa', 'Gauteng', null, -26.0002, 28.2331, 'Demo South', 'WH-DM-JHB', 'REP-DM02', 'Thursday', '07:00', '21:00', '09:00', '15:00', null, true, null),
  ('DEMO', 'DM-OUT-015', 'Kasi Fuel Stop Alexandra (Demo)', 'Forecourt', 'Demo Contact 15', '000 000 0015', null, '24 Demo Street', 'Alexandra', 'Johannesburg', 'Gauteng', null, -26.1094, 28.0976, 'Demo North', 'WH-DM-JHB', 'REP-DM01', 'Friday', '06:00', '22:00', '08:00', '16:00', null, true, null),
  ('DEMO', 'DM-OUT-016', 'Hilltop Tavern Midrand (Demo)', 'Tavern or liquor', 'Demo Contact 16', '000 000 0016', 'outlet016@demo.coolerco.test', '25 Demo Street', 'Midrand', 'Midrand', 'Gauteng', null, -25.9862, 28.1254, 'Demo South', 'WH-DM-JHB', 'REP-DM02', 'Monday', '10:00', '23:00', '10:00', '14:00', null, true, null),
  ('DEMO', 'DM-OUT-017', 'Rainbow Spaza Benoni (Demo)', 'Spaza or general dealer', 'Demo Contact 17', '000 000 0017', null, '26 Demo Street', 'Benoni', 'Benoni', 'Gauteng', null, -26.1870, 28.3123, 'Demo North', 'WH-DM-JHB', 'REP-DM01', 'Tuesday', '07:00', '19:00', '08:00', '15:00', 'Sunday', true, null),
  ('DEMO', 'DM-OUT-018', 'Family Supermarket Germiston (Demo)', 'Supermarket', 'Demo Contact 18', '000 000 0018', null, '27 Demo Street', 'Germiston', 'Germiston', 'Gauteng', null, -26.2268, 28.1641, 'Demo South', 'WH-DM-JHB', 'REP-DM02', 'Wednesday', '07:00', '21:00', '09:00', '15:00', null, true, null),
  ('DEMO', 'DM-OUT-019', 'Lucky Fuel Stop Randburg (Demo)', 'Forecourt', 'Demo Contact 19', '000 000 0019', 'outlet019@demo.coolerco.test', '28 Demo Street', 'Randburg', 'Randburg', 'Gauteng', null, -26.0904, 27.9996, 'Demo North', 'WH-DM-JHB', 'REP-DM01', 'Thursday', '06:00', '22:00', '08:00', '16:00', null, true, null),
  ('DEMO', 'DM-OUT-020', 'Greenfield Tavern Kempton Park (Demo)', 'Tavern or liquor', 'Demo Contact 20', '000 000 0020', null, '29 Demo Street', 'Kempton Park', 'Kempton Park', 'Gauteng', null, -26.1037, 28.2347, 'Demo South', 'WH-DM-JHB', 'REP-DM02', 'Friday', '10:00', '23:00', '10:00', '14:00', null, true, null),
  ('DEMO', 'DM-OUT-021', 'Express Spaza Umlazi (Demo)', 'Spaza or general dealer', 'Demo Contact 21', '000 000 0021', null, '30 Demo Street', 'Umlazi', 'Durban', 'KwaZulu-Natal', null, -29.9709, 30.8760, 'Demo North', 'WH-DM-DBN', 'REP-DM03', 'Monday', '07:00', '19:00', '08:00', '15:00', 'Sunday', true, null),
  ('DEMO', 'DM-OUT-022', 'Valley Supermarket KwaMashu (Demo)', 'Supermarket', 'Demo Contact 22', '000 000 0022', 'outlet022@demo.coolerco.test', '31 Demo Street', 'KwaMashu', 'Durban', 'KwaZulu-Natal', null, -29.7391, 30.9830, 'Demo South', 'WH-DM-DBN', 'REP-DM04', 'Tuesday', '07:00', '21:00', '09:00', '15:00', null, true, null),
  ('DEMO', 'DM-OUT-023', 'Star Fuel Stop Pinetown (Demo)', 'Forecourt', 'Demo Contact 23', '000 000 0023', null, '32 Demo Street', 'Pinetown', 'Pinetown', 'KwaZulu-Natal', null, -29.8221, 30.8585, 'Demo North', 'WH-DM-DBN', 'REP-DM03', 'Wednesday', '06:00', '22:00', '08:00', '16:00', null, true, null),
  ('DEMO', 'DM-OUT-024', 'Unity Tavern Chatsworth (Demo)', 'Tavern or liquor', 'Demo Contact 24', '000 000 0024', null, '33 Demo Street', 'Chatsworth', 'Durban', 'KwaZulu-Natal', null, -29.9095, 30.8875, 'Demo South', 'WH-DM-DBN', 'REP-DM04', 'Thursday', '10:00', '23:00', '10:00', '14:00', null, true, null)
on conflict (client_code, outlet_code) do nothing;

-- Asset models (6)
insert into public.coolerco_asset_models (client_code, model_code, description, asset_type, manufacturer, capacity_litres, doors, product_family, notes) values
  ('DEMO', 'DM-UF400', 'Demo upright freezer 400 L, glass door', 'Upright freezer', 'Demo Cooling Co', 400, 1, 'Upright freezer single', null),
  ('DEMO', 'DM-UF700', 'Demo upright freezer 700 L, double glass door', 'Upright freezer', 'Demo Cooling Co', 700, 2, 'Upright freezer double', null),
  ('DEMO', 'DM-CF300', 'Demo chest freezer 300 L, sliding glass lid', 'Chest freezer', 'Demo Cooling Co', 300, 1, 'Chest freezer small', null),
  ('DEMO', 'DM-CF500', 'Demo chest freezer 500 L, sliding glass lid', 'Chest freezer', 'Demo Cooling Co', 500, 1, 'Chest freezer large', null),
  ('DEMO', 'DM-UC350', 'Demo upright cooler 350 L, glass door', 'Upright cooler', 'Demo Cooling Co', 350, 1, 'Upright cooler', null),
  ('DEMO', 'DM-CT90', 'Demo countertop cooler 90 L', 'Countertop cooler', 'Demo Cooling Co', 90, 1, 'Countertop cooler', null)
on conflict (client_code, model_code) do nothing;

-- Assets (70); the warehouse in charge is filled in by the register's trigger
insert into public.coolerco_assets (client_code, asset_number, serial_number, model_code, branding, condition, status, location_type, location_code, placement_date, purchase_date, warranty_end, last_service, has_label, notes) values
  ('DEMO', 'DM000001', 'DEMO-SN-223800', 'DM-CT90', 'Demo Snacks', 'Fair', 'At outlet', 'Outlet', 'DM-OUT-001', '2025-05-20', '2019-07-15', '2022-03-15', null, true, null),
  ('DEMO', 'DM000002', 'DEMO-SN-181390', 'DM-UF700', 'Demo Snacks', 'Fair', 'At outlet', 'Outlet', 'DM-OUT-001', '2025-07-02', '2024-10-15', '2027-06-15', '2026-06-20', true, null),
  ('DEMO', 'DM000003', 'DEMO-SN-383051', 'DM-CF500', 'Demo Dairy', 'New', 'At outlet', 'Outlet', 'DM-OUT-002', '2025-08-03', '2019-12-15', '2022-11-15', '2026-05-21', true, null),
  ('DEMO', 'DM000004', 'DEMO-SN-504531', 'DM-UC350', 'Demo Snacks', 'Poor', 'At outlet', 'Outlet', 'DM-OUT-002', '2025-08-10', '2024-06-15', '2027-01-15', null, true, null),
  ('DEMO', 'DM000005', 'DEMO-SN-161818', 'DM-CF300', 'Demo Ice', 'Good', 'At outlet', 'Outlet', 'DM-OUT-003', '2025-10-04', '2022-05-15', '2025-03-15', null, true, null),
  ('DEMO', 'DM000006', 'DEMO-SN-571007', 'DM-CF500', 'Demo Dairy', 'Fair', 'At outlet', 'Outlet', 'DM-OUT-003', '2025-08-03', '2020-09-15', '2023-05-15', null, true, null),
  ('DEMO', 'DM000007', 'DEMO-SN-476198', 'DM-CF500', 'Demo Snacks', 'Fair', 'At outlet', 'Outlet', 'DM-OUT-004', '2025-05-23', '2022-07-15', '2025-04-15', '2026-03-05', true, null),
  ('DEMO', 'DM000008', 'DEMO-SN-971464', 'DM-UF700', 'Demo Snacks', 'Poor', 'At outlet', 'Outlet', 'DM-OUT-004', '2025-04-01', '2022-03-15', '2025-05-15', '2026-03-14', true, null),
  ('DEMO', 'DM000009', 'DEMO-SN-231587', 'DM-UC350', 'Demo Snacks', 'Good', 'At outlet', 'Outlet', 'DM-OUT-005', '2025-10-19', '2021-09-15', '2024-10-15', null, false, null),
  ('DEMO', 'DM000010', 'DEMO-SN-936630', 'DM-CT90', 'Demo Snacks', 'Good', 'At outlet', 'Outlet', 'DM-OUT-005', '2025-08-28', '2024-07-15', '2027-07-15', '2026-02-16', true, null),
  ('DEMO', 'DM000011', 'DEMO-SN-318904', 'DM-CT90', 'Demo Dairy', 'Fair', 'At outlet', 'Outlet', 'DM-OUT-006', '2025-01-07', '2019-03-15', '2022-02-15', '2026-01-04', true, null),
  ('DEMO', 'DM000012', 'DEMO-SN-481272', 'DM-UF400', 'Demo Snacks', 'New', 'At outlet', 'Outlet', 'DM-OUT-006', '2025-03-18', '2019-01-15', '2022-02-15', null, true, null),
  ('DEMO', 'DM000013', 'DEMO-SN-464264', 'DM-UC350', 'Demo Snacks', 'Fair', 'At outlet', 'Outlet', 'DM-OUT-007', '2025-03-21', '2021-06-15', '2024-08-15', '2026-08-15', true, null),
  ('DEMO', 'DM000014', 'DEMO-SN-207151', 'DM-CF500', 'Demo Snacks', 'Fair', 'At outlet', 'Outlet', 'DM-OUT-007', '2025-05-03', '2020-06-15', '2023-12-15', '2026-03-17', true, null),
  ('DEMO', 'DM000015', 'DEMO-SN-823588', 'DM-UF400', 'Demo Snacks', 'Good', 'At outlet', 'Outlet', 'DM-OUT-008', '2025-09-12', '2020-01-15', '2023-09-15', '2026-02-23', true, null),
  ('DEMO', 'DM000016', 'DEMO-SN-909435', 'DM-CF300', 'Demo Ice', 'Fair', 'At outlet', 'Outlet', 'DM-OUT-008', '2025-06-06', '2021-09-15', '2024-09-15', null, true, null),
  ('DEMO', 'DM000017', 'DEMO-SN-945234', 'DM-CF300', 'Demo Ice', 'Poor', 'At outlet', 'Outlet', 'DM-OUT-009', '2025-04-20', '2020-07-15', '2023-12-15', null, true, null),
  ('DEMO', 'DM000018', 'DEMO-SN-130387', 'DM-UF700', 'Demo Ice', 'Fair', 'At outlet', 'Outlet', 'DM-OUT-009', '2025-08-12', '2024-05-15', '2027-08-15', '2026-10-12', false, null),
  ('DEMO', 'DM000019', 'DEMO-SN-207119', 'DM-CF500', 'Demo Ice', 'Good', 'At outlet', 'Outlet', 'DM-OUT-010', '2025-06-03', '2020-08-15', '2023-04-15', '2026-08-20', true, null),
  ('DEMO', 'DM000020', 'DEMO-SN-938487', 'DM-UC350', 'Demo Snacks', 'Good', 'At outlet', 'Outlet', 'DM-OUT-010', '2025-08-21', '2021-02-15', '2024-11-15', '2026-07-26', true, null),
  ('DEMO', 'DM000021', 'DEMO-SN-927468', 'DM-CT90', 'Demo Snacks', 'Good', 'At outlet', 'Outlet', 'DM-OUT-011', '2025-08-06', '2022-06-15', '2025-02-15', null, true, null),
  ('DEMO', 'DM000022', 'DEMO-SN-189044', 'DM-CT90', 'Demo Snacks', 'Fair', 'At outlet', 'Outlet', 'DM-OUT-011', '2025-08-13', '2024-03-15', '2027-03-15', null, true, null),
  ('DEMO', 'DM000023', 'DEMO-SN-253274', 'DM-UF400', 'Demo Snacks', 'Good', 'At outlet', 'Outlet', 'DM-OUT-012', '2025-10-15', '2024-10-15', '2027-08-15', null, true, null),
  ('DEMO', 'DM000024', 'DEMO-SN-122436', 'DM-CF300', 'Demo Ice', 'Good', 'At outlet', 'Outlet', 'DM-OUT-012', '2025-09-18', '2020-12-15', '2023-11-15', '2026-03-14', true, null),
  ('DEMO', 'DM000025', 'DEMO-SN-407197', 'DM-UF700', 'Demo Snacks', 'Good', 'At outlet', 'Outlet', 'DM-OUT-013', '2025-01-09', '2020-04-15', '2023-10-15', '2026-09-14', true, null),
  ('DEMO', 'DM000026', 'DEMO-SN-794655', 'DM-UF700', 'Demo Snacks', 'Good', 'At outlet', 'Outlet', 'DM-OUT-013', '2025-12-12', '2022-09-15', '2025-07-15', null, true, null),
  ('DEMO', 'DM000027', 'DEMO-SN-635347', 'DM-UC350', 'Demo Ice', 'Good', 'At outlet', 'Outlet', 'DM-OUT-014', '2025-09-05', '2023-08-15', '2026-03-15', null, false, null),
  ('DEMO', 'DM000028', 'DEMO-SN-860420', 'DM-UF700', 'Demo Ice', 'Good', 'At outlet', 'Outlet', 'DM-OUT-014', '2025-03-16', '2023-09-15', '2026-01-15', '2026-09-17', true, null),
  ('DEMO', 'DM000029', 'DEMO-SN-360565', 'DM-UC350', 'Demo Ice', 'Fair', 'At outlet', 'Outlet', 'DM-OUT-015', '2025-02-18', '2019-05-15', '2022-01-15', null, true, null),
  ('DEMO', 'DM000030', 'DEMO-SN-564779', 'DM-UC350', 'Demo Dairy', 'Fair', 'At outlet', 'Outlet', 'DM-OUT-015', '2025-09-01', '2019-10-15', '2022-09-15', null, true, null),
  ('DEMO', 'DM000031', 'DEMO-SN-946580', 'DM-UF700', 'Demo Dairy', 'Good', 'At outlet', 'Outlet', 'DM-OUT-016', '2025-08-17', '2023-09-15', '2026-04-15', null, true, null),
  ('DEMO', 'DM000032', 'DEMO-SN-243795', 'DM-CF300', 'Demo Dairy', 'Fair', 'At outlet', 'Outlet', 'DM-OUT-016', '2025-04-27', '2022-02-15', '2025-07-15', '2026-02-22', true, null),
  ('DEMO', 'DM000033', 'DEMO-SN-417487', 'DM-UF700', 'Demo Ice', 'Fair', 'At outlet', 'Outlet', 'DM-OUT-017', '2025-02-07', '2024-03-15', '2027-12-15', null, true, null),
  ('DEMO', 'DM000034', 'DEMO-SN-330254', 'DM-CF300', 'Demo Snacks', 'Good', 'At outlet', 'Outlet', 'DM-OUT-017', '2025-05-05', '2022-02-15', '2025-07-15', null, true, null),
  ('DEMO', 'DM000035', 'DEMO-SN-552483', 'DM-UF700', 'Demo Snacks', 'Poor', 'At outlet', 'Outlet', 'DM-OUT-018', '2025-04-06', '2024-07-15', '2027-06-15', '2026-06-11', true, null),
  ('DEMO', 'DM000036', 'DEMO-SN-580951', 'DM-UF400', 'Demo Dairy', 'Good', 'At outlet', 'Outlet', 'DM-OUT-018', '2025-01-11', '2023-12-15', '2026-01-15', '2026-09-20', false, null),
  ('DEMO', 'DM000037', 'DEMO-SN-209869', 'DM-CF300', 'Demo Ice', 'Fair', 'At outlet', 'Outlet', 'DM-OUT-019', '2025-02-04', '2020-05-15', '2023-05-15', '2026-03-09', true, null),
  ('DEMO', 'DM000038', 'DEMO-SN-525667', 'DM-UF700', 'Demo Ice', 'Fair', 'At outlet', 'Outlet', 'DM-OUT-019', '2025-11-27', '2021-09-15', '2024-09-15', '2026-06-03', true, null),
  ('DEMO', 'DM000039', 'DEMO-SN-175931', 'DM-CF300', 'Demo Dairy', 'Good', 'At outlet', 'Outlet', 'DM-OUT-020', '2025-12-06', '2022-01-15', '2025-11-15', '2026-05-03', true, null),
  ('DEMO', 'DM000040', 'DEMO-SN-575816', 'DM-UC350', 'Demo Ice', 'Good', 'At outlet', 'Outlet', 'DM-OUT-020', '2025-02-09', '2019-06-15', '2022-09-15', '2026-05-20', true, null),
  ('DEMO', 'DM000041', 'DEMO-SN-214768', 'DM-UF700', 'Demo Ice', 'Good', 'At outlet', 'Outlet', 'DM-OUT-021', '2025-09-23', '2020-05-15', '2023-01-15', '2026-05-21', true, null),
  ('DEMO', 'DM000042', 'DEMO-SN-624380', 'DM-CF300', 'Demo Snacks', 'Fair', 'At outlet', 'Outlet', 'DM-OUT-021', '2025-04-10', '2022-03-15', '2025-05-15', '2026-01-09', true, null),
  ('DEMO', 'DM000043', 'DEMO-SN-677816', 'DM-UF400', 'Demo Ice', 'Good', 'At outlet', 'Outlet', 'DM-OUT-022', '2025-01-24', '2023-09-15', '2026-08-15', '2026-08-04', true, null),
  ('DEMO', 'DM000044', 'DEMO-SN-672424', 'DM-CT90', 'Demo Dairy', 'Poor', 'At outlet', 'Outlet', 'DM-OUT-022', '2025-07-22', '2022-09-15', '2025-05-15', null, true, null),
  ('DEMO', 'DM000045', 'DEMO-SN-864248', 'DM-UF700', 'Demo Snacks', 'Good', 'At outlet', 'Outlet', 'DM-OUT-023', '2025-04-27', '2024-03-15', '2027-07-15', null, false, null),
  ('DEMO', 'DM000046', 'DEMO-SN-876878', 'DM-UF400', 'Demo Dairy', 'Good', 'At outlet', 'Outlet', 'DM-OUT-023', '2025-01-03', '2024-07-15', '2027-03-15', '2026-07-28', true, null),
  ('DEMO', 'DM000047', 'DEMO-SN-826333', 'DM-UC350', 'Demo Dairy', 'Poor', 'At outlet', 'Outlet', 'DM-OUT-024', '2025-05-20', '2020-01-15', '2023-08-15', '2026-05-15', true, null),
  ('DEMO', 'DM000048', 'DEMO-SN-439249', 'DM-UF400', 'Demo Ice', 'Good', 'At outlet', 'Outlet', 'DM-OUT-024', '2025-06-11', '2023-01-15', '2026-05-15', '2026-03-01', true, null),
  ('DEMO', 'DM000049', 'DEMO-SN-187965', 'DM-CF300', 'Demo Dairy', 'Good', 'In warehouse, ready to work', 'Warehouse', 'WH-DM-JHB', null, '2022-05-15', '2025-09-15', null, true, null),
  ('DEMO', 'DM000050', 'DEMO-SN-913944', 'DM-UF700', 'Demo Ice', 'Good', 'In warehouse, ready to work', 'Warehouse', 'WH-DM-JHB', null, '2023-02-15', '2026-05-15', null, true, null),
  ('DEMO', 'DM000051', 'DEMO-SN-715305', 'DM-UF700', 'Demo Ice', 'Good', 'In warehouse, ready to work', 'Warehouse', 'WH-DM-JHB', null, '2022-07-15', '2025-01-15', '2026-04-03', true, null),
  ('DEMO', 'DM000052', 'DEMO-SN-994694', 'DM-UC350', 'Demo Ice', 'Good', 'In warehouse, ready to work', 'Warehouse', 'WH-DM-JHB', null, '2023-11-15', '2026-12-15', null, true, null),
  ('DEMO', 'DM000053', 'DEMO-SN-901438', 'DM-UC350', 'Demo Dairy', 'Good', 'In warehouse, ready to work', 'Warehouse', 'WH-DM-JHB', null, '2022-12-15', '2025-08-15', '2026-10-21', true, null),
  ('DEMO', 'DM000054', 'DEMO-SN-964925', 'DM-UF700', 'Demo Snacks', 'Good', 'In warehouse, ready to work', 'Warehouse', 'WH-DM-JHB', null, '2019-09-15', '2022-11-15', '2026-09-05', false, null),
  ('DEMO', 'DM000055', 'DEMO-SN-696093', 'DM-UC350', 'Demo Ice', 'Good', 'In warehouse, ready to work', 'Warehouse', 'WH-DM-JHB', null, '2023-11-15', '2026-10-15', null, true, null),
  ('DEMO', 'DM000056', 'DEMO-SN-774118', 'DM-CT90', 'Demo Ice', 'Fair', 'In warehouse, awaiting repair', 'Warehouse', 'WH-DM-JHB', null, '2024-02-15', '2027-01-15', '2026-06-04', true, null),
  ('DEMO', 'DM000057', 'DEMO-SN-153247', 'DM-CF500', 'Demo Snacks', 'Not working', 'In warehouse, awaiting repair', 'Warehouse', 'WH-DM-JHB', null, '2023-01-15', '2026-11-15', '2026-04-16', true, null),
  ('DEMO', 'DM000058', 'DEMO-SN-936446', 'DM-CF300', 'Demo Ice', 'Poor', 'In warehouse, awaiting repair', 'Warehouse', 'WH-DM-JHB', null, '2022-12-15', '2025-09-15', null, true, null),
  ('DEMO', 'DM000059', 'DEMO-SN-169258', 'DM-UF400', 'Demo Snacks', 'Fair', 'In repair', 'Warehouse', 'WH-DM-JHB', null, '2023-12-15', '2026-08-15', '2026-02-28', true, null),
  ('DEMO', 'DM000060', 'DEMO-SN-893186', 'DM-CF300', 'Demo Ice', 'Poor', 'In repair', 'Warehouse', 'WH-DM-JHB', null, '2024-04-15', '2027-12-15', null, true, null),
  ('DEMO', 'DM000061', 'DEMO-SN-180467', 'DM-CF500', 'Demo Dairy', 'Not working', 'In repair', 'Warehouse', 'WH-DM-JHB', null, '2022-11-15', '2025-05-15', null, true, null),
  ('DEMO', 'DM000062', 'DEMO-SN-307922', 'DM-UC350', 'Demo Ice', 'Fair', 'In repair', 'Warehouse', 'WH-DM-JHB', null, '2024-10-15', '2027-03-15', '2026-05-20', true, null),
  ('DEMO', 'DM000063', 'DEMO-SN-113074', 'DM-UC350', 'Demo Dairy', 'Good', 'In warehouse, ready to work', 'Warehouse', 'WH-DM-DBN', null, '2020-01-15', '2023-08-15', '2026-02-23', false, null),
  ('DEMO', 'DM000064', 'DEMO-SN-613397', 'DM-UF700', 'Demo Dairy', 'Good', 'In warehouse, ready to work', 'Warehouse', 'WH-DM-DBN', null, '2024-12-15', '2027-09-15', '2026-08-15', true, null),
  ('DEMO', 'DM000065', 'DEMO-SN-308928', 'DM-UF400', 'Demo Dairy', 'Good', 'In warehouse, ready to work', 'Warehouse', 'WH-DM-DBN', null, '2023-02-15', '2026-08-15', '2026-08-03', true, null),
  ('DEMO', 'DM000066', 'DEMO-SN-381707', 'DM-UC350', 'Demo Dairy', 'Good', 'In warehouse, ready to work', 'Warehouse', 'WH-DM-DBN', null, '2022-04-15', '2025-04-15', '2026-02-05', true, null),
  ('DEMO', 'DM000067', 'DEMO-SN-477019', 'DM-CT90', 'Demo Ice', 'Fair', 'In warehouse, awaiting repair', 'Warehouse', 'WH-DM-DBN', null, '2021-10-15', '2024-11-15', '2026-02-23', true, null),
  ('DEMO', 'DM000068', 'DEMO-SN-609755', 'DM-CF300', 'Demo Dairy', 'Poor', 'In warehouse, awaiting repair', 'Warehouse', 'WH-DM-DBN', null, '2022-01-15', '2025-03-15', '2026-08-22', true, null),
  ('DEMO', 'DM000069', 'DEMO-SN-862506', 'DM-CF500', 'Demo Ice', 'Not working', 'In repair', 'Warehouse', 'WH-DM-DBN', null, '2021-07-15', '2024-06-15', '2026-02-27', true, null),
  ('DEMO', 'DM000070', 'DEMO-SN-887201', 'DM-CF300', 'Demo Dairy', 'Poor', 'In repair', 'Warehouse', 'WH-DM-DBN', null, '2021-07-15', '2024-02-15', null, true, null)
on conflict (client_code, asset_number) do nothing;

-- Fault, repair and spare-part codes (19)
insert into public.coolerco_fault_codes (client_code, code, description, code_type, asset_type, active) values
  ('DEMO', 'DM-F01', 'Not cooling', 'Fault', null, true),
  ('DEMO', 'DM-F02', 'Light not working', 'Fault', null, true),
  ('DEMO', 'DM-F03', 'Door seal damaged', 'Fault', null, true),
  ('DEMO', 'DM-F04', 'Noisy compressor', 'Fault', null, true),
  ('DEMO', 'DM-F05', 'Ice build-up', 'Fault', null, true),
  ('DEMO', 'DM-F06', 'Thermostat fault', 'Fault', null, true),
  ('DEMO', 'DM-F07', 'Power cord damaged', 'Fault', null, true),
  ('DEMO', 'DM-F08', 'Glass door or lid broken', 'Fault', null, true),
  ('DEMO', 'DM-R01', 'Replaced door seal', 'Repair', null, true),
  ('DEMO', 'DM-R02', 'Replaced thermostat', 'Repair', null, true),
  ('DEMO', 'DM-R03', 'Replaced light', 'Repair', null, true),
  ('DEMO', 'DM-R04', 'Re-gassed', 'Repair', null, true),
  ('DEMO', 'DM-R05', 'Defrosted and cleaned', 'Repair', null, true),
  ('DEMO', 'DM-R06', 'Replaced compressor', 'Repair', null, true),
  ('DEMO', 'DM-S01', 'Door seal', 'Spare part', null, true),
  ('DEMO', 'DM-S02', 'Thermostat', 'Spare part', null, true),
  ('DEMO', 'DM-S03', 'LED light strip', 'Spare part', null, true),
  ('DEMO', 'DM-S04', 'Compressor', 'Spare part', null, true),
  ('DEMO', 'DM-S05', 'Power cord', 'Spare part', null, true)
on conflict (client_code, code) do nothing;

-- Service levels for the Demo client (working days to resolve; case calendar uses these)
insert into public.coolerco_sla_rules (client_code, case_type, warehouse_workshop, working_days, clock_starts, note)
select * from (values
  ('DEMO', 'Repair at outlet', null::text, 1, 'logged', 'Demo target'),
  ('DEMO', 'Repair at workshop', null::text, 3, 'logged', 'Demo target'),
  ('DEMO', 'New placement (delivery)', null::text, 3, 'approved', 'Demo target'),
  ('DEMO', 'Collection (removal)', null::text, 5, 'approved', 'Demo target'),
  ('DEMO', 'Replacement', null::text, 3, 'approved', 'Demo target'),
  ('DEMO', 'Branding or decal', null::text, 5, 'approved', 'Demo target')
) x(client_code, case_type, warehouse_workshop, working_days, clock_starts, note)
where not exists (select 1 from public.coolerco_sla_rules r where r.client_code = x.client_code and r.case_type = x.case_type);

-- Check
select 'outlets' what, count(*) from public.coolerco_outlets where client_code = 'DEMO'
union all select 'models', count(*) from public.coolerco_asset_models where client_code = 'DEMO'
union all select 'assets', count(*) from public.coolerco_assets where client_code = 'DEMO'
union all select 'assets without warehouse', count(*) from public.coolerco_assets where client_code = 'DEMO' and warehouse_code is null
union all select 'codes', count(*) from public.coolerco_fault_codes where client_code = 'DEMO'
union all select 'sla rules', count(*) from public.coolerco_sla_rules where client_code = 'DEMO';
