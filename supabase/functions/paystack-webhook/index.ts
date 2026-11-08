// Edge Function: Paystack tells us a payment succeeded; we extend that shop's subscription.
// Deploy with "Verify JWT" switched OFF (Paystack does not send a Tallyfy login).
// Secret needed: PAYSTACK_SECRET_KEY (Edge Functions > Secrets). Webhook URL goes into Paystack settings.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

async function signature(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
}

/** 0712 345 678, +254712345678 and 254712345678 all become 254712345678. */
function toWa(input: string): string {
  const d = input.replace(/\D/g, '')
  if (/^0[17]\d{8}$/.test(d)) return '254' + d.slice(1)
  if (/^[17]\d{8}$/.test(d)) return '254' + d
  if (/^254[17]\d{8}$/.test(d)) return d
  return ''
}

// deno-lint-ignore no-explicit-any
function phoneFrom(data: any): string {
  const fields = [...(data?.metadata?.custom_fields ?? []), ...(data?.custom_fields ?? [])]
  // deno-lint-ignore no-explicit-any
  for (const f of fields as any[]) {
    const label = `${f?.display_name ?? ''} ${f?.variable_name ?? ''}`.toLowerCase()
    if (label.includes('phone') || label.includes('number')) {
      const p = toWa(String(f?.value ?? ''))
      if (p) return p
    }
  }
  return toWa(String(data?.customer?.phone ?? ''))
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  const secret = Deno.env.get('PAYSTACK_SECRET_KEY')
  if (!secret) return new Response('Not set up', { status: 500 })

  const body = await req.text()
  if ((req.headers.get('x-paystack-signature') ?? '') !== (await signature(body, secret))) return new Response('Bad signature', { status: 401 })

  let ev: { event?: string; data?: Record<string, unknown> }
  try {
    ev = JSON.parse(body)
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  // Only successful charges matter. Everything else is acknowledged and ignored.
  if (ev.event !== 'charge.success' || !ev.data) return new Response('ok')
  if (ev.data.currency && ev.data.currency !== 'KES') return new Response('ok')

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { error } = await admin.rpc('record_payment', {
    p_ref: String(ev.data.reference ?? ev.data.id ?? ''),
    p_phone: phoneFrom(ev.data),
    p_amount: Number(ev.data.amount ?? 0) / 100, // Paystack sends the smallest unit (cents)
    p_raw: ev.data
  })
  // A real failure returns 500 so Paystack tries again later.
  if (error) return new Response('Could not record', { status: 500 })
  return new Response('ok')
})
