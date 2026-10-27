-- CoolerCo-Ops 015 — Closure discrepancies: Asset Delivered vs where COM has that asset now (READ ONLY)
-- Wanda 2026-10-27: closed Deliver / Replacement cases (last 3 months by service closure date) where the
-- asset COM says was delivered is NOT at that store — or a cancelled case whose asset IS at the store.
-- Adds ONE new function. Nothing existing is changed; no tables, no data writes. Signed-in users only.
-- Rollback:  drop function if exists public.coolerco_closure_discrepancies(date, text);
--
-- kind:
--   solved_other_pos   Solved, but the delivered asset is at ANOTHER store
--   solved_in_wh       Solved, but the delivered asset is back in an RTMA warehouse / workshop (or not at a POS)
--   cancelled_at_pos   Cancelled, but the asset on the case IS at this store (delivered after all?)
-- explained: a LATER case (created after this one closed) involves the same asset — the move is probably
--            legitimate (e.g. it was removed or replaced afterwards). Shown, but separated in the report.

create or replace function public.coolerco_closure_discrepancies(
  p_since     date default (current_date - interval '3 months')::date,
  p_warehouse text default null           -- cases.warehouse_workshop, e.g. 'RTMA Gauteng' (null = all)
) returns table (
  kind text, case_number text, case_type text, status_reason text, closed_on timestamptz, created_on timestamptz,
  warehouse text, point_of_sale text, pos_local_code text, concessionaire text,
  asset text, asset_bar_code text, asset_local_code text, asset_product_base text, asset_condition text, asset_status text,
  asset_now text, asset_now_location text, asset_now_pos_code text,
  explained boolean, later_case text, later_case_type text, later_case_status text, later_case_created timestamptz
)
language sql stable security invoker
set search_path = public, pg_temp
as $$
with c as (
  select c.case_number, c.case_type, c.status_reason, c.service_closure_date, c.created_on, c.warehouse_workshop,
         c.point_of_sale, c.pos_local_code, c.responsible_ordering_party, nullif(c.asset_delivered, '') ad
  from cases c
  where c.case_type in ('Deliver an Asset', 'Replacement of Asset')
    and c.status_reason in ('Solved', 'Canceled', 'Cancelled')
    and c.service_closure_date >= p_since
    and nullif(c.asset_delivered, '') is not null
    and (p_warehouse is null or c.warehouse_workshop = p_warehouse)),
x as (
  select case
           when c.status_reason = 'Solved' and a.asset_location = 'Location' and a.assign_account_local_code is distinct from c.pos_local_code then 'solved_other_pos'
           when c.status_reason = 'Solved' and coalesce(a.asset_location, '') <> 'Location' then 'solved_in_wh'
           when c.status_reason <> 'Solved' and a.asset_location = 'Location' and a.assign_account_local_code = c.pos_local_code then 'cancelled_at_pos'
         end kind, c.*, a.bar_code, a.local_code, a.product_base, a.condition, a.asset_status,
         a.points_of_sale, a.assign_account, a.asset_location, a.assign_account_local_code
  from c join assets_live a on a.name = c.ad)
select x.kind, x.case_number, x.case_type, x.status_reason, x.service_closure_date, x.created_on,
       x.warehouse_workshop, x.point_of_sale, x.pos_local_code, x.responsible_ordering_party,
       x.ad, x.bar_code, x.local_code, x.product_base, x.condition, x.asset_status,
       coalesce(nullif(x.points_of_sale, ''), x.assign_account), x.asset_location, x.assign_account_local_code,
       l.case_number is not null, l.case_number, l.case_type, l.status_reason, l.created_on
from x
left join lateral (
  select l.case_number, l.case_type, l.status_reason, l.created_on
  from cases l
  where l.case_number <> x.case_number
    and l.created_on > coalesce(x.service_closure_date, x.created_on)
    and (l.asset_removed = x.ad or l.asset_delivered = x.ad or l.asset_repaired = x.ad)
  order by l.created_on limit 1) l on x.kind <> 'cancelled_at_pos'
where x.kind is not null
order by (l.case_number is not null), array_position(array['solved_other_pos','solved_in_wh','cancelled_at_pos'], x.kind), x.service_closure_date desc;
$$;

revoke all on function public.coolerco_closure_discrepancies(date, text) from public, anon;
grant execute on function public.coolerco_closure_discrepancies(date, text) to authenticated;
