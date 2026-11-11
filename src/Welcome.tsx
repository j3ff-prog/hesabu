import { useState } from 'react'
import { seedStarter, type StarterKind } from './seed'
import { toWaNumber, showPhone } from './format'
import { setOwnerPhone } from './shop'
import { api } from './api'
import { ApiError } from './cloudApi'
import { openShopDb } from './db'

const CHOICES: { kind: StarterKind; title: string; hint: string }[] = [
  { kind: 'grocery', title: 'Groceries and household', hint: 'Everyday goods for the home' },
  { kind: 'hardware', title: 'Hardware', hint: 'Tools and building materials' },
  { kind: 'beauty', title: 'Cosmetics and beauty', hint: 'Beauty and personal care' },
  { kind: 'food', title: 'Food and drinks I make', hint: 'Food or drinks you prepare and sell. No stock count to keep' },
  { kind: 'none', title: 'I’ll add my own', hint: 'Start with an empty list' }
]

/** Second step of making an account: name the shop and pick a starter list. */
export function CreateShop({ phone: login, onDone, onSignOut }: { phone: string; onDone: (shopId: string) => void; onSignOut: () => void }) {
  const [shop, setShop] = useState('')
  const [me, setMe] = useState('')
  const [kind, setKind] = useState<StarterKind>('grocery')
  const [phone, setPhone] = useState(showPhone(login))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const wa = toWaNumber(phone)
  const phoneBad = phone.trim().length > 0 && !wa
  const ok = shop.trim().length >= 2 && me.trim().length >= 2 && !phoneBad

  const go = async () => {
    if (!ok || busy) return
    setBusy(true)
    setErr('')
    try {
      const id = await api.createShop(shop.trim(), me.trim(), wa ?? '')
      openShopDb(id)
      await seedStarter(kind)
      if (wa) setOwnerPhone(wa)
      onDone(id)
    } catch (e) {
      setErr(e instanceof ApiError && e.code === 'network' ? 'No internet. Connect and try again.' : 'Could not make your shop. Try again.')
      setBusy(false)
    }
  }

  return (
    <main className="welcome">
      <img src="icon.svg" alt="" width="64" height="64" className="welcome-mark" />
      <h1 className="welcome-title">Tallyfy</h1>
      <p className="welcome-sub">Know what’s happening in your shop, even when you’re not there.</p>

      <label className="field">
        <span>Your name</span>
        <input type="text" value={me} onChange={(e) => setMe(e.target.value)} autoComplete="name" />
      </label>

      <label className="field">
        <span>Name of your shop or business</span>
        <input
          type="text"
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          
          autoComplete="off"
        />
      </label>

      <label className="field">
        <span>Your WhatsApp number (optional)</span>
        <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
        {phoneBad ? (
          <small className="hint warn-text">Enter a Kenyan number like 0712 345 678.</small>
        ) : (
          <small className="hint">Your end-of-day summary is sent here.</small>
        )}
      </label>

      <fieldset className="field">
        <legend>What do you sell?</legend>
        <p className="hint">We’ll add a sample list so you can try the app right away. You can change everything later.</p>
        <div className="choices" role="radiogroup">
          {CHOICES.map((c) => (
            <button
              key={c.kind}
              role="radio"
              aria-checked={kind === c.kind}
              className={'choice' + (kind === c.kind ? ' on' : '')}
              onClick={() => setKind(c.kind)}
            >
              <span className="choice-title">{c.title}</span>
              <span className="choice-hint">{c.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {err && <p className="hint warn-text" role="alert">{err}</p>}
      <button className="btn primary block" disabled={!ok || busy} onClick={go}>
        Open my shop
      </button>
      <p className="hint center">Free for your first 30 days.</p>
      <button className="btn plain-btn block" onClick={onSignOut}>Sign out</button>
    </main>
  )
}
