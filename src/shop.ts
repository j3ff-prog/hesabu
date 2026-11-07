import { useCallback, useState } from 'react'

const KEY = 'tallify.shop'

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

/** The shop's name. Empty until the owner finishes setup. */
export function useShop(): [string, (name: string) => void] {
  const [name, setName] = useState(read)
  const save = useCallback((n: string) => {
    try {
      localStorage.setItem(KEY, n)
    } catch {
      /* storage blocked: keep the name for this session only */
    }
    setName(n)
  }, [])
  return [name, save]
}

const NOTE_KEY = 'tallify.seedNoteDismissed'
export const seedNoteDismissed = (): boolean => {
  try {
    return localStorage.getItem(NOTE_KEY) === '1'
  } catch {
    return false
  }
}
export const dismissSeedNote = (): void => {
  try {
    localStorage.setItem(NOTE_KEY, '1')
  } catch {
    /* ignore */
  }
}

// Small settings kept on the device. Read fresh each time so every screen sees the latest value.
const OWNER_KEY = 'tallify.owner'
const FLOAT_KEY = 'tallify.float'

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

/** Owner's WhatsApp number as 2547XXXXXXXX, or empty. */
export const getOwnerPhone = (): string => get(OWNER_KEY)
export const setOwnerPhone = (wa: string): void => set(OWNER_KEY, wa)

/** Cash usually left in the till at the start of a day. */
export const getFloat = (): string => get(FLOAT_KEY)
export const setFloat = (v: string): void => set(FLOAT_KEY, v)
