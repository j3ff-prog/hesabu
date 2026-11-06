import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Expense } from './db'
import { addDays, dateLabel, money, startOfDay, timeOf } from './format'
import { PlusIcon } from './Icons'
import { ExpenseDetail, ExpenseSheet } from './ExpenseSheet'
import { useAuth } from './Auth'
import { useToast } from './Toast'

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: '7 days' },
  { id: 'month', label: '30 days' },
  { id: 'all', label: 'All' }
] as const
type RangeId = (typeof RANGES)[number]['id']

export function Expenses() {
  const { can } = useAuth()
  const toast = useToast()
  const [range, setRange] = useState<RangeId>('today')
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const all = useLiveQuery(() => db.expenses.orderBy('createdAt').reverse().toArray(), [])

  const from = range === 'today' ? startOfDay() : range === 'week' ? addDays(startOfDay(), -6) : range === 'month' ? addDays(startOfDay(), -29) : 0
  const list = useMemo(() => (all ?? []).filter((e) => e.createdAt >= from), [all, from])
  const groups = useMemo(() => {
    const m = new Map<number, Expense[]>()
    for (const e of list) {
      const d = startOfDay(e.createdAt)
      m.set(d, [...(m.get(d) ?? []), e])
    }
    return [...m.entries()]
  }, [list])
  const byCat = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of list) m.set(e.category, (m.get(e.category) ?? 0) + e.amount)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [list])

  if (!all) return <main className="page" />
  if (!can('expenses')) return <main className="page"><h1>Expenses</h1><p className="muted">You don’t have access to expenses.</p></main>
  const total = list.reduce((t, e) => t + e.amount, 0)
  const openExpense = all.find((e) => e.id === open)

  return (
    <main className="page has-fab">
      <h1>Expenses</h1>
      <div className="segment small" role="radiogroup" aria-label="Period">
        {RANGES.map((r) => (
          <button key={r.id} role="radio" aria-checked={range === r.id} className={range === r.id ? 'on' : ''} onClick={() => setRange(r.id)}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="owed">
        <p className="owed-label">Spent</p>
        <p className="owed-num"><span>KES</span> {money(total)}</p>
        <p className="muted">{list.length} {list.length === 1 ? 'expense' : 'expenses'}</p>
      </div>

      {byCat.length > 1 && (
        <ul className="cat-pills" aria-label="By category">
          {byCat.map(([c, v]) => (
            <li key={c}><span>{c}</span> <strong>{money(v)}</strong></li>
          ))}
        </ul>
      )}

      {list.length === 0 ? (
        <div className="empty">
          <p className="empty-title">No expenses {range === 'today' ? 'today' : 'in this period'}</p>
          <p>Record rent, transport, salaries and what you pay suppliers. When you buy new stock, pick the products and your stock count goes up by itself.</p>
        </div>
      ) : (
        groups.map(([day, items]) => (
          <section key={day} className="block-section">
            <h3 className="muted-head">{dateLabel(day)}</h3>
            <ul className="plain">
              {items.map((e) => (
                <li key={e.id}>
                  <button className="sale-row" onClick={() => setOpen(e.id)}>
                    <span className="sale-main">
                      <span>{e.category}{e.note && e.note !== e.category ? ` · ${e.note}` : ''}</span>
                      <span className="muted">{timeOf(e.createdAt)} · {e.method === 'cash' ? 'Cash' : 'M-Pesa'}{e.byName ? ` · ${e.byName}` : ''}{e.items?.length ? ' · Added to stock' : ''}</span>
                    </span>
                    <span className="strong">{money(e.amount)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {can('addExpense') && (
        <button className="fab" onClick={() => setAdding(true)}>
          <PlusIcon /> Add expense
        </button>
      )}
      {adding && (
        <ExpenseSheet
          onClose={() => setAdding(false)}
          onSaved={({ amount, restocked }) =>
            toast.show({ text: 'Expense saved', sub: `KES ${money(amount)}${restocked ? ` · ${restocked} ${restocked === 1 ? 'product' : 'products'} added to stock` : ''}` })
          }
        />
      )}
      {openExpense && <ExpenseDetail expense={openExpense} onClose={() => setOpen(null)} canRemove={can('addExpense')} />}
    </main>
  )
}
