import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { fmt, num, BAYS, WAREHOUSES, WH_NAMES, bayForStatus, condColor, CONDITIONS, SMARTSCAN_URL } from '../lib/helpers'
import { compressImage, getGps } from '../lib/photos'
import { whereIs } from './Assets'

// Bay scan = COM Asset Touch. Saves to public.coolerco_asset_touch (CoolerCo table).
// Sent to COM (CSV, see /scan/export): location, condition, brand, model, serial, external status, comments.
// CoolerCo only (never sent to COM): building/area + bay and whether they are right.
const SCAN_BAYS = BAYS.filter(b => ['RED', 'ORANGE', 'GREEN', 'YELLOW', 'PENDING', 'SCRAP'].includes(b.key))
const SCAN_TYPES = [['count', '🔢 Stock count'], ['receive', '📥 Received'], ['move', '🔀 Moved bay'], ['dispatch', '📤 Dispatched']]
const EXTERNAL = [ // COM's list (Asset Touch → External Status)
  'Asset Found in Expected Location', 'Asset Not in Expected Location', 'Asset Found with Casualty / Damaged',
  'Asset Found with No Plate / Plate not OK', 'Asset Found with no identifier', 'Asset Inactive Found', 'New Asset Found in Location',
]
const PHOTO_SLOTS = [['barcode', '🏷 Barcode'], ['asset', '🧊 Asset'], ['plate', '🔖 Property plate']]
const MAX_PHOTOS = 6
const TENANT = 'tenant_coolerco'

