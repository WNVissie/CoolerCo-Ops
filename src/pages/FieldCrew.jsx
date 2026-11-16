import { useState, useEffect, useCallback } from 'react'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { WH_NAMES } from '../lib/helpers'

// 👷 Field crew (script 034) — for supervisors / planners
//   📅 Today's crew: each route of the day with the person driving it. "Usual" = the person in the route's RouteIQ slot.
//      Set another driver (+ helpers) after routing — swaps are logged. Approve / reject drivers' requests.
//   👷 Slots & logins: 5 drivers + 5 technicians per warehouse. Fill in the real name, phone and RouteIQ / COM name;
//      create the person's login (email, or a username when they have no email). New person → change the name only.
const iso = d => d.toLocaleDateString('en-CA')
const fmtTime = t => (t ? new Date(t).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const WHS = Object.keys(WH_NAMES)
const needs034 = e => (/does not exist|Could not find|PGRST202/i.test(e?.message || '') ? 'This screen needs database script 034 — not applied on this database yet.' : e?.message)

export default function FieldCrew() {
  const [tab, setTab] = useState('crew')
  const [wh, setWh] = useState(() => localStorage.getItem('cc_crew_wh') || 'JHB')
  useEffect(() => { localStorage.setItem('cc_crew_wh', wh) }, [wh])
  return (
    <>
      <Topbar title="Field crew" sub="Who drives which route · drivers' and technicians' slots and logins" />
      <div className="page-content">
        <div className="filters" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div className="seg">
            <button className={`seg-btn ${tab === 'crew' ? 'on' : ''}`} onClick={() => setTab('crew')}>📅 Today's crew</button>
            <button className={`seg-btn ${tab === 'slots' ? 'on' : ''}`} onClick={() => setTab('slots')}>👷 Slots & logins</button>
          </div>
          <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => setWh(e.target.value)}>
            {WHS.map(c => <option key={c} value={c}>{WH_NAMES[c]}</option>)}
          </select>
        </div>
        {tab === 'crew' ? <CrewBoard wh={wh} /> : <Slots wh={wh} />}
      </div>
    </>
  )
}

