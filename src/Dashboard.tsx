import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { useDebtors } from './creditLogic'
import { buildDashboard } from './analytics'
import { useAuth } from './Auth'
import { compact, dateLabel, money, shortDate } from './format'
import { BarChart, Card, COLORS, HBars, Legend, SplitBar, type BarDatum } from './Charts'

const PERIODS = [7, 30, 90]

const change = (now: number, before: number): string | null => {
  if (before <= 0) return null
  const p = Math.round(((now - before) / before) * 100)
  return (p >= 0 ? '+' : '') + p + '% vs the period before'
}

export function Dashboard() {
  const { can } = useAuth()
  const [days, setDays] = useState(7)
  const sales = useLiveQuery(() => db.sales.toArray(), [])
  const payments = useLiveQuery(() => db.payments.toArray(), [])
  const expenses = useLiveQuery(() => db.expenses.toArray(), [])
  const products = useLiveQuery(() => db.products.toArray(), [])
  const debtors = useDebtors()

  const d = useMemo(
    () => (sales && payments && expenses && products && debtors ? buildDashboard(sales, payments, expenses, products, debtors, days) : null),
    [sales, payments, expenses, products, debtors, days]
  )
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
  const profitBars: BarDatum[] = d.daily.map((x, i) => ({
    label: salesBars[i].label,
    full: dateLabel(x.day) + ` · profit KES ${money(x.profit)}`,
    parts: [{ name: 'Profit', value: Math.max(0, x.profit), color: COLORS.profit }]
  }))
  const hours = d.hours.slice(5, 23)
  const hourBars: BarDatum[] = hours.map((h) => ({
    label: h.hour % 3 === 0 ? `${h.hour % 12 || 12}${h.hour < 12 ? 'am' : 'pm'}` : '',
    full: `${h.hour % 12 || 12}${h.hour < 12 ? 'am' : 'pm'} · ${h.count} ${h.count === 1 ? 'sale' : 'sales'}`,
    parts: [{ name: 'Sales', value: h.total, color: COLORS.cash }]
  }))
  const delta = change(d.sales, d.salesPrev)

  return (
    <div className="dash">
      <div className="segment small" role="radiogroup" aria-label="Period">
        {PERIODS.map((p) => (
          <button key={p} role="radio" aria-checked={days === p} className={days === p ? 'on' : ''} onClick={() => setDays(p)}>
            {p} days
          </button>
        ))}
      </div>
      <p className="muted sub-range">{shortDate(d.from)} to {shortDate(d.to - 1)}</p>

      <div className="kpis">
        <div className="kpi">
          <p className="kpi-label">Sales</p>
          <p className="kpi-num">KES {money(d.sales)}</p>
          <p className="kpi-sub">{d.count} {d.count === 1 ? 'sale' : 'sales'}{delta ? ` · ${delta}` : ''}</p>
        </div>
        {can('seeCost') && (
          <div className="kpi">
            <p className="kpi-label">Profit</p>
            <p className="kpi-num good">KES {money(d.profit)}</p>
            <p className="kpi-sub">
              {d.sales === 0 ? 'No sales yet' : d.costedShare < 0.999 ? `Only counts ${Math.round(d.costedShare * 100)}% of sales that have a buying price` : 'Selling minus buying price'}
            </p>
          </div>
        )}
        {can('expenses') && can('seeCost') && (
          <div className="kpi">
            <p className="kpi-label">Left after expenses</p>
            <p className={'kpi-num ' + (d.net < 0 ? 'bad' : '')}>KES {money(d.net)}</p>
            <p className="kpi-sub">Spent KES {money(d.spent)} on running costs</p>
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
          <Card title="Profit each day" sub="Selling price minus buying price">
            <BarChart data={profitBars} label="Profit each day" />
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

        <Card title="Stock" sub={`${d.stock.total} products`}>
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
