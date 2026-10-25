import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Topbar from '../components/Topbar'
import DataTable from '../components/DataTable'
import Drawer from '../components/Drawer'
import { supabase } from '../lib/supabase'
import { searchCases } from '../lib/caseSearch'
import {
  fmt, num, PS, condColor, CONDITIONS, WAREHOUSES, WH_NAMES, whAssetAccounts,
  BAYS, BAY_STATUSES, bayForStatus, caseAssets, statusColor, CASE_TYPE_ICON,
} from '../lib/helpers'

const ALL_RTMA_ACCOUNTS = WAREHOUSES.flatMap(whAssetAccounts)
const COLS_SELECT = 'id,name,bar_code,local_code,asset_type,condition,asset_location,assign_account,responsible_ordering_party,pos_local_code,points_of_sale,product_base,brand_hierarchy,asset_status,last_touch_date,date_of_last_movement,elapsed_in_wh_days,related_case,imported_at'

// Where is this asset? Plain-language answer used in the table and drawer
export function whereIs(a) {
  if (!a) return { icon: '❔', text: 'Unknown', rtma: false }
  const acc = a.assign_account || ''
  const rtma = /^RTMA .+ (WH|WS)$/.test(acc) && ['Warehouse', 'Workshop'].includes(a.asset_location)
  if (rtma) return { icon: a.asset_location === 'Workshop' ? '🛠️' : '🏭', text: acc.replace(/^RTMA /, '').replace(/ WH$/, ' warehouse').replace(/ WS$/, ' workshop'), rtma }
  if (a.asset_location === 'Location') return { icon: '🏪', text: `At POS · ${a.points_of_sale || acc || '—'}`, rtma }
  if (/^DDS/i.test(acc)) return { icon: '🚫', text: `${acc} (previous supplier)`, rtma }
  return { icon: '📍', text: `${a.asset_location || ''} · ${acc || '—'}`, rtma }
}

