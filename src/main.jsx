import { lazyPage } from './lib/lazyPage'
import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// Public customer portal lives at /p/<link-token>: no login, its own small bundle
const PortalApp = lazyPage(() => import('./portal/PortalApp.jsx'))
const ConcPortal = lazyPage(() => import('./portal/ConcPortal.jsx'))
const FieldApp = lazyPage(() => import('./field/FieldApp.jsx'))
const App = lazyPage(() => import('./App.jsx'))
const m = window.location.pathname.match(/^\/p\/([A-Za-z0-9_-]{10,})\/?$/)
// Concessionaire portal: /c/<personal link> (PIN) or /c/view#s=<staff session>
const c = window.location.pathname.match(/^\/c\/([A-Za-z0-9_-]{4,})\/?$/)
// CoolerCo Field (installable app for warehouse teams + drivers): /field, /field/scan, /field/trip, /field/cases
const f = /^\/field(\/|$)/.test(window.location.pathname)

// Service worker: keeps the app on the phone (fast start, works without signal). Production only.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {m
      ? <Suspense fallback={null}><PortalApp token={m[1]} /></Suspense>
      : c
        ? <Suspense fallback={null}><ConcPortal link={c[1]} /></Suspense>
        : f
          ? <Suspense fallback={null}><FieldApp /></Suspense>
          : <Suspense fallback={null}><App /></Suspense>}
  </StrictMode>,
)
