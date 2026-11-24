-- ============================================================================
-- CoolerCo 041 — Client split (Magnum / Tiger / Demo) + Demo client set-up
-- Run on: TEST first (🟢[TEST] RTMA_Ops). Production only when Wanda says so.
-- Needs:  016 (clients, roles, user access), 028 (coolerco_all_cases), 038 (movements).
-- Rollback: coolerco_041_rollback.sql
--
-- What it does (Wanda 2026-11-24):
--   1. Three helpers that read the existing user access table:
--        coolerco_scope_all()       admins and CoolerCo office staff with no warehouse
--        coolerco_my_clients()      client users  -> their client(s)
--        coolerco_my_warehouses()   CoolerCo staff -> their warehouse(s) + vehicles
--      and coolerco_can_see(client, warehouse) / coolerco_can_see_magnum().
--   2. CoolerCo registers for clients without a system of their own (Tiger, Demo):
--        coolerco_outlets, coolerco_asset_models, coolerco_assets, coolerco_fault_codes
--      Same fields as the onboarding templates. Magnum stays on COM (assets_live).
--   3. Views coolerco_all_outlets + coolerco_all_assets (COM as MAGNUM + the registers),
--      and coolerco_all_cases now hides COM cases from users who may not see Magnum.
--   4. Access rules on the CoolerCo tables: replaces "every signed-in user sees all":
--        admins / managers / office staff with no warehouse  -> everything
--        warehouse staff, drivers, technicians               -> their warehouses, every client
--        client users                                        -> their own client only
--   5. DEMO client + two demo warehouses (WH-DM-JHB, WH-DM-DBN) + their bays.
--
-- Rules for user access rows (coolerco_user_access):
--   role + no client + no warehouse   = sees everything (system_admin, administrator,
--                                       manager, supplier, viewer)
--   role + warehouse (no client)      = CoolerCo staff of that warehouse, all clients
--   role + client                     = that client only (client users, client viewers)
--   A person can have several rows (e.g. a manager for two demo warehouses).
--
-- Who is NOT affected: the customer portal, concessionaire portal, Field app taps,
-- picking and the case engine all run through security-definer functions and keep
-- working exactly as before. Wanda (system_admin) still sees everything.
-- Nothing of the other apps is changed except two demo rows in `warehouses`
-- (TEST only; they show in SmartSpares / SmartDash on TEST as "Demo …").
-- ============================================================================

-- ── 1. Helpers ───────────────────────────────────────────────────────────────
create or replace function public.coolerco_scope_all()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.coolerco_user_access a
     where a.user_id = auth.uid() and a.active
       and (a.role_code = 'system_admin'
            or (a.client_code is null and a.warehouse_code is null
                and a.role_code in ('administrator', 'manager', 'supplier', 'viewer'))));
$$;

create or replace function public.coolerco_my_clients()
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct a.client_code), '{}')
    from public.coolerco_user_access a
   where a.user_id = auth.uid() and a.active and a.client_code is not null;
$$;

-- Warehouse codes of CoolerCo staff rows, plus the vehicles that belong to them
create or replace function public.coolerco_my_warehouses()
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  with mine as (
    select distinct a.warehouse_code as code
      from public.coolerco_user_access a
     where a.user_id = auth.uid() and a.active
       and a.client_code is null and a.warehouse_code is not null
  )
  select coalesce(array_agg(distinct c), '{}') from (
    select code as c from mine
    union
    select v.code from public.warehouses v
      join public.warehouses p on p.id = v.parent_warehouse_id
      join mine m on m.code = p.code
  ) x;
$$;

