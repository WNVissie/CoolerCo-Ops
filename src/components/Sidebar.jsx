import { NavLink, useLocation } from 'react-router-dom'
import { useState } from 'react'

const NAV = [
  { section: 'OVERVIEW' },
  { to: '/',         icon: '📊', label: 'Dashboard' },
  { to: '/assets',   icon: '🏭', label: 'Assets' },
  { to: '/cases',    icon: '🔧', label: 'Cases' },
  { to: '/scan',     icon: '📷', label: 'Scan / Touch' },

  { section: 'FIELD OPS' },
  { to: '/picking',  icon: '📦', label: 'Picking Queue' },
  { to: '/routes',   icon: '🗺️',  label: 'Routes' },
  { href: 'https://smartroutertma.netlify.app/', icon: '🛣️', label: 'Routing App', ext: true },

  { section: 'STOCK & WMS' },
  { to: '/stock',          icon: '🧊', label: 'Asset Stock' },
  { href: 'https://smartsparesrtma.netlify.app/', icon: '🔧', label: 'Spares (SmartSpares)', ext: true },
  { divider: true },
  { to: '/wms/receiving',   icon: '📥', label: 'Receiving' },
  { to: '/wms/transfers',   icon: '🔄', label: 'Transfers' },
  { to: '/wms/stocktake',   icon: '📋', label: 'Stocktake' },
  { to: '/wms/dispatch',    icon: '📤', label: 'Dispatch' },

  { section: 'CUSTOMERS' },
  { to: '/portal',   icon: '🏪', label: 'POS Lookup' },
]

export default function Sidebar({ collapsed, setCollapsed, user, onSignOut }) {
  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-logo" onClick={() => setCollapsed(c => !c)}>
        <div className="logo-icon">CC</div>
        <div style={{ overflow: 'hidden' }}>
          <div className="logo-text">CoolerCo-Ops</div>
          <div className="logo-sub">RTMA Operations Hub</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV.map((item, i) => {
          if (item.section) return (
            <div key={i} className="nav-section-label">{item.section}</div>
          )
          if (item.divider) return <div key={i} className="nav-divider" />
          if (item.href) return (
            <a key={i} className="nav-item" href={item.href} target="_blank" rel="noopener noreferrer">
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
              {!collapsed && <span className="nav-ext-arrow">↗</span>}
            </a>
          )
          return (
            <NavLink key={i} to={item.to} end={item.to === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
              {item.badge && <span className={`nav-badge${item.warn ? ' warn' : ''}`}>{item.badge}</span>}
            </NavLink>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="footer-avatar">{(user?.email || 'RT').slice(0, 2).toUpperCase()}</div>
        {!collapsed && (
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div className="footer-name trunc">{user?.email || 'RTMA Ops'}</div>
            <div className="footer-status"><span className="live-dot" />Live data</div>
          </div>
        )}
        {!collapsed && onSignOut && <button className="btn btn-ghost btn-sm" onClick={onSignOut} title="Sign out">⏻</button>}
      </div>
    </aside>
  )
}
