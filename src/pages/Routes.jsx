import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import Topbar from '../components/Topbar'
import DataTable from '../components/DataTable'
import Drawer from '../components/Drawer'
import { sbFetch, supabase } from '../lib/supabase'
import { fmt, num, rtStatusColor, rtStatusLabel, statusColor, isClosedCase, PS, WAREHOUSES, WH_NAMES, whCaseName } from '../lib/helpers'

// ── Done on the app vs closed in COM ─────────────────────────────────────────
// "Done on app"   = the driver / technician tapped Completed on the mobile trip sheet (routing app).
// "Closed in COM" = the case is Solved / Not Solved / Canceled in COM (from the latest COM upload).
// Only stops whose case is a COM case are compared (Magnum). Cases closed in CoolerCo itself
// (Tiger) have no COM case, so they are left out of the COM numbers.
// Worked out in the browser for the routes on screen only: a few small parallel reads, no database change.
const tappedOnApp = s => s.outcome_status === 'solved' && /^driver marked completed/i.test(s.actual_case_status || '')
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

async function currentStops(routeIds, select) {
  if (!routeIds.length) return []
  const { data: vers } = await supabase.from('routing_route_versions').select('id,route_id').in('route_id', routeIds).eq('is_current', true)
  const parts = await Promise.all(chunks((vers || []).map(v => v.id), 10).map(ids =>
    supabase.from('routing_route_stops').select(select).in('route_version_id', ids).order('stop_sequence').limit(1000)))
  return parts.flatMap(p => p.data || [])
}

async function comStatuses(stops) {
  const nos = [...new Set(stops.map(s => s.case_number).filter(Boolean))]
  const parts = await Promise.all(chunks(nos, 100).map(c => supabase.from('cases').select('case_number,status_reason').in('case_number', c)))
  return new Map(parts.flatMap(p => p.data || []).map(c => [c.case_number, c.status_reason]))
}

function tally(stops, com) {
  const t = { stops: stops.length, app: 0, comCases: 0, comClosed: 0, gap: 0 }
  stops.forEach(s => {
    const inCom = com.has(s.case_number), closed = inCom && isClosedCase(com.get(s.case_number))
    if (tappedOnApp(s)) t.app++
    if (inCom) t.comCases++
    if (closed) t.comClosed++
    if (tappedOnApp(s) && inCom && !closed) t.gap++
  })
  return t
}

