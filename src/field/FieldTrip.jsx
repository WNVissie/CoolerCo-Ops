import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { statusColor, CASE_TYPE_ICON } from '../lib/helpers'
import { cachedQuery, kvGet, kvSet } from '../lib/offline'

// My trip — read view of the routing app's route for this driver (planned + finalised in the routing app).
// Live case status from COM, routing outcome, warehouse prep, assets. Outcomes are recorded in the routing
// app's trip sheet (its own server logic keeps routes, carry-overs and history correct).
const ROUTING_URL = 'https://smartroutertma.netlify.app/'
const OUTCOME = {
  planned: ['Planned', 'blue'], solved: ['✅ Done', 'green'], carried_over: ['↪ Carried over', 'orange'],
  cancelled: ['🚫 Cancelled', 'neutral'], removed: ['Removed', 'neutral'], awaiting_third_party_update: ['⏳ Awaiting update', 'orange'],
}
const iso = d => d.toISOString().slice(0, 10)
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d) }
const fmtDay = s => new Date(s + 'T12:00:00').toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })
const fmtTime = t => (t ? new Date(t).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '')
const waNo = n => { const d = String(n || '').replace(/\D/g, ''); return !d ? '' : d.startsWith('0') ? '27' + d.slice(1) : d }

export default function FieldTrip() {
  const [driver, setDriver] = useState(() => { try { return JSON.parse(localStorage.getItem('cc_field_driver')) } catch { return null } })
  const [picking, setPicking] = useState(!driver)
  const [date, setDate] = useState(() => iso(new Date()))
  const [trip, setTrip] = useState(null)
  const [err, setErr] = useState(null)
  const [fromPhone, setFromPhone] = useState(false)
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    if (!driver) return
    setTrip(null); setErr(null); setFromPhone(false)
    const key = `trip:${driver.username}:${date}`
    try {
      if (!navigator.onLine) throw new Error('offline')
      const { data: routes, error } = await supabase.from('routing_routes')
        .select('id,route_number,route_date,status,vehicle_code,warehouse_group,planned_start_at,planned_return_at,planned_distance_km,dispatched_at,completed_at')
        .eq('resource_username', driver.username).eq('route_date', date).neq('status', 'not_used').order('route_number')
      if (error) throw error
      let stops = [], cases = [], contacts = [], prep = []
      if (routes?.length) {
        const { data: vers } = await supabase.from('routing_route_versions').select('id,route_id').in('route_id', routes.map(r => r.id)).eq('is_current', true)
        const { data: st } = await supabase.from('routing_route_stops')
          .select('id,route_id,stop_sequence,case_number,case_type,point_of_sale,pos_local_code,address,latitude,longitude,use_alternative_address,alternative_address,alternative_latitude,alternative_longitude,asset_barcodes,asset_product_bases,asset_count,planned_arrival_at,end_date,outcome_status,actual_case_status,outcome_recorded_at,outcome_reason')
          .in('route_version_id', (vers || []).map(v => v.id)).order('stop_sequence')
        stops = st || []
        const caseNos = [...new Set(stops.map(s => s.case_number).filter(Boolean))]
        const posCodes = [...new Set(stops.map(s => s.pos_local_code).filter(Boolean))]
        // parallel: live COM status, store contacts, warehouse prep
        const [c, k, p] = await Promise.all([
          caseNos.length ? supabase.from('cases').select('case_number,status_reason,sla_status,end_date,service_closure_date,motive,requested_product_base,asset_delivered,asset_removed,asset_repaired').in('case_number', caseNos) : { data: [] },
          posCodes.length ? supabase.from('routing_pos_contacts').select('pos_local_code,customer_contact_name,mobile_phone,business_phone,customer_whatsapp').in('pos_local_code', posCodes) : { data: [] },
          supabase.rpc('coolerco_picking_queue', { p_from: date, p_warehouse: routes[0].warehouse_group }),
        ])
        cases = c.data || []; contacts = k.data || []
        const ids = new Set(routes.map(r => r.id)); prep = (p.data || []).filter(x => ids.has(x.route_id))
      }
      const t = { routes: routes || [], stops, cases, contacts, prep, at: Date.now() }
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

  if (picking) return <DriverPicker current={driver} onPick={d => { localStorage.setItem('cc_field_driver', JSON.stringify(d)); setDriver(d); setPicking(false) }} onCancel={driver ? () => setPicking(false) : null} />

  const stops = trip?.stops || []
  const done = stops.filter(s => s.outcome_status === 'solved').length
  const left = stops.filter(s => s.outcome_status === 'planned').length

  return (
    <div className="f-pad">
      <div className="f-card">
        <div className="f-row">
          <div className="f-grow"><strong>🚚 {driver.display}</strong><small>{driver.username} · {driver.wh?.replace('RTMA ', '')}</small></div>
          <button className="btn btn-ghost btn-sm" onClick={() => setPicking(true)}>Change</button>
        </div>
        <div className="f-date" style={{ marginTop: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setDate(d => addDays(d, -1))}>‹</button>
          <strong>{date === iso(new Date()) ? 'Today · ' : ''}{fmtDay(date)}</strong>
          <button className="btn btn-ghost btn-sm" onClick={() => setDate(d => addDays(d, 1))}>›</button>
          <button className="btn btn-ghost btn-sm" onClick={load} title="Refresh">↻</button>
        </div>
        {fromPhone && <div className="form-msg warn" style={{ marginTop: 8 }}>📵 No signal — showing the copy saved on this phone ({fmtTime(trip.at)}).</div>}
      </div>

      {err && <div className="form-msg err">{err}</div>}
      {!trip && !err && <div className="load-state"><span className="spinner" /> Loading your trip…</div>}
      {trip && !trip.routes.length && <div className="f-card" style={{ textAlign: 'center', padding: 24 }}><div style={{ fontSize: 30 }}>🛣️</div><p className="text3">No route for {fmtDay(date)}. Routes appear here once they are saved in the routing app.</p></div>}

      {trip?.routes.map(r => {
        const rs = stops.filter(s => s.route_id === r.id)
        const rDone = rs.filter(s => s.outcome_status === 'solved').length
        return (
          <div key={r.id} className="f-card">
            <div className="f-row">
              <div className="f-grow"><strong>{r.route_number}</strong><small>{r.vehicle_code || 'No vehicle'} · start {fmtTime(r.planned_start_at) || '—'} · back {fmtTime(r.planned_return_at) || '—'}{r.planned_distance_km ? ` · ${Math.round(r.planned_distance_km)} km` : ''}</small></div>
              <span className={`tag tag-${r.status === 'completed' ? 'green' : r.status === 'dispatched' || r.status === 'partially_completed' ? 'blue' : 'neutral'}`}>{String(r.status || '').replace(/_/g, ' ')}</span>
            </div>
            <div className="f-progress"><div style={{ width: `${rs.length ? (rDone / rs.length) * 100 : 0}%` }} /></div>
            <div className="f-stat"><div><b>{rs.length}</b><small>stops</small></div><div><b>{rDone}</b><small>done</small></div><div><b>{rs.filter(s => s.outcome_status === 'planned').length}</b><small>to go</small></div></div>
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
        return (
          <div key={s.id} className="f-card">
            <button className="f-row" style={{ width: '100%', background: 'none', border: 0, padding: 0, textAlign: 'left', color: 'inherit', font: 'inherit' }} onClick={() => setOpen(isOpen ? null : s.id)}>
              <span className={`f-seq ${s.outcome_status === 'solved' ? 'done' : s.outcome_status !== 'planned' ? 'bad' : ''}`}>{s.stop_sequence}</span>
              <div className="f-grow">
                <strong>{s.point_of_sale}</strong>
                <small>{CASE_TYPE_ICON[s.case_type] || '📄'} {s.case_type} · {s.case_number}{s.planned_arrival_at ? ` · ⏰ ${fmtTime(s.planned_arrival_at)}` : ''}</small>
              </div>
              <span className="text3">{isOpen ? '▴' : '▾'}</span>
            </button>
            <div className="f-tags">
              <span className={`tag tag-${oc[1]}`}>{oc[0]}</span>
              {c && <span className={`tag tag-${statusColor(c.status_reason)}`} title="Live status in COM">COM: {c.status_reason}</span>}
              {c?.sla_status && <span className="tag tag-neutral">{c.sla_status}</span>}
              {s.asset_count > 0 && <span className="tag tag-neutral">❄️ {s.asset_count}</span>}
            </div>
            {p && (
              <div className="f-prep">
                <span className={p.picked ? 'ok' : ''}>{p.picked ? '✓' : '○'} Picked</span>
                <span className={p.rtw ? 'ok' : ''}>{p.rtw ? '✓' : '○'} RTW</span>
                <span className={p.packed ? 'ok' : ''}>{p.packed ? '✓' : '○'} Packed</span>
                {p.selected_bar_code && <span className="ok">🏷 {p.selected_bar_code}</span>}
              </div>
            )}
            {isOpen && (
              <>
                <div className="f-kv">
                  <span>Address</span><div>{addr || '—'}</div>
                  {k && <><span>Contact</span><div>{k.customer_contact_name || '—'}{phone ? ` · ${phone}` : ''}</div></>}
                  <span>Due</span><div>{c?.end_date ? new Date(c.end_date).toLocaleDateString('en-ZA') : s.end_date ? new Date(s.end_date).toLocaleDateString('en-ZA') : '—'}</div>
                  {(s.asset_barcodes || []).length > 0 && <><span>Assets</span><div className="mono" style={{ fontSize: 11.5 }}>{(s.asset_barcodes || []).map((b, i) => <div key={i}>{b}{s.asset_product_bases?.[i] ? ` · ${s.asset_product_bases[i]}` : ''}</div>)}</div></>}
                  {c?.requested_product_base && <><span>Requested</span><div>{c.requested_product_base}</div></>}
                  {s.outcome_recorded_at && <><span>Recorded</span><div>{fmtTime(s.outcome_recorded_at)} · {s.actual_case_status || ''}{s.outcome_reason ? ` · ${s.outcome_reason}` : ''}</div></>}
                  {c?.service_closure_date && <><span>Closed (COM)</span><div>{new Date(c.service_closure_date).toLocaleString('en-ZA')}</div></>}
                </div>
                <div className="f-acts">
                  <a className="btn btn-primary btn-sm" href={nav} target="_blank" rel="noopener noreferrer">🧭 Navigate</a>
                  {phone && <a className="btn btn-ghost btn-sm" href={`tel:${phone}`}>📞 Call</a>}
                  {waNo(k?.customer_whatsapp || k?.mobile_phone) && <a className="btn btn-ghost btn-sm" href={`https://wa.me/${waNo(k?.customer_whatsapp || k?.mobile_phone)}`} target="_blank" rel="noopener noreferrer">💬 WhatsApp</a>}
                  <a className="btn btn-ghost btn-sm" href={ROUTING_URL} target="_blank" rel="noopener noreferrer" title="Arrived, outcome, job card — recorded in the routing trip sheet">📝 Record outcome ↗</a>
                </div>
              </>
            )}
          </div>
        )
      })}
      {stops.length > 0 && <p className="text3" style={{ fontSize: 11, textAlign: 'center' }}>{done} done · {left} to go · Record arrivals and outcomes in the routing trip sheet — COM status updates after the next COM upload.</p>}
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
