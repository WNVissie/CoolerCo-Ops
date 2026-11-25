import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { rpcRead, isNetErr, NET_MSG } from '../lib/rpcRetry'
import './portal.css'

// Concessionaire portal — no Supabase login. Personal link (/c/<link>) + PIN → 12-hour session.
// Staff "Open as…" arrives on /c/view#s=<session> (2-hour session, actions logged as staff).
// Every call goes through coolerco_conc_* functions, which only return this concessionaire's data.

const ICON = { 'Repair at POS': '🔧', 'Removal of Asset': '📦', 'Delivery of Asset': '🚚', 'Replacement of Asset': '🔄', 'Repair at Workshop': '🛠️' }
const icon = t => ICON[t] || (/(repair)/i.test(t || '') ? '🔧' : /(remov|collect)/i.test(t || '') ? '📦' : /(deliver|new)/i.test(t || '') ? '🚚' : '📄')
const REJECT = [
  ['REJ_NOT_APPROVED', 'Not approved'],
  ['REJ_DUPLICATE', 'Already logged (duplicate)'],
  ['REJ_NOT_OUR_ASSET', 'Not our asset / wrong store'],
  ['REJ_MORE_INFO', 'Need more information'],
]
const ERR = {
  invalid_link: 'This link is not valid. Please ask CoolerCo for a new link.',
  wrong_pin: 'Wrong PIN — please try again.',
  locked: 'Too many wrong PINs. Please wait 15 minutes or ask CoolerCo to reset your PIN.',
  no_pin: 'Your PIN has not been set yet. Please ask CoolerCo.',
  expired: 'Your session has ended. Please enter your PIN again.',
  already_decided: 'Someone already decided on this request.',
  bad_com_number: 'That does not look like a COM case number (e.g. CAS-3031960-K3B2W1).',
}
const OPEN = ['open', 'in progress', 'waiting', 'in service', 'on hold']
const fmtD = d => (d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
const fmtDT = d => (d ? new Date(d).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const ATTENTION = ['action required', 'approval required', 'error', 'error external']
const statusTag = s => {
  const v = (s || '').toLowerCase()
  if (s === 'Waiting for Approval' || ATTENTION.includes(v)) return 'warn'
  if (s === 'Rejected' || /cancel|not solved/.test(v)) return 'bad'
  if (OPEN.includes(v) || s === 'Linked to COM' || v === 'solved') return 'ok'
  return ''
}

export default function ConcPortal({ link }) {
  const staff = link === 'view'
  const key = `cc_conc_${link}`
  const [session, setSession] = useState(() => {
    if (staff) { const m = window.location.hash.match(/s=([A-Za-z0-9_-]+)/); return m ? m[1] : null }
    try { return sessionStorage.getItem(key) } catch { return null }
  })
  const [ctx, setCtx] = useState(null)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('approve')

  const call = useCallback(async (fn, args = {}) => {
    const read = !/_(decide|link_com|add_comment|alert_fix|reschedule)$/.test(fn)
    const { data, error } = read ? await rpcRead(fn, { p_session: session, ...args }) : await supabase.rpc(fn, { p_session: session, ...args })
    if (error) throw new Error(isNetErr(error) || error.network ? NET_MSG : error.message)
    if (data?.error === 'expired') { try { sessionStorage.removeItem(key) } catch {} ; setSession(null); setCtx(null); setErr(ERR.expired); return null }
    return data
  }, [session, key])

  const loadCtx = useCallback(async () => { if (session) { const d = await call('coolerco_conc_context').catch(e => setErr(e.message)); if (d) setCtx(d) } }, [session, call])
  useEffect(() => { loadCtx() }, [loadCtx])
  // ⚠️ Needs action (script 059): store location / contact problems from the field — hidden where 059 is not installed
  const [alerts, setAlerts] = useState(null)
  const loadAlerts = useCallback(async () => { if (session) { const d = await call('coolerco_conc_alerts').catch(() => null); setAlerts(d?.alerts || null) } }, [session, call])
  useEffect(() => { loadAlerts() }, [loadAlerts])
  const openAlerts = (alerts || []).filter(a => a.status === 'open').length
  useEffect(() => { if (openAlerts && tab === 'approve' && !ctx?.to_approve) setTab('action') }, [openAlerts, ctx])

  if (!session) return staff
    ? <Shell><div className="p-card p-center"><div className="p-big">⏱️</div><p>This staff view has ended. Open it again from <b>Responsible Ordering Parties</b> in CoolerCo-Ops.</p></div></Shell>
    : <PinScreen link={link} msg={err} onLogin={s => { try { sessionStorage.setItem(key, s) } catch {} ; setErr(null); setSession(s) }} />

  if (!ctx) return <Shell><div className="p-card p-center">{err ? <><p className="p-err">{err}</p><button className="p-btn" onClick={() => { setErr(null); loadCtx() }}>↻ Try again</button></> : <><span className="p-spin" /> Loading…</>}</div></Shell>

  const logout = () => { try { sessionStorage.removeItem(key) } catch {} ; setSession(null); setCtx(null) }
  const TABS = [
    ...(alerts && alerts.length ? [['action', '⚠️', 'Needs action', openAlerts]] : []),
    ['approve', '✅', 'To approve', ctx.to_approve],
    ['log', '📝', 'Log in COM', ctx.to_log],
    ['cases', '📋', 'Cases', (ctx.open_com || 0) + (ctx.attention_com || 0)],
    ['stores', '🏪', 'Stores', ctx.stores],
  ]
  return (
    <Shell who={ctx.concessionaire} sub={ctx.actor} onLogout={staff ? null : logout}>
      {ctx.actor_type === 'staff' && <div className="p-card p-dup" style={{ padding: 10, fontSize: 12.5 }}>👁 Staff view — you see exactly what <b>{ctx.concessionaire}</b> sees. Anything you do is logged under your name.</div>}
      <div className="c-kpis">
        <div><span>❄️</span><b>{(ctx.assets_at_pos || 0).toLocaleString()}</b><small>assets at your stores</small></div>
        <div><span>🏪</span><b>{(ctx.stores || 0).toLocaleString()}</b><small>stores</small></div>
        <div><span>📋</span><b>{(ctx.open_com || 0).toLocaleString()}</b><small>open cases (store + logistics)</small></div>
        {ctx.attention_com > 0 && <div><span>⚠️</span><b>{ctx.attention_com.toLocaleString()}</b><small>need action</small></div>}
        {ctx.assets_in_workshop > 0 && <div><span>🛠️</span><b>{ctx.assets_in_workshop.toLocaleString()}</b><small>in workshop</small></div>}
      </div>
      <div className="p-tabs c-tabs">
        {TABS.map(([k, i, l, n]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            <span className="c-tab-ico">{i}</span><span className="c-tab-lbl">{l}</span>{n > 0 && <span className="p-count">{n > 999 ? '999+' : n}</span>}
          </button>
        ))}
      </div>
      {tab === 'action' && <NeedsAction call={call} alerts={alerts || []} onChange={() => { loadAlerts(); loadCtx() }} />}
      {tab === 'approve' && <Approve call={call} onChange={loadCtx} />}
      {tab === 'log' && <LogCom call={call} onChange={loadCtx} />}
      {tab === 'cases' && <Cases call={call} />}
      {tab === 'stores' && <Stores call={call} ctx={ctx} />}
    </Shell>
  )
}

function Shell({ who, sub, onLogout, children }) {
  return (
    <div className="p-root">
      <header className="p-head">
        <div className="p-logo">Cooler<span>Co</span></div>
        {who && <div className="p-store"><small>CONCESSIONAIRE</small><strong>{who}</strong></div>}
        {onLogout && <button className="c-out" onClick={onLogout} title="Sign out">⎋</button>}
      </header>
      <main className="p-main c-main">{children}</main>
      <footer className="p-foot">{sub ? `Signed in as ${sub} · ` : ''}CoolerCo · RTMA</footer>
    </div>
  )
}

function PinScreen({ link, msg, onLogin }) {
  const [info, setInfo] = useState(null)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(msg)
  const [busy, setBusy] = useState(false)
  useEffect(() => { rpcRead('coolerco_conc_link_info', { p_link: link }).then(({ data, error }) => setInfo(error ? { error: 'net' } : data || { error: 'invalid_link' })) }, [link])
  async function go(e) {
    e.preventDefault(); setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('coolerco_conc_login', { p_link: link, p_pin: pin })
    setBusy(false)
    if (error) return setErr(isNetErr(error) ? NET_MSG : error.message)
    if (data?.error) { setPin(''); return setErr(ERR[data.error] || data.error) }
    onLogin(data.session)
  }
  return (
    <Shell>
      <div className="p-card p-center">
        {!info ? <><span className="p-spin" /> Checking your link…</>
          : info.error === 'net' ? <><div className="p-big">📶</div><p className="p-err">{NET_MSG}</p><button className="p-btn" onClick={() => window.location.reload()}>↻ Try again</button></>
          : info.error ? <><div className="p-big">🔗</div><p className="p-err">{ERR.invalid_link}</p></>
            : (
              <form onSubmit={go}>
                <div className="p-big">🔐</div>
                <h2 style={{ margin: '4px 0' }}>Hello {info.name}</h2>
                <p className="p-muted">{info.concessionaire}</p>
                <div className="p-label">Enter your PIN</div>
                <input className="c-pin" inputMode="numeric" autoComplete="one-time-code" maxLength={8} autoFocus value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" />
                {err && <p className="p-err">{err}</p>}
                <button className="p-btn" style={{ width: '100%', marginTop: 12 }} disabled={busy || pin.length < 4}>{busy ? 'Checking…' : 'Sign in'}</button>
                <p className="p-muted" style={{ marginTop: 12 }}>Forgot your PIN? Ask CoolerCo to reset it.</p>
              </form>
            )}
      </div>
    </Shell>
  )
}

function useList(call, fn, args, deps) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const load = useCallback(() => { setRows(null); call(fn, args).then(d => setRows(d)).catch(e => setErr(e.message)) }, deps) // eslint-disable-line
  useEffect(() => { load() }, [load])
  return [rows, load, err]
}

function Loading({ err }) { return <div className="p-card p-center">{err ? <p className="p-err">{err}</p> : <><span className="p-spin" /> Loading…</>}</div> }
function Empty({ icon: i, text }) { return <div className="p-card p-center"><div className="p-big">{i}</div><p className="p-muted">{text}</p></div> }

function RequestHead({ r }) {
  return (
    <>
      <div className="c-row-top">
        <span className="c-ico">{icon(r.case_type)}</span>
        <div className="c-grow">
          <strong>{r.case_type}</strong>
          <small>{r.point_of_sale} · {r.pos_local_code}</small>
        </div>
        <span className={`p-tag ${statusTag(r.status)}`}>{r.status}</span>
      </div>
      <div className="p-sum c-sum">
        <div><span>Reference</span><b className="c-mono">{r.case_number}</b></div>
        <div><span>Logged</span>{fmtDT(r.created_on)}</div>
        {(r.asset || r.family) && <div><span>Asset</span>{r.product || r.family || r.asset}{r.barcode ? ` · 🏷 ${r.barcode}` : ''}{r.local_code ? ` · ${r.local_code}` : ''}{r.condition ? ` · ${r.condition}` : ''}</div>}
        {r.description && <div><span>Problem</span>{r.description}</div>}
        <div><span>Contact</span>{r.contact || '—'}{r.phone ? <> · <a href={`tel:${r.phone}`}>{r.phone}</a></> : ''}</div>
        {r.photos > 0 && <div><span>Photos</span>📷 {r.photos} attached (CoolerCo can view)</div>}
        {r.approved_by && <div><span>Decided</span>{r.approved_by} · {fmtDT(r.approved_at)}</div>}
        {r.com_case_number && <div><span>COM case</span><b className="c-mono">{r.com_case_number}</b></div>}
      </div>
    </>
  )
}

function Approve({ call, onChange }) {
  const [view, setView] = useState('waiting')
  const [rows, load, err] = useList(call, 'coolerco_conc_requests', { p_view: view }, [view, call])
  const [act, setAct] = useState(null) // { case, mode }
  const [reason, setReason] = useState(REJECT[0][0])
  const [comment, setComment] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  async function decide(r, decision) {
    setBusy(true); setMsg(null)
    const d = await call('coolerco_conc_decide', { p_case: r.case_number, p_decision: decision, p_reason: decision === 'reject' ? reason : null, p_comment: comment }).catch(e => ({ error: e.message }))
    setBusy(false)
    if (!d) return
    if (d.error) return setMsg({ bad: true, text: d.error === 'already_decided' ? `${ERR.already_decided} (${d.status}${d.by ? ' by ' + d.by : ''})` : ERR[d.error] || d.error })
    setMsg({ text: decision === 'accept' ? `✅ ${r.case_number} accepted — next: log it in COM (tab "Log in COM").` : `🚫 ${r.case_number} rejected.` })
    setAct(null); setComment(''); load(); onChange()
  }

  return (
    <>
      <div className="c-seg">
        <button className={view === 'waiting' ? 'on' : ''} onClick={() => setView('waiting')}>Waiting</button>
        <button className={view === 'done' ? 'on' : ''} onClick={() => setView('done')}>Decided</button>
      </div>
      {msg && <div className={`p-card c-msg ${msg.bad ? 'bad' : ''}`}>{msg.text}</div>}
      {!rows ? <Loading err={err} /> : !rows.length ? <Empty icon="🎉" text={view === 'waiting' ? 'Nothing waiting for your approval.' : 'No decided requests yet.'} />
        : rows.map(r => (
          <div className="p-card" key={r.case_number}>
            <RequestHead r={r} />
            {r.status === 'Waiting for Approval' && (act?.case !== r.case_number ? (
              <div className="c-actions">
                <button className="p-btn ghost" onClick={() => { setAct({ case: r.case_number, mode: 'reject' }); setComment('') }}>🚫 Reject</button>
                <button className="p-btn" onClick={() => { setAct({ case: r.case_number, mode: 'accept' }); setComment('') }}>✅ Accept</button>
              </div>
            ) : (
              <div className="c-decide">
                {act.mode === 'reject' && <>
                  <div className="p-label">Reason</div>
                  <select className="c-select" value={reason} onChange={e => setReason(e.target.value)}>{REJECT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                </>}
                <div className="p-label">Comment {act.mode === 'reject' ? '(the store will see why)' : '(optional)'}</div>
                <textarea rows={2} value={comment} onChange={e => setComment(e.target.value)} placeholder={act.mode === 'accept' ? 'e.g. Approved — will log in COM today' : 'e.g. Asset was swapped last week'} />
                <div className="c-actions">
                  <button className="p-btn ghost" onClick={() => setAct(null)}>Cancel</button>
                  <button className={`p-btn ${act.mode === 'reject' ? 'c-bad' : ''}`} disabled={busy || (act.mode === 'reject' && !comment.trim())} onClick={() => decide(r, act.mode)}>
                    {busy ? 'Saving…' : act.mode === 'accept' ? 'Confirm accept' : 'Confirm reject'}
                  </button>
                </div>
              </div>
            ))}
            <Comments call={call} caseNo={r.case_number} count={r.comments} />
          </div>
        ))}
    </>
  )
}

function comText(r) {
  return [
    `Case type: ${r.case_type}`,
    `Point of sale: ${r.point_of_sale} (${r.pos_local_code})`,
    r.asset ? `Asset: ${r.asset}${r.barcode ? ' / barcode ' + r.barcode : ''}${r.local_code ? ' / local code ' + r.local_code : ''}` : null,
    r.family && !r.asset ? `Requested: ${r.family}` : null,
    r.description ? `Description: ${r.description}` : null,
    `Contact: ${r.contact || ''} ${r.phone || ''}`.trim(),
    `CoolerCo ref: ${r.case_number}`,
  ].filter(Boolean).join('\n')
}

function LogCom({ call, onChange }) {
  const [rows, load, err] = useList(call, 'coolerco_conc_requests', { p_view: 'to_log' }, [call])
  const [com, setCom] = useState({})
  const [msg, setMsg] = useState(null)
  async function save(r) {
    setMsg(null)
    const d = await call('coolerco_conc_link_com', { p_case: r.case_number, p_com: com[r.case_number] || '' }).catch(e => ({ error: e.message }))
    if (!d) return
    if (d.error) return setMsg({ bad: true, text: ERR[d.error] || d.error })
    setMsg({ text: `🔗 ${r.case_number} linked to ${String(com[r.case_number]).toUpperCase().trim()}${d.in_com_yet ? '' : ' — it will show its COM progress after the next COM upload.'}` })
    load(); onChange()
  }
  return (
    <>
      <div className="p-card c-help">
        <b>How this works</b>
        <ol>
          <li>Tap <b>📋 Copy for COM</b> and paste the details into a new case in the COM portal.</li>
          <li>Type the COM case number here and tap <b>Link</b>. The request then follows the COM case — no double work.</li>
        </ol>
      </div>
      {msg && <div className={`p-card c-msg ${msg.bad ? 'bad' : ''}`}>{msg.text}</div>}
      {!rows ? <Loading err={err} /> : !rows.length ? <Empty icon="✔️" text="All accepted requests are logged in COM." />
        : rows.map(r => (
          <div className="p-card" key={r.case_number}>
            <RequestHead r={r} />
            <div className="c-actions">
              <button className="p-btn ghost" onClick={() => { navigator.clipboard?.writeText(comText(r)); setMsg({ text: '📋 Details copied — paste them into COM.' }) }}>📋 Copy for COM</button>
            </div>
            <div className="c-link">
              <input placeholder="COM case no. e.g. CAS-3031960-K3B2W1" value={com[r.case_number] || ''} onChange={e => setCom({ ...com, [r.case_number]: e.target.value })} />
              <button className="p-btn" disabled={!(com[r.case_number] || '').trim()} onClick={() => save(r)}>🔗 Link</button>
            </div>
          </div>
        ))}
    </>
  )
}

function Cases({ call }) {
  const [q, setQ] = useState('')
  const [deb, setDeb] = useState('')
  const [status, setStatus] = useState('open')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState(null)
  useEffect(() => { const t = setTimeout(() => { setDeb(q.trim()); setPage(0) }, 400); return () => clearTimeout(t) }, [q])
  const GROUPS = ['open', 'attention', 'closed', 'all']
  const pStatus = deb && GROUPS.includes(status) ? 'all' : status
  const [data, , err] = useList(call, 'coolerco_conc_cases', { p_search: deb || null, p_status: pStatus, p_limit: 50, p_offset: page * 50 }, [deb, pStatus, page, call])
  const total = data?.total || 0
  const pick = k => { setStatus(k); setPage(0); setOpen(null) }
  const groupOf = st => (data?.by_status || []).find(b => b.status === st)?.group
  const seg = GROUPS.includes(status) ? status : groupOf(status) || 'all'
  const gCount = g => (data?.by_status || []).filter(b => g === 'all' || b.group === g).reduce((a, b) => a + b.n, 0)
  const chips = (data?.by_status || []).filter(b => seg === 'all' || b.group === seg)
  return (
    <>
      <div className="c-search">
        <input placeholder="🔍 Case no., store name, POS code, barcode…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <p className="p-muted" style={{ marginTop: -4 }}>🔧 Repair at Shopper POS · 🚚 Delivery · 🔄 Replacement · 📦 Removal — warehouse cases are not shown.</p>
      <div className="c-seg c-seg-wrap">
        {[['open', 'Open'], ['attention', '⚠️ Needs action'], ['closed', deb ? 'Closed' : 'Closed (2 months)'], ['all', 'All']].map(([k, l]) => (
          <button key={k} className={seg === k ? 'on' : ''} onClick={() => pick(k)}>{l}{data ? <span className="c-segn">{gCount(k)}</span> : null}</button>
        ))}
      </div>
      {chips.length > 1 && (
        <div className="c-chips">
          {chips.map(b => (
            <button key={b.status} className={`c-chip ${status === b.status ? 'on' : ''}`} onClick={() => pick(status === b.status ? seg : b.status)}>
              <span className={`p-tag ${statusTag(b.status)}`}>{b.status}</span><b>{b.n}</b>
            </button>
          ))}
        </div>
      )}
      {!data ? <Loading err={err} /> : !data.rows.length ? <Empty icon="🔍" text={deb ? 'No cases found for your stores.' : 'No cases.'} /> : (
        <>
          <p className="p-muted">{total.toLocaleString()} case{total === 1 ? '' : 's'}{GROUPS.includes(status) ? '' : ` · ${status}`}{data.by_type ? ' · ' + Object.entries(data.by_type).map(([t, n]) => `${icon(t)} ${n}`).join('  ') : ''} · status updated by COM</p>
          {data.rows.map(c => (
            <div className="p-card c-case" key={c.case_number}>
              <button className="c-row-top c-btnrow" onClick={() => setOpen(open === c.case_number ? null : c.case_number)}>
                <span className="c-ico">{icon(c.case_type)}</span>
                <div className="c-grow">
                  <strong>{c.point_of_sale}</strong>
                  <small>{c.case_type} · {fmtD(c.created_on)}</small>
                </div>
                <span className={`p-tag ${statusTag(c.status)}`}>{c.status || '—'}</span>
                {c.comments > 0 && <span className="c-cnt">💬{c.comments}</span>}
              </button>
              {open === c.case_number && (
                <>
                  <div className="p-sum c-sum">
                    <div><span>COM case</span><b className="c-mono">{c.case_number}</b></div>
                    <div><span>Store</span>{c.point_of_sale} · {c.pos_local_code}</div>
                    <div><span>Status</span><span className={`p-tag ${statusTag(c.status)}`}>{c.status || '—'}</span></div>
                    <div><span>{c.case_type === 'Replacement of Asset' ? 'New asset' : 'Asset'}</span><span className="c-mono">{c.asset || '—'}</span></div>
                    {c.asset_removed && <div><span>Removed</span><span className="c-mono">{c.asset_removed}</span></div>}
                    <div><span>Due</span>{fmtD(c.end_date)}{c.sla_class ? ` · SLA ${c.sla_class}` : ''}{c.sla ? ` · ${c.sla}` : ''}</div>
                    {c.closed && <div><span>Closed</span>{fmtD(c.closed)}</div>}
                    {c.motive && <div><span>Reason</span>{c.motive}</div>}
                    <div><span>Warehouse</span>{c.warehouse}</div>
                  </div>
                  <Comments call={call} caseNo={c.case_number} count={c.comments} startOpen />
                </>
              )}
            </div>
          ))}
          {total > 50 && (
            <div className="c-actions">
              <button className="p-btn ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Previous</button>
              <span className="p-muted" style={{ alignSelf: 'center' }}>{page + 1} / {Math.ceil(total / 50)}</span>
              <button className="p-btn ghost" disabled={(page + 1) * 50 >= total} onClick={() => setPage(p => p + 1)}>Next ›</button>
            </div>
          )}
        </>
      )}
    </>
  )
}

function Comments({ call, caseNo, count, startOpen }) {
  const [open, setOpen] = useState(!!startOpen)
  const [list, setList] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => call('coolerco_conc_comments', { p_case: caseNo }).then(d => setList(Array.isArray(d) ? d : [])), [call, caseNo])
  useEffect(() => { if (open) load() }, [open, load])
  async function add() {
    setBusy(true)
    await call('coolerco_conc_add_comment', { p_case: caseNo, p_body: text }).catch(() => null)
    setBusy(false); setText(''); load()
  }
  return (
    <div className="c-comments">
      <button className="c-link-btn" onClick={() => setOpen(!open)}>💬 Comments{count ? ` (${count})` : ''} {open ? '▴' : '▾'}</button>
      {open && (
        <div>
          {!list ? <p className="p-muted"><span className="p-spin" /> Loading…</p>
            : !list.length ? <p className="p-muted">No comments yet.</p>
              : list.map((m, i) => (
                <div key={i} className={`c-cmt ${m.type}`}>
                  <div className="c-cmt-who">{m.type === 'staff' ? '🏢' : m.type === 'customer' ? '🏪' : '🤝'} {m.who} · {fmtDT(m.at)}</div>
                  <div>{m.body}</div>
                </div>
              ))}
          <div className="c-link">
            <input placeholder="Add a comment for CoolerCo…" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && text.trim() && add()} />
            <button className="p-btn" disabled={busy || !text.trim()} onClick={add}>Send</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stores({ call, ctx }) {
  const [rows, , err] = useList(call, 'coolerco_conc_stores', {}, [call])
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(60)
  if (!rows) return <Loading err={err} />
  const s = q.trim().toLowerCase()
  const list = s ? rows.filter(r => (r.name || '').toLowerCase().includes(s) || (r.pos || '').toLowerCase().includes(s)) : rows
  const withAssets = rows.filter(r => r.assets > 0).length
  return (
    <>
      <div className="c-stats">
        <div><b>{(ctx.assets_at_pos || 0).toLocaleString()}</b><small>❄️ asset base at POS (you are responsible)</small></div>
        <div><b>{rows.length.toLocaleString()}</b><small>🏪 stores · {withAssets.toLocaleString()} with assets</small></div>
      </div>
      <div className="c-search"><input placeholder="🔍 Store name or POS code…" value={q} onChange={e => { setQ(e.target.value); setShown(60) }} /></div>
      <div className="p-card" style={{ padding: '4px 14px' }}>
        {!list.length ? <p className="p-muted">No stores match.</p> : list.slice(0, shown).map(r => (
          <div className="p-req" key={r.pos}>
            <div className="c-grow"><strong style={{ fontSize: 13 }}>{r.name}</strong><small className="p-muted" style={{ display: 'block', margin: 0 }}>{r.pos} · {r.warehouse || '—'}</small></div>
            <span className="p-tag">❄️ {r.assets}</span>
          </div>
        ))}
        {list.length > shown && <button className="c-link-btn" style={{ margin: '10px 0' }} onClick={() => setShown(n => n + 100)}>Show more ({(list.length - shown).toLocaleString()} left)</button>}
      </div>
    </>
  )
}


// ⚠️ Needs action: the driver could not find the store or reach the customer. Check and fix the details, then ask for a new visit.
function NeedsAction({ call, alerts, onChange }) {
  const [open, setOpen] = useState(null)
  const [f, setF] = useState({})
  const [note, setNote] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const start = a => { setOpen(a.id); setMsg(null); setChecked(false); setNote(''); const o = a.outlet || {}
    setF({ contact_person: o.contact_person || '', mobile_number: o.mobile_number || '', street_address: o.street_address || '', suburb: o.suburb || '', town: o.town || '',
           gps: o.latitude != null ? `${o.latitude}, ${o.longitude}` : '' }) }
  const parseGps = t => { const m = String(t || '').match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/); return m ? { lat: +m[1], lng: +m[2] } : null }
  const myLocation = () => navigator.geolocation?.getCurrentPosition(p => setF(x => ({ ...x, gps: `${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}` })),
    () => setMsg({ bad: true, text: 'Could not read your location — paste the map pin instead.' }), { enableHighAccuracy: true, timeout: 10000 })

  async function save(a) {
    setBusy(true); setMsg(null)
    const g = parseGps(f.gps)
    if (f.gps && !g) { setBusy(false); return setMsg({ bad: true, text: 'Paste the map pin as "-26.12345, 28.12345" (or a Google Maps link).' }) }
    const p = { contact_person: f.contact_person, mobile_number: f.mobile_number, street_address: f.street_address, suburb: f.suburb, town: f.town, ...(g ? { latitude: g.lat, longitude: g.lng } : {}) }
    const d = await call('coolerco_conc_alert_fix', { p_alert: a.id, p }).catch(e => ({ error: e.message }))
    if (!d || d.error) { setBusy(false); return setMsg({ bad: true, text: d?.error === 'bad_gps' ? 'That map pin is not in South Africa.' : d?.error === 'no_outlet' ? 'This store is not in the register — ask the warehouse to fix it.' : d?.error || 'Not saved' }) }
    const r = await call('coolerco_conc_reschedule', { p_alert: a.id, p_note: note || null }).catch(e => ({ error: e.message }))
    setBusy(false)
    if (!r || r.error) return setMsg({ bad: true, text: r?.error === 'already_done' ? 'Already done.' : r?.error || 'Not saved' })
    setMsg({ text: r.new_case ? `✅ Store details saved · new visit booked as ${r.new_case}.` : `✅ Store details saved (${r.note}).` })
    setOpen(null); onChange()
  }

  return (
    <>
      {msg && <div className={`p-card c-msg ${msg.bad ? 'bad' : ''}`}>{msg.text}</div>}
      {!alerts.length ? <Empty icon="🎉" text="Nothing needs your action." /> : alerts.map(a => {
        const o = a.outlet || {}, isOpen = a.status === 'open'
        return (
          <div className="p-card" key={a.id} style={isOpen ? { borderLeft: '4px solid #e8590c' } : {}}>
            <div style={{ fontWeight: 600 }}>{a.kind === 'location' ? '📍 The driver could not find this store' : '📞 The driver could not reach the customer'}</div>
            <div style={{ fontSize: 13 }}>{o.name} <span className="c-mono" style={{ opacity: .7 }}>{o.code}</span></div>
            <div style={{ fontSize: 12, opacity: .8 }}>{a.case_type} · <span className="c-mono">{a.case_number}</span></div>
            {a.reason && <div style={{ fontSize: 12, marginTop: 4 }}>{a.reason}</div>}
            {!isOpen ? <div style={{ fontSize: 12, marginTop: 6 }}>✅ Done by {a.done_by}{a.follow_up ? ` · new visit ${a.follow_up}` : ''}</div>
              : open !== a.id ? <div className="c-actions"><button className="p-btn" onClick={() => start(a)}>🔎 Check the store & book a new visit</button></div> : (
              <div className="c-decide">
                <div className="p-label">Map pin {o.latitude != null && <a href={`https://www.google.com/maps?q=${o.latitude},${o.longitude}`} target="_blank" rel="noreferrer">(see current pin ↗)</a>}</div>
                <input value={f.gps} onChange={e => setF({ ...f, gps: e.target.value })} placeholder="-26.12345, 28.12345 or a Google Maps link" />
                <div className="c-actions" style={{ justifyContent: 'flex-start' }}>
                  <button className="p-btn ghost" onClick={myLocation}>📱 I am at the store now</button>
                  <a className="p-btn ghost" href={`https://www.google.com/maps/search/${encodeURIComponent([o.name, o.street_address, o.town].filter(Boolean).join(' '))}`} target="_blank" rel="noreferrer">🔎 Find on Google Maps</a>
                </div>
                <div className="p-label">Street address</div><input value={f.street_address} onChange={e => setF({ ...f, street_address: e.target.value })} />
                <div className="p-label">Suburb · Town</div>
                <div style={{ display: 'flex', gap: 6 }}><input value={f.suburb} onChange={e => setF({ ...f, suburb: e.target.value })} /><input value={f.town} onChange={e => setF({ ...f, town: e.target.value })} /></div>
                <div className="p-label">Contact person · Mobile</div>
                <div style={{ display: 'flex', gap: 6 }}><input value={f.contact_person} onChange={e => setF({ ...f, contact_person: e.target.value })} /><input value={f.mobile_number} onChange={e => setF({ ...f, mobile_number: e.target.value })} inputMode="tel" /></div>
                <div className="p-label">Note for the warehouse (optional)</div>
                <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. entrance is at the back, ask for Thabo" />
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginTop: 6 }}>
                  <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} style={{ width: 'auto' }} /> I checked the {a.kind === 'location' ? 'location' : 'contact details'} — they are correct now
                </label>
                <div className="c-actions">
                  <button className="p-btn ghost" onClick={() => setOpen(null)}>Cancel</button>
                  <button className="p-btn" disabled={busy || !checked} onClick={() => save(a)}>{busy ? 'Saving…' : '✅ Save & book a new visit'}</button>
                </div>
              </div>)}
          </div>)
      })}
    </>
  )
}
