import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import './portal.css'

// Public customer portal — no login. The link token identifies the store.
// Only two server functions are used: coolerco_portal_context + coolerco_portal_submit.
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

  async function load() {
    const { data, error } = await supabase.rpc('coolerco_portal_context', { p_token: token })
    if (error) { setErr(error.message); return }
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

  // Already-logged work for the chosen asset (repair/collection) or any open delivery (new asset)
  const openFor = a => (ctx?.open_cases || []).filter(o => (o.assets || []).includes(a))
  const dup = !ctx ? [] : kind === 'new'
    ? (ctx.open_cases || []).filter(o => /deliver|replacement/i.test(o.case_type))
    : asset ? openFor(asset.asset) : []

  function reset() { setStep(0); setKind(null); setAsset(null); setFamily(null); setDesc(''); setPhotos([]); setDone(null); setDupAck(false); setStopped(null) }

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
    const { data, error } = await supabase.rpc('coolerco_portal_submit', {
      p_token: token,
      p_request: { kind, asset: asset?.asset, family_id: family?.id, description: desc, contact_name: name, contact_phone: phone, photos: photos.map(p => p.path) },
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    if (data?.error) { setErr(ERRORS[data.error] || data.error); return }
    setDone(data.case_number); load()
  }

  const canNext = [!!kind, (kind === 'new' ? !!family : !!asset) && (!dup.length || dupAck), desc.trim().length >= 5 && name.trim() && phone.trim(), true][step]

  if (err && !ctx) return <Shell><div className="p-card p-center"><div className="p-big">⚠️</div><p>{err}</p></div></Shell>
  if (!ctx) return <Shell><div className="p-center"><span className="p-spin" /> Loading your store…</div></Shell>

  return (
    <Shell pos={ctx.pos}>
      <div className="p-tabs">
        <button className={tab === 'new' ? 'on' : ''} onClick={() => setTab('new')}>➕ Log a request</button>
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>📋 My requests {ctx.requests?.length ? <span className="p-count">{ctx.requests.length}</span> : null}</button>
      </div>

      {tab === 'mine' && (ctx.open_cases || []).some(o => o.source === 'COM') && (
        <div className="p-card">
          <h3>🔧 Open work for your store</h3>
          {(ctx.open_cases || []).filter(o => o.source === 'COM').map(o => (
            <div key={o.case_number} className="p-req">
              <div><strong>{o.case_number}</strong><div className="p-muted">{o.case_type} · {fmtDate(o.created_on)}</div></div>
              <span className="p-tag ok">{o.status}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'mine' && (
        <div className="p-card">
          <h3>📋 Requests you logged</h3>
          {!ctx.requests?.length ? <p className="p-muted">No requests yet.</p> : ctx.requests.map(r => (
            <div key={r.case_number} className="p-req">
              <div><strong>{r.case_number}</strong><div className="p-muted">{r.case_type} · {fmtDate(r.created_on)}</div></div>
              <span className={`p-tag ${r.status === 'Waiting for Approval' ? 'warn' : r.status === 'Rejected' ? 'bad' : 'ok'}`}>{r.status}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'new' && done && (
        <div className="p-card p-center">
          <div className="p-done">✓</div>
          <h2>Request received</h2>
          <p className="p-muted">Your reference number</p>
          <div className="p-ref">{done}</div>
          <div className="p-tl">
            {STATUS_TL.map((s, i) => (
              <div key={s} className={`p-tl-item ${i === 0 ? 'now' : ''}`}><span className="p-tl-dot">{i === 0 ? '●' : '○'}</span>{s === 'Open' ? 'Approved' : s === 'Planned' ? 'Scheduled' : s === 'Completed' ? 'Done' : s}</div>
            ))}
          </div>
          <p className="p-muted" style={{ fontSize: 12 }}>We will contact you on {phone}. Keep this reference number.</p>
          <button className="p-btn" onClick={reset}>Log another request</button>
        </div>
      )}

      {tab === 'new' && !done && stopped && (
        <div className="p-card p-center">
          <div className="p-done">✓</div>
          <h2>No new request needed</h2>
          <p className="p-muted">Your existing case number</p>
          <div className="p-ref">{stopped.case_number}</div>
          <p className="p-muted">{stopped.case_type} · {stopped.status} · logged {fmtDate(stopped.created_on)}</p>
          <button className="p-btn" onClick={reset}>Back to start</button>
        </div>
      )}

      {tab === 'new' && !done && !stopped && (
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

          {step === 1 && dup.length > 0 && !dupAck && (
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
              <textarea rows={4} value={desc} onChange={e => setDesc(e.target.value)}
                placeholder={kind === 'repair' ? 'e.g. Not cooling, light not working, door does not close' : kind === 'collection' ? 'e.g. Store closing, not needed any more' : 'e.g. Space available near the till'} />
              <div className="p-label">📷 Photos (optional, up to 3)</div>
              <div className="p-photos">
                {photos.map(p => <img key={p.path} src={p.url} alt="" />)}
                {photos.length < 3 && (
                  <label className="p-add-photo">＋<input type="file" accept="image/*" capture="environment" multiple hidden onChange={e => addPhotos(e.target.files)} /></label>
                )}
              </div>
              <div className="p-label">👤 Your name</div>
              <input value={name} onChange={e => setName(e.target.value)} />
              <div className="p-label">📞 Contact number</div>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>
          )}

          {step === 3 && (
            <div className="p-card">
              <h3>Please confirm</h3>
              <div className="p-sum">
                <div><span>Request</span><strong>{KINDS.find(k => k.key === kind)?.label}</strong></div>
                <div><span>{kind === 'new' ? 'Item' : 'Asset'}</span><strong>{kind === 'new' ? family?.name : `${asset?.family || asset?.family_name || asset?.product} · ${asset?.barcode || ''}`}</strong></div>
                <div><span>Details</span><strong>{desc}</strong></div>
                <div><span>Photos</span><strong>{photos.length}</strong></div>
                <div><span>Contact</span><strong>{name} · {phone}</strong></div>
                <div><span>Store</span><strong>{ctx.pos.name}</strong></div>
              </div>
              {kind !== 'repair' && <p className="p-muted" style={{ fontSize: 12 }}>ℹ️ {kind === 'new' ? 'New assets' : 'Collections'} need approval before they are scheduled.</p>}
              {err && <p className="p-err">{err}</p>}
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
