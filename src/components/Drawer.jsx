import { useEffect } from 'react'

export default function Drawer({ open, onClose, title, icon, children }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="drawer-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer">
        <div className="drawer-hd">
          {icon && <span style={{ fontSize: 20 }}>{icon}</span>}
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
          </div>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  )
}
