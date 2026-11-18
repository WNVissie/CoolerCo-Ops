import { useState, useEffect, useMemo } from 'react'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { num, WH_NAMES, whCaseName, CASE_TYPE_ICON } from '../lib/helpers'
import { checkRoute, fromRouteIQ, fromField, km, LIMITS, ROAD_FACTOR } from '../lib/tripCheck'
import { loadHours, hoursOn, windowKind, statusAt, dayText, saParts } from '../lib/posHours'

// 📏 Trip check — what the Arrived / Left GPS tells us, per route and per driver (no tracking).
// Sources: 🛣 RouteIQ WhatsApp trip sheet + 📲 CoolerCo Field app. Read only, calculated in the browser
// (one day at a time is small: a few hundred taps), so no database change is needed.
const ROUTE_EVENTS = ['driver_arrived', 'driver_left_pos', 'driver_left_warehouse', 'driver_returned_warehouse', 'driver_delay_reported']
const iso = d => d.toLocaleDateString('en-CA')
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d) }
const hm = s => (s ? new Date(s).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' }) : '—')
const kmTxt = n => (n == null ? '—' : `${n.toLocaleString('en-ZA', { maximumFractionDigits: 1 })} km`)
const chunks = (a, n = 150) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
const LEVEL = { bad: 'red', warn: 'orange', info: 'neutral' }

// Supabase returns at most 1,000 rows per call → read page by page
async function all(make) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) return out
  }
}
async function inChunks(ids, make) { return (await Promise.all(chunks(ids).map(c => all(() => make(c))))).flat() }

