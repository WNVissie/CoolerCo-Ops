-- ============================================================================
-- CoolerCo 050 - case management for self-managed clients (Tiger, Demo, any client
-- without its own system). TEST first. Rollback: coolerco_050_rollback.sql
--
-- Wanda 2026-11-24:
--   * SLA classes A / B / C / D = 8 / 16 / 24 / 48 WORKING hours, configurable.
--     Working time = Monday to Friday 08:00-17:00, no Saturdays, no public holidays.
--     The clock starts when the case is LOGGED.
--   * Staff and client users log cases in the app (all case types); the customer
--     portal and the rep portal work with the clients own asset register.
--
-- What this adds (all coolerco_ objects; Magnum / COM cases are not touched):
--   1. settings sla_work_start / sla_work_end / sla_work_days
--   2. coolerco_sla_classes (A-D) + coolerco_sla_class_rules (which class for which
--      client / case type / priority; most specific rule wins)
--   3. coolerco_cases: sla_class, sla_hours, sla_override
--   4. coolerco_add_working_hours(at, hours), coolerco_is_self_managed(client),
--      coolerco_sla_class_for(client, type, priority), coolerco_sla_preview(...)
--   5. trigger on coolerco_cases: a case of a self-managed client gets its class and
--      due date (end_date) from the time it was logged, unless set by hand
--   6. coolerco_case_form_options() + coolerco_case_create(request) for the apps
--      New case screen
--   7. customer portal: an outlet of a self-managed client sees its own register
--      assets and the clients models (new versions of coolerco_portal_context and
--      coolerco_portal_submit; Magnum outlets work exactly as before)
-- Plain ASCII on purpose: the SQL editor misreads some characters and phrases.
-- ============================================================================

-- 1. Working time
insert into public.coolerco_settings (key, value) values
  ('sla_work_start', '"08:00"'::jsonb),
  ('sla_work_end', '"17:00"'::jsonb),
  ('sla_work_days', '[1,2,3,4,5]'::jsonb)
on conflict (key) do nothing;

-- 2. SLA classes and the rules that pick one
create table if not exists public.coolerco_sla_classes (
  code text primary key,
  label text not null,
  working_hours numeric not null check (working_hours > 0),
  sort_order int not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.coolerco_sla_classes (code, label, working_hours, sort_order) values
  ('A', 'A - 8 working hours', 8, 1),
  ('B', 'B - 16 working hours', 16, 2),
  ('C', 'C - 24 working hours', 24, 3),
  ('D', 'D - 48 working hours', 48, 4)
on conflict (code) do nothing;

create table if not exists public.coolerco_sla_class_rules (
  id bigint generated always as identity primary key,
  client_code text not null default '*',
  case_type text not null default '*',
  priority text not null default '*',
  sla_class text not null references public.coolerco_sla_classes(code),
  active boolean not null default true,
  note text,
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (client_code, case_type, priority)
);
-- Starting rules (change them in Setup later): urgent = A, repair at the outlet = B,
-- delivery / replacement = C, everything else = D
insert into public.coolerco_sla_class_rules (client_code, case_type, priority, sla_class, note) values
  ('*', '*', '*', 'D', 'Default'),
  ('*', 'Deliver an Asset', '*', 'C', 'Starting rule'),
  ('*', 'Replacement of Asset', '*', 'C', 'Starting rule'),
  ('*', 'Repair at Shopper POS', '*', 'B', 'Starting rule'),
  ('*', '*', 'High', 'A', 'Urgent: product spoiling')
on conflict (client_code, case_type, priority) do nothing;

alter table public.coolerco_sla_classes enable row level security;
alter table public.coolerco_sla_class_rules enable row level security;
drop policy if exists coolerco_sla_classes_read on public.coolerco_sla_classes;
create policy coolerco_sla_classes_read on public.coolerco_sla_classes for select to authenticated using (true);
drop policy if exists coolerco_sla_classes_admin on public.coolerco_sla_classes;
create policy coolerco_sla_classes_admin on public.coolerco_sla_classes for all to authenticated
  using (public.coolerco_has_role(array['system_admin', 'administrator'])) with check (public.coolerco_has_role(array['system_admin', 'administrator']));
drop policy if exists coolerco_sla_class_rules_read on public.coolerco_sla_class_rules;
create policy coolerco_sla_class_rules_read on public.coolerco_sla_class_rules for select to authenticated using (true);
drop policy if exists coolerco_sla_class_rules_admin on public.coolerco_sla_class_rules;
create policy coolerco_sla_class_rules_admin on public.coolerco_sla_class_rules for all to authenticated
  using (public.coolerco_has_role(array['system_admin', 'administrator'])) with check (public.coolerco_has_role(array['system_admin', 'administrator']));
revoke all on public.coolerco_sla_classes, public.coolerco_sla_class_rules from anon;

-- 3. New columns on CoolerCo cases
alter table public.coolerco_cases add column if not exists sla_class text;
alter table public.coolerco_cases add column if not exists sla_hours numeric;
alter table public.coolerco_cases add column if not exists sla_override boolean not null default false;

-- 4. Helpers
create or replace function public.coolerco_is_self_managed(p_client text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select c.system_of_record = 'coolerco' from public.coolerco_clients c where c.code = p_client), false);
$$;

