import { useState, useEffect } from 'react'
import Topbar from '../../components/Topbar'
import { supabase } from '../../lib/supabase'
import { fmt, WAREHOUSES, WH_NAMES } from '../../lib/helpers'

export default function Dispatch() {
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    warehouse_id: '', item_code: '', quantity: '',
    destination: '', vehicle_reg: '', driver_name: '', reference: '', notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => { loadRecent() }, [])

  async function loadRecent() {
    const { data } = await supabase.from('coolerco_wms_dispatches')
      .select('*').order('dispatched_at', { ascending: false }).limit(20)
    setRecent(data || [])
    setLoading(false)
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('coolerco_wms_dispatches').insert({
      warehouse_id: form.warehouse_id,
      item_code: form.item_code,
      quantity: Number(form.quantity),
      destination: form.destination,
      vehicle_registration: form.vehicle_reg,
      driver_name: form.driver_name,
      reference_number: form.reference,
      notes: form.notes,
      dispatched_by: 'ops-hub',
      dispatched_at: new Date().toISOString(),
      status: 'dispatched',
    })
    if (error) {
      setMsg({ type: 'error', text: error.code === '42P01' ? '⚠ WMS tables not yet deployed' : error.message })
    } else {
      setMsg({ type: 'success', text: `✓ Dispatched ${form.quantity}× ${form.item_code} from ${form.warehouse_id}` })
      setForm(f => ({ ...f, item_code: '', quantity: '', destination: '', reference: '', notes: '' }))
      loadRecent()
      setTimeout(() => setMsg(null), 4000)
    }
    setSaving(false)
  }

  const statusColor = s => ({ dispatched: 'orange', delivered: 'green', cancelled: 'neutral' }[s] || 'neutral')

  return (
    <>
      <Topbar title="WMS — Dispatch" sub="Log stock dispatched from warehouse" />
      <div className="page-content">
        <div className="two-col">
          <div className="card">
            <div className="card-header"><span className="card-title">📤 Log Dispatch</span></div>
            <div style={{ padding: 18 }}>
              <form onSubmit={submit} className="form-grid">
                <div className="form-row">
                  <div>
                    <div className="field-lbl">Warehouse *</div>
                    <select className="field-ctrl" value={form.warehouse_id} onChange={e => set('warehouse_id', e.target.value)} required>
                      <option value="">Select…</option>
                      {WAREHOUSES.map(w => <option key={w} value={w}>{w} – {WH_NAMES[w]}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="field-lbl">Quantity *</div>
                    <input type="number" className="field-ctrl" min="1" value={form.quantity} onChange={e => set('quantity', e.target.value)} required />
                  </div>
                </div>
                <div className="form-row">
                  <div>
                    <div className="field-lbl">Item Code *</div>
                    <input type="text" className="field-ctrl" value={form.item_code} onChange={e => set('item_code', e.target.value)} required />
                  </div>
                  <div>
                    <div className="field-lbl">Destination</div>
                    <input type="text" className="field-ctrl" placeholder="Customer / location" value={form.destination} onChange={e => set('destination', e.target.value)} />
                  </div>
                </div>
                <div className="form-row">
                  <div>
                    <div className="field-lbl">Driver</div>
                    <input type="text" className="field-ctrl" value={form.driver_name} onChange={e => set('driver_name', e.target.value)} />
                  </div>
                  <div>
                    <div className="field-lbl">Vehicle Reg</div>
                    <input type="text" className="field-ctrl" value={form.vehicle_reg} onChange={e => set('vehicle_reg', e.target.value)} />
                  </div>
                </div>
                <div>
                  <div className="field-lbl">Reference / Delivery Note</div>
                  <input type="text" className="field-ctrl" value={form.reference} onChange={e => set('reference', e.target.value)} />
                </div>
                <div>
                  <div className="field-lbl">Notes</div>
                  <textarea className="field-ctrl" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
                </div>
                {msg && <div className={`form-msg ${msg.type}`}>{msg.text}</div>}
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Saving…</> : '📤 Log Dispatch'}
                </button>
              </form>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><span className="card-title">🕐 Recent Dispatches</span></div>
            {loading ? <div className="load-state"><span className="spinner" /></div>
              : recent.length === 0
                ? <div className="empty-state" style={{ padding: 28 }}><div className="empty-ico">📤</div><div>No dispatches yet</div></div>
                : (
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead><tr><th>WH</th><th>Item</th><th>Qty</th><th>Destination</th><th>Status</th><th>Date</th></tr></thead>
                      <tbody>
                        {recent.map((r, i) => (
                          <tr key={i}>
                            <td>{r.warehouse_id}</td>
                            <td className="mono" style={{ fontSize: 11 }}>{r.item_code}</td>
                            <td><strong>{r.quantity}</strong></td>
                            <td><span className="trunc" style={{ maxWidth: 120, display: 'block' }}>{r.destination || '—'}</span></td>
                            <td><span className={`tag tag-${statusColor(r.status)}`}>{r.status}</span></td>
                            <td className="text3">{fmt(r.dispatched_at)}</td>
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
