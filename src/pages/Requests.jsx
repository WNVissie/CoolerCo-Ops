import { useState, useEffect, useCallback } from 'react'
import Topbar from '../components/Topbar'
import DataTable from '../components/DataTable'
import Drawer from '../components/Drawer'
import { supabase } from '../lib/supabase'
import { fmt, num, PS, statusColor, condColor, CASE_TYPE_ICON, WAREHOUSES, WH_NAMES } from '../lib/helpers'

// CoolerCo's own cases (portal requests first). Approve → Open, Reject with a reason.
// Priority is set by the server from the customer's symptom + product answers (and raised by a customer query).
const PRIORITY = { High: ['⚡ High', 'red'], Medium: ['Medium', 'orange'], Low: ['Low', 'neutral'] }
const PriorityTag = ({ p }) => (p && PRIORITY[p] ? <span className={`tag tag-${PRIORITY[p][1]}`}>{PRIORITY[p][0]}</span> : null)
const VIEWS = [
  { key: 'Waiting for Approval', icon: '⏳', label: 'Waiting for approval' },
  { key: 'Open', icon: '📂', label: 'Approved / open' },
  { key: 'Rejected', icon: '🚫', label: 'Rejected' },
  { key: 'all', icon: '🗂️', label: 'All' },
]

export default function Requests() {
  const [view, setView] = useState('Waiting for Approval')
  const [wh, setWh] = useState('')
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [counts, setCounts] = useState({})
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('coolerco_cases').select('*, family:coolerco_product_families(name,display_name)', { count: 'exact' })
    if (view !== 'all') q = q.eq('status_reason', view)
    if (wh) q = q.eq('warehouse_code', wh)
    const { data, count } = await q.order('created_on', { ascending: false }).range(page * PS, page * PS + PS - 1)
    setRows(data || []); setCount(count || 0); setLoading(false)
  }, [view, wh, page])

  const loadCounts = useCallback(async () => {
    const res = await Promise.all(VIEWS.filter(v => v.key !== 'all').map(v =>
      supabase.from('coolerco_cases').select('case_number', { count: 'exact', head: true }).eq('status_reason', v.key)))
    setCounts(Object.fromEntries(VIEWS.filter(v => v.key !== 'all').map((v, i) => [v.key, res[i].count || 0])))
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadCounts() }, [loadCounts])
  useEffect(() => { setPage(0) }, [view, wh])

  const COLS = [
    { key: 'case_number', label: 'Case #', cls: 'mono', render: v => <strong style={{ fontSize: 11 }}>{v}</strong> },
    { key: 'case_type', label: 'Request', render: v => <span>{CASE_TYPE_ICON[v] || '•'} {v}</span> },
    { key: 'status_reason', label: 'Status', render: v => <span className={`tag tag-${statusColor(v === 'Waiting for Approval' ? 'waiting' : v)}`}>{v}</span> },
    { key: 'priority', label: 'Priority', render: (v, r) => <span><PriorityTag p={v} />{r.repeat_of_case ? <span className="tag tag-purple" style={{ marginLeft: 4 }} title={`Repeat of ${r.repeat_of_case}`}>🔁 Repeat</span> : null}</span> },
    { key: 'originator', label: 'From', render: (v, r) => <span>{v}<div className="text3" style={{ fontSize: 10 }}>{r.origin}</div></span> },
    { key: 'point_of_sale', label: 'Store', render: (v, r) => <span className="trunc" style={{ maxWidth: 180, display: 'block' }} title={v}>{v}<span className="text3"> · {r.pos_local_code}</span></span> },
    { key: 'warehouse_code', label: 'WH', render: v => WH_NAMES[v] || v || '—' },
    { key: '_what', label: 'Asset / item', cls: 'mono', render: (_, r) => <span style={{ fontSize: 10.5 }}>{r.family?.display_name || r.family?.name || r.mapped_asset || '—'}</span> },
    { key: 'created_on', label: 'Logged', render: v => <span className="text3">{fmt(v)}</span> },
  ]

  return (
    <>
      <Topbar title="Requests" sub="CoolerCo cases · customer portal requests need approval" />
      <div className="page-content">
        <div className="check-chips">
          {VIEWS.map(v => (
            <button key={v.key} className={`check-chip tag-${v.key === 'Waiting for Approval' ? 'orange' : v.key === 'Open' ? 'blue' : v.key === 'Rejected' ? 'red' : 'neutral'}${view === v.key ? ' on' : ''}`} onClick={() => setView(v.key)}>
              <span>{v.icon} {v.label}</span><strong>{v.key === 'all' ? '' : num(counts[v.key] ?? 0)}</strong>
            </button>
          ))}
        </div>
        <div className="filters">
          <select value={wh} onChange={e => setWh(e.target.value)}>
            <option value="">🏢 All warehouses</option>
            {WAREHOUSES.map(w => <option key={w} value={w}>{WH_NAMES[w]}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => { load(); loadCounts() }}>↻ Refresh</button>
        </div>
        <div className="card">
          <div className="card-header"><span className="card-title">{VIEWS.find(v => v.key === view)?.icon} {VIEWS.find(v => v.key === view)?.label}</span><span className="card-count">{num(count)}</span></div>
          <DataTable cols={COLS} rows={rows} count={count} page={page} setPage={setPage} onRowClick={setSelected} loading={loading} />
        </div>
      </div>
      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.case_number} icon={CASE_TYPE_ICON[selected?.case_type] || '📋'}>
        {selected && <RequestDetail c={selected} onChanged={() => { setSelected(null); load(); loadCounts() }} />}
      </Drawer>
    </>
  )
}

