import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { HashRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { useShop, getOwnerPhone } from './shop'
import { Welcome } from './Welcome'
import { Sell } from './Sell'
import { Stock } from './Stock'
import { Credit } from './Credit'
import { Expenses } from './Expenses'
import { Reports } from './Reports'
import { Admin } from './Admin'
import { AuthProvider, useAuth } from './Auth'
import { ForcePin, SignIn, ChangePinSheet } from './SignIn'
import { Ribbon, MenuSheet, type Panel } from './Ribbon'
import { TeamSheet } from './Team'
import { DataSheet } from './DataSheet'
import { SettingsSheet } from './Settings'
import { UiContext } from './Ui'
import { CreditIcon, ExpensesIcon, Logo, ReportsIcon, SellIcon, StockIcon } from './Icons'
import { TallyDraw } from './Tally'
import { ToastContext, type ToastData } from './Toast'
import { heartbeat } from './cloud'

export default function App() {
  const [shop, setShop] = useShop()

  // The admin page is for the Hesabu owner, on any device: it skips the shop's own sign-in.
  if (window.location.hash.startsWith('#/admin')) {
    return (
      <HashRouter>
        <Routes>
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </HashRouter>
    )
  }

  if (!shop) return <Welcome onDone={setShop} />

  return (
    <AuthProvider
      gate={(a) => {
        if (!a.teamOn) return null
        if (a.me.id === 0) return <SignIn />
        const u = a.users.find((x) => x.id === a.me.id)
        return u?.mustChange ? <ForcePin /> : null
      }}
    >
      <Shell shop={shop} setShop={setShop} />
    </AuthProvider>
  )
}

function Deny({ title }: { title: string }) {
  return (
    <main className="page">
      <h1>{title}</h1>
      <p className="muted">You don’t have access to this. Ask the owner.</p>
    </main>
  )
}

function Shell({ shop, setShop }: { shop: string; setShop: (n: string) => void }) {
  const { can } = useAuth()
  const [toast, setToast] = useState<ToastData | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [needNumber, setNeedNumber] = useState(false)

  const show = useCallback((t: Omit<ToastData, 'id'>) => setToast({ ...t, id: Date.now() }), [])
  const toastCtx = useMemo(() => ({ show }), [show])
  const ui = useMemo(
    () => ({
      openSettings: (n = false) => {
        setNeedNumber(n)
        setPanel('settings')
      },
      openData: () => setPanel('data')
    }),
    []
  )

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    void heartbeat(shop, getOwnerPhone())
  }, [shop])

  const guard = (ok: boolean, title: string, el: ReactNode) => (ok ? el : <Deny title={title} />)
  const close = () => setPanel(null)

  return (
    <ToastContext.Provider value={toastCtx}>
      <UiContext.Provider value={ui}>
        <HashRouter>
          <div className="app">
            <Ribbon shop={shop} open={setPanel} />
            <Routes>
              <Route path="/" element={<Sell />} />
              <Route path="/stock" element={guard(can('viewStock'), 'Stock', <Stock />)} />
              <Route path="/credit" element={guard(can('credit'), 'Credit', <Credit shop={shop} />)} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/reports/*" element={<Reports shop={shop} />} />
              <Route path="/today" element={<Navigate to="/reports" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>

            {toast && (
              <div className="toast" role="status" key={toast.id}>
                <TallyDraw />
                <div className="toast-text">
                  <span>{toast.text}</span>
                  {toast.sub && <span className="toast-sub">{toast.sub}</span>}
                </div>
                {toast.undo && (
                  <button
                    className="toast-undo"
                    onClick={() => {
                      toast.undo?.()
                      setToast(null)
                    }}
                  >
                    Undo
                  </button>
                )}
              </div>
            )}

            <nav className="tabs" aria-label="Main">
              <div className="brand" aria-hidden="true">
                <Logo size={34} />
                <span>hesabu</span>
              </div>
              {can('sell') && (
                <NavLink to="/" end>
                  <SellIcon />
                  <span>Sell</span>
                </NavLink>
              )}
              {can('viewStock') && (
                <NavLink to="/stock">
                  <StockIcon />
                  <span>Stock</span>
                </NavLink>
              )}
              {can('credit') && (
                <NavLink to="/credit">
                  <CreditIcon />
                  <span>Credit</span>
                </NavLink>
              )}
              {can('expenses') && (
                <NavLink to="/expenses">
                  <ExpensesIcon />
                  <span>Expenses</span>
                </NavLink>
              )}
              <NavLink to="/reports">
                <ReportsIcon />
                <span>{can('dashboard') ? 'Reports' : 'My day'}</span>
              </NavLink>
            </nav>
          </div>

          {panel === 'menu' && <MenuSheet shop={shop} open={setPanel} onClose={close} />}
          {panel === 'data' && <DataSheet onClose={close} />}
          {panel === 'team' && <TeamSheet onClose={close} />}
          {panel === 'pin' && <ChangePinSheet onClose={close} />}
          {panel === 'settings' && (
            <SettingsSheet
              shop={shop}
              onRename={(n) => {
                setShop(n)
                void heartbeat(n, getOwnerPhone(), true)
              }}
              onClose={close}
              needNumber={needNumber}
            />
          )}
        </HashRouter>
      </UiContext.Provider>
    </ToastContext.Provider>
  )
}
