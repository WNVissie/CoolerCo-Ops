import { useState, useEffect, useMemo, useRef } from 'react'
import Topbar from '../components/Topbar'
import Drawer from '../components/Drawer'
import CameraScan from '../components/CameraScan'
import LabelPrompt from '../components/LabelPrompt'
import PickingLegacy from './PickingLegacy'
import { supabase } from '../lib/supabase'
import { num, WAREHOUSES, WH_NAMES, whCaseName, condColor, CASE_TYPE_ICON } from '../lib/helpers'
import { entryTimer } from '../lib/labels'

// 📦 Picking (script 024). Same routing prep as the routing app, but CoolerCo helps:
//  ✨ suggests the best RTW cooler per stop (family → requested condition → brand → model), fills a whole day in one tap
//  📷 scan to pick: the scan finds its own stop; wrong cooler / not RTW / other warehouse / reserved = buzz + red card
//  🆕 new stock protection: A - New for a used request needs a reason · every step is logged (coolerco_asset_movements)
// Writes go to routing prep only where pick_writes_routing is on (TEST/UAT). Elsewhere: read-only. No 024 → old board.
const pad = n => String(n).padStart(2, '0')
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` // phone's local date
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
const today = () => ymd(new Date())
const dayLabel = d => new Date(d + 'T12:00:00').toLocaleDateString('en-ZA', { weekday: 'short', day: '2-digit', month: 'short' })
const keep = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const put = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
const buzz = bad => { try { navigator.vibrate?.(bad ? [120, 80, 120, 80, 200] : 60) } catch { /* no vibrate */ } }
const beep = bad => {
  try {
    const A = window.AudioContext || window.webkitAudioContext; const ctx = new A(); const o = ctx.createOscillator(); const g = ctx.createGain()
    o.frequency.value = bad ? 220 : 880; o.type = bad ? 'square' : 'sine'; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination)
    o.start(); o.stop(ctx.currentTime + (bad ? 0.45 : 0.12)); o.onended = () => ctx.close()
  } catch { /* no audio */ }
}

const FLAG = {
  no_selection: ['❗', 'No cooler selected', 'red'],
  not_rtw: ['🟠', 'Not Ready to Work', 'orange'],
  at_pos: ['🏪', 'Cooler is at a store', 'red'],
  other_wh: ['🏢', 'Other warehouse', 'red'],
  family: ['🧩', 'Other family than asked', 'red'],
  upgrade_new: ['🆕', 'A - New for a used request', 'purple'],
  condition: ['🔶', 'Other condition than asked', 'orange'],
  brand: ['🏷', 'Other branding than asked', 'orange'],
  double_booked: ['⛔', 'Also selected for another case', 'red'],
  reserved_elsewhere: ['⛔', 'Reserved for another case', 'red'],
  not_picked: ['⏳', 'Not picked yet', 'orange'],
}
const PROBLEM_FLAGS = ['not_rtw', 'at_pos', 'other_wh', 'family', 'condition', 'brand', 'double_booked']
const REASONS = ['No used stock of this model', 'Customer / Magnum asked for it', 'Approved by supervisor', 'Other cooler damaged']
const Flag = ({ f }) => { const [i, l, c] = FLAG[f] || ['•', f, 'neutral']; return <span className={`tag tag-${c}`} title={l}>{i} {l}</span> }

export default function Picking() {
  const [wh, setWh] = useState(() => keep('cc_pick_wh', keep('cc_scan_wh', 'JHB')))
  const [day, setDay] = useState(today)
  const [data, setData] = useState(null) // { writes, lines }
  const [legacy, setLegacy] = useState(false)
  const [err, setErr] = useState(null)
  const [show, setShow] = useState('all') // all | no_selection | problems | upgrade_new | to_pick
  const [tick, setTick] = useState(0)
  const [choose, setChoose] = useState(null) // line → candidates drawer
  const [scanOpen, setScanOpen] = useState(false)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { put('cc_pick_wh', wh) }, [wh])
  useEffect(() => {
    let live = true
    setErr(null)
    supabase.rpc('coolerco_pick_board', { p_from: day, p_to: day, p_warehouse: whCaseName(wh) }).then(({ data: d, error }) => {
      if (!live) return
      if (error) { if (/does not exist|Could not find/i.test(error.message)) setLegacy(true); else setErr(error.message); return }
      setData(d)
    })
    return () => { live = false }
  }, [wh, day, tick])
  useEffect(() => { setData(null) }, [wh, day])

  const lines = useMemo(() => data?.lines || [], [data])
  const writes = !!data?.writes
  const count = f => lines.filter(l => (l.flags || []).includes(f)).length
  const problems = lines.filter(l => (l.flags || []).some(f => PROBLEM_FLAGS.includes(f))).length
  const picked = lines.filter(l => l.picked).length
  const shown = useMemo(() => lines.filter(l => show === 'all'
    || (show === 'problems' ? (l.flags || []).some(f => PROBLEM_FLAGS.includes(f)) : show === 'to_pick' ? l.selected_asset && !l.picked : (l.flags || []).includes(show))), [lines, show])
  const routes = useMemo(() => {
    const m = new Map()
    shown.forEach(l => { if (!m.has(l.route_id)) m.set(l.route_id, { r: l, lines: [] }); m.get(l.route_id).lines.push(l) })
    return [...m.values()]
  }, [shown])

  async function autofill() {
    if (!confirm(`Fill every stop without a cooler on ${dayLabel(day)} (${WH_NAMES[wh]}) with its best match?\nOnly exact condition matches are filled; the rest stay for you to choose.`)) return
    setBusy(true)
    const { data: r, error } = await supabase.rpc('coolerco_pick_autofill', { p_date: day, p_warehouse: whCaseName(wh) })
    setBusy(false)
    if (error || r?.error) setMsg({ bad: true, t: error?.message || r.error })
    else setMsg({ t: `✨ ${r.filled} stop(s) filled.${r.left ? ` ${r.left} still need you (no exact match — tap ✨ Choose).` : ''}` })
    setTick(t => t + 1)
  }
  async function undo(l, what) {
    const reason = prompt(what === 'pick' ? `Undo the pick of ${l.selected_bar_code}? Reason:` : `Remove ${l.selected_bar_code} from this stop? Reason:`)
    if (!reason?.trim()) return
    const { data: r, error } = await supabase.rpc('coolerco_pick_undo', { p_route: l.route_id, p_case: l.case_number, p_what: what, p_reason: reason })
    if (error || r?.error) setMsg({ bad: true, t: error?.message || r.error }); else setTick(t => t + 1)
  }

  if (legacy) return <PickingLegacy />
  const card = (key, label, value, sub, color) => (
    <button type="button" className={`stat-card c-${color}`} aria-pressed={show === key} onClick={() => setShow(show === key ? 'all' : key)}
      style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', outline: show === key ? '2px solid var(--accent)' : 'none' }}>
      <div className="stat-label">{label}</div><div className="stat-value">{data ? num(value) : '…'}</div><div className="stat-sub">{sub}</div>
    </button>)

  return (
    <>
      <Topbar title="Picking" sub="Suggested cooler per stop → scan to pick · wrong coolers are stopped"
        actions={writes && <button className="btn btn-primary btn-sm" onClick={() => setScanOpen(o => !o)}>📷 Scan to pick</button>} />
      <div className="page-content">
        <div className="filters" style={{ flexWrap: 'wrap', gap: 8 }}>
          <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => setWh(e.target.value)} aria-label="Warehouse">
            {WAREHOUSES.map(w => <option key={w} value={w}>🏢 {WH_NAMES[w]}</option>)}
          </select>
          <div className="seg">
            <button className="seg-btn" onClick={() => setDay(d => addDays(d, -1))} aria-label="Previous day">‹</button>
            {[[today(), 'Today'], [addDays(today(), 1), 'Tomorrow']].map(([d, l]) => <button key={d} className={`seg-btn${day === d ? ' on' : ''}`} onClick={() => setDay(d)}>{l}</button>)}
            <button className="seg-btn" onClick={() => setDay(d => addDays(d, 1))} aria-label="Next day">›</button>
          </div>
          <input type="date" className="field-ctrl" style={{ width: 'auto' }} value={day} onChange={e => e.target.value && setDay(e.target.value)} aria-label="Route date" />
          <span className="text3" style={{ fontSize: 11 }}>{dayLabel(day)}</span>
          {writes && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} disabled={busy || !count('no_selection')} onClick={autofill}>✨ Fill suggestions ({count('no_selection')})</button>}
        </div>
        {data && !writes && <div className="notice warn">👁 Read-only on this database — selecting and picking are done in the routing app here. (CoolerCo picking is switched on for UAT/TEST.)</div>}
        {err && <div className="form-msg error">{err}</div>}
        {msg && <div className={`form-msg ${msg.bad ? 'error' : 'success'}`}>{msg.t}</div>}

        {scanOpen && writes && <PickScan day={day} wh={wh} onPicked={() => setTick(t => t + 1)} onClose={() => setScanOpen(false)} />}

        <div className="stats-row">
          {card('all', '🚚 Stops to prepare', lines.length, `${new Set(lines.map(l => l.route_id)).size} route(s) · deliveries + replacements`, 'accent')}
          {card('no_selection', '❗ No cooler', count('no_selection'), 'tap ✨ Fill suggestions', count('no_selection') ? 'red' : 'green')}
          {card('to_pick', '✅ Picked', picked, `${lines.filter(l => l.selected_asset && !l.picked).length} selected, still to scan`, picked === lines.length && lines.length ? 'green' : 'orange')}
          {card('problems', '⚠ Problems', problems, 'not RTW, wrong family, at a store…', problems ? 'red' : 'green')}
          {card('upgrade_new', '🆕 New for used', count('upgrade_new'), 'A - New given where used was asked', count('upgrade_new') ? 'purple' : 'green')}
        </div>

        {!data && !err && <div className="load-state"><span className="spinner" /> Loading routes…</div>}
        {data && !lines.length && <div className="empty-state"><div className="empty-ico">📦</div><div>No delivery or replacement stops on {dayLabel(day)} for {WH_NAMES[wh]}.</div><div className="text3" style={{ fontSize: 11 }}>Routes are made in the routing app.</div></div>}
        {data && lines.length > 0 && !shown.length && <div className="empty-state"><div className="empty-ico">✅</div><div>Nothing in this filter.</div></div>}

        {routes.map(({ r, lines: ls }) => {
          const p = ls.filter(l => l.picked).length, s = ls.filter(l => l.selected_asset).length
          return (
            <details key={r.route_id} className="card wh-card" style={{ marginBottom: 10 }} open>
              <summary className="wh-card-hd">
                <div style={{ minWidth: 0 }}>
                  <div className="card-title">🚚 {r.route_number}{r.is_ncd ? <span className="tag tag-purple" style={{ marginLeft: 6 }}>NCD</span> : null}</div>
                  <div className="text3" style={{ fontSize: 10.5 }}>{r.driver || 'No driver yet'} · {r.route_status}</div>
                </div>
                <div className="prep-pills">
                  <span className={`tag tag-${s === ls.length ? 'green' : 'red'}`}>🎯 {s}/{ls.length} chosen</span>
                  <span className={`tag tag-${p === ls.length ? 'green' : 'orange'}`}>✅ {p}/{ls.length} picked</span>
                </div>
              </summary>
              <div className="tbl-wrap">
                <table className="tbl pick-tbl">
                  <thead><tr><th>#</th><th>Stop</th><th>Asked for</th><th>Cooler</th><th>Status</th>{writes && <th></th>}</tr></thead>
                  <tbody>{ls.map(l => (
                    <tr key={l.case_number}>
                      <td className="text3">{l.stop_sequence ?? '—'}</td>
                      <td style={{ fontSize: 11 }}>
                        <div className="mono" style={{ fontSize: 10.5 }}>{CASE_TYPE_ICON[l.case_type] || '•'} {l.case_number}</div>
                        <div className="trunc text3" style={{ maxWidth: 200, fontSize: 10.5 }} title={l.point_of_sale}>{l.point_of_sale}</div>
                      </td>
                      <td style={{ fontSize: 11 }}>
                        <div>{l.req_family_name || l.req_base || '—'}</div>
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
                          {l.req_condition && <span className={`tag tag-${condColor(l.req_condition)}`}>{l.req_condition}</span>}
                          {l.req_brand && <span className="tag tag-neutral">{l.req_brand}</span>}
                        </div>
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {l.selected_asset ? <>
                          <div className="mono"><b>{l.selected_bar_code}</b> <span className="text3">{l.selected_local_code}</span></div>
                          <div className="text3 trunc" style={{ maxWidth: 190, fontSize: 10.5 }}>{l.selected_variant || l.selected_base}</div>
                          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
                            {l.selected_condition && <span className={`tag tag-${condColor(l.selected_condition)}`}>{l.selected_condition}</span>}
                            {l.selected_brand && <span className="tag tag-neutral">{l.selected_brand}</span>}
                          </div>
                        </> : <span className="text3">—</span>}
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {l.picked ? <span className="tag tag-green" title={l.picked_at ? new Date(l.picked_at).toLocaleString('en-ZA') : ''}>✅ Picked</span> : null}
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 3 }}>
                          {(l.flags || []).filter(f => f !== 'not_picked' || !l.picked).map(f => <Flag key={f} f={f} />)}
                        </div>
                        {l.reserved_for && <div className="text3" style={{ fontSize: 10 }}>also on {l.reserved_for}</div>}
                      </td>
                      {writes && <td style={{ whiteSpace: 'nowrap' }}>
                        <button className={`btn btn-sm ${l.selected_asset ? 'btn-ghost' : 'btn-primary'}`} onClick={() => setChoose(l)}>✨ {l.selected_asset ? 'Change' : 'Choose'}</button>
                        {l.selected_asset && <button className="btn btn-ghost btn-sm" title={l.picked ? 'Undo pick' : 'Remove cooler'} onClick={() => undo(l, l.picked ? 'pick' : 'select')}>↩</button>}
                      </td>}
                    </tr>))}
                  </tbody>
                </table>
              </div>
            </details>)
        })}
        <details className="sec" style={{ marginTop: 10 }}>
          <summary>ℹ️ How picking works here</summary>
          <div className="sec-body" style={{ fontSize: 11.5 }}>
            <p><b>1. Choose:</b> ✨ Fill suggestions gives every stop its best Ready-to-Work cooler: same family, the requested condition, then branding and model. It never offers a cooler reserved for another open case or on an open case. Stops without an exact match stay for you: ✨ Choose shows the options.</p>
            <p><b>2. Scan to pick:</b> scan the cooler — the app finds its stop by itself. ✅ green = picked. ⛔ red + buzz = wrong cooler, not RTW, other warehouse or already at a store; you can only go on with a reason.</p>
            <p><b>New stock:</b> giving <i>A - New</i> where <i>used</i> was asked needs a reason, so new stock is only used on purpose. Every choice, pick, swap and undo is logged with who and why.</p>
          </div>
        </details>
      </div>
      <Candidates line={choose} onClose={() => setChoose(null)} onDone={t => { setChoose(null); setMsg({ t }); setTick(n => n + 1) }} />
    </>
  )
}

// ✨ Options for one stop → select (asks a reason when the cooler doesn't fully match)
function Candidates({ line, onClose, onDone }) {
  const [list, setList] = useState(null)
  const [pending, setPending] = useState(null) // { asset, soft }
  const [reason, setReason] = useState('')
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (!line) return
    setList(null); setPending(null); setReason(''); setErr(null)
    supabase.rpc('coolerco_pick_candidates', { p_route: line.route_id, p_case: line.case_number, p_limit: 12 })
      .then(({ data, error }) => { if (error) setErr(error.message); setList(data || []) })
  }, [line])
  async function select(c, why) {
    setErr(null)
    const { data: r, error } = await supabase.rpc('coolerco_pick_select', { p_route: line.route_id, p_case: line.case_number, p_asset: c.asset, p_reason: why || null })
    if (error) return setErr(error.message)
    if (r?.needs_reason) { setPending({ c, soft: r.soft }); return }
    if (r?.blocked) return setErr('Not allowed: ' + (r.hard || []).map(f => FLAG[f]?.[1] || f).join(', '))
    if (!r?.ok) return setErr(r?.error || 'Not saved')
    onDone(`🎯 ${c.bar_code} chosen for ${line.point_of_sale}.`)
  }
  return (
    <Drawer open={!!line} onClose={onClose} title={line ? `Choose a cooler · stop ${line.stop_sequence ?? ''}` : ''} icon="✨">
      {line && <>
        <div className="req-box" style={{ marginBottom: 10, fontSize: 11.5 }}>
          <div><b>{line.point_of_sale}</b> <span className="mono text3">{line.case_number}</span></div>
          <div>Asked: {line.req_family_name || line.req_base} · {line.req_condition || 'any condition'} · {line.req_brand || 'any branding'}</div>
          {line.selected_asset && <div className="text3">Now: {line.selected_bar_code} ({line.selected_condition})</div>}
        </div>
        {err && <div className="form-msg error">{err}</div>}
        {pending && (
          <div className="req-box" style={{ borderColor: 'var(--orange)', marginBottom: 10 }}>
            <div style={{ fontSize: 11.5, marginBottom: 6 }}><b>{pending.c.bar_code}</b> needs a reason: {(pending.soft || []).map(f => <Flag key={f} f={f} />)}</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>{REASONS.map(r => <button key={r} type="button" className={`btn btn-sm ${reason === r ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setReason(r)}>{r}</button>)}</div>
            <input className="field-ctrl" style={{ width: '100%' }} placeholder="Reason" value={reason} onChange={e => setReason(e.target.value)} />
            <div className="modal-btns"><button className="btn btn-ghost btn-sm" onClick={() => setPending(null)}>Back</button>
              <button className="btn btn-primary btn-sm" disabled={!reason.trim()} onClick={() => select(pending.c, reason)}>Choose with reason</button></div>
          </div>)}
        {!list ? <div className="load-state"><span className="spinner" /> Finding coolers…</div> : !list.length ? (
          <div className="empty-state"><div className="empty-ico">🔍</div><div>No free Ready-to-Work cooler of this family in this warehouse.</div></div>
        ) : list.map((c, i) => (
          <div key={c.asset} className="pick-cand">
            <div style={{ minWidth: 0 }}>
              <div className="mono"><b>{c.bar_code}</b> <span className="text3">{c.local_code}</span>{i === 0 && !c.upgrade_new && c.same_condition ? <span className="tag tag-green" style={{ marginLeft: 6 }}>Best match</span> : null}</div>
              <div className="text3 trunc" style={{ fontSize: 10.5 }}>{c.product_variant || c.product_base}{c.area ? ` · 📍 ${c.area}` : ''}</div>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
                <span className={`tag tag-${condColor(c.condition)}`}>{c.condition}</span>
                {c.brand && <span className={`tag tag-${c.same_brand ? 'neutral' : 'orange'}`}>{c.brand}</span>}
                {c.upgrade_new && <Flag f="upgrade_new" />}
                {!c.same_condition && !c.upgrade_new && <Flag f="condition" />}
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => select(c)}>Choose</button>
          </div>))}
      </>}
    </Drawer>
  )
}

