import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, voidSale, type Sale } from './db'
import { useDebtors } from './creditLogic'
import { dateLabel, money, startOfDay, timeOf } from './format'
import { useAuth } from './Auth'
import { useUi } from './Ui'
import { getOwnerPhone } from './shop'
import { payLabel } from './pay'
import { Sheet } from './Sheet'
import { Tally } from './Tally'
import { CloseDaySheet } from './DayTools'
import { dayFigures, diffText, openWhatsApp, summaryText, waLink } from './summary'

type Panel = null | 'close'

export function Today({ shop }: { shop: string }) {
  const { me, can } = useAuth()
  const ui = useUi()
  const full = can('today') // owners and managers see the whole day; attendants see only their own sales
  const day = startOfDay()
  const sales = useLiveQuery(() => db.sales.toArray(), [])
  const payments = useLiveQuery(() => db.payments.toArray(), [])
  const expenses = useLiveQuery(() => db.expenses.toArray(), [])
  const expensePays = useLiveQuery(() => db.expensePayments.toArray(), [])
  const closing = useLiveQuery(async () => (await db.closings.get(day)) ?? null, [day])
  const products = useLiveQuery(() => db.products.toArray(), [])
  const debtors = useDebtors()
  const [open, setOpen] = useState<Sale | null>(null)
  const [panel, setPanel] = useState<Panel>(null)

  if (!sales || !payments || !expenses || !expensePays || closing === undefined || !products || !debtors) return <main className="page" />

  const mine = full ? sales : sales.filter((s) => s.by === me.id)
  const f = dayFigures(day, mine, full ? payments : [], full ? expenses : [], full ? expensePays : [])
  const cancelled = mine.filter((s) => s.voidedAt && s.createdAt >= day).sort((a, b) => b.createdAt - a.createdAt)
  const recordedToday = expenses.filter((e) => e.createdAt >= day).length
  const owedToYou = debtors.reduce((t, d) => t + d.balance, 0)
  const low = products.filter((p) => p.kind !== 'service' && p.stock <= p.lowAt).sort((a, b) => a.stock - b.stock)

  const best = new Map<string, { name: string; qty: number }>()
  for (const s of f.live)
    for (const l of s.lines) {
      const cur = best.get(l.name) ?? { name: l.name, qty: 0 }
      cur.qty += l.qty
      best.set(l.name, cur)
    }
  const top = [...best.values()].sort((a, b) => b.qty - a.qty).slice(0, 5)

  const sendSummary = () => {
    const wa = getOwnerPhone()
    if (!wa) {
      ui.openSettings(true)
      return
    }
    openWhatsApp(waLink(wa, summaryText(shop, day, f, closing, low)))
  }

  return (
    <main className="page">
      <p className="muted sub-day">{shop} · {dateLabel()}{full ? '' : ` · Your sales, ${me.name}`}</p>

      <div className="today-cols">
      <div className="today-side">
      {full && can('expenses') ? (
        <>
          {can('seeCost') ? (
            <section className="hero" aria-label="Profit today">
              <p className="hero-label">{f.profit < 0 ? 'Loss today' : 'Profit today'}</p>
              <p className={'hero-num' + (f.profit < 0 ? ' neg' : '')}><span>KES</span> {money(Math.abs(f.profit))}</p>
              <div className="hero-pl">
                <span>Money on hand today</span>
                <strong className={f.onHand.total < 0 ? 'neg-text' : ''}>KES {money(f.onHand.total)}</strong>
              </div>
              <dl className="hero-split two">
                <div><dt>In cash</dt><dd>{money(f.onHand.cash)}</dd></div>
                <div><dt>On M-Pesa</dt><dd>{money(f.onHand.mpesa)}</dd></div>
              </dl>
              <p className="hero-note">
                Profit is what you earned from sales that were paid for, minus your costs.
                {f.costs > 0 ? ` It includes KES ${money(f.costs)} of costs for today, like your share of rent.` : ''}
                {f.stockPaid > 0 ? ` You paid KES ${money(f.stockPaid)} for new stock. That lowers your money on hand, but it only counts against profit once you sell it.` : ''}
                {f.unknown > 0 ? ' Goods with no buying price are left out of profit.' : ''}
              </p>
            </section>
          ) : (
            <section className="hero" aria-label="Money on hand today">
              <p className="hero-label">Money on hand today</p>
              <p className={'hero-num' + (f.onHand.total < 0 ? ' neg' : '')}><span>KES</span> {money(f.onHand.total)}</p>
              <dl className="hero-split two">
                <div><dt>In cash</dt><dd>{money(f.onHand.cash)}</dd></div>
                <div><dt>On M-Pesa</dt><dd>{money(f.onHand.mpesa)}</dd></div>
              </dl>
              <p className="hero-note">Money received today minus money you paid out. Customers who have not paid yet are not counted.</p>
            </section>
          )}

          <section className="card-soft" aria-label="Sales today">
            <div className="card-row">
              <div>
                <p className="hero-label dark">Sales today</p>
                <p className="card-num">KES {money(f.total)}</p>
              </div>
              <p className="card-count">{f.live.length} {f.live.length === 1 ? 'sale' : 'sales'}</p>
            </div>
            {f.live.length > 0 ? <Tally count={f.live.length} /> : <p className="muted">No sales yet today.</p>}
            <dl className="pay-split">
              <div style={{ ['--c' as string]: '#0e5a52' }}><dt>Paid in cash</dt><dd>KES {money(f.cash)}</dd></div>
              <div style={{ ['--c' as string]: '#f2a33a' }}><dt>Paid by M-Pesa</dt><dd>KES {money(f.mpesa)}</dd></div>
              <div style={{ ['--c' as string]: '#6b7f99' }}><dt>Not paid yet (credit)</dt><dd>KES {money(f.credit)}</dd></div>
            </dl>
            {f.collected > 0 && <p className="hint spaced">Credit customers paid back KES {money(f.collected)} today.</p>}
          </section>

          {(owedToYou > 0 || f.payables > 0) && (
            <section className="owe-pair" aria-label="Who owes what">
              {owedToYou > 0 && can('credit') && (
                <Link to="/credit" className="owe-card">
                  <span className="owe-label">Customers owe you</span>
                  <strong>KES {money(owedToYou)}</strong>
                </Link>
              )}
              {f.payables > 0 && (
                <Link to="/expenses" className="owe-card bill">
                  <span className="owe-label">You owe suppliers</span>
                  <strong>KES {money(f.payables)}</strong>
                  <span className="muted">{f.bills} {f.bills === 1 ? 'bill' : 'bills'} to pay</span>
                </Link>
              )}
            </section>
          )}
        </>
      ) : (
        <section className="hero" aria-label="Sales today">
          <p className="hero-label">Sales today</p>
          <p className="hero-num"><span>KES</span> {money(f.total)}</p>
          {f.live.length > 0 ? <Tally count={f.live.length} /> : <p className="hero-empty">No sales yet today.</p>}
          <p className="hero-count">{f.live.length} {f.live.length === 1 ? 'sale' : 'sales'}</p>
          <dl className="hero-split">
            <div><dt>Cash</dt><dd>{money(f.cash)}</dd></div>
            <div><dt>M-Pesa</dt><dd>{money(f.mpesa)}</dd></div>
            <div><dt>On credit</dt><dd>{money(f.credit)}</dd></div>
          </dl>
        </section>
      )}

      {full && (
      <section className="close-card" aria-label="End of day">
        {closing ? (
          <>
            <p className={'close-status ' + (closing.diff === 0 ? 'ok' : 'bad')}>
              Day closed · {diffText(closing.diff)}
            </p>
            <p className="muted">Counted KES {money(closing.counted)}, should be KES {money(closing.expected)}.</p>
            <div className="close-actions">
              <button className="btn primary" onClick={sendSummary}>Send summary to owner</button>
              <button className="btn plain-btn" onClick={() => setPanel('close')}>Count again</button>
            </div>
          </>
        ) : (
          <>
            <p className="close-title">End of the day?</p>
            <p className="muted">Count your cash and see if it matches your sales.</p>
            <div className="close-actions">
              <button className="btn primary" onClick={() => setPanel('close')}>Close the day</button>
              <button className="btn plain-btn" onClick={sendSummary}>Send summary</button>
            </div>
          </>
        )}
      </section>
      )}

      </div>
      <div className="today-main">
      {full && low.length > 0 && (
        <section className="block-section">
          <div className="section-head">
            <h2>Running low</h2>
            <Link to="/stock" state={{ filter: 'low' }} className="link">See all {low.length}</Link>
          </div>
          <ul className="plain">
            {low.slice(0, 4).map((p) => (
              <li key={p.id}>
                <span>{p.name}</span>
                <span className="strong red">{p.stock <= 0 ? 'Out of stock' : `${p.stock} left`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {top.length > 0 && (
        <section className="block-section">
          <h2>Best sellers</h2>
          <ul className="plain">
            {top.map((t) => (
              <li key={t.name}>
                <span>{t.name}</span>
                <span className="strong">{t.qty} sold</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {full && (f.spent > 0 || recordedToday > 0) && (
        <section className="block-section">
          <div className="section-head">
            <h2>Expenses today</h2>
            <Link to="/expenses" className="link">See expenses</Link>
          </div>
          <p className="muted">
            {f.spent > 0 ? `KES ${money(f.spent)} paid out` : 'Nothing paid out yet'}
            {recordedToday > 0 ? `, ${recordedToday} ${recordedToday === 1 ? 'expense' : 'expenses'} recorded` : ''}.
          </p>
        </section>
      )}

      <section className="block-section">
        <h2>Sales</h2>
        {f.live.length === 0 && <p className="muted">Sales you record will show here.</p>}
        <ul className="plain">
          {f.live.map((s) => (
            <li key={s.id}>
              <button className="sale-row" onClick={() => setOpen(s)}>
                <span className="sale-main">
                  <span className="sale-title">
                    <strong>{s.customer || 'Customer'}</strong>
                    <span className="sale-what">{summary(s)}</span>
                  </span>
                  <span className="muted">{timeOf(s.createdAt)} · {payLabel(s)}{full && s.byName ? ` · Sold by ${s.byName}` : ''}</span>
                </span>
                <span className="strong">{money(s.total)}</span>
              </button>
            </li>
          ))}
        </ul>
        {cancelled.length > 0 && (
          <>
            <h3 className="muted-head">Cancelled</h3>
            <ul className="plain struck">
              {cancelled.map((s) => (
                <li key={s.id}>
                  <button className="sale-row" onClick={() => setOpen(s)}>
                    <span className="sale-main">
                      <span className="sale-title">
                        <strong>{s.customer || 'Customer'}</strong>
                        <span className="sale-what">{summary(s)}</span>
                      </span>
                      <span className="muted">{timeOf(s.createdAt)}</span>
                    </span>
                    <span>{money(s.total)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      </div>
      </div>

      {open && <SaleSheet sale={open} canVoid={can('voidSale')} onClose={() => setOpen(null)} />}
      {panel === 'close' && (
        <CloseDaySheet shop={shop} day={day} figures={f} low={low} existing={closing} onClose={() => setPanel(null)} />
      )}
    </main>
  )
}

const summary = (s: Sale) => {
  const first = s.lines[0]
  const more = s.lines.length - 1
  return `${first.qty} × ${first.name}${more > 0 ? ` + ${more} more` : ''}`
}

function SaleSheet({ sale, onClose, canVoid }: { sale: Sale; onClose: () => void; canVoid: boolean }) {
  const [sure, setSure] = useState(false)
  return (
    <Sheet title={sale.voidedAt ? 'Cancelled sale' : 'Sale'} onClose={onClose}>
      {sale.customer && <p className="sale-who">{sale.customer}</p>}
      <p className="muted">
        {timeOf(sale.createdAt)} · {payLabel(sale)}
        {sale.byName ? ` · Sold by ${sale.byName}` : ''}
      </p>
      <ul className="lines static">
        {sale.lines.map((l, i) => (
          <li key={i}>
            <div className="line-name">
              <span>{l.qty} × {l.name}</span>
              <span className="muted">KES {money(l.price)} each</span>
            </div>
            <span className="line-total">{money(l.price * l.qty)}</span>
          </li>
        ))}
      </ul>
      <div className="total-row">
        <span>Total</span>
        <span className="total-num">KES {money(sale.total)}</span>
      </div>
      {!sale.voidedAt && canVoid && !sure && (
        <button className="btn text-danger block" onClick={() => setSure(true)}>Cancel this sale</button>
      )}
      {!sale.voidedAt && canVoid && sure && (
        <div className="confirm-box" role="alertdialog" aria-label="Cancel this sale?">
          <p className="confirm-q">Cancel this sale?</p>
          <button
            className="btn danger block"
            onClick={async () => {
              await voidSale(sale.id)
              onClose()
            }}
          >
            Yes, cancel it
          </button>
          <button className="btn outline block gap-top" onClick={() => setSure(false)}>No, keep it</button>
        </div>
      )}
      {!sale.voidedAt && canVoid && <p className="hint center">Cancelling puts the items back in stock.</p>}
    </Sheet>
  )
}
