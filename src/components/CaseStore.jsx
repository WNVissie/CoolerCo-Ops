import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// 🏪 The store (outlet) on a case — shown in every case drawer under the case actions.
//   • Store name, full address, contact, 🗺 View on map, 📂 all cases of this store
//   • ✏️ Update store details (incl. GPS: paste a Google Maps link / coordinates, or 📱 use my location)
//       Tiger / Demo (self-managed): saved straight away on the outlet + its open cases, logged (script 055)
//       Magnum (COM is master): goes to the outlet-correction review list (033); COM keeps the old details until fixed there
//   • 💬 Send portal link by WhatsApp: the store's own secure link (/p/…) so the customer logs and follows requests
const inSA = (lat, lng) => lat >= -35.5 && lat <= -21.5 && lng >= 16 && lng <= 33.5
const mapLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
export function parseGps(text) {
  const t = (text || '').trim()
  const m = t.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || t.match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || t.match(/^(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1]), lng = Number(m[2])
  return inSA(lat, lng) ? { lat, lng } : { lat, lng, outside: true }
}
const waNumber = n => { const d = String(n || '').replace(/\D/g, ''); return !d ? '' : d.startsWith('0') ? '27' + d.slice(1) : d }
const ERR = {
  not_allowed: 'Your user may not change store details (supervisors, planners and admins can).',
  com_master: 'Magnum stores are kept in COM — your change goes to the review list instead.',
  name_required: 'The store name cannot be empty.',
  bad_gps: 'That GPS point is not in South Africa.',
  not_found: 'Store not found in the register.',
  sign_in: 'Please sign in again.',
}
const FIELDS = [['name', 'Store name'], ['contact_person', 'Contact person'], ['mobile_number', 'Mobile (WhatsApp)'], ['email', 'Email'],
  ['street_address', 'Street'], ['suburb', 'Suburb'], ['town', 'Town'], ['province', 'Province'], ['postal_code', 'Postal code']]

