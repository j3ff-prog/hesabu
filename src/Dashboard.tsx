import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { isService, db } from './db'
import { useDebtors } from './creditLogic'
import { partsOf } from './pay'
import { buildDashboard } from './analytics'
import { useAuth } from './Auth'
import { compact, dateLabel, money, shortDate } from './format'
import { BarChart, Card, COLORS, HBars, Legend, ProfitChart, SplitBar, type BarDatum, type ProfitDatum } from './Charts'

const PERIODS = [1, 7, 30, 90]
const VIEW_KEY = 'hesabu.profitView'
const readView = (): 'bars' | 'line' => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'line' ? 'line' : 'bars'
  } catch {
    return 'bars'
  }
}

const change = (now: number, before: number): string | null => {
  if (before <= 0) return null
  const p = Math.round(((now - before) / before) * 100)
  return (p >= 0 ? '+' : '') + p + '% vs the period before'
}

export function Dashboard() {
  const { can } = useAuth()
  const [days, setDays] = useState(7)
  const [view, setViewState] = useState<'bars' | 'line'>(readView)
  const setView = (v: 'bars' | 'line') => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* ignore */
    }
  }
  const sales = useLiveQuery(() => db.sales.toArray(), [])
  const payments = useLiveQuery(() => db.payments.toArray(), [])
  const expenses = useLiveQuery(() => db.expenses.toArray(), [])
  const products = useLiveQuery(() => db.products.toArray(), [])
  const debtors = useDebtors()

  const d = useMemo(
    () => (sales && payments && expenses && products && debtors ? buildDashboard(sales, payments, expenses, products, debtors, days) : null),
    [sales, payments, expenses, products, debtors, days]
  )
  const worth = useMemo(() => {
    if (!sales || !payments || !expenses || !products || !debtors) return null
    const inn = sales.filter((s) => !s.voidedAt).reduce((t, s) => t + partsOf(s).cash + partsOf(s).mpesa, 0) + payments.reduce((t, p) => t + p.amount, 0)
    const out = expenses.reduce((t, e) => t + e.amount, 0)
    const goods = products.filter((p) => !isService(p) && p.stock > 0)
    const stock = goods.reduce((t, p) => t + p.stock * p.cost, 0)
    return {
      onHand: inn - out,
      stock,
      unpriced: goods.filter((p) => !(p.cost > 0)).length,
      owed: debtors.reduce((t, x) => t + x.balance, 0)
    }
  }, [sales, payments, expenses, products, debtors])
  if (!d) return null
  if (!can('dashboard')) return <p className="muted pad">You don’t have access to the dashboard.</p>

  const salesBars: BarDatum[] = d.daily.map((x) => ({
    label: days <= 7 ? new Date(x.day).toLocaleDateString('en-KE', { weekday: 'short' }) : String(new Date(x.day).getDate()),
    full: dateLabel(x.day) + ` · KES ${money(x.total)}`,
    parts: [
      { name: 'Cash', value: x.cash, color: COLORS.cash },
      { name: 'M-Pesa', value: x.mpesa, color: COLORS.mpesa },
      { name: 'Credit', value: x.credit, color: COLORS.credit }
    ]
  }))
  const profitPoints: ProfitDatum[] = d.daily.map((x, i) => ({ label: salesBars[i].label, full: dateLabel(x.day), value: x.profit }))
  const hours = d.hours.slice(5, 23)
  const hourBars: BarDatum[] = hours.map((h) => ({
    label: h.hour % 3 === 0 ? `${h.hour % 12 || 12}${h.hour < 12 ? 'am' : 'pm'}` : '',
    full: `${h.hour % 12 || 12}${h.hour < 12 ? 'am' : 'pm'} · ${h.count} ${h.count === 1 ? 'sale' : 'sales'}`,
    parts: [{ name: 'Sales', value: h.total, color: COLORS.cash }]
  }))
  const delta = change(d.sales, d.salesPrev)

  return (
    <div className="dash">
      {worth && can('seeCost') && can('expenses') && (
        <section className="worth" aria-label="What the business is worth">
          <p className="kpi-label">What your business is worth</p>
          <p className={'worth-num' + (worth.onHand + worth.stock + worth.owed < 0 ? ' bad' : '')}>KES {money(worth.onHand + worth.stock + worth.owed)}</p>
          <dl>
            <div><dt>Money on hand (cash and M-Pesa)</dt><dd>{money(worth.onHand)}</dd></div>
            <div><dt>Stock you hold, at buying price</dt><dd>{money(worth.stock)}</dd></div>
            <div><dt>Owed to you by customers</dt><dd>{money(worth.owed)}</dd></div>
          </dl>
          <p className="hint">
            Counted from your records since you started using Hesabu. Money you had before, or took out for yourself, is not included.
            {worth.unpriced > 0 ? ` ${worth.unpriced} item${worth.unpriced === 1 ? '' : 's'} in stock ${worth.unpriced === 1 ? 'has' : 'have'} no buying price and ${worth.unpriced === 1 ? 'is' : 'are'} left out.` : ''}
          </p>
        </section>
      )}
      <div className="segment small" role="radiogroup" aria-label="Period">
        {PERIODS.map((p) => (
          <button key={p} role="radio" aria-checked={days === p} className={days === p ? 'on' : ''} onClick={() => setDays(p)}>
            {p === 1 ? 'Today' : `${p} days`}
          </button>
        ))}
      </div>
      <p className="muted sub-range">{days === 1 ? 'Today, ' + shortDate(d.from) : `${shortDate(d.from)} to ${shortDate(d.to - 1)}`}</p>

      <div className="kpis">
        <div className="kpi">
          <p className="kpi-label">Sales</p>
          <p className="kpi-num">KES {money(d.sales)}</p>
          <p className="kpi-sub">{d.count} {d.count === 1 ? 'sale' : 'sales'}{delta ? ` · ${delta}` : ''}</p>
        </div>
        {can('seeCost') && (
          <div className="kpi">
            <p className="kpi-label">Profit</p>
            <p className={'kpi-num ' + (d.profit < 0 ? 'bad' : 'good')}>KES {money(d.profit)}</p>
            <p className="kpi-sub">
              {d.sales === 0
                ? 'No sales yet'
                : d.countedShare < 0.999
                  ? `Based on ${Math.round(d.countedShare * 100)}% of sales. Goods without a buying price are left out.`
                  : 'After costs and expenses'}
            </p>
          </div>
        )}
        {can('expenses') && (
          <div className="kpi">
            <p className="kpi-label">Spent on costs</p>
            <p className="kpi-num">KES {money(d.spent)}</p>
            <p className="kpi-sub">Ingredients, rent, transport and the like{d.stockBought > 0 ? `. Not counting KES ${money(d.stockBought)} of new stock.` : ''}</p>
          </div>
        )}
        {can('expenses') && (
          <div className="kpi">
            <p className="kpi-label">Money on hand</p>
            <p className={'kpi-num ' + (d.onHand.total < 0 ? 'bad' : '')}>KES {money(d.onHand.total)}</p>
            <p className="kpi-sub">Cash {money(d.onHand.cash)} · M-Pesa {money(d.onHand.mpesa)}. Received minus spent. Money owed to you is not counted.</p>
          </div>
        )}
        <div className="kpi">
          <p className="kpi-label">Owed to you now</p>
          <p className="kpi-num">KES {money(d.owed)}</p>
          <p className="kpi-sub">Collected KES {money(d.collected)} in this period</p>
        </div>
      </div>

      <div className="dash-grid">
        <Card title="Sales each day" sub="How the money came in">
          <Legend items={[{ name: 'Cash', color: COLORS.cash }, { name: 'M-Pesa', color: COLORS.mpesa }, { name: 'Credit', color: COLORS.credit }]} />
          <BarChart data={salesBars} label="Sales each day, split by cash, M-Pesa and credit" />
        </Card>

        {can('seeCost') && (
          <Card title="Profit each day" sub="After costs and expenses. A loss goes below the line in red.">
            <div className="segment small view-switch" role="radiogroup" aria-label="Chart style">
              <button role="radio" aria-checked={view === 'bars'} className={view === 'bars' ? 'on' : ''} onClick={() => setView('bars')}>Bars</button>
              <button role="radio" aria-checked={view === 'line'} className={view === 'line' ? 'on' : ''} onClick={() => setView('line')}>Line</button>
            </div>
            <ProfitChart data={profitPoints} mode={view} label="Profit each day" />
          </Card>
        )}

        <Card title="How customers paid">
          <SplitBar parts={[
            { name: 'Cash', value: d.split.cash, color: COLORS.cash },
            { name: 'M-Pesa', value: d.split.mpesa, color: COLORS.mpesa },
            { name: 'Credit', value: d.split.credit, color: COLORS.credit }
          ]} />
        </Card>

        <Card title="Best sellers" sub="By money earned">
          <HBars rows={d.best.map((b) => ({ label: b.name, value: b.revenue, note: `${b.qty} sold` }))} empty="No sales in this period." />
        </Card>

        <Card title="Busiest hours" sub="Money earned by the hour of the day">
          <BarChart data={hourBars} height={160} label="Sales by hour of the day" />
        </Card>

        <Card title="Who owes you, and for how long" sub={`KES ${money(d.owed)} in total`}>
          <HBars
            rows={d.ageing.map((a, i) => ({ label: a.label, value: a.amount, note: `${a.people} ${a.people === 1 ? 'person' : 'people'}`, color: i >= 2 ? COLORS.alert : COLORS.credit }))}
            empty="Nobody owes you right now."
          />
        </Card>

        <Card title="Stock" sub={`${d.stock.total} goods counted${d.stock.services ? `, ${d.stock.services} food or service items not counted` : ''}`}>
          <SplitBar parts={[
            { name: 'Fine', value: d.stock.ok, color: COLORS.cash },
            { name: 'Running low', value: d.stock.low, color: COLORS.mpesa },
            { name: 'Out of stock', value: d.stock.out, color: COLORS.alert }
          ]} />
          {can('seeCost') && (
            <dl className="mini-split">
              <div><dt>Stock worth (buying price)</dt><dd>KES {compact(d.stock.atCost)}</dd></div>
              <div><dt>Stock worth (selling price)</dt><dd>KES {compact(d.stock.atPrice)}</dd></div>
            </dl>
          )}
        </Card>

        {can('expenses') && (
          <Card title="Where the money went" sub={d.stockBought > 0 ? `Includes KES ${money(d.stockBought)} spent on new stock` : undefined}>
            <HBars rows={d.spending.map((s) => ({ label: s.category, value: s.amount }))} empty="No expenses in this period." />
          </Card>
        )}
      </div>
    </div>
  )
}
