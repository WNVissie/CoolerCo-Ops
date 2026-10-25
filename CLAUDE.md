# CoolerCo-Ops — Project Overview & Hand-over

**Last updated:** 2026-10-25 · **Repo:** https://github.com/WNVissie/CoolerCo-Ops (branch `main`)
**Stack:** React 18 + Vite 5 · React Router v6 · Supabase JS v2 · Netlify · SheetJS (lazy, export only)
**Owner:** Wanda (SMART Project Partners). Explain in plain language, simple modern UI, icons, collapsible sections, small fonts, responsive, parallel + lazy loading, say whether server or browser is better.

Related docs (in the claude.ai project): `coolerco-field-mapping.md`, `coolerco-delivery-design.md`.

---

## 1. Golden rules

- **Database = RTMA_Ops PRODUCTION `abgxjfeofgvimmimxvpa`**, shared with the RTMA dashboard (`rtma-cases-dashboard-netlify` / SMARTDash_RTMA), routing app and SmartSpares. **Append/add only** — never alter, rename or drop existing objects. Show the script and get approval before applying.
- Everything CoolerCo adds is prefixed **`coolerco_`** (planned WMS tables: `coolerco_wms_*`).
- **COM (Magnum's D365, built by Noesis) data is one-way**: `cases` and `assets_live` are imported by the dashboard; CoolerCo never writes to them.
- Do **not** change the dashboard repo. Its `CLAUDE.md` + `netlify/functions/upload-cases.js` are the reference for mapping rules.
- The app requires **sign-in** (SmartHub Supabase accounts). `assets_live` RLS only serves authenticated users.
- Two kinds of stock: **asset stock** (coolers in RTMA warehouses — this app) and **spares stock** (baskets, decals… — SmartSpares app, link only: https://smartsparesrtma.netlify.app/).

---

## 2. Data mapping (screen label → field)

| Label | Field |
|---|---|
| Status | `cases.status_reason` (`cases.status` is empty) |
| Open cases | status_reason in Open, In Progress, Waiting, In Service, **On Hold** |
| SLA | `sla_status` — **SLA Exceeded = closed early (good)**; values: SLA Met, SLA Exceeded, SLA Not Met, Open Case SLA Not Met, Open Case SLA Not Measured, SLA Not Measured, Cancelled by Organisation, Cancelled - Out of Stock, Exception - Rejected/Error |
| Concessionaire | `responsible_ordering_party` (never "customer") |
| POS | `point_of_sale`, `pos_local_code` |
| Warehouse (cases) | `warehouse_workshop` = "RTMA Gauteng" |
| Warehouse (assets) | `assign_account` = "RTMA Gauteng WH" / "RTMA Gauteng WS" |
| Asset on a case | Delivery/Prepare → `asset_delivered`; Replacement → `asset_delivered` + `asset_removed`; Removal/Receive → `asset_removed`; Repair at Workshop / Shopper POS / Decal @WH → `asset_repaired`; Scrap / other → any; **`mapped_asset` only as fallback** |
| Requested | `requested_product_base`, `requested_asset_condition`, `requested_brand_hierarchy` |
| Condition | full COM label: `A - New`, `B - Good as New`, `C - Used`, `D - Back of House only` |
| Cases store | the **asset number** (`AST-…`), not barcode → barcode/local code search looks up `assets_live` first |
| Routes | `routing_routes`: route_number, warehouse_group ("RTMA Gauteng"), resource_display_name, vehicle_code, planned_stop_count; stops: case_number, case_type, point_of_sale, outcome_status |
| Warehouse codes | JHB Gauteng, CPT Cape Town, BFN Bloemfontein, DBN Durban, EL East London, GEO George, NEL Nelspruit, POL Polokwane, PE Port Elizabeth (`warehouses` table holds uuid `id` + `code`) |

**CoolerCo stock** = `asset_location` in (Warehouse, Workshop) AND `assign_account` like `RTMA … WH/WS`. DDS (previous supplier), other suppliers and POS assets are **not** stock — only visible when an asset is searched (shows "where is it").

**Bays** (from COM status): Waiting for Action / To Audit → 🔴 RED Receiving · To be Repaired / Refurbished / Broken → 🟠 ORANGE Repair · Ready to Work → 🟢 GREEN · To be Branded → 🟡 YELLOW (not available) · In Transit → 🔵 PENDING · To be Scrapped → ⚫ SCRAP · Missing → ⚠️.

---

## 3. Database objects added (all additive) — scripts in `supabase/`

**001** `coolerco_001_stock_and_case_search.sql`
- `coolerco_bay_for_status(text)` — status → bay
- `coolerco_wh_asset_stock` (view) — stock totals by warehouse / WH-WS / status / bay / type / condition
- `coolerco_case_search(...)` — open by default; search case no / POS / asset (barcode, local code, number across all 4 asset fields) / warehouse / case type / SLA / status open|closed|all / date field (created_on, begin_date, end_date, service_closure_date) + from/to; returns `total_count` + `case_row` (no raw_case); closed/all needs a filter
- 10 indexes `idx_cases_*`

**002** `coolerco_002_locations_families.sql`
- `coolerco_wh_locations` (warehouse → building → area) + `coolerco_wh_location_rules` (what belongs where; lowest priority wins)
  - Gauteng: Receiving WH · Main WH (BAU: RTW not A-New, picking/loading) · NCD WH (A-New incl. to be branded, scrap, refurb; NCD picking)
  - Cape Town & Durban: one building, NCD + BAU areas · others: one MAIN area
- `coolerco_asset_touch.location_id` (new column) — scans record building/area; `warehouse_id` is a **uuid** from `warehouses`
- `coolerco_asset_location_check` (view) + `coolerco_asset_location_summary` — results: WORKSHOP_NO_CASE, WRONG_PLACE, WRONG_WAREHOUSE, NO_AREA_ON_SCAN, NO_RULE, NOT_SCANNED, OK
- `coolerco_product_families` + `coolerco_product_base_family` — interim families (81 families for 96 bases, seeded from base description without code; codes can be letters e.g. `ZAF0001 - BICYCLE`)
- New tables: RLS on, authenticated read/write (tighten to admin role later)

**003** `coolerco_003_cases_portal.sql` (applied in 3 parts 003a tables / 003b functions / 003c lock-down + bucket)
- `coolerco_settings` (portal_catalogue_mode all|available, portal_daily_request_limit) · `coolerco_warehouse_settings` (app code → case code GT, CTN, DBN, BLM, GRG, EL, PE, POL, NEL; default SLA days)
- `coolerco_pos_warehouse` — 19,181 POS from `latest_pos_records` (warehouse) with latest-case fallback; 963 `needs_review`
- Catalogue = product families (+ display_name, description, asset_type, photo_path, show_in_portal, sort_order); 38 families switched on for the demo
- `coolerco_cases` (COM column names + originator/origin, requested_family_id, photo_paths, approval fields) · `coolerco_case_events` (audit) · `coolerco_reason_codes` · `coolerco_case_counters`
- Case number `CAS-ddmmyy-<case code>000001` (`coolerco_next_case_number`, restarts daily per warehouse, server-side lock)
- `coolerco_case_set_status(case, status, reason, notes)` — approve (→ Open, sets begin/end by SLA) / reject (→ Rejected)
- `coolerco_portal_links` (one token per POS, contact pre-filled from latest COM case, `otp_required` for later WhatsApp code) + `coolerco_portal_link_history` (trigger logs contact changes)
- Public portal may ONLY call `coolerco_portal_context(token)` and `coolerco_portal_submit(token, request)` (security definer); bucket `coolerco-cases` (private): anon upload only to `portal/<valid token>/`, staff full; catalogue photos in `catalogue/`
- **POS key = L-code** (`L18042450`) = `cases.pos_local_code` = `latest_pos_records.pos_id` = `assets_live.assign_account_local_code` (NOT `assets_live.pos_local_code`, which has no L)
- Rule: DROP/REVOKE only ever on new coolerco_ objects; never on existing tables

Demo link (OK GROCER CAROLINA 1245, L15060203, Gauteng, 3 assets): `/p/1WdAoeC9TEdWQBp77FVhHVp9`

Live numbers 2026-10-25: stock 8,926 (4,850 RTW) · open cases 4,499 · 37 workshop assets without an open repair case.

---

## 4. App pages (`src/pages`)

| Route | Page |
|---|---|
| `/` | Dashboard — stock, RTW, open, overdue, scans, picking (parallel) |
| `/cases` | Open cases by default; search panel (case/POS/asset, filters, 4 date fields); on-screen max 2 months unless a specific case/POS/asset; Excel export with record-count warning (longer periods allowed); drawer with asset roles + requested vs actual |
| `/assets` | Default = CoolerCo stock; search = any asset + "Where is it?"; lazy case history + bay scans |
| `/stock` | Asset Stock by warehouse and bay (WH + WS toggle) |
| `/stock/check` | Location Check — flags + list |
| `/scan` | Bay scan: barcode → building/area (★ expected) → bay → type → saves to `coolerco_asset_touch` |
| `/setup` | Admin: buildings/areas/rules · portal catalogue (tick, name, description, photo; all vs available mode) · product families |
| `/picking`, `/routes` | Routing app data (read) |
| `/portal` | POS Lookup (store → cases + assets) |
| `/requests` | CoolerCo cases / portal requests: Waiting for Approval → ✅ Approve / 🚫 Reject (reason); photos, history |
| `/portal-access` | Create a store's portal link, edit contact (logged), Copy / Open / WhatsApp / QR |
| `/p/<token>` | **Public customer portal** (no login, own small bundle): Repair / Collection (store's Magnum assets from COM) or New asset (catalogue families) → details + up to 3 compressed photos → reference number + timeline; "My requests" tab |
| `/newcase` | **Paused** (must not write to COM `cases`) |
| `/wms/*` | Receiving/Transfers/Stocktake/Dispatch → `coolerco_wms_*` tables **not created yet** |

Helpers in `src/lib/helpers.js` (single source: statuses, SLA, case types, `caseAssets()`, conditions, warehouses translator, bays). Case search + Excel export in `src/lib/caseSearch.js`.

---

## 5. Agreed next steps (see `coolerco-delivery-design.md`)

1. ✅ Locations, stray flags, product families
2. **CoolerCo cases** (portal part ✅ built 2026-10-25; still to do: staff Delivery wizard, statuses after Open, SLA rules per area) — `coolerco_cases` (COM column names + originator CoolerCo/Customer/Concessionaire/Magnum + user/time), `coolerco_case_events` (audit), `coolerco_reason_codes`, `coolerco_sla_rules` (per case type + warehouse; Magnum 2 days, 3 for far areas). Delivery wizard: SLA end date auto (overridable), POS confirm + mandatory GPS with search, available models grouped by Product Variant + Condition + Brand Hierarchy (RTW minus reservations; To be Branded not available). Concessionaire/Magnum → Open; Customer → Waiting for Approval (approved by Magnum or concessionaire). Flow: Open → In Progress → ✅ Confirm → In Service → Planned (Routed) → Asset Picked → Loaded → Arrived → Completed → Left POS; not completed → Action Required → Cancelled (reason) or Resolved.
3. **Driver / job card** in the routing app: extra optional columns on `routing_job_cards` (contact no, received-by-other + details, original/delivered asset, swap); 3 photos; reasons Service Denied/Refused Entry, Location not Found, Asset Missing, Incorrect Asset Details; swap only within the **same product family** with warning; complete → asset to POS, out of stock, Assigned/Deployed via `coolerco_asset_movements` (never overwrite `assets_live`); new storage bucket for cases.
4. Mobile-style tripsheet redesign in the routing app.

**Open risk:** `cases` table has RLS disabled (readable with the anon key incl. contact numbers) — plan a fix with the other apps.
