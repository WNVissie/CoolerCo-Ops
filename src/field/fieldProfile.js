import { supabase } from '../lib/supabase'

// Who is signed in on this phone (script 034): the field slot's real name, warehouse, RouteIQ name; planner or not.
// Kept on the phone so the greeting and "my routes" work without signal.
export async function loadProfile() {
  try {
    if (!navigator.onLine) throw new Error('offline')
    const { data, error } = await supabase.rpc('coolerco_my_field_profile')
    if (error) throw error
    localStorage.setItem('cc_field_profile', JSON.stringify(data))
    localStorage.setItem('cc_field_034', '1')
    return data
  } catch (e) {
    if (/function .* does not exist|PGRST202|404/i.test(String(e?.message || e?.code || ''))) localStorage.setItem('cc_field_034', '0')
    try { return JSON.parse(localStorage.getItem('cc_field_profile')) } catch { return null }
  }
}
export const has034 = () => localStorage.getItem('cc_field_034') === '1'

// A positive line for the day — same line all day, a new one tomorrow (written for CoolerCo, no famous quotes)
const QUOTES = [
  'Every cooler you deliver keeps a shop open and a customer happy.',
  'Small checks save big trips. Scan it, sign it, done.',
  'You are the face of the company at every store today.',
  'One stop at a time — steady wins the route.',
  'A clean job card today means no phone calls tomorrow.',
  'Safe driving first. The route will wait; your family is waiting too.',
  'Good work is quiet: the right asset, the right store, the right time.',
  'Smile at the store — it makes the next visit easier.',
  'Your care with every asset keeps the whole team moving.',
  'Today is a fresh route. Make it a good one.',
  'Double-check the barcode — it takes ten seconds and saves a day.',
  'The best routes are planned well and driven calmly.',
  'Helping a shop owner today helps a whole community.',
  'Ask for help when you need it — that is what the team is for.',
  'Every completed stop is a promise kept.',
  'Take your break. A rested driver is a safe driver.',
  'Proud work, honest notes, safe roads.',
  'You make the plan real. Thank you for showing up.',
  'Small things done well add up to a great day.',
  'Leave every store better than you found it.',
  'Patience at a busy store is a skill — and you have it.',
  'Good photos tell the story when you are already on the next stop.',
  'Today: arrive, complete, smile, repeat.',
  'Teamwork turns long routes into short days.',
  'Your attention to detail is what customers remember.',
  'Drive like your loved ones are on the road with you.',
  'A tidy truck is a quick truck.',
  'Well done yesterday. Let us do even better today.',
  'Every route starts with the first stop — let us go.',
  'Thank you for the work nobody sees but everybody needs.',
]
export function quoteOfTheDay(d = new Date()) {
  const n = Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 864e5)
  return QUOTES[((n % QUOTES.length) + QUOTES.length) % QUOTES.length]
}
