import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, setActor, type Role, type User } from './db'
import { clearFail, getSession, hashPin, lockedFor, noteFail, setSession } from './pin'
import { roleCan, WRITES, type Perm } from './rights'
import { useAccount } from './cloud'

export interface Who {
  id: number // 0 when nobody has set up staff yet
  name: string
  role: Role
}

interface AuthValue {
  /** The person using the app now. */
  me: Who
  /** True when staff exist, so people must sign in. */
  teamOn: boolean
  users: User[]
  can: (p: Perm) => boolean
  /** The subscription has ended: look and download only. */
  readOnly: boolean
  signIn: (id: number, pin: string) => Promise<'ok' | 'bad' | 'locked'>
  signOut: () => void
  /** After a successful PIN change or recovery. */
  startSession: (id: number) => void
  /** Used while the very first owner is being created, so the screen doesn't flip to sign-in halfway. */
  claimOwner: () => void
}

const Ctx = createContext<AuthValue | null>(null)
export const useAuth = (): AuthValue => {
  const v = useContext(Ctx)
  if (!v) throw new Error('Auth is missing')
  return v
}

const SOLO: Who = { id: 0, name: 'Owner', role: 'owner' }
const IDLE_MS = 10 * 60_000

/** Decides who is signed in. Children are shown only once someone is (or when there is no staff list yet). */
export function AuthProvider({ children, gate }: { children: ReactNode; gate: (ctx: AuthValue) => ReactNode | null }) {
  const users = useLiveQuery(() => db.users.toArray(), [])
  const account = useAccount()
  const [sid, setSid] = useState<number | null>(getSession)

  const startSession = useCallback((id: number) => {
    setSession(id)
    setSid(id)
  }, [])
  const claimOwner = useCallback(() => {
    setSession(-1)
    setSid(-1)
  }, [])
  const signOut = useCallback(() => {
    setSession(null)
    setSid(null)
  }, [])

  const list = useMemo(() => users ?? [], [users])
  const teamOn = list.length > 0
  // sid -1 means "whoever the owner is, once saved" (see claimOwner)
  const current = list.find((u) => u.active && (u.id === sid || (sid === -1 && u.role === 'owner')))
  const me: Who = !teamOn ? SOLO : current ? { id: current.id, name: current.name, role: current.role } : SOLO

  // A removed or switched-off person is signed out straight away.
  useEffect(() => {
    if (users && sid !== null && sid !== -1 && !list.some((u) => u.id === sid && u.active)) signOut()
  }, [users, list, sid, signOut])

  // Turn the placeholder into the real owner id once it exists.
  useEffect(() => {
    if (sid === -1 && current) startSession(current.id)
  }, [sid, current, startSession])

  // Records say who made them.
  useEffect(() => {
    setActor(teamOn && current ? { id: current.id, name: current.name } : null)
  }, [teamOn, current])

  // Lock after a few quiet minutes on a shared phone.
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!teamOn || !current) return
    const reset = () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(signOut, IDLE_MS)
    }
    const evs = ['pointerdown', 'keydown', 'touchstart'] as const
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    reset()
    return () => {
      evs.forEach((e) => window.removeEventListener(e, reset))
      window.clearTimeout(timer.current)
    }
  }, [teamOn, current, signOut])

  const readOnly = account.status === 'suspended'
  const can = useCallback(
    (p: Perm) => roleCan(me.role, p) && !(readOnly && WRITES.has(p)),
    [me.role, readOnly]
  )

  const signIn = useCallback(
    async (id: number, pin: string): Promise<'ok' | 'bad' | 'locked'> => {
      if (lockedFor(id) > 0) return 'locked'
      const u = list.find((x) => x.id === id && x.active)
      if (!u) return 'bad'
      if ((await hashPin(pin, u.salt)) === u.pinHash) {
        clearFail(id)
        startSession(id)
        return 'ok'
      }
      noteFail(id)
      return lockedFor(id) > 0 ? 'locked' : 'bad'
    },
    [list, startSession]
  )

  const value: AuthValue = { me, teamOn, users: list, can, readOnly, signIn, signOut, startSession, claimOwner }
  if (!users) return null
  const blocked = gate(value)
  return <Ctx.Provider value={value}>{blocked ?? children}</Ctx.Provider>
}
