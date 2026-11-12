# CoolerCo-Ops — Project Overview & Hand-over

**Last updated:** 2026-11-12 · **Repo:** https://github.com/WNVissie/CoolerCo-Ops (branch `main`)
**Stack:** React 18 + Vite 5 · React Router v6 · Supabase JS v2 · Netlify · SheetJS (lazy, export only)
**Owner:** Wanda (SMART Project Partners). Explain in plain language, simple modern UI, icons, collapsible sections, small fonts, responsive, parallel + lazy loading, say whether server or browser is better.

Related docs (in the claude.ai project): `coolerco-field-mapping.md`, `coolerco-delivery-design.md`.

---

## 1. Golden rules

- **Two databases (since 2026-11-10):**
  - **TEST = `🟢[TEST] RTMA_Ops` `laljfgwngculogdzmqiu`** (paid project in the PROD organisation; cloned from production with Supabase "Restore to a New Project" on 2026-11-10 — one day behind at that moment; photos/files not copied; month-end billing cron switched **off**). **The UAT Netlify site points here.** All new work is applied and tested here first.
  - **PRODUCTION = RTMA_Ops `abgxjfeofgvimmimxvpa`**, shared with the RTMA dashboard (`rtma-cases-dashboard-netlify` / SMARTDash_RTMA), routing app and SmartSpares. **Scripts 016–019, 021–024 are NOT applied in production yet** (020a/020c = the read-only export for the copy job, applied there). Production only gets a script when Wanda says so, with its rollback.
- **Append/add only** — never alter, rename or drop existing objects of other apps. Show the script and get approval before applying.
- **Applying scripts:** the Supabase connector asks Wanda to confirm DDL and times out after 2 minutes. What works: Claude writes the script → **Wanda runs it in the SQL editor of the TEST project** ("Run and enable RLS", confirm the destructive-operations prompt) → Claude verifies with read-only checks and a `do $$ … raise exception … $$` test block (rolls itself back, leaves no test data).
- **Code workflow:** Claude has push access. Each change goes on a `claude/<topic>` branch; Wanda says **"merge"** → fast-forward to `main` → Netlify deploys. The app must keep working against a database that does not have the newer scripts (it falls back to the older screens) — keep that rule.
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

**Bays** (from COM status): To Audit → 🔴 RED Receiving · Waiting for Action (after a scrap case) → ⚫ SCRAP · To be Repaired / Refurbished / Broken → 🟠 ORANGE Repair · Ready to Work → 🟢 GREEN · To be Branded → 🟡 YELLOW (not available) · In Transit → 🔵 PENDING · To be Scrapped → ⚫ SCRAP · Missing → ⚠️.

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
- **006** portal duplicate check: `coolerco_portal_context` returns `open_cases` (COM + CoolerCo) → portal shows "Already logged: case no." with *That's my problem* / *It's a different problem*
- Public portal may ONLY call `coolerco_portal_context(token)` and `coolerco_portal_submit(token, request)` (security definer); bucket `coolerco-cases` (private): anon upload only to `portal/<valid token>/`, staff full; catalogue photos in `catalogue/`
- **POS key = L-code** (`L18042450`) = `cases.pos_local_code` = `latest_pos_records.pos_id` = `assets_live.assign_account_local_code` (NOT `assets_live.pos_local_code`, which has no L)
- Rule: DROP/REVOKE only ever on new coolerco_ objects; never on existing tables

