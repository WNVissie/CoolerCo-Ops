import { supabase } from './supabase'

// Read-only server calls: retry quietly on network / server hiccups (e.g. a Supabase API restart).
// Never use for writes (submit, decide…) — a retry could create a duplicate.
export const NET_MSG = 'We could not reach CoolerCo just now. Please check your signal and try again.'

export function isNetErr(e) {
  const m = String(e?.message || e || '')
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed|timeout/i.test(m) || e?.status >= 500
}

export async function rpcRead(fn, args, tries = 3) {
  let last
  for (let i = 0; i < tries; i++) {
    const res = await supabase.rpc(fn, args).then(r => r, e => ({ data: null, error: e }))
    if (!res.error || !isNetErr(res.error)) return res
    last = res
    await new Promise(r => setTimeout(r, 800 * (i + 1)))
  }
  return { data: null, error: { ...last.error, message: NET_MSG, network: true } }
}
