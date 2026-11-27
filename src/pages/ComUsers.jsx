import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// 👤 COM users (script 063): which COM portal username a step is notified under.
//   Field person (slot) → office user → the warehouse's logistics / workshop default → the warehouse (office) user.
//   COM shows the step as created "By Portal/mobile" by that user. CoolerCo never stores COM passwords.
export default function ComUsers({ onMissing }) {
  const [d, setD] = useState(null)
  const [msg, setMsg] = useState(null)
  const [open, setOpen] = useState({ wh: true, slots: false, users: false })
  const load = useCallback(() => {
    supabase.rpc('coolerco_com_users').then(({ data, error }) => {
      if (error) { if (/Could not find|does not exist/i.test(error.message)) onMissing?.(); else setMsg({ t: 'err', s: error.message }) } else setD(data)
    })
  }, [onMissing])
  useEffect(() => { load() }, [load])
  const set = async (what, id, value, label) => {
    const { error } = await supabase.rpc('coolerco_com_user_set', { p_what: what, p_id: id, p_value: value })
    setMsg(error ? { t: 'err', s: error.message } : { t: 'ok', s: `Saved ${label}.` })
    load()
  }
  if (!d) return <div className="card">{msg ? <div className={`form-msg ${msg.t}`}>{msg.s}</div> : <span className="spinner" />}</div>
  const Sec = p => <Section {...p} open={open} setOpen={setOpen} />
  return (
    <div className="card">
      {msg && <div className={`form-msg ${msg.t}`}>{msg.s}</div>}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
        <label><input type="checkbox" checked={!!d.auto_wpt} onChange={e => confirm(`${e.target.checked ? 'Switch ON' : 'Switch OFF'}: route finalised → WITHIN PROPOSED TIME (Magnum)?`) && set('auto_wpt', null, String(e.target.checked), 'auto WPT')} /> 🗺 Route finalised → WITHIN PROPOSED TIME (Magnum only{' · on TEST only test routes'})</label>
        <label><input type="checkbox" checked={!!d.send_routing} onChange={e => confirm(`${e.target.checked ? 'Send' : 'Stop sending'} Portal User Router To / Routed On to COM?\n(Switch off once Magnum approves the CoolerCo Field app for the drivers. WPT, Asset Delivered and ASSET PICKED are still sent.)`) && set('send_routing', 'MAGNUM', String(e.target.checked), 'routing switch')} /> 🚚 Send routing to COM (Magnum)</label>
      </div>
      <Sec k="wh" title={`🏭 Warehouse defaults (${d.warehouses.length})`}>
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Warehouse</th><th>Logistics (WPT, picking)</th><th>Workshop (Repair at Workshop, Decal)</th><th>Office / fallback</th></tr></thead><tbody>
          {d.warehouses.map(w => <tr key={w.code}><td><b>{w.code}</b> <span className="text3">{w.name}</span></td>
            <td><Cell v={w.logistics} ph={w.office} onSave={v => set('wh_logistics', w.code, v, `${w.code} logistics user`)} /></td>
            <td><Cell v={w.workshop} ph={w.office} onSave={v => set('wh_workshop', w.code, v, `${w.code} workshop user`)} /></td>
            <td><Cell v={w.office} onSave={v => set('wh_office', w.code, v, `${w.code} office user`)} /></td></tr>)}
        </tbody></table></div>
      </Sec>
      <Sec k="slots" title={`👷 Drivers & technicians (${d.slots.length} slots)`}>
        <div className="text3" style={{ fontSize: 11 }}>Empty = the RouteIQ name is used (they are the same COM portal users today).</div>
        <div className="table-wrap"><table className="tbl"><thead><tr><th>Slot</th><th>Person</th><th>RouteIQ</th><th>COM portal user</th></tr></thead><tbody>
          {d.slots.map(s => <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }}><td>{s.warehouse} · {s.type} {s.slot_no}</td><td>{s.person || '—'}{s.has_login ? ' 🔑' : ''}</td>
            <td className="mono">{s.routeiq}</td><td><Cell v={s.com_portal_user} ph={s.routeiq} onSave={v => set('slot', s.id, v, `${s.routeiq || 'slot'} COM user`)} /></td></tr>)}
        </tbody></table></div>
      </Sec>
      <Sec k="users" title={`🧑‍💼 Office users (${d.users.length})`}>
        <div className="text3" style={{ fontSize: 11 }}>Used when an office user closes a case or picks. Empty = the warehouse default.</div>
        <div className="table-wrap"><table className="tbl"><thead><tr><th>User</th><th>Roles · warehouse</th><th>COM portal user</th></tr></thead><tbody>
          {d.users.map(u => <tr key={u.user_id}><td>{u.email}</td><td style={{ fontSize: 11 }}>{u.roles}{u.warehouses ? ` · ${u.warehouses}` : ''}</td>
            <td><Cell v={u.com_portal_user} onSave={v => set('user', u.user_id, v, `${u.email} COM user`)} /></td></tr>)}
        </tbody></table></div>
      </Sec>
    </div>
  )
}

function Section({ k, title, children, open, setOpen }) {
  return <div style={{ margin: '8px 0' }}>
    <button className="btn btn-ghost btn-sm" onClick={() => setOpen(o => ({ ...o, [k]: !o[k] }))}>{open[k] ? '▾' : '▸'} {title}</button>
    {open[k] && <div style={{ marginTop: 6 }}>{children}</div>}
  </div>
}

function Cell({ v, ph, onSave }) {
  const [x, setX] = useState(v || '')
  useEffect(() => { setX(v || '') }, [v])
  return <input className="field-ctrl mono" style={{ width: 160, fontSize: 12 }} value={x} placeholder={ph || ''}
    onChange={e => setX(e.target.value.trim())} onBlur={() => x !== (v || '') && onSave(x)} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />
}
