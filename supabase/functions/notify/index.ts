// Edge Function "notify": sends phone notifications.
//  - A sale was recorded: tell the shop's owner and managers (not the person who made it).
//  - A support message was sent: the admin hears about a shop's message, a shop hears about the admin's reply.
// Deploy with "Verify JWT" OFF (the database calls it). Secrets needed: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
// Each notification is sent once: the row is marked first, so repeated calls do nothing.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import webpush from 'npm:web-push@3.6.7'

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } })

const money = (n: number) => Math.round(n).toLocaleString('en-KE')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  const pub = Deno.env.get('VAPID_PUBLIC_KEY')
  const priv = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!pub || !priv) return reply({ error: 'Not set up' }, 500)

  // deno-lint-ignore no-explicit-any
  let b: any
  try {
    b = await req.json()
  } catch {
    return reply({ error: 'Bad request' }, 400)
  }
  // The app asks for the public key so nothing has to be pasted into the code.
  if (b.action === 'key') return reply({ key: pub })

  const id = String(b.id ?? '')
  if (!/^[0-9a-f-]{36}$/.test(id)) return reply({ error: 'Bad id' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  webpush.setVapidDetails('mailto:nexus.softwareske@gmail.com', pub, priv)

  let userIds: string[] = []
  let payload: { title: string; body: string; url: string } | null = null

  if (b.type === 'sale') {
    // Claim it: only the first call for a recent sale goes through.
    const { data: s } = await admin
      .from('sales')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', id)
      .is('notified_at', null)
      .gt('created_at', new Date(Date.now() - 3 * 3600_000).toISOString())
      .select('shop_id, total, by_user, by_name, method, customer')
      .maybeSingle()
    if (!s) return reply({ ok: true })
    const { data: shop } = await admin.from('shops').select('name').eq('id', s.shop_id).maybeSingle()
    const { data: ms } = await admin.from('members').select('user_id').eq('shop_id', s.shop_id).eq('active', true).in('role', ['owner', 'manager'])
    userIds = (ms ?? []).map((m: { user_id: string }) => m.user_id).filter((u: string) => u !== s.by_user)
    const how = s.method === 'credit' ? 'on credit' : s.method === 'mpesa' ? 'by M-Pesa' : 'in cash'
    payload = {
      title: shop?.name ?? 'Tallyfy',
      body: `${s.by_name || 'Someone'} sold KES ${money(Number(s.total))} ${how}${s.customer ? ` to ${s.customer}` : ''}`,
      url: './#/reports'
    }
  } else if (b.type === 'support') {
    const { data: m } = await admin
      .from('support_messages')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', id)
      .is('notified_at', null)
      .select('shop_id, from_admin, body, sender')
      .maybeSingle()
    if (!m) return reply({ ok: true })
    if (m.from_admin) {
      const { data: ms } = await admin.from('members').select('user_id').eq('shop_id', m.shop_id).eq('active', true).in('role', ['owner', 'manager'])
      userIds = (ms ?? []).map((x: { user_id: string }) => x.user_id)
      payload = { title: 'Tallyfy support replied', body: m.body.slice(0, 120), url: './#/' }
    } else {
      const { data: as } = await admin.from('platform_admins').select('user_id')
      userIds = (as ?? []).map((x: { user_id: string }) => x.user_id)
      const { data: shop } = await admin.from('shops').select('name').eq('id', m.shop_id).maybeSingle()
      payload = { title: `Support: ${shop?.name ?? 'a shop'}`, body: m.body.slice(0, 120), url: './#/admin' }
    }
  } else {
    return reply({ error: 'Unknown type' }, 400)
  }

  if (userIds.length === 0 || !payload) return reply({ ok: true, sent: 0 })
  const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth').in('user_id', userIds)
  let sent = 0
  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload))
      sent++
    } catch (e) {
      // A phone that has turned notifications off or uninstalled the app: forget it.
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    }
  }
  return reply({ ok: true, sent })
})