**004** Waiting for Action → SCRAP bay (follows Scrap an Asset cases) · **005** read-only windows: `coolerco_picking_queue(from, warehouse)` (routing preparation + route + stop) and `coolerco_asset_repairs(asset)` (COM repair lines) — security definer, signed-in only; the routing/repair tables' own permissions are unchanged

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
| `/picking` | 📦 Picking (024): suggest → scan to pick → alarms; read-only where writes are off; old read-only board (`PickingLegacy.jsx`) where 024 is missing |
| `/routes` | Routing app routes (read) |
| `/portal` | POS Lookup (store → cases + assets) |
| `/requests` | CoolerCo cases / portal requests: Waiting for Approval → ✅ Approve / 🚫 Reject (reason); photos, history |
| `/portal-access` | Create a store's portal link, edit contact (logged), Copy / Open / WhatsApp / QR |
| `/p/<token>` | **Public customer portal** (no login, own small bundle): Repair / Collection (store's Magnum assets from COM) or New asset (catalogue families) → details + up to 3 compressed photos → reference number + timeline; "My requests" tab |
| `/newcase` | **Paused** (must not write to COM `cases`) |
| `/wms/*` | Receiving/Transfers/Stocktake/Dispatch = old quantity-form placeholders (tables never created) — being replaced (section 9) · `/wms/labels` = 🏷 Asset labels |
| `/field` | **CoolerCo Field PWA** (installable, offline): Scan · My trip · Cases — see section 6 |
| `/scan/export`, `/scan/stocktake` | COM Touch sync (CSV) · Stock take exceptions |
| `/concessionaires`, `/c/<link>` | Concessionaire users / portal |

Helpers in `src/lib/helpers.js` (single source: statuses, SLA, case types, `caseAssets()`, conditions, warehouses translator, bays). Case search + Excel export in `src/lib/caseSearch.js`.

---

## 5. Agreed next steps (see `coolerco-delivery-design.md`)

1. ✅ Locations, stray flags, product families
2. **CoolerCo cases** (portal part ✅ built 2026-10-25; still to do: staff Delivery wizard, statuses after Open, SLA rules per area) — `coolerco_cases` (COM column names + originator CoolerCo/Customer/Concessionaire/Magnum + user/time), `coolerco_case_events` (audit), `coolerco_reason_codes`, `coolerco_sla_rules` (per case type + warehouse; Magnum 2 days, 3 for far areas). Delivery wizard: SLA end date auto (overridable), POS confirm + mandatory GPS with search, available models grouped by Product Variant + Condition + Brand Hierarchy (RTW minus reservations; To be Branded not available). Concessionaire/Magnum → Open; Customer → Waiting for Approval (approved by Magnum or concessionaire). Flow: Open → In Progress → ✅ Confirm → In Service → Planned (Routed) → Asset Picked → Loaded → Arrived → Completed → Left POS; not completed → Action Required → Cancelled (reason) or Resolved.
3. **Driver / job card** in the routing app: extra optional columns on `routing_job_cards` (contact no, received-by-other + details, original/delivered asset, swap); 3 photos; reasons Service Denied/Refused Entry, Location not Found, Asset Missing, Incorrect Asset Details; swap only within the **same product family** with warning; complete → asset to POS, out of stock, Assigned/Deployed via `coolerco_asset_movements` (never overwrite `assets_live`); new storage bucket for cases.
4. Mobile-style tripsheet redesign in the routing app.

---

## 6. ▶ RESUME HERE — work in progress (2026-10-25 evening)

**Concessionaire portal — BUILT 2026-10-25** (request: "access either via app or on their own link").
- **Script 007 APPLIED:** `supabase/coolerco_007_concessionaire_portal.sql` (24 concessionaires seeded). Tested as anon: own data only, other concessionaires' stores return 0, fake session refused, tables not readable directly.
- **Demo user:** AM UYS MARKETING ENTERPRISES CC (owns the demo store L15060203; 626 stores, 36 open COM cases) → `/c/Ce3EhVjVrFi_9DRUTsq9UWoj`, PIN **1234** (change it in Concessionaires before real use).
- **Screens:** `/c/<link>` (`src/portal/ConcPortal.jsx`, own bundle, styles in `portal.css` `.c-*`): PIN → tabs ✅ To approve (Waiting / Decided; Accept / Reject + reason + comment) · 📝 Log in COM (Copy for COM + type COM case no. → Linked to COM) · 📋 Cases (their COM cases, open / closed 2 months, search case/POS/barcode, comments) · 🏪 Stores. Staff page `/concessionaires` (`src/pages/Concessionaires.jsx`, Customers menu): list, 👁 Open as (→ `/c/view#s=<2-hour staff session>`), users (add, PIN set/reset/random, link copy, WhatsApp, QR, switch off), COM names + merge spellings.
- **008 APPLIED (2026-10-26):** asset base = `assets_live` at POS (`asset_location`='Location') where `responsible_ordering_party` = concessionaire's COM names. View `coolerco_conc_asset_base` (staff; per concessionaire: assets_at_pos, assets_in_workshop, stores_with_assets) + `coolerco_conc_context` returns assets_at_pos / assets_in_workshop. Shown as KPI strip in the portal and per row on the staff page (sorted by asset base). All 20,577 POS assets map to a concessionaire; AM UYS = 712.
- **Links:** customer demo `/p/1WdAoeC9TEdWQBp77FVhHVp9` · concessionaire demo `/c/Ce3EhVjVrFi_9DRUTsq9UWoj` (PIN 1234).
- **2026-10-26 fix:** a Supabase API restart (08:42) gave the customer portal "Failed to fetch" (shows as CORS / 520). Portals now use `src/lib/rpcRetry.js` `rpcRead()` — read calls retry 3× quietly, then a friendly 📶 message + ↻ Try again. Writes (submit, decide, link COM, comment) are never retried (no duplicates).
- **009 APPLIED (2026-10-26):** concessionaire portal shows **only POS-facing cases** — Repair at Shopper POS, Deliver an Asset, Replacement of Asset, Removal of Asset (`coolerco_conc_case_type_ok`); warehouse cases (Repair at Workshop, Decal @WH, Receive, Scrap, Prepare) hidden, incl. comments. Cases tab: Open · ⚠️ Needs action (Action Required, Approval Required, Error, Error External) · Closed (2 months) · All, with clickable status chips + counts (`by_status`, `by_type`); Replacement shows new + removed asset. AM UYS open 36 → 13.
- **Not done yet:** staff Requests page doesn't show comments / COM link yet; request photos not shown to concessionaires (count only).
- **Design:** no Supabase login for concessionaires.
- **New objects (all additive, `coolerco_` only):** `coolerco_concessionaires` + `coolerco_concessionaire_names` (COM `responsible_ordering_party` spellings → one concessionaire, so name variants can be grouped) · `coolerco_concessionaire_users` · `coolerco_conc_sessions` · `coolerco_case_comments` (COM or CoolerCo cases; visibility internal/concessionaire/customer) · new column `coolerco_cases.com_case_number` · status **"Linked to COM"** + reason `LOGGED_IN_COM`.
- **Functions:** `coolerco_conc_link_info`, `coolerco_conc_login(link, pin)`, `coolerco_conc_context`, `coolerco_conc_requests(session, waiting|to_log|done|all)`, `coolerco_conc_decide` (accept → Open / reject → Rejected; **first decision wins**, logged in `coolerco_case_events`), `coolerco_conc_link_com` (type the COM case no. → Linked to COM), `coolerco_conc_cases` (their COM cases, open by default, search case/POS/asset), `coolerco_conc_stores`, `coolerco_conc_comments` / `coolerco_conc_add_comment`. Staff only: `coolerco_conc_staff_session(concessionaire)` ("Open as…"), `coolerco_conc_set_pin(user, pin)`.
- **Possible duplicate names to check:** "CHILLI 4 U" vs "Nelspruit Ola (Chilli 4U)" (merge in Concessionaires → COM names if same).
- **Data notes:** 26 POS have a different concessionaire in the POS file vs cases; a few stray ROP names (SPAR…, DDS…, SE MANGA) — seed skips RTMA/DDS and names with < 15 rows; review in the staff page.

**COM Asset Touch from our bay scans — LIVE (010 applied + merged to main 2026-10-27)** (Wanda: "do ONE upload with two to three assets"; COM import = CSV).
- **Flow (Wanda):** scan on mobile → touch_status **New** → user taps **📤 Submit** → **Submitted** → CSV sync to COM with Status Reason **"Submited"** (COM spelling; kicks off COM's workflow "attach scan to asset") → mark **Synced**. COM then Accepts/Discards (open ticket? data match?) — we read COM's verdict back from its `asset_touch` import (same asset, touched_at ±5 min).
- **CSV = scan fields only** (Touched at, External Status, Serial Number, Barcode, Local Code, External Code, Location, Asset, Brand Hierarchy, Condition, Portal User Created By, Reporter Type, Status Reason, Record Creation Method, Product Base, Product Variant, Short Notes + Latitude/Longitude). The "(Asset) (Asset)" lookups are NOT sent (COM fills them) — they're in our **📊 Reconciliation (Excel)**: scan vs assets_live side by side, per-field mismatch flags (serial, condition, brand, model, location) + overall **⚠ mismatch** + COM result.
- Script `supabase/coolerco_010_com_asset_touch.sql` (APPLIED 2026-10-27; tested with a signed-in token — note SQL tests need `request.jwt.claims` set or assets_live returns nothing): columns on our `coolerco_asset_touch` (touch_status, submitted_at/by, com_location, external_status, condition_found, brand_found, product_base_found, product_variant_found, serial_found, latitude, longitude, photo_paths, expected_bay, bay_ok, expected_location_id, location_ok, com_user, com_exported_at, com_export_batch); `coolerco_warehouse_settings.com_portal_user` (JHB RTMAWH2Gauteng, DBN RTMAWHDBN, CPT RTMACTNWH, BFN RTMAWHBLOEM, EL RTMWHEL, GEO RTMAWHGRG, NEL RTMANELWH, POL RTMAWHPOL, PE PortalPE); views `coolerco_asset_options` (18 brands, 154 models) + `coolerco_com_touch_export` (scan + assets_live + mismatch flags + COM verdict); function `coolerco_stocktake_exceptions(period, warehouse)`; **lock-down** of `coolerco_asset_touch` (was RLS off + anon).
- Edit rules (Wanda): user may change **condition** (COM list), **branding** (all brand hierarchies), **model** (all variants, flagged mismatch), **serial**; NOT barcode / SAP no.; asset status read-only; comments; photos barcode / asset / property plate (+ extras, max 6, bucket `coolerco-cases` `touch/<date>/<id>/`); phone GPS. **Bay + area check = CoolerCo only** (expected bay from COM status; expected area from location rules → "⚠ Wrong bay / wrong area", e.g. To be Branded in Main WH).
- **Stock take exceptions** `/scan/stocktake` (`src/pages/StocktakeExceptions.jsx`): uses **SmartScan's stock take** — `asset_touch_periods` (scope warehouse; opening a period snapshots assets_live into `asset_touch_period_assets`; SmartScan has close + 7-day reconcile) — read only. NOT the inspection views (`snapshot_inspection_status` / `inspections` = SMARTInspect take-on). Categories: In snapshot (still in WH) scanned / ❌ not scanned · 📤 Moved out (in snapshot, no longer in that WH) · 📥 Moved in (in WH now, not in snapshot); each scanned or not (CoolerCo scan or COM touch at RTMA location within dates). Live "October alignment" (1–22 Oct, 8,944) on 27 Oct: 8,781 still in WH (7,165 scanned → 1,616 not) · 163 moved out (113 scanned) · 130 moved in (12 scanned). Excel export.
- Screens: `/scan` (Scan.jsx: WH/WS toggle → COM location, external status auto/override, Submit per row / "Submit n new") · `/scan/export` "COM Touch sync" (New / To sync / Synced / All, mismatches only, ⬇ COM CSV, ✓ Mark as synced, ↩ Back to Submitted, 📊 Reconciliation Excel) · `/scan/stocktake`. Helpers `src/lib/photos.js`.
- SmartScan (COM scan reporting, Wanda's app) https://smartscanmagnum.netlify.app/ — `SMARTSCAN_URL`; linked on Scan, exception page and WMS menu.
- Open: date format accepted by COM import? SMARTDash_RTMA `asset-touch` branch (rules) not readable yet — Wanda to give the Claude GitHub app access.

**Scan report — LIVE (012 applied + merged 2026-10-27)** (Wanda: "a scan report by WH on the CoolerCo app"; SmartScan only reports COM scans).
- `/scan/report` (`src/pages/ScanReport.jsx`, WMS menu "📊 Scan report"; Scan header links to it; SmartScan kept as "SmartScan (COM)").
- `coolerco_scan_report(from, to, warehouse, source all|com|coolerco, result all|accepted|discarded|pending|mismatch, search, limit, offset)` — security invoker, signed-in only; one call returns total + per-warehouse summary + by day + by user + one page of rows. Sources: 🟦 `asset_touch` at "RTMA <wh> WH/WS" + 🟩 `coolerco_com_touch_export`. SA days. ≈0.5 s for a month (10,911 scans Oct). Rollback: drop the function.
- Page shows "COM data up to <last touched_at>" (COM import lags). 27 Oct: `coolerco_asset_touch` had **0 rows** — no CoolerCo scans saved yet.
- **013 APPLIED (2026-10-27):** report rows carry scanned_area, belongs_area, area_ok, touch_id, is_latest; result filter `wrong_area` (latest CoolerCo scan in the wrong area) + summary wrong_area. Rollback: re-run 012. Report "📍 Wrong area" tab: tick → **✅ Moved to correct area** inserts a new scan at the expected area, scan_type daily, touch_status **Internal** (never sent to COM; COM sync skips it) → latest scan wins, exception clears.
- **⚡ Quick scan — LIVE (merged 2026-10-27)** in `Scan.jsx` (default mode, remembered per device; 📋 Full scan = old form). Wanda's rules: choose **📍 Scanning in** first (warehouse → WH/WS → area; remembered) · scan → card (`QuickCard`) with `PlaceBadge` (square = area the asset IS in now = where scanned; circle = bay from COM status) + barcode, SAP no., COM location, condition, branding → **auto-saved** with COM's values (bay_ok not checked) · ⛔ wrong warehouse (COM assign_account ≠ chosen WH, e.g. Nelspruit asset in Gauteng) or ⚠ wrong area (location rules) → strong buzz, red card, camera paused → ✓ Accept here (saved, location_ok=false → exception report) / Skip / ✏️ Change · ✏️ Change opens the full scan prefilled; saving adds a newer scan (latest counts) · Submit unchanged (📤 → Submitted → CSV for COM). Camera: `CameraScan` `continuous` + `paused` + children (card over the camera; same code ignored 4 s).
- **🐞 Fixed 2026-10-27 (hotfix on main):** `coolerco_asset_touch.scan_type` check only allows daily/monthly/receiving/dispatch/stocktake — the app sent count/receive/move, so **no scan was ever saved**. App now sends stocktake/receiving/daily/dispatch; `dbScanType()` in `offline.js` translates queued old ones.

**Open case · asset at POS — LIVE (014 applied + merged 2026-10-27)** (Wanda: deliver, replace and removal; same product family; open cases since 1 July 2026).
- `/cases/asset-at-pos` (`src/pages/CaseAssetExceptions.jsx`, Field Ops menu) + Dashboard tile. `coolerco_open_case_asset_exceptions(since, warehouse)` — security definer (reads routing_warehouse_preparation), signed-in only. Kinds: delivered_open (picked/prepared asset already at this POS), other_pos (at another POS), collected_open (removed asset back in RTMA WH/WS), possible (nothing picked; same-family asset at this POS, replacement's old asset excluded; candidates with same_model / same_condition). "Picked/prepared" = routing prep selected asset, else COM asset_delivered. Live 27 Oct: 1 / 1 / 2 / 41.
- Refresh: every 5 min while visible + on return to tab + ↻; shows COM upload time (assets_live.last_synced_at); 🆕 new since last look (localStorage `cc_case_asset_seen`). Cases page accepts `?case=`. Rollback: drop the function + revert.

- **2026-10-27 evening (Wanda): show ONLY delivered_open + other_pos** (picked/prepared asset already at a POS); collected/possible filtered out in the page + dashboard tile (function unchanged).

**Closure discrepancies — LIVE (015 applied + merged 2026-10-27)** (Wanda: Asset Delivered vs the same asset at POS, last 3 months).
- `/cases/closure-discrepancies` (`src/pages/ClosureDiscrepancies.jsx`, Field Ops menu "🔀 Closure discrepancies"). `coolerco_closure_discrepancies(since default 3 months, warehouse)` — security invoker, signed-in only. Deliver/Replacement closed (Solved/Canceled) by service_closure_date with asset_delivered: solved_other_pos (asset at another POS), solved_in_wh (asset not at a POS), cancelled_at_pos (cancelled but asset at this POS). `explained` = a later case (created after closure) has the same asset delivered/removed/repaired → hidden by default. Live 27 Oct: 87 / 81 / 15 unexplained (+255 explained). Rollback: drop the function + revert.

**Product families regrouped (Wanda 2026-10-26, applied — data only):** VISIMAX (Visimax, II, III, III 3D, IV, Top Shelf) · SLIM VISIMAX (Slim II, II-3DEf, III, III 3D, IV, + "VISIMAX SLIM NEW GEN (7)") · RODI (33 + 35.3) · UDD 200 · UDD 300 (SC eutectic, SCB, SCEB ×2, SCEBN) · UDD 400 (SCB, SCEBN) · MINUS FORTY (MC460 + VC460); BICYCLE, PUSH CART, SMART N already one each. Merged-away families set inactive + hidden (not deleted; notes "Merged into …"). UDD 100, UDD160, UDD 500 left as they were.

**Scanning on phones + whole app mobile (2026-10-27):** `/scan` has a big **📷 Scan** button → `src/components/CameraScan.jsx` (QR + Code128/39/93, EAN, UPC, ITF, Codabar, DataMatrix; phone's BarcodeDetector, else lazy `@zxing/browser` for iPhone; torch toggle; vibrate on read) + type / hand-scanner box. `codeCandidates()` pulls keys out of QR text/URLs (AST-…, path parts, query values, long codes) → lookup on assets_live name, bar_code, local_code, serial_number, external_code, sap_number (best match first); not found shows the code read. **Teams at different warehouses at the same time:** warehouse remembered per device; Recent = 👤 Mine (default) or 🏢 this warehouse; Submit only your own New scans; header shows "you n today · all teams n". Phone CSS: inputs 16px (no iPhone zoom), header buttons wrap under title, tap targets ≥32–48px, 2-column bay tiles, safe-area padding. Checked all 21 staff pages at 390px with Playwright + mocked Supabase (`scratchpad/mobile-check.js`): no sideways scroll, no errors.

**CoolerCo Field — installable PWA (2026-10-27)** at **/field** (Wanda's choices: one field app in CoolerCo-Ops; same SmartHub login for drivers; "close" = record outcome, COM closes; offline queue).
- Files: `src/field/FieldApp.jsx` (own bundle via `main.jsx`; login; header with 📶/📵 + ⏳ waiting count + 📲 Install (Android prompt) / iPhone "Share → Add to Home Screen" hint; bottom tabs) · `FieldTrip.jsx` · `FieldCases.jsx` · `field.css` · `public/manifest.webmanifest` (name "CoolerCo Field", start_url /field, standalone, icons in `public/icons/`, shortcuts Scan / My trip) · `public/sw.js` (service worker: pages network-first 4 s → saved copy; `/static/*` cache-forever; icons stale-while-revalidate; Supabase never cached) registered in `main.jsx` (prod only); `netlify.toml` no-cache for sw.js + manifest. Staff menu: Field Ops → "📲 Field app (install)".
- **📷 Scan** = `pages/Scan.jsx` with `field` prop + offline (`src/lib/offline.js`, IndexedDB `coolerco-field`): queue for scans (+ photo blobs) and Submits, sent in order on `online` / every 30 s / start; scan ids made on the phone + insert treats duplicate key as done → never duplicates; scan time kept (`created_at` set on the phone). "💾 Save <warehouse> list for offline" stores that warehouse's assets_live rows (WH+WS) for offline lookups; dropdowns/areas cached (`cachedQuery`). Session via getSession (works offline).
- **🚚 My trip** (read-only from the routing app's tables — routing tables are SELECT-only for users; routing app writes outcomes via its own server code): driver picks their routing name once (`routing_portal_users` driver/technician; saved on the phone — SmartHub accounts have no portal username); routes for date (‹ › today) → current version stops in order: routing outcome (planned/solved/carried over/cancelled…), **live COM status** + SLA (`cases`), prep Picked/RTW/Packed + picked barcode (`coolerco_picking_queue`), assets, address, contact (`routing_pos_contacts`); 🧭 Navigate (Google Maps, alternative address if set), 📞 Call, 💬 WhatsApp, 📝 Record outcome ↗ (opens routing trip sheet). Trip saved on the phone for offline viewing.
- **📋 Cases**: lookup by CAS-…, L-code, store name or scanned asset → `coolerco_case_search` (all statuses), status/SLA/due/assets.
- Tested with Playwright + mocked Supabase at 390 px (`scratchpad/field-check.js`): picker → trip → stop, cases, offline scan queued then sent on reconnect, SW active, manifest OK.
- **Sizes / storage (measured 2026-10-27):** first download ≈ 115 KB compressed (Android) / ≈ 225 KB (iPhone, + ZXing camera reader, only fetched where the phone has no BarcodeDetector); then cached by the service worker. Offline asset list: Gauteng 5,011 assets ≈ 2.2 MB on the phone (other warehouses ≤ 1.7 MB together); replaced on refresh, never grows. Photos compressed at capture to 1024 px / JPEG 70% (≈ 100–200 KB, from 3–6 MB) — before storing or sending. Online: uploaded straight away, nothing kept. Offline: kept in the queue and **deleted from the phone as soon as the scan is sent**. Trip copies > 7 days purged; `navigator.storage.persist()` requested so waiting scans aren't cleared; "💾 n MB on phone" shown on the Field scan bar.
- **Next for outcomes in the Field app:** needs the routing app's repository (smartroutertma) to reuse its own outcome/arrived/left/job-card server endpoints — not built yet. Drivers record outcomes in the routing trip sheet meanwhile (704+ stops already done that way).

**Field app navigation + report source filter (2026-10-27 afternoon, live on main):**
- Field app: **🏠 Home** screen (tiles My trip / Scan assets / Case status + Full CoolerCo-Ops + Sign out); header shows **‹ Back** + page title on every screen; each screen is a step in the phone history (Android back / iPhone swipe work); bottom tabs Home · My trip · Scan · Cases; trip has **⏎ Back to today** when another day is shown; trip dates use the phone's local date (was UTC — midnight–2 am showed yesterday). Staff pages: **‹ Back** on phones (React Router history idx, else Dashboard) — `Topbar.jsx`.
- Scan report: **"Scanned by"** chips above the list (All · COM scanned · CoolerCo scanned, with counts); sources defined once in `SOURCE_LIST` (ScanReport.jsx) — a future client = one more entry + its branch in `coolerco_scan_report` (p_source).
- **iPhone barcode fix (2026-10-27 15:4x):** iPhones have no built-in barcode reader; the old JavaScript ZXing (low-res frame) could not read 1D plates. Now `src/lib/zxingReader.js` = **zxing-wasm** (zxing-cpp WebAssembly, ~0.9 MB .wasm served from our site, cached by the service worker; tryHarder + tryRotate) on a 1920 px camera, reading only the white-frame area (`CameraScan.jsx`), continuous focus; Field app pre-loads it on phones without BarcodeDetector. Verified on Wanda's screenshot of plate 6068203 → Code128 "6068203". Android still uses the phone's built-in reader.
- **First COM upload test (2026-10-27):** 4 Gauteng scans (1113543, 1122359, 1123092, 1100149), all Submitted, no mismatches → CSV sent to Wanda (`CoolerCo_Asset_Touch_JHB_test_2026-10-27.csv`, 19 COM column names, Submited, lat/long). After COM accepts the import: mark them ✓ Synced in COM Touch sync.
- Rollback (Wanda wants one for every change): `git revert <commit>` on main → Netlify redeploys the previous version; no database changes in these.

**Then (agreed order):** COM matching after upload (same store + asset/family + compatible type, ~14 days) · combined COM + CoolerCo cases view · **conversion stats** (portal requests → COM cases) · WhatsApp via Meta Cloud API (after Wanda's Meta setup) · tenant/client structure (Magnum, Tiger Brands) · route QR sheet + bulk send queue · staff Delivery wizard · routing app job card / tripsheet · WMS tables.

**Open questions — ANSWERED by Wanda 2026-11-10 (see section 7):** approvals, comments visibility, several users per concessionaire, replacement on the portal, duplicates (block per asset), condition/branding. Still open: auto-link exact COM matches (rule explained, not yet confirmed) and the 14-day match window.

**Open risk:** `cases` table has RLS disabled (readable with the anon key incl. contact numbers) — plan a fix with the other apps.

---

## 7. ▶ RESUME HERE — 2026-11-10 / 11 (review, test database, roles foundation, portal rules, inbox)

**Direction (Wanda):** CoolerCo-Ops becomes the one app for end-to-end asset management — client portal, customer link, technician/driver mobile app, warehouse picking from routing; later Spares, dashboard, POS mapping, Inspection (+ admin) folded in so it feels like one app. Fleet: 3 trucks + bakkie in Gauteng and Durban, 1 truck + bakkie in the other warehouses; 4 technicians in the larger warehouses, 1 elsewhere; technicians repair at stores, one is usually warehouse-based.

**Clients** (`coolerco_clients`, called "client" because `tenant_id` already means something else):
- **MAGNUM** — COM (Dynamics 365 by Noesis, on Unilever's `unilevercrm` environment) is the master; cases are closed in COM; CoolerCo never writes to it. Magnum is moving COM to Salesforce (so `external_system` is a setting).
- **TIGER** (Tiger Brands, second client) — no system of their own: **CoolerCo is the master**, cases are closed here; integration to their sales/customers later.

**Roles** (`coolerco_roles` + `coolerco_user_access` = role + scope client / warehouse / contractor; helper `coolerco_has_role`, `coolerco_my_access`):
system_admin (Wanda only) · administrator (uploads, edit records) · manager (supplier + approvals) · supplier (RTMA/CoolerCo: sees all, updates, audited, no delete) · client (Magnum / Tiger users: log, view, reports, approve delivery/removal/replacement) · viewer (executives) · contractor_admin (own company's cases, own technicians, tripsheets) · technician / driver (own cases only, job card, own stats). Customers and concessionaires / representatives keep their personal links (no login). **Role checks are NOT enforced on the existing pages yet** (any signed-in user still sees everything) — needs users to be given roles first, and a screen to do that. Only the new tables (alerts, feedback, contact updates) are role-protected. Wanda = system_admin on TEST.

**Rules decided by Wanda (2026-11-10):**
- **One open case per ASSET**, whatever the request type (COM or CoolerCo). A store can have several cases for different assets. A new-asset request has no asset yet → never blocked (portal only reminds).
- While a case is open the customer **asks about it** (query = comment on the case, no new case). Once closed, a new request is allowed; a repair within **30 days** of the last repair = **repeat repair** (linked to the earlier case, works across COM).
- **Repairs need no approval** (option per client: `repair_needs_approval`). Priority comes from **symptom + product impact** (customer never picks High/Medium/Low); "My product is now spoiling" raises to High and alerts the supervisor; client/supplier may override (audited).
- **Approvals:** concessionaire / representative approves only their own customers' requests; Magnum / Tiger (client) can approve delivery, removal, replacement; approver may edit the replacement asset, condition and branding from available stock at the chosen warehouse. Replacement allowed on the customer portal.
- **Comments:** concessionaire comments hidden from customers; supplier and client see them. Several users per concessionaire.
- **Customer history:** a customer sees only their own store; asset history only for the time the asset stood in their store (needs placement periods — not built).
- **Notifications:** new request → concessionaire + supervisor alarm; customer on approval and on closure (email if registered and opted in, WhatsApp later); closure message carries a **feedback survey** (1–5 stars, working now? on time/professional? comment) — scores for the supplier only unless shared per client (`coolerco_clients.share_feedback`).
- **Contact details:** customer confirms at a glance when logging; changes go to a supervisor to approve; for Magnum stores approved changes land on a "to capture in COM" list.
- **Contractors:** managed even if they do not use the app — contractor admin picks own technicians, builds the tripsheet, RTMA monitors (tables exist; screens not built). Job card + outcomes belong in the mobile app; the routing app keeps the tripsheet.

**Scripts (all in `supabase/`, each with a rollback; applied on TEST only):**
- **016** `coolerco_016_roles_priority_notifications_feedback.sql` — clients, roles, user access, contractors (+ technicians), symptoms, product impacts, `coolerco_priority_for`, notification rules + queue (`coolerco_notifications`, `coolerco_notify`, trigger `coolerco_cases_notify` on `coolerco_cases` — can never block a save), contact update requests (`coolerco_portal_propose_contact`, `coolerco_contact_update_decide`), feedback (`coolerco_case_feedback`, `coolerco_feedback_context` / `_submit`), new columns on `coolerco_cases` (client_code, symptom_code, product_impact, priority_source/set_by/set_at), `coolerco_portal_links` (client_code, email, notify_email, notify_whatsapp, trading_hours, delivery_notes), `coolerco_concessionaires` (client_code, kind). Existing rows tagged MAGNUM.
- **017** `coolerco_017_portal_symptoms_priority.sql` — `coolerco_portal_options(token)`, `coolerco_portal_submit_v2(token, request)` (wraps the unchanged `coolerco_portal_submit`).
- **018** `coolerco_018_one_case_per_asset_queries.sql` — `coolerco_case_is_closed`, `coolerco_asset_open_case` (COM + CoolerCo), block in submit_v2 (advisory lock per asset), repeat flag (`repeat_of_case`, `repeat_days`; setting `repeat_repair_days` 30), `coolerco_query_reasons`, `coolerco_portal_case(token, case)`, `coolerco_portal_case_query(token, case, reason, note)` (limit `portal_daily_query_limit` 3 per case per day), options now return saved contact + query reasons.
- **019** `coolerco_019_inbox.sql` — `coolerco_query_inbox`, `coolerco_inbox_counts`, `coolerco_contact_update_captured`. (An earlier draft blocked a second new-asset request per catalogue item — removed; the script drops that function.)
- Test pattern used for each: a `do $$` block that exercises the functions and ends with `raise exception` carrying the results → everything rolls back.

**App changes (live on `main`, UAT):**
- **Customer portal** (`src/portal/PortalApp.jsx`): Repair asks *What is wrong?* (symptom buttons) + *What is happening to your product?*; description optional; repair shows Received → Accepted, "⚡ Marked urgent". Asset with an open case → the case + **💬 Ask about this case** (no second case). *My requests* rows open the case (`CaseView`): details, messages the customer may see, query form. Contact details shown as one line with ✏️ Change; changed details used on the request and proposed for approval. Falls back to the old screens where 017 / 018 are not installed (`opts`, `canQuery`).
- **Requests** (`src/pages/Requests.jsx`): Priority + 🔁 Repeat badges; problem / product impact / who set the priority; 💬 Messages with reply (customer can see / internal only).
- **📥 Inbox** (`src/pages/Inbox.jsx`, `/inbox`, first menu group): 🔔 Alerts (mark read) · 💬 Customer queries on CoolerCo **and COM** cases with reply (COM is never changed) · 👤 Contact updates (approve / reject, "To capture in COM").
- **Supervisor alarm** (`src/components/InboxAlarm.jsx`, mounted in `App.jsx`): asks `coolerco_inbox_counts` every 30 s while the app is open; new alert → sound + buzz + banner (urgent = red), count badge on the Inbox menu item, the ☰ button and the tab title; 🔔/🔕 mute per device; goes silent where 019 is not installed.

**Not built yet / known limits:** role checks on existing pages + a screen to give users roles · warehouse filter on alerts · push to a closed phone · **sending** email/WhatsApp (queued only) · feedback survey page + closure message · contractor screens · customer history by placement period · SLA rules per priority · pick/load scanning + `coolerco_asset_movements` · job card/outcomes in the Field app · staff Delivery wizard · Tiger case lifecycle (closing in the app). None of the 2026-11-10/11 screens were visually checked by Claude — Wanda tests on UAT.

**Resend (email):** connected; domain `smartpartners.co.za` (Wanda's, registered at domains.co.za) — **verification failed** because the DNS records were added at domains.co.za while the domain's nameservers are `dns1–4.p04.nsone.net` (= Netlify DNS), so only records added in **Netlify DNS** count. Next: add the 3 sending records there (TXT `resend._domainkey`, MX `send` → `feedback-smtp.eu-west-1.amazonses.com` priority 10, TXT `send` → `v=spf1 include:amazonses.com ~all`); **never** the root "receiving" MX (it would divert her normal email); re-verify in Resend; then build the sender (Edge Function reading `coolerco_notifications` where channel = email, API key as a Supabase secret).

**Magnum COM exports (parked, files with Wanda):** exports fail on bulk days (2-minute export limit); asset touch is the biggest. `WhoAmI` works for Wanda's user on the Web API. `com_pull_v2.js` = console snippet run on a signed-in Dynamics page: reads her saved personal views (cases `ca772141-a774-f111-ab0e-0022489b662f` on `incident`, assets `517261e4-a374-f111-ab0e-0022489b662f` on `noesis_asset`, asset touch `39d50f10-d4cd-f111-a05c-70a8a5304fbd` on `noesis_assettouch`) page by page and saves an `.xlsx` like the normal export (labels, SA-time date cells, numbers). v1 (CSV) pulled assets successfully; v2 not yet run by Wanda. Still needed: cases + asset touch Excel headings, repairs view saved as a personal view, the dashboard repo to check how its upload reads dates, a cell-by-cell comparison before any upload. Wanted: pulls at 07:00, 12:00, 15:00, 19:00 feeding the dashboard and UAT — fully hands-off needs an app registration from Magnum/Noesis (ask them); do not automate her personal sign-in.

**Open risks:** `cases` has RLS disabled (see above) · the 48 old `st_*` tables (earlier AssetFlow start, not used by CoolerCo) have RLS off incl. `st_users` with password hashes — Wanda to decide: switch RLS on for all of them (separate small script) · TEST holds real customer data (contact numbers).

**Suggested next (not yet agreed):** Resend sender → feedback survey → roles screen + enforcing roles → pick/load scanning with the movement ledger → job card in the Field app.

---

## 8. ▶ RESUME HERE — 2026-11-11 evening (batch 2, merged to main)

**TEST follows production (020):**
- Production: `020a_PRODUCTION_read_only_export.sql` adds login role `coolerco_test_reader` (read-only) and schema `coolerco_export` with 20 `select *` views of the COM/dashboard tables. `020c_PRODUCTION_cleanup.sql` removed 020b objects that were run on prod by mistake (the job never ran there).
- TEST: `020b_TEST_sync_from_production.sql` sets up postgres_fdw server `coolerco_prod` (pooler, user `coolerco_test_reader.abgxjfeofgvimmimxvpa`), tables `coolerco_sync_tables` (since / all / newer_id / periods) and `coolerco_sync_runs`, and function `coolerco_sync_from_prod(p_full)`. The function refuses to run where `coolerco_export` exists (= production). It switches dashboard triggers off per table (`session_replication_role` is not allowed on Supabase), upserts, then refreshes `mv_supplier_view_cases`.
- pg_cron (UTC): `coolerco_sync_from_prod` at `30 6,17 * * *` = **08:30 and 19:30 SA**; `coolerco_sync_from_prod_full` Sunday 01:00 SA. Manual run: `select public.coolerco_sync_from_prod();` Counts matched production on 11 Nov.
- Rollbacks: `020_rollback_TEST.sql`, `020_rollback_PRODUCTION.sql`.

**Dashboard / Cases:**
- 📂 Cases quick link first. Latest open cases → `/cases?case=` (drawer opens). Recent routes → `/routes?route=` (route opens).
- Cases page: open-cases-per-warehouse cards (click = filter); filters apply as you pick, dates apply on blur.

**🚩 Case flags (021)** `/cases/flags` (`CaseFlags.jsx`, Field Ops menu, Excel):
- `coolerco_repeat_workshop_repairs(since, warehouse)`: a Repair at Workshop that follows a **Solved** Repair at Workshop on the same asset, with no other COM/CoolerCo case in between; follow-on created in the last 3 months by default. TEST 11 Nov: 337.
- `coolerco_duplicate_open_cases(warehouse)`: assets with 2+ open cases (COM + CoolerCo). TEST 11 Nov: 15, all COM.

**Case actions (022)** `coolerco_022_case_actions.sql` (rollback `022_rollback`), applied on TEST and tested with the roll-back block:
- `coolerco_case_actions(case)` → source COM/CoolerCo, open?, `com_url`, `can_cancel`. `com_url` = setting `com_case_url` + `cases.raw_case->>'(Do Not Modify) Case'` (Dynamics GUID; change the setting when Magnum moves to Salesforce).
- `coolerco_case_cancel(case, reason, note)`: CoolerCo cases only, roles system_admin / administrator / manager / supplier, reasons `CAN_*` (status Cancelled; CAN_OTHER needs a note). Sets status Cancelled, motive, service_closure_date; logged in `coolerco_case_events`. COM cases are refused: cancel them in COM.
- UI: `src/components/CaseActions.jsx` (🟦 COM / 🟩 CoolerCo tag, 📋 Copy no., **Open in COM ↗**, 🚫 Cancel case with reason). Shown in the Cases drawer and in a pop-out when a case number is clicked on Case flags (+ 📂 Open full case). Without 022 the block is simply hidden.

---

## 9. ▶ RESUME HERE — 2026-11-12 WMS start: asset labels (branch `claude/wms-labels`, NOT merged)

**WMS direction (agreed in principle):** the system predicts each movement from cases and routes; the user confirms with one scan. Typing stays as a fallback. Alarms only for exceptions; pop-up tasks; escalation timers; daily digest. Ledger `coolerco_asset_movements` still to build. The old `/wms/receiving|transfers|stocktake|dispatch` screens are quantity-form placeholders over tables that don't exist; replace them. Wanda's answers on people/devices/arrivals/audit/loading are still open.


### WMS design (Wanda 2026-11-12 — "users record as little as possible, automate, pop-ups/alarms, accurate data")

**Principle:** cases and routes say what *should* happen ("expected movements", like receiving against an advance shipping notice). A person confirms with **one scan**. Typing is the fallback, recorded as typed. Only a mismatch raises a pop-up or alarm. Every confirmed scan = one line in an append-only ledger, `coolerco_asset_movements`, which is CoolerCo's own "where is it" record and never overwrites COM.

**Workflows (planned):**
| Step | System does | User does |
|---|---|---|
| Receiving | "expected in" list from completed collections, Receive cases, inbound transfers | scan off the truck → 🔴 Receiving; unexpected = alarm; expected-not-arrived = supervisor alert |
| Audit | task per cooler in Receiving, oldest first | scan + tap RTW / Repair / Brand / Scrap → bay + "to update in COM" list |
| Workshop | COM repair case solved → pop-up "move to 🟢" | scan at green bay |
| Picking | pick list from routing prep; suggest which cooler (same family/model/condition/brand, RTW, not reserved, oldest, nearest) | scan; wrong = alarm + stop |
| Loading | knows the route's stops (vehicle codes are empty on routes → per route) | scan each cooler; missing/extra → no "loaded" without a supervisor override + reason |
| Delivery | Field app outcome closes the loop (later) | — |
| Transfers | dispatch with a destination warehouse, in transit | receiving side scans in |
| Stock take | daily cycle count per area (not seen in 30 days, wrong-area, high value) | scan 20–40 a day |
- Alarms: sound + buzz only when someone must act now; pop-up tasks; escalation timers; one daily digest; push to a closed phone needs web push (iPhone: only an installed app).
- Accuracy: scan, don't type; bay/area/route QR labels; photos only on exceptions; daily three-way check (ledger vs COM vs last scan); "last confirmed" date per cooler; reservations.
- Order: ① ledger + picking/loading checks → ② receiving + audit → ③ workshop pop-ups → ④ cycle counting → ⑤ transfers → ⑥ spares.

**Facts found (TEST, 12 Nov):** last 30 days 199 routes, 5 warehouses use routing, `vehicle_code` empty on all; 1,162 deliver/replacement stops, 894 collect stops; routing prep 502 rows (439 with a selected cooler, 416 picked, 28 packed, 0 returned): packed/returned are hardly used. Last 60 days: 780 solved deliveries with a selected cooler, **56 (7%) delivered a different cooler** than selected → reason for a pick check.

**Picking today (routing prep, last 60 days, 1,397 delivery/replacement stops on finalised routes) — measured 12 Nov:**
- **35% no cooler selected** (491): Gauteng 355/1,228 (29%); outside Gauteng it is barely used (PE 52/67, BFN 38/52, CPT 20/24, EL 24/24). 418 of those were solved with no trace of which cooler was meant.
- 108 selected but never marked picked; picked before route day 605 / on the day 245 / after 12.
- Condition differs from the request on 266: mostly **C - Used requested → A - New given (195)**, B → A 24, D → A 12 (new stock spent where used was asked); downgrades are rare (A → C 6).
- Family differs from request: 8. Solved with a different cooler than selected: 62. Same cooler selected on two different cases: 39 (some are re-planned cases).
- Routing prep is written only by the routing app (smartroutertma, server code). CoolerCo reads it (`coolerco_picking_queue`).
- **Question to Wanda:** may CoolerCo write the selection / picked flag into `routing_warehouse_preparation` (same database, her own routing app), or must it stay read-only with CoolerCo keeping its own pick records?

**Picking — BUILT 2026-11-12 (Wanda: option A on UAT only; "don't change anything on the routing app"; she'll make a UAT copy of the routing app on Netlify pointing at TEST):**
- Routing tables are **not** in the TEST copy job, so TEST routes stopped on 10 Nov. New routes on TEST will come from the UAT routing app copy. `routing_warehouse_preparation`: PK (route_id, case_number), no triggers, RLS on, no policies, grants only to service_role, so the routing app writes it with its server key.
- **024** `coolerco_024_picking.sql` (rollback `024_rollback`), applied on TEST and tested with roll-back blocks:
  - setting `pick_writes_routing` (true only where `sync_role` = TEST, so production stays read-only even if 024 is applied there) + `pick_new_needs_reason` (true).
  - `coolerco_asset_movements` = **append-only ledger** (reserve, unreserve, pick, unpick, load, unload, receive, putaway, transfer_out/in, deliver, collect, audit, scrap, adjust; how camera/scanner/typed/system/screen; expected; exception; override_reason; `client_id` unique so a phone resend never doubles). Signed-in users read; writes only via functions.
  - `coolerco_pick_lines` (internal): delivery/replacement stops of current route versions + request (COM, else CoolerCo case) + prep + selected cooler + flags: no_selection, not_rtw, at_pos, other_wh, family, upgrade_new (A - New for a used request), condition, brand, double_booked (selected on another open case within 14 days), not_picked.
  - `coolerco_pick_board(from, to, warehouse_group)` → {writes, lines}. ≈0.02 s per day.
  - `coolerco_pick_candidates(route, case, limit)`: free RTW coolers in `<warehouse> WH` of the requested family (or base). Not reserved, not on an open case. Score: condition 40 (A-New upgrade −30), brand 20, base 10, scanned area 3. ≈0.03 s.
  - `coolerco_pick_select(route, case, asset, reason)`: hard = at_pos / other_wh (refused). Soft = not_rtw / family / upgrade_new / condition / brand / reserved_elsewhere (need a reason). Writes prep + ledger. Advisory lock per asset.
  - `coolerco_pick_autofill(date, warehouse)`: fills stops without a cooler with the best exact-condition, non-upgrade match only.
  - `coolerco_pick_scan(code, date, warehouse, route?, case?, how, reason?, client_id)`: without a stop it finds the stop where the cooler is selected, else returns `choose_stop` (open stops of that family, exact matches first). Results: picked / choose_stop / wrong_cooler / needs_reason / blocked / no_stop / not_found. Scanning the already-selected cooler picks it (its reason was given at selection). A swap with a reason is logged as `swapped`.
  - `coolerco_pick_undo(route, case, pick|select, reason)`.
- **App** `src/pages/Picking.jsx` (menu "📦 Picking"): warehouse (remembered) + Today/Tomorrow/‹ ›/date; cards ❗ No cooler · ✅ Picked · ⚠ Problems · 🆕 New for used (click = filter); ✨ Fill suggestions; per route: Asked for vs Cooler + flag chips, ✨ Choose/Change (drawer with candidates, "Best match", reason buttons), ↩ undo with reason; 📷 Scan to pick panel (camera continuous or hand scanner/typed; green/orange/red result card + buzz + beep; choose-stop buttons; "Pick anyway" with reason; typed pick → 🏷 label prompt). Old board kept as `PickingLegacy.jsx`.

**To do next (Wanda 12 Nov):** customer portal: let the customer **update their contact details at any time** (not only when logging a call).

**Still to answer (Wanda):** people per warehouse (receiving clerk, picker, technician, supervisor) · devices (phones or rugged scanners, wifi in yard) · bay/area labels · how coolers arrive (own trucks only, or Magnum/supplier stock with a delivery list) · who audits and who updates COM status · who does routing prep and when; should CoolerCo suggest the cooler · loading check today · transfers between warehouses · cycle counting vs monthly SmartScan · Tiger coolers in the same warehouses · KPIs · who may override an alarm.

**Assumptions used until answered:** phones (Android + iPhone) with hand scanners where present, same SmartHub login · on UAT CoolerCo selects and picks in routing prep (option A; production read-only) · loading checked per route · any signed-in user may override with a reason (logged; roles later).

**Labels (Wanda):** many coolers have no physical label, or lost it (metal plates fall off). COM data is clean: all RTMA stock has a barcode. **Real labels start with "11"**; other barcodes were never physically labelled (492 in stock on 12 Nov). Plan: re-print the **existing COM barcode** as **QR + number in text** (+ local code / model / warehouse small) on a **Brother P-touch, 24 mm TZe** (extra-strength tape suggested). Printers in 3 warehouses, more coming. RTMA may print Magnum barcodes. Wanda fixes wrong links in COM herself.

**023** `coolerco_023_asset_labels.sql` (rollback `023_rollback`), applied on TEST and tested:
- `coolerco_asset_labels` (one row per asset: reason never_labelled/lost/damaged/wrong_label; status needed → printed → confirmed; print_count, who/when).
- `coolerco_label_corrections` (code on cooler, asset COM links it to, real asset; open/fixed).
- `coolerco_label_mark(assets[], action, reason)`, `coolerco_label_todo(warehouse)` (walking order: warehouse, WH/WS, last scanned area, bay; ≈0.1 s), `coolerco_label_summary()`. Security invoker, signed-in only.

**App:**
- `src/lib/labels.js`: label PNG drawn in the browser (360 dpi, 18 × 58 mm print area). **🖨 Print to printer** = `printDirect()`: hidden iframe, `@page 64mm × 24mm`, one page per label, browser print window → choose the P-touch. PC needs the Brother driver; Android needs Brother's *Print Service Plugin*; iPhone has no direct option (P-touch isn't AirPrint), so the 📲 Brother app button is the main one there. Batch: 🖨 Print n on the labels page. **📲 Brother app** = Share on phones, download on PC; P-touch Editor CSV (Barcode, LocalCode, Model, Warehouse, Bay, Area); `entryTimer()` (hand scanner = whole code in < 400 ms); `labelNeed()`.
- `src/components/LabelPrompt.jsx`: 🏷 prompt on Quick + Full scan (also in the Field app) when the label didn't scan, i.e. a typed code or a match on local code / serial / SAP no. Buttons: Print / Later / Wrong cooler. `labelAfterScan()`: a real label scan confirms a printed label, and a scanned "not 11" barcode is marked as labelled.
- `/wms/labels` (`src/pages/wms/Labels.jsx`, WMS menu "🏷 Asset labels"): To label (per-warehouse cards, filter, 🖨 one label, ⬇ P-touch file + mark printed), ✅ Confirm by scan box (camera or scanner), 🔁 Label corrections (report: code on cooler + real cooler by local code / serial / SAP → save + flag wrong_label → print; list To fix in COM / Fixed; Excel).

