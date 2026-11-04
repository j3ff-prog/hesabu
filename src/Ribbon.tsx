import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DownloadIcon, LockIcon, Logo, PlusIcon } from './Icons'
import { useAuth } from './Auth'
import { ROLE_LABEL } from './rights'
import { Sheet } from './Sheet'
import { useAccount } from './cloud'

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

/** The bar across the top: logo, shop name, and the actions people reach for most. */
export function Ribbon({ shop, open }: { shop: string; open: (p: Panel) => void }) {
  const { me, can, teamOn, readOnly } = useAuth()
  const online = useOnline()
  const account = useAccount()
  const data = can('export') || can('importStock')

  return (
    <>
      <header className="ribbon">
        <Link to="/" className="ribbon-brand" aria-label="Hesabu, go to Sell">
          <Logo size={30} />
        </Link>
        <div className="ribbon-shop">
          <span className="ribbon-name">{shop}</span>
          <span className={'chip-state' + (online ? '' : ' off')}>{online ? 'Saved on this phone' : 'Offline, still working'}</span>
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
            {teamOn && <span className="avatar-role">{ROLE_LABEL[me.role]}</span>}
          </button>
        </div>
      </header>
      {readOnly && (
        <div className="banner" role="status">
          <strong>Your subscription has ended.</strong> {account.message || 'You can look at your records and download your data. Renew to record new sales.'}
        </div>
      )}
    </>
  )
}

export function MenuSheet({ shop, open, onClose }: { shop: string; open: (p: Panel) => void; onClose: () => void }) {
  const { me, can, teamOn, signOut } = useAuth()
  const data = can('export') || can('importStock')
  const item = (label: string, hint: string, go: () => void) => (
    <li key={label}>
      <button className="menu-item" onClick={go}>
        <span>{label}</span>
        <span className="muted">{hint}</span>
      </button>
    </li>
  )
  return (
    <Sheet title={shop} onClose={onClose}>
      <p className="muted">Signed in as <strong>{me.name}</strong>{teamOn ? ` · ${ROLE_LABEL[me.role]}` : ''}</p>
      <ul className="menu-list">
        {data && item('Data', 'Download spreadsheets, upload stock', () => open('data'))}
        {can('team') && item('Team', teamOn ? 'Staff, roles and PINs' : 'Add staff and protect the shop with a PIN', () => open('team'))}
        {can('settings') && item('Shop settings', 'Name, owner’s number, backup', () => open('settings'))}
        {teamOn && item('Change my PIN', 'Choose a new PIN', () => open('pin'))}
      </ul>
      {teamOn && (
        <button className="btn outline block gap-top" onClick={() => { onClose(); signOut() }}>
          <LockIcon /> Lock the app
        </button>
      )}
    </Sheet>
  )
}
