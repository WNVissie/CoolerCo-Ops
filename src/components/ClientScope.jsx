import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// Which clients this user may look at, and which one is picked.
//   MAGNUM = the COM screens as they always were (Magnum data from COM)
//   ALL    = every client this user may see, from the CoolerCo lists
//   <code> = one CoolerCo client (Tiger, Demo, Demo Foods …)
// Users who may not see Magnum (demo, Tiger) never get the MAGNUM option.
// Works on a database without scripts 041 / 049: then only MAGNUM shows.
const KEY = 'cc_client_pick'
let cache = null

async function loadScope() {
  if (cache) return cache
  const [blk, cl] = await Promise.all([
    supabase.rpc('coolerco_magnum_blocked'),
    supabase.from('coolerco_clients').select('code,name,active').eq('active', true).order('name'),
  ])
  const blocked = blk.error ? false : !!blk.data // without 049 everyone keeps the COM screens
  const others = (cl.data || []).filter(c => c.code !== 'MAGNUM')
  if (!others.length) { cache = { ready: true, blocked: false, clients: [], hasRegister: false }; return cache }
  // Counts per client (open cases + assets) so a user only gets chips for clients they can see
  const counts = await Promise.all(others.map(c => Promise.all([
    supabase.from('coolerco_all_cases').select('case_number', { count: 'exact', head: true }).eq('client_code', c.code).eq('is_open', true),
    supabase.from('coolerco_all_assets').select('asset_number', { count: 'exact', head: true }).eq('client_code', c.code),
  ])))
  const clients = others.map((c, i) => ({ ...c, open: counts[i][0].count || 0, assets: counts[i][1].count || 0, err: counts[i][0].error || counts[i][1].error }))
    .filter(c => !c.err && (!blocked || c.open + c.assets > 0))
  cache = { ready: true, blocked, clients, hasRegister: true }
  return cache
}

export function useClientScope() {
  const [params, setParams] = useSearchParams()
  const [scope, setScope] = useState(cache || { ready: false, blocked: false, clients: [] })
  useEffect(() => { let on = true; loadScope().then(s => on && setScope(s)); return () => { on = false } }, [])

  const options = scope.ready ? [
    ...(scope.blocked ? [] : [{ code: 'MAGNUM', name: 'Magnum (COM)', icon: '🟦' }]),
    ...(scope.clients.length > 1 || (scope.clients.length && !scope.blocked) ? [{ code: 'ALL', name: 'All clients', icon: '🗂️' }] : []),
    ...scope.clients.map(c => ({ code: c.code, name: c.name, icon: '🟩', open: c.open })),
  ] : []

  const wanted = params.get('client') || (() => { try { return localStorage.getItem(KEY) } catch { return null } })()
  const client = options.find(o => o.code === wanted)?.code || options[0]?.code || 'MAGNUM'

  const pick = code => {
    try { localStorage.setItem(KEY, code) } catch { /* private mode */ }
    const p = new URLSearchParams(params); p.set('client', code); setParams(p, { replace: true })
  }
  return { ...scope, options, client, pick }
}

// The row of client chips shown at the top of Cases, Assets and Stock
export function ClientBar({ scope }) {
  if (!scope.ready || scope.options.length < 2) return null
  return (
    <div className="chip-row" role="group" aria-label="Client" style={{ alignItems: 'center' }}>
      <span className="text3" style={{ fontSize: 11 }}>Client</span>
      {scope.options.map(o => (
        <button type="button" key={o.code} className={`chip-opt${scope.client === o.code ? ' on' : ''}`} aria-pressed={scope.client === o.code} onClick={() => scope.pick(o.code)}>
          {o.icon} {o.name}{o.open != null ? ` · ${o.open} open` : ''}
        </button>
      ))}
    </div>
  )
}

export const clientName = (scope, code) => scope.clients?.find(c => c.code === code)?.name || (code === 'MAGNUM' ? 'Magnum' : code)
