import { useState, useEffect, useMemo } from 'react'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { WAREHOUSES, WH_NAMES, fmt } from '../lib/helpers'

// 👥 Users & roles (script 026). Everyone signs in with their SmartHub account; here an administrator gives each person
// their CoolerCo role(s), for all warehouses or one. Nothing is deleted: a role is switched off/on, every change logged.
// Overrides (pick anyway, short loading…) = system admin, manager or supervisor (setting override_roles).
const ROLE_ICON = { system_admin: '🛡', administrator: '🗝', manager: '👔', supervisor: '🧑‍✈️', stock_controller: '📦', warehouse_assistant: '🧰',
  supplier: '🏭', client: '🤝', viewer: '👁', contractor_admin: '🏗', technician: '🔧', driver: '🚚' }
const WAREHOUSE_ROLES = ['supervisor', 'stock_controller', 'warehouse_assistant', 'technician', 'driver']
const CLIENTS = [['', 'All clients'], ['MAGNUM', 'Magnum'], ['TIGER', 'Tiger Brands']]
const ERR = { not_allowed: 'Only administrators can manage users.', only_system_admin: 'Only the system administrator can give or remove admin roles.',
  not_yourself: 'You can’t switch off your own system administrator role.', unknown_role: 'Unknown role.', unknown_user: 'User not found.' }
