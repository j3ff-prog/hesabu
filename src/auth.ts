const enc = new TextEncoder()

const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export const newSalt = (): string => toHex(crypto.getRandomValues(new Uint8Array(16)).buffer)

/** A PIN is never stored. We keep a salted, slow hash of it. */
export async function hashPin(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 60000 },
    key,
    256
  )
  return toHex(bits)
}

export const validPin = (pin: string): boolean => /^\d{4,6}$/.test(pin)

const digits = (n: number): string => {
  const a = crypto.getRandomValues(new Uint32Array(n))
  return [...a].map((x) => String(x % 10)).join('')
}

/** A temporary PIN to hand to a new staff member. Avoids easy ones like 1111 or 1234. */
export function tempPin(): string {
  for (;;) {
    const p = digits(4)
    if (/^(\d)\1{3}$/.test(p) || p === '1234' || p === '4321' || p === '0000') continue
    return p
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function recoveryCode(): string {
  const a = crypto.getRandomValues(new Uint8Array(8))
  const s = [...a].map((x) => ALPHABET[x % ALPHABET.length]).join('')
  return s.slice(0, 4) + '-' + s.slice(4)
}
export const normaliseCode = (c: string): string => c.toUpperCase().replace(/[^A-Z0-9]/g, '')

// ---- Wrong-PIN lockout, remembered on this device ----
const failKey = (id: number) => `hesabu.fail.${id}`
const MAX_TRIES = 5
const LOCK_MS = 60_000

interface Fail {
  n: number
  until: number
}
const readFail = (id: number): Fail => {
  try {
    return JSON.parse(localStorage.getItem(failKey(id)) ?? '') as Fail
  } catch {
    return { n: 0, until: 0 }
  }
}
export const lockedFor = (id: number): number => Math.max(0, readFail(id).until - Date.now())
export const noteFail = (id: number): void => {
  const f = readFail(id)
  const n = f.n + 1
  const next: Fail = n >= MAX_TRIES ? { n: 0, until: Date.now() + LOCK_MS } : { n, until: 0 }
  try {
    localStorage.setItem(failKey(id), JSON.stringify(next))
  } catch {
    /* ignore */
  }
}
export const clearFail = (id: number): void => {
  try {
    localStorage.removeItem(failKey(id))
  } catch {
    /* ignore */
  }
}
export const triesLeft = (id: number): number => MAX_TRIES - readFail(id).n

// ---- Recovery code for the owner ----
const REC_KEY = 'hesabu.recovery'
export async function saveRecovery(code: string): Promise<void> {
  const salt = newSalt()
  const hash = await hashPin(normaliseCode(code), salt)
  try {
    localStorage.setItem(REC_KEY, JSON.stringify({ salt, hash }))
  } catch {
    /* ignore */
  }
}
export async function checkRecovery(code: string): Promise<boolean> {
  try {
    const r = JSON.parse(localStorage.getItem(REC_KEY) ?? '') as { salt: string; hash: string }
    return (await hashPin(normaliseCode(code), r.salt)) === r.hash
  } catch {
    return false
  }
}
export const hasRecovery = (): boolean => {
  try {
    return !!localStorage.getItem(REC_KEY)
  } catch {
    return false
  }
}

// ---- Which user is signed in (for this browser tab only) ----
const SESSION_KEY = 'hesabu.session'
export const getSession = (): number | null => {
  try {
    const v = sessionStorage.getItem(SESSION_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}
export const setSession = (id: number | null): void => {
  try {
    if (id === null) sessionStorage.removeItem(SESSION_KEY)
    else sessionStorage.setItem(SESSION_KEY, String(id))
  } catch {
    /* ignore */
  }
}
