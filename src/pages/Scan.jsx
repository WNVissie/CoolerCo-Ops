import { useState, useEffect } from 'react'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { fmt, num } from '../lib/helpers'

export default function Scan() {
  const [serial, setSerial] = useState('')
  const [result, setResult] = useState(null)
  const [recent, setRecent] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    loadRecent()
    loadStats()
  }, [])

  async function loadRecent() {
    const { data } = await supabase.from('coolerco_asset_touch')
      .select('asset_serial,scanned_at,scan_type,location_code,scanned_by')
      .eq('tenant_id', 'tenant_coolerco')
      .order('scanned_at', { ascending: false })
      .limit(15)
    setRecent(data || [])
  }

  async function loadStats() {
    const today = new Date().toISOString().split('T')[0]
    const [todayR, weekR] = await Promise.all([
      supabase.from('coolerco_asset_touch').select('id', { count: 'exact', head: true })
        .eq('tenant_id', 'tenant_coolerco').gte('scanned_at', today),
      supabase.from('coolerco_asset_touch').select('id', { count: 'exact', head: true })
        .eq('tenant_id', 'tenant_coolerco').gte('scanned_at', new Date(Date.now() - 7 * 86400000).toISOString()),
    ])
    setStats({ today: todayR.count, week: weekR.count })
  }

  async function lookupSerial(s) {
    if (!s.trim()) return
    setLoading(true)
    setResult(null)
    const { data } = await supabase.from('assets_live')
      .select('asset_id,serial_number,asset_description,condition_grade,warehouse_id,customer_name,location_code')
      .ilike('serial_number', s.trim())
      .limit(1)
    setResult(data?.[0] || null)
    setLoading(false)
    if (!data?.length) setMsg({ type: 'error', text: `Serial "${s}" not found in asset register` })
  }

  async function logTouch() {
    if (!result) return
    setScanning(true)
    const { error } = await supabase.from('coolerco_asset_touch').insert({
      tenant_id: 'tenant_coolerco',
      asset_serial: result.serial_number,
      scan_type: 'manual',
      location_code: result.location_code,
      scanned_by: 'ops-hub',
      scanned_at: new Date().toISOString(),
    })
    if (error) {
      setMsg({ type: 'error', text: 'Failed to log touch: ' + error.message })
    } else {
      setMsg({ type: 'success', text: `✓ Touch logged for ${result.serial_number}` })
      setSerial('')
      setResult(null)
      loadRecent()
      loadStats()
    }
    setScanning(false)
    setTimeout(() => setMsg(null), 4000)
  }

  return (
    <>
      <Topbar title="Scan / Touch" sub="Log asset touches and look up by serial" />
      <div className="page-content">
        <div className="stats-row" style={{ marginBottom: 18 }}>
          <div className="stat-card c-teal">
            <div className="stat-label">Scans Today</div>
            <div className="stat-value">{num(stats.today)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Scans This Week</div>
            <div className="stat-value">{num(stats.week)}</div>
          </div>
        </div>

        <div className="two-col">
          {/* Lookup + Log */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">📷 Asset Lookup & Touch</span>
            </div>
            <div style={{ padding: '18px' }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input
                  type="text"
                  placeholder="Enter serial number…"
                  value={serial}
                  onChange={e => setSerial(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && lookupSerial(serial)}
                  style={{ flex: 1 }}
                  autoFocus
                />
                <button className="btn btn-primary" onClick={() => lookupSerial(serial)} disabled={loading || !serial.trim()}>
                  {loading ? <span className="spinner" /> : '🔍 Lookup'}
                </button>
              </div>

              {msg && (
                <div className={`form-msg ${msg.type}`} style={{ display: 'block', marginBottom: 14 }}>
                  {msg.text}
                </div>
              )}

              {result ? (
                <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{result.serial_number}</div>
                    <span className={`tag tag-${result.condition_grade === 'A' ? 'green' : result.condition_grade === 'B' ? 'blue' : result.condition_grade === 'C' ? 'orange' : 'red'}`}>
                      Grade {result.condition_grade || '?'}
                    </span>
                  </div>
                  <div className="dl-grid">
                    {[
                      ['Description', result.asset_description],
                      ['Warehouse', result.warehouse_id],
                      ['Customer', result.customer_name],
                      ['Location', result.location_code],
                    ].map(([l, v]) => (
                      <div key={l} className="dl-field">
                        <div className="lbl">{l}</div>
                        <div className="val">{v || '—'}</div>
                      </div>
                    ))}
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%', marginTop: 16, padding: '9px' }}
                    onClick={logTouch}
                    disabled={scanning}
                  >
                    {scanning ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Logging…</> : '✓ Log Touch'}
                  </button>
                </div>
              ) : (
                <div className="empty-state" style={{ padding: '28px 0' }}>
                  <div className="empty-ico">📷</div>
                  <div>Enter a serial number to look up an asset</div>
                  <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text4)' }}>Press Enter or click Lookup</div>
                </div>
              )}
            </div>
          </div>

          {/* Recent Scans */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">🕐 Recent Scans</span>
              <span className="card-count">{recent.length} shown</span>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>Serial</th><th>Type</th><th>Location</th><th>When</th></tr>
                </thead>
                <tbody>
                  {recent.map((r, i) => (
                    <tr key={i}>
                      <td className="mono" style={{ fontSize: 11 }}>{r.asset_serial}</td>
                      <td>{r.scan_type || '—'}</td>
                      <td>{r.location_code || '—'}</td>
                      <td className="text3">{fmt(r.scanned_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
