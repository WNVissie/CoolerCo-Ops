import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { CASE_TYPE_ICON } from '../lib/helpers'

// 🧭 Action Required desk for one case (script 059) — Demo / Tiger and other self-managed clients.
// Ways out depend on the case type and what went wrong (rules decided by Wanda 25 Nov):
//   reschedule = a new case linked to this one (parent → Resolved) · cancel = coolers back where they were
//   Repair at POS failed → new repair / Replacement / Removal · Repair at Workshop failed → relog repair / Scrap (no cancel)
const ERR = {
  not_allowed: 'Your user may not decide on this case.', way_not_allowed: 'That follow-up is not allowed for this case.',
  cancel_not_allowed: 'A failed workshop repair cannot be cancelled — relog the repair or scrap the cooler.',
  reason_required: 'Choose a cancel reason.', note_required: 'Add a short note for "Other".', not_action_required: 'The case is no longer waiting on the desk.',
}
const WAY_LABEL = t => t === 'Scrap an Asset' ? '🗑 Scrap the cooler' : `🔁 New ${t}`
const EVENT_LABEL = { location_unavailable: 'Location unavailable', location_closed: 'Location closed', denied: 'Service denied', repair_failed: 'Repair failed',
  lack_material: 'Lack of material', no_contact: 'Customer could not be contacted', asset_missing: 'Asset missing', other: 'Other reason' }

export default function CaseDesk({ caseNumber, onDone }) {
  const [o, setO] = useState(null)
  const [mode, setMode] = useState(null) // { way } | 'cancel'
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const load = () => supabase.rpc('coolerco_ar_options', { p_case: caseNumber }).then(({ data, error }) => setO(error || !data || data.error ? null : data))
  useEffect(() => { setO(null); setMode(null); load() }, [caseNumber])
  if (!o) return null

  async function go() {
    setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('coolerco_ar_resolve', mode === 'cancel'
      ? { p_case: caseNumber, p_action: 'cancel', p_reason: reason, p_note: note || null }
      : { p_case: caseNumber, p_action: 'reschedule', p_type: mode.way, p_note: note || null })
    setBusy(false)
    if (error) return setErr(error.message)
    if (data?.error) return setErr(ERR[data.error] || data.error)
    onDone(mode === 'cancel' ? `🚫 ${caseNumber} cancelled — coolers back where they were.${data.on_route ? ` Marked as cancelled on route ${data.on_route}.` : ''}`
      : `🔁 New ${data.type} case ${data.new_case} made; ${caseNumber} is Resolved.`)
  }

  const openAlerts = o.alerts.filter(a => a.status === 'open')
  return (
    <div className="req-box" style={{ marginTop: 6, borderColor: 'var(--orange)' }}>
      <div className="lbl">🧭 Action required · {EVENT_LABEL[o.event] || o.event || 'needs a decision'}</div>
      {o.reason && <div style={{ fontSize: 11 }}>{o.reason}</div>}
      <div className="text3" style={{ fontSize: 10.5 }}>{o.since ? `since ${new Date(o.since).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</div>
      {o.alerts.map(a => (
        <div key={a.id} className={`form-msg ${a.status === 'open' ? 'warn' : 'success'}`} style={{ display: 'block', marginTop: 4, fontSize: 11 }}>
          🚨 {a.kind === 'location' ? 'Region asked to check the store location' : 'Region asked to check the customer contact'} ·{' '}
          {a.status === 'open' ? 'waiting for the region' : `done by ${a.done_by || '—'}${a.note ? ` · ${a.note}` : ''}`}
        </div>))}
      {!o.can_decide ? <div className="text3" style={{ fontSize: 10.5, marginTop: 4 }}>The warehouse or the client decides what happens next.</div> : !mode ? (
        <div className="modal-btns" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', marginTop: 6 }}>
          {o.ways.map(w => <button key={w} className="btn btn-primary btn-sm" onClick={() => { setMode({ way: w }); setErr(null) }}>{CASE_TYPE_ICON[w] || ''} {WAY_LABEL(w)}</button>)}
          {o.can_cancel && <button className="btn btn-danger btn-sm" onClick={() => { setMode('cancel'); setErr(null) }}>🚫 Cancel case</button>}
        </div>
      ) : (
        <div style={{ marginTop: 6 }}>
          {mode === 'cancel' ? <>
            {o.on_route && <div className="form-msg warn" style={{ display: 'block', marginBottom: 6 }}>🚚 On route <b>{o.on_route.route}</b> — recorded as <b>cancelled on route</b>.</div>}
            <select className="field-ctrl" value={reason} onChange={e => setReason(e.target.value)} style={{ width: '100%', marginBottom: 6 }}>
              <option value="">Cancel reason…</option>
              {(o.cancel_reasons || []).map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </> : <div style={{ fontSize: 11, marginBottom: 6 }}>{WAY_LABEL(mode.way)}: a new case for the same store, linked to {caseNumber}, with its own SLA.{openAlerts.length ? ' The open region alert is closed with it.' : ''}</div>}
          <textarea className="field-ctrl" rows={2} style={{ width: '100%' }} value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" />
          {err && <div className="form-msg error">{err}</div>}
          <div className="modal-btns" style={{ marginTop: 6 }}>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setMode(null)}>Back</button>
            <button className={`btn btn-sm ${mode === 'cancel' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (mode === 'cancel' && !reason)} onClick={go}>
              {busy ? 'Saving…' : mode === 'cancel' ? '🚫 Cancel case' : '✅ Make the new case'}</button>
          </div>
        </div>)}
    </div>
  )
}
