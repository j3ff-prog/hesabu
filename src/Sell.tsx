import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { customerKey, db, recordSale, saveProduct, voidSale, type Method, type Product, isService } from './db'
import { money, methodLabel, isoDate, addDays, startOfDay } from './format'
import { Sheet } from './Sheet'
import { MinusIcon, PlusIcon, SearchIcon } from './Icons'
import { useToast } from './Toast'
import { useDebtors } from './creditLogic'
import { useAuth } from './Auth'

type Cart = Record<string, number>

export function Sell() {
  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), [])
  const [cart, setCart] = useState<Cart>({})
  const [q, setQ] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [extras, setExtras] = useState<Product[]>([]) // one-time items typed in during this sale
  const toast = useToast()
  const { can, readOnly } = useAuth()

  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }))
  const sub = (id: string) =>
    setCart((c) => {
      const next = { ...c }
      if ((next[id] ?? 0) <= 1) delete next[id]
      else next[id] -= 1
      return next
    })

  const lines = useMemo(
    () => [...(products ?? []), ...extras].filter((p) => cart[p.id]).map((p) => ({ p, qty: cart[p.id] })),
    [products, extras, cart]
  )
  const count = lines.reduce((s, l) => s + l.qty, 0)
  const total = lines.reduce((s, l) => s + l.qty * l.p.price, 0)

  if (!products) return <main className="page" />

  if (!can('sell')) {
    return (
      <main className="page">
        <h1>Sell</h1>
        <div className="empty">
          <p className="empty-title">{readOnly ? 'Your subscription has ended' : 'You can’t record sales'}</p>
          <p>{readOnly ? 'You can still look at your records and download your data. Renew to start selling again.' : 'Ask the owner for access.'}</p>
        </div>
      </main>
    )
  }

  if (products.length === 0) {
    return (
      <main className="page">
        <h1>Sell</h1>
        <div className="empty">
          <p className="empty-title">Nothing to sell yet</p>
          <p>Add what you sell with its price: goods you stock, or food and services you provide. Then you can record sales in a few taps.</p>
          <Link className="btn primary" to="/stock">
            Add items
          </Link>
        </div>
      </main>
    )
  }

  const needle = q.trim().toLowerCase()
  const shown = needle ? products.filter((p) => p.name.toLowerCase().includes(needle)) : products

  return (
    <main className={'page' + (count > 0 ? ' has-bar' : '')}>
      <h1>Sell</h1>
      <label className="search">
        <SearchIcon />
        <input
          type="search"
          placeholder="Search products"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search products"
        />
      </label>

      <button className="btn outline add-item" onClick={() => setAdding(true)}>
        <PlusIcon /> Add an item that is not on the list
      </button>

      {shown.length === 0 && <p className="muted pad">Nothing matches “{q}”.</p>}

      <div className="tiles">
        {shown.map((p) => (
          <Tile key={p.id} p={p} qty={cart[p.id] ?? 0} onAdd={() => add(p.id)} onSub={() => sub(p.id)} />
        ))}
      </div>

      {count > 0 && (
        <div className="cart-bar">
          <div>
            <span className="cart-count">{count} {count === 1 ? 'item' : 'items'}</span>
            <span className="cart-total">KES {money(total)}</span>
          </div>
          <button className="btn amber" onClick={() => setReviewing(true)}>
            Review sale
          </button>
        </div>
      )}

      {adding && (
        <AddItemSheet
          name={q.trim()}
          canSave={can('editStock')}
          onClose={() => setAdding(false)}
          onAdd={async (name, price, save) => {
            let id: string
            if (save) id = await saveProduct({ name, price, cost: 0, stock: 0, lowAt: 0, kind: 'service' })
            else {
              id = 'x:' + crypto.randomUUID()
              setExtras((e) => [...e, { id, name, price, cost: 0, stock: 0, lowAt: 0, kind: 'service', createdAt: Date.now(), dirty: 0, rev: 0 }])
            }
            add(id)
            setQ('')
            setAdding(false)
          }}
        />
      )}

      {reviewing && (
        <Checkout
          lines={lines}
          total={total}
          onAdd={add}
          onSub={sub}
          onClose={() => setReviewing(false)}
          onDone={(id, t, who, credit) => {
            setCart({})
            setReviewing(false)
            toast.show({
              text: 'Sale recorded',
              sub: !who ? `KES ${money(t)}` : credit ? `KES ${money(t)} · added to ${who}’s credit` : `KES ${money(t)} · ${who}`,
              undo: () => void voidSale(id)
            })
          }}
        />
      )}
    </main>
  )
}

