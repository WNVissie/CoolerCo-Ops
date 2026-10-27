import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { fmt, num, BAYS, WAREHOUSES, WH_NAMES, bayForStatus, condColor, CONDITIONS, SMARTSCAN_URL } from '../lib/helpers'
import { compressImage, getGps } from '../lib/photos'
import { whereIs } from './Assets'
import CameraScan, { codeCandidates } from '../components/CameraScan'
import PlaceBadge, { PlaceLegend } from '../components/PlaceBadge'
import { dbScanType, queueAdd, queueAll, flushQueue, startAutoFlush, isNetErr, offlineLookup, cachedQuery, saveWarehouseAssets, savedAssetsInfo, storageUsed } from '../lib/offline'

// Bay scan = COM Asset Touch. Saves to public.coolerco_asset_touch (CoolerCo table).
// Sent to COM (CSV, see /scan/export): location, condition, brand, model, serial, external status, comments.
// CoolerCo only (never sent to COM): building/area + bay and whether they are right.
const SCAN_BAYS = BAYS.filter(b => ['RED', 'ORANGE', 'GREEN', 'YELLOW', 'PENDING', 'SCRAP'].includes(b.key))
// values = what the database accepts (daily, monthly, receiving, dispatch, stocktake)
const SCAN_TYPES = [['stocktake', '🔢 Stock count'], ['receiving', '📥 Received'], ['daily', '🔀 Moved bay'], ['dispatch', '📤 Dispatched']]
const EXTERNAL = [ // COM's list (Asset Touch → External Status)
  'Asset Found in Expected Location', 'Asset Not in Expected Location', 'Asset Found with Casualty / Damaged',
  'Asset Found with No Plate / Plate not OK', 'Asset Found with no identifier', 'Asset Inactive Found', 'New Asset Found in Location',
]
const PHOTO_SLOTS = [['barcode', '🏷 Barcode'], ['asset', '🧊 Asset'], ['plate', '🔖 Property plate']]
const MAX_PHOTOS = 6
const TENANT = 'tenant_coolerco'
const keep = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const put = (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }
const buzz = bad => { try { navigator.vibrate?.(bad ? [160, 80, 160, 80, 160] : 60) } catch { /* ignore */ } }

