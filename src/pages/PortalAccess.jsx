import { useState, useEffect } from 'react'
import Topbar from '../components/Topbar'
import Drawer from '../components/Drawer'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'
import { fmt, num, WH_NAMES } from '../lib/helpers'
import { useClientScope, ClientBadge } from '../components/ClientScope'

// Create / share the customer portal link for a store (one link per POS).
const portalUrl = token => `${window.location.origin}/p/${token}`
const waNumber = n => {
  const d = String(n || '').replace(/\D/g, '')
  if (!d) return ''
  return d.startsWith('0') ? '27' + d.slice(1) : d
}

// Customers & portal links (Wanda 2026-11-25: "I cannot create QR codes … I cannot see the customer list").
//   Magnum (COM): search a store (min 3 characters) — as before.
//   Tiger / Demo / any self-managed client: the client's outlet register is listed straight away (scoped by the user's
//   access), filter by text, warehouse, region, rep / Responsible Ordering Party; per store: open cases, 📂 cases, link + QR.
export default function PortalAccess() {
  const scope = useClientScope()
  const [mode, setMode] = useState(null)   // null = follow the client chips default
  const clientOpts = (scope.options || []).filter(o => o.code !== 'MAGNUM')
  const view = mode || (scope.ready && (scope.blocked || scope.client !== 'MAGNUM') && clientOpts.length ? (scope.client !== 'MAGNUM' ? scope.client : 'ALL') : 'MAGNUM')
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
      <Topbar title="Customers & portal links" sub="Every store per client · one secure link per store · share by WhatsApp or QR" />
      <div className="page-content">
        {scope.ready && (clientOpts.length > 0) && (
          <div className="chip-row" role="group" aria-label="Client" style={{ alignItems: 'center' }}>
            <span className="text3" style={{ fontSize: 11 }}>Client</span>
            {!scope.blocked && <button type="button" className={`chip-opt${view === 'MAGNUM' ? ' on' : ''}`} onClick={() => setMode('MAGNUM')}>🟦 Magnum (COM)</button>}
            {clientOpts.map(o => <button type="button" key={o.code} className={`chip-opt${view === o.code ? ' on' : ''}`} onClick={() => setMode(o.code)}>{o.color ? <span className="cl-dot" style={{ background: o.color.dot }} /> : o.icon} {o.name}</button>)}
          </div>
        )}
        {view !== 'MAGNUM' ? <ClientOutlets scope={scope} client={view} onOpen={setOpen} /> : <>
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
        <ComFixList />
        </>}
      </div>
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.point_of_sale || 'Portal link'} icon="🔗">
        {open && <LinkDetail link={open} onSaved={l => { setOpen(l); setLinks(x => ({ ...x, [l.pos_local_code]: l })); loadRecent() }} />}
      </Drawer>
    </>
  )
}

// 🛠 To fix in COM: Magnum store corrections saved in RouteIQ from CoolerCo (056). COM still has the old details until
// someone changes them there; tick → ✓ Fixed in COM.
function ComFixList() {
  const [rows, setRows] = useState(null)
  const [sel, setSel] = useState([])
  const [err, setErr] = useState(null)
  const load = () => supabase.from('coolerco_outlet_changes').select('*').eq('client_code', 'MAGNUM').is('com_fixed_at', null).order('changed_at', { ascending: false }).limit(500)
    .then(({ data, error }) => { if (error) { setErr(/com_fixed_at|does not exist/i.test(error.message) ? null : error.message); setRows(error ? [] : data || []) } else setRows(data || []) })
  useEffect(() => { load() }, [])
  async function done() {
    const { error } = await supabase.rpc('coolerco_outlet_change_com_fixed', { p_ids: sel })
    if (error) setErr(error.message); else { setSel([]); load() }
  }
  if (!rows || (!rows.length && !err)) return null
  return (
    <details className="sec" open>
      <summary>🛠 To fix in COM ({num(rows.length)})</summary>
      <div className="sec-body">
        <div className="text3" style={{ fontSize: 11, marginBottom: 6 }}>Magnum store details corrected in CoolerCo. RouteIQ and the Field app already use them; COM still has the old details until you change them there.</div>
        {err && <div className="form-msg err">{err}</div>}
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th></th><th>Store</th><th>What</th><th>Was</th><th>Now</th><th>By · when</th><th>Case</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td><input type="checkbox" checked={sel.includes(r.id)} onChange={e => setSel(x => e.target.checked ? [...x, r.id] : x.filter(v => v !== r.id))} /></td>
              <td className="mono" style={{ fontSize: 10.5 }}>{r.outlet_code}</td><td>{r.field}</td>
              <td className="text3">{r.old_value || '—'}</td><td><strong>{r.new_value || '—'}</strong></td>
              <td className="text3" style={{ fontSize: 10.5 }}>{r.changed_by} · {fmt(r.changed_at)}</td>
              <td className="mono" style={{ fontSize: 10.5 }}>{r.case_number || ''}</td>
            </tr>))}</tbody>
        </table></div>
        <button className="btn btn-primary btn-sm" style={{ marginTop: 6 }} disabled={!sel.length} onClick={done}>✓ Fixed in COM ({sel.length})</button>
      </div>
    </details>
  )
}