function Tile({ p, qty, onAdd, onSub }: { p: Product; qty: number; onAdd: () => void; onSub: () => void }) {
  const service = isService(p)
  const out = !service && p.stock <= 0
  const low = !service && !out && p.stock <= p.lowAt
  const inCart = qty > 0
  return (
    <div className={'tile' + (inCart ? ' in-cart' : '')}>
      <button className="tile-main" onClick={onAdd} aria-label={`Add ${p.name}, KES ${p.price}`}>
        <span className="tile-name">{p.name}</span>
        <span className="tile-price">KES {money(p.price)}</span>
        {!service && (
          <span className={'tile-stock' + (out || low ? ' warn' : '')}>
            {out ? 'Out of stock' : low ? `Only ${p.stock} left` : `${p.stock} in stock`}
          </span>
        )}
      </button>
      {inCart && (
        <div className="tile-step">
          <button onClick={onSub} aria-label={`Remove one ${p.name}`}>
            <MinusIcon />
          </button>
          <span className="tile-qty" aria-live="polite">{qty}</span>
          <button onClick={onAdd} aria-label={`Add one more ${p.name}`}>
            <PlusIcon />
          </button>
        </div>
      )}
    </div>
  )
}

function Checkout({
  lines,
  total,
  onAdd,
  onSub,
  onClose,
  onDone
}: {
  lines: { p: Product; qty: number }[]
  total: number
  onAdd: (id: string) => void
  onSub: (id: string) => void
  onClose: () => void
  onDone: (id: string, total: number, buyer?: string, credit?: boolean) => void
}) {
  const [method, setMethod] = useState<Method>('cash')
  const [split, setSplit] = useState(false)
  const [cashIn, setCashIn] = useState('')
  const [mpesaIn, setMpesaIn] = useState('')
  const [due, setDue] = useState(() => isoDate(addDays(startOfDay(), 7)))
  const [customer, setCustomer] = useState('')
  const [saving, setSaving] = useState(false)
  const debtors = useDebtors()
  const known = useKnownBuyers()

  const cashAmt = split ? Math.max(0, Number(cashIn) || 0) : method === 'cash' ? total : 0
  const mpesaAmt = split ? Math.max(0, Number(mpesaIn) || 0) : method === 'mpesa' ? total : 0
  const over = cashAmt + mpesaAmt > total
  const creditAmt = over ? 0 : total - cashAmt - mpesaAmt
  const isCredit = creditAmt > 0
  const needsName = isCredit && customer.trim().length < 2
  const needsDue = isCredit && !due
  const empty = lines.length === 0

  const save = async () => {
    if (saving || needsName || needsDue || over || empty) return
    setSaving(true)
    // Reuse the spelling we already have for this person, so "wanjiku" and "Wanjiku" stay one customer.
    const typed = customer.trim()
    const who = typed ? known.find((k) => k.key === customerKey(typed))?.name ?? typed : undefined
    const { id, total: t } = await recordSale(
      lines.map(({ p, qty }) => ({ productId: p.id.startsWith('x:') ? '' : p.id, name: p.name, qty, price: p.price, cost: p.cost, ...(isService(p) ? { service: true } : {}) })),
      { cash: cashAmt, mpesa: mpesaAmt, credit: creditAmt },
      who,
      isCredit ? new Date(due + 'T23:59:59').getTime() : undefined
    )
    onDone(id, t, who, isCredit)
  }

  const typedKey = customerKey(customer)
  const pool = isCredit ? (debtors ?? []).map((d) => ({ key: d.key, name: d.name })) : known
  const suggestions = pool.filter((d) => d.key !== typedKey && (typedKey === '' || d.key.includes(typedKey))).slice(0, 6)

  return (
    <Sheet title="Review sale" onClose={onClose}>
      <ul className="lines">
        {lines.map(({ p, qty }) => (
          <li key={p.id}>
            <div className="line-name">
              <span>{p.name}</span>
              <span className="muted">KES {money(p.price)} each</span>
            </div>
            <div className="stepper">
              <button onClick={() => onSub(p.id)} aria-label={`Remove one ${p.name}`}>
                <MinusIcon />
              </button>
              <span>{qty}</span>
              <button onClick={() => onAdd(p.id)} aria-label={`Add one more ${p.name}`}>
                <PlusIcon />
              </button>
            </div>
            <span className="line-total">{money(p.price * qty)}</span>
          </li>
        ))}
      </ul>

      <fieldset className="field">
        <legend>How did they pay?</legend>
        <div className="segment" role="radiogroup">
          {(['cash', 'mpesa', 'credit'] as Method[]).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={method === m}
              className={method === m ? 'on' : ''}
              onClick={() => { setMethod(m); setSplit(false) }}
            >
              {methodLabel[m]}
            </button>
          ))}
          <button role="radio" aria-checked={split} className={split ? 'on' : ''} onClick={() => setSplit(true)}>
            Part and part
          </button>
        </div>
        {split && (
          <div className="two split-in">
            <label className="field">
              <span>Paid in cash</span>
              <input type="number" inputMode="numeric" min="0" value={cashIn} onChange={(e) => setCashIn(e.target.value)} placeholder="0" />
            </label>
            <label className="field">
              <span>Paid by M-Pesa</span>
              <input type="number" inputMode="numeric" min="0" value={mpesaIn} onChange={(e) => setMpesaIn(e.target.value)} placeholder="0" />
            </label>
          </div>
        )}
        {split && (
          <p className={'hint' + (over ? ' warn-text' : '')}>
            {over ? `That is more than the total (KES ${money(total)}).` : creditAmt > 0 ? `The rest, KES ${money(creditAmt)}, goes on credit.` : 'Fully paid.'}
          </p>
        )}
      </fieldset>

      <label className="field">
        <span>{isCredit ? 'Who owes you?' : 'Buyer’s name (optional)'}</span>
        <input
          type="text"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          placeholder={isCredit ? 'Customer name' : 'Leave empty if you don’t know'}
          autoComplete="off"
          aria-required={isCredit}
        />
      </label>
      {suggestions.length > 0 && (
        <div className="chips" aria-label={isCredit ? 'Customers who already have credit' : 'Recent buyers'}>
          {suggestions.map((d) => (
            <button key={d.key} className="chip" onClick={() => setCustomer(d.name)}>
              {d.name}
            </button>
          ))}
        </div>
      )}

      {isCredit && (
        <label className="field">
          <span>When will they pay?</span>
          <input type="date" value={due} min={isoDate(startOfDay())} onChange={(e) => setDue(e.target.value)} />
        </label>
      )}

      <div className="total-row">
        <span>Total</span>
        <span className="total-num">KES {money(total)}</span>
      </div>

      <button className="btn primary block" disabled={needsName || needsDue || over || saving || empty} onClick={save}>
        Record sale
      </button>
      {needsName && <p className="hint center">Enter the customer’s name to record a credit sale.</p>}
      {!needsName && needsDue && <p className="hint center">Choose the date they will pay.</p>}
    </Sheet>
  )
}

