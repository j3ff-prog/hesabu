import type { Sale } from './db'

export interface Parts {
  cash: number
  mpesa: number
  credit: number
}

/** How a sale was paid. Older sales have one method; newer ones can be split between cash, M-Pesa and credit. */
export function partsOf(s: Pick<Sale, 'method' | 'total' | 'cash' | 'mpesa' | 'credit'>): Parts {
  if (s.cash !== undefined || s.mpesa !== undefined || s.credit !== undefined) return { cash: s.cash ?? 0, mpesa: s.mpesa ?? 0, credit: s.credit ?? 0 }
  return { cash: s.method === 'cash' ? s.total : 0, mpesa: s.method === 'mpesa' ? s.total : 0, credit: s.method === 'credit' ? s.total : 0 }
}

export function payLabel(s: Sale): string {
  const p = partsOf(s)
  return [p.cash > 0 && 'Cash', p.mpesa > 0 && 'M-Pesa', p.credit > 0 && 'Credit'].filter(Boolean).join(' + ') || 'Cash'
}
