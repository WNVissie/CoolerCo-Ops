import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { fmt, num, condColor, WH_NAMES, whCaseName } from '../lib/helpers'

// Closure discrepancies: closed Deliver / Replacement cases where COM's "Asset Delivered" is not where the case says.
// Server-side: coolerco_closure_discrepancies(since, warehouse) (015, read only) — last 3 months by closure date.
const KINDS = [
  ['solved_other_pos', '⚠ Solved · asset at another store', 'red', 'Case solved, but the delivered asset is at a DIFFERENT store in COM.'],
  ['solved_in_wh', '🏬 Solved · asset not at a store', 'orange', 'Case solved, but the delivered asset is in an RTMA warehouse / workshop (never left, or came back).'],
  ['cancelled_at_pos', '🚫 Cancelled · asset at this store', 'accent', 'Case cancelled, but the asset on it IS at this store — delivered after all?'],
]
const KIND = Object.fromEntries(KINDS.map(k => [k[0], k]))
const PAGE = 100
const monthsAgo = n => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toLocaleDateString('en-CA') }

export default function ClosureDiscrepancies() {
  const [since, setSince] = useState(() => monthsAgo(3))
  const [wh, setWh] = useState('')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('all')
  const [showExplained, setShowExplained] = useState(false)
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    setRows(null); setErr(null); setShown(PAGE)
    supabase.rpc('coolerco_closure_discrepancies', { p_since: since, p_warehouse: wh ? whCaseName(wh) : null }).then(({ data, error }) => {
      if (!live) return
      if (error) setErr(/does not exist|Could not find/i.test(error.message) ? 'This report needs database script 015 — not applied yet.' : error.message)
      setRows(data || [])
    })
    return () => { live = false }
  }, [since, wh, tick])

  const open = useMemo(() => (rows || []).filter(r => !r.explained), [rows])
  const counts = useMemo(() => Object.fromEntries(KINDS.map(([k]) => [k, open.filter(r => r.kind === k).length])), [open])
  const explainedCount = (rows || []).length - open.length
  const byWh = useMemo(() => {
    const m = {}; for (const r of open) { const w = (r.warehouse || '—').replace(/^RTMA /, ''); m[w] = (m[w] || 0) + 1 }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [open])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (showExplained ? rows || [] : open).filter(r => tab === 'all' || r.kind === tab)
      .filter(r => !s || [r.case_number, r.point_of_sale, r.pos_local_code, r.asset, r.asset_bar_code, r.asset_local_code, r.concessionaire, r.asset_now]
        .some(v => String(v || '').toLowerCase().includes(s)))
  }, [rows, open, tab, q, showExplained])

  async function exportXlsx() {
    const XLSX = await import('xlsx')
    const data = list.map(r => ({
      Discrepancy: KIND[r.kind]?.[1].replace(/^\S+ /, ''), 'Explained by later case': r.explained ? 'Yes' : 'No',
      'Case no.': r.case_number, 'Case type': r.case_type, Status: r.status_reason, Closed: fmt(r.closed_on), Created: fmt(r.created_on),
      Warehouse: r.warehouse, 'Case store': r.point_of_sale, 'Case POS code': r.pos_local_code, Concessionaire: r.concessionaire,
      'Asset delivered': r.asset, Barcode: r.asset_bar_code, 'Local code': r.asset_local_code, Model: r.asset_product_base, Condition: r.asset_condition,
      'Asset status (COM)': r.asset_status, 'COM has it at': r.asset_now, 'COM location type': r.asset_now_location, 'COM POS code': r.asset_now_pos_code,
      'Later case': r.later_case || '', 'Later case type': r.later_case_type || '', 'Later case status': r.later_case_status || '', 'Later case created': r.later_case_created ? fmt(r.later_case_created) : '',
    }))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Closure discrepancies')
    XLSX.writeFile(wb, `CoolerCo_Closure_discrepancies_${wh || 'ALL'}_since_${since}.xlsx`)
  }

  return (
    <>
      <Topbar title="Closure discrepancies" sub="Closed deliver & replacement cases where COM's Asset Delivered is not at that store"
        actions={<button className="btn btn-ghost btn-sm" disabled={!rows} onClick={() => setTick(n => n + 1)}>↻ Refresh</button>} />
      <div className="page-content">
        <div className="filters" style={{ flexWrap: 'wrap', gap: 8 }}>
          <label className="text3" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>Closed since
            <input type="date" className="field-ctrl" style={{ width: 'auto' }} value={since} onChange={e => e.target.value && setSince(e.target.value)} /></label>
          <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => setWh(e.target.value)}>
            <option value="">🏢 All warehouses</option>
            {Object.entries(WH_NAMES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
          <div className="search-wrap" style={{ flex: 1, minWidth: 180 }}><span className="ico">🔍</span>
            <input placeholder="Case no., store, L-code, barcode, concessionaire…" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE) }} /></div>
        </div>
        {err && <div className="form-msg err">{err}</div>}

        <div className="stats-row">
          {KINDS.map(([k, l, c, d]) => (
            <div key={k} className={`stat-card c-${c}`} style={{ cursor: 'pointer', outline: tab === k ? '2px solid var(--accent)' : 'none' }} onClick={() => { setTab(tab === k ? 'all' : k); setShown(PAGE) }} title={d}>
              <div className="stat-label">{l}</div><div className="stat-value">{rows ? num(counts[k]) : '…'}</div><div className="stat-sub">{d}</div></div>))}
          <div className="stat-card" style={{ cursor: 'pointer', outline: showExplained ? '2px solid var(--accent)' : 'none' }} onClick={() => setShowExplained(v => !v)}>
            <div className="stat-label">ℹ Explained by a later case</div><div className="stat-value">{rows ? num(explainedCount) : '…'}</div>
            <div className="stat-sub">the asset was on a newer case (e.g. removed or replaced since) — {showExplained ? 'shown' : 'hidden, tap to show'}</div></div>
        </div>
        {byWh.length > 0 && <div className="text3" style={{ fontSize: 11, marginBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>By warehouse: {byWh.map(([w, n]) => <span key={w} className="tag tag-neutral">{w} {num(n)}</span>)}</div>}

        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 6 }}>
            <div className="seg">
              <button className={`seg-btn${tab === 'all' ? ' on' : ''}`} onClick={() => setTab('all')}>All</button>
              {KINDS.map(([k, l]) => <button key={k} className={`seg-btn${tab === k ? ' on' : ''}`} onClick={() => { setTab(k); setShown(PAGE) }}>{l.split(' · ')[0]} · {l.split(' · ')[1]?.replace(/^asset /, '')}</button>)}
            </div>
            <label className="text3" style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={showExplained} onChange={e => setShowExplained(e.target.checked)} /> include explained</label>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} disabled={!list.length} onClick={exportXlsx}>⬇ Excel ({num(list.length)})</button>
          </div>
          {!rows ? <div className="load-state"><span className="spinner" /> Checking closed cases against COM assets…</div> : !list.length ? (
            <div className="empty-state"><div className="empty-ico">🎉</div><div>No discrepancies in this list.</div></div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Discrepancy</th><th>Case</th><th>Case store</th><th>Asset delivered</th><th>COM has it at</th></tr></thead>
                <tbody>{list.slice(0, shown).map(r => {
                  const k = KIND[r.kind]
                  return (
                    <tr key={r.kind + r.case_number} style={r.explained ? { opacity: .65 } : undefined}>
                      <td><span className={`tag tag-${k[2] === 'accent' ? 'blue' : k[2]}`}>{k[1]}</span>
                        {r.explained && <div className="text3" style={{ fontSize: 10, marginTop: 3 }}>ℹ later case <Link className="mono" to={`/cases?case=${encodeURIComponent(r.later_case)}`}>{r.later_case}</Link><br />{r.later_case_type} · {r.later_case_status} · {fmt(r.later_case_created)}</div>}</td>
                      <td><Link className="mono" to={`/cases?case=${encodeURIComponent(r.case_number)}`}>{r.case_number}</Link>
                        <div className="text3" style={{ fontSize: 10 }}>{r.case_type} · {r.status_reason}</div>
                        <div className="text3" style={{ fontSize: 10 }}>closed {fmt(r.closed_on)}</div></td>
                      <td style={{ fontSize: 11 }}>{r.point_of_sale}<div className="text3 mono" style={{ fontSize: 10 }}>{r.pos_local_code} · {(r.warehouse || '').replace(/^RTMA /, '')}</div>
                        <div className="text3 trunc" style={{ fontSize: 10, maxWidth: 180 }} title={r.concessionaire}>{r.concessionaire}</div></td>
                      <td style={{ fontSize: 11 }}><Link className="mono" to={`/assets?q=${encodeURIComponent(r.asset_bar_code || r.asset)}`}>{r.asset_bar_code || r.asset}</Link>
                        <div className="text3" style={{ fontSize: 10 }}>{r.asset_product_base} {r.asset_condition && <span className={`tag tag-${condColor(r.asset_condition)}`}>{r.asset_condition.charAt(0)}</span>}</div>
                        <div className="text3" style={{ fontSize: 10 }}>{r.asset_status}</div></td>
                      <td style={{ fontSize: 11 }}><b>{r.asset_now || '—'}</b><div className="text3 mono" style={{ fontSize: 10 }}>{r.asset_now_location}{r.asset_now_pos_code ? ` · ${r.asset_now_pos_code}` : ''}</div></td>
                    </tr>)
                })}</tbody>
              </table>
              {list.length > shown && <div style={{ padding: 10, textAlign: 'center' }}><button className="btn btn-ghost btn-sm" onClick={() => setShown(n => n + PAGE * 3)}>Show more ({num(list.length - shown)} left)</button></div>}
            </div>
          )}
        </div>
        <div className="text3" style={{ fontSize: 10.5, marginTop: 8 }}>Closed = Solved or Cancelled, by service closure date. "COM has it at" = COM's asset register now (last COM upload). A later case on the same asset usually means it legitimately moved after closure — those are hidden unless you tick "include explained". Read only — correct the case or asset in COM.</div>
      </div>
    </>
  )
}
