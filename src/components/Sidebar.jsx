import { NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'

// Menu categories — each folds open/closed (one open at a time, so no scrolling)
const NAV = [
  { section: 'Overview', icon: '📊', items: [
    { to: '/',         icon: '🏠', label: 'Dashboard' },
    { to: '/assets',   icon: '🏭', label: 'Assets' },
    { to: '/cases',    icon: '🔧', label: 'Cases' },
    { to: '/scan',     icon: '📷', label: 'Scan / Touch' },
  ] },
  { section: 'Field Ops', icon: '🚚', items: [
    { to: '/picking',  icon: '📦', label: 'Picking Queue' },
    { to: '/routes',   icon: '🗺️', label: 'Routes' },
    { href: 'https://smartroutertma.netlify.app/', icon: '🛣️', label: 'Routing App' },
  ] },
  { section: 'Stock', icon: '🧊', items: [
    { to: '/stock',         icon: '🧊', label: 'Asset Stock' },
    { to: '/stock/check',   icon: '🧭', label: 'Location Check' },
    { href: 'https://smartsparesrtma.netlify.app/', icon: '🔩', label: 'Spares (SmartSpares)' },
  ] },
  { section: 'WMS', icon: '🏬', items: [
    { to: '/wms/receiving', icon: '📥', label: 'Receiving' },
    { to: '/wms/transfers', icon: '🔄', label: 'Transfers' },
    { to: '/wms/stocktake', icon: '📋', label: 'Stocktake' },
    { to: '/wms/dispatch',  icon: '📤', label: 'Dispatch' },
  ] },
  { section: 'Customers', icon: '🏪', items: [
    { to: '/portal', icon: '🏪', label: 'POS Lookup' },
  ] },
  { section: 'Admin', icon: '⚙️', items: [
    { to: '/setup', icon: '⚙️', label: 'Setup' },
  ] },
]

const matches = (item, path) => item.to && (item.to === '/' ? path === '/' : path === item.to || path.startsWith(item.to + '/'))
const groupOf = path => NAV.find(g => g.items.some(i => matches(i, path)))?.section

export default function Sidebar({ collapsed, onToggle, mobileOpen, onNavigate, user, onSignOut }) {
  const { pathname } = useLocation()
  const showText = !collapsed || mobileOpen
  const [open, setOpen] = useState(() => groupOf(pathname) || 'Overview')
  const [flyout, setFlyout] = useState(null) // { section, top } — collapsed mode
  const [tip, setTip] = useState(null)       // { text, top }  — collapsed tooltips
  const asideRef = useRef(null)

  // Keep the category of the current page open
  useEffect(() => { const g = groupOf(pathname); if (g) setOpen(g) }, [pathname])
  // Close the flyout on outside click / Escape
  useEffect(() => {
    if (!flyout) return
    const close = e => { if (e.key === 'Escape' || (e.type === 'mousedown' && !e.target.closest('.nav-flyout, .nav-cat-icon'))) setFlyout(null) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [flyout])
  useEffect(() => { setFlyout(null); setTip(null) }, [collapsed, pathname])

  const showTip = (e, text) => { if (!showText) setTip({ text, top: e.currentTarget.getBoundingClientRect().top + e.currentTarget.offsetHeight / 2 }) }
  const hideTip = () => setTip(null)

  const Item = ({ item }) => {
    const inner = (
      <>
        <span className="nav-icon">{item.icon}</span>
        <span className="nav-label">{item.label}</span>
        {item.href && <span className="nav-ext-arrow">↗</span>}
      </>
    )
    const done = () => { setFlyout(null); onNavigate?.() }
    return item.href
      ? <a className="nav-item" href={item.href} target="_blank" rel="noopener noreferrer" onClick={done}>{inner}</a>
      : <NavLink to={item.to} end={item.to === '/'} onClick={done} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>{inner}</NavLink>
  }

  return (
    <aside ref={asideRef} className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mob-open' : ''}`}>
      <div className="sidebar-logo">
        <div className="logo-icon">CC</div>
        {showText && (
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div className="logo-text">CoolerCo-Ops</div>
            <div className="logo-sub">RTMA Operations Hub</div>
          </div>
        )}
        <button className="nav-collapse-btn" onClick={onToggle}
          onMouseEnter={e => showTip(e, 'Expand menu')} onMouseLeave={hideTip}
          aria-label={mobileOpen ? 'Close menu' : collapsed ? 'Expand menu' : 'Collapse menu'}>
          {mobileOpen ? '✕' : collapsed ? '»' : '«'}
        </button>
      </div>

      <nav className="sidebar-nav">
        {NAV.map(g => {
          const hasActive = g.items.some(i => matches(i, pathname))
          if (!showText) {
            // Collapsed: one icon per category → tooltip on hover, items fly out on click
            return (
              <button key={g.section} className={`nav-cat-icon${hasActive ? ' active' : ''}${flyout?.section === g.section ? ' on' : ''}`}
                aria-label={g.section}
                onMouseEnter={e => !flyout && showTip(e, g.section)} onMouseLeave={hideTip}
                onClick={e => { hideTip(); const r = e.currentTarget.getBoundingClientRect(); setFlyout(f => f?.section === g.section ? null : { section: g.section, top: r.top }) }}>
                {g.icon}
              </button>
            )
          }
          const isOpen = open === g.section
          return (
            <div key={g.section} className={`nav-cat${isOpen ? ' open' : ''}`}>
              <button className={`nav-cat-hd${hasActive ? ' has-active' : ''}`} onClick={() => setOpen(isOpen ? null : g.section)} aria-expanded={isOpen}>
                <span className="nav-icon">{g.icon}</span>
                <span className="nav-label">{g.section}</span>
                <span className="nav-cat-count">{g.items.length}</span>
                <span className="nav-chev">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && <div className="nav-cat-items">{g.items.map(i => <Item key={i.label} item={i} />)}</div>}
            </div>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="footer-avatar" onMouseEnter={e => showTip(e, user?.email || 'Signed in')} onMouseLeave={hideTip}>
          {(user?.email || 'RT').slice(0, 2).toUpperCase()}
        </div>
        {showText && (
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div className="footer-name trunc">{user?.email || 'RTMA Ops'}</div>
            <div className="footer-status"><span className="live-dot" />Live data</div>
          </div>
        )}
        {showText && onSignOut && <button className="btn btn-ghost btn-sm nav-signout" onClick={onSignOut} title="Sign out">⏻</button>}
      </div>

      {/* Collapsed-mode tooltip + category flyout (fixed, so the slim bar never clips them) */}
      {tip && !showText && <div className="nav-tip" style={{ top: tip.top }}>{tip.text}</div>}
      {flyout && !showText && (
        <div className="nav-flyout" style={{ top: Math.min(flyout.top, window.innerHeight - 260) }}>
          <div className="nav-flyout-hd">{NAV.find(g => g.section === flyout.section)?.icon} {flyout.section}</div>
          {NAV.find(g => g.section === flyout.section)?.items.map(i => <Item key={i.label} item={i} />)}
        </div>
      )}
    </aside>
  )
}
