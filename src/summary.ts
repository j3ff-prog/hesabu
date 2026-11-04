import type { Expense, Payment, Product, Sale } from './db'
import { dateLabel, money } from './format'

export interface DayFigures {
  live: Sale[] // sales that were not cancelled
  total: number
  cash: number
  mpesa: number
  credit: number
  collected: number // paid back by credit customers
  cashCollected: number
  spent: number
  cashSpent: number
  profit: number // only counts items that have a buying price
  hasCost: boolean
}

export function dayFigures(sales: Sale[], payments: Payment[], expenses: Expense[]): DayFigures {
  const live = sales.filter((s) => !s.voidedAt)
  const by = (m: string) => live.filter((s) => s.method === m).reduce((t, s) => t + s.total, 0)
  let profit = 0
  let hasCost = false
  for (const s of live)
    for (const l of s.lines)
      if (l.cost > 0) {
        hasCost = true
        profit += (l.price - l.cost) * l.qty
      }
  const sum = (xs: { amount: number }[]) => xs.reduce((t, x) => t + x.amount, 0)
  return {
    live,
    total: live.reduce((t, s) => t + s.total, 0),
    cash: by('cash'),
    mpesa: by('mpesa'),
    credit: by('credit'),
    collected: sum(payments),
    cashCollected: sum(payments.filter((p) => p.method === 'cash')),
    spent: sum(expenses),
    cashSpent: sum(expenses.filter((e) => e.method === 'cash')),
    profit,
    hasCost
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
  if (f.spent > 0) lines.push(`Spent: KES ${money(f.spent)}`)
  if (closing) {
    lines.push('', `Cash check: should be KES ${money(closing.expected)}, counted KES ${money(closing.counted)}`, `*${diffText(closing.diff)}*`)
  }
  if (low.length > 0) {
    lines.push('', `Running low: ${low.slice(0, 6).map((p) => `${p.name} (${Math.max(0, p.stock)})`).join(', ')}`)
  }
  lines.push('', 'Sent from Hesabu')
  return lines.join('\n')
}

export const waLink = (wa: string, text: string): string => `https://wa.me/${wa}?text=${encodeURIComponent(text)}`

/** Open WhatsApp. If the browser blocks the new tab, go there in this one. */
export function openWhatsApp(url: string): void {
  const w = window.open(url, '_blank', 'noopener')
  if (!w) window.location.href = url
}
