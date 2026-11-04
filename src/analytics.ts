import { STOCK_CATEGORY, type Expense, type Payment, type Product, type Sale } from './db'
import { addDays, startOfDay } from './format'
import type { Debtor } from './creditLogic'

export interface DayBar {
  day: number
  cash: number
  mpesa: number
  credit: number
  total: number
  profit: number
}

export interface Dashboard {
  days: number
  from: number
  to: number
  sales: number
  salesPrev: number
  count: number
  profit: number // margin on items that have a buying price
  costedShare: number // 0..1 of sales value that has a buying price
  spent: number // running costs, not counting new-stock purchases
  stockBought: number
  net: number // profit - spent
  collected: number
  creditGiven: number
  split: { cash: number; mpesa: number; credit: number }
  daily: DayBar[]
  best: { name: string; qty: number; revenue: number }[]
  hours: { hour: number; count: number; total: number }[]
  ageing: { label: string; amount: number; people: number }[]
  owed: number
  stock: { out: number; low: number; ok: number; atCost: number; atPrice: number; total: number }
  spending: { category: string; amount: number }[]
}

/** All the numbers behind the dashboard, for the last `days` days including today. */
export function buildDashboard(
  sales: Sale[],
  payments: Payment[],
  expenses: Expense[],
  products: Product[],
  debtors: Debtor[],
  days: number,
  now = Date.now()
): Dashboard {
  const to = addDays(startOfDay(now), 1)
  const from = addDays(to, -days)
  const prevFrom = addDays(from, -days)

  const live = sales.filter((s) => !s.voidedAt)
  const inRange = live.filter((s) => s.createdAt >= from && s.createdAt < to)
  const prev = live.filter((s) => s.createdAt >= prevFrom && s.createdAt < from)

  const daily: DayBar[] = []
  for (let i = 0; i < days; i++) daily.push({ day: addDays(from, i), cash: 0, mpesa: 0, credit: 0, total: 0, profit: 0 })
  const idx = (ts: number) => Math.min(days - 1, Math.max(0, Math.round((startOfDay(ts) - from) / 86400000)))

  const split = { cash: 0, mpesa: 0, credit: 0 }
  const bestMap = new Map<string, { name: string; qty: number; revenue: number }>()
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, total: 0 }))
  let profit = 0
  let costed = 0

  for (const s of inRange) {
    const d = daily[idx(s.createdAt)]
    d[s.method] += s.total
    d.total += s.total
    split[s.method] += s.total
    const h = hours[new Date(s.createdAt).getHours()]
    h.count++
    h.total += s.total
    for (const l of s.lines) {
      if (l.cost > 0) {
        const m = (l.price - l.cost) * l.qty
        profit += m
        d.profit += m
        costed += l.price * l.qty
      }
      const b = bestMap.get(l.name) ?? { name: l.name, qty: 0, revenue: 0 }
      b.qty += l.qty
      b.revenue += l.price * l.qty
      bestMap.set(l.name, b)
    }
  }
  const sales_ = inRange.reduce((t, s) => t + s.total, 0)

  const exp = expenses.filter((e) => e.createdAt >= from && e.createdAt < to)
  const spent = exp.filter((e) => e.category !== STOCK_CATEGORY).reduce((t, e) => t + e.amount, 0)
  const stockBought = exp.filter((e) => e.category === STOCK_CATEGORY).reduce((t, e) => t + e.amount, 0)
  const catMap = new Map<string, number>()
  for (const e of exp) catMap.set(e.category, (catMap.get(e.category) ?? 0) + e.amount)

  const ages = [
    { label: 'Up to a week', min: 0, max: 7, amount: 0, people: 0 },
    { label: '1 to 4 weeks', min: 8, max: 30, amount: 0, people: 0 },
    { label: '1 to 2 months', min: 31, max: 60, amount: 0, people: 0 },
    { label: 'Over 2 months', min: 61, max: Infinity, amount: 0, people: 0 }
  ]
  const today = startOfDay(now)
  for (const d of debtors) {
    const age = Math.floor((today - startOfDay(d.since)) / 86400000)
    const b = ages.find((a) => age >= a.min && age <= a.max) ?? ages[0]
    b.amount += d.balance
    b.people++
  }

  const out = products.filter((p) => p.stock <= 0).length
  const low = products.filter((p) => p.stock > 0 && p.stock <= p.lowAt).length

  return {
    days,
    from,
    to,
    sales: sales_,
    salesPrev: prev.reduce((t, s) => t + s.total, 0),
    count: inRange.length,
    profit,
    costedShare: sales_ > 0 ? costed / sales_ : 0,
    spent,
    stockBought,
    net: profit - spent,
    collected: payments.filter((p) => p.createdAt >= from && p.createdAt < to).reduce((t, p) => t + p.amount, 0),
    creditGiven: split.credit,
    split,
    daily,
    best: [...bestMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6),
    hours,
    ageing: ages.map(({ label, amount, people }) => ({ label, amount, people })),
    owed: debtors.reduce((t, d) => t + d.balance, 0),
    stock: {
      out,
      low,
      ok: products.length - out - low,
      atCost: products.reduce((t, p) => t + Math.max(0, p.stock) * p.cost, 0),
      atPrice: products.reduce((t, p) => t + Math.max(0, p.stock) * p.price, 0),
      total: products.length
    },
    spending: [...catMap.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount)
  }
}
