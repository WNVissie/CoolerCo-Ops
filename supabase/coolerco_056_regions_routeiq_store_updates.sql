-- 056 · Regions for self-managed clients + Magnum store corrections straight into RouteIQ (Wanda 2026-11-25)
--
-- A) REGIONS ("We should build Tiger regions — Inland and Coastal for now, allow more, link the customer to a region
--    like we use the concessionaires")
--    A region is a Responsible Ordering Party (coolerco_concessionaires) with kind = 'region'. It works exactly like a
--    concessionaire / rep: its users get the same portal link + PIN, approve their own customers' requests and see
--    their cases. The customer (outlet) is linked through the same field the concessionaires use:
--    coolerco_pos_warehouse.concessionaire (= the ROP name new cases carry), plus coolerco_outlets.region for filters.
--    Seeded: Tiger Inland, Tiger Coastal. More can be added from the app (coolerco_rop_add).
--    REPRESENTATIVES UNDER A REGION (Wanda: "region and then under the region — representatives"): a rep is a
--    coolerco_concessionaires row (kind 'representative') with parent_id = its region and a rep_code. The store is linked
--    to the REGION (its Responsible Ordering Party, carried on cases) and to its rep through coolerco_outlets.rep_code.
--    Region users see + approve all the region's stores; a rep user only the stores with their rep_code.
--    Concessionaires (Magnum) have no parent → their portal works exactly as before.
--    On TEST the demo reps move under new regions Demo Inland / Demo Coastal (+ Demo Foods Inland / Coastal);
--    their links and PINs keep working.
--
-- B) MAGNUM STORE CORRECTIONS → ROUTEIQ ("Magnum store corrections should update into RouteIQ")
--    Writes the same tables, the same way, as RouteIQ's own POS Reconciliations (apply_routing_pos_reconciliation):
--      name / address → routing_pos_detail_overrides · GPS → pos_coordinates · contact → routing_pos_contacts
--      (+ a history row in routing_pos_contact_changes). RouteIQ's code is NOT changed; it simply reads these tables.
--    Every change is also logged in coolerco_outlet_changes (client MAGNUM) = the "to fix in COM" list, because COM keeps
--    the old details until someone fixes them there. Customer contact updates approved in the Inbox for a Magnum store
--    go to routing_pos_contacts the same way (trigger).
--    NOTE TEST: routing_pos_contacts is in the 08:30 / 19:30 copy from production, so on TEST a contact change can be
--    overwritten by production's row at the next copy. Names, addresses and GPS are not copied, so they stay.
--
-- Add-only (coolerco_ objects + rows in RouteIQ's correction tables). Rollback: coolerco_056_rollback.sql.

-- ── A) regions ───────────────────────────────────────────────────────────────────────────────────────────────
alter table public.coolerco_outlet_changes add column if not exists com_fixed_at timestamptz;
alter table public.coolerco_outlet_changes add column if not exists com_fixed_by text;
alter table public.coolerco_concessionaires add column if not exists parent_id uuid references public.coolerco_concessionaires(id);
alter table public.coolerco_concessionaires add column if not exists rep_code text;
create unique index if not exists ux_coolerco_conc_rep_code on public.coolerco_concessionaires (client_code, rep_code) where rep_code is not null;

insert into public.coolerco_concessionaires (display_name, kind, client_code, active, notes)
select v.n, 'region', 'TIGER', true, 'Region (056) — outlets are linked to it like to a concessionaire'
  from (values ('Tiger Inland'), ('Tiger Coastal')) v(n)
 where exists (select 1 from public.coolerco_clients where code = 'TIGER')
on conflict (display_name) do nothing;
insert into public.coolerco_concessionaire_names (rop_name, concessionaire_id)
select upper(c.display_name), c.id from public.coolerco_concessionaires c
 where c.display_name in ('Tiger Inland', 'Tiger Coastal')
on conflict (rop_name) do nothing;

