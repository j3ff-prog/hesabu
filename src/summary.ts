import { STOCK_CATEGORY, type Expense, type ExpensePayment, type Payment, type Product, type Sale } from './db'
import { addDays, dateLabel, money } from './format'
import { lineProfit } from './profit'
import { partsOf } from './pay'
import { buildGains, costsBetween, gainsBetween, outflows, sumFlows, unpaidBills } from './ledger'

export interface DayFigures {
  live: Sale[] // sales that were not cancelled
  total: number
  cash: number
  mpesa: number
  credit: number
  collected: number // paid back by credit customers
  cashCollected: number
  mpesaCollected: number
  spent: number // money paid out today for expenses, including bills paid off today
  cashSpent: number
  mpesaSpent: number
  onHand: { cash: number; mpesa: number; total: number } // money you should really have: received minus paid out. Credit not yet paid is left out.
  profit: number // see ledger.ts
  costs: number // the share of costs that belongs to today
  stockPaid: number // paid today for new stock: it lowers money on hand but is not a cost until the stock is sold
  hasCost: boolean // there is something to base a profit on
  unknown: number // selling value of goods with no buying price, left out of profit
  payables: number // bills still to pay, all time
  bills: number // number of those bills
}

/** All the figures for one day. Pass everything the phone has: older credit and bills can be paid today. */
export function dayFigures(day: number, sales: Sale[], payments: Payment[], expenses: Expense[], expensePayments: ExpensePayment[]): DayFigures {
  const end = addDays(day, 1)
  const live = sales.filter((s) => !s.voidedAt && s.createdAt >= day && s.createdAt < end)
  const by = (m: 'cash' | 'mpesa' | 'credit') => live.reduce((t, s) => t + partsOf(s)[m], 0)
  let hasCost = false
  let unknown = 0
  for (const s of live)
    for (const l of s.lines) {
      const p = lineProfit(l)
      if (p.margin || p.income) hasCost = true
      unknown += p.unknown
    }
  const todays = payments.filter((p) => p.createdAt >= day && p.createdAt < end)
  const sum = (xs: { amount: number }[]) => xs.reduce((t, x) => t + x.amount, 0)
  const flows = outflows(expenses, expensePayments)
  const cashOut = sumFlows(flows, day, end, 'cash')
  const mpesaOut = sumFlows(flows, day, end, 'mpesa')
  const cashIn = by('cash') + sum(todays.filter((p) => p.method === 'cash'))
  const mpesaIn = by('mpesa') + sum(todays.filter((p) => p.method === 'mpesa'))
  const costs = costsBetween(expenses, day, end)
  const owed = unpaidBills(expenses, expensePayments)
  return {
    live,
    total: live.reduce((t, s) => t + s.total, 0),
    cash: by('cash'),
    mpesa: by('mpesa'),
    credit: by('credit'),
    collected: sum(todays),
    cashCollected: sum(todays.filter((p) => p.method === 'cash')),
    mpesaCollected: sum(todays.filter((p) => p.method === 'mpesa')),
    spent: cashOut + mpesaOut,
    cashSpent: cashOut,
    mpesaSpent: mpesaOut,
    onHand: { cash: cashIn - cashOut, mpesa: mpesaIn - mpesaOut, total: cashIn + mpesaIn - cashOut - mpesaOut },
    profit: gainsBetween(buildGains(sales, payments), day, end) - costs,
    costs,
    stockPaid: expenses.filter((e) => e.category === STOCK_CATEGORY && e.method !== 'credit' && e.createdAt >= day && e.createdAt < end).reduce((t, e) => t + e.amount, 0),
    hasCost,
    unknown,
    payables: owed.reduce((t, b) => t + b.balance, 0),
    bills: owed.length
  }
}

/** Cash that should be in the till: what it started with, plus cash in, minus cash out. */
export const expectedCash = (started: number, f: DayFigures): number => started + f.cash + f.cashCollected - f.cashSpent

export const diffText = (diff: number): string =>
  diff === 0 ? 'Cash matches' : diff < 0 ? `Short by KES ${money(-diff)}` : `Over by KES ${money(diff)}`

export interface ClosingInfo {
  started: number
  expected: number
  counted: number
  diff: number
}

/** The end-of-day message the owner receives on WhatsApp. */
export function summaryText(shop: string, day: number, f: DayFigures, closing: ClosingInfo | null, low: Product[]): string {
  const n = f.live.length
  const lines = [
    `*${shop}* · ${dateLabel(day)}`,
    '',
    `Sales: KES ${money(f.total)} (${n} ${n === 1 ? 'sale' : 'sales'})`,
    `Cash ${money(f.cash)} · M-Pesa ${money(f.mpesa)} · On credit ${money(f.credit)}`
  ]
  if (f.collected > 0) lines.push(`Collected from credit: KES ${money(f.collected)}`)
  if (f.spent > 0) lines.push(`Paid out: KES ${money(f.spent)}`)
  lines.push(`Money on hand: KES ${money(f.onHand.total)} (cash ${money(f.onHand.cash)}, M-Pesa ${money(f.onHand.mpesa)})`)
  lines.push(f.profit >= 0 ? `Profit today: KES ${money(f.profit)}` : `Loss today: KES ${money(-f.profit)}`)
  if (f.payables > 0) lines.push(`You owe suppliers: KES ${money(f.payables)}`)
  if (closing) {
    lines.push('', `Cash check: should be KES ${money(closing.expected)}, counted KES ${money(closing.counted)}`, `*${diffText(closing.diff)}*`)
  }
  if (low.length > 0) {
    lines.push('', `Running low: ${low.slice(0, 6).map((p) => `${p.name} (${Math.max(0, p.stock)})`).join(', ')}`)
  }
  lines.push('', 'Sent from Tallyfy')
  return lines.join('\n')
}

export const waLink = (wa: string, text: string): string => `https://wa.me/${wa}?text=${encodeURIComponent(text)}`

/** Open WhatsApp. If the browser blocks the new tab, go there in this one. */
export function openWhatsApp(url: string): void {
  const w = window.open(url, '_blank', 'noopener')
  if (!w) window.location.href = url
}
