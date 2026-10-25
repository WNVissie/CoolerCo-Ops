import { useState, useEffect, useCallback } from 'react'
import Topbar from '../components/Topbar'
import DataTable from '../components/DataTable'
import Drawer from '../components/Drawer'
import { sbFetch, supabase } from '../lib/supabase'
import { fmt, num, rtStatusColor, rtStatusLabel, PS } from '../lib/helpers'

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
      select: 'id,route_name,status,warehouse_id,driver_name,vehicle_registration,stop_count,created_at,dispatched_at,completed_at',
      order: 'created_at',
      asc: false,
      limit: PS,
      offset: page * PS,
    }
    if (status) params.eq = { status }
    if (wh) params.eq = { ...params.eq, warehouse_id: wh }

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
    { key: 'route_name', label: 'Route', render: v => <strong style={{ fontSize: 12 }}>{v || 'Unnamed'}</strong> },
    {
      key: 'status', label: 'Status',
      render: v => <span className={`tag tag-${rtStatusColor(v)}`}>{rtStatusLabel(v)}</span>
    },
    { key: 'warehouse_id', label: 'WH' },
    { key: 'driver_name', label: 'Driver' },
    { key: 'vehicle_registration', label: 'Vehicle' },
    { key: 'stop_count', label: 'Stops', render: v => <strong>{v ?? '—'}</strong> },
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
            {['JHB','CPT','BFN','DBN','EL','GEO','NEL','POL','PE'].map(w => <option key={w} value={w}>{w}</option>)}
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

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.route_name || 'Route Detail'} icon="🗺️">
        {selected && (
          <>
            <div style={{ marginBottom: 14 }}>
              <span className={`tag tag-${rtStatusColor(selected.status)}`}>{rtStatusLabel(selected.status)}</span>
            </div>
            <div className="dl-grid">
              {[
                ['Warehouse', selected.warehouse_id],
                ['Driver', selected.driver_name],
                ['Vehicle', selected.vehicle_registration],
                ['Stops', selected.stop_count],
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
                    <tr><th>#</th><th>Customer</th><th>Address</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {stops.map((s, i) => (
                      <tr key={i}>
                        <td>{s.stop_sequence ?? i + 1}</td>
                        <td>{s.customer_name || '—'}</td>
                        <td className="trunc" style={{ maxWidth: 140 }}>{s.address || '—'}</td>
                        <td><span className={`tag tag-${s.is_completed ? 'green' : 'neutral'}`}>{s.is_completed ? '✓' : 'Pending'}</span></td>
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
