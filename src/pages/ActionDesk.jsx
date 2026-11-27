import { useState, useEffect } from 'react'
import Topbar from '../components/Topbar'
import Drawer from '../components/Drawer'
import CaseActions from '../components/CaseActions'
import ExpectedBack from '../components/ExpectedBack'
import { supabase } from '../lib/supabase'
import { CASE_TYPE_ICON } from '../lib/helpers'
import { useClientScope, ClientBadge } from '../components/ClientScope'

// 🧭 Action Required desk (script 059): every Demo / Tiger case that was not done waits here with its reason.
// Open a case → reschedule (new linked case) or cancel. Location / contact problems also go to the region (🚨).
const EVENT_LABEL = { location_unavailable: '📍 Location unavailable', location_closed: '🔒 Location closed', denied: '🙅 Service denied', repair_failed: '🛠 Repair failed',
  lack_material: '📦 Lack of material', no_contact: '📞 No contact', asset_missing: '❓ Asset missing', other: '📝 Other' }
const age = t => { const h = Math.round((Date.now() - new Date(t)) / 36e5); return h < 24 ? `${h} h` : `${Math.round(h / 24)} d` }

export default function ActionDesk() {
  const scope = useClientScope()
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [missing, setMissing] = useState(false)
  const [client, setClient] = useState('')
  const [ev, setEv] = useState('')
  const [sel, setSel] = useState(null)
  const [msg, setMsg] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    supabase.rpc('coolerco_ar_list', { p_client: client || null, p_warehouse: null }).then(({ data, error }) => {
      if (error) { if (/does not exist|Could not find/i.test(error.message)) setMissing(true); else setErr(error.message); setRows([]); return }
      setRows(data || [])
    })
  }, [client, tick])

  const all = rows || []
  const events = [...new Set(all.map(r => r.event || 'other'))]
  const shown = all.filter(r => !ev || (r.event || 'other') === ev)
  const waitingRegion = all.filter(r => (r.open_alerts || []).length).length

  return (
    <>
      <Topbar title="Action required" sub="Cases not done in the field — coolers expected back (all clients) · reschedule or cancel (Demo / Tiger and other CoolerCo-run clients)" />
      <div className="page-content">
        <ExpectedBack />
        {missing && <div className="notice warn">🧭 The Action Required desk needs database script 059.</div>}
        {err && <div className="form-msg error">{err}</div>}
        {msg && <div className="form-msg success">{msg}</div>}
        <div className="stats-row">
          <div className="stat-card c-orange"><div className="stat-label">🧭 Waiting for a decision</div><div className="stat-value">{rows ? all.length : '…'}</div><div className="stat-sub">oldest first</div></div>
          <div className="stat-card c-red"><div className="stat-label">🚨 Waiting for the region</div><div className="stat-value">{rows ? waitingRegion : '…'}</div><div className="stat-sub">location / contact to check</div></div>
        </div>
        <div className="chip-row" style={{ alignItems: 'center' }}>
          <select className="field-ctrl" style={{ width: 'auto' }} value={client} onChange={e => setClient(e.target.value)} aria-label="Client">
            <option value="">All clients</option>
            {(scope.clients || []).map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          <button type="button" className={`chip-opt${!ev ? ' on' : ''}`} onClick={() => setEv('')}>All reasons · {all.length}</button>
          {events.map(e => <button type="button" key={e} className={`chip-opt${ev === e ? ' on' : ''}`} onClick={() => setEv(ev === e ? '' : e)}>{EVENT_LABEL[e] || e} · {all.filter(r => (r.event || 'other') === e).length}</button>)}
        </div>
        {!rows && <div className="load-state"><span className="spinner" /> Loading…</div>}
        {rows && !shown.length && !missing && <div className="empty-state"><div className="empty-ico">✅</div><div>Nothing waiting — every case has a way forward.</div></div>}
        {shown.length > 0 && (
          <div className="card"><div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Waiting</th><th>Case</th><th>Store</th><th>Why</th><th>Ways out</th></tr></thead>
              <tbody>{shown.map(r => (
                <tr key={r.case_number} onClick={() => setSel(r)} style={{ cursor: 'pointer' }}>
                  <td><span className={`tag tag-${(Date.now() - new Date(r.since)) > 864e5 ? 'red' : 'orange'}`}>{age(r.since)}</span></td>
                  <td style={{ fontSize: 11 }}>
                    <div className="mono"><b>{r.case_number}</b></div>
                    <div>{CASE_TYPE_ICON[r.case_type] || '•'} {r.case_type}</div>
                    <ClientBadge scope={scope} code={r.client_code} small />
                  </td>
                  <td style={{ fontSize: 11 }}><div className="trunc" style={{ maxWidth: 200 }}>{r.point_of_sale}</div><div className="text3">{r.pos_local_code} · {r.warehouse_code}</div></td>
                  <td style={{ fontSize: 11, maxWidth: 280 }}>
                    <div><b>{EVENT_LABEL[r.event] || r.event || '—'}</b></div>
                    <div className="text3 trunc" style={{ maxWidth: 280 }} title={r.reason}>{r.reason}</div>
                    {(r.open_alerts || []).length > 0 && <span className="tag tag-red">🚨 waiting for the region</span>}
                    {(r.alerts_done || []).length > 0 && <span className="tag tag-green">✅ region checked</span>}
                  </td>
                  <td style={{ fontSize: 10.5 }}>{(r.ways || []).map(w => <div key={w}>{w === 'Scrap an Asset' ? '🗑 Scrap' : `🔁 ${w}`}</div>)}</td>
                </tr>))}
              </tbody>
            </table>
          </div></div>)}
      </div>
      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel?.case_number || 'Case'} icon={CASE_TYPE_ICON[sel?.case_type] || '🧭'}>
        {sel && <>
          <div style={{ fontSize: 12, marginBottom: 8 }}><ClientBadge scope={scope} code={sel.client_code} /> {sel.case_type} · {sel.point_of_sale}</div>
          <CaseActions caseNumber={sel.case_number} onChanged={() => setTick(t => t + 1)} />
          <a className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} href={`/cases?client=${sel.client_code}&case=${sel.case_number}`}>📂 Open full case</a>
        </>}
      </Drawer>
    </>
  )
}
