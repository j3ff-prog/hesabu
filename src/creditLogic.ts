import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { customerKey, db, type Customer, type Payment, type Sale } from './db'
import { methodLabel } from './format'
import { partsOf } from './pay'

export interface CreditEntry {
  kind: 'sale' | 'payment'
  id: string
  at: number
  amount: number
  label: string
}

export interface Debtor {
  key: string
  name: string
  phone?: string
  balance: number
  since: number // date of the oldest credit that is still unpaid
  due?: number // when that credit is to be paid
  entries: CreditEntry[] // newest first
}

/** Work out who still owes money. Cancelled sales don't count; payments clear the oldest credit first. */
export function buildDebtors(sales: Sale[], payments: Payment[], customers: Customer[]): Debtor[] {
  const phones = new Map(customers.map((c) => [c.key, c.phone] as const))
  const groups = new Map<string, { sales: Sale[]; pays: Payment[] }>()

  for (const s of sales) {
    if (s.voidedAt || partsOf(s).credit <= 0 || !s.customer) continue
    const key = customerKey(s.customer)
    const g = groups.get(key) ?? { sales: [], pays: [] }
    g.sales.push(s)
    groups.set(key, g)
  }
  for (const p of payments) groups.get(p.customerKey)?.pays.push(p)

  const out: Debtor[] = []
  for (const [key, g] of groups) {
    g.sales.sort((a, b) => a.createdAt - b.createdAt)
    const cr = (s: Sale) => partsOf(s).credit
    const owed = g.sales.reduce((t, s) => t + cr(s), 0)
    const paid = g.pays.reduce((t, p) => t + p.amount, 0)
    const balance = owed - paid
    if (balance < 1) continue

    let left = paid
    let since = g.sales[0].createdAt
    let due: number | undefined = g.sales[0].dueAt
    for (const s of g.sales) {
      if (left >= cr(s)) left -= cr(s)
      else {
        since = s.createdAt
        due = s.dueAt
        break
      }
    }

    const entries: CreditEntry[] = [
      ...g.sales.map((s): CreditEntry => {
        const more = s.lines.length - 1
        return {
          kind: 'sale',
          id: s.id,
          at: s.createdAt,
          amount: cr(s),
          label: `${s.lines[0].qty} × ${s.lines[0].name}${more > 0 ? ` + ${more} more` : ''}`
        }
      }),
      ...g.pays.map((p): CreditEntry => ({
        kind: 'payment',
        id: p.id,
        at: p.createdAt,
        amount: p.amount,
        label: `Payment · ${methodLabel[p.method]}`
      }))
    ].sort((a, b) => b.at - a.at)

    out.push({
      key,
      name: g.sales[0].customer ?? key, // keep the spelling used the first time
      phone: phones.get(key),
      balance,
      since,
      due,
      entries
    })
  }
  return out.sort((a, b) => b.balance - a.balance)
}

/** Everyone who currently owes money. Updates by itself when a credit sale or payment is saved. */
export function useDebtors(): Debtor[] | undefined {
  const sales = useLiveQuery(async () => (await db.sales.toArray()).filter((s) => partsOf(s).credit > 0), [])
  const payments = useLiveQuery(() => db.payments.toArray(), [])
  const customers = useLiveQuery(() => db.customers.toArray(), [])
  return useMemo(
    () => (sales && payments && customers ? buildDebtors(sales, payments, customers) : undefined),
    [sales, payments, customers]
  )
}