const ago = d => { if (!d) return 'never'; const days = Math.floor((Date.now() - new Date(d)) / 864e5); return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago` }

export default function Users() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [show, setShow] = useState('all') // all | none | warehouse
  const [tick, setTick] = useState(0)
  const [adding, setAdding] = useState(null) // user id with open add form
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    supabase.rpc('coolerco_users_admin').then(({ data, error }) => {
      if (error) setErr(/does not exist|Could not find/i.test(error.message) ? 'This page needs database script 026.' : error.message)
      else if (data?.error) setErr(ERR[data.error] || data.error)
      else setD(data)
    })
  }, [tick])

  const roles = d?.roles || []
  const label = c => roles.find(r => r.code === c)?.label || c
  const s = q.trim().toLowerCase()
  const users = useMemo(() => (d?.users || []).filter(u => {
    const act = (u.access || []).filter(a => a.active)
    if (show === 'none' && act.length) return false
    if (show === 'warehouse' && !act.some(a => WAREHOUSE_ROLES.includes(a.role))) return false
    return !s || [u.email, u.name, ...act.map(a => label(a.role))].some(v => String(v || '').toLowerCase().includes(s))
  }), [d, s, show]) // eslint-disable-line react-hooks/exhaustive-deps
  const none = (d?.users || []).filter(u => !(u.access || []).some(a => a.active)).length

  async function setActive(a, on) {
    const { data, error } = await supabase.rpc('coolerco_user_access_set', { p_id: a.id, p_active: on })
    if (error || data?.error) setMsg({ bad: true, t: ERR[data?.error] || error?.message || data.error }); else { setMsg(null); setTick(t => t + 1) }
  }

  return (
    <>
      <Topbar title="Users & roles" sub="SmartHub sign-ins → what each person may do in CoolerCo" />
      <div className="page-content">
        {err && <div className="form-msg error">{err}</div>}
        {msg && <div className={`form-msg ${msg.bad ? 'error' : 'success'}`}>{msg.t}</div>}
        {d && <>
          <div className="filters" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="search-wrap" style={{ flex: 1, minWidth: 200 }}><span className="ico">🔍</span>
              <input placeholder="Name, email or role…" value={q} onChange={e => setQ(e.target.value)} /></div>
            <div className="seg">
              {[['all', `All (${d.users.length})`], ['none', `No role (${none})`], ['warehouse', 'Warehouse team']].map(([k, l]) =>
                <button key={k} className={`seg-btn${show === k ? ' on' : ''}`} onClick={() => setShow(k)}>{l}</button>)}
            </div>
          </div>
          <div className="card">
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Person</th><th>CoolerCo roles</th><th>SmartHub (hint)</th><th></th></tr></thead>
              <tbody>{users.map(u => {
                const acc = u.access || []
                return (
                  <tr key={u.id}>
                    <td style={{ fontSize: 11.5, minWidth: 180 }}>
                      <b>{u.name || u.email.split('@')[0]}</b>{u.id === d.me && <span className="tag tag-blue" style={{ marginLeft: 4 }}>you</span>}
                      <div className="text3" style={{ fontSize: 10.5 }}>{u.email}</div>
                      <div className="text3" style={{ fontSize: 10 }}>last sign-in {ago(u.last_sign_in)}</div>
                    </td>
                    <td style={{ fontSize: 11 }}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {!acc.length && <span className="text3">— no role yet</span>}
                        {acc.map(a => (
                          <span key={a.id} className={`tag ${a.active ? 'tag-blue' : 'tag-neutral'}`} style={{ opacity: a.active ? 1 : 0.55 }}
                            title={`${a.active ? 'Active' : 'Switched off'} · ${a.updated_by || ''} ${fmt(a.updated_at) || ''}`}>
                            {ROLE_ICON[a.role] || '•'} {label(a.role)}{a.warehouse ? ` · ${WH_NAMES[a.warehouse] || a.warehouse}` : ''}{a.client ? ` · ${a.client}` : ''}
                            <button type="button" className="tag-x" aria-label={a.active ? `Switch off ${label(a.role)}` : `Switch on ${label(a.role)}`}
                              onClick={() => setActive(a, !a.active)}>{a.active ? '✕' : '↺'}</button>
                          </span>))}
                      </div>
                      {adding === u.id && <AddRole user={u} roles={roles} onDone={r => { setAdding(null); if (r?.error) setMsg({ bad: true, t: ERR[r.error] || r.error }); else { setMsg(null); setTick(t => t + 1) } }} />}
                    </td>
                    <td style={{ fontSize: 10.5 }} className="text3">
                      {(u.smarthub || []).map(m => `${m.role}${m.warehouse ? ' · ' + (WH_NAMES[m.warehouse] || m.warehouse) : ''}`).join(', ') || '—'}
                    </td>
                    <td>{adding !== u.id && <button className="btn btn-ghost btn-sm" onClick={() => setAdding(u.id)}>➕ Role</button>}</td>
                  </tr>)
              })}</tbody>
            </table></div>
          </div>
          <details className="sec" style={{ marginTop: 10 }}>
            <summary>ℹ️ What each role may do</summary>
            <div className="sec-body" style={{ fontSize: 11.5 }}>
              {roles.map(r => <p key={r.code} style={{ margin: '3px 0' }}><b>{ROLE_ICON[r.code] || '•'} {r.label}</b> — {r.description || ''}</p>)}
              <p className="text3">Overrides (pick a cooler that doesn&rsquo;t match, let a truck leave short…) need a <b>supervisor, manager or system administrator</b> role for that warehouse. Roles are switched off rather than deleted, and every change is logged.</p>
            </div>
          </details>
        </>}
        {!d && !err && <div className="load-state"><span className="spinner" /> Loading users…</div>}
      </div>
    </>
  )
}

function AddRole({ user, roles, onDone }) {
  const [role, setRole] = useState('stock_controller')
  const [wh, setWh] = useState(() => (user.smarthub || []).find(m => WAREHOUSES.includes(m.warehouse))?.warehouse || 'JHB')
  const [client, setClient] = useState('')
  const [busy, setBusy] = useState(false)
  const perWh = WAREHOUSE_ROLES.includes(role) || role === 'manager'
  async function save() {
    setBusy(true)
    const { data, error } = await supabase.rpc('coolerco_user_access_add', { p_user: user.id, p_role: role,
      p_warehouse: perWh && wh !== '*' ? wh : null, p_client: role === 'client' ? (client || null) : null })
    setBusy(false); onDone(error ? { error: error.message } : data)
  }
  return (
    <div className="req-box" style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <select className="field-ctrl" style={{ width: 'auto' }} value={role} onChange={e => setRole(e.target.value)} aria-label="Role">
        {roles.map(r => <option key={r.code} value={r.code}>{ROLE_ICON[r.code] || ''} {r.label}</option>)}
      </select>
      {perWh && <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => setWh(e.target.value)} aria-label="Warehouse">
        <option value="*">All warehouses</option>
        {WAREHOUSES.map(w => <option key={w} value={w}>{WH_NAMES[w]}</option>)}
      </select>}
      {role === 'client' && <select className="field-ctrl" style={{ width: 'auto' }} value={client} onChange={e => setClient(e.target.value)} aria-label="Client">
        {CLIENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>}
      <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Give role'}</button>
      <button className="btn btn-ghost btn-sm" onClick={() => onDone(null)}>Cancel</button>
    </div>
  )
}