-- Add working hours to a moment: Monday-Friday (setting), 08:00-17:00 (setting),
-- public holidays skipped, South African time. A start outside working time starts
-- at the next opening.
create or replace function public.coolerco_add_working_hours(p_at timestamptz, p_hours numeric)
returns timestamptz language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  tz constant text := 'Africa/Johannesburg';
  v_start time := coalesce((select (value #>> '{}')::time from public.coolerco_settings where key = 'sla_work_start'), '08:00');
  v_end time := coalesce((select (value #>> '{}')::time from public.coolerco_settings where key = 'sla_work_end'), '17:00');
  v_days int[] := coalesce((select array(select jsonb_array_elements_text(value)::int) from public.coolerco_settings where key = 'sla_work_days'), array[1,2,3,4,5]);
  v_local timestamp := p_at at time zone tz;
  v_left interval := make_interval(mins => round(coalesce(p_hours, 0) * 60)::int);
  v_day date; v_open timestamp; v_close timestamp; i int := 0;
begin
  if p_at is null then return null; end if;
  loop
    i := i + 1;
    exit when i > 1000;
    v_day := v_local::date;
    if extract(isodow from v_day)::int = any (v_days)
       and not exists (select 1 from public.coolerco_public_holidays h where h.holiday_date = v_day) then
      v_open := v_day + v_start; v_close := v_day + v_end;
      if v_local < v_open then v_local := v_open; end if;
      if v_local < v_close then
        if v_left <= (v_close - v_local) then return (v_local + v_left) at time zone tz; end if;
        v_left := v_left - (v_close - v_local);
      end if;
    end if;
    v_local := (v_day + 1)::timestamp;
  end loop;
  return (v_local + v_left) at time zone tz;
end $$;

-- Which class applies: client rule beats *, case type rule beats *, priority rule beats *
create or replace function public.coolerco_sla_class_for(p_client text, p_case_type text, p_priority text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select r.sla_class from public.coolerco_sla_class_rules r
    join public.coolerco_sla_classes c on c.code = r.sla_class and c.active
   where r.active
     and r.client_code in (coalesce(p_client, '*'), '*')
     and r.case_type in (coalesce(p_case_type, '*'), '*')
     and r.priority in (coalesce(p_priority, '*'), '*')
   order by (r.priority <> '*') desc, (r.client_code <> '*') desc, (r.case_type <> '*') desc, c.working_hours
   limit 1;
$$;

create or replace function public.coolerco_sla_preview(p_client text, p_case_type text, p_priority text default null,
                                                        p_class text default null, p_at timestamptz default now())
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with k as (select coalesce(p_class, public.coolerco_sla_class_for(p_client, p_case_type, p_priority)) as code)
  select jsonb_build_object('sla_class', c.code, 'label', c.label, 'hours', c.working_hours,
                            'due', public.coolerco_add_working_hours(p_at, c.working_hours))
    from k join public.coolerco_sla_classes c on c.code = k.code;
$$;

-- 5. Class + due date on every case of a self-managed client (never blocks a save)
create or replace function public.coolerco_cases_sla_trg()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_class text; v_hours numeric;
begin
  begin
    if public.coolerco_is_self_managed(new.client_code) and not coalesce(new.sla_override, false) then
      v_class := public.coolerco_sla_class_for(new.client_code, new.case_type, new.priority);
      select working_hours into v_hours from public.coolerco_sla_classes where code = v_class;
      if v_class is not null and v_hours is not null then
        new.sla_class := v_class;
        new.sla_hours := v_hours;
        new.begin_date := coalesce(new.begin_date, new.created_on, now());
        new.end_date := public.coolerco_add_working_hours(coalesce(new.created_on, now()), v_hours);
      end if;
    elsif public.coolerco_is_self_managed(new.client_code) and new.sla_override and new.sla_class is not null then
      select working_hours into v_hours from public.coolerco_sla_classes where code = new.sla_class;
      new.sla_hours := coalesce(v_hours, new.sla_hours);
      new.end_date := coalesce(new.end_date, public.coolerco_add_working_hours(coalesce(new.created_on, now()), v_hours));
      new.begin_date := coalesce(new.begin_date, new.created_on, now());
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;
drop trigger if exists coolerco_cases_sla on public.coolerco_cases;
create trigger coolerco_cases_sla before insert or update of client_code, case_type, priority, sla_class, sla_override
  on public.coolerco_cases for each row execute function public.coolerco_cases_sla_trg();

-- 6. New case screen
create or replace function public.coolerco_case_form_options()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'can_create', exists (select 1 from public.coolerco_user_access a where a.user_id = auth.uid() and a.active and a.role_code <> 'viewer'),
    'can_set_sla', public.coolerco_is_planner(),
    'clients', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name) order by c.name)
                           from public.coolerco_clients c
                          where c.active and c.system_of_record = 'coolerco'
                            and (public.coolerco_scope_all() or c.code = any (public.coolerco_my_clients())
                                 or exists (select 1 from public.coolerco_outlets o where o.client_code = c.code
                                             and o.warehouse_code = any (public.coolerco_my_warehouses())))), '[]'::jsonb),
    'case_types', jsonb_build_array(
      jsonb_build_object('type', 'Deliver an Asset', 'icon', 'deliver', 'outlet', true, 'asset', null, 'model', true),
      jsonb_build_object('type', 'Repair at Shopper POS', 'icon', 'repair', 'outlet', true, 'asset', 'outlet', 'model', false, 'symptom', true),
      jsonb_build_object('type', 'Removal of Asset', 'icon', 'removal', 'outlet', true, 'asset', 'outlet', 'model', false),
      jsonb_build_object('type', 'Replacement of Asset', 'icon', 'replace', 'outlet', true, 'asset', 'outlet', 'model', true),
      jsonb_build_object('type', 'Repair at Workshop', 'icon', 'workshop', 'outlet', false, 'asset', 'warehouse', 'model', false),
      jsonb_build_object('type', 'Decal @WH', 'icon', 'decal', 'outlet', false, 'asset', 'warehouse', 'model', false)),
    'symptoms', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'label', s.label, 'ask_product', s.ask_product) order by s.sort_order, s.label)
                            from public.coolerco_symptoms s where s.active), '[]'::jsonb),
    'impacts', coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'label', i.label, 'priority', i.priority) order by i.sort_order, i.label)
                           from public.coolerco_product_impacts i where i.active), '[]'::jsonb),
    'sla_classes', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'label', c.label, 'hours', c.working_hours) order by c.sort_order)
                               from public.coolerco_sla_classes c where c.active), '[]'::jsonb));
