import { useState } from 'react'
import { saveClosing, type Closing, type Product } from './db'
import { money, showPhone, toNum, toWaNumber } from './format'
import { getFloat, getOwnerPhone, setFloat, setOwnerPhone } from './shop'
import { Sheet } from './Sheet'
import { diffText, expectedCash, openWhatsApp, summaryText, waLink, type DayFigures } from './summary'

/** Count the cash, see if it matches, and (optionally) send the day's summary to the owner. */
export function CloseDaySheet({
  shop,
  day,
  figures,
  low,
  existing,
  onClose
}: {
  shop: string
  day: number
  figures: DayFigures
  low: Product[]
  existing: Closing | null
  onClose: () => void
}) {
  const [started, setStarted] = useState(existing ? String(existing.started) : getFloat())
  const [counted, setCounted] = useState(existing ? String(existing.counted) : '')
  const owner = getOwnerPhone()
  const [phone, setPhone] = useState(owner ? showPhone(owner) : '')

  const startedN = Math.round(toNum(started))
  const expected = expectedCash(startedN, figures)
  const hasCount = counted.trim() !== ''
  const countedN = Math.round(toNum(counted))
  const diff = countedN - expected

  const wa = toWaNumber(phone)
  const phoneBad = phone.trim().length > 0 && !wa

  const save = async (send: boolean) => {
    if (!hasCount) return
    const closing: Closing = { day, started: startedN, expected, counted: countedN, diff, createdAt: Date.now() }
    await saveClosing(closing)
    setFloat(String(startedN))
    if (send && wa) {
      setOwnerPhone(wa)
      openWhatsApp(waLink(wa, summaryText(shop, day, figures, closing, low)))
    }
    onClose()
  }

  return (
    <Sheet title="Close the day" onClose={onClose}>
      <label className="field">
        <span>Cash in the till when you opened (KES)</span>
        <input type="text" inputMode="numeric" value={started} onChange={(e) => setStarted(e.target.value)} placeholder="0" />
      </label>

      <ul className="calc">
        <li><span>Cash sales</span><span>{money(figures.cash)}</span></li>
        {figures.cashCollected > 0 && <li><span>Cash paid back by credit customers</span><span>{money(figures.cashCollected)}</span></li>}
        {figures.cashSpent > 0 && <li><span>Cash spent on expenses</span><span>− {money(figures.cashSpent)}</span></li>}
        <li className="calc-total"><span>Cash that should be in the till</span><span>KES {money(expected)}</span></li>
      </ul>

      <label className="field">
        <span>Cash you counted (KES)</span>
        <input type="text" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="Count the till, then enter it here" />
      </label>

      {hasCount && (
        <p className={'result ' + (diff === 0 ? 'ok' : 'bad')} role="status">
          {diffText(diff)}
        </p>
      )}

      <label className="field">
        <span>Owner’s WhatsApp number</span>
        <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
      </label>
      {phoneBad && <p className="hint warn-text">Enter a Kenyan number like 0712 345 678.</p>}

      <button className="btn primary block" disabled={!hasCount || !wa} onClick={() => save(true)}>
        Save and send to owner
      </button>
      <button className="btn outline block gap-top" disabled={!hasCount} onClick={() => save(false)}>
        Save only
      </button>
      {!hasCount && <p className="hint center">Enter the cash you counted to continue.</p>}
    </Sheet>
  )
}
