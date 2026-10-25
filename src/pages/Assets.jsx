import { useState, useEffect, useCallback } from 'react'
import Topbar from '../components/Topbar'
import DataTable from '../components/DataTable'
import Drawer from '../components/Drawer'
import { sbFetch, supabase } from '../lib/supabase'
import { fmt, num, condColor, PS } from '../lib/helpers'

// Real conditions from the assets_live table
const CONDITIONS = ['', 'A', 'B', 'C', 'D', 'E', 'S']

export default function Assets() {
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [condition, setCondition] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [assetHistory, setAssetHistory] = useState([])
  const [histLoading, setHistLoading] = useState(false)
  const [totalCount, setTotalCount] = useState(null)

  // Debounce search
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 380)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { setPage(0) }, [debouncedSearch, condition])

  const load = useCallback(async () => {
    setLoading(true)
    const params = {
      // Exact column names from assets_live table
      select: 'id,name,bar_code,local_code,asset_type,condition,asset_location,assign_account,responsible_ordering_party,pos_local_code,product_base,asset_status,status,last_touch_date,imported_at',
      order: 'imported_at',
      asc: false,
      limit: PS,
      offset: page * PS,
    }
    // Search by asset name or bar_code
    if (debouncedSearch) params.ilike = { name: `%${debouncedSearch}%` }
    if (condition) params.eq = { condition }

    const { data, count, error } = await sbFetch('assets_live', params)
    if (!error) { setRows(data); setCount(count) }
    setLoading(false)
  }, [page, debouncedSearch, condition])

  useEffect(() => { load() }, [load])

  // Grab total on mount
  useEffect(() => {
    supabase.from('assets_live').select('id', { count: 'exact', head: true })
      .then(({ count }) => setTotalCount(count))
  }, [])

  async function openAsset(row) {
    setSelected(row)
    setHistLoading(true)
    setAssetHistory([])
    // coolerco_asset_touch links by bar_code or local_code
    const { data } = await supabase.from('coolerco_asset_touch')
      .select('created_at,scan_type,bay,warehouse_name,scanned_by,warehouse_id')
      .eq('bar_code', row.bar_code)
      .eq('tenant_id', 'tenant_coolerco')
      .order('created_at', { ascending: false })
      .limit(20)
    setAssetHistory(data || [])
    setHistLoading(false)
  }

  const COLS = [
    {
      key: 'name', label: 'Asset Name',
      render: v => <strong style={{ fontSize: 11.5 }}>{v || '—'}</strong>
    },
    { key: 'bar_code', label: 'Barcode', cls: 'mono', render: v => <span style={{ fontSize: 11 }}>{v || '—'}</span> },
    { key: 'asset_type', label: 'Type', render: v => <span className="trunc" style={{ maxWidth: 100, display: 'block' }}>{v || '—'}</span> },
    { key: 'condition', label: 'Cond.', render: v => v ? <span className={`tag tag-${condColor(v)}`}>{v}</span> : '—' },
    // assign_account = the warehouse/account the asset is assigned to
    { key: 'assign_account', label: 'Warehouse / Account', render: v => <span className="trunc" style={{ maxWidth: 150, display: 'block' }}>{v || '—'}</span> },
    // responsible_ordering_party = the Concessionaire
    { key: 'responsible_ordering_party', label: 'Concessionaire', render: v => <span className="trunc" style={{ maxWidth: 140, display: 'block' }}>{v || '—'}</span> },
    { key: 'pos_local_code', label: 'POS Code', cls: 'mono' },
    { key: 'last_touch_date', label: 'Last Touch', render: v => <span className="text3">{fmt(v)}</span> },
  ]

  return (
    <>
      <Topbar
        title="Assets"
        sub={totalCount != null ? `${num(totalCount)} total assets from COM` : 'Asset register'}
        actions={<a href="https://smartroutertma.netlify.app/" target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">🔗 Routing App ↗</a>}
      />
      <div className="page-content">
        <div className="filters">
          <div className="search-wrap">
            <span className="ico">🔍</span>
            <input
              type="text"
              placeholder="Search asset name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select value={condition} onChange={e => setCondition(e.target.value)}>
            <option value="">All conditions</option>
            {CONDITIONS.filter(Boolean).map(c => <option key={c} value={c}>Grade {c}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setCondition(''); setPage(0) }}>Clear</button>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">🏭 Asset Register</span>
            <span className="card-count">{num(count)} results</span>
          </div>
          <DataTable
            cols={COLS}
            rows={rows}
            count={count}
            page={page}
            setPage={setPage}
            onRowClick={openAsset}
            loading={loading}
          />
        </div>
      </div>

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.name || 'Asset Detail'} icon="🏭">
        {selected && (
          <>
            <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className={`tag tag-${condColor(selected.condition)}`} style={{ fontSize: 12 }}>
                Grade {selected.condition || '?'}
              </span>
              {selected.asset_status && (
                <span className="tag tag-neutral" style={{ fontSize: 11 }}>{selected.asset_status}</span>
              )}
              <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>
                {selected.asset_type || '—'}
              </span>
            </div>

            <div className="dl-grid">
              {[
                ['Asset Name', selected.name],
                ['Barcode', selected.bar_code],
                ['Local Code', selected.local_code],
                ['Asset Type', selected.asset_type],
                ['Product Base', selected.product_base],
                ['Location Type', selected.asset_location],
                ['Warehouse / Account', selected.assign_account],
                ['Concessionaire', selected.responsible_ordering_party],
                ['POS Local Code', selected.pos_local_code],
                ['Asset Status', selected.asset_status],
                ['Status', selected.status],
                ['Last Touch', fmt(selected.last_touch_date)],
                ['Imported', fmt(selected.imported_at)],
              ].map(([lbl, val]) => (
                <div key={lbl} className="dl-field">
                  <div className="lbl">{lbl}</div>
                  <div className="val">{val || '—'}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10, color: 'var(--text2)' }}>
                📷 Scan History (last 20)
              </div>
              {histLoading ? (
                <div className="load-state" style={{ padding: 20 }}><span className="spinner" /></div>
              ) : assetHistory.length === 0 ? (
                <div className="empty-state" style={{ padding: 16 }}>No scan history found for barcode</div>
              ) : (
                <table className="tbl" style={{ fontSize: 11.5 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Warehouse</th>
                      <th>Bay</th>
                      <th>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assetHistory.map((h, i) => (
                      <tr key={i}>
                        <td>{fmt(h.created_at)}</td>
                        <td>{h.scan_type || '—'}</td>
                        <td>{h.warehouse_name || h.warehouse_id || '—'}</td>
                        <td>{h.bay || '—'}</td>
                        <td>{h.scanned_by || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </Drawer>
    </>
  )
}
