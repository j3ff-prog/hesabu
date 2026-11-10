import { customerKey, type Expense, type ExpensePayment, type Payment, type Period, type Sale } from './db'
import { addDays, startOfDay } from './format'
import { isCost, lineProfit } from './profit'
import { partsOf } from './pay'

/**
 * The two ways money is counted, in one place.
 *
 * Profit (what the business earned):
 *  - A sale counts once it is PAID. A credit sale adds nothing until the customer pays; each payment brings in its share
 *    of the sale's profit on the day it arrives. Payments clear the oldest credit first.
 *  - A cost counts as soon as you have it, even if you have not paid yet (you owe it). A cost that covers a week, a month or a
 *    year is spread evenly over those days, so paying a month's rent does not make one day look like a loss.
 *
 * Money on hand (what you could actually hold): cash and M-Pesa received, minus cash and M-Pesa paid out. Credit counts
 * on neither side until the money moves.
 */

// ---------- Profit from sales ----------

export interface Gain {
  at: number
  amount: number
}

const earnedOf = (s: Sale): number => {
  let e = 0
  for (const l of s.lines) {
    const p = lineProfit(l)
    e += p.margin + p.income
  }
  return e
}

/** When each part of the profit on sales was actually received. */
export function buildGains(sales: Sale[], payments: Payment[]): Gain[] {
  const gains: Gain[] = []
  const owing = new Map<string, { rem: number; per: number }[]>()
  const byTime = [...sales].filter((s) => !s.voidedAt).sort((a, b) => a.createdAt - b.createdAt)

  for (const s of byTime) {
    const e = earnedOf(s)
    const p = partsOf(s)
    const total = s.total > 0 ? s.total : p.cash + p.mpesa + p.credit
    if (total <= 0) continue
    const trackable = p.credit > 0 && !!s.customer && customerKey(s.customer) !== ''
    // Paid now: counts today. A credit with nobody to collect from can never be tracked, so it counts now rather than never.
    const now = trackable ? p.cash + p.mpesa : total
    if (now > 0 && e !== 0) gains.push({ at: s.createdAt, amount: (e * now) / total })
    if (trackable) {
      const key = customerKey(s.customer as string)
      const list = owing.get(key) ?? []
      list.push({ rem: p.credit, per: e / total })
      owing.set(key, list)
    }
  }

  for (const pay of [...payments].sort((a, b) => a.createdAt - b.createdAt)) {
    const list = owing.get(pay.customerKey)
    if (!list) continue
    let left = pay.amount
    for (const c of list) {
      if (left <= 0) break
      if (c.rem <= 0) continue
      const t = Math.min(left, c.rem)
      c.rem -= t
      left -= t
      if (c.per !== 0) gains.push({ at: pay.createdAt, amount: t * c.per })
    }
  }
  return gains
}

export const gainsBetween = (gains: Gain[], from: number, to: number): number =>
  gains.reduce((t, g) => (g.at >= from && g.at < to ? t + g.amount : t), 0)

// ---------- Costs ----------

const endOf = (start: number, period: Period): number => {
  const d = new Date(start)
  if (period === 'week') d.setDate(d.getDate() + 7)
  else if (period === 'month') d.setMonth(d.getMonth() + 1)
  else if (period === 'year') d.setFullYear(d.getFullYear() + 1)
  else d.setDate(d.getDate() + 1)
  return d.getTime()
}

/** The first and last moment an expense covers. */
export const coverage = (e: Pick<Expense, 'createdAt' | 'period'>): { start: number; end: number } => {
  const start = startOfDay(e.createdAt)
  return { start, end: endOf(start, e.period ?? 'day') }
}

/** The part of the costs that belongs to the days from `from` up to (not including) `to`. */
export function costsBetween(expenses: Expense[], from: number, to: number): number {
  let t = 0
  for (const e of expenses) {
    if (!isCost(e)) continue
    const { start, end } = coverage(e)
    const a = Math.max(start, from)
    const b = Math.min(end, to)
    if (b > a) t += (e.amount * (b - a)) / (end - start)
  }
  return t
}

/** Costs for each day, from `from`, for `days` days. */
export function costsByDay(expenses: Expense[], from: number, days: number): number[] {
  const out: number[] = []
  for (let i = 0; i < days; i++) out.push(costsBetween(expenses, addDays(from, i), addDays(from, i + 1)))
  return out
}

/** What one day of this expense is worth against profit. */
export const perDay = (e: Pick<Expense, 'amount' | 'createdAt' | 'period'>): number => {
  const { start, end } = coverage(e)
  return (e.amount * 86400000) / (end - start)
}

// ---------- Money paid out, and bills still to pay ----------

export interface Flow {
  at: number
  amount: number
  method: 'cash' | 'mpesa'
}

/** Every time money left the business for an expense: when it was paid, or each time a credit bill was paid off. */
export function outflows(expenses: Expense[], pays: ExpensePayment[]): Flow[] {
  const live = new Set(expenses.map((e) => e.id))
  const out: Flow[] = []
  for (const e of expenses) if (e.method !== 'credit') out.push({ at: e.createdAt, amount: e.amount, method: e.method })
  for (const p of pays) if (live.has(p.expenseId)) out.push({ at: p.createdAt, amount: p.amount, method: p.method })
  return out
}

export interface Bill {
  expense: Expense
  paid: number
  balance: number
}

export const billOf = (e: Expense, pays: ExpensePayment[]): Bill => {
  const paid = pays.filter((p) => p.expenseId === e.id).reduce((t, p) => t + p.amount, 0)
  return { expense: e, paid, balance: Math.max(0, e.amount - paid) }
}

/** Credit expenses that still have something to pay, the one due soonest first. */
export function unpaidBills(expenses: Expense[], pays: ExpensePayment[]): Bill[] {
  return expenses
    .filter((e) => e.method === 'credit')
    .map((e) => billOf(e, pays))
    .filter((b) => b.balance >= 1)
    .sort((a, b) => (a.expense.dueAt ?? Infinity) - (b.expense.dueAt ?? Infinity) || a.expense.createdAt - b.expense.createdAt)
}

export const sumFlows = (flows: Flow[], from: number, to: number, method?: 'cash' | 'mpesa'): number =>
  flows.reduce((t, f) => (f.at >= from && f.at < to && (!method || f.method === method) ? t + f.amount : t), 0)
