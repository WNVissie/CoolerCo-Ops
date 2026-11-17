-- CoolerCo-Ops · 039 · RUN ON TEST after 038 — COM import file = COM's own columns + asset on the notification + routing into COM
-- Wanda 17 Nov (UAT Case Notification export): a Case Notification row can carry the asset itself —
--   Asset Reference + Asset Reference Type (Global Code / Serial number / Barcode / External Code) + Case Asset Bucket
--   (Asset Delivered / Removed / Repaired), and a second one (Asset Reference 2 …) for a Replacement. So a closure sets the
--   asset on the case in the same row — no separate case re-import. Routing = notification ROUTE TO INFORMATION (550119) +
--   Routed To Portal User (= the RouteIQ name, e.g. RTMAGTD2 — the same names COM shows in "Portal User Router To").
-- Also: movements are stamped with the exact clock time (two movements in one go — In Transit then To be Repaired — kept
--   their order; found in the 038 check on TEST).
-- Additive; coolerco_ only. Rollback: coolerco_039_rollback.sql (puts 038's functions back)

alter table public.coolerco_com_updates add column if not exists asset_ref       text;
alter table public.coolerco_com_updates add column if not exists asset_ref_type  text;
alter table public.coolerco_com_updates add column if not exists asset_bucket    text;
alter table public.coolerco_com_updates add column if not exists asset_ref2      text;
alter table public.coolerco_com_updates add column if not exists asset_ref2_type text;
alter table public.coolerco_com_updates add column if not exists asset_bucket2   text;
alter table public.coolerco_com_updates add column if not exists routed_to       text;
alter table public.coolerco_com_updates add column if not exists route_number    text;

-- which assets each step must show COM
alter table public.coolerco_case_rules add column if not exists com_asset_roles text[];
update public.coolerco_case_rules set com_asset_roles = case
    when case_type = 'Deliver an Asset' and event in ('picked', 'completed') then array['delivered']
    when case_type = 'Replacement of Asset' and event = 'picked' then array['delivered']
    when case_type = 'Replacement of Asset' and event = 'completed' then array['delivered', 'removed']
    when case_type = 'Removal of Asset' and event = 'completed' then array['removed']
    when case_type in ('Repair at Shopper POS', 'Repair at Workshop', 'Decal @WH') and event in ('completed', 'repair_failed', 'to_brand') then array['repaired']
  end
 where com_asset_roles is null;

-- routing into COM (only sent when you press 🗺 Route in COM)
insert into public.coolerco_case_rules (client_code, case_type, event, notification, notification_code, note)
select '*', t, 'routed', 'ROUTE TO INFORMATION', '550119', 'routing into COM: Routed To Portal User = the route''s RouteIQ name'
  from unnest(array['Deliver an Asset','Removal of Asset','Replacement of Asset','Repair at Shopper POS','Repair at Workshop','Decal @WH']) t
on conflict (client_code, case_type, event) do nothing;

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
         from_kind, from_code, to_kind, to_code, status_before, status_after, how, expected, source, source_id, reverses, by_label, at)
  values (p_asset, v_bar, v_mv, p_code, p_case ->> 'warehouse_workshop', p_case ->> 'case_number', p_case ->> 'case_type', p_case ->> 'client_code', p_role,
          n.kind, n.code, coalesce(t.to_kind, n.kind), coalesce(v_to_code, n.code), n.status, coalesce(p_status, t.status_after),
          'system', p_expected, p_source, p_source_id, p_reverses, 'CoolerCo rules', clock_timestamp())
  on conflict (source_id, asset, movement_code) where source_id is not null do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.coolerco_reverse_case_movements(p_case text, p_only_loaded boolean, p_source text, p_source_id uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare m record; v_n int := 0;
begin
  for m in select * from public.coolerco_asset_movements
            where case_number = p_case and not reversed and movement not in ('reverse', 'unreserve', 'unpick', 'audit')
              and (not p_only_loaded or movement in ('pick', 'load', 'reserve'))
            order by at desc loop
    insert into public.coolerco_asset_movements (asset, bar_code, movement, movement_code, warehouse, case_number, case_type, client_code, asset_role,
           from_kind, from_code, to_kind, to_code, status_before, status_after, how, expected, source, source_id, reverses, by_label, at)
    values (m.asset, m.bar_code, case when p_only_loaded then 'return' else 'reverse' end, case when p_only_loaded then 'CC-RETURN' else 'CC-REVERSE' end,
            m.warehouse, p_case, m.case_type, m.client_code, m.asset_role, m.to_kind, m.to_code, m.from_kind, m.from_code,
            m.status_after, m.status_before, 'system', m.expected, p_source, null, m.id, 'CoolerCo rules', clock_timestamp());
    update public.coolerco_asset_movements set reversed = true where id = m.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.coolerco_case_apply_event(p_case text, p_event text, p_source text default 'engine', p_source_id uuid default null,
       p_assets jsonb default '{}', p_at timestamptz default null, p_notes text default null,
       p_lat double precision default null, p_lng double precision default null, p_approved boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k record; c jsonb; r public.coolerco_case_rules; v_master text; v_coolerco boolean; m jsonb; v_asset text; v_role text;
  v_out jsonb := '{}'; v_moves int := 0; v_refs jsonb := '[]'; v_role2 text; v_ast text; v_follow text; v_wh text; v_closed boolean; v_at timestamptz := coalesce(p_at, now());
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
    -- the asset(s) COM must see on this step (Case Asset Bucket + Asset Reference, global code AST-…)
    foreach v_role2 in array coalesce(r.com_asset_roles, '{}') loop
      v_ast := coalesce(p_assets ->> v_role2, case v_role2 when 'delivered' then k.asset_delivered when 'removed' then k.asset_removed
                                                            when 'repaired' then coalesce(k.asset_repaired, k.mapped_asset) end);
      if v_ast is not null and v_ast !~ '^AST' then
        select name into v_ast from public.assets_live where v_ast in (bar_code, local_code, serial_number, sap_number) limit 1;
      end if;
      if v_ast is not null then
        v_refs := v_refs || jsonb_build_object('ref', v_ast, 'bucket', case v_role2 when 'delivered' then 'Asset Delivered' when 'removed' then 'Asset Removed' else 'Asset Repaired' end);
      end if;
    end loop;
    insert into public.coolerco_com_updates (case_number, case_type, client_code, event, notification, notification_code, service_at, notes,
           latitude, longitude, warehouse, source, source_id, asset_ref, asset_ref_type, asset_bucket, asset_ref2, asset_ref2_type, asset_bucket2,
           routed_to, route_number)
    values (coalesce(k.com_case_number, p_case), k.case_type, k.client_code, p_event, r.notification, r.notification_code, v_at, p_notes,
            p_lat, p_lng, k.warehouse_workshop, p_source, p_source_id,
            v_refs -> 0 ->> 'ref', case when v_refs -> 0 is not null then 'Global Code' end, v_refs -> 0 ->> 'bucket',
            v_refs -> 1 ->> 'ref', case when v_refs -> 1 is not null then 'Global Code' end, v_refs -> 1 ->> 'bucket',
            p_assets ->> 'routed_to', p_assets ->> 'route_number')
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

-- 🗺 Route in COM: one ROUTE TO INFORMATION per stop of the finalised routes of a day (COM cases only)
create or replace function public.coolerco_com_route_updates(p_date date, p_warehouse text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s record; v jsonb; v_n int := 0; v_skip int := 0;
begin
  if not public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor', 'supplier']) then raise exception 'Not allowed'; end if;
  for s in select st.case_number, r.route_number, r.resource_username, r.id route_id,
                  coalesce(st.planned_arrival_at, (r.route_date + time '08:00') at time zone 'Africa/Johannesburg') at_time
             from public.routing_routes r
             join public.routing_route_versions rv on rv.route_id = r.id and rv.is_current
             join public.routing_route_stops st on st.route_version_id = rv.id
            where r.route_date = p_date and r.status in ('finalised', 'dispatched', 'partially_completed', 'completed')
              and (p_warehouse is null or r.warehouse_group = public.coolerco_wh_group(p_warehouse))
              and st.outcome_status <> 'removed' and r.resource_username is not null
            order by r.route_number, st.stop_sequence
  loop
    v := public.coolerco_case_apply_event(s.case_number, 'routed', 'route', null,
           jsonb_build_object('route_id', s.route_id, 'routed_to', s.resource_username, 'route_number', left(s.route_number, 25)), s.at_time,
           'Routed on ' || s.route_number);
    if v ? 'com_update' then v_n := v_n + 1; else v_skip := v_skip + 1; end if;
  end loop;
  return jsonb_build_object('queued', v_n, 'skipped', v_skip);
end $$;
revoke all on function public.coolerco_com_route_updates(date, text) from public, anon;
grant execute on function public.coolerco_com_route_updates(date, text) to authenticated;

select count(*) filter (where com_asset_roles is not null) rules_with_assets, count(*) filter (where event = 'routed') routing_rules from public.coolerco_case_rules;
