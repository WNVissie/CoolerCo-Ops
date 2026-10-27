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
| `/picking` | Warehouse Preparation board (read-only, `coolerco_picking_queue`): per date → route, Picked → RTW → Packed, asset + bay |
| `/routes` | Routing app routes (read) |
| `/portal` | POS Lookup (store → cases + assets) |
| `/requests` | CoolerCo cases / portal requests: Waiting for Approval → ✅ Approve / 🚫 Reject (reason); photos, history |
| `/portal-access` | Create a store's portal link, edit contact (logged), Copy / Open / WhatsApp / QR |
| `/p/<token>` | **Public customer portal** (no login, own small bundle): Repair / Collection (store's Magnum assets from COM) or New asset (catalogue families) → details + up to 3 compressed photos → reference number + timeline; "My requests" tab |
| `/newcase` | **Paused** (must not write to COM `cases`) |
| `/wms/*` | Receiving/Transfers/Stocktake/Dispatch → `coolerco_wms_*` tables **not created yet** |
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

**Product families regrouped (Wanda 2026-10-26, applied — data only):** VISIMAX (Visimax, II, III, III 3D, IV, Top Shelf) · SLIM VISIMAX (Slim II, II-3DEf, III, III 3D, IV, + "VISIMAX SLIM NEW GEN (7)") · RODI (33 + 35.3) · UDD 200 · UDD 300 (SC eutectic, SCB, SCEB ×2, SCEBN) · UDD 400 (SCB, SCEBN) · MINUS FORTY (MC460 + VC460); BICYCLE, PUSH CART, SMART N already one each. Merged-away families set inactive + hidden (not deleted; notes "Merged into …"). UDD 100, UDD160, UDD 500 left as they were.

**Scanning on phones + whole app mobile (2026-10-27):** `/scan` has a big **📷 Scan** button → `src/components/CameraScan.jsx` (QR + Code128/39/93, EAN, UPC, ITF, Codabar, DataMatrix; phone's BarcodeDetector, else lazy `@zxing/browser` for iPhone; torch toggle; vibrate on read) + type / hand-scanner box. `codeCandidates()` pulls keys out of QR text/URLs (AST-…, path parts, query values, long codes) → lookup on assets_live name, bar_code, local_code, serial_number, external_code, sap_number (best match first); not found shows the code read. **Teams at different warehouses at the same time:** warehouse remembered per device; Recent = 👤 Mine (default) or 🏢 this warehouse; Submit only your own New scans; header shows "you n today · all teams n". Phone CSS: inputs 16px (no iPhone zoom), header buttons wrap under title, tap targets ≥32–48px, 2-column bay tiles, safe-area padding. Checked all 21 staff pages at 390px with Playwright + mocked Supabase (`scratchpad/mobile-check.js`): no sideways scroll, no errors.

**CoolerCo Field — installable PWA (2026-10-27)** at **/field** (Wanda's choices: one field app in CoolerCo-Ops; same SmartHub login for drivers; "close" = record outcome, COM closes; offline queue).
- Files: `src/field/FieldApp.jsx` (own bundle via `main.jsx`; login; header with 📶/📵 + ⏳ waiting count + 📲 Install (Android prompt) / iPhone "Share → Add to Home Screen" hint; bottom tabs) · `FieldTrip.jsx` · `FieldCases.jsx` · `field.css` · `public/manifest.webmanifest` (name "CoolerCo Field", start_url /field, standalone, icons in `public/icons/`, shortcuts Scan / My trip) · `public/sw.js` (service worker: pages network-first 4 s → saved copy; `/static/*` cache-forever; icons stale-while-revalidate; Supabase never cached) registered in `main.jsx` (prod only); `netlify.toml` no-cache for sw.js + manifest. Staff menu: Field Ops → "📲 Field app (install)".
- **📷 Scan** = `pages/Scan.jsx` with `field` prop + offline (`src/lib/offline.js`, IndexedDB `coolerco-field`): queue for scans (+ photo blobs) and Submits, sent in order on `online` / every 30 s / start; scan ids made on the phone + insert treats duplicate key as done → never duplicates; scan time kept (`created_at` set on the phone). "💾 Save <warehouse> list for offline" stores that warehouse's assets_live rows (WH+WS) for offline lookups; dropdowns/areas cached (`cachedQuery`). Session via getSession (works offline).
- **🚚 My trip** (read-only from the routing app's tables — routing tables are SELECT-only for users; routing app writes outcomes via its own server code): driver picks their routing name once (`routing_portal_users` driver/technician; saved on the phone — SmartHub accounts have no portal username); routes for date (‹ › today) → current version stops in order: routing outcome (planned/solved/carried over/cancelled…), **live COM status** + SLA (`cases`), prep Picked/RTW/Packed + picked barcode (`coolerco_picking_queue`), assets, address, contact (`routing_pos_contacts`); 🧭 Navigate (Google Maps, alternative address if set), 📞 Call, 💬 WhatsApp, 📝 Record outcome ↗ (opens routing trip sheet). Trip saved on the phone for offline viewing.
- **📋 Cases**: lookup by CAS-…, L-code, store name or scanned asset → `coolerco_case_search` (all statuses), status/SLA/due/assets.
- Tested with Playwright + mocked Supabase at 390 px (`scratchpad/field-check.js`): picker → trip → stop, cases, offline scan queued then sent on reconnect, SW active, manifest OK.
- **Sizes / storage (measured 2026-10-27):** first download ≈ 115 KB compressed (Android) / ≈ 225 KB (iPhone, + ZXing camera reader, only fetched where the phone has no BarcodeDetector); then cached by the service worker. Offline asset list: Gauteng 5,011 assets ≈ 2.2 MB on the phone (other warehouses ≤ 1.7 MB together); replaced on refresh, never grows. Photos compressed at capture to 1024 px / JPEG 70% (≈ 100–200 KB, from 3–6 MB) — before storing or sending. Online: uploaded straight away, nothing kept. Offline: kept in the queue and **deleted from the phone as soon as the scan is sent**. Trip copies > 7 days purged; `navigator.storage.persist()` requested so waiting scans aren't cleared; "💾 n MB on phone" shown on the Field scan bar.
- **Driver "open in app" links (2026-10-27, branch `field-driver-links`, waiting for approval of 011):** Wanda: keep the routing app's WhatsApp link as backup + a separate link that opens the Field app. Drivers have no SmartHub login (routing outcomes are logged as "Mobile trip sheet driver"), so: one personal **8-character code per driver** (`coolerco_field_driver_links`, easy alphabet, never expires, ↻ New code kills the old link) → link `/field/d/<code>` → Field app **driver mode** (no login, only "My trip", data from security-definer `coolerco_field_trip(code, date)` — routes, current-version stops, COM status, contacts, prep). Phone remembers the code; installed iPhone app (separate storage) asks for the code once ("CODE" screen; staff sign-in is a second button). Staff page `/driver-links` "Driver app links" (Field Ops): per driver today's routes, code, last opened, 💬 WhatsApp app link · 📋 Copy · 🔳 QR · ↻ New code. Script `supabase/coolerco_011_field_driver_links.sql`.
- **Next for outcomes in the Field app:** needs the routing app's repository (smartroutertma) to reuse its own outcome/arrived/left/job-card server endpoints — not built yet. Drivers record outcomes in the routing trip sheet meanwhile (704+ stops already done that way).

**Then (agreed order):** COM matching after upload (same store + asset/family + compatible type, ~14 days) · combined COM + CoolerCo cases view · **conversion stats** (portal requests → COM cases) · WhatsApp via Meta Cloud API (after Wanda's Meta setup) · tenant/client structure (Magnum, Tiger Brands) · route QR sheet + bulk send queue · staff Delivery wizard · routing app job card / tripsheet · WMS tables.

**Open questions for Wanda (unanswered):** Magnum second approval for some types? Customers see concessionaire comments? Concessionaires log requests in v1? Several users per concessionaire? Replacement on the customer portal? Auto-link exact COM matches? Match window 14 days? Block or warn on duplicates? Approver sets condition/branding?

**Open risk:** `cases` table has RLS disabled (readable with the anon key incl. contact numbers) — plan a fix with the other apps.
