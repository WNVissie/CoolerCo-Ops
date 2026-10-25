import { useState, useEffect, useCallback } from 'react'
import Topbar from '../components/Topbar'
import DataTable from '../components/DataTable'
import Drawer from '../components/Drawer'
import { sbFetch, supabase } from '../lib/supabase'
import { fmt, num, slaColor, slaLabel, PS } from '../lib/helpers'

const SLA_OPTS = [
  '', 'Open Case SLA Not Met', 'Open Case SLA Not Met Ongoing',
  'Open Case In SLA', 'SLA Met', 'Cancelled - Customer',
]

export default function Cases() {
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [sla, setSla] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 380)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { setPage(0) }, [debouncedSearch, sla])

  const load = useCallback(async () => {
    setLoading(true)
    const params = {
      select: 'case_number,customer_name,asset_serial,sla_status,case_status,created_at,closed_at,technician_name,warehouse_id,fault_description',
      order: 'created_at',
      asc: false,
      limit: PS,
      offset: page * PS,
    }
    if (debouncedSearch) params.ilike = { case_number: `%${debouncedSearch}%` }
    if (sla) params.eq = { sla_status: sla }

    const { data, count, error } = await sbFetch('cases', params)
    if (!error) { setRows(data); setCount(count) }
    setLoading(false)
  }, [page, debouncedSearch, sla])

  useEffect(() => { load() }, [load])

  const COLS = [
    {
      key: 'case_number', label: 'Case #', cls: 'mono',
      render: v => <strong style={{ fontSize: 11.5 }}>{v}</strong>
    },
    { key: 'customer_name', label: 'Customer', render: v => <span className="trunc" style={{ maxWidth: 160, display: 'block' }}>{v || '—'}</span> },
    { key: 'asset_serial', label: 'Asset Serial', cls: 'mono', render: v => <span style={{ fontSize: 11 }}>{v || '—'}</span> },
    {
      key: 'sla_status', label: 'SLA Status',
      render: v => <span className={`tag tag-${slaColor(v)}`}>{slaLabel(v)}</span>
    },
    { key: 'technician_name', label: 'Technician' },
    { key: 'created_at', label: 'Opened', render: v => <span className="text3">{fmt(v)}</span> },
    { key: 'closed_at', label: 'Closed', render: v => <span className="text3">{fmt(v)}</span> },
  ]

  return (
    <>
      <Topbar
        title="Cases"
        sub="Service & repair cases"
        actions={
          <a href="/newcase" className="btn btn-primary btn-sm">➕ New Case</a>
        }
      />
      <div className="page-content">
        <div className="filters">
          <div className="search-wrap">
            <span className="ico">🔍</span>
            <input
              type="text"
              placeholder="Search case number, customer…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select value={sla} onChange={e => setSla(e.target.value)}>
            <option value="">All SLA statuses</option>
            {SLA_OPTS.filter(Boolean).map(s => (
              <option key={s} value={s}>{slaLabel(s)}</option>
            ))}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setSla(''); setPage(0) }}>Clear</button>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">🔧 Cases</span>
            <span className="card-count">{num(count)} results</span>
          </div>
          <DataTable
            cols={COLS}
            rows={rows}
            count={count}
            page={page}
            setPage={setPage}
            onRowClick={setSelected}
            loading={loading}
          />
        </div>
      </div>

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.case_number || 'Case Detail'} icon="🔧">
        {selected && (
          <div className="form-grid">
            <div className="dl-grid">
              {[
                ['Case Number', selected.case_number],
                ['Customer', selected.customer_name],
                ['Asset Serial', selected.asset_serial],
                ['SLA Status', null],
                ['Case Status', selected.case_status],
                ['Technician', selected.technician_name],
                ['Warehouse', selected.warehouse_id],
                ['Opened', fmt(selected.created_at)],
                ['Closed', fmt(selected.closed_at)],
              ].map(([lbl, val]) => (
                <div key={lbl} className="dl-field">
                  <div className="lbl">{lbl}</div>
                  {lbl === 'SLA Status'
                    ? <span className={`tag tag-${slaColor(selected.sla_status)}`}>{slaLabel(selected.sla_status)}</span>
                    : <div className="val">{val || '—'}</div>
                  }
                </div>
              ))}
            </div>
            {selected.fault_description && (
              <div className="mt-16">
                <div className="field-lbl">Fault Description</div>
                <div style={{ background: 'var(--surface2)', borderRadius: 7, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.6, border: '1px solid var(--border)' }}>
                  {selected.fault_description}
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </>
  )
}
