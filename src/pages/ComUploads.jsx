import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { WH_NAMES } from '../lib/helpers'

// ⬆ COM uploads (script 063) — the four files proven in COM UAT on 26 Nov, on COM's own Excel templates.
//   Routing (WPT) · Routing + picking (case update + ASSET PICKED) · Daily · Workshop (repairs, then SERVICE COMPLETE).
//   COM's import does not keep order: one step per case per file, the next waits until the earlier one is ✓ Done in COM.
//   Files are filled in the browser (src/lib/comXlsx.js) so the Excel table range covers every row.
const KINDS = [
  ['routing', '🗺 Routing', 'WITHIN PROPOSED TIME for the cases on finalised routes'],
  ['routing_picking', '📦 Routing + picking', 'Case update (Asset Delivered, Router To, Routed On) + ASSET PICKED'],
  ['daily', '📅 Daily', 'Closures and issues from the Field app / office: SERVICE COMPLETE, TO REPAIR, LOCATION CLOSED …'],
  ['workshop', '🛠 Workshop', 'Repair at Workshop / Decal @WH: WPT, repairs (Case Repair), then SERVICE COMPLETE'],
]
const FILES = {
  notification: { label: '📄 Case Notification', tpl: '/com-templates/case_notification.xlsx', entity: 'noesis_casenotification',
                  how: 'COM → Case Notifications → Import from Excel' },
  case_update: { label: '🧾 Case update (CoolerCo - Picking update view)', entity: 'incident',
                 how: 'COM → Cases → view "CoolerCo - Picking update" → Export to Excel (only these cases) → drop the export here → import the filled file' },
  repair: { label: '🛠 Case Repair', tpl: '/com-templates/case_repair.xlsx', entity: 'noesis_caserepair', how: 'COM → Case Repairs → Import from Excel' },
}
const ORDER = { routing: ['notification'], routing_picking: ['case_update', 'notification'], daily: ['repair', 'notification'], workshop: ['repair', 'notification'] }
const saTime = d => (d ? new Date(d).toLocaleString('sv-SE', { timeZone: 'Africa/Johannesburg' }).slice(0, 16) : '')
const need063 = e => /Could not find|does not exist|PGRST20[25]/i.test(e?.message || '')
const stamp = () => new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Johannesburg' }).slice(0, 16).replace(/[-: ]/g, '')

// one queue line → one row of COM's Case Notification template (as in the files COM UAT accepted on 26 Nov)
function notificationRow(r, routedTo) {
  return {
    'Notification ID': r.notification, Name: r.notification, Notification: r.notification, 'Case Type': r.case_type, Case: r.case_number,
    'Service Date': r.service_at ? new Date(r.service_at) : new Date(), 'Extra Notes': (r.notes || '').slice(0, 1000),
    'Portal User Created by': r.notified_by_portal_user, 'Portal Username': r.notified_by_portal_user, 'Record Creation Method': 'By Portal/mobile',
    'Routed To Portal User': /^ASSET PICKED/.test(r.notification) ? (r.routed_to || routedTo || '') : '',
    'Asset Reference Type': 'Global Code', 'Asset 2 Reference Type': 'Global Code',
    Latitude: r.latitude ?? '', Longitude: r.longitude ?? '',
  }
}

