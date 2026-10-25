import { useState, useEffect, useCallback } from 'react'
import Topbar from '../components/Topbar'
import DataTable from '../components/DataTable'
import Drawer from '../components/Drawer'
import { sbFetch, supabase } from '../lib/supabase'
import { fmt, num, condColor, PS } from '../lib/helpers'

const CONDITIONS = ['', 'A', 'B', 'C', 'D']
const ASSET_TYPES = ['', 'CoolerCo', 'Reach-In', 'Chest', 'Display', 'Other']

export default function Assets() {
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [condition, setCondition] = useState('')
  const [wh, setWh] = useState('')
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

  useEffect(() => { setPage(0) }, [debouncedSearch, condition, wh])

  const load = useCallback(async () => {
    setLoading(true)
    const params = {
      select: 'asset_id,serial_number,asset_description,asset_type,condition_grade,warehouse_id,customer_name,customer_account,location_code,last_scanned,created_at',
      order: 'created_at',
      asc: false,
      limit: PS,
      offset: page * PS,
    }
    if (debouncedSearch) {
      // search across serial, description, customer
      params.ilike = { serial_number: `%${debouncedSearch}%` }
    }
    if (condition) params.eq = { ...params.eq, condition_grade: condition }
    if (wh) params.eq = { ...params.eq, warehouse_id: wh }

    const { data, count, error } = await sbFetch('assets_live', params)
    if (!error) { setRows(data); setCount(count) }
    setLoading(false)
  }, [page, debouncedSearch, condition, wh])

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
    const { data } = await supabase.from('coolerco_asset_touch')
      .select('scanned_at,scan_type,location_code,scanned_by')
      .eq('asset_serial', row.serial_number)
      .eq('tenant_id', 'tenant_coolerco')
      .order('scanned_at', { ascending: false })
      .limit(20)
    setAssetHistory(data || [])
    setHistLoading(false)
  }

  const COLS = [
    { key: 'serial_number', label: 'Serial', cls: 'mono', render: v => <strong style={{ fontSize: 11.5 }}>{v || '—'}</strong> },
    { key: 'asset_description', label: 'Description', render: (v, r) => <span className="trunc" style={{ maxWidth: 200, display: 'block' }}>{v || r.asset_type || '—'}</span> },
    { key: 'condition_grade', label: 'Cond.', render: v => v ? <span className={`tag tag-${condColor(v)}`}>{v}</span> : '—' },
    { key: 'warehouse_id', label: 'WH' },
    { key: 'customer_name', label: 'Customer', render: v => <span className="trunc" style={{ maxWidth: 160, display: 'block' }}>{v || '—'}</span> },
    { key: 'location_code', label: 'Location' },
    { key: 'last_scanned', label: 'Last Scan', render: v => <span className="text3">{fmt(v)}</span> },
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
              placeholder="Search serial, description, customer…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select value={condition} onChange={e => setCondition(e.target.value)}>
            <option value="">All conditions</option>
            {CONDITIONS.filter(Boolean).map(c => <option key={c} value={c}>Grade {c}</option>)}
          </select>
          <select value={wh} onChange={e => setWh(e.target.value)}>
            <option value="">All warehouses</option>
            {['JHB','CPT','BFN','DBN','EL','GEO','NEL','POL','PE'].map(w => <option key={w} value={w}>{w}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setCondition(''); setWh(''); setPage(0) }}>Clear</button>
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

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.serial_number || 'Asset Detail'} icon="🏭">
        {selected && (
          <>
            <div style={{ marginBottom: 16 }}>
              <span className={`tag tag-${condColor(selected.condition_grade)}`} style={{ fontSize: 12 }}>
                Grade {selected.condition_grade || '?'}
              </span>
              <span style={{ marginLeft: 8, fontSize: 11.5, color: 'var(--text3)' }}>
                {selected.asset_type || '—'}
              </span>
            </div>

            <div className="dl-grid">
              {[
                ['Serial Number', selected.serial_number],
                ['Description', selected.asset_description],
                ['Asset Type', selected.asset_type],
                ['Warehouse', selected.warehouse_id],
                ['Customer', selected.customer_name],
                ['Account', selected.customer_account],
                ['Location', selected.location_code],
                ['Last Scan', fmt(selected.last_scanned)],
                ['Created', fmt(selected.created_at)],
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
                <div className="empty-state" style={{ padding: 16 }}>No scan history</div>
              ) : (
                <table className="tbl" style={{ fontSize: 11.5 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Location</th>
                      <th>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assetHistory.map((h, i) => (
                      <tr key={i}>
                        <td>{fmt(h.scanned_at)}</td>
                        <td>{h.scan_type || '—'}</td>
                        <td>{h.location_code || '—'}</td>
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