-- add a region / rep / concessionaire for a client (office roles). A rep needs its region (p_parent); it gets a rep_code.
create or replace function public.coolerco_rop_add(p_client text, p_name text, p_kind text default 'region', p_parent uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_name text := nullif(trim(p_name), ''); v_par public.coolerco_concessionaires; v_code text;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not (public.coolerco_is_planner() or public.coolerco_has_role(array['system_admin', 'administrator', 'manager'])) then
    return jsonb_build_object('error', 'not_allowed'); end if;
  if v_name is null then return jsonb_build_object('error', 'name_required'); end if;
  if p_kind not in ('region', 'representative', 'concessionaire') then return jsonb_build_object('error', 'bad_kind'); end if;
  if not exists (select 1 from public.coolerco_clients where code = p_client) then return jsonb_build_object('error', 'bad_client'); end if;
  if p_kind = 'representative' then
    select * into v_par from public.coolerco_concessionaires where id = p_parent and active and parent_id is null;
    if not found or v_par.client_code is distinct from p_client then return jsonb_build_object('error', 'parent_required'); end if;
    v_code := 'REP-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  elsif p_parent is not null then return jsonb_build_object('error', 'bad_kind');
  end if;
  if exists (select 1 from public.coolerco_concessionaires where lower(display_name) = lower(v_name))
     or exists (select 1 from public.coolerco_concessionaire_names where rop_name = upper(v_name)) then
    return jsonb_build_object('error', 'exists'); end if;
  insert into public.coolerco_concessionaires (display_name, kind, client_code, active, notes, parent_id, rep_code)
  values (v_name, p_kind, p_client, true, 'Added in the app by ' || coalesce(auth.jwt() ->> 'email', 'user'), p_parent, v_code)
  returning id into v_id;
  insert into public.coolerco_concessionaire_names (rop_name, concessionaire_id) values (upper(v_name), v_id);
  return jsonb_build_object('ok', true, 'id', v_id, 'rep_code', v_code);
end $$;

-- link outlets (customers) of a self-managed client to a region (or concessionaire) or to a rep under a region.
--   rep    → the store's ROP = the rep's region; store's rep_code = the rep
--   region → the store's ROP = the region; its rep stays only if that rep belongs to this region
-- Open cases of the store follow (their Responsible Ordering Party = the region).
create or replace function public.coolerco_outlets_set_rop(p_client text, p_outlets text[], p_rop uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.coolerco_concessionaires; reg public.coolerco_concessionaires; v_name text; o public.coolerco_outlets;
        v_n int := 0; v_old text; v_rep text;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not public.coolerco_is_self_managed(p_client) then return jsonb_build_object('error', 'com_master'); end if;
  if not (public.coolerco_is_planner() or public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier'])) then
    return jsonb_build_object('error', 'not_allowed'); end if;
  select * into r from public.coolerco_concessionaires where id = p_rop and active;
  if not found or r.client_code is distinct from p_client then return jsonb_build_object('error', 'bad_rop'); end if;
  if r.parent_id is not null then select * into reg from public.coolerco_concessionaires where id = r.parent_id; else reg := r; end if;
  select min(rop_name) into v_name from public.coolerco_concessionaire_names where concessionaire_id = reg.id;
  v_name := coalesce(v_name, upper(reg.display_name));
  for o in select * from public.coolerco_outlets where client_code = p_client and outlet_code = any (p_outlets) loop
    if not public.coolerco_can_see(p_client, o.warehouse_code) then continue; end if;
    select concessionaire into v_old from public.coolerco_pos_warehouse where pos_local_code = o.outlet_code;
    insert into public.coolerco_pos_warehouse (pos_local_code, point_of_sale, concessionaire, warehouse_code, source, needs_review, updated_at, updated_by)
    values (o.outlet_code, o.name, v_name, o.warehouse_code, 'coolerco_056', false, now(), coalesce(auth.jwt() ->> 'email', 'user'))
    on conflict (pos_local_code) do update set concessionaire = excluded.concessionaire, updated_at = now(), updated_by = excluded.updated_by;
    v_rep := case when r.parent_id is not null then r.rep_code
                  when exists (select 1 from public.coolerco_concessionaires x where x.client_code = p_client and x.rep_code = o.rep_code and x.parent_id = reg.id) then o.rep_code
                  else null end;
    update public.coolerco_outlets set region = case when reg.kind = 'region' then reg.display_name else region end, rep_code = v_rep,
           updated_at = now(), updated_by = coalesce(auth.jwt() ->> 'email', 'user') where id = o.id;
    update public.coolerco_cases set responsible_ordering_party = v_name
     where client_code = p_client and pos_local_code = o.outlet_code and not public.coolerco_case_is_closed(status_reason);
    insert into public.coolerco_outlet_changes (client_code, outlet_code, field, old_value, new_value)
    values (p_client, o.outlet_code, 'responsible_ordering_party', concat_ws(' · rep ', v_old, o.rep_code), concat_ws(' · rep ', v_name, v_rep));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'linked', v_n, 'rop', v_name, 'rep', case when r.parent_id is not null then r.display_name end);
end $$;

-- ── A2) the ROP portal (/c/<link>) follows the hierarchy ────────────────────────────────────────────────────
-- Keep the current definitions so the rollback can put them back exactly.
create table if not exists public.coolerco_fn_backup (script text, fn text, def text not null, saved_at timestamptz not null default now(), primary key (script, fn));
alter table public.coolerco_fn_backup enable row level security;
revoke all on public.coolerco_fn_backup from anon, authenticated;
insert into public.coolerco_fn_backup (script, fn, def)
select '056', p.proname, pg_get_functiondef(p.oid) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
 where p.proname in ('coolerco_conc_owns_pos', 'coolerco_conc_stores', 'coolerco_conc_cases', 'coolerco_conc_context')
on conflict (script, fn) do nothing;

-- does this ROP (or rep) look after this store?  no parent = as before (store linked to it); rep = store of its region with its rep_code
create or replace function public.coolerco_conc_owns_pos(p_conc uuid, p_pos text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.coolerco_concessionaires me
      join public.coolerco_pos_warehouse w on w.pos_local_code = p_pos
      join public.coolerco_concessionaire_names n on n.rop_name = w.concessionaire
     where me.id = p_conc
       and ((me.parent_id is null and n.concessionaire_id = me.id)
         or (me.parent_id is not null and n.concessionaire_id = me.parent_id
             and exists (select 1 from public.coolerco_outlets o where o.outlet_code = p_pos and o.rep_code = me.rep_code))))
$$;

create or replace function public.coolerco_conc_stores(p_session text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.coolerco_conc_sessions; v_top uuid;
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  select coalesce(parent_id, id) into v_top from public.coolerco_concessionaires where id = s.concessionaire_id;
  return coalesce((select jsonb_agg(jsonb_build_object('pos', w.pos_local_code, 'name', w.point_of_sale, 'warehouse', w.warehouse_code,
            'rep', (select x.display_name from public.coolerco_outlets o join public.coolerco_concessionaires x on x.rep_code = o.rep_code and x.client_code = o.client_code
                     where o.outlet_code = w.pos_local_code limit 1),
            'assets', (select count(*) from public.assets_live a where a.assign_account_local_code = w.pos_local_code and a.asset_location = 'Location')
                    + (select count(*) from public.coolerco_assets a where a.location_code = w.pos_local_code and a.location_type = 'Outlet'))
            order by w.point_of_sale)
    from public.coolerco_pos_warehouse w join public.coolerco_concessionaire_names n on n.rop_name = w.concessionaire
    where n.concessionaire_id = v_top and public.coolerco_conc_owns_pos(s.concessionaire_id, w.pos_local_code)), '[]'::jsonb);
end $$;

-- coolerco_conc_cases + coolerco_conc_context: same functions, one condition changed each (patched in place, so the rest stays identical)
do $patch$
declare d text;
  o1 text := 'join public.coolerco_concessionaire_names n on n.rop_name = c.responsible_ordering_party and n.concessionaire_id = s.concessionaire_id';
  n1 text := 'join lateral (select 1) n on ((c.source = ''COM'' and exists (select 1 from public.coolerco_concessionaire_names nn where nn.rop_name = c.responsible_ordering_party and nn.concessionaire_id = s.concessionaire_id)) or (c.source = ''CoolerCo'' and public.coolerco_conc_owns_pos(s.concessionaire_id, c.pos_local_code)))';
  o2 text := 'select count(*) from public.coolerco_pos_warehouse w join public.coolerco_concessionaire_names n on n.rop_name = w.concessionaire where n.concessionaire_id = c.id';
  n2 text := 'select count(*) from public.coolerco_pos_warehouse w join public.coolerco_concessionaire_names n on n.rop_name = w.concessionaire where n.concessionaire_id = coalesce(c.parent_id, c.id) and public.coolerco_conc_owns_pos(c.id, w.pos_local_code)';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public' where p.proname = 'coolerco_conc_cases';
  if position(n1 in d) = 0 then
    if position(o1 in d) = 0 then raise exception '056: coolerco_conc_cases is not the expected version (051) - nothing changed'; end if;
    execute replace(d, o1, n1);
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public' where p.proname = 'coolerco_conc_context';
  if position(n2 in d) = 0 then
    if position(o2 in d) = 0 then raise exception '056: coolerco_conc_context is not the expected version - nothing changed'; end if;
    execute replace(d, o2, n2);
  end if;
end $patch$;

-- ── B) Magnum store corrections → RouteIQ's tables ───────────────────────────────────────────────────────────
-- p = { name, address, latitude, longitude, contact_name, mobile }  (only the keys sent are changed)
create or replace function public.coolerco_magnum_store_update(p_pos text, p jsonb, p_case text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_code text := upper(trim(coalesce(p_pos, ''))); v_who text := coalesce(auth.jwt() ->> 'email', 'user');
  v_pos_name text; v_old jsonb; v_new jsonb; v_lat numeric; v_lng numeric; v_phone text; v_n int := 0; v_txt text;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not public.coolerco_can_see_magnum() then return jsonb_build_object('error', 'not_allowed'); end if;
  if not (public.coolerco_is_planner() or public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier'])) then
    return jsonb_build_object('error', 'not_allowed'); end if;
  if v_code = '' then return jsonb_build_object('error', 'not_found'); end if;
  select point_of_sale into v_pos_name from public.cases where pos_local_code = v_code order by created_on desc limit 1;
  if v_pos_name is null then return jsonb_build_object('error', 'not_found'); end if;

  v_txt := nullif(trim(p ->> 'name'), '');
  if v_txt is not null then
    select to_jsonb(x.corrected_name) into v_old from public.routing_pos_detail_overrides x where x.pos_local_code = v_code;
    insert into public.routing_pos_detail_overrides (pos_local_code, original_name, corrected_name)
    values (v_code, v_pos_name, v_txt)
    on conflict (pos_local_code) do update set corrected_name = excluded.corrected_name, updated_at = now();
    insert into public.coolerco_outlet_changes (client_code, outlet_code, case_number, field, old_value, new_value)
    values ('MAGNUM', v_code, p_case, 'name', coalesce(v_old #>> '{}', v_pos_name), v_txt);
    v_n := v_n + 1;
  end if;

  v_txt := nullif(trim(p ->> 'address'), '');
  if v_txt is not null then
    select to_jsonb(x.corrected_address) into v_old from public.routing_pos_detail_overrides x where x.pos_local_code = v_code;
    insert into public.routing_pos_detail_overrides (pos_local_code, original_name, corrected_address)
    values (v_code, v_pos_name, v_txt)
    on conflict (pos_local_code) do update set corrected_address = excluded.corrected_address, updated_at = now();
    insert into public.coolerco_outlet_changes (client_code, outlet_code, case_number, field, old_value, new_value)
    values ('MAGNUM', v_code, p_case, 'address', v_old #>> '{}', v_txt);
    v_n := v_n + 1;
  end if;

  if p ? 'latitude' or p ? 'longitude' then
    v_lat := nullif(p ->> 'latitude', '')::numeric; v_lng := nullif(p ->> 'longitude', '')::numeric;
    if v_lat is null or v_lng is null or v_lat not between -35 and -22 or v_lng not between 16 and 33 then
      return jsonb_build_object('error', 'bad_gps'); end if;
    select jsonb_build_object('lat', x.latitude, 'lng', x.longitude) into v_old from public.pos_coordinates x where x.pos_local_code = v_code;
    insert into public.pos_coordinates (pos_local_code, point_of_sale, latitude, longitude, source)
    values (v_code, v_pos_name, v_lat, v_lng, 'coolerco_office')
    on conflict (pos_local_code) do update set latitude = excluded.latitude, longitude = excluded.longitude, source = excluded.source;
    insert into public.coolerco_outlet_changes (client_code, outlet_code, case_number, field, old_value, new_value)
    values ('MAGNUM', v_code, p_case, 'gps', concat_ws(', ', v_old ->> 'lat', v_old ->> 'lng'), concat_ws(', ', v_lat, v_lng));
    v_n := v_n + 1;
  end if;

  if nullif(trim(coalesce(p ->> 'contact_name', '')), '') is not null or nullif(trim(coalesce(p ->> 'mobile', '')), '') is not null then
    v_phone := regexp_replace(coalesce(p ->> 'mobile', ''), '[^0-9]', '', 'g');
    if v_phone ~ '^0[0-9]{9}$' then v_phone := '27' || substring(v_phone from 2); end if;
    if v_phone <> '' and v_phone !~ '^27[0-9]{9}$' then return jsonb_build_object('error', 'bad_phone'); end if;
    select to_jsonb(x) into v_old from public.routing_pos_contacts x where x.pos_local_code = v_code;
    insert into public.routing_pos_contacts (pos_local_code, point_of_sale, customer_contact_name, customer_whatsapp, mobile_phone, source, is_verified)
    values (v_code, v_pos_name, nullif(trim(p ->> 'contact_name'), ''), nullif(v_phone, ''), nullif(v_phone, ''), 'coolerco_office', true)
    on conflict (pos_local_code) do update set
      customer_contact_name = coalesce(excluded.customer_contact_name, routing_pos_contacts.customer_contact_name),
      customer_whatsapp = coalesce(excluded.customer_whatsapp, routing_pos_contacts.customer_whatsapp),
      mobile_phone = coalesce(excluded.mobile_phone, routing_pos_contacts.mobile_phone),
      source = excluded.source, is_verified = true, updated_at = now();
    select to_jsonb(x) into v_new from public.routing_pos_contacts x where x.pos_local_code = v_code;
    insert into public.routing_pos_contact_changes (pos_local_code, before_values, after_values, recorded_by, source)
    values (v_code, coalesce(v_old, '{}'::jsonb), coalesce(v_new, '{}'::jsonb), v_who, 'coolerco_office');
    insert into public.coolerco_outlet_changes (client_code, outlet_code, case_number, field, old_value, new_value)
    values ('MAGNUM', v_code, p_case, 'contact', concat_ws(' · ', v_old ->> 'customer_contact_name', v_old ->> 'customer_whatsapp'),
            concat_ws(' · ', v_new ->> 'customer_contact_name', v_new ->> 'customer_whatsapp'));
    v_n := v_n + 1;
  end if;
  return jsonb_build_object('ok', true, 'changed', v_n);
end $$;

-- Customer contact updates approved in the Inbox for a Magnum store → RouteIQ's contact table too (never blocks the approval)
create or replace function public.coolerco_contact_update_to_routeiq()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old jsonb; v_new jsonb; v_phone text; v_name text;
begin
  if new.status is distinct from 'Approved' or old.status = 'Approved' then return new; end if;
  if exists (select 1 from public.coolerco_outlets where outlet_code = new.pos_local_code) then return new; end if; -- self-managed: not RouteIQ
  begin
    v_phone := regexp_replace(coalesce(new.proposed_values ->> 'mobile_number', ''), '[^0-9]', '', 'g');
    if v_phone ~ '^0[0-9]{9}$' then v_phone := '27' || substring(v_phone from 2); end if;
    if v_phone !~ '^27[0-9]{9}$' then v_phone := null; end if;
    v_name := nullif(trim(coalesce(new.proposed_values ->> 'contact_name', '')), '');
    if v_phone is null and v_name is null then return new; end if;
    select to_jsonb(x) into v_old from public.routing_pos_contacts x where x.pos_local_code = new.pos_local_code;
    insert into public.routing_pos_contacts (pos_local_code, customer_contact_name, customer_whatsapp, mobile_phone, source, is_verified)
    values (new.pos_local_code, v_name, v_phone, v_phone, 'coolerco_customer', true)
    on conflict (pos_local_code) do update set
      customer_contact_name = coalesce(excluded.customer_contact_name, routing_pos_contacts.customer_contact_name),
      customer_whatsapp = coalesce(excluded.customer_whatsapp, routing_pos_contacts.customer_whatsapp),
      mobile_phone = coalesce(excluded.mobile_phone, routing_pos_contacts.mobile_phone),
      source = excluded.source, is_verified = true, updated_at = now();
    select to_jsonb(x) into v_new from public.routing_pos_contacts x where x.pos_local_code = new.pos_local_code;
    insert into public.routing_pos_contact_changes (pos_local_code, before_values, after_values, recorded_by, source)
    values (new.pos_local_code, coalesce(v_old, '{}'::jsonb), coalesce(v_new, '{}'::jsonb), coalesce(new.decided_by, 'customer portal'), 'coolerco_customer');
  exception when others then
    raise warning 'coolerco_contact_update_to_routeiq: %', sqlerrm;  -- the approval itself always goes through
  end;
  return new;
end $$;
drop trigger if exists coolerco_contact_update_to_routeiq on public.coolerco_contact_update_requests;
create trigger coolerco_contact_update_to_routeiq after update of status on public.coolerco_contact_update_requests
  for each row execute function public.coolerco_contact_update_to_routeiq();

-- "to fix in COM": mark a Magnum change as done in COM
create or replace function public.coolerco_outlet_change_com_fixed(p_ids bigint[])
returns int language sql security definer set search_path = public, pg_temp as $$
  with u as (
    update public.coolerco_outlet_changes set com_fixed_at = now(), com_fixed_by = coalesce(auth.jwt() ->> 'email', 'user')
     where id = any (p_ids) and client_code = 'MAGNUM' and com_fixed_at is null
       and (public.coolerco_is_planner() or public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supplier']))
    returning 1)
  select count(*)::int from u
$$;

revoke all on function public.coolerco_rop_add(text, text, text, uuid) from public, anon;
revoke all on function public.coolerco_outlets_set_rop(text, text[], uuid) from public, anon;
revoke all on function public.coolerco_magnum_store_update(text, jsonb, text) from public, anon;
revoke all on function public.coolerco_outlet_change_com_fixed(bigint[]) from public, anon;
revoke all on function public.coolerco_contact_update_to_routeiq() from public, anon, authenticated;
grant execute on function public.coolerco_rop_add(text, text, text, uuid) to authenticated;
grant execute on function public.coolerco_outlets_set_rop(text, text[], uuid) to authenticated;
grant execute on function public.coolerco_magnum_store_update(text, jsonb, text) to authenticated;
grant execute on function public.coolerco_outlet_change_com_fixed(bigint[]) to authenticated;

-- ── C) TEST only: demo reps move under regions (Demo Inland = Gauteng stores, Demo Coastal = Durban stores) ─────
do $demo$
declare c text; wh text; reg text; rid uuid; rp record;
begin
  if not public.coolerco_is_test_db() or not exists (select 1 from public.coolerco_clients where code = 'DEMO') then return; end if;
  foreach c in array array['DEMO', 'DEMOFOODS'] loop
    foreach wh in array array['WH-DM-JHB', 'WH-DM-DBN'] loop
      reg := case c when 'DEMO' then 'Demo' else 'Demo Foods' end || case wh when 'WH-DM-JHB' then ' Inland' else ' Coastal' end;
      insert into public.coolerco_concessionaires (display_name, kind, client_code, active, notes)
      values (reg, 'region', c, true, 'Demo region (056)') on conflict (display_name) do nothing;
      select id into rid from public.coolerco_concessionaires where display_name = reg;
      insert into public.coolerco_concessionaire_names (rop_name, concessionaire_id) values (upper(reg), rid) on conflict (rop_name) do nothing;
      -- the reps whose stores are in this warehouse go under this region, with the rep code their stores carry
      for rp in
        select x.id, n.rop_name, min(o.rep_code) rep_code
          from public.coolerco_concessionaires x
          join public.coolerco_concessionaire_names n on n.concessionaire_id = x.id
          join public.coolerco_pos_warehouse w on w.concessionaire = n.rop_name
          join public.coolerco_outlets o on o.outlet_code = w.pos_local_code and o.client_code = c
         where x.client_code = c and x.kind = 'representative' and x.parent_id is null and o.warehouse_code = wh
         group by x.id, n.rop_name
      loop
        update public.coolerco_concessionaires set parent_id = rid, rep_code = coalesce(rep_code, rp.rep_code) where id = rp.id;
        update public.coolerco_outlets o set rep_code = coalesce(o.rep_code, rp.rep_code), region = reg
          from public.coolerco_pos_warehouse w where w.pos_local_code = o.outlet_code and w.concessionaire = rp.rop_name and o.client_code = c;
        update public.coolerco_cases k set responsible_ordering_party = upper(reg)
         where k.client_code = c and k.responsible_ordering_party = rp.rop_name and not public.coolerco_case_is_closed(k.status_reason);
        update public.coolerco_pos_warehouse set concessionaire = upper(reg), updated_at = now(), updated_by = 'coolerco_056'
         where concessionaire = rp.rop_name;
      end loop;
    end loop;
  end loop;
end $demo$;
