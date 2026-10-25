import { NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'

const NAV = [
  { section: 'OVERVIEW', items: [
    { to: '/',         icon: '📊', label: 'Dashboard' },
    { to: '/assets',   icon: '🏭', label: 'Assets' },
    { to: '/cases',    icon: '🔧', label: 'Cases' },
    { to: '/scan',     icon: '📷', label: 'Scan / Touch' },
  ] },
  { section: 'FIELD OPS', items: [
    { to: '/picking',  icon: '📦', label: 'Picking Queue' },
    { to: '/routes',   icon: '🗺️', label: 'Routes' },
    { href: 'https://smartroutertma.netlify.app/', icon: '🛣️', label: 'Routing App' },
  ] },
  { section: 'STOCK & WMS', items: [
    { to: '/stock',         icon: '🧊', label: 'Asset Stock' },
    { to: '/stock/check',   icon: '🧭', label: 'Location Check' },
    { href: 'https://smartsparesrtma.netlify.app/', icon: '🔧', label: 'Spares (SmartSpares)' },
    { divider: true },
    { to: '/wms/receiving', icon: '📥', label: 'Receiving' },
    { to: '/wms/transfers', icon: '🔄', label: 'Transfers' },
    { to: '/wms/stocktake', icon: '📋', label: 'Stocktake' },
    { to: '/wms/dispatch',  icon: '📤', label: 'Dispatch' },
  ] },
  { section: 'CUSTOMERS', items: [
    { to: '/portal', icon: '🏪', label: 'POS Lookup' },
  ] },
  { section: 'ADMIN', items: [
    { to: '/setup', icon: '⚙️', label: 'Setup' },
  ] },
]

const readFolded = () => { try { return JSON.parse(localStorage.getItem('cc_nav_folded') || '{}') } catch { return {} } }

export default function Sidebar({ collapsed, onToggle, mobileOpen, onNavigate, user, onSignOut }) {
  // Sections can be folded too (remembered per browser)
  const [folded, setFolded] = useState(readFolded)
  useEffect(() => { try { localStorage.setItem('cc_nav_folded', JSON.stringify(folded)) } catch { /* ignore */ } }, [folded])
  const showText = !collapsed || mobileOpen

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mob-open' : ''}`}>
      <div className="sidebar-logo">
        <div className="logo-icon">CC</div>
        {showText && (
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div className="logo-text">CoolerCo-Ops</div>
            <div className="logo-sub">RTMA Operations Hub</div>
          </div>
        )}
        <button className="nav-collapse-btn" onClick={onToggle}
          title={mobileOpen ? 'Close menu' : collapsed ? 'Expand menu' : 'Collapse menu'}
          aria-label={mobileOpen ? 'Close menu' : collapsed ? 'Expand menu' : 'Collapse menu'}>
          {mobileOpen ? '✕' : collapsed ? '»' : '«'}
        </button>
      </div>

      <nav className="sidebar-nav">
        {NAV.map(group => {
          const isFolded = showText && folded[group.section]
          return (
            <div key={group.section}>
              {showText
                ? (
                  <button className="nav-section-label" onClick={() => setFolded(f => ({ ...f, [group.section]: !f[group.section] }))}>
                    <span>{group.section}</span><span>{isFolded ? '▸' : '▾'}</span>
                  </button>
                )
                : <div className="nav-divider" />}
              {!isFolded && group.items.map((item, i) => {
                if (item.divider) return <div key={i} className="nav-divider" />
                const inner = (
                  <>
                    <span className="nav-icon">{item.icon}</span>
                    {showText && <span className="nav-label">{item.label}</span>}
                    {showText && item.href && <span className="nav-ext-arrow">↗</span>}
                  </>
                )
                if (item.href) return (
                  <a key={i} className="nav-item" href={item.href} target="_blank" rel="noopener noreferrer" title={item.label} onClick={onNavigate}>{inner}</a>
                )
                return (
                  <NavLink key={i} to={item.to} end={item.to === '/'} title={item.label} onClick={onNavigate}
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>{inner}</NavLink>
                )
              })}
            </div>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="footer-avatar" title={user?.email}>{(user?.email || 'RT').slice(0, 2).toUpperCase()}</div>
        {showText && (
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div className="footer-name trunc">{user?.email || 'RTMA Ops'}</div>
            <div className="footer-status"><span className="live-dot" />Live data</div>
          </div>
        )}
        {showText && onSignOut && <button className="btn btn-ghost btn-sm nav-signout" onClick={onSignOut} title="Sign out">⏻</button>}
      </div>
    </aside>
  )
}
