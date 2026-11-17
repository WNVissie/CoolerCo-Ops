-- CoolerCo-Ops · 038 · RUN ON TEST FIRST — case rules + asset movement ledger + COM updates (Wanda 2026-11-17)
-- ONE rules table drives every client:  CoolerCo event (route, pick, job card, not-done reason, cancel)  →
--   COM notification + case status + asset movements (COM movement types 001–044) + follow-up case.
--   • MAGNUM (COM is master): CoolerCo writes the notification to "COM updates" (a file to import in COM) and posts the
--     movements as EXPECTED; nothing is ever written to COM `cases` / `assets_live`. "App vs COM" shows what COM hasn't caught up with.
--   • TIGER (CoolerCo is master): CoolerCo applies it itself — case status + motive, asset movements, follow-up case
--     (Removal / Replacement → Repair at Workshop, Repair failed → Replacement, To brand → Decal @WH).
--   • Cancelled case (any client): every movement of that case is reversed → assets back to where they were, previous status.
-- Wanda's rules 17 Nov: Replacement old asset 005 (In Transit) then To be Repaired when the repair case is made · Removal 004
--   (To be Repaired, always checked before RTW) · Repair failed → Not Solved · Arrived = our records only · partial Replacement
--   Tiger only (supervisor OK), COM does not allow it · workshop + Decal @WH from CoolerCo now.
-- Extends 024's ledger coolerco_asset_movements (picking) — creates it if 024 is not installed. Additive; coolerco_ only.
-- Engine never blocks a Field app save (errors go to coolerco_engine_log). Rollback: coolerco_038_rollback.sql

-- ── 1. COM movement types (shared by all clients) + CoolerCo's own steps ──
create table if not exists public.coolerco_movement_types (
  code         text primary key,
  name         text not null,
  from_kind    text,            -- Warehouse / Workshop / Location / Organization / Vehicle
  to_kind      text,
  status_after text,            -- asset status after the movement (null = unchanged)
  physical     boolean default true,
  source       text not null default 'COM' check (source in ('COM', 'CoolerCo')),
  active       boolean not null default true
);
insert into public.coolerco_movement_types (code, name, from_kind, to_kind, status_after, physical) values
  ('001','From Warehouse to Organization','Warehouse','Organization','Ready to Work',true),
  ('002','From Organization to Warehouse','Organization','Warehouse','Ready to Work',true),
  ('003','From Warehouse to Shopper POS','Warehouse','Location','Assigned',true),
  ('004','From Shopper POS to Warehouse - Broken','Location','Warehouse','To be Repaired',true),
  ('005','From Shopper POS to Warehouse - Replaced','Location','Warehouse','In Transit',true),
  ('006','From Shopper POS to Warehouse - Final','Location','Warehouse','Ready to Work',true),
  ('007','From Shopper POS to Warehouse - Definitive','Location','Warehouse','In Transit',true),
  ('009','From Warehouse to Repairing','Warehouse','Workshop','To be Repaired',true),
  ('010','From Repairing to Warehouse - Repaired','Workshop','Warehouse','Waiting for Action',true),
  ('011','From Repairing to Warehouse - Not Repaired','Workshop','Warehouse','Broken',true),
  ('012','From a Warehouse to an another Warehouse','Warehouse','Warehouse','Ready to Work',true),
  ('013','Purchased by Entity','Organization','Warehouse','Sold',false),
  ('014','From Unknown to Warehouse','Organization','Warehouse','Ready to Work',true),
  ('017','From Warehouse to Destruction','Warehouse','Organization','Scrapped',true),
  ('019','From Repairing to Destruction','Workshop','Organization','Scrapped',true),
  ('020','Change of Shopper POS ownership','Location','Location','Assigned',true),
  ('021','Preventative Maintenance','Location','Location',null,true),
  ('022','Inventory Complete',null,null,null,false),
  ('023','Inventory Missing - Shopper POS','Location','Location',null,false),
  ('024','Inventory Missing - Warehouse',null,null,null,false),
  ('025','From Warehouse to Salvage','Warehouse','Workshop','To be Scrapped',true),
  ('027','Change of ROP','Location','Location',null,false),
  ('028','From a Warehouse to an another Warehouse','Warehouse','Warehouse','Waiting for Action',true),
  ('029','From Salvage to Warehouse','Workshop','Warehouse','To be Scrapped',true),
  ('030','From Repairing to Warranty','Warehouse','Warehouse','Under Warranty Repair',true),
  ('031','From Warranty to Warehouse','Warehouse','Warehouse','Waiting for Action',true),
  ('032','From a Central Warehouse to a Distributor Warehouse','Warehouse','Warehouse','Ready to Work',true),
  ('033','From a Distributor Warehouse to a Central Warehouse','Warehouse','Warehouse','Ready to Work',true),
  ('034','From a Central Warehouse to a Distributor Warehouse','Warehouse','Warehouse','Waiting for Action',true),
  ('035','From a Distributor Warehouse to a Central Warehouse','Warehouse','Warehouse','Waiting for Action',true),
  ('036','From a Distributor Warehouse to Shopper POS','Warehouse','Location','Assigned',false),
  ('037','From Shopper POS to Distributor Warehouse','Location','Warehouse','Ready to Work',true),
  ('038','From a Distributor Warehouse to a Distributor Warehouse','Warehouse','Warehouse','Ready to Work',true),
  ('039','From Shopper POS to Warehouse - Back Order','Location','Warehouse','Back Order',true),
  ('040','From Repairing to Warehouse - Back Order','Workshop','Warehouse','Back Order',true),
  ('041','From Warehouse to Refurbish','Warehouse','Warehouse','To be Refurbished',false),
  ('042','From Shopper POS to Warehouse - To Refurbish','Location','Warehouse','To be Refurbished',false),
  ('043','From Shopper POS to Shopper POS - Merged','Point of Sale','Location','Assigned',false),
  ('044','From Warehouse to Sold to Entity','Warehouse','Organization','Sold',true)
