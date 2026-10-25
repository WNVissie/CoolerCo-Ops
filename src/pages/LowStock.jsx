import { useState, useEffect } from 'react'
import Topbar from '../components/Topbar'
import { supabase } from '../lib/supabase'
import { num, CATS, WAREHOUSES, WH_NAMES } from '../lib/helpers'

export default function LowStock() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [catFilter, setCatFilter] = useState('')
  const [whFilter, setWhFilter] = useState('')

  useEffect(() => {
    async function load() {
      // Load all categories, filter server-side for below min
      const results = await Promise.all(
        CATS.map(c =>
          supabase.from(c.view)
            .select('item_code,item_description,warehouse_id,on_hand,min_stock')
            .lt('on_hand', supabase.raw ? 'min_stock' : 999999) // fallback
            .limit(500)
        )
      )
      // Actually filter client-side since we can't use column comparison easily
      const all = []
      CATS.forEach((c, i) => {
        const rows = results[i].data || []
        rows.filter(r => r.min_stock > 0 && (r.on_hand || 0) < r.min_stock).forEach(r => {
          all.push({ ...r, cat: c.key, catLabel: c.label, catIcon: c.icon })
        })
      })
      // Sort by deficit (worst first)
      all.sort((a, b) => (a.on_hand - a.min_stock) - (b.on_hand - b.min_stock))
      setItems(all)
      setLoading(false)
    }
    load()
  }, [])

  const filtered = items.filter(i =>
    (catFilter ? i.cat === catFilter : true) &&
    (whFilter ? i.warehouse_id === whFilter : true)
  )

  return (
    <>
      <Topbar title="Low Stock Alert" sub="Items below minimum stock level" />
      <div className="page-content">
        {loading ? (
          <div className="load-state"><span className="spinner" /> Checking stock levels…</div>
        ) : (
          <>
            <div className="stats-row" style={{ marginBottom: 16 }}>
              <div className="stat-card c-red">
                <div className="stat-label">Total Low Stock SKUs</div>
                <div className="stat-value">{num(items.length)}</div>
              </div>
              {CATS.map(c => {
                const n = items.filter(i => i.cat === c.key).length
                return n > 0 ? (
                  <div key={c.key} className="stat-card c-orange">
                    <div className="stat-label">{c.icon} {c.label}</div>
                    <div className="stat-value">{n}</div>
                    <div className="stat-sub">below min</div>
                  </div>
                ) : null
              })}
            </div>

            <div className="filters">
              <select value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                <option value="">All categories</option>
                {CATS.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
              </select>
              <select value={whFilter} onChange={e => setWhFilter(e.target.value)}>
                <option value="">All warehouses</option>
                {WAREHOUSES.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text3)' }}>{filtered.length} items</span>
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">⚠️ Low Stock Items</span>
                <span className="card-count">{filtered.length} items</span>
              </div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Code</th>
                      <th>Description</th>
                      <th>WH</th>
                      <th>On Hand</th>
                      <th>Min</th>
                      <th>Deficit</th>
                      <th>Level</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 200).map((item, i) => {
                      const deficit = item.min_stock - (item.on_hand || 0)
                      const pct = Math.round(((item.on_hand || 0) / item.min_stock) * 100)
                      return (
                        <tr key={i}>
                          <td><span style={{ fontSize: 13 }}>{item.catIcon}</span> {item.catLabel}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{item.item_code || '—'}</td>
                          <td><span className="trunc" style={{ maxWidth: 200, display: 'block' }}>{item.item_description || '—'}</span></td>
                          <td>{item.warehouse_id}</td>
                          <td><strong style={{ color: 'var(--red)' }}>{num(item.on_hand)}</strong></td>
                          <td>{num(item.min_stock)}</td>
                          <td><span className="tag tag-red">-{num(deficit)}</span></td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: 60, height: 5, background: 'var(--surface3)', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: pct < 50 ? 'var(--red)' : 'var(--orange)', borderRadius: 3 }} />
                              </div>
                              <span style={{ fontSize: 10.5, color: 'var(--text3)' }}>{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {filtered.length > 200 && (
                <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text3)', borderTop: '1px solid var(--border)' }}>
                  Showing first 200 of {filtered.length} items. Use filters to narrow results.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
