-- CoolerCo-Ops 014 — Open case, asset already at the POS (READ ONLY)
-- Wanda 2026-10-27: open Deliver / Replacement / Removal cases (created since 1 July 2026)
-- where COM already shows the asset at the store (or back in the warehouse) — the case was not closed.
-- Adds ONE new function. Nothing existing is changed; no tables, no data writes.
-- security definer because routing_warehouse_preparation is not readable by app users (same as 005);
-- execute granted to signed-in users only.
-- Rollback:  drop function if exists public.coolerco_open_case_asset_exceptions(date, text);
--
-- kind:
--   delivered_open   ✅ the asset picked / prepared for this case is already at THIS store
--   other_pos        ⚠ the asset picked / prepared is at ANOTHER store
--   possible         🔍 nothing picked / prepared, but this store already has an asset of the
--                       requested product FAMILY (candidates listed; a replacement's old asset is ignored)
--   collected_open   📦 removal / replacement: the asset to remove is already back in an RTMA WH / WS
-- "Picked / prepared" = routing warehouse prep selected asset, else COM Asset Delivered.

create or replace function public.coolerco_open_case_asset_exceptions(
  p_since     date default '2026-07-01',
  p_warehouse text default null          -- cases.warehouse_workshop, e.g. 'RTMA Gauteng' (null = all)
) returns table (
  kind text, case_number text, case_type text, status_reason text, created_on timestamptz,
  end_date timestamptz, sla_status text, warehouse text, point_of_sale text, pos_local_code text,
  concessionaire text, requested_product_base text, requested_condition text, requested_family text,
  asset text, asset_bar_code text, asset_local_code text, asset_product_base text, asset_condition text,
  asset_source text, picked_at timestamptz, asset_now text, asset_now_pos_code text,
  candidates json
)
language sql stable security definer
set search_path = public, pg_temp
as $$
with fam as (
  select b.product_base, b.family_id, coalesce(f.display_name, f.name) family
  from coolerco_product_base_family b join coolerco_product_families f on f.id = b.family_id),
c as (
  select c.case_number, c.case_type, c.status_reason, c.created_on, c.end_date, c.sla_status,
         c.warehouse_workshop, c.point_of_sale, c.pos_local_code, c.responsible_ordering_party,
         c.requested_product_base, c.requested_asset_condition,
         nullif(c.asset_delivered, '') asset_delivered, nullif(c.asset_removed, '') asset_removed,
         p.selected_asset_name, p.picked_at
  from cases c
  left join lateral (
    select w.selected_asset_name, coalesce(w.picked_at, w.asset_selected_at) picked_at
    from routing_warehouse_preparation w
    where w.case_number = c.case_number and w.selected_asset_name is not null
    order by w.updated_at desc nulls last limit 1) p on true
  where c.status_reason in ('Open', 'In Progress', 'Waiting', 'In Service', 'On Hold')
    and c.case_type in ('Deliver an Asset', 'Replacement of Asset', 'Removal of Asset')
    and c.created_on >= p_since
    and (p_warehouse is null or c.warehouse_workshop = p_warehouse)),
d as (
  select c.*, coalesce(c.selected_asset_name, c.asset_delivered) out_asset,
         case when c.selected_asset_name is not null then 'Routing prep (picked)'
              when c.asset_delivered is not null then 'COM Asset Delivered' end out_source,
         rf.family_id req_family_id, rf.family req_family
  from c left join fam rf on rf.product_base = c.requested_product_base),
-- deliveries / replacements with a picked or prepared asset
outs as (
  select case when a.assign_account_local_code = d.pos_local_code then 'delivered_open' else 'other_pos' end kind,
         d.*, a.name a_name, a.bar_code a_bar, a.local_code a_local, a.product_base a_base, a.condition a_cond,
         coalesce(a.points_of_sale, a.assign_account) a_now, a.assign_account_local_code a_now_code, null::json cands
  from d join assets_live a on a.name = d.out_asset
  where d.case_type <> 'Removal of Asset' and a.asset_location = 'Location'),
-- nothing picked / prepared: same-family assets already at this store
poss as (
  select 'possible'::text kind, d.*, null::text a_name, null::text a_bar, null::text a_local, null::text a_base, null::text a_cond,
         null::text a_now, null::text a_now_code,
         (select json_agg(json_build_object('asset', x.name, 'bar_code', x.bar_code, 'local_code', x.local_code,
                  'product_base', x.product_base, 'condition', x.condition, 'brand', x.brand_hierarchy,
                  'same_model', x.product_base = d.requested_product_base,
                  'same_condition', x.condition = d.requested_asset_condition)
                  order by (x.product_base = d.requested_product_base) desc, (x.condition = d.requested_asset_condition) desc)
          from assets_live x join fam fx on fx.product_base = x.product_base
          where x.asset_location = 'Location' and x.assign_account_local_code = d.pos_local_code
            and fx.family_id = d.req_family_id and x.name is distinct from d.asset_removed) cands
  from d
  where d.case_type <> 'Removal of Asset' and d.out_asset is null and d.req_family_id is not null),
-- removals / replacements: the asset to remove is already back in an RTMA warehouse / workshop
coll as (
  select 'collected_open'::text kind, d.*, r.name, r.bar_code, r.local_code, r.product_base, r.condition,
         r.assign_account, r.assign_account_local_code, null::json
  from d join assets_live r on r.name = d.asset_removed
  where d.case_type in ('Removal of Asset', 'Replacement of Asset') and r.assign_account ~* '^RTMA .* W[HS]$'),
allx as (select * from outs union all select * from poss where cands is not null union all select * from coll)
select x.kind, x.case_number, x.case_type, x.status_reason, x.created_on, x.end_date, x.sla_status, x.warehouse_workshop,
       x.point_of_sale, x.pos_local_code, x.responsible_ordering_party, x.requested_product_base, x.requested_asset_condition, x.req_family,
       x.a_name, x.a_bar, x.a_local, x.a_base, x.a_cond,
       case when x.kind = 'collected_open' then 'COM Asset Removed' else x.out_source end, x.picked_at, x.a_now, x.a_now_code,
       x.cands
from allx x
order by array_position(array['delivered_open','other_pos','collected_open','possible'], x.kind), x.created_on;
$$;

revoke all on function public.coolerco_open_case_asset_exceptions(date, text) from public, anon;
grant execute on function public.coolerco_open_case_asset_exceptions(date, text) to authenticated;
