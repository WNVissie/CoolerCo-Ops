import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import CameraScan, { codeCandidates } from '../components/CameraScan'

// 🔍 Audit route in the Field app (script 060). My audit days → stores in driving order → at the store:
// "5 on record", scan each cooler (count goes up 1/5 … 5/5), each one marked ✅ found / ⚠ at another store / ➕ extra.
// Finishing below 5/5 asks the store manager: all coolers covered? any in back rooms? any at another store of the owner?
// The auditor may fix the store's GPS / contact. Needs signal (offline queue for audits comes later).
const RES = { found: ['✅', 'Found', 'green'], other_store: ['⚠', 'On record at another place', 'orange'], extra: ['➕', 'Not on our register', 'neutral'], missing: ['❓', 'Missing', 'red'], pending: ['⏳', 'Not scanned yet', 'neutral'] }
const ERR = { not_allowed: 'This store is not on your audit.', store_finished: 'This store is already finished.', audit_closed: 'The audit is closed.', code_required: 'Scan or type a number.',
  questions_required: 'Answer the 3 questions with the store manager first.', bad_gps: 'That GPS point is not in South Africa.', no_outlet: 'Store not found in the register.' }
const buzz = bad => { try { navigator.vibrate?.(bad ? [120, 80, 200] : 60) } catch { /* none */ } }
const fmtD = d => new Date(d + 'T00:00:00').toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) }

export default function FieldAudit() {
  const [audits, setAudits] = useState(null)
  const [day, setDay] = useState(null)        // { audit, day }
  const [store, setStore] = useState(null)    // audit store id
  const [err, setErr] = useState(null)
  const load = () => supabase.rpc('coolerco_audit_my_days').then(({ data, error }) => { if (error) setErr(/does not exist|Could not find/i.test(error.message) ? 'Audits are not switched on yet (database script 060).' : error.message); setAudits(data || []) })
  useEffect(() => { load() }, [])
  if (store) return <AuditStore id={store} onBack={() => { setStore(null); load() }} />
  if (day) return <AuditDay audit={day.audit} day={day.day} onOpen={setStore} onBack={() => { setDay(null); load() }} />
  return (
    <div className="f-pad">
      {err && <div className="form-msg err">{err}</div>}
      {!audits ? <div className="load-state"><span className="spinner" /> Loading…</div> : !audits.length ? (
        <div className="empty-state"><div className="empty-ico">🔍</div><div>No audit days for you. The office loads auditors on the audit plan.</div></div>
      ) : audits.map(a => (
        <div key={a.audit_id} className="f-card">
          <div><b>{a.name}</b> <span className="mono" style={{ fontSize: 11 }}>{a.code}</span></div>
          <div className="text3" style={{ fontSize: 12 }}>{a.auditor} · {a.client_code}</div>
          {(a.days || []).map(d => (
            <button key={d.day} className={`f-tile${d.day === today() ? ' f-today' : ''}`} style={{ marginTop: 8 }} onClick={() => setDay({ audit: a, day: d.day })}>
              <span className="f-tile-ico">📅</span>
              <span className="f-grow"><strong>{fmtD(d.day)}{d.day === today() ? ' · today' : ''}</strong><small>{d.stores} stores · {d.coolers} coolers · {d.visited}/{d.stores} done</small></span>
              <span className="f-tile-go">›</span>
            </button>))}
        </div>))}
    </div>
  )
}

