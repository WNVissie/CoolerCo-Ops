import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { fmt, num, statusColor, CASE_TYPES, CASE_TYPE_ICON, WH_NAMES, whCaseName } from '../lib/helpers'

// 📅 Case calendar — SLA follow-up (script 040, read only, worked out on the server).
// Each case sits on its SLA due date (COM's own end date; CoolerCo/Tiger: own end date or the SLA rule).
// Colour = what needs doing: red = open and past due · blue = open, not due yet · amber = closed late ·
// green = closed on time · grey = cancelled. Click a day (or a KPI card) → the follow-up list underneath.
const PLACE_BY = [
  { key: 'due', label: 'SLA due date', short: 'SLA due date' },
  { key: 'logged', label: 'Logged date', short: 'logged date' },
  { key: 'routed', label: 'Routed date', short: 'route date' },
  { key: 'closed', label: 'Closed date', short: 'closed date' },
]
const SEG = [
  { key: 'late', label: 'Open, past due', color: 'var(--red)' },
  { key: 'open', label: 'Open, not yet due', color: 'var(--blue)' },
  { key: 'closed_late', label: 'Closed late', color: 'var(--orange)' },
  { key: 'closed_ontime', label: 'Closed on time', color: 'var(--green)' },
  { key: 'cancelled', label: 'Cancelled', color: 'var(--text4)' },
]
const BUCKET_TAG = {
  late: ['red', 'Overdue'], open: ['blue', 'Open'], closed_late: ['orange', 'Closed late'],
  closed_ontime: ['green', 'On time'], cancelled: ['neutral', 'Cancelled'],
}
const VIEWS = {
  overdue: 'Overdue — still open', due_soon: 'Due today or next working day', needs_action: 'Needs action in COM',
  carried: 'Open from earlier months', gap: 'Done on the app · still open in COM', not_placed: 'Open — not on a route',
}
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// dates as YYYY-MM-DD strings (no time-zone surprises)
const iso = d => d.toISOString().slice(0, 10)
const parse = s => new Date(`${s}T00:00:00Z`)
const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
const monthStart = s => `${s.slice(0, 7)}-01`
const addMonths = (s, n) => { const d = parse(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + n); return iso(d) }
const isoDow = s => ((parse(s).getUTCDay() + 6) % 7) + 1
const dayLabel = s => parse(s).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const monthLabel = s => parse(s).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const todaySA = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })
const needsScript = e => (/does not exist|Could not find/i.test(e?.message || '') ? 'The case calendar needs database script 040 — not applied on this database yet.' : e?.message)
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—')

function Bar({ d }) {
  const total = SEG.reduce((s, x) => s + (d[x.key] || 0), 0)
  if (!total) return null
  return (
    <div className="cal-bar" aria-hidden="true">
      {SEG.map(x => (d[x.key] ? <span key={x.key} style={{ flex: d[x.key], background: x.color }} /> : null))}
    </div>
  )
}

