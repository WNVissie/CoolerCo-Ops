-- CoolerCo-Ops 063 - COM uploads (Magnum) from CoolerCo, on COM's own templates. TEST first.
-- Wanda 27 Nov 2026 (after the 26 Nov COM UAT tests):
--   * COM portal username per field slot and per office user; default logistics + workshop user per warehouse
--     (warehouse com_portal_user stays the office fallback). Every queued COM step records who notified it.
--   * Four uploads: Routing (WPT) / Routing + picking (case update + ASSET PICKED) / Daily / Workshop (repairs, then SERVICE COMPLETE).
--     COM's import does not keep order -> one step per case per file; the next step waits until the earlier one is Done in COM.
--   * Route finalised -> WITHIN PROPOSED TIME for Magnum cases only. On TEST only CoolerCo test routes count, because the
--     08:30 / 19:30 copy from production rewrites the routing tables there.
--   * Routing (Portal User Router To) is a per-client switch: once Magnum approves the CoolerCo Field app, switch it off.
-- Add-only: new columns / tables / functions with the coolerco_ prefix. Triggers on routing tables never block a save.
-- Plain ASCII on purpose (the SQL editor choked on emoji in 039). Rollback: coolerco_063_rollback.sql

-- 1. Who notifies in COM -------------------------------------------------------------------------------------------
alter table public.coolerco_field_slots add column if not exists com_portal_user text;
comment on column public.coolerco_field_slots.com_portal_user is 'COM portal username of this driver / technician slot (empty = the RouteIQ name)';

alter table public.coolerco_warehouse_settings add column if not exists com_logistics_user text;
alter table public.coolerco_warehouse_settings add column if not exists com_workshop_user text;
comment on column public.coolerco_warehouse_settings.com_logistics_user is 'Default COM portal user for logistics steps (WPT, picking) when no person is known';
comment on column public.coolerco_warehouse_settings.com_workshop_user is 'Default COM portal user for workshop steps (Repair at Workshop, Decal @WH)';
update public.coolerco_warehouse_settings set com_logistics_user = com_portal_user where com_logistics_user is null and com_portal_user is not null;
-- PE as used in the 26 Nov COM UAT tests: picking by RTMAWHPE, workshop steps by RTMAPEWS1 (other warehouses: set on the screen)
update public.coolerco_warehouse_settings set com_logistics_user = 'RTMAWHPE' where warehouse_code = 'PE' and com_logistics_user = 'PortalPE';
update public.coolerco_warehouse_settings set com_workshop_user = 'RTMAPEWS1' where warehouse_code = 'PE' and com_workshop_user is null;
-- demo warehouses sit in the same buildings as RTMA Gauteng / Durban
update public.coolerco_warehouse_settings set com_portal_user = 'RTMAWH2Gauteng' where warehouse_code = 'WH-DM-JHB' and com_portal_user is null;
update public.coolerco_warehouse_settings set com_portal_user = 'RTMAWHDBN' where warehouse_code = 'WH-DM-DBN' and com_portal_user is null;