export default function Assets() {
  const [params] = useSearchParams()
  const autoOpened = useRef(false)
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState(params.get('q') || '')
  const [debounced, setDebounced] = useState(params.get('q') || '')
  const [wh, setWh] = useState(params.get('wh') || '')
  const [bay, setBay] = useState(params.get('bay') || '')
  const [condition, setCondition] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 380); return () => clearTimeout(t) }, [search])
  useEffect(() => { setPage(0) }, [debounced, wh, bay, condition])

  const searching = debounced.length > 0

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('assets_live').select(COLS_SELECT, { count: 'exact' })
    if (searching) {
      // A search looks at ALL assets (POS, DDS, other suppliers) so you can see where it is
      const s = debounced.replace(/[,()]/g, ' ')
      q = q.or(`bar_code.eq.${s},local_code.eq.${s},name.ilike.%${s}%,pos_local_code.eq.${s}`)
    } else {
      // Default list = CoolerCo (RTMA) stock only: RTMA warehouses + workshops
      q = q.in('asset_location', ['Warehouse', 'Workshop'])
        .in('assign_account', wh ? whAssetAccounts(wh) : ALL_RTMA_ACCOUNTS)
      if (bay && BAY_STATUSES[bay]) q = q.in('asset_status', BAY_STATUSES[bay])
    }
    if (condition) q = q.eq('condition', condition)
    q = q.order('name').range(page * PS, page * PS + PS - 1)
    const { data, count, error } = await q
    setRows(error ? [] : data || []); setCount(error ? 0 : count || 0); setLoading(false)
    if (!error && count === 1 && params.get('q') && debounced === params.get('q').trim() && !autoOpened.current) {
      autoOpened.current = true; setSelected(data[0])
    }
  }, [debounced, searching, wh, bay, condition, page])

  useEffect(() => { load() }, [load])

  const COLS = [
    { key: 'name', label: 'Asset', cls: 'mono', render: v => <strong style={{ fontSize: 10.5 }}>{v}</strong> },
    { key: 'bar_code', label: 'Barcode', cls: 'mono' },
    { key: 'local_code', label: 'Local code', cls: 'mono' },
    { key: 'product_base', label: 'Product', render: v => <span className="trunc" style={{ maxWidth: 140, display: 'block' }} title={v}>{v || '—'}</span> },
    { key: 'condition', label: 'Cond.', render: v => v ? <span className={`tag tag-${condColor(v)}`}>{v}</span> : '—' },
    { key: 'asset_status', label: 'Status / bay', render: v => { const b = BAYS.find(x => x.key === bayForStatus(v)); return <span title={b?.label}>{b?.icon} {v || '—'}</span> } },
    { key: '_where', label: 'Where', render: (_, r) => { const w = whereIs(r); return <span className="trunc" style={{ maxWidth: 190, display: 'block' }} title={w.text}>{w.icon} {w.text}</span> } },
    { key: 'last_touch_date', label: 'Last touch', render: v => <span className="text3">{fmt(v)}</span> },
  ]

  return (
    <>
      <Topbar
        title="Assets"
        sub={searching ? 'Searching all assets (any location)' : 'CoolerCo stock · RTMA warehouses & workshops'}
        actions={<Link to="/stock" className="btn btn-ghost btn-sm">📊 Stock by bay</Link>}
      />
      <div className="page-content">
        <div className="filters">
          <div className="search-wrap" style={{ flex: '1 1 260px' }}>
            <span className="ico">🔍</span>
            <input type="text" placeholder="Barcode, local code, asset number or POS code…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select value={wh} onChange={e => setWh(e.target.value)} disabled={searching}>
            <option value="">🏢 All RTMA warehouses</option>
            {WAREHOUSES.map(w => <option key={w} value={w}>{WH_NAMES[w]}</option>)}
          </select>
          <select value={bay} onChange={e => setBay(e.target.value)} disabled={searching}>
            <option value="">🎨 All bays</option>
            {BAYS.filter(b => BAY_STATUSES[b.key]).map(b => <option key={b.key} value={b.key}>{b.icon} {b.label}</option>)}
          </select>
          <select value={condition} onChange={e => setCondition(e.target.value)}>
            <option value="">All conditions</option>
            {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setWh(''); setBay(''); setCondition('') }}>Clear</button>
        </div>
        {searching && <div className="notice">🔎 Search covers every asset, including those at a POS, with DDS or other suppliers. Clear the search to return to CoolerCo stock.</div>}

        <div className="card">
          <div className="card-header">
            <span className="card-title">{searching ? '🔎 Search results' : '🏭 CoolerCo stock'}</span>
            <span className="card-count">{num(count)} assets</span>
          </div>
          <DataTable cols={COLS} rows={rows} count={count} page={page} setPage={setPage} onRowClick={setSelected} loading={loading} />
        </div>
      </div>

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.bar_code ? `Barcode ${selected.bar_code}` : selected?.name || 'Asset'} icon="🧊">
        {selected && <AssetDetail a={selected} />}
      </Drawer>
    </>
  )
}

function Field({ label, children }) {
  return <div className="dl-field"><div className="lbl">{label}</div><div className="val">{children || '—'}</div></div>
}

