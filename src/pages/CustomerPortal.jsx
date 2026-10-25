import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import Drawer from '../components/Drawer'
import { supabase } from '../lib/supabase'
import { searchCases } from '../lib/caseSearch'
import { fmt, num, statusColor, slaColor, slaLabel, condColor, CASE_TYPE_ICON, caseAssetText } from '../lib/helpers'

// POS lookup: find a store, then see its cases and the assets COM says are there.
export default function CustomerPortal() {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(false)
  const [pos, setPos] = useState(null)

  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 380); return () => clearTimeout(t) }, [search])

  useEffect(() => {
    if (debounced.length < 3) { setList([]); return }
    setLoading(true)
    const s = debounced.replace(/[,()]/g, ' ')
    supabase.from('cases').select('point_of_sale,pos_local_code,responsible_ordering_party,warehouse_workshop')
      .or(`pos_local_code.eq.${s},point_of_sale.ilike.%${s}%`).order('created_on', { ascending: false }).limit(300)
      .then(({ data }) => {
        const m = new Map()
        ;(data || []).forEach(r => {
          const k = r.pos_local_code || r.point_of_sale
          if (!m.has(k)) m.set(k, { ...r, cases: 0 })
          m.get(k).cases++
        })
        setList([...m.values()]); setLoading(false)
      })
  }, [debounced])

  return (
    <>
      <Topbar title="POS Lookup" sub="Find a store · its cases and assets" />
      <div className="page-content">
        <div className="filters">
          <div className="search-wrap" style={{ flex: 1 }}>
            <span className="ico">🏪</span>
            <input placeholder="POS name or POS local code (min 3 characters)" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="card">
          {loading ? <div className="load-state"><span className="spinner" /> Searching…</div>
            : !list.length ? <div className="empty-state"><div className="empty-ico">🏪</div><div>{debounced.length < 3 ? 'Type a POS name or code' : 'No stores found'}</div></div>
              : (
                <div className="tbl-wrap"><table className="tbl">
                  <thead><tr><th>Point of Sale</th><th>POS code</th><th>Concessionaire</th><th>Warehouse</th><th>Recent cases</th></tr></thead>
                  <tbody>{list.map(p => (
                    <tr key={p.pos_local_code || p.point_of_sale} onClick={() => setPos(p)} style={{ cursor: 'pointer' }}>
                      <td>{p.point_of_sale}</td><td className="mono">{p.pos_local_code || '—'}</td>
                      <td className="trunc" style={{ maxWidth: 160 }}>{p.responsible_ordering_party || '—'}</td>
                      <td>{(p.warehouse_workshop || '—').replace('RTMA ', '')}</td><td>{num(p.cases)}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
        </div>
      </div>
      <Drawer open={!!pos} onClose={() => setPos(null)} title={pos?.point_of_sale || 'POS'} icon="🏪">
        {pos && <PosDetail p={pos} />}
      </Drawer>
    </>
  )
}

function PosDetail({ p }) {
  const [cases, setCases] = useState(null)
  const [assets, setAssets] = useState(null)

  // Both lists load at the same time
  useEffect(() => {
    const key = p.pos_local_code || p.point_of_sale
    Promise.all([
      searchCases({ pos: key, status: 'all' }, { limit: 50 }),
      p.pos_local_code
        ? supabase.from('assets_live').select('name,bar_code,local_code,product_base,condition,asset_status').eq('pos_local_code', p.pos_local_code).limit(50)
        : Promise.resolve({ data: [] }),
    ]).then(([c, a]) => { setCases(c.rows); setAssets(a.data || []) })
  }, [p])

  return (
    <div>
      <div className="dl-grid" style={{ marginBottom: 12 }}>
        <div className="dl-field"><div className="lbl">POS code</div><div className="val mono">{p.pos_local_code || '—'}</div></div>
        <div className="dl-field"><div className="lbl">Concessionaire</div><div className="val">{p.responsible_ordering_party || '—'}</div></div>
      </div>
      <details className="sec" open>
        <summary>🧊 Assets at this POS (per COM) {assets ? `(${assets.length})` : ''}</summary>
        <div className="sec-body">
          {!assets ? <div className="load-state"><span className="spinner" /></div> : !assets.length ? <div className="text3">No assets listed at this POS.</div> : assets.map(a => (
            <Link key={a.name} to={`/assets?q=${encodeURIComponent(a.bar_code || a.name)}`} className="tl-item">
              <span className="mono" style={{ fontSize: 11 }}>{a.bar_code} · {a.local_code}</span>
              <span className="text3 trunc" style={{ fontSize: 10.5 }}>{a.product_base}</span>
              <span className={`tag tag-${condColor(a.condition)}`} style={{ marginLeft: 'auto' }}>{a.condition}</span>
            </Link>
          ))}
        </div>
      </details>
      <details className="sec" open>
        <summary>🔧 Cases {cases ? `(${cases.length})` : ''}</summary>
        <div className="sec-body">
          {!cases ? <div className="load-state"><span className="spinner" /></div> : !cases.length ? <div className="text3">No cases.</div> : cases.map(c => (
            <div key={c.case_number} className="tl-item">
              <span className="tl-dot">{CASE_TYPE_ICON[c.case_type] || '•'}</span>
              <div style={{ minWidth: 0 }}>
                <div><strong className="mono" style={{ fontSize: 11 }}>{c.case_number}</strong> · {c.case_type}</div>
                <div className="text3" style={{ fontSize: 10.5 }}>{fmt(c.created_on)} · {caseAssetText(c)}</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span className={`tag tag-${statusColor(c.status_reason)}`}>{c.status_reason}</span>
                <span className={`tag tag-${slaColor(c.sla_status)}`}>{slaLabel(c.sla_status)}</span>
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}
