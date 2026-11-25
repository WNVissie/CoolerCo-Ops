import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import CaseStore from './CaseStore'
import CaseOfficeClose from './CaseOfficeClose'
import CaseDesk from './CaseDesk'

const COM_PORTAL_TICKETS = 'https://emeaportal.unilevercom.com/en/tickets?toApprove=true'

// What can be done with a case:
//  • COM case  → "Open in COM ↗" (cancelling happens in COM — CoolerCo never writes to COM)
//  • COM case  → "Open in COM portal ↗": copies the case number and opens the COMPORTAL tickets page.
//    The portal keeps the same address when you filter, so there is no direct link to one ticket yet:
//    the supervisor pastes (Ctrl+V / long-press) into the Case Number filter. Each user signs in with their own portal login.
//  • CoolerCo case → "Cancel case" with a reason (staff roles only, logged in the case history)
// Needs script 022 (coolerco_case_actions / coolerco_case_cancel). Without it this block shows nothing.
const ERR = {
  not_allowed: 'Your user does not have a role that may cancel this case.',
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
  const [portalTip, setPortalTip] = useState(false)
  const [decide, setDecide] = useState(null)      // null · 'approve' · 'reject'
  const [rejReasons, setRejReasons] = useState([])
  const [rej, setRej] = useState('')
  const [decNote, setDecNote] = useState('')
  const [opts, setOpts] = useState(null)          // 058: office close + client cancel options (Demo / Tiger cases)
  const [closeOpen, setCloseOpen] = useState(false)

  const load = () => supabase.rpc('coolerco_case_actions', { p_case: caseNumber })
    .then(({ data, error }) => setA(error || !data || data.error ? null : data))

  const loadOpts = () => supabase.rpc('coolerco_case_close_options', { p_case: caseNumber })
    .then(({ data, error }) => setOpts(error || !data || data.error ? null : data))
  useEffect(() => { setA(null); setOpts(null); setCancelOpen(false); setCloseOpen(false); setMsg(null); if (caseNumber) { load(); loadOpts() } }, [caseNumber])
  useEffect(() => {
    if (decide !== 'reject' || rejReasons.length) return
    supabase.from('coolerco_reason_codes').select('code,label').eq('status', 'Rejected').eq('active', true).order('sort_order')
      .then(({ data }) => setRejReasons(data || []))
  }, [decide])
  useEffect(() => {
    if (!cancelOpen || reasons.length) return
    supabase.from('coolerco_reason_codes').select('code,label').eq('status', 'Cancelled').eq('active', true).order('sort_order')
      .then(({ data }) => setReasons(data || []))
  }, [cancelOpen])

  if (!a) return null
  const canCancel = a.can_cancel || !!opts?.can_cancel

  const copy = () => {
    navigator.clipboard?.writeText(a.case_number).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }
  // Copy first (the click still counts as the user's action), then open the portal in a new tab
  const openPortal = () => {
    try { navigator.clipboard?.writeText(a.case_number) } catch { /* copy not allowed: the tip still shows the number */ }
    window.open(COM_PORTAL_TICKETS, '_blank', 'noopener,noreferrer')
    setPortalTip(true); setTimeout(() => setPortalTip(false), 12000)
  }
  // ✅ Approve / 🚫 Reject a request straight from the case (same rules as the Requests page)
  const setStatus = async (status, reason) => {
    setBusy(true); setMsg(null)
    const { error } = await supabase.rpc('coolerco_case_set_status', { p_case_number: a.case_number, p_status: status, p_reason_code: reason, p_notes: decNote || null })
    setBusy(false)
    if (error) return setMsg({ bad: true, t: /permission|not allowed|role/i.test(error.message) ? 'Your user may not approve this request.' : error.message })
    setMsg({ t: status === 'Open' ? '✅ Approved — the case is now Open and its SLA clock runs.' : '🚫 Request rejected — logged in the case history.' })
    setDecide(null); setRej(''); setDecNote(''); load(); onChanged?.()
  }
  const cancel = async () => {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('coolerco_case_cancel', { p_case: a.case_number, p_reason: reason, p_note: note || null })
    setBusy(false)
    if (error) return setMsg({ bad: true, t: error.message })
    if (data?.error) return setMsg({ bad: true, t: ERR[data.error] || data.error })
    setMsg({ t: `✅ Case cancelled — logged in the case history.${data?.on_route ? ` Marked as cancelled on route ${data.on_route}.` : ''}` }); setCancelOpen(false); setReason(''); setNote('')
    load(); loadOpts(); onChanged?.()
  }

  return (
    <div className="case-actions">
      <div className="case-actions-row">
        <span className={`tag tag-${a.source === 'COM' ? 'neutral' : 'blue'}`}>{a.source === 'COM' ? '🟦 COM case' : '🟩 CoolerCo case'}</span>
        <button className="btn btn-ghost btn-sm" onClick={copy} title="Copy the case number">{copied ? '✓ Copied' : '📋 Copy no.'}</button>
        {a.source === 'COM' && a.com_url && (
          <a className="btn btn-primary btn-sm" href={a.com_url} target="_blank" rel="noopener noreferrer" title="Opens this case in Dynamics (COM) — sign in with your COM user">Open in COM ↗</a>
        )}
        {a.source === 'COM' && (
          <button className="btn btn-ghost btn-sm" onClick={openPortal} title="Copies the case number and opens the COM portal tickets page — sign in with your own portal login">Open in COM portal ↗</button>
        )}
        {opts?.can_close && !closeOpen && !cancelOpen && <button className="btn btn-primary btn-sm" onClick={() => setCloseOpen(true)} title="When the driver cannot close it on the phone">✅ Close case</button>}
        {canCancel && !cancelOpen && !closeOpen && <button className="btn btn-danger btn-sm" onClick={() => setCancelOpen(true)}>🚫 Cancel case</button>}
      </div>
      {a.source === 'CoolerCo' && a.status === 'Waiting for Approval' && (
        <div className="req-box" style={{ marginTop: 6 }}>
          <div className="lbl">⏳ Waiting for approval</div>
          {decide === null && (
            <div className="modal-btns" style={{ justifyContent: 'flex-start' }}>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => setDecide('approve')}>✅ Approve</button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setDecide('reject')}>🚫 Reject…</button>
            </div>
          )}
          {decide && (
            <>
              {decide === 'reject' && (
                <select className="field-ctrl" value={rej} onChange={e => setRej(e.target.value)} style={{ width: '100%', marginBottom: 6 }}>
                  <option value="">Choose a reason…</option>
                  {rejReasons.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
                </select>
              )}
              <input className="field-ctrl" placeholder="Note (optional)" value={decNote} onChange={e => setDecNote(e.target.value)} style={{ width: '100%' }} />
              <div className="modal-btns" style={{ justifyContent: 'flex-start', marginTop: 6 }}>
                {decide === 'approve'
                  ? <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => setStatus('Open', 'APPROVED')}>{busy ? 'Saving…' : '✅ Approve request'}</button>
                  : <button className="btn btn-danger btn-sm" disabled={busy || !rej} onClick={() => setStatus('Rejected', rej)}>{busy ? 'Saving…' : '🚫 Reject request'}</button>}
                <button className="btn btn-ghost btn-sm" onClick={() => { setDecide(null); setRej('') }}>Back</button>
              </div>
            </>
          )}
        </div>
      )}
      {portalTip && (
        <div className="text3" style={{ fontSize: 10.5 }}>📋 <b>{a.case_number}</b> is copied. In the COM portal, paste it in the <b>Case Number</b> filter box (Ctrl+V, or long-press on a phone) and press Enter.</div>
      )}
      {a.source === 'COM' && a.is_open && (
        <div className="text3" style={{ fontSize: 10.5 }}>COM cases are cancelled in COM (CoolerCo never changes COM). Open it, cancel there — the next COM upload shows it here.</div>
      )}
      {opts?.status === 'Action Required' && <CaseDesk caseNumber={a.case_number} onDone={t => { setMsg({ t }); load(); loadOpts(); onChanged?.() }} />}
      {closeOpen && opts && <CaseOfficeClose opts={opts} onCancel={() => setCloseOpen(false)}
        onDone={t => { setCloseOpen(false); setMsg({ t }); load(); loadOpts(); onChanged?.() }} />}
      {a.source === 'CoolerCo' && a.is_open && !canCancel && opts?.status !== 'Action Required' && (
        <div className="text3" style={{ fontSize: 10.5 }}>Your user may not cancel this case (warehouse, office or client role needed).</div>
      )}
      {cancelOpen && (
        <div className="req-box" style={{ marginTop: 6 }}>
          <div className="lbl">Cancel {a.case_number}</div>
          {opts?.on_route && <div className="form-msg warn" style={{ display: 'block', marginBottom: 6 }}>🚚 This case is on route <b>{opts.on_route.route}</b> ({opts.on_route.date}). It will be recorded as <b>cancelled on route</b> (charged as a route visit, not a plain cancellation).</div>}
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
      <CaseStore caseNumber={a.case_number} />
    </div>
  )
}
