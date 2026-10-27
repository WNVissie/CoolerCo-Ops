// Place badge: the SQUARE is the warehouse area, the CIRCLE is the bay.
// e.g. blue square + green circle = NCD WH · Ready to Work.
export const AREA_COLORS = {
  NCD:       { color: '#2563eb', label: 'NCD' },
  BAU:       { color: '#64748b', label: 'Main / BAU' },
  RECEIVING: { color: '#7c3aed', label: 'Receiving' },
  MAIN:      { color: '#0d9488', label: 'Warehouse' },
  WS:        { color: '#a16207', label: 'Workshop' },
}
export const BAY_COLORS = {
  RED: '#dc2626', ORANGE: '#f97316', GREEN: '#16a34a', YELLOW: '#facc15',
  PENDING: '#38bdf8', SCRAP: '#111827', MISSING: '#d1d5db',
}

export default function PlaceBadge({ area, bay, size = 30, title }) {
  const sq = AREA_COLORS[area]?.color || '#cbd5e1'
  const dot = BAY_COLORS[bay]
  return (
    <span className="place-badge" title={title} style={{ width: size, height: size, background: sq, borderRadius: Math.round(size / 6) }}>
      {dot ? <span style={{ width: size * 0.5, height: size * 0.5, background: dot }} /> : <b style={{ fontSize: size * 0.45 }}>?</b>}
    </span>
  )
}

export function PlaceLegend() {
  return (
    <div className="place-legend">
      <span>■ area:</span>
      {Object.entries(AREA_COLORS).map(([k, v]) => <span key={k}><i style={{ background: v.color }} />{v.label}</span>)}
      <span>● bay:</span>
      {[['GREEN', 'RTW'], ['RED', 'Receiving'], ['ORANGE', 'Repair'], ['YELLOW', 'To brand'], ['PENDING', 'In transit'], ['SCRAP', 'Scrap']].map(([k, l]) =>
        <span key={k}><i style={{ background: BAY_COLORS[k], borderRadius: '50%' }} />{l}</span>)}
    </div>
  )
}
