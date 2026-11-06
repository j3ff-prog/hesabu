import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addExpense, CATEGORIES, db, deleteExpense, isService, STOCK_CATEGORY, type Expense, type Product, type RestockLine } from './db'
import { money, timeOf, shortDate, toNum } from './format'
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
  const [method, setMethod] = useState<'cash' | 'mpesa'>('cash')
  const [lines, setLines] = useState<Line[]>([])
  const [q, setQ] = useState('')
  const restock = category === STOCK_CATEGORY

  const sum = lines.reduce((t, l) => t + Math.max(0, toNum(l.qty)) * Math.max(0, toNum(l.cost)), 0)
  const shownAmount = restock && !edited ? (sum > 0 ? String(sum) : '') : amount
  const amt = toNum(shownAmount)
  const usable = lines.filter((l) => Math.round(toNum(l.qty)) > 0)
  const valid = amt > 0 && (!restock || usable.length > 0)

  const matches = useMemo(() => {
    const n = q.trim().toLowerCase()
    if (!n || !products) return []
    const taken = new Set(lines.map((l) => l.p.id))
    return products.filter((p) => !isService(p) && !taken.has(p.id) && p.name.toLowerCase().includes(n)).slice(0, 6)
  }, [q, products, lines])

  const patch = (id: number, k: 'qty' | 'cost', v: string) =>
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
            <button key={c} className={'chip' + (category === c ? ' on' : '')} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {category === 'Ingredients' && (
        <p className="hint">Flour, milk, cooking gas and other things you use up to make food. They are taken off your profit, so Hesabu can show what your food and services really earn.</p>
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
        <span>{restock ? 'Supplier or note (optional)' : 'Note (optional)'}</span>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={restock ? 'e.g. Wholesale, Gikomba' : 'e.g. Matatu to town'} />
      </label>
      <div className="segment" role="radiogroup" aria-label="Paid with">
        {(['cash', 'mpesa'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={method === m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>
            {m === 'cash' ? 'Paid with cash' : 'Paid by M-Pesa'}
          </button>
        ))}
      </div>
      <p className="hint spaced">Cash expenses are taken off the cash you should have in the till.</p>
      <button className="btn primary block" disabled={!valid} onClick={save}>
        {restock ? 'Save and add to stock' : 'Save expense'}
      </button>
      {restock && usable.length === 0 && <p className="hint center">Pick at least one product.</p>}
    </Sheet>
  )
}

/** Look at one expense and remove it. Removing a stock purchase takes that stock back off the shelf. */
export function ExpenseDetail({ expense, onClose, canRemove }: { expense: Expense; onClose: () => void; canRemove: boolean }) {
  const [sure, setSure] = useState(false)
  return (
    <Sheet title="Expense" onClose={onClose}>
      <p className="sheet-balance"><span>KES</span> {money(expense.amount)}</p>
      <p className="muted">
        {expense.category} · {expense.method === 'cash' ? 'Cash' : 'M-Pesa'} · {shortDate(expense.createdAt)}, {timeOf(expense.createdAt)}
        {expense.byName ? ` · ${expense.byName}` : ''}
      </p>
      {expense.note && expense.note !== expense.category && <p>{expense.note}</p>}
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
      {canRemove && (
        <button
          className={'btn text-danger block' + (sure ? ' armed' : '')}
          onClick={async () => {
            if (!sure) return setSure(true)
            await deleteExpense(expense.id)
            onClose()
          }}
        >
          {sure ? 'Tap again to remove this expense' : 'Remove this expense'}
        </button>
      )}
      {canRemove && expense.items && expense.items.length > 0 && <p className="hint center">Removing it takes this stock off the shelf again.</p>}
    </Sheet>
  )
}
