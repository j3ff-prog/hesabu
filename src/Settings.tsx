import { useRef, useState } from 'react'
import { exportAll, importAll } from './db'
import { showPhone, toWaNumber } from './format'
import { getOwnerPhone, setOwnerPhone } from './shop'
import { Sheet } from './Sheet'
import { cloudOn } from './cloud'

export function SettingsSheet({
  shop,
  onRename,
  onClose,
  needNumber = false
}: {
  shop: string
  onRename: (name: string) => void
  onClose: () => void
  needNumber?: boolean
}) {
  const [name, setName] = useState(shop)
  const owner = getOwnerPhone()
  const [phone, setPhone] = useState(owner ? showPhone(owner) : '')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const wa = toWaNumber(phone)
  const phoneBad = phone.trim().length > 0 && !wa
  const nameOk = name.trim().length >= 2

  const download = async () => {
    setError('')
    const data = await exportAll(shop, getOwnerPhone())
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hesabu-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    setMsg(`Backup saved: ${data.products.length} products, ${data.sales.length} sales. Keep a copy somewhere safe, like WhatsApp to yourself or Google Drive.`)
  }

  const restore = async () => {
    if (!pending) return
    try {
      const data = await importAll(JSON.parse(await pending.text()))
      if (data.shop) onRename(data.shop)
      if (data.owner) setOwnerPhone(data.owner)
      setError('')
      setMsg(`Restored ${data.products.length} products and ${data.sales.length} sales.`)
    } catch (e) {
      setMsg('')
      setError(e instanceof Error ? e.message : 'That file could not be read.')
    }
    setPending(null)
    if (fileRef.current) fileRef.current.value = ''
  }

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
      <button
        className="btn primary block"
        disabled={!nameOk || phoneBad}
        onClick={() => {
          onRename(name.trim())
          setOwnerPhone(wa ?? '')
          onClose()
        }}
      >
        Save changes
      </button>

      {cloudOn && (
        <p className="hint spaced">Hesabu shares your shop name, number and usage totals with the Hesabu team so it can support you. Your sales, customers and prices stay on this phone.</p>
      )}

      <h3 className="muted-head">Back up your shop</h3>
      <p className="hint spaced">
        Your sales and stock are stored on this phone only. Download a backup now and then. You can restore it on this phone or a new one.
      </p>
      <button className="btn outline block" onClick={download}>
        Download backup
      </button>

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          setMsg('')
          setError('')
          setPending(e.target.files?.[0] ?? null)
        }}
      />
      {!pending ? (
        <button className="btn outline block gap-top" onClick={() => fileRef.current?.click()}>
          Restore from a backup file
        </button>
      ) : (
        <div className="restore-box">
          <p>
            Restore from <strong>{pending.name}</strong>? This replaces everything on this phone.
          </p>
          <button className="btn text-danger armed block" onClick={restore}>
            Yes, replace everything
          </button>
          <button className="btn plain-btn block" onClick={() => { setPending(null); if (fileRef.current) fileRef.current.value = '' }}>
            Cancel
          </button>
        </div>
      )}
      {msg && <p className="hint ok-text" role="status">{msg}</p>}
      {error && <p className="hint warn-text" role="alert">{error}</p>}
    </Sheet>
  )
}
