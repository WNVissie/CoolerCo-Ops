import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useSearchParams, useNavigate } from 'react-router-dom'
import Topbar from '../components/Topbar'
import DataTable from '../components/DataTable'
import Drawer from '../components/Drawer'
import { searchCases, countCases, exportCases } from '../lib/caseSearch'
import {
  fmt, num, PS, slaColor, slaLabel, statusColor, isOpenCase,
  SLA_OPTIONS, CASE_TYPES, CASE_TYPE_ICON, DATE_FIELDS, WAREHOUSES, WH_NAMES, whCaseName,
  caseAssets, caseAssetText, condColor,
} from '../lib/helpers'

const SEARCH_BY = [
  { key: 'caseNumber', label: '🔖 Case no.', ph: 'e.g. CAS-12345' },
  { key: 'pos',        label: '🏪 POS',      ph: 'POS name or POS local code' },
  { key: 'asset',      label: '🧊 Asset',    ph: 'Barcode, local code or asset number' },
]
const MAX_VIEW_DAYS = 62 // on-screen searches are limited to ~2 months; export can go longer

const today = () => new Date().toISOString().slice(0, 10)
const monthsAgo = n => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10) }
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000)

const EMPTY = { by: 'caseNumber', text: '', status: 'open', warehouse: '', caseType: '', sla: '', dateField: 'created_on', from: '', to: '' }

// Turns the form into search parameters + checks the house rules
function buildQuery(form) {
  const q = { status: form.status, caseType: form.caseType, sla: form.sla, dateField: form.dateField, from: form.from, to: form.to }
  if (form.text.trim()) q[form.by] = form.text.trim()
  if (form.warehouse) q.warehouse = whCaseName(form.warehouse)
  const specific = !!(q.caseNumber || q.pos || q.asset)
  // Looking up a specific case / POS / asset finds it whether open or closed
  // (unless "Closed" was chosen on purpose)
  if (specific && form.status === 'open') q.status = 'all'
  if (form.status !== 'open' && !specific) {
    if (!q.warehouse && !q.caseType && !q.sla && !q.from && !q.to) {
      return { error: 'To include closed cases, add a case no., POS, asset, warehouse, case type or a date range.' }
    }
    // No dates given → default to the last 2 months
    if (!q.from && !q.to) { q.from = monthsAgo(2); q.to = today() }
  }
  return { q, specific }
}

