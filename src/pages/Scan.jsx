import { useState, useEffect, useRef } from 'react'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { fmt, num, BAYS, WAREHOUSES, WH_NAMES, bayForStatus, condColor } from '../lib/helpers'
import { whereIs } from './Assets'

// Daily CoolerCo bay scans → public.coolerco_asset_touch (adds rows only).
// Separate from COM's monthly asset_touch; the two are compared at month-end.
const SCAN_BAYS = BAYS.filter(b => ['RED', 'ORANGE', 'GREEN', 'YELLOW', 'SCRAP'].includes(b.key))
const SCAN_TYPES = [['receive', '📥 Received'], ['move', '🔀 Moved bay'], ['count', '🔢 Stock count'], ['dispatch', '📤 Dispatched']]
const TENANT = 'tenant_coolerco'

export default function Scan() {
  const [code, setCode] = useState('')
  const [asset, setAsset] = useState(null)
  const [wh, setWh] = useState(() => { try { return localStorage.getItem('cc_scan_wh') || '' } catch { return '' } })
  const [bay, setBay] = useState('')
  const [type, setType] = useState('count')
  const [notes, setNotes] = useState('')
  const [recent, setRecent] = useState([])
  const [stats, setStats] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const inputRef = useRef(null)

  const [whs, setWhs] = useState([])
  const [locs, setLocs] = useState([])
  const [locId, setLocId] = useState('')
  const [expected, setExpected] = useState(null)

  useEffect(() => {
    loadRecent()
    Promise.all([
      supabase.from('warehouses').select('id,code,name').eq('warehouse_type', 'regional').in('code', WAREHOUSES),
      supabase.from('coolerco_wh_locations').select('id,warehouse_code,building,area,label').eq('active', true).order('sort_order'),
    ]).then(([w, l]) => { setWhs(w.data || []); setLocs(l.data || []) })
  }, [])
  useEffect(() => { try { wh && localStorage.setItem('cc_scan_wh', wh) } catch { /* ignore */ } }, [wh])

  async function loadRecent() {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const [list, today] = await Promise.all([
      supabase.from('coolerco_asset_touch').select('created_at,bar_code,asset_name,warehouse_name,bay,scan_type,scanned_by')
        .order('created_at', { ascending: false }).limit(15),
      supabase.from('coolerco_asset_touch').select('id', { count: 'exact', head: true }).gte('created_at', start.toISOString()),
    ])
    setRecent(list.data || []); setStats({ today: today.count })
  }

  async function lookup(e) {
    e?.preventDefault()
    const s = code.trim().replace(/[,()]/g, ' ')
    if (!s) return
    setBusy(true); setMsg(null); setAsset(null)
    const { data } = await supabase.from('assets_live')
      .select('name,bar_code,local_code,asset_type,product_base,condition,asset_status,asset_location,assign_account,points_of_sale')
      .or(`bar_code.eq.${s},local_code.eq.${s},name.eq.${s}`).limit(1)
    setBusy(false)
    const a = data?.[0]
    if (!a) { setMsg({ type: 'err', text: `"${s}" was not found in the asset register.` }); return }
    setAsset(a)
    // Suggest the bay from the asset's COM status
    const suggested = bayForStatus(a.asset_status)
    setBay(SCAN_BAYS.some(b => b.key === suggested) ? suggested : 'RED')
    // Where SHOULD it be? (server-side rule) — pre-select it
    const { data: chk } = await supabase.from('coolerco_asset_location_check')
      .select('warehouse_code,expected_location_id,expected_location').eq('name', a.name).maybeSingle()
    setExpected(chk || null)
    if (chk?.warehouse_code) setWh(chk.warehouse_code)
    if (chk?.expected_location_id) setLocId(chk.expected_location_id)
  }

  async function save() {
    const whRow = whs.find(w => w.code === wh)
    if (!asset || !whRow || !bay || !locId) { setMsg({ type: 'warn', text: 'Choose a warehouse, building/area and bay first.' }); return }
    const loc = locs.find(l => l.id === locId)
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('coolerco_asset_touch').insert({
      tenant_id: TENANT,
      bar_code: asset.bar_code, local_code: asset.local_code, asset_name: asset.name,
      warehouse_id: whRow.id, warehouse_name: loc?.label || WH_NAMES[wh], location_id: locId, bay, scan_type: type,
      scanned_by: user?.email || 'ops-hub', scanned_by_user_id: user?.id || null,
      notes: notes || null,
    })
    setBusy(false)
    if (error) { setMsg({ type: 'err', text: 'Could not save the scan: ' + error.message }); return }
    const wrong = expected?.expected_location_id && expected.expected_location_id !== locId
    setMsg({ type: wrong ? 'warn' : 'ok', text: `✓ ${asset.bar_code || asset.name} logged in ${loc?.label} · ${BAYS.find(b => b.key === bay)?.label}${wrong ? ` — ⚠ should be in ${expected.expected_location}` : ''}` })
    setAsset(null); setCode(''); setNotes(''); setExpected(null); loadRecent()
    inputRef.current?.focus()
  }

  const where = whereIs(asset)

  return (
    <>
      <Topbar title="Scan / Bay Touch" sub={`Daily bay scans · ${num(stats.today)} today`} />
      <div className="page-content">
        <div className="two-col">
          <div className="card" style={{ padding: 16 }}>
            <form onSubmit={lookup} className="filters" style={{ marginBottom: 12 }}>
              <div className="search-wrap" style={{ flex: 1 }}>
                <span className="ico">📷</span>
                <input ref={inputRef} autoFocus inputMode="numeric" placeholder="Scan or type barcode / local code" value={code} onChange={e => setCode(e.target.value)} />
              </div>
              <button className="btn btn-primary btn-sm" disabled={busy}>Find</button>
            </form>

            {asset && (
              <>
                <div className={`where-box ${where.rtma ? 'rtma' : ''}`}>
                  <div style={{ fontSize: 22 }}>{where.icon}</div>
                  <div>
                    <div style={{ fontWeight: 600 }} className="mono">{asset.bar_code} · {asset.local_code}</div>
                    <div className="text3" style={{ fontSize: 11 }}>{asset.product_base} · {asset.asset_type}</div>
                    <div style={{ fontSize: 11.5 }}>COM says: {where.text}</div>
                  </div>
                </div>
                <div className="chip-row">
                  {asset.condition && <span className={`tag tag-${condColor(asset.condition)}`}>{asset.condition}</span>}
                  <span className="tag tag-neutral">{asset.asset_status}</span>
                  {!where.rtma && <span className="tag tag-orange">⚠ Not in RTMA stock per COM</span>}
                </div>

                <div className="field-lbl">🏢 Warehouse</div>
                <select className="field-ctrl" value={wh} onChange={e => { setWh(e.target.value); setLocId('') }}>
                  <option value="">Choose…</option>
                  {WAREHOUSES.map(w => <option key={w} value={w}>{WH_NAMES[w]}</option>)}
                </select>

                <div className="field-lbl" style={{ marginTop: 10 }}>🏠 Building / area</div>
                <div className="bay-pick">
                  {locs.filter(l => l.warehouse_code === wh).map(l => (
                    <button type="button" key={l.id} className={`bay-tile bay-pending${locId === l.id ? ' on' : ''}`} onClick={() => setLocId(l.id)}>
                      <span>{l.building}{l.area !== 'MAIN' ? ` · ${l.area}` : ''}</span>
                      {expected?.expected_location_id === l.id && <strong title="Where this asset should be">★</strong>}
                    </button>
                  ))}
                </div>
                {expected?.expected_location && <div className="text3" style={{ fontSize: 10.5, marginTop: 4 }}>★ Should be in: {expected.expected_location}</div>}

                <div className="field-lbl" style={{ marginTop: 10 }}>🎨 Bay</div>
                <div className="bay-pick">
                  {SCAN_BAYS.map(b => (
                    <button type="button" key={b.key} className={`bay-tile bay-${b.key.toLowerCase()}${bay === b.key ? ' on' : ''}`} onClick={() => setBay(b.key)}>
                      <span>{b.icon} {b.label}</span>
                    </button>
                  ))}
                </div>

                <div className="field-lbl" style={{ marginTop: 10 }}>Scan type</div>
                <div className="seg">
                  {SCAN_TYPES.map(([k, l]) => <button type="button" key={k} className={`seg-btn${type === k ? ' on' : ''}`} onClick={() => setType(k)}>{l}</button>)}
                </div>
                <input className="field-ctrl" style={{ marginTop: 10 }} placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
                <button className="btn btn-primary" style={{ marginTop: 12, width: '100%' }} onClick={save} disabled={busy}>✓ Save scan</button>
              </>
            )}
            {msg && <div className={`form-msg ${msg.type}`} style={{ marginTop: 10 }}>{msg.text}</div>}
          </div>

          <div className="card">
            <div className="card-header"><span className="card-title">🕒 Recent scans</span></div>
            {!recent.length ? <div className="empty-state"><div className="empty-ico">📷</div><div>No bay scans yet</div></div> : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>When</th><th>Barcode</th><th>WH</th><th>Bay</th><th>Type</th></tr></thead>
                  <tbody>{recent.map((r, i) => (
                    <tr key={i}><td className="text3">{fmt(r.created_at)}</td><td className="mono">{r.bar_code || r.asset_name}</td><td>{r.warehouse_name}</td>
                      <td>{BAYS.find(b => b.key === r.bay)?.icon} {r.bay}</td><td>{r.scan_type}</td></tr>
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
