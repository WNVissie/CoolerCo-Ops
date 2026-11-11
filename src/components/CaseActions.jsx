import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// What can be done with a case:
//  • COM case  → "Open in COM ↗" (cancelling happens in COM — CoolerCo never writes to COM)
//  • CoolerCo case → "Cancel case" with a reason (staff roles only, logged in the case history)
// Needs script 022 (coolerco_case_actions / coolerco_case_cancel). Without it this block shows nothing.
const ERR = {
  not_allowed: 'Your user does not have a role that may cancel cases.',
  reason_required: 'Choose a reason.',
  note_required: 'Add a short note for "Other".',
  already_closed: 'This case is already closed.',
  com_case: 'This is a COM case — cancel it in COM.',
  not_found: 'Case not found.',
  sign_in: 'Please sign in again.',
}

export default function CaseActions({ caseNumber, onChanged }) {
  const [a, setA] = useState(null)
  const [reasons, setReasons] = useState([])
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [copied, setCopied] = useState(false)

  const load = () => supabase.rpc('coolerco_case_actions', { p_case: caseNumber })
    .then(({ data, error }) => setA(error || !data || data.error ? null : data))

  useEffect(() => { setA(null); setCancelOpen(false); setMsg(null); if (caseNumber) load() }, [caseNumber])
  useEffect(() => {
    if (!cancelOpen || reasons.length) return
    supabase.from('coolerco_reason_codes').select('code,label').eq('status', 'Cancelled').eq('active', true).order('sort_order')
      .then(({ data }) => setReasons(data || []))
  }, [cancelOpen])

  if (!a) return null

  const copy = () => {
    navigator.clipboard?.writeText(a.case_number).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }
  const cancel = async () => {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('coolerco_case_cancel', { p_case: a.case_number, p_reason: reason, p_note: note || null })
    setBusy(false)
    if (error) return setMsg({ bad: true, t: error.message })
    if (data?.error) return setMsg({ bad: true, t: ERR[data.error] || data.error })
    setMsg({ t: '✅ Case cancelled — logged in the case history.' }); setCancelOpen(false); setReason(''); setNote('')
    load(); onChanged?.()
  }

  return (
    <div className="case-actions">
      <div className="case-actions-row">
        <span className={`tag tag-${a.source === 'COM' ? 'neutral' : 'blue'}`}>{a.source === 'COM' ? '🟦 COM case' : '🟩 CoolerCo case'}</span>
        <button className="btn btn-ghost btn-sm" onClick={copy} title="Copy the case number">{copied ? '✓ Copied' : '📋 Copy no.'}</button>
        {a.source === 'COM' && a.com_url && (
          <a className="btn btn-primary btn-sm" href={a.com_url} target="_blank" rel="noopener noreferrer" title="Opens this case in Dynamics (COM) — sign in with your COM user">Open in COM ↗</a>
        )}
        {a.can_cancel && !cancelOpen && <button className="btn btn-danger btn-sm" onClick={() => setCancelOpen(true)}>🚫 Cancel case</button>}
      </div>
      {a.source === 'COM' && a.is_open && (
        <div className="text3" style={{ fontSize: 10.5 }}>COM cases are cancelled in COM (CoolerCo never changes COM). Open it, cancel there — the next COM upload shows it here.</div>
      )}
      {a.source === 'CoolerCo' && a.is_open && !a.can_cancel && (
        <div className="text3" style={{ fontSize: 10.5 }}>Only supplier, manager or administrator users can cancel CoolerCo cases.</div>
      )}
      {cancelOpen && (
        <div className="req-box" style={{ marginTop: 6 }}>
          <div className="lbl">Cancel {a.case_number}</div>
          <select className="field-ctrl" value={reason} onChange={e => setReason(e.target.value)} style={{ width: '100%', marginBottom: 6 }}>
            <option value="">Reason…</option>
            {reasons.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
          <textarea className="field-ctrl" rows={2} placeholder={reason === 'CAN_OTHER' ? 'Note (required)' : 'Note (optional)'} value={note} onChange={e => setNote(e.target.value)} style={{ width: '100%' }} />
          <div className="modal-btns" style={{ marginTop: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setCancelOpen(false); setMsg(null) }} disabled={busy}>Keep case</button>
            <button className="btn btn-danger btn-sm" onClick={cancel} disabled={busy || !reason}>{busy ? 'Cancelling…' : '🚫 Cancel case'}</button>
          </div>
        </div>
      )}
      {msg && <div className={`form-msg ${msg.bad ? 'error' : 'success'}`} style={{ marginTop: 4 }}>{msg.t}</div>}
    </div>
  )
}
