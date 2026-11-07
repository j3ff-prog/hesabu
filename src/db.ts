import Dexie, { type EntityTable } from 'dexie'

export type Method = 'cash' | 'mpesa' | 'credit'
export type Role = 'owner' | 'manager' | 'attendant'

/**
 * Every record has an id made on the device (a uuid), so phones never clash.
 * `dirty` = changed here and not yet uploaded. `rev` goes up on every local change, so an upload only
 * clears `dirty` if nothing changed while it was in flight.
 */
interface Synced {
  dirty?: 0 | 1
  rev?: number
}

export interface Product extends Synced {
  id: string
  name: string
  price: number // selling price
  cost: number // buying price, 0 if unknown (attendants never receive it)
  stock: number
  lowAt: number // warn when stock is at or below this
  createdAt: number
  /** 'service' = food you make or a service you give: no stock count, no buying price. Missing means goods. */
  kind?: 'goods' | 'service'
}

export const isService = (p: { kind?: string }): boolean => p.kind === 'service'

export interface SaleLine {
  id: string
  service?: boolean // food or a service: counted as income, costs come from expenses
  productId: string
  name: string
  qty: number
  price: number
  cost: number
}

export interface Payment extends Synced {
  id: string
  customerKey: string
  customer: string
  amount: number
  method: 'cash' | 'mpesa'
  createdAt: number
  by?: string // user id
  byName?: string
}

export interface Customer extends Synced {
  key: string
  name: string
  phone?: string // saved as 2547XXXXXXXX
}

export const CATEGORIES = ['New stock', 'Ingredients', 'Transport', 'Rent', 'Electricity', 'Salary', 'Other'] as const
export const STOCK_CATEGORY = 'New stock'

/** One product bought in a "New stock" expense. */
export interface RestockLine {
  productId: string
  name: string
  qty: number
  cost: number // buying price per item
}

export interface Expense extends Synced {
  id: string
  amount: number
  note: string
  category: string
  method: 'cash' | 'mpesa'
  createdAt: number
  items?: RestockLine[] // set when the expense bought new stock
  sent?: 1 // the server has received this expense
  by?: string
  byName?: string
}

/** The cash count at the end of a day. One per day, keyed by the day's start time. */
export interface Closing extends Synced {
  day: number
  started: number // cash in the till at the start of the day
  expected: number // what the till should hold
  counted: number // what was actually counted
  diff: number // counted - expected (negative = short)
  createdAt: number
}

export interface Sale extends Synced {
  id: string
  createdAt: number
  method: Method
  customer?: string
  total: number
  lines: SaleLine[]
  sent?: 1 // the server has received this sale
  cash?: number // how much was paid in cash, by M-Pesa, and left on credit (missing on older sales)
  mpesa?: number
  credit?: number
  dueAt?: number // when a credit is to be paid
  voidedAt?: number
  by?: string
  byName?: string
}

/** Something deleted here that the server still has. */
export interface Deletion {
  id: string // "table:rowId"
  table: 'products' | 'payments' | 'expenses'
  rowId: string
}

export interface Meta {
  key: string
  value: string
}

export class HesabuDB extends Dexie {
  products!: EntityTable<Product, 'id'>
  sales!: EntityTable<Sale, 'id'>
  payments!: EntityTable<Payment, 'id'>
  customers!: EntityTable<Customer, 'key'>
  expenses!: EntityTable<Expense, 'id'>
  closings!: EntityTable<Closing, 'day'>
  deletions!: EntityTable<Deletion, 'id'>
  meta!: EntityTable<Meta, 'key'>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      products: 'id, name, dirty',
      sales: 'id, createdAt, method, dirty',
      payments: 'id, customerKey, createdAt, dirty',
      customers: 'key, dirty',
      expenses: 'id, createdAt, category, dirty',
      closings: 'day, dirty',
      deletions: 'id',
      meta: 'key'
    })
  }
}

