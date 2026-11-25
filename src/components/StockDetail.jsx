import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { num, condColor } from '../lib/helpers'

// 📦 Stock drill-down for one warehouse (script 062: coolerco_stock_detail) — Wanda 25 Nov:
// by model → condition → branding: total, ✅ available (Ready to Work, not promised), ⏳ pending (on an open case / picked), 🛠 not ready.
// Works for Magnum (COM) and for the self-managed clients (CoolerCo register). One line per model + branding + condition, with a subtotal per model.
export default function StockDetail({ client = 'MAGNUM', wh, whName, loc = 'all', onClose }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState('') // '' | available | pending | not_ready

  useEffect(() => {
    setRows(null); setErr(null)
    supabase.rpc('coolerco_stock_detail', { p_client: client, p_warehouse: wh }).then(({ data, error }) => {
      if (error) setErr(/does not exist|Could not find/i.test(error.message) ? 'The stock drill-down needs database script 062.' : error.message)
      else setRows(data || [])
    })
  }, [client, wh])

  const list = useMemo(() => (rows || []).filter(r => (loc === 'all' || r.location_type === loc)
    && (!only || r[only] > 0)
    && (!q.trim() || [r.model, r.condition, r.branding].some(v => String(v || '').toLowerCase().includes(q.trim().toLowerCase())))), [rows, loc, q, only])
  const add = (a, r) => ({ total: a.total + r.total, available: a.available + r.available, pending: a.pending + r.pending, not_ready: a.not_ready + r.not_ready })
  const zero = { total: 0, available: 0, pending: 0, not_ready: 0 }
  const models = useMemo(() => {
    const m = {}
    list.forEach(r => { const x = (m[r.model] ||= { model: r.model, ...zero, lines: [] }); Object.assign(x, add(x, r)); x.lines.push(r) })
    return Object.values(m).sort((a, b) => b.total - a.total)
  }, [list]) // eslint-disable-line react-hooks/exhaustive-deps
  const tot = list.reduce(add, zero)

  async function exportXlsx() {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(list.map(r => ({ Warehouse: whName || wh, Where: r.location_type, Model: r.model, Branding: r.branding, Condition: r.condition,
      Total: r.total, 'Pending (open case / picked)': r.pending, Available: r.available, 'Not ready': r.not_ready })))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Stock')
    XLSX.writeFile(wb, `Stock_${wh}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const Num = ({ v, c }) => v ? <b className={c ? `text-${c}` : ''} style={{ color: c ? `var(--${c})` : undefined }}>{num(v)}</b> : <span className="text3">—</span>
  return (
    <div className="card stock-detail" id="stock-detail">
      <div className="card-header" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="card-title">📦 {whName || wh} · stock by model, condition and branding</span>
        <div className="search-wrap" style={{ flex: 1, minWidth: 180 }}><span className="ico">🔍</span>
          <input placeholder="Model, condition or branding…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <button className="btn btn-ghost btn-sm" disabled={!list.length} onClick={exportXlsx}>⬇ Excel</button>
        {onClose && <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>}
      </div>
      {err && <div className="form-msg err">{err}</div>}
      {!rows && !err && <div className="load-state"><span className="spinner" /> Counting stock…</div>}
      {rows && (
        <>
          <div className="stats-row" style={{ padding: '10px 12px 0' }}>
            {[['', '📦 Total', tot.total, 'accent', 'in this warehouse' + (loc === 'all' ? ' + workshop' : '')],
              ['pending', '⏳ Pending', tot.pending, 'orange', 'on an open case or picked'],
              ['available', '✅ Available', tot.available, 'green', 'Ready to Work, not on a case'],
              ['not_ready', '🛠 Not ready', tot.not_ready, 'red', 'repair, branding, audit…']].map(([k, l, v, c, d]) => (
              <button key={l} type="button" className={`stat-card c-${c}`} aria-pressed={only === k} onClick={() => setOnly(only === k ? '' : k)}
                style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', outline: only === k && k ? '2px solid var(--accent)' : 'none' }}>
                <div className="stat-label">{l}</div><div className="stat-value">{num(v)}</div><div className="stat-sub">{d}</div>
              </button>))}
          </div>
          <div className="tbl-wrap">
            {/* Wanda 25 Nov: one line per model + branding + condition → total · pending · available (model subtotal under each model) */}
            <table className="tbl">
              <thead><tr><th>Model</th><th>Branding</th><th>Condition</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>⏳ Pending</th><th style={{ textAlign: 'right' }}>✅ Available</th><th style={{ textAlign: 'right' }}>🛠 Not ready</th></tr></thead>
              <tbody>
                {!models.length && <tr><td colSpan={7} className="text3">Nothing here.</td></tr>}
                {models.map(m => [
                  ...[...m.lines].sort((a, b) => String(a.branding).localeCompare(String(b.branding)) || String(a.condition).localeCompare(String(b.condition))).map((r, i) => (
                    <tr key={m.model + i}>
                      <td style={{ fontSize: 11.5 }}>{i === 0 ? <b>{m.model}</b> : ''}</td>
                      <td style={{ fontSize: 11 }}>{r.branding}{r.location_type === 'Workshop' && <span className="text3"> · 🛠 workshop</span>}</td>
                      <td><span className={`tag tag-${condColor(r.condition)}`}>{r.condition}</span></td>
                      <td style={{ textAlign: 'right' }}><b>{num(r.total)}</b></td>
                      <td style={{ textAlign: 'right' }}><Num v={r.pending} c="orange" /></td>
                      <td style={{ textAlign: 'right' }}><Num v={r.available} c="green" /></td>
                      <td style={{ textAlign: 'right' }}><Num v={r.not_ready} c="red" /></td>
                    </tr>)),
                  ...(m.lines.length > 1 ? [
                    <tr key={m.model + '_sum'} style={{ background: 'var(--surface2)' }}>
                      <td colSpan={3} className="text3" style={{ fontSize: 11, textAlign: 'right' }}>{m.model} · all brandings + conditions</td>
                      <td style={{ textAlign: 'right' }}><b>{num(m.total)}</b></td>
                      <td style={{ textAlign: 'right' }}><Num v={m.pending} c="orange" /></td>
                      <td style={{ textAlign: 'right' }}><Num v={m.available} c="green" /></td>
                      <td style={{ textAlign: 'right' }}><Num v={m.not_ready} c="red" /></td>
                    </tr>] : []),
                ])}
                {models.length > 0 && <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td colSpan={3}><b>All models</b></td>
                  <td style={{ textAlign: 'right' }}><b>{num(tot.total)}</b></td>
                  <td style={{ textAlign: 'right' }}><Num v={tot.pending} c="orange" /></td>
                  <td style={{ textAlign: 'right' }}><Num v={tot.available} c="green" /></td>
                  <td style={{ textAlign: 'right' }}><Num v={tot.not_ready} c="red" /></td>
                </tr>}
              </tbody>
            </table>
          </div>
          {client === 'MAGNUM' && <div className="text3" style={{ fontSize: 10.5, padding: 8 }}>Pending = chosen in the routing app's preparation for an open case, or named on an open COM case (same rule as Picking). <Link to={`/assets?wh=${wh}`}>See the coolers →</Link></div>}
        </>)}
    </div>
  )
}