export default function Routes() {
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState('')
  const [wh, setWh] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [stops, setStops] = useState([])
  const [params, setParams] = useSearchParams()
  const [stats, setStats] = useState({})   // route id → tally (routes on screen)
  const [com, setCom] = useState(new Map()) // case number → COM status (open route)
  const statsRun = useRef(0)

  const load = useCallback(async () => {
    setLoading(true)
    const params = {
      select: 'id,route_number,route_date,status,warehouse_group,resource_display_name,vehicle_code,planned_stop_count,planned_asset_count,created_at,dispatched_at,completed_at',
      order: 'created_at',
      asc: false,
      limit: PS,
      offset: page * PS,
    }
    if (status) params.eq = { status }
    if (wh) params.eq = { ...params.eq, warehouse_group: whCaseName(wh) }

    const { data, count } = await sbFetch('routing_routes', params)
    setRows(data); setCount(count)
    setLoading(false)
  }, [page, status, wh])

  useEffect(() => { load() }, [load])

  // After the list shows: count done-on-app vs closed-in-COM for the routes on this page
  useEffect(() => {
    const run = ++statsRun.current
    setStats({})
    if (!rows.length) return
    ;(async () => {
      try {
        const st = await currentStops(rows.map(r => r.id), 'route_id,case_number,outcome_status,actual_case_status')
        const map = await comStatuses(st)
        if (run !== statsRun.current) return
        const by = {}
        st.forEach(s => { (by[s.route_id] ||= []).push(s) })
        setStats(Object.fromEntries(Object.entries(by).map(([id, list]) => [id, tally(list, map)])))
      } catch { /* the list still works without the counts */ }
    })()
  }, [rows])
  useEffect(() => { setPage(0) }, [status, wh])

  // Opened from the Dashboard (/routes?route=<id>): show that route's details straight away
  useEffect(() => {
    const id = params.get('route')
    if (!id) return
    supabase.from('routing_routes')
      .select('id,route_number,route_date,status,warehouse_group,resource_display_name,vehicle_code,planned_stop_count,planned_asset_count,created_at,dispatched_at,completed_at')
      .eq('id', id).maybeSingle()
      .then(({ data }) => { if (data) openRoute(data) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function closeRoute() {
    setSelected(null)
    if (params.get('route')) setParams({}, { replace: true })
  }

  async function openRoute(row) {
    setSelected(row); setStops([]); setCom(new Map())
    // Stops of the current version of the route (older versions are left out)
    let data = await currentStops([row.id], '*')
    if (!data.length) {
      const r = await supabase.from('routing_route_stops').select('*').eq('route_id', row.id).order('stop_sequence', { ascending: true }).limit(100)
      data = r.data || []
    }
    setStops(data)
    setCom(await comStatuses(data))
  }

  const stat = (row, fn) => { const t = stats[row.id]; return t ? fn(t) : <span className="text3">…</span> }

  const COLS = [
    { key: 'route_number', label: 'Route', render: v => <strong style={{ fontSize: 12 }}>{v || 'Unnamed'}</strong> },
    {
      key: 'status', label: 'Status',
      render: v => <span className={`tag tag-${rtStatusColor(v)}`}>{rtStatusLabel(v)}</span>
    },
    { key: 'warehouse_group', label: 'WH', render: v => (v || '—').replace('RTMA ', '') },
    { key: 'route_date', label: 'Route date', render: v => <span className="text3">{fmt(v)}</span> },
    { key: 'resource_display_name', label: 'Driver / Tech' },
    { key: 'vehicle_code', label: 'Vehicle' },
    { key: 'planned_stop_count', label: 'Stops', render: v => <strong>{v ?? '—'}</strong> },
    { key: '_app', label: '📱 Done on app', render: (_v, row) => stat(row, t => <span title="Tapped Completed on the mobile trip sheet"><strong>{t.app}</strong><span className="text3"> / {t.stops}</span></span>) },
    { key: '_com', label: '✅ Closed in COM', render: (_v, row) => stat(row, t => t.comCases
      ? <span title="Cases on this route that are closed in COM"><strong>{t.comClosed}</strong><span className="text3"> / {t.comCases}</span></span>
      : <span className="text3" title="No COM cases on this route">—</span>) },
    { key: '_gap', label: 'Gap', render: (_v, row) => stat(row, t => t.gap
      ? <span className="tag tag-red" title="Done on the app but still open in COM">⚠ {t.gap}</span>
      : t.app ? <span className="tag tag-green">✓</span> : <span className="text3">—</span>) },
    { key: 'created_at', label: 'Created', render: v => <span className="text3">{fmt(v)}</span> },
    { key: 'dispatched_at', label: 'Dispatched', render: v => <span className="text3">{fmt(v)}</span> },
  ]

  return (
    <>
      <Topbar
        title="Routes"
        sub="Delivery & collection routes"
        actions={
          <a href="https://smartroutertma.netlify.app/" target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
            🛣️ Open Routing App ↗
          </a>
        }
      />
      <div className="page-content">
        <div className="filters">
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['saved_draft','finalised','dispatched','partially_completed','completed','not_used'].map(s => (
              <option key={s} value={s}>{rtStatusLabel(s)}</option>
            ))}
          </select>
          <select value={wh} onChange={e => setWh(e.target.value)}>
            <option value="">All warehouses</option>
            {WAREHOUSES.map(w => <option key={w} value={w}>{WH_NAMES[w]}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => { setStatus(''); setWh(''); }}>Clear</button>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">🗺️ Routes</span>
            <span className="card-count">{num(count)} routes</span>
          </div>
          <DataTable cols={COLS} rows={rows} count={count} page={page} setPage={setPage} onRowClick={openRoute} loading={loading} />
        </div>
      </div>

      <Drawer open={!!selected} onClose={closeRoute} title={selected?.route_number || 'Route Detail'} icon="🗺️">
        {selected && (
          <>
            <div style={{ marginBottom: 14 }}>
              <span className={`tag tag-${rtStatusColor(selected.status)}`}>{rtStatusLabel(selected.status)}</span>
            </div>
            <div className="dl-grid">
              {[
                ['Warehouse', selected.warehouse_group],
                ['Route date', fmt(selected.route_date)],
                ['Driver / Tech', selected.resource_display_name],
                ['Vehicle', selected.vehicle_code],
                ['Stops', selected.planned_stop_count],
                ['Assets', selected.planned_asset_count],
                ['Created', fmt(selected.created_at)],
                ['Dispatched', fmt(selected.dispatched_at)],
                ['Completed', fmt(selected.completed_at)],
              ].map(([l, v]) => (
                <div key={l} className="dl-field">
                  <div className="lbl">{l}</div>
                  <div className="val">{v ?? '—'}</div>
                </div>
              ))}
            </div>

            {stops.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10, color: 'var(--text2)' }}>
                  📍 Stops ({stops.length})
                </div>
                {(() => { const t = tally(stops, com); return (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    <span className="tag tag-blue">📱 Done on app {t.app} / {t.stops}</span>
                    {t.comCases > 0 && <span className="tag tag-green">✅ Closed in COM {t.comClosed} / {t.comCases}</span>}
                    {t.gap > 0 && <span className="tag tag-red">⚠ {t.gap} done on app, still open in COM</span>}
                  </div>
                ) })()}
                <table className="tbl" style={{ fontSize: 11.5 }}>
                  <thead>
                    <tr><th>#</th><th>Case / POS</th><th>Address</th><th>App</th><th>COM</th></tr>
                  </thead>
                  <tbody>
                    {stops.map((s, i) => (
                      <tr key={i}>
                        <td>{s.stop_sequence ?? i + 1}</td>
                        <td>{s.case_number} · {s.case_type}<div className="text3" style={{ fontSize: 10.5 }}>{s.point_of_sale || '—'}</div></td>
                        <td className="trunc" style={{ maxWidth: 140 }}>{s.address || '—'}</td>
                        <td><span className={`tag tag-${tappedOnApp(s) ? 'blue' : s.outcome_status === 'solved' ? 'green' : 'neutral'}`} title={s.actual_case_status || ''}>{tappedOnApp(s) ? '📱 done' : (s.outcome_status || 'planned').replace(/_/g, ' ')}</span></td>
                        <td>{com.has(s.case_number)
                          ? <span className={`tag tag-${tappedOnApp(s) && !isClosedCase(com.get(s.case_number)) ? 'red' : statusColor(com.get(s.case_number))}`}>{tappedOnApp(s) && !isClosedCase(com.get(s.case_number)) ? '⚠ ' : ''}{com.get(s.case_number)}</span>
                          : <span className="text3" title="Not a COM case">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Drawer>
    </>
  )
}
