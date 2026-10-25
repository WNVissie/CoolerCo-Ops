import { useState, useEffect } from 'react'
import Topbar from '../components/Topbar'
import Drawer from '../components/Drawer'
import { supabase } from '../lib/supabase'
import { fmt, num } from '../lib/helpers'

// Staff: concessionaires, their COM name spellings, portal users (link + PIN) and "Open as".
const concUrl = token => `${window.location.origin}/c/${token}`
const waNumber = n => { const d = String(n || '').replace(/\D/g, ''); return !d ? '' : d.startsWith('0') ? '27' + d.slice(1) : d }

async function openAs(id) {
  const w = window.open('', '_blank') // open first so pop-up blockers allow it
  const { data, error } = await supabase.rpc('coolerco_conc_staff_session', { p_concessionaire: id })
  if (error || !data) { w?.close(); alert(error?.message || 'Could not open'); return }
  if (w) w.location.href = `${window.location.origin}/c/view#s=${data}`
}

export default function Concessionaires() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const [showOff, setShowOff] = useState(false)

  async function load() {
    // parallel: concessionaires, names, users, waiting requests per store
    const [c, n, u] = await Promise.all([
      supabase.from('coolerco_concessionaires').select('*').order('display_name'),
      supabase.from('coolerco_concessionaire_names').select('*'),
      supabase.from('coolerco_concessionaire_users').select('id,concessionaire_id,active,last_login_at'),
    ])
    const names = n.data || [], users = u.data || []
    setRows((c.data || []).map(x => ({
      ...x,
      names: names.filter(m => m.concessionaire_id === x.id).map(m => m.rop_name),
      users: users.filter(m => m.concessionaire_id === x.id),
    })))
  }
  useEffect(() => { load() }, [])

  const s = q.trim().toLowerCase()
  const list = (rows || []).filter(r => (showOff || r.active) && (!s || r.display_name.toLowerCase().includes(s) || r.names.some(n => n.toLowerCase().includes(s))))
  const withUsers = (rows || []).filter(r => r.users.some(u => u.active)).length

  return (
    <>
      <Topbar title="Concessionaires" sub="Their own portal: personal link + PIN · approve customer requests · comment on COM cases" />
      <div className="page-content">
        <div className="stats-row">
          <div className="stat-card c-accent"><div className="stat-label">🤝 Concessionaires</div><div className="stat-value">{rows ? num(rows.filter(r => r.active).length) : '…'}</div></div>
          <div className="stat-card c-green"><div className="stat-label">🔐 With portal users</div><div className="stat-value">{rows ? num(withUsers) : '…'}</div></div>
        </div>
        <div className="filters">
          <div className="search-wrap" style={{ flex: 1 }}><span className="ico">🔍</span>
            <input placeholder="Search concessionaire…" value={q} onChange={e => setQ(e.target.value)} /></div>
          <label className="text3" style={{ fontSize: 11.5, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={showOff} onChange={e => setShowOff(e.target.checked)} /> show switched off</label>
        </div>
        <div className="card" style={{ padding: 12 }}>
          {!rows ? <div className="load-state"><span className="spinner" /> Loading…</div> : list.map(r => (
            <div key={r.id} className="loc-row" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <strong>{r.display_name}</strong>
                <div className="text3" style={{ fontSize: 10.5 }}>
                  {r.names.length > 1 ? `${r.names.length} COM spellings · ` : ''}{r.users.length ? `${r.users.filter(u => u.active).length} user(s)` : 'no users yet'}
                  {!r.active && ' · switched off'}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => openAs(r.id)} title="See the portal exactly as they see it">👁 Open as</button>
              <button className="btn btn-primary btn-sm" onClick={() => setOpen(r)}>Users & links</button>
            </div>
          ))}
        </div>
      </div>
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.display_name || ''} icon="🤝">
        {open && <ConcDetail conc={open} all={rows} onChanged={async () => { await load() }} />}
      </Drawer>
    </>
  )
}

