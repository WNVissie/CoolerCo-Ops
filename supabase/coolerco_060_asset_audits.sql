-- 060 · Asset audits + "not scanned at its store" report (Wanda 2026-11-25 16:46-16:55; demo next week)
-- Audit types: kickoff (once, full baseline) · adhoc (sample of a region / area for a period) · statutory (every 3 years, all coolers) · annual.
-- Planner: scope + sample + period + number of auditors -> stores per auditor per day in driving order, time per store
--   (10 min + 3 min per cooler, editable) + travel (distance x road factor at an average speed; no map costs) -> days + finish date.
-- At the store (Field app): "5 on record", count-up while scanning, result per cooler found / other_store / extra / missing,
--   below 5/5 the manager questions must be answered; the auditor may fix the store's GPS / contact (logged).
-- Exceptions: a missing cooler later scanned at another store (any scan source) -> "found at a different location".
-- Always-on report: register cooler at an outlet not seen at that outlet for 1 / 2 / 3 months (sightings from audits,
--   Field app job cards, deliveries; customer / rep scans later).
-- Scope today: clients CoolerCo runs (Tiger, Demo …). Magnum results to COM come later.
-- Add-only. All tables behind functions (no direct access). Rollback: coolerco_060_rollback.sql.

-- ── start points (warehouse pins; the shared warehouses table has no GPS) ───────────────────
create table if not exists public.coolerco_warehouse_pins (warehouse_code text primary key, latitude double precision not null, longitude double precision not null, label text);
insert into public.coolerco_warehouse_pins (warehouse_code, latitude, longitude, label) values
  ('JHB', -26.0390, 28.2320, 'RTMA Gauteng'), ('CPT', -33.8084, 18.5323, 'RTMA Cape Town'), ('DBN', -29.8334, 30.8288, 'RTMA Durban'),
  ('BFN', -29.0966, 26.1596, 'RTMA Bloemfontein'), ('EL', -32.9809, 27.9116, 'RTMA East London'), ('GEO', -33.9875, 22.4529, 'RTMA George'),
  ('NEL', -25.3274, 31.0180, 'RTMA Nelspruit'), ('POL', -23.8842, 29.4591, 'RTMA Polokwane'), ('PE', -33.9547, 25.5792, 'RTMA Port Elizabeth'),
  ('WH-DM-JHB', -26.2186, 28.1650, 'Demo Gauteng (Germiston)'), ('WH-DM-DBN', -29.8154, 30.8573, 'Demo Durban (Pinetown)')
on conflict (warehouse_code) do nothing;
alter table public.coolerco_warehouse_pins enable row level security;
revoke all on public.coolerco_warehouse_pins from anon, authenticated;

create or replace function public.coolerco_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- ── sightings: every time a cooler is seen at a store ────────────────────────────────────────
create table if not exists public.coolerco_asset_sightings (
  id uuid primary key default gen_random_uuid(),
  client_code text not null, asset_number text not null, outlet_code text not null,
  seen_at timestamptz not null default now(),
  source text not null check (source in ('audit', 'job_card', 'delivery', 'rep', 'customer', 'field_scan', 'seed')),
  by_label text, ref uuid);
create index if not exists idx_coolerco_sightings_asset on public.coolerco_asset_sightings (client_code, asset_number, seen_at desc);
create index if not exists idx_coolerco_sightings_outlet on public.coolerco_asset_sightings (client_code, outlet_code);
alter table public.coolerco_asset_sightings enable row level security;
revoke all on public.coolerco_asset_sightings from anon, authenticated;

-- Field app job card: the delivered / removed / repaired cooler was seen at the stop's store
create or replace function public.coolerco_trg_sighting_job_card()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare c text; a public.coolerco_assets;
begin
  if new.pos_local_code is null then return null; end if;
  foreach c in array array[new.delivered_barcode, new.removed_barcode, new.repaired_barcode] loop
    continue when c is null or trim(c) = '';
    select * into a from public.coolerco_assets where upper(asset_number) = upper(trim(c)) or upper(coalesce(serial_number, '')) = upper(trim(c)) limit 1;
    if found then
      insert into public.coolerco_asset_sightings (client_code, asset_number, outlet_code, seen_at, source, by_label, ref)
      values (a.client_code, a.asset_number, new.pos_local_code, coalesce(new.completed_at, new.created_at, now()), 'job_card', new.driver_username, new.id);
    end if;
  end loop;
  return null;
exception when others then return null;
end $$;
drop trigger if exists coolerco_sighting_job_card on public.coolerco_field_job_cards;
create trigger coolerco_sighting_job_card after insert on public.coolerco_field_job_cards for each row execute function public.coolerco_trg_sighting_job_card();

-- a cooler delivered to a store (rules engine / office close) counts as seen there
create or replace function public.coolerco_trg_sighting_delivery()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if lower(coalesce(new.to_kind, '')) in ('location', 'outlet') and new.to_code is not null and new.client_code is not null
     and exists (select 1 from public.coolerco_assets where client_code = new.client_code and asset_number = new.asset) then
    insert into public.coolerco_asset_sightings (client_code, asset_number, outlet_code, seen_at, source, by_label, ref)
    values (new.client_code, new.asset, new.to_code, coalesce(new.at, now()), 'delivery', new.by_label, new.id);
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists coolerco_sighting_delivery on public.coolerco_asset_movements;
create trigger coolerco_sighting_delivery after insert on public.coolerco_asset_movements for each row execute function public.coolerco_trg_sighting_delivery();

-- ── audits ───────────────────────────────────────────────────────────────────────────────────
create table if not exists public.coolerco_audits (
  id uuid primary key default gen_random_uuid(),
  code text unique, name text not null,
  audit_type text not null check (audit_type in ('kickoff', 'adhoc', 'statutory', 'annual')),
  client_code text not null, regions text[], warehouses text[],
  sample_method text not null default 'all' check (sample_method in ('all', 'random', 'risk', 'manual')),
  sample_pct int, period_start date not null, period_end date,
  auditors_planned int not null default 1,
  minutes_per_store int not null default 10, minutes_per_cooler int not null default 3,
  day_minutes int not null default 480, avg_speed_kmh int not null default 40, road_factor numeric not null default 1.3,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'done', 'cancelled')),
  notes text, created_by text default coalesce(auth.jwt() ->> 'email', 'user'), created_at timestamptz not null default now(), updated_at timestamptz default now());

