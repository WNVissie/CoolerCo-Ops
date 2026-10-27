import { supabase } from './supabase'
import { WH_NAMES } from './helpers'

// Offline support for the field app (browser side, IndexedDB on the phone):
//  · queue  — scans (+ photos) and submits saved while there is no signal; sent in order when back online.
//    Scans carry their own id, so sending twice can never create a duplicate.
//  · kv     — small saved lists: the warehouse asset list (for offline lookups), dropdowns, areas.
const DB = 'coolerco-field', VER = 1
let dbp
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER)
    r.onupgradeneeded = () => { r.result.createObjectStore('queue', { keyPath: 'qid' }); r.result.createObjectStore('kv') }
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  })
  return dbp
}
async function tx(store, mode, fn) {
  const d = await db()
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode); const s = t.objectStore(store); let out
    Promise.resolve(fn(s)).then(v => { out = v })
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error)
  })
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })

export const kvGet = key => tx('kv', 'readonly', s => req(s.get(key))).catch(() => undefined)
export const kvSet = (key, val) => tx('kv', 'readwrite', s => req(s.put(val, key))).catch(() => undefined)

// ── queue ────────────────────────────────────────────────────────────
const emit = () => queueCount().then(n => window.dispatchEvent(new CustomEvent('cc-queue', { detail: n })))
export const queueAll = () => tx('queue', 'readonly', s => req(s.getAll())).then(a => (a || []).sort((x, y) => x.at - y.at)).catch(() => [])
export const queueCount = () => tx('queue', 'readonly', s => req(s.count())).catch(() => 0)
export async function queueAdd(item) { await tx('queue', 'readwrite', s => req(s.put({ qid: crypto.randomUUID(), at: Date.now(), ...item }))); emit() }
async function queueDel(qid) { await tx('queue', 'readwrite', s => req(s.delete(qid))) }
async function queuePut(item) { await tx('queue', 'readwrite', s => req(s.put(item))) }

export const isNetErr = e => /failed to fetch|networkerror|load failed|network request failed|fetch failed|timeout|offline/i.test(String(e?.message || e || '')) || e?.status >= 500 || !navigator.onLine

// The table only accepts these scan types (database check): daily, monthly, receiving, dispatch, stocktake.
// Older app versions used count / receive / move — translate so those saved scans still go through.
export const SCAN_TYPE_DB = { count: 'stocktake', receive: 'receiving', move: 'daily', quick: 'stocktake' }
export const dbScanType = t => SCAN_TYPE_DB[t] || t

let flushing = false
export async function flushQueue() {
  if (flushing || !navigator.onLine) return { sent: 0 }
  flushing = true
  let sent = 0
  try {
    for (const it of await queueAll()) {
      try {
        if (it.type === 'touch') {
          for (const p of it.photos || []) {
            const { error } = await supabase.storage.from('coolerco-cases').upload(p.path, p.blob, { contentType: 'image/jpeg', upsert: true })
            if (error) throw error
          }
          const { error } = await supabase.from('coolerco_asset_touch').insert({ ...it.row, scan_type: dbScanType(it.row.scan_type) })
          if (error && error.code !== '23505') throw error // 23505 = already there (sent before) → fine
        } else if (it.type === 'submit') {
          const { error } = await supabase.from('coolerco_asset_touch').update(it.patch).in('id', it.ids).eq('touch_status', 'New')
          if (error) throw error
        }
        await queueDel(it.qid); sent++
      } catch (e) {
        if (isNetErr(e)) break // still no signal — try later, keep order
        await queuePut({ ...it, error: String(e.message || e), tries: (it.tries || 0) + 1 }) // real error: keep it visible, continue
      }
    }
  } finally { flushing = false; emit() }
  if (sent) window.dispatchEvent(new CustomEvent('cc-queue-sent', { detail: sent }))
  return { sent }
}

// Auto-send: when signal returns, on start, and every 30 s
let started = false
export function startAutoFlush() {
  if (started) return; started = true
  window.addEventListener('online', () => flushQueue())
  setInterval(() => flushQueue(), 30000)
  flushQueue(); emit()
  // ask the phone not to clear our saved data (waiting scans) when space runs low
  navigator.storage?.persist?.().catch(() => {})
  purgeOld()
}

// Saved trip copies older than 7 days are removed (asset lists are replaced, never added to)
async function purgeOld() {
  try {
    const keys = await tx('kv', 'readonly', s => req(s.getAllKeys()))
    const cutoff = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)
    for (const k of keys || []) {
      const d = String(k).match(/^trip:.*:(\d{4}-\d{2}-\d{2})$/)?.[1]
      if (d && d < cutoff) await tx('kv', 'readwrite', s => req(s.delete(k)))
    }
  } catch { /* ignore */ }
}

// How much this app keeps on the phone (MB)
export async function storageUsed() {
  try { const e = await navigator.storage.estimate(); return Math.round((e.usage || 0) / 1e5) / 10 } catch { return null }
}

// ── offline asset list (per warehouse) ───────────────────────────────
const ASSET_COLS = 'name,bar_code,local_code,sap_number,serial_number,external_code,asset_type,product_base,product_variant,brand_hierarchy,condition,asset_status,asset_location,assign_account,points_of_sale'
export async function saveWarehouseAssets(wh, onProgress) {
  const name = WH_NAMES[wh]; if (!name) return null
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('assets_live').select(ASSET_COLS)
      .in('asset_location', ['Warehouse', 'Workshop']).ilike('assign_account', `RTMA ${name}%`).order('name').range(from, from + 999)
    if (error) throw error
    rows.push(...(data || [])); onProgress?.(rows.length)
    if (!data || data.length < 1000) break
  }
  const val = { at: Date.now(), rows }
  await kvSet('assets:' + wh, val)
  return val
}
export async function savedAssetsInfo(wh) { const v = await kvGet('assets:' + wh); return v ? { at: v.at, n: v.rows.length } : null }
export async function offlineLookup(keys) {
  const k = new Set(keys.map(String))
  const lists = await tx('kv', 'readonly', s => req(s.getAll())).catch(() => [])
  const order = ['name', 'bar_code', 'local_code', 'serial_number', 'external_code', 'sap_number']
  let best = null, bestRank = 99
  for (const v of lists || []) for (const a of v?.rows || []) {
    const r = order.findIndex(f => a[f] && k.has(String(a[f])))
    if (r >= 0 && r < bestRank) { best = a; bestRank = r; if (r === 0) return best }
  }
  return best
}

// Small lists (dropdowns, areas): live when online, saved copy when not
export async function cachedQuery(key, run) {
  try {
    const { data, error } = await run()
    if (error) throw error
    kvSet('list:' + key, data); return data || []
  } catch { return (await kvGet('list:' + key)) || [] }
}
