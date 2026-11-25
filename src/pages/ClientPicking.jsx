import { useState, useEffect } from 'react'
import Drawer from '../components/Drawer'
import CameraScan, { codeCandidates } from '../components/CameraScan'
import { supabase } from '../lib/supabase'
import { num, WAREHOUSES, WH_NAMES, condColor, CASE_TYPE_ICON } from '../lib/helpers'
import { useClientScope, ClientBadge } from '../components/ClientScope'

// 🟩 Picking for clients where CoolerCo is the master (Tiger, Demo, Demo Foods …) — script 057.
// Stock = CoolerCo's own register (coolerco_assets), not COM. One line per Deliver / Replacement stop of the day's routes.
//   Choose = list of Ready-to-Work coolers of that client in the case's warehouse, same model first
//   📷 Scan = the cooler's asset number or serial → picked straight away (wrong model asks a reason)
// A pick: case gets the cooler (Asset Delivered), cooler status "Picked", movement 'pick' in the ledger. ↩ undo puts it back.
const ERR = {
  not_allowed: 'You may not pick (warehouse or office role needed).', not_found: 'Case not found.', asset_not_found: 'No cooler with that number for this client.',
  other_warehouse: 'That cooler is in another warehouse.', not_ready: 'That cooler is not Ready to Work (or already picked).',
  picked_elsewhere: 'That cooler is already picked for another case.', case_not_open: 'The case is not open (closed or still waiting for approval).',
  no_pick_needed: 'This case type does not need a cooler from the warehouse.', nothing_picked: 'Nothing picked yet.', sign_in: 'Please sign in again.',
}
const REASONS = ['Requested model out of stock', 'Customer asked for this model', 'Approved by supervisor', 'Bigger / better fit for the store']
const buzz = bad => { try { navigator.vibrate?.(bad ? [120, 80, 200] : 60) } catch { /* none */ } }