create table if not exists public.coolerco_audit_auditors (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.coolerco_audits(id) on delete cascade,
  seq int not null, label text not null, person_name text, slot_id uuid, user_id uuid, area text,
  kind text not null default 'staff' check (kind in ('staff', 'external')), active boolean not null default true,
  unique (audit_id, seq));

create table if not exists public.coolerco_audit_stores (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.coolerco_audits(id) on delete cascade,
  client_code text not null, outlet_code text not null, outlet_name text, latitude double precision, longitude double precision,
  warehouse_code text, region text, rep_code text, coolers_expected int not null default 0, risk int not null default 0,
  auditor_id uuid references public.coolerco_audit_auditors(id) on delete set null,
  plan_day date, plan_day_no int, plan_seq int, travel_km numeric, travel_min int, store_min int, eta time,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'visited', 'skipped')),
  started_at timestamptz, visited_at timestamptz, visited_by text, manager_answers jsonb, note text,
  store_fixed boolean not null default false, gps_lat double precision, gps_lng double precision,
  unique (audit_id, outlet_code));
create index if not exists idx_coolerco_audit_stores_auditor on public.coolerco_audit_stores (auditor_id, plan_day, plan_seq);

create table if not exists public.coolerco_audit_items (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.coolerco_audits(id) on delete cascade,
  audit_store_id uuid not null references public.coolerco_audit_stores(id) on delete cascade,
  client_code text, asset_number text not null, model text, expected boolean not null default true,
  result text not null default 'pending' check (result in ('pending', 'found', 'other_store', 'extra', 'missing')),
  registered_at text, scanned_at timestamptz, scanned_by text, scanned_code text, how text,
  found_elsewhere_outlet text, found_elsewhere_at timestamptz, found_elsewhere_by text,
  unique (audit_store_id, asset_number));
create index if not exists idx_coolerco_audit_items_asset on public.coolerco_audit_items (asset_number, result);

alter table public.coolerco_audits enable row level security;
alter table public.coolerco_audit_auditors enable row level security;
alter table public.coolerco_audit_stores enable row level security;
alter table public.coolerco_audit_items enable row level security;
revoke all on public.coolerco_audits, public.coolerco_audit_auditors, public.coolerco_audit_stores, public.coolerco_audit_items from anon, authenticated;

create or replace function public.coolerco_audit_office()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.coolerco_is_planner() or public.coolerco_has_role(array['system_admin', 'administrator', 'manager', 'supervisor', 'supplier'])
$$;

-- last time a register cooler was seen at a store (and where it was seen last of all)
create or replace function public.coolerco_last_seen(p_client text, p_asset text, p_outlet text)
returns timestamptz language sql stable security definer set search_path = public, pg_temp as $$
  select max(seen_at) from public.coolerco_asset_sightings where client_code = p_client and asset_number = p_asset and outlet_code = p_outlet
$$;

-- ── create an audit: scope + sample -> stores and the coolers on record there ───────────────
create or replace function public.coolerco_audit_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_client text := p ->> 'client_code'; v_method text := coalesce(p ->> 'sample_method', 'all');
        v_pct int := nullif(p ->> 'sample_pct', '')::int; v_n int; v_take int; v_regions text[]; v_whs text[]; v_outlets text[]; v_code text; v_type text := coalesce(p ->> 'audit_type', 'adhoc');
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not public.coolerco_audit_office() then return jsonb_build_object('error', 'not_allowed'); end if;
  if v_client is null or not public.coolerco_is_self_managed(v_client) then return jsonb_build_object('error', 'client_required'); end if;
  if not public.coolerco_can_see(v_client, null) then return jsonb_build_object('error', 'not_allowed'); end if;
  if v_method in ('random', 'risk') and (v_pct is null or v_pct not between 1 and 100) then return jsonb_build_object('error', 'pct_required'); end if;
  v_regions := case when jsonb_typeof(p -> 'regions') = 'array' and jsonb_array_length(p -> 'regions') > 0 then array(select jsonb_array_elements_text(p -> 'regions')) end;
  v_whs := case when jsonb_typeof(p -> 'warehouses') = 'array' and jsonb_array_length(p -> 'warehouses') > 0 then array(select jsonb_array_elements_text(p -> 'warehouses')) end;
  v_outlets := case when jsonb_typeof(p -> 'outlets') = 'array' then array(select jsonb_array_elements_text(p -> 'outlets')) end;
  if v_method = 'manual' and coalesce(cardinality(v_outlets), 0) = 0 then return jsonb_build_object('error', 'stores_required'); end if;
  v_code := 'AUD-' || to_char(now() at time zone 'Africa/Johannesburg', 'YYMMDD') || '-' ||
            lpad(((select count(*) from public.coolerco_audits where created_at::date = current_date) + 1)::text, 2, '0');
  insert into public.coolerco_audits (code, name, audit_type, client_code, regions, warehouses, sample_method, sample_pct, period_start, period_end,
         auditors_planned, minutes_per_store, minutes_per_cooler, day_minutes, notes)
  values (v_code, coalesce(nullif(trim(p ->> 'name'), ''), initcap(v_type) || ' audit ' || v_client), v_type, v_client, v_regions, v_whs, v_method, v_pct,
          coalesce(nullif(p ->> 'period_start', '')::date, current_date + 1), nullif(p ->> 'period_end', '')::date,
          greatest(coalesce(nullif(p ->> 'auditors', '')::int, 1), 1), coalesce(nullif(p ->> 'minutes_per_store', '')::int, 10),
          coalesce(nullif(p ->> 'minutes_per_cooler', '')::int, 3), coalesce(nullif(p ->> 'day_minutes', '')::int, 480), p ->> 'notes')
  returning id into v_id;

  -- candidate stores with their coolers on record and a risk score
  create temp table if not exists _cand (outlet_code text, n int, risk int, rnd double precision) on commit drop;
  truncate _cand;
  insert into _cand
  select o.outlet_code,
         (select count(*) from public.coolerco_assets a where a.client_code = o.client_code and a.location_type = 'Outlet' and a.location_code = o.outlet_code),
         0, random()
    from public.coolerco_outlets o
   where o.client_code = v_client and coalesce(o.active, true)
     and (v_regions is null or o.region = any (v_regions)) and (v_whs is null or o.warehouse_code = any (v_whs))
     and (v_method <> 'manual' or o.outlet_code = any (v_outlets))
     and public.coolerco_can_see(o.client_code, o.warehouse_code);
  -- stores without coolers on record: only in a kick-off / statutory audit (or picked by hand)
  if v_type not in ('kickoff', 'statutory') and v_method <> 'manual' then delete from _cand where n = 0; end if;
  -- risk: coolers not seen there for 90+ days, exceptions in earlier audits, size of the store
  update _cand c set risk = c.n
       + 2 * (select count(*) from public.coolerco_assets a where a.client_code = v_client and a.location_type = 'Outlet' and a.location_code = c.outlet_code
                and coalesce(public.coolerco_last_seen(v_client, a.asset_number, c.outlet_code), '-infinity') < now() - interval '90 days')
       + 3 * (select count(*) from public.coolerco_audit_items i join public.coolerco_audit_stores s on s.id = i.audit_store_id
               where s.client_code = v_client and s.outlet_code = c.outlet_code and i.result in ('missing', 'other_store', 'extra'));
  select count(*) into v_n from _cand;
  v_take := case when v_method in ('random', 'risk') then greatest(1, ceil(v_n * v_pct / 100.0)::int) else v_n end;

  insert into public.coolerco_audit_stores (audit_id, client_code, outlet_code, outlet_name, latitude, longitude, warehouse_code, region, rep_code, coolers_expected, risk)
  select v_id, o.client_code, o.outlet_code, o.name, o.latitude, o.longitude, o.warehouse_code, o.region, o.rep_code, c.n, c.risk
    from (select * from _cand order by case when v_method = 'risk' then -risk else 0 end, case when v_method = 'random' then rnd else 0 end, outlet_code limit v_take) c
    join public.coolerco_outlets o on o.client_code = v_client and o.outlet_code = c.outlet_code;

  insert into public.coolerco_audit_items (audit_id, audit_store_id, client_code, asset_number, model, expected, result)
  select v_id, s.id, a.client_code, a.asset_number, coalesce(m.display_name, m.description, a.model_code), true, 'pending'
    from public.coolerco_audit_stores s
    join public.coolerco_assets a on a.client_code = s.client_code and a.location_type = 'Outlet' and a.location_code = s.outlet_code
    left join public.coolerco_asset_models m on m.client_code = a.client_code and m.model_code = a.model_code
   where s.audit_id = v_id;

  perform public.coolerco_audit_plan(v_id, null);
  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code, 'stores', v_take, 'candidates', v_n);
