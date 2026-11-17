import { useState, useEffect, useCallback } from 'react'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { WH_NAMES } from '../lib/helpers'

// 🧪 Test routes (script 035) — TEST database only.
//   RouteIQ (the routing app) makes the real routes on PRODUCTION and only knows COM cases. To test the whole field flow
//   with Tiger / CoolerCo cases, a supervisor builds a test route here: date + driver slot + cases in visiting order.
//   The route then shows in the driver's Field app (My trip) with a 🧪 Test route banner. Production will use RouteIQ.
const iso = d => d.toLocaleDateString('en-CA')
const WHS = Object.keys(WH_NAMES)
const friendly = e => (/does not exist|Could not find|PGRST202/i.test(e?.message || '') ? 'This screen needs database script 035 (and 034) — not applied on this database yet.' : e?.message)

export default function TestRoutes() {
  const [wh, setWh] = useState(() => localStorage.getItem('cc_crew_wh') || 'JHB')
  const [date, setDate] = useState(() => iso(new Date()))
  const [slots, setSlots] = useState([])
  const [slot, setSlot] = useState('')
  const [search, setSearch] = useState('')
  const [source, setSource] = useState('coolerco')
  const [cands, setCands] = useState(null)
  const [picked, setPicked] = useState([])
  const [routes, setRoutes] = useState([])
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const loadRoutes = useCallback(() => {
    supabase.rpc('coolerco_test_route_list', { p_date: date, p_warehouse: wh }).then(({ data, error }) => error ? setMsg({ t: 'err', s: friendly(error) }) : setRoutes(data || []))
  }, [date, wh])
  const loadCands = useCallback(() => {
    setCands(null)
    supabase.rpc('coolerco_test_route_candidates', { p_warehouse: wh, p_search: search || null, p_source: source })
      .then(({ data, error }) => error ? (setMsg({ t: 'err', s: friendly(error) }), setCands([])) : setCands(data || []))
  }, [wh, search, source])
  useEffect(() => { loadRoutes() }, [loadRoutes])
  useEffect(() => { const t = setTimeout(loadCands, 300); return () => clearTimeout(t) }, [loadCands])
  useEffect(() => {
    setPicked([]); setSlot('')
    supabase.rpc('coolerco_field_slot_list', { p_warehouse: wh }).then(({ data }) => setSlots((data || []).filter(s => s.active !== false && s.routeiq_username)))
  }, [wh])

  const toggle = c => setPicked(p => (p.includes(c) ? p.filter(x => x !== c) : [...p, c]))
  const move = (i, d) => setPicked(p => { const a = [...p]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a })

  const create = async () => {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('coolerco_test_route_create', { p_date: date, p_warehouse: wh, p_slot: slot, p_cases: picked, p_note: note || null })
    setBusy(false)
    if (error) return setMsg({ t: 'err', s: friendly(error) })
    setMsg({ t: 'ok', s: `✅ ${data.route_number} made with ${data.stops} stop(s). The driver sees it in the Field app → My trip.` })
    setPicked([]); setNote(''); loadRoutes(); loadCands()
  }
  const remove = async r => {
    if (!confirm(`Delete test route ${r.route_number}? Taps and job cards already saved on it stay in the history.`)) return
    const { error } = await supabase.rpc('coolerco_test_route_delete', { p_route: r.route_id })
    if (error) return setMsg({ t: 'err', s: friendly(error) })
    loadRoutes()
  }
  const slotLabel = s => `${s.person_name || '—'} · ${s.routeiq_username} (${s.worker_type})`

  return (
    <>
      <Topbar title="🧪 Test routes" sub="Build routes on the TEST system to test the Field app with Tiger / CoolerCo cases" />
      <div className="page-content">
        <div className="card" style={{ background: '#fff4d6', borderLeft: '4px solid #d98a1c' }}>
          <b>🧪 Reminder — these are TEST routes.</b>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            They exist only on the TEST database (UAT). In <b>production, routes come from RouteIQ</b> (the routing app) — the Field app will be linked to RouteIQ
            once testing is done. This screen refuses to work on production. Route numbers start with <code>TEST-</code> and drivers see a 🧪 banner on them.
          </div>
        </div>

        <div className="filters" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => { setWh(e.target.value); localStorage.setItem('cc_crew_wh', e.target.value) }}>
            {WHS.map(c => <option key={c} value={c}>{WH_NAMES[c]}</option>)}
          </select>
          <input type="date" className="field-ctrl" style={{ width: 'auto' }} value={date} onChange={e => e.target.value && setDate(e.target.value)} />
          <select className="field-ctrl" style={{ width: 'auto', minWidth: 220 }} value={slot} onChange={e => setSlot(e.target.value)}>
            <option value="">— Driver / technician slot —</option>
            {slots.map(s => <option key={s.id} value={s.routeiq_username}>{slotLabel(s)}</option>)}
          </select>
        </div>
        {slots.length === 0 && <div className="form-msg warn">No slot with a RouteIQ name in this warehouse — fill one in under 👷 Field crew → Slots & logins.</div>}
        {msg && <div className={`form-msg ${msg.t}`}>{msg.s}</div>}

        <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12 }}>
          <div className="card">
            <div className="card-title">1 · Pick open cases</div>
            <div className="filters" style={{ gap: 6, flexWrap: 'wrap' }}>
              <div className="seg">
                {[['coolerco', '🟩 CoolerCo / Tiger'], ['com', '🟦 COM'], ['all', 'All']].map(([k, l]) => (
                  <button key={k} className={`seg-btn ${source === k ? 'on' : ''}`} onClick={() => setSource(k)}>{l}</button>))}
              </div>
              <input className="field-ctrl" placeholder="Case no., store or L-code" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
            </div>
            {source !== 'coolerco' && <div className="text3" style={{ fontSize: 11, margin: '4px 0' }}>Tip: a COM case already on a real route moves to your test route on TEST until the next copy from production (08:30 / 19:30).</div>}
            {!cands && <div className="load-state"><span className="spinner" /></div>}
            {cands?.length === 0 && <div className="text3" style={{ fontSize: 12 }}>No open cases found. Log a Tiger / CoolerCo case first (customer portal or Requests).</div>}
            <div style={{ maxHeight: 420, overflow: 'auto' }}>
              {cands?.map(c => (
                <label key={c.case_number} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border, #eee)', fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={picked.includes(c.case_number)} onChange={() => toggle(c.case_number)} />
                  <div style={{ flex: 1 }}>
                    <b>{c.case_number}</b> <span className={`tag tag-${c.source === 'COM' ? 'blue' : 'green'}`}>{c.client_code || c.source}</span>{c.routed_today && <span className="tag tag-neutral">on a route today</span>}
                    <div className="text3">{c.case_type} · {c.status_reason} · {c.point_of_sale || '—'} {c.pos_local_code ? `(${c.pos_local_code})` : ''}</div>
                  </div>
                </label>))}
            </div>
          </div>

          <div className="card">
            <div className="card-title">2 · Visiting order ({picked.length})</div>
            {picked.length === 0 && <div className="text3" style={{ fontSize: 12 }}>Tick cases on the left.</div>}
            {picked.map((c, i) => (
              <div key={c} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 0', fontSize: 12 }}>
                <b style={{ width: 20 }}>{i + 1}</b><span style={{ flex: 1 }}>{c}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => move(i, -1)} disabled={i === 0}>▲</button>
                <button className="btn btn-ghost btn-sm" onClick={() => move(i, 1)} disabled={i === picked.length - 1}>▼</button>
                <button className="btn btn-ghost btn-sm" onClick={() => toggle(c)}>✕</button>
              </div>))}
            <input className="field-ctrl" placeholder="Note (optional), e.g. Tiger delivery test" value={note} onChange={e => setNote(e.target.value)} style={{ marginTop: 8 }} />
            <button className="btn btn-primary" style={{ marginTop: 8, width: '100%' }} disabled={busy || !slot || !picked.length} onClick={create}>
              {busy ? 'Making…' : '🧪 Make test route'}
            </button>
            {!slot && picked.length > 0 && <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>Choose the driver / technician slot at the top.</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-title">🧪 Test routes on {date} ({routes.length})</div>
          {routes.length === 0 && <div className="text3" style={{ fontSize: 12 }}>None yet.</div>}
          {routes.map(r => (
            <div key={r.route_id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border, #eee)', fontSize: 12 }}>
              <div style={{ flex: 1 }}>
                <b>{r.route_number}</b> · {r.slot_name} ({r.slot}) · {r.stops} stop(s){r.note ? ` · ${r.note}` : ''}
                <div className="text3">{(r.cases || []).join(' → ')}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => remove(r)}>🗑 Delete</button>
            </div>))}
          <div className="text3" style={{ fontSize: 11, marginTop: 6 }}>The driver sees the route if it is linked to them: the slot's usual login, or set under 👷 Field crew → Today's crew.</div>
        </div>
      </div>
    </>
  )
}
