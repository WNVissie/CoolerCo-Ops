import { useState } from 'react'
import CameraScan, { codeCandidates } from '../components/CameraScan'
import { assetRoles } from './fieldStops'
import { lookupAsset } from './fieldStops'

// The assets for one stop, always visible on the trip card:
//   📦 Deliver  = the asset picked & prepared in the warehouse (RouteIQ preparation), else what was requested
//   ↩️ Remove   = the asset to collect at the store
//   🛠 Repair   = the asset to repair
// 📷 Check: the driver scans the asset in front of him → ✅ correct / ⛔ not the planned one.
// The result is kept on the phone (per stop) and pre-fills the job card.
const cleanBase = b => String(b || '').replace(/^\s*[\w-]+\s*-\s*/, '') // "1772 - SLIM VISIMAX III" → "SLIM VISIMAX III"
const key = (stopId, role) => `cc_check:${stopId}:${role}`
export const savedCheck = (stopId, role) => { try { return JSON.parse(localStorage.getItem(key(stopId, role))) } catch { return null } }

export function plannedAssets(s, p, c) {
  const roles = assetRoles(s.case_type)
  const out = []
  const stopAssets = (s.asset_barcodes || []).map((b, i) => ({ code: b, base: s.asset_product_bases?.[i] }))
  if (roles.includes('delivered')) {
    if (p?.selected_bar_code) out.push({ role: 'delivered', code: p.selected_bar_code, name: p.selected_asset_name, local: p.selected_local_code, base: p.selected_product_base || c?.requested_product_base, condition: p.selected_condition, branding: p.selected_branding, prep: p })
    else out.push({ role: 'delivered', code: null, base: c?.requested_product_base || s.asset_product_bases?.[0], notPicked: true, asset: c?.asset_delivered })
  }
  if (roles.includes('removed')) {
    // Replacement: the stop's own asset is the old one to collect (the new one comes from the picking)
    const r = stopAssets.find(a => a.code && a.code !== p?.selected_bar_code)
    out.push({ role: 'removed', code: r?.code || null, base: r?.base, asset: c?.asset_removed })
  }
  if (roles.includes('repaired')) out.push({ role: 'repaired', code: stopAssets[0]?.code || null, base: stopAssets[0]?.base, asset: c?.asset_repaired })
  return out
}

const LABEL = { delivered: ['📦', 'Deliver'], removed: ['↩️', 'Remove'], repaired: ['🛠', 'Repair'] }

export default function StopAssets({ stop, prep, kase }) {
  const list = plannedAssets(stop, prep, kase)
  const [checks, setChecks] = useState(() => Object.fromEntries(list.map(a => [a.role, savedCheck(stop.id, a.role)])))
  const [cam, setCam] = useState(null)
  const [busy, setBusy] = useState(null)
  if (!list.length) return null

  const check = async (a, raw) => {
    setBusy(a.role)
    const keys = codeCandidates(raw)
    const found = (await lookupAsset(raw).catch(() => ({}))).asset
    const ids = new Set([...keys, found?.bar_code, found?.name, found?.local_code].filter(Boolean).map(String))
    const ok = a.code ? ids.has(String(a.code)) || (a.name && ids.has(a.name)) : null
    const res = { code: found?.bar_code || keys[0] || raw, name: found?.name, base: found?.product_base, ok, at: Date.now() }
    localStorage.setItem(key(stop.id, a.role), JSON.stringify(res))
    setChecks(c => ({ ...c, [a.role]: res })); setBusy(null)
    navigator.vibrate?.(ok === false ? [200, 80, 200] : 60)
  }

  return (
    <div className="f-assets">
      {list.map(a => {
        const [ico, lbl] = LABEL[a.role], ck = checks[a.role]
        return (
          <div key={a.role} className={`f-asset ${ck?.ok === true ? 'ok' : ck?.ok === false ? 'bad' : ''}`}>
            <div className="f-asset-main">
              <small>{ico} {lbl}</small>
              {a.code ? <b className="mono">{a.code}</b> : <b className="text3">{a.role === 'delivered' ? 'Not picked yet' : 'No barcode on the stop'}</b>}
              <span>{cleanBase(a.base) || '—'}{a.condition ? ` · ${a.condition}` : ''}{a.branding ? ` · ${a.branding}` : ''}</span>
              {a.prep && <span className="f-asset-prep">{a.prep.picked ? '✓' : '○'} Picked {a.prep.rtw ? '✓' : '○'} RTW {a.prep.packed ? '✓' : '○'} Packed</span>}
              {a.notPicked && <span className="f-asset-warn">⚠ Warehouse has not picked an asset for this case</span>}
              {ck && (
                <span className={`f-asset-check ${ck.ok === true ? 'ok' : ck.ok === false ? 'bad' : ''}`}>
                  {ck.ok === true ? '✅ Correct asset scanned' : ck.ok === false ? `⛔ Scanned ${ck.code}${ck.base ? ` (${cleanBase(ck.base)})` : ''} — not the planned asset` : `📷 Scanned ${ck.code}${ck.base ? ` (${cleanBase(ck.base)})` : ''}`}
                </span>
              )}
            </div>
            <button className="btn btn-ghost btn-sm f-asset-scan" disabled={busy === a.role} onClick={() => setCam(a)}>{busy === a.role ? '…' : ck ? '📷 Again' : '📷 Check'}</button>
          </div>
        )
      })}
      {cam && <CameraScan onClose={() => setCam(null)} onResult={t => { const a = cam; setCam(null); check(a, t) }} />}
    </div>
  )
}
