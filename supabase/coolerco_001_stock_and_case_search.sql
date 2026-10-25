-- CoolerCo-Ops · 001 · Asset stock view, case search function, search indexes
-- Target: RTMA_Ops PRODUCTION (abgxjfeofgvimmimxvpa)
-- READ-ONLY ADDITIONS: no table is altered, no row is inserted/updated/deleted.
-- Everything is additive and safe to re-run (CREATE OR REPLACE / IF NOT EXISTS).
-- Both objects run as the calling user (security invoker), so existing
-- row-level security still applies (assets_live needs a logged-in user).

-- ---------------------------------------------------------------------
-- 1. Status -> WMS bay rule (one place, reused by the view and the app)
--    Source: "RTMA Status Mapping" artifact, confirmed by Wanda 2026-10-25
-- ---------------------------------------------------------------------
create or replace function public.coolerco_bay_for_status(p_status text)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(p_status, '')))
    when 'waiting for action' then 'RED'      -- received, awaiting assessment
    when 'to audit'           then 'RED'
    when 'to be repaired'     then 'ORANGE'   -- repair / wash bay
    when 'to be refurbished'  then 'ORANGE'
    when 'broken'             then 'ORANGE'
    when 'ready to work'      then 'GREEN'    -- available stock
    when 'to be branded'      then 'YELLOW'   -- decal prep, not yet available
    when 'to be scrapped'     then 'SCRAP'
    when 'in transit'         then 'PENDING'
    when 'missing'            then 'MISSING'
    else 'OTHER'
  end
$$;

-- ---------------------------------------------------------------------
-- 2. RTMA (CoolerCo) warehouse asset stock
--    Only assets physically at an RTMA warehouse (WH) or workshop (WS).
--    DDS, other suppliers and assets at POS are excluded by design.
-- ---------------------------------------------------------------------
create or replace view public.coolerco_wh_asset_stock
with (security_invoker = true) as
select
  w.code                                   as warehouse_code,
  r.region                                 as warehouse_name,
  r.location_type,
  a.asset_status,
  public.coolerco_bay_for_status(a.asset_status) as bay,
  a.asset_type,
  a.condition,
  count(distinct a.name)::int              as assets
from public.assets_live a
cross join lateral (
  select
    substring(a.assign_account from '^RTMA (.+) (?:WH|WS)$') as region,
    case when a.assign_account ~ ' WS$' then 'Workshop' else 'Warehouse' end as location_type
) r
left join public.warehouses w
  on w.name = r.region and w.warehouse_type = 'regional'
where a.asset_location in ('Warehouse', 'Workshop')
  and a.assign_account ~ '^RTMA .+ (WH|WS)$'
group by 1, 2, 3, 4, 5, 6, 7;

-- ---------------------------------------------------------------------
-- 3. Case search: open cases by default, closed cases only on request
--    Asset search accepts asset number, barcode or local code and matches
--    every asset role on the case (mapped / delivered / removed / repaired).
--    Returns total_count on every row so the app can page and warn on export.
--    raw_case is left out to keep responses small.
-- ---------------------------------------------------------------------
create or replace function public.coolerco_case_search(
  p_case_number text default null,
  p_pos         text default null,   -- POS name (contains) or POS local code (exact)
  p_asset       text default null,   -- asset number, barcode or local code
  p_warehouse   text default null,   -- e.g. 'RTMA Gauteng'
  p_case_type   text default null,
  p_sla_status  text default null,
  p_status      text default 'open', -- 'open' | 'closed' | 'all'
  p_date_field  text default 'created_on', -- created_on | begin_date | end_date | service_closure_date
  p_from        date default null,
  p_to          date default null,
  p_limit       int  default 50,
  p_offset      int  default 0
)
returns table (total_count bigint, case_row jsonb)
language plpgsql
stable
as $$
declare
  v_open   text[] := array['open','in progress','waiting','in service','on hold'];
  v_assets text[];
  v_status text := lower(coalesce(nullif(trim(p_status), ''), 'open'));