export default function CaseStore({ caseNumber }) {
  const [c, setC] = useState(null)          // the case row (coolerco_all_cases)
  const [outlet, setOutlet] = useState(null) // register row for self-managed clients
  const [edit, setEdit] = useState(false)
  const [form, setForm] = useState({})
  const [gpsText, setGpsText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [wa, setWa] = useState(null)        // { url, number, name }

  const load = async () => {
    const { data } = await supabase.from('coolerco_all_cases')
      .select('case_number,source,client_code,point_of_sale,pos_local_code,address,latitude,longitude,case_contact_name,case_contact_number,case_mobile_number')
      .eq('case_number', caseNumber).maybeSingle()
    setC(data || null)
    if (data && data.client_code !== 'MAGNUM' && data.pos_local_code) {
      const { data: o } = await supabase.from('coolerco_outlets').select('*').eq('client_code', data.client_code).eq('outlet_code', data.pos_local_code).maybeSingle()
      setOutlet(o || null)
    } else setOutlet(null)
  }
  useEffect(() => { setC(null); setEdit(false); setMsg(null); setWa(null); if (caseNumber) load() }, [caseNumber]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!c || !c.pos_local_code) return null
  const magnum = c.client_code === 'MAGNUM'
  const lat = outlet?.latitude ?? c.latitude, lng = outlet?.longitude ?? c.longitude
  const address = outlet ? [outlet.street_address, outlet.suburb, outlet.town, outlet.province, outlet.postal_code].filter(Boolean).join(', ') : c.address
  const gps = parseGps(gpsText)

  function openEdit() {
    const base = outlet || { name: c.point_of_sale, contact_person: c.case_contact_name, mobile_number: c.case_mobile_number || c.case_contact_number, street_address: c.address }
    setForm(Object.fromEntries(FIELDS.map(([k]) => [k, base[k] || ''])))
    setGpsText(''); setMsg(null); setEdit(true)
  }
  function useMyLocation() {
    if (!navigator.geolocation) return setMsg({ bad: true, t: 'This device cannot give a location.' })
    navigator.geolocation.getCurrentPosition(p => setGpsText(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`),
      () => setMsg({ bad: true, t: 'Location not allowed or not found.' }), { enableHighAccuracy: true, timeout: 10000 })
  }

  async function save() {
    if (gpsText && (!gps || gps.outside)) return setMsg({ bad: true, t: gps?.outside ? ERR.bad_gps : 'Paste a Google Maps link or coordinates like -26.2041, 28.0473' })
    setBusy(true); setMsg(null)
    if (!magnum) {
      const before = outlet || {}
      const p = Object.fromEntries(Object.entries(form).filter(([k, v]) => (v || '') !== (before[k] || '')))
      if (gps) { p.latitude = gps.lat; p.longitude = gps.lng }
      if (!Object.keys(p).length) { setBusy(false); return setMsg({ t: 'Nothing changed.' }) }
      const { data, error } = await supabase.rpc('coolerco_outlet_update', { p_client: c.client_code, p_outlet: c.pos_local_code, p, p_case: c.case_number })
      setBusy(false)
      if (error) return setMsg({ bad: true, t: /does not exist|PGRST202/i.test(error.message) ? 'Needs database script 055 on this database.' : error.message })
      if (data?.error) return setMsg({ bad: true, t: ERR[data.error] || data.error })
      setMsg({ t: `✅ Saved (${data.changed} change${data.changed === 1 ? '' : 's'}) — the store and its open cases now use these details.` }); setEdit(false); load()
    } else {
      // Magnum: file a correction for review (COM / RouteIQ are the masters)
      const issues = {}
      if (form.name !== (c.point_of_sale || '')) issues.incorrect_pos_name = 'Corrected from a case in CoolerCo-Ops'
      if (form.street_address !== (c.address || '')) issues.incorrect_address = 'Corrected from a case in CoolerCo-Ops'
      if (form.contact_person !== (c.case_contact_name || '') || form.mobile_number !== (c.case_mobile_number || c.case_contact_number || '')) issues.incorrect_contact = 'Corrected from a case in CoolerCo-Ops'
      if (gps) issues.incorrect_gps = 'Correct point set in the office (from the map)'
      if (!Object.keys(issues).length) { setBusy(false); return setMsg({ t: 'Nothing changed.' }) }
      const { data: u } = await supabase.auth.getUser()
      const { error } = await supabase.from('coolerco_field_pos_reports').insert({
        id: crypto.randomUUID(), pos_local_code: c.pos_local_code, point_of_sale: c.point_of_sale, issues,
        new_pos_name: issues.incorrect_pos_name ? form.name : null, new_address: issues.incorrect_address ? [form.street_address, form.suburb, form.town].filter(Boolean).join(', ') : null,
        new_contact_name: issues.incorrect_contact ? form.contact_person : null, new_contact_phone: issues.incorrect_contact ? form.mobile_number : null,
        latitude: gps?.lat ?? null, longitude: gps?.lng ?? null, review_status: 'new', driver_username: `office:${u?.user?.email || ''}`, created_by: u?.user?.id,
      })
      setBusy(false)
      if (error) return setMsg({ bad: true, t: error.message })
      setMsg({ t: '📝 Sent to the store-correction review list. Routing and COM keep the old details until it is accepted and fixed in COM.' }); setEdit(false)
    }
  }

  async function portalLink() {
    setBusy(true); setMsg(null)
    const r = magnum
      ? await supabase.rpc('coolerco_portal_link_for_pos', { p_pos_local_code: c.pos_local_code })
      : await supabase.rpc('coolerco_portal_link_for_outlet', { p_client: c.client_code, p_outlet: c.pos_local_code })
    setBusy(false)
    if (r.error || !r.data?.token) return setMsg({ bad: true, t: /does not exist|PGRST202/i.test(r.error?.message || '') ? 'Needs database script 055 on this database.' : (r.error?.message || 'Could not make the link.') })
    const l = r.data
    setWa({ url: `${window.location.origin}/p/${l.token}`, name: l.contact_name || outlet?.contact_person || c.case_contact_name || '',
      number: l.mobile_number || l.contact_number || outlet?.mobile_number || c.case_mobile_number || c.case_contact_number || '' })
  }
  const waPhone = waNumber(wa?.number)
  const waOk = waPhone.length >= 11 && waPhone.length <= 13
  const waText = wa ? encodeURIComponent(`Hello ${wa.name || ''}, this is CoolerCo. Use this secure link to log a repair, collection or new cooler request for ${c.point_of_sale}, and to follow case ${c.case_number}: ${wa.url}`) : ''

  return (
    <details className="sec" open style={{ marginTop: 8 }}>
      <summary>🏪 Store · {c.point_of_sale || c.pos_local_code}</summary>
      <div className="sec-body">
        <div className="dl-grid">
          <div className="dl-field"><div className="lbl">Store</div><div className="val">{c.point_of_sale} <span className="text3 mono">· {c.pos_local_code}</span></div></div>
          <div className="dl-field"><div className="lbl">Address</div><div className="val">{address || '—'}</div></div>
          <div className="dl-field"><div className="lbl">Contact</div><div className="val">{outlet?.contact_person || c.case_contact_name || '—'}</div></div>
          <div className="dl-field"><div className="lbl">Mobile</div><div className="val">{(outlet?.mobile_number || c.case_mobile_number || c.case_contact_number) ? <a href={`tel:${outlet?.mobile_number || c.case_mobile_number || c.case_contact_number}`}>{outlet?.mobile_number || c.case_mobile_number || c.case_contact_number}</a> : '—'}</div></div>
          <div className="dl-field"><div className="lbl">GPS</div><div className="val">{lat != null && lng != null ? <a href={mapLink(lat, lng)} target="_blank" rel="noopener noreferrer">🗺 View on map ↗</a> : <span className="tag tag-orange">No GPS</span>}{outlet?.gps_set_by ? <span className="text3" style={{ fontSize: 10 }}> · set by {outlet.gps_set_by}</span> : null}</div></div>
        </div>
        <div className="case-actions-row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
          <Link className="btn btn-ghost btn-sm" to={`/cases?client=${magnum ? 'MAGNUM' : c.client_code}&pos=${encodeURIComponent(c.pos_local_code)}`} title="Every case of this store">📂 Store's cases</Link>
          {!edit && <button className="btn btn-ghost btn-sm" onClick={openEdit}>✏️ Update store details</button>}
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={portalLink} title="The store's own secure link to log and follow requests">💬 Portal link by WhatsApp</button>
        </div>

        {wa && (
          <div className="req-box" style={{ marginTop: 6 }}>
            <div className="lbl">Send the store's portal link</div>
            <div className="text3 mono" style={{ fontSize: 10.5, wordBreak: 'break-all' }}>{wa.url}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <input className="field-ctrl" style={{ flex: '1 1 120px' }} placeholder="Name" value={wa.name} onChange={e => setWa({ ...wa, name: e.target.value })} />
              <input className="field-ctrl" style={{ flex: '1 1 140px' }} placeholder="Mobile, e.g. 082 123 4567" value={wa.number} onChange={e => setWa({ ...wa, number: e.target.value })} />
            </div>
            <div className="modal-btns" style={{ justifyContent: 'flex-start', marginTop: 6 }}>
              <a className={`btn btn-primary btn-sm${waOk ? '' : ' disabled'}`} aria-disabled={!waOk} href={waOk ? `https://wa.me/${waPhone}?text=${waText}` : undefined} target="_blank" rel="noopener noreferrer" onClick={e => { if (!waOk) { e.preventDefault(); setMsg({ bad: true, t: 'Type a full mobile number first.' }) } }}>💬 Open WhatsApp</a>
              <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(wa.url).then(() => setMsg({ t: '📋 Link copied.' }))}>📋 Copy link</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setWa(null)}>Close</button>
            </div>
          </div>
        )}

        {edit && (
          <div className="req-box" style={{ marginTop: 6 }}>
            <div className="lbl">{magnum ? '✏️ Correct the store details (goes to review — COM is the master for Magnum stores)' : '✏️ Update store details (saved on the store and its open cases)'}</div>
            <div className="dl-grid" style={{ gap: 6 }}>
              {FIELDS.filter(([k]) => outlet || ['name', 'contact_person', 'mobile_number', 'street_address'].includes(k)).map(([k, label]) => (
                <label key={k} className="dl-field" style={{ margin: 0 }}><span className="lbl">{label}</span>
                  <input className="field-ctrl" value={form[k] || ''} onChange={e => setForm({ ...form, [k]: e.target.value })} /></label>
              ))}
            </div>
            <div className="lbl" style={{ marginTop: 8 }}>📍 GPS point {lat != null ? '(leave empty to keep it)' : '(none yet)'}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <input className="field-ctrl" style={{ flex: '1 1 220px' }} placeholder="Paste a Google Maps link or -26.2041, 28.0473" value={gpsText} onChange={e => setGpsText(e.target.value)} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={useMyLocation} title="Only when you are standing at the store">📱 Use my location</button>
              <a className="btn btn-ghost btn-sm" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([form.name, form.street_address, form.town].filter(Boolean).join(', '))}`} target="_blank" rel="noopener noreferrer">🔎 Find on Google Maps</a>
            </div>
            {gpsText && (gps && !gps.outside
              ? <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>✅ Point found: {gps.lat}, {gps.lng} · <a href={mapLink(gps.lat, gps.lng)} target="_blank" rel="noopener noreferrer">🗺 Check on map</a></div>
              : <div className="form-msg err">{gps?.outside ? ERR.bad_gps : 'Not a map link or coordinates yet.'}</div>)}
            <div className="modal-btns" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : magnum ? '📝 Send for review' : '💾 Save'}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setEdit(false); setMsg(null) }}>Cancel</button>
            </div>
          </div>
        )}
        {msg && <div className={`form-msg ${msg.bad ? 'err' : 'ok'}`}>{msg.t}</div>}
      </div>
    </details>
  )
}
