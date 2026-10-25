import { useState, useEffect, useCallback } from 'react'
import Topbar from '../components/Topbar'
import DataTable from '../components/DataTable'
import Drawer from '../components/Drawer'
import { sbFetch, supabase } from '../lib/supabase'
import { fmt, num, slaColor, slaLabel, PS } from '../lib/helpers'

export default function CustomerPortal() {
  const [customers, setCustomers] = useState([])
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [custCases, setCustCases] = useState([])
  const [custAssets, setCustAssets] = useState([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('cases')
  const [summary, setSummary] = useState({})

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 380)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (debouncedSearch.length >= 2) searchCustomers()
    else setCustomers([])
  }, [debouncedSearch])

  async function searchCustomers() {
    setLoading(true)
    // Aggregate from cases — distinct customers
    const { data } = await supabase.from('cases')
      .select('customer_name,customer_account')
      .ilike('customer_name', `%${debouncedSearch}%`)
      .limit(30)
    // Deduplicate
    const seen = new Set()
    const unique = (data || []).filter(r => {
      if (!r.customer_name) return false
      const key = r.customer_name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key); return true
    })
    setCustomers(unique)
    setLoading(false)
  }

  async function openCustomer(c) {
    setSelected(c)
    setTab('cases')
    const [casesR, assetsR] = await Promise.all([
      supabase.from('cases')
        .select('case_number,sla_status,case_status,created_at,closed_at,asset_serial,fault_description')
        .ilike('customer_name', c.customer_name)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('assets_live')
        .select('serial_number,asset_description,condition_grade,warehouse_id,location_code')
        .ilike('customer_name', c.customer_name)
        .limit(50),
    ])
    const cases = casesR.data || []
    const assets = assetsR.data || []
    setCustCases(cases)
    setCustAssets(assets)
    setSummary({
      totalCases: cases.length,
      openCases: cases.filter(c => c.case_status === 'Open').length,
      slaMet: cases.filter(c => c.sla_status === 'SLA Met').length,
      totalAssets: assets.length,
    })
  }

  const CASE_COLS = [
    { key: 'case_number', label: 'Case #', cls: 'mono', render: v => <strong style={{ fontSize: 11 }}>{v}</strong> },
    { key: 'sla_status', label: 'SLA', render: v => <span className={`tag tag-${slaColor(v)}`}>{slaLabel(v)}</span> },
    { key: 'case_status', label: 'Status' },
    { key: 'asset_serial', label: 'Asset', cls: 'mono', render: v => <span style={{ fontSize: 11 }}>{v || '—'}</span> },
    { key: 'created_at', label: 'Date', render: v => <span className="text3">{fmt(v)}</span> },
  ]

  const ASSET_COLS = [
    { key: 'serial_number', label: 'Serial', cls: 'mono', render: v => <strong style={{ fontSize: 11 }}>{v}</strong> },
    { key: 'asset_description', label: 'Description' },
    { key: 'condition_grade', label: 'Cond.', render: v => v ? <span className={`tag tag-${v === 'A' ? 'green' : v === 'B' ? 'blue' : v === 'C' ? 'orange' : 'red'}`}>{v}</span> : '—' },
    { key: 'warehouse_id', label: 'WH' },
    { key: 'location_code', label: 'Location' },
  ]

  return (
    <>
      <Topbar title="Customer Portal" sub="View customer cases and assets" />
      <div className="page-content">
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ padding: '16px' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>🔍 Search Customer</div>
            <div className="search-wrap">
              <span className="ico">👤</span>
              <input
                type="text"
                placeholder="Type customer name (min 2 chars)…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          {loading && <div className="load-state" style={{ padding: 20 }}><span className="spinner" /></div>}

          {customers.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)' }}>
              {customers.map((c, i) => (
                <div key={i}
                  onClick={() => openCustomer(c)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                    transition: 'background .12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{c.customer_name}</div>
                    {c.customer_account && <div style={{ fontSize: 11, color: 'var(--text3)' }}>Account: {c.customer_account}</div>}
                  </div>
                  <span style={{ color: 'var(--text3)', fontSize: 12 }}>View →</span>
                </div>
              ))}
            </div>
          )}

          {debouncedSearch.length >= 2 && !loading && customers.length === 0 && (
            <div className="empty-state" style={{ padding: 20 }}>No customers found for "{debouncedSearch}"</div>
          )}
        </div>
      </div>

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.customer_name} icon="👤">
        {selected && (
          <>
            {/* Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              {[
                ['Cases', summary.totalCases, 'accent'],
                ['Open', summary.openCases, summary.openCases > 0 ? 'orange' : 'green'],
                ['SLA Met', summary.slaMet, 'green'],
                ['Assets', summary.totalAssets, 'teal'],
              ].map(([l, v, c]) => (
                <div key={l} className={`stat-card c-${c}`} style={{ padding: '12px 14px' }}>
                  <div className="stat-label">{l}</div>
                  <div className="stat-value" style={{ fontSize: 20 }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="cat-tabs" style={{ marginBottom: 14 }}>
              <div className={`cat-tab${tab === 'cases' ? ' active' : ''}`} onClick={() => setTab('cases')}>
                🔧 Cases ({custCases.length})
              </div>
              <div className={`cat-tab${tab === 'assets' ? ' active' : ''}`} onClick={() => setTab('assets')}>
                🏭 Assets ({custAssets.length})
              </div>
            </div>

            {tab === 'cases' && (
              <table className="tbl" style={{ fontSize: 11.5 }}>
                <thead>
                  <tr>{CASE_COLS.map(c => <th key={c.key}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {custCases.map((r, i) => (
                    <tr key={i}>
                      {CASE_COLS.map(c => <td key={c.key}>{c.render ? c.render(r[c.key], r) : (r[c.key] ?? '—')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'assets' && (
              <table className="tbl" style={{ fontSize: 11.5 }}>
                <thead>
                  <tr>{ASSET_COLS.map(c => <th key={c.key}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {custAssets.map((r, i) => (
                    <tr key={i}>
                      {ASSET_COLS.map(c => <td key={c.key}>{c.render ? c.render(r[c.key], r) : (r[c.key] ?? '—')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Drawer>
    </>
  )
}
