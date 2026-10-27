import { useState, useEffect } from 'react'
import Topbar from '../components/Topbar'
import Drawer from '../components/Drawer'
import { supabase } from '../lib/supabase'
import { fmt, num, WH_NAMES } from '../lib/helpers'

// Create / share the customer portal link for a store (one link per POS).
const portalUrl = token => `${window.location.origin}/p/${token}`
const waNumber = n => {
  const d = String(n || '').replace(/\D/g, '')
  if (!d) return ''
  return d.startsWith('0') ? '27' + d.slice(1) : d
}

export default function PortalAccess() {
  const [q, setQ] = useState('')
  const [deb, setDeb] = useState('')
  const [stores, setStores] = useState([])
  const [links, setLinks] = useState({})
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(null) // link row

  useEffect(() => { const t = setTimeout(() => setDeb(q.trim()), 350); return () => clearTimeout(t) }, [q])

  async function loadRecent() {
    const { data } = await supabase.from('coolerco_portal_links').select('*').order('created_at', { ascending: false }).limit(20)
    setRecent(data || [])
  }
  useEffect(() => { loadRecent() }, [])

  useEffect(() => {
    if (deb.length < 3) { setStores([]); return }
    setLoading(true)
    const s = deb.replace(/[,()]/g, ' ')
    supabase.from('coolerco_pos_warehouse').select('pos_local_code,point_of_sale,concessionaire,warehouse_code,needs_review')
      .or(`pos_local_code.ilike.%${s}%,point_of_sale.ilike.%${s}%`).order('point_of_sale').limit(30)
      .then(async ({ data }) => {
        setStores(data || [])
        const codes = (data || []).map(d => d.pos_local_code)
        if (codes.length) {
          const { data: l } = await supabase.from('coolerco_portal_links').select('*').in('pos_local_code', codes)
          setLinks(Object.fromEntries((l || []).map(x => [x.pos_local_code, x])))
        }
        setLoading(false)
      })
  }, [deb])

  async function createLink(pos) {
    const { data, error } = await supabase.rpc('coolerco_portal_link_for_pos', { p_pos_local_code: pos })
    if (!error && data) { setLinks(l => ({ ...l, [pos]: data })); setOpen(data); loadRecent() }
  }

  const Row = ({ s, l }) => (
    <div className="loc-row" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <strong>{s.point_of_sale}</strong>
        <div className="text3" style={{ fontSize: 10.5 }}>{s.pos_local_code} · {WH_NAMES[s.warehouse_code] || 'No warehouse'} · {s.concessionaire || '—'}</div>
      </div>
      {l ? (
        <>
          {!(l.mobile_number || l.contact_number) && <span className="tag tag-orange">📵 no number</span>}
          <span className={`tag tag-${l.active ? 'green' : 'neutral'}`}>{l.active ? '🔗 link ready' : 'off'}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(l)}>Share / edit</button>
        </>
      ) : (
        <button className="btn btn-primary btn-sm" disabled={!s.warehouse_code} title={s.warehouse_code ? '' : 'Map this store to a warehouse first'} onClick={() => createLink(s.pos_local_code)}>＋ Create link</button>
      )}
    </div>
  )

  return (
    <>
      <Topbar title="Portal Access" sub="One secure link per store · share by WhatsApp or QR" />
      <div className="page-content">
        <div className="filters">
          <div className="search-wrap" style={{ flex: 1 }}><span className="ico">🏪</span>
            <input placeholder="Search store name or POS code (min 3 characters)…" value={q} onChange={e => setQ(e.target.value)} /></div>
        </div>
        {deb.length >= 3 && (
          <div className="card" style={{ padding: 12, marginBottom: 12 }}>
            {loading ? <div className="load-state"><span className="spinner" /> Searching…</div>
              : !stores.length ? <div className="text3">No stores found.</div>
                : stores.map(s => <Row key={s.pos_local_code} s={s} l={links[s.pos_local_code]} />)}
          </div>
        )}
        <details className="sec" open>
          <summary>🔗 Recently created links ({num(recent.length)})</summary>
          <div className="sec-body">
            {!recent.length ? <div className="text3">No links yet — search a store above and create one.</div> : recent.map(l => (
              <Row key={l.id} s={{ point_of_sale: l.point_of_sale, pos_local_code: l.pos_local_code, warehouse_code: null }} l={l} />
            ))}
          </div>
        </details>
      </div>
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.point_of_sale || 'Portal link'} icon="🔗">
        {open && <LinkDetail link={open} onSaved={l => { setOpen(l); setLinks(x => ({ ...x, [l.pos_local_code]: l })); loadRecent() }} />}
      </Drawer>
    </>
  )
}

