import { useState, useEffect, useMemo } from 'react'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { fmt, num, WAREHOUSES, WH_NAMES, whCaseName, condColor, CASE_TYPE_ICON } from '../lib/helpers'

// Warehouse Preparation board — READ-ONLY view of the routing app's preparation
// (picking, RTW and packing are done in the Routing App).
const ROUTING_APP = 'https://smartroutertma.netlify.app/'
const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const dayLabel = d => new Date(d + 'T00:00:00').toLocaleDateString('en-ZA', { weekday: 'short', day: '2-digit', month: 'short' })

export default function Picking() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [wh, setWh] = useState('')
  const [from, setFrom] = useState(daysAgo(3))
  const [show, setShow] = useState('open') // open = not yet packed | all

  useEffect(() => {
    setRows(null)
    supabase.rpc('coolerco_picking_queue', { p_from: from, p_warehouse: wh ? whCaseName(wh) : null })
      .then(({ data, error }) => { if (error) setErr(error.message); else { setErr(null); setRows(data || []) } })
  }, [wh, from])

  // Group: date → route (all done in the browser from one small response)
  const groups = useMemo(() => {
    const list = (rows || []).filter(r => show === 'all' || !r.packed)
    const byDay = {}
    list.forEach(r => {
      const d = (byDay[r.route_date] ||= {})
      ;(d[r.route_id] ||= { route: r, lines: [] }).lines.push(r)
    })
    return Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b))
  }, [rows, show])

  const totals = useMemo(() => {
    const t = { lines: 0, picked: 0, rtw: 0, packed: 0 }
    ;(rows || []).forEach(r => { t.lines++; if (r.picked) t.picked++; if (r.rtw) t.rtw++; if (r.packed) t.packed++ })
    return t
  }, [rows])

  return (
    <>
      <Topbar title="Warehouse Preparation" sub="Picked → RTW → Packed, per route (read-only from the Routing App)"
        actions={<a href={ROUTING_APP} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">🛣️ Open Routing App ↗</a>} />
      <div className="page-content">
        <div className="filters">
          <select value={wh} onChange={e => setWh(e.target.value)}>
            <option value="">🏢 All warehouses</option>
            {WAREHOUSES.map(w => <option key={w} value={w}>{WH_NAMES[w]}</option>)}
          </select>
          <label style={{ fontSize: 11.5, display: 'flex', gap: 6, alignItems: 'center' }}>From <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <div className="seg">
            {[['open', '📦 Not yet packed'], ['all', '🗂️ All lines']].map(([k, l]) => <button key={k} className={`seg-btn${show === k ? ' on' : ''}`} onClick={() => setShow(k)}>{l}</button>)}
          </div>
        </div>

        {err && <div className="notice warn">{err}</div>}
        {!rows && !err && <div className="load-state"><span className="spinner" /> Loading preparation…</div>}

        {rows && (
          <>
            <div className="stats-row">
              <div className="stat-card c-accent"><div className="stat-label">📋 Lines</div><div className="stat-value">{num(totals.lines)}</div><div className="stat-sub">since {fmt(from)}</div></div>
              <div className="stat-card"><div className="stat-label">✅ Picked</div><div className="stat-value">{num(totals.picked)}</div></div>
              <div className="stat-card c-green"><div className="stat-label">🟢 RTW</div><div className="stat-value">{num(totals.rtw)}</div></div>
              <div className="stat-card c-orange"><div className="stat-label">📦 Packed / loaded</div><div className="stat-value">{num(totals.packed)}</div><div className="stat-sub">{num(totals.lines - totals.packed)} still to load</div></div>
            </div>

            {!groups.length && <div className="empty-state"><div className="empty-ico">📦</div><div>Nothing to prepare for this selection</div></div>}

            {groups.map(([day, routes]) => (
              <details key={day} className="sec" open={day >= today()}>
                <summary>📅 {dayLabel(day)} {day === today() ? '· today' : ''} · {Object.keys(routes).length} route(s)</summary>
                <div className="sec-body">
                  {Object.values(routes).map(({ route, lines }) => {
                    const p = lines.filter(l => l.picked).length, r = lines.filter(l => l.rtw).length, k = lines.filter(l => l.packed).length
                    return (
                      <details key={route.route_id} className="card wh-card" style={{ marginBottom: 10 }} open>
                        <summary className="wh-card-hd">
                          <div style={{ minWidth: 0 }}>
                            <div className="card-title">🚚 {route.route_number} <span className="text3" style={{ fontWeight: 400 }}>· {(route.warehouse_group || '').replace('RTMA ', '')}</span></div>
                            <div className="text3" style={{ fontSize: 10.5 }}>{route.driver || 'No driver yet'}{route.vehicle_code ? ` · ${route.vehicle_code}` : ''} · {route.route_status}</div>
                          </div>
                          <div className="prep-pills">
                            <span className={`tag tag-${p === lines.length ? 'green' : 'orange'}`}>✅ {p}/{lines.length}</span>
                            <span className={`tag tag-${r === lines.length ? 'green' : 'orange'}`}>🟢 {r}/{lines.length}</span>
                            <span className={`tag tag-${k === lines.length ? 'green' : 'neutral'}`}>📦 {k}/{lines.length}</span>
                          </div>
                        </summary>
                        <div className="tbl-wrap">
                          <table className="tbl">
                            <thead><tr><th>#</th><th>Case / store</th><th>Asset</th><th>Bay</th><th>Picked</th><th>RTW</th><th>Packed</th></tr></thead>
                            <tbody>
                              {lines.map(l => (
                                <tr key={l.case_number}>
                                  <td className="text3">{l.stop_sequence ?? '—'}</td>
                                  <td>
                                    <div className="mono" style={{ fontSize: 10.5 }}>{CASE_TYPE_ICON[l.case_type] || '•'} {l.case_number}{l.is_ncd ? <span className="tag tag-purple" style={{ marginLeft: 4 }}>NCD</span> : null}</div>
                                    <div className="trunc text3" style={{ maxWidth: 220, fontSize: 10.5 }} title={l.point_of_sale}>{l.point_of_sale}</div>
                                  </td>
                                  <td>
                                    {l.selected_asset_name ? <>
                                      <div className="mono" style={{ fontSize: 10.5 }}>{l.selected_bar_code} · {l.selected_local_code}</div>
                                      <div className="text3 trunc" style={{ maxWidth: 200, fontSize: 10.5 }}>{l.selected_product_base}</div>
                                      {l.selected_condition && <span className={`tag tag-${condColor(l.selected_condition)}`}>{l.selected_condition}</span>}
                                    </> : <span className="tag tag-orange">no asset selected</span>}
                                    {l.returned_asset_name && <div className="text3" style={{ fontSize: 10 }}>⬇ return: {l.returned_bar_code}</div>}
                                  </td>
                                  <td>{l.bay || '—'}</td>
                                  <td>{l.picked ? <span title={l.picked_at ? new Date(l.picked_at).toLocaleString('en-ZA') : ''}>✅</span> : '—'}</td>
                                  <td>{l.rtw ? '🟢' : '—'}</td>
                                  <td>{l.packed ? '📦' : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )
                  })}
                </div>
              </details>
            ))}
          </>
        )}
      </div>
    </>
  )
}
