import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

// ⭐ My board (script 037) — the driver's / technician's own work for a day, week or month:
//   progress (routed → done on the App → closed in COM), cases by type and status, best day, team share,
//   and the trip-sheet score: where the rules were not followed (no outcome, no Arrived / Left tap, no job card,
//   late start, done but COM still open), with the list to fix. Last result is kept on the phone for offline viewing.
const iso = d => d.toLocaleDateString('en-CA')
const PERIODS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']]
const TYPE_ICON = { 'Deliver an Asset': '📦', 'Replacement of Asset': '🔁', 'Removal of Asset': '↩️', 'Repair at Shopper POS': '🛠', 'Repair at Workshop': '🔧' }
const STATUS_TONE = { Solved: 'good', Completed: 'good', Resolved: 'good', Canceled: 'grey', 'Not Solved': 'bad', 'Action Required': 'bad', 'In Service': 'blue', 'In Progress': 'blue', Open: 'blue' }
const CHECKS = [
  ['no_outcome', '📝', 'Stop with no outcome', 'The day is over and nothing was recorded. Record Completed or Not completed with a reason.'],
  ['arrived', '📍', 'No “Arrived” tap', 'Tap 📍 Arrived when you reach the store — it proves the visit time.'],
  ['left', '🚪', 'No “Left store” tap', 'Tap 🚪 Left store when you drive away.'],
  ['job_card', '📸', 'No job card', 'Done stops need the job card: 2 photos + signature (or the reason it was refused).'],
  ['late_start', '🏭', 'Late or no warehouse start', 'Tap 🚚 Start trip when you leave — before 08:00.'],
  ['com_open', '⏳', 'Done, but COM still open', 'Done on the App more than a day ago, but COM is not closed yet. Tell your supervisor.'],
]
const fmtDay = d => new Date(d + 'T12:00').toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })

function useCount(target, ms = 900) {         // animated count-up
  const [v, setV] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = performance.now(), a = from.current, b = Number(target) || 0
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setV(b); from.current = b; return }
    let raf
    const step = t => { const p = Math.min(1, (t - start) / ms); const e = 1 - Math.pow(1 - p, 3); setV(Math.round(a + (b - a) * e)); if (p < 1) raf = requestAnimationFrame(step); else from.current = b }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}
const Num = ({ n }) => <>{useCount(n)}</>
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)

function cheer(donePct, score, routed, first) {
  if (!routed) return ['🌱', `No routed work in this period yet, ${first}. Fresh start!`]
  if (donePct >= 100 && score >= 95) return ['🏆', `Perfect, ${first}! Every stop done and the trip sheet is spotless.`]
  if (donePct >= 90) return ['🔥', `On fire, ${first}! ${score < 90 ? 'Now close the gaps below to make it perfect.' : 'Keep it rolling!'}`]
  if (donePct >= 70) return ['💪', `Strong work, ${first}! You're well on your way.`]
  if (donePct >= 40) return ['🚚', `Good progress, ${first} — one stop at a time.`]
  return ['☀️', `Let's go, ${first}! Every stop counts.`]
}

