// Cases, assets and stock for CoolerCo clients (Tiger, Demo, Demo Foods …) and
// "All clients". Reads the combined lists coolerco_all_cases / coolerco_all_assets,
// which only return rows the signed-in user may see (warehouse staff: every client
// in their warehouse; client users: their own client).
import StockDetail from '../components/StockDetail'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Topbar from '../components/Topbar'
import DataTable from '../components/DataTable'
import Drawer from '../components/Drawer'
import CaseActions from '../components/CaseActions'
import ModelPhoto from '../components/ModelPhoto'
import { ClientBar, ClientBadge, clientName } from '../components/ClientScope'
import { supabase } from '../lib/supabase'
import { fmt, num, PS, CASE_TYPE_ICON, condColor } from '../lib/helpers'

const clean = s => s.replace(/[,()%*]/g, ' ').trim()
const isLate = r => r.end_date && (r.is_open ? new Date(r.end_date) < new Date() : r.service_closure_date && new Date(r.service_closure_date) > new Date(r.end_date))
function stColor(s) {
  const v = String(s || '').toLowerCase()
  if (['solved', 'completed', 'resolved', 'closed'].includes(v)) return 'green'
  if (['rejected', 'not solved'].includes(v)) return 'red'
  if (['cancelled', 'canceled'].includes(v)) return 'neutral'
  if (['waiting for approval', 'on hold', 'action required', 'waiting'].includes(v)) return 'orange'
  return 'blue'
}
const ClientTag = ({ scope, code }) => <ClientBadge scope={scope} code={code} small />
function Field({ label, children }) { return <div className="dl-field"><div className="lbl">{label}</div><div className="val">{children || '—'}</div></div> }
function Section({ title, open, children }) { return <details className="sec" open={open}><summary>{title}</summary><div className="sec-body">{children}</div></details> }

