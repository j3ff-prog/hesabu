import Dexie, { type EntityTable } from 'dexie'

export type Method = 'cash' | 'mpesa' | 'credit'

export interface Product {
  id: number
  name: string
  price: number // selling price
  cost: number // buying price, 0 if unknown
  stock: number
  lowAt: number // warn when stock is at or below this
  createdAt: number
}

export interface SaleLine {
  productId: number
  name: string
  qty: number
  price: number
  cost: number
}

export interface Payment {
  id: number
  customerKey: string
  customer: string
  amount: number
  method: 'cash' | 'mpesa'
  createdAt: number
  by?: number // user id
  byName?: string
}

export interface Customer {
  key: string
  name: string
  phone?: string // saved as 2547XXXXXXXX
}

export const CATEGORIES = ['New stock', 'Transport', 'Rent', 'Electricity', 'Salary', 'Other'] as const
export const STOCK_CATEGORY = 'New stock'

/** One product bought in a "New stock" expense. */
export interface RestockLine {
  productId: number
  name: string
  qty: number
  cost: number // buying price per item
}

export interface Expense {
  id: number
  amount: number
  note: string
  category: string
  method: 'cash' | 'mpesa'
  createdAt: number
  items?: RestockLine[] // set when the expense bought new stock
  by?: number
  byName?: string
}

export type Role = 'owner' | 'manager' | 'attendant'

export interface User {
  id: number
  name: string
  phone: string // 2547XXXXXXXX, how we identify the person
  role: Role
  salt: string
  pinHash: string
  mustChange: boolean // temporary PIN: choose a new one at first sign-in
  active: boolean
  createdAt: number
}

/** The cash count at the end of a day. One per day, keyed by the day's start time. */
export interface Closing {
  day: number
  started: number // cash in the till at the start of the day
  expected: number // what the till should hold
  counted: number // what was actually counted
  diff: number // counted - expected (negative = short)
  createdAt: number
}

export interface Sale {
  id: number
  createdAt: number
  method: Method
  customer?: string
  total: number
  lines: SaleLine[]
  voidedAt?: number
  by?: number
  byName?: string
}

class HesabuDB extends Dexie {
  products!: EntityTable<Product, 'id'>
  sales!: EntityTable<Sale, 'id'>
  payments!: EntityTable<Payment, 'id'>
  customers!: EntityTable<Customer, 'key'>
  expenses!: EntityTable<Expense, 'id'>
  closings!: EntityTable<Closing, 'day'>
  users!: EntityTable<User, 'id'>

  constructor() {
    super('hesabu')
    this.version(1).stores({
      products: '++id, name',
      sales: '++id, createdAt'
    })
    this.version(2).stores({
      products: '++id, name',
      sales: '++id, createdAt, method',
      payments: '++id, customerKey, createdAt',
      customers: 'key'
    })
    this.version(3).stores({
      products: '++id, name',
      sales: '++id, createdAt, method',
      payments: '++id, customerKey, createdAt',
      customers: 'key',
      expenses: '++id, createdAt',
      closings: 'day'
    })
    this.version(4)
      .stores({
        products: '++id, name',
        sales: '++id, createdAt, method',
        payments: '++id, customerKey, createdAt',
        customers: 'key',
        expenses: '++id, createdAt, category',
        closings: 'day',
        users: '++id, phone'
      })
      .upgrade((tx) =>
        tx
          .table('expenses')
          .toCollection()
          .modify((e: Expense) => {
            const n = (e.note ?? '').trim().toLowerCase()
            const hit = CATEGORIES.find((c) => c.toLowerCase() === n || (c === STOCK_CATEGORY && n === 'stock'))
            e.category = hit ?? 'Other'
          })
      )
  }
}

export const db = new HesabuDB()

/** Who is using the app right now. Set after sign-in so records say who made them. */
let actor: { id: number; name: string } | null = null
export const setActor = (a: { id: number; name: string } | null): void => {
  actor = a
}
const who = () => (actor ? { by: actor.id, byName: actor.name } : {})

/** Save a sale and take the items out of stock, all or nothing. */
export async function recordSale(
  lines: SaleLine[],
  method: Method,
  customer?: string
): Promise<{ id: number; total: number }> {
  const total = lines.reduce((sum, l) => sum + l.price * l.qty, 0)
  return db.transaction('rw', db.products, db.sales, async () => {
    const id = await db.sales.add({
      createdAt: Date.now(),
      method,
      customer,
      total,
      lines,
      ...who()
    } as Sale)
    for (const l of lines) {
      const p = await db.products.get(l.productId)
      if (p) await db.products.update(l.productId, { stock: p.stock - l.qty })
    }
    return { id, total }
  })
}

/** Cancel a sale and put the items back in stock. */
export async function voidSale(id: number): Promise<void> {
  await db.transaction('rw', db.products, db.sales, async () => {
    const sale = await db.sales.get(id)
    if (!sale || sale.voidedAt) return
    await db.sales.update(id, { voidedAt: Date.now() })
    for (const l of sale.lines) {
      const p = await db.products.get(l.productId)
      if (p) await db.products.update(l.productId, { stock: p.stock + l.qty })
    }
  })
}

/** One customer = one lowercase, single-spaced name, so "Wanjiku " and "wanjiku" are the same person. */
export const customerKey = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, ' ')

export async function addPayment(customer: string, amount: number, method: 'cash' | 'mpesa'): Promise<number> {
  return db.payments.add({
    customerKey: customerKey(customer),
    customer,
    amount,
    method,
    createdAt: Date.now(),
    ...who()
  } as Payment)
}