function ClientOutlets({ scope, client, onOpen }) {
  const [rows, setRows] = useState(null)
  const [links, setLinks] = useState({})
  const [openBy, setOpenBy] = useState({})
  const [q, setQ] = useState('')
  const [wh, setWh] = useState('')
  const [rep, setRep] = useState('')
  const [region, setRegion] = useState('')
  const [msg, setMsg] = useState(null)
  const [rops, setRops] = useState([])        // regions / reps / concessionaires of this client (056)
  const [ropBy, setRopBy] = useState({})      // outlet → Responsible Ordering Party name
  const [sel, setSel] = useState([])          // ticked outlets
  const [linkTo, setLinkTo] = useState('')
  const [newRop, setNewRop] = useState(null)  // { name, kind } while adding
  const load = async () => {
    setRows(null)
    let r = supabase.from('coolerco_outlets').select('client_code,outlet_code,name,town,suburb,province,warehouse_code,region,rep_code,contact_person,mobile_number,latitude,longitude,active').eq('active', true).order('name').limit(2000)
    if (client !== 'ALL') r = r.eq('client_code', client)
    let rq = supabase.from('coolerco_concessionaires').select('id,display_name,kind,client_code,active,parent_id,rep_code').eq('active', true).neq('client_code', 'MAGNUM').order('display_name')
    if (client !== 'ALL') rq = rq.eq('client_code', client)
    const [{ data, error }, l, c, rp] = await Promise.all([
      r,
      supabase.from('coolerco_portal_links').select('*').neq('client_code', 'MAGNUM').limit(5000),
      supabase.from('coolerco_all_cases').select('pos_local_code').neq('source', 'COM').eq('is_open', true).limit(5000),
      rq,
    ])
    setRops(rp.data || [])
    const codes = (data || []).map(o => o.outlet_code)
    if (codes.length) {
      const { data: pw } = await supabase.from('coolerco_pos_warehouse').select('pos_local_code,concessionaire').in('pos_local_code', codes.slice(0, 1000))
      setRopBy(Object.fromEntries((pw || []).map(x => [x.pos_local_code, x.concessionaire])))
    }
    if (error) { setMsg({ bad: true, t: error.message }); setRows([]); return }
    setRows(data || [])
    setLinks(Object.fromEntries((l.data || []).map(x => [x.pos_local_code, x])))
    const m = {}; (c.data || []).forEach(x => { m[x.pos_local_code] = (m[x.pos_local_code] || 0) + 1 }); setOpenBy(m)
  }
  useEffect(() => { load() }, [client]) // eslint-disable-line react-hooks/exhaustive-deps
  const uniq = k => [...new Set((rows || []).map(r => r[k]).filter(Boolean))].sort()
  const s = q.trim().toLowerCase()
  const ropOf = o => ropBy[o.outlet_code] || ''
  const repName = o => (o.rep_code && rops.find(r => r.rep_code === o.rep_code && r.client_code === o.client_code)?.display_name) || ''
  const list = (rows || []).filter(r => (!wh || r.warehouse_code === wh) && (!rep || ropOf(r) === rep) && (!region || r.region === region)
    && (!s || [r.name, r.outlet_code, r.town, r.suburb, r.contact_person].some(v => String(v || '').toLowerCase().includes(s))))
  const ropNames = [...new Set((rows || []).map(ropOf).filter(Boolean))].sort()
  const oneClient = client !== 'ALL' ? client : null
  async function linkSelected() {
    if (!linkTo || !sel.length) return
    const target = rops.find(r => r.id === linkTo)
    setMsg(null)
    const { data, error } = await supabase.rpc('coolerco_outlets_set_rop', { p_client: target.client_code, p_outlets: sel, p_rop: linkTo })
    if (error) return setMsg({ bad: true, t: /does not exist|PGRST202/i.test(error.message) ? 'Linking needs database script 056 on this database.' : error.message })
    if (data?.error) return setMsg({ bad: true, t: { not_allowed: 'Your user may not change this.', bad_rop: 'That region / rep belongs to another client.', com_master: 'Magnum stores are linked in COM.' }[data.error] || data.error })
    setMsg({ t: `✅ ${data.linked} store(s) linked to ${target.display_name}. Their open cases now carry it; its portal users see them.` }); setSel([]); load()
  }
  async function addRop() {
    if (!newRop?.name?.trim() || !oneClient) return
    if (newRop.kind === 'representative' && !newRop.parent) return setMsg({ bad: true, t: 'Pick the region (or concessionaire) this rep works under.' })
    const { data, error } = await supabase.rpc('coolerco_rop_add', { p_client: oneClient, p_name: newRop.name.trim(), p_kind: newRop.kind, ...(newRop.kind === 'representative' ? { p_parent: newRop.parent } : {}) })
    if (error) return setMsg({ bad: true, t: /does not exist|PGRST202/i.test(error.message) ? 'Adding needs database script 056 on this database.' : error.message })
    if (data?.error) return setMsg({ bad: true, t: { exists: 'That name already exists.', not_allowed: 'Your user may not add regions.', name_required: 'Type a name.', parent_required: 'Pick the region this rep works under.' }[data.error] || data.error })
    setMsg({ t: `✅ ${newRop.name.trim()} added. Tick stores and link them; add its users under Responsible Ordering Parties.` }); setNewRop(null); setLinkTo(data.id); load()
  }
  const allTicked = list.length > 0 && list.slice(0, 500).every(o => sel.includes(o.outlet_code))

  async function makeLink(o) {
    setMsg(null)
    const { data, error } = await supabase.rpc('coolerco_portal_link_for_outlet', { p_client: o.client_code, p_outlet: o.outlet_code })
    if (error) return setMsg({ bad: true, t: /does not exist|PGRST202/i.test(error.message) ? 'Making a new link needs database script 055 on this database.' : error.message })
    setLinks(x => ({ ...x, [o.outlet_code]: data })); onOpen(data)
  }
  return (
    <>
      <div className="filters" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="search-wrap" style={{ flex: '1 1 240px' }}><span className="ico">🏪</span>
          <input placeholder="Store, code, town or contact…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <select value={wh} onChange={e => setWh(e.target.value)}><option value="">🏢 All warehouses</option>{uniq('warehouse_code').map(w => <option key={w} value={w}>{WH_NAMES[w] || w}</option>)}</select>
        {uniq('region').length > 0 && <select value={region} onChange={e => setRegion(e.target.value)}><option value="">🗺 All regions</option>{uniq('region').map(w => <option key={w}>{w}</option>)}</select>}
        {ropNames.length > 0 && <select value={rep} onChange={e => setRep(e.target.value)}><option value="">🤝 All Responsible Ordering Parties</option>{ropNames.map(w => <option key={w}>{w}</option>)}</select>}
        <button className="btn btn-ghost btn-sm" onClick={load}>↻ Refresh</button>
      </div>
      <div className="req-box" style={{ margin: '0 0 8px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="lbl" style={{ margin: 0 }}>🗺 Region / Responsible Ordering Party</span>
        <span className="text3" style={{ fontSize: 11 }}>{sel.length ? `${sel.length} store(s) ticked` : 'Tick stores below, then link them'}</span>
        <select value={linkTo} onChange={e => setLinkTo(e.target.value)} style={{ minWidth: 200 }}>
          <option value="">Link to…</option>
          {rops.filter(r => !r.parent_id).map(top => (
            <optgroup key={top.id} label={`${top.kind === 'region' ? '🗺 Region' : top.kind === 'concessionaire' ? '🤝 Concessionaire' : '👤 Rep'}: ${top.display_name}${client === 'ALL' ? ` (${top.client_code})` : ''}`}>
              <option value={top.id}>{top.display_name} — whole {top.kind === 'region' ? 'region' : 'party'}</option>
              {rops.filter(r => r.parent_id === top.id).map(r => <option key={r.id} value={r.id}>　↳ rep {r.display_name}</option>)}
            </optgroup>))}
        </select>
        <button className="btn btn-primary btn-sm" disabled={!linkTo || !sel.length} onClick={linkSelected}>🔗 Link {sel.length || ''}</button>
        {oneClient && !newRop && <button className="btn btn-ghost btn-sm" onClick={() => setNewRop({ name: '', kind: 'region' })}>➕ New region / rep</button>}
        {newRop && <>
          <input className="field-ctrl" style={{ width: 180 }} placeholder="e.g. Tiger Inland" value={newRop.name} onChange={e => setNewRop({ ...newRop, name: e.target.value })} />
          <select value={newRop.kind} onChange={e => setNewRop({ ...newRop, kind: e.target.value })}><option value="region">Region</option><option value="representative">Rep (under a region)</option><option value="concessionaire">Concessionaire</option></select>
          {newRop.kind === 'representative' && <select value={newRop.parent || ''} onChange={e => setNewRop({ ...newRop, parent: e.target.value })}><option value="">Under region…</option>{rops.filter(r => !r.parent_id && r.client_code === oneClient).map(r => <option key={r.id} value={r.id}>{r.display_name}</option>)}</select>}
          <button className="btn btn-primary btn-sm" onClick={addRop}>Add</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setNewRop(null)}>Cancel</button>
        </>}
        {!oneClient && <span className="text3" style={{ fontSize: 10.5 }}>Pick one client to add a region.</span>}
      </div>
      {msg && <div className={`form-msg ${msg.bad ? 'err' : 'ok'}`}>{msg.t}</div>}
      <div className="card">
        <div className="card-header"><span className="card-title">🏪 Stores</span><span className="card-count">{rows ? `${num(list.length)} of ${num(rows.length)}` : ''}</span></div>
        {!rows ? <div className="load-state"><span className="spinner" /> Loading stores…</div> : !list.length ? <div className="text3" style={{ padding: 12 }}>No stores match.</div> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th><input type="checkbox" aria-label="Tick all" checked={allTicked} onChange={e => setSel(e.target.checked ? list.slice(0, 500).map(o => o.outlet_code) : [])} /></th>{client === 'ALL' && <th>Client</th>}<th>Store</th><th>Town</th><th>Warehouse</th><th>Region · rep</th><th>Contact</th><th>Open cases</th><th>Portal link</th></tr></thead>
            <tbody>{list.slice(0, 500).map(o => {
              const l = links[o.outlet_code]
              return (
                <tr key={o.client_code + o.outlet_code}>
                  <td><input type="checkbox" aria-label={`Tick ${o.name}`} checked={sel.includes(o.outlet_code)} onChange={e => setSel(x => e.target.checked ? [...x, o.outlet_code] : x.filter(v => v !== o.outlet_code))} /></td>
                  {client === 'ALL' && <td><ClientBadge scope={scope} code={o.client_code} small /></td>}
                  <td><strong style={{ fontSize: 12 }}>{o.name}</strong><div className="text3 mono" style={{ fontSize: 10 }}>{o.outlet_code}{o.latitude == null ? ' · ⚠ no GPS' : ''}</div></td>
                  <td>{o.town || o.suburb || '—'}</td>
                  <td>{WH_NAMES[o.warehouse_code] || o.warehouse_code || '—'}</td>
                  <td>{o.region ? <span className="tag tag-blue" style={{ fontSize: 10 }}>🗺 {o.region}</span> : ropOf(o) ? <span style={{ fontSize: 11 }}>{ropOf(o)}</span> : '—'}{repName(o) ? <div className="text3" style={{ fontSize: 10.5 }}>👤 {repName(o)}</div> : null}</td>
                  <td>{o.contact_person || '—'}{o.mobile_number ? <div className="text3" style={{ fontSize: 10 }}>{o.mobile_number}</div> : null}</td>
                  <td>{openBy[o.outlet_code] ? <Link to={`/cases?client=${o.client_code}&pos=${encodeURIComponent(o.outlet_code)}`}>📂 {openBy[o.outlet_code]} open</Link> : <span className="text3">—</span>}</td>
                  <td>{l ? <button className="btn btn-ghost btn-sm" onClick={() => onOpen(l)}>{l.active ? '🔗 Share / QR' : '⏸ off · edit'}</button>
                    : <button className="btn btn-primary btn-sm" onClick={() => makeLink(o)}>＋ Create link</button>}</td>
                </tr>
              )
            })}</tbody>
          </table></div>
        )}
        {list.length > 500 && <div className="text3" style={{ padding: 8, fontSize: 11 }}>Showing the first 500 — narrow the search.</div>}
      </div>
    </>
  )
}

function LinkDetail({ link, onSaved }) {
  const [form, setForm] = useState({ contact_name: link.contact_name || '', contact_number: link.contact_number || '', mobile_number: link.mobile_number || '', ...('client_code' in link ? { client_code: link.client_code || 'MAGNUM' } : {}) })
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
    setMsg(error ? { type: 'err', text: error.message } : { type: 'ok', text: '✓ Saved (change logged)' })
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
          {'client_code' in form && <>
            <div className="field-lbl">Client (whose store / requests)</div>
            <select className="field-ctrl" value={form.client_code} onChange={e => setForm({ ...form, client_code: e.target.value })}>
              <option value="MAGNUM">🟦 Magnum (COM)</option>
              <option value="TIGER">🐯 Tiger Brands (CoolerCo is the master)</option>
            </select>
            <div className="text3" style={{ fontSize: 11, margin: '2px 0 8px' }}>New requests from this link are logged for this client.</div>
          </>}
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
