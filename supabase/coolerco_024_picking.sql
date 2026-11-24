-- CoolerCo-Ops · 024 · Improved picking: movement ledger, cooler suggestions, scan-to-pick, reservations, alarms
-- Additive: new coolerco_ table + functions. Writes ROUTING PREP (routing_warehouse_preparation) only where the
-- setting pick_writes_routing = true — switched on automatically on TEST (coolerco_settings.sync_role = 'TEST'),
-- OFF anywhere else (production stays read-only; Wanda 12 Nov: "don't change anything on the routing app").
-- Table grants/policies of routing tables are NOT changed (writes go through security definer functions).
-- Rollback: coolerco_024_rollback.sql

-- ── Switch ──
insert into public.coolerco_settings (key, value)
select 'pick_writes_routing', to_jsonb(coalesce((select value #>> '{}' from public.coolerco_settings where key = 'sync_role'), '') = 'TEST')
on conflict (key) do nothing;
-- New stock protection: giving A - New where the case asked for another condition needs a reason
insert into public.coolerco_settings (key, value) values ('pick_new_needs_reason', 'true'::jsonb) on conflict (key) do nothing;

-- ── Movement ledger (append-only; CoolerCo's own "what happened to which cooler") ──
create table if not exists public.coolerco_asset_movements (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid unique,                    -- made on the phone → a resend never doubles
  asset           text not null,
  bar_code        text,
  movement        text not null check (movement in ('reserve', 'unreserve', 'pick', 'unpick', 'load', 'unload', 'receive', 'putaway',
                                                    'transfer_out', 'transfer_in', 'deliver', 'collect', 'audit', 'scrap', 'adjust')),
  warehouse       text,
  location_id     uuid,
  route_id        uuid,
  case_number     text,
  how             text check (how in ('camera', 'scanner', 'typed', 'system', 'screen')),
  expected        boolean,                        -- did the system expect this cooler here?
  exception       text,                           -- e.g. swapped, upgrade_new, family, reserved_elsewhere
  override_reason text,
  details         jsonb,
  by_user         uuid default auth.uid(),
  by_label        text,
  at              timestamptz not null default now()
);
create index if not exists idx_cc_moves_asset on public.coolerco_asset_movements (asset, at desc);
create index if not exists idx_cc_moves_route on public.coolerco_asset_movements (route_id, case_number);
create index if not exists idx_cc_moves_at on public.coolerco_asset_movements (at desc);
alter table public.coolerco_asset_movements enable row level security;
drop policy if exists coolerco_asset_movements_read on public.coolerco_asset_movements;
create policy coolerco_asset_movements_read on public.coolerco_asset_movements for select to authenticated using (true);
revoke all on public.coolerco_asset_movements from anon, authenticated;
grant select on public.coolerco_asset_movements to authenticated;   -- writes only through the functions below

-- ── Helpers ──
create or replace function public.coolerco_pick_writes_on() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (value #>> '{}')::boolean from public.coolerco_settings where key = 'pick_writes_routing'), false)
$$;

-- One delivery/replacement stop with what was asked, what is selected, and every check. Used by board + scan.
create or replace function public.coolerco_pick_lines(p_from date, p_to date, p_warehouse text default null, p_route uuid default null)
returns table (
  route_id uuid, route_number text, route_date date, route_status text, warehouse_group text, driver text, is_ncd boolean,
  case_number text, case_type text, stop_sequence int, point_of_sale text, pos_local_code text, case_status text,
  req_base text, req_condition text, req_brand text, req_family uuid, req_family_name text,
  selected_asset text, selected_bar_code text, selected_local_code text, selected_base text, selected_variant text,
  selected_condition text, selected_brand text, selected_status text, selected_bay text, selected_place text,
  asset_selected_at timestamptz, picked boolean, picked_at timestamptz, rtw boolean, packed boolean,
  flags text[], reserved_for text
)
language sql stable security definer set search_path = public, pg_temp as $$
  with r as (
    select rr.* from public.routing_routes rr
     where rr.route_date between p_from and p_to
       and coalesce(rr.status, '') not in ('not_used', 'cancelled')
       and (p_warehouse is null or rr.warehouse_group = p_warehouse)
       and (p_route is null or rr.id = p_route)
  ), st as (
    select distinct on (s.route_id, s.case_number) s.*
      from public.routing_route_stops s
      join r on r.id = s.route_id
      left join public.routing_route_versions v on v.id = s.route_version_id
     where s.case_type in ('Deliver an Asset', 'Replacement of Asset')
       and (v.id is null or v.is_current)
     order by s.route_id, s.case_number, v.is_current desc nulls last, s.created_at desc
  ), x as (
    select r.id rid, r.route_number, r.route_date, r.status rstatus, r.warehouse_group, r.resource_display_name, r.is_ncd,
           st.case_number, st.case_type, st.stop_sequence, st.point_of_sale, st.pos_local_code,
           coalesce(c.status_reason, k.status_reason) case_status,
           coalesce(c.requested_product_base, k.requested_product_base) req_base,
           coalesce(c.requested_asset_condition, k.requested_asset_condition) req_condition,
           coalesce(c.requested_brand_hierarchy, k.requested_brand_hierarchy) req_brand,
           p.selected_asset_name, p.selected_bar_code, p.selected_local_code, p.asset_selected_at,
           coalesce(p.picked, false) picked, p.picked_at, coalesce(p.rtw, false) rtw, coalesce(p.packed, false) packed,
           a.product_base a_base, a.product_variant a_variant, a.condition a_cond, a.brand_hierarchy a_brand, a.asset_status a_status,
           a.assign_account a_acc, a.asset_location a_loc, a.points_of_sale a_pos
      from st join r on r.id = st.route_id
      left join public.cases c on c.case_number = st.case_number
      left join public.coolerco_cases k on k.case_number = st.case_number and c.case_number is null
      left join public.routing_warehouse_preparation p on p.route_id = st.route_id and p.case_number = st.case_number
      left join public.assets_live a on a.name = p.selected_asset_name
  )
  select x.rid, x.route_number, x.route_date, x.rstatus, x.warehouse_group, x.resource_display_name, x.is_ncd,
         x.case_number, x.case_type, x.stop_sequence, x.point_of_sale, x.pos_local_code, x.case_status,
         x.req_base, x.req_condition, x.req_brand, fr.family_id, fn.name,
         x.selected_asset_name, x.selected_bar_code, x.selected_local_code, x.a_base, x.a_variant,
         x.a_cond, x.a_brand, x.a_status, public.coolerco_bay_for_status(x.a_status),
         coalesce(x.a_acc, x.a_pos, x.a_loc),
         x.asset_selected_at, x.picked, x.picked_at, x.rtw, x.packed,
         array_remove(array[
           case when x.selected_asset_name is null then 'no_selection' end,
           case when x.selected_asset_name is not null and x.a_status is distinct from 'Ready to Work' then 'not_rtw' end,
           case when x.selected_asset_name is not null and x.a_loc = 'Location' then 'at_pos'
                when x.selected_asset_name is not null and coalesce(x.a_acc, '') not like x.warehouse_group || ' %' then 'other_wh' end,
           case when x.selected_asset_name is not null and fr.family_id is not null and fs.family_id is not null and fr.family_id <> fs.family_id then 'family' end,
           case when x.selected_asset_name is not null and x.a_cond = 'A - New' and coalesce(x.req_condition, '') not in ('', 'A - New') then 'upgrade_new' end,
           case when x.selected_asset_name is not null and x.req_condition is not null and x.a_cond is not null and x.a_cond <> x.req_condition
                     and not (x.a_cond = 'A - New') then 'condition' end,
           case when x.selected_asset_name is not null and x.req_brand is not null and x.a_brand is not null and x.a_brand <> x.req_brand then 'brand' end,
           case when res.case_number is not null then 'double_booked' end,
           case when x.selected_asset_name is not null and not x.picked and x.route_date <= current_date then 'not_picked' end
         ], null),
         res.case_number
    from x
    left join public.coolerco_product_base_family fr on fr.product_base = x.req_base
    left join public.coolerco_product_families fn on fn.id = fr.family_id
    left join public.coolerco_product_base_family fs on fs.product_base = x.a_base
    left join lateral (
      select p2.case_number from public.routing_warehouse_preparation p2 join public.routing_routes r2 on r2.id = p2.route_id
       where x.selected_asset_name is not null and p2.selected_asset_name = x.selected_asset_name
         and p2.case_number <> x.case_number and coalesce(r2.status, '') not in ('not_used', 'cancelled')
         and r2.route_date >= x.route_date - 14
         and exists (select 1 from public.cases c2 where c2.case_number = p2.case_number and c2.status_reason in ('Open', 'In Progress', 'Waiting', 'In Service', 'On Hold'))
       limit 1) res on true
   order by x.route_date, x.warehouse_group, x.route_number, x.stop_sequence nulls last;
$$;

-- Board for the screen: lines + whether this database lets CoolerCo write the prep
create or replace function public.coolerco_pick_board(p_from date, p_to date, p_warehouse text default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'sign in'; end if;
  return jsonb_build_object('writes', public.coolerco_pick_writes_on(),
    'lines', coalesce((select jsonb_agg(to_jsonb(l)) from public.coolerco_pick_lines(p_from, p_to, p_warehouse) l), '[]'::jsonb));
end $$;

-- ✨ Best RTW coolers for one stop: same family, then requested condition, brand, base, in a picking area.
-- Not offered: reserved for another open case, or on an open case. A - New for a used request = "upgrade" (needs a reason).
create or replace function public.coolerco_pick_candidates(p_route uuid, p_case text, p_limit int default 8)
returns table (asset text, bar_code text, local_code text, product_base text, product_variant text, condition text, brand text,
               area text, score int, upgrade_new boolean, same_base boolean, same_condition boolean, same_brand boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare l record;
begin
  if auth.uid() is null then raise exception 'sign in'; end if;
  select * into l from public.coolerco_pick_lines(current_date - 400, current_date + 400, null, p_route) x where x.case_number = p_case limit 1;
  if not found then return; end if;
  return query
  with stock as (
    select a.* from public.assets_live a
     where a.assign_account = l.warehouse_group || ' WH' and a.asset_location = 'Warehouse' and a.asset_status = 'Ready to Work'
       and (l.req_family is null and a.product_base = l.req_base
            or exists (select 1 from public.coolerco_product_base_family f where f.product_base = a.product_base and f.family_id = l.req_family))
  ), free as (
    select s.* from stock s
     where not exists (select 1 from public.routing_warehouse_preparation p2 join public.routing_routes r2 on r2.id = p2.route_id
                        where p2.selected_asset_name = s.name and not (p2.route_id = p_route and p2.case_number = p_case)
                          and coalesce(r2.status, '') not in ('not_used', 'cancelled') and r2.route_date >= current_date - 14
                          and exists (select 1 from public.cases c2 where c2.case_number = p2.case_number and c2.status_reason in ('Open', 'In Progress', 'Waiting', 'In Service', 'On Hold')))
       and not exists (select 1 from public.cases c3 where c3.status_reason in ('Open', 'In Progress', 'Waiting', 'In Service', 'On Hold')
                          and s.name in (c3.asset_repaired, c3.asset_removed, c3.asset_delivered))
  ), scored as (
    select f.*, lt.area,
           (f.product_base = l.req_base) sb, (f.condition = l.req_condition) sc, (f.brand_hierarchy = l.req_brand) sbr,
           (f.condition = 'A - New' and coalesce(l.req_condition, '') not in ('', 'A - New')) up
      from free f
      left join lateral (select w.label area, w.is_picking from public.coolerco_asset_touch t join public.coolerco_wh_locations w on w.id = t.location_id
                          where t.asset_name = f.name order by t.created_at desc limit 1) lt on true
  )
  select s.name, s.bar_code, s.local_code, s.product_base, s.product_variant, s.condition, s.brand_hierarchy, s.area,
         (case when s.sc then 40 when s.up then -30 else 0 end + case when s.sbr then 20 else 0 end + case when s.sb then 10 else 0 end
          + case when s.area is not null then 3 else 0 end)::int,
         s.up, s.sb, s.sc, s.sbr
    from scored s
   order by 9 desc, s.bar_code
   limit greatest(coalesce(p_limit, 8), 1);
end $$;

-- Internal: check a cooler against a stop; returns problems (codes) that need a reason
create or replace function public.coolerco_pick_problems(p_route uuid, p_case text, p_asset text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare l record; a public.assets_live; fa uuid; hard text[] := '{}'; soft text[] := '{}'; v_res text;
begin
  select * into l from public.coolerco_pick_lines(current_date - 400, current_date + 400, null, p_route) x where x.case_number = p_case limit 1;
  if not found then return jsonb_build_object('error', 'stop_not_found'); end if;
  select * into a from public.assets_live where name = p_asset;
  if not found then return jsonb_build_object('error', 'asset_not_found'); end if;
  select family_id into fa from public.coolerco_product_base_family where product_base = a.product_base;
  if a.asset_location = 'Location' then hard := hard || 'at_pos'::text; end if;
  if coalesce(a.assign_account, '') not like l.warehouse_group || ' %' and a.asset_location <> 'Location' then hard := hard || 'other_wh'::text; end if;
  if a.asset_status is distinct from 'Ready to Work' then soft := soft || 'not_rtw'::text; end if;
  if l.req_family is not null and fa is distinct from l.req_family then soft := soft || 'family'::text; end if;
  if a.condition = 'A - New' and coalesce(l.req_condition, '') not in ('', 'A - New')
     and coalesce((select (value #>> '{}')::boolean from public.coolerco_settings where key = 'pick_new_needs_reason'), true) then soft := soft || 'upgrade_new'::text; end if;
  if l.req_condition is not null and a.condition <> l.req_condition and a.condition <> 'A - New' then soft := soft || 'condition'::text; end if;
  if l.req_brand is not null and a.brand_hierarchy is distinct from l.req_brand then soft := soft || 'brand'::text; end if;
  select p2.case_number into v_res from public.routing_warehouse_preparation p2 join public.routing_routes r2 on r2.id = p2.route_id
   where p2.selected_asset_name = p_asset and not (p2.route_id = p_route and p2.case_number = p_case)
     and coalesce(r2.status, '') not in ('not_used', 'cancelled') and r2.route_date >= current_date - 14
     and exists (select 1 from public.cases c2 where c2.case_number = p2.case_number and c2.status_reason in ('Open', 'In Progress', 'Waiting', 'In Service', 'On Hold'))
   limit 1;
  if v_res is not null then soft := soft || 'reserved_elsewhere'::text; end if;
  return jsonb_build_object('hard', to_jsonb(hard), 'soft', to_jsonb(soft), 'reserved_for', v_res,
    'asset', jsonb_build_object('name', a.name, 'bar_code', a.bar_code, 'local_code', a.local_code, 'product_base', a.product_base,
      'product_variant', a.product_variant, 'condition', a.condition, 'brand', a.brand_hierarchy, 'status', a.asset_status,
      'place', coalesce(a.assign_account, a.points_of_sale, a.asset_location)),
    'stop', jsonb_build_object('route_number', l.route_number, 'route_date', l.route_date, 'stop', l.stop_sequence, 'store', l.point_of_sale,
      'req_base', l.req_base, 'req_condition', l.req_condition, 'req_brand', l.req_brand, 'selected', l.selected_asset, 'picked', l.picked));
end $$;

-- Internal: write the selection (+ optionally the pick) into routing prep and the ledger
create or replace function public.coolerco_pick_write(p_route uuid, p_case text, a jsonb, p_pick boolean, p_how text, p_reason text,
                                                     p_exception text, p_client uuid, p_expected boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_by text := coalesce(auth.jwt() ->> 'email', auth.uid()::text); v_wh text; v_old text;
begin
  select warehouse_group into v_wh from public.routing_routes where id = p_route;
  select selected_asset_name into v_old from public.routing_warehouse_preparation where route_id = p_route and case_number = p_case;
  insert into public.routing_warehouse_preparation as p (route_id, case_number, selected_asset_name, selected_bar_code, selected_local_code,
         selected_product_base, selected_condition, selected_branding, asset_selected_at, picked, picked_at, updated_at)
  values (p_route, p_case, a ->> 'name', a ->> 'bar_code', a ->> 'local_code', a ->> 'product_base', a ->> 'condition', a ->> 'brand', now(),
          p_pick, case when p_pick then now() end, now())
  on conflict (route_id, case_number) do update set
    selected_asset_name = excluded.selected_asset_name, selected_bar_code = excluded.selected_bar_code, selected_local_code = excluded.selected_local_code,
    selected_product_base = excluded.selected_product_base, selected_condition = excluded.selected_condition, selected_branding = excluded.selected_branding,
    asset_selected_at = case when p.selected_asset_name is distinct from excluded.selected_asset_name then now() else p.asset_selected_at end,
    picked = case when p_pick then true when p.selected_asset_name is distinct from excluded.selected_asset_name then false else p.picked end,
    picked_at = case when p_pick then now() when p.selected_asset_name is distinct from excluded.selected_asset_name then null else p.picked_at end,
    updated_at = now();
  if v_old is not null and v_old <> a ->> 'name' then
    insert into public.coolerco_asset_movements (asset, movement, warehouse, route_id, case_number, how, expected, exception, details, by_label)
    values (v_old, 'unreserve', v_wh, p_route, p_case, coalesce(p_how, 'screen'), true, 'replaced', jsonb_build_object('by', a ->> 'name'), v_by);
  end if;
  if v_old is distinct from a ->> 'name' then
    insert into public.coolerco_asset_movements (asset, bar_code, movement, warehouse, route_id, case_number, how, expected, exception, override_reason, by_label, client_id)
    values (a ->> 'name', a ->> 'bar_code', 'reserve', v_wh, p_route, p_case, coalesce(p_how, 'screen'), p_expected, p_exception, p_reason, v_by,
            case when not p_pick then p_client end);
  end if;
  if p_pick then
    insert into public.coolerco_asset_movements (asset, bar_code, movement, warehouse, route_id, case_number, how, expected, exception, override_reason, by_label, client_id)
    values (a ->> 'name', a ->> 'bar_code', 'pick', v_wh, p_route, p_case, coalesce(p_how, 'screen'), p_expected, p_exception, p_reason, v_by, p_client);
  end if;
end $$;

-- ✋ Select a cooler for a stop (screen or "accept suggestion"). Problems → {needs_reason} unless a reason is given.
create or replace function public.coolerco_pick_select(p_route uuid, p_case text, p_asset text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare chk jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not public.coolerco_pick_writes_on() then return jsonb_build_object('error', 'writes_off'); end if;
  perform pg_advisory_xact_lock(hashtext('coolerco_pick:' || p_asset));
  chk := public.coolerco_pick_problems(p_route, p_case, p_asset);
  if chk ? 'error' then return chk; end if;
  if jsonb_array_length(chk -> 'hard') > 0 then return chk || jsonb_build_object('ok', false, 'blocked', true); end if;
  if jsonb_array_length(chk -> 'soft') > 0 and nullif(trim(coalesce(p_reason, '')), '') is null then
    return chk || jsonb_build_object('ok', false, 'needs_reason', true);
  end if;
  perform public.coolerco_pick_write(p_route, p_case, chk -> 'asset', false, 'screen', nullif(trim(p_reason), ''),
    nullif(array_to_string(array(select jsonb_array_elements_text(chk -> 'soft')), ','), ''), null, jsonb_array_length(chk -> 'soft') = 0);
  return chk || jsonb_build_object('ok', true);
end $$;

-- ✨ Fill every stop without a cooler (date + warehouse) with its best clean match (no reason needed). Returns how many.
create or replace function public.coolerco_pick_autofill(p_date date, p_warehouse text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l record; c record; n int := 0; m int := 0;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not public.coolerco_pick_writes_on() then return jsonb_build_object('error', 'writes_off'); end if;
  for l in select * from public.coolerco_pick_lines(p_date, p_date, p_warehouse) x where x.selected_asset is null
             and coalesce(x.case_status, 'Open') in ('Open', 'In Progress', 'Waiting', 'In Service', 'On Hold') loop
    select * into c from public.coolerco_pick_candidates(l.route_id, l.case_number, 1) k where not k.upgrade_new and k.same_condition;
    if found and (public.coolerco_pick_select(l.route_id, l.case_number, c.asset, null) ->> 'ok')::boolean then n := n + 1; else m := m + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'filled', n, 'left', m);
end $$;

-- 📷 Scan to pick. With p_case: for that stop. Without: works out the stop on that day's routes in that warehouse.
-- Results: picked | wrong_cooler (another cooler is selected) | needs_reason | blocked | choose_stop | no_stop | not_found
create or replace function public.coolerco_pick_scan(p_code text, p_date date, p_warehouse text, p_route uuid default null, p_case text default null,
                                                    p_how text default 'camera', p_reason text default null, p_client uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.assets_live; k text := trim(coalesce(p_code, '')); l record; chk jsonb; v_stops jsonb; v_soft text;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not public.coolerco_pick_writes_on() then return jsonb_build_object('error', 'writes_off'); end if;
  if p_client is not null and exists (select 1 from public.coolerco_asset_movements where client_id = p_client) then
    return jsonb_build_object('result', 'picked', 'repeat', true);
  end if;
  select * into a from public.assets_live x where k <> '' and (x.bar_code = k or x.name = k or x.local_code = k or x.sap_number = k or x.serial_number = k)
   order by (x.bar_code = k) desc, (x.name = k) desc limit 1;
  if not found then return jsonb_build_object('result', 'not_found', 'code', k); end if;
  perform pg_advisory_xact_lock(hashtext('coolerco_pick:' || a.name));

  if p_case is null then
    -- 1) a stop where exactly this cooler is selected
    select * into l from public.coolerco_pick_lines(p_date, p_date, p_warehouse) x where x.selected_asset = a.name limit 1;
    if not found then
      -- 2) stops still without a cooler that ask for this family → let the person choose (or the only one)
      select jsonb_agg(jsonb_build_object('route_id', x.route_id, 'route_number', x.route_number, 'case_number', x.case_number, 'stop', x.stop_sequence,
               'store', x.point_of_sale, 'req_base', x.req_base, 'req_condition', x.req_condition, 'req_brand', x.req_brand,
               'match', (x.req_condition = a.condition) and (x.req_brand is not distinct from a.brand_hierarchy))
               order by (x.req_condition = a.condition) desc, x.route_number, x.stop_sequence)
        into v_stops
        from public.coolerco_pick_lines(p_date, p_date, p_warehouse) x
        left join public.coolerco_product_base_family fa on fa.product_base = a.product_base
       where x.selected_asset is null and (x.req_family = fa.family_id or x.req_base = a.product_base);
      if v_stops is null then
        return jsonb_build_object('result', 'no_stop', 'asset', jsonb_build_object('name', a.name, 'bar_code', a.bar_code, 'product_base', a.product_base, 'condition', a.condition, 'status', a.asset_status));
      end if;
      return jsonb_build_object('result', 'choose_stop', 'stops', v_stops,
        'asset', jsonb_build_object('name', a.name, 'bar_code', a.bar_code, 'product_base', a.product_base, 'product_variant', a.product_variant, 'condition', a.condition, 'brand', a.brand_hierarchy));
    end if;
    p_route := l.route_id; p_case := l.case_number;
  end if;

  chk := public.coolerco_pick_problems(p_route, p_case, a.name);
  if chk ? 'error' then return chk || jsonb_build_object('result', 'no_stop'); end if;
  if (chk -> 'stop' ->> 'selected') is not null and chk -> 'stop' ->> 'selected' <> a.name and nullif(trim(coalesce(p_reason, '')), '') is null then
    return chk || jsonb_build_object('result', 'wrong_cooler', 'selected_bar_code',
      (select selected_bar_code from public.routing_warehouse_preparation where route_id = p_route and case_number = p_case));
  end if;
  if jsonb_array_length(chk -> 'hard') > 0 then return chk || jsonb_build_object('result', 'blocked'); end if;
  -- the selected cooler itself: its problems were accepted (with a reason) when it was selected → just pick it
  if jsonb_array_length(chk -> 'soft') > 0 and nullif(trim(coalesce(p_reason, '')), '') is null
     and (chk -> 'stop' ->> 'selected') is distinct from a.name then
    return chk || jsonb_build_object('result', 'needs_reason');
  end if;
  v_soft := nullif(array_to_string(array(select jsonb_array_elements_text(chk -> 'soft')), ','), '');
  if (chk -> 'stop' ->> 'selected') is not null and chk -> 'stop' ->> 'selected' <> a.name then v_soft := concat_ws(',', 'swapped', v_soft); end if;
  perform public.coolerco_pick_write(p_route, p_case, chk -> 'asset', true, coalesce(p_how, 'camera'), nullif(trim(p_reason), ''), v_soft, p_client,
                                     v_soft is null);
  return chk || jsonb_build_object('result', 'picked', 'route_id', p_route, 'case_number', p_case);
end $$;

-- ↩ Undo a pick (or a selection) for a stop — reason required, logged
create or replace function public.coolerco_pick_undo(p_route uuid, p_case text, p_what text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.routing_warehouse_preparation; v_by text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not public.coolerco_pick_writes_on() then return jsonb_build_object('error', 'writes_off'); end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then return jsonb_build_object('error', 'reason_required'); end if;
  select * into p from public.routing_warehouse_preparation where route_id = p_route and case_number = p_case for update;
  if not found or p.selected_asset_name is null then return jsonb_build_object('error', 'nothing_selected'); end if;
  if p_what = 'pick' then
    update public.routing_warehouse_preparation set picked = false, picked_at = null, updated_at = now() where route_id = p_route and case_number = p_case;
  else
    update public.routing_warehouse_preparation set selected_asset_name = null, selected_bar_code = null, selected_local_code = null, selected_product_base = null,
           selected_condition = null, selected_branding = null, asset_selected_at = null, picked = false, picked_at = null, updated_at = now()
     where route_id = p_route and case_number = p_case;
  end if;
  insert into public.coolerco_asset_movements (asset, bar_code, movement, warehouse, route_id, case_number, how, expected, override_reason, by_label)
  values (p.selected_asset_name, p.selected_bar_code, case when p_what = 'pick' then 'unpick' else 'unreserve' end,
          (select warehouse_group from public.routing_routes where id = p_route), p_route, p_case, 'screen', true, trim(p_reason), v_by);
  return jsonb_build_object('ok', true);
end $$;

-- Grants: signed-in users only; internal helpers not callable directly
revoke all on function public.coolerco_pick_writes_on() from public, anon;
revoke all on function public.coolerco_pick_lines(date, date, text, uuid) from public, anon, authenticated;
revoke all on function public.coolerco_pick_problems(uuid, text, text) from public, anon, authenticated;
revoke all on function public.coolerco_pick_write(uuid, text, jsonb, boolean, text, text, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.coolerco_pick_board(date, date, text) from public, anon;
revoke all on function public.coolerco_pick_candidates(uuid, text, int) from public, anon;
revoke all on function public.coolerco_pick_select(uuid, text, text, text) from public, anon;
revoke all on function public.coolerco_pick_autofill(date, text) from public, anon;
revoke all on function public.coolerco_pick_scan(text, date, text, uuid, text, text, text, uuid) from public, anon;
revoke all on function public.coolerco_pick_undo(uuid, text, text, text) from public, anon;
grant execute on function public.coolerco_pick_writes_on() to authenticated;
grant execute on function public.coolerco_pick_board(date, date, text) to authenticated;
grant execute on function public.coolerco_pick_candidates(uuid, text, int) to authenticated;
grant execute on function public.coolerco_pick_select(uuid, text, text, text) to authenticated;
grant execute on function public.coolerco_pick_autofill(date, text) to authenticated;
grant execute on function public.coolerco_pick_scan(text, date, text, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.coolerco_pick_undo(uuid, text, text, text) to authenticated;