end $$;

-- ── plan: auditors x days, driving order, time ───────────────────────────────────────────────
-- per warehouse: stores swept by angle around the warehouse pin and cut into one block per auditor (balanced on time);
-- per auditor: nearest store next from the warehouse; a new day when the store + the way back no longer fit the working day.
create or replace function public.coolerco_audit_plan(p_audit uuid, p_auditors int default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.coolerco_audits; v_n int; w record; v_nw int; v_total numeric; v_aud int := 0; v_auditor uuid; v_chunk numeric;
        st record; v_lat double precision; v_lng double precision; v_used numeric; v_day int; v_seq int; v_next record; v_travel numeric; v_km numeric;
        v_back numeric; v_store numeric; v_dates date[]; v_maxday int; i int; v_left int; v_blk int; v_acc numeric;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if not public.coolerco_audit_office() then return jsonb_build_object('error', 'not_allowed'); end if;
  select * into a from public.coolerco_audits where id = p_audit for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if exists (select 1 from public.coolerco_audit_stores where audit_id = p_audit and status <> 'planned') and p_auditors is not null then
    return jsonb_build_object('error', 'already_started'); end if;
  v_n := greatest(coalesce(p_auditors, a.auditors_planned, 1), 1);
  update public.coolerco_audits set auditors_planned = v_n, updated_at = now() where id = p_audit;
  -- auditor rows 1..n (named ones beyond n stay but get no stores)
  for i in 1..v_n loop
    insert into public.coolerco_audit_auditors (audit_id, seq, label) values (p_audit, i, 'Auditor ' || i) on conflict (audit_id, seq) do nothing;
  end loop;
  delete from public.coolerco_audit_auditors where audit_id = p_audit and seq > v_n and person_name is null;
  update public.coolerco_audit_stores set auditor_id = null, plan_day = null, plan_day_no = null, plan_seq = null, travel_km = null, travel_min = null, eta = null,
         store_min = a.minutes_per_store + a.minutes_per_cooler * coolers_expected
   where audit_id = p_audit and status = 'planned';

  select sum(store_min) into v_total from public.coolerco_audit_stores where audit_id = p_audit and status = 'planned';
  if coalesce(v_total, 0) = 0 then return public.coolerco_audit_summary(p_audit); end if;

  for w in select s.warehouse_code, sum(s.store_min) mins,
                  coalesce(max(p.latitude), avg(s.latitude)) lat, coalesce(max(p.longitude), avg(s.longitude)) lng
             from public.coolerco_audit_stores s left join public.coolerco_warehouse_pins p on p.warehouse_code = s.warehouse_code
            where s.audit_id = p_audit and s.status = 'planned' group by s.warehouse_code order by 2 desc loop
    v_nw := least(greatest(round(v_n * w.mins / v_total)::int, 1), v_n);
    v_chunk := w.mins / v_nw; v_blk := 0; v_acc := 0;
    -- sweep by angle, cut into v_nw blocks of about equal time
    for st in select id, store_min from public.coolerco_audit_stores
              where audit_id = p_audit and status = 'planned' and warehouse_code is not distinct from w.warehouse_code
              order by atan2(coalesce(latitude, w.lat) - w.lat, coalesce(longitude, w.lng) - w.lng), outlet_code loop
      if v_acc >= v_chunk * (v_blk + 1) and v_blk < v_nw - 1 then v_blk := v_blk + 1; end if;
      select id into v_auditor from public.coolerco_audit_auditors where audit_id = p_audit and seq = ((v_aud + v_blk) % v_n) + 1;
      update public.coolerco_audit_stores set auditor_id = v_auditor where id = st.id;
      v_acc := v_acc + st.store_min;
    end loop;
    v_aud := v_aud + v_nw;
  end loop;

  -- order + days per auditor (nearest next store; days restart at the warehouse)
  for w in select distinct s.auditor_id, s.warehouse_code, coalesce(p.latitude, (select avg(latitude) from public.coolerco_audit_stores x where x.audit_id = p_audit)) lat,
                  coalesce(p.longitude, (select avg(longitude) from public.coolerco_audit_stores x where x.audit_id = p_audit)) lng
             from public.coolerco_audit_stores s left join public.coolerco_warehouse_pins p on p.warehouse_code = s.warehouse_code
            where s.audit_id = p_audit and s.status = 'planned' and s.auditor_id is not null loop
    -- an auditor's day number continues after any earlier warehouse block of the same auditor
    select coalesce(max(plan_day_no), 0) into v_day from public.coolerco_audit_stores where audit_id = p_audit and auditor_id = w.auditor_id and plan_day_no is not null;
    v_day := v_day + 1; v_seq := 0; v_used := 0; v_lat := w.lat; v_lng := w.lng;
    loop
      select id, latitude, longitude, store_min, public.coolerco_km(v_lat, v_lng, coalesce(latitude, v_lat), coalesce(longitude, v_lng)) km into v_next
        from public.coolerco_audit_stores
       where audit_id = p_audit and auditor_id = w.auditor_id and warehouse_code is not distinct from w.warehouse_code and status = 'planned' and plan_seq is null
       order by 5, outlet_code limit 1;
      exit when not found;
      v_km := v_next.km * a.road_factor;
      v_travel := v_km / a.avg_speed_kmh * 60;
      v_back := public.coolerco_km(coalesce(v_next.latitude, w.lat), coalesce(v_next.longitude, w.lng), w.lat, w.lng) * a.road_factor / a.avg_speed_kmh * 60;
      if v_seq > 0 and v_used + v_travel + v_next.store_min + v_back > a.day_minutes then
        v_day := v_day + 1; v_seq := 0; v_used := 0; v_lat := w.lat; v_lng := w.lng;
        v_km := public.coolerco_km(v_lat, v_lng, coalesce(v_next.latitude, v_lat), coalesce(v_next.longitude, v_lng)) * a.road_factor;
        v_travel := v_km / a.avg_speed_kmh * 60;
      end if;
      v_seq := v_seq + 1;
      update public.coolerco_audit_stores set plan_day_no = v_day, plan_seq = v_seq, travel_km = round(v_km::numeric, 1), travel_min = round(v_travel)::int,
             eta = (time '08:00' + make_interval(mins => round(v_used + v_travel)::int))
       where id = v_next.id;
      v_used := v_used + v_travel + v_next.store_min;
      v_lat := coalesce(v_next.latitude, v_lat); v_lng := coalesce(v_next.longitude, v_lng);
    end loop;
  end loop;

  -- day numbers -> working days from the start date (weekends and public holidays skipped)
  select max(plan_day_no) into v_maxday from public.coolerco_audit_stores where audit_id = p_audit;
  select array_agg(d order by d) into v_dates from (
    select d::date d from generate_series(a.period_start, a.period_start + (coalesce(v_maxday, 1) * 3 + 14), interval '1 day') d
     where extract(isodow from d) < 6
       and not exists (select 1 from public.coolerco_public_holidays h where h.holiday_date = d::date)
     order by d limit coalesce(v_maxday, 1)) x;
  update public.coolerco_audit_stores set plan_day = v_dates[plan_day_no] where audit_id = p_audit and plan_day_no is not null;
  return public.coolerco_audit_summary(p_audit);
end $$;

create or replace function public.coolerco_audit_summary(p_audit uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('ok', true, 'id', a.id, 'code', a.code,
    'stores', (select count(*) from public.coolerco_audit_stores where audit_id = a.id),
    'coolers', (select coalesce(sum(coolers_expected), 0) from public.coolerco_audit_stores where audit_id = a.id),
    'days', (select count(distinct plan_day) from public.coolerco_audit_stores where audit_id = a.id),
    'first_day', (select min(plan_day) from public.coolerco_audit_stores where audit_id = a.id),
    'finish', (select max(plan_day) from public.coolerco_audit_stores where audit_id = a.id),
    'hours', (select round(coalesce(sum(store_min + coalesce(travel_min, 0)), 0) / 60.0, 1) from public.coolerco_audit_stores where audit_id = a.id),
    'km', (select round(coalesce(sum(travel_km), 0)) from public.coolerco_audit_stores where audit_id = a.id),
    'late', a.period_end is not null and (select max(plan_day) from public.coolerco_audit_stores where audit_id = a.id) > a.period_end)
  from public.coolerco_audits a where a.id = p_audit
$$;

-- ── read the audit (plan, auditors, progress) ───────────────────────────────────────────────
create or replace function public.coolerco_audit_list()
returns table (id uuid, code text, name text, audit_type text, client_code text, status text, period_start date, period_end date,
               stores int, visited int, coolers int, found int, missing int, other_store int, extra int, auditors int, finish date, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.code, a.name, a.audit_type, a.client_code, a.status, a.period_start, a.period_end,
         (select count(*)::int from public.coolerco_audit_stores s where s.audit_id = a.id),
         (select count(*)::int from public.coolerco_audit_stores s where s.audit_id = a.id and s.status = 'visited'),
         (select coalesce(sum(coolers_expected), 0)::int from public.coolerco_audit_stores s where s.audit_id = a.id),
         (select count(*)::int from public.coolerco_audit_items i where i.audit_id = a.id and i.result = 'found'),
         (select count(*)::int from public.coolerco_audit_items i where i.audit_id = a.id and i.result = 'missing'),
         (select count(*)::int from public.coolerco_audit_items i where i.audit_id = a.id and i.result = 'other_store'),
         (select count(*)::int from public.coolerco_audit_items i where i.audit_id = a.id and i.result = 'extra'),
         a.auditors_planned, (select max(plan_day) from public.coolerco_audit_stores s where s.audit_id = a.id), a.created_at
    from public.coolerco_audits a
   where auth.uid() is not null and public.coolerco_can_see(a.client_code, null) and (public.coolerco_audit_office() or public.coolerco_has_role(array['client', 'viewer']))
   order by a.created_at desc
$$;

create or replace function public.coolerco_audit_get(p_audit uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a public.coolerco_audits;
begin
  select * into a from public.coolerco_audits where id = p_audit;
  if not found or auth.uid() is null or not public.coolerco_can_see(a.client_code, null) then return jsonb_build_object('error', 'not_found'); end if;
  return jsonb_build_object('audit', to_jsonb(a), 'summary', public.coolerco_audit_summary(p_audit), 'can_edit', public.coolerco_audit_office(),
    'auditors', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'seq', x.seq, 'label', x.label, 'person_name', x.person_name, 'slot_id', x.slot_id,
                 'has_login', x.user_id is not null, 'area', x.area, 'kind', x.kind,
                 'stores', (select count(*) from public.coolerco_audit_stores s where s.auditor_id = x.id),
                 'visited', (select count(*) from public.coolerco_audit_stores s where s.auditor_id = x.id and s.status = 'visited'),
                 'days', (select count(distinct plan_day) from public.coolerco_audit_stores s where s.auditor_id = x.id),
                 'regions', (select jsonb_agg(distinct s.region) from public.coolerco_audit_stores s where s.auditor_id = x.id and s.region is not null)) order by x.seq)
               from public.coolerco_audit_auditors x where x.audit_id = p_audit), '[]'),
    'stores', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'outlet_code', s.outlet_code, 'name', s.outlet_name, 'region', s.region, 'rep_code', s.rep_code,
                 'warehouse_code', s.warehouse_code, 'lat', s.latitude, 'lng', s.longitude, 'coolers', s.coolers_expected, 'risk', s.risk,
                 'auditor_id', s.auditor_id, 'day', s.plan_day, 'day_no', s.plan_day_no, 'seq', s.plan_seq, 'km', s.travel_km, 'travel_min', s.travel_min,
                 'store_min', s.store_min, 'eta', to_char(s.eta, 'HH24:MI'), 'status', s.status, 'visited_at', s.visited_at, 'visited_by', s.visited_by,
                 'store_fixed', s.store_fixed, 'answers', s.manager_answers,
                 'found', (select count(*) from public.coolerco_audit_items i where i.audit_store_id = s.id and i.result = 'found'),
                 'missing', (select count(*) from public.coolerco_audit_items i where i.audit_store_id = s.id and i.result = 'missing'),
                 'other', (select count(*) from public.coolerco_audit_items i where i.audit_store_id = s.id and i.result in ('other_store', 'extra')))
                 order by s.plan_day nulls last, s.auditor_id, s.plan_seq)
               from public.coolerco_audit_stores s where s.audit_id = p_audit), '[]'),
    'start_points', coalesce((select jsonb_object_agg(p.warehouse_code, jsonb_build_array(p.latitude, p.longitude)) from public.coolerco_warehouse_pins p
               where p.warehouse_code in (select warehouse_code from public.coolerco_audit_stores where audit_id = p_audit)), '{}'));
