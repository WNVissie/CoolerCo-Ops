import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import DataTable from '../components/DataTable'
import { sbFetch } from '../lib/supabase'
import { num, CATS, WAREHOUSES, WH_NAMES, PS } from '../lib/helpers'

export default function StockCategory() {
  const { cat } = useParams()
  const catDef = CATS.find(c => c.key === cat)
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [wh, setWh] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 380)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { setPage(0) }, [debouncedSearch, wh, cat])

  const load = useCallback(async () => {
    if (!catDef) return
    setLoading(true)
    const params = {
      order: 'on_hand',
      asc: true,
      limit: PS,
      offset: page * PS,
    }
    if (debouncedSearch) params.ilike = { item_description: `%${debouncedSearch}%` }
    if (wh) params.eq = { warehouse_id: wh }

    const { data, count } = await sbFetch(catDef.view, params)
    setRows(data); setCount(count)
    setLoading(false)
  }, [page, debouncedSearch, wh, cat, catDef])

  useEffect(() => { load() }, [load])

  if (!catDef) return <div className="page-content"><div className="empty-state">Unknown category</div></div>

  const COLS = [
    { key: 'item_code', label: 'Code', cls: 'mono', render: v => <span style={{ fontSize: 11 }}>{v || '—'}</span> },
    { key: 'item_description', label: 'Description', render: v => <span className="trunc" style={{ maxWidth: 220, display: 'block' }}>{v || '—'}</span> },
    { key: 'warehouse_id', label: 'WH' },
    { key: 'on_hand', label: 'On Hand', render: v => <strong>{num(v)}</strong> },
    { key: 'min_stock', label: 'Min' },
    { key: 'reserved', label: 'Reserved' },
    {
      key: 'on_hand', label: 'Status',
      render: (v, r) => {
        const pct = r.min_stock > 0 ? Math.round((v / r.min_stock) * 100) : null
        if (pct === null) return <span className="tag tag-neutral">No min set</span>
        if (pct < 50) return <span className="tag tag-red">Critical {pct}%</span>
        if (pct < 100) return <span className="tag tag-orange">Low {pct}%</span>
        return <span className="tag tag-green">OK {pct}%</span>
      }
    },
  ]

  return (
    <>
      <Topbar
        title={`${catDef.icon} ${catDef.label}`}
        sub={`Stock by item · all warehouses`}
        actions={
          <Link to="/stock" className="btn btn-ghost btn-sm">← Back</Link>
        }
      />
      <div className="page-content">
        <div className="filters">
          <div className="search-wrap">
            <span className="ico">🔍</span>
            <input type="text" placeholder="Search items…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select value={wh} onChange={e => setWh(e.target.value)}>
            <option value="">All warehouses</option>
            {WAREHOUSES.map(w => <option key={w} value={w}>{w} – {WH_NAMES[w]}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setWh(''); }}>Clear</button>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">{catDef.icon} {catDef.label} Stock</span>
            <span className="card-count">{num(count)} SKUs</span>
          </div>
          <DataTable cols={COLS} rows={rows} count={count} page={page} setPage={setPage} loading={loading} />
        </div>
      </div>
    </>
  )
}