export default function ClientPicking({ wh, setWh, day, dayNav }) {
  const scope = useClientScope()
  const [lines, setLines] = useState(null)
  const [err, setErr] = useState(null)
  const [missing, setMissing] = useState(false)
  const [msg, setMsg] = useState(null)
  const [tick, setTick] = useState(0)
  const [choose, setChoose] = useState(null)
  const [show, setShow] = useState('all')

  useEffect(() => {
    let live = true
    setLines(null); setErr(null)
    supabase.rpc('coolerco_client_pick_board', { p_date: day, p_warehouse: wh }).then(({ data, error }) => {
      if (!live) return
      if (error) { if (/does not exist|Could not find/i.test(error.message)) setMissing(true); else setErr(error.message); setLines([]); return }
      setLines(data || [])
    })
    return () => { live = false }
  }, [day, wh, tick])

  async function undo(l) {
    if (!window.confirm(`Release ${l.picked_asset} from ${l.case_number}? It goes back to Ready to Work.`)) return
    const { data: r, error } = await supabase.rpc('coolerco_client_pick_undo', { p_case: l.case_number, p_reason: 'Undone on picking board' })
    if (error || r?.error) return setMsg({ t: error?.message || ERR[r.error] || r.error, bad: true })
    setMsg({ t: `↩ ${r.asset} back to Ready to Work.` }); setTick(n => n + 1)
  }

  const all = lines || []
  const picked = all.filter(l => l.picked_asset).length
  const noStock = all.filter(l => !l.picked_asset && !l.ready_any).length
  const otherModel = all.filter(l => l.picked_asset && l.model_match === false).length
  const shown = all.filter(l => show === 'all' || (show === 'to_pick' ? !l.picked_asset : show === 'picked' ? !!l.picked_asset : show === 'no_stock' ? !l.picked_asset && !l.ready_any : l.model_match === false))
  const routes = Object.values(shown.reduce((m, l) => { (m[l.route_id] ||= { r: l, ls: [] }).ls.push(l); return m }, {}))
  const card = (key, label, value, sub, color) => (
    <button type="button" className={`stat-card c-${color}`} aria-pressed={show === key} onClick={() => setShow(show === key ? 'all' : key)}
      style={{ cursor: 'pointer', textAlign: 'left', font: 'inherit', outline: show === key ? '2px solid var(--accent)' : 'none' }}>
      <div className="stat-label">{label}</div><div className="stat-value">{lines ? num(value) : '…'}</div><div className="stat-sub">{sub}</div>
    </button>)

  if (missing) return <div className="notice warn">🟩 Picking for other clients needs database script 057.</div>
  return (
    <>
      <div className="filters" style={{ flexWrap: 'wrap', gap: 8 }}>
        <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => setWh(e.target.value)} aria-label="Warehouse">
          {WAREHOUSES.map(w => <option key={w} value={w}>🏢 {WH_NAMES[w]}</option>)}
        </select>
        {dayNav}
      </div>
      {err && <div className="form-msg error">{err}</div>}
      {msg && <div className={`form-msg ${msg.bad ? 'error' : 'success'}`}>{msg.t}</div>}
      <div className="stats-row">
        {card('all', '🚚 Stops needing a cooler', all.length, `${new Set(all.map(l => l.route_id)).size} route(s) · deliveries + replacements`, 'accent')}
        {card('to_pick', '⏳ To pick', all.length - picked, 'tap Choose or scan', all.length - picked ? 'orange' : 'green')}
        {card('picked', '✅ Picked', picked, 'cooler on the case', picked === all.length && all.length ? 'green' : 'accent')}
        {card('no_stock', '🚫 No stock', noStock, 'no Ready-to-Work cooler of this client here', noStock ? 'red' : 'green')}
        {card('other_model', '🔁 Other model', otherModel, 'picked with a reason', otherModel ? 'purple' : 'green')}
      </div>
      {!lines && <div className="load-state"><span className="spinner" /> Loading routes…</div>}
      {lines && !all.length && <div className="empty-state"><div className="empty-ico">📦</div><div>No Demo / Tiger delivery or replacement stops on routes of this day in {WH_NAMES[wh]}.</div><div className="text3" style={{ fontSize: 11 }}>On TEST: put the cases on a 🧪 Test route first.</div></div>}
      {routes.map(({ r, ls }) => {
        const p = ls.filter(l => l.picked_asset).length
        return (
          <details key={r.route_id} className="card wh-card" style={{ marginBottom: 10 }} open>
            <summary className="wh-card-hd">
              <div style={{ minWidth: 0 }}>
                <div className="card-title">🚚 {r.route_number}{/^TEST-/.test(r.route_number) && <span className="tag tag-purple" style={{ marginLeft: 6 }}>🧪 test</span>}</div>
                <div className="text3" style={{ fontSize: 10.5 }}>{r.driver || 'No driver yet'} · {r.route_status}</div>
              </div>
              <div className="prep-pills"><span className={`tag tag-${p === ls.length ? 'green' : 'orange'}`}>✅ {p}/{ls.length} picked</span></div>
            </summary>
            <div className="tbl-wrap">
              <table className="tbl pick-tbl">
                <thead><tr><th>#</th><th>Stop</th><th>Asked for</th><th>Cooler</th><th></th></tr></thead>
                <tbody>{ls.map(l => (
                  <tr key={l.case_number}>
                    <td className="text3">{l.stop_sequence ?? '—'}</td>
                    <td style={{ fontSize: 11 }}>
                      <div className="mono" style={{ fontSize: 10.5 }}>{CASE_TYPE_ICON[l.case_type] || '•'} {l.case_number}</div>
                      <div className="trunc text3" style={{ maxWidth: 200, fontSize: 10.5 }} title={l.point_of_sale}>{l.point_of_sale}</div>
                      <div style={{ marginTop: 2 }}><ClientBadge scope={scope} code={l.client_code} small /></div>
                    </td>
                    <td style={{ fontSize: 11 }}>
                      <div>{l.requested_model || '—'}</div>
                      {l.requested_condition && <span className={`tag tag-${condColor(l.requested_condition)}`}>{l.requested_condition}</span>}
                      <div className="text3" style={{ fontSize: 10 }}>{l.ready_same_model} of this model ready · {l.ready_any} any</div>
                      {l.asset_removed && <div className="text3" style={{ fontSize: 10 }}>↩️ collects {l.asset_removed}</div>}
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {l.picked_asset ? <>
                        <div className="mono"><b>{l.picked_asset}</b> <span className="tag tag-green">✅ Picked</span></div>
                        <div className="text3 trunc" style={{ maxWidth: 190, fontSize: 10.5 }}>{l.picked_model}</div>
                        {l.picked_condition && <span className={`tag tag-${condColor(l.picked_condition)}`}>{l.picked_condition}</span>}
                        {l.model_match === false && <span className="tag tag-purple" style={{ marginLeft: 3 }}>🔁 other model</span>}
                        <div className="text3" style={{ fontSize: 10 }}>{l.picked_by} · {new Date(l.picked_at).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' })}</div>
                      </> : !l.ready_any ? <span className="tag tag-red">🚫 No stock</span> : <span className="tag tag-orange">⏳ Not picked</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className={`btn btn-sm ${l.picked_asset ? 'btn-ghost' : 'btn-primary'}`} onClick={() => setChoose(l)}>{l.picked_asset ? '🔄 Change' : '📦 Pick'}</button>
                      {l.picked_asset && <button className="btn btn-ghost btn-sm" title="Undo pick" onClick={() => undo(l)}>↩</button>}
                    </td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          </details>)
      })}
      <details className="sec" style={{ marginTop: 10 }}>
        <summary>ℹ️ How picking works for these clients</summary>
        <div className="sec-body" style={{ fontSize: 11.5 }}>
          <p>These clients have no COM, so their stock is CoolerCo&rsquo;s own register. A stop shows here when its case is a delivery or replacement on a route of this day (on TEST: a 🧪 test route).</p>
          <p><b>📦 Pick:</b> choose from the list (the requested model first) or scan the cooler&rsquo;s label. A different model needs a reason. The cooler goes on the case as <i>Asset Delivered</i>, its status becomes <i>Picked</i>, and the move is written to the movement history. The driver sees it on the stop in the Field app.</p>
          <p><b>↩ Undo</b> puts the cooler back to Ready to Work and clears it from the case. Everything is logged with who and when.</p>
        </div>
      </details>
      <PickDrawer line={choose} onClose={() => setChoose(null)} onDone={t => { setChoose(null); setMsg({ t }); setTick(n => n + 1) }} />
    </>
  )
}

function PickDrawer({ line, onClose, onDone }) {
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [other, setOther] = useState(null) // cooler of another model → reason first
  const [reason, setReason] = useState('')
  const [code, setCode] = useState('')
  const [cam, setCam] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!line) return
    setList(null); setErr(null); setOther(null); setReason(''); setCode('')
    supabase.rpc('coolerco_client_pick_candidates', { p_case: line.case_number, p_limit: 20 })
      .then(({ data, error }) => { if (error) setErr(error.message); setList(data || []) })
  }, [line])

  async function pick(asset, how = 'screen', why = null) {
    setBusy(true); setErr(null)
    const { data: r, error } = await supabase.rpc('coolerco_client_pick_select', { p_case: line.case_number, p_asset: asset, p_route: line.route_id, p_how: how, p_reason: why })
    setBusy(false)
    if (error) { buzz(true); return setErr(error.message) }
    if (r?.error === 'other_model') { buzz(true); setOther({ asset: r.asset, model: r.model, how }); return }
    if (r?.error) { buzz(true); return setErr(`${r.asset ? r.asset + ': ' : ''}${ERR[r.error] || r.error}${r.status ? ` (${r.status})` : ''}`) }
    buzz(false); onDone(`📦 ${r.asset} picked for ${line.point_of_sale}${r.model_match === false ? ' (other model)' : ''}.`)
  }
  const scanned = (raw, how) => { const c = codeCandidates(raw)[0] || raw; setCode(c); pick(c, how) }

  return (
    <Drawer open={!!line} onClose={onClose} title={line ? `Pick a cooler · stop ${line.stop_sequence ?? ''}` : ''} icon="📦">
      {line && <>
        <div className="req-box" style={{ marginBottom: 10, fontSize: 11.5 }}>
          <div><b>{line.point_of_sale}</b> <span className="mono text3">{line.case_number}</span></div>
          <div>Asked: {line.requested_model || 'any model'}{line.requested_condition ? ` · ${line.requested_condition}` : ''}</div>
          {line.picked_asset && <div className="text3">Now: {line.picked_asset} — picking another releases it</div>}
        </div>
        <form className="filters" style={{ gap: 6 }} onSubmit={e => { e.preventDefault(); if (code.trim()) pick(code.trim(), 'typed') }}>
          <input className="field-ctrl" style={{ flex: 1, minWidth: 140 }} value={code} onChange={e => setCode(e.target.value)} placeholder="Scan or type asset / serial no." aria-label="Asset number" />
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setCam(true)}>📷 Scan</button>
          <button className="btn btn-primary btn-sm" disabled={busy || !code.trim()}>Pick</button>
        </form>
        {err && <div className="form-msg error">{err}</div>}
        {other && (
          <div className="req-box" style={{ borderColor: 'var(--purple, #7c3aed)', marginBottom: 10, fontSize: 11.5 }}>
            <div><b>{other.asset}</b> is a <b>{other.model || 'different model'}</b> — not the model asked for. Why use it?</div>
            <div className="chip-row" style={{ margin: '6px 0' }}>
              {REASONS.map(x => <button type="button" key={x} className={`chip-opt${reason === x ? ' on' : ''}`} onClick={() => setReason(x)}>{x}</button>)}
            </div>
            <input className="field-ctrl" value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason" />
            <div className="modal-btns">
              <button className="btn btn-ghost btn-sm" onClick={() => setOther(null)}>Back</button>
              <button className="btn btn-primary btn-sm" disabled={busy || !reason.trim()} onClick={() => pick(other.asset, other.how, reason.trim())}>Pick with this reason</button>
            </div>
          </div>)}
        {!list ? <div className="load-state"><span className="spinner" /> Finding coolers…</div> : !list.length ? (
          <div className="empty-state"><div className="empty-ico">🔍</div><div>No free Ready-to-Work cooler of this client in this warehouse.</div></div>
        ) : list.map((c, i) => (
          <div key={c.asset_number} className="pick-cand">
            <div style={{ minWidth: 0 }}>
              <div className="mono"><b>{c.asset_number}</b> <span className="text3">{c.serial_number}</span>{i === 0 && c.same_model ? <span className="tag tag-green" style={{ marginLeft: 6 }}>Best match</span> : null}</div>
              <div className="text3 trunc" style={{ fontSize: 10.5 }}>{c.model || c.model_code}</div>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
                {c.condition && <span className={`tag tag-${condColor(c.condition)}`}>{c.condition}</span>}
                {c.branding && <span className="tag tag-neutral">{c.branding}</span>}
                {!c.same_model && <span className="tag tag-purple">🔁 other model</span>}
              </div>
            </div>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => pick(c.asset_number)}>Pick</button>
          </div>))}
        {cam && <CameraScan onClose={() => setCam(false)} onResult={t => { setCam(false); scanned(t, 'camera') }} />}
      </>}
    </Drawer>
  )
}