export default function CaseCalendar() {
  const [params, setParams] = useSearchParams()
  const month = params.get('m') && /^\d{4}-\d{2}/.test(params.get('m')) ? `${params.get('m').slice(0, 7)}-01` : monthStart(todaySA())
  const wh = params.get('wh') || ''
  const client = params.get('client') || ''
  const type = params.get('type') || ''
  const by = PLACE_BY.some(p => p.key === params.get('by')) ? params.get('by') : 'due'
  const set = (k, v) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })

  const [cal, setCal] = useState(null)
  const [err, setErr] = useState(null)
  const [tick, setTick] = useState(0)
  const [sel, setSel] = useState(null)       // { view: 'day', date } | { view: 'overdue' } …
  const [list, setList] = useState(null)
  const [listErr, setListErr] = useState(null)

  const filters = { p_place_by: by, p_warehouse: wh ? whCaseName(wh) : null, p_client: client || null, p_case_type: type || null }

  // month summary — one server call fills the cards + calendar
  useEffect(() => {
    let live = true
    setCal(null); setErr(null)
    supabase.rpc('coolerco_case_calendar', { p_month: month, ...filters }).then(({ data, error }) => {
      if (!live) return
      if (error) setErr(needsScript(error)); else setCal(data)
    })
    return () => { live = false }
  }, [month, wh, client, type, by, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  // default selection: today when it's in the month shown, else the overdue list
  useEffect(() => {
    const t = todaySA()
    setSel(monthStart(t) === month ? { view: 'day', date: t } : { view: 'overdue' })
  }, [month])

  // follow-up list for what is selected
  useEffect(() => {
    if (!sel) return
    let live = true
    setList(null); setListErr(null)
    supabase.rpc('coolerco_case_calendar_list', { p_view: sel.view, p_date: sel.date || null, p_month: month, ...filters, p_limit: 500 })
      .then(({ data, error }) => {
        if (!live) return
        if (error) setListErr(needsScript(error)); else setList(data)
      })
    return () => { live = false }
  }, [sel, month, wh, client, type, by, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  // calendar cells: blanks before the 1st, then the days, a week total after each Sunday
  const weeks = useMemo(() => {
    if (!cal?.days) return []
    const out = []
    let week = Array(isoDow(cal.from) - 1).fill(null)
    cal.days.forEach(d => {
      week.push(d)
      if (week.length === 7) { out.push(week); week = [] }
    })
    if (week.length) out.push([...week, ...Array(7 - week.length).fill(null)])
    return out
  }, [cal])

  const k = cal?.kpi || {}
  const today = cal?.today || todaySA()
  const holidays = k.holidays || {}
  const showGap = client !== 'TIGER' && (k.gap || 0) > 0
  const listRef = useRef(null)
  // phones: the list sits under the calendar → bring it into view after a tap
  const pick = s => {
    setSel(s)
    if (window.matchMedia('(max-width: 768px)').matches) setTimeout(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }
  const isSel = s => sel && sel.view === s.view && sel.date === s.date

  async function exportXlsx() {
    if (!list?.rows?.length) return
    const XLSX = await import('xlsx')
    const rows = list.rows.map(r => ({
      'Follow-up': BUCKET_TAG[r.bucket]?.[1], 'Case no.': r.case_number, Source: r.source, Client: r.client_code, 'Case type': r.case_type,
      Status: r.status_reason, 'Needs action': r.needs_action ? 'Yes' : '', Priority: r.priority, 'Due date': r.due_date,
      'Due date from': r.due_from === 'rule' ? 'SLA rule' : 'Case', 'Days late': r.days_late || '', Warehouse: (r.warehouse_workshop || '').replace(/^RTMA /, ''),
      Store: r.point_of_sale, 'L-code': r.pos_local_code, Concessionaire: r.responsible_ordering_party, Asset: r.asset,
      Logged: fmt(r.created_on), Closed: r.service_closure_date ? fmt(r.service_closure_date) : '', 'SLA (COM)': r.sla_status,
      Route: r.route_number, 'Route date': r.route_date, 'Route outcome': r.route_outcome, 'Done on app, open in COM': r.app_done_com_open ? 'Yes' : '',
    }))
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Follow-up')
    XLSX.writeFile(wb, `CoolerCo_Case_followup_${sel.view === 'day' ? sel.date : sel.view}_${wh || 'ALL'}.xlsx`)
  }

  const kpiCards = [
    { view: 'overdue', icon: '⏰', label: 'Overdue, still open', value: k.overdue, c: 'red', sub: 'Past the SLA due date — any month' },
    { view: 'due_soon', icon: '📌', label: 'Due today or next working day', value: (k.due_today || 0) + (k.due_next || 0), c: 'orange',
      sub: cal ? `${num(k.due_today)} today · ${num(k.due_next)} on ${fmt(cal.next_working_day)}` : '' },
    { view: 'needs_action', icon: '⚠️', label: 'Needs action', value: k.needs_action, c: 'orange', sub: 'Action Required / Error / Approval Required' },
    { view: 'carried', icon: '↩️', label: 'Open from earlier months', value: k.carried, c: 'accent', sub: `Placed before ${cal ? monthLabel(cal.from) : 'this month'}` },
    { view: null, icon: '✅', label: 'Closed within SLA', value: pct(k.closed_ontime, k.closed), c: 'green', sub: cal ? `${num(k.closed_ontime)} of ${num(k.closed)} closed in ${monthLabel(cal.from)}` : '' },
    ...(showGap ? [{ view: 'gap', icon: '📱', label: 'Done on app · open in COM', value: k.gap, c: 'teal', sub: 'Driver tapped completed — close in COM' }] : []),
    ...(by === 'routed' && k.not_placed ? [{ view: 'not_placed', icon: '🗺️', label: 'Open, not on a route', value: k.not_placed, c: 'accent', sub: 'No current route stop' }] : []),
  ]

  return (
    <>
      <Topbar title="Case calendar" sub="SLA follow-up — what is late, what is due, what was closed on time"
        actions={<button className="btn btn-ghost btn-sm" disabled={!cal} onClick={() => setTick(n => n + 1)}>↻ Refresh</button>} />
      <div className="page-content">
        <div className="filters" style={{ flexWrap: 'wrap', gap: 8 }}>
          <select className="field-ctrl" style={{ width: 'auto' }} value={client} onChange={e => set('client', e.target.value)} aria-label="Client">
            <option value="">👥 All clients</option><option value="MAGNUM">Magnum (COM)</option><option value="TIGER">Tiger</option>
          </select>
          <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => set('wh', e.target.value)} aria-label="Warehouse">
            <option value="">🏢 All warehouses</option>
            {Object.entries(WH_NAMES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
          <select className="field-ctrl" style={{ width: 'auto' }} value={type} onChange={e => set('type', e.target.value)} aria-label="Case type">
            <option value="">🔧 All case types</option>
            {CASE_TYPES.map(t => <option key={t} value={t}>{CASE_TYPE_ICON[t]} {t}</option>)}
          </select>
          <label className="text3" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>Place cases by
            <select className="field-ctrl" style={{ width: 'auto' }} value={by} onChange={e => set('by', e.target.value === 'due' ? '' : e.target.value)}>
              {PLACE_BY.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select></label>
          <span style={{ flex: 1 }} />
          <div className="cal-month-nav">
            <button className="btn btn-ghost btn-sm" onClick={() => set('m', addMonths(month, -1).slice(0, 7))} aria-label="Previous month">‹</button>
            <input type="month" className="field-ctrl" style={{ width: 'auto' }} value={month.slice(0, 7)} onChange={e => e.target.value && set('m', e.target.value)} aria-label="Month" />
            <button className="btn btn-ghost btn-sm" onClick={() => set('m', addMonths(month, 1).slice(0, 7))} aria-label="Next month">›</button>
            {monthStart(todaySA()) !== month && <button className="btn btn-ghost btn-sm" onClick={() => set('m', '')}>⏎ This month</button>}
          </div>
        </div>
        {err && <div className="form-msg err">{err}</div>}

        <div className="stats-row">
          {kpiCards.map(c => (
            <button key={c.label} type="button" className={`stat-card c-${c.c}`} disabled={!c.view}
              aria-pressed={!!c.view && sel?.view === c.view}
              style={{ cursor: c.view ? 'pointer' : 'default', textAlign: 'left', font: 'inherit', outline: c.view && sel?.view === c.view ? '2px solid var(--accent)' : 'none' }}
              onClick={() => c.view && pick({ view: c.view })}>
              <div className="stat-label">{c.icon} {c.label}</div>
              <div className="stat-value">{cal ? (typeof c.value === 'string' ? c.value : num(c.value || 0)) : '…'}</div>
              <div className="stat-sub">{c.sub}</div>
            </button>
          ))}
        </div>

        {cal?.by_type?.length > 0 && (
          <div className="chip-row" aria-label="By case type this month">
            {cal.by_type.map(t => (
              <button key={t.case_type} type="button" className={`tag ${type === t.case_type ? 'tag-blue' : 'tag-neutral'} cal-type-chip`}
                onClick={() => set('type', type === t.case_type ? '' : t.case_type)} title="Filter on this case type">
                {CASE_TYPE_ICON[t.case_type] || '🔧'} {t.case_type} · {num(t.total)}
                {t.late > 0 && <span className="cal-late"> · {num(t.late)} late</span>}
                {t.closed > 0 && <span className="text3"> · {pct(t.ontime, t.closed)} on time</span>}
              </button>
            ))}
          </div>
        )}

        <div className="card" style={{ padding: 12, marginBottom: 14 }}>
          <div className="cal-head">
            <div style={{ fontWeight: 600, fontSize: 14 }}>{monthLabel(month)}{wh ? ` · ${WH_NAMES[wh]}` : ''}{client ? ` · ${client === 'TIGER' ? 'Tiger' : 'Magnum'}` : ''}</div>
            <div className="cal-legend">
              {SEG.map(x => <span key={x.key}><i style={{ background: x.color }} />{x.label}</span>)}
              {showGap && <span>📱 done on app, open in COM</span>}
            </div>
          </div>
          {!cal && !err ? <div className="load-state"><span className="spinner" /> Loading…</div> : cal && (
            <div className="cal-grid" role="grid" aria-label={`Cases by ${PLACE_BY.find(p => p.key === by).label}`}>
              {WEEKDAYS.map(w => <div key={w} className="cal-dh">{w}</div>)}
              <div className="cal-dh">Week</div>
              {weeks.map((week, wi) => {
                const days = week.filter(Boolean)
                const t = days.reduce((a, d) => ({ on: a.on + d.closed_ontime, cl: a.cl + d.closed_ontime + d.closed_late, late: a.late + d.late }), { on: 0, cl: 0, late: 0 })
                return [
                  ...week.map((d, i) => {
                    if (!d) return <div key={`b${wi}-${i}`} className="cal-cell blank" />
                    const total = SEG.reduce((s, x) => s + (d[x.key] || 0), 0)
                    const we = i >= 5
                    const hol = holidays[d.d]
                    const s = { view: 'day', date: d.d }
                    return (
                      <button key={d.d} type="button" role="gridcell"
                        className={`cal-cell${we || hol ? ' off' : ''}${d.d === today ? ' today' : ''}${isSel(s) ? ' sel' : ''}${d.late ? ' has-late' : ''}`}
                        onClick={() => pick(s)} aria-label={`${dayLabel(d.d)}: ${total} cases, ${d.late} overdue`}>
                        <div className="cal-num"><span>{Number(d.d.slice(8))}</span>{d.gap > 0 && showGap && <span title={`${d.gap} done on app, open in COM`}>📱</span>}</div>
                        {hol && <div className="cal-hol" title={hol}>{hol}</div>}
                        {total > 0 ? (
                          <>
                            <Bar d={d} />
                            <div className="cal-count">{num(total)}<span className="cal-word"> {by === 'due' ? 'due' : 'cases'}</span></div>
                            {d.late > 0 && <span className="cal-late-chip">{num(d.late)} late</span>}
                          </>
                        ) : <div className="cal-empty">{we ? '' : '—'}</div>}
                      </button>
                    )
                  }),
                  <div key={`w${wi}`} className="cal-week" title="Closed on time this week (cases placed in this week)">
                    <b>{t.cl ? pct(t.on, t.cl) : '—'}</b><span>on time</span>{t.late > 0 && <span className="cal-late">{num(t.late)} late</span>}
                  </div>,
                ]
              })}
            </div>
          )}
          {cal && (
            <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
              Due date = COM&apos;s own SLA end date (Magnum) or the case&apos;s end date; cases still waiting for approval use the SLA rule (2 working days, weekends and public holidays skipped).
              {cal.com_data_up_to && <> · COM data up to {new Date(cal.com_data_up_to).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' })}</>}
            </div>
          )}
        </div>

        {sel && (
          <div className="card" ref={listRef}>
            <div className="cal-list-head">
              <div>
                <div style={{ fontWeight: 600 }}>{sel.view === 'day' ? dayLabel(sel.date) : VIEWS[sel.view]}</div>
                <div className="text3" style={{ fontSize: 11 }}>
                  {list ? `${num(list.total)} ${list.total === 1 ? 'case' : 'cases'}${list.total > list.rows.length ? ` · first ${num(list.rows.length)} shown — export for all filters` : ''}` : 'Loading…'}
                  {sel.view === 'day' && ` · placed by ${PLACE_BY.find(p => p.key === by).short} · overdue first`}
                </div>
              </div>
              <span style={{ flex: 1 }} />
              {sel.view === 'day' && <button className="btn btn-ghost btn-sm" onClick={() => pick({ view: 'day', date: addDays(sel.date, -1) })} aria-label="Previous day">‹</button>}
              {sel.view === 'day' && <button className="btn btn-ghost btn-sm" onClick={() => pick({ view: 'day', date: addDays(sel.date, 1) })} aria-label="Next day">›</button>}
              <button className="btn btn-ghost btn-sm" disabled={!list?.rows?.length} onClick={exportXlsx}>⬇ Excel</button>
            </div>
            {listErr && <div className="form-msg err" style={{ margin: 12 }}>{listErr}</div>}
            {!list && !listErr && <div className="load-state"><span className="spinner" /> Loading…</div>}
            {list && !list.rows.length && <div className="empty-state" style={{ padding: 24, textAlign: 'center' }}>Nothing to follow up here.</div>}
            {list?.rows?.map(r => {
              const [bc, bl] = BUCKET_TAG[r.bucket] || ['neutral', r.bucket]
              return (
                <div key={r.case_number} className={`cal-row b-${r.bucket}`}>
                  <div className="cal-row-main">
                    <div className="chip-row" style={{ marginBottom: 4 }}>
                      <span className={`tag tag-${bc}`}>{bl}{r.days_late ? ` · ${r.days_late}d` : ''}</span>
                      {r.needs_action && <span className="tag tag-orange">⚠️ Needs action</span>}
                      {/^high/i.test(r.priority || '') && <span className="tag tag-red">⚡ High priority</span>}
                      {r.app_done_com_open && <span className="tag tag-teal">📱 Done on app · open in COM</span>}
                      <span className={`tag tag-${r.source === 'COM' ? 'blue' : 'green'}`}>{r.source === 'COM' ? '🟦 COM' : `🟩 ${r.client_code === 'TIGER' ? 'Tiger' : 'CoolerCo'}`}</span>
                    </div>
                    <div>
                      <Link className="mono" to={`/cases?case=${encodeURIComponent(r.case_number)}`}>{r.case_number}</Link>
                      <span className="text3"> · {CASE_TYPE_ICON[r.case_type] || '🔧'} {r.case_type} · </span>
                      <span className={`tag tag-${statusColor(r.status_reason)}`}>{r.status_reason}</span>
                    </div>
                    <div className="text3" style={{ fontSize: 11.5 }}>
                      🏪 {r.point_of_sale || '—'} <span className="mono">{r.pos_local_code}</span>
                      {!wh && r.warehouse_workshop && <> · {r.warehouse_workshop.replace(/^RTMA /, '')}</>}
                      {r.asset && <> · <span className="mono">{r.asset}</span></>}
                    </div>
                  </div>
                  <div className="cal-row-side">
                    <div><span className="text3">Due</span> <b>{fmt(r.due_date)}</b>{r.due_from === 'rule' && <span className="text3" title="From the SLA rule — the case has no end date yet"> (rule)</span>}</div>
                    <div className="text3">Logged {fmt(r.created_on)}{r.service_closure_date ? ` · closed ${fmt(r.service_closure_date)}` : ''}</div>
                    <div className="text3">{r.route_number ? <>🗺️ <Link to={`/routes?route=${encodeURIComponent(r.route_id)}`}>{r.route_number}</Link> · {fmt(r.route_date)}{r.route_outcome ? ` · ${String(r.route_outcome).replace(/_/g, ' ')}` : ''}</> : (r.follow_up ? '🗺️ Not on a route' : '')}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
