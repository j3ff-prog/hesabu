// The Hesabu registry: remembers which shops use the app, and lets you manage them.
// Shops send totals only (name, owner number, counts). No sales, customers or prices.

export interface Env {
  DB: D1Database
  ADMIN_KEY: string // set with:  npx wrangler secret put ADMIN_KEY
  ALLOWED_ORIGIN?: string // optional: your app's address, e.g. https://hesabu.pages.dev
}

// Minimal D1 shape so this file also runs in tests.
interface D1Database {
  prepare(sql: string): {
    bind(...v: unknown[]): {
      first<T = unknown>(): Promise<T | null>
      all<T = unknown>(): Promise<{ results: T[] }>
      run(): Promise<unknown>
    }
  }
}

const STATUSES = ['trial', 'active', 'suspended']

const cors = (env: Env, req: Request): Record<string, string> => ({
  'access-control-allow-origin': env.ALLOWED_ORIGIN || req.headers.get('origin') || '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  vary: 'origin'
})

const json = (data: unknown, status: number, h: Record<string, string>): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...h } })

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1e12, Math.round(v))) : 0)

/** Constant-time comparison so the key can't be guessed by timing. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export async function handle(req: Request, env: Env, now = Date.now()): Promise<Response> {
  const h = cors(env, req)
  const url = new URL(req.url)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h })

  // A shop checks in. It gets back its subscription state.
  if (url.pathname === '/api/beat' && req.method === 'POST') {
    const raw = await req.text()
    if (raw.length > 4000) return json({ error: 'too large' }, 413, h)
    let b: Record<string, unknown>
    try {
      b = JSON.parse(raw)
    } catch {
      return json({ error: 'bad json' }, 400, h)
    }
    const id = text(b.id, 64)
    const shop = text(b.shop, 80)
    if (!/^[0-9a-f-]{16,64}$/i.test(id) || shop.length < 2) return json({ error: 'bad request' }, 400, h)
    const owner = text(b.owner, 15).replace(/\D/g, '')
    const last = typeof b.lastSale === 'number' && Number.isFinite(b.lastSale) ? Math.round(b.lastSale) : null

    await env.DB.prepare(
      `INSERT INTO shops (id, shop, owner, products, users, sales30, revenue30, lastSale, firstSeen, lastSeen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET shop=excluded.shop, owner=excluded.owner, products=excluded.products,
         users=excluded.users, sales30=excluded.sales30, revenue30=excluded.revenue30,
         lastSale=excluded.lastSale, lastSeen=excluded.lastSeen`
    )
      .bind(id, shop, owner, count(b.products), count(b.users), count(b.sales30), count(b.revenue30), last, now, now)
      .run()

    const row = await env.DB.prepare('SELECT status, paidUntil, message FROM shops WHERE id = ?').bind(id).first<{
      status: string
      paidUntil: number | null
      message: string
    }>()
    // A paid shop whose date has passed is treated as ended (the admin sets the date; no manual chasing needed).
    let status = row?.status ?? 'trial'
    if (status === 'active' && row?.paidUntil && row.paidUntil < now) status = 'suspended'
    return json({ status, paidUntil: row?.paidUntil ?? null, message: row?.message || null }, 200, h)
  }

  // Everything below is for you only.
  if (url.pathname.startsWith('/api/admin/')) {
    const auth = req.headers.get('authorization') ?? ''
    const key = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!env.ADMIN_KEY || env.ADMIN_KEY.length < 8 || !same(key, env.ADMIN_KEY)) return json({ error: 'unauthorized' }, 401, h)

    if (url.pathname === '/api/admin/shops' && req.method === 'GET') {
      const r = await env.DB.prepare('SELECT * FROM shops ORDER BY lastSeen DESC LIMIT 5000').bind().all()
      return json({ shops: r.results }, 200, h)
    }

    if (url.pathname === '/api/admin/shop' && req.method === 'POST') {
      let b: Record<string, unknown>
      try {
        b = JSON.parse(await req.text())
      } catch {
        return json({ error: 'bad json' }, 400, h)
      }
      const id = text(b.id, 64)
      const status = text(b.status, 12)
      if (!id || !STATUSES.includes(status)) return json({ error: 'bad request' }, 400, h)
      const paidUntil = typeof b.paidUntil === 'number' && Number.isFinite(b.paidUntil) ? Math.round(b.paidUntil) : null
      const res = await env.DB.prepare('UPDATE shops SET status=?, plan=?, paidUntil=?, note=?, message=? WHERE id=?')
        .bind(status, text(b.plan, 60), paidUntil, text(b.note, 500), text(b.message, 200), id)
        .run()
      return json({ ok: true, res: !!res }, 200, h)
    }
  }

  return json({ error: 'not found' }, 404, h)
}

export default {
  fetch: (req: Request, env: Env): Promise<Response> => handle(req, env)
}
