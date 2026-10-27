import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { fmt, num, condColor, WH_NAMES } from '../lib/helpers'

// Scan report by warehouse — which assets were scanned, where, when and with what result.
// Server-side: coolerco_scan_report() (012, read only) does the counting for the whole period
// and returns one page of rows, so the browser never downloads thousands of scans to count them.
// Sources: 🟦 COM touches (asset_touch at an RTMA WH/WS) + 🟩 CoolerCo bay scans (coolerco_asset_touch).

const PAGE = 100
const MAX_EXPORT = 20000
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }
const PRESETS = [
  ['today', 'Today', () => [today(), today()]],
  ['yday', 'Yesterday', () => [addDays(today(), -1), addDays(today(), -1)]],
  ['7d', '7 days', () => [addDays(today(), -6), today()]],
  ['30d', '30 days', () => [addDays(today(), -29), today()]],
  ['month', 'This month', () => [today().slice(0, 8) + '01', today()]],
]
const SOURCES = [['all', 'All'], ['com', '🟦 COM'], ['coolerco', '🟩 CoolerCo']]
const RESULTS = [['all', 'All'], ['accepted', '✅ Accepted'], ['discarded', '🚫 Discarded'], ['pending', '⏳ Pending'], ['mismatch', '⚠ Mismatch']]
const resultTag = r => r === 'Accepted' ? 'green' : r === 'Discarded' ? 'red' : 'neutral'
const fmtT = d => (d ? new Date(d).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—')
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)

