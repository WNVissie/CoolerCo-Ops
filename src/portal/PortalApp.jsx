import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { rpcRead, isNetErr, NET_MSG } from '../lib/rpcRetry'
import './portal.css'

// Public customer portal — no login. The link token identifies the store.
// Server functions used: coolerco_portal_context, coolerco_portal_options (symptom + query lists, saved contact),
// coolerco_portal_submit_v2 (falls back to coolerco_portal_submit where 017 is not installed),
// coolerco_portal_case + coolerco_portal_case_query (ask about an open case) and coolerco_portal_propose_contact.
const KINDS = [
  { key: 'repair',     icon: '🔧', label: 'Repair',     desc: 'An asset is not working properly' },
  { key: 'collection', icon: '📦', label: 'Collection', desc: 'Remove an asset from the store' },
  { key: 'new',        icon: '➕', label: 'New asset',  desc: 'Request an additional asset' },
]
const STEPS = ['Request', 'Asset', 'Details', 'Confirm']
const STATUS_TL = ['Waiting for Approval', 'Open', 'Planned', 'Completed']
const ERRORS = {
  invalid_link: 'This link is not valid any more. Please ask CoolerCo for a new link.',
  daily_limit: 'You have reached today\'s request limit. Please try again tomorrow or call CoolerCo.',
  no_warehouse: 'Your store is not linked to a CoolerCo warehouse yet. Please call CoolerCo.',
  asset_not_at_store: 'That asset is no longer listed at your store.',
  bad_family: 'That item is no longer in the catalogue.',
  symptom_required: 'Please choose what is wrong with the asset.',
  impact_required: 'Please tell us what is happening to your product.',
  not_found: 'We could not find that case for your store.',
  case_closed: 'That case is already closed. You can log a new request for the asset.',
  query_limit: 'You have reached today\'s limit of messages for this case. Please call your CoolerCo warehouse if it is urgent.',
  reason_required: 'Please choose what you want to ask.',
  note_required: 'Please type a short message.',
}
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '')

// Shrink photos before upload (saves the customer's mobile data)
async function compress(file, max = 1280) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file) })
  const k = Math.min(1, max / Math.max(img.width, img.height))
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.75))
}