create table if not exists public.coolerco_user_com_portal (
  user_id uuid primary key,
  com_portal_user text not null,
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.coolerco_user_com_portal enable row level security;
revoke all on public.coolerco_user_com_portal from anon, authenticated;   -- functions only

alter table public.coolerco_clients add column if not exists com_send_routing boolean not null default true;
comment on column public.coolerco_clients.com_send_routing is 'Send Portal User Router To / Routed On to COM (off once the client approves the CoolerCo Field app)';

alter table public.coolerco_com_updates add column if not exists notified_by_portal_user text;
alter table public.coolerco_com_updates add column if not exists created_by uuid;
alter table public.coolerco_com_updates alter column created_by set default auth.uid();
-- the case update (Router To + Routed On + Asset Delivered) travels with the ASSET PICKED line but has its own state:
-- COM refuses ASSET PICKED until the asset is on the case (26 Nov), so ASSET PICKED waits until the case update is Done
alter table public.coolerco_com_updates add column if not exists case_update_status text check (case_update_status in ('exported', 'done'));
alter table public.coolerco_com_updates add column if not exists case_update_batch text;
alter table public.coolerco_com_updates add column if not exists case_update_at timestamptz;

create or replace function public.coolerco_is_workshop_case(p_type text)
returns boolean language sql immutable as $$
  select coalesce(p_type, '') in ('Repair at Workshop', 'Decal @WH', 'Scrap an Asset')
$$;

-- the COM portal user for a step: the person (slot / office user) first, else the warehouse default
create or replace function public.coolerco_com_user_for(p_user uuid, p_case_type text, p_warehouse text, p_routed_to text default null)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v text; w public.coolerco_warehouse_settings;
begin
  if p_user is not null then
    select coalesce(nullif(s.com_portal_user, ''), s.routeiq_username) into v from public.coolerco_field_slots s where s.user_id = p_user and s.active limit 1;
    if v is null then select com_portal_user into v from public.coolerco_user_com_portal where user_id = p_user; end if;
  end if;
  if v is null and p_routed_to is not null then
    select coalesce(nullif(s.com_portal_user, ''), s.routeiq_username) into v from public.coolerco_field_slots s where upper(s.routeiq_username) = upper(p_routed_to) limit 1;
  end if;
  if v is null then
    select * into w from public.coolerco_warehouse_settings
     where com_name = p_warehouse or warehouse_code = p_warehouse or com_name = regexp_replace(coalesce(p_warehouse, ''), ' (WH|WS)$', '') limit 1;
    v := case when public.coolerco_is_workshop_case(p_case_type) then coalesce(w.com_workshop_user, w.com_portal_user)
              else coalesce(w.com_logistics_user, w.com_portal_user) end;
  end if;
  return v;
end $$;
revoke all on function public.coolerco_com_user_for(uuid, text, text, text) from public, anon;
grant execute on function public.coolerco_com_user_for(uuid, text, text, text) to authenticated;

-- every new queue line gets its notifier (job card / stop event -> the field person who did it)
create or replace function public.coolerco_com_updates_fill()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := new.created_by;
begin
  begin
    if v_user is null and new.source = 'job_card' then select created_by into v_user from public.coolerco_field_job_cards where id = new.source_id; end if;
    if v_user is null and new.source = 'stop_event' then select created_by into v_user from public.coolerco_field_stop_events where id = new.source_id; end if;
    new.created_by := v_user;
    if new.notified_by_portal_user is null then
      new.notified_by_portal_user := public.coolerco_com_user_for(
        case when new.source in ('route', 'workshop') then null else v_user end, new.case_type, new.warehouse,
        case when new.source in ('job_card', 'stop_event') then new.routed_to end);
    end if;
  exception when others then
    insert into public.coolerco_engine_log (case_number, event, source, result)
    values (new.case_number, 'com_user', 'trigger', jsonb_build_object('error', sqlerrm));
  end;
  return new;
end $$;
drop trigger if exists coolerco_com_updates_fill on public.coolerco_com_updates;
create trigger coolerco_com_updates_fill before insert on public.coolerco_com_updates
  for each row execute function public.coolerco_com_updates_fill();

update public.coolerco_com_updates u set notified_by_portal_user = public.coolerco_com_user_for(null, u.case_type, u.warehouse, null)
 where notified_by_portal_user is null;

-- 2. Case repairs for COM (Case Repair template). Repairs must be on the case before SERVICE COMPLETE. -------------
create table if not exists public.coolerco_com_case_repairs (
  id uuid primary key default gen_random_uuid(),
  case_number text not null,
  case_type text,
  client_code text default 'MAGNUM',
  warehouse text,
  fault_code text,
  fault_name text,
  repair_code text,
  repair_name text,
  quantity numeric not null default 1,
  notes text,
  asset_ref text,
  source text not null default 'office',
  source_id uuid,
  status text not null default 'to_send' check (status in ('to_send', 'exported', 'done', 'skipped')),
  notified_by_portal_user text,
  export_batch text,
  exported_at timestamptz,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists idx_cc_com_repairs_case on public.coolerco_com_case_repairs (case_number, status);
alter table public.coolerco_com_case_repairs enable row level security;
revoke all on public.coolerco_com_case_repairs from anon, authenticated;
grant select on public.coolerco_com_case_repairs to authenticated;
drop policy if exists coolerco_com_case_repairs_read on public.coolerco_com_case_repairs;
create policy coolerco_com_case_repairs_read on public.coolerco_com_case_repairs for select to authenticated
  using (public.coolerco_can_see(client_code, warehouse) or (coalesce(client_code, 'MAGNUM') = 'MAGNUM' and public.coolerco_can_see_magnum()));

-- a completed repair job card on a COM (Magnum) case -> one repair line with the technician's words (edit the code on the export screen)
create or replace function public.coolerco_job_card_com_repair()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare k record;
begin
  begin
    if coalesce(new.repair_details, '') = '' or coalesce(new.service_result, 'service_completed') <> 'service_completed'
       or new.case_type not in ('Repair at Workshop', 'Repair at Shopper POS') then return new; end if;
    select case_number, case_type, warehouse_workshop, asset_repaired, mapped_asset into k from public.cases where case_number = new.case_number;
    if k.case_number is null then return new; end if;   -- COM cases only
    insert into public.coolerco_com_case_repairs (case_number, case_type, warehouse, repair_name, quantity, notes, asset_ref, source, source_id, created_by, notified_by_portal_user)
    values (new.case_number, k.case_type, k.warehouse_workshop, left(new.repair_details, 200), 1, new.repair_details, coalesce(k.asset_repaired, k.mapped_asset),
            'job_card', new.id, new.created_by, public.coolerco_com_user_for(new.created_by, k.case_type, k.warehouse_workshop, new.driver_username));
  exception when others then
    insert into public.coolerco_engine_log (case_number, event, source, result) values (new.case_number, 'com_repair', 'job_card', jsonb_build_object('error', sqlerrm));
  end;
  return new;
end $$;
drop trigger if exists coolerco_job_card_com_repair on public.coolerco_field_job_cards;
create trigger coolerco_job_card_com_repair after insert on public.coolerco_field_job_cards
  for each row execute function public.coolerco_job_card_com_repair();

create or replace function public.coolerco_com_repair_save(p_id uuid, p_case text, p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := p_id; k record;
begin
  if not public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor', 'supplier']) then raise exception 'Not allowed'; end if;
  if v_id is null then
    select case_number, case_type, warehouse_workshop, asset_repaired, mapped_asset into k from public.cases where case_number = p_case;
    if k.case_number is null then raise exception 'Case % is not a COM case', p_case; end if;
    insert into public.coolerco_com_case_repairs (case_number, case_type, warehouse, asset_ref, source, notified_by_portal_user)
    values (k.case_number, k.case_type, k.warehouse_workshop, coalesce(k.asset_repaired, k.mapped_asset), 'office',
            public.coolerco_com_user_for(auth.uid(), k.case_type, k.warehouse_workshop, null))
    returning id into v_id;
  end if;
  update public.coolerco_com_case_repairs set
         fault_code = coalesce(p ->> 'fault_code', fault_code), fault_name = coalesce(p ->> 'fault_name', fault_name),
         repair_code = coalesce(p ->> 'repair_code', repair_code), repair_name = coalesce(p ->> 'repair_name', repair_name),
         quantity = coalesce((p ->> 'quantity')::numeric, quantity), notes = coalesce(p ->> 'notes', notes),
         notified_by_portal_user = coalesce(nullif(p ->> 'notified_by_portal_user', ''), notified_by_portal_user)
   where id = v_id and status = 'to_send';
  return v_id;
end $$;
revoke all on function public.coolerco_com_repair_save(uuid, text, jsonb) from public, anon;
grant execute on function public.coolerco_com_repair_save(uuid, text, jsonb) to authenticated;

create or replace function public.coolerco_com_repairs_mark(p_ids uuid[], p_status text, p_batch text default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  if not public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor', 'supplier']) then raise exception 'Not allowed'; end if;
  if p_status not in ('to_send', 'exported', 'done', 'skipped') then raise exception 'Unknown status %', p_status; end if;
  update public.coolerco_com_case_repairs set status = p_status,
         exported_at = case when p_status = 'exported' then now() else exported_at end,
         export_batch = case when p_status = 'exported' then coalesce(p_batch, export_batch) else export_batch end,
         done_at = case when p_status = 'done' then now() else done_at end
   where id = any (p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.coolerco_com_repairs_mark(uuid[], text, text) from public, anon;
grant execute on function public.coolerco_com_repairs_mark(uuid[], text, text) to authenticated;

-- 3. What goes in each upload, and what waits ------------------------------------------------------------------------
-- p_kind: routing | routing_picking | daily | workshop
-- file:   notification (Case Notification template) | case_update (Case update view template) | repair (Case Repair template)
create or replace function public.coolerco_com_step_rank(p_n text)
returns int language sql immutable as $$
  select case when p_n = 'WITHIN PROPOSED TIME' then 10 when p_n = 'ROUTE TO INFORMATION' then 12
              when p_n ~ '(PICKED|ARRIVED|STARTED|DELAYED)' then 20
              when p_n ~ '^(SERVICE COMPLETE|TO REPAIR|TO BRAND OR DECAL|TO SCRAP)$' then 200 else 100 end
$$;

create or replace function public.coolerco_com_export_rows(p_kind text, p_warehouse text default null)
returns table (id uuid, file text, case_number text, case_type text, notification text, notification_code text, service_at timestamptz,
               notes text, latitude double precision, longitude double precision, warehouse text, source text,
               asset_ref text, asset_ref_type text, asset_bucket text, asset_ref2 text, asset_ref2_type text, asset_bucket2 text,
               routed_to text, route_number text, notified_by_portal_user text, com_status text,
               fault_code text, fault_name text, repair_code text, repair_name text, quantity numeric,
               ready boolean, hold_reason text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_wh text := case when p_warehouse is null or p_warehouse = '' then null
                          else coalesce((select com_name from public.coolerco_warehouse_settings where warehouse_code = p_warehouse), p_warehouse) end;
begin
  if not public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor', 'supplier']) then raise exception 'Not allowed'; end if;
  if p_kind not in ('routing', 'routing_picking', 'daily', 'workshop') then raise exception 'Unknown upload %', p_kind; end if;
  return query
  with q as (
    select u.*, 'notification'::text f from public.coolerco_com_updates u
     where u.status = 'to_send' and coalesce(u.client_code, 'MAGNUM') = 'MAGNUM'
       and (v_wh is null or u.warehouse = v_wh)
       and u.notification <> 'ROUTE TO INFORMATION'
       and case p_kind
             when 'routing' then u.notification = 'WITHIN PROPOSED TIME' and not public.coolerco_is_workshop_case(u.case_type)
             when 'routing_picking' then u.notification ~ '^ASSET PICKED' and not public.coolerco_is_workshop_case(u.case_type)
             when 'daily' then u.notification <> 'WITHIN PROPOSED TIME' and u.notification !~ '^ASSET PICKED' and not public.coolerco_is_workshop_case(u.case_type)
             else public.coolerco_is_workshop_case(u.case_type) end
    union all
    -- case update ("CoolerCo - Picking update" view): Asset Delivered from the pick + Portal User Router To / Routed On
    -- (routing only while the client's switch is on). The screen merges the lines of one case into one row.
    select u.*, 'case_update' from public.coolerco_com_updates u
     where p_kind = 'routing_picking' and u.status = 'to_send'
       and coalesce(u.client_code, 'MAGNUM') = 'MAGNUM' and (v_wh is null or u.warehouse = v_wh)
       and not public.coolerco_is_workshop_case(u.case_type)
       and ((u.notification ~ '^ASSET PICKED' and u.case_update_status is null)
            or (u.notification = 'ROUTE TO INFORMATION'
                and coalesce((select c.com_send_routing from public.coolerco_clients c where c.code = 'MAGNUM'), true)))
  ),
  base as (
    select q.*, cs.status_reason com_status,
           exists (select 1 from public.coolerco_com_updates x where x.case_number = q.case_number and (x.status = 'exported' or x.case_update_status = 'exported')) case_waiting,
           exists (select 1 from public.coolerco_com_updates x where x.case_number = q.case_number and x.notification ~ '^ASSET PICKED' and x.status = 'to_send' and x.case_update_status is null) pick_waiting,
           exists (select 1 from public.coolerco_com_updates x where x.case_number = q.case_number and x.notification ~ '^ASSET PICKED' and x.status = 'done') pick_done,
           exists (select 1 from public.coolerco_com_case_repairs x where x.case_number = q.case_number and x.status = 'exported') rep_waiting,
           exists (select 1 from public.coolerco_com_updates x where x.case_number = q.case_number and x.notification = 'WITHIN PROPOSED TIME' and x.status = 'done') wpt_done,
           exists (select 1 from public.coolerco_com_updates x where x.case_number = q.case_number and x.notification = 'WITHIN PROPOSED TIME' and x.status in ('to_send', 'exported')) wpt_open,
           exists (select 1 from public.coolerco_com_case_repairs x where x.case_number = q.case_number and x.status = 'done') rep_done,
           exists (select 1 from public.coolerco_com_case_repairs x where x.case_number = q.case_number and x.status in ('to_send', 'exported')) rep_open
      from q left join public.cases cs on cs.case_number = q.case_number
  ),
  judged as (
    select b.*,
      case
        when b.case_waiting or b.rep_waiting then 'waits for the exported step to be Done in COM'
        when b.notification <> 'WITHIN PROPOSED TIME' and not b.wpt_done and (b.wpt_open or coalesce(b.com_status, '') not in ('In Service'))
             then 'waits for WITHIN PROPOSED TIME to be Done in COM'
        when b.com_status in ('Solved', 'Not Solved', 'Canceled', 'Cancelled') then 'case already ' || b.com_status || ' in COM'
        when b.f = 'case_update' and b.notification = 'ROUTE TO INFORMATION' and not b.pick_waiting then 'waits for the picking - Router To goes to COM together with the picked asset'
        when b.f = 'notification' and b.notification ~ '^ASSET PICKED' and coalesce(b.case_update_status, '') <> 'done'
             then 'waits for the case update (Router To + Asset Delivered) to be Done in COM - COM refuses ASSET PICKED before the asset is on the case'
        when b.f = 'notification' and b.case_type in ('Deliver an Asset', 'Replacement of Asset') and b.notification in ('SERVICE COMPLETE', 'TO REPAIR') and not b.pick_done
             then 'waits for ASSET PICKED to be Done in COM'
        when b.com_status in ('Error', 'Further Action Required', 'Action Required', 'Waiting') then 'COM case is ' || b.com_status || ' - only Magnum can action it'
        when b.notification = 'SERVICE COMPLETE' and b.case_type in ('Repair at Workshop', 'Repair at Shopper POS') and b.rep_open then 'the repairs go first (Case Repair file)'
        when b.notification = 'SERVICE COMPLETE' and b.case_type in ('Repair at Workshop', 'Repair at Shopper POS') and not b.rep_done then 'add the repair first - COM needs repairs before SERVICE COMPLETE'
      end hold
      from base b
  ),
  firsts as (   -- one notification per case per file: the earliest step in COM's process order
    select j.*, row_number() over (partition by j.case_number, j.f order by (j.hold is not null), public.coolerco_com_step_rank(j.notification), j.service_at) rn
      from judged j
  )
  select f.id, f.f, f.case_number, f.case_type, f.notification, f.notification_code, f.service_at, f.notes, f.latitude, f.longitude, f.warehouse, f.source,
         coalesce(f.asset_ref, case when f.f = 'case_update' then (select p.asset_ref from public.coolerco_com_updates p where p.case_number = f.case_number and p.notification ~ '^ASSET PICKED' and p.status <> 'skipped' order by p.created_at desc limit 1) end),
         f.asset_ref_type, f.asset_bucket, f.asset_ref2, f.asset_ref2_type, f.asset_bucket2, f.routed_to, f.route_number, f.notified_by_portal_user, f.com_status,
         null::text, null::text, null::text, null::text, null::numeric,
         f.hold is null and (f.rn = 1 or f.f = 'case_update'),
         coalesce(f.hold, case when f.rn > 1 and f.f <> 'case_update' then 'waits for the earlier step of this case' end)
    from firsts f
  union all
  select r.id, 'repair', r.case_number, r.case_type, 'CASE REPAIR', null, r.created_at, r.notes, null, null, r.warehouse, r.source,
         r.asset_ref, 'Global Code', 'Asset Repaired', null, null, null, null, null, r.notified_by_portal_user, cs.status_reason,
         r.fault_code, r.fault_name, r.repair_code, r.repair_name, r.quantity,
         h.hold is null,
         h.hold
    from public.coolerco_com_case_repairs r
    left join public.cases cs on cs.case_number = r.case_number
    cross join lateral (select case
        when exists (select 1 from public.coolerco_com_updates x where x.case_number = r.case_number and x.status = 'exported') then 'waits for the exported step to be Done in COM'
        when coalesce(cs.status_reason, '') not in ('In Service', 'In Progress') then 'COM case is ' || coalesce(cs.status_reason, 'not found') || ' - repairs go on In Progress / In Service cases'
        when coalesce(r.repair_code, '') = '' and coalesce(r.repair_name, '') = '' then 'choose the repair'
      end hold) h
   where p_kind in ('workshop', 'daily') and r.status = 'to_send' and coalesce(r.client_code, 'MAGNUM') = 'MAGNUM'
     and (v_wh is null or r.warehouse = v_wh)
     and (p_kind = 'workshop') = public.coolerco_is_workshop_case(r.case_type)
   order by 3, 2;
end $$;
revoke all on function public.coolerco_com_export_rows(text, text) from public, anon;
grant execute on function public.coolerco_com_export_rows(text, text) to authenticated;

-- case update file exported / done in COM (per case): the picked line's case update state + the routing line's status
create or replace function public.coolerco_com_case_update_mark(p_cases text[], p_status text, p_batch text default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  if not public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor', 'supplier']) then raise exception 'Not allowed'; end if;
  if p_status not in ('exported', 'done', 'to_send') then raise exception 'Unknown status %', p_status; end if;
  update public.coolerco_com_updates
     set case_update_status = case when p_status = 'to_send' then null else p_status end,
         case_update_batch = case when p_status = 'exported' then coalesce(p_batch, case_update_batch) else case_update_batch end,
         case_update_at = now()
   where case_number = any (p_cases) and notification ~ '^ASSET PICKED' and status = 'to_send'
     and (p_status <> 'done' or case_update_status = 'exported');
  get diagnostics v_n = row_count;
  update public.coolerco_com_updates
     set status = p_status,
         exported_at = case when p_status = 'exported' then now() else exported_at end,
         export_batch = case when p_status = 'exported' then coalesce(p_batch, export_batch) else export_batch end,
         done_at = case when p_status = 'done' then now() else done_at end
   where case_number = any (p_cases) and notification = 'ROUTE TO INFORMATION' and status in ('to_send', 'exported');
  return v_n;
end $$;
revoke all on function public.coolerco_com_case_update_mark(text[], text, text) from public, anon;
grant execute on function public.coolerco_com_case_update_mark(text[], text, text) to authenticated;

create or replace function public.coolerco_com_case_updates_open()
returns table (case_number text, case_type text, asset_ref text, routed_to text, batch text, at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.case_number, u.case_type, u.asset_ref,
         (select r.routed_to from public.coolerco_com_updates r where r.case_number = u.case_number and r.notification = 'ROUTE TO INFORMATION' and r.status <> 'skipped' order by r.created_at desc limit 1),
         u.case_update_batch, u.case_update_at
    from public.coolerco_com_updates u
   where public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor', 'supplier'])
     and u.notification ~ '^ASSET PICKED' and u.case_update_status = 'exported' and u.status = 'to_send'
   order by u.case_update_at
$$;
revoke all on function public.coolerco_com_case_updates_open() from public, anon;
grant execute on function public.coolerco_com_case_updates_open() to authenticated;

-- 4. Route finalised -> WITHIN PROPOSED TIME (Magnum only) -----------------------------------------------------------
insert into public.coolerco_settings (key, value)
select 'com_auto_wpt', 'true'::jsonb where not exists (select 1 from public.coolerco_settings where key = 'com_auto_wpt');

create or replace function public.coolerco_com_wpt_for_route(p_route uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare s record; v jsonb; v_n int := 0; r public.routing_routes;
        v_send boolean := coalesce((select com_send_routing from public.coolerco_clients where code = 'MAGNUM'), true);
begin
  select * into r from public.routing_routes where id = p_route;
  if r.id is null or r.status not in ('finalised', 'dispatched', 'partially_completed', 'completed') then return 0; end if;
  if public.coolerco_is_test_db() and not exists (select 1 from public.coolerco_test_routes t where t.route_id = p_route) then return 0; end if;
  for s in select distinct on (st.case_number) st.case_number
             from public.routing_route_stops st
             join public.routing_route_versions rv on rv.id = st.route_version_id and rv.is_current
             join public.cases c on c.case_number = st.case_number           -- COM (Magnum) cases only
            where st.route_id = p_route and coalesce(st.outcome_status, '') <> 'removed'
              and c.status_reason in ('Open', 'In Progress')
              and not exists (select 1 from public.coolerco_com_updates u where u.case_number = st.case_number and u.notification = 'WITHIN PROPOSED TIME' and u.status <> 'skipped')
  loop
    v := public.coolerco_case_apply_event(s.case_number, 'route_final', 'route', null, jsonb_build_object('route_id', p_route),
           coalesce(r.finalised_at, now()), 'Route ' || r.route_number || ' finalised');
    if v ? 'com_update' then v_n := v_n + 1; end if;
    -- routing for the case update file (Portal User Router To / Routed On), as in the 26 Nov tests (TEST6b), while the switch is on
    if v_send and r.resource_username is not null then
      perform public.coolerco_case_apply_event(s.case_number, 'routed', 'route', null,
        jsonb_build_object('route_id', p_route, 'routed_to', r.resource_username, 'route_number', left(r.route_number, 25)),
        coalesce(r.finalised_at, now()), 'Routed on ' || r.route_number);
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.coolerco_com_wpt_for_route(uuid) from public, anon;
grant execute on function public.coolerco_com_wpt_for_route(uuid) to authenticated;

create or replace function public.coolerco_route_auto_wpt()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_route uuid;
begin
  begin
    if coalesce((select value #>> '{}' from public.coolerco_settings where key = 'com_auto_wpt'), 'true') <> 'true' then return null; end if;
    v_route := case tg_table_name when 'routing_routes' then new.id else new.route_id end;
    if tg_table_name = 'routing_routes' and new.status is not distinct from old.status then return null; end if;
    perform public.coolerco_com_wpt_for_route(v_route);
  exception when others then
    insert into public.coolerco_engine_log (case_number, event, source, result)
    values (null, 'route_final', 'trigger:' || tg_table_name, jsonb_build_object('route', v_route, 'error', sqlerrm));
  end;
  return null;
end $$;
drop trigger if exists coolerco_route_auto_wpt on public.routing_routes;
create trigger coolerco_route_auto_wpt after update of status on public.routing_routes
  for each row execute function public.coolerco_route_auto_wpt();
drop trigger if exists coolerco_route_auto_wpt on public.routing_route_stops;
create trigger coolerco_route_auto_wpt after insert on public.routing_route_stops
  for each row execute function public.coolerco_route_auto_wpt();
drop trigger if exists coolerco_route_auto_wpt on public.coolerco_test_routes;
create trigger coolerco_route_auto_wpt after insert on public.coolerco_test_routes
  for each row execute function public.coolerco_route_auto_wpt();

-- the manual "Find WPT steps" button: Magnum (COM) cases only, and on TEST only test routes
create or replace function public.coolerco_case_route_events(p_from date default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare s record; v_n int := 0; v jsonb;
begin
  for s in select distinct on (st.case_number) st.case_number, r.id route_id
             from public.routing_route_stops st join public.routing_routes r on r.id = st.route_id
             join public.routing_route_versions rv on rv.id = st.route_version_id and rv.is_current
             join public.cases c on c.case_number = st.case_number
            where r.status in ('finalised', 'dispatched', 'partially_completed', 'completed')
              and r.route_date >= coalesce(p_from, (now() at time zone 'Africa/Johannesburg')::date - 3)
              and c.status_reason in ('Open', 'In Progress')
              and (not public.coolerco_is_test_db() or exists (select 1 from public.coolerco_test_routes t where t.route_id = r.id))
              and not exists (select 1 from public.coolerco_com_updates u where u.case_number = st.case_number and u.notification = 'WITHIN PROPOSED TIME' and u.status <> 'skipped')
  loop
    v := public.coolerco_case_apply_event(s.case_number, 'route_final', 'route', null, jsonb_build_object('route_id', s.route_id));
    if v ? 'ok' then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.coolerco_case_route_events(date) from public, anon;
grant execute on function public.coolerco_case_route_events(date) to authenticated;

-- Workshop: COM makes the Repair at Workshop / Decal @WH case (TO REPAIR / TO BRAND); CoolerCo sends its WPT by the workshop user
create or replace function public.coolerco_com_workshop_candidates(p_warehouse text default null)
returns table (case_number text, case_type text, status_reason text, warehouse text, asset text, created_on timestamptz, queued text)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.case_number, c.case_type, c.status_reason, c.warehouse_workshop, coalesce(c.asset_repaired, c.mapped_asset), c.created_on,
         (select string_agg(u.notification || ' (' || u.status || ')', ', ') from public.coolerco_com_updates u where u.case_number = c.case_number and u.status <> 'skipped')
    from public.cases c
   where public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor', 'supplier'])
     and c.case_type in ('Repair at Workshop', 'Decal @WH') and c.status_reason in ('Open', 'In Progress', 'In Service')
     and (p_warehouse is null or p_warehouse = '' or c.warehouse_workshop = coalesce((select com_name from public.coolerco_warehouse_settings where warehouse_code = p_warehouse), p_warehouse))
   order by c.created_on desc nulls last
   limit 500
$$;
revoke all on function public.coolerco_com_workshop_candidates(text) from public, anon;
grant execute on function public.coolerco_com_workshop_candidates(text) to authenticated;

create or replace function public.coolerco_com_workshop_wpt(p_cases text[], p_note text default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare v_case text; v jsonb; v_n int := 0;
begin
  if not public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor', 'supplier']) then raise exception 'Not allowed'; end if;
  foreach v_case in array coalesce(p_cases, '{}') loop
    if exists (select 1 from public.cases where case_number = v_case and status_reason in ('Open', 'In Progress')) then
      v := public.coolerco_case_apply_event(v_case, 'route_final', 'workshop', null, '{}'::jsonb, now(), coalesce(nullif(p_note, ''), 'Received at the workshop'));
      if v ? 'com_update' then v_n := v_n + 1; end if;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.coolerco_com_workshop_wpt(text[], text) from public, anon;
grant execute on function public.coolerco_com_workshop_wpt(text[], text) to authenticated;

-- COM's repair names (from the Case Repair lines the dashboard imports) for the repair picker on the export screen
create or replace function public.coolerco_com_repair_names()
returns table (repair_name text, case_type text, uses bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.repair_name, r.case_type, count(*) from public.case_repairs r
   where public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor', 'supplier']) and coalesce(r.repair_name, '') <> ''
   group by 1, 2 order by 3 desc limit 1000
$$;
revoke all on function public.coolerco_com_repair_names() from public, anon;
grant execute on function public.coolerco_com_repair_names() to authenticated;

-- Repair at Workshop SERVICE COMPLETE moves the cooler to Ready to Work in COM (tested 26 Nov, CAS-161264 / CAS-161265),
-- not to COM type 010's "Waiting for Action". Same in CoolerCo: expected for Magnum (App vs COM), real for Tiger / Demo.
insert into public.coolerco_movement_types (code, name, active, source, from_kind, to_kind, physical, status_after)
select 'CC-RTW', 'Repaired at the workshop - Ready to Work', true, 'CoolerCo', 'Workshop', 'Warehouse', true, 'Ready to Work'
 where not exists (select 1 from public.coolerco_movement_types where code = 'CC-RTW');
update public.coolerco_case_rules set movements = '[{"role": "repaired", "code": "CC-RTW"}]'::jsonb,
       note = coalesce(note || ' · ', '') || '063: cooler to Ready to Work (as COM does)', updated_at = now()
 where client_code = '*' and case_type = 'Repair at Workshop' and event = 'completed' and coalesce(movements, '[]'::jsonb) = '[]'::jsonb;

-- 5. Settings screen: COM users ------------------------------------------------------------------------------------
create or replace function public.coolerco_com_users()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor']) then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'warehouses', (select coalesce(jsonb_agg(jsonb_build_object('code', w.warehouse_code, 'name', w.com_name, 'office', w.com_portal_user,
                        'logistics', w.com_logistics_user, 'workshop', w.com_workshop_user) order by w.warehouse_code), '[]')
                     from public.coolerco_warehouse_settings w),
    'slots', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'warehouse', s.warehouse_code, 'type', s.worker_type, 'slot_no', s.slot_no,
                   'routeiq', s.routeiq_username, 'person', s.person_name, 'com_portal_user', s.com_portal_user, 'has_login', s.user_id is not null, 'active', s.active)
                   order by s.warehouse_code, s.worker_type, s.slot_no), '[]') from public.coolerco_field_slots s),
    'users', (select coalesce(jsonb_agg(jsonb_build_object('user_id', u.id, 'email', u.email, 'com_portal_user', m.com_portal_user,
                   'roles', (select string_agg(distinct a.role_code, ', ') from public.coolerco_user_access a where a.user_id = u.id and a.active),
                   'warehouses', (select string_agg(distinct a.warehouse_code, ', ') from public.coolerco_user_access a where a.user_id = u.id and a.active))
                   order by u.email), '[]')
                from auth.users u left join public.coolerco_user_com_portal m on m.user_id = u.id
               where exists (select 1 from public.coolerco_user_access a where a.user_id = u.id and a.active
                               and a.role_code in ('system_admin', 'administrator', 'manager', 'supervisor', 'supplier'))
                  or m.user_id is not null),
    'send_routing', (select coalesce(com_send_routing, true) from public.coolerco_clients where code = 'MAGNUM'),
    'auto_wpt', coalesce((select value #>> '{}' from public.coolerco_settings where key = 'com_auto_wpt'), 'true') = 'true');
end $$;
revoke all on function public.coolerco_com_users() from public, anon;
grant execute on function public.coolerco_com_users() to authenticated;

-- p_what: slot | user | wh_office | wh_logistics | wh_workshop | send_routing | auto_wpt
create or replace function public.coolerco_com_user_set(p_what text, p_id text, p_value text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v text := nullif(trim(coalesce(p_value, '')), '');
begin
  if not public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor']) then raise exception 'Not allowed'; end if;
  if v is not null and length(v) > 100 then raise exception 'Username too long'; end if;
  case p_what
    when 'slot' then update public.coolerco_field_slots set com_portal_user = v, updated_at = now(), updated_by = auth.uid() where id = p_id::uuid;
    when 'user' then
      if v is null then delete from public.coolerco_user_com_portal where user_id = p_id::uuid;
      else insert into public.coolerco_user_com_portal (user_id, com_portal_user) values (p_id::uuid, v)
           on conflict (user_id) do update set com_portal_user = excluded.com_portal_user, updated_at = now(), updated_by = auth.uid(); end if;
    when 'wh_office' then update public.coolerco_warehouse_settings set com_portal_user = v, updated_at = now() where warehouse_code = p_id;
    when 'wh_logistics' then update public.coolerco_warehouse_settings set com_logistics_user = v, updated_at = now() where warehouse_code = p_id;
    when 'wh_workshop' then update public.coolerco_warehouse_settings set com_workshop_user = v, updated_at = now() where warehouse_code = p_id;
    when 'send_routing' then
      if not public.coolerco_has_role(array['system_admin', 'administrator']) then raise exception 'Only administrators change this'; end if;
      update public.coolerco_clients set com_send_routing = (v = 'true'), updated_at = now() where code = coalesce(p_id, 'MAGNUM');
    when 'auto_wpt' then
      if not public.coolerco_has_role(array['system_admin', 'administrator']) then raise exception 'Only administrators change this'; end if;
      update public.coolerco_settings set value = to_jsonb(coalesce(v, 'false')) where key = 'com_auto_wpt';
    else raise exception 'Unknown setting %', p_what;
  end case;
  return found;
end $$;
revoke all on function public.coolerco_com_user_set(text, text, text) from public, anon;
grant execute on function public.coolerco_com_user_set(text, text, text) to authenticated;

-- 6. COM templates (uploaded once on the export screen; the file is filled in the browser) -------------------------
-- stored in the private bucket coolerco-cases under com-templates/<notification|case_update|repair>.xlsx (staff only)

select (select count(*) from public.coolerco_warehouse_settings where com_logistics_user is not null) warehouses_with_logistics_user,
       (select count(*) from public.coolerco_com_updates where notified_by_portal_user is not null) queue_lines_with_notifier;