/** Each shop has its own database on the device, so someone who belongs to two shops never mixes them up. */
export let db: HesabuDB = new HesabuDB('hesabu-none')
export function openShopDb(shopId: string): HesabuDB {
  if (db.name !== `hesabu-${shopId}`) {
    db.close()
    db = new HesabuDB(`hesabu-${shopId}`)
  }
  return db
}

export const newId = (): string => crypto.randomUUID()

/** Who is using the app right now, so records say who made them. */
let actor: { id: string; name: string } | null = null
export const setActor = (a: { id: string; name: string } | null): void => {
  actor = a
}
const who = () => (actor ? { by: actor.id, byName: actor.name } : {})

/** Tells the sync engine something changed here. */
export const changed = (): void => {
  window.dispatchEvent(new Event('hesabu-local-change'))
}
const touch = <T extends Synced>(row: T): T => ({ ...row, dirty: 1, rev: (row.rev ?? 0) + 1 })

/** Save a sale and take the items out of stock, all or nothing. */
export async function recordSale(
  lines: Omit<SaleLine, 'id'>[],
  pay: { cash: number; mpesa: number; credit: number },
  customer?: string,
  dueAt?: number
): Promise<{ id: string; total: number }> {
  const method: Method = pay.credit >= pay.cash && pay.credit >= pay.mpesa && pay.credit > 0 ? 'credit' : pay.mpesa > pay.cash ? 'mpesa' : 'cash'
  const total = lines.reduce((sum, l) => sum + l.price * l.qty, 0)
  const id = newId()
  await db.transaction('rw', db.products, db.sales, async () => {
    await db.sales.add(
      touch({
        id,
        createdAt: Date.now(),
        method,
        customer,
        total,
        cash: pay.cash,
        mpesa: pay.mpesa,
        credit: pay.credit,
        ...(pay.credit > 0 && dueAt ? { dueAt } : {}),
        lines: lines.map((l) => ({ ...l, id: newId() })),
        ...who()
      } as Sale)
    )
    for (const l of lines) {
      const p = await db.products.get(l.productId)
      // Stock changes from sales are kept by the server too, so the product row is not marked as changed.
      if (p && !l.service) await db.products.update(l.productId, { stock: p.stock - l.qty })
    }
  })
  changed()
  return { id, total }
}

/** Cancel a sale and put the items back in stock. */
export async function voidSale(id: string): Promise<void> {
  await db.transaction('rw', db.products, db.sales, async () => {
    const sale = await db.sales.get(id)
    if (!sale || sale.voidedAt) return
    await db.sales.put(touch({ ...sale, voidedAt: Date.now() }))
    for (const l of sale.lines) {
      const p = await db.products.get(l.productId)
      if (p && !l.service) await db.products.update(l.productId, { stock: p.stock + l.qty })
    }
  })
  changed()
}

/** One customer = one lowercase, single-spaced name, so "Wanjiku " and "wanjiku" are the same person. */
export const customerKey = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ')

export async function addPayment(customer: string, amount: number, method: 'cash' | 'mpesa'): Promise<string> {
  const id = newId()
  await db.payments.add(
    touch({ id, customerKey: customerKey(customer), customer, amount, method, createdAt: Date.now(), ...who() } as Payment)
  )
  changed()
  return id
}

export async function deletePayment(id: string): Promise<void> {
  await db.transaction('rw', db.payments, db.deletions, async () => {
    await db.payments.delete(id)
    await db.deletions.put({ id: `payments:${id}`, table: 'payments', rowId: id })
  })
  changed()
}

export async function savePhone(key: string, name: string, phone: string): Promise<void> {
  const cur = await db.customers.get(key)
  await db.customers.put(touch({ ...(cur ?? { key, name }), key, name: cur?.name ?? name, phone }))
  changed()
}

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'dirty' | 'rev'>

export async function saveProduct(input: ProductInput, id?: string): Promise<string> {
  if (id) {
    const cur = await db.products.get(id)
    if (cur) await db.products.put(touch({ ...cur, ...input }))
  } else {
    id = newId()
    await db.products.add(touch({ ...input, id, createdAt: Date.now() } as Product))
  }
  changed()
  return id
}

