import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'

// Pages
import Dashboard from './pages/Dashboard'
import Assets from './pages/Assets'
import Cases from './pages/Cases'
import Scan from './pages/Scan'
import Picking from './pages/Picking'
import Routes_ from './pages/Routes'
import StockOverview from './pages/StockOverview'
import StockCategory from './pages/StockCategory'
import LowStock from './pages/LowStock'
import NewCase from './pages/NewCase'
import CustomerPortal from './pages/CustomerPortal'

// WMS pages
import Receiving from './pages/wms/Receiving'
import Transfers from './pages/wms/Transfers'
import Stocktake from './pages/wms/Stocktake'
import Dispatch from './pages/wms/Dispatch'

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <BrowserRouter>
      <div className="app-shell">
        <Sidebar collapsed={sidebarCollapsed} />
        <div className="main-area">
          <div className="topbar-hamburger" onClick={() => setSidebarCollapsed(c => !c)} title="Toggle menu">
            ☰
          </div>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/assets" element={<Assets />} />
            <Route path="/cases" element={<Cases />} />
            <Route path="/scan" element={<Scan />} />
            <Route path="/picking" element={<Picking />} />
            <Route path="/routes" element={<Routes_ />} />
            <Route path="/stock" element={<StockOverview />} />
            <Route path="/stock/category/:cat" element={<StockCategory />} />
            <Route path="/stock/low" element={<LowStock />} />
            <Route path="/wms/receiving" element={<Receiving />} />
            <Route path="/wms/transfers" element={<Transfers />} />
            <Route path="/wms/stocktake" element={<Stocktake />} />
            <Route path="/wms/dispatch" element={<Dispatch />} />
            <Route path="/portal" element={<CustomerPortal />} />
            <Route path="/newcase" element={<NewCase />} />
            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  )
}
