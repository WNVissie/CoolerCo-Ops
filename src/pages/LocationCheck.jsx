import { useState, useEffect, useMemo } from 'react'
import Topbar from '../components/Topbar'
import DataTable from '../components/DataTable'
import Drawer from '../components/Drawer'
import { supabase } from '../lib/supabase'
import { fmt, num, PS, WAREHOUSES, WH_NAMES, condColor } from '../lib/helpers'
import { AssetDetail } from './Assets'

// Expected place (setup rules) vs last CoolerCo scan — worked out on the server
export const CHECKS = [
  { key: 'WORKSHOP_NO_CASE', icon: '🛠️', label: 'Workshop, no repair case', color: 'red', tip: 'Return to Main WH or open a Repair at Workshop case' },
  { key: 'WRONG_PLACE',      icon: '↔️', label: 'In the wrong building/area', color: 'orange', tip: 'Move to the expected place' },
  { key: 'WRONG_WAREHOUSE',  icon: '🏢', label: 'Scanned at another warehouse', color: 'orange', tip: 'COM and the scan disagree' },
  { key: 'NO_AREA_ON_SCAN',  icon: '❔', label: 'Scan has no area', color: 'neutral', tip: 'Rescan choosing a building/area' },
  { key: 'NO_RULE',          icon: '📐', label: 'No rule for this status', color: 'purple', tip: 'Add a rule in Setup' },
  { key: 'NOT_SCANNED',      icon: '📷', label: 'Not scanned yet', color: 'neutral', tip: 'No CoolerCo bay scan yet' },
  { key: 'OK',               icon: '✅', label: 'In the right place', color: 'green', tip: '' },
]

export default function LocationCheck() {
  const [summary, setSummary] = useState(null)
  const [wh, setWh] = useState('')
  const [check, setCheck] = useState('WORKSHOP_NO_CASE')
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    supabase.from('coolerco_asset_location_summary').select('*').then(({ data }) => setSummary(data || []))
  }, [])

  useEffect(() => { setPage(0) }, [wh, check])

  // Detail list loads only for the chosen flag (lazy, paged)
  useEffect(() => {
    setLoading(true)
    let q = supabase.from('coolerco_asset_location_check')
      .select('name,bar_code,local_code,asset_status,condition,product_base,warehouse_code,assign_account,expected_location,scanned_location,last_scan_at,last_scanned_by', { count: 'exact' })
      .eq('check_result', check)
    if (wh) q = q.eq('warehouse_code', wh)
    q.order('warehouse_code').order('name').range(page * PS, page * PS + PS - 1)
      .then(({ data, count }) => { setRows(data || []); setCount(count || 0); setLoading(false) })
  }, [wh, check, page])

  const totals = useMemo(() => {
    const m = {}
    ;(summary || []).filter(r => !wh || r.warehouse_code === wh).forEach(r => { m[r.check_result] = (m[r.check_result] || 0) + r.assets })
    return m
  }, [summary, wh])

  const byWh = useMemo(() => WAREHOUSES.map(code => {
    const list = (summary || []).filter(r => r.warehouse_code === code)
    const flags = list.filter(r => !['OK', 'NOT_SCANNED'].includes(r.check_result)).reduce((t, r) => t + r.assets, 0)
    const expected = {}
    list.forEach(r => { const k = r.expected_location || 'No rule'; expected[k] = (expected[k] || 0) + r.assets })
    return { code, flags, total: list.reduce((t, r) => t + r.assets, 0), expected: Object.entries(expected).sort((a, b) => b[1] - a[1]) }
  }), [summary])

  const active = CHECKS.find(c => c.key === check)
  const COLS = [
    { key: 'bar_code', label: 'Barcode', cls: 'mono' },
    { key: 'local_code', label: 'Local code', cls: 'mono' },
    { key: 'product_base', label: 'Product', render: v => <span className="trunc" style={{ maxWidth: 150, display: 'block' }} title={v}>{v || '—'}</span> },
    { key: 'condition', label: 'Cond.', render: v => v ? <span className={`tag tag-${condColor(v)}`}>{v}</span> : '—' },
    { key: 'asset_status', label: 'COM status' },
    { key: 'warehouse_code', label: 'WH', render: v => WH_NAMES[v] || v || '—' },
    { key: 'expected_location', label: 'Should be in', render: v => v ? <strong>{v}</strong> : '—' },
    { key: 'scanned_location', label: 'Last scanned in', render: (v, r) => v ? <span>{v}<div className="text3" style={{ fontSize: 10 }}>{fmt(r.last_scan_at)}</div></span> : '—' },
  ]

  return (
    <>
      <Topbar title="Location Check" sub="Where each asset should be vs where it was last scanned" />
      <div className="page-content">
        <div className="filters">
          <select value={wh} onChange={e => setWh(e.target.value)}>
            <option value="">🏢 All warehouses</option>
            {WAREHOUSES.map(w => <option key={w} value={w}>{WH_NAMES[w]}</option>)}
          </select>
        </div>

        <div className="check-chips">
          {CHECKS.map(c => (
            <button key={c.key} className={`check-chip tag-${c.color}${check === c.key ? ' on' : ''}`} onClick={() => setCheck(c.key)} title={c.tip}>
              <span>{c.icon} {c.label}</span><strong>{summary ? num(totals[c.key] || 0) : '…'}</strong>
            </button>
          ))}
        </div>

        <details className="sec">
          <summary>🏠 Expected placement per warehouse</summary>
          <div className="sec-body wh-grid">
            {byWh.filter(w => w.total).map(w => (
              <div key={w.code} className="card" style={{ padding: 10 }}>
                <div className="card-title" style={{ marginBottom: 6 }}>🏢 {WH_NAMES[w.code]} {w.flags ? <span className="tag tag-orange">⚠ {num(w.flags)}</span> : null}</div>
                {w.expected.map(([k, n]) => <div key={k} className="mini-row"><span>{k}</span><span>{num(n)}</span></div>)}
              </div>
            ))}
          </div>
        </details>

        <div className="card">
          <div className="card-header">
            <span className="card-title">{active.icon} {active.label}</span>
            <span className="card-count">{num(count)} assets{active.tip ? ` · ${active.tip}` : ''}</span>
          </div>
          <DataTable cols={COLS} rows={rows} count={count} page={page} setPage={setPage} loading={loading}
            onRowClick={async r => {
              const { data } = await supabase.from('assets_live').select('*').eq('name', r.name).maybeSingle()
              setSelected(data || r)
            }} />
        </div>
      </div>
      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.bar_code ? `Barcode ${selected.bar_code}` : 'Asset'} icon="🧊">
        {selected && <AssetDetail a={selected} />}
      </Drawer>
    </>
  )
}
