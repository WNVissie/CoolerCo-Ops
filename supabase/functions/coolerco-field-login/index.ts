// CoolerCo-Ops · Edge Function "coolerco-field-login"
// Supervisors / planners create or reset the SmartHub login of a field slot (driver / technician) from the Crew screen.
//  · email given → that email; no email → "<username>@field.smartpartners.co.za" (no mailbox; the person signs in
//    with just the username — the app adds the domain)
//  · the login is confirmed straight away and linked to the slot; the person's name is stored on the account
// Only callers for whom coolerco_is_planner() is true may use it. The service key never leaves the server.
import { createClient } from 'npm:@supabase/supabase-js@2'

const FIELD_DOMAIN = 'field.smartpartners.co.za'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405)
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization') || ''
  const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } })
  const { data: isPlanner, error: pe } = await asUser.rpc('coolerco_is_planner')
  if (pe || !isPlanner) return reply({ error: 'Only supervisors / planners can create field logins' }, 403)

  let body: { slot_id?: string; username?: string; email?: string; password?: string }
  try { body = await req.json() } catch { return reply({ error: 'Bad request' }, 400) }
  const password = String(body.password || '')
  if (!body.slot_id) return reply({ error: 'slot_id is required' }, 400)
  if (password.length < 8) return reply({ error: 'Password must be at least 8 characters' }, 400)

  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: slot, error: se } = await admin.from('coolerco_field_slots').select('id,person_name,routeiq_username,user_id,warehouse_code,worker_type,slot_no').eq('id', body.slot_id).maybeSingle()
  if (se || !slot) return reply({ error: 'Slot not found' }, 404)

  const username = String(body.username || slot.routeiq_username || `${slot.warehouse_code}-${slot.worker_type === 'driver' ? 'D' : 'T'}${slot.slot_no}`).trim().toLowerCase()
  const email = (String(body.email || '').trim() || `${username}@${FIELD_DOMAIN}`).toLowerCase()
  const meta = { first_name: (slot.person_name || '').split(' ')[0] || username, last_name: (slot.person_name || '').split(' ').slice(1).join(' '), field_slot: slot.id }

  // existing login on the slot → reset its password (and email if a new one was given)
  if (slot.user_id) {
    const upd: Record<string, unknown> = { password, user_metadata: meta }
    if (String(body.email || '').trim()) { upd.email = email; upd.email_confirm = true } // keep the current email unless a new one is given
    const { data: u, error } = await admin.auth.admin.updateUserById(slot.user_id, upd)
    if (error) return reply({ error: error.message }, 400)
    const cur = (u?.user?.email || email).toLowerCase()
    return reply({ ok: true, action: 'reset', email: cur, username: cur.endsWith('@' + FIELD_DOMAIN) ? cur.split('@')[0] : null })
  }
  const { data: created, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta })
  if (ce || !created?.user) return reply({ error: ce?.message || 'Could not create the login' }, 400)
  const { error: le } = await admin.from('coolerco_field_slots').update({ user_id: created.user.id, updated_at: new Date().toISOString() }).eq('id', slot.id)
  if (le) return reply({ error: le.message }, 400)
  return reply({ ok: true, action: 'created', email, username: email.endsWith('@' + FIELD_DOMAIN) ? username : null })
})
