import { useState, useEffect, useCallback } from 'react'
import Topbar from '../components/Topbar'
import DataTable from '../components/DataTable'
import { sbFetch, supabase } from '../lib/supabase'
import { fmt, num, PS } from '../lib/helpers'

export default function Picking() {
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [wh, setWh] = useState('')
  const [showPicked, setShowPicked] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const params = {
      select: 'id,route_id,item_code,item_description,quantity,warehouse_id,is_picked,picked_at,picked_by,serial_number',
      order: 'id',
      asc: true,
      limit: PS,
      offset: page * PS,
    }
    if (!showPicked) params.eq = { is_picked: false }
    if (wh) params.eq = { ...params.eq, warehouse_id: wh }

    const { data, count } = await sbFetch('routing_warehouse_preparation', params)
    setRows(data); setCount(count)
    setLoading(false)
  }, [page, wh, showPicked])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0) }, [wh, showPicked])

  async function markPicked(row) {
    const { error } = await supabase.from('routing_warehouse_preparation')
      .update({ is_picked: true, picked_at: new Date().toISOString(), picked_by: 'ops-hub' })
      .eq('id', row.id)
    if (!error) load()
  }

  const COLS = [
    { key: 'item_code', label: 'Item Code', cls: 'mono' },
    { key: 'item_description', label: 'Description', render: v => <span className="trunc" style={{ maxWidth: 200, display: 'block' }}>{v || '—'}</span> },
    { key: 'quantity', label: 'Qty', render: v => <strong>{v}</strong> },
    { key: 'warehouse_id', label: 'WH' },
    { key: 'serial_number', label: 'Serial', cls: 'mono', render: v => <span style={{ fontSize: 11 }}>{v || '—'}</span> },
    {
      key: 'is_picked', label: 'Status',
      render: (v, row) => v
        ? <span className="tag tag-green">✓ Picked {fmt(row.picked_at)}</span>
        : <button className="btn btn-primary btn-sm" onClick={e => { e.stopPropagation(); markPicked(row) }}>Mark Picked</button>
    },
  ]

  return (
    <>
      <Topbar title="Picking Queue" sub="Warehouse pick list for routes" />
      <div className="page-content">
        <div className="filters">
          <select value={wh} onChange={e => setWh(e.target.value)}>
            <option value="">All warehouses</option>
            {['JHB','CPT','BFN','DBN','EL','GEO','NEL','POL','PE'].map(w => <option key={w} value={w}>{w}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={showPicked} onChange={e => setShowPicked(e.target.checked)} />
            Show picked items
          </label>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text3)' }}>
            {num(count)} {showPicked ? 'items' : 'pending items'}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">📦 Pick List</span>
            <span className="card-count">{num(count)} items</span>
          </div>
          <DataTable cols={COLS} rows={rows} count={count} page={page} setPage={setPage} loading={loading} />
        </div>
      </div>
    </>
  )
}
