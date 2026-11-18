import { useState, useEffect, useCallback } from 'react'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { WH_NAMES } from '../lib/helpers'
import { DAYS, weekText, loadHours } from '../lib/posHours'

// 🕘 Store hours — opening hours + receiving hours per store and day (script 036).
// Example (Wanda): open 08:00–21:00, receives deliveries only 09:00–15:00.
// Tick several stores to give them the same hours in one go (e.g. a whole chain).
const T = t => (t ? String(t).slice(0, 5) : '')
const ROW = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }
const LBL = { fontSize: 11, flexBasis: '100%', color: 'var(--text3)', marginBottom: -2 }
const EMPTY = d => ({ day: d, closed: false, open_from: '', open_to: '', receive_from: '', receive_to: '', receive2_from: '', receive2_to: '', two: false })

export default function PosHours() {
  const [ready, setReady] = useState(null)
  const [q, setQ] = useState('')
  const [wh, setWh] = useState(() => localStorage.getItem('cc_poshours_wh') || '')
  const [onlyWith, setOnlyWith] = useState(false)
  const [stores, setStores] = useState([])
  const [hours, setHours] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [ticked, setTicked] = useState({})   // pos → store row
  const [edit, setEdit] = useState(null)     // store row being edited
  const [tick, setTick] = useState(0)

  useEffect(() => { localStorage.setItem('cc_poshours_wh', wh) }, [wh])
  useEffect(() => {
    supabase.from('coolerco_pos_hours').select('pos_local_code').limit(1).then(({ error }) => setReady(!error))
  }, [])

  const search = useCallback(async () => {
    setBusy(true); setErr(null)
    try {
      let codes = null
      if (onlyWith) {
        const { data, error } = await supabase.from('coolerco_pos_hours').select('pos_local_code').limit(5000)
        if (error) throw error
        codes = [...new Set((data || []).map(r => r.pos_local_code))]
        if (!codes.length) { setStores([]); setHours({}); return }
      }
      let qq = supabase.from('latest_pos_records').select('pos_id,pos_name,address,city,warehouse,rop').order('pos_name').limit(onlyWith ? 500 : 60)
      const s = q.trim()
      if (s) qq = qq.or(`pos_name.ilike.%${s.replace(/[,()%]/g, ' ')}%,pos_id.ilike.%${s.replace(/[,()%]/g, '')}%`)
      if (wh) qq = qq.ilike('warehouse', `%${(WH_NAMES[wh] || wh).replace(/^RTMA\s*/i, '')}%`)
      if (codes) qq = qq.in('pos_id', codes.slice(0, 500))
      if (!s && !codes) { setStores([]); setHours({}); return }
      const { data, error } = await qq
      if (error) throw error
      const seen = new Set(), list = (data || []).filter(r => !seen.has(r.pos_id) && seen.add(r.pos_id))
      setStores(list)
      const h = await loadHours(list.map(r => r.pos_id))
      setHours(h.byPos)
    } catch (e) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }, [q, wh, onlyWith])
  useEffect(() => { const t = setTimeout(search, 350); return () => clearTimeout(t) }, [search, tick])

  const tickedList = Object.values(ticked)
  return (
    <>
      <Topbar title="Store hours" sub="When each store is open — and when it receives deliveries and collections" />
      <div className="page-content">
        {ready === false && <div className="form-msg warn">Store hours need script <b>036</b> on this database (<code>supabase/coolerco_036_pos_hours.sql</code>). Run it in the SQL editor of the TEST project, then refresh.</div>}

        <details className="card" style={{ marginBottom: 12 }}>
          <summary className="card-header" style={{ cursor: 'pointer' }}><span className="card-title">ℹ️ How hours are used</span></summary>
          <div style={{ padding: '4px 14px 12px', fontSize: 12, lineHeight: 1.55 }}>
            <b>Opening hours</b> — when the store is open: repairs at the store and visits.<br />
            <b>Receiving hours</b> — when the store accepts <b>deliveries, replacements and collections</b>. Leave empty if it receives whenever it is open.
            It may start before opening (back-door receiving). Use a <b>2nd window</b> for a break, e.g. 09:00–12:00 and 13:30–15:00.<br />
            <b>Public holiday</b> — only used on a public holiday when filled in; otherwise the normal weekday applies.<br />
            Drivers see the hours on every stop in the Field app (🟢 receiving now · 🟠 closes soon · 🔴 closed), and Trip check flags visits outside them.
          </div>
        </details>

        <div className="filters" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="search-wrap" style={{ flex: 1, minWidth: 200 }}><span className="ico">🔍</span>
            <input placeholder="Store name or L-code…" value={q} onChange={e => setQ(e.target.value)} autoFocus /></div>
          <select className="field-ctrl" style={{ width: 'auto' }} value={wh} onChange={e => setWh(e.target.value)} aria-label="Warehouse">
            <option value="">🏢 All warehouses</option>
            {Object.entries(WH_NAMES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
          <label className="text3" style={{ fontSize: 11.5, display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={onlyWith} onChange={e => setOnlyWith(e.target.checked)} /> 🕘 Only stores with hours</label>
        </div>
        {err && <div className="form-msg err">{err}</div>}

        {tickedList.length > 0 && (
          <div className="form-msg ok" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            ☑️ {tickedList.length} store{tickedList.length > 1 ? 's' : ''} ticked
            <button className="btn btn-primary btn-sm" disabled={!ready} onClick={() => setEdit(tickedList[0])}>🕘 Set hours for all ticked</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setTicked({})}>Clear ticks</button>
          </div>
        )}

        <div className="card">
          {busy && <div className="load-state"><span className="spinner" /> Searching…</div>}
          {!busy && !stores.length && <div className="empty-state"><div className="empty-ico">🏪</div><div>{q.trim() || onlyWith ? 'No stores found.' : 'Type a store name or L-code to start.'}</div></div>}
          {!busy && stores.map(s => {
            const rows = hours[s.pos_id], on = !!ticked[s.pos_id]
            return (
              <div key={s.pos_id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
                <input type="checkbox" checked={on} aria-label={`Tick ${s.pos_name}`} style={{ marginTop: 4 }}
                  onChange={() => setTicked(t => { const n = { ...t }; if (on) delete n[s.pos_id]; else n[s.pos_id] = s; return n })} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.pos_name} <span className="text3 mono" style={{ fontWeight: 400 }}>{s.pos_id}</span></div>
                  <div className="text3" style={{ fontSize: 11 }}>{[s.address, s.city, s.warehouse].filter(Boolean).join(' · ')}</div>
                  <div style={{ fontSize: 11.5, marginTop: 3 }}>{rows?.length ? <>🕘 {weekText(rows)}</> : <span className="text3">No hours yet</span>}</div>
                </div>
                <button className="btn btn-ghost btn-sm" disabled={!ready} onClick={() => setEdit(s)}>{rows?.length ? '✏️ Edit' : '➕ Add hours'}</button>
              </div>
            )
          })}
        </div>
      </div>
      {edit && <HoursEditor store={edit} rows={hours[edit.pos_id] || []}
        others={tickedList.filter(t => t.pos_id !== edit.pos_id)}
        onClose={saved => { setEdit(null); if (saved) { setTicked({}); setTick(n => n + 1) } }} />}
    </>
  )
}

function HoursEditor({ store, rows, others, onClose }) {
  const [days, setDays] = useState(() => DAYS.map(([d]) => {
    const r = rows.find(x => x.day === d)
    return r ? { day: d, closed: r.closed, open_from: T(r.open_from), open_to: T(r.open_to), receive_from: T(r.receive_from), receive_to: T(r.receive_to), receive2_from: T(r.receive2_from), receive2_to: T(r.receive2_to), two: !!r.receive2_from } : EMPTY(d)
  }))
  const [note, setNote] = useState('')
  const [also, setAlso] = useState(others)
  const [msg, setMsg] = useState(null)
  const [saving, setSaving] = useState(false)
  const [hist, setHist] = useState(null)

  useEffect(() => { const k = e => e.key === 'Escape' && onClose(false); document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [onClose])
  const set = (d, patch) => setDays(ds => ds.map(x => (x.day === d ? { ...x, ...patch } : x)))
  const copyMon = to => { const m = days[0]; setDays(ds => ds.map(x => (to.includes(x.day) ? { ...m, day: x.day } : x))) }

  async function showHistory() {
    const { data, error } = await supabase.rpc('coolerco_pos_hours_history', { p_pos: store.pos_id, p_limit: 30 })
    setHist(error ? [] : data || [])
  }

  async function save() {
    setMsg(null)
    const payload = days.map(x => {
      const filled = x.closed || x.open_from || x.open_to || x.receive_from || x.receive_to
      if (!filled) return { day: x.day, clear: true }
      return { day: x.day, closed: x.closed, open_from: x.closed ? '' : x.open_from, open_to: x.closed ? '' : x.open_to,
        receive_from: x.closed ? '' : x.receive_from, receive_to: x.closed ? '' : x.receive_to,
        receive2_from: x.closed || !x.two ? '' : x.receive2_from, receive2_to: x.closed || !x.two ? '' : x.receive2_to }
    })
    const bad = payload.find(p => !p.clear && !p.closed && (!p.open_from || !p.open_to))
    if (bad) return setMsg({ type: 'err', text: `${DAYS.find(d => d[0] === bad.day)[1]}: fill in both opening times, or tick Closed.` })
    setSaving(true)
    const pos = [store.pos_id, ...also.map(a => a.pos_id)]
    const { error } = await supabase.rpc('coolerco_pos_hours_set', { p_pos: pos, p_days: payload, p_note: note.trim() || null, p_source: 'staff' })
    setSaving(false)
    if (error) return setMsg({ type: 'err', text: error.message })
    onClose(true)
  }

  const inp = (d, f) => <input type="time" className="field-ctrl" style={{ flex: 1, minWidth: 0, width: 'auto', padding: '4px 4px' }} value={d[f]} onChange={e => set(d.day, { [f]: e.target.value })} aria-label={`${DAYS.find(x => x[0] === d.day)[1]} ${f.replace('_', ' ')}`} />
  return (
    <div className="drawer-overlay" onMouseDown={e => e.target === e.currentTarget && onClose(false)}>
      <div className="drawer" role="dialog" aria-label="Store hours" style={{ width: 'min(640px, 100vw)' }}>
        <div className="drawer-hd">
          <div><div style={{ fontWeight: 700 }}>🕘 {store.pos_name}</div><div className="text3 mono" style={{ fontSize: 11 }}>{store.pos_id}</div></div>
          <button className="drawer-close" onClick={() => onClose(false)} aria-label="Close">✕</button>
        </div>
        <div className="drawer-body">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => copyMon([2, 3, 4, 5])}>📋 Copy Mon to Tue–Fri</button>
            <button className="btn btn-ghost btn-sm" onClick={() => copyMon([2, 3, 4, 5, 6, 7])}>📋 Copy Mon to every day</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 8 }}>
            {days.map(d => (
              <div key={d.day} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px', background: d.closed ? 'var(--bg2, #f6f7f9)' : 'transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <b style={{ fontSize: 12.5, flex: 1 }}>{DAYS.find(x => x[0] === d.day)[1]}</b>
                  <label className="text3" style={{ fontSize: 11.5, display: 'flex', gap: 5, alignItems: 'center' }}>
                    <input type="checkbox" checked={d.closed} onChange={e => set(d.day, { closed: e.target.checked })} /> Closed</label>
                </div>
                {!d.closed && <>
                  <div style={ROW}><span style={LBL}>🏪 Open</span>{inp(d, 'open_from')}<span>–</span>{inp(d, 'open_to')}</div>
                  <div style={ROW}><span style={LBL} title="Deliveries, replacements, collections. Empty = whenever open.">🚚 Receives</span>{inp(d, 'receive_from')}<span>–</span>{inp(d, 'receive_to')}</div>
                  {d.two
                    ? <div style={ROW}><span style={LBL}>🚚 and</span>{inp(d, 'receive2_from')}<span>–</span>{inp(d, 'receive2_to')}
                        <button className="btn btn-ghost btn-sm" onClick={() => set(d.day, { two: false, receive2_from: '', receive2_to: '' })} aria-label="Remove 2nd receiving window">✕</button></div>
                    : <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => set(d.day, { two: true })}>＋ 2nd receiving window</button>}
                  {!d.receive_from && <div className="text3" style={{ fontSize: 10.5 }}>Receives whenever open</div>}
                </>}
              </div>))}
          </div>
          <p className="text3" style={{ fontSize: 11, margin: '6px 0 10px' }}>Leave a whole day empty to remove it. Midnight closing = 23:59.</p>

          <label className="text3" style={{ fontSize: 11.5 }}>Note (who told us / source)</label>
          <input className="field-ctrl" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Store manager on the phone, 18 Nov" />

          {also.length > 0 && <div style={{ marginTop: 10, fontSize: 12 }}>
            <b>Also save the same hours to:</b>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>{also.map(a => (
              <span key={a.pos_id} className="tag tag-blue">{a.pos_name} <button style={{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit' }} aria-label={`Remove ${a.pos_name}`} onClick={() => setAlso(x => x.filter(y => y.pos_id !== a.pos_id))}>✕</button></span>))}</div>
          </div>}

          {msg && <div className={`form-msg ${msg.type}`} style={{ marginTop: 10 }}>{msg.text}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : `💾 Save${also.length ? ` (${also.length + 1} stores)` : ''}`}</button>
            <button className="btn btn-ghost" onClick={() => onClose(false)}>Cancel</button>
          </div>

          <details className="sec" style={{ marginTop: 16 }} onToggle={e => e.target.open && !hist && showHistory()}>
            <summary>🕓 Changes</summary>
            <div className="sec-body" style={{ fontSize: 11.5 }}>
              {!hist ? 'Loading…' : !hist.length ? <span className="text3">No changes yet.</span> : hist.map((h, i) => (
                <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                  {new Date(h.changed_at).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })} · <b>{DAYS.find(x => x[0] === h.day)?.[1]}</b> · {h.action === 'clear' ? 'removed' : h.new_row?.closed ? 'closed' : `${T(h.new_row?.open_from)}–${T(h.new_row?.open_to)}${h.new_row?.receive_from ? `, receives ${T(h.new_row.receive_from)}–${T(h.new_row.receive_to)}` : ''}`}
                  <span className="text3"> · {h.changed_by_email || '—'}{h.note ? ` · ${h.note}` : ''}</span>
                </div>))}
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
