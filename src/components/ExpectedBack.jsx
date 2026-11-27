import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import CameraScan from './CameraScan'
import { WH_NAMES } from '../lib/helpers'

// 📥 Coolers expected back at the warehouse (script 064). A Delivery / Replacement not done at the store means the driver
// loaded the cooler; it counts as back in stock only once that same cooler is scanned at receiving. Magnum scans in the
// Scan app tick it off by themselves; here the warehouse can scan / type any client's cooler. Wrong cooler = flagged.
const saTime = d => (d ? new Date(d).toLocaleString('sv-SE', { timeZone: 'Africa/Johannesburg' }).slice(0, 16) : '')
const STATUS = { open: ['⏳ expected', 'tag-blue'], wrong_asset: ['⛔ wrong cooler back', 'tag-red'], received: ['✅ received', 'tag-green'], cancelled: ['— closed', 'tag-neutral'] }

export default function ExpectedBack() {
  const [rows, setRows] = useState(null)
  const [missing, setMissing] = useState(false)
  const [wh, setWh] = useState(() => localStorage.getItem('cc_return_wh') || '')
  const [view, setView] = useState('open')
  const [code, setCode] = useState('')
  const [cam, setCam] = useState(false)
  const [msg, setMsg] = useState(null)
  const [open, setOpen] = useState(true)
  const load = useCallback(() => {
    supabase.rpc('coolerco_expected_returns_list', { p_warehouse: wh || null, p_status: view }).then(({ data, error }) => {
      if (error) { if (/Could not find|does not exist/i.test(error.message)) setMissing(true); else setMsg({ t: 'err', s: error.message }); setRows([]) } else setRows(data || [])
    })
  }, [wh, view])
  useEffect(() => { load() }, [load])
  useEffect(() => { try { localStorage.setItem('cc_return_wh', wh) } catch { /* private mode */ } }, [wh])
  if (missing) return null

  const receive = async (c, id) => {
    const v = (c || '').trim(); if (!v) return
    const { data, error } = await supabase.rpc('coolerco_expected_return_receive', { p_code: v, p_warehouse: wh || null, p_id: id || null, p_source: 'receiving' })
    if (error) setMsg({ t: 'err', s: error.message })
    else if (data.matched) { setMsg({ t: 'ok', s: `✅ ${data.asset} received for ${data.case} — booked back into stock${data.late ? ' (late)' : ''}.` }); navigator.vibrate?.(80) }
    else if (data.wrong_asset) { setMsg({ t: 'err', s: `⛔ ${data.scanned} is not the cooler loaded for ${data.case} (expected ${data.expected}). Flagged — find the right cooler.` }); navigator.vibrate?.([200, 100, 200]) }
    else setMsg({ t: 'warn', s: `${data.code || v} is not expected back${wh ? ' at this warehouse' : ''}. If it came back from a store, check the case.` })
    setCode(''); load()
  }
  const close = async r => {
    const note = prompt(`Close ${r.asset} (${r.case_number}) without a scan? Say why (e.g. case cancelled in COM and cooler found in the bay, written off):`)
    if (!note) return
    const { error } = await supabase.rpc('coolerco_expected_return_close', { p_id: r.id, p_status: 'cancelled', p_note: note })
    setMsg(error ? { t: 'err', s: error.message } : { t: 'ok', s: 'Closed.' }); load()
  }
  const openCount = (rows || []).filter(r => r.status === 'open' || r.status === 'wrong_asset').length
  const overdue = (rows || []).filter(r => r.overdue).length

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)} style={{ fontWeight: 600 }}>
        {open ? '▾' : '▸'} 📥 Coolers expected back at the warehouse {rows && view === 'open' && <> · {openCount}{overdue ? <span className="tag tag-red" style={{ marginLeft: 6 }}>{overdue} overdue</span> : null}</>}
      </button>
      {open && <>
        <div className="text3" style={{ fontSize: 11.5, margin: '4px 0 8px' }}>A Delivery or Replacement not done at the store: the driver loaded the cooler, so it must come back and be scanned at receiving — the same cooler — before it is back in stock. Magnum scans in the Scan app tick it off automatically.</div>
        <div className="filters" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => setWh(e.target.value)}>
            <option value="">All warehouses</option>
            {Object.entries(WH_NAMES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            <option value="WH-DM-JHB">Demo Gauteng</option><option value="WH-DM-DBN">Demo Durban</option>
          </select>
          <div className="seg">{[['open', 'Expected'], ['today', 'Received today'], ['all', 'All']].map(([k, l]) => <button key={k} className={`seg-btn ${view === k ? 'on' : ''}`} onClick={() => setView(k)}>{l}</button>)}</div>
          <form onSubmit={e => { e.preventDefault(); receive(code) }} style={{ display: 'inline-flex', gap: 4 }}>
            <input className="field-ctrl mono" style={{ width: 190 }} value={code} onChange={e => setCode(e.target.value)} placeholder="Scan / type barcode or AST-…" />
            <button className="btn btn-primary btn-sm" type="submit">📥 Receive</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setCam(true)}>📷</button>
          </form>
        </div>
        {msg && <div className={`form-msg ${msg.t}`}>{msg.s}</div>}
        {cam && <CameraScan onClose={() => setCam(false)} onResult={t => { setCam(false); receive(t) }} />}
        {!rows && <span className="spinner" />}
        {rows?.length === 0 && <div className="text3" style={{ fontSize: 12, padding: 6 }}>{view === 'open' ? 'No coolers expected back.' : 'Nothing here.'}</div>}
        {rows?.length > 0 && <div className="table-wrap"><table className="tbl"><thead><tr><th>Cooler</th><th>Case</th><th>Why not done</th><th>Route · driver</th><th>Expected by</th><th>Status</th><th /></tr></thead><tbody>
          {rows.map(r => <tr key={r.id} style={r.overdue ? { background: 'var(--red-bg)' } : null}>
            <td className="mono" style={{ fontSize: 11.5 }}>{r.bar_code || r.asset}<div className="text3" style={{ fontSize: 10.5 }}>{r.model}</div></td>
            <td className="mono"><a href={`/cases?client=ALL&case=${encodeURIComponent(r.case_number)}`}>{r.case_number}</a><div className="text3" style={{ fontSize: 10.5 }}>{r.case_type} · {r.client_code}</div></td>
            <td style={{ fontSize: 11 }}>{(r.reason || '').replace(/_/g, ' ')}</td>
            <td style={{ fontSize: 11 }}>{r.route_number || '—'}{r.driver ? ` · ${r.driver}` : ''}</td>
            <td style={{ fontSize: 11 }}>{saTime(r.expected_by)}{r.overdue && <div className="tag tag-red">overdue</div>}</td>
            <td><span className={`tag ${STATUS[r.status]?.[1]}`}>{STATUS[r.status]?.[0] || r.status}</span>
              {r.received_at && <div className="text3" style={{ fontSize: 10.5 }}>{saTime(r.received_at)} · {r.received_scan}</div>}
              {r.note && <div className="text3" style={{ fontSize: 10.5 }}>{r.note}</div>}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{(r.status === 'open' || r.status === 'wrong_asset') && <button className="btn btn-ghost btn-sm" onClick={() => close(r)} title="Close without a scan (with a reason)">✕</button>}</td>
          </tr>)}
        </tbody></table></div>}
      </>}
    </div>
  )
}
