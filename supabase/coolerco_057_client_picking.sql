-- 057 · Picking for self-managed clients (Tiger, Demo, Demo Foods …) — Wanda 2026-11-25: "Picking first"
-- Magnum picking stays as it is (RouteIQ's warehouse preparation + COM stock). For clients where CoolerCo is the master,
-- the stock is CoolerCo's own register (coolerco_assets), so picking happens here:
--   board      = Deliver / Replacement stops of that day's routes (RouteIQ or 🧪 test routes) whose case is a CoolerCo case
--                of a self-managed client, with the requested model and the cooler picked so far
--   candidates = the client's coolers in the case's warehouse, Ready to Work, not picked / not on another open case;
--                same model first (requested model = the case's requested_product_base = model description or display name)
--   pick       = one cooler per case: written on the case (asset_delivered), status "Picked" on the register,
--                and a 'pick' movement in the ledger (CC-PICK); a different model needs a reason
--   undo       = releases the cooler (back to Ready to Work, 'unpick' movement, case asset_delivered cleared)
-- The Field app shows the picked cooler on the stop (coolerco_client_picks_for_routes).
-- Add-only. Rollback: coolerco_057_rollback.sql.

create table if not exists public.coolerco_client_picks (
  id            uuid primary key default gen_random_uuid(),
  client_code   text not null,
  route_id      uuid,
  stop_id       uuid,
  case_number   text not null,
  asset_number  text not null,
  warehouse_code text,
  model_match   boolean not null default true,
  reason        text,
  how           text not null default 'screen' check (how in ('screen', 'camera', 'scanner', 'typed')),
  picked_by     text not null default coalesce(auth.jwt() ->> 'email', 'user'),
  picked_at     timestamptz not null default now(),
  status_before text,
  released_at   timestamptz,
  released_by   text,
  release_reason text
);
create unique index if not exists ux_coolerco_client_picks_case  on public.coolerco_client_picks (case_number)  where released_at is null;
create unique index if not exists ux_coolerco_client_picks_asset on public.coolerco_client_picks (client_code, asset_number) where released_at is null;
create index if not exists idx_coolerco_client_picks_route on public.coolerco_client_picks (route_id);
alter table public.coolerco_client_picks enable row level security;
revoke all on public.coolerco_client_picks from anon, authenticated;
grant select on public.coolerco_client_picks to authenticated;
drop policy if exists coolerco_client_picks_read on public.coolerco_client_picks;
create policy coolerco_client_picks_read on public.coolerco_client_picks for select to authenticated
  using (public.coolerco_can_see(client_code, warehouse_code));

-- who may pick: warehouse staff + office roles
create or replace function public.coolerco_can_pick()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.coolerco_is_planner()
      or public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier', 'supervisor', 'stock_controller', 'warehouse_assistant'])
$$;

-- does a register cooler match the requested model? (requested_product_base holds the model description / display name)
create or replace function public.coolerco_model_matches(p_client text, p_model_code text, p_requested text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_requested is null or exists (select 1 from public.coolerco_asset_models m
     where m.client_code = p_client and m.model_code = p_model_code
       and lower(trim(p_requested)) in (lower(trim(m.description)), lower(trim(coalesce(m.display_name, ''))), lower(trim(m.model_code))))
$$;

-- the board: one line per Deliver / Replacement stop of a self-managed client's case on routes of that day
create or replace function public.coolerco_client_pick_board(p_date date, p_warehouse text default null)
returns table (route_id uuid, route_number text, route_status text, driver text, stop_id uuid, stop_sequence int,
               case_number text, client_code text, case_type text, case_status text, point_of_sale text, pos_local_code text,
               warehouse_code text, requested_model text, requested_condition text, asset_removed text,
               picked_asset text, picked_model text, picked_condition text, picked_by text, picked_at timestamptz, model_match boolean,
               ready_same_model int, ready_any int)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id, r.route_number, r.status, r.resource_display_name, s.id, s.stop_sequence,
         k.case_number, k.client_code, k.case_type, k.status_reason, k.point_of_sale, k.pos_local_code,
         k.warehouse_code, k.requested_product_base, k.requested_asset_condition, k.asset_removed,
         p.asset_number, pm.description, pa.condition, p.picked_by, p.picked_at, p.model_match,
         (select count(*)::int from public.coolerco_assets a where a.client_code = k.client_code and a.warehouse_code = k.warehouse_code
             and a.location_type = 'Warehouse' and a.status ilike '%ready%' and public.coolerco_model_matches(a.client_code, a.model_code, k.requested_product_base)
             and not exists (select 1 from public.coolerco_client_picks x where x.client_code = a.client_code and x.asset_number = a.asset_number and x.released_at is null)),
         (select count(*)::int from public.coolerco_assets a where a.client_code = k.client_code and a.warehouse_code = k.warehouse_code
             and a.location_type = 'Warehouse' and a.status ilike '%ready%'
             and not exists (select 1 from public.coolerco_client_picks x where x.client_code = a.client_code and x.asset_number = a.asset_number and x.released_at is null))
    from public.routing_routes r
    join public.routing_route_versions v on v.route_id = r.id and v.is_current
    join public.routing_route_stops s on s.route_version_id = v.id and s.outcome_status <> 'removed'
    join public.coolerco_cases k on k.case_number = s.case_number
    left join public.coolerco_client_picks p on p.case_number = k.case_number and p.released_at is null
    left join public.coolerco_assets pa on pa.client_code = p.client_code and pa.asset_number = p.asset_number
    left join public.coolerco_asset_models pm on pm.client_code = pa.client_code and pm.model_code = pa.model_code
   where auth.uid() is not null
     and r.route_date = p_date and coalesce(r.status, '') not in ('not_used', 'cancelled', 'suggested', 'saved_draft')
     and public.coolerco_is_self_managed(k.client_code)
     and k.case_type in ('Deliver an Asset', 'Replacement of Asset')
     and (p_warehouse is null or r.warehouse_group = public.coolerco_wh_group(p_warehouse) or k.warehouse_code in (upper(p_warehouse), 'WH-DM-' || upper(p_warehouse)))
     and public.coolerco_can_see(k.client_code, k.warehouse_code)
   order by r.route_number, s.stop_sequence
$$;

-- candidates for one case
create or replace function public.coolerco_client_pick_candidates(p_case text, p_limit int default 20)
returns table (asset_number text, serial_number text, model_code text, model text, condition text, branding text, status text,
               same_model boolean, same_condition boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.asset_number, a.serial_number, a.model_code, m.description, a.condition, a.branding, a.status,
         public.coolerco_model_matches(a.client_code, a.model_code, k.requested_product_base),
         k.requested_asset_condition is null or a.condition = k.requested_asset_condition
    from public.coolerco_cases k
    join public.coolerco_assets a on a.client_code = k.client_code and a.warehouse_code = k.warehouse_code
    left join public.coolerco_asset_models m on m.client_code = a.client_code and m.model_code = a.model_code
   where auth.uid() is not null and k.case_number = p_case and public.coolerco_can_see(k.client_code, k.warehouse_code)
     and a.location_type = 'Warehouse' and a.status ilike '%ready%'
     and not exists (select 1 from public.coolerco_client_picks x where x.client_code = a.client_code and x.asset_number = a.asset_number and x.released_at is null)
     and not exists (select 1 from public.coolerco_cases o where o.client_code = a.client_code and o.case_number <> k.case_number
                       and not public.coolerco_case_is_closed(o.status_reason) and a.asset_number in (o.asset_delivered, o.asset_removed, o.asset_repaired))
   order by 8 desc, 9 desc, a.asset_number
   limit greatest(coalesce(p_limit, 20), 1)
$$;

-- pick one cooler for a case (screen choice or scan). A different model needs a reason.
create or replace function public.coolerco_client_pick_select(p_case text, p_asset text, p_route uuid default null, p_how text default 'screen', p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare k public.coolerco_cases; a public.coolerco_assets; v_match boolean; v_stop uuid; v_old public.coolerco_client_picks; v_code text := upper(trim(coalesce(p_asset, '')));
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not public.coolerco_can_pick() then return jsonb_build_object('error', 'not_allowed'); end if;
  select * into k from public.coolerco_cases where case_number = p_case for update;
  if not found or not public.coolerco_is_self_managed(k.client_code) then return jsonb_build_object('error', 'not_found'); end if;
  if not public.coolerco_can_see(k.client_code, k.warehouse_code) then return jsonb_build_object('error', 'not_allowed'); end if;
  if k.case_type not in ('Deliver an Asset', 'Replacement of Asset') then return jsonb_build_object('error', 'no_pick_needed'); end if;
  if public.coolerco_case_is_closed(k.status_reason) or k.status_reason = 'Waiting for Approval' then return jsonb_build_object('error', 'case_not_open', 'status', k.status_reason); end if;
  perform pg_advisory_xact_lock(hashtext('coolerco_client_pick:' || k.client_code || ':' || v_code));
  -- scanned: the asset number, serial number or barcode on the label
  select * into a from public.coolerco_assets where client_code = k.client_code and (upper(asset_number) = v_code or upper(coalesce(serial_number, '')) = v_code) limit 1;
  if not found then return jsonb_build_object('error', 'asset_not_found', 'code', p_asset); end if;
  if a.warehouse_code is distinct from k.warehouse_code then return jsonb_build_object('error', 'other_warehouse', 'asset', a.asset_number, 'warehouse', a.warehouse_code); end if;
  if a.location_type <> 'Warehouse' or a.status not ilike '%ready%' then return jsonb_build_object('error', 'not_ready', 'asset', a.asset_number, 'status', a.status); end if;
  if exists (select 1 from public.coolerco_client_picks x where x.client_code = a.client_code and x.asset_number = a.asset_number and x.released_at is null and x.case_number <> p_case) then
    return jsonb_build_object('error', 'picked_elsewhere', 'asset', a.asset_number); end if;
  v_match := public.coolerco_model_matches(k.client_code, a.model_code, k.requested_product_base);
  if not v_match and nullif(trim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('error', 'other_model', 'asset', a.asset_number, 'requested', k.requested_product_base,
                              'model', (select description from public.coolerco_asset_models where client_code = a.client_code and model_code = a.model_code)); end if;
  -- a cooler picked before for this case goes back to Ready to Work
  select * into v_old from public.coolerco_client_picks where case_number = p_case and released_at is null;
  if found then
    if v_old.asset_number = a.asset_number then return jsonb_build_object('ok', true, 'asset', a.asset_number, 'already', true); end if;
    perform public.coolerco_client_pick_undo(p_case, 'Replaced by ' || a.asset_number);
  end if;
  select s.id into v_stop from public.routing_route_stops s join public.routing_route_versions v on v.id = s.route_version_id and v.is_current
   where s.case_number = p_case and (p_route is null or s.route_id = p_route) limit 1;
  insert into public.coolerco_client_picks (client_code, route_id, stop_id, case_number, asset_number, warehouse_code, model_match, reason, how, status_before)
  values (k.client_code, p_route, v_stop, p_case, a.asset_number, k.warehouse_code, v_match, nullif(trim(p_reason), ''),
          case when p_how in ('screen', 'camera', 'scanner', 'typed') then p_how else 'screen' end, a.status);
  update public.coolerco_assets set status = 'Picked', updated_at = now(), updated_by = coalesce(auth.jwt() ->> 'email', 'user') where id = a.id;
  update public.coolerco_cases set asset_delivered = a.asset_number, updated_at = now() where case_number = p_case;
  insert into public.coolerco_asset_movements (asset, movement, warehouse, route_id, case_number, how, expected, exception, override_reason,
         by_label, client_code, case_type, movement_code, asset_role, from_kind, from_code, to_kind, to_code, status_before, status_after, source)
  values (a.asset_number, 'pick', k.warehouse_code, p_route, p_case,
          case when p_how in ('camera', 'scanner', 'typed') then p_how else 'screen' end, v_match, not v_match, nullif(trim(p_reason), ''),
          coalesce(auth.jwt() ->> 'email', 'user'), k.client_code, k.case_type,
          case when exists (select 1 from public.coolerco_movement_types where code = 'CC-PICK') then 'CC-PICK' end, 'delivered',
          'warehouse', k.warehouse_code, 'picked', k.warehouse_code, a.status, 'Picked', 'client_picking');
  insert into public.coolerco_case_events (case_number, event_type, from_status, to_status, notes, actor_type, actor_label)
  values (p_case, 'picked', k.status_reason, k.status_reason,
          'Cooler ' || a.asset_number || ' picked' || case when v_match then '' else ' (other model: ' || trim(p_reason) || ')' end,
          'staff', coalesce(auth.jwt() ->> 'email', 'user'));
  return jsonb_build_object('ok', true, 'asset', a.asset_number, 'model_match', v_match);
end $$;

-- release the picked cooler of a case
create or replace function public.coolerco_client_pick_undo(p_case text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.coolerco_client_picks; k public.coolerco_cases;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not public.coolerco_can_pick() then return jsonb_build_object('error', 'not_allowed'); end if;
  select * into p from public.coolerco_client_picks where case_number = p_case and released_at is null for update;
  if not found then return jsonb_build_object('error', 'nothing_picked'); end if;
  if not public.coolerco_can_see(p.client_code, p.warehouse_code) then return jsonb_build_object('error', 'not_allowed'); end if;
  select * into k from public.coolerco_cases where case_number = p_case;
  update public.coolerco_client_picks set released_at = now(), released_by = coalesce(auth.jwt() ->> 'email', 'user'), release_reason = nullif(trim(p_reason), '') where id = p.id;
  update public.coolerco_assets set status = coalesce(p.status_before, 'In warehouse, ready to work'), updated_at = now(), updated_by = coalesce(auth.jwt() ->> 'email', 'user')
   where client_code = p.client_code and asset_number = p.asset_number and status = 'Picked';
  update public.coolerco_cases set asset_delivered = null, updated_at = now() where case_number = p_case and asset_delivered = p.asset_number;
  -- the pick is undone here, so a later cancel must not reverse it a second time
  update public.coolerco_asset_movements set reversed = true
   where case_number = p_case and asset = p.asset_number and movement = 'pick' and source = 'client_picking' and not reversed;
  insert into public.coolerco_asset_movements (asset, movement, warehouse, route_id, case_number, how, expected, exception, override_reason,
         by_label, client_code, case_type, asset_role, from_kind, from_code, to_kind, to_code, status_before, status_after, source)
  values (p.asset_number, 'unpick', p.warehouse_code, p.route_id, p_case, 'screen', true, false, nullif(trim(p_reason), ''),
          coalesce(auth.jwt() ->> 'email', 'user'), p.client_code, k.case_type, 'delivered', 'picked', p.warehouse_code, 'warehouse', p.warehouse_code,
          'Picked', coalesce(p.status_before, 'In warehouse, ready to work'), 'client_picking');
  insert into public.coolerco_case_events (case_number, event_type, from_status, to_status, notes, actor_type, actor_label)
  values (p_case, 'unpicked', k.status_reason, k.status_reason, 'Cooler ' || p.asset_number || ' released' || coalesce(': ' || nullif(trim(p_reason), ''), ''),
          'staff', coalesce(auth.jwt() ->> 'email', 'user'));
  return jsonb_build_object('ok', true, 'asset', p.asset_number);
end $$;

-- Field app: the cooler picked for each client case on these routes (shown on the stop like RouteIQ's preparation)
create or replace function public.coolerco_client_picks_for_routes(p_routes uuid[])
returns table (route_id uuid, case_number text, asset_number text, serial_number text, model text, condition text, branding text, picked_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p.route_id, s.route_id), p.case_number, p.asset_number, a.serial_number, m.description, a.condition, a.branding, p.picked_at
    from public.coolerco_client_picks p
    join public.routing_route_stops s on s.case_number = p.case_number and s.route_id = any (p_routes)
    left join public.coolerco_assets a on a.client_code = p.client_code and a.asset_number = p.asset_number
    left join public.coolerco_asset_models m on m.client_code = a.client_code and m.model_code = a.model_code
   where auth.uid() is not null and p.released_at is null
$$;

revoke all on function public.coolerco_can_pick() from public, anon;
revoke all on function public.coolerco_model_matches(text, text, text) from public, anon;
revoke all on function public.coolerco_client_pick_board(date, text) from public, anon;
revoke all on function public.coolerco_client_pick_candidates(text, int) from public, anon;
revoke all on function public.coolerco_client_pick_select(text, text, uuid, text, text) from public, anon;
revoke all on function public.coolerco_client_pick_undo(text, text) from public, anon;
revoke all on function public.coolerco_client_picks_for_routes(uuid[]) from public, anon;
grant execute on function public.coolerco_can_pick() to authenticated;
grant execute on function public.coolerco_model_matches(text, text, text) to authenticated;
grant execute on function public.coolerco_client_pick_board(date, text) to authenticated;
grant execute on function public.coolerco_client_pick_candidates(text, int) to authenticated;
grant execute on function public.coolerco_client_pick_select(text, text, uuid, text, text) to authenticated;
grant execute on function public.coolerco_client_pick_undo(text, text) to authenticated;
grant execute on function public.coolerco_client_picks_for_routes(uuid[]) to authenticated;
