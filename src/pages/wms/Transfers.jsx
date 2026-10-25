import { useState, useEffect } from 'react'
import Topbar from '../../components/Topbar'
import { supabase } from '../../lib/supabase'
import { fmt, WAREHOUSES, WH_NAMES } from '../../lib/helpers'

export default function Transfers() {
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ from_warehouse: '', to_warehouse: '', item_code: '', quantity: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => { loadRecent() }, [])

  async function loadRecent() {
    const { data } = await supabase.from('wms_transfers')
      .select('*').order('transferred_at', { ascending: false }).limit(20)
    setRecent(data || [])
    setLoading(false)
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    if (form.from_warehouse === form.to_warehouse) {
      setMsg({ type: 'error', text: 'From and To warehouse must be different' }); return
    }
    setSaving(true)
    const { error } = await supabase.from('wms_transfers').insert({
      from_warehouse: form.from_warehouse,
      to_warehouse: form.to_warehouse,
      item_code: form.item_code,
      quantity: Number(form.quantity),
      notes: form.notes,
      transferred_by: 'ops-hub',
      transferred_at: new Date().toISOString(),
      status: 'pending',
    })
    if (error) {
      setMsg({ type: 'error', text: error.code === '42P01' ? '⚠ WMS tables not yet deployed' : error.message })
    } else {
      setMsg({ type: 'success', text: `✓ Transfer logged: ${form.quantity}× ${form.item_code}` })
      setForm(f => ({ ...f, item_code: '', quantity: '', notes: '' }))
      loadRecent()
      setTimeout(() => setMsg(null), 4000)
    }
    setSaving(false)
  }

  const statusColor = s => ({ pending: 'orange', in_transit: 'blue', completed: 'green', cancelled: 'neutral' }[s] || 'neutral')

  return (
    <>
      <Topbar title="WMS — Transfers" sub="Move stock between warehouses" />
      <div className="page-content">
        <div className="two-col">
          <div className="card">
            <div className="card-header"><span className="card-title">🔄 Create Transfer</span></div>
            <div style={{ padding: 18 }}>
              <form onSubmit={submit} className="form-grid">
                <div className="form-row">
                  <div>
                    <div className="field-lbl">From Warehouse *</div>
                    <select className="field-ctrl" value={form.from_warehouse} onChange={e => set('from_warehouse', e.target.value)} required>
                      <option value="">Select…</option>
                      {WAREHOUSES.map(w => <option key={w} value={w}>{w} – {WH_NAMES[w]}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="field-lbl">To Warehouse *</div>
                    <select className="field-ctrl" value={form.to_warehouse} onChange={e => set('to_warehouse', e.target.value)} required>
                      <option value="">Select…</option>
                      {WAREHOUSES.filter(w => w !== form.from_warehouse).map(w => <option key={w} value={w}>{w} – {WH_NAMES[w]}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div>
                    <div className="field-lbl">Item Code *</div>
                    <input type="text" className="field-ctrl" value={form.item_code} onChange={e => set('item_code', e.target.value)} required />
                  </div>
                  <div>
                    <div className="field-lbl">Quantity *</div>
                    <input type="number" className="field-ctrl" min="1" value={form.quantity} onChange={e => set('quantity', e.target.value)} required />
                  </div>
                </div>
                <div>
                  <div className="field-lbl">Notes</div>
                  <textarea className="field-ctrl" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
                </div>
                {msg && <div className={`form-msg ${msg.type}`}>{msg.text}</div>}
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Saving…</> : '🔄 Create Transfer'}
                </button>
              </form>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><span className="card-title">📋 Recent Transfers</span></div>
            {loading ? <div className="load-state"><span className="spinner" /></div>
              : recent.length === 0
                ? <div className="empty-state" style={{ padding: 32 }}><div className="empty-ico">🔄</div><div>No transfers yet</div></div>
                : (
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead><tr><th>From</th><th>To</th><th>Item</th><th>Qty</th><th>Status</th><th>Date</th></tr></thead>
                      <tbody>
                        {recent.map((r, i) => (
                          <tr key={i}>
                            <td>{r.from_warehouse}</td>
                            <td>{r.to_warehouse}</td>
                            <td className="mono" style={{ fontSize: 11 }}>{r.item_code}</td>
                            <td><strong>{r.quantity}</strong></td>
                            <td><span className={`tag tag-${statusColor(r.status)}`}>{r.status}</span></td>
                            <td className="text3">{fmt(r.transferred_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
            }
          </div>
        </div>
      </div>
    </>
  )
}
