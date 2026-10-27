-- CoolerCo-Ops · 011 · Driver "open in app" links for CoolerCo Field (no login for drivers)
-- ADDITIVE: one new table + three new functions (coolerco_ only). Routing tables, cases, contacts are only READ.
-- The routing app's own WhatsApp trip link is untouched and stays the backup.
-- A driver's personal code (8 letters/digits, easy to type) opens /field/d/<code>; the phone remembers it.

create table if not exists public.coolerco_field_driver_links (
  portal_username text primary key,                   -- routing_portal_users.portal_username (e.g. RTMAGTD7C)
  code            text not null unique,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      text,
  last_used_at    timestamptz
);
alter table public.coolerco_field_driver_links enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'coolerco_field_driver_links' and policyname = 'coolerco_field_driver_links_staff') then
    create policy coolerco_field_driver_links_staff on public.coolerco_field_driver_links for all to authenticated using (true) with check (true);
  end if;
end $$;
revoke all on public.coolerco_field_driver_links from anon;

-- Easy-to-type code: no 0/O, 1/I/L
create or replace function public.coolerco_field_new_code()
returns text language sql volatile set search_path = public, pg_temp as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 8)
$$;

-- Staff: create or renew a driver's code (renewing makes the old link stop working)
create or replace function public.coolerco_field_driver_link(p_username text, p_renew boolean default false)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v text;
begin
  if auth.role() <> 'authenticated' then raise exception 'Staff only'; end if;
  if not exists (select 1 from public.routing_portal_users where portal_username = p_username) then raise exception 'Unknown driver'; end if;
  select code into v from public.coolerco_field_driver_links where portal_username = p_username and active;
  if v is null or p_renew then
    loop
      v := public.coolerco_field_new_code();
      exit when not exists (select 1 from public.coolerco_field_driver_links where code = v);
    end loop;
    insert into public.coolerco_field_driver_links (portal_username, code, active, created_by)
    values (p_username, v, true, coalesce(auth.jwt() ->> 'email', 'staff'))
    on conflict (portal_username) do update set code = excluded.code, active = true, created_at = now(), created_by = excluded.created_by;
  end if;
  return v;
end $$;

-- Driver (no login): their trip for a day — same shape the Field app's "My trip" uses
create or replace function public.coolerco_field_trip(p_code text, p_date date default current_date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.coolerco_field_driver_links; d public.routing_portal_users; v_routes jsonb; v_ids uuid[]; v_stops jsonb; v_cases text[]; v_pos text[];
begin
  select * into l from public.coolerco_field_driver_links where code = upper(trim(p_code)) and active;
  if not found then return jsonb_build_object('error', 'invalid_code'); end if;
  select * into d from public.routing_portal_users where portal_username = l.portal_username;
  update public.coolerco_field_driver_links set last_used_at = now() where portal_username = l.portal_username;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.route_number), '[]'::jsonb), array_agg(r.id)
    into v_routes, v_ids
  from (select id, route_number, route_date, status, vehicle_code, warehouse_group, planned_start_at, planned_return_at, planned_distance_km, dispatched_at, completed_at
        from public.routing_routes where resource_username = l.portal_username and route_date = p_date and coalesce(status, '') <> 'not_used') r;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.route_id, s.stop_sequence), '[]'::jsonb), array_agg(distinct s.case_number), array_agg(distinct s.pos_local_code)
    into v_stops, v_cases, v_pos
  from (select st.id, st.route_id, st.stop_sequence, st.case_number, st.case_type, st.point_of_sale, st.pos_local_code, st.address, st.latitude, st.longitude,
               st.use_alternative_address, st.alternative_address, st.alternative_latitude, st.alternative_longitude,
               st.asset_barcodes, st.asset_product_bases, st.asset_count, st.planned_arrival_at, st.end_date,
               st.outcome_status, st.actual_case_status, st.outcome_recorded_at, st.outcome_reason
        from public.routing_route_stops st
        join public.routing_route_versions v on v.id = st.route_version_id and v.is_current
        where st.route_id = any(coalesce(v_ids, '{}'))) s;

  return jsonb_build_object(
    'driver', jsonb_build_object('username', d.portal_username, 'display', d.display_name, 'wh', d.warehouse_group, 'type', d.worker_type),
    'routes', v_routes, 'stops', v_stops,
    'cases', coalesce((select jsonb_agg(jsonb_build_object('case_number', c.case_number, 'status_reason', c.status_reason, 'sla_status', c.sla_status,
                          'end_date', c.end_date, 'service_closure_date', c.service_closure_date, 'requested_product_base', c.requested_product_base))
                       from public.cases c where c.case_number = any(coalesce(v_cases, '{}'))), '[]'::jsonb),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('pos_local_code', k.pos_local_code, 'customer_contact_name', k.customer_contact_name,
                          'mobile_phone', k.mobile_phone, 'business_phone', k.business_phone, 'customer_whatsapp', k.customer_whatsapp))
                       from public.routing_pos_contacts k where k.pos_local_code = any(coalesce(v_pos, '{}'))), '[]'::jsonb),
    'prep', coalesce((select jsonb_agg(jsonb_build_object('route_id', p.route_id, 'case_number', p.case_number, 'picked', p.picked, 'rtw', p.rtw,
                          'packed', p.packed, 'selected_bar_code', p.selected_bar_code))
                       from public.routing_warehouse_preparation p where p.route_id = any(coalesce(v_ids, '{}'))), '[]'::jsonb)
  );
end $$;

revoke all on function public.coolerco_field_new_code() from public, anon, authenticated;
revoke all on function public.coolerco_field_driver_link(text, boolean) from public, anon;
grant execute on function public.coolerco_field_driver_link(text, boolean) to authenticated;
revoke all on function public.coolerco_field_trip(text, date) from public;
grant execute on function public.coolerco_field_trip(text, date) to anon, authenticated;
