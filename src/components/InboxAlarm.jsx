import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// Supervisor alarm. Asks the server every 30 s (one small call) what is waiting. A NEW alert gives a
// sound, a buzz on phones and a clear banner; the count is shown in the menu and on the ☰ button.
// Browser side on purpose: it only runs while someone has the app open, and costs one tiny request.
const EVERY = 30000
const EVENT_ICON = { case_logged: '📨', case_query: '💬', contact_update: '👤', feedback_low: '⭐', feedback_not_working: '🛠' }

function beep(urgent) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const tones = urgent ? [880, 660, 880, 660] : [660, 880]
    tones.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.type = 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.22)
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.22 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.22 + 0.2)
      o.connect(g); g.connect(ctx.destination)
      o.start(ctx.currentTime + i * 0.22); o.stop(ctx.currentTime + i * 0.22 + 0.21)
    })
    setTimeout(() => ctx.close().catch(() => {}), tones.length * 220 + 300)
  } catch { /* sound is a bonus — never break the page for it */ }
}

export default function InboxAlarm({ onCounts }) {
  const [banner, setBanner] = useState(null)
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem('cc_alarm_muted') === '1' } catch { return false } })
  const seen = useRef(null) // newest alert id we already announced
  const off = useRef(false)  // the server function is not installed here → stop asking
  const navigate = useNavigate()

  const check = useCallback(async () => {
    if (off.current || document.hidden || !navigator.onLine) return
    const { data, error } = await supabase.rpc('coolerco_inbox_counts')
    if (error?.code === 'PGRST202' || error?.code === '42883') { off.current = true; return } // not installed (e.g. production before script 019): stay silent
    if (error || !data) return
    onCounts?.(data)
    const total = (data.alerts || 0)
    document.title = `${total ? `(${total}) ` : ''}CoolerCo-Ops`
    const latest = data.latest
    if (seen.current === null) { // first look after opening the app: remember, but only announce what is unread and new since last time
      let last = null; try { last = localStorage.getItem('cc_alarm_last') } catch { /* ignore */ }
      seen.current = latest?.id || ''
      if (!latest || latest.id === last) return
    } else if (!latest || latest.id === seen.current) return
    seen.current = latest.id
    try { localStorage.setItem('cc_alarm_last', latest.id) } catch { /* ignore */ }
    setBanner({ ...latest, more: Math.max(0, total - 1) })
    if (!muted) { beep(latest.priority === 'High'); navigator.vibrate?.(latest.priority === 'High' ? [200, 100, 200, 100, 200] : [150]) }
  }, [onCounts, muted])

  useEffect(() => {
    check()
    const t = setInterval(check, EVERY)
    const now = () => check()
    document.addEventListener('visibilitychange', now); window.addEventListener('online', now); window.addEventListener('cc-inbox', now)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', now); window.removeEventListener('online', now); window.removeEventListener('cc-inbox', now) }
  }, [check])

  const toggleMute = () => setMuted(m => { try { localStorage.setItem('cc_alarm_muted', m ? '0' : '1') } catch { /* ignore */ } return !m })
  if (!banner) return null
  const urgent = banner.priority === 'High'
  return (
    <div className={`alarm-banner${urgent ? ' urgent' : ''}`} role="alert">
      <span className="alarm-ico">{urgent ? '⚡' : EVENT_ICON[banner.event] || '🔔'}</span>
      <div className="alarm-text">
        <strong>{urgent ? 'URGENT · ' : ''}{banner.title || 'New alert'}</strong>
        {banner.more > 0 && <small>+ {banner.more} more waiting</small>}
      </div>
      <button className="btn btn-sm alarm-open" onClick={() => { setBanner(null); navigate(banner.event === 'case_query' ? '/inbox?tab=queries' : banner.event === 'contact_update' ? '/inbox?tab=contacts' : '/inbox') }}>Open</button>
      <button className="alarm-x" onClick={toggleMute} aria-label={muted ? 'Turn alarm sound on' : 'Turn alarm sound off'} title={muted ? 'Sound is off' : 'Sound is on'}>{muted ? '🔕' : '🔔'}</button>
      <button className="alarm-x" onClick={() => setBanner(null)} aria-label="Close">✕</button>
    </div>
  )
}
