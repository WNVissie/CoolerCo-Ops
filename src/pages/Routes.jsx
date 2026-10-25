import { useState, useEffect, useCallback } from 'react'
import Topbar from '../components/Topbar'
import DataTable from '../components/DataTable'
import Drawer from '../components/Drawer'
import { sbFetch, supabase } from '../lib/supabase'
import { fmt, num, rtStatusColor, rtStatusLabel, PS, WAREHOUSES, WH_NAMES, whCaseName } from '../lib/helpers'

export default function Routes() {
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState('')
  const [wh, setWh] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [stops, setStops] = useState([])

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
  useEffect(() => { setPage(0) }, [status, wh])

  async function openRoute(row) {
    setSelected(row)
    const { data } = await supabase.from('routing_route_stops')
      .select('*')
      .eq('route_id', row.id)
      .order('stop_sequence', { ascending: true })
      .limit(100)
    setStops(data || [])
  }

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

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.route_number || 'Route Detail'} icon="🗺️">
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
                <table className="tbl" style={{ fontSize: 11.5 }}>
                  <thead>
                    <tr><th>#</th><th>Case / POS</th><th>Address</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {stops.map((s, i) => (
                      <tr key={i}>
                        <td>{s.stop_sequence ?? i + 1}</td>
                        <td>{s.case_number} · {s.case_type}<div className="text3" style={{ fontSize: 10.5 }}>{s.point_of_sale || '—'}</div></td>
                        <td className="trunc" style={{ maxWidth: 140 }}>{s.address || '—'}</td>
                        <td><span className={`tag tag-${s.outcome_status === 'completed' || s.actual_case_status === 'Solved' ? 'green' : 'neutral'}`}>{s.outcome_status || s.actual_case_status || 'planned'}</span></td>
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
