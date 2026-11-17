import { useState, useEffect, useCallback } from 'react'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { WH_NAMES, fmt } from '../lib/helpers'

// 📤 COM updates (script 038) — one rules table turns CoolerCo events into what COM needs, per client and case type.
//   Magnum (COM is master): notifications queue here → ⬇ file for COM's Import from Excel → ✓ marked. CoolerCo never writes COM.
//   Tiger (CoolerCo is master): the same rules are applied directly (status, follow-up cases, asset movements).
//   Tabs: To send · Exported · App vs COM (movements COM hasn't caught up with) · Asset history · Rules · Engine log.
const TABS = [['send', '📤 To send'], ['exported', '📦 Exported'], ['check', '⚠️ App vs COM'], ['history', '🔁 Asset history'], ['rules', '📏 Rules'], ['log', '🧾 Engine log']]
const need038 = e => /does not exist|Could not find|PGRST20[25]/i.test(e?.message || '')
const saTime = d => (d ? new Date(d).toLocaleString('sv-SE', { timeZone: 'Africa/Johannesburg' }).slice(0, 16) : '')
const csvCell = v => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
// COM's import does NOT keep the order of two steps for the same case (the case ends in error) → one file holds at most
// ONE step per case, in the order of COM's process groups (Acknowledge 10 · Information 20 · Issue 100 · Closure 200), and the
// next step of a case waits until the previous one is marked Done in COM (Wanda 17 Nov).
const RANK = n => (n === 'WITHIN PROPOSED TIME' ? 10 : /PICKED|ARRIVED|STARTED|DELAYED/.test(n) ? 20 : /^(SERVICE COMPLETE|TO REPAIR|TO BRAND OR DECAL|TO SCRAP)$/.test(n) ? 200 : 100)
const CHECK_LABEL = { not_at_pos_in_com: '📍 Not at the POS in COM yet', still_at_pos_in_com: '🏪 COM still shows it at the POS', status_differs: '🔤 Status differs', ok: '✅ Matches' }

