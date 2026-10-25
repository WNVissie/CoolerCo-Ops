export const PS = 50 // page size

export function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function num(n) {
  return n != null ? Number(n).toLocaleString() : '—'
}

export function slaColor(s) {
  if (!s) return 'tag-neutral'
  if (s.includes('Not Met') || s.includes('Exceeded')) return 'tag-red'
  if (s === 'SLA Met') return 'tag-green'
  if (s.includes('Cancelled')) return 'tag-orange'
  return 'tag-neutral'
}

export function slaLabel(s) {
  if (!s) return '—'
  return s.replace('Open Case SLA ', '').replace('Cancelled - ', '')
}

export function rtStatusColor(s) {
  const m = { saved_draft: 'tag-neutral', finalised: 'tag-blue', dispatched: 'tag-orange', partially_completed: 'tag-orange', completed: 'tag-green', not_used: 'tag-neutral' }
  return m[s] || 'tag-neutral'
}

export function rtStatusLabel(s) {
  const m = { saved_draft: 'Draft', finalised: 'Finalised', dispatched: 'Dispatched', partially_completed: 'Partial', completed: 'Completed', not_used: 'Not Used' }
  return m[s] || s
}

export function condColor(c) {
  const m = { A: 'tag-green', B: 'tag-blue', C: 'tag-orange', D: 'tag-red' }
  return m[c] || 'tag-neutral'
}

export const CATS = [
  { key: 'spares',    icon: '🔧', label: 'Spares',    view: 'v_spare_stock_dashboard' },
  { key: 'baskets',   icon: '🧺', label: 'Baskets',   view: 'v_basket_stock_dashboard' },
  { key: 'decals',    icon: '🏷️', label: 'Decals',    view: 'v_decal_stock_dashboard' },
  { key: 'doors',     icon: '🚪', label: 'Doors',     view: 'v_door_stock_dashboard' },
  { key: 'furniture', icon: '🪑', label: 'Furniture', view: 'v_furniture_stock_dashboard' },
  { key: 'office',    icon: '📎', label: 'Office',    view: 'v_office_stock_dashboard' },
]

export const WAREHOUSES = ['JHB','CPT','BFN','DBN','EL','GEO','NEL','POL','PE']
export const WH_NAMES = {
  JHB:'Gauteng', CPT:'Cape Town', BFN:'Bloemfontein',
  DBN:'Durban', EL:'East London', GEO:'George',
  NEL:'Nelspruit', POL:'Polokwane', PE:'Port Elizabeth'
}
