import { useState, useEffect } from 'react'
import Topbar from '../../components/Topbar'
import { supabase } from '../../lib/supabase'
import { fmt, num, WAREHOUSES, WH_NAMES } from '../../lib/helpers'

export default function Receiving() {
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    warehouse_id: '', item_code: '', item_description: '',
    quantity: '', supplier: '', reference: '', notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => { loadRecent() }, [])

  async function loadRecent() {
    const { data } = await supabase.from('coolerco_wms_receiving')
      .select('*')
      .order('received_at', { ascending: false })
      .limit(20)
    setRecent(data || [])
    setLoading(false)
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    if (!form.warehouse_id || !form.item_code || !form.quantity) {
      setMsg({ type: 'error', text: 'Warehouse, item code and quantity are required' })
      return
    }
    setSaving(true)
    const { error } = await supabase.from('coolerco_wms_receiving').insert({
      warehouse_id: form.warehouse_id,
      item_code: form.item_code,
      item_description: form.item_description,
      quantity: Number(form.quantity),
      supplier: form.supplier,
      reference_number: form.reference,
      notes: form.notes,
      received_by: 'ops-hub',
      received_at: new Date().toISOString(),
      status: 'received',
    })
    if (error) {
      // If table doesn't exist yet, show helpful message
      if (error.code === '42P01') {
        setMsg({ type: 'error', text: '⚠ WMS tables not yet created. This will be enabled once the WMS schema is deployed.' })
      } else {
        setMsg({ type: 'error', text: 'Error: ' + error.message })
      }
    } else {
      setMsg({ type: 'success', text: `✓ Received ${form.quantity}× ${form.item_code} at ${form.warehouse_id}` })
      setForm({ warehouse_id: form.warehouse_id, item_code: '', item_description: '', quantity: '', supplier: '', reference: '', notes: '' })
      loadRecent()
      setTimeout(() => setMsg(null), 4000)
    }
    setSaving(false)
  }

  return (
    <>
      <Topbar title="WMS — Receiving" sub="Log stock received into warehouse" />
      <div className="page-content">
        <div className="two-col">
          {/* Form */}
          <div className="card">
            <div className="card-header"><span className="card-title">📥 Receive Stock</span></div>
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
                    <input type="text" className="field-ctrl" placeholder="SKU / part number" value={form.item_code} onChange={e => set('item_code', e.target.value)} required />
                  </div>
                  <div>
                    <div className="field-lbl">Description</div>
                    <input type="text" className="field-ctrl" placeholder="Item description" value={form.item_description} onChange={e => set('item_description', e.target.value)} />
                  </div>
                </div>
                <div className="form-row">
                  <div>
                    <div className="field-lbl">Supplier</div>
                    <input type="text" className="field-ctrl" value={form.supplier} onChange={e => set('supplier', e.target.value)} />
                  </div>
                  <div>
                    <div className="field-lbl">Reference / GRN</div>
                    <input type="text" className="field-ctrl" value={form.reference} onChange={e => set('reference', e.target.value)} />
                  </div>
                </div>
                <div>
                  <div className="field-lbl">Notes</div>
                  <textarea className="field-ctrl" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} />
                </div>
                {msg && <div className={`form-msg ${msg.type}`}>{msg.text}</div>}
                <button type="submit" className="btn btn-primary" disabled={saving} style={{ padding: '9px' }}>
                  {saving ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Saving…</> : '📥 Log Receipt'}
                </button>
              </form>
            </div>
          </div>

          {/* Recent receipts */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">🕐 Recent Receipts</span>
            </div>
            {loading ? (
              <div className="load-state"><span className="spinner" /></div>
            ) : recent.length === 0 ? (
              <div className="empty-state" style={{ padding: 32 }}>
                <div className="empty-ico">📥</div>
                <div>No receipts logged yet</div>
                <div style={{ fontSize: 11, marginTop: 6, color: 'var(--text4)' }}>WMS tables will be created on first use</div>
              </div>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr><th>Item</th><th>Qty</th><th>WH</th><th>Supplier</th><th>Date</th></tr>
                  </thead>
                  <tbody>
                    {recent.map((r, i) => (
                      <tr key={i}>
                        <td className="mono" style={{ fontSize: 11 }}>{r.item_code}</td>
                        <td><strong>{r.quantity}</strong></td>
                        <td>{r.warehouse_id}</td>
                        <td>{r.supplier || '—'}</td>
                        <td className="text3">{fmt(r.received_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
