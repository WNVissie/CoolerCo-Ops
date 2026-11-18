// 🕘 Store opening + receiving hours (script 036: coolerco_pos_hours, coolerco_public_holidays).
// One set of rules for the hours page, the Field app and Trip check.
//   • Opening hours  → store visits and repairs at the store
//   • Receiving hours → Deliver / Replacement / Removal (empty = same as opening; may be before opening)
//   • Day 1 Mon … 7 Sun, 8 = public holiday (used on a holiday only if that store has a day-8 row)
import { supabase } from './supabase'

export const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun'], [8, 'Public holiday']]
export const DAY_NAME = Object.fromEntries(DAYS)
const RECEIVE_TYPES = /deliver|replacement|removal|collect|receive/i
export const windowKind = caseType => (RECEIVE_TYPES.test(caseType || '') ? 'receive' : 'open')

const hhmm = t => (t ? String(t).slice(0, 5) : '')
const mins = t => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0) }
const fmt = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

// SA date parts for a moment (UTC+2, no daylight saving)
export function saParts(at = new Date()) {
  const d = new Date(new Date(at).getTime() + 2 * 3600e3)
  return { date: d.toISOString().slice(0, 10), isoDay: ((d.getUTCDay() + 6) % 7) + 1, minutes: d.getUTCHours() * 60 + d.getUTCMinutes() }
}

// rows of one store + holiday dates → the hours for one date (null = no hours captured)
export function hoursOn(rows, holidays, date) {
  if (!rows?.length) return null
  const hol = holidays?.[date]
  const day = new Date(date + 'T12:00:00Z').getUTCDay(), iso = ((day + 6) % 7) + 1
  const r = (hol && rows.find(x => x.day === 8)) || rows.find(x => x.day === iso)
  if (!r) return { date, day: iso, holiday: hol || null, unknown: true }
  return {
    date, day: r.day, holiday: hol || null, closed: r.closed,
    open: r.closed ? null : [mins(r.open_from), mins(r.open_to)],
    receive: r.closed ? [] : [r.receive_from ? [mins(r.receive_from), mins(r.receive_to)] : [mins(r.open_from), mins(r.open_to)],
      ...(r.receive2_from ? [[mins(r.receive2_from), mins(r.receive2_to)]] : [])],
    receiveSameAsOpen: !r.receive_from, note: r.note,
  }
}

// "Receives 09:00–15:00 · open 08:00–21:00" for one day
export function dayText(h, kind) {
  if (!h) return null
  if (h.unknown) return `No hours for ${DAY_NAME[h.day]}`
  if (h.closed) return `Closed${h.holiday ? ` (${h.holiday})` : ''}`
  const open = `${fmt(h.open[0])}–${fmt(h.open[1])}`
  const recv = h.receive.map(w => `${fmt(w[0])}–${fmt(w[1])}`).join(' & ')
  return kind === 'receive' ? `Receives ${recv}${h.receiveSameAsOpen ? '' : ` · open ${open}`}` : `Open ${open}${h.receiveSameAsOpen ? '' : ` · receives ${recv}`}`
}

// Is the store open / receiving at a minute of the day? → { state, text }
//   state: ok | soon (closes within 45 min) | before | after | closed | unknown
export function statusAt(h, kind, minute) {
  if (!h || h.unknown) return { state: 'unknown', text: 'No hours captured' }
  if (h.closed) return { state: 'closed', text: `Closed today${h.holiday ? ` — ${h.holiday}` : ''}` }
  const wins = kind === 'receive' ? h.receive : [h.open]
  const label = kind === 'receive' ? 'Receiving' : 'Open'
  for (const [a, b] of wins) {
    if (minute >= a && minute < b) {
      const left = b - minute
      return left <= 45 ? { state: 'soon', text: `${label} — closes ${fmt(b)} (${left} min)` } : { state: 'ok', text: `${label} now · until ${fmt(b)}` }
    }
  }
  const next = wins.find(([a]) => a > minute)
  if (next) return { state: 'before', text: `${kind === 'receive' ? 'Not receiving yet' : 'Not open yet'} — from ${fmt(next[0])}` }
  return { state: 'after', text: `${kind === 'receive' ? 'Receiving closed' : 'Closed'} since ${fmt(wins[wins.length - 1][1])}` }
}

// Short week summary: "Mon–Fri 08:00–21:00 (receives 09:00–15:00) · Sat 08:00–14:00 · Sun closed"
export function weekText(rows) {
  if (!rows?.length) return ''
  const one = r => (r.closed ? 'closed' : `${hhmm(r.open_from)}–${hhmm(r.open_to)}${r.receive_from ? ` (receives ${hhmm(r.receive_from)}–${hhmm(r.receive_to)}${r.receive2_from ? ` & ${hhmm(r.receive2_from)}–${hhmm(r.receive2_to)}` : ''})` : ''}`)
  const parts = []
  let run = null
  for (const [d] of DAYS.slice(0, 7)) {
    const r = rows.find(x => x.day === d), t = r ? one(r) : null
    if (run && run.t === t) run.to = d
    else { if (run) parts.push(run); run = { from: d, to: d, t } }
  }
  parts.push(run)
  const out = parts.filter(p => p.t).map(p => `${DAY_NAME[p.from]}${p.to !== p.from ? `–${DAY_NAME[p.to]}` : ''} ${p.t}`)
  const ph = rows.find(x => x.day === 8)
  if (ph) out.push(`Public holidays ${one(ph)}`)
  return out.join(' · ')
}

// Load hours for many stores (+ holidays). Returns { ready, byPos: { L…: rows }, holidays: { date: name } }.
// ready = false where script 036 is not installed (screens then simply show nothing).
export async function loadHours(posCodes, { from, to } = {}) {
  const codes = [...new Set((posCodes || []).filter(Boolean).map(c => String(c).trim().toUpperCase()))]
  const out = { ready: true, byPos: {}, holidays: {} }
  const hq = supabase.from('coolerco_public_holidays').select('holiday_date,name')
  const [hol, ...parts] = await Promise.all([
    from ? hq.gte('holiday_date', from).lte('holiday_date', to || from) : hq,
    ...Array.from({ length: Math.ceil(codes.length / 300) }, (_, i) =>
      supabase.from('coolerco_pos_hours').select('pos_local_code,day,closed,open_from,open_to,receive_from,receive_to,receive2_from,receive2_to,note,source,updated_at').in('pos_local_code', codes.slice(i * 300, i * 300 + 300))),
  ])
  if (hol.error) return { ready: false, byPos: {}, holidays: {} }
  for (const h of hol.data || []) out.holidays[h.holiday_date] = h.name
  for (const p of parts) {
    if (p.error) return { ready: false, byPos: {}, holidays: {} }
    for (const r of p.data || []) (out.byPos[r.pos_local_code] ||= []).push(r)
  }
  return out
}

export const STATE_TAG = { ok: 'green', soon: 'orange', before: 'orange', after: 'red', closed: 'red', unknown: 'neutral' }
export const STATE_ICON = { ok: '🟢', soon: '🟠', before: '🕘', after: '🔴', closed: '⛔', unknown: '❔' }
