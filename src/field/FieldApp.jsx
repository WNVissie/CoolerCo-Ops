import { useState, useEffect, lazy, Suspense } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Login from '../pages/Login'
import { startAutoFlush, queueCount } from '../lib/offline'
import './field.css'

// CoolerCo Field — installable app for warehouse teams and drivers (same SmartHub login).
// Screens: 🏠 Home · 📷 Scan (offline queue) · 🚚 My trip (routing app's route, live case status) · 📋 Cases (status lookup).
// Every screen has ‹ Back in the header; the phone's own back (Android button / iPhone swipe) works too.
const Scan = lazy(() => import('../pages/Scan'))
const FieldTrip = lazy(() => import('./FieldTrip'))
const FieldCases = lazy(() => import('./FieldCases'))
const TABS = [['home', '🏠', 'Home'], ['trip', '🚚', 'My trip'], ['scan', '📷', 'Scan'], ['cases', '📋', 'Cases']]
const TITLES = { trip: '🚚 My trip', scan: '📷 Scan', cases: '📋 Case status' }

const tabFromPath = () => (window.location.pathname.match(/^\/field\/(home|trip|scan|cases)/) || [])[1]

export default function FieldApp() {
  const [session, setSession] = useState(undefined)
  const [tab, setTab] = useState(() => tabFromPath() || 'home')
  const [online, setOnline] = useState(navigator.onLine)
  const [waiting, setWaiting] = useState(0)
  const [install, setInstall] = useState(null) // Android install prompt
  const [iosHint, setIosHint] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session)) // works offline (saved on the phone)
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    const on = () => setOnline(true), off = () => setOnline(false)
    const q = e => setWaiting(e.detail)
    const bip = e => { e.preventDefault(); setInstall(e) }
    window.addEventListener('online', on); window.addEventListener('offline', off)
    window.addEventListener('cc-queue', q); window.addEventListener('beforeinstallprompt', bip)
    queueCount().then(setWaiting)
    const pop = () => setTab(tabFromPath() || 'home')
    window.addEventListener('popstate', pop)
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    if (ios && !standalone && !localStorage.getItem('cc_ios_hint_done')) setIosHint(true)
    return () => {
      sub.subscription.unsubscribe()
      window.removeEventListener('online', on); window.removeEventListener('offline', off)
      window.removeEventListener('cc-queue', q); window.removeEventListener('beforeinstallprompt', bip)
      window.removeEventListener('popstate', pop)
    }
  }, [])

  useEffect(() => {
    if (!session) return
    startAutoFlush()
    // fetch the other screens once, so they open without signal later (kept by the service worker)
    const warm = () => { import('../pages/Scan'); import('./FieldTrip'); import('./FieldCases'); if (!('BarcodeDetector' in window)) import('@zxing/browser') } // iPhone camera reader only where needed
    'requestIdleCallback' in window ? requestIdleCallback(warm) : setTimeout(warm, 1500)
  }, [session])

  // Each screen is a step in the phone's history, so Back (header, Android button, iPhone swipe) returns to the previous one
  function go(t) { if (t === tab) return; setTab(t); window.history.pushState({ cc: true }, '', t === 'home' ? '/field' : '/field/' + t) }
  function back() { if (window.history.state?.cc) window.history.back(); else { setTab('home'); window.history.replaceState(null, '', '/field') } }

  if (session === undefined) return <div className="load-state" style={{ height: '100dvh' }}><span className="spinner" /></div>
  if (!session) return <Login />

  return (
    <BrowserRouter>
      <div className="f-root">
        <header className="f-head">
          {tab === 'home'
            ? <div className="f-logo">❄️ <b>Cooler</b><span>Co</span> <small>Field</small></div>
            : <><button className="f-back" onClick={back} aria-label="Back">‹ Back</button><div className="f-title">{TITLES[tab]}</div></>}
          <span className={`f-net ${online ? 'on' : 'off'}`}>{online ? '📶' : '📵 Offline'}{waiting > 0 ? ` · ⏳${waiting}` : ''}</span>
          {install && <button className="f-install" onClick={async () => { install.prompt(); await install.userChoice; setInstall(null) }}>📲 Install</button>}
        </header>
        {iosHint && (
          <div className="f-hint">
            📲 Install on iPhone: tap <b>Share</b> <span className="f-share">⬆</span> then <b>Add to Home Screen</b>.
            <button onClick={() => { localStorage.setItem('cc_ios_hint_done', '1'); setIosHint(false) }}>✕</button>
          </div>
        )}
        <main className="f-main">
          <Suspense fallback={<div className="load-state"><span className="spinner" /> Loading…</div>}>
            {tab === 'home' && <FieldHome go={go} waiting={waiting} user={session.user} />}
            {tab === 'scan' && <Scan field />}
            {tab === 'trip' && <FieldTrip />}
            {tab === 'cases' && <FieldCases />}
          </Suspense>
        </main>
        <nav className="f-tabs">
          {TABS.map(([k, i, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => go(k)}><span>{i}</span><small>{l}</small></button>
          ))}
        </nav>
      </div>
    </BrowserRouter>
  )
}

// Home: big tiles to each part of the app (the "main screen")
function FieldHome({ go, waiting, user }) {
  const driver = (() => { try { return JSON.parse(localStorage.getItem('cc_field_driver')) } catch { return null } })()
  const name = user?.user_metadata?.first_name || (user?.email || '').split('@')[0]
  const tiles = [
    ['trip', '🚚', 'My trip', driver ? `${driver.display} · today's stops` : "Today's route, stops and case status"],
    ['scan', '📷', 'Scan assets', waiting ? `⏳ ${waiting} waiting to send` : 'QR or barcode · works without signal'],
    ['cases', '📋', 'Case status', 'Look up a case, store or asset'],
  ]
  return (
    <div className="f-pad">
      <div className="f-hello">
        <strong>Hello {name} 👋</strong>
        <small>{new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })}</small>
      </div>
      {tiles.map(([k, i, t, d]) => (
        <button key={k} className="f-tile" onClick={() => go(k)}>
          <span className="f-tile-ico">{i}</span>
          <span className="f-grow"><strong>{t}</strong><small>{d}</small></span>
          <span className="f-tile-go">›</span>
        </button>
      ))}
      <div className="f-home-links">
        <a className="btn btn-ghost btn-sm" href="/">🖥 Full CoolerCo-Ops</a>
        <button className="btn btn-ghost btn-sm" onClick={() => { if (confirm('Sign out of CoolerCo Field?')) supabase.auth.signOut() }}>⎋ Sign out</button>
      </div>
    </div>
  )
}