export default function TripCheck() {
  const [date, setDate] = useState(() => iso(new Date()))
  const [wh, setWh] = useState(() => localStorage.getItem('cc_tripcheck_wh') || '')
  const [q, setQ] = useState('')
  const [onlyFlags, setOnlyFlags] = useState(false)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState({})
  const [tick, setTick] = useState(0)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => { localStorage.setItem('cc_tripcheck_wh', wh) }, [wh])
  useEffect(() => {
    let live = true
    setData(null); setErr(null)
    ;(async () => {
      let rq = () => supabase.from('routing_routes').select('id,route_number,route_date,status,warehouse_group,resource_username,resource_display_name,vehicle_code,planned_distance_km')
        .eq('route_date', date).not('status', 'in', '(not_used,cancelled)').order('route_number')
      if (wh) { const base = rq; rq = () => base().eq('warehouse_group', whCaseName(wh)) }
      const routes = await all(rq)
      const ids = routes.map(r => r.id)
      if (!ids.length) return { routes: [], results: [] }
      // parallel: current versions → stops · RouteIQ taps · Field app taps (tables may not exist → ignored)
      const [vers, rEv, fStop, fRoute] = await Promise.all([
        inChunks(ids, c => supabase.from('routing_route_versions').select('id,route_id').in('route_id', c).eq('is_current', true)),
        inChunks(ids, c => supabase.from('routing_route_events').select('route_id,route_stop_id,event_type,created_at,reason,metadata').in('route_id', c).in('event_type', ROUTE_EVENTS)),
        inChunks(ids, c => supabase.from('coolerco_field_stop_events').select('route_id,stop_id,event_type,occurred_at,latitude,longitude,accuracy_m,note').in('route_id', c)).catch(() => []),
        inChunks(ids, c => supabase.from('coolerco_field_route_events').select('route_id,stop_id,event_type,delay_type,reason,note,occurred_at,latitude,longitude,accuracy_m').in('route_id', c)).catch(() => []),
      ])
      const stops = await inChunks(vers.map(v => v.id), c => supabase.from('routing_route_stops')
        .select('id,route_id,stop_sequence,case_number,case_type,point_of_sale,pos_local_code,latitude,longitude,use_alternative_address,alternative_latitude,alternative_longitude,planned_leg_distance_km,planned_arrival_at')
        .in('route_version_id', c))
      const events = [...fromRouteIQ(rEv), ...fromField(fStop, fRoute)]
      // 🕘 store hours (036): arrival outside receiving hours (deliver / replace / collect) or opening hours (repairs)
      const hrs = await loadHours(stops.map(s => s.pos_local_code), { from: date, to: date }).catch(() => null)
      const hoursCheck = hrs?.ready ? (v, at) => {
        const h = hoursOn(hrs.byPos[v.pos], hrs.holidays, saParts(at).date)
        if (!h || h.unknown) return null
        const kind = v.case_types.some(t => windowKind(t) === 'receive') ? 'receive' : 'open'
        const st = statusAt(h, kind, saParts(at).minutes)
        return ['before', 'after', 'closed'].includes(st.state) ? { level: 'warn', text: `Arrived outside ${kind === 'receive' ? 'receiving' : 'opening'} hours (${dayText(h, kind)})` } : null
      } : null
      const results = routes.map(r => checkRoute(r, stops.filter(s => s.route_id === r.id), events, hoursCheck))
      return { routes, results }
    })().then(d => live && setData(d)).catch(e => live && setErr(e.message || String(e)))
    return () => { live = false }
  }, [date, wh, tick])

  const s = q.trim().toLowerCase()
  const list = useMemo(() => (data?.results || [])
    .filter(x => x.summary.taps > 0 || !onlyFlags)
    .filter(x => !onlyFlags || x.summary.warn > 0)
    .filter(x => !s || [x.route.route_number, x.route.resource_display_name, x.route.vehicle_code, ...x.visits.map(v => v.store)].some(v => String(v || '').toLowerCase().includes(s))), [data, onlyFlags, s])
  const withTaps = list.filter(x => x.summary.taps > 0)

  const tot = useMemo(() => {
    const L = list.map(x => x.summary)
    const sum = k => L.reduce((a, b) => a + (b[k] || 0), 0)
    const dw = list.flatMap(x => x.visits.map(v => v.dwell_min).filter(v => v != null))
    return {
      routes: list.length, tapped: withTaps.length, visited: sum('stores_visited'), planned: sum('stores_planned'),
      est: Math.round(sum('comparable_est_km') * 10) / 10, plan: Math.round(sum('comparable_planned_km') * 10) / 10,
      legs: sum('legs_measured'), unreliable: sum('legs_unreliable'), warn: sum('warn'),
      dwell: dw.length ? Math.round(dw.reduce((a, b) => a + b, 0) / dw.length) : null,
    }
  }, [list, withTaps])

  // per driver (the routed resource — RouteIQ name)
  const drivers = useMemo(() => {
    const m = {}
    for (const x of withTaps) {
      const k = x.route.resource_display_name || x.route.resource_username || '—'
      const d = (m[k] ||= { name: k, routes: 0, visited: 0, planned: 0, est: 0, plan: 0, legs: 0, warn: 0, dwell: [] })
      d.routes++; d.visited += x.summary.stores_visited; d.planned += x.summary.stores_planned
      d.est += x.summary.comparable_est_km || 0; d.plan += x.summary.comparable_planned_km || 0
      d.legs += x.summary.legs_measured; d.warn += x.summary.warn
      d.dwell.push(...x.visits.map(v => v.dwell_min).filter(v => v != null))
    }
    return Object.values(m).sort((a, b) => b.warn - a.warn || a.name.localeCompare(b.name))
  }, [withTaps])

  async function exportXlsx() {
    const XLSX = await import('xlsx')
    const legs = list.flatMap(x => x.legs.map(l => ({
      Date: date, Route: x.route.route_number, Driver: x.route.resource_display_name, Vehicle: x.route.vehicle_code,
      From: l.from_label, To: l.to.store, 'Left at': hm(l.from_at), 'Arrived at': hm(l.to.arrived_at), Status: l.status,
      'Straight km': l.straight_km, [`Est. road km (×${ROAD_FACTOR})`]: l.est_km, 'Planned leg km': l.planned_km, Minutes: l.minutes, 'km/h': l.kmh,
      'Counted in totals': l.status === 'Measured' ? (l.reliable ? 'Yes' : 'No — tap away from store') : 'No',
      Flags: l.flags.map(f => f.text).join(' · '),
    })))
    const visits = list.flatMap(x => x.visits.map(v => ({
      Date: date, Route: x.route.route_number, Driver: x.route.resource_display_name, 'Planned store no.': v.planned_visit, Store: v.store, 'POS code': v.pos,
      Cases: v.cases.join(', '), 'Case types': v.case_types.join(', '), 'Planned arrival': hm(v.planned_arrival_at), Arrived: hm(v.arrived_at), Left: hm(v.left_at),
      'Minutes at store': v.dwell_min, 'Arrived — m from store': v.arr_from_store_m, 'Left — m from store': v.left_from_store_m, Source: v.source,
      Flags: v.flags.map(f => f.text).join(' · '),
    })))
    const drv = drivers.map(d => ({ Date: date, Driver: d.name, Routes: d.routes, 'Stores visited': d.visited, 'Stores planned': d.planned,
      'Est. km (counted legs)': Math.round(d.est * 10) / 10, 'Planned km (same legs)': Math.round(d.plan * 10) / 10, 'Legs counted': d.legs,
      'Avg minutes at store': d.dwell.length ? Math.round(d.dwell.reduce((a, b) => a + b, 0) / d.dwell.length) : null, Flags: d.warn }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(drv), 'By driver')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(legs), 'Legs')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(visits), 'Store visits')
    XLSX.writeFile(wb, `CoolerCo_Trip_check_${date}_${wh || 'ALL'}.xlsx`)
  }

  return (
    <>
      <Topbar title="Trip check" sub="Estimated from the GPS at Arrived and Left — no tracking"
        actions={<>
          <button className="btn btn-ghost btn-sm" disabled={!list.length} onClick={exportXlsx}>⬇ Excel</button>
          <button className="btn btn-ghost btn-sm" disabled={!data} onClick={() => setTick(n => n + 1)}>↻</button>
        </>} />
      <div className="page-content">
        <div className="filters" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setDate(d => addDays(d, -1))} aria-label="Previous day">‹</button>
          <input type="date" className="field-ctrl" style={{ width: 'auto' }} value={date} onChange={e => e.target.value && setDate(e.target.value)} />
          <button className="btn btn-ghost btn-sm" onClick={() => setDate(d => addDays(d, 1))} aria-label="Next day">›</button>
          <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => setWh(e.target.value)} aria-label="Warehouse">
            <option value="">🏢 All warehouses</option>
            {Object.entries(WH_NAMES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
          <div className="search-wrap" style={{ flex: 1, minWidth: 160 }}><span className="ico">🔍</span>
            <input placeholder="Route, driver, vehicle, store…" value={q} onChange={e => setQ(e.target.value)} /></div>
          <label className="text3" style={{ fontSize: 11.5, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={onlyFlags} onChange={e => setOnlyFlags(e.target.checked)} /> ⚠️ Only routes with flags</label>
        </div>
        {err && <div className="form-msg err">{err}</div>}

        <div className="stats-row">
          <div className="stat-card"><div className="stat-label">🛣 Routes with taps</div><div className="stat-value">{data ? `${num(tot.tapped)}/${num(tot.routes)}` : '…'}</div><div className="stat-sub">{num(tot.visited)} of {num(tot.planned)} stores visited</div></div>
          <div className="stat-card"><div className="stat-label">📏 Est. km (counted legs)</div><div className="stat-value">{data ? kmTxt(tot.est) : '…'}</div><div className="stat-sub">planned {kmTxt(tot.plan)} for the same {num(tot.legs)} legs{tot.unreliable ? ` · ${tot.unreliable} not counted` : ''}</div></div>
          <div className="stat-card"><div className="stat-label">⏱ Avg time at a store</div><div className="stat-value">{tot.dwell != null ? `${tot.dwell} min` : '—'}</div><div className="stat-sub">Arrived → Left, same day</div></div>
          <div className={`stat-card ${tot.warn ? 'c-red' : 'c-green'}`}><div className="stat-label">⚠️ Flags</div><div className="stat-value">{data ? num(tot.warn) : '…'}</div><div className="stat-sub">far from store · slow / impossible legs · late or quick taps</div></div>
        </div>

        <div className="card" style={{ marginBottom: 12 }}>
          <button className="card-header" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', font: 'inherit', color: 'inherit' }} onClick={() => setShowHelp(v => !v)}>
            <span className="card-title">ℹ️ How this is measured</span><span className="text3" style={{ marginLeft: 'auto' }}>{showHelp ? '▴' : '▾'}</span>
          </button>
          {showHelp && <div style={{ padding: '4px 14px 12px', fontSize: 12, lineHeight: 1.5 }}>
            Like warehouse scans at key steps, the phone saves its position only when the driver taps <b>📍 Arrived</b> and <b>🚪 Left</b> (RouteIQ trip sheet 🛣 or CoolerCo Field app 📲).
            A <b>leg</b> runs from Left at one store to Arrived at the next: straight-line distance × {ROAD_FACTOR} for roads (the same factor RouteIQ's capacity model uses).
            It does <b>not</b> show the road driven, detours or stops in between. Legs where a tap was made more than {LIMITS.unreliableM / 1000} km from its store are shown but <b>not counted</b> in the km.
            <br />Flags: arrived outside the store's receiving / opening hours (🕘 Store hours) · tap more than {LIMITS.farM} m (+ GPS uncertainty) from the store's map point · leg slower than {LIMITS.slowKmh} km/h and at least {LIMITS.slowMinMinutes} min (no delay reported) · faster than {LIMITS.fastKmh} km/h (a tap was not made at the store) · Arrived and Left within 2 min · Left on a later day · out of planned order.
            Several cases at one store count as one visit. The warehouse legs need GPS on Start at WH / Returned (Field app only).
            If several drivers are flagged at the same store, its map point is probably wrong.
          </div>}
        </div>

        {drivers.length > 0 && (
          <details className="card" style={{ marginBottom: 12 }}>
            <summary className="card-header" style={{ cursor: 'pointer' }}><span className="card-title">👤 By driver</span><span className="card-count">{drivers.length}</span></summary>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Driver</th><th>Routes</th><th>Stores</th><th>Est. km</th><th>Planned km (same legs)</th><th>Avg at store</th><th>Flags</th></tr></thead>
              <tbody>{drivers.map(d => (
                <tr key={d.name}><td>{d.name}</td><td>{d.routes}</td><td>{d.visited}/{d.planned}</td><td>{kmTxt(Math.round(d.est * 10) / 10)}</td><td>{kmTxt(Math.round(d.plan * 10) / 10)}</td>
                  <td>{d.dwell.length ? `${Math.round(d.dwell.reduce((a, b) => a + b, 0) / d.dwell.length)} min` : '—'}</td>
                  <td>{d.warn ? <span className="tag tag-orange">⚠️ {d.warn}</span> : <span className="tag tag-green">✓</span>}</td></tr>))}</tbody>
            </table></div>
          </details>
        )}

        {!data && !err && <div className="load-state"><span className="spinner" /> Reading taps…</div>}
        {data && !list.length && <div className="empty-state"><div className="empty-ico">🛣️</div><div>No routes{onlyFlags ? ' with flags' : ''} for this day{wh ? ` in ${WH_NAMES[wh]}` : ''}.</div></div>}

        {list.map(x => {
          const r = x.route, sm = x.summary, isOpen = !!open[r.id]
          return (
            <div key={r.id} className="card" style={{ marginBottom: 10 }}>
              <button className="card-header" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', flexWrap: 'wrap', gap: 6, textAlign: 'left' }}
                onClick={() => setOpen(o => ({ ...o, [r.id]: !isOpen }))} aria-expanded={isOpen}>
                <span className="card-title">{r.route_number}</span>
                <span className="text3" style={{ fontSize: 11.5 }}>{r.resource_display_name || '—'}{r.vehicle_code ? ` · ${r.vehicle_code}` : ''}</span>
                {sm.sources.map(src => <span key={src} className="tag tag-neutral">{src === 'RouteIQ' ? '🛣 RouteIQ' : '📲 Field app'}</span>)}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="tag tag-blue">🏪 {sm.stores_visited}/{sm.stores_planned}</span>
                  {sm.comparable_est_km != null && <span className="tag tag-neutral" title="Counted legs vs the planned km of the same legs">📏 {kmTxt(sm.comparable_est_km)} · plan {kmTxt(sm.comparable_planned_km)}</span>}
                  {sm.avg_dwell_min != null && <span className="tag tag-neutral">⏱ {sm.avg_dwell_min} min/store</span>}
                  {!sm.taps ? <span className="tag tag-neutral">no taps</span> : sm.warn ? <span className="tag tag-orange">⚠️ {sm.warn}</span> : <span className="tag tag-green">✓ no flags</span>}
                  <span className="text3">{isOpen ? '▴' : '▾'}</span>
                </span>
              </button>
              {isOpen && <RouteDetail x={x} />}
            </div>
          )
        })}
        <div className="text3" style={{ fontSize: 10.5, marginTop: 8 }}>
          Planned route km (whole route, incl. warehouse legs) is in RouteIQ; here only legs that were both planned in that order and measured are compared. Times in SAST.
        </div>
      </div>
    </>
  )
}

function Flags({ flags }) {
  if (!flags?.length) return null
  return <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>{flags.map((f, i) => <span key={i} className={`tag tag-${LEVEL[f.level]}`} style={{ fontSize: 10.5 }}>{f.level === 'info' ? 'ℹ️' : '⚠️'} {f.text}</span>)}</div>
}

function RouteDetail({ x }) {
  const legTo = new Map(x.legs.filter(l => l.kind !== 'return').map(l => [l.to, l]))
  const back = x.legs.find(l => l.kind === 'return')
  const done = x.visits.filter(v => v.arrived_at), notDone = x.visits.filter(v => !v.arrived_at)
  const mapUrl = v => (v.point ? `https://www.google.com/maps/dir/?api=1&destination=${v.point.lat},${v.point.lng}` : null)
  const gpsUrl = g => (g ? `https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}` : null)
  return (
    <div style={{ padding: '4px 12px 12px' }}>
      {!done.length && <div className="text3" style={{ fontSize: 12, padding: 8 }}>No Arrived taps on this route yet.</div>}
      {done.map(v => {
        const l = legTo.get(v)
        return (
          <div key={v.stop_ids[0]}>
            {l && <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0 6px 18px', borderLeft: '2px dashed var(--border)', marginLeft: 10, fontSize: 11.5 }}>
              <span>🚚</span>
              <div style={{ flex: 1 }}>
                {l.status === 'Measured'
                  ? <><b>{kmTxt(l.est_km)}</b> <span className="text3">({kmTxt(l.straight_km)} straight)</span> · {l.minutes} min · {l.kmh} km/h{l.planned_km != null ? <> · <span className="text3">planned {kmTxt(l.planned_km)}</span></> : null}</>
                  : <span className="text3">{l.status}</span>}
                <Flags flags={l.flags} />
              </div>
            </div>}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
              <span className="tag tag-blue" title="Planned store number" style={{ minWidth: 26, justifyContent: 'center' }}>{v.planned_visit}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{v.store}</div>
                <div className="text3" style={{ fontSize: 11 }}>{v.case_types.map(t => `${CASE_TYPE_ICON[t] || '•'} ${t}`).join(' · ')} · {v.cases.join(', ')}</div>
                <div style={{ fontSize: 11.5, marginTop: 3 }}>
                  📍 {hm(v.arrived_at)}{v.arr_from_store_m != null && <> <a className="text3" href={gpsUrl(v.arr_gps)} target="_blank" rel="noopener noreferrer">({km(v.arr_from_store_m)} from store)</a></>}
                  {' → '}🚪 {hm(v.left_at)}{v.left_from_store_m != null && <> <a className="text3" href={gpsUrl(v.left_gps)} target="_blank" rel="noopener noreferrer">({km(v.left_from_store_m)} from store)</a></>}
                  {v.dwell_min != null && <> · ⏱ <b>{v.dwell_min} min</b></>}
                  {v.planned_arrival_at && <span className="text3"> · planned {hm(v.planned_arrival_at)}</span>}
                  {mapUrl(v) && <> · <a href={mapUrl(v)} target="_blank" rel="noopener noreferrer">store map point ↗</a></>}
                  {v.source && <span className="text3"> · {v.source}</span>}
                </div>
                <Flags flags={v.flags} />
              </div>
            </div>
          </div>
        )
      })}
      {back && <div style={{ fontSize: 11.5, padding: '6px 0', borderTop: '1px solid var(--border)' }}>🏭 Back at warehouse {hm(back.to.arrived_at)} · {kmTxt(back.est_km)} · {back.minutes} min</div>}
      {notDone.length > 0 && <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 11.5 }}>
        <span className="text3">Not tapped:</span> {notDone.map(v => <span key={v.stop_ids[0]} className="tag tag-neutral" style={{ marginRight: 4 }}>{v.planned_visit}. {v.store}</span>)}
      </div>}
    </div>
  )
}
