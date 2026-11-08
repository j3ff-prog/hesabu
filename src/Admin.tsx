import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { ApiError, type AdminShop, type Session } from './cloudApi'
import { tempPin } from './pin'
import { AuthScreen } from './SignIn'
import { compact, isoDate, money, showPhone, toWaNumber } from './format'
import { downloadFile, toCsv } from './csv'
import { Sheet } from './Sheet'
import { openWhatsApp, waLink } from './summary'

type ShopRow = AdminShop

const DAY = 86400000
const t = (iso: string | null): number | null => (iso ? new Date(iso).getTime() : null)
const ago = (iso: string | null): string => {
  const ts = t(iso)
  if (!ts) return 'Never'
  const d = Math.floor((Date.now() - ts) / DAY)
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`
}

type Filter = 'all' | 'active7' | 'quiet' | 'trial' | 'paying' | 'suspended'

/** Your view of every shop that uses Tallyfy. Open it at  #/admin  and sign in with your own phone number and PIN. */
export function Admin() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [shops, setShops] = useState<ShopRow[] | null>(null)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<ShopRow | null>(null)

  useEffect(() => {
    api.getSession().then(setSession, () => setSession(null))
  }, [])

  const load = useCallback(async () => {
    setErr('')
    try {
      setShops(await api.adminShops())
    } catch (e) {
      setErr(e instanceof ApiError && e.code === 'network' ? 'No internet.' : 'This account is not a Tallyfy admin. Ask for your number to be added in Supabase.')
    }
  }, [])

  useEffect(() => {
    if (session) void load()
  }, [session, load])

  const stats = useMemo(() => {
    const s = shops ?? []
    const now = Date.now()
    return {
      total: s.length,
      active7: s.filter((x) => now - (t(x.last_sale) ?? 0) < 7 * DAY).length,
      newWeek: s.filter((x) => now - (t(x.created_at) ?? 0) < 7 * DAY).length,
      paying: s.filter((x) => x.status === 'active').length,
      revenue: s.reduce((sum, x) => sum + Number(x.revenue30), 0)
    }
  }, [shops])

  const list = useMemo(() => {
    const now = Date.now()
    const n = q.trim().toLowerCase()
    return (shops ?? [])
      .filter((x) => {
        const last = t(x.last_sale) ?? 0
        if (filter === 'active7') return now - last < 7 * DAY
        if (filter === 'quiet') return now - last >= 14 * DAY
        if (filter === 'trial') return x.status === 'trial'
        if (filter === 'paying') return x.status === 'active'
        if (filter === 'suspended') return x.status === 'suspended'
        return true
      })
      .filter((x) => !n || x.name.toLowerCase().includes(n) || x.owner_phone.includes(n.replace(/\D/g, '') || '§'))
      .sort((a, b) => (t(b.last_sale) ?? t(b.created_at) ?? 0) - (t(a.last_sale) ?? t(a.created_at) ?? 0))
  }, [shops, filter, q])

  if (session === undefined) return <main className="welcome" aria-busy="true" />
  if (!session) return <AuthScreen onDone={(s) => setSession(s)} />

  const filters: [Filter, string][] = [['all', 'All'], ['active7', 'Used this week'], ['quiet', 'Gone quiet'], ['trial', 'On trial'], ['paying', 'Paying'], ['suspended', 'Suspended']]

  return (
    <main className="page admin">
      <div className="admin-head">
        <h1>Tallyfy admin</h1>
        <div className="admin-actions">
          <button className="btn outline" onClick={() => void load()}>Refresh</button>
          <button
            className="btn outline"
            onClick={() =>
              downloadFile(
                `tallyfy-shops-${isoDate(Date.now())}.csv`,
                toCsv([
                  ['Shop', 'Owner phone', 'Status', 'Plan', 'Trial ends', 'Paid until', 'Started', 'Last sale', 'Products', 'Staff', 'Sales (30 days)', 'Revenue (30 days)', 'Note'],
                  ...(shops ?? []).map((s) => [s.name, s.owner_phone ? showPhone(s.owner_phone) : '', s.status, s.plan, isoDate(t(s.trial_ends_at) ?? 0), s.paid_until ? isoDate(t(s.paid_until) ?? 0) : '', isoDate(t(s.created_at) ?? 0), s.last_sale ? isoDate(t(s.last_sale) ?? 0) : '', s.products, s.staff, s.sales30, s.revenue30, s.admin_note])
                ])
              )
            }
          >
            Download list
          </button>
          <button className="btn plain-btn" onClick={async () => { await api.signOut(); window.location.hash = '#/'; window.location.reload() }}>Sign out</button>
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
            <div className="kpi"><p className="kpi-label">Sales through Tallyfy</p><p className="kpi-num">KES {compact(stats.revenue)}</p><p className="kpi-sub">Last 30 days, all shops</p></div>
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
                      <span className="row-name">{s.name}</span>
                      <span className="muted">{s.owner_phone ? showPhone(s.owner_phone) : 'No phone yet'} · last sale {ago(s.last_sale)}</span>
                    </span>
                    <span className="shop-figs">
                      <span className="strong">KES {compact(Number(s.revenue30))}</span>
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

function ShopSheet({ shop, onClose, onSaved }: { shop: ShopRow; onClose: () => void; onSaved: (s: ShopRow) => void }) {
  const [status, setStatus] = useState(shop.status)
  const [plan, setPlan] = useState(shop.plan)
  const [paid, setPaid] = useState(shop.paid_until ? isoDate(t(shop.paid_until) ?? 0) : '')
  const [note, setNote] = useState(shop.admin_note)
  const [message, setMessage] = useState(shop.message)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [newPin, setNewPin] = useState<{ pin: string; phone: string } | null>(null)
  const wa = toWaNumber(shop.owner_phone)

  const resetOwner = async () => {
    setBusy(true)
    setErr('')
    try {
      const pin = tempPin()
      const r = await api.adminResetOwner(shop.id, pin)
      setNewPin({ pin, phone: r.phone })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not reset')
    }
    setBusy(false)
  }

  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      const paidUntil = paid ? new Date(paid + 'T23:59:59').toISOString() : null
      await api.adminSetShop(shop.id, status, plan, paidUntil, note, message)
      onSaved({ ...shop, status, plan, paid_until: paidUntil, admin_note: note, message })
    } catch {
      setErr('Could not save. Try again.')
      setBusy(false)
    }
  }

  return (
    <Sheet title={shop.name} onClose={onClose}>
      <dl className="facts">
        <div><dt>Owner</dt><dd>{shop.owner_phone ? showPhone(shop.owner_phone) : 'Not given'}</dd></div>
        <div><dt>Started</dt><dd>{isoDate(t(shop.created_at) ?? 0)}</dd></div>
        <div><dt>Trial ends</dt><dd>{isoDate(t(shop.trial_ends_at) ?? 0)}</dd></div>
        <div><dt>Last sale</dt><dd>{ago(shop.last_sale)}</dd></div>
        <div><dt>Sales, 30 days</dt><dd>{shop.sales30} (KES {money(Number(shop.revenue30))})</dd></div>
        <div><dt>Products · Staff</dt><dd>{shop.products} · {shop.staff}</dd></div>
      </dl>

      {wa && (
        <button className="btn outline block" onClick={() => openWhatsApp(waLink(wa, `Hello, this is Tallyfy. How is ${shop.name} getting on with the app?`))}>
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
        <p className="hint spaced">
          {status === 'suspended' ? 'The shop can still look at its records and download its data, but cannot record new sales.' : status === 'active' ? 'Paying shops can record until the "paid until" date.' : 'Trial shops can record until their trial ends.'}
        </p>
      </fieldset>
      <div className="two">
        <label className="field"><span>Plan</span><input type="text" value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="e.g. Monthly 500" /></label>
        <label className="field"><span>Paid until</span><input type="date" value={paid} onChange={(e) => setPaid(e.target.value)} /></label>
      </div>
      <label className="field"><span>Message shown to the shop (optional)</span><input type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Pay to till 123456 to renew" /></label>
      <label className="field"><span>Your private note</span><input type="text" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {err && <p className="hint warn-text" role="alert">{err}</p>}
      <button className="btn primary block" disabled={busy} onClick={save}>Save</button>

      <h3 className="muted-head">Owner forgot their PIN</h3>
      {newPin ? (
        <>
          <p>New PIN for <strong>{showPhone(newPin.phone)}</strong>:</p>
          <p className="temp-pin">{newPin.pin}</p>
          {toWaNumber(newPin.phone) && (
            <button className="btn amber block" onClick={() => openWhatsApp(waLink(toWaNumber(newPin.phone) ?? '', `Hello, your Tallyfy PIN has been reset. Sign in with your phone number and this PIN: ${newPin.pin}. Please change it from the menu after signing in.`))}>Send on WhatsApp</button>
          )}
        </>
      ) : (
        <>
          <p className="hint">First make sure it really is the owner (call them or check the WhatsApp number). Then set a new PIN.</p>
          <button className="btn outline block" disabled={busy} onClick={resetOwner}>Set a new PIN for the owner</button>
        </>
      )}
    </Sheet>
  )
}
