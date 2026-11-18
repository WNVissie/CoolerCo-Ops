import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { statusColor, CASE_TYPE_ICON } from '../lib/helpers'
import { cachedQuery, kvGet, kvSet } from '../lib/offline'
import { fieldTablesReady, loadReasons, serverStatus, pendingTaps, mergeState, recordTap, TAP_LABEL, stopCoords, distanceM, fmtDistance, isFar } from './fieldStops'
import { getGps } from '../lib/photos'
import FieldJobCard from './FieldJobCard'
import StopAssets from './StopAssets'
import { loadProfile, has034 } from './fieldProfile'
import { CrewRequests } from './FieldCrew'
import { RouteWarehouse, RouteDelay, StopExtras } from './FieldRouteParts'
import { routeEvents033Ready, serverRouteEvents, pendingRouteRows } from './fieldStops'
import LocationAsk from './LocationAsk'
import { loadHours, hoursOn, windowKind, statusAt, dayText, saParts, STATE_TAG, STATE_ICON } from '../lib/posHours'
import { isNative, scheduleLeftReminder, cancelLeftReminder } from '../lib/native'

// "Have you left the store?" — asked LEFT_REMIND_MIN after 📍 Arrived while 🚪 Left is not tapped yet.
// "Still here" asks again after the same time. Only while the app is open (or as soon as it is opened again);
// a reminder on a locked phone comes with the Android app. GPS is read only at the Arrived and Left taps.
const LEFT_REMIND_MIN = 15
const snoozeKey = id => `cc_left_snooze:${id}`

// My trip — read view of the routing app's route for this driver (planned + finalised in the routing app).
// Live case status from COM, routing outcome, warehouse prep, assets. Outcomes are recorded in the routing
// app's trip sheet (its own server logic keeps routes, carry-overs and history correct).
// With script 031 on the database: Arrived / Completed / Not completed / Left POS + job card are recorded HERE
// (offline queue → coolerco_field_* tables on TEST). Without 031 the old "Record outcome ↗" button shows.
const ROUTING_URL = 'https://smartroutertma.netlify.app/'
const OUTCOME = {
  planned: ['Planned', 'blue'], solved: ['✅ Done', 'green'], carried_over: ['↪ Carried over', 'orange'],
  cancelled: ['🚫 Cancelled', 'neutral'], removed: ['Removed', 'neutral'], awaiting_third_party_update: ['⏳ Awaiting update', 'orange'],
}
// local (South African) date, not UTC — so midnight to 2 am still shows today
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d) }
const fmtDay = s => new Date(s + 'T12:00:00').toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })
const fmtTime = t => (t ? new Date(t).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '')
const waNo = n => { const d = String(n || '').replace(/\D/g, ''); return !d ? '' : d.startsWith('0') ? '27' + d.slice(1) : d }

// A field person (driver / technician with a slot, script 034) sees ONLY the routes assigned to them today
// (usual RouteIQ slot, or the crew the supervisor set). Staff without a slot keep the "Who is driving?" picker.
const meFromPhone = () => { try { const p = JSON.parse(localStorage.getItem('cc_field_profile')); return has034() && p?.slot ? p : null } catch { return null } }
const meAsDriver = p => ({ username: p.slot.routeiq || 'me', display: p.name, wh: p.slot.warehouse, type: p.slot.type, me: true })