function Field({ label, children }) {
  return <div className="dl-field"><div className="lbl">{label}</div><div className="val">{children || '—'}</div></div>
}

function RequestDetail({ c, onChanged }) {
  const [events, setEvents] = useState(null)
  const [photos, setPhotos] = useState([])
  const [asset, setAsset] = useState(null)
  const [reasons, setReasons] = useState([])
  const [reject, setReject] = useState(null) // reason code
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [labels, setLabels] = useState({})     // symptom + product impact wording
  const [msgs, setMsgs] = useState(null)       // messages on this case
  const [reply, setReply] = useState('')
  const [vis, setVis] = useState('customer')   // who may read the reply

  const loadMsgs = () => supabase.from('coolerco_case_comments').select('*').eq('case_number', c.case_number).order('created_at').then(({ data }) => setMsgs(data || []))

  // Everything for the drawer loads together
  useEffect(() => {
    Promise.all([
      supabase.from('coolerco_case_events').select('*').eq('case_number', c.case_number).order('created_at'),
      c.photo_paths?.length ? supabase.storage.from('coolerco-cases').createSignedUrls(c.photo_paths, 3600) : Promise.resolve({ data: [] }),
      c.mapped_asset ? supabase.from('assets_live').select('name,bar_code,local_code,product_base,condition,asset_status').eq('name', c.mapped_asset).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('coolerco_reason_codes').select('*').eq('status', 'Rejected').eq('active', true).order('sort_order'),
      c.symptom_code ? supabase.from('coolerco_symptoms').select('label').eq('code', c.symptom_code).maybeSingle() : Promise.resolve({ data: null }),
      c.product_impact ? supabase.from('coolerco_product_impacts').select('label').eq('code', c.product_impact).maybeSingle() : Promise.resolve({ data: null }),
      loadMsgs(),
    ]).then(([e, p, a, r, sy, im]) => { setLabels({ symptom: sy?.data?.label, impact: im?.data?.label }); setEvents(e.data || []); setPhotos((p.data || []).map(x => x.signedUrl).filter(Boolean)); setAsset(a.data); setReasons(r.data || []) })
  }, [c]) // eslint-disable-line react-hooks/exhaustive-deps

  async function setStatus(status, reason) {
    setBusy(true); setErr(null)
    const { error } = await supabase.rpc('coolerco_case_set_status', { p_case_number: c.case_number, p_status: status, p_reason_code: reason, p_notes: notes || null })
    setBusy(false)
    if (error) setErr(error.message); else onChanged()
  }

  async function sendReply() {
    if (!reply.trim()) return
    setBusy(true); setErr(null)
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('coolerco_case_comments').insert({
      case_number: c.case_number, case_source: 'CoolerCo', author_type: 'staff', author_label: u?.user?.email || 'staff', body: reply.trim().slice(0, 2000), visibility: vis,
    })
    setBusy(false)
    if (error) setErr(error.message); else { setReply(''); loadMsgs() }
  }

  return (
    <div>
      <div className="chip-row">
        <span className="tag tag-neutral">{c.case_type}</span>
        <PriorityTag p={c.priority} />
        {c.repeat_of_case && <span className="tag tag-purple">🔁 Repeat of {c.repeat_of_case}{c.repeat_days != null ? ` · ${c.repeat_days} d` : ''}</span>}
        <span className={`tag tag-${c.status_reason === 'Waiting for Approval' ? 'orange' : statusColor(c.status_reason)}`}>{c.status_reason}</span>
        <span className="tag tag-blue">{c.originator} · {c.origin}</span>
      </div>

      {c.status_reason === 'Waiting for Approval' && (
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <div className="lbl">Decision</div>
          <input className="field-ctrl" placeholder="Note (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
          {reject === null ? (
            <div className="modal-btns" style={{ justifyContent: 'flex-start' }}>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => setStatus('Open', 'APPROVED')}>✅ Approve</button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setReject('')}>🚫 Reject…</button>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <select className="field-ctrl" value={reject} onChange={e => setReject(e.target.value)}>
                <option value="">Choose a reason…</option>
                {reasons.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
              <div className="modal-btns" style={{ justifyContent: 'flex-start' }}>
                <button className="btn btn-danger btn-sm" disabled={busy || !reject} onClick={() => setStatus('Rejected', reject)}>Reject request</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setReject(null)}>Cancel</button>
              </div>
            </div>
          )}
          {err && <div className="form-msg err">{err}</div>}
        </div>
      )}

      <details className="sec" open>
        <summary>📝 Request</summary>
        <div className="sec-body">
          {(labels.symptom || labels.impact) && (
            <div className="dl-grid" style={{ marginBottom: 8 }}>
              <Field label="Problem">{labels.symptom}</Field>
              <Field label="Product">{labels.impact}</Field>
              <Field label="Priority">{c.priority && <><PriorityTag p={c.priority} /> <span className="text3" style={{ fontSize: 10.5 }}>{c.priority_source === 'customer_query' ? 'raised by customer query' : c.priority_source === 'auto' ? 'set automatically' : c.priority_source || ''}</span></>}</Field>
            </div>
          )}
          <div className="note-box">{c.description || '—'}</div>
          {photos.length > 0 && <div className="p-thumbs">{photos.map(u => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 7, marginRight: 6 }} /></a>)}</div>}
        </div>
      </details>

      <details className="sec" open>
        <summary>💬 Messages {msgs?.length ? `(${msgs.length})` : ''}</summary>
        <div className="sec-body">
          {!msgs ? <div className="load-state"><span className="spinner" /></div> : !msgs.length ? <div className="text3" style={{ fontSize: 11.5 }}>No messages on this case.</div> : (
            <div className="timeline">
              {msgs.map(m => (
                <div key={m.id} className="tl-item">
                  <span className="tl-dot">{m.author_type === 'customer' ? '👤' : m.author_type === 'staff' ? '🧑‍💼' : '🤝'}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, whiteSpace: 'pre-wrap' }}>{m.body}</div>
                    <div className="text3" style={{ fontSize: 10.5 }}>{new Date(m.created_at).toLocaleString('en-ZA')} · {m.author_label} · <span className={`tag tag-${m.visibility === 'customer' ? 'blue' : 'neutral'}`}>{m.visibility === 'customer' ? 'customer can see' : m.visibility === 'internal' ? 'internal' : 'concessionaire'}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <textarea className="field-ctrl" rows={2} style={{ marginTop: 8 }} placeholder="Reply or add a note…" value={reply} onChange={e => setReply(e.target.value)} />
          <div className="modal-btns" style={{ justifyContent: 'flex-start' }}>
            <select className="field-ctrl" style={{ width: 'auto' }} value={vis} onChange={e => setVis(e.target.value)} aria-label="Who can see this">
              <option value="customer">👤 Customer can see</option>
              <option value="internal">🔒 Internal only</option>
            </select>
            <button className="btn btn-primary btn-sm" disabled={busy || !reply.trim()} onClick={sendReply}>➤ Send</button>
          </div>
          {err && c.status_reason !== 'Waiting for Approval' && <div className="form-msg err">{err}</div>}
        </div>
      </details>

      <details className="sec" open>
        <summary>🧊 {c.requested_family_id ? 'Requested item' : 'Asset'}</summary>
        <div className="sec-body dl-grid">
          {c.requested_family_id
            ? <Field label="Family (catalogue)">{c.family?.display_name || c.family?.name}</Field>
            : <>
              <Field label="Asset number"><span className="mono">{c.mapped_asset}</span></Field>
              <Field label="Barcode"><span className="mono">{asset?.bar_code}</span></Field>
              <Field label="Local code"><span className="mono">{asset?.local_code}</span></Field>
              <Field label="Product">{asset?.product_base}</Field>
              <Field label="Condition">{c.asset_condition && <span className={`tag tag-${condColor(c.asset_condition)}`}>{c.asset_condition}</span>}</Field>
              <Field label="COM status">{asset?.asset_status}</Field>
            </>}
        </div>
      </details>

      <details className="sec" open>
        <summary>🏪 Store & contact</summary>
        <div className="sec-body dl-grid">
          <Field label="Store">{c.point_of_sale}</Field>
          <Field label="POS code"><span className="mono">{c.pos_local_code}</span></Field>
          <Field label="Concessionaire">{c.responsible_ordering_party}</Field>
          <Field label="Warehouse">{c.warehouse_workshop}</Field>
          <Field label="Contact">{c.case_contact_name}</Field>
          <Field label="Phone">{c.case_contact_number && <a href={`tel:${c.case_contact_number}`}>{c.case_contact_number}</a>}</Field>
        </div>
      </details>

      <details className="sec">
        <summary>📅 Dates & SLA</summary>
        <div className="sec-body dl-grid">
          <Field label="Logged">{fmt(c.created_on)}</Field>
          <Field label="Approved">{c.approved_at ? `${fmt(c.approved_at)} · ${c.approved_by}` : null}</Field>
          <Field label="Begin">{fmt(c.begin_date)}</Field>
          <Field label="End (due)">{fmt(c.end_date)}</Field>
          <Field label="SLA days">{c.sla_days}</Field>
        </div>
      </details>

      <details className="sec" open>
        <summary>🕒 History</summary>
        <div className="sec-body">
          {!events ? <div className="load-state"><span className="spinner" /></div> : (
            <div className="timeline">
              {events.map(e => (
                <div key={e.id} className="tl-item">
                  <span className="tl-dot">{e.actor_type === 'customer' ? '👤' : '🧑‍💼'}</span>
                  <div style={{ minWidth: 0 }}>
                    <div><strong>{e.to_status}</strong>{e.reason_code ? <span className="text3"> · {e.reason_code}</span> : null}</div>
                    <div className="text3" style={{ fontSize: 10.5 }}>{new Date(e.created_at).toLocaleString('en-ZA')} · {e.actor_label}</div>
                    {e.notes && <div style={{ fontSize: 11.5 }}>{e.notes}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  )
}
