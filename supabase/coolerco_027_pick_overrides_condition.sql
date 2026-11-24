-- CoolerCo-Ops · 027 · Picking step 2 (Wanda 12 Nov):
--  • Overrides only by supervisors (manager / system admin) of that warehouse — coolerco_can_override (026).
--    A stock controller who hits a mismatch taps "🙋 Ask supervisor" → request + in-app alert → supervisor approves on the board.
--  • Condition mismatch: "Is COM's condition wrong?" → the real condition is recorded as a CoolerCo touch (Submitted → goes to
--    COM through COM Touch sync) and the pick goes ahead when the real condition matches — no supervisor needed.
-- Replaces CoolerCo's own pick functions from 024 (routing app objects untouched). Needs 024 + 026. Rollback: coolerco_027_rollback.sql

insert into public.coolerco_notification_rules (event_type, recipient_type, channel)
select 'pick_override', 'supervisor', 'inapp'
where not exists (select 1 from public.coolerco_notification_rules where event_type = 'pick_override' and recipient_type = 'supervisor' and channel = 'inapp');

create table if not exists public.coolerco_override_requests (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'pick' check (kind in ('pick', 'select', 'load')),
  route_id      uuid,
  case_number   text,
  asset         text not null,
  bar_code      text,
  warehouse     text,                 -- route warehouse_group, e.g. 'RTMA Gauteng'
  problems      jsonb,
  reason        text not null,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by  uuid default auth.uid(),
  requested_label text,
  requested_at  timestamptz not null default now(),
  decided_by    text,
  decided_at    timestamptz,
  decision_note text
);
create index if not exists idx_cc_override_pending on public.coolerco_override_requests (warehouse, status, requested_at desc);
alter table public.coolerco_override_requests enable row level security;
drop policy if exists coolerco_override_requests_read on public.coolerco_override_requests;
create policy coolerco_override_requests_read on public.coolerco_override_requests for select to authenticated using (true);
revoke all on public.coolerco_override_requests from anon, authenticated;
grant select on public.coolerco_override_requests to authenticated;

