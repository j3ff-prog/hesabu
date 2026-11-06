import { useState } from 'react'
import { showPhone, toWaNumber } from './format'
import { getOwnerPhone, setOwnerPhone } from './shop'
import { Sheet } from './Sheet'
import { api } from './api'
import { useAuth } from './Auth'

export function SettingsSheet({ onClose, needNumber = false }: { onClose: () => void; needNumber?: boolean }) {
  const { shopId, shopName, refresh } = useAuth()
  const [name, setName] = useState(shopName)
  const owner = getOwnerPhone()
  const [phone, setPhone] = useState(owner ? showPhone(owner) : '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const wa = toWaNumber(phone)
  const phoneBad = phone.trim().length > 0 && !wa
  const nameOk = name.trim().length >= 2

  return (
    <Sheet title="Shop settings" onClose={onClose}>
      <label className="field">
        <span>Shop name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Owner’s WhatsApp number</span>
        <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
      </label>
      {phoneBad ? (
        <p className="hint warn-text">Enter a Kenyan number like 0712 345 678.</p>
      ) : (
        <p className="hint">
          {needNumber ? 'Add the owner’s number to send the summary. ' : ''}The end-of-day summary is sent to this number on WhatsApp.
        </p>
      )}
      {err && <p className="hint warn-text" role="alert">{err}</p>}
      <button
        className="btn primary block"
        disabled={!nameOk || phoneBad || busy}
        onClick={async () => {
          setBusy(true)
          try {
            await api.updateShop(shopId, name.trim(), wa ?? '')
            setOwnerPhone(wa ?? '')
            await refresh()
            onClose()
          } catch {
            setErr('Could not save. Check your internet and try again.')
            setBusy(false)
          }
        }}
      >
        Save changes
      </button>
      <p className="hint spaced">Your records are saved online under your account, so they are safe if this phone is lost. Download spreadsheets any time from Data.</p>
    </Sheet>
  )
}
