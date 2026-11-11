import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { customerKey, db, recordSale, saveProduct, voidSale, type Method, type Product, isService } from './db'
import { money, methodLabel, isoDate, addDays, startOfDay, timeOf } from './format'
import { payLabel } from './pay'
import { Sheet } from './Sheet'
import { MinusIcon, PlusIcon, SearchIcon } from './Icons'
import { useToast } from './Toast'
import { useDebtors } from './creditLogic'
import { useAuth } from './Auth'

type Cart = Record<string, number>

/** The Sell page: today's sales, and one big button to record a new one. */
export function Sell() {
  const { can, readOnly } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const today = useLiveQuery(async () => {
    const from = startOfDay()
    return (await db.sales.where('createdAt').aboveOrEqual(from).toArray()).filter((s) => !s.voidedAt).sort((a, b) => b.createdAt - a.createdAt)
  }, [])

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

  const total = (today ?? []).reduce((t, s) => t + s.total, 0)

  return (
    <main className="page has-bar">
      <h1>Sell</h1>
      <p className="muted">
        Today: {(today ?? []).length} {(today ?? []).length === 1 ? 'sale' : 'sales'} · KES {money(total)}
      </p>

      {today && today.length === 0 && (
        <div className="empty">
          <p className="empty-title">No sales yet today</p>
          <ol className="first-steps">
            <li>Tap <strong>New sale</strong> below.</li>
            <li>Tap each item the customer is buying.</li>
            <li>Press <strong>Continue</strong>, choose how they paid, then <strong>Record sale</strong>.</li>
          </ol>
        </div>
      )}
      <ul className="recent">
        {(today ?? []).slice(0, 12).map((s) => (
          <li key={s.id}>
            <div>
              <span className="sale-title">
                <strong>{s.customer || 'Customer'}</strong>
                <span className="sale-what">{s.lines.map((l) => (l.qty > 1 ? `${l.qty} × ${l.name}` : l.name)).join(', ')}</span>
              </span>
              <span className="muted">
                {timeOf(s.createdAt)} · {payLabel(s)}
              </span>
            </div>
            <span className="line-total">{money(s.total)}</span>
          </li>
        ))}
      </ul>

      <div className="cart-bar solo">
        <button className="btn amber block" onClick={() => setOpen(true)}>
          <PlusIcon /> New sale
        </button>
      </div>

      {open && (
        <NewSale
          onClose={() => setOpen(false)}
          onDone={(id, t, who, credit) => {
            setOpen(false)
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

/** Pick what was sold: search, tap to add, change amounts, or add something that is not on the list. */
function NewSale({ onClose, onDone }: { onClose: () => void; onDone: (id: string, total: number, buyer?: string, credit?: boolean) => void }) {
  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), [])
  const { can } = useAuth()
  const [cart, setCart] = useState<Cart>({})
  const [extras, setExtras] = useState<Product[]>([]) // one-time items typed in during this sale
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [paying, setPaying] = useState(false)

  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }))
  const sub = (id: string) =>
    setCart((c) => {
      const next = { ...c }
      if ((next[id] ?? 0) <= 1) delete next[id]
      else next[id] -= 1
      return next
    })

  const all = useMemo(() => [...(products ?? []), ...extras], [products, extras])
  const lines = useMemo(() => all.filter((p) => cart[p.id]).map((p) => ({ p, qty: cart[p.id] })), [all, cart])
  const count = lines.reduce((s, l) => s + l.qty, 0)
  const total = lines.reduce((s, l) => s + l.qty * l.p.price, 0)

  const needle = q.trim().toLowerCase()
  const shown = needle ? all.filter((p) => p.name.toLowerCase().includes(needle)) : all

  if (paying)
    return (
      <Checkout
        lines={lines}
        total={total}
        onAdd={add}
        onSub={sub}
        onClose={() => setPaying(false)}
        onDone={onDone}
      />
    )

  if (adding)
    return (
      <AddItemSheet
        name={q.trim()}
        canSave={can('editStock')}
        canCost={can('seeCost')}
        onClose={() => setAdding(false)}
        onAdd={async (item, save) => {
          let id: string
          if (save) id = await saveProduct(item)
          else {
            id = 'x:' + crypto.randomUUID()
            setExtras((e) => [...e, { ...item, id, createdAt: Date.now(), dirty: 0, rev: 0 }])
          }
          add(id)
          setQ('')
          setAdding(false)
        }}
      />
    )

  return (
    <Sheet title="New sale" onClose={onClose}>
      <label className="search">
        <SearchIcon />
        <input type="search" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" autoFocus />
      </label>

      {shown.length === 0 && <p className="muted pad">Nothing matches “{q}”.</p>}
      <ul className="pick">
        {shown.map((p) => {
          const qty = cart[p.id] ?? 0
          const service = isService(p)
          const out = !service && p.stock <= 0
          return (
            <li key={p.id} className={qty > 0 ? 'on' : ''}>
              <button className="pick-main" onClick={() => add(p.id)} aria-label={`Add ${p.name}, KES ${p.price}`}>
                <span className="pick-name">{p.name}</span>
                <span className="muted">
                  KES {money(p.price)}
                  {!service && !p.id.startsWith('x:') ? (out ? ' · out of stock' : ` · ${p.stock} in stock`) : ''}
                </span>
              </button>
              {qty > 0 ? (
                <div className="stepper">
                  <button onClick={() => sub(p.id)} aria-label={`Remove one ${p.name}`}>
                    <MinusIcon />
                  </button>
                  <span aria-live="polite">{qty}</span>
                  <button onClick={() => add(p.id)} aria-label={`Add one more ${p.name}`}>
                    <PlusIcon />
                  </button>
                </div>
              ) : (
                <button className="pick-add" onClick={() => add(p.id)} aria-hidden="true" tabIndex={-1}>
                  <PlusIcon />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <button className="btn outline block gap-top" onClick={() => setAdding(true)}>
        <PlusIcon /> Not on the list? Add an item
      </button>

      <div className="sheet-foot">
        <div>
          <span className="cart-count">{count} {count === 1 ? 'item' : 'items'}</span>
          <span className="cart-total">KES {money(total)}</span>
        </div>
        <button className="btn amber" disabled={count === 0} onClick={() => setPaying(true)}>
          Continue
        </button>
      </div>
    </Sheet>
  )
}

type NewItem = Omit<Product, 'id' | 'createdAt' | 'dirty' | 'rev'>

function AddItemSheet({
  name: start,
  canSave,
  canCost,
  onClose,
  onAdd
}: {
  name: string
  canSave: boolean
  canCost: boolean
  onClose: () => void
  onAdd: (item: NewItem, save: boolean) => void
}) {
  const [name, setName] = useState(start)
  const [kind, setKind] = useState<'goods' | 'service'>('service')
  const [price, setPrice] = useState('')
  const [cost, setCost] = useState('')
  const [stock, setStock] = useState('')
  const [save, setSave] = useState(canSave)
  const ok = name.trim().length >= 2 && Number(price) > 0

  return (
    <Sheet title="Add an item" onClose={onClose}>
      <fieldset className="field">
        <legend>What kind of item?</legend>
        <div className="segment" role="radiogroup">
          <button role="radio" aria-checked={kind === 'goods'} className={kind === 'goods' ? 'on' : ''} onClick={() => setKind('goods')}>
            Goods
          </button>
          <button role="radio" aria-checked={kind === 'service'} className={kind === 'service' ? 'on' : ''} onClick={() => setKind('service')}>
            Food or service
          </button>
        </div>
        <p className="hint spaced">{kind === 'goods' ? 'Something you buy and resell.' : 'Something you make or do.'}</p>
      </fieldset>
      <label className="field">
        <span>Name of the item</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span>Selling price (KES)</span>
        <input type="number" inputMode="numeric" min="1" value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      {kind === 'goods' && save && (
        <div className="two">
          {canCost && (
            <label className="field">
              <span>Buying price (optional)</span>
              <input type="number" inputMode="numeric" min="0" value={cost} onChange={(e) => setCost(e.target.value)} />
            </label>
          )}
          <label className="field">
            <span>In stock (optional)</span>
            <input type="number" inputMode="numeric" min="0" value={stock} onChange={(e) => setStock(e.target.value)} />
          </label>
        </div>
      )}
      {canSave ? (
        <label className="check">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          <span>Keep it on my list for next time</span>
        </label>
      ) : (
        <p className="hint">This sells it once. The owner can add it to the list.</p>
      )}
      <button
        className="btn primary block"
        disabled={!ok}
        onClick={() =>
          onAdd(
            {
              name: name.trim(),
              price: Number(price),
              cost: kind === 'goods' && save ? Number(cost) || 0 : 0,
              stock: kind === 'goods' && save ? Number(stock) || 0 : 0,
              lowAt: 0,
              kind
            },
            save
          )
        }
      >
        Add to sale
      </button>
    </Sheet>
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
    // If the phone's storage ever stalls, never leave the button greyed out: close and let the list show the truth.
    let finished = false
    const watchdog = window.setTimeout(() => {
      if (finished) return
      finished = true
      setSaving(false)
      onClose()
    }, 6000)
    try {
      const { id, total: t } = await recordSale(
        lines.map(({ p, qty }) => ({ productId: p.id.startsWith('x:') ? '' : p.id, name: p.name, qty, price: p.price, cost: p.cost, ...(isService(p) ? { service: true } : {}) })),
        { cash: cashAmt, mpesa: mpesaAmt, credit: creditAmt },
        who,
        isCredit ? new Date(due + 'T23:59:59').getTime() : undefined
      )
      if (!finished) {
        finished = true
        onDone(id, t, who, isCredit)
      }
    } catch {
      if (!finished) {
        finished = true
        setSaving(false)
      }
    } finally {
      window.clearTimeout(watchdog)
    }
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
          placeholder={isCredit ? 'Customer name' : 'You can leave this empty'}
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

