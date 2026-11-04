import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiBase, cloudOn } from './cloud'
import { compact, isoDate, money, showPhone, toWaNumber } from './format'
import { downloadFile, toCsv } from './csv'
import { Sheet } from './Sheet'
import { openWhatsApp, waLink } from './summary'
import { Logo } from './Icons'

export interface ShopRow {
  id: string
  shop: string
  owner: string
  products: number
  users: number
  sales30: number
  revenue30: number
  lastSale: number | null
  firstSeen: number
  lastSeen: number
  status: 'trial' | 'active' | 'suspended'
  plan: string
  paidUntil: number | null
  note: string
  message: string
}

const KEY = 'hesabu.adminKey'
const read = () => {
  try {
    return sessionStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}
const DAY = 86400000
const ago = (ts: number | null): string => {
  if (!ts) return 'Never'
  const d = Math.floor((Date.now() - ts) / DAY)
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`
}

type Filter = 'all' | 'active7' | 'quiet' | 'trial' | 'paying' | 'suspended'

/** Your view of every shop that uses Hesabu. Open it at  #/admin  and sign in with your admin key. */
export function Admin() {
  const [key, setKey] = useState(read)
  const [typed, setTyped] = useState('')
  const [shops, setShops] = useState<ShopRow[] | null>(null)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<ShopRow | null>(null)

  const load = useCallback(async (k: string) => {
    setErr('')
    try {
      const r = await fetch(apiBase + '/api/admin/shops', { headers: { authorization: 'Bearer ' + k } })
      if (r.status === 401) {
        setErr('That key is not right.')
        setKey('')
        try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
        return
      }
      if (!r.ok) throw new Error()
      setShops(((await r.json()) as { shops: ShopRow[] }).shops)
    } catch {
      setErr('Could not reach the registry. Check your internet and the API address.')
    }
  }, [])

  useEffect(() => {
    if (key) void load(key)
  }, [key, load])

  const stats = useMemo(() => {
    const s = shops ?? []
    const now = Date.now()
    return {
      total: s.length,
      active7: s.filter((x) => now - x.lastSeen < 7 * DAY).length,
      newWeek: s.filter((x) => now - x.firstSeen < 7 * DAY).length,
      paying: s.filter((x) => x.status === 'active').length,
      revenue: s.reduce((t, x) => t + x.revenue30, 0)
    }
  }, [shops])

  const list = useMemo(() => {
    const now = Date.now()
    const n = q.trim().toLowerCase()
    return (shops ?? [])
      .filter((x) => {
        if (filter === 'active7') return now - x.lastSeen < 7 * DAY
        if (filter === 'quiet') return now - x.lastSeen >= 14 * DAY
        if (filter === 'trial') return x.status === 'trial'
        if (filter === 'paying') return x.status === 'active'
        if (filter === 'suspended') return x.status === 'suspended'
        return true
      })
      .filter((x) => !n || x.shop.toLowerCase().includes(n) || x.owner.includes(n.replace(/\D/g, '') || '§'))
      .sort((a, b) => b.lastSeen - a.lastSeen)
  }, [shops, filter, q])

  if (!cloudOn) {
    return (
      <main className="page admin">
        <h1>Admin</h1>
        <div className="empty">
          <p className="empty-title">The registry is not connected yet</p>
          <p>Deploy the registry (see SETUP.md, part 3) and build the app with its address. Then every shop that opens Hesabu appears here.</p>
          <Link className="btn primary" to="/">Back to the shop</Link>
        </div>
      </main>
    )
  }

  if (!key) {
    return (
      <main className="welcome">
        <Logo size={56} />
        <h1 className="welcome-title">Admin</h1>
        <form onSubmit={(e) => { e.preventDefault(); try { sessionStorage.setItem(KEY, typed) } catch { /* ignore */ } setKey(typed) }}>
          <label className="field">
            <span>Admin key</span>
            <input type="password" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
          </label>
          {err && <p className="hint warn-text" role="alert">{err}</p>}
          <button className="btn primary block" type="submit" disabled={typed.length < 8}>Sign in</button>
        </form>
      </main>
    )
  }

  const filters: [Filter, string][] = [['all', 'All'], ['active7', 'Used this week'], ['quiet', 'Gone quiet'], ['trial', 'On trial'], ['paying', 'Paying'], ['suspended', 'Suspended']]

  return (
    <main className="page admin">
      <div className="admin-head">
        <h1>Hesabu admin</h1>
        <div className="admin-actions">
          <button className="btn outline" onClick={() => void load(key)}>Refresh</button>
          <button
            className="btn outline"
            onClick={() =>
              downloadFile(
                `hesabu-shops-${isoDate(Date.now())}.csv`,
                toCsv([
                  ['Shop', 'Owner phone', 'Status', 'Plan', 'Paid until', 'First seen', 'Last seen', 'Products', 'Staff', 'Sales (30 days)', 'Revenue (30 days)', 'Note'],
                  ...(shops ?? []).map((s) => [s.shop, s.owner ? showPhone(s.owner) : '', s.status, s.plan, s.paidUntil ? isoDate(s.paidUntil) : '', isoDate(s.firstSeen), isoDate(s.lastSeen), s.products, s.users, s.sales30, s.revenue30, s.note])
                ])
              )
            }
          >
            Download list
          </button>
          <button className="btn plain-btn" onClick={() => { try { sessionStorage.removeItem(KEY) } catch { /* ignore */ } setKey(''); setShops(null) }}>Sign out</button>
        </div>
      </div>
      {err && <p className="hint warn-text" role="alert">{err}</p>}
      {!shops && !err && <p className="muted">Loading…</p>}

      {shops && (
        <>
          <div className="kpis">
            <div className="kpi"><p className="kpi-label">Shops</p><p className="kpi-num">{stats.total}</p><p className="kpi-sub">{stats.newWeek} new this week</p></div>
            <div className="kpi"><p className="kpi-label">Used this week</p><p className="kpi-num">{stats.active7}</p><p className="kpi-sub">{stats.total ? Math.round((stats.active7 / stats.total) * 100) : 0}% of all shops</p></div>
            <div className="kpi"><p className="kpi-label">Paying</p><p className="kpi-num">{stats.paying}</p><p className="kpi-sub">{stats.total - stats.paying} on trial or stopped</p></div>
            <div className="kpi"><p className="kpi-label">Sales through Hesabu</p><p className="kpi-num">KES {compact(stats.revenue)}</p><p className="kpi-sub">Last 30 days, all shops</p></div>
          </div>

          <div className="chips tight" role="radiogroup" aria-label="Filter">
            {filters.map(([id, label]) => (
              <button key={id} role="radio" aria-checked={filter === id} className={'chip' + (filter === id ? ' on' : '')} onClick={() => setFilter(id)}>{label}</button>
            ))}
          </div>
          <label className="search">
            <input type="search" placeholder="Search by shop name or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search shops" />
          </label>

          {list.length === 0 ? (
            <p className="muted pad">No shops match.</p>
          ) : (
            <ul className="shop-list">
              {list.map((s) => (
                <li key={s.id}>
                  <button className="shop-row" onClick={() => setOpen(s)}>
                    <span className="shop-main">
                      <span className="row-name">{s.shop}</span>
                      <span className="muted">{s.owner ? showPhone(s.owner) : 'No phone yet'} · seen {ago(s.lastSeen)}</span>
                    </span>
                    <span className="shop-figs">
                      <span className="strong">KES {compact(s.revenue30)}</span>
                      <span className="muted">{s.sales30} sales · {s.products} products</span>
                    </span>
                    <span className={'status ' + s.status}>{s.status === 'active' ? 'Paying' : s.status === 'trial' ? 'Trial' : 'Suspended'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {open && (
        <ShopSheet
          shop={open}
          adminKey={key}
          onClose={() => setOpen(null)}
          onSaved={(r) => {
            setShops((cur) => (cur ?? []).map((x) => (x.id === r.id ? r : x)))
            setOpen(null)
          }}
        />
      )}
    </main>
  )
}

function ShopSheet({ shop, adminKey, onClose, onSaved }: { shop: ShopRow; adminKey: string; onClose: () => void; onSaved: (s: ShopRow) => void }) {
  const [status, setStatus] = useState(shop.status)
  const [plan, setPlan] = useState(shop.plan)
  const [paid, setPaid] = useState(shop.paidUntil ? isoDate(shop.paidUntil) : '')
  const [note, setNote] = useState(shop.note)
  const [message, setMessage] = useState(shop.message)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const wa = toWaNumber(shop.owner)

  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      const paidUntil = paid ? new Date(paid + 'T23:59:59').getTime() : null
      const r = await fetch(apiBase + '/api/admin/shop', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + adminKey, 'content-type': 'application/json' },
        body: JSON.stringify({ id: shop.id, status, plan, paidUntil, note, message })
      })
      if (!r.ok) throw new Error()
      onSaved({ ...shop, status, plan, paidUntil, note, message })
    } catch {
      setErr('Could not save. Try again.')
      setBusy(false)
    }
  }

  return (
    <Sheet title={shop.shop} onClose={onClose}>
      <dl className="facts">
        <div><dt>Owner</dt><dd>{shop.owner ? showPhone(shop.owner) : 'Not given'}</dd></div>
        <div><dt>Started</dt><dd>{isoDate(shop.firstSeen)}</dd></div>
        <div><dt>Last opened</dt><dd>{ago(shop.lastSeen)}</dd></div>
        <div><dt>Last sale</dt><dd>{ago(shop.lastSale)}</dd></div>
        <div><dt>Sales, 30 days</dt><dd>{shop.sales30} (KES {money(shop.revenue30)})</dd></div>
        <div><dt>Products · Staff</dt><dd>{shop.products} · {shop.users}</dd></div>
      </dl>
      <p className="hint">You see totals only. Individual sales, customers and prices stay on the shop’s phone.</p>

      {wa && (
        <button className="btn outline block" onClick={() => openWhatsApp(waLink(wa, `Hello, this is Hesabu. How is ${shop.shop} getting on with the app?`))}>
          Message on WhatsApp
        </button>
      )}

      <fieldset className="field">
        <legend>Subscription</legend>
        <div className="segment" role="radiogroup">
          {(['trial', 'active', 'suspended'] as const).map((s) => (
            <button key={s} role="radio" aria-checked={status === s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
              {s === 'active' ? 'Paying' : s === 'trial' ? 'Trial' : 'Suspended'}
            </button>
          ))}
        </div>
        {status === 'suspended' && <p className="hint spaced">The shop can still look at its records and download its data, but cannot record new sales.</p>}
      </fieldset>
      <div className="two">
        <label className="field"><span>Plan</span><input type="text" value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="e.g. Monthly 500" /></label>
        <label className="field"><span>Paid until</span><input type="date" value={paid} onChange={(e) => setPaid(e.target.value)} /></label>
      </div>
      <label className="field"><span>Message shown to the shop (optional)</span><input type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Pay to till 123456 to renew" /></label>
      <label className="field"><span>Your private note</span><input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {err && <p className="hint warn-text" role="alert">{err}</p>}
      <button className="btn primary block" disabled={busy} onClick={save}>Save</button>
    </Sheet>
  )
}