on conflict (code) do nothing;
insert into public.coolerco_movement_types (code, name, from_kind, to_kind, status_after, physical, source) values
  ('CC-PICK',    'Picked for a route (bay → loading)',          'Warehouse', 'Warehouse', null,            true,  'CoolerCo'),
  ('CC-LOAD',    'Loaded on the truck',                          'Warehouse', 'Vehicle',   null,            true,  'CoolerCo'),
  ('CC-RETURN',  'Brought back to the warehouse (not delivered)','Vehicle',   'Warehouse', null,            true,  'CoolerCo'),
  ('CC-STATUS',  'Status change only',                           null,        null,        null,            false, 'CoolerCo'),
  ('CC-REVERSE', 'Reversal (case cancelled)',                    null,        null,        null,            true,  'CoolerCo')
on conflict (code) do nothing;
alter table public.coolerco_movement_types enable row level security;
drop policy if exists coolerco_movement_types_read on public.coolerco_movement_types;
create policy coolerco_movement_types_read on public.coolerco_movement_types for select to authenticated using (true);
revoke all on public.coolerco_movement_types from anon, authenticated;
grant select on public.coolerco_movement_types to authenticated;

-- ── 2. Ledger: 024's table, extended ──
create table if not exists public.coolerco_asset_movements (
  id uuid primary key default gen_random_uuid(), client_id uuid unique, asset text not null, bar_code text,
  movement text not null, warehouse text, location_id uuid, route_id uuid, case_number text,
  how text check (how in ('camera', 'scanner', 'typed', 'system', 'screen')), expected boolean, exception text,
  override_reason text, details jsonb, by_user uuid default auth.uid(), by_label text, at timestamptz not null default now());
alter table public.coolerco_asset_movements drop constraint if exists coolerco_asset_movements_movement_check;
alter table public.coolerco_asset_movements add constraint coolerco_asset_movements_movement_check check (movement in
  ('reserve', 'unreserve', 'pick', 'unpick', 'load', 'unload', 'receive', 'putaway', 'transfer_out', 'transfer_in',
   'deliver', 'collect', 'audit', 'scrap', 'adjust', 'return', 'repair_in', 'repair_out', 'status', 'reverse'));
alter table public.coolerco_asset_movements add column if not exists client_code   text;
alter table public.coolerco_asset_movements add column if not exists case_type     text;
alter table public.coolerco_asset_movements add column if not exists movement_code text references public.coolerco_movement_types(code);
alter table public.coolerco_asset_movements add column if not exists asset_role    text;      -- delivered / removed / repaired
alter table public.coolerco_asset_movements add column if not exists from_kind     text;
alter table public.coolerco_asset_movements add column if not exists from_code     text;
alter table public.coolerco_asset_movements add column if not exists to_kind       text;
alter table public.coolerco_asset_movements add column if not exists to_code       text;
alter table public.coolerco_asset_movements add column if not exists status_before text;
alter table public.coolerco_asset_movements add column if not exists status_after  text;
alter table public.coolerco_asset_movements add column if not exists source        text;      -- picking / job_card / stop_event / cancel / route / engine
alter table public.coolerco_asset_movements add column if not exists source_id     uuid;
alter table public.coolerco_asset_movements add column if not exists reverses      uuid references public.coolerco_asset_movements(id);
alter table public.coolerco_asset_movements add column if not exists reversed      boolean not null default false;
create unique index if not exists coolerco_moves_source_uq on public.coolerco_asset_movements (source_id, asset, movement_code) where source_id is not null;
create index if not exists idx_cc_moves_case on public.coolerco_asset_movements (case_number, at);
alter table public.coolerco_asset_movements enable row level security;
drop policy if exists coolerco_asset_movements_read on public.coolerco_asset_movements;
create policy coolerco_asset_movements_read on public.coolerco_asset_movements for select to authenticated using (true);
revoke all on public.coolerco_asset_movements from anon, authenticated;
grant select on public.coolerco_asset_movements to authenticated;

-- ── 3. Rules: event → notification + case status + movements + follow-up, per client ('*' = all) and case type ──
create table if not exists public.coolerco_case_rules (
  id                     uuid primary key default gen_random_uuid(),
  client_code            text not null default '*',
  case_type              text not null,
  event                  text not null,      -- route_final, picked, arrived, completed, partial, denied, location_closed,
                                             -- location_unavailable, lack_material, repair_failed, to_brand, asset_missing, other, cancelled
  notification           text,               -- COM notification name (null = nothing to COM)
  notification_code      text,
  case_status            text,               -- status after (null = unchanged)
  movements              jsonb not null default '[]',   -- [{"role":"delivered","code":"003"}, …]
  return_loaded          boolean not null default false, -- not delivered → picked / loaded assets go back to the warehouse
  follow_up_case_type    text,
  follow_up_asset_role   text,
  follow_up_asset_status text,               -- status of that asset once the follow-up case exists (e.g. To be Repaired)
  allowed                boolean not null default true,
  needs_approval         boolean not null default false,
  active                 boolean not null default true,
  note                   text,
  updated_at             timestamptz default now(),
  updated_by             uuid,
  unique (client_code, case_type, event)
);
alter table public.coolerco_case_rules enable row level security;
drop policy if exists coolerco_case_rules_read on public.coolerco_case_rules;
create policy coolerco_case_rules_read on public.coolerco_case_rules for select to authenticated using (true);
revoke all on public.coolerco_case_rules from anon, authenticated;
grant select on public.coolerco_case_rules to authenticated;

