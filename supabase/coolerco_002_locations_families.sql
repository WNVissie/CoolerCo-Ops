-- CoolerCo-Ops · 002 · Warehouse locations, stray-asset check, product families
-- Target: RTMA_Ops PRODUCTION (abgxjfeofgvimmimxvpa)
-- ADDITIVE ONLY: new coolerco_ tables/views + one new nullable column on CoolerCo's
-- own coolerco_asset_touch table. No COM or other-app object is changed.

-- ---------------------------------------------------------------------
-- 1. Places: warehouse → building → area
-- ---------------------------------------------------------------------
create table if not exists public.coolerco_wh_locations (
  id             uuid primary key default gen_random_uuid(),
  warehouse_code text not null,          -- JHB, CPT, DBN ...
  building       text not null,          -- 'Receiving WH', 'Main WH', 'NCD WH' ...
  area           text not null,          -- RECEIVING | BAU | NCD | MAIN
  label          text not null,
  is_picking     boolean not null default false,  -- picking / loading happens here
  sort_order     int not null default 100,
  active         boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     text,
  unique (warehouse_code, building, area)
);

-- 2. Rules: "what belongs here". Expected place of an asset = the rule with the
--    lowest priority number that matches its status + condition in its warehouse.
--    NULL list = matches anything.
create table if not exists public.coolerco_wh_location_rules (
  id                 uuid primary key default gen_random_uuid(),
  location_id        uuid not null references public.coolerco_wh_locations(id) on delete cascade,
  match_statuses     text[],
  match_conditions   text[],
  exclude_conditions text[],
  priority           int not null default 100,
  active             boolean not null default true,
  notes              text,
  created_at         timestamptz not null default now()
);

-- Seed (only when empty) — agreed 2026-10-25
do $$
begin
  if exists (select 1 from public.coolerco_wh_locations) then return; end if;

  insert into public.coolerco_wh_locations (warehouse_code, building, area, label, is_picking, sort_order, notes) values
    ('JHB','Receiving WH','RECEIVING','Gauteng · Receiving WH', false, 10, 'Returns land here; repair + decal'),
    ('JHB','Main WH','BAU','Gauteng · Main WH (BAU)', true, 20, 'BAU RTW, picking, staging, truck loading'),
    ('JHB','NCD WH','NCD','Gauteng · NCD WH', true, 30, 'New, to be branded (new), scrap, refurb; NCD picking + loading'),
    ('CPT','Cape Town WH','BAU','Cape Town · BAU', true, 20, 'Receiving, repair and BAU RTW'),
    ('CPT','Cape Town WH','NCD','Cape Town · NCD', true, 30, null),
    ('DBN','Durban WH','BAU','Durban · BAU area', true, 20, 'Receiving, repair and BAU RTW'),
    ('DBN','Durban WH','NCD','Durban · NCD area', true, 30, null),
    ('BFN','Bloemfontein WH','MAIN','Bloemfontein WH', true, 10, null),
    ('EL','East London WH','MAIN','East London WH', true, 10, null),
    ('GEO','George WH','MAIN','George WH', true, 10, null),
    ('NEL','Nelspruit WH','MAIN','Nelspruit WH', true, 10, null),
    ('POL','Polokwane WH','MAIN','Polokwane WH', true, 10, null),
    ('PE','Port Elizabeth WH','MAIN','Port Elizabeth WH', true, 10, null);

  -- NCD rules (JHB, CPT, DBN)
  insert into public.coolerco_wh_location_rules (location_id, match_statuses, match_conditions, priority, notes)
  select id, array['To be Scrapped','To be Refurbished'], null, 10, 'Scrap / refurb' from public.coolerco_wh_locations where area = 'NCD'
  union all
  select id, array['Ready to Work','To be Branded'], array['A - New'], 20, 'New assets incl. to be branded' from public.coolerco_wh_locations where area = 'NCD';

  -- Gauteng Receiving
  insert into public.coolerco_wh_location_rules (location_id, match_statuses, priority, notes)
  select id, array['Waiting for Action','To Audit','To be Repaired','Broken','To be Branded'], 30, 'Returned / repair / BAU decal'
  from public.coolerco_wh_locations where warehouse_code = 'JHB' and area = 'RECEIVING';

  -- Gauteng Main: RTW that is not A - New
  insert into public.coolerco_wh_location_rules (location_id, match_statuses, exclude_conditions, priority, notes)
  select id, array['Ready to Work'], array['A - New'], 40, 'BAU ready to work'
  from public.coolerco_wh_locations where warehouse_code = 'JHB' and area = 'BAU';

  -- CPT / DBN BAU area and single-building warehouses: everything else
  insert into public.coolerco_wh_location_rules (location_id, priority, notes)
  select id, 100, 'Everything not in NCD' from public.coolerco_wh_locations where warehouse_code in ('CPT','DBN') and area = 'BAU'
  union all
  select id, 100, 'Whole warehouse' from public.coolerco_wh_locations where area = 'MAIN';
end $$;

-- 3. Each CoolerCo scan can record the exact building/area (new nullable column)
alter table public.coolerco_asset_touch
  add column if not exists location_id uuid references public.coolerco_wh_locations(id);

