import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { cachedQuery, offlineLookup } from '../lib/offline'
import { compressImage } from '../lib/photos'
import CameraScan, { codeCandidates } from '../components/CameraScan'
import { saveJobCard, assetRoles } from './fieldStops'
import { savedCheck } from './StopAssets'

// Job card for one stop — Completed or Not completed. Works without signal: everything is queued on the phone.
// Asset swap check: a delivered asset that differs from the planned one must be the same product family (warning, never blocks).
const ROLE = {
  delivered: { label: 'Asset delivered', field: 'delivered_barcode', icon: '📦' },
  removed: { label: 'Asset removed', field: 'removed_barcode', icon: '↩️' },
  repaired: { label: 'Asset repaired', field: 'repaired_barcode', icon: '🛠' },
}

export async function findAsset(code) {
  const keys = codeCandidates(code)
  const local = await offlineLookup(keys)
  if (local || !navigator.onLine) return local
  for (const f of ['bar_code', 'name', 'local_code', 'serial_number', 'sap_number']) {
    const { data } = await supabase.from('assets_live').select('name,bar_code,product_base,condition,brand_hierarchy').in(f, keys).limit(1)
    if (data?.[0]) return data[0]
  }
  return null
}

export default function FieldJobCard({ stop, driver, mode, plannedBarcode, plannedBase, contact, reasons, onDone, onCancel }) {
  const roles = assetRoles(stop.case_type)
  const [outcome, setOutcome] = useState(mode)
  const [reason, setReason] = useState('')
  const [work, setWork] = useState('')
  // pre-fill: what the driver already scanned on the trip card (📷 Check), else what was planned
  const [codes, setCodes] = useState(() => ({
    delivered: savedCheck(stop.id, 'delivered')?.code || plannedBarcode || '',
    removed: roles.includes('removed') ? (savedCheck(stop.id, 'removed')?.code || stop.asset_barcodes?.find(b => b !== plannedBarcode) || '') : '',
    repaired: roles.includes('repaired') ? (savedCheck(stop.id, 'repaired')?.code || stop.asset_barcodes?.[0] || '') : '',
  }))
  const [info, setInfo] = useState({})
  const [cam, setCam] = useState(null)
  const [name, setName] = useState(contact?.customer_contact_name || '')
  const [phone, setPhone] = useState(contact?.mobile_phone || contact?.business_phone || '')
  const [other, setOther] = useState(false)
  const [photos, setPhotos] = useState([])
  const [sig, setSig] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [families, setFamilies] = useState({})

  useEffect(() => {
    cachedQuery('base_family', () => supabase.from('coolerco_product_base_family').select('product_base,family_id'))
      .then(rows => setFamilies(Object.fromEntries(rows.map(r => [r.product_base, r.family_id]))))
  }, [])

  // look up each scanned asset (offline list first); results kept per code, so a slow older lookup can't overwrite a newer one
  useEffect(() => {
    const t = setTimeout(() => {
      for (const r of roles) {
        const c = codes[r]?.trim()
        if (!c || c in (info[r] || {})) continue
        findAsset(c).then(a => setInfo(i => ({ ...i, [r]: { ...(i[r] || {}), [c]: a } })))
      }
    }, 300)
    return () => clearTimeout(t)
  }, [codes]) // eslint-disable-line react-hooks/exhaustive-deps
  const found = r => { const c = codes[r]?.trim(); return c && info[r] && c in info[r] ? { asset: info[r][c] } : null }

  const delivered = codes.delivered?.trim()
  const swapped = roles.includes('delivered') && !!delivered && !!plannedBarcode && delivered !== plannedBarcode
  const delBase = found('delivered')?.asset?.product_base
  const famA = families[delBase], famB = families[plannedBase]
  const familyOk = swapped ? (famA && famB ? famA === famB : null) : null
  const rs = (reasons || []).find(r => r.code === reason)
  const needNote = outcome === 'not_completed' && rs?.needs_note

  const addPhoto = async e => {
    const files = [...(e.target.files || [])].slice(0, 3 - photos.length)
    const out = []
    for (const f of files) out.push(await compressImage(f))
    setPhotos(p => [...p, ...out.filter(Boolean)].slice(0, 3)); e.target.value = ''
  }

  const save = async () => {
    setErr(null)
    if (outcome === 'not_completed' && !reason) return setErr('Choose why it was not completed.')
    if (needNote && !work.trim()) return setErr('Add a note for this reason.')
    if (outcome === 'completed' && roles.includes('delivered') && !delivered) return setErr('Scan or type the asset you delivered.')
    if (outcome === 'completed' && !name.trim()) return setErr('Who received it? Type the name.')
    setBusy(true)
    try {
      await saveJobCard(stop, driver, {
        outcome, reason_code: outcome === 'not_completed' ? reason : null, work_done: work.trim() || null,
        received_by_name: name.trim() || null, received_by_phone: phone.trim() || null, received_by_other: other,
        delivered_barcode: codes.delivered?.trim() || null, removed_barcode: codes.removed?.trim() || null, repaired_barcode: codes.repaired?.trim() || null,
        planned_barcode: plannedBarcode || null, swapped, swap_family_ok: familyOk, swap_note: swapped ? `Planned ${plannedBarcode} (${plannedBase || '?'}), delivered ${delivered} (${delBase || '?'})` : null,
      }, photos, sig)
      onDone()
    } catch (e) { setErr(e.message || String(e)); setBusy(false) }
  }

  return (
    <div className="f-sheet" role="dialog" aria-label="Job card">
      <div className="f-sheet-body">
        <div className="f-row" style={{ marginBottom: 8 }}>
          <div className="f-grow"><strong>📝 Job card</strong><small>{stop.point_of_sale} · {stop.case_type} · {stop.case_number}</small></div>
          <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>✕</button>
        </div>

        <div className="f-seg">
          <button className={outcome === 'completed' ? 'on ok' : ''} onClick={() => setOutcome('completed')}>✅ Completed</button>
          <button className={outcome === 'not_completed' ? 'on bad' : ''} onClick={() => setOutcome('not_completed')}>⚠️ Not completed</button>
        </div>

        {outcome === 'not_completed' && (
          <>
            <div className="field-lbl">Why not?</div>
            <div className="f-chips">{(reasons || []).map(r => <button key={r.code} className={reason === r.code ? 'on' : ''} onClick={() => setReason(r.code)}>{r.label}</button>)}</div>
          </>
        )}

        {roles.map(r => {
          const a = found(r)
          return (
            <div key={r} style={{ marginTop: 10 }}>
              <div className="field-lbl">{ROLE[r].icon} {ROLE[r].label}{r === 'delivered' && plannedBarcode ? <span className="text3"> · planned {plannedBarcode}</span> : null}</div>
              <div className="f-row" style={{ gap: 6 }}>
                <input className="field-ctrl f-grow" inputMode="text" placeholder="Barcode / asset no." value={codes[r]} onChange={e => setCodes(c => ({ ...c, [r]: e.target.value }))} />
                <button className="btn btn-ghost btn-sm" onClick={() => setCam(r)}>📷</button>
              </div>
              {a && (a.asset
                ? <small className="text3">{a.asset.name} · {a.asset.product_base || '—'} · {a.asset.condition || ''}</small>
                : <small className="text3">Not found in the saved asset list — kept as typed.</small>)}
            </div>
          )
        })}
        {swapped && (
          <div className={`form-msg ${familyOk === false ? 'err' : 'warn'}`} style={{ marginTop: 8 }}>
            {familyOk === false ? '⛔ Different product family than planned — only swap within the same family. Check before you leave it.'
              : familyOk ? '🔁 Swapped asset — same product family. It will be flagged for the office.'
                : '🔁 Swapped asset — family could not be checked. It will be flagged for the office.'}
          </div>
        )}

        <div className="field-lbl" style={{ marginTop: 10 }}>{outcome === 'completed' ? 'Work done' : 'Note'}{needNote ? ' *' : ''}</div>
        <textarea className="field-ctrl" rows={2} value={work} onChange={e => setWork(e.target.value)} placeholder={outcome === 'completed' ? 'What was done (optional)' : 'What happened'} />

        <div className="field-lbl" style={{ marginTop: 10 }}>Received by</div>
        <input className="field-ctrl" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
        <input className="field-ctrl" style={{ marginTop: 6 }} inputMode="tel" placeholder="Contact number" value={phone} onChange={e => setPhone(e.target.value)} />
        <label className="f-check"><input type="checkbox" checked={other} onChange={e => setOther(e.target.checked)} /> Someone other than the store contact</label>

        <div className="field-lbl" style={{ marginTop: 10 }}>Photos ({photos.length}/3)</div>
        <div className="f-row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {photos.map((b, i) => <img key={i} className="f-thumb" src={URL.createObjectURL(b)} alt="" onClick={() => setPhotos(p => p.filter((_, j) => j !== i))} />)}
          {photos.length < 3 && <label className="btn btn-ghost btn-sm">📷 Add<input type="file" accept="image/*" capture="environment" hidden onChange={addPhoto} /></label>}
        </div>

        {outcome === 'completed' && <><div className="field-lbl" style={{ marginTop: 10 }}>Signature</div><SignaturePad onChange={setSig} /></>}

        {err && <div className="form-msg err" style={{ marginTop: 8 }}>{err}</div>}
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 12, minHeight: 46 }} onClick={save} disabled={busy}>
          {busy ? 'Saving…' : outcome === 'completed' ? '✅ Save job card' : '⚠️ Save — not completed'}
        </button>
        <p className="text3" style={{ fontSize: 11, textAlign: 'center', marginTop: 6 }}>Saved on the phone first, sent as soon as there is signal.</p>
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
      <button className="btn btn-ghost btn-sm" onClick={clear}>Clear</button>
    </div>
  )
}
