import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { fmt, num, BAYS, WAREHOUSES, WH_NAMES, condColor } from '../lib/helpers'

// Bay scans → CSV in COM's Asset Touch layout (columns from "Name" onwards, as in COM's own export).
// The three "(Do Not Modify)" columns are left out: these are NEW touches. Bay/area never go to COM.
const COLS = [ // scan fields only — COM fills the (Asset) (Asset) lookups itself
  ['Touched at', r => dt(r.touched_at)],
  ['External Status', r => r.external_status],
  ['Serial Number', r => r.serial_number],
  ['Barcode', r => r.barcode],
  ['Local Code', r => r.local_code],
  ['External Code', r => r.external_code],
  ['Location', r => r.location],
  ['Asset', r => r.asset],
  ['Brand Hierarchy', r => r.brand_hierarchy],
  ['Condition', r => r.condition],
  ['Portal User Created By', r => r.portal_user],
  ['Reporter Type', () => 'Organization'],
  ['Status Reason', (r, o) => o.statusReason],
  ['Record Creation Method', () => 'By Portal/mobile'],
  ['Product Base', r => r.product_base],
  ['Product Variant', r => r.product_variant],
  ['Short Notes', r => r.notes],
]
// Reconciliation report (our records): scan vs assets_live + COM's verdict
const REPORT = [
  ['Touched at', r => dt(r.touched_at)], ['Scanned by', r => r.scanned_by], ['Status', r => r.touch_status], ['Batch', r => r.com_export_batch],
  ['Asset', r => r.asset], ['Barcode', r => r.barcode], ['Local Code', r => r.local_code], ['SAP no.', r => r.sap_number], ['Asset status (COM)', r => r.asset_status],
  ['Mismatch', r => r.any_mismatch ? 'Yes' : 'No'],
  ['Location (scan)', r => r.location], ['Location (COM)', r => r.asset_assign_account], ['Location mismatch', r => yn(r.location_mismatch)],
  ['Condition (scan)', r => r.condition], ['Condition (COM)', r => r.asset_condition], ['Condition mismatch', r => yn(r.condition_mismatch)],
  ['Brand (scan)', r => r.brand_hierarchy], ['Brand (COM)', r => r.asset_brand_hierarchy], ['Brand mismatch', r => yn(r.brand_mismatch)],
  ['Model (scan)', r => r.product_variant], ['Model (COM)', r => r.asset_product_variant], ['Model mismatch', r => yn(r.model_mismatch)],
  ['Serial (scan)', r => r.serial_number], ['Serial (COM)', r => r.asset_serial_number], ['Serial mismatch', r => yn(r.serial_mismatch)],
  ['External Status', r => r.external_status], ['Comments', r => r.notes], ['Photos', r => r.photo_paths?.length || 0],
  ['Area (CoolerCo)', r => r.warehouse_name], ['Bay', r => r.bay], ['Expected bay', r => r.expected_bay], ['Bay OK', r => yn(r.bay_ok !== false)], ['Area OK', r => yn(r.location_ok !== false)],
  ['COM touch', r => r.com_touch_name], ['COM result', r => r.com_status_reason], ['COM message', r => r.com_processing_message],
  ['Latitude', r => r.latitude], ['Longitude', r => r.longitude],
]
const yn = v => (v ? 'Yes' : 'No')
const GPS_COLS = [['Latitude', r => r.latitude], ['Longitude', r => r.longitude]]

