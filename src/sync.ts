import { useSyncExternalStore } from 'react'
import { ApiError, type Api, type Row, type SyncTable } from './cloudApi'
import { db, type Closing, type Customer, type Expense, type Payment, type Product, type Role, type Sale } from './db'

/** Keeps this phone and the server in step. Works offline: everything is saved here first and sent when there is signal. */

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'blocked'
export interface SyncStatus {
  state: SyncState
  pending: number
  last: number // when the last full round finished
  error: string
}

let status: SyncStatus = { state: 'idle', pending: 0, last: 0, error: '' }
const listeners = new Set<() => void>()
const set = (p: Partial<SyncStatus>): void => {
  status = { ...status, ...p }
  listeners.forEach((l) => l())
}
export const useSyncStatus = (): SyncStatus =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => status
  )

const iso = (ms: number): string => new Date(ms).toISOString()
const ms = (s: unknown): number => new Date(s as string).getTime()
const num = (v: unknown): number => Number(v ?? 0)

async function getCursor(t: string): Promise<string | null> {
  return (await db.meta.get(`cur:${t}`))?.value ?? null
}
const setCursor = (t: string, v: string): Promise<unknown> => db.meta.put({ key: `cur:${t}`, value: v })

export async function countPending(): Promise<number> {
  const [a, b, c, d, e, f, g] = await Promise.all([
    db.products.where('dirty').equals(1).count(),
    db.sales.where('dirty').equals(1).count(),
    db.payments.where('dirty').equals(1).count(),
    db.customers.where('dirty').equals(1).count(),
    db.expenses.where('dirty').equals(1).count(),
    db.closings.where('dirty').equals(1).count(),
    db.deletions.count()
  ])
  return a + b + c + d + e + f + g
}

/**
 * Items sold or bought on this phone that the server has not heard about yet. The server will take these off or add them
 * to its own stock figure when they arrive, so they are kept out of the number we send and put back on the number we get.
 */
async function pendingStock(): Promise<Map<string, number>> {
  const delta = new Map<string, number>()
  const add = (id: string, n: number) => delta.set(id, (delta.get(id) ?? 0) + n)
  for (const s of await db.sales.where('dirty').equals(1).toArray()) {
    for (const l of s.lines) {
      if (l.service) continue
      if (!s.sent && !s.voidedAt) add(l.productId, -l.qty)
      else if (s.sent && s.voidedAt) add(l.productId, l.qty)
    }
  }
  for (const e of await db.expenses.where('dirty').equals(1).toArray()) {
    if (e.sent) continue
    for (const i of e.items ?? []) add(i.productId, i.qty)
  }
  return delta
}

// ---------- Upload ----------

async function clean<T extends { dirty?: 0 | 1; rev?: number }>(
  table: { update: (k: never, c: object) => Promise<unknown>; get: (k: never) => Promise<T | undefined> },
  key: unknown,
  rev: number | undefined,
  extra: object = {}
): Promise<void> {
  const cur = await table.get(key as never)
  if (cur && (cur.rev ?? 0) === (rev ?? 0)) await table.update(key as never, { dirty: 0, ...extra })
  else if (cur && Object.keys(extra).length) await table.update(key as never, extra)
}

