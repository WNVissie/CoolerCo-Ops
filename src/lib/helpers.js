export const PS = 50 // page size

export function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function num(n) {
  return n != null ? Number(n).toLocaleString() : '—'
}

// ── Case status (same rules as the RTMA dashboard: upload-cases.js / CLAUDE.md) ──
// Open = Status Reason Open, In Progress, Waiting, In Service + On Hold (shown, never overdue)
export const OPEN_REASONS = ['Open', 'In Progress', 'Waiting', 'In Service', 'On Hold']

export const STATUS_REASONS = [
  'Open', 'In Progress', 'Waiting', 'In Service', 'On Hold',
  'Solved', 'Not Solved', 'Canceled', 'Rejected', 'Action Required',
  'Approval Required', 'Error', 'Error External',
]

export function isOpenCase(statusReason) {
  return OPEN_REASONS.some(s => s.toLowerCase() === String(statusReason || '').trim().toLowerCase())
}

export function statusColor(s) {
  const v = String(s || '').toLowerCase()
  if (v === 'solved') return 'green'
  if (v === 'not solved' || v === 'rejected' || v.startsWith('error')) return 'red'
  if (v === 'canceled' || v === 'cancelled') return 'neutral'
  if (v === 'on hold' || v === 'waiting' || v === 'action required' || v === 'approval required') return 'orange'
  if (v === 'in service' || v === 'in progress' || v === 'open') return 'blue'
  return 'neutral'
}

// Real sla_status values written by the dashboard upload (slaResult()).
// "SLA Exceeded" = closed BEFORE the end date (early) → good.
export const SLA_OPTIONS = [
  'SLA Met', 'SLA Exceeded', 'SLA Not Met',
  'Open Case SLA Not Met', 'Open Case SLA Not Measured',
  'SLA Not Measured', 'Cancelled by Organisation', 'Cancelled - Out of Stock',
  'Exception - Rejected', 'Exception - Error',
]

export function slaColor(s) {
  if (!s) return 'neutral'
  if (s === 'SLA Met' || s === 'SLA Exceeded') return 'green'
  if (s.includes('Not Met')) return 'red'
  if (s.startsWith('Exception')) return 'purple'
  if (s.startsWith('Cancelled')) return 'neutral'
  return 'orange' // not measured / open
}

export function slaLabel(s) {
  if (!s) return '—'
  if (s === 'SLA Exceeded') return 'Early (Exceeded)'
  if (s === 'Open Case SLA Not Met') return 'Open · Overdue'
  if (s === 'Open Case SLA Not Measured') return 'Open · In time'
  return s
}

export const CASE_TYPES = [
  'Deliver an Asset', 'Replacement of Asset', 'Removal of Asset', 'Receive Asset',
  'Repair at Workshop', 'Repair at Shopper POS', 'Decal @WH', 'Prepare Asset', 'Scrap an Asset',
]

export const CASE_TYPE_ICON = {
  'Deliver an Asset': '🚚', 'Replacement of Asset': '🔁', 'Removal of Asset': '📦',
  'Receive Asset': '📥', 'Repair at Workshop': '🛠️', 'Repair at Shopper POS': '🔧',
  'Decal @WH': '🏷️', 'Prepare Asset': '🧰', 'Scrap an Asset': '🗑️',
}

export const DATE_FIELDS = [
  { key: 'created_on', label: 'Created On' },
  { key: 'begin_date', label: 'Begin (Start) Date' },
  { key: 'end_date', label: 'End Date' },
  { key: 'service_closure_date', label: 'Service Closure Date' },
]

// ── Which asset(s) belong to a case — same rule as assetForCaseType() in the
// dashboard upload. Mapped Asset is only ever a fallback.
// Each role carries the matching "requested" values so asked-for vs done can be compared.
export function caseAssets(c) {
  if (!c) return []
  const t = String(c.case_type || '').toUpperCase()
  const req = {
    product_base: c.requested_product_base,
    condition: c.requested_asset_condition,
    brand: c.requested_brand_hierarchy,
  }
  const delivered = c.asset_delivered && {
    role: 'Delivered', icon: '⬆', asset: c.asset_delivered,
    condition: c.delivered_asset_condition, requested: req,
  }
  const removed = c.asset_removed && {
    role: 'Removed', icon: '⬇', asset: c.asset_removed,
    condition: c.removed_asset_condition || c.asset_condition, product_base: c.removed_product_base,
  }
  const repaired = c.asset_repaired && {
    role: 'Repaired', icon: '🛠', asset: c.asset_repaired,
    condition: c.repaired_asset_condition || c.asset_condition, brand: c.current_asset_brand_hierarchy,
  }
  const mapped = c.mapped_asset && {
    role: 'Mapped (fallback)', icon: '•', asset: c.mapped_asset, condition: c.asset_condition, fallback: true,
  }

  let out = []
  if (['DELIVER AN ASSET', 'PREPARE ASSET'].includes(t)) out = [delivered]
  else if (t === 'REPLACEMENT OF ASSET') out = [delivered, removed]
  else if (['REMOVAL OF ASSET', 'RECEIVE ASSET'].includes(t)) out = [removed]
  else if (['REPAIR AT WORKSHOP', 'REPAIR AT SHOPPER POS', 'DECAL @WH', 'DECAL@WH'].includes(t)) out = [repaired]
  else out = [delivered, removed, repaired]

  out = out.filter(Boolean)
  if (!out.length && mapped) out = [mapped]
  return out
}