export default function Scan({ field = false }) {
  const [code, setCode] = useState('')
  const [asset, setAsset] = useState(null)
  const [wh, setWh] = useState(() => { try { return localStorage.getItem('cc_scan_wh') || '' } catch { return '' } })
  const [ws, setWs] = useState(false) // COM location: WH or WS
  const [bay, setBay] = useState('')
  const [type, setType] = useState('stocktake')
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
  const [cam, setCam] = useState(false)
  const [me, setMe] = useState(null)
  const [scope, setScope] = useState('me') // me | wh (teams scan at different warehouses at the same time)
  const touchId = useRef(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [queued, setQueued] = useState([]) // waiting to send (this phone)
  const [saved, setSaved] = useState(null) // offline asset list info
  const [saving, setSaving] = useState(null)
  const [used, setUsed] = useState(null) // MB kept on this phone

  const [locs, setLocs] = useState([])
  const [whs, setWhs] = useState([])
  const [locId, setLocId] = useState('')
  const [expected, setExpected] = useState(null)

  // ⚡ Quick scan: scan → compact card → saved. ✏️ Change opens the full scan.
  const [mode, setMode] = useState(() => keep('cc_scan_mode', 'quick'))
  const [scanLoc, setScanLoc] = useState(() => keep('cc_scan_loc', '')) // where the scanner is standing (building/area)
  const [quickWs, setQuickWs] = useState(() => keep('cc_scan_ws', '0') === '1')
  const [qc, setQc] = useState(null) // the last quick-scan card
  const gpsRef = useRef(null)
  useEffect(() => put('cc_scan_mode', mode), [mode])
  useEffect(() => { if (scanLoc) put('cc_scan_loc', scanLoc) }, [scanLoc])
  useEffect(() => put('cc_scan_ws', quickWs ? '1' : '0'), [quickWs])

  useEffect(() => {
    loadRecent()
    // parallel: warehouses, areas, dropdown values (server-side distinct)
    // live when online, the phone's saved copy when not
    Promise.all([
      cachedQuery('whs', () => supabase.from('warehouses').select('id,code,name').eq('warehouse_type', 'regional').in('code', WAREHOUSES)),
      cachedQuery('locs', () => supabase.from('coolerco_wh_locations').select('id,warehouse_code,building,area,label').eq('active', true).order('sort_order')),
      cachedQuery('opts', () => supabase.from('coolerco_asset_options').select('kind,value,base,n')),
    ]).then(([w, l, o]) => {
      setWhs(w || []); setLocs(l || [])
      const rows = o || []
      setOpts({
        brands: rows.filter(r => r.kind === 'brand').sort((a, b) => b.n - a.n),
        models: rows.filter(r => r.kind === 'model').sort((a, b) => String(a.value).localeCompare(String(b.value))),
      })
    })
  }, [])
  useEffect(() => { try { wh && localStorage.setItem('cc_scan_wh', wh) } catch { /* ignore */ } }, [wh])

  // session from the phone (works offline)
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setMe(data?.session?.user || null)) }, [])
  useEffect(() => { if (me) loadRecent() }, [me, scope, wh])
  useEffect(() => {
    startAutoFlush()
    const refreshQ = () => { queueAll().then(setQueued); storageUsed().then(setUsed) }
    const on = () => { setOnline(true); flushQueue() }, off = () => setOnline(false)
    const sent = e => { setMsg({ type: 'ok', text: `📶 Back online — ${e.detail} saved item(s) sent` }); loadRecent() }
    window.addEventListener('online', on); window.addEventListener('offline', off)
    window.addEventListener('cc-queue', refreshQ); window.addEventListener('cc-queue-sent', sent)
    refreshQ()
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('cc-queue', refreshQ); window.removeEventListener('cc-queue-sent', sent) }
  }, [])
  useEffect(() => { if (wh) savedAssetsInfo(wh).then(setSaved) }, [wh])

  async function saveOffline() {
    if (!wh) return
    setSaving(0)
    try { const v = await saveWarehouseAssets(wh, n => setSaving(n)); setSaved({ at: v.at, n: v.rows.length }) }
    catch (e) { setMsg({ type: 'err', text: 'Could not save the list: ' + (e.message || e) }) }
    setSaving(null)
  }

  async function loadRecent() {
    if (!me || !navigator.onLine) return
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const whId = whs.find(w => w.code === wh)?.id
    let list = supabase.from('coolerco_asset_touch').select('id,created_at,bar_code,asset_name,warehouse_name,bay,bay_ok,location_ok,touch_status,photo_paths,scanned_by,scanned_by_user_id')
      .order('created_at', { ascending: false }).limit(25)
    list = scope === 'wh' && whId ? list.eq('warehouse_id', whId) : list.eq('scanned_by_user_id', me.id)
    const [l, mine, all] = await Promise.all([
      list,
      supabase.from('coolerco_asset_touch').select('id', { count: 'exact', head: true }).gte('created_at', start.toISOString()).eq('scanned_by_user_id', me.id),
      supabase.from('coolerco_asset_touch').select('id', { count: 'exact', head: true }).gte('created_at', start.toISOString()),
    ])
    setRecent(l.data || []); setStats({ today: mine.count, all: all.count })
  }

  function reset() {
    photos.forEach(p => p.url && URL.revokeObjectURL(p.url)) // release on-screen previews
    setAsset(null); setCode(''); setNotes(''); setExpected(null); setPhotos([]); setFound({}); setGps(undefined); touchId.current = null
  }

  // Find an asset by any code (online: assets_live · no signal: the list saved on this phone)
  async function findAsset(raw) {
    // QR codes can hold a URL or text: try every likely key (asset no., barcode, local code, serial, external code, SAP no.)
    const keys = codeCandidates(raw).map(k => k.replace(/[,()"\\]/g, '')).filter(Boolean)
    const list = keys.map(k => `"${k}"`).join(',')
    let a = null, fromPhone = false
    try {
      if (!navigator.onLine) throw new Error('offline')
      const { data, error } = await supabase.from('assets_live')
        .select('name,bar_code,local_code,sap_number,serial_number,external_code,asset_type,product_base,product_variant,brand_hierarchy,condition,asset_status,asset_location,assign_account,points_of_sale')
        .or(['name', 'bar_code', 'local_code', 'serial_number', 'external_code', 'sap_number'].map(f => `${f}.in.(${list})`).join(',')).limit(5)
      if (error) throw error
      // best match: asset no. → barcode → local code → serial → external → SAP
      const rank = x => ['name', 'bar_code', 'local_code', 'serial_number', 'external_code', 'sap_number'].findIndex(f => keys.includes(String(x[f] || '')))
      a = (data || []).sort((x, y) => rank(x) - rank(y))[0]
    } catch (err) {
      if (!isNetErr(err)) return { error: err.message }
      a = await offlineLookup(keys); fromPhone = true // no signal: the warehouse list saved on this phone
    }
    return { a, fromPhone }
  }
  // Where it should be (location rules) + where CoolerCo last scanned it
  async function locationCheck(a, fromPhone) {
    if (fromPhone) return null
    const { data } = await supabase.from('coolerco_asset_location_check')
      .select('warehouse_code,expected_location_id,expected_location,scanned_location_id,scanned_location,last_scan_at')
      .eq('name', a.name).maybeSingle().then(r => r, () => ({ data: null }))
    return data || null
  }

  async function lookup(e, scanned) {
    e?.preventDefault?.()
    const raw = (scanned ?? code).trim()
    if (!raw) return
    if (scanned) setCode(scanned)
    setBusy(true); setMsg(null); setAsset(null); setPhotos([])
    const { a, fromPhone, error } = await findAsset(raw)
    if (error) { setBusy(false); setMsg({ type: 'err', text: error }); return }
    if (!a) { setBusy(false); setMsg({ type: 'err', text: fromPhone ? `No signal and not in this phone's saved list. Code read: "${raw.slice(0, 120)}"` : `Not found in the asset register. Code read: "${raw.slice(0, 120)}"` }); return }
    if (fromPhone) setMsg({ type: 'warn', text: '📶 No signal — asset details from the list saved on this phone' })
    touchId.current = crypto.randomUUID()
    setAsset(a)
    setFound({ condition: a.condition || '', brand: a.brand_hierarchy || '', variant: a.product_variant || '', serial: a.serial_number || '', ext: '' })
    setWs(/ WS$/i.test(a.assign_account || ''))
    const suggested = bayForStatus(a.asset_status)
    setBay(SCAN_BAYS.some(b => b.key === suggested) ? suggested : '')
    setGps(undefined); getGps().then(setGps) // in the background
    const chk = await locationCheck(a, fromPhone)
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
      let uploaded = false
      if (navigator.onLine) {
        const { error } = await supabase.storage.from('coolerco-cases').upload(path, blob, { contentType: 'image/jpeg', upsert: true })
        if (error && !isNetErr(error)) throw error
        uploaded = !error
      }
      setPhotos(p => [...p, { slot, path, url: URL.createObjectURL(blob), blob, uploaded }]) // not uploaded yet → sent with the scan
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
    const user = me
    const row = {
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
      created_at: new Date().toISOString(), // the time of the scan, also when it is sent later
    }
    const pending = photos.filter(p => !p.uploaded).map(p => ({ path: p.path, blob: p.blob }))
    const res = await persist(row, pending, asset.bar_code || asset.name)
    setBusy(false)
    if (res.error) { setMsg({ type: 'err', text: 'Could not save the scan: ' + res.error }); return }
    const queuedNow = res.queued
    const warn = [bayOk === false && `wrong bay — belongs in ${BAYS.find(b => b.key === expectedBay)?.icon} ${BAYS.find(b => b.key === expectedBay)?.label}`,
      locOk === false && `wrong area — should be in ${expected.expected_location}`].filter(Boolean)
    setMsg({ type: warn.length ? 'warn' : 'ok', text: `${queuedNow ? '📶 No signal — saved on this phone, it will send by itself.' : '✓'} ${asset.bar_code || asset.name} saved as New (tap 📤 Submit when done) · ${loc?.label} · ${BAYS.find(b => b.key === bay)?.label}${warn.length ? ' — ⚠ ' + warn.join(' · ') : ''}` })
    reset(); loadRecent(); inputRef.current?.focus()
  }

  // Save one scan: online → insert (duplicate id = already saved); no signal → kept on the phone
  async function persist(row, pending = [], label = '') {
    try {
      if (!navigator.onLine) throw new Error('offline')
      for (const p of pending) {
        const { error } = await supabase.storage.from('coolerco-cases').upload(p.path, p.blob, { contentType: 'image/jpeg', upsert: true })
        if (error) throw error
      }
      const { error } = await supabase.from('coolerco_asset_touch').insert({ ...row, scan_type: dbScanType(row.scan_type) })
      if (error && error.code !== '23505') throw error
      return { queued: false }
    } catch (err) {
      if (!isNetErr(err)) return { error: err.message || String(err) }
      await queueAdd({ type: 'touch', row, photos: pending, label }); return { queued: true }
    }
  }

  // ⚡ Quick scan: find → compare with where the scanner is → save (or ask when it is in the wrong place)
  const scanPlace = locs.find(l => l.id === scanLoc && l.warehouse_code === wh) || null
  async function quickScan(raw) {
    raw = String(raw || '').trim()
    if (!raw) return
    const whRow = whs.find(w => w.code === wh)
    if (!scanPlace || !whRow) { setMsg({ type: 'warn', text: '📍 First choose where you are scanning — warehouse and area.' }); return }
    setMsg(null); setCode(''); setQc({ status: 'looking', code: raw })
    getGps().then(g => { gpsRef.current = g }) // in the background, used for the next save
    const { a, fromPhone, error } = await findAsset(raw)
    if (error || !a) {
      buzz(true)
      setQc({ status: 'notfound', code: raw, text: error || (fromPhone ? "No signal and not in this phone's saved list" : 'Not found in the asset register') }); return
    }
    const chk = await locationCheck(a, fromPhone)
    const comWh = /^RTMA /i.test(a.assign_account || '') ? String(a.assign_account).replace(/^RTMA\s+|\s+W[HS]$/gi, '') : null
    const card = {
      id: crypto.randomUUID(), asset: a, chk, fromPhone, place: scanPlace, whRow, ws: quickWs,
      expBay: bayForStatus(a.asset_status),
      areaOk: chk?.expected_location_id ? chk.expected_location_id === scanPlace.id : null, // location rules
      whOk: comWh ? comWh === WH_NAMES[wh] : false, // COM: is it booked to this warehouse at all?
    }
    if (card.areaOk === false || card.whOk === false) { buzz(true); setQc({ ...card, status: 'wrong' }); return }
    buzz(false); await quickSave(card)
  }
  async function quickSave(card) {
    const a = card.asset, comLoc = `RTMA ${WH_NAMES[card.place.warehouse_code]} ${card.ws ? 'WS' : 'WH'}`
    setQc({ ...card, status: 'saving' })
    const row = {
      id: card.id, tenant_id: TENANT,
      bar_code: a.bar_code || a.name, local_code: a.local_code, asset_name: a.name,
      warehouse_id: card.whRow.id, warehouse_name: card.place.label, location_id: card.place.id,
      bay: SCAN_BAYS.some(b => b.key === card.expBay) ? card.expBay : null, scan_type: 'stocktake',
      scanned_by: me?.email || 'ops-hub', scanned_by_user_id: me?.id || null, notes: null,
      com_location: comLoc, external_status: comLoc === a.assign_account ? 'Asset Found in Expected Location' : 'Asset Not in Expected Location',
      condition_found: a.condition || null, brand_found: a.brand_hierarchy || null,
      product_variant_found: a.product_variant || null, product_base_found: a.product_base || null, serial_found: a.serial_number || null,
      latitude: gpsRef.current?.lat ?? null, longitude: gpsRef.current?.lng ?? null, photo_paths: [],
      expected_bay: card.expBay, bay_ok: null, // quick scan does not check the bay
      expected_location_id: card.chk?.expected_location_id || null,
      location_ok: card.areaOk === false || card.whOk === false ? false : card.areaOk,
      created_at: new Date().toISOString(),
    }
    const res = await persist(row, [], a.bar_code || a.name)
    setQc({ ...card, status: res.error ? 'error' : res.queued ? 'queued' : 'saved', text: res.error, accepted: card.areaOk === false || card.whOk === false })
    if (!res.error) loadRecent()
  }
  // ✏️ Change → the full scan, prefilled (saving it adds a newer scan; the latest scan counts)
  function openFull(card) {
    const a = card.asset
    setMode('full'); setCam(false); setQc(null); setMsg(null)
    touchId.current = crypto.randomUUID()
    setAsset(a); setCode(a.bar_code || a.name); setPhotos([]); setNotes('')
    setFound({ condition: a.condition || '', brand: a.brand_hierarchy || '', variant: a.product_variant || '', serial: a.serial_number || '', ext: '' })
    setWs(card.ws); setLocId(card.place.id); setExpected(card.chk || null)
    setBay(SCAN_BAYS.some(b => b.key === card.expBay) ? card.expBay : '')
    setGps(undefined); getGps().then(setGps)
  }

  async function submit(ids) {
    if (!ids.length) return
    const patch = { touch_status: 'Submitted', submitted_at: new Date().toISOString(), submitted_by: me?.email || null }
    let error = null
    try {
      if (!navigator.onLine) throw new Error('offline')
      ;({ error } = await supabase.from('coolerco_asset_touch').update(patch).in('id', ids).eq('touch_status', 'New'))
      if (error && isNetErr(error)) throw error
    } catch {
      await queueAdd({ type: 'submit', ids, patch, label: `Submit ${ids.length}` })
      setMsg({ type: 'warn', text: `📶 No signal — submit of ${ids.length} scan(s) saved on this phone, it will send by itself` }); return
    }
    setMsg(error ? { type: 'err', text: error.message } : { type: 'ok', text: `📤 ${ids.length} scan(s) submitted — ready to sync to COM` })
    loadRecent()
  }
  const queuedTouches = queued.filter(q => q.type === 'touch')
  const queuedSubmitIds = new Set(queued.filter(q => q.type === 'submit').flatMap(q => q.ids))
  const newOnes = [...queuedTouches.map(q => ({ id: q.row.id })), ...recent.filter(r => r.touch_status === 'New' && r.scanned_by_user_id === me?.id)].filter(r => !queuedSubmitIds.has(r.id))

  const where = whereIs(asset)
  const Changed = ({ k }) => changed(k) ? <span className="tag tag-orange" style={{ marginLeft: 6 }}>changed</span> : null

  return (
    <>
      {!field && <Topbar title="Scan / Asset Touch" sub={`Bay scan + COM asset touch · you ${num(stats.today)} today · all teams ${num(stats.all)}`}
        actions={<>
          <Link className="btn btn-ghost btn-sm" to="/scan/report" title="Assets scanned by warehouse — COM + CoolerCo">📊 Scan report</Link>
          <a className="btn btn-ghost btn-sm" href={SMARTSCAN_URL} target="_blank" rel="noopener noreferrer" title="COM scanning app">🔗 SmartScan ↗</a>
          <Link className="btn btn-ghost btn-sm" to="/scan/export">⬆ COM Touch sync</Link>
        </>} />}
      <div className="page-content">
        <div className="two-col">
          <div className="card" style={{ padding: 16 }}>
            <div className={`off-bar ${online ? '' : 'off'}`}>
              <span>{online ? '📶 Online' : '📵 No signal — scans are saved on this phone'}{field && used != null ? <small style={{ opacity: .7 }}> · 💾 {used} MB on phone</small> : null}</span>
              {queued.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => flushQueue()} disabled={!online}>⏳ {queued.length} waiting{online ? ' · send now' : ''}</button>}
              {wh && <button type="button" className="btn btn-ghost btn-sm" onClick={saveOffline} disabled={!online || saving !== null}
                title="Keep this warehouse's asset list on the phone for scanning without signal">
                {saving !== null ? `⬇ ${num(saving)}…` : saved ? `💾 ${num(saved.n)} saved ${new Date(saved.at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })} ↻` : `⬇ Save ${WH_NAMES[wh]} list for offline`}
              </button>}
            </div>
            <div className="seg" style={{ marginBottom: 10 }}>
              <button type="button" className={`seg-btn${mode === 'quick' ? ' on' : ''}`} onClick={() => { setMode('quick'); reset() }}>⚡ Quick scan</button>
              <button type="button" className={`seg-btn${mode === 'full' ? ' on' : ''}`} onClick={() => { setMode('full'); setQc(null) }}>📋 Full scan</button>
            </div>
            {mode === 'quick' ? (
              <>
                <details className="sec" open={!scanPlace}>
                  <summary>📍 Scanning in: {scanPlace ? <b>{scanPlace.label}{quickWs ? ' · Workshop' : ''}</b> : <span className="tag tag-orange">choose first</span>}</summary>
                  <div className="sec-body">
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <select className="field-ctrl" style={{ flex: 1, minWidth: 140 }} value={wh} onChange={e => { setWh(e.target.value); setScanLoc('') }}>
                        <option value="">🏢 Warehouse…</option>
                        {WAREHOUSES.map(w => <option key={w} value={w}>{WH_NAMES[w]}</option>)}
                      </select>
                      <div className="seg">
                        <button type="button" className={`seg-btn${!quickWs ? ' on' : ''}`} onClick={() => setQuickWs(false)}>🏬 WH</button>
                        <button type="button" className={`seg-btn${quickWs ? ' on' : ''}`} onClick={() => setQuickWs(true)}>🛠 WS</button>
                      </div>
                    </div>
                    <div className="bay-pick" style={{ marginTop: 8 }}>
                      {locs.filter(l => l.warehouse_code === wh).map(l => (
                        <button type="button" key={l.id} className={`bay-tile bay-pending${scanPlace?.id === l.id ? ' on' : ''}`} onClick={() => setScanLoc(l.id)}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><PlaceBadge area={quickWs ? 'WS' : l.area} size={16} />{l.building}{l.area !== 'MAIN' ? ` · ${l.area}` : ''}</span>
                        </button>))}
                    </div>
                  </div>
                </details>
                <form onSubmit={e => { e.preventDefault(); quickScan(code) }} className="scan-find">
                  <button type="button" className="btn btn-primary scan-cam-btn" disabled={!scanPlace} onClick={() => setCam(true)}>📷 Scan</button>
                  <div className="search-wrap">
                    <span className="ico">⌨</span>
                    <input ref={inputRef} autoFocus enterKeyHint="search" autoComplete="off" placeholder="or type / hand-scanner, then Enter" value={code} onChange={e => setCode(e.target.value)} />
                  </div>
                </form>
                {cam && <CameraScan continuous paused={qc?.status === 'wrong' || qc?.status === 'looking'} onClose={() => setCam(false)} onResult={quickScan}>
                  {qc && <QuickCard qc={qc} onAccept={() => quickSave(qc)} onSkip={() => setQc({ ...qc, status: 'skipped' })} onChange={() => openFull(qc)} dark />}
                </CameraScan>}
                {qc && <QuickCard qc={qc} onAccept={() => quickSave(qc)} onSkip={() => setQc({ ...qc, status: 'skipped' })} onChange={() => openFull(qc)} />}
                <PlaceLegend />
              </>
            ) : (<>
            <form onSubmit={lookup} className="scan-find">
              <button type="button" className="btn btn-primary scan-cam-btn" onClick={() => setCam(true)} title="Scan a QR code or barcode with the camera">📷 Scan</button>
              <div className="search-wrap">
                <span className="ico">⌨</span>
                <input ref={inputRef} autoFocus enterKeyHint="search" autoComplete="off" placeholder="or type / hand-scanner: barcode, local code, serial" value={code} onChange={e => setCode(e.target.value)} />
              </div>
              <button className="btn btn-ghost btn-sm" disabled={busy}>Find</button>
              {asset && <button type="button" className="btn btn-ghost btn-sm" onClick={reset} aria-label="Clear">✕</button>}
            </form>
            {cam && <CameraScan onClose={() => setCam(false)} onResult={txt => { setCam(false); lookup(null, txt) }} />}

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
            </>)}
            {msg && <div className={`form-msg ${msg.type}`} style={{ marginTop: 10 }}>{msg.text}</div>}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="seg">
                <button className={`seg-btn${scope === 'me' ? ' on' : ''}`} onClick={() => setScope('me')}>👤 Mine</button>
                <button className={`seg-btn${scope === 'wh' ? ' on' : ''}`} onClick={() => setScope('wh')} disabled={!wh}>🏢 {wh ? WH_NAMES[wh] : 'Warehouse'}</button>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {newOnes.length > 0 && <button className="btn btn-primary btn-sm" onClick={() => submit(newOnes.map(r => r.id))}>📤 Submit {newOnes.length} new</button>}
                {!field && <Link className="card-count" to="/scan/export">COM sync ›</Link>}
              </div>
            </div>
            {queuedTouches.length > 0 && (
              <div className="q-list">
                {queuedTouches.map(q => (
                  <div key={q.qid} className="q-row"><span className="mono">{q.label}</span><span className="text3">{new Date(q.at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className={`tag tag-${q.error ? 'red' : 'orange'}`} title={q.error || ''}>{q.error ? '⚠ not accepted' : '⏳ waiting to send'}</span></div>
                ))}
              </div>
            )}
            {!recent.length && !queuedTouches.length ? <div className="empty-state"><div className="empty-ico">📷</div><div>No scans yet</div></div> : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>When</th><th>Barcode</th><th>Area</th><th>Bay</th><th>📸</th><th>Status</th></tr></thead>
                  <tbody>{recent.map((r, i) => (
                    <tr key={i}>
                      <td className="text3">{fmt(r.created_at)}</td><td className="mono">{r.bar_code || r.asset_name}</td>
                      <td>{r.warehouse_name}{r.location_ok === false ? ' ⚠' : ''}</td>
                      <td>{BAYS.find(b => b.key === r.bay)?.icon} {r.bay}{r.bay_ok === false ? ' ⚠' : ''}</td>
                      <td>{r.photo_paths?.length || 0}</td>
                      <td>{r.touch_status === 'New'
                        ? (r.scanned_by_user_id === me?.id ? <button className="btn btn-ghost btn-sm" onClick={() => submit([r.id])}>📤 Submit</button> : <span className="tag tag-neutral" title={r.scanned_by}>New · {String(r.scanned_by || '').split('@')[0]}</span>)
                        : <span className={`tag tag-${r.touch_status === 'Synced' ? 'green' : 'blue'}`}>{r.touch_status}</span>}</td>
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

// The compact quick-scan card. Badge = where the asset IS now (the area it was just scanned in) · bay from its COM status.
function QuickCard({ qc, onAccept, onSkip, onChange, dark = false }) {
  if (qc.status === 'looking') return <div className={`quick-card${dark ? ' dark' : ''}`}><span className="spinner" /> Looking up {qc.code}…</div>
  if (qc.status === 'notfound') return <div className={`quick-card bad${dark ? ' dark' : ''}`}><b>❓ {qc.text}</b><div className="mono" style={{ fontSize: 11 }}>{String(qc.code).slice(0, 80)}</div></div>
  const a = qc.asset, bay = BAYS.find(b => b.key === qc.expBay)
  const wrong = qc.areaOk === false || qc.whOk === false
  const state = { saving: ['⏳', 'Saving…'], saved: ['✅', qc.accepted ? 'Saved — accepted in this place (exception)' : 'Saved'], queued: ['📵', 'Saved on this phone — sends by itself'],
    error: ['⚠', 'Not saved: ' + (qc.text || '')], wrong: ['⚠', 'Wrong place — accept here?'], skipped: ['⏭', 'Skipped — not saved'] }[qc.status] || ['', '']
  return (
    <div className={`quick-card${wrong && qc.status !== 'saved' ? ' bad' : wrong ? ' warn' : ' ok'}${dark ? ' dark' : ''}`}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <PlaceBadge area={qc.ws ? 'WS' : qc.place?.area} bay={qc.expBay} size={40} title="Where it is now" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="mono" style={{ fontWeight: 700, fontSize: 15 }}>{a.bar_code || a.name}</div>
          <div style={{ fontSize: 11 }}>Is in <b>{qc.place?.label}{qc.ws ? ' · WS' : ''}</b> · {bay ? `${bay.icon} ${bay.label}` : a.asset_status}</div>
        </div>
        <span style={{ fontSize: 20 }}>{state[0]}</span>
      </div>
      <div className="quick-grid">
        <div><span>SAP no.</span><b className="mono">{a.sap_number || '—'}</b></div>
        <div><span>COM location</span><b>{a.assign_account || a.points_of_sale || a.asset_location || '—'}</b></div>
        <div><span>Condition</span><b>{a.condition || '—'}</b></div>
        <div><span>Branding</span><b>{a.brand_hierarchy || '—'}</b></div>
      </div>
      {wrong && <div className="quick-wrong">
        {qc.whOk === false && (/^RTMA /i.test(a.assign_account || '')
          ? <div style={{ fontSize: 13 }}>⛔ <b>Wrong warehouse</b> — this asset belongs to <b>{String(a.assign_account).replace(/^RTMA\s+|\s+W[HS]$/gi, '')}</b> ({a.assign_account}).</div>
          : <div style={{ fontSize: 13 }}>⛔ <b>Not RTMA stock</b> — COM has it at <b>{a.points_of_sale || a.assign_account || a.asset_location || 'another location'}</b>.</div>)}
        {qc.areaOk === false && <div>⚠ By its status it belongs in <b>{qc.chk?.expected_location}</b>.</div>}
        {qc.chk?.scanned_location && <div className="text3">Last CoolerCo scan: {qc.chk.scanned_location}</div>}
      </div>}
      <div style={{ fontSize: 11, marginTop: 4 }}>{state[1]}</div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        {qc.status === 'wrong' && <><button type="button" className="btn btn-primary btn-sm" onClick={onAccept}>✓ Accept here</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onSkip}>Skip</button></>}
        {['saved', 'queued', 'wrong', 'skipped', 'error'].includes(qc.status) && <button type="button" className="btn btn-ghost btn-sm" onClick={onChange}>✏️ Change</button>}
      </div>
    </div>
  )
}
