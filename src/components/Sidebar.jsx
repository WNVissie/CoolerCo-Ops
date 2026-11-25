import { NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect, useRef, lazy, Suspense } from 'react'
const InstallApp = lazy(() => import('./InstallApp'))
import { useAccess, allowed } from '../lib/access'

// Menu categories — each folds open/closed (one open at a time, so no scrolling)
const NAV = [
  { section: 'Overview', icon: '📊', items: [
    { to: '/',         icon: '🏠', label: 'Dashboard' },
    { to: '/inbox',    icon: '📥', label: 'Inbox', badge: true },
  ] },
  { section: 'Field Ops', icon: '🚚', items: [
    { to: '/cases',    icon: '🔧', label: 'Cases' },
    { to: '/cases/new', icon: '➕', label: 'New case' },
    { to: '/cases/calendar', icon: '📅', label: 'Case calendar' },
    { to: '/cases/action-required', icon: '🧭', label: 'Action required' },
    { to: '/cases/asset-at-pos', icon: '⚠️', label: 'Open case · asset at POS' },
    { to: '/cases/closure-discrepancies', icon: '🔀', label: 'Closure discrepancies', magnum: true },
    { to: '/cases/flags', icon: '🚩', label: 'Case flags' },
    { to: '/com-updates', icon: '📤', label: 'COM updates & movements', magnum: true, office: true },
    { to: '/assets',   icon: '🏭', label: 'Assets' },
    { to: '/picking', icon: '📦', label: 'Picking' },
    { to: '/routes',   icon: '🗺️', label: 'Routes', magnum: true },
    { to: '/crew',     icon: '👷', label: 'Field crew', office: true },
    { to: '/test-routes', icon: '🧪', label: 'Test routes (TEST only)', office: true },
    { href: 'https://smartroutertma.netlify.app/', icon: '🛣️', label: 'Routing App', magnum: true },
    { action: 'install', icon: '📲', label: 'Install app' },
    { href: '/field', icon: '📱', label: 'Open Field app' },
  ] },
  { section: 'Stock', icon: '🧊', items: [
    { to: '/stock',         icon: '🧊', label: 'Asset Stock' },
    { to: '/stock/check',   icon: '🧭', label: 'Location Check', magnum: true },
    { href: 'https://smartsparesrtma.netlify.app/', icon: '🔩', label: 'Spares (SmartSpares)' },
  ] },
  { section: 'WMS', icon: '🏬', items: [
    { to: '/scan',          icon: '📷', label: 'Scan / Touch' },
    { to: '/scan/report',   icon: '📊', label: 'Scan report' },
    { to: '/scan/export',   icon: '⬆️', label: 'COM Touch sync', magnum: true },
    { to: '/scan/stocktake', icon: '📋', label: 'Stock take exceptions', magnum: true },
    { to: '/wms/labels',    icon: '🏷', label: 'Asset labels' },
    { href: 'https://smartscanmagnum.netlify.app/', icon: '🔗', label: 'SmartScan (COM)', magnum: true },
    { to: '/wms/receiving', icon: '📥', label: 'Receiving' },
    { to: '/wms/transfers', icon: '🔄', label: 'Transfers' },
    { to: '/wms/stocktake', icon: '📋', label: 'Stocktake' },
    { to: '/wms/dispatch',  icon: '📤', label: 'Dispatch' },
  ] },
  { section: 'Customers', icon: '🏪', items: [
    { to: '/requests', icon: '📨', label: 'Requests' },
    { to: '/portal-access', icon: '🔗', label: 'Customers & portal links' },
    { to: '/concessionaires', icon: '🤝', label: 'Responsible Ordering Parties' },
    { to: '/portal', icon: '🏪', label: 'POS Lookup (COM)', magnum: true },
  ] },
  { section: 'Admin', icon: '⚙️', items: [
    { to: '/catalogue', icon: '🛍️', label: 'Catalogue' },
    { to: '/setup', icon: '⚙️', label: 'Setup', office: true },
    { to: '/users', icon: '👥', label: 'Users & roles', office: true },
  ] },
]

const matches = (item, path) => item.to && (item.to === '/' ? path === '/' : path === item.to || path.startsWith(item.to + '/'))
const groupOf = path => NAV.find(g => g.items.some(i => matches(i, path)))?.section