function ConcDetail({ conc, all, onChanged }) {
  const [users, setUsers] = useState(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '' })
  const [msg, setMsg] = useState(null)
  const [sel, setSel] = useState(null) // user id opened for share/PIN
  const [mergeInto, setMergeInto] = useState('')

  async function loadUsers() {
    const { data } = await supabase.from('coolerco_concessionaire_users')
      .select('id,name,email,phone,link_token,active,failed_attempts,locked_until,last_login_at,created_at,created_by')
      .eq('concessionaire_id', conc.id).order('created_at')
    setUsers(data || [])
  }
  useEffect(() => { loadUsers(); setSel(null) }, [conc.id])

  async function addUser() {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.from('coolerco_concessionaire_users')
      .insert({ concessionaire_id: conc.id, name: form.name.trim(), email: form.email.trim() || null, phone: form.phone.trim() || null, created_by: user?.email })
      .select('id').single()
    if (error) return setMsg({ type: 'err', text: error.message })
    setForm({ name: '', email: '', phone: '' }); setMsg({ type: 'ok', text: '✓ User added — now set a PIN and share the link' })
    await loadUsers(); setSel(data.id); onChanged()
  }

  async function merge() {
    if (!mergeInto || !confirm(`Move all COM spellings of "${conc.display_name}" into the selected concessionaire and switch this one off?`)) return
    const { error } = await supabase.from('coolerco_concessionaire_names').update({ concessionaire_id: mergeInto }).eq('concessionaire_id', conc.id)
    if (!error) await supabase.from('coolerco_concessionaires').update({ active: false, updated_at: new Date().toISOString() }).eq('id', conc.id)
    setMsg(error ? { type: 'err', text: error.message } : { type: 'ok', text: '✓ Merged — this entry is now switched off' })
    onChanged()
  }

  return (
    <div>
      <div className="chip-row" style={{ marginBottom: 10 }}>
        <button className="btn btn-primary btn-sm" onClick={() => openAs(conc.id)}>👁 Open portal as {conc.display_name}</button>
      </div>

      <details className="sec" open>
        <summary>🔐 Portal users ({users ? users.length : '…'})</summary>
        <div className="sec-body">
          {!users ? <div className="spinner" /> : !users.length ? <div className="text3">No users yet — add one below.</div> : users.map(u => (
            <div key={u.id}>
              <div className="loc-row" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <strong>{u.name}</strong>
                  <div className="text3" style={{ fontSize: 10.5 }}>{[u.phone, u.email].filter(Boolean).join(' · ') || 'no contact'} · last sign-in {u.last_login_at ? fmt(u.last_login_at) : 'never'}</div>
                </div>
                {u.locked_until && new Date(u.locked_until) > new Date() && <span className="tag tag-red">🔒 locked</span>}
                {!u.active && <span className="tag tag-neutral">off</span>}
                <button className="btn btn-ghost btn-sm" onClick={() => setSel(sel === u.id ? null : u.id)}>{sel === u.id ? 'Close' : 'PIN / share'}</button>
              </div>
              {sel === u.id && <UserShare user={u} conc={conc} onSaved={loadUsers} />}
            </div>
          ))}
          <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div className="field-lbl">➕ Add user</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
              <input className="field-ctrl" placeholder="Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              <input className="field-ctrl" placeholder="Mobile (WhatsApp)" type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              <input className="field-ctrl" placeholder="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="modal-btns"><button className="btn btn-primary btn-sm" disabled={!form.name.trim()} onClick={addUser}>Add user</button></div>
            {msg && <div className={`form-msg ${msg.type}`}>{msg.text}</div>}
          </div>
        </div>
      </details>

      <details className="sec">
        <summary>🏷 COM names ({conc.names.length})</summary>
        <div className="sec-body">
          <div className="text3" style={{ fontSize: 11, marginBottom: 6 }}>Cases and stores are matched on these exact COM "Responsible ordering party" names.</div>
          {conc.names.map(n => <div key={n} className="mini-row"><span className="mono" style={{ fontSize: 11 }}>{n}</span></div>)}
          <div className="field-lbl" style={{ marginTop: 10 }}>Same concessionaire spelt differently? Merge into:</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <select className="field-ctrl" value={mergeInto} onChange={e => setMergeInto(e.target.value)}>
              <option value="">— choose —</option>
              {(all || []).filter(a => a.id !== conc.id && a.active).map(a => <option key={a.id} value={a.id}>{a.display_name}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" disabled={!mergeInto} onClick={merge}>Merge</button>
          </div>
        </div>
      </details>
    </div>
  )
}

function UserShare({ user, conc, onSaved }) {
  const [qr, setQr] = useState(null)
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState(null)
  const url = concUrl(user.link_token)
  const phone = waNumber(user.phone)
  const wa = encodeURIComponent(`Hello ${user.name}, this is CoolerCo. Use your personal link to approve store requests and follow your cases for ${conc.display_name}: ${url}\nYour PIN will be sent separately.`)

  useEffect(() => { import('qrcode').then(QR => QR.toDataURL(url, { width: 200, margin: 1 })).then(setQr) }, [url])

  async function savePin() {
    const { error } = await supabase.rpc('coolerco_conc_set_pin', { p_user: user.id, p_pin: pin })
    setMsg(error ? { type: 'err', text: error.message } : { type: 'ok', text: `✓ PIN set. Tell ${user.name} the PIN by phone or a separate message.` })
    if (!error) { setPin(''); onSaved() }
  }
  async function toggle() {
    await supabase.from('coolerco_concessionaire_users').update({ active: !user.active }).eq('id', user.id)
    onSaved()
  }
  const randomPin = () => setPin(String(Math.floor(1000 + Math.random() * 9000)) + String(Math.floor(Math.random() * 100)).padStart(2, '0'))

  return (
    <div className="where-box rtma" style={{ alignItems: 'flex-start', margin: '6px 0 10px', flexWrap: 'wrap' }}>
      {qr ? <img src={qr} alt="QR code" style={{ width: 110, height: 110, borderRadius: 6, background: '#fff' }} /> : <div className="spinner" />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="lbl">Personal link</div>
        <div className="mono" style={{ fontSize: 10.5, wordBreak: 'break-all' }}>{url}</div>
        <div className="chip-row" style={{ marginTop: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(url); setMsg({ type: 'ok', text: '✓ Link copied' }) }}>📋 Copy</button>
          {phone ? <a className="btn btn-primary btn-sm" href={`https://wa.me/${phone}?text=${wa}`} target="_blank" rel="noreferrer">💬 WhatsApp link</a>
            : <span className="tag tag-orange">📵 no mobile</span>}
          <button className="btn btn-ghost btn-sm" onClick={toggle}>{user.active ? '⏸ Switch off' : '▶ Switch on'}</button>
        </div>
        <div className="field-lbl" style={{ marginTop: 8 }}>Set / reset PIN (4–8 digits){user.failed_attempts ? ` · ${user.failed_attempts} wrong tries` : ''}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="field-ctrl" inputMode="numeric" maxLength={8} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 482915" style={{ maxWidth: 140 }} />
          <button className="btn btn-ghost btn-sm" onClick={randomPin} title="Make a random 6-digit PIN">🎲</button>
          <button className="btn btn-primary btn-sm" disabled={pin.length < 4} onClick={savePin}>Save PIN</button>
        </div>
        {msg && <div className={`form-msg ${msg.type}`}>{msg.text}</div>}
      </div>
    </div>
  )
}