-- ---------------------------------------------------------------------
-- 4. Location check: expected place vs last CoolerCo scan, per RTMA stock asset
-- ---------------------------------------------------------------------
create or replace view public.coolerco_asset_location_check
with (security_invoker = true) as
with stock as (
  select a.name, a.bar_code, a.local_code, a.asset_status, a.condition, a.product_base,
         a.asset_location, a.assign_account,
         w.code as warehouse_code,
         w.id   as warehouse_uuid,
         (a.assign_account ~ ' WS$') as at_workshop
  from public.assets_live a
  left join public.warehouses w
    on w.warehouse_type = 'regional'
   and w.name = substring(a.assign_account from '^RTMA (.+) (?:WH|WS)$')
  where a.asset_location in ('Warehouse','Workshop')
    and a.assign_account ~ '^RTMA .+ (WH|WS)$'
),
last_scan as (
  select distinct on (coalesce(t.asset_name, t.bar_code))
         coalesce(t.asset_name, t.bar_code) as asset_key, t.bar_code, t.asset_name,
         t.location_id, t.warehouse_id, t.bay, t.created_at, t.scanned_by
  from public.coolerco_asset_touch t
  order by coalesce(t.asset_name, t.bar_code), t.created_at desc
)
select
  s.*,
  exp.location_id                      as expected_location_id,
  el.label                             as expected_location,
  ls.location_id                       as scanned_location_id,
  sl.label                             as scanned_location,
  sw.code                              as scanned_warehouse,
  ls.created_at                        as last_scan_at,
  ls.scanned_by                        as last_scanned_by,
  (s.at_workshop and not exists (
     select 1 from public.cases c
     where c.case_type = 'Repair at Workshop'
       and lower(trim(c.status_reason)) in ('open','in progress','waiting','in service','on hold')
       and (c.asset_repaired = s.name or c.mapped_asset = s.name)
  ))                                   as workshop_without_case,
  case
    when s.at_workshop then
      case when not exists (
        select 1 from public.cases c
        where c.case_type = 'Repair at Workshop'
          and lower(trim(c.status_reason)) in ('open','in progress','waiting','in service','on hold')
          and (c.asset_repaired = s.name or c.mapped_asset = s.name))
      then 'WORKSHOP_NO_CASE' else 'OK' end
    when ls.asset_key is null then 'NOT_SCANNED'
    when ls.warehouse_id is not null and ls.warehouse_id <> s.warehouse_uuid then 'WRONG_WAREHOUSE'
    when ls.location_id is null then 'NO_AREA_ON_SCAN'
    when exp.location_id is null then 'NO_RULE'
    when ls.location_id <> exp.location_id then 'WRONG_PLACE'
    else 'OK'
  end                                  as check_result
from stock s
left join last_scan ls
  on ls.asset_key = s.name or (ls.asset_name is null and ls.bar_code = s.bar_code)
left join lateral (
  select r.location_id
  from public.coolerco_wh_location_rules r
  join public.coolerco_wh_locations l on l.id = r.location_id and l.active
  where r.active
    and l.warehouse_code = s.warehouse_code
    and (r.match_statuses is null or s.asset_status = any(r.match_statuses))
    and (r.match_conditions is null or s.condition = any(r.match_conditions))
    and (r.exclude_conditions is null or not (coalesce(s.condition,'') = any(r.exclude_conditions)))
  order by r.priority
  limit 1
) exp on true
left join public.coolerco_wh_locations el on el.id = exp.location_id
left join public.coolerco_wh_locations sl on sl.id = ls.location_id
left join public.warehouses sw on sw.id = ls.warehouse_id;

-- ---------------------------------------------------------------------
-- 5. Product families (interim, until COM has one base per product)
-- ---------------------------------------------------------------------
create table if not exists public.coolerco_product_families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  notes      text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.coolerco_product_base_family (
  product_base text primary key,             -- exactly as COM sends it, e.g. '1820 - SD-151 - Hiron'
  family_id    uuid not null references public.coolerco_product_families(id),
  updated_at   timestamptz not null default now(),
  updated_by   text
);

-- Seed: one family per description (the base text without its code number)
insert into public.coolerco_product_families (name)
select distinct upper(trim(regexp_replace(pb, '^\s*[A-Za-z0-9]+\s+-\s+', '')))
from (
  select product_base pb from public.assets_live
  union select requested_product_base from public.cases
  union select removed_product_base from public.cases
) u
where pb is not null and trim(pb) <> ''
on conflict (name) do nothing;

insert into public.coolerco_product_base_family (product_base, family_id)
select u.pb, f.id
from (
  select product_base pb from public.assets_live
  union select requested_product_base from public.cases
  union select removed_product_base from public.cases
) u
join public.coolerco_product_families f
  on f.name = upper(trim(regexp_replace(u.pb, '^\s*[A-Za-z0-9]+\s+-\s+', '')))
where u.pb is not null and trim(u.pb) <> ''
on conflict (product_base) do nothing;

-- ---------------------------------------------------------------------
-- 6. Access: signed-in users read; signed-in users may edit setup for now
--    (tighten to admin role when the user/role table is agreed)
-- ---------------------------------------------------------------------
alter table public.coolerco_wh_locations        enable row level security;
alter table public.coolerco_wh_location_rules   enable row level security;
alter table public.coolerco_product_families    enable row level security;
alter table public.coolerco_product_base_family enable row level security;

do $$
declare t text;
begin
  foreach t in array array['coolerco_wh_locations','coolerco_wh_location_rules','coolerco_product_families','coolerco_product_base_family'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_read') then
      execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    end if;
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_write') then
      execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_write', t);
    end if;
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

revoke all on public.coolerco_asset_location_check from anon;
grant select on public.coolerco_asset_location_check to authenticated;

-- 7. Small summary for the Location Check page (one tiny call instead of ~9k rows)
create or replace view public.coolerco_asset_location_summary
with (security_invoker = true) as
select warehouse_code, check_result, expected_location, count(*)::int as assets
from public.coolerco_asset_location_check
group by 1, 2, 3;
revoke all on public.coolerco_asset_location_summary from anon;
grant select on public.coolerco_asset_location_summary to authenticated;
