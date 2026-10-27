import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { fmt, num, condColor, SMARTSCAN_URL } from '../lib/helpers'

// Stock-take exceptions against SmartScan's stock-take period (asset_touch_periods → per-asset snapshot).
// Server-side: coolerco_stocktake_exceptions(period, warehouse) — read only.
// Scanned = CoolerCo bay scan or COM touch at an RTMA location between the period's start and end date.
const CATS = [
  ['notscanned', '❌ Not scanned', r => r.category === 'In baseline' && !r.scanned],
  ['out', '📤 Moved out', r => r.category === 'Moved out'],
  ['in', '📥 Moved in', r => r.category === 'Moved in'],
  ['exceptions', '⚠ All exceptions', r => r.category !== 'In baseline' || !r.scanned],
  ['scanned', '✅ Scanned', r => r.scanned],
  ['all', 'All', () => true],
]
const PAGE = 100
const fmtD = d => (d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '')

export default function StocktakeExceptions() {
  const [periods, setPeriods] = useState([])
  const [period, setPeriod] = useState('')
  const [wh, setWh] = useState('')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [cat, setCat] = useState('exceptions')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)

  const [noPeriods, setNoPeriods] = useState(false)
  useEffect(() => {
    supabase.from('asset_touch_periods').select('id,label,start_date,end_date,closed_at').eq('scope', 'warehouse').order('start_date', { ascending: false }).limit(20)
      .then(({ data }) => { setPeriods(data || []); if (data?.[0]) setPeriod(data[0].id); else { setNoPeriods(true); setRows([]) } })
  }, [])

  useEffect(() => {
    if (!period) return
    setRows(null); setErr(null); setShown(PAGE)
    // one server call per period/warehouse; filtering and counts happen in the browser (≈9k small rows)
    supabase.rpc('coolerco_stocktake_exceptions', { p_period: period, p_warehouse: wh || null }).limit(20000)
      .then(({ data, error }) => { if (error) setErr(error.message); setRows(data || []) })
  }, [period, wh])

  const p = periods.find(x => x.id === period)
  const whs = useMemo(() => [...new Set((rows || []).map(r => r.warehouse))].sort(), [rows])
  const stats = useMemo(() => {
    const r = rows || []
    const by = c => r.filter(x => x.category === c)
    const base = by('In baseline'), out = by('Moved out'), inn = by('Moved in')
    return {
      base: base.length, baseScanned: base.filter(x => x.scanned).length,
      out: out.length, outScanned: out.filter(x => x.scanned).length,
      in: inn.length, inScanned: inn.filter(x => x.scanned).length,
    }
  }, [rows])
  const list = useMemo(() => {
    const f = CATS.find(c => c[0] === cat)[2]
    const s = q.trim().toLowerCase()
    return (rows || []).filter(f).filter(r => !s || [r.asset_number, r.barcode, r.local_code, r.product_base].some(v => (v || '').toLowerCase().includes(s)))
  }, [rows, cat, q])
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0)

  async function exportXlsx() {
    const XLSX = await import('xlsx')
    const data = list.map(r => ({
      Warehouse: r.warehouse, Category: r.category, Scanned: r.scanned ? 'Yes' : 'No', 'Scanned by': r.scan_source || '', 'Last scan': r.last_scan_at ? fmt(r.last_scan_at) : '',
      'Scan location': r.scan_location || '', Asset: r.asset_number, Barcode: r.barcode, 'Local code': r.local_code, 'Product base': r.product_base, Condition: r.condition,
      'Status at snapshot': r.baseline_status || '', 'Status now': r.current_status || '', 'Location now': r.current_location || '', 'Account now': r.current_account || '',
    }))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Exceptions')
    XLSX.writeFile(wb, `CoolerCo_Stocktake_${(p?.label || 'period').replace(/\W+/g, '_')}_${wh || 'ALL'}_${cat}.xlsx`)
  }

  return (
    <>
      <Topbar title="Stock take exceptions" sub="Snapshot from SmartScan's stock take period vs scans (CoolerCo + COM)"
        actions={<><Link className="btn btn-ghost btn-sm" to="/scan">📷 Scan</Link><a className="btn btn-ghost btn-sm" href={SMARTSCAN_URL} target="_blank" rel="noopener noreferrer">📊 SmartScan ↗</a></>} />
      <div className="page-content">
        <div className="filters" style={{ flexWrap: 'wrap' }}>
          <select className="field-ctrl" style={{ width: 'auto' }} value={period} onChange={e => setPeriod(e.target.value)}>
            {!periods.length && <option value="">No stock take periods</option>}
            {periods.map(x => <option key={x.id} value={x.id}>{x.label} · {fmtD(x.start_date)} – {fmtD(x.end_date)}{x.closed_at ? ' (closed)' : ''}</option>)}
          </select>
          <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => setWh(e.target.value)}>
            <option value="">All warehouses</option>
            {(wh ? [wh] : whs).map(w => <option key={w} value={w}>{w.replace(/^RTMA /, '')}</option>)}
          </select>
          <div className="search-wrap" style={{ flex: 1 }}><span className="ico">🔍</span>
            <input placeholder="Asset, barcode, local code, model…" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE) }} /></div>
        </div>
        <div className="text3" style={{ fontSize: 10.5, marginBottom: 10 }}>
          The snapshot is set in SmartScan when the stock take period is opened. Scanned = a CoolerCo bay scan or a COM touch at an RTMA location between the start and end date.
        </div>

        {err && <div className="form-msg err">{err}</div>}
        <div className="stats-row">
          <div className="stat-card c-accent"><div className="stat-label">📦 In snapshot, still here</div><div className="stat-value">{rows ? num(stats.base) : '…'}</div>
            <div className="stat-sub">{num(stats.baseScanned)} scanned · {pct(stats.baseScanned, stats.base)}%</div></div>
          <div className="stat-card c-red"><div className="stat-label">❌ Not scanned</div><div className="stat-value">{rows ? num(stats.base - stats.baseScanned) : '…'}</div>
            <div className="stat-sub">in snapshot, still in the warehouse</div></div>
          <div className="stat-card c-orange"><div className="stat-label">📤 Moved out (exception)</div><div className="stat-value">{rows ? num(stats.out) : '…'}</div>
            <div className="stat-sub">{num(stats.outScanned)} scanned · {num(stats.out - stats.outScanned)} not</div></div>
          <div className="stat-card c-orange"><div className="stat-label">📥 Moved in (exception)</div><div className="stat-value">{rows ? num(stats.in) : '…'}</div>
            <div className="stat-sub">{num(stats.inScanned)} scanned · {num(stats.in - stats.inScanned)} not</div></div>
        </div>

        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 6 }}>
            <div className="seg">
              {CATS.map(([k, l, f]) => <button key={k} className={`seg-btn${cat === k ? ' on' : ''}`} onClick={() => { setCat(k); setShown(PAGE) }}>{l}{rows ? ` (${num(rows.filter(f).length)})` : ''}</button>)}
            </div>
            <button className="btn btn-ghost btn-sm" disabled={!list.length} onClick={exportXlsx}>⬇ Excel ({num(list.length)})</button>
          </div>
          {noPeriods ? <div className="empty-state"><div className="empty-ico">📋</div><div>No warehouse stock take period yet. Open one in <a href={SMARTSCAN_URL} target="_blank" rel="noopener noreferrer">SmartScan</a> — it takes the snapshot.</div></div>
            : !rows ? <div className="load-state"><span className="spinner" /> Comparing snapshot with scans…</div> : !list.length ? (
            <div className="empty-state"><div className="empty-ico">🎉</div><div>Nothing in this list.</div></div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Asset</th><th>Warehouse</th><th>Category</th><th>Scanned</th><th>Status snapshot → now</th><th>Where now</th></tr></thead>
                <tbody>{list.slice(0, shown).map(r => (
                  <tr key={r.asset_number + r.category}>
                    <td><Link to={`/assets?q=${encodeURIComponent(r.barcode || r.asset_number)}`} className="mono">{r.barcode || r.asset_number}</Link>
                      <div className="text3" style={{ fontSize: 10 }}>{r.product_base} {r.condition && <span className={`tag tag-${condColor(r.condition)}`}>{r.condition.charAt(0)}</span>}</div></td>
                    <td style={{ fontSize: 11 }}>{r.warehouse?.replace(/^RTMA /, '')}</td>
                    <td><span className={`tag tag-${r.category === 'In baseline' ? 'neutral' : 'orange'}`}>{r.category === 'In baseline' ? 'In snapshot' : r.category}</span></td>
                    <td>{r.scanned
                      ? <><span className="tag tag-green">✓ {r.scan_source}</span><div className="text3" style={{ fontSize: 10 }}>{fmt(r.last_scan_at)} · {r.scan_location}</div></>
                      : <span className="tag tag-red">✗ Not scanned</span>}</td>
                    <td style={{ fontSize: 11 }}>{r.baseline_status || '—'}{r.current_status && r.current_status !== r.baseline_status ? ` → ${r.current_status}` : ''}</td>
                    <td style={{ fontSize: 11 }}>{r.current_account || r.current_location || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
              {list.length > shown && <div style={{ padding: 10, textAlign: 'center' }}><button className="btn btn-ghost btn-sm" onClick={() => setShown(n => n + PAGE * 3)}>Show more ({num(list.length - shown)} left)</button></div>}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