end $$;

-- people who can be auditors: Field app slots (with a login) of the audit's warehouses
create or replace function public.coolerco_audit_people(p_audit uuid)
returns table (slot_id uuid, person_name text, warehouse_code text, worker_type text, has_login boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.id, coalesce(f.person_name, f.routeiq_username), f.warehouse_code, f.worker_type, f.user_id is not null
    from public.coolerco_field_slots f
   where auth.uid() is not null and public.coolerco_audit_office() and f.active and f.person_name is not null
   order by (f.warehouse_code in (select left(replace(coalesce(s.warehouse_code, ''), 'WH-DM-', ''), 3) from public.coolerco_audit_stores s where s.audit_id = p_audit)) desc,
            f.warehouse_code, f.person_name
$$;

create or replace function public.coolerco_audit_set_auditor(p_auditor uuid, p_slot uuid, p_name text default null, p_area text default null, p_kind text default 'staff')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare f record;
begin
  if auth.uid() is null or not public.coolerco_audit_office() then return jsonb_build_object('error', 'not_allowed'); end if;
  if p_slot is not null then select * into f from public.coolerco_field_slots where id = p_slot; end if;
  update public.coolerco_audit_auditors set slot_id = p_slot, user_id = f.user_id,
         person_name = coalesce(nullif(trim(p_name), ''), f.person_name, f.routeiq_username),
         area = nullif(trim(coalesce(p_area, '')), ''), kind = case when p_kind = 'external' then 'external' else 'staff' end
   where id = p_auditor;
  return jsonb_build_object('ok', true, 'has_login', f.user_id is not null);
end $$;

-- move one store to another auditor / day (planner fine-tuning)
create or replace function public.coolerco_audit_move_store(p_store uuid, p_auditor uuid, p_day date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.coolerco_audit_office() then return jsonb_build_object('error', 'not_allowed'); end if;
  update public.coolerco_audit_stores set auditor_id = coalesce(p_auditor, auditor_id), plan_day = coalesce(p_day, plan_day),
         plan_seq = coalesce((select max(plan_seq) + 1 from public.coolerco_audit_stores x where x.auditor_id = coalesce(p_auditor, auditor_id) and x.plan_day = coalesce(p_day, plan_day)), 1)
   where id = p_store and status = 'planned';
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.coolerco_audit_set_status(p_audit uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.coolerco_audit_office() then return jsonb_build_object('error', 'not_allowed'); end if;
  if p_status = 'delete' then
    if exists (select 1 from public.coolerco_audit_stores where audit_id = p_audit and status <> 'planned') then return jsonb_build_object('error', 'already_started'); end if;
    delete from public.coolerco_audits where id = p_audit; return jsonb_build_object('ok', true, 'deleted', true);
  end if;
  if p_status not in ('planned', 'in_progress', 'done', 'cancelled') then return jsonb_build_object('error', 'bad_status'); end if;
  update public.coolerco_audits set status = p_status, updated_at = now() where id = p_audit;
  return jsonb_build_object('ok', true);
end $$;

-- ── Field app: my audit days, one store, scan, finish, fix ──────────────────────────────────
create or replace function public.coolerco_audit_can_work(p_store uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.coolerco_audit_stores s join public.coolerco_audit_auditors x on x.id = s.auditor_id
                  where s.id = p_store and x.user_id = auth.uid())
      or exists (select 1 from public.coolerco_audit_stores s where s.id = p_store and public.coolerco_audit_office() and public.coolerco_can_see(s.client_code, s.warehouse_code))
$$;

create or replace function public.coolerco_audit_my_days()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('audit_id', a.id, 'code', a.code, 'name', a.name, 'audit_type', a.audit_type, 'client_code', a.client_code,
           'auditor', x.label, 'person_name', x.person_name, 'status', a.status,
           'days', (select jsonb_agg(jsonb_build_object('day', d.plan_day, 'stores', d.stores, 'visited', d.visited, 'coolers', d.coolers) order by d.plan_day)
                      from (select plan_day, count(*) stores, count(*) filter (where status = 'visited') visited, sum(coolers_expected) coolers
                              from public.coolerco_audit_stores where auditor_id = x.id group by plan_day) d)) order by a.period_start), '[]')
    from public.coolerco_audit_auditors x join public.coolerco_audits a on a.id = x.audit_id
   where x.user_id = auth.uid() and a.status in ('planned', 'in_progress')
$$;

create or replace function public.coolerco_audit_day(p_audit uuid, p_day date)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'seq', s.plan_seq, 'outlet_code', s.outlet_code, 'name', s.outlet_name, 'eta', to_char(s.eta, 'HH24:MI'),
           'lat', s.latitude, 'lng', s.longitude, 'coolers', s.coolers_expected, 'status', s.status, 'km', s.travel_km,
           'found', (select count(*) from public.coolerco_audit_items i where i.audit_store_id = s.id and i.result = 'found'),
           'address', concat_ws(', ', o.street_address, o.suburb, o.town)) order by s.plan_seq), '[]')
    from public.coolerco_audit_stores s
    join public.coolerco_audit_auditors x on x.id = s.auditor_id
    left join public.coolerco_outlets o on o.client_code = s.client_code and o.outlet_code = s.outlet_code
   where s.audit_id = p_audit and s.plan_day = p_day and (x.user_id = auth.uid() or public.coolerco_audit_office())
