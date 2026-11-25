import { useState, useEffect, useMemo } from 'react'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { useClientScope, ClientBadge } from '../components/ClientScope'

// 🔍 Asset audits (script 060) — Wanda 25 Nov: kick-off, ad hoc / sample, statutory (3-yearly), annual.
// New audit → scope + sample + period + number of auditors → CoolerCo plans the days, the route per auditor and the finish date.
// Load the auditors (Field app people) → their audit days show in the Field app (🔍 Audits).
// Progress + exceptions (missing, at another store, extra, found at a different location) per audit.
// 📡 Not scanned: coolers not seen at their store for 1 / 2 / 3 months (any scan at the store counts).
const TYPES = [
  ['kickoff', '🚀', 'Kick-off', 'Once: full baseline of every store and cooler'],
  ['adhoc', '🎯', 'Ad hoc / sample', 'A region or area, for a set period'],
  ['statutory', '⚖️', 'Statutory (3-yearly)', 'Every cooler — external legal requirement'],
  ['annual', '📅', 'Annual', 'Every cooler, once a year (when approved)'],
]
const TYPE_LABEL = Object.fromEntries(TYPES.map(([k, i, l]) => [k, `${i} ${l}`]))
const SAMPLES = [['all', 'All stores in the area'], ['random', 'Random %'], ['risk', 'Risk-based %'], ['manual', 'Pick by hand']]
const KIND = { missing: ['❓ Missing', 'red'], found_elsewhere: ['📍 Found at a different location', 'purple'], other_store: ['⚠ At another store', 'orange'], extra: ['➕ Extra (not on record here)', 'neutral'] }
const BUCKET = { never: ['Never scanned', 'red'], m3: ['3+ months', 'red'], m2: ['2 months', 'orange'], m1: ['1 month', 'yellow'], ok: ['Seen this month', 'green'] }
const ERR = { not_allowed: 'Your user may not plan audits (office or supervisor role needed).', client_required: 'Choose a client.', pct_required: 'Give the sample % (1–100).',
  stores_required: 'Tick at least one store.', already_started: 'This audit has started — it can no longer be re-planned or deleted.' }
const fmtD = d => d ? new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) }

export default function Audits() {
  const [view, setView] = useState('audits')
  const [open, setOpen] = useState(null)       // audit id
  const [creating, setCreating] = useState(false)
  const [list, setList] = useState(null)
  const [missing, setMissing] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    supabase.rpc('coolerco_audit_list').then(({ data, error }) => {
      if (error && /does not exist|Could not find/i.test(error.message)) setMissing(true)
      setList(data || [])
    })
  }, [tick])
  const back = () => { setOpen(null); setCreating(false); setTick(t => t + 1) }

  return (
    <>
      <Topbar title="Asset audits" sub="Plan store visits, scan every cooler, find what is missing" />
      <div className="page-content">
        {missing && <div className="notice warn">🔍 Asset audits need database script 060.</div>}
        <div className="seg" role="group" style={{ marginBottom: 10 }}>
          <button className={`seg-btn${view === 'audits' ? ' on' : ''}`} onClick={() => setView('audits')}>🔍 Audits</button>
          <button className={`seg-btn${view === 'notseen' ? ' on' : ''}`} onClick={() => setView('notseen')}>📡 Not scanned at their store</button>
        </div>
        {view === 'notseen' ? <NotScanned /> : creating ? <NewAudit onDone={id => { setCreating(false); setOpen(id); setTick(t => t + 1) }} onCancel={back} />
          : open ? <AuditDetail id={open} onBack={back} /> : (
          <>
            <div className="filters"><button className="btn btn-primary" onClick={() => setCreating(true)}>➕ New audit</button></div>
            {!list ? <div className="load-state"><span className="spinner" /> Loading…</div> : !list.length ? (
              <div className="empty-state"><div className="empty-ico">🔍</div><div>No audits yet. ➕ New audit plans the first one.</div></div>
            ) : (
              <div className="card"><div className="tbl-wrap"><table className="tbl">
                <thead><tr><th>Audit</th><th>Type</th><th>Client</th><th>Period</th><th>Stores</th><th>Coolers</th><th>Exceptions</th><th>Status</th></tr></thead>
                <tbody>{list.map(a => (
                  <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(a.id)}>
                    <td><div className="mono" style={{ fontSize: 11 }}><b>{a.code}</b></div><div style={{ fontSize: 11.5 }}>{a.name}</div></td>
                    <td style={{ fontSize: 11 }}>{TYPE_LABEL[a.audit_type]}</td>
                    <td><ClientBadgeLite code={a.client_code} /></td>
                    <td style={{ fontSize: 11 }}>{fmtD(a.period_start)} → {fmtD(a.finish)}{a.period_end && a.finish > a.period_end ? <span className="tag tag-red" style={{ marginLeft: 4 }}>after {fmtD(a.period_end)}</span> : null}</td>
                    <td style={{ fontSize: 11 }}>{a.visited}/{a.stores}</td>
                    <td style={{ fontSize: 11 }}>{a.found}/{a.coolers} found</td>
                    <td style={{ fontSize: 11 }}>{a.missing ? <span className="tag tag-red">❓ {a.missing}</span> : null} {a.other_store ? <span className="tag tag-orange">⚠ {a.other_store}</span> : null} {a.extra ? <span className="tag tag-neutral">➕ {a.extra}</span> : null}</td>
                    <td><StatusTag s={a.status} /></td>
                  </tr>))}
                </tbody>
              </table></div></div>)}
          </>)}
      </div>
    </>
  )
}

