import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { openShopDb, setActor, type Role } from './db'
import { roleCan, WRITES, type Perm } from './rights'
import { api } from './api'
import { ApiError, type Session, type ShopInfo, type ShopState } from './cloudApi'
import { startSync, countPending, type SyncHandle } from './sync'
import { setOwnerPhone } from './shop'
import { AuthScreen, ShopPicker } from './SignIn'
import { CreateShop } from './Welcome'
import { Splash } from './Splash'

export interface Who {
  id: string
  name: string
  role: Role
}

interface AuthValue {
  me: Who
  shopId: string
  shopName: string
  shops: ShopInfo[]
  teamOn: true
  can: (p: Perm) => boolean
  /** The trial or subscription has ended: look and download only. */
  readOnly: boolean
  shopState: ShopState | null
  signOut: () => Promise<void>
  switchShop: (id: string) => void
  /** Reload the shop list and subscription state (after renaming, for example). */
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthValue | null>(null)
export const useAuth = (): AuthValue => {
  const v = useContext(Ctx)
  if (!v) throw new Error('Auth is missing')
  return v
}

// What this device last knew, so the app opens with no signal.
const CTX_KEY = 'tallify.ctx'
const ACTIVE_KEY = 'tallify.active'
interface Cached {
  session: Session
  shops: ShopInfo[]
  states: Record<string, ShopState>
}
const readCache = (): Cached | null => {
  try {
    return JSON.parse(localStorage.getItem(CTX_KEY) ?? 'null') as Cached | null
  } catch {
    return null
  }
}
const writeCache = (c: Cached | null): void => {
  try {
    if (c) localStorage.setItem(CTX_KEY, JSON.stringify(c))
    else localStorage.removeItem(CTX_KEY)
  } catch {
    /* ignore */
  }
}
const readActive = (): string => {
  try {
    return localStorage.getItem(ACTIVE_KEY) ?? ''
  } catch {
    return ''
  }
}
const writeActive = (id: string): void => {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    /* ignore */
  }
}

type Phase = 'loading' | 'signedOut' | 'noShop' | 'pick' | 'ready'

/** Decides who is signed in and which shop is open. Children are shown only once both are known. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [session, setSession] = useState<Session | null>(null)
  const [shops, setShops] = useState<ShopInfo[]>([])
  const [shopId, setShopId] = useState('')
  const [shopState, setShopState] = useState<ShopState | null>(null)
  const sync = useRef<SyncHandle | null>(null)

  const choose = useCallback((list: ShopInfo[]): void => {
    setShops(list)
    if (list.length === 0) return setPhase('noShop')
    const saved = readActive()
    const pick = list.find((s) => s.id === saved) ?? (list.length === 1 ? list[0] : null)
    if (!pick) return setPhase('pick')
    writeActive(pick.id)
    openShopDb(pick.id)
    setShopId(pick.id)
    setPhase('ready')
  }, [])

  // Start: use the saved sign-in. With no signal, fall back to what this phone last knew.
  useEffect(() => {
    let live = true
    void (async () => {
      const cached = readCache()
      // Open straight away from what this phone already knows, and check with the server in the background.
      if (cached && cached.shops.length > 0 && readActive()) {
        setSession(cached.session)
        choose(cached.shops)
        try {
          const live = await api.getSession()
          if (!live) {
            writeCache(null)
            writeActive('')
            window.location.reload()
          }
        } catch {
          /* offline: keep going */
        }
        return
      }
      let s: Session | null = null
      let list: ShopInfo[] | null = null
      try {
        s = await api.getSession()
        if (s) list = await api.myShops()
      } catch (e) {
        if (e instanceof ApiError && e.code === 'network' && cached) {
          s = cached.session
          list = cached.shops
        } else s = null
      }
      if (!live) return
      if (!s || !list) {
        if (!s && cached && !navigator.onLine) {
          setSession(cached.session)
          return choose(cached.shops)
        }
        return setPhase('signedOut')
      }
      setSession(s)
      writeCache({ session: s, shops: list, states: cached?.states ?? {} })
      choose(list)
    })()
    return () => {
      live = false
    }
  }, [choose])

  const shop = shops.find((s) => s.id === shopId)
  const role: Role = shop?.role ?? 'attendant'

  // Records say who made them, and the shop's number is kept for the WhatsApp summary.
  useEffect(() => {
    if (phase !== 'ready' || !session || !shop) return
    setActor({ id: session.userId, name: shop.memberName })
    if (shop.ownerPhone) setOwnerPhone(shop.ownerPhone)
  }, [phase, session, shop])

  const loadState = useCallback(async (id: string): Promise<void> => {
    try {
      const st = await api.shopState(id)
      if (!st) return
      setShopState(st)
      const c = readCache()
      if (c) writeCache({ ...c, states: { ...c.states, [id]: st } })
    } catch {
      const st = readCache()?.states[id]
      if (st) setShopState((cur) => cur ?? st)
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await api.myShops()
      setShops(list)
      const c = readCache()
      if (c) writeCache({ ...c, shops: list })
      if (shopId && !list.some((s) => s.id === shopId)) {
        writeActive('')
        window.location.reload()
      }
    } catch {
      /* offline: keep what we have */
    }
    if (shopId) await loadState(shopId)
  }, [shopId, loadState])

  // Sync while a shop is open. A refusal usually means the subscription ended or the role changed: look again.
  useEffect(() => {
    if (phase !== 'ready' || !shopId) return
    const h = startSync(api, shopId, role, () => void refresh())
    sync.current = h
    void loadState(shopId)
    const t = window.setInterval(() => void refresh(), 5 * 60_000)
    const back = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', back)
    return () => {
      document.removeEventListener('visibilitychange', back)
      window.clearInterval(t)
      h.stop()
      sync.current = null
    }
  }, [phase, shopId, role, loadState, refresh])

  const signOut = useCallback(async (): Promise<void> => {
    sync.current?.stop()
    try {
      await api.signOut()
    } catch {
      /* ignore */
    }
    writeCache(null)
    writeActive('')
    window.location.reload()
  }, [])

  const switchShop = useCallback((id: string) => {
    writeActive(id)
    window.location.reload()
  }, [])

  const readOnly = !!shopState && !shopState.writable
  const can = useCallback((p: Perm) => roleCan(role, p) && !(readOnly && WRITES.has(p)), [role, readOnly])

  const value = useMemo<AuthValue>(
    () => ({
      me: { id: session?.userId ?? '', name: shop?.memberName ?? '', role },
      shopId,
      shopName: shop?.name ?? '',
      shops,
      teamOn: true,
      can,
      readOnly,
      shopState,
      signOut,
      switchShop,
      refresh
    }),
    [session, shop, role, shopId, shops, can, readOnly, shopState, signOut, switchShop, refresh]
  )

  if (phase === 'loading') return <Splash />
  if (phase === 'signedOut')
    return (
      <AuthScreen
        onDone={(s, list) => {
          setSession(s)
          writeCache({ session: s, shops: list, states: {} })
          choose(list)
        }}
      />
    )
  if (phase === 'noShop' && session)
    return (
      <CreateShop
        phone={session.phone}
        onDone={(id) => {
          writeActive(id)
          window.location.reload()
        }}
        onSignOut={signOut}
      />
    )
  if (phase === 'pick') return <ShopPicker shops={shops} onPick={switchShop} onSignOut={signOut} />
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** For the menu: are there changes on this phone the server has not received? */
export const unsentCount = countPending