// 📷 Scan to pick — camera (continuous) or hand scanner / typing. The scan finds its own stop.
function PickScan({ day, wh, onPicked, onClose }) {
  const [code, setCode] = useState('')
  const [cam, setCam] = useState(false)
  const [res, setRes] = useState(null) // last result + what was sent
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const timer = useRef(entryTimer())
  const inp = useRef(null)
  useEffect(() => { inp.current?.focus() }, [])

  async function send(raw, how, extra = {}) {
    const k = String(raw || '').trim(); if (!k) return
    setBusy(true); setCode('')
    const args = { p_code: k, p_date: day, p_warehouse: whCaseName(wh), p_how: how, p_route: extra.route || null, p_case: extra.case || null,
      p_reason: extra.reason || null, p_client: crypto.randomUUID() }
    const { data: r, error } = await supabase.rpc('coolerco_pick_scan', args)
    setBusy(false)
    const out = error ? { result: 'error', message: error.message } : (r?.error ? { result: 'error', message: r.error } : r)
    const good = out.result === 'picked'
    buzz(!good); beep(!good && out.result !== 'choose_stop')
    setRes({ ...out, code: k, how, sent: extra }); setReason('')
    if (good) onPicked()
    inp.current?.focus()
  }
  const again = extra => send(res.code, res.how, { route: res.sent.route, case: res.sent.case, ...extra })
  const tone = { picked: 'ok', choose_stop: 'ask', needs_reason: 'warn', wrong_cooler: 'bad', blocked: 'bad', not_found: 'warn', no_stop: 'warn', error: 'bad' }[res?.result] || 'ask'

  const panel = res && (
    <div className={`pick-res ${tone}`}>
      {res.result === 'picked' && <><div className="pick-res-t">✅ Picked {res.asset?.bar_code || res.code}</div>
        <div>{res.stop ? <>Route {res.stop.route_number} · stop {res.stop.stop} · <b>{res.stop.store}</b></> : 'Already picked'}</div></>}
      {res.result === 'choose_stop' && <><div className="pick-res-t">❓ {res.asset?.bar_code} · {res.asset?.product_variant || res.asset?.product_base} · {res.asset?.condition}</div>
        <div style={{ marginBottom: 4 }}>Not chosen for a stop yet. Which stop is it for?</div>
        {(res.stops || []).map(s => <button key={s.case_number} type="button" className={`btn btn-sm ${s.match ? 'btn-primary' : 'btn-ghost'}`} style={{ margin: '0 4px 4px 0' }}
          onClick={() => send(res.code, res.how, { route: s.route_id, case: s.case_number })}>{s.route_number} · {s.stop ?? '—'} · {s.store}{s.match ? ' ✓' : ` (${s.req_condition || '?'})`}</button>)}</>}
      {res.result === 'wrong_cooler' && <><div className="pick-res-t">⛔ Wrong cooler</div>
        <div>This stop ({res.stop?.store}) is set for <b className="mono">{res.selected_bar_code}</b>. Put this one back — or swap with a reason:</div></>}
      {res.result === 'needs_reason' && <><div className="pick-res-t">⚠ {res.asset?.bar_code} doesn&rsquo;t fully match {res.stop?.store}</div>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>{(res.soft || []).map(f => <Flag key={f} f={f} />)}</div></>}
      {res.result === 'blocked' && <><div className="pick-res-t">⛔ Can&rsquo;t pick {res.asset?.bar_code}</div>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>{(res.hard || []).map(f => <Flag key={f} f={f} />)}</div><div className="text3">{res.asset?.place}</div></>}
      {res.result === 'no_stop' && <><div className="pick-res-t">🤷 No stop needs {res.asset?.bar_code || res.code} on {dayLabel(day)}</div><div>{res.asset?.product_base} · {res.asset?.condition} · {res.asset?.status}</div></>}
      {res.result === 'not_found' && <div className="pick-res-t">🔍 “{res.code}” not found — try the local code</div>}
      {res.result === 'error' && <div className="pick-res-t">⚠ {res.message}</div>}
      {['wrong_cooler', 'needs_reason'].includes(res.result) && <div style={{ marginTop: 6 }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>{REASONS.map(r => <button key={r} type="button" className={`btn btn-sm ${reason === r ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setReason(r)}>{r}</button>)}</div>
        <div style={{ display: 'flex', gap: 6 }}><input className="field-ctrl" style={{ flex: 1 }} placeholder="Reason" value={reason} onChange={e => setReason(e.target.value)} />
          <button type="button" className="btn btn-primary btn-sm" disabled={!reason.trim() || busy} onClick={() => again({ reason, route: res.route_id || res.sent.route || null, case: res.case_number || res.sent.case || null })}>Pick anyway</button></div>
      </div>}
      {res.how === 'typed' && res.asset?.bar_code && res.result === 'picked' && <LabelPrompt asset={res.asset} reason={res.asset.bar_code.startsWith('11') ? 'lost' : 'never_labelled'} dark={cam} />}
    </div>)

  return (
    <div className="card" style={{ padding: 10, marginBottom: 10 }}>
      <form className="scan-find" style={{ marginBottom: res ? 8 : 0 }} onSubmit={e => { e.preventDefault(); send(code, timer.current.wasScanner(code.trim()) ? 'scanner' : 'typed') }}>
        <button type="button" className="btn btn-primary scan-cam-btn" onClick={() => setCam(true)}>📷 Scan</button>
        <div className="search-wrap"><span className="ico">📦</span>
          <input ref={inp} enterKeyHint="go" autoComplete="off" placeholder={`Scan a cooler to pick · ${WH_NAMES[wh]} · ${dayLabel(day)}`} value={code}
            onChange={e => { timer.current.onChange(e.target.value); setCode(e.target.value) }} /></div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close scanning">✕</button>
      </form>
      {!cam && panel}
      {cam && <CameraScan continuous paused={busy} onClose={() => setCam(false)} onResult={t => send(t, 'camera')}>{panel}</CameraScan>}
    </div>
  )
}