export default function Sidebar({ collapsed, navMode, onSwitchMode, onToggle, mobileOpen, onNavigate, user, onSignOut, inboxCount = 0, inboxUrgent = false }) {
  const { pathname } = useLocation()
  const access = useAccess()
  // hide pages the user cannot use (Magnum-only pages for demo / Tiger users, office pages for field / client users)
  const nav = NAV.map(g => ({ ...g, items: g.items.filter(i => allowed(i, access)) })).filter(g => g.items.length)
  const showText = !collapsed || mobileOpen
  const [open, setOpen] = useState(() => groupOf(pathname) || 'Overview')
  const [flyout, setFlyout] = useState(null) // { section, top } — collapsed mode
  const [tip, setTip] = useState(null)       // { text, top }  — collapsed tooltips
  const [install, setInstall] = useState(false) // 📲 Install app window
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
        {item.badge && inboxCount > 0 && <span className={`nav-badge${inboxUrgent ? ' urgent' : ''}`} aria-label={`${inboxCount} waiting`}>{inboxCount}</span>}
        {item.href && <span className="nav-ext-arrow">↗</span>}
      </>
    )
    const done = () => { setFlyout(null); onNavigate?.() }
    if (item.action === 'install') return <button type="button" className="nav-item nav-btn" onClick={() => { done(); setInstall(true) }}>{inner}</button>
    return item.href
      ? <a className="nav-item" href={item.href} target="_blank" rel="noopener noreferrer" onClick={done}>{inner}</a>
      : <NavLink to={item.to} end={item.to === '/' || item.to === '/scan' || item.to === '/cases'} onClick={done} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>{inner}</NavLink>
  }

  return (
    <>
    {install && <Suspense fallback={null}><InstallApp onClose={() => setInstall(false)} /></Suspense>}
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
        {nav.map(g => {
          const hasActive = g.items.some(i => matches(i, pathname))
          if (!showText) {
            // Collapsed: one icon per category → tooltip on hover, items fly out on click
            return (
              <button key={g.section} className={`nav-cat-icon${hasActive ? ' active' : ''}${flyout?.section === g.section ? ' on' : ''}`}
                aria-label={g.section}
                onMouseEnter={e => !flyout && showTip(e, g.section)} onMouseLeave={hideTip}
                onClick={e => { hideTip(); const r = e.currentTarget.getBoundingClientRect(); setFlyout(f => f?.section === g.section ? null : { section: g.section, top: r.top }) }}>
                {g.icon}
                {g.items.some(i => i.badge) && inboxCount > 0 && <span className={`nav-badge on-btn${inboxUrgent ? ' urgent' : ''}`}>{inboxCount}</span>}
              </button>
            )
          }
          const isOpen = open === g.section
          return (
            <div key={g.section} className={`nav-cat${isOpen ? ' open' : ''}`}>
              <button className={`nav-cat-hd${hasActive ? ' has-active' : ''}`} onClick={() => setOpen(isOpen ? null : g.section)} aria-expanded={isOpen}>
                <span className="nav-icon">{g.icon}</span>
                <span className="nav-label">{g.section}</span>
                {g.items.some(i => i.badge) && inboxCount > 0 && !isOpen
                  ? <span className={`nav-badge${inboxUrgent ? ' urgent' : ''}`}>{inboxCount}</span>
                  : <span className="nav-cat-count">{g.items.length}</span>}
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
        {onSwitchMode && (
          <button className="nav-mode-btn" onClick={onSwitchMode}
            onMouseEnter={e => showTip(e, navMode === 'menu' ? 'Show as sidebar' : 'Use ☰ menu')} onMouseLeave={hideTip}
            title={navMode === 'menu' ? 'Show as sidebar' : 'Use ☰ menu (hide the sidebar)'}
            aria-label={navMode === 'menu' ? 'Show as sidebar' : 'Use hamburger menu'}>
            {navMode === 'menu' ? '📌' : '☰'}
          </button>
        )}
        {showText && onSignOut && <button className="btn btn-ghost btn-sm nav-signout" onClick={onSignOut} title="Sign out">⏻</button>}
      </div>

      {/* Collapsed-mode tooltip + category flyout (fixed, so the slim bar never clips them) */}
      {tip && !showText && <div className="nav-tip" style={{ top: tip.top }}>{tip.text}</div>}
      {flyout && !showText && (
        <div className="nav-flyout" style={{ top: Math.min(flyout.top, window.innerHeight - 260) }}>
          <div className="nav-flyout-hd">{NAV.find(g => g.section === flyout.section)?.icon} {flyout.section}</div>
          {nav.find(g => g.section === flyout.section)?.items.map(i => <Item key={i.label} item={i} />)}
        </div>
      )}
    </aside>
    </>
  )
}