export function AssetDetail({ a }) {
  const where = whereIs(a)
  const b = BAYS.find(x => x.key === bayForStatus(a.asset_status))

  return (
    <div>
      <div className={`where-box ${where.rtma ? 'rtma' : ''}`}>
        <div style={{ fontSize: 22 }}>{where.icon}</div>
        <div>
          <div className="lbl">Where is it?</div>
          <div style={{ fontWeight: 600 }}>{where.text}</div>
          <div className="text3" style={{ fontSize: 10.5 }}>{where.rtma ? 'Counts in CoolerCo stock' : 'Not in CoolerCo stock'}{a.date_of_last_movement ? ` · moved ${fmt(a.date_of_last_movement)}` : ''}</div>
        </div>
      </div>
      <div className="chip-row">
        {a.condition && <span className={`tag tag-${condColor(a.condition)}`}>{a.condition}</span>}
        {a.asset_status && <span className="tag tag-neutral">{b?.icon} {a.asset_status}</span>}
        {where.rtma && b && <span className="tag tag-blue">Bay: {b.label}</span>}
      </div>

      <details className="sec" open>
        <summary>🧊 Asset details</summary>
        <div className="sec-body dl-grid">
          <Field label="Asset number"><span className="mono">{a.name}</span></Field>
          <Field label="Barcode"><span className="mono">{a.bar_code}</span></Field>
          <Field label="Local code"><span className="mono">{a.local_code}</span></Field>
          <Field label="Type">{a.asset_type}</Field>
          <Field label="Product base">{a.product_base}</Field>
          <Field label="Brand">{a.brand_hierarchy}</Field>
          <Field label="Location type">{a.asset_location}</Field>
          <Field label="Assigned account">{a.assign_account}</Field>
          <Field label="Concessionaire">{a.responsible_ordering_party}</Field>
          <Field label="POS code">{a.pos_local_code}</Field>
          <Field label="Days in WH">{a.elapsed_in_wh_days}</Field>
          <Field label="Last touch">{fmt(a.last_touch_date)}</Field>
        </div>
      </details>

      <AssetHistory a={a} />
    </div>
  )
}

// One timeline from every source we hold about an asset (all loaded together)
const SOURCES = {
  case:     { icon: '🔧', label: 'COM cases' },
  repair:   { icon: '🛠️', label: 'Repair lines' },
  cc:       { icon: '📨', label: 'CoolerCo requests' },
  touch:    { icon: '📍', label: 'COM touches' },
  record:   { icon: '🗂️', label: 'COM record changes' },
  scan:     { icon: '📷', label: 'Bay scans' },
}

