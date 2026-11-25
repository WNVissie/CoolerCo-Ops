-- 055 · Update store (outlet) details from a case + portal link for any outlet (Wanda 2026-11-25)
--   "Allow user to update POS detail in the ticket … also the GPS if it is wrong on the map"
--   "create a link inside the case of the outlet and send via WhatsApp to the customer"
-- Self-managed clients (Tiger, Demo …): CoolerCo owns the outlet register, so the change is saved straight away:
--   coolerco_outlets + the store details on that outlet's OPEN CoolerCo cases (so routing / Field app use the new details).
--   Every change is logged in coolerco_outlet_changes (who, when, old -> new, from which case).
-- Magnum (COM is master): NOT here. The app files a correction in coolerco_field_pos_reports (033, review list) instead.
-- Add-only. Rollback: coolerco_055_rollback.sql.

create table if not exists public.coolerco_outlet_changes (
  id          bigint generated always as identity primary key,
  client_code text not null,
  outlet_code text not null,
  case_number text,
  field       text not null,
  old_value   text,
  new_value   text,
  changed_by  text not null default coalesce(auth.jwt() ->> 'email', 'user'),
  changed_at  timestamptz not null default now()
);
create index if not exists idx_coolerco_outlet_changes_outlet on public.coolerco_outlet_changes (client_code, outlet_code, changed_at desc);
alter table public.coolerco_outlet_changes enable row level security;
revoke all on public.coolerco_outlet_changes from anon, authenticated;
grant select on public.coolerco_outlet_changes to authenticated;
drop policy if exists coolerco_outlet_changes_read on public.coolerco_outlet_changes;
create policy coolerco_outlet_changes_read on public.coolerco_outlet_changes for select to authenticated
  using (public.coolerco_can_see(client_code, null));

-- p = { name, contact_person, mobile_number, email, street_address, suburb, town, province, postal_code, latitude, longitude, notes }
-- Only the keys sent are changed. GPS must be inside South Africa.
create or replace function public.coolerco_outlet_update(p_client text, p_outlet text, p jsonb, p_case text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.coolerco_outlets; f text; v_old text; v_new text; v_n int := 0;
  v_lat double precision; v_lng double precision;
  v_fields text[] := array['name', 'contact_person', 'mobile_number', 'email', 'street_address', 'suburb', 'town', 'province', 'postal_code', 'notes'];
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not public.coolerco_is_self_managed(p_client) then return jsonb_build_object('error', 'com_master'); end if;
  if not (public.coolerco_is_planner() or public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier'])) then
    return jsonb_build_object('error', 'not_allowed'); end if;
  select * into o from public.coolerco_outlets where client_code = p_client and outlet_code = p_outlet for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if not public.coolerco_can_see(p_client, o.warehouse_code) then return jsonb_build_object('error', 'not_allowed'); end if;

  foreach f in array v_fields loop
    if p ? f then
      execute format('select ($1).%I::text', f) using o into v_old;
      v_new := nullif(trim(p ->> f), '');
      if f = 'name' and v_new is null then return jsonb_build_object('error', 'name_required'); end if;
      if v_new is distinct from v_old then
        execute format('update public.coolerco_outlets set %I = $1 where id = $2', f) using v_new, o.id;
        insert into public.coolerco_outlet_changes (client_code, outlet_code, case_number, field, old_value, new_value)
        values (p_client, p_outlet, p_case, f, v_old, v_new);
        v_n := v_n + 1;
      end if;
    end if;
  end loop;

  if p ? 'latitude' or p ? 'longitude' then
    v_lat := nullif(p ->> 'latitude', '')::double precision; v_lng := nullif(p ->> 'longitude', '')::double precision;
    if v_lat is null or v_lng is null or v_lat not between -35.5 and -21.5 or v_lng not between 16 and 33.5 then
      return jsonb_build_object('error', 'bad_gps'); end if;
    if v_lat is distinct from o.latitude or v_lng is distinct from o.longitude then
      update public.coolerco_outlets set latitude = v_lat, longitude = v_lng, gps_source = 'office_case',
             gps_set_by = coalesce(auth.jwt() ->> 'email', 'user'), gps_set_at = now() where id = o.id;
      insert into public.coolerco_outlet_changes (client_code, outlet_code, case_number, field, old_value, new_value)
      values (p_client, p_outlet, p_case, 'gps', concat_ws(', ', o.latitude, o.longitude), concat_ws(', ', v_lat, v_lng));
      v_n := v_n + 1;
    end if;
  end if;

  if v_n > 0 then
    update public.coolerco_outlets set updated_at = now(), updated_by = coalesce(auth.jwt() ->> 'email', 'user') where id = o.id;
    select * into o from public.coolerco_outlets where id = o.id;
    -- open cases of this outlet carry the new store details (closed cases keep what they had)
    update public.coolerco_cases k
       set point_of_sale = o.name,
           address = public.coolerco_outlet_address(p_client, p_outlet),
           latitude = o.latitude, longitude = o.longitude,
           case_contact_name = coalesce(o.contact_person, k.case_contact_name),
           case_mobile_number = coalesce(o.mobile_number, k.case_mobile_number)
     where k.client_code = p_client and k.pos_local_code = p_outlet and not public.coolerco_case_is_closed(k.status_reason);
  end if;
  return jsonb_build_object('ok', true, 'changed', v_n);
end $$;
revoke all on function public.coolerco_outlet_update(text, text, jsonb, text) from public, anon;
grant execute on function public.coolerco_outlet_update(text, text, jsonb, text) to authenticated;

-- Portal link for an outlet of any client: the existing one, or a new one with the outlet's contact.
-- Magnum outlets keep using coolerco_portal_link_for_pos (003).
create or replace function public.coolerco_portal_link_for_outlet(p_client text, p_outlet text)
returns public.coolerco_portal_links language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.coolerco_portal_links; o public.coolerco_outlets;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into r from public.coolerco_portal_links where pos_local_code = p_outlet limit 1;
  if found then return r; end if;
  select * into o from public.coolerco_outlets where client_code = p_client and outlet_code = p_outlet;
  if not found then raise exception 'Outlet % not found', p_outlet; end if;
  if not public.coolerco_can_see(p_client, o.warehouse_code) then raise exception 'Not allowed'; end if;
  insert into public.coolerco_portal_links (pos_local_code, point_of_sale, contact_name, mobile_number, email, client_code, created_by)
  values (p_outlet, o.name, o.contact_person, o.mobile_number, o.email, p_client, coalesce(auth.jwt() ->> 'email', 'user'))
  returning * into r;
  return r;
end $$;
revoke all on function public.coolerco_portal_link_for_outlet(text, text) from public, anon;
grant execute on function public.coolerco_portal_link_for_outlet(text, text) to authenticated;