export async function removeProduct(id: string): Promise<void> {
  await db.transaction('rw', db.products, db.deletions, async () => {
    await db.products.delete(id)
    await db.deletions.put({ id: `products:${id}`, table: 'products', rowId: id })
  })
  changed()
}

export interface ExpenseInput {
  amount: number
  note: string
  category: string
  method: 'cash' | 'mpesa'
  items?: RestockLine[]
}

/** Save an expense. If it bought new stock, the stock goes up and each product's buying price is updated. */
export async function addExpense(input: ExpenseInput): Promise<string> {
  const items = input.category === STOCK_CATEGORY ? (input.items ?? []).filter((i) => i.qty > 0) : []
  const id = newId()
  await db.transaction('rw', db.expenses, db.products, async () => {
    await db.expenses.add(
      touch({
        id,
        amount: input.amount,
        note: input.note,
        category: input.category,
        method: input.method,
        createdAt: Date.now(),
        ...(items.length ? { items } : {}),
        ...who()
      } as Expense)
    )
    for (const i of items) {
      const p = await db.products.get(i.productId)
      if (!p || isService(p)) continue
      // The server applies the same change when it receives the expense, so the product is not marked as changed.
      await db.products.update(i.productId, { stock: p.stock + i.qty, ...(i.cost > 0 ? { cost: i.cost } : {}) })
    }
  })
  changed()
  return id
}

/** Remove an expense. If it had bought stock, that stock comes back off the shelf. */
export async function deleteExpense(id: string): Promise<void> {
  await db.transaction('rw', db.expenses, db.products, db.deletions, async () => {
    const e = await db.expenses.get(id)
    if (!e) return
    for (const i of e.items ?? []) {
      const p = await db.products.get(i.productId)
      if (p) await db.products.update(i.productId, { stock: p.stock - i.qty })
    }
    await db.expenses.delete(id)
    await db.deletions.put({ id: `expenses:${id}`, table: 'expenses', rowId: id })
  })
  changed()
}

// ---------- Bulk product upload ----------

export interface ProductRow {
  name: string
  price: number
  cost: number
  stock: number
  lowAt: number
  hasCost: boolean
  hasStock: boolean
  hasLow: boolean
  service: boolean
}

export const productKey = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ')

/** Add new products and (optionally) update the ones that already exist, matched by name. */
export async function importProducts(rows: ProductRow[], updateExisting: boolean): Promise<{ added: number; updated: number; skipped: number }> {
  let added = 0
  let updated = 0
  let skipped = 0
  await db.transaction('rw', db.products, async () => {
    const existing = new Map((await db.products.toArray()).map((p) => [productKey(p.name), p] as const))
    for (const r of rows) {
      const found = existing.get(productKey(r.name))
      if (found) {
        if (!updateExisting) {
          skipped++
          continue
        }
        await db.products.put(
          touch({
            ...found,
            price: r.price,
            kind: r.service ? 'service' : 'goods',
            ...(r.hasCost ? { cost: r.cost } : {}),
            ...(r.hasStock ? { stock: r.stock } : {}),
            ...(r.hasLow ? { lowAt: r.lowAt } : {})
          })
        )
        updated++
      } else {
        const p = touch({
          id: newId(),
          name: r.name,
          price: r.price,
          cost: r.cost,
          stock: r.stock,
          lowAt: r.hasLow ? r.lowAt : 5,
          ...(r.service ? { kind: 'service' as const } : {}),
          createdAt: Date.now()
        } as Product)
        await db.products.add(p)
        existing.set(productKey(r.name), p)
        added++
      }
    }
  })
  changed()
  return { added, updated, skipped }
}

export async function saveClosing(c: Omit<Closing, 'dirty' | 'rev'>): Promise<void> {
  const cur = await db.closings.get(c.day)
  await db.closings.put(touch({ ...(cur ?? {}), ...c } as Closing))
  changed()
}