export default function FieldBoard() {
  const [period, setPeriod] = useState(() => localStorage.getItem('cc_board_period') || 'month')
  const [date, setDate] = useState(() => iso(new Date()))
  const [wh, setWh] = useState(() => localStorage.getItem('cc_crew_wh') || 'JHB')
  const key = `cc_board:${period}:${date}:${wh}`
  const [b, setB] = useState(() => { try { return JSON.parse(localStorage.getItem(key)) } catch { return null } })
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState(null)
  const [fresh, setFresh] = useState(false)

  useEffect(() => { localStorage.setItem('cc_board_period', period) }, [period])
  useEffect(() => {
    let alive = true
    try { setB(JSON.parse(localStorage.getItem(key))) } catch { setB(null) }
    setErr(null); setFresh(false)
    supabase.rpc('coolerco_field_board', { p_period: period, p_date: date, p_warehouse: wh }).then(({ data, error }) => {
      if (!alive) return
      if (error) return setErr(/does not exist|Could not find|PGRST202/i.test(error.message) ? 'My board needs database script 037 — not on this database yet.' : navigator.onLine ? error.message : '📵 No signal — showing the last saved board.')
      setB(data); setFresh(true)
      try { localStorage.setItem(key, JSON.stringify(data)) } catch { /* full */ }
    })
    return () => { alive = false }
  }, [key, period, date, wh])

  const shift = n => {
    const d = new Date(date + 'T12:00')
    if (period === 'day') d.setDate(d.getDate() + n); else if (period === 'week') d.setDate(d.getDate() + 7 * n); else d.setMonth(d.getMonth() + n, 1)
    setDate(iso(d))
  }
  const isNow = b ? b.today >= b.from && b.today <= b.to : true
  const label = !b ? '' : period === 'day' ? fmtDay(b.from) : period === 'week' ? `${fmtDay(b.from)} – ${fmtDay(b.to)}` : new Date(b.from + 'T12:00').toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })

  const me = b?.has_slot ? b.mine : b?.team
  const first = String(b?.person || '').split(/[\s.]/)[0] || 'team'
  const c = me?.checks || {}
  const issueCount = CHECKS.reduce((a, [k]) => a + (Number(c[k]) || 0), 0)
  const checkBase = (Number(c.done_stops) || 0) * 3 + (Number(c.stops) || 0) + (Number(me?.routes) || 0)
  const score = checkBase ? Math.max(0, Math.round(100 - (issueCount / checkBase) * 100)) : 100
  const donePct = pct(me?.app_done, me?.routed), comPct = pct(me?.com_done, me?.routed)
  const [emoji, msg] = cheer(donePct, score, me?.routed, first)
  const share = b?.has_slot && b.team?.app_done ? pct(b.mine.app_done, b.team.app_done) : null
  const byType = Object.entries(me?.by_type || {}).sort((x, y) => y[1] - x[1])
  const byStatus = Object.entries(me?.by_status || {}).sort((x, y) => y[1] - x[1])
  const maxType = Math.max(1, ...byType.map(([, n]) => n))

  return (
    <div className="f-pad fb">
      <div className="fb-bar">
        <div className="seg">{PERIODS.map(([k, l]) => <button key={k} className={`seg-btn ${period === k ? 'on' : ''}`} onClick={() => { setPeriod(k); setDate(iso(new Date())) }}>{l}</button>)}</div>
        {!b?.has_slot && (
          <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => { setWh(e.target.value); localStorage.setItem('cc_crew_wh', e.target.value) }}>
            {['JHB', 'CPT', 'DBN', 'BFN', 'EL', 'GEO', 'NEL', 'POL', 'PE'].map(w => <option key={w}>{w}</option>)}
          </select>)}
      </div>
      <div className="fb-nav">
        <button className="btn btn-ghost btn-sm" onClick={() => shift(-1)}>‹</button>
        <strong>{label}</strong>
        <button className="btn btn-ghost btn-sm" onClick={() => shift(1)} disabled={isNow}>›</button>
        {!isNow && <button className="btn btn-ghost btn-sm" onClick={() => setDate(iso(new Date()))}>⏎ Now</button>}
      </div>
      {err && <div className="form-msg warn">{err}</div>}
      {!b && !err && <div className="load-state"><span className="spinner" /></div>}

      {b && me && <>
        <div className={`fb-hero ${donePct >= 100 ? 'win' : ''}`}>
          <div className="fb-cheer"><span className="fb-emoji">{emoji}</span><span>{msg}</span></div>
          {!b.has_slot && <small className="fb-sub">Team view · {b.warehouse_name} (no driver / technician slot linked to this login)</small>}
          <div className="fb-lane">
            <span className="fb-truck" style={{ left: `${Math.min(100, donePct)}%` }}>{b.worker_type === 'technician' ? '🛠' : '🚚'}</span>
            <div className="fb-track"><span style={{ width: `${donePct}%` }} /></div>
            <div className="fb-track thin"><span style={{ width: `${comPct}%` }} /></div>
          </div>
          <div className="fb-legend"><span><i className="app" /> Done on the App <b>{donePct}%</b></span><span><i className="com" /> Closed in COM <b>{comPct}%</b></span></div>
        </div>

        <div className="fb-kpis">
          <div className="fb-kpi"><span>🗺</span><b><Num n={me.routed} /></b><small>cases routed</small></div>
          <div className="fb-kpi good"><span>✅</span><b><Num n={me.app_done} /></b><small>done on the App</small></div>
          <div className="fb-kpi blue"><span>🟦</span><b><Num n={me.com_done} /></b><small>closed in COM</small></div>
          {period !== 'day'
            ? <div className="fb-kpi"><span>🏆</span><b>{me.best_day ? <Num n={me.best_day.done} /> : '—'}</b><small>{me.best_day ? `best day · ${fmtDay(me.best_day.date)}` : 'best day'}</small></div>
            : <div className="fb-kpi"><span>🚏</span><b><Num n={me.routes} /></b><small>route(s)</small></div>}
        </div>
        {isNow && period !== 'day' && b.today_stops?.stops > 0 && (
          <div className="fb-today">📅 Today: <b>{b.today_stops.done}</b> of <b>{b.today_stops.stops}</b> stops done {b.today_stops.done >= b.today_stops.stops ? '🎉' : '— keep going!'}</div>)}

        <div className={`fb-score ${score >= 95 ? 'good' : score >= 80 ? 'ok' : 'bad'}`}>
          <div className="fb-score-ring" style={{ '--p': score }}><b><Num n={score} />%</b></div>
          <div className="f-grow">
            <strong>Trip-sheet score</strong>
            <small>{issueCount ? `${issueCount} thing(s) to fix — tap a line below to see which stops.` : 'Every rule followed. Spotless! ✨'}</small>
          </div>
        </div>
        <div className="fb-checks">
          {CHECKS.map(([k, ico, t, help]) => {
            const n = Number(c[k]) || 0
            const list = (me.issues || []).filter(i => i.kind === k)
            return (
              <div key={k} className={`fb-check ${n ? 'warn' : 'ok'}`}>
                <button className="fb-check-row" onClick={() => setOpen(open === k ? null : k)}>
                  <span>{n ? ico : '✅'}</span><span className="f-grow">{t}</span><b>{n || '0'}</b>
                </button>
                {open === k && (
                  <div className="fb-check-body">
                    <small>{help}</small>
                    {list.map((i, x) => <div key={x} className="fb-issue"><b>{i.case}</b><span>{i.pos || '—'} · {fmtDay(i.day)}</span></div>)}
                    {n > 0 && !list.length && <small className="text3">{k === 'late_start' ? 'Counted per route.' : 'Counted per case.'}</small>}
                  </div>)}
              </div>)
          })}
        </div>

        {byType.length > 0 && <div className="f-card">
          <strong>What you worked on</strong>
          {byType.map(([t, n]) => (
            <div key={t} className="fb-type">
              <span>{TYPE_ICON[t] || '📄'}</span><span className="f-grow">{t}</span><b>{n}</b>
              <div className="fb-mini"><span style={{ width: `${(n / maxType) * 100}%` }} /></div>
            </div>))}
        </div>}
        {byStatus.length > 0 && <div className="f-card">
          <strong>Case status now</strong>
          <div className="fb-chips">{byStatus.map(([s, n]) => <span key={s} className={`fb-chip ${STATUS_TONE[s] || ''}`}>{s} <b>{n}</b></span>)}</div>
        </div>}

        {b.has_slot && b.team && (
          <div className="f-card fb-team">
            <strong>🤝 Team {b.warehouse_name.replace('RTMA ', '')}</strong>
            <small>{b.team.app_done} of {b.team.routed} cases done on the App · {b.team.com_done} closed in COM</small>
            {share !== null && share > 0 && <div className="fb-share">You did <b>{share}%</b> of the team's completed work {share >= 25 ? '🌟' : '👏'}</div>}
          </div>)}
        {fresh && donePct >= 100 && score >= 95 && <div className="fb-confetti" aria-hidden="true">{'🎉✨🎊⭐🎉✨🎊⭐'.split('').filter(x => x.trim()).map((e, i) => <span key={i} style={{ left: `${8 + i * 11}%`, animationDelay: `${i * 0.12}s` }}>{e}</span>)}</div>}
        <small className="text3 fb-foot">Done on the App = RouteIQ trip sheet or this app. COM is updated by the office; it can lag a day.</small>
      </>}
    </div>
  )
}
