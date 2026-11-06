import { useState } from 'react'
import { seedStarter, type StarterKind } from './seed'
import { toWaNumber } from './format'
import { setOwnerPhone } from './shop'
import { cloudOn } from './cloud'

const CHOICES: { kind: StarterKind; title: string; hint: string }[] = [
  { kind: 'grocery', title: 'Groceries and household', hint: 'Flour, sugar, oil, soap and similar' },
  { kind: 'hardware', title: 'Hardware', hint: 'Nails, cement, paint, bulbs and similar' },
  { kind: 'beauty', title: 'Cosmetics and beauty', hint: 'Lotion, soap, shampoo and similar' },
  { kind: 'food', title: 'Food and drinks I make', hint: 'Porridge, tea, meals. No stock count; ingredients go under Expenses' },
  { kind: 'none', title: 'I’ll add my own', hint: 'Start with an empty list' }
]

export function Welcome({ onDone }: { onDone: (shop: string) => void }) {
  const [shop, setShop] = useState('')
  const [kind, setKind] = useState<StarterKind>('grocery')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const wa = toWaNumber(phone)
  const phoneBad = phone.trim().length > 0 && !wa
  const ok = shop.trim().length >= 2 && !phoneBad

  const go = async () => {
    if (!ok || busy) return
    setBusy(true)
    await seedStarter(kind)
    if (wa) setOwnerPhone(wa)
    onDone(shop.trim())
  }

  return (
    <main className="welcome">
      <img src="icon.svg" alt="" width="64" height="64" className="welcome-mark" />
      <h1 className="welcome-title">Hesabu</h1>
      <p className="welcome-sub">Know what’s happening in your shop, even when you’re not there.</p>

      <label className="field">
        <span>Your shop’s name</span>
        <input
          type="text"
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          placeholder="e.g. Mama Njeri Shop"
          autoComplete="off"
        />
      </label>

      <label className="field">
        <span>Your WhatsApp number (optional)</span>
        <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
        {phoneBad ? (
          <small className="hint warn-text">Enter a Kenyan number like 0712 345 678.</small>
        ) : (
          <small className="hint">Your end-of-day summary is sent here.{cloudOn ? ' We also use it to help you if something goes wrong.' : ''}</small>
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

      <button className="btn primary block" disabled={!ok || busy} onClick={go}>
        Open my shop
      </button>
    </main>
  )
}
