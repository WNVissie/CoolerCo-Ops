import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { num, CATS } from '../lib/helpers'

export default function StockOverview() {
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      // Load all categories in parallel
      const results = await Promise.all(
        CATS.map(c => supabase.from(c.view).select('on_hand,min_stock', { count: 'exact' }))
      )
      const out = {}
      CATS.forEach((c, i) => {
        const rows = results[i].data || []
        out[c.key] = {
          count: results[i].count || rows.length,
          totalOnHand: rows.reduce((s, r) => s + (r.on_hand || 0), 0),
          totalMin: rows.reduce((s, r) => s + (r.min_stock || 0), 0),
          belowMin: rows.filter(r => (r.on_hand || 0) < (r.min_stock || 0)).length,
        }
      })
      setData(out)
      setLoading(false)
    }
    load()
  }, [])

  return (
    <>
      <Topbar
        title="Stock Overview"
        sub="All categories across all warehouses"
        actions={
          <a href="https://smartsparesrtma.netlify.app/" target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
            🔧 Full Spares App ↗
          </a>
        }
      />
      <div className="page-content">
        {loading ? (
          <div className="load-state"><span className="spinner" /> Loading stock data…</div>
        ) : (
          <>
            {/* Summary bar */}
            <div className="stats-row" style={{ marginBottom: 20 }}>
              {CATS.map(c => {
                const d = data[c.key] || {}
                const pct = d.totalMin > 0 ? Math.round((d.totalOnHand / d.totalMin) * 100) : null
                return (
                  <Link key={c.key} to={`/stock/category/${c.key}`} style={{ textDecoration: 'none' }}>
                    <div className={`stat-card${d.belowMin > 0 ? ' c-orange' : ' c-green'}`}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                      onMouseLeave={e => e.currentTarget.style.transform = ''}
                    >
                      <div className="stat-label">{c.icon} {c.label}</div>
                      <div className="stat-value">{num(d.totalOnHand)}</div>
                      <div className="stat-sub">
                        {d.belowMin > 0
                          ? <span style={{ color: 'var(--orange)' }}>⚠ {d.belowMin} SKU{d.belowMin !== 1 ? 's' : ''} below min</span>
                          : <span>✓ {num(d.count)} SKUs in stock</span>
                        }
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>

            {/* Category detail cards */}
            <div className="section-gap">
              {CATS.map(c => {
                const d = data[c.key] || {}
                const pct = d.totalMin > 0 ? Math.min(100, Math.round((d.totalOnHand / d.totalMin) * 100)) : 0
                return (
                  <div key={c.key} className="card">
                    <div className="card-header">
                      <span className="card-title">{c.icon} {c.label}</span>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {d.belowMin > 0 && (
                          <span className="tag tag-orange">⚠ {d.belowMin} below min</span>
                        )}
                        <Link to={`/stock/category/${c.key}`} className="btn btn-ghost btn-sm">Details →</Link>
                      </div>
                    </div>
                    <div style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 600 }}>SKUs</div>
                          <div style={{ fontSize: 18, fontWeight: 700 }}>{num(d.count)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 600 }}>On Hand</div>
                          <div style={{ fontSize: 18, fontWeight: 700 }}>{num(d.totalOnHand)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 600 }}>vs Min</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: pct < 100 ? 'var(--orange)' : 'var(--green)' }}>
                            {pct}%
                          </div>
                        </div>
                      </div>
                      {/* Mini progress bar */}
                      <div style={{ height: 6, background: 'var(--surface3)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.min(100, pct)}%`, height: '100%',
                          background: pct < 80 ? 'var(--orange)' : pct < 50 ? 'var(--red)' : 'var(--green)',
                          borderRadius: 4, transition: 'width .4s'
                        }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </>
  )
}