export default function Cases() {
  const [params] = useSearchParams()
  const [form, setForm] = useState(() => {
    const a = params.get('asset')
    return a ? { ...EMPTY, by: 'asset', text: a, status: 'all' } : EMPTY
  })
  const [query, setQuery] = useState(() => buildQuery(form).q)
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)
  const [more, setMore] = useState(false)
  const [selected, setSelected] = useState(null)
  const [exp, setExp] = useState(null) // export dialog state

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const load = useCallback(async () => {
    setLoading(true)
    const { rows, count, error } = await searchCases(query, { limit: PS, offset: page * PS })
    if (error) setMsg({ type: 'err', text: error.message })
    setRows(rows); setCount(count); setLoading(false)
  }, [query, page])

  useEffect(() => { load() }, [load])

  function runSearch(e) {
    e?.preventDefault()
    const { q, error } = buildQuery(form)
    if (error) { setMsg({ type: 'warn', text: error }); return }
    if (q.from && q.to && !(q.caseNumber || q.pos || q.asset) && dayDiff(q.from, q.to) > MAX_VIEW_DAYS && form.status !== 'open') {
      setMsg({ type: 'warn', text: 'On-screen searches are limited to 2 months. Shorten the dates, or use ⬇ Export for a longer period.' })
      return
    }
    setMsg(null); setPage(0); setQuery(q)
  }

  function clearAll() { setForm(EMPTY); setMsg(null); setPage(0); setQuery(buildQuery(EMPTY).q) }

  function searchAsset(asset) {
    const f = { ...EMPTY, by: 'asset', text: asset, status: 'all' }
    setForm(f); setSelected(null); setPage(0); setMsg(null); setQuery(buildQuery(f).q)
  }

  // ── Export: count first, warn, then download
  async function startExport() {
    const { q, error } = buildQuery(form)
    if (error) { setMsg({ type: 'warn', text: error }); return }
    setExp({ stage: 'counting', q })
    const { count, error: cErr } = await countCases(q)
    if (cErr) { setExp(null); setMsg({ type: 'err', text: cErr.message }); return }
    const long = q.from && q.to && dayDiff(q.from, q.to) > MAX_VIEW_DAYS
    setExp({ stage: 'confirm', q, count, long })
  }
  async function confirmExport() {
    const { q, count } = exp
    setExp(e => ({ ...e, stage: 'running', done: 0 }))
    try {
      const n = await exportCases(q, count, done => setExp(e => ({ ...e, done })))
      setExp(null); setMsg({ type: 'ok', text: `Downloaded ${num(n)} cases to Excel.` })
    } catch (err) {
      setExp(null); setMsg({ type: 'err', text: err.message })
    }
  }

  const isOpenView = query.status === 'open' && !query.caseNumber && !query.pos && !query.asset && !query.warehouse && !query.caseType && !query.sla && !query.from

  const COLS = [
    { key: 'case_number', label: 'Case #', cls: 'mono', render: v => <strong style={{ fontSize: 11 }}>{v}</strong> },
    { key: 'case_type', label: 'Type', render: v => <span className="trunc" style={{ maxWidth: 150, display: 'block' }} title={v}>{CASE_TYPE_ICON[v] || '•'} {v || '—'}</span> },
    { key: 'status_reason', label: 'Status', render: v => <span className={`tag tag-${statusColor(v)}`}>{v || '—'}</span> },
    { key: 'sla_status', label: 'SLA', render: v => <span className={`tag tag-${slaColor(v)}`}>{slaLabel(v)}</span> },
    { key: 'warehouse_workshop', label: 'Warehouse', render: v => <span className="text2">{(v || '—').replace('RTMA ', '')}</span> },
    { key: 'point_of_sale', label: 'Point of Sale', render: (v, r) => <span className="trunc" style={{ maxWidth: 170, display: 'block' }} title={v}>{v || '—'}{r.pos_local_code ? <span className="text3"> · {r.pos_local_code}</span> : null}</span> },
    { key: '_asset', label: 'Asset(s)', cls: 'mono', render: (_, r) => <span style={{ fontSize: 10.5 }}>{caseAssetText(r)}</span> },
    { key: 'created_on', label: 'Created', render: v => <span className="text3">{fmt(v)}</span> },
    { key: 'service_closure_date', label: 'Closed', render: v => <span className="text3">{fmt(v)}</span> },
  ]

  const active = SEARCH_BY.find(s => s.key === form.by)

  return (
    <>
      <Topbar
        title="Cases"
        sub={isOpenView ? 'Showing open cases · search to include closed cases' : 'Search results'}
      />
      <div className="page-content">
        {/* ── Search panel ── */}
        <form className="card search-panel" onSubmit={runSearch}>
          <div className="sp-row">
            <div className="seg">
              {[['open', '📂 Open'], ['closed', '✅ Closed'], ['all', '🗂️ All']].map(([k, l]) => (
                <button type="button" key={k} className={`seg-btn${form.status === k ? ' on' : ''}`} onClick={() => set('status', k)}>{l}</button>
              ))}
            </div>
            <select value={form.by} onChange={e => set('by', e.target.value)} className="sp-by">
              {SEARCH_BY.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <div className="search-wrap sp-text">
              <span className="ico">🔍</span>
              <input type="text" placeholder={active.ph} value={form.text} onChange={e => set('text', e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary btn-sm">Search</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMore(m => !m)}>⚙️ Filters {more ? '▴' : '▾'}</button>
          </div>

          {more && (
            <div className="sp-more">
              <label><span>🏢 Warehouse</span>
                <select value={form.warehouse} onChange={e => set('warehouse', e.target.value)}>
                  <option value="">All</option>
                  {WAREHOUSES.map(w => <option key={w} value={w}>{WH_NAMES[w]}</option>)}
                </select>
              </label>
              <label><span>📋 Case type</span>
                <select value={form.caseType} onChange={e => set('caseType', e.target.value)}>
                  <option value="">All</option>
                  {CASE_TYPES.map(t => <option key={t} value={t}>{CASE_TYPE_ICON[t]} {t}</option>)}
                </select>
              </label>
              <label><span>⏱️ SLA</span>
                <select value={form.sla} onChange={e => set('sla', e.target.value)}>
                  <option value="">All</option>
                  {SLA_OPTIONS.map(s => <option key={s} value={s}>{slaLabel(s)}</option>)}
                </select>
              </label>
              <label><span>📅 Date field</span>
                <select value={form.dateField} onChange={e => set('dateField', e.target.value)}>
                  {DATE_FIELDS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              </label>
              <label><span>From</span><input type="date" value={form.from} onChange={e => set('from', e.target.value)} /></label>
              <label><span>To</span><input type="date" value={form.to} onChange={e => set('to', e.target.value)} /></label>
              <div className="sp-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>✕ Clear</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={startExport}>⬇ Export to Excel</button>
              </div>
            </div>
          )}
          {msg && <div className={`form-msg ${msg.type}`}>{msg.text}</div>}
        </form>

        <div className="card">
          <div className="card-header">
            <span className="card-title">{isOpenView ? '📂 Open cases' : '🔍 Results'}</span>
            <span className="card-count">{num(count)} cases</span>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={startExport} disabled={!count}>⬇ Excel</button>
          </div>
          <DataTable cols={COLS} rows={rows} count={count} page={page} setPage={setPage} onRowClick={setSelected} loading={loading} />
        </div>
      </div>

      {/* ── Export confirm ── */}
      {exp && (
        <div className="drawer-overlay" style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div className="card modal">
            {exp.stage === 'counting' && <div className="load-state"><span className="spinner" /> Counting records…</div>}
            {exp.stage === 'confirm' && (
              <>
                <div className="card-title" style={{ marginBottom: 8 }}>⬇ Export to Excel</div>
                <div className={`notice ${exp.count > 10000 || exp.long ? 'warn' : ''}`}>
                  <strong>{num(exp.count)}</strong> cases will be exported.
                  {exp.long && <div>⚠️ This covers more than 2 months.</div>}
                  {exp.count > 10000 && <div>⚠️ Large export — this may take a minute and use more mobile data.</div>}
                </div>
                <div className="modal-btns">
                  <button className="btn btn-ghost btn-sm" onClick={() => setExp(null)}>Cancel</button>
                  <button className="btn btn-primary btn-sm" disabled={!exp.count} onClick={confirmExport}>Download</button>
                </div>
              </>
            )}
            {exp.stage === 'running' && (
              <div className="load-state"><span className="spinner" /> Exporting {num(exp.done)} of {num(exp.count)}…</div>
            )}
          </div>
        </div>
      )}

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.case_number || 'Case'} icon={CASE_TYPE_ICON[selected?.case_type] || '🔧'}>
        {selected && <CaseDetail c={selected} onAsset={searchAsset} />}
      </Drawer>
    </>
  )
}

function Field({ label, children }) {
  return <div className="dl-field"><div className="lbl">{label}</div><div className="val">{children || '—'}</div></div>
}

function Section({ title, open, children }) {
  return (
    <details className="sec" open={open}>
      <summary>{title}</summary>
      <div className="sec-body">{children}</div>
    </details>
  )
}

function Mismatch({ asked, got }) {
  if (!asked || !got) return null
  return String(asked).trim().toLowerCase() === String(got).trim().toLowerCase()
    ? <span className="tag tag-green">✓ matches request</span>
    : <span className="tag tag-orange">⚠ requested {asked}</span>
}

function CaseDetail({ c, onAsset }) {
  const assets = caseAssets(c)
  const navigate = useNavigate()
  // Barcode, local code and product base for each asset on the case — one small call when the drawer opens
  const [info, setInfo] = useState({})
  useEffect(() => {
    const names = [...new Set(assets.map(a => a.asset).filter(Boolean))]
    if (!names.length) return
    supabase.from('assets_live').select('name,bar_code,local_code,product_base,product_variant,asset_status,assign_account')
      .in('name', names).then(({ data }) => setInfo(Object.fromEntries((data || []).map(r => [r.name, r]))))
  }, [c.case_number])
  return (
    <div>
      <div className="chip-row">
        <span className="tag tag-neutral">{c.case_type}</span>
        <span className={`tag tag-${statusColor(c.status_reason)}`}>{c.status_reason || '—'}</span>
        <span className={`tag tag-${slaColor(c.sla_status)}`}>{slaLabel(c.sla_status)}</span>
        {isOpenCase(c.status_reason) && c.sla_days_late > 0 && <span className="tag tag-red">{c.sla_days_late} days late</span>}
      </div>

      <Section title={`🧊 Assets on this case (${assets.length})`} open>
        {!assets.length && <div className="text3">No asset recorded on this case.</div>}
        {assets.map(a => (
          <div key={a.role + a.asset} className="asset-card">
            <div className="asset-card-hd">
              <span className="tag tag-blue">{a.icon} {a.role}</span>
              <button className="linkish mono" onClick={() => navigate(`/assets?q=${encodeURIComponent(a.asset)}`)} title="Open this asset">{a.asset} ↗</button>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button className="btn btn-primary btn-sm" onClick={() => navigate(`/assets?q=${encodeURIComponent(a.asset)}`)} title="Open this asset">🏭 Go to asset</button>
                <button className="btn btn-ghost btn-sm" onClick={() => onAsset(a.asset)} title="Every case for this asset">🔧 All cases</button>
              </span>
            </div>
            <div className="dl-grid">
              <Field label="Barcode"><span className="mono">{info[a.asset]?.bar_code}</span></Field>
              <Field label="Local code"><span className="mono">{info[a.asset]?.local_code}</span></Field>
              <Field label="Product base">{info[a.asset]?.product_base || a.product_base}</Field>
              <Field label="Condition">{a.condition && <span className={`tag tag-${condColor(a.condition)}`}>{a.condition}</span>}</Field>
              {a.brand && <Field label="Brand">{a.brand}</Field>}
            </div>
            {a.requested && (a.requested.condition || a.requested.product_base || a.requested.brand) && (
              <div className="req-box">
                <div className="lbl">Requested</div>
                <div className="dl-grid">
                  <Field label="Condition">{a.requested.condition} <Mismatch asked={a.requested.condition} got={a.condition} /></Field>
                  <Field label="Product base">{a.requested.product_base}</Field>
                  <Field label="Brand">{a.requested.brand}</Field>
                </div>
              </div>
            )}
            {a.fallback && <div className="text3" style={{ fontSize: 10.5 }}>Only the Mapped Asset is filled on this case.</div>}
          </div>
        ))}
        {c.mapped_asset && !assets.some(a => a.asset === c.mapped_asset) && (
          <div className="text3" style={{ fontSize: 10.5 }}>Mapped asset: <span className="mono">{c.mapped_asset}</span></div>
        )}
      </Section>

      <Section title="📅 Dates & SLA" open>
        <div className="dl-grid">
          <Field label="Created On">{fmt(c.created_on)}</Field>
          <Field label="Begin Date">{fmt(c.begin_date)}</Field>
          <Field label="End Date (due)">{fmt(c.end_date)}</Field>
          <Field label="Service Closure">{fmt(c.service_closure_date)}</Field>
          <Field label="SLA Level">{c.sla_level}</Field>
          <Field label="SLA Group">{c.sla_group}</Field>
          <Field label="Days late">{c.sla_days_late ? `${c.sla_days_late}` : null}</Field>
          <Field label="Days early">{c.sla_days_early ? `${c.sla_days_early}` : null}</Field>
        </div>
      </Section>

      <Section title="🏪 POS & contact">
        <div className="dl-grid">
          <Field label="Point of Sale">{c.point_of_sale}</Field>
          <Field label="POS Local Code">{c.pos_local_code}</Field>
          <Field label="Concessionaire">{c.responsible_ordering_party}</Field>
          <Field label="Address">{c.address}</Field>
          <Field label="Contact">{c.case_contact_name}</Field>
          <Field label="Phone">{c.case_contact_number && <a href={`tel:${c.case_contact_number}`}>{c.case_contact_number}</a>}</Field>
          <Field label="Mobile">{c.case_mobile_number && <a href={`tel:${c.case_mobile_number}`}>{c.case_mobile_number}</a>}</Field>
        </div>
      </Section>

      <Section title="👷 Who & where">
        <div className="dl-grid">
          <Field label="Warehouse / Workshop">{c.warehouse_workshop}</Field>
          <Field label="Technician">{c.technician_routed_to}</Field>
          <Field label="Contractor">{c.contractor}</Field>
          <Field label="Priority">{c.priority}</Field>
          <Field label="Origin">{c.origin}</Field>
          <Field label="Reason">{c.reason}</Field>
        </div>
      </Section>

      {(c.motive || c.message) && (
        <Section title="📝 Motive & messages">
          {c.motive && <div className="note-box"><div className="lbl">Motive</div>{c.motive}</div>}
          {c.message && <div className="note-box"><div className="lbl">Message</div>{c.message}</div>}
        </Section>
      )}
    </div>
  )
}