export default function ScanReport() {
  const [preset, setPreset] = useState('7d')
  const [[from, to], setRange] = useState(PRESETS[2][2]())
  const [wh, setWh] = useState('')
  const [source, setSource] = useState('all')
  const [result, setResult] = useState('all')
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [data, setData] = useState(null)
  const [rows, setRows] = useState([])
  const [err, setErr] = useState(null)
  const [more, setMore] = useState(false)
  const [lastCom, setLastCom] = useState(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 380); return () => clearTimeout(t) }, [q])

  // Last COM import date — loaded in parallel, tells the user how fresh the COM side is
  useEffect(() => {
    supabase.from('asset_touch').select('touched_at').order('touched_at', { ascending: false }).limit(1)
      .then(({ data }) => setLastCom(data?.[0]?.touched_at || null))
  }, [])

  const args = { p_from: from, p_to: to, p_warehouse: wh || null, p_source: source, p_result: result, p_search: dq || null }
  useEffect(() => {
    let live = true
    setData(null); setErr(null)
    supabase.rpc('coolerco_scan_report', { ...args, p_limit: PAGE, p_offset: 0 }).then(({ data, error }) => {
      if (!live) return
      if (error) { setErr(/does not exist|Could not find/i.test(error.message) ? 'The scan report needs database script 012 — not applied yet.' : error.message); setData({ total: 0, summary: [], days: [], users: [] }); setRows([]); return }
      setData(data); setRows(data.rows || [])
    })
    return () => { live = false }
  }, [from, to, wh, source, result, dq]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    setMore(true)
    const { data: d } = await supabase.rpc('coolerco_scan_report', { ...args, p_limit: PAGE * 3, p_offset: rows.length })
    setRows(r => [...r, ...(d?.rows || [])]); setMore(false)
  }

  async function exportXlsx() {
    const total = data?.total || 0
    if (total > MAX_EXPORT && !confirm(`${num(total)} scans — only the newest ${num(MAX_EXPORT)} fit in one file. Continue?`)) return
    setExporting(true)
    const [{ data: d }, XLSX] = await Promise.all([
      supabase.rpc('coolerco_scan_report', { ...args, p_limit: MAX_EXPORT, p_offset: 0 }),
      import('xlsx'),
    ])
    const list = (d?.rows || []).map(r => ({
      'Scanned at': r.at ? new Date(r.at).toLocaleString('en-ZA', { hour12: false }) : '', Source: r.source, Warehouse: WH_NAMES[r.wh] || r.wh, 'WH / WS': r.wh_ws,
      Asset: r.asset, Barcode: r.barcode, 'Local code': r.local_code, 'Product base': r.product_base, Condition: r.condition,
      'Scanned by': r.scanned_by, Bay: r.bay || '', Result: r.result || '', Mismatch: r.mismatch ? 'Yes' : 'No', Note: r.note || '',
    }))
    const sum = (d?.summary || []).map(s => ({
      Warehouse: s.name, Scans: s.scans, 'Unique assets': s.assets, 'COM touches': s.com_scans, 'CoolerCo scans': s.coolerco_scans,
      Accepted: s.accepted, Discarded: s.discarded, Mismatches: s.mismatches, Workshop: s.workshop, 'Last scan': s.last_at ? new Date(s.last_at).toLocaleString('en-ZA', { hour12: false }) : '',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sum), 'By warehouse')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(list), 'Scans')
    XLSX.writeFile(wb, `CoolerCo_Scan_Report_${wh || 'ALL'}_${from}_to_${to}.xlsx`)
    setExporting(false)
  }

  const totals = useMemo(() => (data?.summary || []).reduce((t, s) => ({
    scans: t.scans + s.scans, assets: t.assets + s.assets, accepted: t.accepted + s.accepted,
    discarded: t.discarded + s.discarded, mismatches: t.mismatches + s.mismatches,
  }), { scans: 0, assets: 0, accepted: 0, discarded: 0, mismatches: 0 }), [data])
  const maxDay = Math.max(1, ...(data?.days || []).map(d => d.scans))
  const comStale = lastCom && (source !== 'coolerco') && to > lastCom.slice(0, 10)

  return (
    <>
      <Topbar title="Scan report" sub="Assets scanned by warehouse — COM touches + CoolerCo bay scans"
        actions={<Link className="btn btn-ghost btn-sm" to="/scan">📷 Scan</Link>} />
      <div className="page-content">
        {/* ── Filters ── */}
        <div className="filters" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="seg">
            {PRESETS.map(([k, l, f]) => <button key={k} className={`seg-btn${preset === k ? ' on' : ''}`} onClick={() => { setPreset(k); setRange(f()) }}>{l}</button>)}
          </div>
          <input type="date" className="field-ctrl" style={{ width: 'auto' }} value={from} max={to} onChange={e => { setPreset(''); setRange([e.target.value, to]) }} />
          <input type="date" className="field-ctrl" style={{ width: 'auto' }} value={to} min={from} onChange={e => { setPreset(''); setRange([from, e.target.value]) }} />
          <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => setWh(e.target.value)}>
            <option value="">🏢 All warehouses</option>
            {Object.entries(WH_NAMES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
          <div className="seg">{SOURCES.map(([k, l]) => <button key={k} className={`seg-btn${source === k ? ' on' : ''}`} onClick={() => setSource(k)}>{l}</button>)}</div>
          <div className="search-wrap" style={{ flex: 1, minWidth: 180 }}><span className="ico">🔍</span>
            <input placeholder="Asset, barcode, local code, model, user…" value={q} onChange={e => setQ(e.target.value)} /></div>
        </div>
        <div className="text3" style={{ fontSize: 10.5, marginBottom: 10 }}>
          🟦 COM = touches in COM's Asset Touch import at an RTMA warehouse/workshop · 🟩 CoolerCo = bay scans in this app.
          {lastCom && <> COM data up to <strong>{fmtT(lastCom)}</strong>.</>}
          {comStale && <span className="tag tag-orange" style={{ marginLeft: 6 }}>Newer COM touches appear after the next COM upload</span>}
        </div>
        {err && <div className="form-msg err">{err}</div>}

        {/* ── Totals ── */}
        <div className="stats-row">
          <div className="stat-card c-accent"><div className="stat-label">📷 Scans</div><div className="stat-value">{data ? num(totals.scans) : '…'}</div>
            <div className="stat-sub">{from === to ? from : `${from} → ${to}`}</div></div>
          <div className="stat-card"><div className="stat-label">🧊 Unique assets</div><div className="stat-value">{data ? num(totals.assets) : '…'}</div>
            <div className="stat-sub">counted once per warehouse</div></div>
          <div className="stat-card c-green"><div className="stat-label">✅ Accepted by COM</div><div className="stat-value">{data ? num(totals.accepted) : '…'}</div>
            <div className="stat-sub">{pct(totals.accepted, totals.scans)}% of scans</div></div>
          <div className="stat-card c-red"><div className="stat-label">🚫 Discarded by COM</div><div className="stat-value">{data ? num(totals.discarded) : '…'}</div>
            <div className="stat-sub">{pct(totals.discarded, totals.scans)}% · e.g. open case</div></div>
          <div className="stat-card c-orange"><div className="stat-label">⚠ Mismatches</div><div className="stat-value">{data ? num(totals.mismatches) : '…'}</div>
            <div className="stat-sub">condition, location, serial, model, bay</div></div>
        </div>

        {/* ── By warehouse (click a card to filter) ── */}
        <details className="sec" open>
          <summary>🏢 By warehouse {wh && <span className="tag tag-blue" style={{ marginLeft: 6 }}>{WH_NAMES[wh]} <span className="linkish" onClick={e => { e.preventDefault(); setWh('') }}>✕</span></span>}</summary>
          <div className="sec-body">
            {!data ? <div className="load-state"><span className="spinner" /> Counting scans…</div>
              : !data.summary.length ? <div className="empty-state"><div className="empty-ico">📭</div><div>No scans in this period.</div></div>
              : <div className="wh-grid">{data.summary.map(s => (
                <div key={s.code} className="card wh-card" style={{ cursor: 'pointer', outline: wh === s.code ? '2px solid var(--accent)' : 'none' }} onClick={() => setWh(wh === s.code ? '' : s.code)}>
                  <div className="wh-card-hd">
                    <div><strong>{s.name}</strong><div className="text3" style={{ fontSize: 10.5 }}>last scan {fmtT(s.last_at)}</div></div>
                    <div className="wh-total">{num(s.scans)}<small>{num(s.assets)} assets</small></div>
                  </div>
                  <div className="bay-bar" title={`Accepted ${s.accepted} · Discarded ${s.discarded} · other ${s.scans - s.accepted - s.discarded}`}>
                    <div style={{ width: pct(s.accepted, s.scans) + '%', background: 'var(--green)' }} />
                    <div style={{ width: pct(s.discarded, s.scans) + '%', background: 'var(--red)' }} />
                  </div>
                  <div className="wh-card-body" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, fontSize: 11 }}>
                    <span className="tag tag-green">✅ {num(s.accepted)}</span>
                    <span className="tag tag-red">🚫 {num(s.discarded)}</span>
                    {s.mismatches > 0 && <span className="tag tag-orange">⚠ {num(s.mismatches)}</span>}
                    {s.com_scans > 0 && <span className="tag tag-blue">🟦 {num(s.com_scans)}</span>}
                    {s.coolerco_scans > 0 && <span className="tag tag-teal">🟩 {num(s.coolerco_scans)}</span>}
                    {s.workshop > 0 && <span className="tag tag-neutral">🔧 WS {num(s.workshop)}</span>}
                  </div>
                </div>))}</div>}
          </div>
        </details>

        {/* ── By day + by user (folded, small) ── */}
        {data && data.days.length > 1 && (
          <details className="sec">
            <summary>📅 By day ({data.days.length} days)</summary>
            <div className="sec-body">{data.days.map(d => (
              <div key={d.day} className="wh-row"><div className="wh-name">{new Date(d.day + 'T12:00:00').toLocaleDateString('en-ZA', { weekday: 'short', day: '2-digit', month: 'short' })}</div>
                <div className="wh-bar-wrap"><div className="wh-bar" style={{ width: (d.scans / maxDay) * 100 + '%' }} /></div>
                <div className="wh-qty">{num(d.scans)}</div></div>))}</div>
          </details>
        )}
        {data && data.users.length > 0 && (
          <details className="sec">
            <summary>👤 By user ({data.users.length})</summary>
            <div className="sec-body">{data.users.map(u => (
              <div key={u.wh + u.scanned_by} className="wh-row"><div className="wh-name trunc" title={u.scanned_by}>{u.scanned_by || '—'}</div>
                <div className="text3" style={{ width: 90, fontSize: 11 }}>{WH_NAMES[u.wh] || u.wh}</div>
                <div className="wh-bar-wrap"><div className="wh-bar" style={{ width: (u.scans / data.users[0].scans) * 100 + '%' }} /></div>
                <div className="wh-qty">{num(u.scans)}</div></div>))}</div>
          </details>
        )}

        {/* ── Scanned assets list ── */}
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 6 }}>
            <div className="seg">{RESULTS.map(([k, l]) => <button key={k} className={`seg-btn${result === k ? ' on' : ''}`} onClick={() => setResult(k)}>{l}</button>)}</div>
            <span className="text3" style={{ fontSize: 11 }}>{data ? `${num(data.total)} scans` : ''}</span>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} disabled={!data?.total || exporting} onClick={exportXlsx}>{exporting ? '⏳ Preparing…' : `⬇ Excel (${num(data?.total || 0)})`}</button>
          </div>
          {!data ? <div className="load-state"><span className="spinner" /> Loading scans…</div> : !rows.length ? (
            <div className="empty-state"><div className="empty-ico">📭</div><div>No scans match these filters.</div></div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>When</th><th>Asset</th><th>Warehouse</th><th>Scanned by</th><th>Result</th></tr></thead>
                <tbody>{rows.map((r, i) => (
                  <tr key={r.source + r.asset_key + r.at + i}>
                    <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fmtT(r.at)}<div className="text3" style={{ fontSize: 10 }}>{r.source === 'COM' ? '🟦 COM' : '🟩 CoolerCo'}</div></td>
                    <td><Link to={`/assets?q=${encodeURIComponent(r.barcode || r.asset)}`} className="mono">{r.barcode || r.asset}</Link>
                      <div className="text3" style={{ fontSize: 10 }}>{r.product_base} {r.condition && <span className={`tag tag-${condColor(r.condition)}`}>{r.condition.charAt(0)}</span>}</div></td>
                    <td style={{ fontSize: 11 }}>{WH_NAMES[r.wh] || r.wh} {r.wh_ws === 'WS' && <span className="tag tag-neutral">WS</span>}{r.bay && <div className="text3" style={{ fontSize: 10 }}>Bay {r.bay}{r.bay_ok === false ? ' ⚠' : ''}</div>}</td>
                    <td style={{ fontSize: 11 }}>{r.scanned_by || '—'}</td>
                    <td><span className={`tag tag-${resultTag(r.result)}`}>{r.result || '—'}</span>{r.mismatch && <span className="tag tag-orange" style={{ marginLeft: 4 }}>⚠</span>}
                      {r.note && <div className="text3 trunc" style={{ fontSize: 10, maxWidth: 220 }} title={r.note}>{r.note}</div>}</td>
                  </tr>))}</tbody>
              </table>
              {rows.length < data.total && <div style={{ padding: 10, textAlign: 'center' }}>
                <button className="btn btn-ghost btn-sm" disabled={more} onClick={loadMore}>{more ? '⏳' : `Show more (${num(data.total - rows.length)} left)`}</button></div>}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
