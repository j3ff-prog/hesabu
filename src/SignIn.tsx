import { useEffect, useState } from 'react'
import { db, updateUser, type User } from './db'
import { useAuth } from './Auth'
import { ROLE_LABEL } from './rights'
import { checkRecovery, hashPin, lockedFor, newSalt, triesLeft, validPin, clearFail } from './auth'
import { Sheet } from './Sheet'
import { useShop } from './shop'

const initial = (n: string) => (n.trim()[0] ?? '?').toUpperCase()

/** Who is using the phone? Pick a name, type the PIN. */
export function SignIn() {
  const { users, signIn, startSession } = useAuth()
  const [shop] = useShop()
  const active = users.filter((u) => u.active)
  const [pick, setPick] = useState<User | null>(active.length === 1 ? active[0] : null)
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState('')
  const [wait, setWait] = useState(0)
  const [forgot, setForgot] = useState(false)

  useEffect(() => {
    if (!pick) return
    const tick = () => setWait(Math.ceil(lockedFor(pick.id) / 1000))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [pick])

  const go = async () => {
    if (!pick || !validPin(pin) || wait > 0) return
    const r = await signIn(pick.id, pin)
    setPin('')
    if (r === 'ok') return
    setMsg(r === 'locked' ? 'Too many wrong tries. Wait a minute and try again.' : `Wrong PIN. ${triesLeft(pick.id)} tries left.`)
    setWait(Math.ceil(lockedFor(pick.id) / 1000))
  }

  if (pick && forgot) {
    return (
      <Recover
        user={pick}
        onBack={() => setForgot(false)}
        onDone={() => {
          setForgot(false)
          startSession(pick.id)
        }}
      />
    )
  }

  return (
    <main className="welcome signin">
      <img src="icon.svg" alt="" width="56" height="56" className="welcome-mark" />
      <h1 className="welcome-title">{shop || 'Hesabu'}</h1>
      {!pick ? (
        <>
          <p className="welcome-sub">Who is using the phone?</p>
          <ul className="people">
            {active.map((u) => (
              <li key={u.id}>
                <button className="person" onClick={() => { setPick(u); setMsg(''); setPin('') }}>
                  <span className="avatar">{initial(u.name)}</span>
                  <span className="person-main">
                    <span className="person-name">{u.name}</span>
                    <span className="muted">{ROLE_LABEL[u.role]}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void go()
          }}
        >
          <p className="welcome-sub">Hello, {pick.name}. Enter your PIN.</p>
          <label className="field">
            <span>PIN</span>
            <input
              className="pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setMsg('') }}
              autoFocus
              aria-label="PIN"
            />
          </label>
          {msg && <p className="hint warn-text" role="alert">{msg}</p>}
          {wait > 0 && <p className="hint warn-text">Try again in {wait} seconds.</p>}
          <button className="btn primary block" type="submit" disabled={!validPin(pin) || wait > 0}>
            Open the shop
          </button>
          {active.length > 1 && (
            <button type="button" className="btn plain-btn block" onClick={() => setPick(null)}>
              Not you? Choose another name
            </button>
          )}
          <p className="hint center">
            {pick.role === 'owner' ? (
              <button type="button" className="link inline" onClick={() => setForgot(true)}>Forgot your PIN?</button>
            ) : (
              'Forgot your PIN? Ask the owner to set a new one.'
            )}
          </p>
        </form>
      )}
    </main>
  )
}

/** Owner forgot the PIN: the recovery code shown when the PIN was first set lets them choose a new one. */
function Recover({ user, onBack, onDone }: { user: User; onBack: () => void; onDone: () => void }) {
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const ok = code.replace(/[^a-z0-9]/gi, '').length >= 8 && validPin(pin)
  return (
    <main className="welcome signin">
      <h1 className="welcome-title">New PIN</h1>
      <p className="welcome-sub">Enter the recovery code you were given when you set up your PIN.</p>
      <label className="field">
        <span>Recovery code</span>
        <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH" autoComplete="off" autoCapitalize="characters" />
      </label>
      <label className="field">
        <span>New PIN (4 to 6 digits)</span>
        <input className="pin-input" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
      </label>
      {err && <p className="hint warn-text" role="alert">{err}</p>}
      <button
        className="btn primary block"
        disabled={!ok}
        onClick={async () => {
          if (!(await checkRecovery(code))) return setErr('That code is not right. Check it and try again.')
          const salt = newSalt()
          await updateUser(user.id, { salt, pinHash: await hashPin(pin, salt), mustChange: false })
          clearFail(user.id)
          onDone()
        }}
      >
        Save new PIN
      </button>
      <button className="btn plain-btn block" onClick={onBack}>Back</button>
    </main>
  )
}

/** Shown on first sign-in with a temporary PIN: choose your own before using the app. */
export function ForcePin() {
  const { me, signOut } = useAuth()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const ok = validPin(a) && a === b
  return (
    <main className="welcome signin">
      <h1 className="welcome-title">Choose your PIN</h1>
      <p className="welcome-sub">Hello, {me.name}. You signed in with a temporary PIN. Choose one only you know.</p>
      <label className="field">
        <span>New PIN (4 to 6 digits)</span>
        <input className="pin-input" type="password" inputMode="numeric" maxLength={6} value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, ''))} autoFocus />
      </label>
      <label className="field">
        <span>Type it again</span>
        <input className="pin-input" type="password" inputMode="numeric" maxLength={6} value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, ''))} />
      </label>
      {b.length > 0 && a !== b && <p className="hint warn-text">The two PINs are different.</p>}
      <button
        className="btn primary block"
        disabled={!ok}
        onClick={async () => {
          const salt = newSalt()
          await updateUser(me.id, { salt, pinHash: await hashPin(a, salt), mustChange: false })
        }}
      >
        Save PIN and continue
      </button>
      <button className="btn plain-btn block" onClick={signOut}>Cancel</button>
    </main>
  )
}

/** Change my own PIN from the menu. Asks for the current one first. */
export function ChangePinSheet({ onClose }: { onClose: () => void }) {
  const { me } = useAuth()
  const [cur, setCur] = useState('')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const ok = validPin(cur) && validPin(a) && a === b

  return (
    <Sheet title="Change my PIN" onClose={onClose}>
      {done ? (
        <>
          <p className="hint ok-text" role="status">Your PIN has been changed.</p>
          <button className="btn primary block" onClick={onClose}>Done</button>
        </>
      ) : (
        <>
          <label className="field">
            <span>Current PIN</span>
            <input className="pin-input" type="password" inputMode="numeric" maxLength={6} value={cur} onChange={(e) => setCur(e.target.value.replace(/\D/g, ''))} />
          </label>
          <label className="field">
            <span>New PIN (4 to 6 digits)</span>
            <input className="pin-input" type="password" inputMode="numeric" maxLength={6} value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, ''))} />
          </label>
          <label className="field">
            <span>Type the new PIN again</span>
            <input className="pin-input" type="password" inputMode="numeric" maxLength={6} value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, ''))} />
          </label>
          {b.length > 0 && a !== b && <p className="hint warn-text">The two PINs are different.</p>}
          {err && <p className="hint warn-text" role="alert">{err}</p>}
          <button
            className="btn primary block"
            disabled={!ok}
            onClick={async () => {
              const u = await db.users.get(me.id)
              if (!u || (await hashPin(cur, u.salt)) !== u.pinHash) return setErr('Your current PIN is not right.')
              const salt = newSalt()
              await updateUser(me.id, { salt, pinHash: await hashPin(a, salt) })
              setDone(true)
            }}
          >
            Change PIN
          </button>
        </>
      )}
    </Sheet>
  )
}
