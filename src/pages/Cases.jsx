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
      // All column names exactly as they exist in the cases table
      select: 'case_number,case_type,responsible_ordering_party,point_of_sale,pos_local_code,mapped_asset,sla_status,status,status_reason,created_on,service_closure_date,technician_routed_to,warehouse_workshop,motive,sla_days_late,priority,begin_date,end_date,asset_condition,asset_type,origin,reason,contractor,case_contact_name,case_contact_number',
      order: 'created_on',
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
    // point_of_sale is the outlet/POS name — the closest to "customer location"
    { key: 'point_of_sale', label: 'Point of Sale', render: v => <span className="trunc" style={{ maxWidth: 160, display: 'block' }}>{v || '—'}</span> },
    // responsible_ordering_party is the Concessionaire (asset owner/funder)
    { key: 'responsible_ordering_party', label: 'Concessionaire', render: v => <span className="trunc" style={{ maxWidth: 130, display: 'block' }}>{v || '—'}</span> },
    // mapped_asset is the asset name on the case (e.g. "CoolerCo 300L")
    { key: 'mapped_asset', label: 'Asset', cls: 'mono', render: v => <span style={{ fontSize: 11 }}>{v || '—'}</span> },
    {
      key: 'sla_status', label: 'SLA Status',
      render: v => <span className={`tag tag-${slaColor(v)}`}>{slaLabel(v)}</span>
    },
    { key: 'technician_routed_to', label: 'Technician', render: v => <span className="trunc" style={{ maxWidth: 120, display: 'block' }}>{v || '—'}</span> },
    { key: 'created_on', label: 'Opened', render: v => <span className="text3">{fmt(v)}</span> },
    { key: 'service_closure_date', label: 'Closed', render: v => <span className="text3">{fmt(v)}</span> },
  ]

  return (
    <>
      <Topbar
        title="Cases"
        sub="Service &amp; repair cases"
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
              placeholder="Search case number…"
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
                ['Case Type', selected.case_type],
                ['Point of Sale', selected.point_of_sale],
                ['POS Local Code', selected.pos_local_code],
                ['Concessionaire', selected.responsible_ordering_party],
                ['Asset', selected.mapped_asset],
                ['Asset Type', selected.asset_type],
                ['Asset Condition', selected.asset_condition],
                ['Priority', selected.priority],
                ['SLA Status', null],
                ['Case Status', selected.status],
                ['Status Reason', selected.status_reason],
                ['Technician', selected.technician_routed_to],
                ['Workshop', selected.warehouse_workshop],
                ['Contractor', selected.contractor],
                ['SLA Days Late', selected.sla_days_late != null ? `${selected.sla_days_late} days` : '—'],
                ['Begin Date', fmt(selected.begin_date)],
                ['End Date', fmt(selected.end_date)],
                ['Opened', fmt(selected.created_on)],
                ['Closed', fmt(selected.service_closure_date)],
                ['Contact', selected.case_contact_name],
                ['Contact Number', selected.case_contact_number],
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
            {selected.motive && (
              <div className="mt-16">
                <div className="field-lbl">Motive</div>
                <div style={{ background: 'var(--surface2)', borderRadius: 7, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.6, border: '1px solid var(--border)' }}>
                  {selected.motive}
                </div>
              </div>
            )}
            {selected.origin && (
              <div className="mt-16">
                <div className="field-lbl">Origin / Reason</div>
                <div style={{ background: 'var(--surface2)', borderRadius: 7, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.6, border: '1px solid var(--border)' }}>
                  {[selected.origin, selected.reason].filter(Boolean).join(' — ')}
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </>
  )
}
