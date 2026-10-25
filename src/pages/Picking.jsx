import { useState, useEffect, useCallback } from 'react'
import Topbar from '../components/Topbar'
import DataTable from '../components/DataTable'
import { sbFetch, supabase } from '../lib/supabase'
import { fmt, num, PS } from '../lib/helpers'

export default function Picking() {
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [showPicked, setShowPicked] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const params = {
      // Exact column names from routing_warehouse_preparation table
      select: 'route_id,case_number,picked,rtw,packed,returned,selected_asset_name,selected_bar_code,selected_local_code,selected_product_base,selected_condition,selected_branding,picked_at,bay,is_ncd',
      order: 'case_number',
      asc: true,
      limit: PS,
      offset: page * PS,
    }
    if (!showPicked) params.eq = { picked: false }

    const { data, count } = await sbFetch('routing_warehouse_preparation', params)
    setRows(data || []); setCount(count || 0)
    setLoading(false)
  }, [page, showPicked])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(0) }, [showPicked])

  async function markPicked(row) {
    // Update using case_number + route_id as the row identifier
    const { error } = await supabase.from('routing_warehouse_preparation')
      .update({ picked: true, picked_at: new Date().toISOString() })
      .eq('case_number', row.case_number)
      .eq('route_id', row.route_id)
    if (!error) load()
  }

  const condColor = c => {
    if (!c) return 'neutral'
    const g = c.toString().toUpperCase()
    if (g === 'A') return 'green'
    if (g === 'B') return 'teal'
    if (g === 'C') return 'orange'
    return 'red'
  }

  const COLS = [
    { key: 'case_number', label: 'Case #', cls: 'mono', render: v => <strong style={{ fontSize: 11.5 }}>{v || '—'}</strong> },
    { key: 'route_id', label: 'Route ID', cls: 'mono', render: v => <span style={{ fontSize: 11 }}>{v || '—'}</span> },
    {
      key: 'selected_asset_name', label: 'Asset',
      render: v => <span className="trunc" style={{ maxWidth: 200, display: 'block' }}>{v || '—'}</span>
    },
    { key: 'selected_bar_code', label: 'Barcode', cls: 'mono', render: v => <span style={{ fontSize: 11 }}>{v || '—'}</span> },
    { key: 'selected_product_base', label: 'Product', render: v => <span className="trunc" style={{ maxWidth: 100, display: 'block' }}>{v || '—'}</span> },
    { key: 'selected_condition', label: 'Cond.', render: v => v ? <span className={`tag tag-${condColor(v)}`}>{v}</span> : '—' },
    { key: 'bay', label: 'Bay', render: v => <span style={{ fontSize: 11 }}>{v || '—'}</span> },
    {
      key: 'picked', label: 'Status',
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
