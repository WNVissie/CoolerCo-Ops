import { useState, useEffect, lazy, Suspense } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Login from '../pages/Login'
import { startAutoFlush, queueCount } from '../lib/offline'
import './field.css'

// CoolerCo Field — installable app for warehouse teams and drivers (same SmartHub login).
// Tabs: 📷 Scan (offline queue) · 🚚 My trip (routing app's route, live case status) · 📋 Cases (status lookup).
const Scan = lazy(() => import('../pages/Scan'))
const FieldTrip = lazy(() => import('./FieldTrip'))
const FieldCases = lazy(() => import('./FieldCases'))
const TABS = [['trip', '🚚', 'My trip'], ['scan', '📷', 'Scan'], ['cases', '📋', 'Cases']]

const tabFromPath = () => (window.location.pathname.match(/^\/field\/(trip|scan|cases)/) || [])[1]

export default function FieldApp() {
  const [session, setSession] = useState(undefined)
  const [tab, setTab] = useState(() => tabFromPath() || (localStorage.getItem('cc_field_driver') ? 'trip' : 'scan'))
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
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    if (ios && !standalone && !localStorage.getItem('cc_ios_hint_done')) setIosHint(true)
    return () => {
      sub.subscription.unsubscribe()
      window.removeEventListener('online', on); window.removeEventListener('offline', off)
      window.removeEventListener('cc-queue', q); window.removeEventListener('beforeinstallprompt', bip)
    }
  }, [])

  useEffect(() => {
    if (!session) return
    startAutoFlush()
    // fetch the other screens once, so they open without signal later (kept by the service worker)
    const warm = () => { import('../pages/Scan'); import('./FieldTrip'); import('./FieldCases'); if (!('BarcodeDetector' in window)) import('@zxing/browser') } // iPhone camera reader only where needed
    'requestIdleCallback' in window ? requestIdleCallback(warm) : setTimeout(warm, 1500)
  }, [session])

  function go(t) { setTab(t); window.history.replaceState(null, '', '/field/' + t) }

  if (session === undefined) return <div className="load-state" style={{ height: '100dvh' }}><span className="spinner" /></div>
  if (!session) return <Login />

  return (
    <BrowserRouter>
      <div className="f-root">
        <header className="f-head">
          <div className="f-logo">❄️ <b>Cooler</b><span>Co</span> <small>Field</small></div>
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