async function push(api: Api, shopId: string, role: Role): Promise<void> {
  const money = role === 'owner' || role === 'manager'
  const stockDelta = await pendingStock()

  const products = await db.products.where('dirty').equals(1).toArray()
  if (products.length) {
    await api.upsert(
      'products',
      products.map((p) => ({
        id: p.id, shop_id: shopId, name: p.name, price: p.price, kind: p.kind ?? 'goods',
        stock: p.stock - (stockDelta.get(p.id) ?? 0), low_at: p.lowAt, created_at: iso(p.createdAt)
      })),
      'id', false
    )
    if (money) {
      await api.upsert('product_costs', products.map((p) => ({ product_id: p.id, shop_id: shopId, cost: p.cost })), 'product_id', false)
    }
    for (const p of products) await clean<Product>(db.products as never, p.id, p.rev)
  }

  for (const s of await db.sales.where('dirty').equals(1).toArray()) {
    if (!s.sent) {
      await api.pushSale(
        { id: s.id, shop_id: shopId, created_at: iso(s.createdAt), method: s.method, customer: s.customer ?? '', total: s.total, by_user: s.by, by_name: s.byName ?? '' },
        s.lines.map((l) => ({ id: l.id, product_id: l.productId, name: l.name, qty: l.qty, price: l.price, service: !!l.service }))
      )
    }
    if (s.voidedAt) await api.voidSale(s.id, iso(s.voidedAt))
    await clean<Sale>(db.sales as never, s.id, s.rev, { sent: 1 })
  }

  const expenses = await db.expenses.where('dirty').equals(1).toArray()
  if (expenses.length) {
    await api.upsert(
      'expenses',
      expenses.map((e) => ({
        id: e.id, shop_id: shopId, amount: e.amount, note: e.note, category: e.category, method: e.method,
        items: e.items ?? null, created_at: iso(e.createdAt), by_user: e.by, by_name: e.byName ?? ''
      })),
      'id', true
    )
    for (const e of expenses) await clean<Expense>(db.expenses as never, e.id, e.rev, { sent: 1 })
  }

  const payments = await db.payments.where('dirty').equals(1).toArray()
  if (payments.length) {
    await api.upsert(
      'payments',
      payments.map((p) => ({
        id: p.id, shop_id: shopId, customer_key: p.customerKey, customer: p.customer, amount: p.amount,
        method: p.method, created_at: iso(p.createdAt), by_user: p.by, by_name: p.byName ?? ''
      })),
      'id', true
    )
    for (const p of payments) await clean<Payment>(db.payments as never, p.id, p.rev)
  }

  const customers = await db.customers.where('dirty').equals(1).toArray()
  if (customers.length) {
    await api.upsert('customers', customers.map((c) => ({ shop_id: shopId, key: c.key, name: c.name, phone: c.phone ?? null })), 'shop_id,key', false)
    for (const c of customers) await clean<Customer>(db.customers as never, c.key, c.rev)
  }

  const closings = await db.closings.where('dirty').equals(1).toArray()
  if (closings.length) {
    await api.upsert(
      'closings',
      closings.map((c) => ({
        shop_id: shopId, day: String(c.day), started: c.started, expected: c.expected, counted: c.counted, diff: c.diff, created_at: iso(c.createdAt)
      })),
      'shop_id,day', false
    )
    for (const c of closings) await clean<Closing>(db.closings as never, c.day, c.rev)
  }

  for (const d of await db.deletions.toArray()) {
    await api.softDelete(d.table, d.rowId)
    await db.deletions.delete(d.id)
  }
}

// ---------- Download ----------

