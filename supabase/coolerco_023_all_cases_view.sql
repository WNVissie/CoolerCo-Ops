-- ============================================================================
-- CoolerCo 023 — extra COM case fields + one combined cases view
-- Run on: TEST first (🟢[TEST] RTMA_Ops). Production only when Wanda says so.
-- Needs:  003 (coolerco_cases), 007 (com_case_number), 016 (client_code).
-- Adds:   2 views. Nothing existing is changed; no data is copied or moved.
--         COM `cases` is only READ (never written).
-- Rollback: coolerco_023_rollback.sql (drops the 2 views).
-- ============================================================================

-- ── 1. Extra COM fields, lifted from the stored COM row (cases.raw_case) ─────
-- One row per COM case. Join on case_number when a screen or report needs them.
-- Values are exactly as COM exported them (text). Dates here are NOT converted
-- yet: use them for display, not for SLA sums, until the format is confirmed.
-- To add another COM field later: add one line here and re-run this script.
create or replace view public.coolerco_com_case_extra
with (security_invoker = true) as
select
  c.case_number,
  nullif(trim(c.raw_case ->> '(Do Not Modify) Case'), '')        as com_id,
  nullif(trim(c.raw_case ->> 'Cancel Reason'), '')               as cancel_reason,
  nullif(trim(c.raw_case ->> 'Canceled Method'), '')             as canceled_method,
  nullif(trim(c.raw_case ->> 'Cancel Request'), '')              as cancel_request,
  nullif(trim(c.raw_case ->> 'Expected Service Date'), '')       as expected_service_date,
  nullif(trim(c.raw_case ->> 'Expected SLA'), '')                as expected_sla,
  nullif(trim(c.raw_case ->> 'Service SLA'), '')                 as service_sla,
  nullif(trim(c.raw_case ->> 'Case Age'), '')                    as case_age,
  nullif(trim(c.raw_case ->> 'Contact'), '')                     as contact,
  nullif(trim(c.raw_case ->> 'Email Address'), '')               as email_address,
  nullif(trim(c.raw_case ->> 'Responsible Contact'), '')         as responsible_contact,
  nullif(trim(c.raw_case ->> 'Concessionaire'), '')              as concessionaire,
  nullif(trim(c.raw_case ->> 'Salesman'), '')                    as salesman,
  nullif(trim(c.raw_case ->> 'Category'), '')                    as category,
  nullif(trim(c.raw_case ->> 'Product Cluster'), '')             as product_cluster,
  nullif(trim(c.raw_case ->> 'Brand Hierarchy'), '')             as brand_hierarchy,
  nullif(trim(c.raw_case ->> 'Fault code note'), '')             as fault_code_note,
  nullif(trim(c.raw_case ->> 'Damage Origin'), '')               as damage_origin,
  nullif(trim(c.raw_case ->> 'Service Measures'), '')            as service_measures,
  nullif(trim(c.raw_case ->> 'Service Measure Reason'), '')      as service_measure_reason,
  nullif(trim(c.raw_case ->> 'Additional Notes'), '')            as additional_notes,
  nullif(trim(c.raw_case ->> 'Error Detail'), '')                as error_detail,
  nullif(trim(c.raw_case ->> 'Acceptance Status'), '')           as acceptance_status,
  nullif(trim(c.raw_case ->> 'Previous Related Case'), '')       as previous_related_case,
  nullif(trim(c.raw_case ->> 'Main Case'), '')                   as main_case,
  nullif(trim(c.raw_case ->> 'Master Case'), '')                 as master_case,
  nullif(trim(c.raw_case ->> 'External Ticket'), '')             as external_ticket,
  nullif(trim(c.raw_case ->> 'Record Creation Method'), '')      as record_creation_method,
  nullif(trim(c.raw_case ->> 'Created By'), '')                  as created_by,
  nullif(trim(c.raw_case ->> 'Portal User Created by'), '')      as portal_user_created_by,
  nullif(trim(c.raw_case ->> 'Modified By'), '')                 as modified_by,
  nullif(trim(c.raw_case ->> 'Modified On'), '')                 as modified_on,
  nullif(trim(c.raw_case ->> 'First Response At'), '')           as first_response_at,
  nullif(trim(c.raw_case ->> 'Goods Issue'), '')                 as goods_issue,
  nullif(trim(c.raw_case ->> 'Goods Receive'), '')               as goods_receive,
  nullif(trim(c.raw_case ->> 'Service Delivered At'), '')        as service_delivered_at
from public.cases c;

