// ➕ New case — for clients CoolerCo runs end to end (Tiger, Demo, …).
// Magnum cases are logged in COM, so Magnum is never offered here.
// Server: coolerco_case_form_options() + coolerco_case_create() (script 050).
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { fmt, CASE_TYPE_ICON, condColor } from '../lib/helpers'

const TYPE_HELP = {
  'Deliver an Asset': 'A new cooler for an outlet',
  'Repair at Shopper POS': 'A technician fixes it at the outlet',
  'Removal of Asset': 'Collect a cooler from an outlet',
  'Replacement of Asset': 'Swap a cooler at an outlet',
  'Repair at Workshop': 'A cooler in the warehouse needs repair',
  'Decal @WH': 'Rebrand a cooler in the warehouse',
}
const ERR = {
  not_allowed: 'You are not allowed to log cases for this client or warehouse.',
  bad_case_type: 'Choose a case type.',
  client_not_self_managed: 'This client logs its cases in its own system.',
  outlet_not_found: 'Choose an outlet.',
  asset_not_found: 'Choose a cooler.',
  asset_not_at_outlet: 'That cooler is not at this outlet.',
  asset_not_in_warehouse: 'That cooler is not in a warehouse.',
  already_open: 'That cooler already has an open case',
  model_required: 'Choose the model wanted.',
  symptom_required: 'Choose what is wrong.',
  no_warehouse: 'The outlet has no servicing warehouse set up.',
  bad_gps: 'The GPS point is not valid (must be in South Africa).',
}
const clean = s => s.replace(/[,()%*]/g, ' ').trim()
const fullAddress = o => [o?.street_address, o?.suburb, o?.town, o?.province, o?.postal_code].filter(Boolean).join(', ')
const inSA = (lat, lng) => lat >= -35.5 && lat <= -21.5 && lng >= 16 && lng <= 33.5
const mapLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
// Reads "-26.25, 27.85", or a Google Maps link (…@-26.25,27.85… / ?q=-26.25,27.85 / ll=…)
function parseGps(text) {
  const t = (text || '').trim()
  const m = t.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || t.match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || t.match(/^(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1]), lng = Number(m[2])
  return inSA(lat, lng) ? { lat, lng } : { lat, lng, outside: true }
}

