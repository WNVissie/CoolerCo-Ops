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
const NewCase = lazy(() => import('./pages/NewCase'))
const CustomerPortal = lazy(() => import('./pages/CustomerPortal'))
const Receiving = lazy(() => import('./pages/wms/Receiving'))
const Transfers = lazy(() => import('./pages/wms/Transfers'))
const Stocktake = lazy(() => import('./pages/wms/Stocktake'))
const Dispatch = lazy(() => import('./pages/wms/Dispatch'))

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
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
        <Sidebar collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} user={session.user} onSignOut={() => supabase.auth.signOut()} />
        <div className="main-area">
          <div className="topbar-hamburger" onClick={() => setSidebarCollapsed(c => !c)} title="Toggle menu">☰</div>
          <Suspense fallback={<div className="load-state"><span className="spinner" /> Loading…</div>}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/assets" element={<Assets />} />
              <Route path="/cases" element={<Cases />} />
              <Route path="/scan" element={<Scan />} />
              <Route path="/picking" element={<Picking />} />
              <Route path="/routes" element={<Routes_ />} />
              <Route path="/stock" element={<AssetStock />} />
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
