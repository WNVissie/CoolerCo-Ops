import { useState, useEffect, useMemo } from 'react'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { num } from '../lib/helpers'

// Driver "open in app" links for CoolerCo Field. Each driver has one personal code (no login):
// /field/d/<code> opens only his trip. The routing app's WhatsApp trip link stays the backup.
const appLink = code => `${window.location.origin}/field/d/${code}`
const today = () => new Date().toISOString().slice(0, 10)

export default function DriverLinks() {
  const [drivers, setDrivers] = useState(null)
  const [links, setLinks] = useState({})
  const [routes, setRoutes] = useState({})
  const [wh, setWh] = useState(() => { try { return localStorage.getItem('cc_dl_wh') || '' } catch { return '' } })
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState(null)
  const [qr, setQr] = useState(null) // { code, img, name }

  async function load() {
    // parallel: drivers, their codes, today's routes
    const [d, l, r] = await Promise.all([
      supabase.from('routing_portal_users').select('portal_username,display_name,worker_type,warehouse_group').eq('is_active', true).in('worker_type', ['driver', 'technician']).order('warehouse_group').order('display_name'),
      supabase.from('coolerco_field_driver_links').select('portal_username,code,active,created_at,last_used_at'),
      supabase.from('routing_routes').select('resource_username,route_number,status').eq('route_date', today()).neq('status', 'not_used'),
    ])
    setDrivers(d.data || [])
    setLinks(Object.fromEntries((l.data || []).filter(x => x.active).map(x => [x.portal_username, x])))
    const byDriver = {}; (r.data || []).forEach(x => { (byDriver[x.resource_username] ||= []).push(x) })
    setRoutes(byDriver)
  }
  useEffect(() => { load() }, [])
  useEffect(() => { try { localStorage.setItem('cc_dl_wh', wh) } catch { /* ignore */ } }, [wh])

  async function getCode(u, renew = false) {
    if (renew && !confirm('Make a new code? The driver\'s old link will stop working.')) return null
    const { data, error } = await supabase.rpc('coolerco_field_driver_link', { p_username: u, p_renew: renew })
    if (error) { setMsg({ type: 'err', text: error.message }); return null }
    await load(); return data
  }
  async function share(d, how) {
    const code = links[d.portal_username]?.code || await getCode(d.portal_username)
    if (!code) return
    const text = `Hi ${d.display_name}, your CoolerCo trip opens here: ${appLink(code)}\nTap it to see today's stops (install it on your phone so it opens with one tap). Your code: ${code}`
    if (how === 'wa') window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
    if (how === 'copy') { navigator.clipboard?.writeText(appLink(code)); setMsg({ type: 'ok', text: `📋 Link for ${d.display_name} copied` }) }
    if (how === 'qr') { const QR = await import('qrcode'); setQr({ code, name: d.display_name, img: await QR.toDataURL(appLink(code), { width: 240, margin: 1 }) }) }
  }

  const whs = useMemo(() => [...new Set((drivers || []).map(d => d.warehouse_group))], [drivers])
  const s = q.trim().toLowerCase()
  const list = (drivers || []).filter(d => (!wh || d.warehouse_group === wh) && (!s || [d.display_name, d.portal_username].some(v => (v || '').toLowerCase().includes(s))))
  const withLink = (drivers || []).filter(d => links[d.portal_username]).length

  return (
    <>
      <Topbar title="Driver app links" sub="Open the trip in CoolerCo Field (no login) · the routing app's WhatsApp link stays the backup" />
      <div className="page-content">
        <div className="stats-row">
          <div className="stat-card c-accent"><div className="stat-label">🚚 Drivers & technicians</div><div className="stat-value">{drivers ? num(drivers.length) : '…'}</div></div>
          <div className="stat-card c-green"><div className="stat-label">🔗 With app link</div><div className="stat-value">{drivers ? num(withLink) : '…'}</div></div>
          <div className="stat-card c-teal"><div className="stat-label">🛣️ On a route today</div><div className="stat-value">{drivers ? num(Object.keys(routes).length) : '…'}</div></div>
        </div>
        <div className="filters">
          <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => setWh(e.target.value)}>
            <option value="">All warehouses</option>
            {whs.map(w => <option key={w} value={w}>{w.replace('RTMA ', '')}</option>)}
          </select>
          <div className="search-wrap" style={{ flex: 1 }}><span className="ico">🔍</span><input placeholder="Driver name or username…" value={q} onChange={e => setQ(e.target.value)} /></div>
        </div>
        {msg && <div className={`form-msg ${msg.type}`} style={{ marginBottom: 10 }}>{msg.text}</div>}
        <div className="card" style={{ padding: 12 }}>
          {!drivers ? <div className="load-state"><span className="spinner" /> Loading…</div> : list.map(d => {
            const l = links[d.portal_username], r = routes[d.portal_username] || []
            return (
              <div key={d.portal_username} className="loc-row" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <strong>{d.worker_type === 'technician' ? '🛠' : '🚚'} {d.display_name}</strong>
                  <div className="text3" style={{ fontSize: 10.5 }}>
                    {d.portal_username} · {d.warehouse_group?.replace('RTMA ', '')}
                    {r.length ? ` · today: ${r.map(x => x.route_number).join(', ')}` : ' · no route today'}
                    {l ? ` · code ${l.code}${l.last_used_at ? ` · opened ${new Date(l.last_used_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })}` : ' · not opened yet'}` : ''}
                  </div>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => share(d, 'wa')}>💬 WhatsApp app link</button>
                <button className="btn btn-ghost btn-sm" onClick={() => share(d, 'copy')}>📋 Copy</button>
                <button className="btn btn-ghost btn-sm" onClick={() => share(d, 'qr')}>🔳 QR</button>
                {l && <button className="btn btn-ghost btn-sm" onClick={() => getCode(d.portal_username, true)} title="New code — the old link stops working">↻ New code</button>}
              </div>
            )
          })}
        </div>
        <p className="text3" style={{ fontSize: 11 }}>One code per driver — it keeps working every day (no need to resend). Lost phone or new driver on the vehicle? Tap ↻ New code. The routing app's own WhatsApp trip link still works as a backup.</p>
      </div>
      {qr && (
        <div className="modal-overlay" onClick={() => setQr(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ padding: 18, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <strong>{qr.name}</strong>
            <div><img src={qr.img} alt="QR code" style={{ width: 240, height: 240, background: '#fff', borderRadius: 8, margin: '10px 0' }} /></div>
            <div className="mono" style={{ fontSize: 18, letterSpacing: '.2em' }}>{qr.code}</div>
            <p className="text3" style={{ fontSize: 11 }}>Driver scans this with the phone camera.</p>
            <button className="btn btn-ghost btn-sm" onClick={() => setQr(null)}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}