function CrewBoard({ wh }) {
  const [date, setDate] = useState(() => iso(new Date()))
  const [b, setB] = useState(null)
  const [err, setErr] = useState(null)
  const [edit, setEdit] = useState(null)   // { route, driver, helpers[], note }
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    setB(null); setErr(null)
    supabase.rpc('coolerco_crew_board', { p_date: date, p_warehouse: wh }).then(({ data, error }) => error ? setErr(needs034(error)) : setB(data))
  }, [date, wh])
  useEffect(() => { load() }, [load])

  const save = async (route, driver, helpers, note) => {
    setBusy(true)
    const { error } = await supabase.rpc('coolerco_crew_set', { p_route: route, p_driver: driver || null, p_helpers: helpers || [], p_note: note || null })
    setBusy(false)
    if (error) return alert(error.message)
    setEdit(null); load()
  }
  const decide = async (id, ok) => {
    const note = ok ? null : prompt('Reason (optional) — the driver sees it:') ?? null
    const { error } = await supabase.rpc('coolerco_crew_decide', { p_request: id, p_approve: ok, p_note: note })
    if (error) return alert(error.message)
    load()
  }
  const people = b?.people || []

  return (
    <>
      <div className="filters" style={{ gap: 8, alignItems: 'center' }}>
        <input type="date" className="field-ctrl" style={{ width: 'auto' }} value={date} onChange={e => e.target.value && setDate(e.target.value)} />
        <button className="btn btn-ghost btn-sm" onClick={load}>↻ Refresh</button>
        <span className="text3" style={{ fontSize: 11 }}>Drivers see only finalised routes that are linked to them.</span>
      </div>
      {err && <div className="form-msg err">{err}</div>}
      {!b && !err && <div className="load-state"><span className="spinner" /></div>}

      {b?.requests?.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid #d98a1c' }}>
          <div className="card-title">🔔 Requests from drivers ({b.requests.length})</div>
          {b.requests.map(q => {
            const r = b.routes.find(x => x.id === q.route_id)
            return (
              <div key={q.id} className="f-row" style={{ gap: 8, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ flex: 1 }}><b>{q.name}</b> · {q.kind === 'claim' ? 'says he is driving' : 'says he is NOT driving'} <b>{r?.route_number || 'a route'}</b>
                  <div className="text3" style={{ fontSize: 11 }}>{fmtTime(q.at)}{q.note ? ` · "${q.note}"` : ''}</div></div>
                <button className="btn btn-primary btn-sm" onClick={() => decide(q.id, true)}>✅ Approve</button>
                <button className="btn btn-ghost btn-sm" onClick={() => decide(q.id, false)}>🚫 Reject</button>
              </div>
            )
          })}
        </div>
      )}

      {b && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Route</th><th>Status</th><th>RouteIQ slot</th><th>Stops</th><th>Driving today</th><th>Helpers</th><th /></tr></thead>
            <tbody>
              {!b.routes.length && <tr><td colSpan={7} className="text3">No routes for {WH_NAMES[wh]} on this day.</td></tr>}
              {b.routes.map(r => {
                const drv = r.crew.find(c => c.role === 'driver'), helpers = r.crew.filter(c => c.role === 'helper')
                const isEdit = edit?.route === r.id
                return (
                  <tr key={r.id}>
                    <td><b>{r.route_number}</b></td>
                    <td><span className={`tag tag-${r.status === 'draft' ? 'neutral' : 'blue'}`}>{r.status}</span></td>
                    <td className="text3">{r.slot_name || r.slot}</td>
                    <td>{r.stops ?? '—'}</td>
                    <td>{isEdit
                      ? <select className="field-ctrl" value={edit.driver || ''} onChange={e => setEdit(x => ({ ...x, driver: e.target.value }))}>
                          <option value="">— usual person of the slot —</option>
                          {people.map(p => <option key={p.user_id} value={p.user_id}>{p.type === 'technician' ? '🛠' : '🚚'} {p.name}</option>)}
                        </select>
                      : drv ? <>{drv.name} <span className={`tag tag-${drv.source === 'set' ? 'orange' : 'neutral'}`}>{drv.source === 'set' ? 'set today' : 'usual'}</span></>
                        : <span className="tag tag-red">No one linked</span>}</td>
                    <td>{isEdit
                      ? <select multiple className="field-ctrl" style={{ minHeight: 70 }} value={edit.helpers} onChange={e => setEdit(x => ({ ...x, helpers: [...e.target.selectedOptions].map(o => o.value) }))}>
                          {people.filter(p => p.user_id !== edit.driver).map(p => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
                        </select>
                      : helpers.map(h => h.name).join(', ') || <span className="text3">—</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{isEdit ? <>
                        <input className="field-ctrl" placeholder="Note (why)" style={{ width: 120 }} value={edit.note} onChange={e => setEdit(x => ({ ...x, note: e.target.value }))} />
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => save(r.id, edit.driver, edit.helpers, edit.note)}>Save</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEdit(null)}>✕</button></>
                      : <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ route: r.id, driver: drv?.source === 'set' ? drv.user_id : '', helpers: helpers.map(h => h.user_id), note: '' })}>🔄 Change</button>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {b && !people.length && <div className="form-msg warn">No drivers or technicians with a login in {WH_NAMES[wh]} yet — add them under 👷 Slots & logins.</div>}
      {b?.log?.length > 0 && (
        <details className="card"><summary className="card-title" style={{ cursor: 'pointer' }}>🕘 Changes ({b.log.length})</summary>
          {b.log.map((l, i) => <div key={i} className="text3" style={{ fontSize: 11.5 }}>{fmtTime(l.at)} · {l.by || '—'} · {(b.routes.find(r => r.id === l.route_id) || {}).route_number} · {l.action.replace(/_/g, ' ')}{l.name ? ` → ${l.name}` : ''}{l.note ? ` · ${l.note}` : ''}</div>)}
        </details>
      )}
      <p className="text3" style={{ fontSize: 11 }}>To go back to the usual person of the slot, choose "— usual person of the slot —" with no helpers.</p>
    </>
  )
}

function Slots({ wh }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [draft, setDraft] = useState({})
  const [login, setLogin] = useState(null)  // { slot, email, username, password }
  const [msg, setMsg] = useState(null)
  const load = useCallback(() => {
    setRows(null); setErr(null)
    supabase.rpc('coolerco_field_slot_list', { p_warehouse: wh }).then(({ data, error }) => error ? setErr(needs034(error)) : setRows(data || []))
  }, [wh])
  useEffect(() => { load(); setDraft({}) }, [load])
  const val = (r, k) => (draft[r.id]?.[k] ?? r[k] ?? '')
  const set = (r, k, v) => setDraft(d => ({ ...d, [r.id]: { ...d[r.id], [k]: v } }))
  const save = async r => {
    const { error } = await supabase.rpc('coolerco_field_slot_save', {
      p_slot: r.id, p_person: val(r, 'person_name'), p_phone: val(r, 'phone'), p_routeiq: val(r, 'routeiq_username'),
      p_login_email: val(r, 'login_email'), p_active: draft[r.id]?.active ?? r.active,
    })
    if (error) return setMsg({ t: 'err', s: error.message })
    setMsg({ t: 'ok', s: `Saved ${val(r, 'person_name') || 'slot'}.` }); setDraft(d => { const n = { ...d }; delete n[r.id]; return n }); load()
  }
  const add = async type => { const { error } = await supabase.rpc('coolerco_field_slot_add', { p_warehouse: wh, p_type: type }); if (error) return setMsg({ t: 'err', s: error.message }); load() }
  const makeLogin = async () => {
    const { data, error } = await supabase.functions.invoke('coolerco-field-login', { body: { slot_id: login.slot.id, email: login.email.trim() || undefined, username: login.username.trim() || undefined, password: login.password } })
    const e = error ? (await error.context?.json?.().catch(() => null))?.error || error.message : data?.error
    if (e) return setMsg({ t: 'err', s: e })
    setMsg({ t: 'ok', s: `${data.action === 'created' ? 'Login created' : 'Password reset'} for ${login.slot.person_name || 'the slot'}: sign in with ${data.username ? `username "${data.username}"` : data.email} and the password you typed. Tell the person; it is not shown again.` })
    setLogin(null); load()
  }

  return (
    <>
      <p className="text3" style={{ fontSize: 11.5 }}>Each slot is one position. Put the person's real name here — when someone new takes the slot, change only the name (old names are kept with dates). RouteIQ / COM name = the slot the planner routes to (e.g. RTMAGTD2). Contractors keep using the WhatsApp trip-sheet link.</p>
      {msg && <div className={`form-msg ${msg.t === 'ok' ? 'ok' : 'err'}`}>{msg.s}</div>}
      {err && <div className="form-msg err">{err}</div>}
      {!rows && !err && <div className="load-state"><span className="spinner" /></div>}
      {rows && ['driver', 'technician'].map(type => (
        <div key={type} className="card">
          <div className="card-title">{type === 'driver' ? '🚚 Drivers' : '🛠 Technicians'} · {WH_NAMES[wh]}</div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>#</th><th>Real name</th><th>Phone</th><th>RouteIQ / COM name</th><th>Login</th><th>Active</th><th /></tr></thead>
            <tbody>{rows.filter(r => r.worker_type === type).map(r => (
              <tr key={r.id}>
                <td>{r.slot_no}</td>
                <td><input className="field-ctrl" style={{ minWidth: 160 }} placeholder="Name Surname" value={val(r, 'person_name')} onChange={e => set(r, 'person_name', e.target.value)} /></td>
                <td><input className="field-ctrl" style={{ width: 120 }} inputMode="tel" value={val(r, 'phone')} onChange={e => set(r, 'phone', e.target.value)} /></td>
                <td><input className="field-ctrl mono" style={{ width: 130 }} placeholder="RTMA…" value={val(r, 'routeiq_username')} onChange={e => set(r, 'routeiq_username', e.target.value.toUpperCase())} /></td>
                <td>{r.user_id
                  ? <span className="text3" style={{ fontSize: 11 }}>{r.login_email?.endsWith('@field.smartpartners.co.za') ? `👤 ${r.login_email.split('@')[0]}` : `✉️ ${r.login_email}`}</span>
                  : <input className="field-ctrl" style={{ width: 170 }} placeholder="existing login email (optional)" value={val(r, 'login_email')} onChange={e => set(r, 'login_email', e.target.value)} />}
                  <button className="btn btn-ghost btn-sm" onClick={() => setLogin({ slot: r, email: '', username: (val(r, 'routeiq_username') || '').toLowerCase(), password: '' })}>{r.user_id ? '🔑 Reset password' : '➕ Create login'}</button></td>
                <td><input type="checkbox" checked={draft[r.id]?.active ?? r.active} onChange={e => set(r, 'active', e.target.checked)} /></td>
                <td>{draft[r.id] && <button className="btn btn-primary btn-sm" onClick={() => save(r)}>💾 Save</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <button className="btn btn-ghost btn-sm" onClick={() => add(type)}>＋ Add {type} slot</button>
        </div>
      ))}
      {login && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 80 }} onClick={() => setLogin(null)}>
          <div className="card" style={{ maxWidth: 420, margin: '10vh auto' }} onClick={e => e.stopPropagation()}>
            <div className="card-title">{login.slot.user_id ? '🔑 Reset password' : '➕ Create login'} · {login.slot.person_name || `${login.slot.worker_type} ${login.slot.slot_no}`}</div>
            {!login.slot.user_id && <>
              <div className="field-lbl">Email (if the person has one)</div>
              <input className="field-ctrl" type="email" value={login.email} onChange={e => setLogin(l => ({ ...l, email: e.target.value }))} />
              <div className="field-lbl" style={{ marginTop: 8 }}>…or a username (no email needed)</div>
              <input className="field-ctrl mono" value={login.username} onChange={e => setLogin(l => ({ ...l, username: e.target.value.toLowerCase().replace(/\s/g, '') }))} placeholder="e.g. rtmagtd2" />
            </>}
            <div className="field-lbl" style={{ marginTop: 8 }}>Password (at least 8 characters)</div>
            <input className="field-ctrl" type="text" value={login.password} onChange={e => setLogin(l => ({ ...l, password: e.target.value }))} />
            <div className="f-row" style={{ gap: 6, marginTop: 12 }}>
              <button className="btn btn-primary" disabled={login.password.length < 8} onClick={makeLogin}>{login.slot.user_id ? 'Reset' : 'Create'}</button>
              <button className="btn btn-ghost" onClick={() => setLogin(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
