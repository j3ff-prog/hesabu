import { useEffect, useState } from 'react'
import { db } from './db'

/** Where the Hesabu registry lives (a Cloudflare Worker). Empty means the app runs fully offline with no registry. */
const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '')
export const cloudOn = BASE !== ''
export const apiBase = BASE

const get = (k: string): string => {
  try {
    return localStorage.getItem(k) ?? ''
  } catch {
    return ''
  }
}
const set = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* ignore */
  }
}

/** A random id for this shop, made once. It identifies the shop to the registry. */
export function shopId(): string {
  let id = get('hesabu.shopId')
  if (!id) {
    id = crypto.randomUUID()
    set('hesabu.shopId', id)
  }
  return id
}

export interface Account {
  status: 'trial' | 'active' | 'suspended'
  paidUntil?: number | null
  message?: string | null
}

const ACC = 'hesabu.account'
export function getAccount(): Account {
  try {
    const a = JSON.parse(get(ACC)) as Account
    if (a && (a.status === 'trial' || a.status === 'active' || a.status === 'suspended')) return a
  } catch {
    /* ignore */
  }
  return { status: 'trial' }
}
function saveAccount(a: Account): void {
  set(ACC, JSON.stringify(a))
  window.dispatchEvent(new Event('hesabu-account'))
}

/** The shop's subscription state, as last told by the registry. Works offline using the last known value. */
export function useAccount(): Account {
  const [a, setA] = useState(getAccount)
  useEffect(() => {
    const on = () => setA(getAccount())
    window.addEventListener('hesabu-account', on)
    return () => window.removeEventListener('hesabu-account', on)
  }, [])
  return a
}

/**
 * Tell the registry this shop exists and is being used. Only totals are sent: shop name, owner's number, counts.
 * Individual sales, customers and prices never leave the phone.
 */
export async function heartbeat(shop: string, owner: string, force = false): Promise<void> {
  if (!cloudOn || !shop || !navigator.onLine) return
  const sig = shop + '|' + owner
  const last = Number(get('hesabu.beat') || 0)
  if (!force && sig === get('hesabu.beatSig') && Date.now() - last < 6 * 3600_000) return
  try {
    const since = Date.now() - 30 * 86400000
    const [products, users, recent, all] = await Promise.all([
      db.products.count(),
      db.users.count(),
      db.sales.where('createdAt').aboveOrEqual(since).toArray(),
      db.sales.orderBy('createdAt').last()
    ])
    const live = recent.filter((s) => !s.voidedAt)
    const res = await fetch(BASE + '/api/beat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: shopId(),
        shop,
        owner,
        products,
        users,
        sales30: live.length,
        revenue30: live.reduce((t, s) => t + s.total, 0),
        lastSale: all?.createdAt ?? null
      })
    })
    if (!res.ok) return
    const a = (await res.json()) as Account
    saveAccount({ status: a.status, paidUntil: a.paidUntil ?? null, message: a.message ?? null })
    set('hesabu.beat', String(Date.now()))
    set('hesabu.beatSig', sig)
  } catch {
    /* offline or registry down: try again later, never block the shop */
  }
}
