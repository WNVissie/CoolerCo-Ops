import { useState, useEffect, useMemo } from 'react'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { num, WAREHOUSES, WH_NAMES, ASSET_STATUSES, CONDITIONS, AREAS } from '../lib/helpers'

// Admin setup: warehouse buildings/areas + their "what belongs here" rules,
// and the interim product families. Both live in CoolerCo's own tables.
export default function Setup() {
  const [user, setUser] = useState(null)
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUser(data.user)) }, [])
  return (
    <>
      <Topbar title="Setup" sub="Warehouse locations · product families · tracking" />
      <div className="page-content">
        <details className="sec" open>
          <summary>🏠 Warehouse buildings, areas & rules</summary>
          <div className="sec-body"><Locations by={user?.email} /></div>
        </details>
        <details className="sec">
          <summary>🛍️ Portal catalogue (what customers can request)</summary>
          <div className="sec-body"><PortalCatalogue by={user?.email} /></div>
        </details>
        <details className="sec">
          <summary>🧬 Product families (interim, until COM has one base per product)</summary>
          <div className="sec-body"><Families by={user?.email} /></div>
        </details>
        <details className="sec">
          <summary>📡 Tracking (GPS of drivers and technicians)</summary>
          <div className="sec-body"><Tracking /></div>
        </details>
      </div>
    </>
  )
}

function Multi({ options, value, onChange }) {
  const v = value || []
  return (
    <div className="chip-pick">
      {options.map(o => (
        <button type="button" key={o} className={`chip-opt${v.includes(o) ? ' on' : ''}`}
          onClick={() => onChange(v.includes(o) ? v.filter(x => x !== o) : [...v, o])}>{o}</button>
      ))}
    </div>
  )
}

const ruleText = r => [
  r.match_statuses?.length ? `Status: ${r.match_statuses.join(', ')}` : 'Any status',
  r.match_conditions?.length ? `Condition: ${r.match_conditions.join(', ')}` : null,
  r.exclude_conditions?.length ? `Not: ${r.exclude_conditions.join(', ')}` : null,
].filter(Boolean).join(' · ')

