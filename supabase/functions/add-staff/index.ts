// Edge Function: the owner adds a person to the shop by phone number, or resets their PIN.
// Runs with the service role, so it checks for itself that the caller is the shop's owner.
// Deploy:  supabase functions deploy add-staff
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'content-type': 'application/json'
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors })

const PHONE = /^254[17]\d{8}$/ // 2547XXXXXXXX or 2541XXXXXXXX
const email = (phone: string) => `${phone}@hesabu.app`
const password = (pin: string) => `hs-${pin}` // Supabase needs 6+ characters; the PIN itself is 6 digits in the app

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '')
  const { data: who } = await admin.auth.getUser(token)
  if (!who?.user) return reply({ error: 'Not signed in' }, 401)

  let b: { action?: string; shopId?: string; name?: string; phone?: string; role?: string; pin?: string }
  try {
    b = await req.json()
  } catch {
    return reply({ error: 'Bad request' }, 400)
  }

  const { data: me } = await admin.from('members').select('role, active').eq('shop_id', b.shopId ?? '').eq('user_id', who.user.id).maybeSingle()
  if (!me || !me.active || me.role !== 'owner') return reply({ error: 'Only the owner can do this' }, 403)

  const phone = (b.phone ?? '').replace(/\D/g, '')
  if (!PHONE.test(phone)) return reply({ error: 'Enter a Kenyan phone number' }, 400)
  const pin = b.pin ?? ''
  if (!/^\d{6}$/.test(pin)) return reply({ error: 'The PIN must be 6 digits' }, 400)

  if (b.action === 'reset-pin') {
    const { data: m } = await admin.from('members').select('user_id, role').eq('shop_id', b.shopId!).eq('phone', phone).maybeSingle()
    if (!m || m.role === 'owner') return reply({ error: 'Person not found' }, 404)
    // A person who belongs to several shops has one login: only reset the PIN if this is the only shop they are in.
    const { count } = await admin.from('members').select('*', { count: 'exact', head: true }).eq('user_id', m.user_id)
    if ((count ?? 0) > 1) return reply({ error: 'This person uses Hesabu in more than one shop, so they must change their own PIN.' }, 409)
    const { error } = await admin.auth.admin.updateUserById(m.user_id, { password: password(pin) })
    return error ? reply({ error: 'Could not reset the PIN' }, 500) : reply({ ok: true })
  }

  // action: add
  const name = (b.name ?? '').trim()
  if (name.length < 2) return reply({ error: 'Enter a name' }, 400)
  if (b.role !== 'manager' && b.role !== 'attendant') return reply({ error: 'Bad role' }, 400)

  let userId: string | null = null
  let existing = false
  const created = await admin.auth.admin.createUser({ email: email(phone), password: password(pin), email_confirm: true })
  if (created.data?.user) {
    userId = created.data.user.id
  } else {
    // Already has a Hesabu login (for example the developer joining as staff). Keep their own PIN.
    const { data: id } = await admin.rpc('user_by_phone', { p_phone: phone })
    if (!id) return reply({ error: 'Could not create the login' }, 500)
    userId = id as string
    existing = true
  }

  const { error } = await admin
    .from('members')
    .upsert({ shop_id: b.shopId, user_id: userId, role: b.role, name, phone, active: true }, { onConflict: 'shop_id,user_id' })
  if (error) return reply({ error: 'Could not add the person' }, 500)
  return reply({ ok: true, existing })
})
