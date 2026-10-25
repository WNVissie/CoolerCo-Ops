export default function Topbar({ title, sub, actions, onMenuClick }) {
  return (
    <header className="topbar">
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