export default function PortalApp({ token }) {
  const [ctx, setCtx] = useState(null)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('new')
  const [step, setStep] = useState(0)
  const [kind, setKind] = useState(null)
  const [asset, setAsset] = useState(null)
  const [family, setFamily] = useState(null)
  const [desc, setDesc] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [photos, setPhotos] = useState([]) // { path, url }
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [famPhotos, setFamPhotos] = useState({})
  const [dupAck, setDupAck] = useState(false) // customer confirmed it is a different problem
  const [stopped, setStopped] = useState(null) // customer said the existing case covers it
  const [opts, setOpts] = useState(null)       // symptom + product lists (null = old screen)
  const [symptom, setSymptom] = useState(null)
  const [impact, setImpact] = useState(null)
  const [caseView, setCaseView] = useState(null) // case number being viewed / asked about
  const [email, setEmail] = useState('')
  const [editContact, setEditContact] = useState(false)
  const [saveContact, setSaveContact] = useState(true) // keep changed details for next time (supervisor approves)
  const [contactNote, setContactNote] = useState(null)
  const [hit, setHit] = useState(null) // open case that stopped this request

  async function load() {
    setErr(null)
    const { data, error } = await rpcRead('coolerco_portal_context', { p_token: token })
    if (error) { setErr(isNetErr(error) ? NET_MSG + ' Your request was not sent yet.' : error.message); return }
    if (data?.error) { setErr(ERRORS[data.error] || data.error); return }
    setCtx(data); setName(n => n || data.contact?.name || ''); setPhone(p => p || data.contact?.phone || '')
    // Catalogue / family pictures (only those that exist), fetched in one call
    const paths = [...new Set([...(data.catalogue || []).map(c => c.photo), ...(data.assets || []).map(a => a.photo)].filter(Boolean))]
    if (paths.length) {
      const { data: urls } = await supabase.storage.from('coolerco-cases').createSignedUrls(paths, 3600)
      setFamPhotos(Object.fromEntries((urls || []).filter(u => u.signedUrl).map(u => [u.path, u.signedUrl])))
    }
  }
  useEffect(() => { load() }, [token])
  // Symptom lists load alongside the store (parallel). If they are not available the old free-text screen is used.
  useEffect(() => {
    rpcRead('coolerco_portal_options', { p_token: token }).then(({ data, error }) => {
      if (!error && data && !data.error && data.symptoms?.length) { setOpts(data); setEmail(e => e || data.contact?.email || '') }
    })
  }, [token])

  // Already-logged work for the chosen asset (repair/collection) or any open delivery (new asset)
  const openFor = a => (ctx?.open_cases || []).filter(o => (o.assets || []).includes(a))
  const dup = !ctx ? [] : kind === 'new'
    ? (ctx.open_cases || []).filter(o => /deliver|replacement/i.test(o.case_type))
    : asset ? openFor(asset.asset) : []

  function reset() { setStep(0); setKind(null); setAsset(null); setFamily(null); setDesc(''); setPhotos([]); setDone(null); setDupAck(false); setStopped(null); setSymptom(null); setImpact(null); setEditContact(false); setContactNote(null); setHit(null) }

  async function addPhotos(files) {
    for (const f of [...files].slice(0, 3 - photos.length)) {
      const blob = await compress(f)
      const path = `portal/${token}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
      const { error } = await supabase.storage.from('coolerco-cases').upload(path, blob, { contentType: 'image/jpeg' })
      if (!error) setPhotos(p => [...p, { path, url: URL.createObjectURL(blob) }])
    }
  }

  async function submit() {
    setBusy(true)
    setErr(null)
    const request = { kind, asset: asset?.asset, family_id: family?.id, description: desc, contact_name: name, contact_phone: phone, photos: photos.map(p => p.path) }
    if (guided) { request.symptom = symptom.code; request.product_impact = needImpact ? impact?.code : null }
    // Writes are never retried (no duplicates)
    const { data, error } = await supabase.rpc(opts ? 'coolerco_portal_submit_v2' : 'coolerco_portal_submit', { p_token: token, p_request: request })
    setBusy(false)
    if (error) { setErr(isNetErr(error) ? NET_MSG + ' Your request was not sent yet.' : error.message); return }
    if (data?.error === 'already_requested') { setErr(`There is already an open request for this item at your store: ${data.case_number}. You can ask about it under "My requests".`); setHit(data.case_number); load(); return }
    if (data?.error === 'already_open') { setHit(data.case_number); setErr(`There is already an open case for this asset: ${data.case_number}. You can ask about it under "My requests".`); load(); return }
    if (data?.error) { setErr(ERRORS[data.error] || data.error); return }
    setDone({ case_number: data.case_number, status: data.status || 'Waiting for Approval', priority: data.priority, repeat_of: data.repeat_of }); load()
    // Changed contact details: used on this request straight away; saved for the store once a supervisor approves
    if (contactChanged && saveContact && opts) {
      const changes = {}
      if (name.trim() !== (saved.name || '')) changes.contact_name = name.trim()
      if (phone.trim() !== (saved.phone || '')) { changes.contact_number = phone.trim(); changes.mobile_number = phone.trim() }
      if (email.trim() !== (saved.email || '')) { changes.email = email.trim(); if (email.trim()) changes.notify_email = true }
      supabase.rpc('coolerco_portal_propose_contact', { p_token: token, p_values: changes }).then(({ data: r }) => {
        setContactNote(r?.ok || r?.error === 'already_pending' ? 'Your updated contact details were sent to CoolerCo to confirm.' : null)
      }, () => {})
    }
  }

  // Repair with symptom lists: pick what is wrong (+ what is happening to the product); typing is optional
  const guided = kind === 'repair' && !!opts
  const needImpact = guided && !!symptom?.ask_product
  const detailsOk = guided ? !!symptom && (!needImpact || !!impact) : desc.trim().length >= 5
  // One open case per asset: an asset with an open case cannot get a second one (the customer asks about the open case instead)
  const canQuery = !!opts?.query_reasons?.length // script 018 installed
  const blocked = kind !== 'new' && dup.length > 0 && canQuery
  const saved = opts?.contact || ctx?.contact || {}
  const contactChanged = name.trim() !== (saved.name || '') || phone.trim() !== (saved.phone || '') || email.trim() !== (saved.email || '')
  const haveContact = !!(saved.name && saved.phone)
  const canNext = [!!kind, (kind === 'new' ? !!family && (!dup.length || dupAck) : !!asset && (canQuery ? !dup.length : !dup.length || dupAck)), detailsOk && name.trim() && phone.trim(), true][step]

  if (err && !ctx) return <Shell><div className="p-card p-center"><div className="p-big">{err === NET_MSG ? '📶' : '⚠️'}</div><p>{err}</p>{err === NET_MSG && <button className="p-btn" onClick={load}>↻ Try again</button>}</div></Shell>
  if (!ctx) return <Shell><div className="p-center"><span className="p-spin" /> Loading your store…</div></Shell>

  return (
    <Shell pos={ctx.pos}>
      <div className="p-tabs">
        <button className={tab === 'new' ? 'on' : ''} onClick={() => setTab('new')}>➕ Log a request</button>
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>📋 My requests {ctx.requests?.length ? <span className="p-count">{ctx.requests.length}</span> : null}</button>
      </div>

      {caseView && <CaseView token={token} caseNo={caseView} reasons={opts?.query_reasons || []} onBack={() => { setCaseView(null); load() }} />}

      {!caseView && tab === 'mine' && (ctx.open_cases || []).some(o => o.source === 'COM') && (
        <div className="p-card">
          <h3>🔧 Open work for your store</h3>
          {(ctx.open_cases || []).filter(o => o.source === 'COM').map(o => (
            <CaseRow key={o.case_number} r={o} canOpen={canQuery} onOpen={() => setCaseView(o.case_number)} />
          ))}
        </div>
      )}

      {!caseView && tab === 'mine' && (
        <div className="p-card">
          <h3>📋 Requests you logged</h3>
          {!ctx.requests?.length ? <p className="p-muted">No requests yet.</p> : ctx.requests.map(r => (
            <CaseRow key={r.case_number} r={r} canOpen={canQuery} onOpen={() => setCaseView(r.case_number)} />
          ))}
          {canQuery && !!ctx.requests?.length && <p className="p-muted" style={{ fontSize: 11.5 }}>Tap a case to see it or to ask about it.</p>}
        </div>
      )}

      {!caseView && tab === 'new' && done && (
        <div className="p-card p-center">
          <div className="p-done">✓</div>
          <h2>Request received</h2>
          <p className="p-muted">Your reference number</p>
          <div className="p-ref">{done.case_number}</div>
          <div className="p-tl">
            {STATUS_TL.map((s, i) => {
              const at = Math.max(0, STATUS_TL.indexOf(done.status))
              // a repair that opens straight away never waits for approval → show "Received" instead
              const label = i === 0 && at > 0 ? 'Received' : s === 'Open' ? (at > 0 ? 'Accepted' : 'Approved') : s === 'Planned' ? 'Scheduled' : s === 'Completed' ? 'Done' : s
              return <div key={s} className={`p-tl-item ${i === at ? 'now' : ''}`}><span className="p-tl-dot">{i < at ? '✓' : i === at ? '●' : '○'}</span>{label}</div>
            })}
          </div>
          {done.priority === 'High' && <p className="p-tag bad" style={{ alignSelf: 'center' }}>⚡ Marked urgent</p>}
          {done.repeat_of && <p className="p-muted" style={{ fontSize: 12 }}>We see this asset was repaired recently ({done.repeat_of}). We have flagged this as a repeat repair.</p>}
          {contactNote && <p className="p-muted" style={{ fontSize: 12 }}>✓ {contactNote}</p>}
          <p className="p-muted" style={{ fontSize: 12 }}>We will contact you on {phone}. Keep this reference number.</p>
          <button className="p-btn" onClick={reset}>Log another request</button>
        </div>
      )}

      {!caseView && tab === 'new' && !done && stopped && (
        <div className="p-card p-center">
          <div className="p-done">✓</div>
          <h2>No new request needed</h2>
          <p className="p-muted">Your existing case number</p>
          <div className="p-ref">{stopped.case_number}</div>
          <p className="p-muted">{stopped.case_type} · {stopped.status} · logged {fmtDate(stopped.created_on)}</p>
          <button className="p-btn" onClick={reset}>Back to start</button>
        </div>
      )}

      {!caseView && tab === 'new' && !done && !stopped && (
        <>
          <div className="p-steps">{STEPS.map((s, i) => <div key={s} className={`p-step ${i < step ? 'done' : i === step ? 'on' : ''}`}><span>{i < step ? '✓' : i + 1}</span>{s}</div>)}</div>

          {step === 0 && (
            <div className="p-card">
              <h3>What do you need?</h3>
              <div className="p-kinds">
                {KINDS.map(k => (
                  <button key={k.key} className={`p-kind ${kind === k.key ? 'sel' : ''}`} onClick={() => { setKind(k.key); setAsset(null); setFamily(null) }}
                    disabled={k.key !== 'new' && !ctx.assets.length}>
                    <span className="p-kind-ico">{k.icon}</span><strong>{k.label}</strong><small>{k.desc}</small>
                  </button>
                ))}
              </div>
              {!ctx.assets.length && <p className="p-muted">No assets are listed at your store, so only New asset is available.</p>}
            </div>
          )}

          {step === 1 && kind !== 'new' && (
            <div className="p-card">
              <h3>Which asset?</h3>
              <p className="p-muted">Assets registered at your store</p>
              <div className="p-list">
                {ctx.assets.map(a => (
                  <button key={a.asset} className={`p-asset ${asset?.asset === a.asset ? 'sel' : ''}`} onClick={() => { setAsset(a); setDupAck(false) }}>
                    <span className="p-thumb">{famPhotos[a.photo] ? <img src={famPhotos[a.photo]} alt="" /> : '🧊'}</span>
                    <span className="p-asset-info">
                      <strong>{a.family || a.family_name || a.product}</strong>
                      <small>Barcode {a.barcode || '—'} · Code {a.local_code || '—'}</small>
                      {a.condition && <span className="p-tag">{a.condition}</span>}
                      {openFor(a.asset).length > 0 && <span className="p-tag warn">ℹ️ Already logged</span>}
                    </span>
                    <span className="p-check">{asset?.asset === a.asset ? '✓' : ''}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && kind === 'new' && (
            <Catalogue items={ctx.catalogue} photos={famPhotos} value={family} onChange={f => { setFamily(f); setDupAck(false) }} />
          )}

          {step === 1 && blocked && (
            <div className="p-card p-dup">
              <strong>ℹ️ There is already an open case for this asset</strong>
              {dup.slice(0, 3).map(o => (
                <div key={o.case_number} className="p-req">
                  <div><strong>{o.case_number}</strong><div className="p-muted">{o.case_type} · logged {fmtDate(o.created_on)}</div></div>
                  <span className="p-tag ok">{o.status}</span>
                </div>
              ))}
              <p className="p-muted">We can only have one open case per asset. You can ask about this case or add information to it — a new request is possible once it is closed.</p>
              <div className="p-nav" style={{ position: 'static', padding: 0 }}>
                <button className="p-btn ghost" onClick={() => setStopped(dup[0])}>👍 OK, thanks</button>
                <button className="p-btn" onClick={() => setCaseView(dup[0].case_number)}>💬 Ask about this case</button>
              </div>
            </div>
          )}

          {step === 1 && !blocked && dup.length > 0 && !dupAck && (
            <div className="p-card p-dup">
              <strong>ℹ️ This is already logged</strong>
              {dup.slice(0, 3).map(o => (
                <div key={o.case_number} className="p-req">
                  <div><strong>{o.case_number}</strong><div className="p-muted">{o.case_type} · logged {fmtDate(o.created_on)}</div></div>
                  <span className="p-tag ok">{o.status}</span>
                </div>
              ))}
              <p className="p-muted">We are already working on this. Keep the case number above for any follow-up.</p>
              <div className="p-nav" style={{ position: 'static', padding: 0 }}>
                <button className="p-btn ghost" onClick={() => setStopped(dup[0])}>👍 That's my problem</button>
                <button className="p-btn" onClick={() => setDupAck(true)}>It's a different problem →</button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="p-card">
              <h3>{kind === 'repair' ? 'What is wrong?' : kind === 'collection' ? 'Why must it be collected?' : 'Anything we should know?'}</h3>
              {guided && (
                <>
                  <div className="p-chips" role="radiogroup" aria-label="What is wrong?">
                    {opts.symptoms.map(o => (
                      <button key={o.code} type="button" role="radio" aria-checked={symptom?.code === o.code}
                        className={`p-chip ${symptom?.code === o.code ? 'sel' : ''}`} onClick={() => { setSymptom(o); if (!o.ask_product) setImpact(null) }}>{o.label}</button>
                    ))}
                  </div>
                  {needImpact && (
                    <>
                      <div className="p-label">🧊 What is happening to your product?</div>
                      <div className="p-chips col" role="radiogroup" aria-label="What is happening to your product?">
                        {opts.impacts.map(o => (
                          <button key={o.code} type="button" role="radio" aria-checked={impact?.code === o.code}
                            className={`p-chip ${impact?.code === o.code ? 'sel' : ''}`} onClick={() => setImpact(o)}>{o.label}</button>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="p-label">📝 Anything else we should know? (optional)</div>
                </>
              )}
              <textarea rows={guided ? 2 : 4} value={desc} onChange={e => setDesc(e.target.value)}
                placeholder={guided ? 'e.g. Started yesterday, makes a clicking sound' : kind === 'repair' ? 'e.g. Not cooling, light not working, door does not close' : kind === 'collection' ? 'e.g. Store closing, not needed any more' : 'e.g. Space available near the till'} />
              <div className="p-label">📷 Photos (optional, up to 3)</div>
              <div className="p-photos">
                {photos.map(p => <img key={p.path} src={p.url} alt="" />)}
                {photos.length < 3 && (
                  <label className="p-add-photo">＋<input type="file" accept="image/*" capture="environment" multiple hidden onChange={e => addPhotos(e.target.files)} /></label>
                )}
              </div>
              <div className="p-label">👤 Your contact details</div>
              {haveContact && !editContact ? (
                <div className="p-contact">
                  <div><strong>{name}</strong><div className="p-muted">📞 {phone}{email ? ` · ✉️ ${email}` : ''}</div></div>
                  <button type="button" className="p-link" onClick={() => setEditContact(true)}>✏️ Change</button>
                </div>
              ) : (
                <>
                  <div className="p-label">Name</div>
                  <input value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
                  <div className="p-label">Contact number</div>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" />
                  {!!opts && <>
                    <div className="p-label">Email (optional — for updates on your request)</div>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="name@example.com" />
                    {contactChanged && !opts.contact?.update_pending && (
                      <label className="p-checkline"><input type="checkbox" checked={saveContact} onChange={e => setSaveContact(e.target.checked)} /> Use these details for my store from now on</label>
                    )}
                    {opts.contact?.update_pending && <p className="p-muted" style={{ fontSize: 11.5 }}>An earlier update of your details is still waiting for CoolerCo to confirm.</p>}
                  </>}
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="p-card">
              <h3>Please confirm</h3>
              <div className="p-sum">
                <div><span>Request</span><strong>{KINDS.find(k => k.key === kind)?.label}</strong></div>
                <div><span>{kind === 'new' ? 'Item' : 'Asset'}</span><strong>{kind === 'new' ? family?.name : `${asset?.family || asset?.family_name || asset?.product} · ${asset?.barcode || ''}`}</strong></div>
                {guided && <div><span>Problem</span><strong>{symptom?.label}</strong></div>}
                {needImpact && <div><span>Product</span><strong>{impact?.label}</strong></div>}
                {(!guided || desc.trim()) && <div><span>Details</span><strong>{desc}</strong></div>}
                <div><span>Photos</span><strong>{photos.length}</strong></div>
                <div><span>Contact</span><strong>{name} · {phone}</strong></div>
                <div><span>Store</span><strong>{ctx.pos.name}</strong></div>
              </div>
              {kind !== 'repair' && <p className="p-muted" style={{ fontSize: 12 }}>ℹ️ {kind === 'new' ? 'New assets' : 'Collections'} need approval before they are scheduled.</p>}
              {err && <p className="p-err">{err}</p>}
              {hit && canQuery && <button type="button" className="p-btn" style={{ width: '100%' }} onClick={() => { setErr(null); setCaseView(hit) }}>💬 Ask about {hit}</button>}
            </div>
          )}

          <div className="p-nav">
            {step > 0 && <button className="p-btn ghost" onClick={() => setStep(s => s - 1)}>← Back</button>}
            {step < 3
              ? <button className="p-btn" disabled={!canNext} onClick={() => setStep(s => s + 1)}>Next →</button>
              : <button className="p-btn" disabled={busy} onClick={submit}>{busy ? 'Sending…' : '✓ Submit request'}</button>}
          </div>
        </>
      )}
    </Shell>
  )
}

// One row in "My requests" — opens the case when the query functions are available
function CaseRow({ r, canOpen, onOpen }) {
  const tag = <span className={`p-tag ${r.status === 'Waiting for Approval' ? 'warn' : r.status === 'Rejected' ? 'bad' : 'ok'}`}>{r.status}</span>
  const body = <div><strong>{r.case_number}</strong><div className="p-muted">{r.case_type} · {fmtDate(r.created_on)}</div></div>
  if (!canOpen) return <div className="p-req">{body}{tag}</div>
  return <button type="button" className="p-req p-req-btn" onClick={onOpen}>{body}<span className="p-req-end">{tag}<span aria-hidden="true">›</span></span></button>
}

// One case: what was logged, messages the customer may see, and "Ask about this case"
function CaseView({ token, caseNo, reasons, onBack }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [reason, setReason] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(null)

  async function load() {
    const { data, error } = await rpcRead('coolerco_portal_case', { p_token: token, p_case: caseNo })
    if (error) { setErr(isNetErr(error) ? NET_MSG : error.message); return }
    if (data?.error) { setErr(ERRORS[data.error] || data.error); return }
    setErr(null); setD(data)
  }
  useEffect(() => { load() }, [caseNo]) // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    setBusy(true); setErr(null)
    // a write: never retried (no duplicate messages)
    const { data, error } = await supabase.rpc('coolerco_portal_case_query', { p_token: token, p_case: caseNo, p_reason: reason.code, p_note: note })
    setBusy(false)
    if (error) { setErr(isNetErr(error) ? NET_MSG + ' Your message was not sent yet.' : error.message); return }
    if (data?.error) { setErr(ERRORS[data.error] || data.error); return }
    setSent(data); setReason(null); setNote(''); load()
  }

  const needNote = !!reason?.needs_note
  return (
    <>
      <button type="button" className="p-link" style={{ marginBottom: 8 }} onClick={onBack}>← Back</button>
      {!d && !err && <div className="p-center"><span className="p-spin" /> Loading…</div>}
      {!d && err && <div className="p-card p-center"><p>{err}</p><button className="p-btn" onClick={load}>↻ Try again</button></div>}
      {d && (
        <>
          <div className="p-card">
            <div className="p-req" style={{ border: 0, padding: 0 }}>
              <div><strong>{d.case_number}</strong><div className="p-muted">{d.case_type} · logged {fmtDate(d.created_on)}</div></div>
              <span className={`p-tag ${d.open ? 'ok' : ''}`}>{d.status}</span>
            </div>
            <div className="p-sum" style={{ marginTop: 10 }}>
              {d.barcode && <div><span>Asset</span><strong>Barcode {d.barcode}</strong></div>}
              {d.symptom && <div><span>Problem</span><strong>{d.symptom}</strong></div>}
              {d.product_impact && <div><span>Product</span><strong>{d.product_impact}</strong></div>}
              {d.description && <div><span>Details</span><strong>{d.description}</strong></div>}
              {d.due && d.open && <div><span>Planned by</span><strong>{fmtDate(d.due)}</strong></div>}
            </div>
            {d.priority === 'High' && <span className="p-tag bad">⚡ Marked urgent</span>}
          </div>

          <div className="p-card">
            <h3>💬 Messages</h3>
            {!d.messages.length && <p className="p-muted">No messages yet.</p>}
            {d.messages.map((m, i) => (
              <div key={i} className={`p-msg ${m.mine ? 'me' : ''}`}>
                <div className="p-msg-body">{m.body}</div>
                <small>{m.from} · {new Date(m.at).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>
              </div>
            ))}
          </div>

          {d.open && reasons.length > 0 && (
            <div className="p-card">
              <h3>Ask about this case</h3>
              {sent && <p className="p-tag ok" style={{ marginBottom: 8 }}>✓ Sent{sent.priority_raised ? ' — we have marked this case urgent' : ''}</p>}
              {d.queries_left <= 0 ? <p className="p-muted">{ERRORS.query_limit}</p> : (
                <>
                  <div className="p-chips col" role="radiogroup" aria-label="What do you want to ask?">
                    {reasons.map(o => (
                      <button key={o.code} type="button" role="radio" aria-checked={reason?.code === o.code}
                        className={`p-chip ${reason?.code === o.code ? 'sel' : ''}`} onClick={() => { setReason(o); setSent(null) }}>{o.label}</button>
                    ))}
                  </div>
                  {reason && (
                    <>
                      <div className="p-label">📝 {needNote ? 'Your message' : 'Add a note (optional)'}</div>
                      <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} />
                      {err && <p className="p-err">{err}</p>}
                      <button className="p-btn" style={{ width: '100%', marginTop: 10 }} disabled={busy || (needNote && !note.trim())} onClick={send}>{busy ? 'Sending…' : '➤ Send'}</button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          {!d.open && <p className="p-muted" style={{ textAlign: 'center' }}>This case is closed. If the problem is back, log a new request.</p>}
        </>
      )}
    </>
  )
}

function Catalogue({ items, photos, value, onChange }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => items.filter(i => !q || (i.name + ' ' + (i.description || '')).toLowerCase().includes(q.toLowerCase())), [items, q])
  return (
    <div className="p-card">
      <h3>Choose from the catalogue</h3>
      <input placeholder="🔍 Search…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="p-list" style={{ marginTop: 10 }}>
        {list.map(c => (
          <button key={c.id} className={`p-asset ${value?.id === c.id ? 'sel' : ''}`} onClick={() => onChange(c)}>
            <span className="p-thumb">{photos[c.photo] ? <img src={photos[c.photo]} alt="" /> : '🧊'}</span>
            <span className="p-asset-info"><strong>{c.name}</strong>{c.description && <small>{c.description}</small>}{c.type && <span className="p-tag">{c.type}</span>}</span>
            <span className="p-check">{value?.id === c.id ? '✓' : ''}</span>
          </button>
        ))}
        {!list.length && <p className="p-muted">Nothing matches.</p>}
      </div>
    </div>
  )
}

function Shell({ pos, children }) {
  return (
    <div className="p-root">
      <header className="p-head">
        <div className="p-logo"><span>Cooler</span>CO</div>
        {pos && <div className="p-store"><small>{pos.code}</small><strong>{pos.name}</strong></div>}
      </header>
      <main className="p-main">{children}</main>
      <footer className="p-foot">CoolerCo · RTMA · Need help? Call your CoolerCo warehouse</footer>
    </div>
  )
}