export default function FieldTrip() {
  const [me, setMe] = useState(meFromPhone)
  const [driver, setDriver] = useState(() => { const p = meFromPhone(); if (p) return meAsDriver(p); try { return JSON.parse(localStorage.getItem('cc_field_driver')) } catch { return null } })
  const [picking, setPicking] = useState(!driver)
  useEffect(() => { loadProfile().then(p => { if (has034() && p?.slot) { setMe(p); setDriver(d => (d?.me && d.username === meAsDriver(p).username && d.display === p.name ? d : meAsDriver(p))); setPicking(false) } else setMe(null) }) }, [])
  const [date, setDate] = useState(() => iso(new Date()))
  const [trip, setTrip] = useState(null)
  const [err, setErr] = useState(null)
  const [fromPhone, setFromPhone] = useState(false)
  const [open, setOpen] = useState(null)
  const [ready, setReady] = useState(false)       // 031 installed
  const [reasons, setReasons] = useState([])
  const [pending, setPending] = useState([])
  const [card, setCard] = useState(null)          // { stop, mode }
  const [tapBusy, setTapBusy] = useState(null)
  const [now, setNow] = useState(Date.now())     // ticks every 30 s + when the app comes back to the front
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    const vis = () => { if (document.visibilityState === 'visible') setNow(Date.now()) }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [])
  const buzzed = useRef('')
  // Android app: the same reminder as a phone notification, so it also reaches a locked phone.
  // Scheduled for each of today's stops with Arrived and no Left; cancelled once Left is tapped.
  const planned = useRef({})

  useEffect(() => { fieldTablesReady().then(ok => { setReady(ok); if (ok) loadReasons().then(setReasons) }) }, [])
  const [v033, setV033] = useState(false)       // 033 installed: warehouse / delays / POS reports
  const [pendRoute, setPendRoute] = useState({ events: [], reports: [] })
  useEffect(() => { routeEvents033Ready().then(setV033) }, [])
  const refreshPending = useCallback(() => { pendingTaps().then(setPending); pendingRouteRows().then(setPendRoute) }, [])
  useEffect(() => {
    refreshPending()
    window.addEventListener('cc-queue', refreshPending)
    return () => window.removeEventListener('cc-queue', refreshPending)
  }, [refreshPending])

  const load = useCallback(async () => {
    if (!driver) return
    setTrip(null); setErr(null); setFromPhone(false)
    const key = driver.me ? `trip:me:${date}` : `trip:${driver.username}:${date}`
    try {
      if (!navigator.onLine) throw new Error('offline')
      const COLS = 'id,route_number,route_date,status,vehicle_code,warehouse_group,resource_display_name,planned_start_at,planned_return_at,planned_distance_km,dispatched_at,completed_at'
      let routes, error
      if (driver.me) {
        // only the routes this person is on today (finalised or later)
        const mine = await supabase.rpc('coolerco_my_routes', { p_date: date })
        if (mine.error) throw mine.error
        const ids = (mine.data || []).map(x => x.route_id)
        ;({ data: routes, error } = ids.length ? await supabase.from('routing_routes').select(COLS).in('id', ids).order('route_number') : { data: [], error: null })
      } else {
        ;({ data: routes, error } = await supabase.from('routing_routes').select(COLS)
          .eq('resource_username', driver.username).eq('route_date', date).neq('status', 'not_used').order('route_number'))
      }
      if (error) throw error
      let stops = [], cases = [], contacts = [], prep = [], hours = null
      if (routes?.length) {
        const { data: vers } = await supabase.from('routing_route_versions').select('id,route_id').in('route_id', routes.map(r => r.id)).eq('is_current', true)
        const { data: st } = await supabase.from('routing_route_stops')
          .select('id,route_id,stop_sequence,case_number,case_type,point_of_sale,pos_local_code,address,latitude,longitude,use_alternative_address,alternative_address,alternative_latitude,alternative_longitude,asset_barcodes,asset_product_bases,asset_count,planned_arrival_at,end_date,outcome_status,actual_case_status,outcome_recorded_at,outcome_reason')
          .in('route_version_id', (vers || []).map(v => v.id)).order('stop_sequence')
        stops = st || []
        const caseNos = [...new Set(stops.map(s => s.case_number).filter(Boolean))]
        const posCodes = [...new Set(stops.map(s => s.pos_local_code).filter(Boolean))]
        // parallel: live COM status, store contacts, warehouse prep
        const [c, k, p, h] = await Promise.all([
          caseNos.length ? supabase.from('cases').select('case_number,status_reason,sla_status,end_date,service_closure_date,motive,requested_product_base,asset_delivered,asset_removed,asset_repaired').in('case_number', caseNos) : { data: [] },
          posCodes.length ? supabase.from('routing_pos_contacts').select('pos_local_code,customer_contact_name,mobile_phone,business_phone,customer_whatsapp').in('pos_local_code', posCodes) : { data: [] },
          supabase.rpc('coolerco_picking_queue', { p_from: date, p_warehouse: routes[0].warehouse_group }),
          loadHours(posCodes, { from: date, to: date }).catch(() => null), // 🕘 store hours (036) — nothing shown without it
        ])
        hours = h?.ready ? h : null
        cases = c.data || []; contacts = k.data || []
        const ids = new Set(routes.map(r => r.id)); prep = (p.data || []).filter(x => ids.has(x.route_id))
      }
      let fs = []
      if (stops.length && localStorage.getItem('cc_field_031') === '1') { try { fs = await serverStatus(stops.map(s => s.id)) } catch { /* 031 missing / no rights */ } }
      let re = { events: [], reports: [] }
      if (routes?.length && localStorage.getItem('cc_field_033') === '1') { try { re = await serverRouteEvents(routes.map(r => r.id)) } catch { /* 033 missing */ } }
      const t = { routes: routes || [], stops, cases, contacts, prep, fs, re, hours, at: Date.now() }
      setTrip(t); kvSet(key, t) // keep for offline
    } catch (e) {
      const saved = await kvGet(key)
      if (saved) { setTrip(saved); setFromPhone(true) } else setErr(!navigator.onLine ? 'No signal and this day is not saved on the phone yet. Open it once with signal.' : (e.message || String(e)))
    }
  }, [driver, date])
  useEffect(() => { load() }, [load])

  const byCase = useMemo(() => Object.fromEntries((trip?.cases || []).map(c => [c.case_number, c])), [trip])
  const byPos = useMemo(() => Object.fromEntries((trip?.contacts || []).map(c => [c.pos_local_code, c])), [trip])
  const byPrep = useMemo(() => Object.fromEntries((trip?.prep || []).map(p => [p.case_number, p])), [trip])
  const fstate = useMemo(() => mergeState(trip?.fs, pending), [trip, pending])
  const rEvents = useMemo(() => { const ids = new Set((trip?.re?.events || []).map(e => e.id)); return [...(trip?.re?.events || []), ...pendRoute.events.filter(e => !ids.has(e.id))] }, [trip, pendRoute])
  const rReports = useMemo(() => { const ids = new Set((trip?.re?.reports || []).map(e => e.id)); return [...(trip?.re?.reports || []), ...pendRoute.reports.filter(e => !ids.has(e.id))] }, [trip, pendRoute])
  // after something is sent, re-read the server state quietly (keeps the saved copy current too)
  useEffect(() => {
    const h = async () => {
      if (!trip?.stops?.length || !ready) return
      try {
        const fs = await serverStatus(trip.stops.map(s => s.id))
        const re = v033 ? await serverRouteEvents(trip.routes.map(r => r.id)).catch(() => trip.re) : trip.re
        const t = { ...trip, fs, re }; setTrip(t); kvSet(`trip:${driver.username}:${date}`, t)
      } catch { /* offline */ }
    }
    window.addEventListener('cc-queue-sent', h)
    return () => window.removeEventListener('cc-queue-sent', h)
  }, [trip, ready, v033, driver, date])

  const [far, setFar] = useState(null)            // { s, dist, gps } — Arrived far from the store
  // Arrived: check the phone's position against the stop first; far away → ask the driver to confirm (never blocks)
  const arrive = async s => {
    setTapBusy(s.id + 'arrived')
    try {
      const gps = await getGps(8000)
      const c = stopCoords(s), dist = gps && c ? distanceM(gps, c) : null
      if (isFar(dist, gps)) { setFar({ s, dist, gps, why: '' }); return }
      await recordTap(s, driver, 'arrived', { gps }); refreshPending()
    } finally { setTapBusy(null) }
  }
  const confirmFar = async () => {
    const { s, dist, gps, why } = far
    setFar(null)
    await recordTap(s, driver, 'arrived', { gps, note: `Location confirmed by driver: ${fmtDistance(dist)} from the store's map point (GPS ±${gps?.acc ?? '?'} m)${why ? ' · ' + why : ''}` })
    refreshPending()
  }
  const tap = async (s, type, opts) => {
    setTapBusy(s.id + type)
    try { await recordTap(s, driver, type, opts); refreshPending() } finally { setTapBusy(null) }
  }

  useEffect(() => {
    if (!isNative() || !ready || !trip || date !== iso(new Date())) return
    for (const st of trip.stops || []) {
      const f = fstate[st.id]
      const was = planned.current[st.id]
      if (f?.arrived_at && !f.left_at && Date.now() - new Date(f.arrived_at).getTime() < 12 * 3600e3) {
        const at = Math.max(new Date(f.arrived_at).getTime(), +localStorage.getItem(snoozeKey(st.id)) || 0) + LEFT_REMIND_MIN * 60e3
        if (at > Date.now() + 5000 && was !== at) { planned.current[st.id] = at; scheduleLeftReminder(st, at) }
      } else if (was) { delete planned.current[st.id]; cancelLeftReminder(st.id) }
    }
  }, [fstate, trip, ready, date, now])

  if (picking) return <DriverPicker current={driver} onPick={d => { localStorage.setItem('cc_field_driver', JSON.stringify(d)); setDriver(d); setPicking(false) }} onCancel={driver ? () => setPicking(false) : null} />

  const stops = trip?.stops || []
  const isDone = s => fstate[s.id]?.outcome === 'completed' || s.outcome_status === 'solved'
  const isOpenStop = s => !fstate[s.id]?.outcome && s.outcome_status === 'planned'
  const done = stops.filter(isDone).length
  const left = stops.filter(isOpenStop).length
  // the first stop where Arrived was tapped 15+ min ago (or since "still here") and Left is not tapped yet — today only
  const leftDue = (ready && date === iso(new Date()) && !card && !far) ? stops.find(s => {
    const f = fstate[s.id]
    if (!f?.arrived_at || f.left_at) return false
    const arr = new Date(f.arrived_at).getTime()
    if (now - arr > 12 * 3600e3) return false
    const from = Math.max(arr, +localStorage.getItem(snoozeKey(s.id)) || 0)
    return now - from >= LEFT_REMIND_MIN * 60e3
  }) : null
  const dueKey = leftDue ? leftDue.id + ':' + (localStorage.getItem(snoozeKey(leftDue.id)) || '') : ''
  if (dueKey && buzzed.current !== dueKey) { buzzed.current = dueKey; try { navigator.vibrate?.([250, 120, 250]) } catch { /* no vibrate */ } }
  const stillHere = s => { localStorage.setItem(snoozeKey(s.id), String(Date.now())); setNow(Date.now()) }

  return (
    <div className="f-pad">
      <div className="f-card">
        <div className="f-row">
          <div className="f-grow"><strong>🚚 {driver.display}</strong><small>{driver.me ? `${driver.type === 'technician' ? 'Technician' : 'Driver'}${driver.username !== 'me' ? ` · ${driver.username}` : ''}` : `${driver.username} · ${driver.wh?.replace('RTMA ', '')}`}</small></div>
          {!driver.me && <button className="btn btn-ghost btn-sm" onClick={() => setPicking(true)}>Change</button>}
        </div>
        <div className="f-date" style={{ marginTop: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setDate(d => addDays(d, -1))}>‹</button>
          <strong>{date === iso(new Date()) ? 'Today · ' : ''}{fmtDay(date)}</strong>
          <button className="btn btn-ghost btn-sm" onClick={() => setDate(d => addDays(d, 1))}>›</button>
          <button className="btn btn-ghost btn-sm" onClick={load} title="Refresh">↻</button>
        </div>
        {date !== iso(new Date()) && <button className="btn btn-primary btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => setDate(iso(new Date()))}>⏎ Back to today</button>}
        <div>
        </div>
        {fromPhone && <div className="form-msg warn" style={{ marginTop: 8 }}>📵 No signal — showing the copy saved on this phone ({fmtTime(trip.at)}).</div>}
      </div>

      {ready && date === iso(new Date()) && <LocationAsk compact />}
      {err && <div className="form-msg err">{err}</div>}
      {!trip && !err && <div className="load-state"><span className="spinner" /> Loading your trip…</div>}
      {trip && !trip.routes.length && <div className="f-card" style={{ textAlign: 'center', padding: 24 }}><div style={{ fontSize: 30 }}>🛣️</div><p className="text3">{driver.me ? `No route for you on ${fmtDay(date)} yet. Routes appear here once the planner has finalised them and they are linked to you.` : `No route for ${fmtDay(date)}. Routes appear here once they are saved in the routing app.`}</p></div>}


      {trip?.routes.map(r => {
        const rs = stops.filter(s => s.route_id === r.id)
        const rDone = rs.filter(isDone).length
        return (
          <div key={r.id} className="f-card">
            <div className="f-row">
              <div className="f-grow"><strong>{r.route_number}</strong><small>{r.vehicle_code || 'No vehicle'} · start {fmtTime(r.planned_start_at) || '—'} · back {fmtTime(r.planned_return_at) || '—'}{r.planned_distance_km ? ` · ${Math.round(r.planned_distance_km)} km` : ''}</small></div>
              <span className={`tag tag-${r.status === 'completed' ? 'green' : r.status === 'dispatched' || r.status === 'partially_completed' ? 'blue' : 'neutral'}`}>{String(r.status || '').replace(/_/g, ' ')}</span>
            </div>
            {/^TEST-/.test(r.route_number || '') && <div className="f-testroute">🧪 <b>Test route</b> — made on the TEST system only. Real routes come from RouteIQ.</div>}
            <div className="f-progress"><div style={{ width: `${rs.length ? (rDone / rs.length) * 100 : 0}%` }} /></div>
            {v033 && <RouteWarehouse route={r} driver={driver} events={rEvents.filter(e => e.route_id === r.id)} onSaved={refreshPending} />}
            {v033 && <RouteDelay route={r} driver={driver} events={rEvents.filter(e => e.route_id === r.id)} onSaved={refreshPending} />}
            <div className="f-stat"><div><b>{rs.length}</b><small>stops</small></div><div><b>{rDone}</b><small>done</small></div><div><b>{rs.filter(isOpenStop).length}</b><small>to go</small></div></div>
          </div>
        )
      })}

      {stops.map(s => {
        const c = byCase[s.case_number], k = byPos[s.pos_local_code], p = byPrep[s.case_number]
        const oc = OUTCOME[s.outcome_status] || [s.outcome_status, 'neutral']
        const lat = s.use_alternative_address ? s.alternative_latitude : s.latitude, lng = s.use_alternative_address ? s.alternative_longitude : s.longitude
        const addr = s.use_alternative_address ? s.alternative_address : s.address
        const nav = lat && lng ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr || s.point_of_sale)}`
        const phone = k?.mobile_phone || k?.business_phone
        const isOpen = open === s.id
        const f = fstate[s.id] || {}
        // 🕘 store hours: receiving hours for deliveries / replacements / collections, opening hours for repairs
        const kind = windowKind(s.case_type)
        const hrs = trip.hours ? hoursOn(trip.hours.byPos[s.pos_local_code], trip.hours.holidays, date) : null
        const isToday = date === saParts(new Date(now)).date
        const live = hrs && isToday && !f.left_at ? statusAt(hrs, kind, saParts(new Date(now)).minutes) : null
        const planOk = hrs && s.planned_arrival_at ? statusAt(hrs, kind, saParts(s.planned_arrival_at).minutes) : null
        return (
          <div key={s.id} className="f-card">
            <button className="f-row" style={{ width: '100%', background: 'none', border: 0, padding: 0, textAlign: 'left', color: 'inherit', font: 'inherit' }} onClick={() => setOpen(isOpen ? null : s.id)}>
              <span className={`f-seq ${isDone(s) ? 'done' : f.outcome === 'not_completed' || s.outcome_status !== 'planned' ? 'bad' : ''}`}>{s.stop_sequence}</span>
              <div className="f-grow">
                <strong>{s.point_of_sale}</strong>
                <small>{CASE_TYPE_ICON[s.case_type] || '📄'} {s.case_type} · {s.case_number}{s.planned_arrival_at ? ` · ⏰ ${fmtTime(s.planned_arrival_at)}` : ''}</small>
              </div>
              <span className="text3">{isOpen ? '▴' : '▾'}</span>
            </button>
            <div className="f-tags">
              {f.outcome ? <span className={`tag tag-${f.outcome === 'completed' ? 'green' : 'orange'}`}>{TAP_LABEL[f.outcome]}</span>
                : f.arrived_at ? <span className="tag tag-blue">📍 At store {fmtTime(f.arrived_at)}</span>
                : <span className={`tag tag-${oc[1]}`}>{oc[0]}</span>}
              {f.left_at && <span className="tag tag-neutral">🚪 Left {fmtTime(f.left_at)}</span>}
              {f.pending && <span className="tag tag-orange" title="Saved on this phone, waiting for signal">⏳ waiting to send</span>}
              {c && <span className={`tag tag-${statusColor(c.status_reason)}`} title="Live status in COM">COM: {c.status_reason}</span>}
              {c?.sla_status && <span className="tag tag-neutral">{c.sla_status}</span>}
              {s.asset_count > 0 && <span className="tag tag-neutral">❄️ {s.asset_count}</span>}
              {live && live.state !== 'unknown' && <span className={`tag tag-${STATE_TAG[live.state]}`} title={dayText(hrs, kind)}>{STATE_ICON[live.state]} {live.text}</span>}
              {!live && hrs && !hrs.unknown && <span className={`tag tag-${hrs.closed ? 'red' : 'neutral'}`}>🕘 {dayText(hrs, kind)}</span>}
              {planOk && !f.arrived_at && ['before', 'after', 'closed'].includes(planOk.state) && <span className="tag tag-orange" title="The planned arrival time is outside the store's hours">⚠️ Planned ⏰ {fmtTime(s.planned_arrival_at)} is outside {kind === 'receive' ? 'receiving' : 'opening'} hours</span>}
            </div>
            <StopAssets stop={s} prep={p} kase={c} />
            {isOpen && (
              <>
                <div className="f-kv">
                  <span>Address</span><div>{addr || '—'}</div>
                  {hrs && <><span>Hours</span><div>{hrs.unknown ? 'Not captured for this day' : dayText(hrs, kind)}{hrs.note ? ` · ${hrs.note}` : ''}</div></>}
                  {k && <><span>Contact</span><div>{k.customer_contact_name || '—'}{phone ? ` · ${phone}` : ''}</div></>}
                  <span>Due</span><div>{c?.end_date ? new Date(c.end_date).toLocaleDateString('en-ZA') : s.end_date ? new Date(s.end_date).toLocaleDateString('en-ZA') : '—'}</div>
                  {c?.requested_product_base && <><span>Requested</span><div>{c.requested_product_base}</div></>}
                  {s.outcome_recorded_at && <><span>Recorded</span><div>{fmtTime(s.outcome_recorded_at)} · {s.actual_case_status || ''}{s.outcome_reason ? ` · ${s.outcome_reason}` : ''}</div></>}
                  {c?.service_closure_date && <><span>Closed (COM)</span><div>{new Date(c.service_closure_date).toLocaleString('en-ZA')}</div></>}
                </div>
                <div className="f-acts">
                  <a className="btn btn-primary btn-sm" href={nav} target="_blank" rel="noopener noreferrer">🧭 Navigate</a>
                  {phone && <a className="btn btn-ghost btn-sm" href={`tel:${phone}`}>📞 Call</a>}
                  {waNo(k?.customer_whatsapp || k?.mobile_phone) && <a className="btn btn-ghost btn-sm" href={`https://wa.me/${waNo(k?.customer_whatsapp || k?.mobile_phone)}`} target="_blank" rel="noopener noreferrer">💬 WhatsApp</a>}
                  {!ready && <a className="btn btn-ghost btn-sm" href={ROUTING_URL} target="_blank" rel="noopener noreferrer" title="Arrived, outcome, job card — recorded in the routing trip sheet">📝 Record outcome ↗</a>}
                </div>
                {ready && (
                  <div className="f-taps">
                    {!f.arrived_at && <button className="btn btn-primary" disabled={!!tapBusy} onClick={() => arrive(s)}>{tapBusy === s.id + 'arrived' ? '📡 Checking location…' : '📍 Arrived at store'}</button>}
                    {f.arrived_at && !f.outcome && <>
                      <button className="btn btn-primary" onClick={() => setCard({ stop: s, mode: 'completed' })}>📝 Job card — completed</button>
                      <button className="btn btn-ghost" onClick={() => setCard({ stop: s, mode: 'not_completed' })}>⚠️ Not completed — job card</button>
                    </>}
                    {f.outcome && !f.left_at && <button className="btn btn-primary" disabled={!!tapBusy} onClick={() => tap(s, 'left')}>{tapBusy === s.id + 'left' ? '…' : '🚪 Left store'}</button>}
                    {f.outcome && <button className="btn btn-ghost btn-sm" onClick={() => setCard({ stop: s, mode: f.outcome })}>✏️ Redo job card</button>}
                    {v033 && <StopExtras stop={s} driver={driver} contact={k} events={rEvents} reports={rReports} onSaved={refreshPending} />}
                    {f.arrived_at && <small className="text3">📍 {fmtTime(f.arrived_at)}{f.outcome_at ? ` · ${TAP_LABEL[f.outcome]} ${fmtTime(f.outcome_at)}` : ''}{f.reason_code ? ` · ${reasons.find(r => r.code === f.reason_code)?.label || f.reason_code}` : ''}{f.left_at ? ` · 🚪 ${fmtTime(f.left_at)}` : ''}</small>}
                  </div>
                )}
              </>
            )}
          </div>
        )
      })}
      {v033 && trip?.routes.map(r => <RouteWarehouse key={'back' + r.id} where="bottom" route={r} driver={driver} events={rEvents.filter(e => e.route_id === r.id)} onSaved={refreshPending} />)}
      {driver.me && trip && navigator.onLine && <CrewRequests date={date} myRoutes={trip.routes} onChanged={load} />}
      {stops.length > 0 && <p className="text3" style={{ fontSize: 11, textAlign: 'center' }}>{done} done · {left} to go · {ready ? 'Taps and job cards are saved on the phone and sent when there is signal (test system — not sent to RouteIQ yet).' : 'Record arrivals and outcomes in the routing trip sheet'} — COM status updates after the next COM upload.</p>}
      {leftDue && (() => {
        const s = leftDue, f = fstate[s.id] || {}
        const mins = Math.round((now - new Date(f.arrived_at).getTime()) / 60000)
        return (
          <div className="f-sheet" role="dialog" aria-label="Have you left the store?">
            <div className="f-sheet-body">
              <div style={{ fontSize: 34, textAlign: 'center' }}>🚪</div>
              <strong style={{ display: 'block', textAlign: 'center', fontSize: 16 }}>Have you left the store?</strong>
              <p className="text3" style={{ textAlign: 'center', fontSize: 13, margin: '6px 0 12px' }}>{s.point_of_sale}<br />Arrived {fmtTime(f.arrived_at)} · {mins} min ago</p>
              {f.outcome ? (
                <button className="btn btn-primary" style={{ width: '100%', minHeight: 46 }} disabled={!!tapBusy}
                  onClick={() => tap(s, 'left', { note: `Left recorded from the ${LEFT_REMIND_MIN}-minute reminder` })}>{tapBusy === s.id + 'left' ? '📡 Saving…' : "🚪 Yes, I've left — record Left"}</button>
              ) : (
                <>
                  <div className="form-msg warn" style={{ marginBottom: 8 }}>The job card for this stop is not done yet. Do it first, then you can record Left.</div>
                  <button className="btn btn-primary" style={{ width: '100%', minHeight: 46 }} onClick={() => setCard({ stop: s, mode: 'completed' })}>📝 Job card — completed</button>
                  <button className="btn btn-ghost" style={{ width: '100%', marginTop: 6, minHeight: 42 }} onClick={() => setCard({ stop: s, mode: 'not_completed' })}>⚠️ Not completed — job card</button>
                </>
              )}
              <button className="btn btn-ghost" style={{ width: '100%', marginTop: 6, minHeight: 42 }} onClick={() => stillHere(s)}>⏳ No, still at the store — ask again in {LEFT_REMIND_MIN} min</button>
              <p className="text3" style={{ fontSize: 11, textAlign: 'center', marginTop: 6 }}>Your location is saved only with Arrived and Left.</p>
            </div>
          </div>
        )
      })()}
      {far && (
        <div className="f-sheet" role="dialog" aria-label="Check location">
          <div className="f-sheet-body">
            <div style={{ fontSize: 34, textAlign: 'center' }}>📍</div>
            <strong style={{ display: 'block', textAlign: 'center', fontSize: 16 }}>You are {fmtDistance(far.dist)} from this store</strong>
            <p className="text3" style={{ textAlign: 'center', fontSize: 13, margin: '6px 0 12px' }}>{far.s.point_of_sale}<br />Are you at the correct store?</p>
            <div className="field-lbl">Why is it different? (optional)</div>
            <div className="f-chips">{["I'm at the store — map point is wrong", 'Different entrance / in a mall', 'Delivering at another branch on instruction', 'Weak GPS signal'].map(w => (
              <button key={w} className={far.why === w ? 'on' : ''} onClick={() => setFar(f => ({ ...f, why: f.why === w ? '' : w }))}>{w}</button>
            ))}</div>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 12, minHeight: 46 }} onClick={confirmFar}>✓ Yes, I'm at the store — record Arrived</button>
            {stopCoords(far.s) && <a className="btn btn-ghost" style={{ width: '100%', marginTop: 6, minHeight: 42, justifyContent: 'center' }} href={`https://www.google.com/maps/dir/?api=1&destination=${stopCoords(far.s).lat},${stopCoords(far.s).lng}`} target="_blank" rel="noopener noreferrer">🧭 Navigate to the store</a>}
            <button className="btn btn-ghost" style={{ width: '100%', marginTop: 6, minHeight: 42 }} onClick={() => setFar(null)}>Cancel — not there yet</button>
            <p className="text3" style={{ fontSize: 11, textAlign: 'center', marginTop: 6 }}>Your answer and the distance are saved with the visit for the office.</p>
          </div>
        </div>
      )}
      {card && (() => {
        const s = card.stop, p = byPrep[s.case_number], c = byCase[s.case_number]
        return <FieldJobCard stop={s} driver={driver} mode={card.mode} prep={p} kase={c} contact={byPos[s.pos_local_code]}
          onCancel={() => setCard(null)} onDone={() => { setCard(null); refreshPending() }} />
      })()}
    </div>
  )
}

