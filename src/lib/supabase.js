import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Convenience: fetch with count
export async function sbFetch(table, params = {}) {
  let q = supabase.from(table).select(params.select || '*', { count: 'exact' })

  if (params.eq)   Object.entries(params.eq).forEach(([k, v]) => { q = q.eq(k, v) })
  if (params.ilike) Object.entries(params.ilike).forEach(([k, v]) => { q = q.ilike(k, v) })
  if (params.gte)  Object.entries(params.gte).forEach(([k, v]) => { q = q.gte(k, v) })
  if (params.order) q = q.order(params.order, { ascending: params.asc ?? false })
  if (params.limit) q = q.limit(params.limit)
  if (params.offset) q = q.range(params.offset, params.offset + (params.limit || 50) - 1)

  const { data, count, error } = await q
  return { data: data || [], count, error }
}
