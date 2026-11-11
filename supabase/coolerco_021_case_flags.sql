-- CoolerCo-Ops · 021 · Case flags (read only, additive — two new functions, nothing else changed)
--   1. coolerco_repeat_workshop_repairs(since, warehouse)
--      A Repair at Workshop that follows a SOLVED Repair at Workshop on the same asset, with no other case of any
--      type on that asset in between. The follow-on repair was created on/after "since" (default: 3 months ago).
--   2. coolerco_duplicate_open_cases(warehouse)
--      Assets that have two or more OPEN cases at the same time (COM and CoolerCo together) — the one-case rule
--      should stop this, so anything here slipped through.
-- Asset on a case: Asset Repaired / Removed / Delivered; Mapped Asset only when none of those is filled.
-- Signed-in users only. Rollback: coolerco_021_rollback.sql

create or replace function public.coolerco_repeat_workshop_repairs(p_since date default (now() - interval '3 months')::date, p_warehouse text default null)
returns table (asset text, bar_code text, local_code text, product_base text, asset_status text, warehouse text,
               first_case text, first_created timestamptz, first_closed timestamptz,
               second_case text, second_created timestamptz, second_status text, second_closed timestamptz,
               days_after_closure int, repairs_in_period int)
language sql stable security invoker set search_path = public, pg_temp as $$
  with rw as (
    select c.case_number, coalesce(c.asset_repaired, c.mapped_asset) as asset, c.status_reason, c.created_on,
           c.service_closure_date, c.warehouse_workshop
      from public.cases c
     where c.case_type = 'Repair at Workshop' and coalesce(c.asset_repaired, c.mapped_asset) is not null
  ), pairs as (
    select b.asset, b.warehouse_workshop, a.case_number as first_case, a.created_on as first_created,
           a.service_closure_date as first_closed, a.status_reason as first_status,
           b.case_number as second_case, b.created_on as second_created, b.status_reason as second_status,
           b.service_closure_date as second_closed
      from rw b
      join lateral (select * from rw a where a.asset = b.asset and a.created_on < b.created_on
                     order by a.created_on desc limit 1) a on true
     where b.created_on >= coalesce(p_since, (now() - interval '3 months')::date)
       and (p_warehouse is null or b.warehouse_workshop = p_warehouse)
  )
  select p.asset, al.bar_code, al.local_code, al.product_base, al.asset_status, p.warehouse_workshop,
         p.first_case, p.first_created, p.first_closed,
         p.second_case, p.second_created, p.second_status, p.second_closed,
         case when p.first_closed is not null then floor(extract(epoch from p.second_created - p.first_closed) / 86400)::int end,
         (count(*) over (partition by p.asset))::int
    from pairs p
    left join public.assets_live al on al.name = p.asset
   where p.first_status = 'Solved'
     and not exists (
       select 1 from public.cases o
        where o.case_number not in (p.first_case, p.second_case)
          and p.asset in (o.asset_repaired, o.asset_removed, o.asset_delivered, o.mapped_asset)
          and o.created_on > p.first_created and o.created_on < p.second_created)
     and not exists (
       select 1 from public.coolerco_cases k
        where p.asset in (k.asset_repaired, k.asset_removed, k.asset_delivered, k.mapped_asset)
          and k.created_on > p.first_created and k.created_on < p.second_created)
   order by p.second_created desc;
$$;

create or replace function public.coolerco_duplicate_open_cases(p_warehouse text default null)
returns table (asset text, bar_code text, local_code text, product_base text, asset_status text, asset_now text,
               open_cases int, has_coolerco boolean, warehouses text, cases jsonb)
language sql stable security invoker set search_path = public, pg_temp as $$
  with c as (
    select 'COM'::text as source, x.case_number, x.case_type, x.status_reason, x.created_on, x.warehouse_workshop, x.point_of_sale,
           array_remove(case when coalesce(x.asset_repaired, x.asset_removed, x.asset_delivered) is null then array[x.mapped_asset]
                             else array[x.asset_repaired, x.asset_removed, x.asset_delivered] end, null) as assets
      from public.cases x
     where x.status_reason in ('Open', 'In Progress', 'Waiting', 'In Service', 'On Hold')
    union all
    select 'CoolerCo', k.case_number, k.case_type, k.status_reason, k.created_on, k.warehouse_workshop, k.point_of_sale,
           array_remove(case when coalesce(k.asset_repaired, k.asset_removed, k.asset_delivered) is null then array[k.mapped_asset]
                             else array[k.asset_repaired, k.asset_removed, k.asset_delivered] end, null)
      from public.coolerco_cases k
     where not public.coolerco_case_is_closed(k.status_reason)
  ), a as (
    select distinct c.source, c.case_number, c.case_type, c.status_reason, c.created_on, c.warehouse_workshop, c.point_of_sale, u.asset
      from c cross join lateral unnest(c.assets) as u(asset)
  ), g as (
    select a.asset, count(distinct a.case_number)::int as n, bool_or(a.source = 'CoolerCo') as has_cc,
           string_agg(distinct replace(coalesce(a.warehouse_workshop, '—'), 'RTMA ', ''), ', ') as whs,
           jsonb_agg(jsonb_build_object('source', a.source, 'case_number', a.case_number, 'case_type', a.case_type,
                     'status', a.status_reason, 'created_on', a.created_on, 'point_of_sale', a.point_of_sale) order by a.created_on) as cases
      from a group by a.asset having count(distinct a.case_number) > 1
  )
  select g.asset, al.bar_code, al.local_code, al.product_base, al.asset_status,
         coalesce(al.assign_account, '') || case when al.asset_location is not null then ' · ' || al.asset_location else '' end,
         g.n, g.has_cc, g.whs, g.cases
    from g left join public.assets_live al on al.name = g.asset
   where p_warehouse is null or exists (select 1 from jsonb_array_elements(g.cases) e where e ->> 'case_number' in (
           select case_number from public.cases where warehouse_workshop = p_warehouse
           union all select case_number from public.coolerco_cases where warehouse_workshop = p_warehouse))
   order by g.n desc, g.asset;
$$;

revoke all on function public.coolerco_repeat_workshop_repairs(date, text) from public, anon;
grant execute on function public.coolerco_repeat_workshop_repairs(date, text) to authenticated;
revoke all on function public.coolerco_duplicate_open_cases(text) from public, anon;
grant execute on function public.coolerco_duplicate_open_cases(text) to authenticated;
