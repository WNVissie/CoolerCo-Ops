import { supabase } from '../lib/supabase'
import { queueAdd, queueAll, flushQueue, cachedQuery, offlineLookup } from '../lib/offline'
import { codeCandidates } from '../components/CameraScan'
import { getGps } from '../lib/photos'

// Field app taps (Arrived · Completed · Not completed · Left POS) + job cards — script 031.
// Everything goes through the phone's offline queue first, so it works without signal and is sent in order.
// Saved in coolerco_field_* tables on TEST; RouteIQ is not touched (it will receive the same rows later).

// ── "Are you at the right store?" ─────────────────────────────────
// Arrived more than FAR_M metres (plus the GPS's own uncertainty) from the stop's point → the driver confirms. Never blocks.
export const FAR_M = 300
export function stopCoords(s) {
  const lat = s.use_alternative_address ? s.alternative_latitude : s.latitude
  const lng = s.use_alternative_address ? s.alternative_longitude : s.longitude
  return lat && lng ? { lat: +lat, lng: +lng } : null
}
export function distanceM(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(h)))
}
export const fmtDistance = m => (m < 1000 ? `${m} m` : `${(m / 1000).toLocaleString('en-ZA', { maximumFractionDigits: m < 10000 ? 1 : 0 })} km`)
export const isFar = (dist, gps) => dist != null && dist > FAR_M + Math.min(gps?.acc || 0, 500)

export const TAP_LABEL = { arrived: '📍 Arrived', completed: '✅ Completed', not_completed: '⚠️ Not completed', left: '🚪 Left POS' }

// Is 031 installed? (the app must keep working without it — then the old "Record outcome ↗" button shows)
export async function fieldTablesReady() {
  if (!navigator.onLine) return localStorage.getItem('cc_field_031') === '1'
  const { error } = await supabase.from('coolerco_field_reasons').select('code').limit(1)
  const ok = !error
  localStorage.setItem('cc_field_031', ok ? '1' : '0')
  return ok
}

// Is 032 installed? (service result, repair details, spares, refusal reason on the job card)
export async function jobCard032Ready() {
  if (!navigator.onLine) return localStorage.getItem('cc_field_032') === '1'
  const { error } = await supabase.from('coolerco_field_job_cards').select('service_result').limit(0)
  localStorage.setItem('cc_field_032', error ? '0' : '1')
  return !error
}

// Service result — same choices as RouteIQ's trip-sheet job card
export const SERVICE_RESULTS = [
  { code: 'service_completed', label: 'Service completed', icon: '✅' },
  { code: 'service_denied', label: 'Service Denied/Refused', icon: '🚫', reason: 'SERVICE_DENIED' },
  { code: 'incorrect_location', label: 'Incorrect Location', icon: '📍', reason: 'INCORRECT_LOCATION', old: 'LOCATION_NOT_FOUND' },
  { code: 'location_closed', label: 'Location Closed', icon: '🔒', reason: 'LOCATION_CLOSED', old: 'STORE_CLOSED' },
  { code: 'repair_failed', label: 'Repair Failed', icon: '🛠', reason: 'REPAIR_FAILED', old: 'OTHER', repairOnly: true },
]

