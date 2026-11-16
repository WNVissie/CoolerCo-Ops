import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Driver side of crew changes (script 034), shown under My trip:
//   · "This is not my route" on a route he was given
//   · "Not on your list?" → today's routes in his warehouse → "This is my route today" (claim)
//   · his requests with the supervisor's answer
const KIND = { claim: 'This is my route today', not_mine: 'This is not my route' }
const STATUS = { pending: ['⏳ Waiting for supervisor', 'orange'], approved: ['✅ Approved', 'green'], rejected: ['🚫 Not approved', 'neutral'] }

export function CrewRequests({ date, myRoutes, onChanged }) {
  const [reqs, setReqs] = useState([])
  const [open, setOpen] = useState(false)
  const [list, setList] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)

  const loadReqs = useCallback(() => supabase.rpc('coolerco_my_crew_requests', { p_date: date }).then(({ data }) => setReqs(data || [])), [date])
  useEffect(() => { loadReqs() }, [loadReqs])
  useEffect(() => { if (open && !list) supabase.rpc('coolerco_claimable_routes', { p_date: date }).then(({ data, error }) => setList(error ? [] : data || [])) }, [open, list, date])

  const ask = async (route, kind) => {
    setBusy(route + kind); setMsg(null)
    const { error } = await supabase.rpc('coolerco_crew_request', { p_route: route, p_kind: kind, p_note: note.trim() || null })
    setBusy(null)
    if (error) return setMsg({ t: 'err', s: error.message })
    setNote(''); setMsg({ t: 'ok', s: 'Sent to your supervisor. Your trip updates once they approve.' }); loadReqs()
  }
  const mine = new Set((myRoutes || []).map(r => r.id))
  const pendingFor = (route, kind) => reqs.find(r => r.route_id === route && r.kind === kind && r.status === 'pending')

  return (
    <div className="f-card">
      {(myRoutes || []).map(r => (
        <div key={r.id} className="f-row" style={{ gap: 6, marginBottom: 6 }}>
          <small className="f-grow">{r.route_number}</small>
          {pendingFor(r.id, 'not_mine') ? <span className="tag tag-orange">⏳ "Not mine" sent</span>
            : <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => ask(r.id, 'not_mine')}>🙅 This is not my route</button>}
        </div>
      ))}
      <details className="f-fold" open={open} onToggle={e => setOpen(e.target.open)}>
        <summary>🔄 Driving another route today?</summary>
        <p className="text3" style={{ fontSize: 11.5, margin: '2px 0 8px' }}>Pick the route you are driving. Your supervisor confirms, then it appears in your trip.</p>
        <input className="field-ctrl" placeholder="Note for the supervisor (optional), e.g. swapped with Thabo" value={note} onChange={e => setNote(e.target.value)} />
        {!list ? <div className="load-state"><span className="spinner" /></div> : list.filter(r => !mine.has(r.route_id)).map(r => (
          <div key={r.route_id} className="f-row" style={{ gap: 6, marginTop: 6 }}>
            <div className="f-grow"><b style={{ fontSize: 13 }}>{r.route_number}</b><small>{r.slot_name || ''} · {r.stops ?? '?'} stops{r.crew ? ` · now: ${r.crew}` : ''}</small></div>
            {pendingFor(r.route_id, 'claim') ? <span className="tag tag-orange">⏳ Sent</span>
              : <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => ask(r.route_id, 'claim')}>This is mine</button>}
          </div>
        ))}
        {list && !list.filter(r => !mine.has(r.route_id)).length && <small className="text3">No other finalised routes in your warehouse today.</small>}
      </details>
      {msg && <div className={`form-msg ${msg.t === 'ok' ? 'ok' : 'err'}`} style={{ marginTop: 6 }}>{msg.s}</div>}
      {reqs.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {reqs.map(q => (
            <small key={q.id} className="text3" style={{ display: 'block' }}>
              {q.route_number} · {KIND[q.kind]} · <span className={`tag tag-${STATUS[q.status][1]}`}>{STATUS[q.status][0]}</span>{q.decide_note ? ` · ${q.decide_note}` : ''}
              {q.status === 'approved' && q.kind === 'claim' && !mine.has(q.route_id) && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={onChanged}>↻ Load it</button>}
            </small>
          ))}
        </div>
      )}
    </div>
  )
}
