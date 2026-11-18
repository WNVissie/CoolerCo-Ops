// Trip check — what can be measured from the GPS saved with the Arrived / Left taps only (no tracking).
// Two sources, merged per stop: 🛣 RouteIQ WhatsApp trip sheet (routing_route_events, GPS in metadata.location)
// and 📲 CoolerCo Field app (coolerco_field_stop_events / coolerco_field_route_events).
// Distance = straight line between Left at one store and Arrived at the next × ROAD_FACTOR (same 1.3 RouteIQ's
// capacity model uses). It is an estimate: the road actually driven, detours and stops in between are not known.
// Pure functions (no Supabase) so they can be tested on their own.

export const ROAD_FACTOR = 1.3
export const LIMITS = {
  farM: 300,          // a tap further than this (+ GPS uncertainty, max 500 m) from the store's map point
  slowKmh: 15,        // a leg slower than this …
  slowMinMinutes: 15, // … that also took at least this long
  fastKmh: 120,       // faster than this is not possible on a truck — a tap was not made at the store
  fastMinKm: 0.5,
  unreliableM: 2000,  // a leg whose start or end tap is further than this from its store is not counted in the km
}

export function distanceM(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(h))
}
const okGps = g => g && Number.isFinite(g.lat) && Number.isFinite(g.lng) && !(g.lat === 0 && g.lng === 0)
const r1 = n => (n == null ? null : Math.round(n * 10) / 10)
const t = s => (s ? new Date(s).getTime() : null)
// South African day (UTC+2, no daylight saving)
export const saDay = s => new Date(t(s) + 2 * 3600e3).toISOString().slice(0, 10)
const sameDay = (a, b) => saDay(a) === saDay(b)

export function stopPoint(s) {
  const lat = +(s.use_alternative_address ? s.alternative_latitude : s.latitude)
  const lng = +(s.use_alternative_address ? s.alternative_longitude : s.longitude)
  return okGps({ lat, lng }) ? { lat, lng } : null
}

// ── normalise the two sources into one list: { route_id, stop_id, type, at, gps, source } ──
export function fromRouteIQ(rows) {
  const TYPE = { driver_arrived: 'arrived', driver_left_pos: 'left', driver_left_warehouse: 'left_warehouse', driver_returned_warehouse: 'returned_warehouse', driver_delay_reported: 'delay' }
  return (rows || []).filter(e => TYPE[e.event_type]).map(e => {
    const l = e.metadata?.location || {}
    const gps = { lat: +l.latitude, lng: +l.longitude, acc: l.accuracyMetres != null ? Math.round(+l.accuracyMetres) : null }
    return { route_id: e.route_id, stop_id: e.route_stop_id, type: TYPE[e.event_type], at: l.capturedAt || e.created_at, gps: okGps(gps) ? gps : null, source: 'RouteIQ', note: e.reason || null }
  })
}
export function fromField(stopRows, routeRows) {
  const g = e => (okGps({ lat: e.latitude, lng: e.longitude }) ? { lat: e.latitude, lng: e.longitude, acc: e.accuracy_m != null ? Math.round(e.accuracy_m) : null } : null)
  return [
    ...(stopRows || []).filter(e => e.event_type === 'arrived' || e.event_type === 'left')
      .map(e => ({ route_id: e.route_id, stop_id: e.stop_id, type: e.event_type, at: e.occurred_at, gps: g(e), source: 'Field app', note: e.note })),
    ...(routeRows || []).map(e => ({ route_id: e.route_id, stop_id: e.stop_id, type: e.event_type === 'delay' ? 'delay' : e.event_type, at: e.occurred_at, gps: g(e), source: 'Field app', note: e.reason || e.note })),
  ]
}

