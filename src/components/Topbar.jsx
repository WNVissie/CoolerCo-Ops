// Every page except the Dashboard shows ‹ Back (all screen sizes): previous page,
// or the Dashboard when the page was opened directly (link, bookmark, new tab).
function goBack() {
  if (window.history.state?.idx > 0) window.history.back() // React Router counts pages opened inside the app
  else window.location.assign('/')
}

export default function Topbar({ title, sub, actions, onMenuClick }) {
  const home = window.location.pathname === '/'
  return (
    <header className="topbar">
      {!home && (
        <button className="topbar-back" onClick={goBack} aria-label="Back"
          title={window.history.state?.idx > 0 ? 'Back to the previous page' : 'Back to the Dashboard'}>
          ‹<span className="topbar-back-txt">Back</span>
        </button>
      )}
      <button
        onClick={onMenuClick}
        className="btn btn-ghost btn-icon"
        style={{ display: 'none' }}
        id="mob-menu-btn"
        aria-label="Menu"
      >☰</button>
      <div style={{ flex: 1 }}>
        <div className="topbar-title">{title}</div>
        {sub && <div className="topbar-sub">{sub}</div>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
    </header>
  )
}
