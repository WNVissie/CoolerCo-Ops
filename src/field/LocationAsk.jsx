import { useState, useEffect } from 'react'
import { getGps } from '../lib/photos'

// Asks for location permission up front (Home + My trip), so the first 📍 Arrived / 🚪 Left already has GPS.
// GPS is only read at those taps — there is no tracking in between.
// granted → shows nothing · prompt → "Allow location" button · denied → how to switch it back on (Samsung / Chrome).
export default function LocationAsk({ compact = false }) {
  const [state, setState] = useState('unknown') // granted | prompt | denied | unknown
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let perm
    const read = p => setState(p.state)
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' }).then(p => { perm = p; read(p); p.onchange = () => read(p) }).catch(() => setState(localStorage.getItem('cc_gps_ok') === '1' ? 'granted' : 'prompt'))
    } else setState(localStorage.getItem('cc_gps_ok') === '1' ? 'granted' : 'prompt') // older iPhones: no permissions API
    return () => { if (perm) perm.onchange = null }
  }, [])

  if (!navigator.geolocation || state === 'granted' || state === 'unknown') return null

  const allow = async () => {
    setBusy(true); setMsg('')
    const g = await getGps(10000)
    setBusy(false)
    if (g) { localStorage.setItem('cc_gps_ok', '1'); setState('granted') }
    else setMsg("No location yet. Check that the phone's Location is switched on (pull down from the top of the screen → 📍 Location), then try again.")
  }

  if (state === 'denied') return (
    <div className="form-msg warn" style={{ marginBottom: 10 }}>
      📍 <b>Location is blocked for this app.</b> Arrived and Left will be saved without GPS.
      {!compact && <><br /><small>To switch it on: tap the 🔒 or ⓘ next to the web address → <b>Permissions</b> → <b>Location</b> → <b>Allow</b>. Installed app on Samsung: <b>Settings → Apps → Chrome → Permissions → Location → Allow only while using the app</b>.</small></>}
    </div>
  )

  return (
    <div className="f-card" style={{ borderColor: 'var(--accent)' }}>
      <div className="f-row">
        <span style={{ fontSize: 26 }}>📍</span>
        <div className="f-grow"><strong>Allow location</strong><small>Your location is saved only when you tap Arrived and Left at a store.</small></div>
      </div>
      <button className="btn btn-primary" style={{ width: '100%', marginTop: 8, minHeight: 44 }} disabled={busy} onClick={allow}>{busy ? '📡 Asking the phone…' : '📍 Allow location'}</button>
      {msg && <div className="form-msg warn" style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  )
}
