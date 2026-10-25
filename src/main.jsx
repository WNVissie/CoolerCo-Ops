import { lazyPage } from './lib/lazyPage'
import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// Public customer portal lives at /p/<link-token>: no login, its own small bundle
const PortalApp = lazyPage(() => import('./portal/PortalApp.jsx'))
const App = lazyPage(() => import('./App.jsx'))
const m = window.location.pathname.match(/^\/p\/([A-Za-z0-9_-]{10,})\/?$/)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {m
      ? <Suspense fallback={null}><PortalApp token={m[1]} /></Suspense>
      : <Suspense fallback={null}><App /></Suspense>}
  </StrictMode>,
)
