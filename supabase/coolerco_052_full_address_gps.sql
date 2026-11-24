-- ============================================================================
-- CoolerCo 052 - full outlet address on cases + GPS for outlets that have none
-- TEST first. Rollback: coolerco_052_rollback.sql (puts the 050 versions back).
-- Wanda 2026-11-24: add province and postal code (helps to identify the outlet);
-- let the user find the GPS point when an outlet has none.
--   * coolerco_outlets: gps_source, gps_set_by, gps_set_at (who added a missing point)
--   * coolerco_outlet_address(client, outlet) = street, suburb, town, province, postal code
--   * coolerco_case_create: case address = the full address; latitude / longitude on the
--     request fill a missing outlet GPS point (South Africa only), kept on the register
--   * coolerco_portal_submit: requests from outlets of self-managed clients carry the
--     full address and the GPS point too (Magnum outlets unchanged)
-- Plain ASCII, no apostrophes in comments.
-- ============================================================================
alter table public.coolerco_outlets add column if not exists gps_source text;
alter table public.coolerco_outlets add column if not exists gps_set_by text;
alter table public.coolerco_outlets add column if not exists gps_set_at timestamptz;

create or replace function public.coolerco_outlet_address(p_client text, p_outlet text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select nullif(concat_ws(', ', nullif(trim(o.street_address), ''), nullif(trim(o.suburb), ''), nullif(trim(o.town), ''),
                          nullif(trim(o.province), ''), nullif(trim(o.postal_code), '')), '')
    from public.coolerco_outlets o where o.client_code = p_client and o.outlet_code = p_outlet;
$$;
revoke all on function public.coolerco_outlet_address(text, text) from public, anon;
grant execute on function public.coolerco_outlet_address(text, text) to authenticated;

create or replace function public.coolerco_case_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_client text := nullif(p ->> 'client', '');
  v_type text := nullif(p ->> 'case_type', '');
  v_outlet_code text := nullif(p ->> 'outlet', '');
  v_asset_no text := nullif(p ->> 'asset', '');
  v_model_code text := nullif(p ->> 'model', '');
  v_sym text := nullif(p ->> 'symptom', '');
  v_imp text := nullif(p ->> 'product_impact', '');
  v_class text := nullif(p ->> 'sla_class', '');
  o public.coolerco_outlets; a public.coolerco_assets; m public.coolerco_asset_models; am public.coolerco_asset_models;
  ws public.coolerco_warehouse_settings;
  v_wh text; v_no text; v_open jsonb; v_pri text; v_rep text; v_lbl text; v_role text; v_prev text; v_prev_at timestamptz; v_days int;
  v_out_needed boolean := v_type in ('Deliver an Asset', 'Repair at Shopper POS', 'Removal of Asset', 'Replacement of Asset');
  v_lat float8 := nullif(p ->> 'latitude', '')::float8;
  v_lng float8 := nullif(p ->> 'longitude', '')::float8;
  v_asset_where text := case when v_type in ('Repair at Shopper POS', 'Removal of Asset', 'Replacement of Asset') then 'Outlet'
                             when v_type in ('Repair at Workshop', 'Decal @WH') then 'Warehouse' end;
begin
  select a2.role_code into v_role from public.coolerco_user_access a2
   where a2.user_id = auth.uid() and a2.active and a2.role_code <> 'viewer' order by a2.created_at limit 1;
  if v_role is null then return jsonb_build_object('error', 'not_allowed'); end if;
  if v_type is null or v_type not in ('Deliver an Asset', 'Repair at Shopper POS', 'Removal of Asset', 'Replacement of Asset', 'Repair at Workshop', 'Decal @WH') then
    return jsonb_build_object('error', 'bad_case_type');
  end if;
  if not public.coolerco_is_self_managed(v_client) then return jsonb_build_object('error', 'client_not_self_managed'); end if;

  if v_out_needed then
    select * into o from public.coolerco_outlets where client_code = v_client and outlet_code = v_outlet_code and active;
    if not found then return jsonb_build_object('error', 'outlet_not_found'); end if;
    v_wh := o.warehouse_code;
  end if;

  if v_asset_where is not null then
    select * into a from public.coolerco_assets where client_code = v_client and asset_number = v_asset_no;
    if not found then return jsonb_build_object('error', 'asset_not_found'); end if;
    if v_asset_where = 'Outlet' and (a.location_type <> 'Outlet' or a.location_code <> o.outlet_code) then
      return jsonb_build_object('error', 'asset_not_at_outlet');
    end if;
    if v_asset_where = 'Warehouse' and a.location_type <> 'Warehouse' then
      return jsonb_build_object('error', 'asset_not_in_warehouse');
    end if;
    v_wh := coalesce(v_wh, a.warehouse_code);
    select * into am from public.coolerco_asset_models where client_code = v_client and model_code = a.model_code;
    perform pg_advisory_xact_lock(hashtext('coolerco_asset:' || a.asset_number));
    v_open := public.coolerco_asset_open_case(a.asset_number);
    if v_open is not null then return jsonb_build_object('error', 'already_open') || v_open; end if;
  end if;

  if v_type in ('Deliver an Asset', 'Replacement of Asset') then
    select * into m from public.coolerco_asset_models where client_code = v_client and model_code = v_model_code and active;
    if not found then return jsonb_build_object('error', 'model_required'); end if;
  end if;

  if not public.coolerco_can_see(v_client, v_wh) then return jsonb_build_object('error', 'not_allowed'); end if;
  if (v_lat is null) <> (v_lng is null) or v_lat not between -35.5 and -21.5 or v_lng not between 16 and 33.5 then
    if v_lat is not null or v_lng is not null then return jsonb_build_object('error', 'bad_gps'); end if;
  end if;
  -- An outlet without a GPS point gets the one found on the form (kept on the register, with who and when)
  if v_out_needed and v_lat is not null and (o.latitude is null or o.longitude is null) then
    update public.coolerco_outlets
       set latitude = v_lat, longitude = v_lng, gps_source = coalesce(nullif(p ->> 'gps_source', ''), 'case form'),
           gps_set_by = coalesce(auth.jwt() ->> 'email', 'user'), gps_set_at = now(), updated_at = now()
     where client_code = o.client_code and outlet_code = o.outlet_code;
    o.latitude := v_lat; o.longitude := v_lng;
  end if;
  select * into ws from public.coolerco_warehouse_settings where warehouse_code = v_wh;
  if not found then return jsonb_build_object('error', 'no_warehouse'); end if;

  if v_type = 'Repair at Shopper POS' then
    if v_sym is null or not exists (select 1 from public.coolerco_symptoms where code = v_sym and active) then
      return jsonb_build_object('error', 'symptom_required');
    end if;
    v_pri := public.coolerco_priority_for(v_sym, v_imp);
    select coalesce((value #>> '{}')::int, 30) into v_days from public.coolerco_settings where key = 'repeat_repair_days';
    select k.case_number, coalesce(k.service_closure_date, k.updated_at) into v_prev, v_prev_at
      from public.coolerco_cases k
     where k.asset_repaired = a.asset_number and k.status_reason in ('Completed', 'Closed', 'Solved', 'Resolved')
       and coalesce(k.service_closure_date, k.updated_at) > now() - make_interval(days => coalesce(v_days, 30))
     order by coalesce(k.service_closure_date, k.updated_at) desc limit 1;
  else
    v_sym := null; v_imp := null;
    v_pri := coalesce(nullif(p ->> 'priority', ''), 'Medium');
  end if;
  if v_class is not null and not (public.coolerco_is_planner() and exists (select 1 from public.coolerco_sla_classes where code = v_class and active)) then
    v_class := null;
  end if;

  select w.concessionaire into v_rep from public.coolerco_pos_warehouse w where w.pos_local_code = o.outlet_code;
  v_lbl := coalesce(auth.jwt() ->> 'email', 'user');
  v_no := public.coolerco_next_case_number(v_wh);

  insert into public.coolerco_cases (
    case_number, client_code, case_type, status_reason, motive, originator, origin, priority,
    warehouse_code, warehouse_workshop, responsible_ordering_party, point_of_sale, pos_local_code,
    latitude, longitude, address, case_contact_name, case_mobile_number,
    asset_type, mapped_asset, asset_removed, asset_repaired, asset_condition,
    requested_product_base, requested_asset_condition, requested_brand_hierarchy, description, photo_paths,
    symptom_code, product_impact, priority_source, priority_set_by, priority_set_at,
    repeat_of_case, repeat_days, sla_class, sla_override,
    created_by_user_id, created_by_label, approved_by, approved_at, tenant_id)
  values (
    v_no, v_client, v_type, 'Open', 'LOGGED_IN_APP',
    case when v_role = 'client' then 'Client' else 'CoolerCo' end, 'App', v_pri,
    v_wh, ws.com_name, v_rep, o.name, o.outlet_code,
    o.latitude, o.longitude, public.coolerco_outlet_address(o.client_code, o.outlet_code),
    coalesce(nullif(p ->> 'contact_name', ''), o.contact_person), coalesce(nullif(p ->> 'contact_mobile', ''), o.mobile_number),
    coalesce(am.asset_type, m.asset_type), a.asset_number,
    case when v_type in ('Removal of Asset', 'Replacement of Asset') then a.asset_number end,
    case when v_type in ('Repair at Shopper POS', 'Repair at Workshop', 'Decal @WH') then a.asset_number end,
    a.condition,
    m.description, nullif(p ->> 'condition', ''), nullif(p ->> 'branding', ''), left(p ->> 'description', 2000),
    (select array_agg(x) from jsonb_array_elements_text(coalesce(p -> 'photos', '[]'::jsonb)) x),
    v_sym, v_imp, case when v_sym is not null then 'auto' else 'user' end, v_lbl, now(),
    v_prev, case when v_prev_at is not null then greatest(0, floor(extract(epoch from now() - v_prev_at) / 86400))::int end,
    v_class, v_class is not null,
    auth.uid(), v_lbl, v_lbl, now(),
    (select w.tenant_id from public.warehouses w where w.code = v_wh));

  insert into public.coolerco_case_events (case_number, event_type, from_status, to_status, reason_code, notes, actor_type, actor_user_id, actor_label)
  values (v_no, 'status', null, 'Open', 'LOGGED_IN_APP', left(p ->> 'description', 500),
          case when v_role = 'client' then 'client' else 'staff' end, auth.uid(), v_lbl);

  return (select jsonb_build_object('case_number', k.case_number, 'status', k.status_reason, 'sla_class', k.sla_class,
                                    'due', k.end_date, 'priority', k.priority, 'repeat_of', k.repeat_of_case)
            from public.coolerco_cases k where k.case_number = v_no);
end $$;

create or replace function public.coolerco_portal_submit(p_token text, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l public.coolerco_portal_links; pw public.coolerco_pos_warehouse; ws public.coolerco_warehouse_settings;
  kind text := p_request ->> 'kind'; v_type text; v_fam uuid; v_no text; v_lim int; v_today int; v_self boolean;
  v_name text; v_atype text; v_cond text; v_req text;
begin
  select * into l from public.coolerco_portal_links where token = p_token and active;
  if not found then return jsonb_build_object('error', 'invalid_link'); end if;
  v_self := public.coolerco_is_self_managed(l.client_code);
  select (value #>> '{}')::int into v_lim from public.coolerco_settings where key = 'portal_daily_request_limit';
  select count(*) into v_today from public.coolerco_cases where portal_link_id = l.id and created_on > now() - interval '1 day';
  if v_today >= coalesce(v_lim, 10) then return jsonb_build_object('error', 'daily_limit'); end if;
  select * into pw from public.coolerco_pos_warehouse where pos_local_code = l.pos_local_code;
  if pw.warehouse_code is null then return jsonb_build_object('error', 'no_warehouse'); end if;
  select * into ws from public.coolerco_warehouse_settings where warehouse_code = pw.warehouse_code;
  v_type := case kind when 'repair' then 'Repair at Shopper POS' when 'collection' then 'Removal of Asset' when 'new' then 'Deliver an Asset' end;
  if v_type is null then return jsonb_build_object('error', 'bad_request_type'); end if;
  if kind in ('repair', 'collection') then
    if v_self then
      select a.asset_number, m.asset_type, a.condition into v_name, v_atype, v_cond
        from public.coolerco_assets a
        left join public.coolerco_asset_models m on m.client_code = a.client_code and m.model_code = a.model_code
       where a.client_code = l.client_code and a.asset_number = p_request ->> 'asset'
         and a.location_type = 'Outlet' and a.location_code = l.pos_local_code;
    else
      select a.name, a.asset_type, a.condition into v_name, v_atype, v_cond from public.assets_live a
       where a.name = p_request ->> 'asset' and a.assign_account_local_code = l.pos_local_code and a.asset_location = 'Location';
    end if;
    if v_name is null then return jsonb_build_object('error', 'asset_not_at_store'); end if;
  elsif v_self then
    select m.description, m.asset_type into v_req, v_atype from public.coolerco_asset_models m
     where m.client_code = l.client_code and m.active
       and m.model_code = coalesce(nullif(p_request ->> 'model_code', ''), p_request ->> 'family_id');
    if v_req is null then return jsonb_build_object('error', 'bad_family'); end if;
  else
    v_fam := nullif(p_request ->> 'family_id', '')::uuid;
    if v_fam is null or not exists (select 1 from public.coolerco_product_families where id = v_fam and active and show_in_portal) then
      return jsonb_build_object('error', 'bad_family');
    end if;
  end if;
  v_no := public.coolerco_next_case_number(pw.warehouse_code);
  insert into public.coolerco_cases (
    case_number, case_type, status_reason, motive, originator, origin, priority,
    warehouse_code, warehouse_workshop, responsible_ordering_party, point_of_sale, pos_local_code,
    case_contact_name, case_contact_number, case_mobile_number,
    asset_type, mapped_asset, asset_removed, asset_repaired, asset_condition,
    requested_family_id, requested_product_base, description, photo_paths, sla_days, portal_link_id, created_by_label, client_code, tenant_id,
    address, latitude, longitude)
  values (
    v_no, v_type, 'Waiting for Approval', 'PORTAL_REQUEST', 'Customer', 'Portal', nullif(p_request ->> 'priority', ''),
    pw.warehouse_code, ws.com_name, pw.concessionaire, coalesce(l.point_of_sale, pw.point_of_sale), l.pos_local_code,
    coalesce(nullif(p_request ->> 'contact_name', ''), l.contact_name),
    coalesce(nullif(p_request ->> 'contact_phone', ''), l.contact_number), l.mobile_number,
    v_atype, v_name,
    case when kind = 'collection' then v_name end,
    case when kind = 'repair' then v_name end,
    v_cond, v_fam, v_req, left(p_request ->> 'description', 2000),
    (select array_agg(x) from jsonb_array_elements_text(coalesce(p_request -> 'photos', '[]'::jsonb)) x where x like 'portal/' || p_token || '/%'),
    ws.default_sla_days, l.id,
    'Portal: ' || coalesce(nullif(p_request ->> 'contact_name', ''), l.contact_name, 'customer'),
    case when v_self then l.client_code end,
    case when v_self then (select w.tenant_id from public.warehouses w where w.code = pw.warehouse_code) end,
    case when v_self then public.coolerco_outlet_address(l.client_code, l.pos_local_code) end,
    case when v_self then (select o.latitude from public.coolerco_outlets o where o.client_code = l.client_code and o.outlet_code = l.pos_local_code) end,
    case when v_self then (select o.longitude from public.coolerco_outlets o where o.client_code = l.client_code and o.outlet_code = l.pos_local_code) end);
  insert into public.coolerco_case_events (case_number, from_status, to_status, reason_code, notes, actor_type, actor_label)
  values (v_no, null, 'Waiting for Approval', 'PORTAL_REQUEST', left(p_request ->> 'description', 500), 'customer',
          coalesce(nullif(p_request ->> 'contact_name', ''), l.contact_name, 'customer'));
  return jsonb_build_object('case_number', v_no);
end $$;

-- Check
select outlet_code, public.coolerco_outlet_address(client_code, outlet_code) as address, latitude, longitude
  from public.coolerco_outlets where client_code in ('DEMO', 'DEMOFOODS') order by outlet_code limit 3;