insert into public.coolerco_case_rules (client_code, case_type, event, notification, notification_code, case_status, movements, return_loaded,
       follow_up_case_type, follow_up_asset_role, follow_up_asset_status, allowed, needs_approval, note) values
 -- Deliver an Asset
 ('*','Deliver an Asset','route_final','WITHIN PROPOSED TIME','550101','In Service','[]',false,null,null,null,true,false,null),
 ('*','Deliver an Asset','picked','ASSET PICKED AND PREPARED FOR TRANSPORT','550109','In Service','[]',false,null,null,null,true,false,null),
 ('*','Deliver an Asset','completed','SERVICE COMPLETE','590101','Solved','[{"role":"delivered","code":"003"}]',false,null,null,null,true,false,'asset to the POS, Assigned'),
 ('*','Deliver an Asset','denied','SERVICE DENIED/REFUSED','590203','Action Required','[]',true,null,null,null,true,false,null),
 ('*','Deliver an Asset','location_unavailable','LOCATION UNAVAILABLE','590201','Action Required','[]',true,null,null,null,true,false,null),
 ('*','Deliver an Asset','location_closed','LOCATION CLOSED','590202','Action Required','[]',true,null,null,null,true,false,null),
 -- Removal of Asset
 ('*','Removal of Asset','route_final','WITHIN PROPOSED TIME','550101','In Service','[]',false,null,null,null,true,false,null),
 ('*','Removal of Asset','completed','TO REPAIR','590211','Solved','[{"role":"removed","code":"004"}]',false,'Repair at Workshop','removed',null,true,false,'always technically checked before Ready to Work'),
 ('*','Removal of Asset','denied','SERVICE DENIED/REFUSED','590203','Action Required','[]',false,null,null,null,true,false,null),
 -- Replacement of Asset
 ('*','Replacement of Asset','route_final','WITHIN PROPOSED TIME','550101','In Service','[]',false,null,null,null,true,false,null),
 ('*','Replacement of Asset','picked','ASSET PICKED AND PREPARED FOR TRANSPORT','550109','In Service','[]',false,null,null,null,true,false,null),
 ('*','Replacement of Asset','completed','TO REPAIR','590211','Solved','[{"role":"delivered","code":"003"},{"role":"removed","code":"005"}]',false,'Repair at Workshop','removed','To be Repaired',true,false,'old asset In Transit until the repair case exists'),
 ('*','Replacement of Asset','denied','SERVICE DENIED/REFUSED','590203','Action Required','[]',true,null,null,null,true,false,'both assets come back'),
 ('MAGNUM','Replacement of Asset','partial',null,null,null,'[]',false,null,null,null,false,false,'COM does not allow a partial replacement — record Not completed; the office decides'),
 ('TIGER','Replacement of Asset','partial',null,null,'Solved','[{"role":"delivered","code":"003"}]',false,null,null,null,true,true,'new asset delivered, old one not collected — supervisor OK; no repair case'),
 -- Repair at Shopper POS
 ('*','Repair at Shopper POS','route_final','WITHIN PROPOSED TIME','550101','In Service','[]',false,null,null,null,true,false,null),
 ('*','Repair at Shopper POS','completed','SERVICE COMPLETE','590101','Solved','[]',false,null,null,null,true,false,'with faults, repairs and spares'),
 ('*','Repair at Shopper POS','lack_material','LACK OF MATERIAL','590204','Action Required','[]',false,null,null,null,true,false,null),
 ('*','Repair at Shopper POS','location_unavailable','LOCATION UNAVAILABLE','590201','Action Required','[]',false,null,null,null,true,false,null),
 ('*','Repair at Shopper POS','location_closed','LOCATION CLOSED','590202','Action Required','[]',false,null,null,null,true,false,null),
 ('*','Repair at Shopper POS','denied','SERVICE DENIED/REFUSED','590203','Action Required','[]',false,null,null,null,true,false,null),
 ('*','Repair at Shopper POS','repair_failed','REPAIR FAILED','590280','Not Solved','[]',false,'Replacement of Asset','repaired',null,true,false,'automatic Replacement, linked as the related case'),
 -- Repair at Workshop
 ('*','Repair at Workshop','route_final','WITHIN PROPOSED TIME','550101','In Service','[]',false,null,null,null,true,false,null),
 ('*','Repair at Workshop','completed','SERVICE COMPLETE','590101','Solved','[]',false,null,null,null,true,false,'with faults, repairs and spares'),
 ('*','Repair at Workshop','lack_material','LACK OF MATERIAL','590204','Action Required','[]',false,null,null,null,true,false,null),
 ('*','Repair at Workshop','to_brand','TO BRAND OR DECAL','590220','Solved','[]',false,'Decal @WH','repaired',null,true,false,'branding ticket'),
 ('*','Repair at Workshop','repair_failed','REPAIR FAILED','590280','Not Solved','[]',false,null,null,null,true,false,'to confirm: auto Replacement for a workshop asset?'),
 -- Decal @WH
 ('*','Decal @WH','route_final','WITHIN PROPOSED TIME','550101','In Service','[]',false,null,null,null,true,false,null),
 ('*','Decal @WH','completed','SERVICE COMPLETE','590101','Solved','[]',false,null,null,null,true,false,null)