function ClientBadgeLite({ code }) { const scope = useClientScope(); return <ClientBadge scope={scope} code={code} small /> }
const StatusTag = ({ s }) => <span className={`tag tag-${{ planned: 'accent', in_progress: 'orange', done: 'green', cancelled: 'neutral' }[s] || 'neutral'}`}>{{ planned: '📝 Planned', in_progress: '🚶 In progress', done: '✅ Done', cancelled: 'Cancelled' }[s] || s}</span>

// ── ➕ New audit ─────────────────────────────────────────────────────────────────────────────
function NewAudit({ onDone, onCancel }) {
  const scope = useClientScope()
  const [f, setF] = useState({ audit_type: 'adhoc', client_code: '', regions: [], sample_method: 'all', sample_pct: 20, outlets: [], period_start: tomorrow(), period_end: '', auditors: 2, minutes_per_store: 10, minutes_per_cooler: 3, name: '' })
  const [outlets, setOutlets] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  useEffect(() => { if (!f.client_code && scope.clients?.length) set('client_code', scope.clients[0].code) }, [scope.clients])
  useEffect(() => {
    if (!f.client_code) return
    supabase.from('coolerco_outlets').select('outlet_code,name,region,warehouse_code,town').eq('client_code', f.client_code).order('region').order('name').limit(5000)
      .then(({ data }) => setOutlets(data || []))
    setF(x => ({ ...x, regions: [], outlets: [] }))
  }, [f.client_code])
  const regions = useMemo(() => [...new Set(outlets.map(o => o.region).filter(Boolean))], [outlets])
  const inScope = outlets.filter(o => !f.regions.length || f.regions.includes(o.region))
  const toggle = (k, v) => set(k, f[k].includes(v) ? f[k].filter(x => x !== v) : [...f[k], v])

  async function go() {
    setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('coolerco_audit_create', { p: { ...f, outlets: f.sample_method === 'manual' ? f.outlets : null, period_end: f.period_end || null } })
    setBusy(false)
    if (error) return setErr(error.message)
    if (data?.error) return setErr(ERR[data.error] || data.error)
    onDone(data.id)
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="card-title" style={{ marginBottom: 8 }}>➕ New audit</div>
      <div className="lbl">1 · Type</div>
      <div className="audit-types">
        {TYPES.map(([k, i, l, d]) => (
          <button type="button" key={k} className={`audit-type${f.audit_type === k ? ' on' : ''}`} onClick={() => set('audit_type', k)}>
            <span style={{ fontSize: 20 }}>{i}</span><b>{l}</b><span className="text3" style={{ fontSize: 10.5 }}>{d}</span>
          </button>))}
      </div>
      <div className="lbl" style={{ marginTop: 12 }}>2 · Client and area</div>
      <div className="filters" style={{ gap: 8 }}>
        <select className="field-ctrl" style={{ width: 'auto' }} value={f.client_code} onChange={e => set('client_code', e.target.value)} aria-label="Client">
          {(scope.clients || []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <input className="field-ctrl" style={{ flex: 1, minWidth: 200 }} value={f.name} onChange={e => set('name', e.target.value)} placeholder="Name (optional), e.g. Kick-off Gauteng" />
      </div>
      <div className="chip-row" style={{ marginTop: 6 }}>
        <button type="button" className={`chip-opt${!f.regions.length ? ' on' : ''}`} onClick={() => set('regions', [])}>All regions · {outlets.length} stores</button>
        {regions.map(r => <button type="button" key={r} className={`chip-opt${f.regions.includes(r) ? ' on' : ''}`} onClick={() => toggle('regions', r)}>🗺 {r} · {outlets.filter(o => o.region === r).length}</button>)}
      </div>
      <div className="lbl" style={{ marginTop: 12 }}>3 · Which stores</div>
      <div className="chip-row">
        {SAMPLES.map(([k, l]) => <button type="button" key={k} className={`chip-opt${f.sample_method === k ? ' on' : ''}`} onClick={() => set('sample_method', k)}>{l}</button>)}
        {['random', 'risk'].includes(f.sample_method) && <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="number" className="field-ctrl" style={{ width: 70 }} min={1} max={100} value={f.sample_pct} onChange={e => set('sample_pct', +e.target.value)} />% of {inScope.length} stores</label>}
      </div>
      {f.sample_method === 'risk' && <div className="text3" style={{ fontSize: 10.5 }}>Riskiest first: coolers not scanned for 3+ months, earlier missing / wrong-store coolers, more coolers.</div>}
      {f.sample_method === 'manual' && (
        <div className="audit-pick">
          {inScope.map(o => (
            <label key={o.outlet_code} className="audit-pick-row">
              <input type="checkbox" checked={f.outlets.includes(o.outlet_code)} onChange={() => toggle('outlets', o.outlet_code)} />
              <span className="mono" style={{ fontSize: 10.5 }}>{o.outlet_code}</span> <span>{o.name}</span> <span className="text3">{o.town} · {o.region}</span>
            </label>))}
        </div>)}
      <div className="lbl" style={{ marginTop: 12 }}>4 · Period, auditors and time per store</div>
      <div className="audit-grid">
        <label>Start<input type="date" className="field-ctrl" value={f.period_start} onChange={e => set('period_start', e.target.value)} /></label>
        <label>Finish by (optional)<input type="date" className="field-ctrl" value={f.period_end} onChange={e => set('period_end', e.target.value)} /></label>
        <label>Auditors<input type="number" min={1} max={50} className="field-ctrl" value={f.auditors} onChange={e => set('auditors', +e.target.value)} /></label>
        <label>Minutes per store<input type="number" min={1} className="field-ctrl" value={f.minutes_per_store} onChange={e => set('minutes_per_store', +e.target.value)} /></label>
        <label>+ minutes per cooler<input type="number" min={0} className="field-ctrl" value={f.minutes_per_cooler} onChange={e => set('minutes_per_cooler', +e.target.value)} /></label>
      </div>
      <div className="text3" style={{ fontSize: 10.5, marginTop: 4 }}>Working day 08:00–16:00, weekends and public holidays skipped. Travel = road distance at 40 km/h; real times are learned once audits are done.</div>
      {err && <div className="form-msg error">{err}</div>}
      <div className="modal-btns" style={{ marginTop: 10 }}>
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !f.client_code || (f.sample_method === 'manual' && !f.outlets.length)} onClick={go}>{busy ? 'Planning…' : '🗺 Plan the audit'}</button>
      </div>
    </div>
  )
}

// ── one audit: plan, auditors, progress + exceptions ─────────────────────────────────────────
function AuditDetail({ id, onBack }) {
  const [d, setD] = useState(null)
  const [rep, setRep] = useState(null)
  const [tab, setTab] = useState('plan')
  const [n, setN] = useState(1)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [people, setPeople] = useState([])
  const load = () => {
    supabase.rpc('coolerco_audit_get', { p_audit: id }).then(({ data }) => { setD(data); if (data?.audit) setN(data.audit.auditors_planned) })
    supabase.rpc('coolerco_audit_report', { p_audit: id }).then(({ data }) => setRep(data))
  }
  useEffect(() => { load(); supabase.rpc('coolerco_audit_people', { p_audit: id }).then(({ data }) => setPeople(data || [])) }, [id])
  if (!d) return <div className="load-state"><span className="spinner" /> Loading…</div>
  if (d.error) return <div className="form-msg error">Audit not found.</div>
  const a = d.audit, s = d.summary || {}, started = d.stores.some(x => x.status !== 'planned')

  async function replan() {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('coolerco_audit_plan', { p_audit: id, p_auditors: n })
    setBusy(false)
    if (error || data?.error) return setMsg({ t: error?.message || ERR[data.error] || data.error, bad: true })
    setMsg({ t: `🗺 Re-planned for ${n} auditor${n > 1 ? 's' : ''}: ${data.days} day(s), finish ${fmtD(data.finish)}.` }); load()
  }
  async function status(st) {
    if (st === 'delete' && !window.confirm('Delete this audit plan?')) return
    const { data } = await supabase.rpc('coolerco_audit_set_status', { p_audit: id, p_status: st })
    if (data?.error) return setMsg({ t: ERR[data.error] || data.error, bad: true })
    if (data?.deleted) return onBack()
    load()
  }
  async function setAuditor(x, slot, area) {
    const { data } = await supabase.rpc('coolerco_audit_set_auditor', { p_auditor: x.id, p_slot: slot || null, p_name: null, p_area: area ?? x.area })
    if (data?.error) return setMsg({ t: ERR[data.error] || data.error, bad: true })
    setMsg({ t: data?.has_login === false ? '⚠ This person has no Field app login yet — create one under Field crew.' : '✅ Auditor saved — the audit days show in their Field app.' }); load()
  }

  const byAud = d.auditors.map(x => ({ ...x, days: groupBy(d.stores.filter(st => st.auditor_id === x.id), st => st.day) }))
  return (
    <>
      <div className="filters" style={{ alignItems: 'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>‹ All audits</button>
        <span className="mono"><b>{a.code}</b></span> <span>{a.name}</span> <ClientBadgeLite code={a.client_code} /> <StatusTag s={a.status} /> <span className="text3" style={{ fontSize: 11 }}>{TYPE_LABEL[a.audit_type]}</span>
      </div>
      {msg && <div className={`form-msg ${msg.bad ? 'error' : 'success'}`}>{msg.t}</div>}
      <div className="stats-row">
        <div className="stat-card c-accent"><div className="stat-label">🏪 Stores</div><div className="stat-value">{s.stores}</div><div className="stat-sub">{d.stores.filter(x => x.status === 'visited').length} visited</div></div>
        <div className="stat-card c-teal"><div className="stat-label">❄️ Coolers on record</div><div className="stat-value">{s.coolers}</div><div className="stat-sub">{rep?.totals?.found ?? 0} found so far</div></div>
        <div className="stat-card c-orange"><div className="stat-label">📅 Days</div><div className="stat-value">{s.days}</div><div className="stat-sub">{fmtD(s.first_day)} → {fmtD(s.finish)}</div></div>
        <div className={`stat-card ${s.late ? 'c-red' : 'c-green'}`}><div className="stat-label">🏁 Finish</div><div className="stat-value" style={{ fontSize: 20 }}>{fmtD(s.finish)}</div><div className="stat-sub">{s.late ? `after the finish-by date ${fmtD(a.period_end)}` : a.period_end ? `in time for ${fmtD(a.period_end)}` : 'no finish-by date'}</div></div>
        <div className="stat-card"><div className="stat-label">⏱ Work</div><div className="stat-value">{s.hours} h</div><div className="stat-sub">{s.km} km driving</div></div>
      </div>
      {d.can_edit && !started && (
        <div className="filters" style={{ alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12 }}>Auditors</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setN(Math.max(1, n - 1))} aria-label="Fewer auditors">−</button>
          <b style={{ minWidth: 20, textAlign: 'center' }}>{n}</b>
          <button className="btn btn-ghost btn-sm" onClick={() => setN(n + 1)} aria-label="More auditors">＋</button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={replan}>{busy ? 'Planning…' : '🗺 Re-plan'}</button>
          <span className="text3" style={{ fontSize: 10.5 }}>More auditors → fewer days and an earlier finish.</span>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => status('delete')}>🗑 Delete plan</button>
        </div>)}
      {d.can_edit && <div className="filters" style={{ gap: 6 }}>
        {a.status === 'planned' && <span className="text3" style={{ fontSize: 11 }}>Load the auditors (tab 👷) — the audit starts with the first scan.</span>}
        {a.status === 'in_progress' && <button className="btn btn-ghost btn-sm" onClick={() => status('done')}>✅ Close the audit</button>}
        {a.status === 'done' && <button className="btn btn-ghost btn-sm" onClick={() => status('in_progress')}>↩ Re-open</button>}
      </div>}
      <div className="seg" role="group" style={{ margin: '8px 0' }}>
        <button className={`seg-btn${tab === 'plan' ? ' on' : ''}`} onClick={() => setTab('plan')}>📅 Plan & routes</button>
        <button className={`seg-btn${tab === 'auditors' ? ' on' : ''}`} onClick={() => setTab('auditors')}>👷 Auditors</button>
        <button className={`seg-btn${tab === 'report' ? ' on' : ''}`} onClick={() => setTab('report')}>📊 Progress & exceptions</button>
      </div>

      {tab === 'plan' && byAud.map(x => (
        <details key={x.id} className="card wh-card" style={{ marginBottom: 10 }} open>
          <summary className="wh-card-hd">
            <div><div className="card-title">👷 {x.label}{x.person_name ? ` · ${x.person_name}` : ''}</div>
              <div className="text3" style={{ fontSize: 10.5 }}>{x.stores} stores · {Object.keys(x.days).length} day(s){x.regions?.length ? ` · ${x.regions.join(', ')}` : ''}</div></div>
            <span className={`tag tag-${x.visited === x.stores && x.stores ? 'green' : 'accent'}`}>{x.visited}/{x.stores} visited</span>
          </summary>
          <div className="audit-days">
            {Object.entries(x.days).map(([day, list]) => {
              const pin = d.start_points[list[0]?.warehouse_code]
              const mins = list.reduce((t, st) => t + st.store_min + (st.travel_min || 0), 0)
              return (
                <div key={day} className="audit-day">
                  <div className="audit-day-hd"><b>{fmtD(day)}</b><span className="text3">{list.length} stores · {Math.round(mins / 6) / 10} h · {Math.round(list.reduce((t, st) => t + (+st.km || 0), 0))} km</span>
                    <a className="btn btn-ghost btn-sm" target="_blank" rel="noreferrer" href={mapsUrl(pin, list)}>🧭 Route in Google Maps</a></div>
                  <ol className="audit-stops">
                    {list.map(st => (
                      <li key={st.id} className={st.status === 'visited' ? 'done' : ''}>
                        <span className="mono text3" style={{ fontSize: 10 }}>{st.eta}</span> <b>{st.name}</b> <span className="text3">{st.outlet_code}</span>
                        <span className="tag tag-neutral" style={{ marginLeft: 4 }}>❄️ {st.coolers}</span>
                        {st.status === 'visited' ? <span className="tag tag-green">✅ {st.found}/{st.coolers}{st.missing ? ` · ❓ ${st.missing}` : ''}</span> : st.status === 'in_progress' ? <span className="tag tag-orange">🚶 {st.found}/{st.coolers}</span> : null}
                        <span className="text3" style={{ fontSize: 10 }}> · {st.km} km</span>
                      </li>))}
                  </ol>
                </div>)
            })}
            {!Object.keys(x.days).length && <div className="text3" style={{ fontSize: 11, padding: 8 }}>No stores for this auditor.</div>}
          </div>
        </details>))}

      {tab === 'auditors' && (
        <div className="card"><div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Auditor</th><th>Person (Field app login)</th><th>Area</th><th>Work</th></tr></thead>
          <tbody>{d.auditors.map(x => (
            <tr key={x.id}>
              <td><b>{x.label}</b></td>
              <td>
                <select className="field-ctrl" style={{ minWidth: 220 }} value={x.slot_id || ''} disabled={!d.can_edit} onChange={e => setAuditor(x, e.target.value)}>
                  <option value="">— choose a person —</option>
                  {people.map(p => <option key={p.slot_id} value={p.slot_id}>{p.person_name} · {p.warehouse_code} {p.worker_type}{p.has_login ? '' : ' (no login yet)'}</option>)}
                </select>
                {x.person_name && !x.has_login && <div className="text3" style={{ fontSize: 10 }}>⚠ No Field app login — create one under 👷 Field crew.</div>}
              </td>
              <td><input className="field-ctrl" defaultValue={x.area || ''} placeholder={(x.regions || []).join(', ') || 'e.g. Soweto + Randburg'} disabled={!d.can_edit}
                         onBlur={e => e.target.value !== (x.area || '') && setAuditor(x, x.slot_id, e.target.value)} /></td>
              <td style={{ fontSize: 11 }}>{x.stores} stores · {x.days} day(s) · {x.visited} visited</td>
            </tr>))}
          </tbody>
        </table></div>
        <div className="text3" style={{ fontSize: 10.5, padding: 8 }}>External auditors without a login get a daily link — coming after the demo.</div></div>)}

      {tab === 'report' && rep && !rep.error && (
        <>
          <div className="chip-row">
            <span className="tag tag-green">✅ Found {rep.totals.found}</span>
            <span className="tag tag-red">❓ Missing {rep.totals.missing}</span>
            <span className="tag tag-purple">📍 Found elsewhere {rep.totals.found_elsewhere}</span>
            <span className="tag tag-orange">⚠ At another store {rep.totals.other_store}</span>
            <span className="tag tag-neutral">➕ Extra {rep.totals.extra}</span>
            <span className="tag tag-accent">⏳ Not yet scanned {rep.totals.pending}</span>
          </div>
          <div className="card" style={{ marginTop: 8 }}><div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Exception</th><th>Cooler</th><th>Store on the audit</th><th>Details</th><th>Manager said</th></tr></thead>
            <tbody>{rep.exceptions.length ? rep.exceptions.map(e => (
              <tr key={e.item}>
                <td><span className={`tag tag-${KIND[e.kind]?.[1]}`}>{KIND[e.kind]?.[0] || e.kind}</span></td>
                <td style={{ fontSize: 11 }}><b className="mono">{e.asset_number}</b><div className="text3">{e.model}</div></td>
                <td style={{ fontSize: 11 }}>{e.store_name} <span className="text3">{e.store} · {e.region}</span></td>
                <td style={{ fontSize: 11 }}>
                  {e.kind === 'found_elsewhere' && <>Seen at <b>{e.found_elsewhere_outlet}</b> on {new Date(e.found_elsewhere_at).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' })} by {e.found_elsewhere_by}</>}
                  {e.kind === 'other_store' && <>On record at {e.registered_at}</>}
                  {e.kind === 'extra' && <>Not on CoolerCo's register (code scanned: {e.asset_number})</>}
                  {e.kind === 'missing' && <>Not scanned at the visit ({e.visited_at ? new Date(e.visited_at).toLocaleDateString('en-ZA') : '—'})</>}
                </td>
                <td style={{ fontSize: 10.5 }}>{e.answers ? <>All covered: {e.answers.all_covered} · Back rooms: {e.answers.back_rooms} · Other stores: {e.answers.other_stores}</> : '—'}</td>
              </tr>)) : <tr><td colSpan={5} className="text3">No exceptions yet.</td></tr>}
            </tbody>
          </table></div></div>
          <div className="card" style={{ marginTop: 8 }}><div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Auditor</th><th>Stores visited</th><th>Coolers scanned</th><th>Store details fixed</th></tr></thead>
            <tbody>{rep.by_auditor.map(x => <tr key={x.label}><td>{x.label}{x.person_name ? ` · ${x.person_name}` : ''}</td><td>{x.visited}/{x.stores}</td><td>{x.scanned}</td><td>{x.fixed}</td></tr>)}</tbody>
          </table></div></div>
        </>)}
    </>
  )
}

function groupBy(arr, fn) { return arr.reduce((m, x) => { const k = fn(x) || 'not planned'; (m[k] ||= []).push(x); return m }, {}) }
function mapsUrl(pin, list) {
  const pts = list.filter(s => s.lat != null).map(s => `${s.lat},${s.lng}`)
  const start = pin ? `${pin[0]},${pin[1]}` : pts[0]
  return `https://www.google.com/maps/dir/${[start, ...pts.slice(0, 9), start].map(encodeURIComponent).join('/')}`
}

// ── 📡 Not scanned at their store ──────────────────────────────────────────────────────────
function NotScanned() {
  const scope = useClientScope()
  const [client, setClient] = useState('')
  const [rows, setRows] = useState(null)
  const [b, setB] = useState('')
  const [group, setGroup] = useState('region')
  useEffect(() => {
    setRows(null)
    supabase.rpc('coolerco_not_scanned', { p_client: client || null, p_warehouse: null }).then(({ data }) => setRows(data || []))
  }, [client])
  const all = rows || []
  const late = all.filter(r => r.bucket !== 'ok')
  const shown = all.filter(r => b ? r.bucket === b : r.bucket !== 'ok')
  const groups = groupBy(late, r => r[group] || '—')
  return (
    <>
      <div className="filters" style={{ gap: 8 }}>
        <select className="field-ctrl" style={{ width: 'auto' }} value={client} onChange={e => setClient(e.target.value)} aria-label="Client">
          <option value="">All clients</option>{(scope.clients || []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <span className="text3" style={{ fontSize: 11 }}>Coolers at a store, by when they were last scanned there (audit, driver / technician job, delivery).</span>
      </div>
      <div className="stats-row">
        {['m1', 'm2', 'm3', 'never', 'ok'].map(k => (
          <button key={k} type="button" className={`stat-card c-${{ m1: 'orange', m2: 'orange', m3: 'red', never: 'red', ok: 'green' }[k]}`} aria-pressed={b === k} onClick={() => setB(b === k ? '' : k)}
                  style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', outline: b === k ? '2px solid var(--accent)' : 'none' }}>
            <div className="stat-label">{BUCKET[k][0]}</div><div className="stat-value">{rows ? all.filter(r => r.bucket === k).length : '…'}</div>
            <div className="stat-sub">{k === 'ok' ? 'scanned in the last 30 days' : k === 'never' ? 'no scan on record' : 'not scanned at the store'}</div>
          </button>))}
      </div>
      <div className="card" style={{ marginBottom: 8 }}>
        <div className="card-header"><span className="card-title">Not scanned for a month or more, by</span>
          <div className="seg">{[['region', 'Region'], ['rep_code', 'Rep'], ['warehouse_code', 'Warehouse']].map(([k, l]) => <button key={k} className={`seg-btn${group === k ? ' on' : ''}`} onClick={() => setGroup(k)}>{l}</button>)}</div></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>{{ region: 'Region', rep_code: 'Rep', warehouse_code: 'Warehouse' }[group]}</th><th>1 month</th><th>2 months</th><th>3+ months</th><th>Never</th></tr></thead>
          <tbody>{Object.entries(groups).map(([k, list]) => (
            <tr key={k}><td><b>{k}</b></td>{['m1', 'm2', 'm3', 'never'].map(x => <td key={x}>{list.filter(r => r.bucket === x).length || ''}</td>)}</tr>))}
          </tbody>
        </table></div>
      </div>
      <div className="card"><div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Cooler</th><th>Store</th><th>Region · rep</th><th>Last scanned there</th><th></th></tr></thead>
        <tbody>{!rows ? <tr><td colSpan={5}><span className="spinner" /></td></tr> : shown.slice(0, 500).map(r => (
          <tr key={r.client_code + r.asset_number}>
            <td style={{ fontSize: 11 }}><b className="mono">{r.asset_number}</b> <ClientBadge scope={scope} code={r.client_code} small /><div className="text3">{r.model}</div></td>
            <td style={{ fontSize: 11 }}>{r.outlet_name} <span className="text3">{r.outlet_code}</span></td>
            <td style={{ fontSize: 11 }}>{r.region} · {r.rep_code}</td>
            <td style={{ fontSize: 11 }}>{r.last_seen ? <>{new Date(r.last_seen).toLocaleDateString('en-ZA')} <span className="text3">({r.days} days)</span></> : '—'}
              {r.seen_elsewhere_outlet && <div><span className="tag tag-purple">📍 Since seen at {r.seen_elsewhere_outlet}</span></div>}</td>
            <td><span className={`tag tag-${BUCKET[r.bucket][1]}`}>{BUCKET[r.bucket][0]}</span></td>
          </tr>))}
        </tbody>
      </table></div></div>
    </>
  )
}
