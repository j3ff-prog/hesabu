import { useState } from 'react'
import { addPayment, deletePayment, savePhone } from './db'
import { daysSince, money, shortDate, showPhone, timeOf, toNum, toWaNumber } from './format'
import { useDebtors, type Debtor } from './creditLogic'
import { Sheet } from './Sheet'
import { useToast } from './Toast'

export function Credit({ shop }: { shop: string }) {
  const debtors = useDebtors()
  const [openKey, setOpenKey] = useState<string | null>(null)

  if (!debtors) return <main className="page" />

  const owed = debtors.reduce((t, d) => t + d.balance, 0)
  // Looked up from live data, so the panel updates after a payment and closes when the debt is cleared.
  const open = debtors.find((d) => d.key === openKey)

  return (
    <main className="page">
      <h1>Credit</h1>

      {debtors.length === 0 ? (
        <div className="empty">
          <p className="empty-title">Nobody owes you right now</p>
          <p>When you record a sale “On credit”, the customer shows up here until they pay.</p>
        </div>
      ) : (
        <>
          <div className="owed">
            <p className="owed-label">Total owed to you</p>
            <p className="owed-num"><span>KES</span> {money(owed)}</p>
            <p className="muted">{debtors.length} {debtors.length === 1 ? 'customer' : 'customers'}</p>
          </div>

          <ul className="rows">
            {debtors.map((d) => {
              const days = daysSince(d.since)
              return (
                <li key={d.key}>
                  <button className="row" onClick={() => setOpenKey(d.key)}>
                    <span className="row-main">
                      <span className="row-name">{d.name}</span>
                      {days >= 14 ? (
                        <span className="overdue">Unpaid for {days} days</span>
                      ) : (
                        <span className="muted">Since {shortDate(d.since)}</span>
                      )}
                    </span>
                    <span className="row-bal">{money(d.balance)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {open && <CustomerSheet debtor={open} shop={shop} onClose={() => setOpenKey(null)} />}
    </main>
  )
}

function CustomerSheet({ debtor, shop, onClose }: { debtor: Debtor; shop: string; onClose: () => void }) {
  const toast = useToast()
  const [paying, setPaying] = useState(false)
  const [amount, setAmount] = useState(String(debtor.balance))
  const [method, setMethod] = useState<'cash' | 'mpesa'>('cash')
  const [editPhone, setEditPhone] = useState(!debtor.phone)
  const [phone, setPhone] = useState(debtor.phone ? showPhone(debtor.phone) : '')

  const amt = toNum(amount)
  const tooMuch = amt > debtor.balance
  const canPay = amt > 0 && !tooMuch

  const wa = toWaNumber(phone)
  const phoneBad = phone.trim().length > 0 && !wa

  const pay = async () => {
    if (!canPay) return
    const id = await addPayment(debtor.name, amt, method)
    toast.show({
      text: 'Payment recorded',
      sub: `KES ${money(amt)} from ${debtor.name}`,
      undo: () => void deletePayment(id)
    })
    // Close the panel so the confirmation (and its Undo button) is visible on the list.
    onClose()
  }

  const message = `Hello ${debtor.name}, a friendly reminder from ${shop}: you have an unpaid balance of KES ${money(
    debtor.balance
  )}. Please pay when you can. Thank you.`

  return (
    <Sheet title={debtor.name} onClose={onClose}>
      <p className="owed-label">Owes you</p>
      <p className="sheet-balance"><span>KES</span> {money(debtor.balance)}</p>

      {!paying ? (
        <button className="btn primary block" onClick={() => { setAmount(String(debtor.balance)); setPaying(true) }}>
          Record payment
        </button>
      ) : (
        <div className="pay-box">
          <label className="field">
            <span>How much did they pay? (KES)</span>
            <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          {tooMuch && <p className="hint warn-text">That is more than they owe (KES {money(debtor.balance)}).</p>}
          <div className="segment" role="radiogroup" aria-label="Payment method">
            {(['cash', 'mpesa'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={method === m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>
                {m === 'cash' ? 'Cash' : 'M-Pesa'}
              </button>
            ))}
          </div>
          <button className="btn primary block" disabled={!canPay} onClick={pay}>
            Save payment
          </button>
          <button className="btn block plain-btn" onClick={() => setPaying(false)}>
            Cancel
          </button>
        </div>
      )}

      <div className="remind">
        {debtor.phone && !editPhone ? (
          <>
            <a
              className="btn outline block"
              href={`https://wa.me/${debtor.phone}?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Remind on WhatsApp
            </a>
            <p className="hint center">
              Sends to {showPhone(debtor.phone)}.{' '}
              <button className="link inline" onClick={() => setEditPhone(true)}>Change number</button>
            </p>
          </>
        ) : (
          <>
            <label className="field">
              <span>Phone number, for WhatsApp reminders</span>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0712 345 678"
              />
            </label>
            {phoneBad && <p className="hint warn-text">Enter a Kenyan number like 0712 345 678.</p>}
            <button
              className="btn outline block"
              disabled={!wa}
              onClick={async () => {
                if (!wa) return
                await savePhone(debtor.key, debtor.name, wa)
                setEditPhone(false)
              }}
            >
              Save number
            </button>
          </>
        )}
      </div>

      <h3 className="muted-head">History</h3>
      <ul className="history">
        {debtor.entries.map((e) => (
          <li key={e.kind + e.id}>
            <span className="history-main">
              <span>{e.label}</span>
              <span className="muted">{shortDate(e.at)}, {timeOf(e.at)}</span>
            </span>
            <span className={e.kind === 'payment' ? 'paid' : 'strong'}>
              {e.kind === 'payment' ? '−' : '+'} {money(e.amount)}
            </span>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
