import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { fmt, num } from '../lib/helpers'

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
      const [assets, cases, openCases, routes, scans, pickQueue] = await Promise.all([
        supabase.from('assets_live').select('id', { count: 'exact', head: true }),
        supabase.from('cases').select('case_number', { count: 'exact', head: true }),
        supabase.from('cases').select('case_number', { count: 'exact', head: true }).in('sla_status', ['Open Case SLA Not Met', 'Open Case SLA Not Met Ongoing', 'Open Case In SLA']),
        supabase.from('routing_routes').select('id,route_number,warehouse_group,status,created_at').order('created_at', { ascending: false }).limit(5),
        supabase.from('coolerco_asset_touch').select('id', { count: 'exact', head: true }).eq('tenant_id', 'tenant_coolerco').gte('created_at', new Date(Date.now() - 86400000).toISOString()),
        supabase.from('routing_warehouse_preparation').select('case_number', { count: 'exact', head: true }).eq('picked', false),
      ])
      setKpi({
        assets: assets.count,
        cases: cases.count,
        openCases: openCases.count,
        scans: scans.count,
        pickPending: pickQueue.count,
      })
      setRoutes(routes.data || [])

      const { data: rc } = await supabase.from('cases')
        .select('case_number,responsible_ordering_party,mapped_asset,sla_status,created_on,status')
        .order('created_on', { ascending: false })
        .limit(8)
      setRecentCases(rc || [])
      setLoading(false)
    }
    load()
  }, [])

  const statusColor = s => {
    if (!s) return ''
    if (s.includes('Not Met')) return 'red'
    if (s.includes('In SLA')) return 'green'
    if (s.includes('Met')) return 'green'
    return 'neutral'
  }

  return (
    <>
      <Topbar title="Dashboard" sub={`Live overview · ${new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}`} />
      <div className="page-content">
        {loading ? (
          <div className="load-state"><span className="spinner" /> Loading data…</div>
        ) : (
          <>
            <div className="stats-row">
              <KPI label="Total Assets" value={num(kpi.assets)} sub="from COM" color="accent" />
              <KPI label="Total Cases" value={num(kpi.cases)} sub="all time" />
              <KPI label="Open Cases" value={num(kpi.openCases)} sub="active" color={kpi.openCases > 100 ? 'red' : 'orange'} />
              <KPI label="Scans Today" value={num(kpi.scans)} sub="asset touches" color="teal" />
              <KPI label="Pick Pending" value={num(kpi.pickPending)} sub="items" color={kpi.pickPending > 20 ? 'orange' : 'green'} />
            </div>

            <div className="two-col">
              {/* Recent Cases */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">🔧 Recent Cases</span>
                  <Link to="/cases" className="btn btn-ghost btn-sm">View all →</Link>
                </div>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Case #</th>
                        <th>Customer</th>
                        <th>Status</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentCases.map(c => (
                        <tr key={c.case_number}>
                          <td className="mono" style={{ fontSize: 11 }}>{c.case_number}</td>
                          <td className="trunc" style={{ maxWidth: 140 }}>{c.responsible_ordering_party || '—'}</td>
                          <td>
                            <span className={`tag tag-${statusColor(c.sla_status)}`}>
                              {c.status || '—'}
                            </span>
                          </td>
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
                { to: '/assets', icon: '🏭', label: 'Assets', sub: `${num(kpi.assets)} total` },
                { to: '/stock', icon: '🏬', label: 'Stock', sub: 'Overview' },
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