$$;

create or replace function public.coolerco_audit_store(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.coolerco_audit_stores; o public.coolerco_outlets;
begin
  if not public.coolerco_audit_can_work(p_store) then return jsonb_build_object('error', 'not_allowed'); end if;
  select * into s from public.coolerco_audit_stores where id = p_store;
  select * into o from public.coolerco_outlets where client_code = s.client_code and outlet_code = s.outlet_code;
  return jsonb_build_object('store', to_jsonb(s) - 'risk', 'audit', (select jsonb_build_object('code', code, 'name', name, 'status', status) from public.coolerco_audits where id = s.audit_id),
    'outlet', jsonb_build_object('name', o.name, 'contact_person', o.contact_person, 'mobile_number', o.mobile_number, 'email', o.email,
                                 'street_address', o.street_address, 'suburb', o.suburb, 'town', o.town, 'latitude', o.latitude, 'longitude', o.longitude),
    'expected', s.coolers_expected,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'asset_number', i.asset_number, 'model', i.model, 'expected', i.expected, 'result', i.result,
                 'registered_at', i.registered_at, 'scanned_at', i.scanned_at) order by i.expected desc, i.result = 'pending' desc, i.asset_number)
               from public.coolerco_audit_items i where i.audit_store_id = p_store), '[]'));