-- 'RTMA Gauteng' → 'JHB' (warehouses.code) for the role check
create or replace function public.coolerco_wh_code_for_group(p_group text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select w.code from public.warehouses w where 'RTMA ' || w.name = p_group or w.name = p_group limit 1
$$;

-- Can the signed-in user override on this route's warehouse?
create or replace function public.coolerco_pick_can_override(p_route uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.coolerco_can_override(public.coolerco_wh_code_for_group((select warehouse_group from public.routing_routes where id = p_route)))
$$;

-- ✋ Select a cooler. Soft problems: supervisor gives the reason; anyone else → needs_supervisor.
create or replace function public.coolerco_pick_select(p_route uuid, p_case text, p_asset text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare chk jsonb; v_ovr boolean;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not public.coolerco_pick_writes_on() then return jsonb_build_object('error', 'writes_off'); end if;
  perform pg_advisory_xact_lock(hashtext('coolerco_pick:' || p_asset));
  chk := public.coolerco_pick_problems(p_route, p_case, p_asset);
  if chk ? 'error' then return chk; end if;
  v_ovr := public.coolerco_pick_can_override(p_route);
  chk := chk || jsonb_build_object('can_override', v_ovr);
  if jsonb_array_length(chk -> 'hard') > 0 then return chk || jsonb_build_object('ok', false, 'blocked', true); end if;
  if jsonb_array_length(chk -> 'soft') > 0 then
    if not v_ovr then return chk || jsonb_build_object('ok', false, 'needs_supervisor', true); end if;
    if nullif(trim(coalesce(p_reason, '')), '') is null then return chk || jsonb_build_object('ok', false, 'needs_reason', true); end if;
  end if;
  perform public.coolerco_pick_write(p_route, p_case, chk -> 'asset', false, 'screen', nullif(trim(p_reason), ''),
    nullif(array_to_string(array(select jsonb_array_elements_text(chk -> 'soft')), ','), ''), null, jsonb_array_length(chk -> 'soft') = 0);
  return chk || jsonb_build_object('ok', true);
end $$;

-- 📷 Scan to pick (as 024) + supervisor rule. Results add: needs_supervisor.
create or replace function public.coolerco_pick_scan(p_code text, p_date date, p_warehouse text, p_route uuid default null, p_case text default null,
                                                    p_how text default 'camera', p_reason text default null, p_client uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.assets_live; k text := trim(coalesce(p_code, '')); l record; chk jsonb; v_stops jsonb; v_soft text; v_ovr boolean; v_swap boolean;
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
    select * into l from public.coolerco_pick_lines(p_date, p_date, p_warehouse) x where x.selected_asset = a.name limit 1;
    if not found then
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
  v_ovr := public.coolerco_pick_can_override(p_route);
  chk := chk || jsonb_build_object('can_override', v_ovr, 'route_id', p_route, 'case_number', p_case);
  v_swap := (chk -> 'stop' ->> 'selected') is not null and chk -> 'stop' ->> 'selected' <> a.name;
  if jsonb_array_length(chk -> 'hard') > 0 then return chk || jsonb_build_object('result', 'blocked'); end if;
  if v_swap and nullif(trim(coalesce(p_reason, '')), '') is null then
    return chk || jsonb_build_object('result', 'wrong_cooler', 'selected_bar_code',
      (select selected_bar_code from public.routing_warehouse_preparation where route_id = p_route and case_number = p_case));
  end if;
  -- the selected cooler itself: its problems were accepted when it was selected → just pick it
  if (jsonb_array_length(chk -> 'soft') > 0 and not ((chk -> 'stop' ->> 'selected') is not distinct from a.name)) or v_swap then
    if not v_ovr then return chk || jsonb_build_object('result', 'needs_supervisor'); end if;
    if nullif(trim(coalesce(p_reason, '')), '') is null then return chk || jsonb_build_object('result', 'needs_reason'); end if;
  end if;
  v_soft := nullif(array_to_string(array(select jsonb_array_elements_text(chk -> 'soft')), ','), '');
  if v_swap then v_soft := concat_ws(',', 'swapped', v_soft); end if;
  perform public.coolerco_pick_write(p_route, p_case, chk -> 'asset', true, coalesce(p_how, 'camera'), nullif(trim(p_reason), ''), v_soft, p_client, v_soft is null);
  return chk || jsonb_build_object('result', 'picked');
end $$;

-- 🔶 "COM's condition is wrong": record the real condition (CoolerCo touch, Submitted → COM Touch sync) and, if the real
-- condition now fits the request, select (+ pick) without a supervisor. Anything else still mismatching → as before.
create or replace function public.coolerco_pick_condition_fix(p_route uuid, p_case text, p_asset text, p_condition text,
                                                              p_pick boolean default false, p_how text default 'screen', p_client uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare chk jsonb; a public.assets_live; l record; v_by text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
        soft text[]; hard text[]; v_wh public.warehouses; v_touch uuid := gen_random_uuid(); v_ovr boolean;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not public.coolerco_pick_writes_on() then return jsonb_build_object('error', 'writes_off'); end if;
  if p_condition not in ('A - New', 'B - Good as New', 'C - Used', 'D - Back of House only') then return jsonb_build_object('error', 'bad_condition'); end if;
  if p_client is not null and exists (select 1 from public.coolerco_asset_movements where client_id = p_client) then return jsonb_build_object('ok', true, 'repeat', true); end if;
  perform pg_advisory_xact_lock(hashtext('coolerco_pick:' || p_asset));
  select * into a from public.assets_live where name = p_asset;
  if not found then return jsonb_build_object('error', 'asset_not_found'); end if;
  chk := public.coolerco_pick_problems(p_route, p_case, p_asset);
  if chk ? 'error' then return chk; end if;
  select x.* into l from public.coolerco_pick_lines(current_date - 400, current_date + 400, null, p_route) x where x.case_number = p_case limit 1;
  -- 1) the real condition, as a CoolerCo scan that goes to COM
  select * into v_wh from public.warehouses where code = public.coolerco_wh_code_for_group(l.warehouse_group);
  if p_condition is distinct from a.condition then
    insert into public.coolerco_asset_touch (id, tenant_id, bar_code, local_code, asset_name, warehouse_id, warehouse_name, scan_type,
           scanned_by, scanned_by_user_id, notes, com_location, external_status, condition_found, brand_found, product_variant_found,
           product_base_found, serial_found, touch_status, submitted_at, submitted_by, expected_bay, created_at)
    values (v_touch, 'tenant_coolerco', coalesce(a.bar_code, a.name), a.local_code, a.name, v_wh.id, coalesce(v_wh.name, l.warehouse_group), 'daily',
            v_by, auth.uid(), 'Condition corrected at picking (COM had ' || coalesce(a.condition, '—') || ') · ' || p_case,
            a.assign_account, 'Asset Found in Expected Location', p_condition, a.brand_hierarchy, a.product_variant, a.product_base, a.serial_number,
            'Submitted', now(), v_by, public.coolerco_bay_for_status(a.asset_status), now());
  end if;
  -- 2) re-check with the real condition
  hard := array(select jsonb_array_elements_text(chk -> 'hard'));
  soft := array(select x from jsonb_array_elements_text(chk -> 'soft') x where x not in ('condition', 'upgrade_new'));
  if p_condition = 'A - New' and coalesce(l.req_condition, '') not in ('', 'A - New') then soft := soft || 'upgrade_new'::text; end if;
  if l.req_condition is not null and p_condition <> l.req_condition and p_condition <> 'A - New' then soft := soft || 'condition'::text; end if;
  chk := jsonb_set(jsonb_set(chk, '{soft}', to_jsonb(soft)), '{asset,condition}', to_jsonb(p_condition))
         || jsonb_build_object('touch_id', case when p_condition is distinct from a.condition then v_touch end);
  if cardinality(hard) > 0 then return chk || jsonb_build_object('ok', false, 'blocked', true, 'result', 'blocked'); end if;
  if cardinality(soft) > 0 then
    v_ovr := public.coolerco_pick_can_override(p_route);
    return chk || jsonb_build_object('ok', false, 'can_override', v_ovr,
      'result', case when v_ovr then 'needs_reason' else 'needs_supervisor' end, 'needs_supervisor', not v_ovr, 'needs_reason', v_ovr);
  end if;
  perform public.coolerco_pick_write(p_route, p_case, chk -> 'asset', coalesce(p_pick, false), coalesce(p_how, 'screen'),
    'COM condition was ' || coalesce(a.condition, '—') || ', really ' || p_condition, 'condition_corrected', p_client, true);
  return chk || jsonb_build_object('ok', true, 'result', case when p_pick then 'picked' else 'selected' end);
end $$;

-- 🙋 Ask a supervisor (stock controller / assistant): request + in-app alert to the warehouse's supervisors
create or replace function public.coolerco_override_request(p_route uuid, p_case text, p_asset text, p_kind text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare chk jsonb; v_id uuid; r public.routing_routes; v_by text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not public.coolerco_pick_writes_on() then return jsonb_build_object('error', 'writes_off'); end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then return jsonb_build_object('error', 'reason_required'); end if;
  if p_kind not in ('pick', 'select') then return jsonb_build_object('error', 'bad_kind'); end if;
  chk := public.coolerco_pick_problems(p_route, p_case, p_asset);
  if chk ? 'error' then return chk; end if;
  if jsonb_array_length(chk -> 'hard') > 0 then return chk || jsonb_build_object('error', 'blocked'); end if;
  select * into r from public.routing_routes where id = p_route;
  update public.coolerco_override_requests set status = 'cancelled', decided_at = now(), decided_by = v_by, decision_note = 'replaced by a new request'
   where route_id = p_route and case_number = p_case and status = 'pending';
  insert into public.coolerco_override_requests (kind, route_id, case_number, asset, bar_code, warehouse, problems, reason, requested_label)
  values (p_kind, p_route, p_case, p_asset, chk -> 'asset' ->> 'bar_code', r.warehouse_group, chk -> 'soft', left(trim(p_reason), 300), v_by)
  returning id into v_id;
  begin
    perform public.coolerco_notify('pick_override', p_case, null, public.coolerco_wh_code_for_group(r.warehouse_group), null,
      '🙋 Pick needs a supervisor: ' || coalesce(chk -> 'asset' ->> 'bar_code', p_asset) || ' for ' || coalesce(chk -> 'stop' ->> 'store', p_case),
      jsonb_build_object('request_id', v_id, 'route', r.route_number, 'problems', chk -> 'soft', 'reason', p_reason, 'by', v_by), 'high');
  exception when others then null;  -- an alert problem never blocks the request
  end;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ✅ / 🚫 Supervisor decides; approve = the selection (+ pick) is written with the request's reason
create or replace function public.coolerco_override_decide(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.coolerco_override_requests; chk jsonb; v_by text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  select * into q from public.coolerco_override_requests where id = p_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if q.status <> 'pending' then return jsonb_build_object('error', 'already_decided'); end if;
  if not public.coolerco_pick_can_override(q.route_id) then return jsonb_build_object('error', 'not_allowed'); end if;
  if p_approve then
    if not public.coolerco_pick_writes_on() then return jsonb_build_object('error', 'writes_off'); end if;
    perform pg_advisory_xact_lock(hashtext('coolerco_pick:' || q.asset));
    chk := public.coolerco_pick_problems(q.route_id, q.case_number, q.asset);
    if chk ? 'error' then return chk; end if;
    if jsonb_array_length(chk -> 'hard') > 0 then return chk || jsonb_build_object('error', 'blocked'); end if;
    perform public.coolerco_pick_write(q.route_id, q.case_number, chk -> 'asset', q.kind = 'pick', 'screen',
      q.reason || ' · approved by ' || v_by || coalesce(' (' || nullif(trim(p_note), '') || ')', ''),
      concat_ws(',', 'supervisor_override', nullif(array_to_string(array(select jsonb_array_elements_text(chk -> 'soft')), ','), '')), null, false);
  end if;
  update public.coolerco_override_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_by, decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '') where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Board (as 024) + may I override here + pending supervisor requests for these routes
create or replace function public.coolerco_pick_board(p_from date, p_to date, p_warehouse text default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'sign in'; end if;
  return jsonb_build_object('writes', public.coolerco_pick_writes_on(),
    'can_override', public.coolerco_can_override(public.coolerco_wh_code_for_group(p_warehouse)),
    'lines', coalesce((select jsonb_agg(to_jsonb(l)) from public.coolerco_pick_lines(p_from, p_to, p_warehouse) l), '[]'::jsonb),
    'overrides', coalesce((select jsonb_agg(to_jsonb(q) order by q.requested_at) from public.coolerco_override_requests q
                            join public.routing_routes r on r.id = q.route_id
                           where q.status = 'pending' and r.route_date between p_from and p_to
                             and (p_warehouse is null or r.warehouse_group = p_warehouse)), '[]'::jsonb));
end $$;

revoke all on function public.coolerco_wh_code_for_group(text) from public, anon;
revoke all on function public.coolerco_pick_can_override(uuid) from public, anon;
revoke all on function public.coolerco_pick_condition_fix(uuid, text, text, text, boolean, text, uuid) from public, anon;
revoke all on function public.coolerco_override_request(uuid, text, text, text, text) from public, anon;
revoke all on function public.coolerco_override_decide(uuid, boolean, text) from public, anon;
grant execute on function public.coolerco_wh_code_for_group(text) to authenticated;
grant execute on function public.coolerco_pick_can_override(uuid) to authenticated;
grant execute on function public.coolerco_pick_condition_fix(uuid, text, text, text, boolean, text, uuid) to authenticated;
grant execute on function public.coolerco_override_request(uuid, text, text, text, text) to authenticated;
grant execute on function public.coolerco_override_decide(uuid, boolean, text) to authenticated;