on conflict (client_code, case_type, event) do nothing;
-- Arrived = our records only (no rule needed). Cancelled = every case type:
insert into public.coolerco_case_rules (client_code, case_type, event, case_status, note)
select '*', t, 'cancelled', 'Canceled', 'assets back to their previous location and status'
  from unnest(array['Deliver an Asset','Removal of Asset','Replacement of Asset','Repair at Shopper POS','Repair at Workshop','Decal @WH']) t
on conflict (client_code, case_type, event) do nothing;

-- Field app reason / service result → event
create table if not exists public.coolerco_event_codes (code text primary key, event text not null, note text);
insert into public.coolerco_event_codes (code, event) values
  ('SERVICE_DENIED','denied'), ('STORE_CLOSED','location_closed'), ('LOCATION_CLOSED','location_closed'),
  ('LOCATION_NOT_FOUND','location_unavailable'), ('INCORRECT_LOCATION','location_unavailable'), ('ASSET_MISSING','asset_missing'),
  ('REPAIR_FAILED','repair_failed'), ('NEEDS_WORKSHOP','other'), ('WRONG_ASSET','other'), ('NO_CONTACT','other'), ('NO_STOCK','other'),
  ('NO_TIME','other'), ('OTHER','other'),
  ('service_completed','completed'), ('service_denied','denied'), ('incorrect_location','location_unavailable'),
  ('location_closed','location_closed'), ('repair_failed','repair_failed')
on conflict (code) do nothing;
alter table public.coolerco_event_codes enable row level security;
drop policy if exists coolerco_event_codes_read on public.coolerco_event_codes;
create policy coolerco_event_codes_read on public.coolerco_event_codes for select to authenticated using (true);
revoke all on public.coolerco_event_codes from anon, authenticated;
grant select on public.coolerco_event_codes to authenticated;

-- ── 4. COM updates (what to import into COM) + engine log ──
create table if not exists public.coolerco_com_updates (
  id                uuid primary key default gen_random_uuid(),
  case_number       text not null,
  case_type         text,
  client_code       text,
  event             text,
  notification      text not null,
  notification_code text,
  service_at        timestamptz not null default now(),
  notes             text,
  latitude          double precision,
  longitude         double precision,
  warehouse         text,
  source            text,
  source_id         uuid,
  status            text not null default 'to_send' check (status in ('to_send', 'exported', 'done', 'skipped')),
  exported_at       timestamptz,
  export_batch      text,
  done_at           timestamptz,
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid()
);
create unique index if not exists coolerco_com_updates_once on public.coolerco_com_updates (case_number, notification) where status <> 'skipped';
create index if not exists idx_cc_com_updates_status on public.coolerco_com_updates (status, service_at);
alter table public.coolerco_com_updates enable row level security;
drop policy if exists coolerco_com_updates_read on public.coolerco_com_updates;
create policy coolerco_com_updates_read on public.coolerco_com_updates for select to authenticated using (true);
revoke all on public.coolerco_com_updates from anon, authenticated;
grant select on public.coolerco_com_updates to authenticated;

create table if not exists public.coolerco_engine_log (
  id bigserial primary key, at timestamptz not null default now(), case_number text, event text, source text, result jsonb);
alter table public.coolerco_engine_log enable row level security;
drop policy if exists coolerco_engine_log_read on public.coolerco_engine_log;
create policy coolerco_engine_log_read on public.coolerco_engine_log for select to authenticated using (true);
revoke all on public.coolerco_engine_log from anon, authenticated;
grant select on public.coolerco_engine_log to authenticated;

alter table public.coolerco_cases add column if not exists related_case text;   -- follow-up cases point to the case that made them

-- ── 5. Engine ──
-- Where an asset is now: CoolerCo ledger first (latest), else the COM register.
create or replace function public.coolerco_asset_now(p_asset text)
returns table (kind text, code text, status text)
language sql stable security definer set search_path = public, pg_temp as $$
  with m as (select to_kind, to_code, status_after, at from public.coolerco_asset_movements
              where asset = p_asset and movement_code is not null order by at desc limit 1),
       s as (select status_after from public.coolerco_asset_movements
              where asset = p_asset and status_after is not null order by at desc limit 1),
       l as (select case when asset_location = 'Location' then 'Location' when asset_location = 'Workshop' then 'Workshop' else asset_location end k,
                    case when asset_location = 'Location' then assign_account_local_code else assign_account end c, asset_status
               from public.assets_live where name = p_asset limit 1)
  select coalesce((select to_kind from m), (select k from l)), coalesce((select to_code from m), (select c from l)),
         coalesce((select status_after from s), (select asset_status from l))
$$;

