import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DownloadIcon, LockIcon, Logo, PlusIcon } from './Icons'
import { unsentCount, useAuth } from './Auth'
import { ROLE_LABEL } from './rights'
import { Sheet } from './Sheet'
import { useSyncStatus } from './sync'

export type Panel = null | 'menu' | 'settings' | 'data' | 'team' | 'pin'

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
  const data = can('export') || can('importStock')

  return (
    <>
      <header className="ribbon">
        <Link to="/" className="ribbon-brand" aria-label="Hesabu, go to Sell">
          <Logo size={30} />
        </Link>
        <div className="ribbon-shop">
          <span className="ribbon-name">{shop}</span>
          <span className={'chip-state' + (!online || sync.state === 'offline' || sync.state === 'error' || sync.state === 'blocked' ? ' off' : '')}>{syncText(online, sync)}</span>
        </div>
        <div className="ribbon-actions">
          {can('sell') && (
            <Link to="/" className="btn amber ribbon-sell">
              <PlusIcon /> New sale
            </Link>
          )}
          {data && (
            <button className="icon-btn ribbon-btn" onClick={() => open('data')} aria-label="Data: download and upload">
              <DownloadIcon />
              <span className="ribbon-label">Data</span>
            </button>
          )}
          <button className="avatar-btn" onClick={() => open('menu')} aria-label={`Menu, signed in as ${me.name}`}>
            <span className="avatar">{me.name.trim()[0]?.toUpperCase() ?? '?'}</span>
            <span className="avatar-role">{ROLE_LABEL[me.role]}</span>
          </button>
        </div>
      </header>
      {readOnly && (
        <div className="banner" role="status">
          <strong>Your subscription has ended.</strong> {shopState?.message || 'You can look at your records and download your data. Renew to record new sales.'}
        </div>
      )}
    </>
  )
}

export function MenuSheet({ shop, open, onClose }: { shop: string; open: (p: Panel) => void; onClose: () => void }) {
  const { me, can, signOut, shops, switchShop, shopId } = useAuth()
  const [sure, setSure] = useState<number | null>(null)
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
    if (n > 0 && sure === null) return setSure(n)
    await signOut()
  }
  return (
    <Sheet title={shop} onClose={onClose}>
      <p className="muted">Signed in as <strong>{me.name}</strong> · {ROLE_LABEL[me.role]}</p>
      <ul className="menu-list">
        {data && item('Data', 'Download spreadsheets, upload stock', () => open('data'))}
        {can('team') && item('Team', 'Staff, roles and PINs', () => open('team'))}
        {can('settings') && item('Shop settings', 'Name and owner’s number', () => open('settings'))}
        {item('Change my PIN', 'Choose a new PIN', () => open('pin'))}
        {shops.length > 1 && shops.filter((s) => s.id !== shopId).map((s) => item('Switch to ' + s.name, ROLE_LABEL[s.role], () => switchShop(s.id)))}
      </ul>
      {sure !== null && (
        <p className="hint warn-text" role="alert">
          {sure} change{sure === 1 ? ' is' : 's are'} still waiting to be sent. If you sign out now, connect to the internet first, or they stay on this phone until you sign in again.
        </p>
      )}
      <button className="btn outline block gap-top" onClick={out}>
        <LockIcon /> {sure !== null ? 'Sign out anyway' : 'Sign out'}
      </button>
    </Sheet>
  )
}