function Locations({ by }) {
  const [locs, setLocs] = useState([])
  const [rules, setRules] = useState([])
  const [msg, setMsg] = useState(null)
  const [newLoc, setNewLoc] = useState(null)
  const [newRule, setNewRule] = useState(null) // { location_id, ... }

  async function load() {
    const [l, r] = await Promise.all([
      supabase.from('coolerco_wh_locations').select('*').order('warehouse_code').order('sort_order'),
      supabase.from('coolerco_wh_location_rules').select('*').order('priority'),
    ])
    setLocs(l.data || []); setRules(r.data || [])
    if (l.error || r.error) setMsg({ type: 'err', text: (l.error || r.error).message })
  }
  useEffect(() => { load() }, [])

  async function save(table, op) {
    const { error } = await op(supabase.from(table))
    setMsg(error ? { type: 'err', text: error.message } : { type: 'ok', text: '✓ Saved' })
    if (!error) load()
    return !error
  }

  return (
    <div>
      <div className="notice">The first matching rule (lowest priority number) decides where an asset <strong>should</strong> be. Scans in another place are flagged on Location Check.</div>
      {WAREHOUSES.map(code => {
        const list = locs.filter(l => l.warehouse_code === code)
        return (
          <div key={code} className="card" style={{ padding: 12, marginBottom: 10 }}>
            <div className="card-title" style={{ marginBottom: 8 }}>🏢 {WH_NAMES[code]}</div>
            {list.map(l => (
              <div key={l.id} className={`loc-row${l.active ? '' : ' off'}`}>
                <div className="loc-hd">
                  <strong>{l.building}</strong> <span className="tag tag-blue">{l.area}</span>
                  {l.is_picking && <span className="tag tag-green">📦 picking</span>}
                  {!l.active && <span className="tag tag-neutral">inactive</span>}
                  <span className="text3" style={{ fontSize: 10.5 }}>{l.notes}</span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setNewRule({ location_id: l.id, priority: 50, match_statuses: [], match_conditions: [], exclude_conditions: [] })}>＋ Rule</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => save('coolerco_wh_locations', t => t.update({ active: !l.active, updated_by: by, updated_at: new Date().toISOString() }).eq('id', l.id))}>{l.active ? 'Deactivate' : 'Activate'}</button>
                  </span>
                </div>
                {rules.filter(r => r.location_id === l.id).map(r => (
                  <div key={r.id} className={`rule-row${r.active ? '' : ' off'}`}>
                    <span className="mono" style={{ fontSize: 10.5 }}>#{r.priority}</span>
                    <span>{ruleText(r)}</span>
                    <button className="linkish" style={{ marginLeft: 'auto' }} onClick={() => save('coolerco_wh_location_rules', t => t.update({ active: !r.active }).eq('id', r.id))}>{r.active ? 'Turn off' : 'Turn on'}</button>
                  </div>
                ))}
                {newRule?.location_id === l.id && (
                  <div className="rule-form">
                    <label>Priority <input type="number" value={newRule.priority} onChange={e => setNewRule({ ...newRule, priority: +e.target.value })} style={{ width: 70 }} /></label>
                    <div className="lbl">Statuses (none = any)</div>
                    <Multi options={ASSET_STATUSES} value={newRule.match_statuses} onChange={v => setNewRule({ ...newRule, match_statuses: v })} />
                    <div className="lbl">Only these conditions (none = any)</div>
                    <Multi options={CONDITIONS} value={newRule.match_conditions} onChange={v => setNewRule({ ...newRule, match_conditions: v })} />
                    <div className="lbl">Never these conditions</div>
                    <Multi options={CONDITIONS} value={newRule.exclude_conditions} onChange={v => setNewRule({ ...newRule, exclude_conditions: v })} />
                    <div className="modal-btns">
                      <button className="btn btn-ghost btn-sm" onClick={() => setNewRule(null)}>Cancel</button>
                      <button className="btn btn-primary btn-sm" onClick={async () => {
                        const n = newRule, nz = a => (a && a.length ? a : null)
                        if (await save('coolerco_wh_location_rules', t => t.insert({ location_id: n.location_id, priority: n.priority, match_statuses: nz(n.match_statuses), match_conditions: nz(n.match_conditions), exclude_conditions: nz(n.exclude_conditions) }))) setNewRule(null)
                      }}>Save rule</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {newLoc?.warehouse_code === code ? (
              <div className="rule-form">
                <div className="sp-more" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
                  <label><span>Building</span><input value={newLoc.building} onChange={e => setNewLoc({ ...newLoc, building: e.target.value })} placeholder="e.g. Main WH" /></label>
                  <label><span>Area</span><select value={newLoc.area} onChange={e => setNewLoc({ ...newLoc, area: e.target.value })}>{AREAS.map(a => <option key={a}>{a}</option>)}</select></label>
                  <label><span>Picking here?</span><select value={newLoc.is_picking ? 'y' : 'n'} onChange={e => setNewLoc({ ...newLoc, is_picking: e.target.value === 'y' })}><option value="n">No</option><option value="y">Yes</option></select></label>
                  <label><span>Notes</span><input value={newLoc.notes} onChange={e => setNewLoc({ ...newLoc, notes: e.target.value })} /></label>
                </div>
                <div className="modal-btns">
                  <button className="btn btn-ghost btn-sm" onClick={() => setNewLoc(null)}>Cancel</button>
                  <button className="btn btn-primary btn-sm" disabled={!newLoc.building.trim()} onClick={async () => {
                    const n = newLoc
                    if (await save('coolerco_wh_locations', t => t.insert({ ...n, building: n.building.trim(), label: `${WH_NAMES[code]} · ${n.building.trim()}${n.area !== 'MAIN' ? ` (${n.area})` : ''}`, updated_by: by }))) setNewLoc(null)
                  }}>Add</button>
                </div>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => setNewLoc({ warehouse_code: code, building: '', area: 'BAU', is_picking: false, notes: '' })}>＋ Building / area</button>
            )}
          </div>
        )
      })}
      {msg && <div className={`form-msg ${msg.type}`}>{msg.text}</div>}
    </div>
  )
}

function Families({ by }) {
  const [fams, setFams] = useState([])
  const [links, setLinks] = useState([])
  const [q, setQ] = useState('')
  const [newName, setNewName] = useState('')
  const [msg, setMsg] = useState(null)

  async function load() {
    const [f, l] = await Promise.all([
      supabase.from('coolerco_product_families').select('*').order('name'),
      supabase.from('coolerco_product_base_family').select('*'),
    ])
    setFams(f.data || []); setLinks(l.data || [])
  }
  useEffect(() => { load() }, [])

  const grouped = useMemo(() => {
    const s = q.trim().toLowerCase()
    return fams.map(f => ({ ...f, bases: links.filter(l => l.family_id === f.id).map(l => l.product_base) }))
      .filter(f => !s || f.name.toLowerCase().includes(s) || f.bases.some(b => b.toLowerCase().includes(s)))
  }, [fams, links, q])

  async function moveBase(base, familyId) {
    const { error } = await supabase.from('coolerco_product_base_family').update({ family_id: familyId, updated_by: by, updated_at: new Date().toISOString() }).eq('product_base', base)
    setMsg(error ? { type: 'err', text: error.message } : { type: 'ok', text: `✓ ${base} moved` }); if (!error) load()
  }
  async function addFamily() {
    const name = newName.trim().toUpperCase(); if (!name) return
    const { error } = await supabase.from('coolerco_product_families').insert({ name, updated_by: by })
    setMsg(error ? { type: 'err', text: error.message } : { type: 'ok', text: `✓ Family ${name} added` }); if (!error) { setNewName(''); load() }
  }
  async function rename(f) {
    const name = window.prompt('New family name', f.name); if (!name || name === f.name) return
    const { error } = await supabase.from('coolerco_product_families').update({ name: name.trim().toUpperCase(), updated_by: by, updated_at: new Date().toISOString() }).eq('id', f.id)
    setMsg(error ? { type: 'err', text: error.message } : { type: 'ok', text: '✓ Renamed' }); if (!error) load()
  }

  return (
    <div>
      <div className="notice">A delivered asset may replace the requested one only if both bases are in the <strong>same family</strong>. Move a base into another family to merge them.</div>
      <div className="filters">
        <div className="search-wrap" style={{ flex: 1 }}><span className="ico">🔍</span><input placeholder="Search family or base…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <input className="field-ctrl" style={{ maxWidth: 200 }} placeholder="New family name" value={newName} onChange={e => setNewName(e.target.value)} />
        <button className="btn btn-primary btn-sm" onClick={addFamily}>＋ Family</button>
      </div>
      <div className="text3" style={{ fontSize: 11, marginBottom: 8 }}>{num(fams.length)} families · {num(links.length)} product bases</div>
      <div className="fam-grid">
        {grouped.map(f => (
          <div key={f.id} className="card" style={{ padding: 10 }}>
            <div className="loc-hd"><strong>{f.name}</strong><span className="tag tag-neutral">{f.bases.length}</span>
              <button className="linkish" style={{ marginLeft: 'auto' }} onClick={() => rename(f)}>Rename</button></div>
            {f.bases.map(b => (
              <div key={b} className="mini-row" style={{ alignItems: 'center' }}>
                <span className="mono" style={{ fontSize: 10.5 }}>{b}</span>
                <select style={{ maxWidth: 130, fontSize: 10.5 }} value={f.id} onChange={e => moveBase(b, e.target.value)}>
                  {fams.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </div>
            ))}
            {!f.bases.length && <div className="text3" style={{ fontSize: 10.5 }}>Empty</div>}
          </div>
        ))}
      </div>
      {msg && <div className={`form-msg ${msg.type}`}>{msg.text}</div>}
    </div>
  )
}

export function PortalCatalogue({ by }) {
  const [fams, setFams] = useState([])
  const [mode, setMode] = useState('all')
  const [urls, setUrls] = useState({})
  const [q, setQ] = useState('')
  const [onlyOn, setOnlyOn] = useState(true)
  const [msg, setMsg] = useState(null)

  async function load() {
    const [f, m] = await Promise.all([
      supabase.from('coolerco_product_families').select('*').order('sort_order').order('name'),
      supabase.from('coolerco_settings').select('value').eq('key', 'portal_catalogue_mode').maybeSingle(),
    ])
    setFams(f.data || []); setMode(m.data?.value || 'all')
    const paths = (f.data || []).map(x => x.photo_path).filter(Boolean)
    if (paths.length) {
      const { data } = await supabase.storage.from('coolerco-cases').createSignedUrls(paths, 3600)
      setUrls(Object.fromEntries((data || []).filter(u => u.signedUrl).map(u => [u.path, u.signedUrl])))
    }
  }
  useEffect(() => { load() }, [])

  async function patch(f, change) {
    const { error } = await supabase.from('coolerco_product_families').update({ ...change, updated_by: by, updated_at: new Date().toISOString() }).eq('id', f.id)
    setMsg(error ? { type: 'err', text: error.message } : { type: 'ok', text: '✓ Saved' }); if (!error) load()
  }
  async function setCatalogueMode(v) {
    const { error } = await supabase.from('coolerco_settings').update({ value: v, updated_by: by, updated_at: new Date().toISOString() }).eq('key', 'portal_catalogue_mode')
    if (!error) setMode(v)
  }
  async function upload(f, file) {
    const path = `catalogue/${f.id}-${Date.now()}.jpg`
    const { error } = await supabase.storage.from('coolerco-cases').upload(path, file, { contentType: file.type || 'image/jpeg' })
    if (error) { setMsg({ type: 'err', text: error.message }); return }
    patch(f, { photo_path: path })
  }

  const list = fams.filter(f => (!onlyOn || f.show_in_portal) && (!q || (f.name + ' ' + (f.display_name || '')).toLowerCase().includes(q.toLowerCase())))
  return (
    <div>
      <div className="notice">Customers see <strong>families only</strong> — never stock levels. Tick which families appear on the portal; add a photo and a friendly name.</div>
      <div className="filters">
        <div className="seg">
          {[['all', '📚 Show all ticked families'], ['available', '🟢 Only families in stock at the store\'s warehouse']].map(([k, l]) => (
            <button key={k} className={`seg-btn${mode === k ? ' on' : ''}`} onClick={() => setCatalogueMode(k)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="filters">
        <div className="search-wrap" style={{ flex: 1 }}><span className="ico">🔍</span><input placeholder="Search family…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <label style={{ fontSize: 11.5, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={onlyOn} onChange={e => setOnlyOn(e.target.checked)} /> only shown on portal</label>
      </div>
      <div className="fam-grid">
        {list.map(f => (
          <div key={f.id} className="card" style={{ padding: 10, display: 'flex', gap: 10 }}>
            <label className="cat-photo" title="Upload photo">
              {urls[f.photo_path] ? <img src={urls[f.photo_path]} alt="" /> : <span>🧊<small>photo</small></span>}
              <input type="file" accept="image/*" hidden onChange={e => e.target.files[0] && upload(f, e.target.files[0])} />
            </label>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="loc-hd"><strong className="trunc">{f.name}</strong>
                <label style={{ marginLeft: 'auto', fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input type="checkbox" checked={f.show_in_portal} onChange={e => patch(f, { show_in_portal: e.target.checked })} /> portal</label></div>
              <input className="field-ctrl" style={{ marginTop: 6, fontSize: 11.5 }} placeholder="Display name" defaultValue={f.display_name || ''} onBlur={e => e.target.value !== (f.display_name || '') && patch(f, { display_name: e.target.value || null })} />
              <input className="field-ctrl" style={{ marginTop: 4, fontSize: 11.5 }} placeholder="Short description (type, size)" defaultValue={f.description || ''} onBlur={e => e.target.value !== (f.description || '') && patch(f, { description: e.target.value || null })} />
            </div>
          </div>
        ))}
      </div>
      {msg && <div className={`form-msg ${msg.type}`}>{msg.text}</div>}
    </div>
  )
}

// ── 📡 Tracking: on/off switches for GPS tracking (script 029; SMART Track 001 + 002) ──
// SMART Track lives in this database, so its switches are set here too. RouteIQ has its own page.
const ROUTEIQ_TRACKING_URL = 'https://smartroutertma.netlify.app/smart-track-settings.html'
const LABELS = {
  smart_track_enabled: 'SMART Track for the whole company',
  smart_track_field_app: 'SMART Track: Field app',
  smart_track_tripsheet: 'SMART Track: WhatsApp trip sheets',
  field_app_tracking: 'CoolerCo Field app tracking',
  smart_track_company: 'SMART Track company',
}

function OnOff({ on, disabled, onChange }) {
  return (
    <div className="seg" style={{ flexShrink: 0 }}>
      <button type="button" className={`seg-btn${on ? ' on' : ''}`} disabled={disabled || on} onClick={() => onChange(true)}>On</button>
      <button type="button" className={`seg-btn${!on ? ' on' : ''}`} disabled={disabled || !on} onClick={() => onChange(false)}>Off</button>
    </div>
  )
}

function SwitchRow({ title, help, on, disabled, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 12.5 }}>{on ? '🟢' : '⚪'} {title}</div>
        <div className="text3" style={{ fontSize: 11.5 }}>{help}</div>
      </div>
      <OnOff on={on} disabled={disabled} onChange={onChange} />
    </div>
  )
}

export function Tracking() {
  const [s, setS] = useState(null)
  const [problem, setProblem] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [newKey, setNewKey] = useState(null)

  async function load() {
    const { data, error } = await supabase.rpc('coolerco_tracking_settings')
    if (error) {
      setProblem(/could not find|schema cache|does not exist/i.test(error.message)
        ? 'Tracking settings are not installed in this database yet (script 029).'
        : error.message)
      return
    }
    setProblem(null); setS(data)
  }
  useEffect(() => { load() }, [])

  async function flip(setting, on) {
    if (!window.confirm(`Turn ${LABELS[setting]} ${on ? 'ON' : 'OFF'}?\n\nThis takes effect within 3 minutes on every phone. The change is logged with your name.`)) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('coolerco_tracking_set', { p_setting: setting, p_on: on })
    setBusy(false)
    if (error) { setMsg({ type: 'err', text: error.message }); return }
    setS(data); setMsg({ type: 'ok', text: `✓ ${LABELS[setting]} is now ${on ? 'on' : 'off'}` })
  }

  async function createCompany() {
    if (!window.confirm('Create the SMART Track company and its server key?\n\nThe key is shown ONCE. Copy it straight into RouteIQ\'s Netlify settings as SMART_TRACK_KEY.')) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('coolerco_tracking_create_company')
    setBusy(false)
    if (error) { setMsg({ type: 'err', text: error.message }); return }
    setNewKey(data.server_key); load()
  }

  if (problem) return <div className="notice">⚠️ {problem}</div>
  if (!s) return <div className="text3">Loading…</div>
  const st = s.smart_track, sw = st.switches, can = s.can_change && !busy
  const fieldPath = [['SMART Track company', sw.enabled], ['SMART Track Field app', sw.field_app], ['CoolerCo Field app', s.field_app_tracking]]
  const tripPath = [['SMART Track company', sw.enabled], ['SMART Track trip sheets', sw.tripsheet]]
  const offAt = path => path.filter(([, on]) => !on).map(([name]) => name)
  const status = (path, also) => offAt(path).length
    ? <span>⚪ <strong>Off</strong> — switched off at: {offAt(path).join(', ')}</span>
    : <span>🟢 <strong>On here</strong> — runs when {also} is also on in RouteIQ</span>

  return (
    <div>
      <div className="notice">
        Tracking runs only when <strong>every</strong> switch on its path is on, so any one switch stops it.
        Changes reach phones within 3 minutes and keep the history already recorded.
        {!s.can_change && <> You can look, but only a system administrator can change these.</>}
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 12, display: 'grid', gap: 4 }}>
          <div>📱 <strong>Field app</strong> (RTMA drivers and technicians): {status(fieldPath, 'the RouteIQ switch')}</div>
          <div>💬 <strong>WhatsApp trip sheets</strong> (contractors): {status(tripPath, 'RouteIQ and its trip-sheet switch')}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 10 }}>
        <strong>🛰️ SMART Track</strong> <span className="text3" style={{ fontSize: 11.5 }}>· the tracking service · company “{st.company_code}”</span>
        {!st.installed && <div className="notice" style={{ marginTop: 8 }}>SMART Track is not installed in this database.</div>}
        {st.installed && !st.switches_ready && <div className="notice" style={{ marginTop: 8 }}>Run <code>smart_track_002_switches.sql</code> to enable these switches.</div>}
        {st.installed && !st.company_exists && (
          <div style={{ marginTop: 8 }}>
            <div className="text3" style={{ fontSize: 11.5, marginBottom: 6 }}>The company has not been set up in SMART Track yet. Setting it up creates the server key RouteIQ needs.</div>
            <button className="btn btn-primary btn-sm" disabled={!can} onClick={createCompany}>➕ Set up SMART Track company</button>
          </div>
        )}
        {newKey && (
          <div className="notice" style={{ marginTop: 8, borderColor: 'var(--red)' }}>
            <strong>Server key — shown once.</strong> Copy it now into RouteIQ's Netlify environment settings as <code>SMART_TRACK_KEY</code>. Do not share it.
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input className="field-ctrl" readOnly value={newKey} style={{ flex: 1, fontFamily: 'monospace', fontSize: 11 }} onFocus={e => e.target.select()} />
              <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(newKey)}>📋 Copy</button>
              <button className="btn btn-sm" onClick={() => setNewKey(null)}>Done</button>
            </div>
          </div>
        )}
        {st.company_exists && st.switches_ready && (
          <div style={{ marginTop: 6 }}>
            <SwitchRow title="Whole company" help="Master switch: off stops all tracking in every app." on={sw.enabled} disabled={!can} onChange={v => flip('smart_track_enabled', v)} />
            <SwitchRow title="Field app" help="Positions from the CoolerCo Field app." on={sw.field_app} disabled={!can} onChange={v => flip('smart_track_field_app', v)} />
            <SwitchRow title="WhatsApp trip sheets" help="Positions from RouteIQ trip sheets (contractors); only while the sheet is open." on={sw.tripsheet} disabled={!can} onChange={v => flip('smart_track_tripsheet', v)} />
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 10 }}>
        <strong>📲 CoolerCo-Ops</strong>
        <SwitchRow title="Track drivers and technicians in the Field app" help="Off: the Field app does not ask for location or send positions." on={s.field_app_tracking} disabled={!can} onChange={v => flip('field_app_tracking', v)} />
      </div>

      <div className="card" style={{ padding: 12, marginBottom: 10 }}>
        <strong>🗺️ RouteIQ</strong>
        <div className="text3" style={{ fontSize: 11.5, margin: '6px 0' }}>RouteIQ's own switch (sending routes and taps, and trip-sheet tracking) is set on RouteIQ, because it runs on the production database.</div>
        <a className="btn btn-sm" href={ROUTEIQ_TRACKING_URL} target="_blank" rel="noopener noreferrer">Open RouteIQ tracking settings ↗</a>
      </div>

      {s.log?.length > 0 && (
        <details className="sec">
          <summary>🧾 Recent changes</summary>
          <div className="sec-body">
            <div style={{ overflowX: 'auto' }}><table className="tbl" style={{ fontSize: 11.5 }}>
              <thead><tr><th>When</th><th>Who</th><th>Setting</th><th>Now</th></tr></thead>
              <tbody>{s.log.map((l, i) => (
                <tr key={i}><td>{new Date(l.at).toLocaleString('en-ZA')}</td><td>{l.by || '—'}</td><td>{LABELS[l.setting] || l.setting}</td>
                  <td>{l.value === null || l.value === undefined ? (l.note || '') : (l.value ? 'On' : 'Off')}</td></tr>
              ))}</tbody>
            </table></div>
          </div>
        </details>
      )}
      {msg && <div className={`form-msg ${msg.type}`}>{msg.text}</div>}
    </div>
  )
}
