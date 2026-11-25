import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// What the signed-in user may see in the menu (one small check per session, cached):
//   magnum  = may see Magnum / COM data (false for demo / Tiger users, script 049)
//   office  = system_admin, administrator, manager or supervisor (planner)
// Older databases without these functions → everything stays visible (same as before).
let cache = null
async function loadAccess() {
  if (cache) return cache
  const [blk, off, mine] = await Promise.all([
    supabase.rpc('coolerco_magnum_blocked'),
    supabase.rpc('coolerco_has_role', { p_roles: ['system_admin', 'administrator', 'manager', 'supervisor'] }),
    supabase.rpc('coolerco_my_access'),
  ])
  // users with no CoolerCo access rows yet (RTMA office staff today) keep every page, as before
  const noRows = !mine.error && Array.isArray(mine.data) && mine.data.length === 0
  cache = { ready: true, magnum: blk.error ? true : !blk.data, office: off.error || noRows ? true : !!off.data }
  return cache
}
export function useAccess() {
  const [a, setA] = useState(cache || { ready: false, magnum: true, office: true })
  useEffect(() => { let on = true; loadAccess().then(x => on && setA(x)); return () => { on = false } }, [])
  return a
}
// menu item rule: magnum = needs Magnum access · office = needs an office role
export const allowed = (item, a) => (!item.magnum || a.magnum) && (!item.office || a.office)
