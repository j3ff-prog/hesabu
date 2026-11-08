import { useState } from 'react'
import { api } from './api'
import { ApiError, type Session, type ShopInfo } from './cloudApi'
import { showPhone, toWaNumber, SUPPORT_EMAIL } from './format'
import { validPin } from './pin'
import { ROLE_LABEL } from './rights'
import { Sheet } from './Sheet'

const digits = (v: string): string => v.replace(/\D/g, '').slice(0, 6)

function message(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'network') return 'No internet. Connect and try again.'
    if (e.code === 'wrong') return 'Wrong phone number or PIN.'
    if (e.code === 'exists') return 'That number already has an account. Sign in instead.'
    return e.message
  }
  return 'Something went wrong. Try again.'
}

/** Phone number and a 6 digit PIN: sign in, or make a new account. */
export function AuthScreen({ onDone }: { onDone: (s: Session, shops: ShopInfo[]) => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const wa = toWaNumber(phone)
  const phoneBad = phone.trim().length > 0 && !wa
  const ok = !!wa && validPin(pin) && (mode === 'in' || pin === again)

  const go = async () => {
    if (!ok || busy || !wa) return
    setBusy(true)
    setErr('')
    try {
      const s = mode === 'in' ? await api.signIn(wa, pin) : await api.signUp(wa, pin)
      onDone(s, mode === 'in' ? await api.myShops() : [])
    } catch (e) {
      setErr(message(e))
      setBusy(false)
    }
  }

  return (
    <main className="welcome signin">
      <img src="icon.svg" alt="" width="64" height="64" className="welcome-mark" />
      <h1 className="welcome-title">Tallyfy</h1>
      <p className="welcome-sub">{mode === 'in' ? 'Sign in with your phone number and PIN.' : 'Make your account. Your first month is free.'}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void go()
        }}
      >
        <label className="field">
          <span>Phone number</span>
          <input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
          {phoneBad && <small className="hint warn-text">Enter a Kenyan number like 0712 345 678.</small>}
        </label>
        <label className="field">
          <span>{mode === 'in' ? 'PIN' : 'Choose a PIN (6 digits)'}</span>
          <input className="pin-input" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => { setPin(digits(e.target.value)); setErr('') }} />
        </label>
        {mode === 'up' && (
          <label className="field">
            <span>Type the PIN again</span>
            <input className="pin-input" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={again} onChange={(e) => setAgain(digits(e.target.value))} />
            {again.length > 0 && pin !== again && <small className="hint warn-text">The two PINs are different.</small>}
          </label>
        )}
        {err && <p className="hint warn-text" role="alert">{err}</p>}
        <button className="btn primary block" type="submit" disabled={!ok || busy}>
          {mode === 'in' ? 'Sign in' : 'Make my account'}
        </button>
      </form>
      <button className="btn plain-btn block" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr(''); setPin(''); setAgain('') }}>
        {mode === 'in' ? 'New here? Make an account' : 'I already have an account'}
      </button>
      <p className="hint center">Signing in needs internet. After that, the app opens without it until you sign out.</p>
      {mode === 'in' && <p className="hint center">Forgot your PIN? Staff: ask your shop owner to set a new one. Owners: email {SUPPORT_EMAIL} from the email or WhatsApp number you gave us.</p>}
    </main>
  )
}

/** For people who belong to more than one shop. */
export function ShopPicker({ shops, onPick, onSignOut }: { shops: ShopInfo[]; onPick: (id: string) => void; onSignOut: () => void }) {
  return (
    <main className="welcome signin">
      <h1 className="welcome-title">Which shop?</h1>
      <ul className="people">
        {shops.map((s) => (
          <li key={s.id}>
            <button className="person" onClick={() => onPick(s.id)}>
              <span className="avatar">{s.name.trim()[0]?.toUpperCase()}</span>
              <span className="person-main">
                <span className="person-name">{s.name}</span>
                <span className="muted">{ROLE_LABEL[s.role]}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button className="btn plain-btn block" onClick={onSignOut}>Sign out</button>
    </main>
  )
}

/** Change my own PIN from the menu. Asks for the current one first. */
export function ChangePinSheet({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState('')
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const ok = validPin(cur) && validPin(a) && a === b

  const field = (label: string, v: string, set: (s: string) => void) => (
    <label className="field">
      <span>{label}</span>
      <input className="pin-input" type="password" inputMode="numeric" maxLength={6} value={v} onChange={(e) => { set(digits(e.target.value)); setErr('') }} />
    </label>
  )

  return (
    <Sheet title="Change my PIN" onClose={onClose}>
      {done ? (
        <>
          <p className="hint ok-text" role="status">Your PIN has been changed.</p>
          <button className="btn primary block" onClick={onClose}>Done</button>
        </>
      ) : (
        <>
          {field('Current PIN', cur, setCur)}
          {field('New PIN (6 digits)', a, setA)}
          {field('Type the new PIN again', b, setB)}
          {b.length > 0 && a !== b && <p className="hint warn-text">The two PINs are different.</p>}
          {err && <p className="hint warn-text" role="alert">{err}</p>}
          <button
            className="btn primary block"
            disabled={!ok || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await api.changePin(cur, a)
                setDone(true)
              } catch (e) {
                setErr(message(e))
              }
              setBusy(false)
            }}
          >
            Change PIN
          </button>
        </>
      )}
    </Sheet>
  )
}

export { showPhone }
