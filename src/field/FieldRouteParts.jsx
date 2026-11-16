import { useState } from 'react'
import { getGps } from '../lib/photos'
import { DELAY_TYPES, ROUTE_DELAY_REASONS, POS_DELAY_REASONS, POS_ISSUES, recordRouteEvent, savePosReport } from './fieldStops'

// Pieces of RouteIQ's mobile trip sheet, in the Field app (script 033; everything queued on the phone):
//   RouteWarehouse — 🏭 Start at WH · leaving now / 🏠 Returned to warehouse (+ "after 08:00, have you left?" reminder)
//   RouteDelay     — ⏱ Report a delay (late departure / running late) → Notify planner
//   StopExtras     — ⏱ delay at this POS · ⚠️ Incorrect POS detail (issues + notes + corrected values + GPS → review)
const fmtTime = t => (t ? new Date(t).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : '')
const isToday = d => d === new Date().toLocaleDateString('en-CA')

export function RouteWarehouse({ route, driver, events, onSaved, where = 'top' }) {
  const [busy, setBusy] = useState(false)
  const left = events.find(e => e.event_type === 'left_warehouse')
  const back = events.find(e => e.event_type === 'returned_warehouse')
  const closed = ['cancelled', 'not_used'].includes(route.status)
  const tap = async type => { setBusy(true); try { await recordRouteEvent(route, driver, type); onSaved() } finally { setBusy(false) } }
  if (where === 'top') {
    const remind = !left && !closed && isToday(route.route_date) && new Date().getHours() >= 8
    return (
      <div className="f-wh">
        {left ? <div className="f-wh-done">🏭 Left warehouse {fmtTime(left.occurred_at)}{left.pending ? ' · ⏳' : ''}</div>
          : <button className="btn btn-primary" disabled={busy || closed} onClick={() => tap('left_warehouse')}>{busy ? '…' : '🏭 Start at WH · leaving now'}</button>}
        {remind && <div className="form-msg warn" style={{ marginTop: 6 }}>⏰ It is after 08:00. Tap <b>Start at WH</b> when you leave the warehouse. If you left earlier, tell your supervisor the actual time.</div>}
      </div>
    )
  }
  return (
    <div className="f-card">
      {back ? <div className="f-wh-done">🏠 Returned to warehouse {fmtTime(back.occurred_at)}{back.pending ? ' · ⏳' : ''}</div>
        : <button className="btn btn-primary" style={{ width: '100%', minHeight: 46, justifyContent: 'center' }} disabled={busy || !left || closed} onClick={() => tap('returned_warehouse')}>{busy ? '…' : `🏠 Returned to warehouse${route.route_number ? ` · ${route.route_number}` : ''}`}</button>}
      {!left && !back && <small className="text3" style={{ display: 'block', textAlign: 'center', marginTop: 4 }}>Available after Start at WH.</small>}
    </div>
  )
}

export function RouteDelay({ route, driver, events, onSaved }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState('late_departure')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState(null)
  const list = events.filter(e => e.event_type === 'delay' && e.delay_type !== 'pos_delay')
  const send = async () => {
    if (!reason) return setMsg({ t: 'err', s: 'Choose a reason.' })
    await recordRouteEvent(route, driver, 'delay', { delay_type: type, reason, note })
    setReason(''); setNote(''); setMsg({ t: 'ok', s: 'Delay saved. The planner can see it' + (navigator.onLine ? '.' : ' once there is signal.') }); onSaved()
  }
  return (
    <details className="f-fold" open={open} onToggle={e => setOpen(e.target.open)}>
      <summary>⏱ Report a delay{list.length ? ` · ${list.length} reported` : ''}</summary>
      <div className="field-lbl">Delay type</div>
      <div className="f-chips">{DELAY_TYPES.map(([k, l]) => <button key={k} className={type === k ? 'on' : ''} onClick={() => setType(k)}>{l}</button>)}</div>
      <div className="field-lbl" style={{ marginTop: 8 }}>Reason</div>
      <div className="f-chips">{ROUTE_DELAY_REASONS.map(r => <button key={r} className={reason === r ? 'on' : ''} onClick={() => setReason(r)}>{r}</button>)}</div>
      <div className="field-lbl" style={{ marginTop: 8 }}>Additional details (optional)</div>
      <textarea className="field-ctrl" rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} />
      <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={send}>📣 Notify planner</button>
      {msg && <div className={`form-msg ${msg.t === 'ok' ? 'ok' : 'err'}`} style={{ marginTop: 6 }}>{msg.s}</div>}
      {list.map(e => <small key={e.id} className="text3" style={{ display: 'block' }}>{fmtTime(e.occurred_at)} · {DELAY_TYPES.find(d => d[0] === e.delay_type)?.[1]} · {e.reason}{e.note ? ` · ${e.note}` : ''}{e.pending ? ' · ⏳' : ''}</small>)}
    </details>
  )
}

export function StopExtras({ stop, driver, events, reports, contact, onSaved }) {
  const [panel, setPanel] = useState(null) // 'delay' | 'pos'
  const delays = events.filter(e => e.event_type === 'delay' && e.stop_id === stop.id)
  const myReports = reports.filter(r => r.stop_id === stop.id)
  return (
    <div className="f-extras">
      <div className="f-row" style={{ gap: 6 }}>
        <button className={`btn btn-ghost btn-sm f-grow ${panel === 'delay' ? 'on' : ''}`} onClick={() => setPanel(p => p === 'delay' ? null : 'delay')}>⏱ Delay at this POS{delays.length ? ' ✓' : ''}</button>
        <button className={`btn btn-ghost btn-sm f-grow ${panel === 'pos' ? 'on' : ''}`} onClick={() => setPanel(p => p === 'pos' ? null : 'pos')}>⚠️ Incorrect POS detail{myReports.length ? ' ✓' : ''}</button>
      </div>
      {panel === 'delay' && <PosDelay stop={stop} driver={driver} delays={delays} onSaved={() => { onSaved(); setPanel(null) }} />}
      {panel === 'pos' && <PosReport stop={stop} driver={driver} contact={contact} reports={myReports} onSaved={() => { onSaved(); setPanel(null) }} />}
    </div>
  )
}

