import { lazyPage } from './lib/lazyPage'
import { useState, useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

// Pages load on first visit (lazy) so the first screen opens fast
const Assets = lazyPage(() => import('./pages/Assets'))
const Cases = lazyPage(() => import('./pages/Cases'))
const Scan = lazyPage(() => import('./pages/Scan'))
const ComTouchExport = lazyPage(() => import('./pages/ComTouchExport'))
const StocktakeExceptions = lazyPage(() => import('./pages/StocktakeExceptions'))
const ScanReport = lazyPage(() => import('./pages/ScanReport'))
const Picking = lazyPage(() => import('./pages/Picking'))
const Routes_ = lazyPage(() => import('./pages/Routes'))
const AssetStock = lazyPage(() => import('./pages/AssetStock'))
const LocationCheck = lazyPage(() => import('./pages/LocationCheck'))
const Setup = lazyPage(() => import('./pages/Setup'))
const Catalogue = lazyPage(() => import('./pages/Catalogue'))
const Requests = lazyPage(() => import('./pages/Requests'))
const PortalAccess = lazyPage(() => import('./pages/PortalAccess'))
const Concessionaires = lazyPage(() => import('./pages/Concessionaires'))
const DriverLinks = lazyPage(() => import('./pages/DriverLinks'))
const NewCase = lazyPage(() => import('./pages/NewCase'))
const CustomerPortal = lazyPage(() => import('./pages/CustomerPortal'))
const Receiving = lazyPage(() => import('./pages/wms/Receiving'))
const Transfers = lazyPage(() => import('./pages/wms/Transfers'))
const Stocktake = lazyPage(() => import('./pages/wms/Stocktake'))
const Dispatch = lazyPage(() => import('./pages/wms/Dispatch'))

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
              <Route path="/scan/export" element={<ComTouchExport />} />
              <Route path="/scan/stocktake" element={<StocktakeExceptions />} />
              <Route path="/scan/report" element={<ScanReport />} />
              <Route path="/picking" element={<Picking />} />
              <Route path="/routes" element={<Routes_ />} />
              <Route path="/stock" element={<AssetStock />} />
              <Route path="/stock/check" element={<LocationCheck />} />
              <Route path="/setup" element={<Setup />} />
              <Route path="/catalogue" element={<Catalogue />} />
              <Route path="/requests" element={<Requests />} />
              <Route path="/portal-access" element={<PortalAccess />} />
              <Route path="/concessionaires" element={<Concessionaires />} />
              <Route path="/driver-links" element={<DriverLinks />} />
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
