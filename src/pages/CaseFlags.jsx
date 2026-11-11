import { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { fmt, num, statusColor, CASE_TYPE_ICON, WH_NAMES, whCaseName } from '../lib/helpers'

// Case flags (read only, server-side — script 021):
//   🔁 Repeat workshop repair: a Repair at Workshop that follows a SOLVED Repair at Workshop on the same asset,
//      with no other case on that asset in between (follow-on created in the period, default 3 months).
//   👯 Two open cases on one asset: the one-case-per-asset rule should stop this — these slipped through.
const TABS = [
  { key: 'repeat', icon: '🔁', label: 'Repeat workshop repairs', color: 'orange',
    help: 'A Repair at Workshop that follows a SOLVED Repair at Workshop on the same asset, with no other case on that asset in between.' },
  { key: 'dup', icon: '👯', label: 'Two open cases on one asset', color: 'red',
    help: 'Assets with more than one open case at the same time (COM and CoolerCo). The one-case rule should stop this.' },
]
const PAGE = 100
const monthsAgo = n => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toLocaleDateString('en-CA') }
const needsScript = e => (/does not exist|Could not find/i.test(e.message) ? 'This report needs database script 021 — not applied on this database yet.' : e.message)
const CaseLink = ({ no }) => <Link className="mono" to={`/cases?case=${encodeURIComponent(no)}`}>{no}</Link>

