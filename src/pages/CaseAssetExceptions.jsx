import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { fmt, num, condColor, slaColor, WH_NAMES, whCaseName } from '../lib/helpers'

// Open cases where COM already shows the asset at the store (or back in the warehouse) — the case was not closed.
// Server-side: coolerco_open_case_asset_exceptions(since, warehouse) (014, read only) does the matching;
// the browser only filters the few hundred rows it returns.
const KINDS = [
  ['delivered_open', '✅ Delivered, still open', 'green', 'The asset picked / prepared for this case is already at this store.'],
  ['other_pos', '⚠ At another store', 'red', 'The asset picked / prepared for this case is at a DIFFERENT store.'],
]
// Wanda 2026-10-27: ONLY flag cases where the asset picked / prepared is already at a POS.
// (The database function also returns 'collected_open' and 'possible' — not shown.)
const SHOWN = new Set(KINDS.map(k => k[0]))
const KIND = Object.fromEntries(KINDS.map(k => [k[0], k]))
const PAGE = 100
const REFRESH_MS = 5 * 60 * 1000 // re-check every 5 minutes while the page is open and visible
const SEEN_KEY = 'cc_case_asset_seen'
const keyOf = r => `${r.kind}|${r.case_number}`
const loadSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')) } catch { return new Set() } }
const hhmm = d => d ? new Date(d).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : ''