/** Names of people who bought recently (newest first), each with the spelling used the first time. */
function useKnownBuyers(): { key: string; name: string }[] {
  const recent = useLiveQuery(() => db.sales.orderBy('createdAt').reverse().limit(300).toArray(), [])
  return useMemo(() => {
    const first = new Map<string, string>()
    const order: string[] = []
    // Oldest first, so the first spelling ever seen wins; order list is rebuilt newest first below.
    for (const s of [...(recent ?? [])].reverse()) {
      if (!s.customer) continue
      const k = customerKey(s.customer)
      if (!first.has(k)) first.set(k, s.customer)
    }
    for (const s of recent ?? []) {
      if (!s.customer) continue
      const k = customerKey(s.customer)
      if (!order.includes(k)) order.push(k)
    }
    return order.map((key) => ({ key, name: first.get(key) ?? key }))
  }, [recent])
}

function AddItemSheet({ name: start, canSave, onClose, onAdd }: { name: string; canSave: boolean; onClose: () => void; onAdd: (name: string, price: number, save: boolean) => void }) {
  const [name, setName] = useState(start)
  const [price, setPrice] = useState('')
  const [save, setSave] = useState(canSave)
  const ok = name.trim().length >= 2 && Number(price) > 0
  return (
    <Sheet title="Add an item to this sale" onClose={onClose}>
      <label className="field">
        <span>What is it?</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Delivery, extra cup" autoFocus />
      </label>
      <label className="field">
        <span>Price (KES)</span>
        <input type="number" inputMode="numeric" min="1" value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      {canSave && (
        <label className="check">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          <span>Keep it on my list for next time</span>
        </label>
      )}
      {!canSave && <p className="hint">This sells it once. The owner can add it to the list.</p>}
      <button className="btn primary block" disabled={!ok} onClick={() => onAdd(name.trim(), Number(price), save)}>
        Add to sale
      </button>
    </Sheet>
  )
}
