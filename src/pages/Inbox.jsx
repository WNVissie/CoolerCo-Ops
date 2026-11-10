import { useState, useEffect, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Topbar from '../components/Topbar'
import Drawer from '../components/Drawer'
import { supabase } from '../lib/supabase'
import { num, statusColor, CASE_TYPE_ICON } from '../lib/helpers'

// Staff inbox — everything that waits for a person, in one place:
//   🔔 Alerts          new requests, customer queries, low ratings (the supervisor alarm)
//   💬 Customer queries messages on CoolerCo AND COM (Magnum) cases, with reply
//   👤 Contact updates  customers' changed details: approve / reject; COM stores → "capture in COM" list
// The counting and grouping is done on the server (one small call each); the browser only shows it.
const TABS = [
  { key: 'alerts', icon: '🔔', label: 'Alerts' },
  { key: 'queries', icon: '💬', label: 'Customer queries' },
  { key: 'contacts', icon: '👤', label: 'Contact updates' },
]
const EVENT = {
  case_logged: ['📨', 'New request'], case_query: ['💬', 'Customer query'], contact_update: ['👤', 'Contact update'],
  feedback_low: ['⭐', 'Low rating'], feedback_not_working: ['🛠', 'Still not working'],
}
const PRIORITY = { High: ['⚡ High', 'red'], Medium: ['Medium', 'orange'], Low: ['Low', 'neutral'] }
const PriorityTag = ({ p }) => (p && PRIORITY[p] ? <span className={`tag tag-${PRIORITY[p][1]}`}>{PRIORITY[p][0]}</span> : null)
const when = d => (d ? new Date(d).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const FIELD = { contact_name: 'Contact name', contact_number: 'Contact number', mobile_number: 'Mobile / WhatsApp', email: 'Email', trading_hours: 'Trading hours',
  delivery_notes: 'Delivery notes', notify_email: 'Email updates', notify_whatsapp: 'WhatsApp updates', point_of_sale: 'Store name', address: 'Address', latitude: 'GPS latitude', longitude: 'GPS longitude' }

export default function Inbox() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(t => t.key === params.get('tab')) ? params.get('tab') : 'alerts'
  const [counts, setCounts] = useState({})
  const loadCounts = useCallback(() => supabase.rpc('coolerco_inbox_counts').then(({ data }) => { if (data) setCounts(data); window.dispatchEvent(new Event('cc-inbox')) }), [])
  useEffect(() => { loadCounts() }, [loadCounts])

  return (
    <>
      <Topbar title="Inbox" sub="Alerts · customer queries · contact updates" />
      <div className="page-content">
        <div className="check-chips">
          {TABS.map(t => (
            <button key={t.key} className={`check-chip tag-${t.key === 'alerts' ? (counts.urgent ? 'red' : 'orange') : t.key === 'queries' ? 'blue' : 'purple'}${tab === t.key ? ' on' : ''}`} onClick={() => setParams({ tab: t.key })}>
              <span>{t.icon} {t.label}</span><strong>{num(counts[t.key] ?? 0)}</strong>
            </button>
          ))}
        </div>
        {tab === 'alerts' && <Alerts onChanged={loadCounts} openQuery={c => setParams({ tab: 'queries', case: c })} />}
        {tab === 'queries' && <Queries onChanged={loadCounts} openCase={params.get('case')} />}
        {tab === 'contacts' && <Contacts onChanged={loadCounts} />}
      </div>
    </>
  )
}

// ── 🔔 Alerts ───────────────────────────────────────────────────────────
function Alerts({ onChanged, openQuery }) {
  const [rows, setRows] = useState(null)
  const [show, setShow] = useState('queued')
  const [err, setErr] = useState(null)
  const load = useCallback(async () => {
    let q = supabase.from('coolerco_notifications').select('*').eq('channel', 'inapp').eq('recipient_type', 'supervisor')
    if (show === 'queued') q = q.eq('status', 'queued')
    const { data, error } = await q.order('created_at', { ascending: false }).limit(150)
    setErr(error?.message || null); setRows(data || [])
  }, [show])
  useEffect(() => { setRows(null); load() }, [load])

  async function markRead(ids) {
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('coolerco_notifications').update({ status: 'read', read_at: new Date().toISOString(), read_by: u?.user?.id || null }).in('id', ids).eq('status', 'queued')
    if (error) setErr(error.message); else { load(); onChanged() }
  }
  const unread = (rows || []).filter(r => r.status === 'queued')

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">🔔 Alerts</span>
        <div className="seg">
          {[['queued', 'Unread'], ['all', 'All']].map(([k, l]) => <button key={k} className={`seg-btn${show === k ? ' on' : ''}`} onClick={() => setShow(k)}>{l}</button>)}
        </div>
        {unread.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => markRead(unread.map(r => r.id))}>✓ Mark all read</button>}
      </div>
      {err && <div className="form-msg err" style={{ margin: 10 }}>{err}</div>}
      {!rows ? <div className="load-state"><span className="spinner" /></div> : !rows.length ? (
        <div className="empty-state"><div className="empty-ico">🔔</div><div>{show === 'queued' ? 'Nothing waiting' : 'No alerts yet'}</div>
          <div className="text3" style={{ fontSize: 11 }}>Alerts are shown to system administrators, administrators, managers and supplier users.</div></div>
      ) : (
        <div className="timeline" style={{ padding: '4px 10px' }}>
          {rows.map(n => {
            const [ico, label] = EVENT[n.event_type] || ['•', n.event_type]
            const p = n.payload || {}
            const com = p.source === 'COM'
            return (
              <div key={n.id} className="tl-item" style={{ alignItems: 'flex-start', opacity: n.status === 'read' ? 0.6 : 1 }}>
                <span className="tl-dot" style={{ fontSize: 16 }}>{ico}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div><strong>{label}</strong> <PriorityTag p={n.priority} /> {p.priority_raised && <span className="tag tag-red">priority raised</span>} {p.repeat_of && <span className="tag tag-purple">🔁 repeat of {p.repeat_of}</span>} {com && <span className="tag tag-neutral">COM case</span>}</div>
                  <div style={{ fontSize: 11.5 }}>{n.title}</div>
                  {(p.symptom || p.product_impact || p.reason_label || p.note || p.comment) && (
                    <div className="text3" style={{ fontSize: 11 }}>{[p.symptom, p.product_impact, p.note, p.comment].filter(Boolean).join(' · ')}</div>
                  )}
                  <div className="text3" style={{ fontSize: 10.5 }}>{n.case_number ? <span className="mono">{n.case_number} · </span> : null}{when(n.created_at)}{n.warehouse_code ? ` · ${n.warehouse_code}` : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {n.event_type === 'case_query' && n.case_number && <button className="btn btn-primary btn-sm" onClick={() => openQuery(n.case_number)}>💬 Reply</button>}
                  {n.event_type === 'contact_update' && <Link className="btn btn-primary btn-sm" to="/inbox?tab=contacts">👤 Review</Link>}
                  {n.event_type !== 'case_query' && n.event_type !== 'contact_update' && n.case_number && <Link className="btn btn-ghost btn-sm" to={com ? `/cases?case=${encodeURIComponent(n.case_number)}` : '/requests'}>Open</Link>}
                  {n.status === 'queued' && <button className="btn btn-ghost btn-sm" onClick={() => markRead([n.id])} aria-label="Mark as read">✓</button>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── 💬 Customer queries (CoolerCo + COM cases) ──────────────────────────
function Queries({ onChanged, openCase }) {
  const [rows, setRows] = useState(null)
  const [waiting, setWaiting] = useState(true)
  const [err, setErr] = useState(null)
  const [sel, setSel] = useState(null)
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('coolerco_query_inbox', { p_waiting_only: waiting, p_limit: 200 })
    setErr(error?.message || null); setRows(data || [])
    return data || []
  }, [waiting])
  useEffect(() => { setRows(null); load() }, [load])
  // opened from an alert: show that case even if it has been answered already
  useEffect(() => { if (openCase) setSel(s => s || { case_number: openCase }) }, [openCase])

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">💬 Customer queries</span>
        <div className="seg">
          {[[true, '⏳ Waiting for a reply'], [false, 'All']].map(([k, l]) => <button key={String(k)} className={`seg-btn${waiting === k ? ' on' : ''}`} onClick={() => setWaiting(k)}>{l}</button>)}
        </div>
      </div>
      {err && <div className="form-msg err" style={{ margin: 10 }}>{err}</div>}
      {!rows ? <div className="load-state"><span className="spinner" /></div> : !rows.length ? (
        <div className="empty-state"><div className="empty-ico">💬</div><div>{waiting ? 'No customer is waiting for a reply' : 'No customer queries yet'}</div></div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Case</th><th>Store</th><th>Status</th><th>Last message</th><th>When</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.case_number} onClick={() => setSel(r)} style={{ cursor: 'pointer' }}>
                  <td><div className="mono" style={{ fontSize: 11 }}><strong>{CASE_TYPE_ICON[r.case_type] || '•'} {r.case_number}</strong></div>
                    <span className={`tag tag-${r.source === 'COM' ? 'neutral' : 'blue'}`}>{r.source}</span> <PriorityTag p={r.priority} /></td>
                  <td><span className="trunc" style={{ maxWidth: 190, display: 'block' }} title={r.point_of_sale}>{r.point_of_sale}</span><span className="text3" style={{ fontSize: 10.5 }}>{r.pos_local_code} · {(r.warehouse || '').replace('RTMA ', '')}</span></td>
                  <td><span className={`tag tag-${statusColor(r.status)}`}>{r.status}</span>{!r.is_open && <div className="text3" style={{ fontSize: 10 }}>closed</div>}</td>
                  <td><span className="trunc" style={{ maxWidth: 260, display: 'block', fontSize: 11.5 }} title={r.last_body}>{r.waiting ? '👤 ' : '🧑‍💼 '}{r.last_body}</span>{r.waiting && <span className="tag tag-orange">waiting for a reply</span>}</td>
                  <td className="text3">{when(r.last_at)}<div style={{ fontSize: 10 }}>{r.messages} message(s)</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel?.case_number} icon="💬">
        {sel && <Thread row={sel} onSent={() => { load(); onChanged() }} />}
      </Drawer>
    </div>
  )
}

function Thread({ row, onSent }) {
  const [msgs, setMsgs] = useState(null)
  const [info, setInfo] = useState(row.source ? row : null)
  const [reply, setReply] = useState('')
  const [vis, setVis] = useState('customer')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const load = useCallback(() => supabase.from('coolerco_case_comments').select('*').eq('case_number', row.case_number).order('created_at').then(({ data }) => setMsgs(data || [])), [row.case_number])
  useEffect(() => {
    load()
    // opened by case number only (from an alert): find out which system the case lives in
    if (!row.source) supabase.rpc('coolerco_query_inbox', { p_waiting_only: false, p_limit: 500 }).then(({ data }) => setInfo((data || []).find(r => r.case_number === row.case_number) || { case_number: row.case_number }))
  }, [load, row])

  async function send() {
    if (!reply.trim()) return
    setBusy(true); setErr(null)
    const { data: u } = await supabase.auth.getUser()
    const source = info?.source || msgs?.[0]?.case_source || 'CoolerCo'
    const { error } = await supabase.from('coolerco_case_comments').insert({
      case_number: row.case_number, case_source: source, author_type: 'staff', author_label: u?.user?.email || 'staff', body: reply.trim().slice(0, 2000), visibility: vis,
    })
    setBusy(false)
    if (error) setErr(error.message); else { setReply(''); load(); onSent() }
  }
  const com = (info?.source || msgs?.[0]?.case_source) === 'COM'

  return (
    <div>
      <div className="chip-row">
        {info?.case_type && <span className="tag tag-neutral">{info.case_type}</span>}
        {info?.status && <span className={`tag tag-${statusColor(info.status)}`}>{info.status}</span>}
        <span className={`tag tag-${com ? 'neutral' : 'blue'}`}>{com ? 'COM case' : 'CoolerCo case'}</span>
        <PriorityTag p={info?.priority} />
      </div>
      {info?.point_of_sale && <div className="text3" style={{ fontSize: 11.5, margin: '6px 0' }}>🏪 {info.point_of_sale} · {info.pos_local_code}</div>}
      {com && <div className="notice">ℹ️ This is a COM case. The customer&apos;s messages and your replies are kept in CoolerCo — COM is not changed. Update the case in COM if something there needs to change.</div>}
      <div style={{ margin: '8px 0' }}>
        <Link className="btn btn-ghost btn-sm" to={com ? `/cases?case=${encodeURIComponent(row.case_number)}` : '/requests'}>Open {com ? 'in Cases' : 'Requests'} ›</Link>
      </div>
      {!msgs ? <div className="load-state"><span className="spinner" /></div> : (
        <div className="timeline">
          {msgs.map(m => (
            <div key={m.id} className="tl-item" style={{ alignItems: 'flex-start' }}>
              <span className="tl-dot">{m.author_type === 'customer' ? '👤' : m.author_type === 'staff' ? '🧑‍💼' : '🤝'}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{m.body}</div>
                <div className="text3" style={{ fontSize: 10.5 }}>{when(m.created_at)} · {m.author_label} · <span className={`tag tag-${m.visibility === 'customer' ? 'blue' : 'neutral'}`}>{m.visibility === 'customer' ? 'customer can see' : m.visibility === 'internal' ? 'internal' : 'concessionaire'}</span></div>
              </div>
            </div>
          ))}
          {!msgs.length && <div className="text3" style={{ fontSize: 11.5 }}>No messages on this case.</div>}
        </div>
      )}
      <textarea className="field-ctrl" rows={3} style={{ marginTop: 10 }} placeholder="Reply to the customer, or add an internal note…" value={reply} onChange={e => setReply(e.target.value)} />
      <div className="modal-btns" style={{ justifyContent: 'flex-start' }}>
        <select className="field-ctrl" style={{ width: 'auto' }} value={vis} onChange={e => setVis(e.target.value)} aria-label="Who can see this">
          <option value="customer">👤 Customer can see</option>
          <option value="internal">🔒 Internal only</option>
        </select>
        <button className="btn btn-primary btn-sm" disabled={busy || !reply.trim()} onClick={send}>➤ Send</button>
      </div>
      {err && <div className="form-msg err">{err}</div>}
    </div>
  )
}

// ── 👤 Contact updates ──────────────────────────────────────────────────
function Contacts({ onChanged }) {
  const [rows, setRows] = useState(null)
  const [show, setShow] = useState('Pending') // Pending | capture | done
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const [note, setNote] = useState({})
  const load = useCallback(async () => {
    let q = supabase.from('coolerco_contact_update_requests').select('*, link:coolerco_portal_links(point_of_sale,pos_local_code,client_code)')
    if (show === 'Pending') q = q.eq('status', 'Pending')
    else if (show === 'capture') q = q.eq('status', 'Approved').eq('capture_in_source', true).is('captured_at', null)
    else q = q.neq('status', 'Pending')
    const { data, error } = await q.order('created_at', { ascending: false }).limit(100)
    setErr(error?.message || null); setRows(data || [])
  }, [show])
  useEffect(() => { setRows(null); load() }, [load])

  async function decide(r, approve) {
    setBusy(r.id); setErr(null)
    const { data, error } = await supabase.rpc('coolerco_contact_update_decide', { p_id: r.id, p_approve: approve, p_note: note[r.id] || null })
    setBusy(null)
    if (error || data?.error) setErr(error?.message || data.error); else { load(); onChanged() }
  }
  async function captured(r) {
    setBusy(r.id); setErr(null)
    const { data, error } = await supabase.rpc('coolerco_contact_update_captured', { p_id: r.id })
    setBusy(null)
    if (error || data?.error) setErr(error?.message || data.error); else load()
  }
  const val = v => (v === true || v === 'true' ? 'Yes' : v === false || v === 'false' ? 'No' : v || '—')

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">👤 Contact updates</span>
        <div className="seg">
          {[['Pending', '⏳ To approve'], ['capture', '📝 To capture in COM'], ['done', 'Decided']].map(([k, l]) => <button key={k} className={`seg-btn${show === k ? ' on' : ''}`} onClick={() => setShow(k)}>{l}</button>)}
        </div>
      </div>
      {err && <div className="form-msg err" style={{ margin: 10 }}>{err}</div>}
      {!rows ? <div className="load-state"><span className="spinner" /></div> : !rows.length ? (
        <div className="empty-state"><div className="empty-ico">👤</div><div>{show === 'Pending' ? 'No contact updates to approve' : show === 'capture' ? 'Nothing to capture in COM' : 'No decisions yet'}</div></div>
      ) : (
        <div style={{ padding: 10, display: 'grid', gap: 10 }}>
          {rows.map(r => (
            <div key={r.id} className="card" style={{ padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div><strong>🏪 {r.link?.point_of_sale || r.pos_local_code}</strong> <span className="text3 mono" style={{ fontSize: 10.5 }}>{r.pos_local_code}</span>
                  <div className="text3" style={{ fontSize: 10.5 }}>Sent {when(r.created_at)}{r.link?.client_code ? ` · ${r.link.client_code}` : ''}</div></div>
                <div>
                  {r.status !== 'Pending' && <span className={`tag tag-${r.status === 'Approved' ? 'green' : 'red'}`}>{r.status}</span>}
                  {r.identity_change && <span className="tag tag-red" style={{ marginLeft: 4 }}>⚠ store name / address changed</span>}
                </div>
              </div>
              <div className="tbl-wrap" style={{ marginTop: 8 }}>
                <table className="tbl">
                  <thead><tr><th>Field</th><th>Now</th><th>Customer says</th></tr></thead>
                  <tbody>
                    {Object.entries(r.proposed_values || {}).map(([k, v]) => (
                      <tr key={k}><td>{FIELD[k] || k}</td><td className="text3">{val(r.current_values?.[k])}</td><td><strong>{val(v)}</strong></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {r.identity_change && r.status === 'Pending' && <div className="notice warn" style={{ marginTop: 8 }}>A changed store name or address can mean a new owner. Name, address and GPS are not changed automatically — check with the store first.</div>}
              {r.status === 'Pending' && (
                <>
                  <input className="field-ctrl" style={{ marginTop: 8 }} placeholder="Note (optional)" value={note[r.id] || ''} onChange={e => setNote(n => ({ ...n, [r.id]: e.target.value }))} />
                  <div className="modal-btns" style={{ justifyContent: 'flex-start' }}>
                    <button className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={() => decide(r, true)}>✅ Approve</button>
                    <button className="btn btn-ghost btn-sm" disabled={busy === r.id} onClick={() => decide(r, false)}>🚫 Reject</button>
                  </div>
                </>
              )}
              {r.status !== 'Pending' && <div className="text3" style={{ fontSize: 10.5, marginTop: 6 }}>{r.decided_by} · {when(r.decided_at)}{r.decision_note ? ` · ${r.decision_note}` : ''}{r.captured_at ? ` · captured in COM ${when(r.captured_at)}` : ''}</div>}
              {show === 'capture' && <div className="modal-btns" style={{ justifyContent: 'flex-start' }}><button className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={() => captured(r)}>✓ Captured in COM</button></div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
