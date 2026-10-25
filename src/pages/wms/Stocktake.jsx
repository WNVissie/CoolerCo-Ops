import { useState, useEffect } from 'react'
import Topbar from '../../components/Topbar'
import { supabase } from '../../lib/supabase'
import { fmt, num, WAREHOUSES, WH_NAMES, CATS } from '../../lib/helpers'

export default function Stocktake() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeSession, setActiveSession] = useState(null)
  const [lines, setLines] = useState([])
  const [form, setForm] = useState({ warehouse_id: '', category: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [lineForm, setLineForm] = useState({ item_code: '', counted: '' })

  useEffect(() => { loadSessions() }, [])

  async function loadSessions() {
    const { data } = await supabase.from('coolerco_wms_stocktakes')
      .select('*').order('started_at', { ascending: false }).limit(20)
    setSessions(data || [])
    setLoading(false)
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function startSession(e) {
    e.preventDefault()
    setSaving(true)
    const { data, error } = await supabase.from('coolerco_wms_stocktakes').insert({
      warehouse_id: form.warehouse_id,
      category: form.category,
      notes: form.notes,
      started_by: 'ops-hub',
      started_at: new Date().toISOString(),
      status: 'in_progress',
    }).select().single()
    if (error) {
      setMsg({ type: 'error', text: error.code === '42P01' ? '⚠ WMS tables not yet deployed' : error.message })
    } else {
      setActiveSession(data)
      setLines([])
      loadSessions()
    }
    setSaving(false)
  }

  async function addLine() {
    if (!lineForm.item_code || lineForm.counted === '') return
    const newLine = { ...lineForm, counted: Number(lineForm.counted), session_id: activeSession.id }
    setLines(l => [...l, newLine])
    setLineForm({ item_code: '', counted: '' })
  }

  async function completeSession() {
    if (!activeSession) return
    setSaving(true)
    // Save all lines
    if (lines.length > 0) {
      await supabase.from('coolerco_wms_stocktake_lines').insert(
        lines.map(l => ({ ...l, recorded_at: new Date().toISOString() }))
      )
    }
    await supabase.from('coolerco_wms_stocktakes')
      .update({ status: 'completed', completed_at: new Date().toISOString(), line_count: lines.length })
      .eq('id', activeSession.id)
    setMsg({ type: 'success', text: `✓ Stocktake completed — ${lines.length} lines recorded` })
    setActiveSession(null)
    setLines([])
    loadSessions()
    setSaving(false)
  }

  const statusColor = s => ({ in_progress: 'blue', completed: 'green', cancelled: 'neutral' }[s] || 'neutral')

  return (
    <>
      <Topbar title="WMS — Stocktake" sub="Count and verify stock levels" />
      <div className="page-content">
        {activeSession ? (
          <div className="card">
            <div className="card-header">
              <span className="card-title">📋 Active Stocktake — {activeSession.warehouse_id}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setActiveSession(null)}>Pause</button>
            </div>
            <div style={{ padding: 18 }}>
              <div style={{ marginBottom: 14, fontSize: 12, color: 'var(--text2)' }}>
                {CATS.find(c => c.key === activeSession.category)?.label || activeSession.category || 'All'} ·
                Started {fmt(activeSession.started_at)} · {lines.length} lines counted
              </div>

              {/* Add line */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input type="text" placeholder="Item code" value={lineForm.item_code}
                  onChange={e => setLineForm(f => ({ ...f, item_code: e.target.value }))}
                  style={{ flex: 2 }} />
                <input type="number" placeholder="Count" value={lineForm.counted} min="0"
                  onChange={e => setLineForm(f => ({ ...f, counted: e.target.value }))}
                  style={{ flex: 1 }}
                  onKeyDown={e => e.key === 'Enter' && addLine()} />
                <button className="btn btn-primary btn-sm" onClick={addLine}>Add</button>
              </div>

              {/* Lines */}
              {lines.length > 0 && (
                <table className="tbl" style={{ marginBottom: 16 }}>
                  <thead><tr><th>#</th><th>Item Code</th><th>Counted</th></tr></thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i}>
                        <td className="text3">{i + 1}</td>
                        <td className="mono">{l.item_code}</td>
                        <td><strong>{l.counted}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {msg && <div className={`form-msg ${msg.type}`} style={{ marginBottom: 12 }}>{msg.text}</div>}
              <button className="btn btn-primary" onClick={completeSession} disabled={saving}>
                {saving ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Saving…</> : '✓ Complete Stocktake'}
              </button>
            </div>
          </div>
        ) : (
          <div className="two-col">
            {/* Start new */}
            <div className="card">
              <div className="card-header"><span className="card-title">📋 Start Stocktake</span></div>
              <div style={{ padding: 18 }}>
                <form onSubmit={startSession} className="form-grid">
                  <div>
                    <div className="field-lbl">Warehouse *</div>
                    <select className="field-ctrl" value={form.warehouse_id} onChange={e => set('warehouse_id', e.target.value)} required>
                      <option value="">Select…</option>
                      {WAREHOUSES.map(w => <option key={w} value={w}>{w} – {WH_NAMES[w]}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="field-lbl">Category</div>
                    <select className="field-ctrl" value={form.category} onChange={e => set('category', e.target.value)}>
                      <option value="">All categories</option>
                      {CATS.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="field-lbl">Notes</div>
                    <textarea className="field-ctrl" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
                  </div>
                  {msg && <div className={`form-msg ${msg.type}`}>{msg.text}</div>}
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Starting…</> : '▶ Start Stocktake'}
                  </button>
                </form>
              </div>
            </div>

            {/* History */}
            <div className="card">
              <div className="card-header"><span className="card-title">🕐 Recent Stocktakes</span></div>
              {loading ? <div className="load-state"><span className="spinner" /></div>
                : sessions.length === 0
                  ? <div className="empty-state" style={{ padding: 28 }}><div className="empty-ico">📋</div><div>No stocktakes yet</div></div>
                  : (
                    <div className="tbl-wrap">
                      <table className="tbl">
                        <thead><tr><th>WH</th><th>Category</th><th>Lines</th><th>Status</th><th>Date</th></tr></thead>
                        <tbody>
                          {sessions.map((s, i) => (
                            <tr key={i}>
                              <td>{s.warehouse_id}</td>
                              <td>{s.category || 'All'}</td>
                              <td>{s.line_count ?? '—'}</td>
                              <td><span className={`tag tag-${statusColor(s.status)}`}>{s.status}</span></td>
                              <td className="text3">{fmt(s.started_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
              }
            </div>
          </div>
        )}
      </div>
    </>
  )
}
