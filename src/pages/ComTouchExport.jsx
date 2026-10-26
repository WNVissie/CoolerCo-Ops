import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { fmt, num, BAYS, WAREHOUSES, WH_NAMES, condColor } from '../lib/helpers'

// Bay scans → CSV in COM's Asset Touch layout (columns from "Name" onwards, as in COM's own export).
// The three "(Do Not Modify)" columns are left out: these are NEW touches. Bay/area never go to COM.
const COLS = [
  ['Name', () => ''], // COM numbers the touch (AT-…)
  ['Touched at', r => dt(r.touched_at)],
  ['External Status', r => r.external_status],
  ['Serial Number', r => r.serial_number],
  ['Barcode', r => r.barcode],
  ['Local Code', r => r.local_code],
  ['External Code', r => r.external_code],
  ['Location', r => r.location],
  ['Points of Sale (Location) (Account)', () => ''],
  ['Points of Sale Codes (Location) (Account)', () => ''],
  ['Asset', r => r.asset],
  ['Brand Hierarchy', r => r.brand_hierarchy],
  ['Condition', r => r.condition],
  ['Portal User Created By', r => r.portal_user],
  ['Reporter Type', () => 'Organization'],
  ['Status Reason', (r, o) => o.statusReason],
  ['Created On', r => dt(r.touched_at)],
  ['Record Creation Method', () => 'By Portal/mobile'],
  ['Bar Code (Asset) (Asset)', r => r.barcode],
  ['Condition (Asset) (Asset)', r => r.asset_condition],
  ['External Code (Asset) (Asset)', r => r.external_code],
  ['GPS Latitude (Asset) (Asset)', r => r.asset_gps_latitude],
  ['GPS Longitude (Asset) (Asset)', r => r.asset_gps_longitude],
  ['Last Touch Origin (Asset) (Asset)', () => ''],
  ['Local Code (Asset) (Asset)', r => r.local_code],
  ['Name (Asset) (Asset)', r => r.asset],
  ['POS External Code (Asset) (Asset)', r => r.asset_pos_external_code],
  ['POS Local Code (Asset) (Asset)', r => r.asset_pos_local_code],
  ['Product Base (Asset) (Asset)', r => r.asset_product_base],
  ['Product Variant (Asset) (Asset)', r => r.asset_product_variant],
  ['Related Case (Asset) (Asset)', r => r.asset_related_case],
  ['Location Mismatch', r => r.location_mismatch],
  ['Point of Sales', () => ''],
  ['Product Base', r => r.product_base],
  ['Product Variant', r => r.product_variant],
  ['Short Notes', r => r.notes],
  ['Processing Message', () => ''],
]
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
  const [show, setShow] = useState('unsent') // unsent | sent | all
  const [latest, setLatest] = useState(true)
  const [opt, setOpt] = useState({ statusReason: 'Submited', gps: false }) // COM spelling; Submited starts COM's touch workflow
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
    if (show === 'unsent') q = q.is('com_exported_at', null)
    if (show === 'sent') q = q.not('com_exported_at', 'is', null)
    if (latest) q = q.eq('latest_of_day', true)
    const { data, error } = await q
    if (error) setMsg({ type: 'err', text: error.message })
    setRows(data || []); setSel({})
  }
  useEffect(() => { load() }, [wh, from, to, show, latest])

  const picked = useMemo(() => (rows || []).filter(r => sel[r.id]), [rows, sel])
  const all = rows?.length && picked.length === rows.length

  function download() {
    const cols = opt.gps ? [...COLS, ...GPS_COLS] : COLS
    const lines = [cols.map(c => csvCell(c[0])).join(','), ...picked.map(r => cols.map(c => csvCell(c[1](r, opt))).join(','))]
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `CoolerCo_Asset_Touch_${wh || 'ALL'}_${dt(new Date()).replace(/[: ]/g, '-')}.csv`
    a.click(); URL.revokeObjectURL(a.href)
    setMsg({ type: 'ok', text: `⬇ ${picked.length} touch(es) downloaded. After the COM import worked, tap "Mark as sent".` })
  }
  async function mark(sent) {
    const ids = picked.map(r => r.id)
    const batch = sent ? `CSV-${dt(new Date())}` : null
    const { error } = await supabase.from('coolerco_asset_touch').update({ com_exported_at: sent ? new Date().toISOString() : null, com_export_batch: batch }).in('id', ids)
    setMsg(error ? { type: 'err', text: error.message } : { type: 'ok', text: sent ? `✓ ${ids.length} marked as sent to COM (${batch})` : `↩ ${ids.length} marked as not sent` })
    load()
  }

  return (
    <>
      <Topbar title="COM Touch export" sub="Bay scans → CSV in COM's Asset Touch layout · bay/area stay in CoolerCo"
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
            {[['unsent', 'To send'], ['sent', 'Sent'], ['all', 'All']].map(([k, l]) => <button key={k} className={`seg-btn${show === k ? ' on' : ''}`} onClick={() => setShow(k)}>{l}</button>)}
          </div>
          <label className="text3" style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={latest} onChange={e => setLatest(e.target.checked)} /> latest scan per asset per day</label>
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
            <div className="text3" style={{ fontSize: 10.5, width: '100%' }}>Columns match COM's Asset Touch export from "Name" onwards; Name is left blank so COM numbers the touch. Photos stay in CoolerCo.</div>
          </div>
        </details>

        <div className="card">
          <div className="card-header">
            <span className="card-title">
              <input type="checkbox" checked={!!all} onChange={e => setSel(e.target.checked ? Object.fromEntries((rows || []).map(r => [r.id, true])) : {})} /> &nbsp;
              {rows ? `${num(rows.length)} touch(es)` : 'Loading…'} · {picked.length} selected
            </span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" disabled={!picked.length} onClick={download}>⬇ Download CSV</button>
              <button className="btn btn-ghost btn-sm" disabled={!picked.length} onClick={() => mark(true)}>✓ Mark as sent</button>
              {show !== 'unsent' && <button className="btn btn-ghost btn-sm" disabled={!picked.length} onClick={() => mark(false)}>↩ Not sent</button>}
            </div>
          </div>
          {msg && <div className={`form-msg ${msg.type}`} style={{ margin: '0 12px 10px' }}>{msg.text}</div>}
          {!rows ? <div className="load-state"><span className="spinner" /> Loading…</div> : !rows.length ? (
            <div className="empty-state"><div className="empty-ico">📷</div><div>No scans for this period. Scan assets on the <Link to="/scan">Scan</Link> page first.</div></div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th></th><th>Touched</th><th>Barcode / asset</th><th>Location (COM)</th><th>Result</th><th>Condition</th><th>Brand / model</th><th>Bay check</th><th>📸</th><th>COM</th></tr></thead>
                <tbody>{rows.map(r => {
                  const cc = r.condition !== r.asset_condition, mc = r.product_variant !== r.asset_product_variant, bc = r.brand_hierarchy !== r.asset_brand_hierarchy
                  const eb = BAYS.find(b => b.key === r.expected_bay)
                  return (
                    <tr key={r.id} onClick={() => setSel(s => ({ ...s, [r.id]: !s[r.id] }))}>
                      <td><input type="checkbox" checked={!!sel[r.id]} readOnly /></td>
                      <td className="text3">{fmt(r.touched_at)}<div style={{ fontSize: 10 }}>{r.scanned_by}</div></td>
                      <td className="mono">{r.barcode}<div className="text3" style={{ fontSize: 10 }}>{r.asset}</div></td>
                      <td>{r.location}{r.location_mismatch === 'Yes' && <div className="text3" style={{ fontSize: 10 }}>COM: {r.asset_assign_account || '—'}</div>}</td>
                      <td><span className={`tag tag-${/Found in Expected/.test(r.external_status) ? 'green' : 'orange'}`}>{(r.external_status || '').replace('Asset ', '')}</span></td>
                      <td><span className={`tag tag-${condColor(r.condition)}`}>{r.condition}</span>{cc && <div className="text3" style={{ fontSize: 10 }}>was {r.asset_condition}</div>}</td>
                      <td style={{ fontSize: 11 }}>{r.brand_hierarchy}{bc && ' ✎'}<div className="text3">{r.product_variant}{mc && <b style={{ color: 'var(--orange)' }}> ✎ was {r.asset_product_variant}</b>}</div></td>
                      <td>{r.bay_ok === false || r.location_ok === false
                        ? <span className="tag tag-orange" title={`Should be ${eb?.label}`}>⚠ {r.bay_ok === false ? `bay → ${eb?.icon} ${eb?.label}` : 'wrong area'}</span>
                        : <span className="tag tag-green">✓</span>}<div className="text3" style={{ fontSize: 10 }}>{r.warehouse_name} · {r.bay}</div></td>
                      <td>{r.photo_paths?.length || 0}</td>
                      <td>{r.com_exported_at ? <span className="tag tag-green" title={r.com_export_batch}>sent</span> : <span className="tag tag-neutral">to send</span>}</td>
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