end $$;

create or replace function public.coolerco_audit_scan(p_store uuid, p_code text, p_how text default 'typed')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.coolerco_audit_stores; a public.coolerco_assets; it public.coolerco_audit_items; v_code text := upper(trim(coalesce(p_code, '')));
        v_by text := coalesce(auth.jwt() ->> 'email', 'user'); v_res text; v_reg text; v_model text;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'sign_in'); end if;
  if v_code = '' then return jsonb_build_object('error', 'code_required'); end if;
  if not public.coolerco_audit_can_work(p_store) then return jsonb_build_object('error', 'not_allowed'); end if;
  select * into s from public.coolerco_audit_stores where id = p_store for update;
  if s.status = 'visited' then return jsonb_build_object('error', 'store_finished'); end if;
  if (select status from public.coolerco_audits where id = s.audit_id) in ('done', 'cancelled') then return jsonb_build_object('error', 'audit_closed'); end if;
  -- the audit's client first, then any client CoolerCo runs
  select * into a from public.coolerco_assets where (upper(asset_number) = v_code or upper(coalesce(serial_number, '')) = v_code)
   order by (client_code = s.client_code) desc limit 1;
  if found then
    select coalesce(m.display_name, m.description, a.model_code) into v_model from public.coolerco_asset_models m where m.client_code = a.client_code and m.model_code = a.model_code;
    select * into it from public.coolerco_audit_items where audit_store_id = p_store and asset_number = a.asset_number;
    if it.id is not null then
      if it.result in ('found', 'other_store', 'extra') then return jsonb_build_object('ok', true, 'already', true, 'asset', a.asset_number, 'result', it.result) || public.coolerco_audit_counts(p_store); end if;
      update public.coolerco_audit_items set result = 'found', scanned_at = now(), scanned_by = v_by, scanned_code = p_code, how = p_how where id = it.id;
      v_res := 'found';
    else
      v_reg := case when a.location_type = 'Outlet' then 'store ' || coalesce(a.location_code, '?') else 'warehouse ' || coalesce(a.warehouse_code, a.location_code, '?') end
               || case when a.client_code <> s.client_code then ' (' || a.client_code || ')' else '' end;
      v_res := case when a.location_type = 'Outlet' and a.location_code = s.outlet_code and a.client_code = s.client_code then 'found' else 'other_store' end;
      insert into public.coolerco_audit_items (audit_id, audit_store_id, client_code, asset_number, model, expected, result, registered_at, scanned_at, scanned_by, scanned_code, how)
      values (s.audit_id, p_store, a.client_code, a.asset_number, v_model, false, v_res, v_reg, now(), v_by, p_code, p_how);
    end if;
    insert into public.coolerco_asset_sightings (client_code, asset_number, outlet_code, seen_at, source, by_label, ref)
    values (a.client_code, a.asset_number, s.outlet_code, now(), 'audit', v_by, p_store);
    -- a cooler marked missing in an audit and now seen here -> found at a different location
    update public.coolerco_audit_items set found_elsewhere_outlet = s.outlet_code || coalesce(' · ' || s.outlet_name, ''), found_elsewhere_at = now(), found_elsewhere_by = v_by
     where asset_number = a.asset_number and result = 'missing' and audit_store_id <> p_store;
  else
    insert into public.coolerco_audit_items (audit_id, audit_store_id, client_code, asset_number, expected, result, scanned_at, scanned_by, scanned_code, how)
    values (s.audit_id, p_store, null, v_code, false, 'extra', now(), v_by, p_code, p_how)
    on conflict (audit_store_id, asset_number) do nothing;
    v_res := 'extra';
  end if;
  update public.coolerco_audit_stores set status = case when status = 'planned' then 'in_progress' else status end, started_at = coalesce(started_at, now()) where id = p_store;
  update public.coolerco_audits set status = 'in_progress', updated_at = now() where id = s.audit_id and status = 'planned';
  return jsonb_build_object('ok', true, 'result', v_res, 'asset', coalesce(a.asset_number, v_code), 'model', v_model, 'registered_at', v_reg) || public.coolerco_audit_counts(p_store);
end $$;

