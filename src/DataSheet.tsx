import { useRef, useState } from 'react'
import { db, importProducts, productKey, type ProductRow } from './db'
import { buildDebtors } from './creditLogic'
import { downloadFile, parseCsv, readProducts, TEMPLATE, toCsv, type ImportPreview } from './csv'
import { addDays, daysSince, isoDate, isoTime, showPhone, startOfDay } from './format'
import { payLabel, partsOf } from './pay'
import { useAuth } from './Auth'
import { Sheet } from './Sheet'

const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: '7', label: 'Last 7 days' },
  { id: '30', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Pick dates' }
] as const
type PeriodId = (typeof PERIODS)[number]['id']

function fromOf(p: PeriodId): number {
  const t = startOfDay()
  if (p === 'today') return t
  if (p === '7') return addDays(t, -6)
  if (p === '30') return addDays(t, -29)
  if (p === 'month') {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  }
  return 0
}

const stamp = () => isoDate(Date.now())

/** Download sales, stock, credit and expenses as spreadsheets, and add many products at once from a CSV file. */
export function DataSheet({ onClose }: { onClose: () => void }) {
  const { can, shopName: shop } = useAuth()
  const [fromD, setFromD] = useState(() => isoDate(addDays(startOfDay(), -29)))
  const [toD, setToD] = useState(() => isoDate(startOfDay()))
  const [period, setPeriod] = useState<PeriodId>('30')
  const [msg, setMsg] = useState('')
  const slug = shop.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'shop'
  const cost = can('seeCost')

  const range = (): [number, number] => {
    if (period === 'custom') {
      const a = new Date(fromD + 'T00:00:00').getTime()
      const b = new Date(toD + 'T00:00:00').getTime()
      return [Math.min(a, b), addDays(Math.max(a, b), 1)]
    }
    return [fromOf(period), addDays(startOfDay(), 1)]
  }

  const done = (what: string, n: number) => setMsg(n === 0 ? `Nothing to download for ${what} yet.` : `Downloaded ${n} ${n === 1 ? 'row' : 'rows'} of ${what}.`)

  const sales = async () => {
    const [from, to] = range()
    const list = (await db.sales.where('createdAt').between(from, to, true, false).toArray()).sort((a, b) => a.createdAt - b.createdAt)
    const head = ['Date', 'Time', 'Sale no.', 'Product', 'Quantity', 'Price each', 'Line total', ...(cost ? ['Buying price each', 'Profit'] : []), 'Payment', 'Cash part', 'M-Pesa part', 'Credit part', 'Due date', 'Buyer', 'Sold by', 'Status']
    const rows: (string | number)[][] = [head]
    for (const s of list)
      for (const l of s.lines)
        rows.push([
          isoDate(s.createdAt), isoTime(s.createdAt), s.id, l.name, l.qty, l.price, l.price * l.qty,
          ...(cost ? [l.cost > 0 ? l.cost : '', l.cost > 0 ? (l.price - l.cost) * l.qty : ''] : []),
          payLabel(s), partsOf(s).cash, partsOf(s).mpesa, partsOf(s).credit, s.dueAt ? isoDate(s.dueAt) : '', s.customer ?? '', s.byName ?? '', s.voidedAt ? 'Cancelled' : 'Active'
        ])
    if (rows.length > 1) downloadFile(`${slug}-sales-${stamp()}.csv`, toCsv(rows))
    done('sales', rows.length - 1)
  }

  const stock = async () => {
    const list = await db.products.orderBy('name').toArray()
    const rows: (string | number)[][] = [['Name', 'Type', 'Selling price', ...(cost ? ['Buying price'] : []), 'In stock', 'Warn at', ...(cost ? ['Stock value at buying price'] : []), 'Status']]
    for (const p of list) {
      const sv = p.kind === 'service'
      rows.push([p.name, sv ? 'Service' : 'Goods', p.price, ...(cost ? [sv ? '' : p.cost || ''] : []), sv ? '' : p.stock, sv ? '' : p.lowAt, ...(cost ? [sv ? '' : Math.max(0, p.stock) * p.cost] : []), sv ? 'Not counted' : p.stock <= 0 ? 'Out of stock' : p.stock <= p.lowAt ? 'Running low' : 'Fine'])
    }
    if (rows.length > 1) downloadFile(`${slug}-stock-${stamp()}.csv`, toCsv(rows))
    done('stock', rows.length - 1)
  }

  const credit = async () => {
    const [s, p, c] = await Promise.all([db.sales.toArray(), db.payments.toArray(), db.customers.toArray()])
    const list = buildDebtors(s, p, c)
    const rows: (string | number)[][] = [['Customer', 'Phone', 'Owes (KES)', 'Unpaid since', 'Days', 'Due date']]
    for (const d of list) rows.push([d.name, d.phone ? showPhone(d.phone) : '', d.balance, isoDate(d.since), daysSince(d.since), d.due ? isoDate(d.due) : ''])
    if (rows.length > 1) downloadFile(`${slug}-credit-owed-${stamp()}.csv`, toCsv(rows))
    done('people who owe you', rows.length - 1)
  }

  const payments = async () => {
    const [from, to] = range()
    const list = (await db.payments.where('createdAt').between(from, to, true, false).toArray()).sort((a, b) => a.createdAt - b.createdAt)
    const rows: (string | number)[][] = [['Date', 'Time', 'Customer', 'Amount', 'Paid with', 'Recorded by']]
    for (const p of list) rows.push([isoDate(p.createdAt), isoTime(p.createdAt), p.customer, p.amount, p.method === 'cash' ? 'Cash' : 'M-Pesa', p.byName ?? ''])
    if (rows.length > 1) downloadFile(`${slug}-credit-payments-${stamp()}.csv`, toCsv(rows))
    done('credit payments', rows.length - 1)
  }

  const expenses = async () => {
    const [from, to] = range()
    const list = (await db.expenses.where('createdAt').between(from, to, true, false).toArray()).sort((a, b) => a.createdAt - b.createdAt)
    const rows: (string | number)[][] = [['Date', 'Time', 'Category', 'Note', 'Amount', 'Paid with', 'Products added to stock', 'Recorded by']]
    for (const e of list)
      rows.push([isoDate(e.createdAt), isoTime(e.createdAt), e.category, e.note, e.amount, e.method === 'cash' ? 'Cash' : 'M-Pesa', (e.items ?? []).map((i) => `${i.qty} x ${i.name}`).join('; '), e.byName ?? ''])
    if (rows.length > 1) downloadFile(`${slug}-expenses-${stamp()}.csv`, toCsv(rows))
    done('expenses', rows.length - 1)
  }

  return (
    <Sheet title="Data" onClose={onClose}>
      {can('export') && (
        <>
          <h3 className="muted-head first">Download as a spreadsheet</h3>
          <p className="hint spaced">Files open in Excel, Google Sheets and any spreadsheet app.</p>
          <div className="chips tight" role="radiogroup" aria-label="Period for sales, payments and expenses">
            {PERIODS.map((p) => (
              <button key={p.id} role="radio" aria-checked={period === p.id} className={'chip' + (period === p.id ? ' on' : '')} onClick={() => setPeriod(p.id)}>{p.label}</button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="two">
              <label className="field"><span>From</span><input type="date" value={fromD} max={toD} onChange={(e) => setFromD(e.target.value)} /></label>
              <label className="field"><span>To</span><input type="date" value={toD} min={fromD} max={isoDate(startOfDay())} onChange={(e) => setToD(e.target.value)} /></label>
            </div>
          )}
          <div className="dl-list">
            <button className="btn outline block" onClick={sales}>Sales</button>
            <button className="btn outline block" onClick={stock}>Items and stock</button>
            <button className="btn outline block" onClick={credit}>Who owes you</button>
            <button className="btn outline block" onClick={payments}>Credit payments</button>
            {can('expenses') && <button className="btn outline block" onClick={expenses}>Expenses</button>}
          </div>
          {msg && <p className="hint ok-text" role="status">{msg}</p>}
        </>
      )}
      {can('importStock') && <Upload onDone={setMsg} />}
      {!can('export') && !can('importStock') && <p className="muted">You don’t have access to this.</p>}
    </Sheet>
  )
}

function Upload({ onDone }: { onDone: (m: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [fileName, setFileName] = useState('')
  const [update, setUpdate] = useState(true)
  const [existing, setExisting] = useState<Set<string>>(new Set())
  const [result, setResult] = useState('')
  const [err, setErr] = useState('')

  const pick = async (f: File | undefined) => {
    setResult('')
    setErr('')
    setPreview(null)
    if (!f) return
    if (/\.xlsx?$/i.test(f.name)) {
      setErr('Excel files can’t be read directly. In Excel choose File > Save As > CSV, then upload that file.')
      return
    }
    try {
      const p = readProducts(parseCsv(await f.text()))
      if (p.missingColumns.length) {
        setErr(`The file needs a column called ${p.missingColumns.join(' and ')}. Download the template to see the layout.`)
        return
      }
      setExisting(new Set((await db.products.toArray()).map((x) => productKey(x.name))))
      setFileName(f.name)
      setPreview(p)
    } catch {
      setErr('That file could not be read.')
    }
  }

  const reset = () => {
    setPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const isNew = (r: ProductRow) => !existing.has(productKey(r.name))
  const newCount = preview ? preview.rows.filter(isNew).length : 0
  const oldCount = preview ? preview.rows.length - newCount : 0

  return (
    <>
      <h3 className="muted-head">Add many items at once</h3>
      <p className="hint spaced">Fill in a spreadsheet, save it as CSV, and upload it. Only Name and Selling price are needed. Put Service in the Type column for food and services.</p>
      <button className="btn outline block" onClick={() => downloadFile('tallify-stock-template.csv', TEMPLATE)}>Download the template</button>
      <input ref={fileRef} type="file" accept=".csv,text/csv,.txt,.xlsx,.xls" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      {!preview && (
        <button className="btn outline block gap-top" onClick={() => fileRef.current?.click()}>Choose a CSV file</button>
      )}
      {err && <p className="hint warn-text" role="alert">{err}</p>}
      {result && <p className="hint ok-text" role="status">{result}</p>}

      {preview && (
        <div className="restore-box">
          <p><strong>{fileName}</strong></p>
          <ul className="plain tight">
            <li><span>New products</span><span className="strong">{newCount}</span></li>
            <li><span>Already in your list</span><span className="strong">{oldCount}</span></li>
            {preview.errors.length > 0 && <li><span>Rows with a problem (skipped)</span><span className="strong red">{preview.errors.length}</span></li>}
            {preview.duplicates > 0 && <li><span>Repeated names (last one used)</span><span className="strong">{preview.duplicates}</span></li>}
          </ul>
          {preview.errors.length > 0 && (
            <ul className="problems">
              {preview.errors.slice(0, 5).map((e) => <li key={e.line}>Row {e.line}: {e.text}</li>)}
              {preview.errors.length > 5 && <li>and {preview.errors.length - 5} more</li>}
            </ul>
          )}
          {oldCount > 0 && (
            <div className="segment small" role="radiogroup" aria-label="Products already in your list">
              <button role="radio" aria-checked={update} className={update ? 'on' : ''} onClick={() => setUpdate(true)}>Update them</button>
              <button role="radio" aria-checked={!update} className={!update ? 'on' : ''} onClick={() => setUpdate(false)}>Leave them</button>
            </div>
          )}
          {oldCount > 0 && update && <p className="hint">Prices, and stock or buying price if the file has them, are replaced with the file’s values.</p>}
          <button
            className="btn primary block gap-top"
            disabled={newCount + (update ? oldCount : 0) === 0}
            onClick={async () => {
              const r = await importProducts(preview.rows, update)
              setResult(`Done: ${r.added} added, ${r.updated} updated${r.skipped ? `, ${r.skipped} left as they were` : ''}.`)
              onDone('')
              reset()
            }}
          >
            Add {newCount + (update ? oldCount : 0)} {newCount + (update ? oldCount : 0) === 1 ? 'product' : 'products'}
          </button>
          <button className="btn plain-btn block" onClick={reset}>Cancel</button>
        </div>
      )}
    </>
  )
}
