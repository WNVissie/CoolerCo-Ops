import { useState } from 'react'
import { supabase } from '../lib/supabase'

// ✅ Close a Demo / Tiger case from the office (script 058) — when the driver's phone is down, broken or out of data.
// Same outcomes as the job card: Completed (or Partly done where the client has it) or a not-done reason.
// What each choice does comes from the case rules (status, follow-up case, cooler moves) — shown on the button.
const WHY = ['Driver phone broken / lost', 'Driver out of data / no signal', 'Driver confirmed by phone', 'Store confirmed by phone', 'Driver forgot to close', 'Field app problem']
const ERR = {
  not_allowed: 'Your user may not close cases (warehouse or office role needed).', why_required: 'Say why the office closes it.',
  delivered_required: 'Which cooler was delivered? Type or scan its number.', removed_required: 'Which cooler was collected?',
  removed_not_found: 'That collected cooler is not in this client\'s register.', note_required: 'This reason needs a note.',
  already_closed: 'This case is already closed.', not_approved: 'The case is still waiting for approval.', future_time: 'The time is in the future.',
  needs_supervisor: 'This outcome needs a supervisor (manager / supervisor) to close.', bad_result: 'Choose an outcome.',
  on_desk: 'This case is waiting on the Action Required desk — choose reschedule or cancel there.',
  asset_not_found: 'No cooler with that number for this client.', other_warehouse: 'That cooler is in another warehouse.',
  not_ready: 'That cooler is not Ready to Work.', picked_elsewhere: 'That cooler is picked for another case.', refused: 'Not allowed for this case type.',
}
const effect = o => o.status ? `→ ${o.status}${o.follow_up ? ` + new ${o.follow_up}` : ''}` : '→ stays open (carried over)'
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }

export default function CaseOfficeClose({ opts, onDone, onCancel }) {
  const [res, setRes] = useState(null)
  const [why, setWhy] = useState('')
  const [note, setNote] = useState('')
  const [deliv, setDeliv] = useState('')
  const [rem, setRem] = useState(opts.asset_removed || '')
  const [at, setAt] = useState(localNow)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const done = opts.outcomes.filter(o => o.kind === 'done'), notDone = opts.outcomes.filter(o => o.kind === 'not_done')
  const chosen = opts.outcomes.find(o => o.key === res)
  const showDeliv = chosen?.kind === 'done' && opts.needs_delivered && res !== 'collected_only'
  const needDeliv = showDeliv && !opts.asset_delivered
  const needRem = (res === 'completed' || res === 'collected_only') && opts.needs_removed

  async function save() {
    setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('coolerco_case_office_close', {
      p_case: opts.case, p_result: res, p_why: why, p_note: note || null,
      p_delivered: needDeliv ? deliv.trim() || null : null, p_removed: needRem && rem.trim() !== (opts.asset_removed || '') ? rem.trim() || null : null,
      p_at: at ? new Date(at).toISOString() : null,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    if (data?.error) return setErr(`${data.asset ? data.asset + ': ' : ''}${ERR[data.error] || data.error}${data.status ? ` (${data.status})` : ''}`)
    const fu = [data?.engine?.follow_up, data?.missing_half].filter(Boolean)
    onDone(`✅ ${opts.case} → ${data.status}${fu.length ? ` · follow-up case ${fu.join(' + ')} made` : ''}${data?.engine?.movements ? ` · ${data.engine.movements} cooler move(s) saved` : ''}${data.status === 'Action Required' ? ' · now on the 🧭 Action Required desk' : ''}.`)
  }

  return (
    <div className="req-box" style={{ marginTop: 6 }}>
      <div className="lbl">✅ Close {opts.case} from the office</div>
      <div className="text3" style={{ fontSize: 10.5, marginBottom: 6 }}>Same outcomes and rules as the driver&rsquo;s job card. Logged with your name.</div>
      <div style={{ fontSize: 11, fontWeight: 600, margin: '4px 0' }}>Done</div>
      <div className="chip-row">
        {done.map(o => <button type="button" key={o.key} className={`chip-opt${res === o.key ? ' on' : ''}`} onClick={() => setRes(o.key)} title={effect(o)}>✅ {o.label} <span className="text3">{effect(o)}</span></button>)}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, margin: '6px 0 4px' }}>Not done</div>
      <div className="chip-row">
        {notDone.map(o => <button type="button" key={o.key} className={`chip-opt${res === o.key ? ' on' : ''}`} onClick={() => setRes(o.key)} title={effect(o)}>{o.alert ? '🚨 ' : ''}{o.label} <span className="text3">{effect(o)}</span></button>)}
      </div>
      {chosen?.alert && <div className="text3" style={{ fontSize: 10.5, marginTop: 4 }}>🚨 The region gets an alert to {chosen.alert === 'location' ? 'check and fix the store location' : 'check the customer contact details'} and to request the reschedule.</div>}
      {chosen?.needs_approval && <div className="text3" style={{ fontSize: 10.5 }}>🧑‍✈️ Needs a supervisor / manager.</div>}
      {chosen && <>
        {showDeliv && (opts.asset_delivered
          ? <div style={{ fontSize: 11, marginTop: 6 }}>📦 Delivered cooler: <b className="mono">{opts.asset_delivered}</b> (picked)</div>
          : <input className="field-ctrl" style={{ width: '100%', marginTop: 6 }} value={deliv} onChange={e => setDeliv(e.target.value)} placeholder={`📦 Delivered cooler no. (asked: ${opts.requested_model || 'any model'})`} />)}
        {needRem && <input className="field-ctrl" style={{ width: '100%', marginTop: 6 }} value={rem} onChange={e => setRem(e.target.value.toUpperCase())} placeholder="↩️ Collected cooler no." />}
        <div style={{ fontSize: 11, fontWeight: 600, margin: '8px 0 4px' }}>Why is the office closing it?</div>
        <div className="chip-row">
          {WHY.map(w => <button type="button" key={w} className={`chip-opt${why === w ? ' on' : ''}`} onClick={() => setWhy(w)}>{w}</button>)}
        </div>
        <input className="field-ctrl" style={{ width: '100%', marginTop: 4 }} value={why} onChange={e => setWhy(e.target.value)} placeholder="Why (required)" />
        <textarea className="field-ctrl" rows={2} style={{ width: '100%', marginTop: 6 }} value={note} onChange={e => setNote(e.target.value)} placeholder={chosen.needs_note ? 'Note (required for this reason)' : 'Note (optional)'} />
        <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>When was it done?
          <input type="datetime-local" className="field-ctrl" style={{ width: 'auto' }} value={at} max={localNow()} onChange={e => setAt(e.target.value)} />
        </label>
      </>}
      {err && <div className="form-msg error" style={{ marginTop: 6 }}>{err}</div>}
      <div className="modal-btns" style={{ marginTop: 6 }}>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}>Back</button>
        <button className="btn btn-primary btn-sm" disabled={busy || !res || !why.trim()} onClick={save}>{busy ? 'Saving…' : '✅ Save outcome'}</button>
      </div>
    </div>
  )
}