function DriverPicker({ current, onPick, onCancel }) {
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    cachedQuery('drivers', () => supabase.from('routing_portal_users').select('portal_username,display_name,worker_type,warehouse_group')
      .eq('is_active', true).in('worker_type', ['driver', 'technician']).order('warehouse_group').order('display_name')).then(setList)
  }, [])
  const s = q.trim().toLowerCase()
  const rows = (list || []).filter(d => !s || [d.portal_username, d.display_name, d.warehouse_group].some(v => (v || '').toLowerCase().includes(s)))
  const groups = [...new Set(rows.map(d => d.warehouse_group))]
  return (
    <div className="f-pad">
      <div className="f-card">
        <strong>🚚 Who is driving?</strong>
        <p className="text3" style={{ fontSize: 12, margin: '4px 0 8px' }}>Choose your routing-app name once — this phone remembers it.</p>
        <input className="field-ctrl" placeholder="Search name, username or warehouse…" value={q} onChange={e => setQ(e.target.value)} />
        {onCancel && <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={onCancel}>Cancel</button>}
      </div>
      {!list ? <div className="load-state"><span className="spinner" /></div> : groups.map(g => (
        <div key={g}>
          <div className="field-lbl" style={{ margin: '10px 2px 6px' }}>{g}</div>
          {rows.filter(d => d.warehouse_group === g).map(d => (
            <button key={d.portal_username} className="f-list-btn" style={current?.username === d.portal_username ? { borderColor: 'var(--accent)' } : null}
              onClick={() => onPick({ username: d.portal_username, display: d.display_name, wh: d.warehouse_group, type: d.worker_type })}>
              {d.worker_type === 'technician' ? '🛠' : '🚚'} <b>{d.display_name}</b> <span className="text3" style={{ fontSize: 11 }}>· {d.portal_username}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