// Short text for the table's Asset column
export function caseAssetText(c) {
  const a = caseAssets(c)
  if (!a.length) return '—'
  return a.map(x => (a.length > 1 ? `${x.icon} ` : '') + x.asset).join('  ')
}

// ── Asset condition: COM stores the full label, e.g. "A - New"
export const CONDITIONS = ['A - New', 'B - Good as New', 'C - Used', 'D - Back of House only']

export function condColor(c) {
  const letter = String(c || '').trim().charAt(0).toUpperCase()
  return { A: 'green', B: 'blue', C: 'orange', D: 'red' }[letter] || 'neutral'
}

// ── Warehouses: one translator for the three naming styles in the data
// code (app) ↔ cases.warehouse_workshop ↔ assets_live.assign_account (WH + WS)
export const WAREHOUSES = ['JHB', 'CPT', 'BFN', 'DBN', 'EL', 'GEO', 'NEL', 'POL', 'PE']
export const WH_NAMES = {
  JHB: 'Gauteng', CPT: 'Cape Town', BFN: 'Bloemfontein',
  DBN: 'Durban', EL: 'East London', GEO: 'George',
  NEL: 'Nelspruit', POL: 'Polokwane', PE: 'Port Elizabeth',
}
export const whCaseName = code => (WH_NAMES[code] ? `RTMA ${WH_NAMES[code]}` : null)
export const whAssetAccounts = code => (WH_NAMES[code] ? [`RTMA ${WH_NAMES[code]} WH`, `RTMA ${WH_NAMES[code]} WS`] : [])

// ── WMS bays (RTMA Status Mapping, confirmed 2026-10-25). Mirrors
// public.coolerco_bay_for_status() in the database.
export const BAYS = [
  { key: 'RED',     icon: '🔴', label: 'Receiving',   desc: 'Waiting for Action · To Audit',        color: 'red' },
  { key: 'ORANGE',  icon: '🟠', label: 'Repair',      desc: 'To be Repaired · Refurbished · Broken', color: 'orange' },
  { key: 'GREEN',   icon: '🟢', label: 'Ready to Work', desc: 'Available stock',                    color: 'green' },
  { key: 'YELLOW',  icon: '🟡', label: 'Branding',    desc: 'To be Branded — not yet available',     color: 'yellow' },
  { key: 'PENDING', icon: '🔵', label: 'In Transit',  desc: 'Moving between locations',              color: 'blue' },
  { key: 'SCRAP',   icon: '⚫', label: 'Scrap',       desc: 'To be Scrapped',                        color: 'neutral' },
  { key: 'MISSING', icon: '⚠️', label: 'Missing',     desc: 'Flagged — not found',                   color: 'purple' },
  { key: 'OTHER',   icon: '▫️', label: 'Other',       desc: 'Any other status',                      color: 'neutral' },
]

export function bayForStatus(s) {
  const v = String(s || '').trim().toLowerCase()
  if (v === 'waiting for action' || v === 'to audit') return 'RED'
  if (v === 'to be repaired' || v === 'to be refurbished' || v === 'broken') return 'ORANGE'
  if (v === 'ready to work') return 'GREEN'
  if (v === 'to be branded') return 'YELLOW'
  if (v === 'to be scrapped') return 'SCRAP'
  if (v === 'in transit') return 'PENDING'
  if (v === 'missing') return 'MISSING'
  return 'OTHER'
}
export const BAY_STATUSES = {
  RED: ['Waiting for Action', 'To Audit'],
  ORANGE: ['To be Repaired', 'To be Refurbished', 'Broken'],
  GREEN: ['Ready to Work'],
  YELLOW: ['To be Branded'],
  PENDING: ['In Transit'],
  SCRAP: ['To be Scrapped'],
  MISSING: ['Missing'],
}

// Route status (routing app)
export function rtStatusColor(s) {
  const m = { saved_draft: 'neutral', finalised: 'blue', dispatched: 'orange', partially_completed: 'orange', completed: 'green', not_used: 'neutral' }
  return m[s] || 'neutral'
}

export function rtStatusLabel(s) {
  const m = { saved_draft: 'Draft', finalised: 'Finalised', dispatched: 'Dispatched', partially_completed: 'Partial', completed: 'Completed', not_used: 'Not Used' }
  return m[s] || s
}

export const SPARES_APP_URL = 'https://smartsparesrtma.netlify.app/'

// Kept for the (now link-only) spares pages
export const CATS = [
  { key: 'spares',    icon: '🔧', label: 'Spares',    view: 'v_spare_stock_dashboard' },
  { key: 'baskets',   icon: '🧺', label: 'Baskets',   view: 'v_basket_stock_dashboard' },
  { key: 'decals',    icon: '🏷️', label: 'Decals',    view: 'v_decal_stock_dashboard' },
  { key: 'doors',     icon: '🚪', label: 'Doors',     view: 'v_door_stock_dashboard' },
  { key: 'furniture', icon: '🪑', label: 'Furniture', view: 'v_furniture_stock_dashboard' },
  { key: 'office',    icon: '📎', label: 'Office',    view: 'v_office_stock_dashboard' },
]
