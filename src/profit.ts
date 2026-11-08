import { STOCK_CATEGORY, type Expense, type SaleLine } from './db'

/**
 * How Tallyfy works out profit, in one place:
 *  - Goods with a buying price: selling price minus buying price.
 *  - Food you make and services (no buying price): the whole selling price counts as income.
 *  - Money spent on costs (ingredients, rent, transport, salaries...) is taken off.
 *  - "New stock" purchases are NOT taken off, because the buying price on each item already covers them.
 *  - Goods with no buying price can't be judged, so they are left out and flagged.
 */
export interface LineProfit {
  margin: number // goods with a buying price
  income: number // food and services
  unknown: number // selling value of goods with no buying price (not counted)
}

export function lineProfit(l: SaleLine): LineProfit {
  const v = l.price * l.qty
  if (l.service) return { margin: 0, income: v, unknown: 0 }
  if (l.cost > 0) return { margin: (l.price - l.cost) * l.qty, income: 0, unknown: 0 }
  return { margin: 0, income: 0, unknown: v }
}

/** Expenses that reduce profit. */
export const isCost = (e: Pick<Expense, 'category'>): boolean => e.category !== STOCK_CATEGORY