$$;

-- request: client, case_type, outlet, asset, model, condition, branding, symptom,
-- product_impact, description, contact_name, contact_mobile, sla_class, photos[]
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
    o.latitude, o.longitude, nullif(concat_ws(', ', o.street_address, o.suburb, o.town), ''),
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

revoke all on function public.coolerco_case_create(jsonb), public.coolerco_case_form_options(),
  public.coolerco_sla_preview(text, text, text, text, timestamptz), public.coolerco_add_working_hours(timestamptz, numeric),
  public.coolerco_sla_class_for(text, text, text), public.coolerco_is_self_managed(text) from public, anon;
grant execute on function public.coolerco_case_create(jsonb), public.coolerco_case_form_options(),
  public.coolerco_sla_preview(text, text, text, text, timestamptz), public.coolerco_add_working_hours(timestamptz, numeric),
  public.coolerco_sla_class_for(text, text, text), public.coolerco_is_self_managed(text) to authenticated;

-- 7. Customer portal for self-managed clients: the outlets own register assets and
--    the clients models. Magnum outlets get exactly what they got before.
create or replace function public.coolerco_portal_context(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.coolerco_portal_links; pw public.coolerco_pos_warehouse; mode text; r jsonb; v_self boolean;
begin
  select * into l from public.coolerco_portal_links where token = p_token and active;
  if not found then return jsonb_build_object('error', 'invalid_link'); end if;
  update public.coolerco_portal_links set last_used_at = now() where id = l.id;
  select * into pw from public.coolerco_pos_warehouse where pos_local_code = l.pos_local_code;
  select value #>> '{}' into mode from public.coolerco_settings where key = 'portal_catalogue_mode';
  v_self := public.coolerco_is_self_managed(l.client_code);
  r := jsonb_build_object(
    'pos', jsonb_build_object('code', l.pos_local_code, 'name', coalesce(l.point_of_sale, pw.point_of_sale),
                              'concessionaire', pw.concessionaire, 'warehouse', pw.warehouse_code),
    'contact', jsonb_build_object('name', l.contact_name, 'phone', coalesce(l.mobile_number, l.contact_number)),
    'otp_required', l.otp_required,
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('case_number', c.case_number, 'case_type', c.case_type, 'status', c.status_reason,
                                          'created_on', c.created_on, 'asset', coalesce(c.asset_repaired, c.asset_removed, c.mapped_asset))
                       order by c.created_on desc)
      from (select * from public.coolerco_cases where pos_local_code = l.pos_local_code order by created_on desc limit 20) c), '[]'::jsonb),
    'open_cases', coalesce((
      select jsonb_agg(o order by o->>'created_on' desc) from (
        select jsonb_build_object('source', 'COM', 'case_number', c.case_number, 'case_type', c.case_type,
                                  'status', c.status_reason, 'created_on', c.created_on,
                                  'assets', to_jsonb(array_remove(array[c.asset_repaired, c.asset_removed, c.asset_delivered, c.mapped_asset], null))) o
        from public.cases c
        where not v_self and c.pos_local_code = l.pos_local_code
          and lower(trim(c.status_reason)) in ('open','in progress','waiting','in service','on hold')
        union all
        select jsonb_build_object('source', 'CoolerCo', 'case_number', k.case_number, 'case_type', k.case_type,
                                  'status', k.status_reason, 'created_on', k.created_on,
                                  'assets', to_jsonb(array_remove(array[k.asset_repaired, k.asset_removed, k.asset_delivered, k.mapped_asset], null)))
        from public.coolerco_cases k
        where k.pos_local_code = l.pos_local_code
          and not public.coolerco_case_is_closed(k.status_reason)
      ) x(o)
    ), '[]'::jsonb));

  if v_self then
    r := r || jsonb_build_object(
      'assets', coalesce((
        select jsonb_agg(jsonb_build_object('asset', a.asset_number, 'barcode', a.asset_number, 'local_code', a.serial_number,
                 'product', coalesce(m.description, a.model_code), 'family', coalesce(m.product_family, m.description),
                 'family_name', m.product_family, 'photo', null, 'type', m.asset_type, 'condition', a.condition) order by m.description, a.asset_number)
          from public.coolerco_assets a
          left join public.coolerco_asset_models m on m.client_code = a.client_code and m.model_code = a.model_code
         where a.client_code = l.client_code and a.location_type = 'Outlet' and a.location_code = l.pos_local_code), '[]'::jsonb),
      'catalogue', coalesce((
        select jsonb_agg(jsonb_build_object('id', m.model_code, 'model_code', m.model_code, 'name', m.description,
                 'description', concat_ws(' / ', m.product_family, m.capacity_litres || ' L'), 'type', m.asset_type, 'photo', null)
                 order by m.asset_type, m.description)
          from public.coolerco_asset_models m
         where m.client_code = l.client_code and m.active
           and (mode is distinct from 'available' or exists (
                 select 1 from public.coolerco_assets s where s.client_code = m.client_code and s.model_code = m.model_code
                    and s.location_type = 'Warehouse' and s.status ilike '%ready%' and s.warehouse_code = pw.warehouse_code))), '[]'::jsonb));
  else
    r := r || jsonb_build_object(
      'assets', coalesce((
        select jsonb_agg(jsonb_build_object('asset', a.name, 'barcode', a.bar_code, 'local_code', a.local_code,
                 'product', a.product_base, 'family', f.display_name, 'family_name', f.name, 'photo', f.photo_path,
                 'type', a.asset_type, 'condition', a.condition) order by a.product_base)
        from public.assets_live a
        left join public.coolerco_product_base_family bf on bf.product_base = a.product_base
        left join public.coolerco_product_families f on f.id = bf.family_id
        where a.assign_account_local_code = l.pos_local_code and a.asset_location = 'Location'), '[]'::jsonb),
      'catalogue', coalesce((
        select jsonb_agg(jsonb_build_object('id', f.id, 'name', coalesce(f.display_name, f.name), 'description', f.description,
                                            'type', f.asset_type, 'photo', f.photo_path) order by f.sort_order, f.name)
        from public.coolerco_product_families f
        where f.active and f.show_in_portal
          and (mode is distinct from 'available' or exists (
                select 1 from public.coolerco_product_base_family bf
                join public.assets_live a on a.product_base = bf.product_base
                where bf.family_id = f.id and a.asset_status = 'Ready to Work' and a.asset_location = 'Warehouse'
                  and a.assign_account = (select com_name || ' WH' from public.coolerco_warehouse_settings where warehouse_code = pw.warehouse_code)))
      ), '[]'::jsonb));
  end if;
  return r;
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
    requested_family_id, requested_product_base, description, photo_paths, sla_days, portal_link_id, created_by_label, client_code, tenant_id)
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
    case when v_self then (select w.tenant_id from public.warehouses w where w.code = pw.warehouse_code) end);
  insert into public.coolerco_case_events (case_number, from_status, to_status, reason_code, notes, actor_type, actor_label)
  values (v_no, null, 'Waiting for Approval', 'PORTAL_REQUEST', left(p_request ->> 'description', 500), 'customer',
          coalesce(nullif(p_request ->> 'contact_name', ''), l.contact_name, 'customer'));
  return jsonb_build_object('case_number', v_no);
end $$;

-- Check
select 'sla classes' what, count(*)::text from public.coolerco_sla_classes
union all select 'sla rules', count(*)::text from public.coolerco_sla_class_rules
union all select 'Tue 24 Nov 16:00 + 8h', public.coolerco_add_working_hours('2026-11-24 16:00+02', 8)::text
union all select 'Fri 27 Nov 15:00 + 24h', public.coolerco_add_working_hours('2026-11-27 15:00+02', 24)::text
union all select 'Demo repair High', (public.coolerco_sla_preview('DEMO', 'Repair at Shopper POS', 'High'))::text;
