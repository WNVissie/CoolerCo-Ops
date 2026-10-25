import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { num, BAYS, WAREHOUSES, WH_NAMES, condColor, SPARES_APP_URL } from '../lib/helpers'

// One small call: the server adds everything up (public.coolerco_wh_asset_stock)
// and sends back ~a few hundred summary rows instead of ~9,000 asset rows.
export default function AssetStock() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [loc, setLoc] = useState('all') // all | Warehouse | Workshop

  useEffect(() => {
    supabase.from('coolerco_wh_asset_stock').select('*').then(({ data, error }) => {
      if (error) setErr(error); else setRows(data || [])
    })
  }, [])

  const filtered = useMemo(() => (rows || []).filter(r => loc === 'all' || r.location_type === loc), [rows, loc])

  const sum = (list, pred = () => true) => list.reduce((t, r) => t + (pred(r) ? r.assets : 0), 0)
  const national = useMemo(() => Object.fromEntries(BAYS.map(b => [b.key, sum(filtered, r => r.bay === b.key)])), [filtered])
  const total = sum(filtered)

  const byWh = useMemo(() => WAREHOUSES.map(code => {
    const list = filtered.filter(r => r.warehouse_code === code)
    const bays = Object.fromEntries(BAYS.map(b => [b.key, sum(list, r => r.bay === b.key)]))
    const group = key => {
      const m = {}
      list.forEach(r => { const k = r[key] || 'Unknown'; m[k] = (m[k] || 0) + r.assets })
      return Object.entries(m).sort((a, b) => b[1] - a[1])
    }
    return { code, name: WH_NAMES[code], total: sum(list), workshop: sum(list, r => r.location_type === 'Workshop'), bays, cond: group('condition'), types: group('asset_type'), statuses: group('asset_status') }
  }).sort((a, b) => b.total - a.total), [filtered])

  const missingView = err && /coolerco_wh_asset_stock|does not exist|schema cache/i.test(err.message || '')

  return (
    <>
      <Topbar
        title="Asset Stock"
        sub="Coolers physically in RTMA warehouses & workshops · grouped by bay"
        actions={<a href={SPARES_APP_URL} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">🔧 Spares stock ↗</a>}
      />
      <div className="page-content">
        {err && (
          <div className="notice warn">
            {missingView
              ? '⏳ The stock summary view has not been installed on the database yet. It will appear here once the read-only script is applied.'
              : `Could not load stock: ${err.message}`}
          </div>
        )}
        {!rows && !err && <div className="load-state"><span className="spinner" /> Loading stock…</div>}

        {rows && (
          <>
            <div className="filters">
              <div className="seg">
                {[['all', '🏢 Warehouse + Workshop'], ['Warehouse', '🏭 Warehouse'], ['Workshop', '🛠️ Workshop']].map(([k, l]) => (
                  <button key={k} className={`seg-btn${loc === k ? ' on' : ''}`} onClick={() => setLoc(k)}>{l}</button>
                ))}
              </div>
              <span className="text3" style={{ fontSize: 11 }}>DDS, other suppliers and assets at POS are not counted — search an asset to find them.</span>
            </div>

            <div className="stats-row">
              <div className="stat-card c-accent"><div className="stat-label">📦 In CoolerCo stock</div><div className="stat-value">{num(total)}</div><div className="stat-sub">unique assets</div></div>
              {BAYS.filter(b => ['GREEN', 'YELLOW', 'ORANGE', 'RED'].includes(b.key)).map(b => (
                <Link key={b.key} to={`/assets?bay=${b.key}`} className={`stat-card bay-${b.key.toLowerCase()}`} style={{ textDecoration: 'none' }}>
                  <div className="stat-label">{b.icon} {b.label}</div>
                  <div className="stat-value">{num(national[b.key])}</div>
                  <div className="stat-sub">{total ? Math.round((national[b.key] / total) * 100) : 0}% · {b.desc}</div>
                </Link>
              ))}
            </div>

            <div className="wh-grid">
              {byWh.map(w => (
                <details key={w.code} className="card wh-card">
                  <summary className="wh-card-hd">
                    <div style={{ minWidth: 0 }}>
                      <div className="card-title">🏢 {w.name} <span className="text3" style={{ fontWeight: 400 }}>· {w.code}</span></div>
                      <div className="text3" style={{ fontSize: 10.5 }}>{num(w.total)} assets{w.workshop ? ` · ${num(w.workshop)} in workshop` : ''}</div>
                    </div>
                    <span className="wh-total">{num(w.bays.GREEN)}<small>available</small></span>
                  </summary>
                  <div className="bay-bar" title="Share by bay">
                    {BAYS.map(b => w.bays[b.key] ? <span key={b.key} className={`bay-seg bay-${b.key.toLowerCase()}`} style={{ flex: w.bays[b.key] }} title={`${b.label}: ${w.bays[b.key]}`} /> : null)}
                  </div>
                  <div className="wh-card-body">
                    <div className="bay-tiles">
                      {BAYS.filter(b => w.bays[b.key]).map(b => (
                        <Link key={b.key} to={`/assets?wh=${w.code}&bay=${b.key}`} className={`bay-tile bay-${b.key.toLowerCase()}`}>
                          <span>{b.icon} {b.label}</span><strong>{num(w.bays[b.key])}</strong>
                        </Link>
                      ))}
                    </div>
                    <div className="mini-cols">
                      <div>
                        <div className="lbl">Condition</div>
                        {w.cond.map(([k, n]) => <div key={k} className="mini-row"><span className={`tag tag-${condColor(k)}`}>{k}</span><span>{num(n)}</span></div>)}
                      </div>
                      <div>
                        <div className="lbl">Asset type</div>
                        {w.types.map(([k, n]) => <div key={k} className="mini-row"><span>{k}</span><span>{num(n)}</span></div>)}
                        <div className="lbl" style={{ marginTop: 8 }}>COM status</div>
                        {w.statuses.map(([k, n]) => <div key={k} className="mini-row"><span>{k}</span><span>{num(n)}</span></div>)}
                      </div>
                    </div>
                    <Link to={`/assets?wh=${w.code}`} className="btn btn-ghost btn-sm">View {w.name} assets →</Link>
                  </div>
                </details>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  )
}