async function pullAll(api: Api, shopId: string, role: Role): Promise<void> {
  const money = role === 'owner' || role === 'manager'
  const stockDelta = await pendingStock()

  const each = async (table: SyncTable, apply: (rows: Row[]) => Promise<void>) => {
    for (;;) {
      const since = await getCursor(table)
      const rows = await api.pull(shopId, table, since)
      if (rows.length === 0) return
      await apply(rows)
      const last = rows[rows.length - 1].updated_at as string
      await setCursor(table, last)
      if (rows.length < 500 || last === since) return
    }
  }

  await each('products', async (rows) => {
    await db.transaction('rw', db.products, async () => {
      for (const r of rows) {
        const id = r.id as string
        const cur = await db.products.get(id)
        if (cur?.dirty) continue
        if (r.deleted_at) {
          if (cur) await db.products.delete(id)
          continue
        }
        await db.products.put({
          id, name: r.name as string, price: num(r.price), kind: r.kind === 'service' ? 'service' : undefined,
          stock: num(r.stock) + (stockDelta.get(id) ?? 0), lowAt: num(r.low_at), createdAt: ms(r.created_at),
          cost: cur?.cost ?? 0, dirty: 0, rev: cur?.rev ?? 0
        })
      }
    })
  })

  if (money) {
    await each('product_costs', async (rows) => {
      await db.transaction('rw', db.products, async () => {
        for (const r of rows) {
          const cur = await db.products.get(r.product_id as string)
          if (cur && !cur.dirty) await db.products.update(cur.id, { cost: num(r.cost) })
        }
      })
    })
  }

  await each('customers', async (rows) => {
    await db.transaction('rw', db.customers, async () => {
      for (const r of rows) {
        const key = r.key as string
        if ((await db.customers.get(key))?.dirty) continue
        await db.customers.put({ key, name: r.name as string, phone: (r.phone as string | null) ?? undefined, dirty: 0 })
      }
    })
  })

  await each('payments', async (rows) => {
    await db.transaction('rw', db.payments, async () => {
      for (const r of rows) {
        const id = r.id as string
        const cur = await db.payments.get(id)
        if (cur?.dirty) continue
        if (r.deleted_at) {
          if (cur) await db.payments.delete(id)
          continue
        }
        await db.payments.put({
          id, customerKey: r.customer_key as string, customer: r.customer as string, amount: num(r.amount),
          method: r.method as 'cash' | 'mpesa', createdAt: ms(r.created_at), by: r.by_user as string, byName: r.by_name as string, dirty: 0
        })
      }
    })
  })

  if (money) {
    await each('expenses', async (rows) => {
      await db.transaction('rw', db.expenses, async () => {
        for (const r of rows) {
          const id = r.id as string
          const cur = await db.expenses.get(id)
          if (cur?.dirty) continue
          if (r.deleted_at) {
            if (cur) await db.expenses.delete(id)
            continue
          }
          await db.expenses.put({
            id, amount: num(r.amount), note: r.note as string, category: r.category as string, method: r.method as 'cash' | 'mpesa',
            createdAt: ms(r.created_at), items: (r.items as Expense['items']) ?? undefined, by: r.by_user as string,
            byName: r.by_name as string, dirty: 0, sent: 1
          })
        }
      })
    })
  }

  await each('sales', async (rows) => {
    const need: string[] = []
    for (const r of rows) {
      if (!(await db.sales.get(r.id as string))) need.push(r.id as string)
    }
    const { lines, costs } = await api.pullLines(need)
    const costOf = new Map(costs.map((c) => [c.line_id as string, num(c.cost)]))
    const linesOf = new Map<string, Row[]>()
    for (const l of lines) {
      const k = l.sale_id as string
      linesOf.set(k, [...(linesOf.get(k) ?? []), l])
    }
    await db.transaction('rw', db.sales, async () => {
      for (const r of rows) {
        const id = r.id as string
        const cur = await db.sales.get(id)
        if (cur?.dirty) continue
        const voidedAt = r.voided_at ? ms(r.voided_at) : undefined
        if (cur) {
          if (cur.voidedAt !== voidedAt) await db.sales.update(id, { voidedAt, sent: 1 })
          continue
        }
        await db.sales.put({
          id, createdAt: ms(r.created_at), method: r.method as Sale['method'], customer: (r.customer as string | null) ?? undefined,
          total: num(r.total), voidedAt, by: r.by_user as string, byName: r.by_name as string, dirty: 0, sent: 1,
          lines: (linesOf.get(id) ?? []).map((l) => ({
            id: l.id as string, productId: (l.product_id as string | null) ?? '', name: l.name as string, qty: num(l.qty),
            price: num(l.price), cost: costOf.get(l.id as string) ?? 0, ...(l.service ? { service: true } : {})
          }))
        })
      }
    })
  })

  if (money) {
    await each('closings', async (rows) => {
      await db.transaction('rw', db.closings, async () => {
        for (const r of rows) {
          const day = Number(r.day)
          if ((await db.closings.get(day))?.dirty) continue
          await db.closings.put({
            day, started: num(r.started), expected: num(r.expected), counted: num(r.counted), diff: num(r.diff),
            createdAt: ms(r.created_at), dirty: 0
          })
        }
      })
    })
  }
}

// ---------- The loop ----------

export interface SyncHandle {
  stop: () => void
  now: () => Promise<void>
}

export function startSync(api: Api, shopId: string, role: Role, onDenied?: () => void): SyncHandle {
  let running = false
  let again = false
  let stopped = false
  let timer: number | undefined

  const run = async (): Promise<void> => {
    if (stopped) return
    if (running) {
      again = true
      return
    }
    running = true
    set({ state: 'syncing' })
    try {
      await push(api, shopId, role)
      await pullAll(api, shopId, role)
      set({ state: 'idle', error: '', last: Date.now(), pending: await countPending() })
    } catch (e) {
      const pending = await countPending()
      if (e instanceof ApiError && e.code === 'network') set({ state: 'offline', pending })
      else if (e instanceof ApiError && e.code === 'denied') {
        set({ state: 'blocked', pending, error: e.message })
        onDenied?.()
      } else set({ state: 'error', pending, error: e instanceof Error ? e.message : 'Sync failed' })
    } finally {
      running = false
      if (again && !stopped) {
        again = false
        void run()
      }
    }
  }

  const onChange = () => {
    void countPending().then((pending) => set({ pending }))
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void run(), 1500)
  }
  const onOnline = () => void run()
  window.addEventListener('hesabu-local-change', onChange)
  window.addEventListener('online', onOnline)
  const tick = window.setInterval(() => void run(), 30_000)
  void countPending().then((pending) => set({ pending }))
  void run()

  return {
    stop: () => {
      stopped = true
      window.removeEventListener('hesabu-local-change', onChange)
      window.removeEventListener('online', onOnline)
      window.clearInterval(tick)
      window.clearTimeout(timer)
      set({ state: 'idle', pending: 0, last: 0, error: '' })
    },
    now: run
  }
}
