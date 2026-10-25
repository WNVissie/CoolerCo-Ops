import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'

const FAULT_TYPES = [
  'Not cooling', 'Compressor failure', 'Door seal damaged', 'Display issue',
  'Electrical fault', 'Physical damage', 'Lighting failure', 'Thermostat issue',
  'Fan motor failure', 'Refrigerant leak', 'Other',
]

export default function NewCase() {
  const nav = useNavigate()
  const [form, setForm] = useState({
    customer_name: '', customer_account: '', asset_serial: '',
    fault_type: '', fault_description: '', contact_name: '', contact_phone: '',
    warehouse_id: '', priority: 'normal',
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [assetInfo, setAssetInfo] = useState(null)
  const [lookingUp, setLookingUp] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function lookupAsset() {
    if (!form.asset_serial.trim()) return
    setLookingUp(true)
    const { data } = await supabase.from('assets_live')
      .select('serial_number,asset_description,customer_name,customer_account,warehouse_id,condition_grade')
      .ilike('serial_number', form.asset_serial.trim())
      .limit(1)
    if (data?.[0]) {
      const a = data[0]
      setAssetInfo(a)
      setForm(f => ({
        ...f,
        customer_name: a.customer_name || f.customer_name,
        customer_account: a.customer_account || f.customer_account,
        warehouse_id: a.warehouse_id || f.warehouse_id,
      }))
    } else {
      setAssetInfo(null)
      setMsg({ type: 'error', text: 'Asset serial not found in register' })
      setTimeout(() => setMsg(null), 3000)
    }
    setLookingUp(false)
  }

  async function submit(e) {
    e.preventDefault()
    if (!form.customer_name || !form.fault_type) {
      setMsg({ type: 'error', text: 'Customer name and fault type are required' })
      return
    }
    setSaving(true)
    const caseNum = `CC-${Date.now().toString(36).toUpperCase()}`
    const { error } = await supabase.from('cases').insert({
      case_number: caseNum,
      customer_name: form.customer_name,
      customer_account: form.customer_account,
      asset_serial: form.asset_serial,
      fault_description: `${form.fault_type}: ${form.fault_description}`.trim(),
      contact_name: form.contact_name,
      contact_phone: form.contact_phone,
      warehouse_id: form.warehouse_id,
      priority: form.priority,
      sla_status: 'Open Case In SLA',
      case_status: 'Open',
      created_at: new Date().toISOString(),
    })
    if (error) {
      setMsg({ type: 'error', text: 'Failed to create case: ' + error.message })
    } else {
      setMsg({ type: 'success', text: `✓ Case ${caseNum} created successfully` })
      setTimeout(() => nav('/cases'), 2000)
    }
    setSaving(false)
  }

  return (
    <>
      <Topbar title="New Case" sub="Log a new service or repair case" actions={
        <button className="btn btn-ghost btn-sm" onClick={() => nav('/cases')}>← Back to Cases</button>
      } />
      <div className="page-content" style={{ maxWidth: 720 }}>
        <form onSubmit={submit}>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-header"><span className="card-title">🏭 Asset Information</span></div>
            <div style={{ padding: '16px' }}>
              <div className="form-row" style={{ marginBottom: 12 }}>
                <div>
                  <div className="field-lbl">Asset Serial Number</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="text" className="field-ctrl" placeholder="e.g. CC-12345"
                      value={form.asset_serial} onChange={e => set('asset_serial', e.target.value)}
                      onBlur={lookupAsset}
                    />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={lookupAsset} disabled={lookingUp}>
                      {lookingUp ? <span className="spinner" style={{ width: 13, height: 13 }} /> : '🔍'}
                    </button>
                  </div>
                </div>
                <div>
                  <div className="field-lbl">Warehouse</div>
                  <select className="field-ctrl" value={form.warehouse_id} onChange={e => set('warehouse_id', e.target.value)}>
                    <option value="">Select warehouse</option>
                    {['JHB','CPT','BFN','DBN','EL','GEO','NEL','POL','PE'].map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
                </div>
              </div>
              {assetInfo && (
                <div style={{ background: 'var(--green-bg)', border: '1px solid var(--green)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
                  ✓ Found: <strong>{assetInfo.asset_description}</strong> · Cond. {assetInfo.condition_grade} · {assetInfo.customer_name}
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-header"><span className="card-title">👤 Customer Information</span></div>
            <div style={{ padding: '16px' }}>
              <div className="form-row">
                <div>
                  <div className="field-lbl">Customer Name *</div>
                  <input type="text" className="field-ctrl" placeholder="Customer / outlet name"
                    value={form.customer_name} onChange={e => set('customer_name', e.target.value)} required />
                </div>
                <div>
                  <div className="field-lbl">Account Number</div>
                  <input type="text" className="field-ctrl" placeholder="Account #"
                    value={form.customer_account} onChange={e => set('customer_account', e.target.value)} />
                </div>
              </div>
              <div className="form-row" style={{ marginTop: 12 }}>
                <div>
                  <div className="field-lbl">Contact Name</div>
                  <input type="text" className="field-ctrl" placeholder="On-site contact"
                    value={form.contact_name} onChange={e => set('contact_name', e.target.value)} />
                </div>
                <div>
                  <div className="field-lbl">Contact Phone</div>
                  <input type="tel" className="field-ctrl" placeholder="+27..."
                    value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-header"><span className="card-title">🔧 Fault Details</span></div>
            <div style={{ padding: '16px' }}>
              <div className="form-row" style={{ marginBottom: 12 }}>
                <div>
                  <div className="field-lbl">Fault Type *</div>
                  <select className="field-ctrl" value={form.fault_type} onChange={e => set('fault_type', e.target.value)} required>
                    <option value="">Select fault type…</option>
                    {FAULT_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <div className="field-lbl">Priority</div>
                  <select className="field-ctrl" value={form.priority} onChange={e => set('priority', e.target.value)}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
              <div>
                <div className="field-lbl">Description</div>
                <textarea className="field-ctrl" rows={4} placeholder="Describe the fault in detail…"
                  value={form.fault_description} onChange={e => set('fault_description', e.target.value)} />
              </div>
            </div>
          </div>

          {msg && <div className={`form-msg ${msg.type}`} style={{ marginBottom: 14 }}>{msg.text}</div>}

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex: 1, padding: '10px' }}>
              {saving ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Creating…</> : '✓ Create Case'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => nav('/cases')}>Cancel</button>
          </div>
        </form>
      </div>
    </>
  )
}
