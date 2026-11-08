import { api } from './api'
import { SUPABASE_KEY, SUPABASE_URL } from './cloudReal'

/** Phone notifications through the browser's push service. Needs the app to be installed on iPhones. */
export type PushState = 'unsupported' | 'blocked' | 'on' | 'off'

export const pushSupported = (): boolean =>
  !import.meta.env.VITE_FAKE_CLOUD && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const toBytes = (b64: string): Uint8Array => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}
const toB64 = (buf: ArrayBuffer | null): string => {
  if (!buf) return ''
  let s = ''
  new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  try {
    const sub = await (await registration()).pushManager.getSubscription()
    return sub && Notification.permission === 'granted' ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

async function publicKey(): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY },
    body: JSON.stringify({ action: 'key' })
  })
  const j = (await r.json()) as { key?: string }
  if (!j.key) throw new Error('Notifications are not set up on the server yet.')
  return j.key
}

/** Ask permission, subscribe this phone, and tell the server. `shopId` is null for the Tallyfy admin's phone. */
export async function enablePush(shopId: string | null): Promise<void> {
  if (!pushSupported()) throw new Error('This phone or browser cannot show notifications.')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notifications are blocked. Turn them on in the phone settings for this app.')
  const reg = await registration()
  const key = await publicKey()
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) as BufferSource }))
  await api.savePush(shopId, { endpoint: sub.endpoint, p256dh: toB64(sub.getKey('p256dh')), auth: toB64(sub.getKey('auth')) })
}

export async function disablePush(): Promise<void> {
  const sub = await (await registration()).pushManager.getSubscription()
  if (!sub) return
  try {
    await api.removePush(sub.endpoint)
  } catch {
    /* the server forgets dead phones by itself */
  }
  await sub.unsubscribe()
}