export default function ComUpdates() {
  const [tab, setTab] = useState('send')
  const [missing, setMissing] = useState(false)
  return (
    <>
      <Topbar title="📤 COM updates" sub="Case steps and asset movements from the app — file for COM (Magnum) · applied directly (Tiger)" />
      <div className="page-content">
        <div className="seg" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
          {TABS.map(([k, l]) => <button key={k} className={`seg-btn ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
        </div>
        {missing && <div className="form-msg warn">This screen needs database script 038 — not applied on this database yet.</div>}
        {!missing && tab === 'send' && <Queue status="to_send" onMissing={() => setMissing(true)} />}
        {!missing && tab === 'exported' && <Queue status="exported" onMissing={() => setMissing(true)} />}
        {!missing && tab === 'check' && <AppVsCom onMissing={() => setMissing(true)} />}
        {!missing && tab === 'history' && <History onMissing={() => setMissing(true)} />}
        {!missing && tab === 'rules' && <Rules onMissing={() => setMissing(true)} />}
        {!missing && tab === 'log' && <EngineLog onMissing={() => setMissing(true)} />}
      </div>
    </>
  )
}

function Queue({ status, onMissing }) {
  const [rows, setRows] = useState(null)
  const [wh, setWh] = useState('')
  const [sel, setSel] = useState([])
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(new Set())   // cases with a step already exported, not yet Done in COM
  const load = useCallback(() => {
    setRows(null); setSel([])
    if (status === 'to_send') supabase.from('coolerco_com_updates').select('case_number').eq('status', 'exported').limit(5000)
      .then(({ data }) => setBlocked(new Set((data || []).map(r => r.case_number))))
    let q = supabase.from('coolerco_com_updates').select('*').eq('status', status).order('service_at', { ascending: true }).limit(2000)
    if (wh) q = q.eq('warehouse', WH_NAMES[wh] ? `RTMA ${WH_NAMES[wh]}` : wh)
    q.then(({ data, error }) => { if (error) { if (need038(error)) onMissing(); else setMsg({ t: 'err', s: error.message }); setRows([]) } else setRows(data || []) })
  }, [status, wh, onMissing])
  useEffect(() => { load() }, [load])

  const findRouteSteps = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('coolerco_case_route_events', { p_from: null })
    setBusy(false)
    setMsg(error ? { t: 'err', s: error.message } : { t: 'ok', s: `${data} case(s) on a finalised route got WITHIN PROPOSED TIME.` })
    load()
  }
  // ready = the first step of its case (by process order, then time) and the case has nothing exported still open in COM
  const ready = new Set()
  if (rows && status === 'to_send') {
    const first = {}
    for (const r of [...rows].sort((a, b) => RANK(a.notification) - RANK(b.notification) || new Date(a.service_at) - new Date(b.service_at)))
      if (!first[r.case_number]) first[r.case_number] = r.id
    rows.forEach(r => { if (first[r.case_number] === r.id && !blocked.has(r.case_number)) ready.add(r.id) })
  }
  const chosen = () => {
    const base = sel.length ? rows.filter(r => sel.includes(r.id)) : rows
    return status === 'to_send' ? base.filter(r => ready.has(r.id)) : base
  }
  const download = async () => {
    const list = chosen()
    if (!list.length) return
    // Column headings follow COM's Case Notification form; replace with the import template's exact headings once Wanda sends it.
    const head = ['Case', 'Notification ID', 'Service Date', 'Receive Date', 'Extra Notes', 'Last Known Location']
    const lines = [head.join(',')].concat(list.map(r => [r.case_number, r.notification, saTime(r.service_at), saTime(r.service_at),
      r.notes || '', r.latitude != null ? `${r.latitude},${r.longitude}` : ''].map(csvCell).join(',')))
    const batch = `COM-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = `CoolerCo_COM_notifications_${batch}.csv`; a.click()
    if (status === 'to_send' && confirm(`Mark these ${list.length} as exported (batch ${batch})?\nImport the file in COM next: Case Notifications → Import from Excel.`)) {
      await mark(list.map(r => r.id), 'exported', batch)
    }
  }
  const mark = async (ids, to, batch) => {
    const { data, error } = await supabase.rpc('coolerco_com_updates_mark', { p_ids: ids, p_status: to, p_batch: batch || null })
    setMsg(error ? { t: 'err', s: error.message } : { t: 'ok', s: `${data} line(s) → ${to}.` })
    load()
  }
  const toggle = id => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]))
  const byNotif = (rows || []).reduce((a, r) => ({ ...a, [r.notification]: (a[r.notification] || 0) + 1 }), {})

  return (
    <div className="card">
      <div className="filters" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => setWh(e.target.value)}>
          <option value="">All warehouses</option>
          {Object.entries(WH_NAMES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
        {status === 'to_send' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={findRouteSteps}>🗺 Find route steps</button>}
        <button className="btn btn-primary btn-sm" disabled={!rows?.length || (status === 'to_send' && !ready.size)} onClick={download}>⬇ File for COM ({status === 'to_send' ? chosen().length : (sel.length || rows?.length || 0)}{status === 'to_send' ? ' — one step per case' : ''})</button>
        {status === 'exported' && <>
          <button className="btn btn-ghost btn-sm" disabled={!sel.length} onClick={() => mark(sel, 'done')}>✓ Done in COM</button>
          <button className="btn btn-ghost btn-sm" disabled={!sel.length} onClick={() => mark(sel, 'to_send')}>↩ Back to send</button>
        </>}
        {status === 'to_send' && <button className="btn btn-ghost btn-sm" disabled={!sel.length} onClick={() => confirm('Skip the selected lines? They will not go to COM.') && mark(sel, 'skipped')}>🚫 Skip</button>}
        <button className="btn btn-ghost btn-sm" onClick={load}>↻</button>
      </div>
      {msg && <div className={`form-msg ${msg.t}`}>{msg.s}</div>}
      {rows && rows.length > 0 && <div className="fb-chips" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
        {Object.entries(byNotif).map(([n, c]) => <span key={n} className="tag tag-neutral">{n} · <b>{c}</b></span>)}</div>}
      {!rows && <div className="load-state"><span className="spinner" /></div>}
      {rows?.length === 0 && <div className="text3" style={{ fontSize: 12, padding: 8 }}>{status === 'to_send' ? 'Nothing waiting for COM. Steps arrive from routes, warehouse picking and Field app job cards.' : 'Nothing exported and waiting.'}</div>}
      {rows?.length > 0 && <div className="table-wrap"><table className="tbl"><thead><tr>
        <th><input type="checkbox" checked={sel.length === rows.length} onChange={e => setSel(e.target.checked ? rows.map(r => r.id) : [])} /></th>
        <th>Case</th><th>Type</th><th>COM notification</th><th>When (SA)</th><th>From</th><th>Notes</th>{status === 'exported' && <th>Batch</th>}
      </tr></thead><tbody>
        {rows.map(r => <tr key={r.id}>
          <td><input type="checkbox" checked={sel.includes(r.id)} onChange={() => toggle(r.id)} /></td>
          <td className="mono"><a href={`/cases?case=${encodeURIComponent(r.case_number)}`}>{r.case_number}</a></td>
          <td>{r.case_type}</td>
          <td><b>{r.notification}</b> <span className="text3">{r.notification_code}</span>
            {status === 'to_send' && (ready.has(r.id) ? <div className="text3" style={{ fontSize: 10, color: '#0d8a50' }}>✓ in the next file</div>
              : <div className="text3" style={{ fontSize: 10 }}>⏳ waits for {blocked.has(r.case_number) ? 'the exported step to be Done in COM' : 'the earlier step of this case'}</div>)}</td>
          <td>{saTime(r.service_at)}</td>
          {status === 'to_send' && null}
          <td>{({ route: '🗺 Route', picking: '📦 Picking', job_card: '📸 Job card', stop_event: '⚠️ Not done' })[r.source] || r.source}</td>
          <td style={{ fontSize: 11, maxWidth: 260 }}>{r.notes}</td>
          {status === 'exported' && <td className="mono" style={{ fontSize: 11 }}>{r.export_batch}</td>}
        </tr>)}
      </tbody></table></div>}
      <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>In COM: Case Notifications → ⋮ → Import from Excel → this file. Then check one case shows the step as <b>Executed</b>. Times are South African time.</div>
    </div>
  )
}

function AppVsCom({ onMissing }) {
  const [rows, setRows] = useState(null)
  const [all, setAll] = useState(false)
  useEffect(() => {
    let q = supabase.from('coolerco_movement_com_check').select('*').order('at', { ascending: false }).limit(1000)
    if (!all) q = q.neq('check_result', 'ok')
    q.then(({ data, error }) => { if (error && need038(error)) onMissing(); setRows(data || []) })
  }, [all, onMissing])
  return (
    <div className="card">
      <div className="filters" style={{ gap: 8 }}>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Show matching ones too</label>
      </div>
      <div className="text3" style={{ fontSize: 11, margin: '4px 0 8px' }}>Movements the app recorded for Magnum that COM's asset register doesn't show yet (COM data as of the last copy). Usually: the COM step wasn't imported yet.</div>
      {!rows && <div className="load-state"><span className="spinner" /></div>}
      {rows?.length === 0 && <div className="text3" style={{ fontSize: 12 }}>✅ COM agrees with everything the app recorded.</div>}
      {rows?.length > 0 && <div className="table-wrap"><table className="tbl"><thead><tr>
        <th>When</th><th>Case</th><th>Asset</th><th>App says</th><th>COM says</th><th>Check</th><th>Days</th></tr></thead><tbody>
        {rows.map((r, i) => <tr key={i}>
          <td>{fmt(r.at)}</td><td className="mono">{r.case_number}</td><td className="mono">{r.bar_code || r.asset}</td>
          <td>{r.movement_code} · {r.to_kind} {r.to_code} {r.status_after ? `· ${r.status_after}` : ''}</td>
          <td>{r.com_location} {r.com_location === 'Location' ? r.com_pos : r.com_account} · {r.com_status}</td>
          <td>{CHECK_LABEL[r.check_result] || r.check_result}</td><td>{r.days_waiting}</td>
        </tr>)}
      </tbody></table></div>}
    </div>
  )
}

function History({ onMissing }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [now, setNow] = useState(null)
  const search = async e => {
    e?.preventDefault()
    if (!q.trim()) return
    setRows(null)
    const [h, n] = await Promise.all([
      supabase.rpc('coolerco_asset_movement_history', { p_asset: q.trim() }),
      supabase.rpc('coolerco_asset_now', { p_asset: q.trim() }),
    ])
    if (h.error && need038(h.error)) return onMissing()
    setRows(h.data || []); setNow((n.data || [])[0] || null)
  }
  return (
    <div className="card">
      <form className="filters" onSubmit={search} style={{ gap: 8 }}>
        <input className="field-ctrl mono" placeholder="Barcode, AST-… or local code" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        <button className="btn btn-primary btn-sm">🔍 Show history</button>
      </form>
      {now?.kind && <div className="form-msg ok">📍 Now: <b>{now.kind}</b> {now.code} · {now.status}</div>}
      {rows?.length === 0 && <div className="text3" style={{ fontSize: 12 }}>No movements recorded by the app for this asset yet.</div>}
      {rows?.length > 0 && <div className="table-wrap"><table className="tbl"><thead><tr>
        <th>When</th><th>Movement</th><th>From → To</th><th>Status</th><th>Case</th><th>Source</th></tr></thead><tbody>
        {rows.map((r, i) => <tr key={i} style={r.reversed ? { opacity: .5, textDecoration: 'line-through' } : null}>
          <td>{fmt(r.at)}</td>
          <td>{r.movement_code ? <><b>{r.movement_code}</b> {r.movement_name}</> : r.movement}</td>
          <td>{r.from_kind ? `${r.from_kind} ${r.from_code || ''} → ${r.to_kind} ${r.to_code || ''}` : '—'}</td>
          <td>{r.status_before || r.status_after ? `${r.status_before || '?'} → ${r.status_after || '='}` : ''}</td>
          <td className="mono">{r.case_number} <span className="text3">{r.client_code}</span></td>
          <td style={{ fontSize: 11 }}>{r.source || r.by_label}{r.expected ? ' · expected' : ''}</td>
        </tr>)}
      </tbody></table></div>}
    </div>
  )
}

function Rules({ onMissing }) {
  const [rows, setRows] = useState(null)
  const [edit, setEdit] = useState({})
  const [msg, setMsg] = useState(null)
  const load = useCallback(() => {
    supabase.from('coolerco_case_rules').select('*').order('case_type').order('event').then(({ data, error }) => {
      if (error && need038(error)) return onMissing()
      setRows(data || [])
    })
  }, [onMissing])
  useEffect(() => { load() }, [load])
  const save = async r => {
    const e = { ...r, ...edit[r.id] }
    const { error } = await supabase.rpc('coolerco_case_rule_save', { p_id: r.id, p_notification: e.notification || '', p_case_status: e.case_status || '', p_active: e.active, p_note: e.note || '' })
    setMsg(error ? { t: 'err', s: error.message } : { t: 'ok', s: `Saved ${r.case_type} / ${r.event}.` })
    setEdit(x => { const y = { ...x }; delete y[r.id]; return y }); load()
  }
  const types = [...new Set((rows || []).map(r => r.case_type))]
  const v = (r, k) => (edit[r.id] && k in edit[r.id] ? edit[r.id][k] : r[k])
  const set = (r, k, val) => setEdit(x => ({ ...x, [r.id]: { ...x[r.id], [k]: val } }))
  return (
    <div className="card">
      <div className="text3" style={{ fontSize: 11, marginBottom: 8 }}>One table for every client: “*” = all clients; a client line (MAGNUM / TIGER) overrides it. Event → COM notification + case status + asset movements + follow-up case. Administrators can change the notification, status, on/off and note.</div>
      {msg && <div className={`form-msg ${msg.t}`}>{msg.s}</div>}
      {!rows && <div className="load-state"><span className="spinner" /></div>}
      {types.map(t => (
        <details key={t} open style={{ marginBottom: 8 }}>
          <summary style={{ fontWeight: 700, cursor: 'pointer' }}>{t}</summary>
          <div className="table-wrap"><table className="tbl"><thead><tr>
            <th>Client</th><th>When</th><th>COM notification</th><th>Case status</th><th>Asset movements</th><th>Follow-up</th><th>On</th><th>Note</th><th></th></tr></thead><tbody>
            {rows.filter(r => r.case_type === t).map(r => <tr key={r.id} style={!r.allowed ? { background: '#fff5f5' } : null}>
              <td>{r.client_code === '*' ? 'all' : r.client_code}</td>
              <td><b>{r.event}</b>{r.needs_approval ? ' 🔐' : ''}{!r.allowed ? ' 🚫' : ''}</td>
              <td><input className="field-ctrl" style={{ fontSize: 11, minWidth: 170 }} value={v(r, 'notification') || ''} onChange={e => set(r, 'notification', e.target.value.toUpperCase())} /></td>
              <td><input className="field-ctrl" style={{ fontSize: 11, width: 110 }} value={v(r, 'case_status') || ''} onChange={e => set(r, 'case_status', e.target.value)} /></td>
              <td style={{ fontSize: 11 }}>{(r.movements || []).map(m => `${m.role} ${m.code}`).join(' · ')}{r.return_loaded ? ' · loaded → back' : ''}{r.follow_up_asset_status ? ` · then ${r.follow_up_asset_status}` : ''}</td>
              <td style={{ fontSize: 11 }}>{r.follow_up_case_type || ''}</td>
              <td><input type="checkbox" checked={!!v(r, 'active')} onChange={e => set(r, 'active', e.target.checked)} /></td>
              <td><input className="field-ctrl" style={{ fontSize: 11, minWidth: 160 }} value={v(r, 'note') || ''} onChange={e => set(r, 'note', e.target.value)} /></td>
              <td>{edit[r.id] && <button className="btn btn-primary btn-sm" onClick={() => save(r)}>💾</button>}</td>
            </tr>)}
          </tbody></table></div>
        </details>))}
    </div>
  )
}

function EngineLog({ onMissing }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    supabase.from('coolerco_engine_log').select('*').order('id', { ascending: false }).limit(100).then(({ data, error }) => {
      if (error && need038(error)) return onMissing()
      setRows(data || [])
    })
  }, [onMissing])
  return (
    <div className="card">
      {!rows && <div className="load-state"><span className="spinner" /></div>}
      {rows?.length === 0 && <div className="text3" style={{ fontSize: 12 }}>Nothing processed yet.</div>}
      {rows?.length > 0 && <div className="table-wrap"><table className="tbl"><thead><tr><th>When</th><th>Case</th><th>Event</th><th>From</th><th>Result</th></tr></thead><tbody>
        {rows.map(r => <tr key={r.id} style={r.result?.error ? { background: '#fff5f5' } : null}>
          <td>{fmt(r.at)}</td><td className="mono">{r.case_number}</td><td>{r.event}</td><td>{r.source}</td>
          <td style={{ fontSize: 11 }}>{r.result?.error ? `❌ ${r.result.error}` : r.result?.skipped ? `⏭ ${r.result.skipped}` : r.result?.refused ? `🚫 ${r.result.refused}` : r.result?.needs_approval ? '🔐 needs supervisor OK' : `✅ ${r.result?.rule || ''}${r.result?.status ? ' → ' + r.result.status : ''}${r.result?.com_update ? ' · COM: ' + r.result.com_update : ''}${r.result?.follow_up ? ' · follow-up ' + r.result.follow_up : ''}${r.result?.movements ? ' · ' + r.result.movements + ' movement(s)' : ''}`}</td>
        </tr>)}
      </tbody></table></div>}
    </div>
  )
}