// Look an asset up by any code it carries (asset no., barcode, local code, serial, external code, SAP no.).
// Online: the live asset register · no signal: the warehouse list saved on the phone.
export async function lookupAsset(raw) {
  const keys = codeCandidates(raw).map(k => k.replace(/[,()"\\]/g, '')).filter(Boolean)
  if (!keys.length) return { asset: null }
  if (navigator.onLine) {
    const list = keys.map(k => `"${k}"`).join(',')
    const F = ['name', 'bar_code', 'local_code', 'serial_number', 'external_code', 'sap_number']
    const { data, error } = await supabase.from('assets_live')
      .select('name,bar_code,local_code,serial_number,sap_number,product_base,product_variant,brand_hierarchy,condition,asset_status,asset_location,assign_account')
      .or(F.map(f => `${f}.in.(${list})`).join(',')).limit(5)
    if (!error) {
      const rank = x => F.findIndex(f => keys.includes(String(x[f] || '')))
      return { asset: (data || []).sort((x, y) => rank(x) - rank(y))[0] || null, source: 'live' }
    }
    if (!/fetch|network|timeout/i.test(error.message || '')) return { asset: null, error: error.message }
  }
  return { asset: await offlineLookup(keys), source: 'phone' }
}

export const loadReasons = () => cachedQuery('field_reasons', () =>
  supabase.from('coolerco_field_reasons').select('code,label,needs_note').eq('active', true).order('sort_order'))

// latest state per stop as saved on the server
export async function serverStatus(stopIds) {
  if (!stopIds.length) return []
  const { data, error } = await supabase.from('coolerco_field_stop_status').select('*').in('stop_id', stopIds)
  if (error) throw error
  return data || []
}

// taps still waiting on this phone (not sent yet)
export async function pendingTaps() {
  return (await queueAll()).filter(q => q.type === 'stop_event').map(q => ({ ...q.row, pending: true }))
}

// Combine server state + waiting taps → { [stop_id]: { arrived_at, left_at, outcome, reason_code, outcome_at, pending } }
export function mergeState(server, pending) {
  const m = {}
  for (const r of server || []) m[r.stop_id] = { ...r, pending: false }
  for (const e of [...(pending || [])].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))) {
    const st = (m[e.stop_id] ||= {})
    st.pending = true
    if (e.event_type === 'arrived' && !st.arrived_at) st.arrived_at = e.occurred_at
    if (e.event_type === 'left') st.left_at = e.occurred_at
    if (e.event_type === 'completed' || e.event_type === 'not_completed') {
      if (!st.outcome_at || new Date(e.occurred_at) >= new Date(st.outcome_at)) {
        st.outcome = e.event_type; st.reason_code = e.reason_code; st.outcome_at = e.occurred_at
      }
    }
  }
  return m
}

const base = (stop, driver) => ({
  stop_id: stop.id, route_id: stop.route_id, case_number: stop.case_number || null, pos_local_code: stop.pos_local_code || null,
  driver_username: driver?.username || null,
})

// Record one tap. GPS is best-effort (max 5 s) and never blocks the save.
export async function recordTap(stop, driver, type, { reason_code = null, note = null, at, gps: known } = {}) {
  const gps = known !== undefined ? known : await getGps(5000)
  const row = {
    id: crypto.randomUUID(), ...base(stop, driver), event_type: type, reason_code, note: note || null,
    occurred_at: at || new Date().toISOString(),
    latitude: gps?.lat ?? null, longitude: gps?.lng ?? null, accuracy_m: gps?.acc ?? null,
  }
  await queueAdd({ type: 'stop_event', row })
  flushQueue()
  return row
}

// Save a job card (+ photos + signature) and the matching Completed / Not completed tap.
export async function saveJobCard(stop, driver, card, photos, signature) {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` // phone's own (SA) date, not UTC
  const files = []
  const photo_paths = (photos || []).map((b, i) => { const path = `field/${day}/${id}/photo-${i + 1}.jpg`; files.push({ path, blob: b, type: 'image/jpeg' }); return path })
  let signature_path = null
  if (signature) { signature_path = `field/${day}/${id}/signature.png`; files.push({ path: signature_path, blob: signature, type: 'image/png' }) }
  const gps = await getGps(5000)
  const row = {
    id, ...base(stop, driver), case_type: stop.case_type || null, completed_at: now, photo_paths, signature_path,
    latitude: gps?.lat ?? null, longitude: gps?.lng ?? null, ...card,
  }
  await queueAdd({ type: 'job_card', row, photos: files })
  await recordTap(stop, driver, card.outcome, { reason_code: card.reason_code, note: card.work_done, at: now })
  return row
}

// Which asset fields a case type needs on the job card
export function assetRoles(caseType = '') {
  const t = caseType.toLowerCase()
  if (t.includes('replacement')) return ['delivered', 'removed']
  if (t.includes('deliver') || t.includes('prepare')) return ['delivered']
  if (t.includes('removal') || t.includes('receive') || t.includes('collect')) return ['removed']
  if (t.includes('repair') || t.includes('decal')) return ['repaired']
  return ['repaired']
}

// ── route events (033): 🏭 left warehouse · 🏠 returned · ⏱ delays · ⚠️ incorrect POS detail ─────────
export const DELAY_TYPES = [['late_departure', 'Late departure'], ['running_late', 'Running late']]
export const ROUTE_DELAY_REASONS = ['Assets were not ready to load', 'Cases were not assigned to me', 'Tripsheet was not received', 'Assets not assigned on COM']
export const POS_DELAY_REASONS = ['Customer delay', 'Traffic', 'Parking', 'Finding Location', 'Vehicle Issue', 'Other']
export const POS_ISSUES = [['incorrect_address', 'Incorrect address'], ['incorrect_pos_name', 'Incorrect POS name'], ['incorrect_gps', 'Incorrect GPS'], ['incorrect_contact', 'Incorrect contact']]

export async function routeEvents033Ready() {
  if (!navigator.onLine) return localStorage.getItem('cc_field_033') === '1'
  const { error } = await supabase.from('coolerco_field_route_events').select('id').limit(0)
  localStorage.setItem('cc_field_033', error ? '0' : '1')
  return !error
}
export async function serverRouteEvents(routeIds) {
  if (!routeIds.length) return { events: [], reports: [] }
  const [e, r] = await Promise.all([
    supabase.from('coolerco_field_route_events').select('*').in('route_id', routeIds).order('occurred_at'),
    supabase.from('coolerco_field_pos_reports').select('id,stop_id,route_id,issues,created_at').in('route_id', routeIds),
  ])
  if (e.error) throw e.error
  return { events: e.data || [], reports: r.data || [] }
}
export async function pendingRouteRows() {
  const q = await queueAll()
  return { events: q.filter(x => x.type === 'route_event').map(x => ({ ...x.row, pending: true })), reports: q.filter(x => x.type === 'pos_report').map(x => ({ ...x.row, pending: true })) }
}
// Warehouse pins (same as RouteIQ's trip sheet) — used to say how far a trip start was from the WH.
export const WAREHOUSE_PINS = {
  'RTMA Bloemfontein': [-29.0966, 26.1596], 'RTMA Cape Town': [-33.8084, 18.5323], 'RTMA Durban': [-29.83339271205558, 30.828805066371313],
  'RTMA East London': [-32.9809, 27.9116], 'RTMA Gauteng': [-26.0390, 28.2320], 'RTMA George': [-33.9875, 22.4529],
  'RTMA Nelspruit': [-25.3274, 31.0180], 'RTMA Polokwane': [-23.8842, 29.4591], 'RTMA Port Elizabeth': [-33.9547, 25.5792],
}
export const TRIP_START = { warehouse: 'from_warehouse', current_location: 'from_current_location' }
export const WAREHOUSE_START_TOLERANCE_M = 1000
export function warehousePin(group = '') {
  const name = String(group).trim().replace(/\s+(WH|WS|WAREHOUSE|WORKSHOP)$/i, '').toLowerCase()
  const key = Object.keys(WAREHOUSE_PINS).find(k => k.toLowerCase() === name)
  return key ? { lat: WAREHOUSE_PINS[key][0], lng: WAREHOUSE_PINS[key][1] } : null
}
// Start trip (Wanda 2026-11-20): From Warehouse or From current location, one GPS stamp either way.
// Saved as left_warehouse (reports + board keep working); reason = from_warehouse / from_current_location,
// note = distance from the WH pin and an "away from WH" flag for the supervisor.
export function tripStartNote(startFrom, gps, warehouseGroup) {
  const pin = warehousePin(warehouseGroup)
  const metres = gps && pin ? Math.round(distanceM(gps, pin)) : null
  const away = startFrom === 'current_location' || (metres != null && metres > WAREHOUSE_START_TOLERANCE_M)
  const where = metres == null ? (gps ? 'distance from WH unknown' : 'location unavailable') : `${(metres / 1000).toFixed(1)} km from WH`
  return `${startFrom === 'current_location' ? 'Started from current location' : 'Started from warehouse'} · ${where}${away ? ' · NOT FROM WH' : ''}`
}
export async function recordTripStart(route, driver, startFrom) {
  const gps = await getGps(8000)
  return recordRouteEvent(route, driver, 'left_warehouse', { reason: TRIP_START[startFrom] || TRIP_START.warehouse, note: tripStartNote(startFrom, gps, route.warehouse_group), gps })
}
export async function recordRouteEvent(route, driver, event_type, { stop = null, delay_type = null, reason = null, note = null, gps: known } = {}) {
  const gps = known !== undefined ? known : await getGps(5000)
  const row = {
    id: crypto.randomUUID(), route_id: route.id, stop_id: stop?.id || null, case_number: stop?.case_number || null, pos_local_code: stop?.pos_local_code || null,
    event_type, delay_type, reason, note: note || null, occurred_at: new Date().toISOString(),
    latitude: gps?.lat ?? null, longitude: gps?.lng ?? null, accuracy_m: gps?.acc ?? null, driver_username: driver?.username || null,
  }
  await queueAdd({ type: 'route_event', row }); flushQueue()
  return row
}
export async function savePosReport(stop, driver, { issues, fix, gps }) {
  const row = {
    id: crypto.randomUUID(), route_id: stop.route_id, stop_id: stop.id, pos_local_code: stop.pos_local_code || null, point_of_sale: stop.point_of_sale || null,
    issues, new_pos_name: fix.name || null, new_address: fix.address || null, new_contact_name: fix.contact || null, new_contact_phone: fix.phone || null,
    latitude: gps?.lat ?? null, longitude: gps?.lng ?? null, accuracy_m: gps?.acc ?? null, driver_username: driver?.username || null,
  }
  await queueAdd({ type: 'pos_report', row }); flushQueue()
  return row
}