create or replace function public.coolerco_audit_counts(p_store uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('expected', count(*) filter (where expected), 'found', count(*) filter (where expected and result = 'found'),
                            'other', count(*) filter (where result = 'other_store'), 'extra', count(*) filter (where result = 'extra'))
    from public.coolerco_audit_items where audit_store_id = p_store
$$;

-- undo one scan (wrong label scanned)
create or replace function public.coolerco_audit_unscan(p_item uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare it public.coolerco_audit_items;
begin
  select * into it from public.coolerco_audit_items where id = p_item;
  if it.id is null or not public.coolerco_audit_can_work(it.audit_store_id) then return jsonb_build_object('error', 'not_allowed'); end if;
  if (select status from public.coolerco_audit_stores where id = it.audit_store_id) = 'visited' then return jsonb_build_object('error', 'store_finished'); end if;
  if it.expected then update public.coolerco_audit_items set result = 'pending', scanned_at = null, scanned_by = null, scanned_code = null where id = p_item;
  else delete from public.coolerco_audit_items where id = p_item; end if;
  delete from public.coolerco_asset_sightings where ref = it.audit_store_id and asset_number = it.asset_number and source = 'audit';
  return jsonb_build_object('ok', true) || public.coolerco_audit_counts(it.audit_store_id);
end $$;

-- finish the store: below n/n the manager questions are required; still-pending coolers become missing
create or replace function public.coolerco_audit_store_finish(p_store uuid, p_answers jsonb default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.coolerco_audit_stores; v_pending int; v_by text := coalesce(auth.jwt() ->> 'email', 'user');
begin
  if auth.uid() is null or not public.coolerco_audit_can_work(p_store) then return jsonb_build_object('error', 'not_allowed'); end if;
  select * into s from public.coolerco_audit_stores where id = p_store for update;
  if s.status = 'visited' then return jsonb_build_object('error', 'store_finished'); end if;
  select count(*) into v_pending from public.coolerco_audit_items where audit_store_id = p_store and expected and result = 'pending';
  if v_pending > 0 and (p_answers is null or not (p_answers ? 'all_covered') or not (p_answers ? 'back_rooms') or not (p_answers ? 'other_stores')) then
    return jsonb_build_object('error', 'questions_required', 'pending', v_pending);
  end if;
  update public.coolerco_audit_items i set result = 'missing',
         found_elsewhere_outlet = (select g.outlet_code from public.coolerco_asset_sightings g where g.client_code = i.client_code and g.asset_number = i.asset_number
                                     and g.outlet_code <> s.outlet_code and g.seen_at > coalesce(s.started_at, now()) - interval '1 day' order by g.seen_at desc limit 1),
         found_elsewhere_at = (select g.seen_at from public.coolerco_asset_sightings g where g.client_code = i.client_code and g.asset_number = i.asset_number
                                 and g.outlet_code <> s.outlet_code and g.seen_at > coalesce(s.started_at, now()) - interval '1 day' order by g.seen_at desc limit 1)
   where audit_store_id = p_store and expected and result = 'pending';
  update public.coolerco_audit_stores set status = 'visited', visited_at = now(), visited_by = v_by, started_at = coalesce(started_at, now()),
         manager_answers = p_answers, note = nullif(trim(coalesce(p_note, '')), '') where id = p_store;
  update public.coolerco_audits set status = case when not exists (select 1 from public.coolerco_audit_stores where audit_id = s.audit_id and status <> 'visited') then 'done' else 'in_progress' end,
         updated_at = now() where id = s.audit_id and status in ('planned', 'in_progress');
  return jsonb_build_object('ok', true, 'missing', v_pending) || public.coolerco_audit_counts(p_store);
end $$;

-- the auditor fixes the store's details on the spot (logged in coolerco_outlet_changes)
create or replace function public.coolerco_audit_store_fix(p_store uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.coolerco_audit_stores; o public.coolerco_outlets; f text; v_old text; v_new text; v_n int := 0; v_lat double precision; v_lng double precision;
        v_by text := 'audit: ' || coalesce(auth.jwt() ->> 'email', 'user'); v_fields text[] := array['name', 'contact_person', 'mobile_number', 'email', 'street_address', 'suburb', 'town'];
begin
  if auth.uid() is null or not public.coolerco_audit_can_work(p_store) then return jsonb_build_object('error', 'not_allowed'); end if;
  select * into s from public.coolerco_audit_stores where id = p_store;
  select * into o from public.coolerco_outlets where client_code = s.client_code and outlet_code = s.outlet_code for update;
  if not found then return jsonb_build_object('error', 'no_outlet'); end if;
  foreach f in array v_fields loop
    if p ? f then
      execute format('select ($1).%I::text', f) using o into v_old;
      v_new := nullif(trim(p ->> f), '');
      if f = 'name' and v_new is null then continue; end if;
      if v_new is distinct from v_old then
        execute format('update public.coolerco_outlets set %I = $1, updated_at = now(), updated_by = $3 where id = $2', f) using v_new, o.id, v_by;
        insert into public.coolerco_outlet_changes (client_code, outlet_code, case_number, field, old_value, new_value, changed_by)
        values (s.client_code, o.outlet_code, null, f, v_old, v_new, v_by);
        v_n := v_n + 1;
      end if;
    end if;
  end loop;
  if nullif(p ->> 'latitude', '') is not null then
    v_lat := (p ->> 'latitude')::double precision; v_lng := (p ->> 'longitude')::double precision;
    if v_lat is null or v_lng is null or v_lat not between -35.5 and -21.5 or v_lng not between 16 and 33.5 then return jsonb_build_object('error', 'bad_gps'); end if;
    if v_lat is distinct from o.latitude or v_lng is distinct from o.longitude then
      update public.coolerco_outlets set latitude = v_lat, longitude = v_lng, gps_source = 'audit', gps_set_by = v_by, gps_set_at = now(), updated_at = now() where id = o.id;
      insert into public.coolerco_outlet_changes (client_code, outlet_code, case_number, field, old_value, new_value, changed_by)
      values (s.client_code, o.outlet_code, null, 'gps', o.latitude || ',' || o.longitude, v_lat || ',' || v_lng, v_by);
      update public.coolerco_audit_stores set gps_lat = v_lat, gps_lng = v_lng where id = p_store;
      v_n := v_n + 1;
    end if;
  end if;
  if v_n > 0 then update public.coolerco_audit_stores set store_fixed = true where id = p_store; end if;
  return jsonb_build_object('ok', true, 'changed', v_n);
end $$;

-- ── audit report: exceptions (incl. found at a different location), answers, per auditor ──
create or replace function public.coolerco_audit_report(p_audit uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a public.coolerco_audits;
begin
  select * into a from public.coolerco_audits where id = p_audit;
  if not found or auth.uid() is null or not public.coolerco_can_see(a.client_code, null) then return jsonb_build_object('error', 'not_found'); end if;
  return jsonb_build_object(
    'totals', (select jsonb_build_object('expected', count(*) filter (where i.expected), 'found', count(*) filter (where i.result = 'found'),
                 'missing', count(*) filter (where i.result = 'missing' and i.found_elsewhere_outlet is null),
                 'found_elsewhere', count(*) filter (where i.result = 'missing' and i.found_elsewhere_outlet is not null),
                 'other_store', count(*) filter (where i.result = 'other_store'), 'extra', count(*) filter (where i.result = 'extra'),
                 'pending', count(*) filter (where i.result = 'pending'))
               from public.coolerco_audit_items i where i.audit_id = p_audit),
    'exceptions', coalesce((select jsonb_agg(jsonb_build_object('item', i.id, 'asset_number', i.asset_number, 'model', i.model,
                 'kind', case when i.result = 'missing' and i.found_elsewhere_outlet is not null then 'found_elsewhere' else i.result end,
                 'store', s.outlet_code, 'store_name', s.outlet_name, 'region', s.region, 'rep_code', s.rep_code,
                 'registered_at', i.registered_at, 'found_elsewhere_outlet', i.found_elsewhere_outlet, 'found_elsewhere_at', i.found_elsewhere_at,
                 'found_elsewhere_by', i.found_elsewhere_by, 'scanned_at', i.scanned_at, 'scanned_by', i.scanned_by, 'visited_at', s.visited_at,
                 'answers', s.manager_answers) order by s.region, s.outlet_code, i.asset_number)
               from public.coolerco_audit_items i join public.coolerco_audit_stores s on s.id = i.audit_store_id
              where i.audit_id = p_audit and i.result in ('missing', 'other_store', 'extra')), '[]'),
    'by_auditor', coalesce((select jsonb_agg(jsonb_build_object('label', x.label, 'person_name', x.person_name,
                 'stores', (select count(*) from public.coolerco_audit_stores s where s.auditor_id = x.id),
                 'visited', (select count(*) from public.coolerco_audit_stores s where s.auditor_id = x.id and s.status = 'visited'),
                 'scanned', (select count(*) from public.coolerco_audit_items i join public.coolerco_audit_stores s on s.id = i.audit_store_id where s.auditor_id = x.id and i.result <> 'pending'),
                 'fixed', (select count(*) from public.coolerco_audit_stores s where s.auditor_id = x.id and s.store_fixed)) order by x.seq)
               from public.coolerco_audit_auditors x where x.audit_id = p_audit), '[]'),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d.plan_day, 'stores', d.n, 'visited', d.v) order by d.plan_day)
               from (select plan_day, count(*) n, count(*) filter (where status = 'visited') v from public.coolerco_audit_stores where audit_id = p_audit group by plan_day) d), '[]'));
end $$;

-- ── always-on: coolers not seen at their store for 1 / 2 / 3 months ─────────────────────────
create or replace function public.coolerco_not_scanned(p_client text default null, p_warehouse text default null)
returns table (client_code text, asset_number text, model text, outlet_code text, outlet_name text, region text, rep_code text, warehouse_code text,
               last_seen timestamptz, days int, bucket text, seen_elsewhere_outlet text, seen_elsewhere_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  with x as (
    select a.client_code, a.asset_number, coalesce(m.display_name, m.description, a.model_code) model, a.location_code outlet_code, o.name outlet_name,
           o.region, o.rep_code, o.warehouse_code,
           (select max(g.seen_at) from public.coolerco_asset_sightings g where g.client_code = a.client_code and g.asset_number = a.asset_number and g.outlet_code = a.location_code) last_seen,
           (select g.outlet_code || coalesce(' · ' || oo.name, '') from public.coolerco_asset_sightings g
              left join public.coolerco_outlets oo on oo.client_code = g.client_code and oo.outlet_code = g.outlet_code
             where g.client_code = a.client_code and g.asset_number = a.asset_number and g.outlet_code <> a.location_code order by g.seen_at desc limit 1) elsewhere,
           (select max(g.seen_at) from public.coolerco_asset_sightings g where g.client_code = a.client_code and g.asset_number = a.asset_number and g.outlet_code <> a.location_code) elsewhere_at
      from public.coolerco_assets a
      join public.coolerco_outlets o on o.client_code = a.client_code and o.outlet_code = a.location_code
      left join public.coolerco_asset_models m on m.client_code = a.client_code and m.model_code = a.model_code
     where auth.uid() is not null and a.location_type = 'Outlet' and public.coolerco_is_self_managed(a.client_code)
       and public.coolerco_can_see(a.client_code, o.warehouse_code)
       and (p_client is null or a.client_code = p_client) and (p_warehouse is null or o.warehouse_code = p_warehouse))
  select client_code, asset_number, model, outlet_code, outlet_name, region, rep_code, warehouse_code, last_seen,
         case when last_seen is null then null else extract(day from now() - last_seen)::int end,
         case when last_seen is null then 'never' when last_seen > now() - interval '30 days' then 'ok' when last_seen > now() - interval '60 days' then 'm1'
              when last_seen > now() - interval '90 days' then 'm2' else 'm3' end,
         case when elsewhere_at > coalesce(last_seen, '-infinity') then elsewhere end,
         case when elsewhere_at > coalesce(last_seen, '-infinity') then elsewhere_at end
    from x order by last_seen nulls first
$$;

-- ── grants ───────────────────────────────────────────────────────────────────────────────────
do $g$
declare f text;
begin
  foreach f in array array['coolerco_audit_create(jsonb)', 'coolerco_audit_plan(uuid, integer)', 'coolerco_audit_summary(uuid)', 'coolerco_audit_list()',
    'coolerco_audit_get(uuid)', 'coolerco_audit_people(uuid)', 'coolerco_audit_set_auditor(uuid, uuid, text, text, text)', 'coolerco_audit_move_store(uuid, uuid, date)',
    'coolerco_audit_set_status(uuid, text)', 'coolerco_audit_my_days()', 'coolerco_audit_day(uuid, date)', 'coolerco_audit_store(uuid)',
    'coolerco_audit_scan(uuid, text, text)', 'coolerco_audit_counts(uuid)', 'coolerco_audit_unscan(uuid)', 'coolerco_audit_store_finish(uuid, jsonb, text)',
    'coolerco_audit_store_fix(uuid, jsonb)', 'coolerco_audit_report(uuid)', 'coolerco_not_scanned(text, text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
  foreach f in array array['coolerco_audit_office()', 'coolerco_audit_can_work(uuid)', 'coolerco_last_seen(text, text, text)', 'coolerco_km(double precision, double precision, double precision, double precision)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
  end loop;
end $g$;
