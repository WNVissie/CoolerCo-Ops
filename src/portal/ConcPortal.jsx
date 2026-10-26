import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
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
const statusTag = s => (s === 'Waiting for Approval' ? 'warn' : s === 'Rejected' || /cancel/i.test(s || '') ? 'bad' : OPEN.includes((s || '').toLowerCase()) || s === 'Linked to COM' ? 'ok' : '')

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
    const { data, error } = await supabase.rpc(fn, { p_session: session, ...args })
    if (error) throw new Error(error.message)
    if (data?.error === 'expired') { try { sessionStorage.removeItem(key) } catch {} ; setSession(null); setCtx(null); setErr(ERR.expired); return null }
    return data
  }, [session, key])

  const loadCtx = useCallback(async () => { if (session) { const d = await call('coolerco_conc_context').catch(e => setErr(e.message)); if (d) setCtx(d) } }, [session, call])
  useEffect(() => { loadCtx() }, [loadCtx])

  if (!session) return staff
    ? <Shell><div className="p-card p-center"><div className="p-big">⏱️</div><p>This staff view has ended. Open it again from <b>Concessionaires</b> in CoolerCo-Ops.</p></div></Shell>
    : <PinScreen link={link} msg={err} onLogin={s => { try { sessionStorage.setItem(key, s) } catch {} ; setErr(null); setSession(s) }} />

  if (!ctx) return <Shell><div className="p-card p-center">{err ? <p className="p-err">{err}</p> : <><span className="p-spin" /> Loading…</>}</div></Shell>

  const logout = () => { try { sessionStorage.removeItem(key) } catch {} ; setSession(null); setCtx(null) }
  const TABS = [
    ['approve', '✅', 'To approve', ctx.to_approve],
    ['log', '📝', 'Log in COM', ctx.to_log],
    ['cases', '📋', 'Cases', ctx.open_com],
    ['stores', '🏪', 'Stores', ctx.stores],
  ]
  return (
    <Shell who={ctx.concessionaire} sub={ctx.actor} onLogout={staff ? null : logout}>
      {ctx.actor_type === 'staff' && <div className="p-card p-dup" style={{ padding: 10, fontSize: 12.5 }}>👁 Staff view — you see exactly what <b>{ctx.concessionaire}</b> sees. Anything you do is logged under your name.</div>}
      <div className="c-kpis">
        <div><span>❄️</span><b>{(ctx.assets_at_pos || 0).toLocaleString()}</b><small>assets at your stores</small></div>
        <div><span>🏪</span><b>{(ctx.stores || 0).toLocaleString()}</b><small>stores</small></div>
        <div><span>📋</span><b>{(ctx.open_com || 0).toLocaleString()}</b><small>open COM cases</small></div>
        {ctx.assets_in_workshop > 0 && <div><span>🛠️</span><b>{ctx.assets_in_workshop.toLocaleString()}</b><small>in workshop</small></div>}
      </div>
      <div className="p-tabs c-tabs">
        {TABS.map(([k, i, l, n]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            <span className="c-tab-ico">{i}</span><span className="c-tab-lbl">{l}</span>{n > 0 && <span className="p-count">{n > 999 ? '999+' : n}</span>}
          </button>
        ))}
      </div>
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
  useEffect(() => { supabase.rpc('coolerco_conc_link_info', { p_link: link }).then(({ data }) => setInfo(data || { error: 'invalid_link' })) }, [link])
  async function go(e) {
    e.preventDefault(); setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('coolerco_conc_login', { p_link: link, p_pin: pin })
    setBusy(false)
    if (error) return setErr(error.message)
    if (data?.error) { setPin(''); return setErr(ERR[data.error] || data.error) }
    onLogin(data.session)
  }
  return (
    <Shell>
      <div className="p-card p-center">
        {!info ? <><span className="p-spin" /> Checking your link…</>
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
  const [data, , err] = useList(call, 'coolerco_conc_cases', { p_search: deb || null, p_status: status, p_limit: 50, p_offset: page * 50 }, [deb, status, page, call])
  const total = data?.total || 0
  return (
    <>
      <div className="c-search">
        <input placeholder="🔍 Case no., store name, POS code, barcode…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {!deb && (
        <div className="c-seg">
          {[['open', 'Open'], ['closed', 'Closed (2 months)']].map(([k, l]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => { setStatus(k); setPage(0) }}>{l}</button>)}
        </div>
      )}
      {!data ? <Loading err={err} /> : !data.rows.length ? <Empty icon="🔍" text={deb ? 'No cases found for your stores.' : 'No cases.'} /> : (
        <>
          <p className="p-muted">{total.toLocaleString()} COM case{total === 1 ? '' : 's'}{deb ? ' found (all statuses)' : ''} · read-only — progress is updated by COM</p>
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
                    <div><span>Asset</span><span className="c-mono">{c.asset || '—'}</span></div>
                    <div><span>Due</span>{fmtD(c.end_date)}{c.sla ? ` · ${c.sla}` : ''}</div>
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