function AuditDay({ audit, day, onOpen, onBack }) {
  const [stops, setStops] = useState(null)
  useEffect(() => { supabase.rpc('coolerco_audit_day', { p_audit: audit.audit_id, p_day: day }).then(({ data }) => setStops(data || [])) }, [audit, day])
  return (
    <div className="f-pad">
      <button className="btn btn-ghost btn-sm" onClick={onBack}>‹ My audits</button>
      <h3 style={{ margin: '8px 0 2px' }}>{fmtD(day)} · {audit.name}</h3>
      <div className="text3" style={{ fontSize: 12, marginBottom: 6 }}>Visit the stores in this order. Tap a store when you arrive.</div>
      {!stops ? <div className="load-state"><span className="spinner" /></div> : stops.map(s => (
        <div key={s.id} className="f-card" style={{ opacity: s.status === 'visited' ? .7 : 1 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="f-seq">{s.seq}</span>
            <div className="f-grow"><b>{s.name}</b><div className="text3" style={{ fontSize: 11.5 }}>{s.address || s.outlet_code} · ETA {s.eta}</div></div>
            <span className={`tag tag-${s.status === 'visited' ? 'green' : s.status === 'in_progress' ? 'orange' : 'neutral'}`}>{s.status === 'visited' ? '✅' : '❄️'} {s.found}/{s.coolers}</span>
          </div>
          <div className="f-actions">
            {s.lat != null && <a className="btn btn-ghost btn-sm" href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`} target="_blank" rel="noreferrer">🧭 Navigate</a>}
            <button className="btn btn-primary btn-sm" onClick={() => onOpen(s.id)}>{s.status === 'visited' ? '👁 View' : s.status === 'in_progress' ? '▶ Continue' : '🔍 Start audit here'}</button>
          </div>
        </div>))}
    </div>
  )
}

function AuditStore({ id, onBack }) {
  const [d, setD] = useState(null)
  const [code, setCode] = useState('')
  const [cam, setCam] = useState(false)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState(false)
  const [ans, setAns] = useState({})
  const [note, setNote] = useState('')
  const [fix, setFix] = useState(null)
  const load = () => supabase.rpc('coolerco_audit_store', { p_store: id }).then(({ data }) => setD(data))
  useEffect(() => { load() }, [id])
  if (!d) return <div className="f-pad"><span className="spinner" /></div>
  if (d.error) return <div className="f-pad"><div className="form-msg err">{ERR[d.error] || d.error}</div><button className="btn btn-ghost" onClick={onBack}>‹ Back</button></div>
  const items = d.items || []
  const found = items.filter(i => i.expected && i.result === 'found').length
  const done = d.store.status === 'visited'

  async function scan(raw, how) {
    const c = (codeCandidates(raw)[0] || raw || '').trim()
    if (!c) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('coolerco_audit_scan', { p_store: id, p_code: c, p_how: how })
    setBusy(false); setCode('')
    if (error || data?.error) { buzz(true); return setMsg({ t: error?.message || ERR[data.error] || data.error, bad: true }) }
    buzz(data.result !== 'found')
    setMsg({ t: data.already ? `${data.asset} was already scanned.` : data.result === 'found' ? `✅ ${data.asset} found (${data.found}/${data.expected})`
      : data.result === 'other_store' ? `⚠ ${data.asset} is on record at ${data.registered_at} — noted here.` : `➕ ${data.asset} is not on our register — noted as extra.`, bad: data.result !== 'found' })
    load()
  }
  async function unscan(it) {
    if (!window.confirm(`Undo the scan of ${it.asset_number}?`)) return
    await supabase.rpc('coolerco_audit_unscan', { p_item: it.id }); load()
  }
  async function finish(withAnswers) {
    if (!withAnswers && found < d.expected) { setAsk(true); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('coolerco_audit_store_finish', { p_store: id, p_answers: withAnswers ? ans : null, p_note: note || null })
    setBusy(false)
    if (error || data?.error) return setMsg({ t: error?.message || ERR[data.error] || data.error, bad: true })
    setAsk(false); setMsg({ t: `✅ Store done: ${data.found}/${data.expected} found${data.missing ? ` · ${data.missing} missing` : ''}.` }); load()
  }
  async function saveFix() {
    setBusy(true)
    const { data, error } = await supabase.rpc('coolerco_audit_store_fix', { p_store: id, p: fix })
    setBusy(false)
    if (error || data?.error) return setMsg({ t: error?.message || ERR[data.error] || data.error, bad: true })
    setFix(null); setMsg({ t: data.changed ? `✏️ Store details saved (${data.changed} change${data.changed > 1 ? 's' : ''}).` : 'Nothing changed.' }); load()
  }
  const here = () => navigator.geolocation?.getCurrentPosition(p => setFix(f => ({ ...f, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) })),
    () => setMsg({ t: 'Could not read your location.', bad: true }), { enableHighAccuracy: true, timeout: 10000 })
  const Q = [['all_covered', 'Have all the coolers in the store been shown to you?'], ['back_rooms', 'Are there coolers in back rooms or storerooms?'], ['other_stores', 'Does the owner have another store where some of these coolers could be?']]

  return (
    <div className="f-pad">
      <button className="btn btn-ghost btn-sm" onClick={onBack}>‹ Today's stores</button>
      <h3 style={{ margin: '8px 0 0' }}>{d.outlet?.name || d.store.outlet_name}</h3>
      <div className="text3" style={{ fontSize: 12 }}>{[d.outlet?.street_address, d.outlet?.suburb, d.outlet?.town].filter(Boolean).join(', ')} · {d.store.outlet_code}</div>
      <div className="audit-counter"><span>❄️ {d.expected} on record at this store</span><b className={found === d.expected ? 'ok' : ''}>{found}/{d.expected}</b><small>scanned</small></div>
      {msg && <div className={`form-msg ${msg.bad ? 'warn' : 'ok'}`}>{msg.t}</div>}
      {!done && (
        <>
          <button className="btn btn-primary" style={{ width: '100%', minHeight: 52, fontSize: 16 }} disabled={busy} onClick={() => setCam(true)}>📷 Scan a cooler</button>
          <form style={{ display: 'flex', gap: 6, marginTop: 6 }} onSubmit={e => { e.preventDefault(); scan(code, 'typed') }}>
            <input className="field-ctrl" style={{ flex: 1 }} value={code} onChange={e => setCode(e.target.value)} placeholder="or type the asset / serial number" />
            <button className="btn btn-ghost" disabled={busy || !code.trim()}>Add</button>
          </form>
        </>)}
      <div style={{ marginTop: 10 }}>
        {items.map(it => {
          const [ico, label, color] = RES[it.result] || RES.pending
          return (
            <div key={it.id} className="f-card" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 10 }}>
              <span style={{ fontSize: 20 }}>{ico}</span>
              <div className="f-grow"><b className="mono">{it.asset_number}</b> <span className="text3" style={{ fontSize: 11 }}>{it.model}</span>
                <div><span className={`tag tag-${color}`}>{label}</span>{it.registered_at && <span className="text3" style={{ fontSize: 11 }}> · {it.registered_at}</span>}</div></div>
              {!done && it.result !== 'pending' && <button className="btn btn-ghost btn-sm" onClick={() => unscan(it)} aria-label="Undo scan">↩</button>}
            </div>)
        })}
      </div>
      {!done && !fix && <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => setFix({ contact_person: d.outlet?.contact_person || '', mobile_number: d.outlet?.mobile_number || '' })}>✏️ Store details wrong? Fix them</button>}
      {fix && (
        <div className="f-card">
          <b>✏️ Store details</b>
          <label className="f-lbl">Contact person<input className="field-ctrl" value={fix.contact_person || ''} onChange={e => setFix({ ...fix, contact_person: e.target.value })} /></label>
          <label className="f-lbl">Mobile<input className="field-ctrl" inputMode="tel" value={fix.mobile_number || ''} onChange={e => setFix({ ...fix, mobile_number: e.target.value })} /></label>
          <button className="btn btn-ghost btn-sm" type="button" onClick={here}>📍 The store is where I am now</button>
          {fix.latitude && <div className="text3" style={{ fontSize: 11 }}>GPS {fix.latitude}, {fix.longitude}</div>}
          <div className="f-actions"><button className="btn btn-ghost btn-sm" onClick={() => setFix(null)}>Cancel</button><button className="btn btn-primary btn-sm" disabled={busy} onClick={saveFix}>💾 Save</button></div>
        </div>)}
      {!done && !ask && <button className="btn btn-primary" style={{ width: '100%', marginTop: 12, minHeight: 48 }} disabled={busy} onClick={() => finish(false)}>✅ Finish this store ({found}/{d.expected})</button>}
      {ask && (
        <div className="f-card" style={{ borderColor: 'var(--orange)' }}>
          <b>Only {found} of {d.expected} coolers scanned — ask the store manager:</b>
          {Q.map(([k, q]) => (
            <div key={k} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 13 }}>{q}</div>
              <div className="chip-row">{['yes', 'no', 'not sure'].map(v => <button type="button" key={v} className={`chip-opt${ans[k] === v ? ' on' : ''}`} onClick={() => setAns({ ...ans, [k]: v })}>{v}</button>)}</div>
            </div>))}
          <textarea className="field-ctrl" rows={2} style={{ width: '100%', marginTop: 8 }} value={note} onChange={e => setNote(e.target.value)} placeholder="Manager's name and what they said (optional)" />
          <div className="text3" style={{ fontSize: 11 }}>Found more coolers? Close this and scan them first.</div>
          <div className="f-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setAsk(false)}>‹ Scan more</button>
            <button className="btn btn-primary btn-sm" disabled={busy || Q.some(([k]) => !ans[k])} onClick={() => finish(true)}>✅ Finish — {d.expected - found} missing</button>
          </div>
        </div>)}
      {done && <div className="form-msg ok" style={{ marginTop: 10 }}>✅ Finished {new Date(d.store.visited_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}{d.store.manager_answers ? ' · manager questions answered' : ''}</div>}
      {cam && <CameraScan onClose={() => setCam(false)} onResult={t => { setCam(false); scan(t, 'camera') }} />}
    </div>
  )
}