-- Post one movement (append-only). Resolves from = where the asset is now, to = by the movement type's kind.
create or replace function public.coolerco_post_movement(p_asset text, p_code text, p_case jsonb, p_role text, p_source text,
       p_source_id uuid, p_expected boolean, p_status text default null, p_reverses uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.coolerco_movement_types; n record; v_id uuid; v_to_code text; v_mv text; v_bar text;
begin
  if p_asset is null then return null; end if;
  -- once per case + asset + movement (a re-done job card or a re-sent event never posts twice)
  if p_code not in ('CC-STATUS', 'CC-REVERSE', 'CC-RETURN') and exists (select 1 from public.coolerco_asset_movements
       where case_number = p_case ->> 'case_number' and asset = p_asset and movement_code = p_code and not reversed) then
    return null;
  end if;
  select * into t from public.coolerco_movement_types where code = p_code;
  select * into n from public.coolerco_asset_now(p_asset);
  select bar_code into v_bar from public.assets_live where name = p_asset limit 1;
  v_to_code := case t.to_kind when 'Location' then p_case ->> 'pos_local_code'
                              when 'Warehouse' then coalesce(p_case ->> 'warehouse_workshop', '') || ' WH'
                              when 'Workshop' then coalesce(p_case ->> 'warehouse_workshop', '') || ' WS'
                              when 'Vehicle' then p_case ->> 'route_id' else n.code end;
  v_mv := case when p_code = 'CC-REVERSE' then 'reverse' when p_code = 'CC-STATUS' then 'status' when p_code = 'CC-RETURN' then 'return'
               when t.to_kind = 'Location' then 'deliver' when t.from_kind = 'Location' then 'collect'
               when t.to_kind = 'Workshop' then 'repair_in' when t.from_kind = 'Workshop' then 'repair_out'
               when t.to_kind = 'Organization' then 'scrap' else 'adjust' end;
  insert into public.coolerco_asset_movements (asset, bar_code, movement, movement_code, warehouse, case_number, case_type, client_code, asset_role,
         from_kind, from_code, to_kind, to_code, status_before, status_after, how, expected, source, source_id, reverses, by_label)
  values (p_asset, v_bar, v_mv, p_code, p_case ->> 'warehouse_workshop', p_case ->> 'case_number', p_case ->> 'case_type', p_case ->> 'client_code', p_role,
          n.kind, n.code, coalesce(t.to_kind, n.kind), coalesce(v_to_code, n.code), n.status, coalesce(p_status, t.status_after),
          'system', p_expected, p_source, p_source_id, p_reverses, 'CoolerCo rules')
  on conflict (source_id, asset, movement_code) where source_id is not null do nothing
  returning id into v_id;
  return v_id;
end $$;

-- Reverse a case's movements (newest first): back to where it came from, previous status.
create or replace function public.coolerco_reverse_case_movements(p_case text, p_only_loaded boolean, p_source text, p_source_id uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare m record; v_n int := 0;
begin
  for m in select * from public.coolerco_asset_movements
            where case_number = p_case and not reversed and movement not in ('reverse', 'unreserve', 'unpick', 'audit')
              and (not p_only_loaded or movement in ('pick', 'load', 'reserve'))
            order by at desc loop
    insert into public.coolerco_asset_movements (asset, bar_code, movement, movement_code, warehouse, case_number, case_type, client_code, asset_role,
           from_kind, from_code, to_kind, to_code, status_before, status_after, how, expected, source, source_id, reverses, by_label)
    values (m.asset, m.bar_code, case when p_only_loaded then 'return' else 'reverse' end, case when p_only_loaded then 'CC-RETURN' else 'CC-REVERSE' end,
            m.warehouse, p_case, m.case_type, m.client_code, m.asset_role, m.to_kind, m.to_code, m.from_kind, m.from_code,
            m.status_after, m.status_before, 'system', m.expected, p_source, null, m.id, 'CoolerCo rules');
    update public.coolerco_asset_movements set reversed = true where id = m.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- THE engine: apply one event to one case.
create or replace function public.coolerco_case_apply_event(p_case text, p_event text, p_source text default 'engine', p_source_id uuid default null,
       p_assets jsonb default '{}', p_at timestamptz default null, p_notes text default null,
       p_lat double precision default null, p_lng double precision default null, p_approved boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k record; c jsonb; r public.coolerco_case_rules; v_master text; v_coolerco boolean; m jsonb; v_asset text; v_role text;
  v_out jsonb := '{}'; v_moves int := 0; v_follow text; v_wh text; v_closed boolean; v_at timestamptz := coalesce(p_at, now());
begin
  select * into k from public.coolerco_all_cases where case_number = p_case order by (source = 'CoolerCo') desc limit 1;
  if k.case_number is null then return jsonb_build_object('skipped', 'case not found'); end if;
  select system_of_record into v_master from public.coolerco_clients where code = coalesce(k.client_code, 'MAGNUM');
  v_coolerco := coalesce(v_master, 'external') = 'coolerco' and k.source = 'CoolerCo';
  select * into r from public.coolerco_case_rules
   where active and case_type = k.case_type and event = p_event and client_code in (coalesce(k.client_code, 'MAGNUM'), '*')
   order by (client_code = '*') limit 1;
  if r.id is null then return jsonb_build_object('skipped', 'no rule for ' || k.case_type || ' / ' || p_event); end if;
  if not r.allowed then return jsonb_build_object('refused', coalesce(r.note, 'not allowed')); end if;
  if r.needs_approval and not p_approved then return jsonb_build_object('needs_approval', true, 'note', r.note); end if;
  v_closed := not coalesce(k.is_open, true);
  if v_closed and p_event <> 'cancelled' then return jsonb_build_object('skipped', 'case already closed (' || k.status_reason || ')'); end if;
  c := to_jsonb(k) || jsonb_build_object('route_id', p_assets ->> 'route_id');

  -- movements
  for m in select * from jsonb_array_elements(r.movements) loop
    v_role := m ->> 'role';
    v_asset := coalesce(p_assets ->> v_role, case v_role when 'delivered' then k.asset_delivered when 'removed' then k.asset_removed
                                                          when 'repaired' then coalesce(k.asset_repaired, k.mapped_asset) end);
    if v_asset is not null and v_asset !~ '^AST' then   -- a barcode / local code → asset number
      select name into v_asset from public.assets_live where v_asset in (bar_code, local_code, serial_number, sap_number) limit 1;
    end if;
    if v_asset is not null and public.coolerco_post_movement(v_asset, m ->> 'code', c, v_role, p_source, p_source_id, not v_coolerco) is not null then
      v_moves := v_moves + 1;
    end if;
  end loop;
  if r.return_loaded then v_moves := v_moves + public.coolerco_reverse_case_movements(p_case, true, p_source, p_source_id); end if;
  if p_event = 'cancelled' then v_moves := v_moves + public.coolerco_reverse_case_movements(p_case, false, p_source, p_source_id); end if;

  -- COM (external master): queue the notification for the COM import file
  if not v_coolerco and r.notification is not null then
    insert into public.coolerco_com_updates (case_number, case_type, client_code, event, notification, notification_code, service_at, notes,
           latitude, longitude, warehouse, source, source_id)
    values (coalesce(k.com_case_number, p_case), k.case_type, k.client_code, p_event, r.notification, r.notification_code, v_at, p_notes,
            p_lat, p_lng, k.warehouse_workshop, p_source, p_source_id)
    on conflict (case_number, notification) where status <> 'skipped' do nothing;
    v_out := v_out || jsonb_build_object('com_update', r.notification);
  end if;

  -- CoolerCo master (Tiger): apply status + follow-up here
  if v_coolerco and r.case_status is not null then
    update public.coolerco_cases set status_reason = r.case_status, motive = coalesce(r.notification, motive),
           asset_delivered = coalesce(p_assets ->> 'delivered_name', asset_delivered),
           service_closure_date = case when r.case_status in ('Solved', 'Not Solved', 'Canceled', 'Cancelled') then v_at else service_closure_date end,
           updated_at = now()
     where case_number = p_case and status_reason is distinct from r.case_status;
    insert into public.coolerco_case_events (case_number, event_type, from_status, to_status, reason_code, notes, actor_type, actor_label, latitude, longitude)
    values (p_case, 'rule:' || p_event, k.status_reason, r.case_status, r.notification, p_notes, 'system', 'CoolerCo rules · ' || p_source, p_lat, p_lng);
    v_out := v_out || jsonb_build_object('status', r.case_status);
    if r.follow_up_case_type is not null then
      v_asset := coalesce(p_assets ->> r.follow_up_asset_role, case r.follow_up_asset_role when 'removed' then k.asset_removed when 'delivered' then k.asset_delivered else coalesce(k.asset_repaired, k.mapped_asset) end);
      if v_asset is not null and v_asset !~ '^AST' then select name into v_asset from public.assets_live where v_asset in (bar_code, local_code, serial_number, sap_number) limit 1; end if;
      select warehouse_code into v_wh from public.coolerco_cases where case_number = p_case;
      if not exists (select 1 from public.coolerco_cases where related_case = p_case and case_type = r.follow_up_case_type) then
        v_follow := public.coolerco_next_case_number(v_wh);
        insert into public.coolerco_cases (case_number, case_type, status_reason, originator, origin, priority, warehouse_code, warehouse_workshop,
               responsible_ordering_party, point_of_sale, pos_local_code, address, latitude, longitude, mapped_asset,
               asset_repaired, asset_delivered, description, begin_date, created_on, created_by_label, client_code, related_case, updated_at)
        select v_follow, r.follow_up_case_type, 'Open', 'CoolerCo', 'Follow-up', x.priority, x.warehouse_code, x.warehouse_workshop,
               x.responsible_ordering_party, x.point_of_sale, x.pos_local_code, x.address, x.latitude, x.longitude, v_asset,
               case when r.follow_up_case_type in ('Repair at Workshop', 'Decal @WH') then v_asset end, null,
               'Automatic follow-up of ' || p_case || ' (' || coalesce(r.notification, p_event) || ')', now(), now(), 'CoolerCo rules', x.client_code, p_case, now()
          from public.coolerco_cases x where x.case_number = p_case;
        insert into public.coolerco_case_events (case_number, event_type, to_status, notes, actor_type, actor_label)
        values (v_follow, 'created', 'Open', 'Follow-up of ' || p_case, 'system', 'CoolerCo rules');
        v_out := v_out || jsonb_build_object('follow_up', v_follow);
      end if;
      if r.follow_up_asset_status is not null and v_asset is not null then
        perform public.coolerco_post_movement(v_asset, 'CC-STATUS', c, r.follow_up_asset_role, p_source || ':follow_up', p_source_id, false, r.follow_up_asset_status);
      end if;
    end if;
  elsif not v_coolerco and r.follow_up_asset_status is not null then
    -- COM makes the follow-up case itself; we only expect the asset status it will give
    v_asset := coalesce(p_assets ->> r.follow_up_asset_role, k.asset_removed);
    if v_asset is not null and v_asset !~ '^AST' then select name into v_asset from public.assets_live where v_asset in (bar_code, local_code, serial_number, sap_number) limit 1; end if;
    if v_asset is not null then perform public.coolerco_post_movement(v_asset, 'CC-STATUS', c, r.follow_up_asset_role, p_source || ':follow_up', p_source_id, true, r.follow_up_asset_status); end if;
  end if;

  v_out := v_out || jsonb_build_object('ok', true, 'rule', r.case_type || ' / ' || r.event, 'movements', v_moves, 'master', case when v_coolerco then 'CoolerCo' else 'COM' end);
  insert into public.coolerco_engine_log (case_number, event, source, result) values (p_case, p_event, p_source, v_out);
  return v_out;
end $$;
revoke all on function public.coolerco_case_apply_event(text, text, text, uuid, jsonb, timestamptz, text, double precision, double precision, boolean) from public, anon;
grant execute on function public.coolerco_case_apply_event(text, text, text, uuid, jsonb, timestamptz, text, double precision, double precision, boolean) to authenticated;
revoke all on function public.coolerco_post_movement(text, text, jsonb, text, text, uuid, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.coolerco_reverse_case_movements(text, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.coolerco_asset_now(text) from public, anon;
grant execute on function public.coolerco_asset_now(text) to authenticated;

-- ── 6. Hooks (never block the save) ──
create or replace function public.coolerco_trg_job_card_rules() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event text; v_res text; v_route uuid;
begin
  begin
    v_res := to_jsonb(new) ->> 'service_result';          -- 032 column, when installed
    v_event := case when new.outcome = 'completed' and coalesce(v_res, 'service_completed') = 'service_completed' then 'completed'
                    else coalesce((select event from public.coolerco_event_codes where code = coalesce(v_res, new.reason_code)), 'other') end;
    perform public.coolerco_case_apply_event(new.case_number, v_event, 'job_card', new.id,
            jsonb_strip_nulls(jsonb_build_object('delivered', new.delivered_barcode, 'removed', new.removed_barcode, 'repaired', new.repaired_barcode,
                                                 'route_id', new.route_id)),
            coalesce(new.completed_at, new.created_at), left(coalesce(new.work_done, '') || ' · Field app job card', 200), new.latitude, new.longitude);
  exception when others then
    insert into public.coolerco_engine_log (case_number, event, source, result) values (new.case_number, v_event, 'job_card', jsonb_build_object('error', sqlerrm));
  end;
  return new;
end $$;
drop trigger if exists coolerco_job_card_rules on public.coolerco_field_job_cards;
create trigger coolerco_job_card_rules after insert on public.coolerco_field_job_cards for each row execute function public.coolerco_trg_job_card_rules();

-- Not completed without a job card → the reason decides
create or replace function public.coolerco_trg_stop_event_rules() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_case text; v_event text;
begin
  begin
    if new.event_type <> 'not_completed' then return new; end if;
    v_case := coalesce(new.case_number, (select case_number from public.routing_route_stops where id = new.stop_id));
    v_event := coalesce((select event from public.coolerco_event_codes where code = new.reason_code), 'other');
    if v_case is not null and not exists (select 1 from public.coolerco_field_job_cards j where j.stop_id = new.stop_id and j.created_at > new.occurred_at - interval '10 minutes') then
      perform public.coolerco_case_apply_event(v_case, v_event, 'stop_event', new.id, jsonb_build_object('route_id', new.route_id), new.occurred_at,
              left(coalesce(new.note, '') || ' · Field app', 200), new.latitude, new.longitude);
    end if;
  exception when others then
    insert into public.coolerco_engine_log (case_number, event, source, result) values (v_case, v_event, 'stop_event', jsonb_build_object('error', sqlerrm));
  end;
  return new;
end $$;
drop trigger if exists coolerco_stop_event_rules on public.coolerco_field_stop_events;
create trigger coolerco_stop_event_rules after insert on public.coolerco_field_stop_events for each row execute function public.coolerco_trg_stop_event_rules();

-- Warehouse pick (024 picking) → "picked" notification (no extra movement: the pick is already in the ledger)
create or replace function public.coolerco_trg_pick_rules() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.movement = 'pick' and new.source is null and new.case_number is not null then
      perform public.coolerco_case_apply_event(new.case_number, 'picked', 'picking', new.id, '{}', new.at, 'Picked in the warehouse · ' || coalesce(new.bar_code, new.asset));
    end if;
  exception when others then
    insert into public.coolerco_engine_log (case_number, event, source, result) values (new.case_number, 'picked', 'picking', jsonb_build_object('error', sqlerrm));
  end;
  return new;
end $$;
drop trigger if exists coolerco_pick_rules on public.coolerco_asset_movements;
create trigger coolerco_pick_rules after insert on public.coolerco_asset_movements for each row execute function public.coolerco_trg_pick_rules();

-- CoolerCo case cancelled (Tiger, or any CoolerCo case) → reverse its movements
create or replace function public.coolerco_trg_case_cancel_rules() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.status_reason in ('Cancelled', 'Canceled') and old.status_reason is distinct from new.status_reason then
      perform public.coolerco_reverse_case_movements(new.case_number, false, 'cancel', null);
      insert into public.coolerco_engine_log (case_number, event, source, result) values (new.case_number, 'cancelled', 'cancel', jsonb_build_object('ok', true));
    end if;
  exception when others then
    insert into public.coolerco_engine_log (case_number, event, source, result) values (new.case_number, 'cancelled', 'cancel', jsonb_build_object('error', sqlerrm));
  end;
  return new;
end $$;
drop trigger if exists coolerco_case_cancel_rules on public.coolerco_cases;
create trigger coolerco_case_cancel_rules after update of status_reason on public.coolerco_cases for each row execute function public.coolerco_trg_case_cancel_rules();

-- Cases on a finalised route → WITHIN PROPOSED TIME (COM: still Open / In Progress there; Tiger: still Open)
create or replace function public.coolerco_case_route_events(p_from date default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare s record; v_n int := 0; v jsonb;
begin
  for s in select distinct on (st.case_number) st.case_number, r.id route_id
             from public.routing_route_stops st join public.routing_routes r on r.id = st.route_id
             join public.routing_route_versions rv on rv.id = st.route_version_id and rv.is_current
             join public.coolerco_all_cases c on c.case_number = st.case_number
            where r.status in ('finalised', 'dispatched', 'partially_completed', 'completed')
              and r.route_date >= coalesce(p_from, (now() at time zone 'Africa/Johannesburg')::date - 3)
              and c.status_reason in ('Open', 'In Progress')
              and not exists (select 1 from public.coolerco_com_updates u where u.case_number = st.case_number and u.notification = 'WITHIN PROPOSED TIME')
  loop
    v := public.coolerco_case_apply_event(s.case_number, 'route_final', 'route', null, jsonb_build_object('route_id', s.route_id));
    if v ? 'ok' then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.coolerco_case_route_events(date) from public, anon;
grant execute on function public.coolerco_case_route_events(date) to authenticated;

-- ── 7. Screens ──
-- Asset history + where it is now
create or replace function public.coolerco_asset_movement_history(p_asset text)
returns table (at timestamptz, movement text, movement_code text, movement_name text, case_number text, case_type text, client_code text,
               asset_role text, from_kind text, from_code text, to_kind text, to_code text, status_before text, status_after text,
               expected boolean, reversed boolean, source text, by_label text, asset text, bar_code text)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.at, m.movement, m.movement_code, t.name, m.case_number, m.case_type, m.client_code, m.asset_role, m.from_kind, m.from_code,
         m.to_kind, m.to_code, m.status_before, m.status_after, m.expected, m.reversed, m.source, m.by_label, m.asset, m.bar_code
    from public.coolerco_asset_movements m left join public.coolerco_movement_types t on t.code = m.movement_code
   where m.asset = p_asset or m.bar_code = p_asset
      or m.asset = (select name from public.assets_live where p_asset in (bar_code, local_code, serial_number, sap_number) limit 1)
   order by m.at desc limit 300
$$;
revoke all on function public.coolerco_asset_movement_history(text) from public, anon;
grant execute on function public.coolerco_asset_movement_history(text) to authenticated;

-- App vs COM (Magnum): movements CoolerCo expects that COM's register does not show yet
create or replace view public.coolerco_movement_com_check with (security_invoker = true) as
select m.at, m.case_number, m.case_type, m.asset, m.bar_code, m.movement_code, t.name movement_name, m.to_kind, m.to_code, m.status_after,
       l.asset_location com_location, l.assign_account com_account, l.assign_account_local_code com_pos, l.asset_status com_status, l.last_synced_at com_data_at,
       case when m.to_kind = 'Location' and (l.asset_location is distinct from 'Location' or l.assign_account_local_code is distinct from m.to_code) then 'not_at_pos_in_com'
            when m.to_kind in ('Warehouse', 'Workshop') and l.asset_location = 'Location' then 'still_at_pos_in_com'
            when m.status_after is not null and l.asset_status is distinct from m.status_after then 'status_differs'
            else 'ok' end as check_result,
       round(extract(epoch from now() - m.at) / 86400.0, 1) as days_waiting
  from public.coolerco_asset_movements m
  join public.coolerco_movement_types t on t.code = m.movement_code and t.source = 'COM'
  left join public.assets_live l on l.name = m.asset
 where m.expected and not m.reversed and coalesce(m.client_code, 'MAGNUM') <> 'TIGER'
   and not exists (select 1 from public.coolerco_asset_movements n where n.asset = m.asset and n.at > m.at and n.movement_code is not null);
revoke all on public.coolerco_movement_com_check from anon, authenticated;
grant select on public.coolerco_movement_com_check to authenticated;

-- COM updates: list, export (mark), done / skip, and edit a rule
create or replace function public.coolerco_com_updates_mark(p_ids uuid[], p_status text, p_batch text default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  if not public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor', 'supplier']) then raise exception 'Not allowed'; end if;
  if p_status not in ('to_send', 'exported', 'done', 'skipped') then raise exception 'Unknown status %', p_status; end if;
  update public.coolerco_com_updates set status = p_status,
         exported_at = case when p_status = 'exported' then now() else exported_at end,
         export_batch = case when p_status = 'exported' then coalesce(p_batch, export_batch) else export_batch end,
         done_at = case when p_status = 'done' then now() else done_at end
   where id = any (p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.coolerco_com_updates_mark(uuid[], text, text) from public, anon;
grant execute on function public.coolerco_com_updates_mark(uuid[], text, text) to authenticated;

create or replace function public.coolerco_case_rule_save(p_id uuid, p_notification text, p_case_status text, p_active boolean, p_note text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.coolerco_has_role(array['system_admin', 'administrator']) then raise exception 'Only an administrator can change the rules'; end if;
  update public.coolerco_case_rules set notification = nullif(trim(p_notification), ''), case_status = nullif(trim(p_case_status), ''),
         active = p_active, note = nullif(trim(p_note), ''), updated_at = now(), updated_by = auth.uid()
   where id = p_id;
end $$;
revoke all on function public.coolerco_case_rule_save(uuid, text, text, boolean, text) from public, anon;
grant execute on function public.coolerco_case_rule_save(uuid, text, text, boolean, text) to authenticated;

select (select count(*) from public.coolerco_movement_types) movement_types, (select count(*) from public.coolerco_case_rules) rules;
