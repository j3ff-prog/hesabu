import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addDays, isoDate, startOfDay } from './format'
import { addExpense, CATEGORIES, db, defaultPeriod, deleteExpense, deleteExpensePayment, isService, payExpense, PERIODS, STOCK_CATEGORY, type Expense, type Period, type Product, type RestockLine } from './db'
import { billOf, perDay } from './ledger'
import { money, timeOf, shortDate, toNum } from './format'
import { useToast } from './Toast'
import { Sheet } from './Sheet'
import { SearchIcon } from './Icons'

interface Line {
  p: Product
  qty: string
  cost: string
}

/** Add an expense. If it is for new stock, pick the products: stock goes up and buying prices update. */
export function ExpenseSheet({ onClose, onSaved }: { onClose: () => void; onSaved?: (e: { amount: number; restocked: number }) => void }) {
  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), [])
  const [category, setCategory] = useState<string>('Transport')
  const [amount, setAmount] = useState('')
  const [edited, setEdited] = useState(false) // true once the person typed their own total
  const [note, setNote] = useState('')
  const [method, setMethod] = useState<'cash' | 'mpesa' | 'credit'>('cash')
  const [period, setPeriod] = useState<Period>(defaultPeriod('Transport'))
  const [supplier, setSupplier] = useState('')
  const [due, setDue] = useState(() => isoDate(addDays(startOfDay(), 14)))
  const [lines, setLines] = useState<Line[]>([])
  const [q, setQ] = useState('')
  const restock = category === STOCK_CATEGORY

  const sum = lines.reduce((t, l) => t + Math.max(0, toNum(l.qty)) * Math.max(0, toNum(l.cost)), 0)
  const shownAmount = restock && !edited ? (sum > 0 ? String(sum) : '') : amount
  const amt = toNum(shownAmount)
  const usable = lines.filter((l) => Math.round(toNum(l.qty)) > 0)
  const credit = method === 'credit'
  const valid = amt > 0 && (!restock || usable.length > 0) && (!credit || (supplier.trim().length >= 2 && !!due))

  const matches = useMemo(() => {
    const n = q.trim().toLowerCase()
    if (!n || !products) return []
    const taken = new Set(lines.map((l) => l.p.id))
    return products.filter((p) => !isService(p) && !taken.has(p.id) && p.name.toLowerCase().includes(n)).slice(0, 6)
  }, [q, products, lines])

  const patch = (id: string, k: 'qty' | 'cost', v: string) =>
    setLines((ls) => ls.map((l) => (l.p.id === id ? { ...l, [k]: v } : l)))

  const save = async () => {
    if (!valid) return
    const items: RestockLine[] = restock
      ? usable.map((l) => ({ productId: l.p.id, name: l.p.name, qty: Math.round(toNum(l.qty)), cost: toNum(l.cost) }))
      : []
    await addExpense({
      amount: amt,
      category,
      method,
      period: restock ? 'day' : period,
      ...(credit ? { supplier: supplier.trim(), dueAt: new Date(due + 'T23:59:59').getTime() } : {}),
      items,
      note: note.trim() || (restock ? items.map((i) => `${i.qty} × ${i.name}`).join(', ') : category)
    })
    onSaved?.({ amount: amt, restocked: items.length })
    onClose()
  }

  return (
    <Sheet title="Add expense" onClose={onClose}>
      <div className="field">
        <span className="label-like">What was it for?</span>
        <div className="chips tight">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={'chip' + (category === c ? ' on' : '')}
              onClick={() => {
                setCategory(c)
                setPeriod(defaultPeriod(c))
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {category === 'Supplies' && (
        <p className="hint">Things you use up to make or do what you sell. They are taken off your profit, so Tallyfy shows what you really earn.</p>
      )}

      {restock && (
        <div className="restock">
          <p className="hint">Pick what you bought. The stock goes up by these amounts and the buying price is updated.</p>
          <label className="search">
            <SearchIcon />
            <input type="search" placeholder="Search your products" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search your products" />
          </label>
          {q.trim() && matches.length === 0 && <p className="hint">No goods match. Add the item under Items first.</p>}
          {matches.length > 0 && (
            <ul className="picks">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => {
                      setLines((ls) => [...ls, { p, qty: '1', cost: p.cost ? String(p.cost) : '' }])
                      setQ('')
                    }}
                  >
                    <span>{p.name}</span>
                    <span className="muted">{p.stock} in stock</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {lines.length > 0 && (
            <ul className="restock-lines">
              {lines.map((l) => (
                <li key={l.p.id}>
                  <div className="rl-name">
                    <span>{l.p.name}</span>
                    <button className="link inline" onClick={() => setLines((ls) => ls.filter((x) => x.p.id !== l.p.id))}>Remove</button>
                  </div>
                  <div className="two">
                    <label className="field">
                      <span>How many</span>
                      <input type="text" inputMode="numeric" value={l.qty} onChange={(e) => patch(l.p.id, 'qty', e.target.value)} />
                    </label>
                    <label className="field">
                      <span>Cost of each (KES)</span>
                      <input type="text" inputMode="decimal" value={l.cost} onChange={(e) => patch(l.p.id, 'cost', e.target.value)} placeholder="0" />
                    </label>
                  </div>
                  <p className="hint">Stock goes from {l.p.stock} to {l.p.stock + Math.max(0, Math.round(toNum(l.qty)))}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <label className="field">
        <span>{restock ? 'Total paid (KES)' : 'How much did you spend? (KES)'}</span>
        <input
          type="text"
          inputMode="decimal"
          value={shownAmount}
          onChange={(e) => {
            setAmount(e.target.value)
            setEdited(true)
          }}
          placeholder="0"
          autoFocus={!restock}
        />
      </label>
      {restock && sum > 0 && edited && amt !== sum && (
        <p className="hint">The items add up to KES {money(sum)}. Change the total only if you paid extra, like delivery.</p>
      )}
      <label className="field">
        <span>{restock ? 'Where did you buy it? (optional)' : 'What was it for? (optional)'}</span>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {!restock && (
        <div className="field">
          <span className="label-like">How long does it last?</span>
          <div className="chips tight" role="radiogroup" aria-label="How long it lasts">
            {PERIODS.map((p) => (
              <button key={p.id} role="radio" aria-checked={period === p.id} className={'chip' + (period === p.id ? ' on' : '')} onClick={() => setPeriod(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          {period !== 'day' && amt > 0 ? (
            <p className="hint">
              KES {money(amt)} for {PERIODS.find((p) => p.id === period)?.short} counts as about KES {money(perDay({ amount: amt, createdAt: Date.now(), period }))} a day in your profit, so one day never looks like a big loss.
            </p>
          ) : (
            <p className="hint">Rent, salaries and electricity are usually paid once for a whole month. Pick how long it lasts and the cost is spread across those days.</p>
          )}
        </div>
      )}
      <div className="segment three" role="radiogroup" aria-label="Paid with">
        {(['cash', 'mpesa', 'credit'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={method === m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>
            {m === 'cash' ? 'Cash' : m === 'mpesa' ? 'M-Pesa' : 'Pay later'}
          </button>
        ))}
      </div>
      {credit ? (
        <>
          <label className="field">
            <span>Who do you owe? (a person or business)</span>
            <input type="text" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </label>
          <label className="field">
            <span>Pay by</span>
            <input type="date" value={due} min={isoDate(startOfDay())} onChange={(e) => setDue(e.target.value)} />
          </label>
          <p className="hint spaced">Nothing leaves your till until you pay. It shows as money you owe, and still counts as a cost in your profit.</p>
        </>
      ) : (
        <p className="hint spaced">Cash expenses are taken off the cash you should have in the till.</p>
      )}
      <button className="btn primary block" disabled={!valid} onClick={save}>
        {restock ? 'Save and add to stock' : credit ? 'Save as a bill to pay' : 'Save expense'}
      </button>
      {restock && usable.length === 0 && <p className="hint center">Pick at least one product.</p>}
      {credit && supplier.trim().length < 2 && amt > 0 && <p className="hint center">Enter who you owe.</p>}
    </Sheet>
  )
}

/** Look at one expense, pay off a bill that was bought on credit, or remove it. Removing a stock purchase takes that stock back off the shelf. */
export function ExpenseDetail({ expense, onClose, canRemove }: { expense: Expense; onClose: () => void; canRemove: boolean }) {
  const toast = useToast()
  const [sure, setSure] = useState(false)
  const [paying, setPaying] = useState(false)
  const pays = useLiveQuery(() => db.expensePayments.where('expenseId').equals(expense.id).toArray(), [expense.id])
  const credit = expense.method === 'credit'
  const bill = billOf(expense, pays ?? [])
  const mine = (pays ?? []).slice().sort((a, b) => b.createdAt - a.createdAt)
  const late = credit && bill.balance >= 1 && !!expense.dueAt && expense.dueAt < Date.now()
  const per = PERIODS.find((p) => p.id === (expense.period ?? 'day'))
  return (
    <Sheet title={credit ? 'Bill' : 'Expense'} onClose={onClose}>
      <p className="sheet-balance"><span>KES</span> {money(expense.amount)}</p>
      <p className="muted">
        {expense.category} · {credit ? 'Pay later' : expense.method === 'cash' ? 'Cash' : 'M-Pesa'} · {shortDate(expense.createdAt)}, {timeOf(expense.createdAt)}
        {expense.byName ? ` · ${expense.byName}` : ''}
      </p>
      {expense.period && expense.period !== 'day' && per && (
        <p className="muted">Lasts {per.short}. About KES {money(perDay(expense))} a day counts against your profit.</p>
      )}
      {expense.note && expense.note !== expense.category && <p>{expense.note}</p>}

      {credit && (
        <section className="bill-box" aria-label="Payments">
          <p className="bill-line"><span>Owed to</span><strong>{expense.supplier || 'Supplier'}</strong></p>
          <p className="bill-line"><span>Paid so far</span><strong>KES {money(bill.paid)}</strong></p>
          <p className={'bill-line' + (late ? ' bad' : '')}>
            <span>{bill.balance >= 1 ? 'Still to pay' : 'Fully paid'}</span>
            <strong>{bill.balance >= 1 ? `KES ${money(bill.balance)}` : '✓'}</strong>
          </p>
          {expense.dueAt && bill.balance >= 1 && <p className={'hint' + (late ? ' warn-text' : '')}>{late ? 'Was due' : 'Due'} {shortDate(expense.dueAt)}</p>}
          {mine.length > 0 && (
            <ul className="plain pay-history">
              {mine.map((p) => (
                <li key={p.id}>
                  <span>{shortDate(p.createdAt)} · {p.method === 'cash' ? 'Cash' : 'M-Pesa'}{p.byName ? ` · ${p.byName}` : ''}</span>
                  <span className="strong">
                    {money(p.amount)}
                    {canRemove && (
                      <button className="link inline" aria-label={`Remove payment of ${money(p.amount)}`} onClick={() => void deleteExpensePayment(p.id)}>Undo</button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canRemove && bill.balance >= 1 && !paying && (
            <button className="btn primary block" onClick={() => setPaying(true)}>Record a payment</button>
          )}
          {canRemove && paying && <PayBill expenseId={expense.id} balance={bill.balance} onDone={(amt) => { toast.show({ text: 'Payment saved', sub: `KES ${money(amt)} paid to ${expense.supplier || 'supplier'}` }); onClose() }} />}
        </section>
      )}

      {expense.items && expense.items.length > 0 && (
        <>
          <h3 className="muted-head">Added to stock</h3>
          <ul className="plain">
            {expense.items.map((i) => (
              <li key={i.productId}>
                <span>{i.qty} × {i.name}</span>
                <span className="strong">{money(i.qty * i.cost)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {canRemove && !sure && (
        <button className="btn text-danger block" onClick={() => setSure(true)}>Remove this expense</button>
      )}
      {canRemove && sure && (
        <div className="confirm-box" role="alertdialog" aria-label="Remove this expense?">
          <p className="confirm-q">Remove this expense?</p>
          <button
            className="btn danger block"
            onClick={async () => {
              await deleteExpense(expense.id)
              onClose()
            }}
          >
            Yes, remove it
          </button>
          <button className="btn outline block gap-top" onClick={() => setSure(false)}>No, keep it</button>
        </div>
      )}
      {canRemove && expense.items && expense.items.length > 0 && <p className="hint center">Removing it takes this stock off the shelf again.</p>}
    </Sheet>
  )
}

/** Pay some or all of what is owed on a bill. */
function PayBill({ expenseId, balance, onDone }: { expenseId: string; balance: number; onDone: (amount: number) => void }) {
  const [amount, setAmount] = useState(String(Math.round(balance)))
  const [method, setMethod] = useState<'cash' | 'mpesa'>('cash')
  const [busy, setBusy] = useState(false)
  const n = toNum(amount)
  const bad = !(n > 0) || n > balance + 0.5
  const save = async () => {
    if (bad || busy) return
    setBusy(true)
    try {
      const paid = Math.min(n, balance)
      await payExpense(expenseId, paid, method)
      onDone(paid)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="pay-bill">
      <label className="field">
        <span>How much are you paying? (KES)</span>
        <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      </label>
      {n > balance + 0.5 && <p className="hint warn-text">That is more than the KES {money(balance)} you owe.</p>}
      <div className="segment" role="radiogroup" aria-label="Paid with">
        {(['cash', 'mpesa'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={method === m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>
            {m === 'cash' ? 'Paid with cash' : 'Paid by M-Pesa'}
          </button>
        ))}
      </div>
      <button className="btn primary block gap-top" disabled={bad || busy} onClick={save}>Save payment</button>
    </div>
  )
}