async function toExcel(rows, sheet, file) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheet)
  XLSX.writeFile(wb, `${file}_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

// ─────────────────────────────── Cases ───────────────────────────────
export function RegisterCases({ scope, initialCase = '' }) {
  const [status, setStatus] = useState(initialCase ? 'all' : 'open')
  const [text, setText] = useState(initialCase)
  const [q, setQ] = useState(clean(initialCase))
  const [type, setType] = useState('')
  const [wh, setWh] = useState('')
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [sel, setSel] = useState(null)
  const [facets, setFacets] = useState({ types: [], whs: [] })
  const [whCounts, setWhCounts] = useState(null) // open cases per warehouse (cards at the top, same as Magnum)
  const [fromLink, setFromLink] = useState(initialCase) // opened from Inbox / Dashboard / a store link
  const [params, setParams] = useSearchParams()
  // back to the normal list: empty search, open cases, link removed from the address
  const clearSearch = () => {
    setText(''); setQ(''); setStatus('open'); setFromLink('')
    if (params.get('case') || params.get('pos')) { const p = new URLSearchParams(params); p.delete('case'); p.delete('pos'); setParams(p, { replace: true }) }
  }
  const closeCase = () => { setSel(null); if (fromLink && fromLink === sel?.case_number) clearSearch() }

  useEffect(() => { const t = setTimeout(() => setQ(clean(text)), 350); return () => clearTimeout(t) }, [text])
  useEffect(() => { setPage(0) }, [q, status, type, wh, scope.client])

  const base = useCallback((sel, opts) => {
    let r = supabase.from('coolerco_all_cases').select(sel, opts)
    if (scope.client !== 'ALL') r = r.eq('client_code', scope.client)
    return r
  }, [scope.client])

  // Case types + warehouses for the filters (this client's CoolerCo cases only: small)
  useEffect(() => {
    base('case_type,warehouse_workshop').neq('source', 'COM').limit(5000).then(({ data }) => {
      const u = k => [...new Set((data || []).map(r => r[k]).filter(Boolean))].sort()
      setFacets({ types: u('case_type'), whs: u('warehouse_workshop') })
    })
  }, [base])

  // open cases per warehouse for the cards (refreshes when a case is closed and the drawer shuts)
  useEffect(() => {
    if (sel) return
    base('warehouse_workshop').eq('is_open', true).limit(20000).then(({ data }) => {
      const m = {}; (data || []).forEach(r => { const k = r.warehouse_workshop || '—'; m[k] = (m[k] || 0) + 1 }); setWhCounts(m)
    })
  }, [base, sel])

  const query = useCallback(() => {
    let r = base('*', { count: 'exact' })
    if (status !== 'all') r = r.eq('is_open', status === 'open')
    if (type) r = r.eq('case_type', type)
    if (wh) r = r.eq('warehouse_workshop', wh)
    if (q) r = r.or(['case_number', 'point_of_sale', 'pos_local_code', 'asset_delivered', 'asset_removed', 'asset_repaired', 'mapped_asset'].map(c => `${c}.ilike.%${q}%`).join(','))
    return r
  }, [base, status, type, wh, q])

  useEffect(() => {
    setLoading(true)
    query().order('created_on', { ascending: false }).range(page * PS, page * PS + PS - 1).then(({ data, count, error }) => {
      setErr(error); setRows(data || []); setCount(count || 0); setLoading(false)
      if (initialCase && page === 0) { const hit = (data || []).find(r => r.case_number === initialCase); if (hit) setSel(hit) }
    })
  }, [query, page])

  async function exportAll() {
    const { data } = await query().order('created_on', { ascending: false }).limit(10000)
    await toExcel((data || []).map(r => ({
      Client: clientName(scope, r.client_code), 'Case number': r.case_number, 'Case type': r.case_type, Status: r.status_reason, Priority: r.priority,
      Warehouse: r.warehouse_workshop, Outlet: r.point_of_sale, 'Outlet code': r.pos_local_code, Rep: r.responsible_ordering_party,
      'Asset delivered': r.asset_delivered, 'Asset removed': r.asset_removed, 'Asset repaired': r.asset_repaired,
      Created: fmt(r.created_on), Due: fmt(r.end_date), Closed: fmt(r.service_closure_date), Late: isLate(r) ? 'Yes' : '',
    })), 'Cases', 'CoolerCo_cases')
  }

  const COLS = [
    { key: 'case_number', label: 'Case #', cls: 'mono', render: v => <strong style={{ fontSize: 11 }}>{v}</strong> },
    { key: 'client_code', label: 'Client', render: v => <ClientTag scope={scope} code={v} /> },
    { key: 'case_type', label: 'Type', render: v => <span className="trunc" style={{ maxWidth: 150, display: 'block' }} title={v}>{CASE_TYPE_ICON[v] || '•'} {v || '—'}</span> },
    { key: 'status_reason', label: 'Status', render: v => <span className={`tag tag-${stColor(v)}`}>{v || '—'}</span> },
    { key: 'end_date', label: 'Due', render: (v, r) => v ? <span className={isLate(r) ? 'tag tag-red' : 'text3'}>{fmt(v)}{isLate(r) ? ' · late' : ''}</span> : <span className="text3">—</span> },
    { key: 'warehouse_workshop', label: 'Warehouse', render: v => <span className="text2">{(v || '—').replace('RTMA ', '')}</span> },
    { key: 'point_of_sale', label: 'Outlet', render: (v, r) => <span className="trunc" style={{ maxWidth: 170, display: 'block' }} title={v}>{v || '—'}{r.pos_local_code ? <span className="text3"> · {r.pos_local_code}</span> : null}</span> },
    { key: '_a', label: 'Asset(s)', cls: 'mono', render: (_, r) => <span className="trunc" style={{ fontSize: 10.5, maxWidth: 170, display: 'block' }}>{[r.asset_delivered && `📦 ${r.asset_delivered}`, r.asset_removed && `↩️ ${r.asset_removed}`, r.asset_repaired && `🛠 ${r.asset_repaired}`].filter(Boolean).join(' ') || (r.requested_product_base ? `wants ${r.requested_product_base}` : '—')}</span> },
    { key: 'created_on', label: 'Created', render: v => <span className="text3">{fmt(v)}</span> },
  ]

  return (
    <>
      <Topbar title="Cases" sub={scope.client === 'ALL' ? 'All clients you may see' : `${clientName(scope, scope.client)} cases`}
        actions={<Link to={`/cases/new${scope.client !== 'ALL' ? `?client=${scope.client}` : ''}`} className="btn btn-primary btn-sm">➕ New case</Link>} />
      <div className="page-content">
        <ClientBar scope={scope} />
        {/* ── Open cases per warehouse: tap to show only that warehouse (tap again for all) ── */}
        <div className="wh-cards" role="group" aria-label="Open cases per warehouse">
          <button type="button" className={`wh-card${!wh ? ' on' : ''}`} onClick={() => setWh('')}>
            <span className="wh-card-n">{whCounts ? Object.values(whCounts).reduce((t, n) => t + n, 0).toLocaleString() : '…'}</span>
            <span className="wh-card-l">All warehouses</span>
          </button>
          {whCounts && Object.entries(whCounts).sort((a, b) => b[1] - a[1]).map(([w, n]) => (
            <button type="button" key={w} className={`wh-card${wh === w ? ' on' : ''}`} aria-pressed={wh === w}
              onClick={() => { setWh(wh === w ? '' : w); setStatus('open') }}>
              <span className="wh-card-n">{n.toLocaleString()}</span>
              <span className="wh-card-l">{w.replace('RTMA ', '')}</span>
            </button>))}
        </div>
        <div className="card search-panel">
          <div className="sp-row">
            <div className="seg">
              {[['open', '📂 Open'], ['closed', '✅ Closed'], ['all', '🗂️ All']].map(([k, l]) => (
                <button type="button" key={k} className={`seg-btn${status === k ? ' on' : ''}`} onClick={() => setStatus(k)}>{l}</button>
              ))}
            </div>
            <div className={`search-wrap sp-text${text.trim() ? ' on' : ''}`}><span className="ico">🔍</span>
              <input type="text" placeholder="Case no., outlet or asset" value={text} onChange={e => setText(e.target.value)} />
              {text && <button type="button" className="search-clear" title="Clear search" aria-label="Clear search" onClick={clearSearch}>✕</button>}
            </div>
            <select value={type} onChange={e => setType(e.target.value)}><option value="">📋 All case types</option>{facets.types.map(t => <option key={t} value={t}>{CASE_TYPE_ICON[t]} {t}</option>)}</select>
            <select value={wh} onChange={e => setWh(e.target.value)}><option value="">🏢 All warehouses</option>{facets.whs.map(w => <option key={w} value={w}>{w}</option>)}</select>
          </div>
          {fromLink && text === fromLink && <div className="link-banner">🔎 Showing only <b className="mono">{fromLink}</b> (opened from a link) <button type="button" className="btn btn-ghost btn-sm" onClick={clearSearch}>✕ Show all open cases</button></div>}
          {err && <div className="form-msg err">Could not load cases: {err.message}</div>}
        </div>
        <div className="card">
          <div className="card-header">
            <span className="card-title">{status === 'open' ? '📂 Open cases' : status === 'closed' ? '✅ Closed cases' : '🗂️ All cases'}</span>
            <span className="card-count">{num(count)} cases</span>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={exportAll} disabled={!count}>⬇ Excel</button>
          </div>
          <DataTable cols={COLS} rows={rows} count={count} page={page} setPage={setPage} onRowClick={setSel} loading={loading} />
        </div>
      </div>
      <Drawer open={!!sel} onClose={closeCase} title={sel?.case_number || 'Case'} icon={CASE_TYPE_ICON[sel?.case_type] || '🔧'}>
        {sel && <RegisterCaseDetail c={sel} scope={scope} />}
      </Drawer>
    </>
  )
}

function RegisterCaseDetail({ c, scope }) {
  const navigate = useNavigate()
  const [events, setEvents] = useState(null)
  const [sla, setSla] = useState(null)
  useEffect(() => {
    if (c.source === 'COM') { setEvents([]); return }
    supabase.from('coolerco_cases').select('sla_class,sla_hours,sla_override,priority,symptom_code,product_impact,repeat_of_case').eq('case_number', c.case_number).maybeSingle()
      .then(({ data }) => setSla(data || null))
    supabase.from('coolerco_case_events').select('created_at,from_status,to_status,notes,actor_label').eq('case_number', c.case_number).order('created_at')
      .then(({ data }) => setEvents(data || []))
  }, [c.case_number])
  const assets = [['📦 Delivered', c.asset_delivered], ['↩️ Removed', c.asset_removed], ['🛠 Repaired', c.asset_repaired]].filter(a => a[1])
  return (
    <div>
      <div className="chip-row">
        <ClientTag scope={scope} code={c.client_code} />
        <span className="tag tag-neutral">{c.case_type}</span>
        <span className={`tag tag-${stColor(c.status_reason)}`}>{c.status_reason}</span>
        {c.priority && <span className={`tag tag-${c.priority === 'High' ? 'red' : 'neutral'}`}>{c.priority} priority</span>}
        {sla?.sla_class && <span className="tag tag-orange" title={`${sla.sla_hours} working hours${sla.sla_override ? ' (set by hand)' : ''}`}>⏱ SLA {sla.sla_class}</span>}
        {sla?.repeat_of_case && <span className="tag tag-red">🔁 Repeat of {sla.repeat_of_case}</span>}
        {isLate(c) && <span className="tag tag-red">⏰ {c.is_open ? 'overdue' : 'closed late'}</span>}
      </div>
      <CaseActions caseNumber={c.case_number} />
      <Section title={`🧊 Assets (${assets.length})`} open>
        {!assets.length && <div className="text3">No asset on this case yet{c.requested_product_base ? ` · requested: ${c.requested_product_base}` : ''}.</div>}
        {assets.map(([role, a]) => (
          <div key={role} className="asset-card"><div className="asset-card-hd">
            <span className="tag tag-blue">{role}</span>
            <button className="linkish mono" onClick={() => navigate(`/assets?client=${scope.client}&q=${encodeURIComponent(a)}`)}>{a} ↗</button>
          </div><ModelPhoto asset={a} /></div>
        ))}
        {c.requested_product_base && assets.length > 0 && <div className="text3" style={{ fontSize: 10.5 }}>Requested: {c.requested_product_base}</div>}
      </Section>
      <Section title="📅 Dates" open>
        <div className="dl-grid">
          <Field label="Created">{fmt(c.created_on)}</Field><Field label="Approved / start">{fmt(c.begin_date)}</Field>
          <Field label="Due">{fmt(c.end_date)}{c.end_date ? ` ${new Date(c.end_date).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}` : ''}</Field><Field label="Closed">{fmt(c.service_closure_date)}</Field>
        </div>
      </Section>
      <Section title="🏪 Outlet & contact">
        <div className="dl-grid">
          <Field label="Outlet">{c.pos_local_code ? <button className="linkish" onClick={() => navigate(`/cases?client=${c.client_code}&pos=${encodeURIComponent(c.pos_local_code)}`)} title="All cases of this store">{c.point_of_sale} ↗</button> : c.point_of_sale}</Field><Field label="Outlet code">{c.pos_local_code}</Field>
          <Field label="Responsible Ordering Party">{c.responsible_ordering_party}</Field><Field label="Address">{c.address}</Field>
          <Field label="Contact">{c.case_contact_name}</Field><Field label="Mobile">{c.case_mobile_number}</Field>
        </div>
      </Section>
      <Section title="👷 Who & where">
        <div className="dl-grid">
          <Field label="Warehouse">{c.warehouse_workshop}</Field><Field label="Logged by">{c.originator}</Field>
          <Field label="Channel">{c.origin}</Field><Field label="Notes">{c.notes}</Field>
        </div>
      </Section>
      {c.source !== 'COM' && (
        <Section title={`🕑 History${events ? ` (${events.length})` : ''}`} open>
          {!events && <div className="text3">Loading…</div>}
          {events?.map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="text3" style={{ minWidth: 92 }}>{fmt(e.created_at)}</span>
              <span><strong>{e.to_status}</strong>{e.notes ? ` · ${e.notes}` : ''}<span className="text3"> · {e.actor_label}</span></span>
            </div>
          ))}
        </Section>
      )}
    </div>
  )
}

// ─────────────────────────────── Assets ───────────────────────────────
export function RegisterAssets({ scope, initialQ = '' }) {
  const [text, setText] = useState(initialQ)
  const [q, setQ] = useState(clean(initialQ))
  const [where, setWhere] = useState('all') // all | Warehouse | Outlet
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [sel, setSel] = useState(null)

  useEffect(() => { const t = setTimeout(() => setQ(clean(text)), 350); return () => clearTimeout(t) }, [text])
  useEffect(() => { setPage(0) }, [q, where, scope.client])

  useEffect(() => {
    setLoading(true)
    let r = supabase.from('coolerco_all_assets').select('*', { count: 'exact' })
    if (scope.client !== 'ALL') r = r.eq('client_code', scope.client)
    else if (!q) r = r.neq('source', 'COM') // "All clients" lists CoolerCo registers; search still finds COM assets
    if (where === 'Warehouse') r = r.in('location_type', ['Warehouse', 'Workshop'])
    if (where === 'Outlet') r = r.in('location_type', ['Outlet', 'Location'])
    if (q) r = r.or(['asset_number', 'bar_code', 'serial_number', 'location_code', 'location_name'].map(c => `${c}.ilike.%${q}%`).join(','))
    r.order('asset_number').range(page * PS, page * PS + PS - 1).then(({ data, count, error }) => {
      setErr(error); setRows(data || []); setCount(count || 0); setLoading(false)
      if (initialQ && count === 1 && page === 0) setSel(data[0])
    })
  }, [scope.client, q, where, page])

  const COLS = [
    { key: 'asset_number', label: 'Asset', cls: 'mono', render: v => <strong style={{ fontSize: 10.5 }}>{v}</strong> },
    { key: 'client_code', label: 'Client', render: v => <ClientTag scope={scope} code={v} /> },
    { key: 'model', label: 'Model', render: v => <span className="trunc" style={{ maxWidth: 170, display: 'block' }} title={v}>{v || '—'}</span> },
    { key: 'branding', label: 'Branding' },
    { key: 'condition', label: 'Cond.', render: v => v ? <span className={`tag tag-${condColor(v)}`}>{v}</span> : '—' },
    { key: 'status', label: 'Status' },
    { key: 'location_name', label: 'Where', render: (v, r) => <span className="trunc" style={{ maxWidth: 190, display: 'block' }} title={v}>{['Outlet', 'Location'].includes(r.location_type) ? '🏪' : '🏭'} {v || r.location_code || '—'}</span> },
  ]

  return (
    <>
      <Topbar title="Assets" sub={scope.client === 'ALL' ? 'All clients you may see' : `${clientName(scope, scope.client)} assets`} />
      <div className="page-content">
        <ClientBar scope={scope} />
        <div className="filters">
          <div className="search-wrap" style={{ flex: '1 1 260px' }}><span className="ico">🔍</span>
            <input type="text" placeholder="Asset number, serial, outlet…" value={text} onChange={e => setText(e.target.value)} />
          </div>
          <div className="seg">
            {[['all', '🗂️ All'], ['Warehouse', '🏭 In warehouse'], ['Outlet', '🏪 At outlets']].map(([k, l]) => (
              <button type="button" key={k} className={`seg-btn${where === k ? ' on' : ''}`} onClick={() => setWhere(k)}>{l}</button>
            ))}
          </div>
        </div>
        {err && <div className="notice warn">Could not load assets: {err.message}</div>}
        <div className="card">
          <div className="card-header"><span className="card-title">🧊 Assets</span><span className="card-count">{num(count)} assets</span></div>
          <DataTable cols={COLS} rows={rows} count={count} page={page} setPage={setPage} onRowClick={setSel} loading={loading} />
        </div>
      </div>
      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel?.asset_number || 'Asset'} icon="🧊">
        {sel && <RegisterAssetDetail a={sel} scope={scope} />}
      </Drawer>
    </>
  )
}

function RegisterAssetDetail({ a, scope }) {
  const navigate = useNavigate()
  const [cases, setCases] = useState(null)
  useEffect(() => {
    const n = a.asset_number
    supabase.from('coolerco_all_cases').select('case_number,case_type,status_reason,created_on,point_of_sale,client_code')
      .or(`asset_delivered.eq.${n},asset_removed.eq.${n},asset_repaired.eq.${n},mapped_asset.eq.${n}`).order('created_on', { ascending: false }).limit(50)
      .then(({ data }) => setCases(data || []))
  }, [a.asset_number])
  return (
    <div>
      <div className="chip-row"><ClientTag scope={scope} code={a.client_code} />{a.status && <span className="tag tag-neutral">{a.status}</span>}</div>
      <Section title="🧊 Asset" open>
        <div className="dl-grid">
          <Field label="Asset number"><span className="mono">{a.asset_number}</span></Field><Field label="Serial"><span className="mono">{a.serial_number}</span></Field>
          <Field label="Model">{a.model}</Field><Field label="Type">{a.asset_type}</Field>
          <Field label="Branding">{a.branding}</Field><Field label="Condition">{a.condition && <span className={`tag tag-${condColor(a.condition)}`}>{a.condition}</span>}</Field>
        </div>
        <ModelPhoto asset={a.asset_number} />
      </Section>
      <Section title="📍 Where is it?" open>
        <div className="dl-grid">
          <Field label="Location">{a.location_type}</Field><Field label="At">{a.location_name}</Field>
          <Field label="Code"><span className="mono">{a.location_code}</span></Field><Field label="Warehouse in charge">{a.warehouse_code}</Field>
        </div>
      </Section>
      <Section title={`🔧 Cases${cases ? ` (${cases.length})` : ''}`} open>
        {!cases && <div className="text3">Loading…</div>}
        {cases && !cases.length && <div className="text3">No cases for this asset.</div>}
        {cases?.map(c => (
          <button key={c.case_number} className="linkish" style={{ display: 'flex', gap: 8, width: '100%', fontSize: 11, padding: '4px 0', textAlign: 'left' }}
            onClick={() => navigate(`/cases?client=${scope.client === 'ALL' ? 'ALL' : c.client_code}&case=${encodeURIComponent(c.case_number)}`)}>
            <span className="mono">{c.case_number}</span><span>{CASE_TYPE_ICON[c.case_type]} {c.case_type}</span>
            <span className={`tag tag-${stColor(c.status_reason)}`}>{c.status_reason}</span><span className="text3">{fmt(c.created_on)}</span>
          </button>
        ))}
      </Section>
    </div>
  )
}

// ─────────────────────────────── Stock ───────────────────────────────
const ST_ICON = s => /ready/i.test(s) ? '🟢' : /await|repair/i.test(s) ? '🟠' : /transit/i.test(s) ? '🔵' : /scrap/i.test(s) ? '⚫' : '⚪'
export function RegisterStock({ scope }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    setRows(null)
    let r = supabase.from('coolerco_all_assets').select('client_code,warehouse_code,status,model,condition,location_type').neq('source', 'COM').in('location_type', ['Warehouse', 'Workshop'])
    if (scope.client !== 'ALL') r = r.eq('client_code', scope.client)
    r.limit(20000).then(({ data, error }) => { setErr(error); setRows(data || []) })
  }, [scope.client])

  const byWh = useMemo(() => {
    const m = {}
    ;(rows || []).forEach(r => {
      const w = m[r.warehouse_code || '—'] ||= { code: r.warehouse_code || '—', total: 0, clients: {}, statuses: {}, models: {} }
      w.total++; w.clients[r.client_code] = (w.clients[r.client_code] || 0) + 1
      w.statuses[r.status || 'Unknown'] = (w.statuses[r.status || 'Unknown'] || 0) + 1
      w.models[r.model || 'Unknown'] = (w.models[r.model || 'Unknown'] || 0) + 1
    })
    return Object.values(m).sort((a, b) => b.total - a.total)
  }, [rows])
  const sorted = o => Object.entries(o).sort((a, b) => b[1] - a[1])

  const [sel, setSel] = useState(null) // warehouse opened for the model / condition / branding drill-down (062)
  return (
    <>
      <Topbar title="Asset Stock" sub={`${scope.client === 'ALL' ? 'All clients' : clientName(scope, scope.client)} · assets in the warehouses`} />
      <div className="page-content">
        <ClientBar scope={scope} />
        {err && <div className="notice warn">Could not load stock: {err.message}</div>}
        {!rows && !err && <div className="load-state"><span className="spinner" /> Loading stock…</div>}
        {rows && !rows.length && <div className="notice">No assets in a warehouse for this client.</div>}
        {sel && (scope.client === 'ALL'
          ? <div className="notice">Pick one client above to see the stock by model, condition and branding.</div>
          : <StockDetail client={scope.client} wh={sel} whName={sel} onClose={() => setSel(null)} />)}
        {byWh.map(w => (
          <details key={w.code} className={`card wh-card${sel === w.code ? ' on' : ''}`} open>
            <summary className="wh-card-hd" title="Open the stock by model, condition and branding"
              onClick={e => { e.preventDefault(); setSel(sel === w.code ? null : w.code); setTimeout(() => document.getElementById('stock-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }}>
              <strong>🏭 {w.code}</strong><span className="card-count">{num(w.total)} assets</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {sorted(w.clients).map(([c, n]) => <span key={c} style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}><ClientTag scope={scope} code={c} /><b style={{ fontSize: 11 }}>{n}</b></span>)}
              </span>
            </summary>
            <div className="wh-card-body">
              <div className="chip-row" style={{ marginBottom: 0 }}>{sorted(w.statuses).map(([s, n]) => <span key={s} className="tag tag-neutral">{ST_ICON(s)} {s} · <strong>{n}</strong></span>)}</div>
              <div className="text3" style={{ fontSize: 11 }}>{sorted(w.models).map(([m, n]) => `${m} ${n}`).join(' · ')}</div>
            </div>
          </details>
        ))}
      </div>
    </>
  )
}
