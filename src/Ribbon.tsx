import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DownloadIcon, LockIcon, Logo } from './Icons'
import { unsentCount, useAuth } from './Auth'
import { ROLE_LABEL } from './rights'
import { PAY_URL, PRICE, shortDate } from './format'
import { Sheet } from './Sheet'
import { useSyncStatus } from './sync'
import { showInstall, useCanInstall } from './Install'

export type Panel = null | 'menu' | 'settings' | 'data' | 'team' | 'pin' | 'help' | 'notify' | 'size'

const useOnline = (): boolean => {
  const [on, setOn] = useState(navigator.onLine)
  useEffect(() => {
    const u = () => setOn(true)
    const d = () => setOn(false)
    window.addEventListener('online', u)
    window.addEventListener('offline', d)
    return () => {
      window.removeEventListener('online', u)
      window.removeEventListener('offline', d)
    }
  }, [])
  return on
}

function PayButton() {
  return (
    <div className="pay-row">
      <a className="btn amber pay-btn" href={PAY_URL} target="_blank" rel="noopener noreferrer">Pay KES {PRICE}</a>
      <span className="hint block-hint">On the payment page, type the phone number you sign in to Tallyfy with.</span>
    </div>
  )
}

function syncText(online: boolean, s: { state: string; pending: number }): string {
  const n = s.pending
  if (!online || s.state === 'offline') return n > 0 ? `Offline · ${n} waiting to send` : 'Offline, still working'
  if (s.state === 'blocked') return n > 0 ? `${n} not sent. Ask the owner` : 'Not allowed to save'
  if (s.state === 'error') return n > 0 ? `${n} not sent yet` : 'Sync problem'
  if (s.state === 'syncing' || n > 0) return 'Saving…'
  return 'All saved'
}

/** The bar across the top: logo, shop name, and the actions people reach for most. */
export function Ribbon({ shop, open }: { shop: string; open: (p: Panel) => void }) {
  const { me, can, readOnly, shopState } = useAuth()
  const online = useOnline()
  const sync = useSyncStatus()
  const soon = shopState?.until ? Math.ceil((new Date(shopState.until).getTime() - Date.now()) / 86400000) : null
  const soonShown = soon !== null && soon <= 7 ? soon : null
  const data = can('export') || can('importStock')

  return (
    <>
      <header className="ribbon">
        <Link to="/" className="ribbon-brand" aria-label="Tallyfy, go to Sell">
          <Logo size={30} />
        </Link>
        <div className="ribbon-shop">
          <span className="ribbon-name">{shop}</span>
          <span className={'chip-state' + (!online || sync.state === 'offline' || sync.state === 'error' || sync.state === 'blocked' ? ' off' : '')}>{syncText(online, sync)}</span>
        </div>
        <div className="ribbon-actions">
          {data && (
            <button className="icon-btn ribbon-btn" onClick={() => open('data')} aria-label="Data: download and upload">
              <DownloadIcon />
              <span className="ribbon-label">Data</span>
            </button>
          )}
          <button className="icon-btn ribbon-btn" onClick={() => open('help')} aria-label="Help and support">
            <span aria-hidden="true" style={{ fontWeight: 700, fontSize: 18, lineHeight: 1 }}>?</span>
            <span className="ribbon-label">Help</span>
          </button>
          <button className="avatar-btn" onClick={() => open('menu')} aria-label={`Menu, signed in as ${me.name}`}>
            <span className="avatar">{me.name.trim()[0]?.toUpperCase() ?? '?'}</span>
            <span className="avatar-role">{ROLE_LABEL[me.role]}</span>
          </button>
        </div>
      </header>
      {readOnly && (
        <div className="banner" role="status">
          <strong>{shopState?.status === 'trial' ? 'Your free month has ended.' : 'Your subscription has ended.'}</strong>{' '}
          {shopState?.message || 'You can look at your records and download your data. Pay to record new sales.'}
          {me.role === 'owner' && <PayButton />}
        </div>
      )}
      {!readOnly && soonShown !== null && me.role === 'owner' && (
        <div className="banner soft" role="status">
          {shopState?.status === 'trial' ? 'Your free month ends' : 'Your subscription ends'} {soonShown <= 0 ? 'today' : soonShown === 1 ? 'tomorrow' : `in ${soonShown} days`}.
          <PayButton />
        </div>
      )}
    </>
  )
}

export function MenuSheet({ shop, open, onClose }: { shop: string; open: (p: Panel) => void; onClose: () => void }) {
  const { me, can, signOut, shops, switchShop, shopId, shopState } = useAuth()
  const [sure, setSure] = useState<number | null>(null)
  const canInstall = useCanInstall()
  const data = can('export') || can('importStock')
  const item = (label: string, hint: string, go: () => void) => (
    <li key={label}>
      <button className="menu-item" onClick={go}>
        <span>{label}</span>
        <span className="muted">{hint}</span>
      </button>
    </li>
  )
  const out = async () => {
    const n = await unsentCount()
    if ((n > 0 || !navigator.onLine) && sure === null) return setSure(n)
    await signOut()
  }
  return (
    <Sheet title={shop} onClose={onClose}>
      <p className="muted">Signed in as <strong>{me.name}</strong> · {ROLE_LABEL[me.role]}</p>
      <ul className="menu-list">
        {data && item('Data', 'Download spreadsheets, upload stock', () => open('data'))}
        {can('team') && item('Team', 'Staff, roles and PINs', () => open('team'))}
        {can('settings') && item('Shop settings', 'Name and owner’s number', () => open('settings'))}
        {me.role === 'owner' && item('Subscription', subText(shopState), () => window.open(PAY_URL, '_blank', 'noopener'))}
        {item('Change my PIN', 'Choose a new PIN', () => open('pin'))}
        {shops.length > 1 && shops.filter((s) => s.id !== shopId).map((s) => item('Switch to ' + s.name, ROLE_LABEL[s.role], () => switchShop(s.id)))}
        {can('settings') && item('Notifications', 'Sales by your team, support replies', () => open('notify'))}
        {canInstall && item('Install the app', 'Add Tallyfy to your home screen', () => { onClose(); showInstall() })}
        {item('Text size', 'Make the writing bigger or smaller', () => open('size'))}
        {item('Help and support', 'Chat with us, quick answers', () => open('help'))}
      </ul>
      {sure !== null && (
        <p className="hint warn-text" role="alert">
          {!navigator.onLine && 'You are offline. Signing in needs internet, so if you sign out now you cannot get back in until you are online. '}
          {sure > 0 && `${sure} change${sure === 1 ? ' is' : 's are'} still waiting to be sent. They stay safe on this phone until you sign in again.`}
        </p>
      )}
      <button className="btn outline block gap-top" onClick={out}>
        <LockIcon /> {sure !== null ? 'Sign out anyway' : 'Sign out'}
      </button>
    </Sheet>
  )
}

function subText(s: { status: string; until: string | null } | null): string {
  if (!s) return `KES ${PRICE} a month. Tap to pay.`
  const d = s.until ? shortDate(new Date(s.until).getTime()) : ''
  if (s.status === 'trial') return `Free until ${d}. Tap to pay KES ${PRICE}.`
  if (s.status === 'active') return `Paid until ${d}. Tap to add a month.`
  return `Stopped. Tap to pay KES ${PRICE}.`
}
