import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { cachedQuery } from '../lib/offline'
import { compressImage } from '../lib/photos'
import CameraScan, { codeCandidates } from '../components/CameraScan'
import { saveJobCard, SERVICE_RESULTS, lookupAsset, jobCard032Ready } from './fieldStops'
import { savedCheck, plannedAssets } from './StopAssets'

// Job card for one stop — same fields and rules as RouteIQ's trip-sheet job card:
//   Service result (5 choices) · notes · repair work + spares (repair cases) · customer name · 2 photos ·
//   signature, or the reason the customer would not sign.
//   Successful service: two photos + signature (or refusal reason). Unsuccessful: a note.
// Plus the assets of the case (to deliver / to remove / repaired) with their details from the asset register,
// and the swap check (delivered asset ≠ picked → same product family?). Works without signal (queued on the phone).
const ROLE = {
  delivered: { done: 'Asset delivered', todo: 'Asset to deliver', icon: '📦' },
  removed: { done: 'Asset removed', todo: 'Asset to remove', icon: '↩️' },
  repaired: { done: 'Asset repaired', todo: 'Asset to repair', icon: '🛠' },
}
const cleanBase = b => String(b || '').replace(/^\s*[\w-]+\s*-\s*/, '')
const where = a => (a?.asset_location === 'Location' ? 'At a store' : (a?.assign_account || a?.asset_location || '').split(/\r?\n/)[0])

// kept for older callers
export const findAsset = async code => (await lookupAsset(code)).asset