create or replace function public.coolerco_can_see(p_client text, p_warehouse text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.coolerco_scope_all()
      or coalesce(p_client, 'MAGNUM') = any (public.coolerco_my_clients())
      or (p_warehouse is not null and p_warehouse = any (public.coolerco_my_warehouses()));
$$;

-- Magnum data from COM has no warehouse code on every row yet. Until it does:
-- Magnum is visible to admins, Magnum client users and staff of any real (non-demo) warehouse.
create or replace function public.coolerco_can_see_magnum()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.coolerco_scope_all()
      or 'MAGNUM' = any (public.coolerco_my_clients())
      or exists (select 1 from public.warehouses w
                  where w.code = any (public.coolerco_my_warehouses())
                    and coalesce(w.tenant_id, '') <> 'tenant_demo');
$$;

revoke all on function public.coolerco_scope_all(), public.coolerco_my_clients(), public.coolerco_my_warehouses(),
  public.coolerco_can_see(text, text), public.coolerco_can_see_magnum() from public, anon;
grant execute on function public.coolerco_scope_all(), public.coolerco_my_clients(), public.coolerco_my_warehouses(),
  public.coolerco_can_see(text, text), public.coolerco_can_see_magnum() to authenticated;

-- ── 2. CoolerCo registers (clients without their own system) ──────────────────
create table if not exists public.coolerco_outlets (
  id              uuid primary key default gen_random_uuid(),
  client_code     text not null references public.coolerco_clients(code),
  outlet_code     text not null,
  name            text not null,
  outlet_type     text,
  contact_person  text,
  mobile_number   text,
  email           text,
  street_address  text,
  suburb          text,
  town            text,
  province        text,
  postal_code     text,
  latitude        double precision,
  longitude       double precision,
  region          text,
  warehouse_code  text,
  rep_code        text,
  route_day       text,
  opening_time    text,
  closing_time    text,
  receiving_from  text,
  receiving_to    text,
  days_closed     text,
  active          boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text default (auth.jwt() ->> 'email'),
  unique (client_code, outlet_code)
);

create table if not exists public.coolerco_asset_models (
  id              uuid primary key default gen_random_uuid(),
  client_code     text not null references public.coolerco_clients(code),
  model_code      text not null,
  description     text not null,
  asset_type      text not null,
  manufacturer    text,
  capacity_litres numeric,
  doors           int,
  product_family  text,
  notes           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text default (auth.jwt() ->> 'email'),
  unique (client_code, model_code)
);

create table if not exists public.coolerco_assets (
  id              uuid primary key default gen_random_uuid(),
  client_code     text not null references public.coolerco_clients(code),
  asset_number    text not null,
  serial_number   text,
  model_code      text,
  branding        text,
  condition       text,
  status          text not null,
  location_type   text not null check (location_type in ('Outlet', 'Warehouse')),
  location_code   text not null,
  warehouse_code  text,             -- warehouse in charge: the location itself, or the outlet's warehouse
  placement_date  date,
  purchase_date   date,
  warranty_end    date,
  last_service    date,
  has_label       boolean,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text default (auth.jwt() ->> 'email'),
  unique (client_code, asset_number)
);
create index if not exists idx_coolerco_assets_location on public.coolerco_assets (client_code, location_type, location_code);
create index if not exists idx_coolerco_assets_wh on public.coolerco_assets (warehouse_code);

create table if not exists public.coolerco_fault_codes (
  id              uuid primary key default gen_random_uuid(),
  client_code     text not null references public.coolerco_clients(code),
  code            text not null,
  description     text not null,
  code_type       text not null check (code_type in ('Fault', 'Repair', 'Spare part')),
  asset_type      text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (client_code, code)
);

-- Warehouse in charge of an asset at an outlet = the outlet's warehouse
create or replace function public.coolerco_assets_set_wh()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.location_type = 'Warehouse' then
    new.warehouse_code := new.location_code;
  elsif new.warehouse_code is null then
    select o.warehouse_code into new.warehouse_code
      from public.coolerco_outlets o
     where o.client_code = new.client_code and o.outlet_code = new.location_code;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists coolerco_assets_set_wh on public.coolerco_assets;
create trigger coolerco_assets_set_wh before insert or update on public.coolerco_assets
  for each row execute function public.coolerco_assets_set_wh();

-- Access: see by client / warehouse; only admins change the registers
do $$
declare t text;
begin
  foreach t in array array['coolerco_outlets', 'coolerco_asset_models', 'coolerco_assets', 'coolerco_fault_codes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated
                      using (public.coolerco_has_role(array[''system_admin'', ''administrator'']))
                      with check (public.coolerco_has_role(array[''system_admin'', ''administrator'']))', t || '_admin', t);
  end loop;
end $$;

drop policy if exists coolerco_outlets_read on public.coolerco_outlets;
create policy coolerco_outlets_read on public.coolerco_outlets for select to authenticated
  using (public.coolerco_can_see(client_code, warehouse_code));

drop policy if exists coolerco_assets_read on public.coolerco_assets;
create policy coolerco_assets_read on public.coolerco_assets for select to authenticated
  using (public.coolerco_can_see(client_code, warehouse_code));

-- Models and codes carry no warehouse: visible to the client's users and to staff
-- who can see at least one asset of that client
drop policy if exists coolerco_asset_models_read on public.coolerco_asset_models;
create policy coolerco_asset_models_read on public.coolerco_asset_models for select to authenticated
  using (public.coolerco_scope_all() or client_code = any (public.coolerco_my_clients())
         or exists (select 1 from public.coolerco_assets a
                     where a.client_code = coolerco_asset_models.client_code
                       and a.warehouse_code = any (public.coolerco_my_warehouses())));

drop policy if exists coolerco_fault_codes_read on public.coolerco_fault_codes;
create policy coolerco_fault_codes_read on public.coolerco_fault_codes for select to authenticated
  using (public.coolerco_scope_all() or client_code = any (public.coolerco_my_clients())
         or exists (select 1 from public.coolerco_assets a
                     where a.client_code = coolerco_fault_codes.client_code
                       and a.warehouse_code = any (public.coolerco_my_warehouses())));

-- ── 3. Combined views ────────────────────────────────────────────────────────
create or replace view public.coolerco_all_outlets with (security_invoker = true) as
select 'COM'::text as source, 'MAGNUM'::text as client_code,
       p.pos_local_code as outlet_code, p.point_of_sale as name, null::text as outlet_type,
       null::text as contact_person, null::text as mobile_number, null::text as town, null::text as province,
       null::double precision as latitude, null::double precision as longitude,
       p.warehouse_code, true as active
  from public.coolerco_pos_warehouse p
 where public.coolerco_can_see_magnum()
union all
select 'CoolerCo', o.client_code, o.outlet_code, o.name, o.outlet_type,
       o.contact_person, o.mobile_number, o.town, o.province, o.latitude, o.longitude,
       o.warehouse_code, o.active
  from public.coolerco_outlets o;

create or replace view public.coolerco_all_assets with (security_invoker = true) as
select 'COM'::text as source, 'MAGNUM'::text as client_code,
       a.name as asset_number, a.bar_code, a.serial_number,
       a.product_variant as model, a.asset_type, a.brand_hierarchy as branding,
       a.condition, a.asset_status as status, a.asset_location as location_type,
       a.assign_account_local_code as location_code, a.assign_account as location_name,
       null::text as warehouse_code
  from public.assets_live a
 where public.coolerco_can_see_magnum()
union all
select 'CoolerCo', s.client_code,
       s.asset_number, s.asset_number, s.serial_number,
       coalesce(m.description, s.model_code), m.asset_type, s.branding,
       s.condition, s.status, s.location_type,
       s.location_code, coalesce(o.name, w.name), s.warehouse_code
  from public.coolerco_assets s
  left join public.coolerco_asset_models m on m.client_code = s.client_code and m.model_code = s.model_code
  left join public.coolerco_outlets o on s.location_type = 'Outlet' and o.client_code = s.client_code and o.outlet_code = s.location_code
  left join public.warehouses w on s.location_type = 'Warehouse' and w.code = s.location_code;

revoke all on public.coolerco_all_outlets, public.coolerco_all_assets from anon, authenticated;
grant select on public.coolerco_all_outlets, public.coolerco_all_assets to authenticated;

-- coolerco_all_cases (028): same columns; COM cases only for users who may see Magnum
create or replace view public.coolerco_all_cases with (security_invoker = true) as
 SELECT 'COM'::text AS source,
    'MAGNUM'::text AS client_code,
    c.case_number, c.case_type, c.status_reason,
    lower(TRIM(BOTH FROM COALESCE(c.status_reason, ''::text))) = ANY (ARRAY['open'::text, 'in progress'::text, 'waiting'::text, 'in service'::text, 'on hold'::text]) AS is_open,
    true AS counts_as_case,
    c.priority, c.origin, NULL::text AS originator, c.motive, c.warehouse_workshop,
    c.responsible_ordering_party, c.point_of_sale, c.pos_local_code, c.address,
    NULLIF(c.latitude::text, ''::text)::double precision AS latitude,
    NULLIF(c.longitude::text, ''::text)::double precision AS longitude,
    c.case_contact_name, c.case_contact_number, c.case_mobile_number, c.asset_type, c.mapped_asset,
    c.asset_removed, c.asset_delivered, c.asset_repaired, c.asset_condition,
    c.requested_product_base, c.requested_asset_condition, c.requested_brand_hierarchy,
    c.created_on, c.begin_date, c.end_date, c.service_closure_date, c.sla_status,
    c.technician_routed_to, c.contractor, c.message AS notes, NULL::text AS com_case_number
   FROM public.cases c
  WHERE public.coolerco_can_see_magnum()
UNION ALL
 SELECT 'CoolerCo'::text AS source,
    COALESCE(k.client_code, 'MAGNUM'::text) AS client_code,
    k.case_number, k.case_type, k.status_reason,
    COALESCE(k.status_reason, ''::text) <> ALL (ARRAY['Rejected'::text, 'Cancelled'::text, 'Canceled'::text, 'Completed'::text, 'Closed'::text, 'Solved'::text, 'Resolved'::text, 'Linked to COM'::text]) AS is_open,
    k.com_case_number IS NULL AS counts_as_case,
    k.priority, k.origin, k.originator, k.motive, k.warehouse_workshop,
    k.responsible_ordering_party, k.point_of_sale, k.pos_local_code, k.address,
    k.latitude, k.longitude,
    k.case_contact_name, k.case_contact_number, k.case_mobile_number, k.asset_type, k.mapped_asset,
    k.asset_removed, k.asset_delivered, k.asset_repaired, k.asset_condition,
    k.requested_product_base, k.requested_asset_condition, k.requested_brand_hierarchy,
    k.created_on, k.begin_date, k.end_date, k.service_closure_date,
    NULL::text AS sla_status, NULL::text AS technician_routed_to, NULL::boolean AS contractor,
    k.description AS notes, k.com_case_number
   FROM public.coolerco_cases k;

revoke all on public.coolerco_all_cases from anon, authenticated;
grant select on public.coolerco_all_cases to authenticated;

-- ── 4. Access rules on the CoolerCo tables ───────────────────────────────────
-- 4a. CoolerCo cases: by client + warehouse
drop policy if exists coolerco_cases_staff on public.coolerco_cases;
drop policy if exists coolerco_cases_scoped on public.coolerco_cases;
create policy coolerco_cases_scoped on public.coolerco_cases for all to authenticated
  using (public.coolerco_can_see(client_code, warehouse_code))
  with check (public.coolerco_can_see(client_code, warehouse_code));

-- 4b. Case events and comments follow the case they belong to (CoolerCo or COM)
drop policy if exists coolerco_case_events_staff on public.coolerco_case_events;
drop policy if exists coolerco_case_events_scoped on public.coolerco_case_events;
create policy coolerco_case_events_scoped on public.coolerco_case_events for all to authenticated
  using (public.coolerco_scope_all()
         or exists (select 1 from public.coolerco_cases k where k.case_number = coolerco_case_events.case_number)
         or (public.coolerco_can_see_magnum()
             and not exists (select 1 from public.coolerco_cases k2 where k2.case_number = coolerco_case_events.case_number)))
  with check (public.coolerco_scope_all()
         or exists (select 1 from public.coolerco_cases k where k.case_number = coolerco_case_events.case_number)
         or (public.coolerco_can_see_magnum()
             and not exists (select 1 from public.coolerco_cases k2 where k2.case_number = coolerco_case_events.case_number)));

drop policy if exists coolerco_case_comments_staff on public.coolerco_case_comments;
drop policy if exists coolerco_case_comments_scoped on public.coolerco_case_comments;
create policy coolerco_case_comments_scoped on public.coolerco_case_comments for all to authenticated
  using (public.coolerco_scope_all()
         or exists (select 1 from public.coolerco_cases k where k.case_number = coolerco_case_comments.case_number)
         or (public.coolerco_can_see_magnum()
             and not exists (select 1 from public.coolerco_cases k2 where k2.case_number = coolerco_case_comments.case_number)))
  with check (public.coolerco_scope_all()
         or exists (select 1 from public.coolerco_cases k where k.case_number = coolerco_case_comments.case_number)
         or (public.coolerco_can_see_magnum()
             and not exists (select 1 from public.coolerco_cases k2 where k2.case_number = coolerco_case_comments.case_number)));

-- 4c. Asset movements: by client + warehouse (written by the case engine)
drop policy if exists coolerco_asset_movements_read on public.coolerco_asset_movements;
drop policy if exists coolerco_asset_movements_scoped on public.coolerco_asset_movements;
create policy coolerco_asset_movements_scoped on public.coolerco_asset_movements for select to authenticated
  using (public.coolerco_can_see(client_code, coalesce(warehouse,
           case when to_kind ilike 'w%' then to_code end,
           case when from_kind ilike 'w%' then from_code end)));

-- 4d. Customer portal links: by client + the outlet's warehouse
drop policy if exists coolerco_portal_links_staff on public.coolerco_portal_links;
drop policy if exists coolerco_portal_links_scoped on public.coolerco_portal_links;
create policy coolerco_portal_links_scoped on public.coolerco_portal_links for all to authenticated
  using (public.coolerco_scope_all()
         or coalesce(client_code, 'MAGNUM') = any (public.coolerco_my_clients())
         or exists (select 1 from public.coolerco_outlets o
                     where o.client_code = coolerco_portal_links.client_code
                       and o.outlet_code = coolerco_portal_links.pos_local_code
                       and o.warehouse_code = any (public.coolerco_my_warehouses()))
         or (coalesce(client_code, 'MAGNUM') = 'MAGNUM' and public.coolerco_can_see_magnum()))
  with check (public.coolerco_scope_all()
         or coalesce(client_code, 'MAGNUM') = any (public.coolerco_my_clients())
         or exists (select 1 from public.coolerco_outlets o
                     where o.client_code = coolerco_portal_links.client_code
                       and o.outlet_code = coolerco_portal_links.pos_local_code
                       and o.warehouse_code = any (public.coolerco_my_warehouses()))
         or (coalesce(client_code, 'MAGNUM') = 'MAGNUM' and public.coolerco_can_see_magnum()));

-- 4e. Magnum outlet -> warehouse list: Magnum viewers only
drop policy if exists coolerco_pos_warehouse_staff on public.coolerco_pos_warehouse;
drop policy if exists coolerco_pos_warehouse_scoped on public.coolerco_pos_warehouse;
create policy coolerco_pos_warehouse_scoped on public.coolerco_pos_warehouse for all to authenticated
  using (public.coolerco_can_see_magnum())
  with check (public.coolerco_can_see_magnum());

-- 4f. Field job cards: read follows the case; adding stays "your own" (031)
drop policy if exists coolerco_fjc_read on public.coolerco_field_job_cards;
create policy coolerco_fjc_read on public.coolerco_field_job_cards for select to authenticated
  using (public.coolerco_scope_all()
         or created_by = auth.uid()
         or exists (select 1 from public.coolerco_cases k where k.case_number = coolerco_field_job_cards.case_number)
         or (public.coolerco_can_see_magnum()
             and not exists (select 1 from public.coolerco_cases k2 where k2.case_number = coolerco_field_job_cards.case_number)));

-- 4g. Alerts and feedback: office roles keep them, but only for clients / warehouses they may see
drop policy if exists coolerco_notifications_staff on public.coolerco_notifications;
create policy coolerco_notifications_staff on public.coolerco_notifications for select to authenticated
  using (public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier', 'supervisor'])
         and public.coolerco_can_see(client_code, warehouse_code));
drop policy if exists coolerco_notifications_read on public.coolerco_notifications;
create policy coolerco_notifications_read on public.coolerco_notifications for update to authenticated
  using (public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier', 'supervisor'])
         and public.coolerco_can_see(client_code, warehouse_code))
  with check (public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier', 'supervisor'])
         and public.coolerco_can_see(client_code, warehouse_code));

drop policy if exists coolerco_feedback_supplier on public.coolerco_case_feedback;
create policy coolerco_feedback_supplier on public.coolerco_case_feedback for select to authenticated
  using (public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier'])
         and public.coolerco_can_see(client_code, warehouse_code));

-- ── 5. Demo client, warehouses and bays ──────────────────────────────────────
insert into public.coolerco_clients (code, name, system_of_record, can_close_cases, repair_needs_approval, share_feedback, active)
values ('DEMO', 'Demo client', 'coolerco', true, false, true, true)
on conflict (code) do nothing;

insert into public.warehouses (code, name, is_active, warehouse_type, city, province, country, tenant_id, has_workshop, has_ncd_bay)
values ('WH-DM-JHB', 'Demo Gauteng Warehouse', true, 'regional', 'Germiston', 'Gauteng', 'South Africa', 'tenant_demo', true, false),
       ('WH-DM-DBN', 'Demo Durban Warehouse',  true, 'regional', 'Pinetown',  'KwaZulu-Natal', 'South Africa', 'tenant_demo', true, false)
on conflict (code) do nothing;

insert into public.coolerco_wh_locations (warehouse_code, building, area, label, is_picking, sort_order, active)
select w.code, w.bld, a.area, w.bld || ' · ' || a.area, a.picking, a.ord, true
  from (values ('WH-DM-JHB', 'Demo Gauteng WH'), ('WH-DM-DBN', 'Demo Durban WH')) w(code, bld)
 cross join (values ('Receiving', false, 10), ('Repair', false, 20), ('Ready to work', true, 30), ('Loading', true, 40)) a(area, picking, ord)
on conflict (warehouse_code, building, area) do nothing;

-- ============================================================================
-- Checks (read only)
-- ============================================================================
select code, name from public.coolerco_clients order by code;
select code, name, tenant_id from public.warehouses where code like 'WH-DM-%';
select tablename, policyname from pg_policies
 where schemaname = 'public' and tablename like 'coolerco_%' and qual = 'true' order by 1;
