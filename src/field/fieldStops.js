import { supabase } from '../lib/supabase'
import { queueAdd, queueAll, flushQueue, cachedQuery } from '../lib/offline'
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
