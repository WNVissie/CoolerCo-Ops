import { useState, useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

// Pages load on first visit (lazy) so the first screen opens fast
const Assets = lazy(() => import('./pages/Assets'))
const Cases = lazy(() => import('./pages/Cases'))
const Scan = lazy(() => import('./pages/Scan'))
const Picking = lazy(() => import('./pages/Picking'))
const Routes_ = lazy(() => import('./pages/Routes'))
const AssetStock = lazy(() => import('./pages/AssetStock'))
const LocationCheck = lazy(() => import('./pages/LocationCheck'))
const Setup = lazy(() => import('./pages/Setup'))
const Requests = lazy(() => import('./pages/Requests'))
const PortalAccess = lazy(() => import('./pages/PortalAccess'))
const NewCase = lazy(() => import('./pages/NewCase'))
const CustomerPortal = lazy(() => import('./pages/CustomerPortal'))
const Receiving = lazy(() => import('./pages/wms/Receiving'))
const Transfers = lazy(() => import('./pages/wms/Transfers'))
const Stocktake = lazy(() => import('./pages/wms/Stocktake'))
const Dispatch = lazy(() => import('./pages/wms/Dispatch'))

export default function App() {
  // Desktop: collapse to icons (remembered). Phone: menu slides in over the page.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => { try { return localStorage.getItem('cc_nav_collapsed') === '1' } catch { return false } })
  const [mobileOpen, setMobileOpen] = useState(false)
  const isPhone = () => window.matchMedia('(max-width: 768px)').matches
  useEffect(() => { try { localStorage.setItem('cc_nav_collapsed', sidebarCollapsed ? '1' : '0') } catch { /* ignore */ } }, [sidebarCollapsed])
  const toggleNav = () => (isPhone() ? setMobileOpen(o => !o) : setSidebarCollapsed(c => !c))
  const [session, setSession] = useState(undefined) // undefined = still checking

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="load-state" style={{ height: '100dvh' }}><span className="spinner" /></div>
  if (!session) return <Login />

  return (
    <BrowserRouter>
      <div className="app-shell">
        <Sidebar collapsed={sidebarCollapsed} onToggle={toggleNav} mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)}
          user={session.user} onSignOut={() => supabase.auth.signOut()} />
        {mobileOpen && <div className="nav-scrim" onClick={() => setMobileOpen(false)} />}
        <div className="main-area">
          <button className="topbar-hamburger" onClick={() => setMobileOpen(true)} aria-label="Open menu">☰</button>
          <Suspense fallback={<div className="load-state"><span className="spinner" /> Loading…</div>}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/assets" element={<Assets />} />
              <Route path="/cases" element={<Cases />} />
              <Route path="/scan" element={<Scan />} />
              <Route path="/picking" element={<Picking />} />
              <Route path="/routes" element={<Routes_ />} />
              <Route path="/stock" element={<AssetStock />} />
              <Route path="/stock/check" element={<LocationCheck />} />
              <Route path="/setup" element={<Setup />} />
              <Route path="/requests" element={<Requests />} />
              <Route path="/portal-access" element={<PortalAccess />} />
              <Route path="/wms/receiving" element={<Receiving />} />
              <Route path="/wms/transfers" element={<Transfers />} />
              <Route path="/wms/stocktake" element={<Stocktake />} />
              <Route path="/wms/dispatch" element={<Dispatch />} />
              <Route path="/portal" element={<CustomerPortal />} />
              <Route path="/newcase" element={<NewCase />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </BrowserRouter>
  )
}