// SA time, "2025-10-06 12:26:22" (same as COM's export)
const dt = v => {
  if (!v) return ''
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(new Date(v)).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`
}
const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

export default function ComTouchExport() {
  const today = new Date().toISOString().slice(0, 10)
  const [wh, setWh] = useState('')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [show, setShow] = useState('Submitted') // New | Submitted | Synced | all
  const [latest, setLatest] = useState(true)
  const [mismatchOnly, setMismatchOnly] = useState(false)
  const [opt, setOpt] = useState({ statusReason: 'Submited', gps: true }) // COM spelling; Submited starts COM's touch workflow
  const [rows, setRows] = useState(null)
  const [sel, setSel] = useState({})
  const [msg, setMsg] = useState(null)

  async function load() {
    setRows(null)
    let q = supabase.from('coolerco_com_touch_export').select('*')
      .gte('created_at', new Date(from + 'T00:00:00+02:00').toISOString())
      .lte('created_at', new Date(to + 'T23:59:59+02:00').toISOString())
      .order('created_at', { ascending: false }).limit(2000)
    if (wh) q = q.eq('warehouse_code', wh)
    if (show !== 'all') q = q.eq('touch_status', show)
    if (mismatchOnly) q = q.eq('any_mismatch', true)
    if (latest) q = q.eq('latest_of_day', true)
    const { data, error } = await q
    if (error) setMsg({ type: 'err', text: error.message })
    setRows(data || []); setSel({})
  }
  useEffect(() => { load() }, [wh, from, to, show, latest, mismatchOnly])

  const picked = useMemo(() => (rows || []).filter(r => sel[r.id]), [rows, sel])
  const syncable = picked.filter(r => r.touch_status !== 'New' && r.touch_status !== 'Internal') // Internal = moved inside the warehouse, never sent to COM
  const all = rows?.length && picked.length === rows.length

  function download() {
    const cols = opt.gps ? [...COLS, ...GPS_COLS] : COLS
    const lines = [cols.map(c => csvCell(c[0])).join(','), ...syncable.map(r => cols.map(c => csvCell(c[1](r, opt))).join(','))]
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `CoolerCo_Asset_Touch_${wh || 'ALL'}_${dt(new Date()).replace(/[: ]/g, '-')}.csv`
    a.click(); URL.revokeObjectURL(a.href)
    setMsg({ type: 'ok', text: `⬇ ${syncable.length} touch(es) in the CSV${picked.length > syncable.length ? ` (${picked.length - syncable.length} not submitted yet — left out)` : ''}. After the COM import worked, tap "✓ Mark as synced".` })
  }
  async function report() {
    const XLSX = await import('xlsx')
    const data = (picked.length ? picked : rows || []).map(r => Object.fromEntries(REPORT.map(([h, f]) => [h, f(r) ?? ''])))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Touch reconciliation')
    XLSX.writeFile(wb, `CoolerCo_Touch_Reconciliation_${wh || 'ALL'}_${from}_${to}.xlsx`)
  }
  async function mark(sent) {
    const ids = syncable.map(r => r.id)
    const batch = sent ? `CSV-${dt(new Date())}` : null
    const { error } = await supabase.from('coolerco_asset_touch')
      .update({ touch_status: sent ? 'Synced' : 'Submitted', com_exported_at: sent ? new Date().toISOString() : null, com_export_batch: batch }).in('id', ids)
    setMsg(error ? { type: 'err', text: error.message } : { type: 'ok', text: sent ? `✓ ${ids.length} marked as synced to COM (${batch})` : `↩ ${ids.length} back to Submitted` })
    load()
  }

  return (
    <>
      <Topbar title="COM Touch sync" sub="Bay scans → CSV in COM's Asset Touch layout · bay/area stay in CoolerCo"
        actions={<Link className="btn btn-ghost btn-sm" to="/scan">📷 Scan</Link>} />
      <div className="page-content">
        <div className="filters" style={{ flexWrap: 'wrap' }}>
          <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => setWh(e.target.value)}>
            <option value="">All warehouses</option>
            {WAREHOUSES.map(w => <option key={w} value={w}>{WH_NAMES[w]}</option>)}
          </select>
          <input type="date" className="field-ctrl" style={{ width: 'auto' }} value={from} onChange={e => setFrom(e.target.value)} />
          <input type="date" className="field-ctrl" style={{ width: 'auto' }} value={to} onChange={e => setTo(e.target.value)} />
          <div className="seg">
            {[['New', '📝 New'], ['Submitted', '📤 To sync'], ['Synced', '✅ Synced'], ['all', 'All']].map(([k, l]) => <button key={k} className={`seg-btn${show === k ? ' on' : ''}`} onClick={() => setShow(k)}>{l}</button>)}
          </div>
          <label className="text3" style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={latest} onChange={e => setLatest(e.target.checked)} /> latest scan per asset per day</label>
          <label className="text3" style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={mismatchOnly} onChange={e => setMismatchOnly(e.target.checked)} /> ⚠ mismatches only</label>
          <Link className="btn btn-ghost btn-sm" to="/scan/stocktake">📋 Stock take exceptions</Link>
        </div>

        <details className="sec">
          <summary>⚙ CSV options</summary>
          <div className="sec-body" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: 12 }}>Status Reason&nbsp;
              <select value={opt.statusReason} onChange={e => setOpt({ ...opt, statusReason: e.target.value })}>
                {[['Submited', 'Submited (starts COM workflow)'], ['New', 'New'], ['Accepted', 'Accepted']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></label>
            <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={opt.gps} onChange={e => setOpt({ ...opt, gps: e.target.checked })} /> add Latitude / Longitude columns (scan GPS)</label>
            <div className="text3" style={{ fontSize: 10.5, width: '100%' }}>The CSV holds the scan fields only (COM's own column names). COM numbers the touch and fills the "(Asset) (Asset)" columns itself; those stay in our reconciliation report. Only Submitted scans go into the CSV. Photos stay in CoolerCo.</div>
          </div>
        </details>

        <div className="card">
          <div className="card-header">
            <span className="card-title">
              <input type="checkbox" checked={!!all} onChange={e => setSel(e.target.checked ? Object.fromEntries((rows || []).map(r => [r.id, true])) : {})} /> &nbsp;
              {rows ? `${num(rows.length)} touch(es)` : 'Loading…'} · {picked.length} selected
            </span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" disabled={!syncable.length} onClick={download}>⬇ COM CSV</button>
              <button className="btn btn-ghost btn-sm" disabled={!syncable.length} onClick={() => mark(true)}>✓ Mark as synced</button>
              {show !== 'Submitted' && <button className="btn btn-ghost btn-sm" disabled={!syncable.length} onClick={() => mark(false)}>↩ Back to Submitted</button>}
              <button className="btn btn-ghost btn-sm" disabled={!rows?.length} onClick={report} title="Scan vs COM, with mismatch flags and COM's result">📊 Reconciliation (Excel)</button>
            </div>
          </div>
          {msg && <div className={`form-msg ${msg.type}`} style={{ margin: '0 12px 10px' }}>{msg.text}</div>}
          {!rows ? <div className="load-state"><span className="spinner" /> Loading…</div> : !rows.length ? (
            <div className="empty-state"><div className="empty-ico">📷</div><div>No scans for this period. Scan assets on the <Link to="/scan">Scan</Link> page first.</div></div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th></th><th>Touched</th><th>Barcode / asset</th><th>Location (COM)</th><th>Result</th><th>Condition</th><th>Brand / model</th><th>Bay check</th><th>📸</th><th>Status / COM result</th></tr></thead>
                <tbody>{rows.map(r => {
                  const cc = r.condition !== r.asset_condition, mc = r.product_variant !== r.asset_product_variant, bc = r.brand_hierarchy !== r.asset_brand_hierarchy
                  const eb = BAYS.find(b => b.key === r.expected_bay)
                  return (
                    <tr key={r.id} onClick={() => setSel(s => ({ ...s, [r.id]: !s[r.id] }))}>
                      <td><input type="checkbox" checked={!!sel[r.id]} readOnly /></td>
                      <td className="text3">{fmt(r.touched_at)}<div style={{ fontSize: 10 }}>{r.scanned_by}</div></td>
                      <td className="mono">{r.barcode}{r.any_mismatch && <span className="tag tag-red" style={{ marginLeft: 4 }} title="Scan differs from the COM asset register">⚠ mismatch</span>}<div className="text3" style={{ fontSize: 10 }}>{r.asset}{!r.asset_known && ' · not in assets_live'}</div></td>
                      <td>{r.location}{r.location_mismatch === 'Yes' && <div className="text3" style={{ fontSize: 10 }}>COM: {r.asset_assign_account || '—'}</div>}</td>
                      <td><span className={`tag tag-${/Found in Expected/.test(r.external_status) ? 'green' : 'orange'}`}>{(r.external_status || '').replace('Asset ', '')}</span></td>
                      <td><span className={`tag tag-${condColor(r.condition)}`}>{r.condition}</span>{cc && <div className="text3" style={{ fontSize: 10 }}>was {r.asset_condition}</div>}</td>
                      <td style={{ fontSize: 11 }}>{r.brand_hierarchy}{bc && ' ✎'}<div className="text3">{r.product_variant}{mc && <b style={{ color: 'var(--orange)' }}> ✎ was {r.asset_product_variant}</b>}</div></td>
                      <td>{r.bay_ok === false || r.location_ok === false
                        ? <span className="tag tag-orange" title={`Should be ${eb?.label}`}>⚠ {r.bay_ok === false ? `bay → ${eb?.icon} ${eb?.label}` : 'wrong area'}</span>
                        : <span className="tag tag-green">✓</span>}<div className="text3" style={{ fontSize: 10 }}>{r.warehouse_name} · {r.bay}</div></td>
                      <td>{r.photo_paths?.length || 0}</td>
                      <td>
                        <span className={`tag tag-${r.touch_status === 'Synced' ? 'green' : r.touch_status === 'New' ? 'neutral' : 'blue'}`} title={r.com_export_batch || ''}>{r.touch_status}</span>
                        {r.com_status_reason && <div><span className={`tag tag-${/accept/i.test(r.com_status_reason) ? 'green' : /discard|reject/i.test(r.com_status_reason) ? 'red' : 'neutral'}`} title={r.com_processing_message || ''}>COM: {r.com_status_reason}</span></div>}
                      </td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