export async function deletePayment(id: number): Promise<void> {
  await db.payments.delete(id)
}

export async function savePhone(key: string, name: string, phone: string): Promise<void> {
  await db.customers.put({ key, name, phone })
}

export type ProductInput = Omit<Product, 'id' | 'createdAt'>

export async function saveProduct(input: ProductInput, id?: number): Promise<void> {
  if (id) await db.products.update(id, input)
  else await db.products.add({ ...input, createdAt: Date.now() } as Product)
}

export async function removeProduct(id: number): Promise<void> {
  await db.products.delete(id)
}

export interface ExpenseInput {
  amount: number
  note: string
  category: string
  method: 'cash' | 'mpesa'
  items?: RestockLine[]
}

/** Save an expense. If it bought new stock, the stock goes up and each product's buying price is updated. */
export async function addExpense(input: ExpenseInput): Promise<number> {
  const items = input.category === STOCK_CATEGORY ? (input.items ?? []).filter((i) => i.qty > 0) : []
  return db.transaction('rw', db.expenses, db.products, async () => {
    const id = await db.expenses.add({
      amount: input.amount,
      note: input.note,
      category: input.category,
      method: input.method,
      createdAt: Date.now(),
      ...(items.length ? { items } : {}),
      ...who()
    } as Expense)
    for (const i of items) {
      const p = await db.products.get(i.productId)
      if (!p) continue
      await db.products.update(i.productId, { stock: p.stock + i.qty, ...(i.cost > 0 ? { cost: i.cost } : {}) })
    }
    return id
  })
}

/** Remove an expense. If it had bought stock, that stock comes back off the shelf. */
export async function deleteExpense(id: number): Promise<void> {
  await db.transaction('rw', db.expenses, db.products, async () => {
    const e = await db.expenses.get(id)
    if (!e) return
    for (const i of e.items ?? []) {
      const p = await db.products.get(i.productId)
      if (p) await db.products.update(i.productId, { stock: p.stock - i.qty })
    }
    await db.expenses.delete(id)
  })
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
        await db.products.update(found.id, {
          price: r.price,
          ...(r.hasCost ? { cost: r.cost } : {}),
          ...(r.hasStock ? { stock: r.stock } : {}),
          ...(r.hasLow ? { lowAt: r.lowAt } : {})
        })
        updated++
      } else {
        const id = (await db.products.add({
          name: r.name,
          price: r.price,
          cost: r.cost,
          stock: r.stock,
          lowAt: r.hasLow ? r.lowAt : 5,
          createdAt: Date.now()
        } as Product)) as number
        existing.set(productKey(r.name), { id } as Product)
        added++
      }
    }
  })
  return { added, updated, skipped }
}

// ---------- Team ----------

export const saveUser = async (u: Omit<User, 'id'>): Promise<number> => (await db.users.add(u as User)) as number
export const updateUser = async (id: number, patch: Partial<User>): Promise<void> => {
  await db.users.update(id, patch)
}

export async function saveClosing(c: Closing): Promise<void> {
  await db.closings.put(c)
}

// ---------- Backup and restore ----------

export interface Backup {
  app: 'hesabu'
  version: number
  exportedAt: number
  shop: string
  owner: string
  products: Product[]
  sales: Sale[]
  payments: Payment[]
  customers: Customer[]
  expenses: Expense[]
  closings: Closing[]
  users?: User[]
}

export async function exportAll(shop: string, owner: string): Promise<Backup> {
  const [products, sales, payments, customers, expenses, closings, users] = await Promise.all([
    db.products.toArray(),
    db.sales.toArray(),
    db.payments.toArray(),
    db.customers.toArray(),
    db.expenses.toArray(),
    db.closings.toArray(),
    db.users.toArray()
  ])
  return { app: 'hesabu', version: 4, exportedAt: Date.now(), shop, owner, products, sales, payments, customers, expenses, closings, users }
}

const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : [])

/** Replace everything on this device with the contents of a backup file. Throws if the file isn't a Hesabu backup. */
export async function importAll(data: unknown): Promise<Backup> {
  const d = data as Partial<Backup> | null
  if (!d || typeof d !== 'object' || d.app !== 'hesabu' || !Array.isArray(d.products) || !Array.isArray(d.sales)) {
    throw new Error('This file is not a Hesabu backup.')
  }
  const okProducts = d.products.every((p) => p && typeof p.id === 'number' && typeof p.name === 'string' && typeof p.price === 'number')
  const okSales = d.sales.every((s) => s && typeof s.id === 'number' && typeof s.createdAt === 'number' && Array.isArray(s.lines))
  if (!okProducts || !okSales) throw new Error('This backup file looks damaged, so nothing was changed.')

  await db.transaction('rw', [db.products, db.sales, db.payments, db.customers, db.expenses, db.closings, db.users], async () => {
    await Promise.all([db.products.clear(), db.sales.clear(), db.payments.clear(), db.customers.clear(), db.expenses.clear(), db.closings.clear()])
    if (Array.isArray(d.users)) await db.users.clear()
    await db.products.bulkPut(d.products as Product[])
    await db.sales.bulkPut(d.sales as Sale[])
    await db.payments.bulkPut(list(d.payments) as Payment[])
    await db.customers.bulkPut(list(d.customers) as Customer[])
    await db.expenses.bulkPut(
      (list(d.expenses) as Expense[]).map((e) => ({ ...e, category: e.category ?? 'Other' }))
    )
    if (Array.isArray(d.users)) await db.users.bulkPut(d.users as User[])
    await db.closings.bulkPut(list(d.closings) as Closing[])
  })
  return d as Backup
}