function AssetHistory({ a }) {
  const [items, setItems] = useState(null)
  const [on, setOn] = useState(() => Object.keys(SOURCES))
  const [open, setOpen] = useState(true)

  useEffect(() => {
    let live = true
    const n = a.name
    Promise.all([
      searchCases({ asset: n, status: 'all' }, { limit: 60 }),
      supabase.from('coolerco_cases').select('case_number,case_type,status_reason,created_on,point_of_sale,warehouse_workshop,originator')
        .or(`mapped_asset.eq.${n},asset_repaired.eq.${n},asset_removed.eq.${n},asset_delivered.eq.${n}`).order('created_on', { ascending: false }).limit(30),
      supabase.from('asset_touch').select('touched_at,pos_name,location,condition,asset_status,status_reason,reporter_type,portal_user_created_by')
        .eq('asset_number', n).order('touched_at', { ascending: false }).limit(30),
      supabase.from('magnum_assets_history').select('revision,first_seen_at,asset_status,asset_location,assign_account,asset_condition')
        .eq('asset_name', n).order('revision', { ascending: false }).limit(30),
      supabase.from('coolerco_asset_touch').select('created_at,scan_type,bay,warehouse_name,scanned_by')
        .or(`asset_name.eq.${n},bar_code.eq.${a.bar_code || '-'}`).order('created_at', { ascending: false }).limit(30),
      supabase.rpc('coolerco_asset_repairs', { p_asset: n }),
    ]).then(([cases, cc, touch, rec, scans, reps]) => {
      if (!live) return
      const list = []
      ;(cases.rows || []).forEach(c => {
        const role = caseAssets(c).find(x => x.asset === n)?.role
        list.push({ src: 'case', at: c.created_on, title: `${CASE_TYPE_ICON[c.case_type] || '•'} ${c.case_type}${role ? ` (${role})` : ''}`,
          sub: `${c.case_number} · ${(c.warehouse_workshop || '').replace('RTMA ', '')} · ${c.point_of_sale || '—'}${c.service_closure_date ? ` · closed ${fmt(c.service_closure_date)}` : ''}`,
          tag: c.status_reason, color: statusColor(c.status_reason), link: `/cases?asset=${encodeURIComponent(n)}` })
      })
      ;(cc.data || []).forEach(c => list.push({ src: 'cc', at: c.created_on, title: `${CASE_TYPE_ICON[c.case_type] || '•'} ${c.case_type}`,
        sub: `${c.case_number} · ${c.originator} · ${c.point_of_sale || ''}`, tag: c.status_reason, color: c.status_reason === 'Waiting for Approval' ? 'orange' : statusColor(c.status_reason), link: '/requests' }))
      ;(touch.data || []).forEach(t => list.push({ src: 'touch', at: t.touched_at, title: `📍 Touched at ${t.pos_name || 'location'}`,
        sub: [t.condition, t.asset_status, t.reporter_type || t.portal_user_created_by].filter(Boolean).join(' · '), tag: t.status_reason, color: t.status_reason === 'Accepted' ? 'green' : 'neutral' }))
      const recs = rec.data || []
      recs.forEach((r, idx) => {
        const prev = recs[idx + 1]
        const changes = prev ? [
          prev.asset_status !== r.asset_status && `status ${prev.asset_status} → ${r.asset_status}`,
          prev.assign_account !== r.assign_account && `moved ${prev.assign_account || '—'} → ${r.assign_account || '—'}`,
          prev.asset_condition !== r.asset_condition && `condition ${prev.asset_condition} → ${r.asset_condition}`,
        ].filter(Boolean) : [`first seen: ${r.asset_status} · ${r.assign_account || r.asset_location || ''}`]
        if (changes.length) list.push({ src: 'record', at: r.first_seen_at, title: '🗂️ COM record changed', sub: changes.join(' · ') })
      })
      ;(scans.data || []).forEach(sc => list.push({ src: 'scan', at: sc.created_at, title: `📷 Bay scan · ${sc.bay || '—'}`, sub: `${sc.warehouse_name || ''} · ${sc.scan_type || ''} · ${sc.scanned_by || ''}` }))
      ;(reps.data || []).forEach(r => list.push({ src: 'repair', at: r.created_on, title: `🛠️ ${r.repair_name || r.repair_code || 'Repair'}`,
        sub: [r.case_number, r.technician, (r.workshop || r.warehouse || '').replace('RTMA ', ''), r.damage_origin, r.component_type].filter(Boolean).join(' · '),
        tag: r.case_status_reason, color: statusColor(r.case_status_reason) }))
      list.sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0))
      setItems(list)
    })
    return () => { live = false }
  }, [a.name])

  const shown = (items || []).filter(i => on.includes(i.src))
  const count = k => (items || []).filter(i => i.src === k).length

  return (
    <details className="sec" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
      <summary>📜 Asset history {items ? `(${items.length})` : ''}</summary>
      <div className="sec-body">
        {!items ? <div className="load-state"><span className="spinner" /> Loading history…</div> : (
          <>
            <div className="chip-pick" style={{ marginBottom: 8 }}>
              {Object.entries(SOURCES).map(([k, v]) => (
                <button key={k} type="button" className={`chip-opt${on.includes(k) ? ' on' : ''}`}
                  onClick={() => setOn(o => o.includes(k) ? o.filter(x => x !== k) : [...o, k])}>{v.icon} {v.label} ({count(k)})</button>
              ))}
            </div>
            {!shown.length ? <div className="text3">No history found for the selected sources.</div> : (
              <div className="timeline">
                {shown.map((i, idx) => {
                  const body = (
                    <>
                      <span className="tl-dot">{SOURCES[i.src].icon}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12 }}><strong>{i.title}</strong></div>
                        <div className="text3" style={{ fontSize: 10.5 }}>{fmt(i.at)}{i.sub ? ` · ${i.sub}` : ''}</div>
                      </div>
                      {i.tag && <span className={`tag tag-${i.color || 'neutral'}`} style={{ marginLeft: 'auto' }}>{i.tag}</span>}
                    </>
                  )
                  return i.link
                    ? <Link key={idx} to={i.link} className="tl-item">{body}</Link>
                    : <div key={idx} className="tl-item">{body}</div>
                })}
              </div>
            )}
          </>
        )}
      </div>
    </details>
  )
}