export default function Scan() {
  const [code, setCode] = useState('')
  const [asset, setAsset] = useState(null)
  const [wh, setWh] = useState(() => { try { return localStorage.getItem('cc_scan_wh') || '' } catch { return '' } })
  const [ws, setWs] = useState(false) // COM location: WH or WS
  const [bay, setBay] = useState('')
  const [type, setType] = useState('count')
  const [found, setFound] = useState({}) // condition, brand, variant, serial, ext
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState([]) // { slot, path, url }
  const [gps, setGps] = useState(undefined) // undefined = asking, null = none
  const [recent, setRecent] = useState([])
  const [stats, setStats] = useState({})
  const [busy, setBusy] = useState(false)
  const [upl, setUpl] = useState(false)
  const [msg, setMsg] = useState(null)
  const [opts, setOpts] = useState({ brands: [], models: [] })
  const inputRef = useRef(null)
  const touchId = useRef(null)

  const [locs, setLocs] = useState([])
  const [whs, setWhs] = useState([])
  const [locId, setLocId] = useState('')
  const [expected, setExpected] = useState(null)

  useEffect(() => {
    loadRecent()
    // parallel: warehouses, areas, dropdown values (server-side distinct)
    Promise.all([
      supabase.from('warehouses').select('id,code,name').eq('warehouse_type', 'regional').in('code', WAREHOUSES),
      supabase.from('coolerco_wh_locations').select('id,warehouse_code,building,area,label').eq('active', true).order('sort_order'),
      supabase.from('coolerco_asset_options').select('kind,value,base,n'),
    ]).then(([w, l, o]) => {
      setWhs(w.data || []); setLocs(l.data || [])
      const rows = o.data || []
      setOpts({
        brands: rows.filter(r => r.kind === 'brand').sort((a, b) => b.n - a.n),
        models: rows.filter(r => r.kind === 'model').sort((a, b) => String(a.value).localeCompare(String(b.value))),
      })
    })
  }, [])
  useEffect(() => { try { wh && localStorage.setItem('cc_scan_wh', wh) } catch { /* ignore */ } }, [wh])

  async function loadRecent() {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const [list, today] = await Promise.all([
      supabase.from('coolerco_asset_touch').select('created_at,bar_code,asset_name,warehouse_name,bay,bay_ok,location_ok,com_exported_at,photo_paths')
        .order('created_at', { ascending: false }).limit(15),
      supabase.from('coolerco_asset_touch').select('id', { count: 'exact', head: true }).gte('created_at', start.toISOString()),
    ])
    setRecent(list.data || []); setStats({ today: today.count })
  }

  function reset() {
    setAsset(null); setCode(''); setNotes(''); setExpected(null); setPhotos([]); setFound({}); setGps(undefined); touchId.current = null
  }

  async function lookup(e) {
    e?.preventDefault()
    const s = code.trim().replace(/[,()]/g, ' ')
    if (!s) return
    setBusy(true); setMsg(null); setAsset(null); setPhotos([])
    const { data } = await supabase.from('assets_live')
      .select('name,bar_code,local_code,sap_number,serial_number,external_code,asset_type,product_base,product_variant,brand_hierarchy,condition,asset_status,asset_location,assign_account,points_of_sale')
      .or(`bar_code.eq.${s},local_code.eq.${s},name.eq.${s},serial_number.eq.${s}`).limit(1)
    const a = data?.[0]
    if (!a) { setBusy(false); setMsg({ type: 'err', text: `"${s}" was not found in the asset register.` }); return }
    touchId.current = crypto.randomUUID()
    setAsset(a)
    setFound({ condition: a.condition || '', brand: a.brand_hierarchy || '', variant: a.product_variant || '', serial: a.serial_number || '', ext: '' })
    setWs(/ WS$/i.test(a.assign_account || ''))
    const suggested = bayForStatus(a.asset_status)
    setBay(SCAN_BAYS.some(b => b.key === suggested) ? suggested : '')
    setGps(undefined); getGps().then(setGps) // in the background
    const { data: chk } = await supabase.from('coolerco_asset_location_check')
      .select('warehouse_code,expected_location_id,expected_location').eq('name', a.name).maybeSingle()
    setBusy(false)
    setExpected(chk || null)
    if (chk?.warehouse_code) setWh(chk.warehouse_code)
    setLocId(chk?.expected_location_id || '')
  }

  async function addPhoto(slot, file) {
    if (!file || !touchId.current) return
    setUpl(true)
    try {
      const blob = await compressImage(file)
      const day = new Date().toISOString().slice(0, 10)
      const path = `touch/${day}/${touchId.current}/${slot}-${Date.now()}.jpg`
      const { error } = await supabase.storage.from('coolerco-cases').upload(path, blob, { contentType: 'image/jpeg' })
      if (error) throw error
      setPhotos(p => [...p, { slot, path, url: URL.createObjectURL(blob) }])
    } catch (e) { setMsg({ type: 'err', text: 'Photo not saved: ' + (e.message || e) }) }
    setUpl(false)
  }

  // Checks (our side): expected bay from COM status; expected building/area from the location rules
  const expectedBay = asset ? bayForStatus(asset.asset_status) : null
  const bayOk = !bay || !expectedBay || !SCAN_BAYS.some(b => b.key === expectedBay) ? null : bay === expectedBay
  const locOk = !locId || !expected?.expected_location_id ? null : locId === expected.expected_location_id
  const comLocation = wh ? `RTMA ${WH_NAMES[wh]} ${ws ? 'WS' : 'WH'}` : ''
  const autoExt = asset && comLocation ? (comLocation === asset.assign_account ? 'Asset Found in Expected Location' : 'Asset Not in Expected Location') : ''
  const model = opts.models.find(m => m.value === found.variant)
  const changed = k => asset && ({ condition: asset.condition, brand: asset.brand_hierarchy, variant: asset.product_variant, serial: asset.serial_number }[k] || '') !== (found[k] || '')

  async function save() {
    const whRow = whs.find(w => w.code === wh)
    if (!asset || !whRow || !bay || !locId) { setMsg({ type: 'warn', text: 'Choose the warehouse, building/area and bay first.' }); return }
    if (photos.length < 3 && !confirm(`Only ${photos.length} photo(s). Save anyway?`)) return
    const loc = locs.find(l => l.id === locId)
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('coolerco_asset_touch').insert({
      id: touchId.current, tenant_id: TENANT,
      bar_code: asset.bar_code, local_code: asset.local_code, asset_name: asset.name,
      warehouse_id: whRow.id, warehouse_name: loc?.label || WH_NAMES[wh], location_id: locId, bay, scan_type: type,
      scanned_by: user?.email || 'ops-hub', scanned_by_user_id: user?.id || null, notes: notes.trim() || null,
      com_location: comLocation, external_status: found.ext || autoExt,
      condition_found: found.condition || null, brand_found: found.brand || null,
      product_variant_found: found.variant || null, product_base_found: model?.base || asset.product_base || null,
      serial_found: found.serial?.trim() || null,
      latitude: gps?.lat ?? null, longitude: gps?.lng ?? null,
      photo_paths: photos.map(p => p.path),
      expected_bay: expectedBay, bay_ok: bayOk, expected_location_id: expected?.expected_location_id || null, location_ok: locOk,
    })
    setBusy(false)
    if (error) { setMsg({ type: 'err', text: 'Could not save the scan: ' + error.message }); return }
    const warn = [bayOk === false && `wrong bay — belongs in ${BAYS.find(b => b.key === expectedBay)?.icon} ${BAYS.find(b => b.key === expectedBay)?.label}`,
      locOk === false && `wrong area — should be in ${expected.expected_location}`].filter(Boolean)
    setMsg({ type: warn.length ? 'warn' : 'ok', text: `✓ ${asset.bar_code || asset.name} saved · ${loc?.label} · ${BAYS.find(b => b.key === bay)?.label}${warn.length ? ' — ⚠ ' + warn.join(' · ') : ''}` })
    reset(); loadRecent(); inputRef.current?.focus()
  }

  const where = whereIs(asset)
  const Changed = ({ k }) => changed(k) ? <span className="tag tag-orange" style={{ marginLeft: 6 }}>changed</span> : null

  return (
    <>
      <Topbar title="Scan / Asset Touch" sub={`Bay scan + COM asset touch · ${num(stats.today)} today`}
        actions={<>
          <a className="btn btn-ghost btn-sm" href={SMARTSCAN_URL} target="_blank" rel="noopener noreferrer" title="COM assets scanned — reporting app">📊 COM scan reports ↗</a>
          <Link className="btn btn-ghost btn-sm" to="/scan/export">⬆ COM Touch export</Link>
        </>} />
      <div className="page-content">
        <div className="two-col">
          <div className="card" style={{ padding: 16 }}>
            <form onSubmit={lookup} className="filters" style={{ marginBottom: 12 }}>
              <div className="search-wrap" style={{ flex: 1 }}>
                <span className="ico">📷</span>
                <input ref={inputRef} autoFocus inputMode="numeric" placeholder="Scan or type barcode / local code / serial" value={code} onChange={e => setCode(e.target.value)} />
              </div>
              <button className="btn btn-primary btn-sm" disabled={busy}>Find</button>
              {asset && <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>✕</button>}
            </form>

            {asset && (
              <>
                <div className={`where-box ${where.rtma ? 'rtma' : ''}`}>
                  <div style={{ fontSize: 22 }}>{where.icon}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }} className="mono">{asset.name}</div>
                    <div className="text3" style={{ fontSize: 11 }}>{asset.product_variant || asset.product_base} · {asset.asset_type}</div>
                    <div style={{ fontSize: 11.5 }}>COM says: {where.text}</div>
                  </div>
                </div>
                <div className="scan-ro">
                  <div><span>🏷 Barcode 🔒</span><b className="mono">{asset.bar_code || '—'}</b></div>
                  <div><span>SAP no. 🔒</span><b className="mono">{asset.sap_number || '—'}</b></div>
                  <div><span>Local code</span><b className="mono">{asset.local_code || '—'}</b></div>
                  <div><span>Status (COM) 🔒</span><b><span className="tag tag-neutral">{asset.asset_status || '—'}</span></b></div>
                </div>
                {!where.rtma && <div className="form-msg warn" style={{ marginBottom: 8 }}>⚠ COM does not list this asset in RTMA stock — the touch will show "Not in Expected Location".</div>}

                <details className="sec" open>
                  <summary>📍 Where is it? (bay check is for CoolerCo only)</summary>
                  <div className="sec-body">
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <div className="field-lbl">🏢 Warehouse</div>
                        <select className="field-ctrl" value={wh} onChange={e => { setWh(e.target.value); setLocId('') }}>
                          <option value="">Choose…</option>
                          {WAREHOUSES.map(w => <option key={w} value={w}>{WH_NAMES[w]}</option>)}
                        </select>
                      </div>
                      <div className="seg">
                        <button type="button" className={`seg-btn${!ws ? ' on' : ''}`} onClick={() => setWs(false)}>🏬 WH</button>
                        <button type="button" className={`seg-btn${ws ? ' on' : ''}`} onClick={() => setWs(true)}>🛠 WS</button>
                      </div>
                    </div>
                    {comLocation && <div className="text3" style={{ fontSize: 10.5, marginTop: 4 }}>COM location: <b>{comLocation}</b>{asset.assign_account && comLocation !== asset.assign_account ? ` · COM has it at ${asset.assign_account}` : ''}</div>}

                    <div className="field-lbl" style={{ marginTop: 10 }}>🏠 Building / area</div>
                    <div className="bay-pick">
                      {locs.filter(l => l.warehouse_code === wh).map(l => (
                        <button type="button" key={l.id} className={`bay-tile bay-pending${locId === l.id ? ' on' : ''}`} onClick={() => setLocId(l.id)}>
                          <span>{l.building}{l.area !== 'MAIN' ? ` · ${l.area}` : ''}</span>
                          {expected?.expected_location_id === l.id && <strong title="Where this asset should be">★</strong>}
                        </button>
                      ))}
                    </div>
                    {locOk === false && <div className="form-msg warn" style={{ marginTop: 6 }}>⚠ Wrong area — a <b>{asset.asset_status}</b> {asset.condition?.charAt(0) === 'A' ? '(A - New) ' : ''}asset belongs in <b>{expected.expected_location}</b>.</div>}

                    <div className="field-lbl" style={{ marginTop: 10 }}>🎨 Bay it is in now</div>
                    <div className="bay-pick">
                      {SCAN_BAYS.map(b => (
                        <button type="button" key={b.key} className={`bay-tile bay-${b.key.toLowerCase()}${bay === b.key ? ' on' : ''}`} onClick={() => setBay(b.key)}>
                          <span>{b.icon} {b.label}</span>
                          {expectedBay === b.key && <strong title="Bay for this COM status">★</strong>}
                        </button>
                      ))}
                    </div>
                    {bayOk === false && <div className="form-msg warn" style={{ marginTop: 6 }}>⚠ Wrong bay — <b>{asset.asset_status}</b> belongs in {BAYS.find(b => b.key === expectedBay)?.icon} <b>{BAYS.find(b => b.key === expectedBay)?.label}</b>. Move it, or save as is to record where it was found.</div>}
                    {bayOk && locOk !== false && <div className="form-msg ok" style={{ marginTop: 6 }}>✅ Right place</div>}
                  </div>
                </details>

                <details className="sec" open>
                  <summary>🔎 What did you find? (goes to COM)</summary>
                  <div className="sec-body">
                    <div className="scan-grid">
                      <div>
                        <div className="field-lbl">Condition<Changed k="condition" /></div>
                        <select className="field-ctrl" value={found.condition} onChange={e => setFound({ ...found, condition: e.target.value })}>
                          {!CONDITIONS.includes(found.condition) && <option value={found.condition}>{found.condition || '—'}</option>}
                          {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <div className="field-lbl">Branding (brand hierarchy)<Changed k="brand" /></div>
                        <select className="field-ctrl" value={found.brand} onChange={e => setFound({ ...found, brand: e.target.value })}>
                          {!opts.brands.some(b => b.value === found.brand) && <option value={found.brand}>{found.brand || '—'}</option>}
                          {opts.brands.map(b => <option key={b.value} value={b.value}>{b.value}</option>)}
                        </select>
                      </div>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <div className="field-lbl">Model (product variant){changed('variant') ? <span className="tag tag-orange" style={{ marginLeft: 6 }}>mismatch — was {asset.product_variant}</span> : null}</div>
                        <select className="field-ctrl" value={found.variant} onChange={e => setFound({ ...found, variant: e.target.value })}>
                          {!opts.models.some(m => m.value === found.variant) && <option value={found.variant}>{found.variant || '—'}</option>}
                          {opts.models.map(m => <option key={m.value} value={m.value}>{m.value}{m.base && m.base.replace(/^\S+\s+-\s+/, '') !== m.value.replace(/^\S+\s+-\s+/, '') ? `  (${m.base})` : ''}</option>)}
                        </select>
                        {model && <div className="text3" style={{ fontSize: 10.5, marginTop: 2 }}>Product base: {model.base}</div>}
                      </div>
                      <div>
                        <div className="field-lbl">Serial no.<Changed k="serial" /></div>
                        <input className="field-ctrl mono" value={found.serial} onChange={e => setFound({ ...found, serial: e.target.value })} />
                      </div>
                      <div>
                        <div className="field-lbl">Touch result</div>
                        <select className="field-ctrl" value={found.ext} onChange={e => setFound({ ...found, ext: e.target.value })}>
                          <option value="">Auto: {autoExt.replace('Asset ', '') || '—'}</option>
                          {EXTERNAL.map(x => <option key={x} value={x}>{x}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="field-lbl" style={{ marginTop: 10 }}>📸 Photos ({photos.length}/{MAX_PHOTOS}) — barcode, asset and property plate</div>
                    <div className="scan-photos">
                      {PHOTO_SLOTS.map(([slot, label]) => {
                        const p = photos.find(x => x.slot === slot)
                        return (
                          <label key={slot} className={`scan-photo${p ? ' has' : ''}`}>
                            {p ? <img src={p.url} alt={label} /> : <span>{upl ? '…' : '＋'}</span>}
                            <small>{label}</small>
                            {!p && <input type="file" accept="image/*" capture="environment" hidden onChange={e => addPhoto(slot, e.target.files?.[0])} />}
                          </label>
                        )
                      })}
                      {photos.filter(p => p.slot === 'extra').map(p => <label key={p.path} className="scan-photo has"><img src={p.url} alt="extra" /><small>Extra</small></label>)}
                      {photos.length < MAX_PHOTOS && (
                        <label className="scan-photo"><span>＋</span><small>Extra</small>
                          <input type="file" accept="image/*" capture="environment" hidden onChange={e => addPhoto('extra', e.target.files?.[0])} /></label>
                      )}
                    </div>

                    <div className="field-lbl" style={{ marginTop: 10 }}>💬 Comments (sent to COM as Short Notes)</div>
                    <textarea className="field-ctrl" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Plate damaged, decal peeling" />
                    <div className="text3" style={{ fontSize: 10.5, marginTop: 4 }}>
                      {gps === undefined ? '📍 Getting GPS…' : gps ? `📍 GPS captured (±${gps.acc} m)` : '📍 No GPS (allow location on this device to capture it)'}
                    </div>
                  </div>
                </details>

                <div className="field-lbl">Scan type</div>
                <div className="seg">
                  {SCAN_TYPES.map(([k, l]) => <button type="button" key={k} className={`seg-btn${type === k ? ' on' : ''}`} onClick={() => setType(k)}>{l}</button>)}
                </div>
                <button className="btn btn-primary" style={{ marginTop: 12, width: '100%' }} onClick={save} disabled={busy || upl}>✓ Save scan</button>
              </>
            )}
            {msg && <div className={`form-msg ${msg.type}`} style={{ marginTop: 10 }}>{msg.text}</div>}
          </div>

          <div className="card">
            <div className="card-header"><span className="card-title">🕒 Recent scans</span><Link className="card-count" to="/scan/export">COM export ›</Link></div>
            {!recent.length ? <div className="empty-state"><div className="empty-ico">📷</div><div>No scans yet</div></div> : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>When</th><th>Barcode</th><th>Area</th><th>Bay</th><th>📸</th><th>COM</th></tr></thead>
                  <tbody>{recent.map((r, i) => (
                    <tr key={i}>
                      <td className="text3">{fmt(r.created_at)}</td><td className="mono">{r.bar_code || r.asset_name}</td>
                      <td>{r.warehouse_name}{r.location_ok === false ? ' ⚠' : ''}</td>
                      <td>{BAYS.find(b => b.key === r.bay)?.icon} {r.bay}{r.bay_ok === false ? ' ⚠' : ''}</td>
                      <td>{r.photo_paths?.length || 0}</td>
                      <td>{r.com_exported_at ? <span className="tag tag-green">sent</span> : <span className="tag tag-neutral">to send</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
