import { supabase } from './supabase'
import { caseAssets, fmt } from './helpers'

// One call to the server-side search (public.coolerco_case_search).
// Returns { rows, count, error }. Each row is a full case (raw_case left out).
export async function searchCases(f = {}, { limit = 50, offset = 0 } = {}) {
  const { data, error } = await supabase.rpc('coolerco_case_search', {
    p_case_number: f.caseNumber || null,
    p_pos: f.pos || null,
    p_asset: f.asset || null,
    p_warehouse: f.warehouse || null,
    p_case_type: f.caseType || null,
    p_sla_status: f.sla || null,
    p_status: f.status || 'open',
    p_date_field: f.dateField || 'created_on',
    p_from: f.from || null,
    p_to: f.to || null,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) return { rows: [], count: 0, error }
  const rows = (data || []).map(d => d.case_row)
  const count = data?.length ? Number(data[0].total_count) : 0
  return { rows, count, error: null }
}

// Just the number of matching cases (for the export warning) — 1 row comes back.
export async function countCases(f) {
  const { count, error } = await searchCases(f, { limit: 1, offset: 0 })
  return { count, error }
}

const EXPORT_COLS = [
  ['Case Number', 'case_number'], ['Case Type', 'case_type'], ['Status Reason', 'status_reason'],
  ['Motive', 'motive'], ['SLA Status', 'sla_status'], ['SLA Group', 'sla_group'],
  ['SLA Days Late', 'sla_days_late'], ['Warehouse / Workshop', 'warehouse_workshop'],
  ['Point of Sale', 'point_of_sale'], ['POS Local Code', 'pos_local_code'],
  ['Concessionaire', 'responsible_ordering_party'], ['Technician', 'technician_routed_to'],
  ['Contractor', 'contractor'],
  ['Asset Delivered', 'asset_delivered'], ['Asset Removed', 'asset_removed'],
  ['Asset Repaired', 'asset_repaired'], ['Mapped Asset', 'mapped_asset'],
  ['Asset Type', 'asset_type'], ['Asset Condition', 'asset_condition'],
  ['Requested Product Base', 'requested_product_base'], ['Requested Asset Condition', 'requested_asset_condition'],
  ['Requested Brand Hierarchy', 'requested_brand_hierarchy'],
  ['Delivered Asset Condition', 'delivered_asset_condition'], ['Removed Asset Condition', 'removed_asset_condition'],
  ['Removed Product Base', 'removed_product_base'], ['Repaired Asset Condition', 'repaired_asset_condition'],
  ['Current Asset Brand Hierarchy', 'current_asset_brand_hierarchy'],
  ['Created On', 'created_on', true], ['Begin Date', 'begin_date', true], ['End Date', 'end_date', true],
  ['Service Closure Date', 'service_closure_date', true],
  ['Priority', 'priority'], ['Origin', 'origin'], ['Reason', 'reason'],
  ['Contact', 'case_contact_name'], ['Contact Number', 'case_contact_number'], ['Mobile', 'case_mobile_number'],
  ['Address', 'address'], ['Message', 'message'],
]

// Pulls results in pages of 2,000 (fast, small responses) and writes an .xlsx.
// The Excel library is only downloaded when someone actually exports.
export async function exportCases(f, total, onProgress) {
  const XLSX = await import('xlsx')
  const PAGE = 2000
  const all = []
  for (let offset = 0; offset < total; offset += PAGE) {
    const { rows, error } = await searchCases(f, { limit: PAGE, offset })
    if (error) throw error
    all.push(...rows)
    onProgress?.(Math.min(all.length, total), total)
    if (rows.length < PAGE) break
  }
  const sheet = all.map(r => {
    const o = {}
    EXPORT_COLS.forEach(([label, key, isDate]) => { o[label] = isDate ? (r[key] ? fmt(r[key]) : '') : (r[key] ?? '') })
    o['Asset (by case type rule)'] = caseAssets(r).map(a => `${a.role}: ${a.asset}`).join(' | ')
    return o
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'Cases')
  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `CoolerCo_cases_${stamp}.xlsx`)
  return all.length
}