export default function ComUploads({ onMissing }) {
  const [kind, setKind] = useState('routing')
  const [wh, setWh] = useState('')
  const [rows, setRows] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showHeld, setShowHeld] = useState(false)
  const [exportFile, setExportFile] = useState(null)   // the fresh COM export for the case update
  const [tplOverride, setTplOverride] = useState({})     // another template (e.g. production) for this session
  const [routeDate, setRouteDate] = useState(() => new Date().toLocaleDateString('en-CA'))

  const load = useCallback(() => {
    setRows(null); setMsg(null)
    supabase.rpc('coolerco_com_export_rows', { p_kind: kind, p_warehouse: wh || null }).then(({ data, error }) => {
      if (error) { if (need063(error)) onMissing?.(); else setMsg({ t: 'err', s: error.message }); setRows([]) } else setRows(data || [])
    })
  }, [kind, wh, onMissing])
  useEffect(() => { load() }, [load])
  useEffect(() => { setExportFile(null) }, [kind])

  const ready = useMemo(() => (rows || []).filter(r => r.ready), [rows])
  const held = useMemo(() => (rows || []).filter(r => !r.ready), [rows])
  const byFile = f => ready.filter(r => r.file === f)
  // case update: the lines of one case merged (pick → Asset Delivered; routing → Router To + Routed On)
  const caseUpdates = useMemo(() => {
    const m = {}
    for (const r of byFile('case_update')) {
      const u = (m[r.case_number] ||= { ids: [], upd: {} })
      u.ids.push(r.id)
      if (/^ASSET PICKED/.test(r.notification) && r.asset_ref) u.upd['Asset Delivered'] = r.asset_ref
      if (r.notification === 'ROUTE TO INFORMATION' && r.routed_to) { u.upd['Portal User Router To'] = r.routed_to; u.upd['Portal User Routed On'] = new Date(r.service_at || Date.now()) }
    }
    return m
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps

  const files = ORDER[kind].filter(f => (f === 'case_update' ? Object.keys(caseUpdates).length : byFile(f).length))

  const template = async f => {
    if (tplOverride[f]) return tplOverride[f].arrayBuffer()
    const res = await fetch(FILES[f].tpl); if (!res.ok) throw new Error(`Template ${FILES[f].tpl} not found`)
    return res.arrayBuffer()
  }
  const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000) }

  const build = async () => {
    const noUser = ready.filter(r => r.file !== 'case_update' && !r.notified_by_portal_user).length
    if (noUser && !confirm(`${noUser} line(s) have no COM portal user (set it on 👤 COM users). COM may refuse them. Build anyway?`)) return
    setBusy(true); setMsg(null)
    try {
      const X = await import('../lib/comXlsx.js')
      const batch = `COM-${kind}-${stamp()}`
      const notes = []; const markIds = new Set(); const repairIds = []
      for (const f of files) {
        if (f === 'case_update') {
          if (!exportFile) throw new Error('Drop the fresh COM export of the "CoolerCo - Picking update" view first (step 1).')
          const t = await X.readTemplate(await exportFile.arrayBuffer())
          const upd = Object.fromEntries(Object.entries(caseUpdates).map(([k, v]) => [k, v.upd]))
          const res = await X.fillUpdate(t, 'Case Number', upd)
          if (res.missingCols.length) notes.push(`⚠ The export has no ${res.missingCols.join(' / ')} column — add it to the COM view, or those values are not sent.`)
          if (res.missing.length) notes.push(`⚠ Not in the COM export (left for the next file): ${res.missing.join(', ')}`)
          res.found.forEach(k => caseUpdates[k].ids.forEach(id => markIds.add(id)))
          if (res.found.length) save(await X.toBlob(t), `CoolerCo_COM_${batch}_1_CaseUpdate_${res.found.length}.xlsx`)
          continue
        }
        const t = await X.readTemplate(await template(f))
        if (t.entity && FILES[f].entity && t.entity !== FILES[f].entity) throw new Error(`The ${FILES[f].label} template is for "${t.entity}" — choose the right template.`)
        const list = byFile(f)
        let out
        if (f === 'notification') {
          const routed = Object.fromEntries(Object.entries(caseUpdates).map(([k, v]) => [k, v.upd['Portal User Router To']]))
          out = list.map(r => notificationRow(r, routed[r.case_number]))
          list.forEach(r => markIds.add(r.id))
        } else {
          out = list.map(r => ({ Asset: r.asset_ref || '', Case: r.case_number, Repair: r.repair_name || r.repair_code || '' }))
          list.forEach(r => repairIds.push(r.id))
        }
        const res = await X.fillNew(t, out)
        if (res.unknown.length) notes.push(`(not in this template, left out: ${res.unknown.join(', ')})`)
        const n = ORDER[kind].indexOf(f) + 1
        save(await X.toBlob(t), `CoolerCo_COM_${batch}_${n}_${f === 'repair' ? 'CaseRepair' : 'Notifications'}_${out.length}.xlsx`)
      }
      setMsg({ t: notes.some(x => x.startsWith('⚠')) ? 'warn' : 'ok', s: [`⬇ ${files.length} file(s) for batch ${batch}.`, ...notes].join('\n') })
      if ((markIds.size || repairIds.length) && confirm(`Mark ${markIds.size + repairIds.length} line(s) as exported (batch ${batch})?\n\nImport the files in COM UAT in the order of their number, then come back and tick ✓ Done in COM on the Exported tab.`)) {
        if (markIds.size) { const { error } = await supabase.rpc('coolerco_com_updates_mark', { p_ids: [...markIds], p_status: 'exported', p_batch: batch }); if (error) throw error }
        if (repairIds.length) { const { error } = await supabase.rpc('coolerco_com_repairs_mark', { p_ids: repairIds, p_status: 'exported', p_batch: batch }); if (error) throw error }
        load()
      }
    } catch (e) { setMsg({ t: 'err', s: e.message || String(e) }) }
    setBusy(false)
  }

  const wpt = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('coolerco_case_route_events', { p_from: null })
    setBusy(false); setMsg(error ? { t: 'err', s: error.message } : { t: 'ok', s: `${data} Magnum case(s) on a finalised route got WITHIN PROPOSED TIME.` }); load()
  }
  const routeInCom = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('coolerco_com_route_updates', { p_date: routeDate, p_warehouse: wh || null })
    setBusy(false); setMsg(error ? { t: 'err', s: error.message } : { t: 'ok', s: `🚚 ${data.queued} stop(s) queued for Router To / Routed On${data.skipped ? ` · ${data.skipped} skipped` : ''}.` }); load()
  }

  return (
    <div className="card">
      <div className="seg" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
        {KINDS.map(([k, l]) => <button key={k} className={`seg-btn ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      <div className="text3" style={{ fontSize: 11.5, marginBottom: 8 }}>{KINDS.find(k => k[0] === kind)[2]}</div>
      <div className="filters" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => setWh(e.target.value)}>
          <option value="">All warehouses</option>
          {Object.entries(WH_NAMES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
        {kind === 'routing' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={wpt} title="Finalised routes are picked up automatically; this catches anything missed">✅ Find WPT steps</button>}
        {kind === 'routing_picking' && <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <input type="date" className="field-ctrl" style={{ width: 'auto' }} value={routeDate} onChange={e => setRouteDate(e.target.value)} />
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={routeInCom} title="Every stop of that day's finalised routes → Portal User Router To = the route's driver / technician">🚚 Add routing for the day</button>
        </span>}
        <button className="btn btn-ghost btn-sm" onClick={load}>↻</button>
      </div>

      {kind === 'workshop' && <Workshop wh={wh} onChange={load} setMsg={setMsg} />}
      {msg && <div className={`form-msg ${msg.t}`} style={{ whiteSpace: 'pre-line' }}>{msg.s}</div>}
      {!rows && <div className="load-state"><span className="spinner" /></div>}

      {rows && <>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
          <span className="tag tag-green">✓ ready&nbsp;<b>{ready.length}</b></span>
          <button className="tag tag-orange" style={{ cursor: 'pointer', border: 0 }} onClick={() => setShowHeld(s => !s)}>⏳ waiting&nbsp;<b>{held.length}</b> {showHeld ? '▴' : '▾'}</button>
        </div>
        {ready.length === 0 && <div className="text3" style={{ fontSize: 12, padding: 6 }}>Nothing ready for this upload{held.length ? ' — the waiting lines show why.' : '.'}</div>}

        {files.map((f, i) => <div key={f} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, margin: '8px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <b style={{ fontSize: 12.5 }}>{i + 1}. {FILES[f].label} · {f === 'case_update' ? Object.keys(caseUpdates).length : byFile(f).length} row(s)</b>
            {f !== 'case_update' && <label className="text3" style={{ fontSize: 11, cursor: 'pointer' }}>
              {tplOverride[f] ? `📎 ${tplOverride[f].name} ✕` : '📎 use another COM template'}
              <input type="file" accept=".xlsx" hidden onChange={e => setTplOverride(o => ({ ...o, [f]: e.target.files[0] || undefined }))} />
            </label>}
          </div>
          <div className="text3" style={{ fontSize: 11 }}>{FILES[f].how}</div>
          {f === 'case_update' && <div style={{ marginTop: 6 }}>
            <div className="text3" style={{ fontSize: 11 }}>Cases: <span className="mono">{Object.keys(caseUpdates).join(', ')}</span>
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => navigator.clipboard?.writeText(Object.keys(caseUpdates).join('\n'))}>📋 Copy</button></div>
            <label className={`btn btn-sm ${exportFile ? 'btn-ghost' : 'btn-primary'}`} style={{ marginTop: 6 }}>
              {exportFile ? `✓ ${exportFile.name}` : '📂 Drop / choose the COM export'}
              <input type="file" accept=".xlsx" hidden onChange={e => setExportFile(e.target.files[0] || null)} />
            </label>
          </div>}
          <div className="table-wrap" style={{ marginTop: 6 }}><table className="tbl"><thead><tr><th>Case</th><th>Type</th><th>{f === 'repair' ? 'Repair' : 'Step'}</th><th>When (SA)</th><th>By (COM user)</th><th>Detail</th></tr></thead><tbody>
            {(f === 'case_update' ? byFile('case_update') : byFile(f)).map(r => <tr key={r.file + r.id}>
              <td className="mono"><a href={`/cases?case=${encodeURIComponent(r.case_number)}`}>{r.case_number}</a></td>
              <td>{r.case_type}</td>
              <td>{f === 'repair' ? <RepairPick r={r} onSaved={load} /> : <b>{f === 'case_update' ? (/^ASSET PICKED/.test(r.notification) ? 'Asset Delivered' : 'Router To / Routed On') : r.notification}</b>}</td>
              <td>{saTime(r.service_at)}</td>
              <td className="mono">{r.notified_by_portal_user || <span className="tag tag-red">no COM user</span>}</td>
              <td style={{ fontSize: 11 }}>{r.asset_ref && <span className="mono">📦 {r.asset_ref} </span>}{r.routed_to && <>🚚 {r.routed_to} </>}{f !== 'repair' && r.notes}</td>
            </tr>)}
          </tbody></table></div>
        </div>)}

        {files.length > 0 && <button className="btn btn-primary" disabled={busy} onClick={build}>{busy ? 'Building…' : `⬇ Build ${files.length} file(s) for COM`}</button>}
        {kind === 'routing_picking' && files.length > 1 && <div className="text3" style={{ fontSize: 11, marginTop: 6 }}>Import in COM in file order: 1 the case update, then 2 the ASSET PICKED notifications.</div>}
        {(kind === 'workshop' || kind === 'daily') && <div className="text3" style={{ fontSize: 11, marginTop: 6 }}>COM needs the repairs on the case before SERVICE COMPLETE: the repair file goes first; SERVICE COMPLETE follows in the next file once the repairs are ✓ Done in COM.</div>}

        {showHeld && held.length > 0 && <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl"><thead><tr><th>Case</th><th>Step</th><th>COM status</th><th>Why it waits</th></tr></thead><tbody>
          {held.map(r => <tr key={r.file + r.id}>
            <td className="mono">{r.case_number}</td>
            <td>{r.file === 'repair' ? <RepairPick r={r} onSaved={load} /> : r.notification}{r.file === 'case_update' && <span className="text3"> (case update)</span>}</td>
            <td>{r.com_status || '—'}</td><td style={{ fontSize: 11 }}>⏳ {r.hold_reason}</td>
          </tr>)}
        </tbody></table></div>}
      </>}
    </div>
  )
}

let repairNames = null
function RepairPick({ r, onSaved }) {
  const [v, setV] = useState(r.repair_name || r.repair_code || '')
  const [names, setNames] = useState(repairNames || [])
  useEffect(() => {
    if (repairNames) return
    supabase.rpc('coolerco_com_repair_names').then(({ data }) => { repairNames = [...new Set((data || []).map(x => x.repair_name))]; setNames(repairNames) })
  }, [])
  const known = names.includes(v)
  const saveIt = async () => {
    if (v === (r.repair_name || '')) return
    const { error } = await supabase.rpc('coolerco_com_repair_save', { p_id: r.id, p_case: r.case_number, p: { repair_name: v } })
    if (!error) onSaved?.()
  }
  return <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
    <input className="field-ctrl" list="com-repair-names" style={{ minWidth: 200, fontSize: 12 }} value={v} onChange={e => setV(e.target.value)} onBlur={saveIt} placeholder="COM repair, e.g. ADJUST THERMOSTAT" />
    {v && !known && names.length > 0 && <span className="tag tag-orange" title="COM only accepts its own repair names">not a COM repair</span>}
    <datalist id="com-repair-names">{names.slice(0, 600).map(n => <option key={n} value={n} />)}</datalist>
  </span>
}

function Workshop({ wh, onChange, setMsg }) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState(null)
  const [sel, setSel] = useState([])
  const [addCase, setAddCase] = useState('')
  useEffect(() => {
    if (!open) return
    setList(null); setSel([])
    supabase.rpc('coolerco_com_workshop_candidates', { p_warehouse: wh || null }).then(({ data, error }) => { if (error) setMsg({ t: 'err', s: error.message }); setList(data || []) })
  }, [open, wh, setMsg])
  const queue = async () => {
    const { data, error } = await supabase.rpc('coolerco_com_workshop_wpt', { p_cases: sel, p_note: 'Received at the workshop' })
    setMsg(error ? { t: 'err', s: error.message } : { t: 'ok', s: `${data} workshop case(s) got WITHIN PROPOSED TIME (by the warehouse's workshop user).` })
    setOpen(false); onChange()
  }
  const addRepair = async () => {
    const c = addCase.trim().toUpperCase(); if (!c) return
    const { error } = await supabase.rpc('coolerco_com_repair_save', { p_id: null, p_case: c, p: {} })
    setMsg(error ? { t: 'err', s: error.message } : { t: 'ok', s: `Repair line added to ${c} — choose the COM repair below.` })
    setAddCase(''); onChange()
  }
  return <div style={{ margin: '8px 0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
    <button className="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)}>📥 Workshop cases → WPT {open ? '▴' : '▾'}</button>
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <input className="field-ctrl" style={{ width: 170 }} placeholder="CAS-… (COM case)" value={addCase} onChange={e => setAddCase(e.target.value)} />
      <button className="btn btn-ghost btn-sm" onClick={addRepair}>＋ Add repair</button>
    </span>
    {open && <div style={{ width: '100%' }}>
      {!list && <span className="spinner" />}
      {list?.length === 0 && <div className="text3" style={{ fontSize: 12 }}>No open workshop cases in COM for this warehouse.</div>}
      {list?.length > 0 && <>
        <div className="table-wrap"><table className="tbl"><thead><tr><th /><th>Case</th><th>Type</th><th>COM status</th><th>Asset</th><th>Already queued</th></tr></thead><tbody>
          {list.map(c => <tr key={c.case_number}>
            <td><input type="checkbox" disabled={!!c.queued || c.status_reason === 'In Service'} checked={sel.includes(c.case_number)} onChange={() => setSel(s => (s.includes(c.case_number) ? s.filter(x => x !== c.case_number) : [...s, c.case_number]))} /></td>
            <td className="mono">{c.case_number}</td><td>{c.case_type}</td><td>{c.status_reason}</td><td className="mono" style={{ fontSize: 11 }}>{c.asset}</td><td style={{ fontSize: 11 }}>{c.queued}</td>
          </tr>)}
        </tbody></table></div>
        <button className="btn btn-primary btn-sm" disabled={!sel.length} onClick={queue}>✅ Queue WPT for {sel.length}</button>
      </>}
    </div>}
  </div>
}
