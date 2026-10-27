import { useState, Fragment } from 'react'
import { searchCases } from '../lib/caseSearch'
import { statusColor, slaColor, caseAssets, CASE_TYPE_ICON } from '../lib/helpers'
import CameraScan from '../components/CameraScan'

// Case status lookup: case no. (CAS-…), store code (L…), store name or an asset (barcode / local code / AST-…).
// Server-side search (coolerco_case_search) — all statuses for a specific case/store/asset.
const fmtD = d => (d ? new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')

function filterFor(raw) {
  const s = raw.trim()
  if (/^CAS-/i.test(s)) return { caseNumber: s.toUpperCase() }
  if (/^L\d{5,}$/i.test(s)) return { pos: s.toUpperCase() }
  if (/^(AST-|\d{5,}$)/i.test(s)) return { asset: s }
  return { pos: s } // store name
}

export default function FieldCases() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [count, setCount] = useState(0)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [cam, setCam] = useState(false)
  const [open, setOpen] = useState(null)

  async function run(e, value) {
    e?.preventDefault?.()
    const v = (value ?? q).trim()
    if (!v) return
    if (value) setQ(value)
    if (!navigator.onLine) { setErr('📵 No signal — case status needs signal. Try again when you are back online.'); return }
    setBusy(true); setErr(null); setOpen(null)
    const { rows: r, count: n, error } = await searchCases({ ...filterFor(v), status: 'all' }, { limit: 30 })
    setBusy(false)
    if (error) { setErr(error.message); setRows([]); return }
    setRows(r); setCount(n)
  }

  return (
    <div className="f-pad">
      <form className="f-card" onSubmit={run}>
        <strong>📋 Case status</strong>
        <p className="text3" style={{ fontSize: 12, margin: '4px 0 8px' }}>Case no. (CAS-…), store code (L…), store name, or scan an asset.</p>
        <div className="scan-find" style={{ marginBottom: 0 }}>
          <button type="button" className="btn btn-primary scan-cam-btn" onClick={() => setCam(true)}>📷 Scan asset</button>
          <div className="search-wrap"><span className="ico">🔍</span>
            <input enterKeyHint="search" placeholder="CAS-…, L…, store or barcode" value={q} onChange={e => setQ(e.target.value)} /></div>
          <button className="btn btn-ghost btn-sm" disabled={busy}>{busy ? '…' : 'Find'}</button>
        </div>
      </form>
      {cam && <CameraScan onClose={() => setCam(false)} onResult={t => { setCam(false); run(null, (t.match(/AST-[\w-]+/i) || [t])[0]) }} />}
      {err && <div className="form-msg err">{err}</div>}
      {rows && !rows.length && !err && <div className="f-card text3" style={{ textAlign: 'center' }}>No cases found.</div>}
      {rows?.length > 0 && <p className="text3" style={{ fontSize: 11.5, margin: '0 2px 6px' }}>{count} case(s){count > rows.length ? ` · showing ${rows.length} newest` : ''}</p>}
      {rows?.map(c => {
        const isOpen = open === c.case_number
        return (
          <div key={c.case_number} className="f-card">
            <button className="f-row" style={{ width: '100%', background: 'none', border: 0, padding: 0, textAlign: 'left', color: 'inherit', font: 'inherit' }} onClick={() => setOpen(isOpen ? null : c.case_number)}>
              <span style={{ fontSize: 22 }}>{CASE_TYPE_ICON[c.case_type] || '📄'}</span>
              <div className="f-grow"><strong>{c.point_of_sale || c.case_number}</strong><small>{c.case_type} · {c.case_number} · {fmtD(c.created_on)}</small></div>
              <span className="text3">{isOpen ? '▴' : '▾'}</span>
            </button>
            <div className="f-tags">
              <span className={`tag tag-${statusColor(c.status_reason)}`}>{c.status_reason || '—'}</span>
              {c.sla_status && <span className={`tag tag-${slaColor(c.sla_status)}`}>{c.sla_status}</span>}
              <span className="tag tag-neutral">Due {fmtD(c.end_date)}</span>
            </div>
            {isOpen && (
              <div className="f-kv">
                <span>Store</span><div>{c.point_of_sale} · {c.pos_local_code}</div>
                <span>Concessionaire</span><div>{c.responsible_ordering_party || '—'}</div>
                <span>Warehouse</span><div>{c.warehouse_workshop || '—'}</div>
                {caseAssets(c).map((a, i) => <Fragment key={i}><span>{a.icon} {a.role}</span><div className="mono" style={{ fontSize: 11.5 }}>{a.asset}{a.condition ? ` · ${a.condition}` : ''}</div></Fragment>)}
                {c.requested_product_base && <><span>Requested</span><div>{c.requested_product_base}{c.requested_asset_condition ? ` · ${c.requested_asset_condition}` : ''}</div></>}
                {c.motive && <><span>Reason</span><div>{c.motive}</div></>}
                {c.service_closure_date && <><span>Closed</span><div>{fmtD(c.service_closure_date)}</div></>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