-- ── 2. One combined view: COM cases (Magnum) + CoolerCo cases (Tiger, portal) ─
-- Same column names on both sides, plus:
--   source          'COM' | 'CoolerCo'
--   client_code     MAGNUM for every COM case; the case's own client for CoolerCo cases
--   is_open         COM: Open, In Progress, Waiting, In Service, On Hold
--                   CoolerCo: anything not Rejected / Cancelled / Completed / Closed / Solved / Resolved / Linked to COM
--   counts_as_case  false for a CoolerCo request that is already linked to a COM case
--                   (same job, logged twice) → filter on this so totals never double count
create or replace view public.coolerco_all_cases
with (security_invoker = true) as
select
  'COM'::text                               as source,
  'MAGNUM'::text                            as client_code,
  c.case_number::text                       as case_number,
  c.case_type::text                         as case_type,
  c.status_reason::text                     as status_reason,
  (lower(trim(coalesce(c.status_reason, ''))) in ('open', 'in progress', 'waiting', 'in service', 'on hold')) as is_open,
  true                                      as counts_as_case,
  c.priority::text                          as priority,
  c.origin::text                            as origin,
  null::text                                as originator,
  c.motive::text                            as motive,
  c.warehouse_workshop::text                as warehouse_workshop,
  c.responsible_ordering_party::text        as responsible_ordering_party,
  c.point_of_sale::text                     as point_of_sale,
  c.pos_local_code::text                    as pos_local_code,
  c.address::text                           as address,
  nullif(c.latitude::text, '')::double precision  as latitude,
  nullif(c.longitude::text, '')::double precision as longitude,
  c.case_contact_name::text                 as case_contact_name,
  c.case_contact_number::text               as case_contact_number,
  c.case_mobile_number::text                as case_mobile_number,
  c.asset_type::text                        as asset_type,
  c.mapped_asset::text                      as mapped_asset,
  c.asset_removed::text                     as asset_removed,
  c.asset_delivered::text                   as asset_delivered,
  c.asset_repaired::text                    as asset_repaired,
  c.asset_condition::text                   as asset_condition,
  c.requested_product_base::text            as requested_product_base,
  c.requested_asset_condition::text         as requested_asset_condition,
  c.requested_brand_hierarchy::text         as requested_brand_hierarchy,
  c.created_on::timestamptz                 as created_on,
  c.begin_date::timestamptz                 as begin_date,
  c.end_date::timestamptz                   as end_date,
  c.service_closure_date::timestamptz       as service_closure_date,
  c.sla_status::text                        as sla_status,
  c.technician_routed_to::text              as technician_routed_to,
  c.contractor::text                        as contractor,
  c.message::text                           as notes,
  null::text                                as com_case_number
from public.cases c
union all
select
  'CoolerCo'::text,
  coalesce(k.client_code, 'MAGNUM')::text,
  k.case_number,
  k.case_type,
  k.status_reason,
  (coalesce(k.status_reason, '') not in ('Rejected', 'Cancelled', 'Canceled', 'Completed', 'Closed', 'Solved', 'Resolved', 'Linked to COM')),
  (k.com_case_number is null),
  k.priority,
  k.origin,
  k.originator,
  k.motive,
  k.warehouse_workshop,
  k.responsible_ordering_party,
  k.point_of_sale,
  k.pos_local_code,
  k.address,
  k.latitude,
  k.longitude,
  k.case_contact_name,
  k.case_contact_number,
  k.case_mobile_number,
  k.asset_type,
  k.mapped_asset,
  k.asset_removed,
  k.asset_delivered,
  k.asset_repaired,
  k.asset_condition,
  k.requested_product_base,
  k.requested_asset_condition,
  k.requested_brand_hierarchy,
  k.created_on,
  k.begin_date,
  k.end_date,
  k.service_closure_date,
  null::text,          -- SLA result for CoolerCo cases: to be calculated (SLA rules not built yet)
  null::text,          -- technician: column to be added with the Tiger case lifecycle
  null::text,          -- contractor: same
  k.description,
  k.com_case_number
from public.coolerco_cases k;

-- ── 3. Who may read them: signed-in users only (never the public key) ────────
-- security_invoker = the views follow the reader's own rights on the tables underneath.
revoke all on public.coolerco_com_case_extra from public, anon;
revoke all on public.coolerco_all_cases      from public, anon;
grant select on public.coolerco_com_case_extra to authenticated;
grant select on public.coolerco_all_cases      to authenticated;

comment on view public.coolerco_com_case_extra is 'CoolerCo 023: extra COM case fields read from cases.raw_case (text, as exported). Read only.';
comment on view public.coolerco_all_cases      is 'CoolerCo 023: COM cases + CoolerCo cases with the same column names. Filter counts_as_case to avoid double counting linked requests. Read only.';

-- ── 4. Check after running (read only; expect the two totals to match) ───────
-- select (select count(*) from public.cases) + (select count(*) from public.coolerco_cases) as tables_total,
--        (select count(*) from public.coolerco_all_cases) as view_total;
-- select source, client_code, is_open, count(*) from public.coolerco_all_cases group by 1, 2, 3 order by 1, 2, 3;
-- select count(*) as cases, count(cancel_reason) as with_cancel_reason, count(email_address) as with_email,
--        count(expected_service_date) as with_expected_date from public.coolerco_com_case_extra;