// ── one route → visits (several cases at one store = one visit) + legs + flags ──
// hoursCheck (optional): (visit, arrivedAtIso) → { level, text } | null — store hours flag (see posHours.js)
export function checkRoute(route, stops, events, hoursCheck = null) {
  const ev = events.filter(e => e.route_id === route.id)
  const byStop = {}
  for (const e of ev) if (e.stop_id) (byStop[e.stop_id] ||= []).push(e)
  const delayStops = new Set(ev.filter(e => e.type === 'delay' && e.stop_id).map(e => e.stop_id))
  const routeDelay = ev.some(e => e.type === 'delay' && !e.stop_id)

  // group stops into store visits: same POS code (or same name) on this route
  const groups = new Map()
  for (const s of [...stops].sort((a, b) => a.stop_sequence - b.stop_sequence)) {
    const key = s.pos_local_code || s.point_of_sale || s.id
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(s)
  }
  const visits = [...groups.values()].map(ss => {
    const taps = ss.flatMap(s => byStop[s.id] || [])
    const arr = taps.filter(e => e.type === 'arrived').sort((a, b) => t(a.at) - t(b.at))[0] || null
    const left = taps.filter(e => e.type === 'left').sort((a, b) => t(b.at) - t(a.at))[0] || null
    const first = ss[0], point = stopPoint(first)
    const far = e => (e?.gps && point ? Math.round(distanceM(e.gps, point)) : null)
    const v = {
      stop_ids: ss.map(s => s.id), cases: ss.map(s => s.case_number).filter(Boolean), case_types: [...new Set(ss.map(s => s.case_type).filter(Boolean))],
      store: first.point_of_sale, pos: first.pos_local_code, planned_position: first.stop_sequence, point,
      planned_inbound_km: first.planned_leg_distance_km != null ? +first.planned_leg_distance_km : null,
      planned_arrival_at: first.planned_arrival_at,
      arrived_at: arr?.at || null, left_at: left?.at || null, arr_gps: arr?.gps || null, left_gps: left?.gps || null,
      source: [...new Set([arr?.source, left?.source].filter(Boolean))].join(' + ') || null,
      arr_from_store_m: far(arr), left_from_store_m: far(left),
      dwell_min: arr && left && t(left.at) > t(arr.at) && sameDay(arr.at, left.at) ? Math.round((t(left.at) - t(arr.at)) / 60000) : null,
      delay_reported: ss.some(s => delayStops.has(s.id)),
      flags: [],
    }
    const lim = g => LIMITS.farM + Math.min(g?.acc || 0, 500)
    if (arr && !arr.gps) v.flags.push({ code: 'no_gps_arrived', level: 'info', text: 'Arrived without GPS' })
    if (left && !left.gps) v.flags.push({ code: 'no_gps_left', level: 'info', text: 'Left without GPS' })
    if (v.arr_from_store_m != null && v.arr_from_store_m > lim(arr.gps)) v.flags.push({ code: 'arrived_far', level: 'warn', text: `Arrived tapped ${km(v.arr_from_store_m)} from the store` })
    if (v.left_from_store_m != null && v.left_from_store_m > lim(left.gps)) v.flags.push({ code: 'left_far', level: 'warn', text: `Left tapped ${km(v.left_from_store_m)} from the store (tapped late?)` })
    if (arr && left && !sameDay(arr.at, left.at)) v.flags.push({ code: 'left_next_day', level: 'warn', text: 'Left tapped on a later day' })
    const hf = hoursCheck && arr ? hoursCheck(v, arr.at) : null
    if (hf) v.flags.push({ code: 'hours', ...hf })
    if (v.dwell_min != null && v.dwell_min < 2) v.flags.push({ code: 'quick', level: 'warn', text: 'Arrived and Left tapped within 2 minutes' })
    if (arr && !left) v.flags.push({ code: 'no_left', level: 'info', text: 'No Left tap' })
    v.arr_far = v.flags.some(f => f.code === 'arrived_far'); v.left_far = v.flags.some(f => f.code === 'left_far')
    return v
  })
  // planned order of STORE visits (a store with 2 cases is one visit)
  ;[...visits].sort((a, b) => a.planned_position - b.planned_position).forEach((v, i) => { v.planned_visit = i + 1 })

  // order of the day = order of Arrived taps; visits without a tap go last
  const done = visits.filter(v => v.arrived_at).sort((a, b) => t(a.arrived_at) - t(b.arrived_at))
  const notDone = visits.filter(v => !v.arrived_at)

  // first leg: from the warehouse, when Start at WH has GPS (Field app) — RouteIQ's has no GPS
  const whOut = ev.filter(e => e.type === 'left_warehouse').sort((a, b) => t(a.at) - t(b.at))[0]
  const whBack = ev.filter(e => e.type === 'returned_warehouse').sort((a, b) => t(b.at) - t(a.at))[0]

  const legs = []
  done.forEach((v, i) => {
    const prev = i ? done[i - 1] : null
    const from = prev ? { label: prev.store, at: prev.left_at, gps: prev.left_gps } : whOut ? { label: '🏭 Warehouse', at: whOut.at, gps: whOut.gps } : null
    const leg = { to: v, from_label: from?.label || '🏭 Warehouse', from_at: from?.at || null, kind: prev ? 'store' : 'warehouse', flags: [] }
    if (prev && v.planned_visit !== prev.planned_visit + 1) {
      leg.flags.push({ code: 'order', level: 'info', text: `Out of planned order (planned store ${v.planned_visit} after ${prev.planned_visit})` })
    }
    leg.in_order = !!prev && !leg.flags.some(f => f.code === 'order')
    leg.planned_km = leg.in_order ? v.planned_inbound_km : null
    if (!from || (!prev && !from.gps)) { leg.status = 'Warehouse leg not measured (Start at WH has no GPS)'; legs.push(leg); return }
    if (!from.at) { leg.status = `No Left tap at ${from.label}`; legs.push(leg); return }
    if (!from.gps || !v.arr_gps) { leg.status = 'GPS missing on a tap'; legs.push(leg); return }
    const mins = (t(v.arrived_at) - t(from.at)) / 60000
    if (mins <= 0) { leg.status = 'Arrived tapped before Left at the previous store'; leg.flags.push({ code: 'time', level: 'warn', text: leg.status }); legs.push(leg); return }
    const straight = distanceM(from.gps, v.arr_gps) / 1000
    leg.straight_km = r1(straight)
    leg.est_km = r1(straight * ROAD_FACTOR)
    leg.minutes = Math.round(mins)
    leg.kmh = mins > 0 ? Math.round(leg.est_km / (mins / 60)) : null
    leg.status = 'Measured'
    // a leg measured from a tap made away from the store says nothing about the road between the stores
    leg.reliable = !(prev && prev.left_from_store_m > LIMITS.unreliableM) && !(v.arr_from_store_m > LIMITS.unreliableM)
    if (!leg.reliable) leg.flags.push({ code: 'unreliable', level: 'info', text: 'Tap made away from the store — km for this leg not counted' })
    if (!leg.reliable) { legs.push(leg); return }
    if (leg.est_km >= LIMITS.fastMinKm && leg.kmh > LIMITS.fastKmh) leg.flags.push({ code: 'fast', level: 'bad', text: `${leg.kmh} km/h — not possible; a tap was not made at the store` })
    else if (leg.minutes >= LIMITS.slowMinMinutes && leg.kmh < LIMITS.slowKmh) {
      const why = v.delay_reported || routeDelay
      leg.flags.push({ code: 'slow', level: why ? 'info' : 'warn', text: `${leg.minutes} min for ~${leg.est_km} km (${leg.kmh} km/h)${why ? ' — delay reported' : ' — no delay reported'}` })
    }
    legs.push(leg)
  })
  // last leg back to the warehouse (Field app Returned has GPS)
  const last = done[done.length - 1]
  if (last && whBack?.gps && last.left_gps && last.left_at && t(whBack.at) > t(last.left_at)) {
    const straight = distanceM(last.left_gps, whBack.gps) / 1000, mins = (t(whBack.at) - t(last.left_at)) / 60000
    legs.push({ to: { store: '🏭 Warehouse', arrived_at: whBack.at }, from_label: last.store, from_at: last.left_at, kind: 'return', straight_km: r1(straight), est_km: r1(straight * ROAD_FACTOR), minutes: Math.round(mins), kmh: Math.round(straight * ROAD_FACTOR / (mins / 60)), status: 'Measured', reliable: true, flags: [] })
  }

  const measured = legs.filter(l => l.status === 'Measured' && l.reliable)
  const comparable = measured.filter(l => l.planned_km != null)
  const dwell = done.filter(v => v.dwell_min != null)
  const flags = [...visits.flatMap(v => v.flags), ...legs.flatMap(l => l.flags)]
  return {
    route, visits: [...done, ...notDone], legs,
    summary: {
      stores_planned: visits.length, stores_visited: done.length, gps_taps: ev.filter(e => (e.type === 'arrived' || e.type === 'left') && e.gps).length,
      taps: ev.filter(e => e.type === 'arrived' || e.type === 'left').length,
      legs_measured: measured.length, legs_unreliable: legs.filter(l => l.status === 'Measured' && !l.reliable).length, legs_total: legs.filter(l => l.kind !== 'warehouse').length + (whOut?.gps ? 1 : 0),
      est_km: measured.length ? r1(measured.reduce((s, l) => s + l.est_km, 0)) : null,
      comparable_est_km: comparable.length ? r1(comparable.reduce((s, l) => s + l.est_km, 0)) : null,
      comparable_planned_km: comparable.length ? r1(comparable.reduce((s, l) => s + l.planned_km, 0)) : null,
      drive_min: measured.length ? measured.reduce((s, l) => s + l.minutes, 0) : null,
      avg_dwell_min: dwell.length ? Math.round(dwell.reduce((s, v) => s + v.dwell_min, 0) / dwell.length) : null,
      warn: flags.filter(f => f.level === 'warn' || f.level === 'bad').length,
      info: flags.filter(f => f.level === 'info').length,
      sources: [...new Set(ev.map(e => e.source))],
    },
  }
}

export const km = m => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString('en-ZA', { maximumFractionDigits: 1 })} km`)