export default function CaseAssetExceptions() {
  const [since, setSince] = useState('2026-07-01')
  const [wh, setWh] = useState('')
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [open, setOpen] = useState(null) // case with candidates unfolded
  const [tick, setTick] = useState(0)     // bump = check again
  const [checkedAt, setCheckedAt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [seen, setSeen] = useState(loadSeen) // exceptions already looked at on this device → the rest show 🆕
  const [comAt, setComAt] = useState(null)

  // Live: every load reads the latest COM upload. Re-checks every 5 min (only while visible) and when you come back to the tab.
  useEffect(() => {
    let live = true
    setErr(null); setBusy(true)
    Promise.all([
      supabase.rpc('coolerco_open_case_asset_exceptions', { p_since: since, p_warehouse: wh ? whCaseName(wh) : null }),
      supabase.from('assets_live').select('last_synced_at').order('last_synced_at', { ascending: false, nullsFirst: false }).limit(1),
    ]).then(([{ data, error }, a]) => {
      if (!live) return
      if (error) setErr(/does not exist|Could not find/i.test(error.message) ? 'This report needs database script 014 — not applied yet.' : error.message)
      else setRows((data || []).filter(r => SHOWN.has(r.kind)))
      setComAt(a.data?.[0]?.last_synced_at || null); setCheckedAt(new Date()); setBusy(false)
    })
    return () => { live = false }
  }, [since, wh, tick])
  useEffect(() => { setRows(null); setShown(PAGE) }, [since, wh])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') setTick(n => n + 1) }, REFRESH_MS)
    const back = () => { if (document.visibilityState === 'visible' && checkedAt && Date.now() - checkedAt > 60000) setTick(n => n + 1) }
    document.addEventListener('visibilitychange', back)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', back) }
  }, [checkedAt])
  const newCount = (rows || []).filter(r => !seen.has(keyOf(r))).length
  function markSeen() {
    const next = new Set([...seen, ...(rows || []).map(keyOf)])
    setSeen(next); try { localStorage.setItem(SEEN_KEY, JSON.stringify([...next].slice(-3000))) } catch { /* ignore */ }
  }

  const counts = useMemo(() => Object.fromEntries(KINDS.map(([k]) => [k, (rows || []).filter(r => r.kind === k).length])), [rows])
  const byWh = useMemo(() => {
    const m = {}
    for (const r of rows || []) { const w = (r.warehouse || '—').replace(/^RTMA /, ''); m[w] = (m[w] || 0) + 1 }
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [rows])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (rows || []).filter(r => tab === 'all' || r.kind === tab)
      .filter(r => !s || [r.case_number, r.point_of_sale, r.pos_local_code, r.asset, r.asset_bar_code, r.concessionaire,
        ...(r.candidates || []).flatMap(c => [c.bar_code, c.asset])].some(v => String(v || '').toLowerCase().includes(s)))
  }, [rows, tab, q])

  async function exportXlsx() {
    const XLSX = await import('xlsx')
    const data = list.flatMap(r => {
      const base = {
        Exception: KIND[r.kind]?.[1].replace(/^\S+ /, ''), 'Case no.': r.case_number, 'Case type': r.case_type, Status: r.status_reason,
        Created: fmt(r.created_on), 'End date': fmt(r.end_date), SLA: r.sla_status, Warehouse: r.warehouse, Store: r.point_of_sale, 'POS code': r.pos_local_code,
        Concessionaire: r.concessionaire, 'Requested model': r.requested_product_base, 'Requested condition': r.requested_condition, 'Product family': r.requested_family,
      }
      if (r.kind !== 'possible') return [{ ...base, Asset: r.asset, Barcode: r.asset_bar_code, 'Local code': r.asset_local_code, Model: r.asset_product_base,
        Condition: r.asset_condition, 'Asset from': r.asset_source, 'Picked at': r.picked_at ? fmt(r.picked_at) : '', 'Asset is now at': r.asset_now }]
      return (r.candidates || []).map(c => ({ ...base, Asset: c.asset, Barcode: c.bar_code, 'Local code': c.local_code, Model: c.product_base, Condition: c.condition,
        'Asset from': 'Candidate at this store', Match: c.same_model ? (c.same_condition ? 'Strong (same model + condition)' : 'Same model') : 'Same family' }))
    })
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Exceptions')
    XLSX.writeFile(wb, `CoolerCo_Open_case_asset_at_POS_${wh || 'ALL'}_${tab}.xlsx`)
  }

  return (
    <>
      <Topbar title="Open case · asset at POS" sub="Open deliver & replacement cases where the asset picked / prepared is already at a POS"
        actions={<button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setTick(n => n + 1)}>{busy ? '⏳ Checking…' : '↻ Refresh'}</button>} />
      <div className="page-content">
        <div className="filters" style={{ flexWrap: 'wrap', gap: 8 }}>
          <label className="text3" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>Cases created since
            <input type="date" className="field-ctrl" style={{ width: 'auto' }} value={since} onChange={e => e.target.value && setSince(e.target.value)} /></label>
          <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => setWh(e.target.value)}>
            <option value="">🏢 All warehouses</option>
            {Object.entries(WH_NAMES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
          <div className="search-wrap" style={{ flex: 1, minWidth: 180 }}><span className="ico">🔍</span>
            <input placeholder="Case no., store, L-code, barcode, concessionaire…" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE) }} /></div>
        </div>
        <div className="text3" style={{ fontSize: 10.5, marginBottom: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>🔄 Checked {checkedAt ? hhmm(checkedAt) : '…'} · re-checks every 5 min while open</span>
          {comAt && <span>· COM data from the upload of <b>{fmt(comAt)} {hhmm(comAt)}</b></span>}
          {rows && newCount > 0 && <><span className="tag tag-red">🆕 {num(newCount)} new since you last looked</span>
            <button className="btn btn-ghost btn-sm" onClick={markSeen}>✓ Mark all as seen</button></>}
        </div>
        {err && <div className="form-msg err">{err}</div>}

        <div className="stats-row">
          {KINDS.map(([k, l, c, d]) => (
            <div key={k} className={`stat-card c-${c === 'blue' ? 'accent' : c}`} style={{ cursor: 'pointer', outline: tab === k ? '2px solid var(--accent)' : 'none' }} onClick={() => { setTab(tab === k ? 'all' : k); setShown(PAGE) }} title={d}>
              <div className="stat-label">{l}</div><div className="stat-value">{rows ? num(counts[k]) : '…'}</div>
              <div className="stat-sub">{d}</div></div>))}
        </div>
        {byWh.length > 0 && <div className="text3" style={{ fontSize: 11, marginBottom: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>By warehouse: {byWh.map(([w, n]) => <span key={w} className="tag tag-neutral">{w} {num(n)}</span>)}</div>}

        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 6 }}>
            <div className="seg">
              <button className={`seg-btn${tab === 'all' ? ' on' : ''}`} onClick={() => setTab('all')}>All{rows ? ` (${num(rows.length)})` : ''}</button>
              {KINDS.map(([k, l]) => <button key={k} className={`seg-btn${tab === k ? ' on' : ''}`} onClick={() => { setTab(k); setShown(PAGE) }}>{l.split(' ')[0]} {rows ? `(${num(counts[k])})` : ''}</button>)}
            </div>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} disabled={!list.length} onClick={exportXlsx}>⬇ Excel ({num(list.length)})</button>
          </div>
          {!rows ? <div className="load-state"><span className="spinner" /> Matching open cases with COM assets…</div> : !list.length ? (
            <div className="empty-state"><div className="empty-ico">🎉</div><div>No exceptions in this list.</div></div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Exception</th><th>Case</th><th>Store</th><th>Requested</th><th>Asset</th></tr></thead>
                <tbody>{list.slice(0, shown).map(r => {
                  const k = KIND[r.kind], c = r.candidates || []
                  return (
                    <tr key={r.kind + r.case_number}>
                      <td><span className={`tag tag-${k[2]}`}>{k[1]}</span>{!seen.has(keyOf(r)) && <div><span className="tag tag-red" style={{ marginTop: 3 }}>🆕 new</span></div>}</td>
                      <td><Link className="mono" to={`/cases?case=${encodeURIComponent(r.case_number)}`}>{r.case_number}</Link>
                        <div className="text3" style={{ fontSize: 10 }}>{r.case_type} · {r.status_reason}</div>
                        <div className="text3" style={{ fontSize: 10 }}>opened {fmt(r.created_on)}{r.sla_status && <> · <span className={`tag tag-${slaColor(r.sla_status)}`}>{r.sla_status}</span></>}</div></td>
                      <td style={{ fontSize: 11 }}>{r.point_of_sale}<div className="text3 mono" style={{ fontSize: 10 }}>{r.pos_local_code} · {(r.warehouse || '').replace(/^RTMA /, '')}</div>
                        <div className="text3 trunc" style={{ fontSize: 10, maxWidth: 180 }} title={r.concessionaire}>{r.concessionaire}</div></td>
                      <td style={{ fontSize: 11 }}>{r.requested_product_base || '—'}<div className="text3" style={{ fontSize: 10 }}>{r.requested_family ? `family ${r.requested_family}` : ''}{r.requested_condition ? ` · ${r.requested_condition}` : ''}</div></td>
                      <td style={{ fontSize: 11 }}>{r.kind !== 'possible' ? (
                        <><Link className="mono" to={`/assets?q=${encodeURIComponent(r.asset_bar_code || r.asset)}`}>{r.asset_bar_code || r.asset}</Link>
                          <div className="text3" style={{ fontSize: 10 }}>{r.asset_product_base} {r.asset_condition && <span className={`tag tag-${condColor(r.asset_condition)}`}>{r.asset_condition.charAt(0)}</span>}</div>
                          <div className="text3" style={{ fontSize: 10 }}>{r.asset_source}{r.picked_at ? ` · ${fmt(r.picked_at)}` : ''}</div>
                          <div style={{ fontSize: 10.5 }}>📍 now: <b>{r.asset_now}</b></div></>
                      ) : (
                        <><button className="linkish" onClick={() => setOpen(open === r.case_number ? null : r.case_number)}>
                          {open === r.case_number ? '▾' : '▸'} {c.length} candidate{c.length === 1 ? '' : 's'} at this store
                          {c.some(x => x.same_model && x.same_condition) ? <span className="tag tag-green" style={{ marginLeft: 4 }}>strong</span> : c.some(x => x.same_model) ? <span className="tag tag-blue" style={{ marginLeft: 4 }}>same model</span> : <span className="tag tag-neutral" style={{ marginLeft: 4 }}>family</span>}
                        </button>
                          {open === r.case_number && <div style={{ display: 'grid', gap: 3, marginTop: 4 }}>{c.map(x => (
                            <div key={x.asset} style={{ fontSize: 10.5 }}>
                              <Link className="mono" to={`/assets?q=${encodeURIComponent(x.bar_code || x.asset)}`}>{x.bar_code || x.asset}</Link> · {x.product_base} {x.condition && <span className={`tag tag-${condColor(x.condition)}`}>{x.condition.charAt(0)}</span>}
                              {x.same_model && x.same_condition ? ' ✅ strong' : x.same_model ? ' ☑ same model' : ' · same family'}
                            </div>))}</div>}</>
                      )}</td>
                    </tr>)
                })}</tbody>
              </table>
              {list.length > shown && <div style={{ padding: 10, textAlign: 'center' }}><button className="btn btn-ghost btn-sm" onClick={() => setShown(n => n + PAGE * 3)}>Show more ({num(list.length - shown)} left)</button></div>}
            </div>
          )}
        </div>
        <div className="text3" style={{ fontSize: 10.5, marginTop: 8 }}>Open = Open, In Progress, Waiting, In Service, On Hold. "Picked / prepared" = the routing app's warehouse prep pick, else COM's Asset Delivered. Read only — COM is not changed; close or correct the case in COM.</div>
      </div>
    </>
  )
}