export default function CaseNew() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [opt, setOpt] = useState(null)
  const [optErr, setOptErr] = useState(null)
  const [client, setClient] = useState(params.get('client') || '')
  const [type, setType] = useState('')
  const [outletQ, setOutletQ] = useState('')
  const [outlets, setOutlets] = useState([])
  const [outlet, setOutlet] = useState(null)
  const [assets, setAssets] = useState(null)
  const [openBy, setOpenBy] = useState({})
  const [assetQ, setAssetQ] = useState('')
  const [asset, setAsset] = useState(null)
  const [models, setModels] = useState([])
  const [ready, setReady] = useState({})
  const [model, setModel] = useState('')
  const [symptom, setSymptom] = useState('')
  const [impact, setImpact] = useState('')
  const [desc, setDesc] = useState('')
  const [contact, setContact] = useState({ name: '', mobile: '' })
  const [cls, setCls] = useState('')
  const [gps, setGps] = useState(null) // GPS found on this form for an outlet that has none
  const [gpsText, setGpsText] = useState('')
  const [gpsMsg, setGpsMsg] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [done, setDone] = useState(null)

  useEffect(() => {
    supabase.rpc('coolerco_case_form_options').then(({ data, error }) => {
      if (error) { setOptErr(error); return }
      setOpt(data)
      if (!client && data.clients?.length) setClient(data.clients[0].code)
    })
  }, [])

  const ct = useMemo(() => opt?.case_types?.find(t => t.type === type), [opt, type])
  const sym = opt?.symptoms?.find(s => s.code === symptom)
  const priority = ct?.symptom ? (opt?.impacts?.find(i => i.code === impact)?.priority || 'Medium') : 'Medium'

  // reset the steps that depend on client / type
  useEffect(() => { setOutlet(null); setOutlets([]); setOutletQ(''); setAsset(null); setModel('') }, [client])
  useEffect(() => { setAsset(null); setModel(''); setSymptom(''); setImpact('') }, [type])

  // outlet search
  useEffect(() => {
    if (!client || !ct?.outlet) return
    const t = setTimeout(() => {
      const s = clean(outletQ)
      let q = supabase.from('coolerco_outlets').select('outlet_code,name,street_address,suburb,town,province,postal_code,latitude,longitude,contact_person,mobile_number,warehouse_code')
        .eq('client_code', client).eq('active', true).order('name').limit(25)
      if (s) q = q.or(`name.ilike.%${s}%,outlet_code.ilike.%${s}%,town.ilike.%${s}%,suburb.ilike.%${s}%`)
      q.then(({ data }) => setOutlets(data || []))
    }, 300)
    return () => clearTimeout(t)
  }, [client, ct, outletQ])

  useEffect(() => { if (outlet) setContact({ name: outlet.contact_person || '', mobile: outlet.mobile_number || '' }); setGps(null); setGpsText(''); setGpsMsg(null) }, [outlet])
  const hasGps = outlet && outlet.latitude != null && outlet.longitude != null

  function useMyLocation() {
    if (!navigator.geolocation) { setGpsMsg('This device cannot share its location.'); return }
    setGpsMsg('Getting your location…')
    navigator.geolocation.getCurrentPosition(
      p => { const lat = +p.coords.latitude.toFixed(6), lng = +p.coords.longitude.toFixed(6)
        if (!inSA(lat, lng)) { setGpsMsg('That location is outside South Africa.'); return }
        setGps({ lat, lng, source: 'my location', acc: Math.round(p.coords.accuracy) }); setGpsMsg(null) },
      () => setGpsMsg('Location not shared. Allow location for this site, or paste a map link.'),
      { enableHighAccuracy: true, timeout: 10000 })
  }
  function usePasted(t) {
    setGpsText(t)
    if (!t.trim()) { setGps(g => (g?.source === 'map link' ? null : g)); setGpsMsg(null); return }
    const g = parseGps(t)
    if (!g) setGpsMsg('Paste a Google Maps link or coordinates like -26.2041, 28.0473')
    else if (g.outside) setGpsMsg('Those coordinates are outside South Africa.')
    else { setGps({ lat: g.lat, lng: g.lng, source: 'map link' }); setGpsMsg(null) }
  }

  // coolers to choose from + their open cases
  useEffect(() => {
    setAssets(null); setOpenBy({})
    if (!client || !ct?.asset || (ct.asset === 'outlet' && !outlet)) return
    let q = supabase.from('coolerco_assets').select('asset_number,serial_number,model_code,condition,status,location_type,location_code,warehouse_code,branding')
      .eq('client_code', client).order('asset_number').limit(300)
    q = ct.asset === 'outlet' ? q.eq('location_type', 'Outlet').eq('location_code', outlet.outlet_code) : q.eq('location_type', 'Warehouse')
    q.then(async ({ data }) => {
      const list = data || []
      setAssets(list)
      if (!list.length) return
      const ids = list.map(a => a.asset_number).join(',')
      const { data: open } = await supabase.from('coolerco_all_cases').select('case_number,case_type,asset_repaired,asset_removed,asset_delivered,mapped_asset')
        .eq('is_open', true).or(`asset_repaired.in.(${ids}),asset_removed.in.(${ids}),asset_delivered.in.(${ids}),mapped_asset.in.(${ids})`)
      const m = {}
      ;(open || []).forEach(c => [c.asset_repaired, c.asset_removed, c.asset_delivered, c.mapped_asset].forEach(a => { if (a && !m[a]) m[a] = c }))
      setOpenBy(m)
    })
  }, [client, ct, outlet])

  // models + how many are ready in the outlet's warehouse
  useEffect(() => {
    if (!client) return
    supabase.from('coolerco_asset_models').select('model_code,description,asset_type,product_family').eq('client_code', client).eq('active', true).order('description')
      .then(({ data }) => setModels(data || []))
  }, [client])
  useEffect(() => {
    if (!client || !outlet?.warehouse_code) { setReady({}); return }
    supabase.from('coolerco_assets').select('model_code,status').eq('client_code', client).eq('location_type', 'Warehouse').eq('warehouse_code', outlet.warehouse_code)
      .then(({ data }) => { const m = {}; (data || []).filter(a => /ready/i.test(a.status || '')).forEach(a => { m[a.model_code] = (m[a.model_code] || 0) + 1 }); setReady(m) })
  }, [client, outlet])

  // SLA preview
  useEffect(() => {
    if (!client || !type) { setPreview(null); return }
    supabase.rpc('coolerco_sla_preview', { p_client: client, p_case_type: type, p_priority: priority, p_class: cls || null })
      .then(({ data }) => setPreview(data || null))
  }, [client, type, priority, cls])

  const assetName = a => {
    const m = models.find(x => x.model_code === a.model_code)
    return m?.description || a.model_code
  }
  const shownAssets = (assets || []).filter(a => !assetQ || `${a.asset_number} ${a.serial_number} ${assetName(a)}`.toLowerCase().includes(assetQ.toLowerCase()))

  const missing = !client ? 'Choose a client' : !type ? 'Choose a case type'
    : ct?.outlet && !outlet ? 'Choose an outlet'
    : ct?.asset && !asset ? 'Choose a cooler'
    : ct?.model && !model ? 'Choose the model wanted'
    : ct?.symptom && !symptom ? 'Choose what is wrong'
    : ct?.symptom && sym?.ask_product && !impact ? 'Say what is happening to the product' : null

  async function submit() {
    setBusy(true); setMsg(null)
    const req = {
      client, case_type: type, outlet: outlet?.outlet_code, asset: asset?.asset_number, model,
      symptom: symptom || null, product_impact: impact || null, description: desc,
      contact_name: contact.name, contact_mobile: contact.mobile, sla_class: cls || null,
      latitude: !hasGps && gps ? gps.lat : null, longitude: !hasGps && gps ? gps.lng : null, gps_source: gps?.source || null,
    }
    const { data, error } = await supabase.rpc('coolerco_case_create', { p: req })
    setBusy(false)
    if (error) { setMsg({ type: 'err', text: error.message }); return }
    if (data?.error) { setMsg({ type: 'err', text: (ERR[data.error] || data.error) + (data.case_number ? `: ${data.case_number}` : '.') }); return }
    setDone(data)
  }

  function again() {
    setDone(null); setType(''); setOutlet(null); setAsset(null); setModel(''); setDesc(''); setCls(''); setMsg(null)
  }

  if (optErr) return (
    <><Topbar title="New case" /><div className="page-content">
      <div className="notice warn">{/coolerco_case_form_options|schema cache|does not exist/i.test(optErr.message) ? '⏳ Logging cases here needs database script 050.' : optErr.message}</div>
    </div></>
  )
  if (!opt) return <div className="load-state"><span className="spinner" /> Loading…</div>
  if (!opt.can_create || !opt.clients?.length) return (
    <><Topbar title="New case" /><div className="page-content">
      <div className="notice">You have no client here to log cases for. Magnum cases are logged in COM.</div>
    </div></>
  )

  if (done) return (
    <><Topbar title="New case" /><div className="page-content">
      <div className="card" style={{ padding: 18, maxWidth: 560 }}>
        <div style={{ fontSize: 28 }}>✅</div>
        <h3 style={{ margin: '6px 0' }}>Case logged: <span className="mono">{done.case_number}</span></h3>
        <div className="chip-row">
          <span className="tag tag-blue">{done.status}</span>
          {done.sla_class && <span className="tag tag-orange">SLA {done.sla_class}</span>}
          {done.priority === 'High' && <span className="tag tag-red">⚡ Urgent</span>}
          {done.repeat_of && <span className="tag tag-red">🔁 Repeat of {done.repeat_of}</span>}
        </div>
        <p className="text2" style={{ fontSize: 12 }}>Due by <strong>{fmt(done.due)} {done.due ? new Date(done.due).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : ''}</strong> (working hours, from now).</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={() => navigate(`/cases?client=${client}&case=${encodeURIComponent(done.case_number)}`)}>📂 Open the case</button>
          <button className="btn btn-ghost btn-sm" onClick={again}>➕ Log another</button>
        </div>
      </div>
    </div></>
  )

  let step = 0
  return (
    <>
      <Topbar title="New case" sub="For clients CoolerCo manages end to end" actions={<Link to={`/cases?client=${client || 'ALL'}`} className="btn btn-ghost btn-sm">📂 Cases</Link>} />
      <div className="page-content">
       <div className="nc-layout">
        <div className="nc-main">
        {opt.clients.length > 1 && (
          <Step n={++step} title="Client">
            <div className="chip-pick">{opt.clients.map(c => <button key={c.code} type="button" className={`chip-opt${client === c.code ? ' on' : ''}`} onClick={() => setClient(c.code)}>🟩 {c.name}</button>)}</div>
          </Step>
        )}

        <Step n={++step} title="What is needed?">
          <div className="nc-types">
            {opt.case_types.map(t => (
              <button key={t.type} type="button" className={`nc-type${type === t.type ? ' on' : ''}`} onClick={() => setType(t.type)}>
                <span className="nc-ico">{CASE_TYPE_ICON[t.type] || '🔧'}</span>
                <strong>{t.type}</strong><span className="text3">{TYPE_HELP[t.type]}</span>
              </button>
            ))}
          </div>
        </Step>

        {ct?.outlet && (
          <Step n={++step} title="Outlet">
            {outlet ? (
              <>
                <div className="nc-picked">🏪 <strong>{outlet.name}</strong> <span className="text3 mono">{outlet.outlet_code}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOutlet(null); setAsset(null) }}>Change</button></div>
                <div className="nc-addr">📮 {fullAddress(outlet) || <span className="text3">No address on the register</span>}</div>
                {hasGps ? (
                  <div className="nc-gps ok">📍 GPS {(+outlet.latitude).toFixed(5)}, {(+outlet.longitude).toFixed(5)} · <a href={mapLink(outlet.latitude, outlet.longitude)} target="_blank" rel="noopener noreferrer">🗺 View on map</a></div>
                ) : (
                  <div className="nc-gps missing">
                    <div><strong>📍 This outlet has no GPS point yet.</strong> Add one so the driver can navigate there. It is saved on the outlet for next time.</div>
                    <div className="nc-gps-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={useMyLocation}>📱 Use my location (I am at the outlet)</button>
                      <a className="btn btn-ghost btn-sm" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([outlet.name, fullAddress(outlet)].filter(Boolean).join(', '))}`} target="_blank" rel="noopener noreferrer">🔎 Find it on Google Maps</a>
                    </div>
                    <input className="field-ctrl" placeholder="Paste the map link or coordinates, e.g. -26.2041, 28.0473" value={gpsText} onChange={e => usePasted(e.target.value)} />
                    {gpsMsg && <div className="text3" style={{ fontSize: 11 }}>{gpsMsg}</div>}
                    {gps && <div className="nc-gps ok">✅ Point found: {gps.lat}, {gps.lng}{gps.acc ? ` (within ${gps.acc} m)` : ''} · <a href={mapLink(gps.lat, gps.lng)} target="_blank" rel="noopener noreferrer">🗺 Check on map</a> <button type="button" className="linkish" onClick={() => { setGps(null); setGpsText('') }}>✕ clear</button></div>}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="search-wrap"><span className="ico">🔍</span><input type="text" placeholder="Outlet name, code or town" value={outletQ} onChange={e => setOutletQ(e.target.value)} /></div>
                <div className="nc-list">
                  {outlets.map(o => <button key={o.outlet_code} type="button" className="nc-row" onClick={() => setOutlet(o)}><strong>{o.name}</strong><span className="text3">{o.outlet_code} · {fullAddress(o)}</span>{(o.latitude == null || o.longitude == null) && <span className="tag tag-orange">No GPS</span>}</button>)}
                  {!outlets.length && <div className="text3" style={{ padding: 6 }}>No outlets found.</div>}
                </div>
              </>
            )}
          </Step>
        )}

        {ct?.asset && (!ct.outlet || outlet) && (
          <Step n={++step} title={ct.asset === 'outlet' ? (type === 'Replacement of Asset' ? 'Cooler to take away' : 'Which cooler?') : 'Cooler in the warehouse'}>
            {asset ? (
              <div className="nc-picked">🧊 <strong className="mono">{asset.asset_number}</strong> {assetName(asset)} {asset.condition && <span className={`tag tag-${condColor(asset.condition)}`}>{asset.condition}</span>}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsset(null)}>Change</button></div>
            ) : (
              <>
                {(assets?.length || 0) > 8 && <div className="search-wrap"><span className="ico">🔍</span><input type="text" placeholder="Asset number, serial or model" value={assetQ} onChange={e => setAssetQ(e.target.value)} /></div>}
                <div className="nc-list">
                  {!assets && <div className="text3" style={{ padding: 6 }}>Loading…</div>}
                  {assets && !assets.length && <div className="text3" style={{ padding: 6 }}>{ct.asset === 'outlet' ? 'No coolers listed at this outlet.' : 'No coolers in the warehouse.'}</div>}
                  {shownAssets.map(a => {
                    const busy = openBy[a.asset_number]
                    return (
                      <button key={a.asset_number} type="button" className="nc-row" disabled={!!busy} onClick={() => setAsset(a)} title={busy ? `Open case ${busy.case_number}` : ''}>
                        <strong className="mono">{a.asset_number}</strong><span>{assetName(a)}</span>
                        <span className="text3">{a.status}{ct.asset === 'warehouse' ? ` · ${a.warehouse_code}` : ''}</span>
                        {busy ? <span className="tag tag-orange">Open: {busy.case_number}</span> : a.condition && <span className={`tag tag-${condColor(a.condition)}`}>{a.condition}</span>}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </Step>
        )}

        {ct?.model && (!ct.outlet || outlet) && (
          <Step n={++step} title={type === 'Replacement of Asset' ? 'New cooler wanted' : 'Model wanted'}>
            <div className="nc-list">
              {models.map(m => (
                <button key={m.model_code} type="button" className={`nc-row${model === m.model_code ? ' on' : ''}`} onClick={() => setModel(m.model_code)}>
                  <strong>{m.description}</strong><span className="text3">{m.asset_type}</span>
                  <span className={`tag tag-${ready[m.model_code] ? 'green' : 'neutral'}`}>{ready[m.model_code] || 0} ready in the warehouse</span>
                </button>
              ))}
            </div>
          </Step>
        )}

        {ct?.symptom && asset && (
          <Step n={++step} title="What is wrong?">
            <div className="chip-pick">{opt.symptoms.map(s => <button key={s.code} type="button" className={`chip-opt${symptom === s.code ? ' on' : ''}`} onClick={() => { setSymptom(s.code); if (!s.ask_product) setImpact('') }}>{s.label}</button>)}</div>
            {sym?.ask_product && (
              <>
                <div className="text3" style={{ margin: '10px 0 4px', fontSize: 11 }}>What is happening to the product?</div>
                <div className="chip-pick">{opt.impacts.map(i => <button key={i.code} type="button" className={`chip-opt${impact === i.code ? ' on' : ''}`} onClick={() => setImpact(i.code)}>{i.priority === 'High' ? '⚡ ' : ''}{i.label}</button>)}</div>
              </>
            )}
          </Step>
        )}

        {type && (
          <Step n={++step} title="Details">
            <div className="nc-grid">
              <label><span>Contact person</span><input className="field-ctrl" value={contact.name} onChange={e => setContact(c => ({ ...c, name: e.target.value }))} /></label>
              <label><span>Contact mobile</span><input className="field-ctrl" value={contact.mobile} onChange={e => setContact(c => ({ ...c, mobile: e.target.value }))} /></label>
            </div>
            <label className="nc-full"><span>Notes</span><textarea className="field-ctrl" rows={3} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Anything the team should know" /></label>
          </Step>
        )}

        </div>

        <aside className="nc-side">
          <div className="card nc-summary">
            <div className="nc-step-hd">🧾 Summary</div>
            <dl className="nc-dl">
              <dt>Client</dt><dd>{opt.clients.find(c => c.code === client)?.name || '—'}</dd>
              <dt>Case type</dt><dd>{type ? <>{CASE_TYPE_ICON[type]} {type}</> : '—'}</dd>
              {ct?.outlet && <><dt>Outlet</dt><dd>{outlet ? outlet.name : '—'}</dd></>}
              {ct?.outlet && outlet && <><dt>Address</dt><dd>{fullAddress(outlet) || '—'}</dd></>}
              {ct?.outlet && outlet && <><dt>GPS</dt><dd>{hasGps ? '✅ on file' : gps ? '✅ added on this form' : <span className="text3">⚠ none (optional)</span>}</dd></>}
              {ct?.asset && <><dt>Cooler</dt><dd className="mono">{asset ? asset.asset_number : '—'}</dd></>}
              {ct?.model && <><dt>Model wanted</dt><dd>{models.find(m => m.model_code === model)?.description || '—'}</dd></>}
              {ct?.symptom && <><dt>Problem</dt><dd>{sym?.label || '—'}{impact ? ` · ${opt.impacts.find(i => i.code === impact)?.label}` : ''}</dd></>}
            </dl>
            {preview && (
              <div className="nc-sla">
                ⏱ <strong>SLA {preview.sla_class}</strong> · {preview.hours} working hours · due <strong>{fmt(preview.due)} {new Date(preview.due).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</strong>
                {priority === 'High' && <span className="tag tag-red" style={{ marginLeft: 6 }}>⚡ Urgent</span>}
                {opt.can_set_sla && (
                  <span className="chip-pick" style={{ marginLeft: 8, display: 'inline-flex' }}>
                    <button type="button" className={`chip-opt${!cls ? ' on' : ''}`} onClick={() => setCls('')}>Auto</button>
                    {opt.sla_classes.map(c => <button key={c.code} type="button" className={`chip-opt${cls === c.code ? ' on' : ''}`} onClick={() => setCls(c.code)}>{c.code} · {c.hours}h</button>)}
                  </span>
                )}
              </div>
            )}

            {msg && <div className={`form-msg ${msg.type}`}>{msg.text}</div>}
            <button className="btn btn-primary nc-submit" disabled={!!missing || busy} onClick={submit}>{busy ? 'Logging…' : '✅ Log case'}</button>
            {missing && <div className="text3 nc-missing">👉 {missing}</div>}
          </div>
        </aside>
       </div>
      </div>
    </>
  )
}

function Step({ n, title, children }) {
  return (
    <div className="card nc-step">
      <div className="nc-step-hd"><span className="nc-n">{n}</span>{title}</div>
      {children}
    </div>
  )
}