export default function CaseFlags() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'dup' ? 'dup' : 'repeat'
  const [since, setSince] = useState(() => monthsAgo(3))
  const [wh, setWh] = useState('')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [repeat, setRepeat] = useState(null)
  const [dup, setDup] = useState(null)
  const [err, setErr] = useState(null)
  const [tick, setTick] = useState(0)

  // Both reports load together (parallel); the counts on the cards stay right whichever tab is open
  useEffect(() => {
    let live = true
    setRepeat(null); setDup(null); setErr(null); setShown(PAGE)
    const w = wh ? whCaseName(wh) : null
    Promise.all([
      supabase.rpc('coolerco_repeat_workshop_repairs', { p_since: since, p_warehouse: w }),
      supabase.rpc('coolerco_duplicate_open_cases', { p_warehouse: w }),
    ]).then(([a, b]) => {
      if (!live) return
      if (a.error || b.error) setErr(needsScript(a.error || b.error))
      setRepeat(a.data || []); setDup(b.data || [])
    })
    return () => { live = false }
  }, [since, wh, tick])

  const s = q.trim().toLowerCase()
  const has = vals => !s || vals.some(v => String(v || '').toLowerCase().includes(s))
  const repeatList = useMemo(() => (repeat || []).filter(r => has([r.asset, r.bar_code, r.local_code, r.first_case, r.second_case, r.product_base])), [repeat, s]) // eslint-disable-line react-hooks/exhaustive-deps
  const dupList = useMemo(() => (dup || []).filter(r => has([r.asset, r.bar_code, r.local_code, r.product_base, ...(r.cases || []).flatMap(c => [c.case_number, c.point_of_sale])])), [dup, s]) // eslint-disable-line react-hooks/exhaustive-deps
  const assetsRepeated = useMemo(() => new Set((repeat || []).map(r => r.asset)).size, [repeat])
  const list = tab === 'repeat' ? repeatList : dupList
  const loading = tab === 'repeat' ? !repeat : !dup

  async function exportXlsx() {
    const XLSX = await import('xlsx')
    const data = tab === 'repeat'
      ? repeatList.map(r => ({
          Warehouse: r.warehouse, Asset: r.asset, Barcode: r.bar_code, 'Local code': r.local_code, Model: r.product_base, 'Asset status (COM)': r.asset_status,
          'First repair': r.first_case, 'First created': fmt(r.first_created), 'First solved': fmt(r.first_closed),
          'Follow-on repair': r.second_case, 'Follow-on created': fmt(r.second_created), 'Follow-on status': r.second_status, 'Follow-on closed': fmt(r.second_closed),
          'Days after first was solved': r.days_after_closure, 'Repeat repairs on this asset in period': r.repairs_in_period,
        }))
      : dupList.flatMap(r => (r.cases || []).map(c => ({
          Asset: r.asset, Barcode: r.bar_code, 'Local code': r.local_code, Model: r.product_base, 'COM has it at': r.asset_now, 'Open cases on asset': r.open_cases,
          Source: c.source, 'Case no.': c.case_number, 'Case type': c.case_type, Status: c.status, Created: fmt(c.created_on), Store: c.point_of_sale,
        })))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), tab === 'repeat' ? 'Repeat workshop repairs' : 'Two open cases')
    XLSX.writeFile(wb, `CoolerCo_${tab === 'repeat' ? 'Repeat_workshop_repairs_since_' + since : 'Two_open_cases_per_asset'}_${wh || 'ALL'}.xlsx`)
  }

  return (
    <>
      <Topbar title="Case flags" sub="Repeat workshop repairs · two open cases on one asset"
        actions={<button className="btn btn-ghost btn-sm" disabled={!repeat || !dup} onClick={() => setTick(n => n + 1)}>↻ Refresh</button>} />
      <div className="page-content">
        <div className="filters" style={{ flexWrap: 'wrap', gap: 8 }}>
          {tab === 'repeat' && (
            <label className="text3" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>Follow-on repair created since
              <input type="date" className="field-ctrl" style={{ width: 'auto' }} value={since} onChange={e => e.target.value && setSince(e.target.value)} /></label>
          )}
          <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => setWh(e.target.value)} aria-label="Warehouse">
            <option value="">🏢 All warehouses</option>
            {Object.entries(WH_NAMES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
          <div className="search-wrap" style={{ flex: 1, minWidth: 180 }}><span className="ico">🔍</span>
            <input placeholder="Asset, barcode, local code, case no., store…" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE) }} /></div>
        </div>
        {err && <div className="form-msg err">{err}</div>}

        <div className="stats-row">
          {TABS.map(t => {
            const rows = t.key === 'repeat' ? repeat : dup
            return (
              <button key={t.key} type="button" className={`stat-card c-${t.color}`} aria-pressed={tab === t.key}
                style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', outline: tab === t.key ? '2px solid var(--accent)' : 'none' }}
                onClick={() => { setParams({ tab: t.key }); setShown(PAGE) }}>
                <div className="stat-label">{t.icon} {t.label}</div>
                <div className="stat-value">{rows ? num(rows.length) : '…'}</div>
                <div className="stat-sub">{t.key === 'repeat' && repeat ? `${num(assetsRepeated)} ${assetsRepeated === 1 ? "asset" : "assets"} · ` : ''}{t.help}</div>
              </button>
            )
          })}
        </div>

        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: 6 }}>
            <span className="card-title">{TABS.find(t => t.key === tab).icon} {TABS.find(t => t.key === tab).label}</span>
            <span className="card-count">{num(list.length)}</span>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} disabled={!list.length} onClick={exportXlsx}>⬇ Excel ({num(list.length)})</button>
          </div>
          {loading ? <div className="load-state"><span className="spinner" /> Checking cases…</div> : !list.length ? (
            <div className="empty-state"><div className="empty-ico">🎉</div><div>Nothing flagged{s ? ' for this search' : ''}.</div></div>
          ) : tab === 'repeat' ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Asset</th><th>First repair (solved)</th><th>Follow-on repair</th><th>Gap</th><th>Warehouse</th></tr></thead>
                <tbody>{repeatList.slice(0, shown).map(r => (
                  <tr key={r.second_case}>
                    <td style={{ fontSize: 11 }}><Link className="mono" to={`/assets?q=${encodeURIComponent(r.bar_code || r.asset)}`}>{r.bar_code || r.asset}</Link>
                      <div className="text3" style={{ fontSize: 10 }}>{r.product_base}</div>
                      {r.repairs_in_period > 1 && <span className="tag tag-red">🔁 {r.repairs_in_period}× in period</span>}</td>
                    <td style={{ fontSize: 11 }}><CaseLink no={r.first_case} /><div className="text3" style={{ fontSize: 10 }}>solved {fmt(r.first_closed)}</div></td>
                    <td style={{ fontSize: 11 }}><CaseLink no={r.second_case} /><div className="text3" style={{ fontSize: 10 }}>created {fmt(r.second_created)}</div>
                      <span className={`tag tag-${statusColor(r.second_status)}`}>{r.second_status}</span></td>
                    <td>{r.days_after_closure != null ? <span className={`tag tag-${r.days_after_closure <= 7 ? 'red' : r.days_after_closure <= 30 ? 'orange' : 'neutral'}`}>{num(r.days_after_closure)} d</span> : '—'}</td>
                    <td className="text2">{(r.warehouse || '—').replace(/^RTMA /, '')}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Asset</th><th>Open cases</th><th>COM has it at</th></tr></thead>
                <tbody>{dupList.slice(0, shown).map(r => (
                  <tr key={r.asset}>
                    <td style={{ fontSize: 11 }}><Link className="mono" to={`/assets?q=${encodeURIComponent(r.bar_code || r.asset)}`}>{r.bar_code || r.asset}</Link>
                      <div className="text3" style={{ fontSize: 10 }}>{r.product_base}</div>
                      <span className="tag tag-red">{r.open_cases} open cases</span> {r.has_coolerco && <span className="tag tag-blue">incl. CoolerCo</span>}</td>
                    <td style={{ fontSize: 11 }}>{(r.cases || []).map(c => (
                      <div key={c.case_number} style={{ marginBottom: 4 }}>
                        <CaseLink no={c.case_number} /> <span className="text3" style={{ fontSize: 10 }}>{c.source}</span>
                        <div className="text3" style={{ fontSize: 10 }}>{CASE_TYPE_ICON[c.case_type] || '•'} {c.case_type} · <span className={`tag tag-${statusColor(c.status)}`}>{c.status}</span> · {fmt(c.created_on)}</div>
                        {c.point_of_sale && <div className="text3 trunc" style={{ fontSize: 10, maxWidth: 260 }} title={c.point_of_sale}>{c.point_of_sale}</div>}
                      </div>))}</td>
                    <td style={{ fontSize: 11 }}>{r.asset_now || '—'}<div className="text3" style={{ fontSize: 10 }}>{r.asset_status}</div></td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
          {list.length > shown && <div style={{ padding: 10, textAlign: 'center' }}><button className="btn btn-ghost btn-sm" onClick={() => setShown(n => n + PAGE * 3)}>Show more ({num(list.length - shown)} left)</button></div>}
        </div>
        <div className="text3" style={{ fontSize: 10.5, marginTop: 8 }}>
          Asset on a case = Asset Repaired / Removed / Delivered (Mapped Asset only when none of those is filled). &ldquo;In between&rdquo; = any case on that asset, COM or CoolerCo, created after the first repair and before the follow-on.
          Open = Open, In Progress, Waiting, In Service, On Hold. Read only — correct cases in COM.
        </div>
      </div>
    </>
  )
}