function PosDelay({ stop, driver, delays, onSaved }) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState(null)
  const save = async () => {
    if (!reason) return setErr('Choose a reason.')
    if (reason === 'Other' && !note.trim()) return setErr('Add a short note for "Other".')
    await recordRouteEvent({ id: stop.route_id }, driver, 'delay', { stop, delay_type: 'pos_delay', reason, note })
    onSaved()
  }
  return (
    <div className="f-panel">
      <div className="field-lbl">Reason</div>
      <div className="f-chips">{POS_DELAY_REASONS.map(r => <button key={r} className={reason === r ? 'on' : ''} onClick={() => setReason(r)}>{r}</button>)}</div>
      <textarea className="field-ctrl" style={{ marginTop: 6 }} rows={2} placeholder="Additional details" value={note} onChange={e => setNote(e.target.value)} />
      {err && <div className="form-msg err" style={{ marginTop: 6 }}>{err}</div>}
      <button className="btn btn-primary" style={{ width: '100%', marginTop: 6 }} onClick={save}>Save POS delay</button>
      {delays.map(e => <small key={e.id} className="text3" style={{ display: 'block' }}>{fmtTime(e.occurred_at)} · {e.reason}{e.note ? ` · ${e.note}` : ''}{e.pending ? ' · ⏳' : ''}</small>)}
    </div>
  )
}

function PosReport({ stop, driver, contact, reports, onSaved }) {
  const [sel, setSel] = useState({})       // issue → note
  const [fix, setFix] = useState({ name: '', address: '', contact: '', phone: '' })
  const [gps, setGps] = useState(null)
  const [gpsBusy, setGpsBusy] = useState(false)
  const [err, setErr] = useState(null)
  const toggle = k => setSel(s => { const n = { ...s }; if (k in n) delete n[k]; else n[k] = ''; return n })
  const capture = async () => { setGpsBusy(true); setGps(await getGps(10000)); setGpsBusy(false) }
  const save = async () => {
    const keys = Object.keys(sel)
    if (!keys.length) return setErr('Tick at least one issue.')
    if (keys.some(k => !sel[k].trim())) return setErr('Write a note for each ticked issue.')
    if ('incorrect_gps' in sel && !gps) return setErr('Tap "Capture current GPS" while standing at the store.')
    await savePosReport(stop, driver, { issues: keys.map(k => ({ type: k, note: sel[k].trim() })), fix, gps })
    onSaved()
  }
  return (
    <div className="f-panel">
      <p className="text3" style={{ fontSize: 11.5, margin: '0 0 6px' }}>Tick every issue and write a note for each. The report goes to the office for review — it does not change the saved store details.</p>
      {POS_ISSUES.map(([k, l]) => (
        <div key={k} style={{ marginBottom: 6 }}>
          <label className="f-check" style={{ marginTop: 0 }}><input type="checkbox" checked={k in sel} onChange={() => toggle(k)} /> {l}</label>
          {k in sel && (
            <>
              <input className="field-ctrl" style={{ marginTop: 4 }} placeholder="What is wrong?" value={sel[k]} onChange={e => setSel(s => ({ ...s, [k]: e.target.value }))} />
              {k === 'incorrect_pos_name' && <input className="field-ctrl" style={{ marginTop: 4 }} placeholder={`Correct name (now: ${stop.point_of_sale || '—'})`} value={fix.name} onChange={e => setFix(f => ({ ...f, name: e.target.value }))} />}
              {k === 'incorrect_address' && <textarea className="field-ctrl" style={{ marginTop: 4 }} rows={2} placeholder="Correct address" value={fix.address} onChange={e => setFix(f => ({ ...f, address: e.target.value }))} />}
              {k === 'incorrect_contact' && <>
                <input className="field-ctrl" style={{ marginTop: 4 }} placeholder={`Correct contact name (now: ${contact?.customer_contact_name || '—'})`} value={fix.contact} onChange={e => setFix(f => ({ ...f, contact: e.target.value }))} />
                <input className="field-ctrl" style={{ marginTop: 4 }} inputMode="tel" placeholder={`Correct number (now: ${contact?.mobile_phone || contact?.business_phone || '—'})`} value={fix.phone} onChange={e => setFix(f => ({ ...f, phone: e.target.value }))} />
              </>}
            </>
          )}
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={capture} disabled={gpsBusy}>{gpsBusy ? '📡 Getting GPS…' : '📍 Capture current GPS'}</button>
      <small className="text3" style={{ display: 'block', marginTop: 4 }}>{gps ? `GPS captured ±${gps.acc} m (${gps.lat}, ${gps.lng})` : 'Stand at the store entrance, then capture.'}</small>
      {err && <div className="form-msg err" style={{ marginTop: 6 }}>{err}</div>}
      <button className="btn btn-primary" style={{ width: '100%', marginTop: 6 }} onClick={save}>Save issue report</button>
      {reports.map(r => <small key={r.id} className="text3" style={{ display: 'block' }}>Reported {fmtTime(r.created_at)} · {(r.issues || []).map(i => POS_ISSUES.find(x => x[0] === i.type)?.[1]).join(', ')}{r.pending ? ' · ⏳' : ''}</small>)}
    </div>
  )
}