function LinkDetail({ link, onSaved }) {
  const [form, setForm] = useState({ contact_name: link.contact_name || '', contact_number: link.contact_number || '', mobile_number: link.mobile_number || '' })
  const [qr, setQr] = useState(null)
  const [msg, setMsg] = useState(null)
  const [history, setHistory] = useState([])
  const url = portalUrl(link.token)
  // Send to: any number typed here (pre-filled with the store's saved WhatsApp number). Saving it as the store contact is optional.
  const [to, setTo] = useState({ name: link.contact_name || '', number: link.mobile_number || link.contact_number || '', keep: false })
  const phone = waNumber(to.number)
  const validPhone = phone.length >= 11 && phone.length <= 13
  const waText = encodeURIComponent(`Hello ${to.name || ''}, this is CoolerCo. Use this secure link to log a repair, collection or new asset request for ${link.point_of_sale}: ${url}`)
  async function sendWa() {
    if (!validPhone) { setMsg({ type: 'warn', text: 'Type a full mobile number, e.g. 082 123 4567 or +27 82 123 4567' }); return }
    window.open(`https://wa.me/${phone}?text=${waText}`, '_blank', 'noopener')
    if (to.keep) {
      const next = { ...form, contact_name: to.name || form.contact_name, mobile_number: to.number }
      setForm(next)
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase.from('coolerco_portal_links').update({ ...next, updated_by: user?.email }).eq('id', link.id).select().single()
      setMsg(error ? { type: 'err', text: error.message } : { type: 'ok', text: '✓ Sent on WhatsApp and saved as the store contact (change logged)' })
      if (!error) onSaved(data)
    } else setMsg({ type: 'ok', text: `💬 WhatsApp opened for ${to.number}` })
  }

  useEffect(() => {
    import('qrcode').then(QR => QR.toDataURL(url, { width: 220, margin: 1 })).then(setQr)
    supabase.from('coolerco_portal_link_history').select('*').eq('link_id', link.id).order('changed_at', { ascending: false }).limit(20)
      .then(({ data }) => setHistory(data || []))
  }, [link])

  async function save() {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.from('coolerco_portal_links').update({ ...form, updated_by: user?.email }).eq('id', link.id).select().single()
    setMsg(error ? { type: 'err', text: error.message } : { type: 'ok', text: '✓ Contact saved (change logged)' })
    if (!error) onSaved(data)
  }
  async function toggle() {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.from('coolerco_portal_links').update({ active: !link.active, updated_by: user?.email }).eq('id', link.id).select().single()
    if (!error) onSaved(data)
  }

  return (
    <div>
      <div className="where-box rtma" style={{ alignItems: 'flex-start' }}>
        {qr ? <img src={qr} alt="QR code" style={{ width: 120, height: 120, borderRadius: 6, background: '#fff' }} /> : <div className="spinner" />}
        <div style={{ minWidth: 0 }}>
          <div className="lbl">Portal link</div>
          <div className="mono" style={{ fontSize: 10.5, wordBreak: 'break-all' }}>{url}</div>
          <div className="chip-row" style={{ marginTop: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(url); setMsg({ type: 'ok', text: '✓ Link copied' }) }}>📋 Copy</button>
            <a className="btn btn-ghost btn-sm" href={url} target="_blank" rel="noreferrer">👁 Open</a>
          </div>
        </div>
      </div>

      <details className="sec" open>
        <summary>💬 Send the link on WhatsApp</summary>
        <div className="sec-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            <div><div className="field-lbl">To (name)</div>
              <input className="field-ctrl" value={to.name} placeholder="e.g. Store manager" onChange={e => setTo({ ...to, name: e.target.value })} /></div>
            <div><div className="field-lbl">WhatsApp number</div>
              <input className="field-ctrl" type="tel" inputMode="tel" value={to.number} placeholder="082 123 4567" onChange={e => setTo({ ...to, number: e.target.value })} /></div>
          </div>
          <label className="text3" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, marginTop: 8 }}>
            <input type="checkbox" checked={to.keep} onChange={e => setTo({ ...to, keep: e.target.checked })} /> Also save as this store's contact
          </label>
          <div className="modal-btns" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="text3" style={{ fontSize: 10.5 }}>{to.number ? (validPhone ? `Sends to +${phone}` : '⚠ number looks incomplete') : 'Type any number — e.g. the manager on duty'}</span>
            <button className="btn btn-primary btn-sm" disabled={!to.number} onClick={sendWa}>💬 Send on WhatsApp</button>
          </div>
        </div>
      </details>

      <details className="sec" open>
        <summary>👤 Store contact (from latest COM case — update here)</summary>
        <div className="sec-body">
          <div className="field-lbl">Name</div>
          <input className="field-ctrl" value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} />
          <div className="field-lbl" style={{ marginTop: 8 }}>Mobile (WhatsApp)</div>
          <input className="field-ctrl" type="tel" value={form.mobile_number} onChange={e => setForm({ ...form, mobile_number: e.target.value })} />
          <div className="field-lbl" style={{ marginTop: 8 }}>Business phone</div>
          <input className="field-ctrl" type="tel" value={form.contact_number} onChange={e => setForm({ ...form, contact_number: e.target.value })} />
          <div className="modal-btns" style={{ justifyContent: 'space-between' }}>
            <button className="btn btn-ghost btn-sm" onClick={toggle}>{link.active ? '⏸ Switch link off' : '▶ Switch link on'}</button>
            <button className="btn btn-primary btn-sm" onClick={save}>Save contact</button>
          </div>
          {msg && <div className={`form-msg ${msg.type}`}>{msg.text}</div>}
        </div>
      </details>

      <details className="sec">
        <summary>🕒 Changes ({history.length})</summary>
        <div className="sec-body">
          {!history.length ? <div className="text3">No changes yet.</div> : history.map(h => (
            <div key={h.id} className="mini-row"><span>{h.field}: <s className="text3">{h.old_value || '—'}</s> → {h.new_value || '—'}</span><span className="text3">{fmt(h.changed_at)} · {h.changed_by}</span></div>
          ))}
          <div className="text3" style={{ fontSize: 10.5, marginTop: 6 }}>Created {fmt(link.created_at)} by {link.created_by} · last opened {link.last_used_at ? fmt(link.last_used_at) : 'never'}</div>
        </div>
      </details>
    </div>
  )
}