begin
  p_case_number := nullif(trim(p_case_number), '');
  p_pos         := nullif(trim(p_pos), '');
  p_asset       := nullif(trim(p_asset), '');
  p_warehouse   := nullif(trim(p_warehouse), '');
  p_case_type   := nullif(trim(p_case_type), '');
  p_sla_status  := nullif(trim(p_sla_status), '');

  -- Closed / all cases need at least one filter so nobody pulls the whole table by accident
  if v_status <> 'open'
     and p_case_number is null and p_pos is null and p_asset is null
     and p_warehouse is null and p_case_type is null and p_sla_status is null
     and p_from is null and p_to is null then
    raise exception 'Add a case number, POS, asset, warehouse, case type or date range to search closed cases';
  end if;

  if p_date_field not in ('created_on','begin_date','end_date','service_closure_date') then
    raise exception 'Unknown date field %', p_date_field;
  end if;

  if p_asset is not null then
    select array_agg(distinct x) into v_assets
    from (
      select p_asset as x
      union all
      select a.name from public.assets_live a
      where a.name = p_asset or a.bar_code = p_asset or a.local_code = p_asset
    ) s;
  end if;

  return query
  with hits as (
    select c.*
    from public.cases c
    where (p_case_number is null or c.case_number ilike '%' || p_case_number || '%')
      and (p_pos is null or c.pos_local_code = p_pos or c.point_of_sale ilike '%' || p_pos || '%')
      and (v_assets is null
           or c.mapped_asset    = any(v_assets)
           or c.asset_delivered = any(v_assets)
           or c.asset_removed   = any(v_assets)
           or c.asset_repaired  = any(v_assets))
      and (p_warehouse is null or c.warehouse_workshop = p_warehouse)
      and (p_case_type is null or c.case_type = p_case_type)
      and (p_sla_status is null or c.sla_status = p_sla_status)
      and (v_status = 'all'
           or (v_status = 'open'   and lower(trim(c.status_reason)) = any(v_open))
           or (v_status = 'closed' and not (lower(trim(coalesce(c.status_reason,''))) = any(v_open))))
      and (p_from is null or (case p_date_field
              when 'begin_date' then c.begin_date
              when 'end_date' then c.end_date
              when 'service_closure_date' then c.service_closure_date
              else c.created_on end) >= p_from)
      and (p_to is null or (case p_date_field
              when 'begin_date' then c.begin_date
              when 'end_date' then c.end_date
              when 'service_closure_date' then c.service_closure_date
              else c.created_on end) < p_to + 1)
  )
  select count(*) over () as total_count,
         to_jsonb(h) - 'raw_case' as case_row
  from hits h
  order by h.created_on desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 0), 50000)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Indexes so searches don't read all 20k cases every time
-- ---------------------------------------------------------------------
create index if not exists idx_cases_created_on            on public.cases (created_on desc);
create index if not exists idx_cases_begin_date            on public.cases (begin_date);
create index if not exists idx_cases_end_date              on public.cases (end_date);
create index if not exists idx_cases_service_closure_date  on public.cases (service_closure_date);
create index if not exists idx_cases_pos_local_code        on public.cases (pos_local_code);
create index if not exists idx_cases_warehouse_workshop    on public.cases (warehouse_workshop);
create index if not exists idx_cases_mapped_asset          on public.cases (mapped_asset);
create index if not exists idx_cases_asset_delivered       on public.cases (asset_delivered);
create index if not exists idx_cases_asset_removed         on public.cases (asset_removed);
create index if not exists idx_cases_asset_repaired        on public.cases (asset_repaired);

-- Only signed-in users may use the new search and stock view
revoke all on function public.coolerco_case_search(text,text,text,text,text,text,text,text,date,date,int,int) from public, anon;
revoke all on public.coolerco_wh_asset_stock from anon;
grant execute on function public.coolerco_bay_for_status(text) to anon, authenticated;
grant execute on function public.coolerco_case_search(text,text,text,text,text,text,text,text,date,date,int,int) to authenticated;
grant select on public.coolerco_wh_asset_stock to authenticated;

-- Hardening (Supabase advisor): fixed search_path on the new functions
alter function public.coolerco_bay_for_status(text) set search_path = public, pg_temp;
alter function public.coolerco_case_search(text,text,text,text,text,text,text,text,date,date,int,int) set search_path = public, pg_temp;
