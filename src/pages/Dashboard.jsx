import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { fmt, num, OPEN_REASONS, statusColor, CASE_TYPE_ICON } from '../lib/helpers'

function KPI({ label, value, sub, color = '' }) {
  return (
    <div className={`stat-card${color ? ` c-${color}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export default function Dashboard() {
  const [kpi, setKpi] = useState({})
  const [recentCases, setRecentCases] = useState([])
  const [routes, setRoutes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      // All loads fire together (parallel) — the page waits for the slowest one only
      const [stock, openCases, overdue, routes, scans, pickQueue, rc, caseAsset] = await Promise.all([
        supabase.from('coolerco_wh_asset_stock').select('bay,assets'),
        supabase.from('cases').select('case_number', { count: 'exact', head: true }).in('status_reason', OPEN_REASONS),
        supabase.from('cases').select('case_number', { count: 'exact', head: true }).eq('sla_status', 'Open Case SLA Not Met'),
        supabase.from('routing_routes').select('id,route_number,warehouse_group,status,created_at').order('created_at', { ascending: false }).limit(5),
        supabase.from('coolerco_asset_touch').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 86400000).toISOString()),
        supabase.rpc('coolerco_picking_queue', { p_from: new Date().toISOString().slice(0, 10), p_warehouse: null }),
        supabase.from('cases').select('case_number,case_type,point_of_sale,warehouse_workshop,status_reason,created_on')
          .in('status_reason', OPEN_REASONS).order('created_on', { ascending: false }).limit(8),
        supabase.rpc('coolerco_open_case_asset_exceptions', { p_since: '2026-07-01', p_warehouse: null }),
      ])
      const st = stock.data || []
      setKpi({
        stock: stock.error ? null : st.reduce((t, r) => t + r.assets, 0),
        available: stock.error ? null : st.filter(r => r.bay === 'GREEN').reduce((t, r) => t + r.assets, 0),
        openCases: openCases.count,
        overdue: overdue.count,
        scans: scans.count,
        pickPending: (pickQueue.data || []).filter(l => !l.packed).length,
        caseAsset: caseAsset.error ? null : (caseAsset.data || []).length,
        caseAssetSure: caseAsset.error ? null : (caseAsset.data || []).filter(r => r.kind !== 'possible').length,
      })
      setRoutes(routes.data || [])
      setRecentCases(rc.data || [])
      setLoading(false)
    }
    load()
  }, [])


  return (
    <>
      <Topbar title="Dashboard" sub={`Live overview · ${new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}`} />
      <div className="page-content">
        {loading ? (
          <div className="load-state"><span className="spinner" /> Loading data…</div>
        ) : (
          <>
            <div className="stats-row">
              <KPI label="🧊 CoolerCo stock" value={num(kpi.stock)} sub="RTMA WH + workshop" color="accent" />
              <KPI label="🟢 Ready to Work" value={num(kpi.available)} sub="available" color="green" />
              <KPI label="📂 Open Cases" value={num(kpi.openCases)} sub="incl. On Hold" color="orange" />
              <KPI label="⏰ Overdue" value={num(kpi.overdue)} sub="open, past end date" color="red" />
              <KPI label="Scans Today" value={num(kpi.scans)} sub="asset touches" color="teal" />
              <KPI label="📦 To load" value={num(kpi.pickPending)} sub="today onwards, not packed" color={kpi.pickPending > 20 ? 'orange' : 'green'} />
              {kpi.caseAsset != null && <Link to="/cases/asset-at-pos" style={{ textDecoration: 'none', color: 'inherit' }}>
                <KPI label="⚠️ Open case · asset at POS" value={num(kpi.caseAsset)} sub={`${num(kpi.caseAssetSure)} sure · ${num(kpi.caseAsset - kpi.caseAssetSure)} possible ›`} color={kpi.caseAssetSure ? 'red' : 'orange'} />
              </Link>}
            </div>

            <div className="two-col">
              {/* Recent Cases */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">📂 Latest open cases</span>
                  <Link to="/cases" className="btn btn-ghost btn-sm">View all →</Link>
                </div>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Case #</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentCases.map(c => (
                        <tr key={c.case_number}>
                          <td className="mono" style={{ fontSize: 11 }}>{c.case_number}</td>
                          <td className="trunc" style={{ maxWidth: 150 }} title={c.point_of_sale}>{CASE_TYPE_ICON[c.case_type] || '•'} {c.case_type}</td>
                          <td><span className={`tag tag-${statusColor(c.status_reason)}`}>{c.status_reason}</span></td>
                          <td className="text3">{fmt(c.created_on)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Recent Routes */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">🗺️ Recent Routes</span>
                  <Link to="/routes" className="btn btn-ghost btn-sm">View all →</Link>
                </div>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Route</th>
                        <th>WH</th>
                        <th>Status</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {routes.length === 0 ? (
                        <tr><td colSpan={4} className="text3" style={{ textAlign: 'center', padding: 24 }}>No routes found</td></tr>
                      ) : routes.map(r => (
                        <tr key={r.id}>
                          <td className="trunc" style={{ maxWidth: 140 }}>{r.route_number || `Route ${r.id}`}</td>
                          <td>{r.warehouse_group}</td>
                          <td>
                            <span className={`tag tag-${r.status === 'completed' ? 'green' : r.status === 'dispatched' ? 'orange' : 'neutral'}`}>
                              {r.status}
                            </span>
                          </td>
                          <td className="text3">{fmt(r.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Quick Links */}
            <div className="mt-16" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
              {[
                { to: '/assets', icon: '🏭', label: 'Assets', sub: 'Find any asset' },
                { to: '/stock', icon: '🧊', label: 'Asset Stock', sub: 'By bay' },
                { to: '/picking', icon: '📦', label: 'Picking', sub: `${num(kpi.pickPending)} pending` },
                { to: '/scan', icon: '📷', label: 'Scan', sub: 'Log a touch' },
                { to: '/wms/receiving', icon: '📥', label: 'Receiving', sub: 'WMS' },
                { to: '/portal', icon: '👤', label: 'Customers', sub: 'Portal' },
              ].map(l => (
                <Link key={l.to} to={l.to} style={{ textDecoration: 'none' }}>
                  <div className="card" style={{ padding: '14px', cursor: 'pointer', transition: 'border-color .15s' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  >
                    <div style={{ fontSize: 22, marginBottom: 6 }}>{l.icon}</div>
                    <div style={{ fontWeight: 600, fontSize: 12.5 }}>{l.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{l.sub}</div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}