export default function FieldJobCard({ stop, driver, mode, prep, kase, contact, onDone, onCancel }) {
  const planned = plannedAssets(stop, prep, kase)
  const isRepair = /repair|decal/i.test(stop.case_type || '')
  const results = SERVICE_RESULTS.filter(r => !r.repairOnly || isRepair)
  const [result, setResult] = useState(mode === 'not_completed' ? '' : 'service_completed')
  const [notes, setNotes] = useState('')
  const [repairWork, setRepairWork] = useState('')
  const [spares, setSpares] = useState([])
  const [codes, setCodes] = useState(() => Object.fromEntries(planned.map(a => [a.role, savedCheck(stop.id, a.role)?.code || a.code || ''])))
  const [info, setInfo] = useState({}) // role → { [code]: { asset, source, error, loading } }
  const [cam, setCam] = useState(null)
  const [name, setName] = useState(contact?.customer_contact_name || '')
  const [phone, setPhone] = useState(contact?.mobile_phone || contact?.business_phone || '')
  const [other, setOther] = useState(false)
  const [photos, setPhotos] = useState([])
  const [sig, setSig] = useState(null)
  const [noSign, setNoSign] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [families, setFamilies] = useState({})
  const [v032, setV032] = useState(false)

  useEffect(() => {
    jobCard032Ready().then(setV032)
    cachedQuery('base_family', () => supabase.from('coolerco_product_base_family').select('product_base,family_id'))
      .then(rows => setFamilies(Object.fromEntries(rows.map(r => [r.product_base, r.family_id]))))
  }, [])

  // asset details for every code on the card (kept per code, so a slow older lookup can't overwrite a newer one)
  useEffect(() => {
    const t = setTimeout(() => {
      for (const r of Object.keys(codes)) {
        const c = codes[r]?.trim()
        if (!c || c in (info[r] || {})) continue
        setInfo(i => ({ ...i, [r]: { ...(i[r] || {}), [c]: { loading: true } } }))
        lookupAsset(c).then(res => setInfo(i => ({ ...i, [r]: { ...(i[r] || {}), [c]: res } })))
          .catch(e => setInfo(i => ({ ...i, [r]: { ...(i[r] || {}), [c]: { asset: null, error: e.message } } })))
      }
    }, 300)
    return () => clearTimeout(t)
  }, [codes]) // eslint-disable-line react-hooks/exhaustive-deps
  const found = r => { const c = codes[r]?.trim(); return c && info[r]?.[c] ? info[r][c] : null }

  const ok = result === 'service_completed'
  const pDel = planned.find(a => a.role === 'delivered')
  const delivered = codes.delivered?.trim()
  const delAsset = found('delivered')?.asset
  const swapped = !!pDel?.code && !!delivered && delivered !== pDel.code && delAsset?.bar_code !== pDel.code
  const famA = families[delAsset?.product_base], famB = families[pDel?.base]
  const familyOk = swapped ? (famA && famB ? famA === famB : null) : null

  const addPhoto = async e => {
    const files = [...(e.target.files || [])].slice(0, 3 - photos.length)
    const out = []
    for (const f of files) out.push(await compressImage(f))
    setPhotos(p => [...p, ...out.filter(Boolean)].slice(0, 3)); e.target.value = ''
  }

  const save = async () => {
    setErr(null)
    if (!result) return setErr('Choose the service result.')
    if (!ok && !notes.trim()) return setErr('Add a note: why could the work not be done?')
    if (ok && pDel && !delivered) return setErr('Scan or type the asset you delivered.')
    if (ok && isRepair && !repairWork.trim()) return setErr('Describe the repair work done.')
    if (ok && photos.length < 2) return setErr('Successful service needs two photos.')
    if (ok && !sig && !noSign.trim()) return setErr('Get the customer to sign, or type why they would not sign.')
    setBusy(true)
    try {
      const rs = SERVICE_RESULTS.find(r => r.code === result)
      const reasonCode = ok ? null : v032 ? rs.reason : (rs.old || rs.reason)
      const sp = spares.filter(x => x.name.trim()).map(x => ({ name: x.name.trim(), qty: Number(x.qty) || 1 }))
      const extra = v032
        ? { service_result: result, repair_details: repairWork.trim() || null, spares: sp, customer_name: name.trim() || null, signature_refusal_reason: sig ? null : noSign.trim() || null }
        : {}
      // without script 032: keep everything readable in the work-done text
      const workText = v032 ? notes.trim()
        : [notes.trim(), repairWork.trim() && `Repair: ${repairWork.trim()}`, sp.length && `Spares: ${sp.map(x => `${x.qty}× ${x.name}`).join(', ')}`, !sig && noSign.trim() && `Did not sign: ${noSign.trim()}`].filter(Boolean).join(' · ')
      await saveJobCard(stop, driver, {
        outcome: ok ? 'completed' : 'not_completed', reason_code: reasonCode, work_done: workText || null,
        received_by_name: name.trim() || null, received_by_phone: phone.trim() || null, received_by_other: other,
        delivered_barcode: codes.delivered?.trim() || null, removed_barcode: codes.removed?.trim() || null, repaired_barcode: codes.repaired?.trim() || null,
        planned_barcode: pDel?.code || null, swapped, swap_family_ok: familyOk,
        swap_note: swapped ? `Planned ${pDel.code} (${cleanBase(pDel.base) || '?'}), delivered ${delivered} (${cleanBase(delAsset?.product_base) || '?'})` : null,
        ...extra,
      }, photos, sig)
      onDone()
    } catch (e) { setErr(e.message || String(e)); setBusy(false) }
  }

  return (
    <div className="f-sheet" role="dialog" aria-label="Job card">
      <div className="f-sheet-body">
        <div className="f-row" style={{ marginBottom: 8 }}>
          <div className="f-grow"><strong>📝 Job Card</strong><small>{stop.point_of_sale} · {stop.case_type} · {stop.case_number}</small></div>
          <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>✕</button>
        </div>

        {planned.map(a => {
          const R = ROLE[a.role], f = found(a.role), x = f?.asset
          const differs = a.code && codes[a.role]?.trim() && codes[a.role].trim() !== a.code && x?.bar_code !== a.code
          return (
            <div key={a.role} className="f-jc-asset">
              <div className="field-lbl">{R.icon} {ok ? R.done : R.todo}</div>
              <div className="f-row" style={{ gap: 6 }}>
                <input className="field-ctrl f-grow mono" placeholder="Barcode / asset no." value={codes[a.role] || ''} onChange={e => setCodes(c => ({ ...c, [a.role]: e.target.value }))} />
                <button className="btn btn-ghost btn-sm" onClick={() => setCam(a.role)}>📷</button>
              </div>
              {a.code && <small className="text3">Planned: <b className="mono">{a.code}</b> · {cleanBase(a.base) || '—'}{a.condition ? ` · ${a.condition}` : ''}{a.branding ? ` · ${a.branding}` : ''}</small>}
              {!a.code && a.role === 'delivered' && <small className="f-asset-warn">⚠ Not picked in the warehouse — requested {cleanBase(a.base) || 'model unknown'}</small>}
              {f?.loading && <small className="text3">🔎 Looking up the asset…</small>}
              {f && !f.loading && x && (
                <div className={`f-jc-detail ${differs ? 'warn' : ''}`}>
                  <b>{cleanBase(x.product_base) || '—'}</b>
                  <span>{x.name} · local {x.local_code || '—'}{x.serial_number ? ` · serial ${x.serial_number}` : ''}</span>
                  <span>{x.condition || '—'}{x.brand_hierarchy ? ` · ${x.brand_hierarchy}` : ''}{x.asset_status ? ` · ${x.asset_status}` : ''}</span>
                  <span>📍 {where(x) || '—'}{f.source === 'phone' ? ' · from the list saved on this phone' : ''}</span>
                </div>
              )}
              {f && !f.loading && !x && <small className="f-asset-warn">{f.error ? `⚠ Could not look it up: ${f.error}` : navigator.onLine ? '⚠ Not found in the asset register — check the barcode. Kept as typed.' : '📵 No signal and not in the saved list — kept as typed.'}</small>}
            </div>
          )
        })}
        {swapped && (
          <div className={`form-msg ${familyOk === false ? 'err' : 'warn'}`} style={{ marginTop: 8 }}>
            {familyOk === false ? '⛔ Different product family than the picked asset — only swap within the same family. Check before you leave it.'
              : familyOk ? '🔁 Not the picked asset, but the same product family. It will be flagged for the office.'
                : '🔁 Not the picked asset — family could not be checked. It will be flagged for the office.'}
          </div>
        )}

        <div className="field-lbl" style={{ marginTop: 12 }}>Service result</div>
        <div className="f-results">
          {results.map(r => (
            <button key={r.code} className={`${result === r.code ? 'on' : ''} ${r.code === 'service_completed' ? 'good' : 'bad'}`} onClick={() => setResult(r.code)}>{r.icon} {r.label}</button>
          ))}
        </div>

        <div className="field-lbl" style={{ marginTop: 10 }}>Notes{!ok ? ' *' : ''}</div>
        <textarea className="field-ctrl" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder={ok ? 'Service notes (optional)' : 'Reason the work could not be completed'} />

        {isRepair && ok && (
          <>
            <div className="field-lbl" style={{ marginTop: 10 }}>Detailed repair work *</div>
            <textarea className="field-ctrl" rows={3} value={repairWork} onChange={e => setRepairWork(e.target.value)} placeholder="What was repaired / replaced" />
            <div className="field-lbl" style={{ marginTop: 10 }}>Spares used</div>
            {spares.map((x, i) => (
              <div key={i} className="f-row" style={{ gap: 6, marginBottom: 6 }}>
                <input className="field-ctrl f-grow" placeholder="Spare part" value={x.name} onChange={e => setSpares(s => s.map((y, j) => j === i ? { ...y, name: e.target.value } : y))} />
                <input className="field-ctrl" style={{ width: 64 }} inputMode="numeric" value={x.qty} onChange={e => setSpares(s => s.map((y, j) => j === i ? { ...y, qty: e.target.value } : y))} />
                <button className="btn btn-ghost btn-sm" onClick={() => setSpares(s => s.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button className="btn btn-ghost btn-sm" onClick={() => setSpares(s => [...s, { name: '', qty: 1 }])}>＋ Add spare</button>
          </>
        )}

        <div className="field-lbl" style={{ marginTop: 10 }}>Customer name</div>
        <input className="field-ctrl" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
        <input className="field-ctrl" style={{ marginTop: 6 }} inputMode="tel" placeholder="Contact number" value={phone} onChange={e => setPhone(e.target.value)} />
        <label className="f-check"><input type="checkbox" checked={other} onChange={e => setOther(e.target.checked)} /> Someone other than the store contact</label>

        <div className="field-lbl" style={{ marginTop: 10 }}>Photos ({photos.length}/3){ok ? ' — two needed' : ''}</div>
        <div className="f-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {photos.map((b, i) => <img key={i} className="f-thumb" src={URL.createObjectURL(b)} alt="" onClick={() => setPhotos(p => p.filter((_, j) => j !== i))} />)}
          {photos.length < 3 && <label className="btn btn-ghost btn-sm">📷 Add<input type="file" accept="image/*" capture="environment" hidden onChange={addPhoto} /></label>}
        </div>

        {ok && (
          <>
            <div className="field-lbl" style={{ marginTop: 10 }}>Customer signature</div>
            <SignaturePad onChange={setSig} />
            {!sig && <><div className="field-lbl" style={{ marginTop: 8 }}>Reason customer would not sign (if applicable)</div>
              <input className="field-ctrl" value={noSign} onChange={e => setNoSign(e.target.value)} /></>}
          </>
        )}

        {err && <div className="form-msg err" style={{ marginTop: 8 }}>{err}</div>}
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 12, minHeight: 46 }} onClick={save} disabled={busy}>{busy ? 'Saving…' : '💾 Save job card'}</button>
        <p className="text3" style={{ fontSize: 11, textAlign: 'center', marginTop: 6 }}>
          {ok ? 'Successful service needs two photos and a signature, or the reason the customer would not sign.' : 'Unsuccessful outcomes need a note and are not marked Completed.'} Saved on the phone first, sent when there is signal.
        </p>
      </div>
      {cam && <CameraScan onClose={() => setCam(null)} onResult={t => { const r = cam; setCam(null); setCodes(c => ({ ...c, [r]: codeCandidates(t)[0] || t })) }} />}
    </div>
  )
}

function SignaturePad({ onChange }) {
  const ref = useRef(null), drawing = useRef(false), drawn = useRef(false)
  useEffect(() => {
    const c = ref.current, r = c.getBoundingClientRect(), k = window.devicePixelRatio || 1
    c.width = r.width * k; c.height = r.height * k
    const g = c.getContext('2d'); g.scale(k, k); g.lineWidth = 2.2; g.lineCap = 'round'; g.strokeStyle = '#111'
  }, [])
  const pos = e => { const r = ref.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
  const down = e => { e.preventDefault(); ref.current.setPointerCapture(e.pointerId); drawing.current = true; const g = ref.current.getContext('2d'); g.beginPath(); g.moveTo(...pos(e)) }
  const move = e => { if (!drawing.current) return; const g = ref.current.getContext('2d'); g.lineTo(...pos(e)); g.stroke(); drawn.current = true }
  const up = () => { if (!drawing.current) return; drawing.current = false; if (drawn.current) ref.current.toBlob(b => onChange(b), 'image/png') }
  const clear = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); drawn.current = false; onChange(null) }
  return (
    <div>
      <canvas ref={ref} className="f-sig" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      <button className="btn btn-ghost btn-sm" onClick={clear}>Clear signature</button>
    </div>
  )
}
