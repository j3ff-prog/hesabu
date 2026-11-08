import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from './Auth'
import { api } from './api'
import { ApiError, type SupportMsg } from './cloudApi'
import { SUPPORT_EMAIL, supportLink } from './format'
import { disablePush, enablePush, pushState, type PushState } from './push'
import { Sheet } from './Sheet'

const errText = (e: unknown): string =>
  e instanceof ApiError && e.code === 'network' ? 'No internet. Connect and try again.' : e instanceof Error ? e.message : 'Something went wrong. Try again.'

const timeLabel = (iso: string): string => {
  const d = new Date(iso)
  const today = new Date()
  const time = d.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' })
  return d.toDateString() === today.toDateString() ? time : `${d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}, ${time}`
}

/** A simple chat. Messages from the shop sit on the right, replies from Tallyfy support on the left. */
function Chat({ load, send, placeholder }: { load: () => Promise<SupportMsg[]>; send: (body: string) => Promise<void>; placeholder: string }) {
  const [msgs, setMsgs] = useState<SupportMsg[] | null>(null)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    try {
      setMsgs(await load())
      setErr('')
    } catch (e) {
      setErr(errText(e))
    }
  }, [load])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 15_000)
    return () => window.clearInterval(t)
  }, [refresh])
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [msgs?.length])

  const submit = async () => {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      await send(body)
      setText('')
      await refresh()
    } catch (e) {
      setErr(errText(e))
    }
    setBusy(false)
  }

  return (
    <div className="chat">
      <div className="chat-log" role="log" aria-live="polite">
        {msgs && msgs.length === 0 && <p className="muted">No messages yet. Write to us below.</p>}
        {msgs?.map((m) => (
          <div key={m.id} className={'bubble ' + (m.fromAdmin ? 'them' : 'me')}>
            {m.sender && <span className="bubble-who">{m.sender}</span>}
            <span>{m.body}</span>
            <span className="bubble-time">{timeLabel(m.createdAt)}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
      {err && <p className="hint warn-text" role="alert">{err}</p>}
      <form className="chat-box" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <input type="text" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label="Message" />
        <button className="btn primary" type="submit" disabled={!text.trim() || busy}>Send</button>
      </form>
    </div>
  )
}

const FAQ: [string, string][] = [
  ['I forgot my PIN.', 'Staff: ask your owner to set a new one under Menu, then Team. Owners: send us a message here or email us, and we will confirm it is you and reset it.'],
  ['Can I use it without internet?', 'Yes. Sales, stock and expenses are saved on your phone and sent when the signal comes back. Signing in needs internet.'],
  ['How do I add a staff member?', 'Menu, then Team, then Add a person. Give them the PIN we show you. They sign in on their own phone.'],
  ['How do I pay?', 'Menu, then Subscription. Type the phone number you sign in with on the payment page, so we can find your shop.'],
  ['My numbers look wrong.', 'Open Reports. A sale that was cancelled or an item with no buying price can change the profit. Send us a message and we will look at it with you.']
]

/** Menu > Help: quick answers, plus a chat with the Tallyfy team for owners and managers. */
export function HelpSheet({ onClose }: { onClose: () => void }) {
  const { shopId, me, can } = useAuth()
  const chat = can('settings') || me.role === 'manager'
  const load = useCallback(() => api.supportMessages(shopId), [shopId])
  return (
    <Sheet title="Help and support" onClose={onClose}>
      {chat ? (
        <>
          <h3 className="muted-head">Chat with Tallyfy</h3>
          <Chat load={load} send={(b) => api.sendSupport(shopId, me.name, b)} placeholder="Type your question" />
          <p className="hint spaced">We reply here and send you a notification if you have turned them on. You can also email {SUPPORT_EMAIL}.</p>
        </>
      ) : (
        <p className="hint">Chat is for owners and managers. Ask your owner, or email <a href={supportLink('Tallyfy help')}>{SUPPORT_EMAIL}</a>.</p>
      )}
      <h3 className="muted-head">Quick answers</h3>
      {FAQ.map(([q, a]) => (
        <details key={q} className="faq">
          <summary>{q}</summary>
          <p>{a}</p>
        </details>
      ))}
    </Sheet>
  )
}

/** Turn notifications on or off for this phone. */
export function NotifyBlock({ shopId, label }: { shopId: string | null; label: string }) {
  const [state, setState] = useState<PushState | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void pushState().then(setState)
  }, [])
  if (!state) return null

  const toggle = async () => {
    setBusy(true)
    setErr('')
    try {
      if (state === 'on') await disablePush()
      else await enablePush(shopId)
    } catch (e) {
      setErr(errText(e))
    }
    setState(await pushState())
    setBusy(false)
  }

  return (
    <div>
      <p className="hint">{label}</p>
      {state === 'unsupported' && <p className="hint warn-text">This phone or browser cannot show notifications. On an iPhone, add the app to the Home Screen first.</p>}
      {state === 'blocked' && <p className="hint warn-text">Notifications are blocked for this app. Turn them on in the phone settings, then come back.</p>}
      {(state === 'on' || state === 'off') && (
        <button className={'btn block ' + (state === 'on' ? 'outline' : 'primary')} disabled={busy} onClick={toggle}>
          {state === 'on' ? 'Turn notifications off on this phone' : 'Turn notifications on'}
        </button>
      )}
      {state === 'on' && <p className="hint ok-text" role="status">Notifications are on for this phone.</p>}
      {err && <p className="hint warn-text" role="alert">{err}</p>}
    </div>
  )
}

export function NotifySheet({ onClose }: { onClose: () => void }) {
  const { shopId } = useAuth()
  return (
    <Sheet title="Notifications" onClose={onClose}>
      <NotifyBlock shopId={shopId} label="Get a notification on this phone when someone on your team records a sale, and when Tallyfy support replies to you. Your own sales do not notify you." />
    </Sheet>
  )
}

/** For the Tallyfy admin: every shop's chat, newest message first, with a reply box. */
export function AdminSupport({ names, onClose }: { names: Record<string, string>; onClose: () => void }) {
  const [all, setAll] = useState<SupportMsg[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      setAll(await api.adminSupport())
    } catch (e) {
      setErr(errText(e))
    }
  }, [])
  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(t)
  }, [load])

  const threads = new Map<string, SupportMsg[]>()
  for (const m of all ?? []) threads.set(m.shopId, [...(threads.get(m.shopId) ?? []), m])
  const list = [...threads.entries()].sort((a, b) => b[1][b[1].length - 1].createdAt.localeCompare(a[1][a[1].length - 1].createdAt))

  if (open) {
    const mine = threads.get(open) ?? []
    return (
      <Sheet title={names[open] ?? 'Shop'} onClose={() => { setOpen(null); void load() }}>
        <Chat load={async () => (await api.adminSupport()).filter((m) => m.shopId === open)} send={(b) => api.adminReply(open, b)} placeholder="Write a reply" />
        {mine.length === 0 && <p className="muted">No messages.</p>}
      </Sheet>
    )
  }

  return (
    <Sheet title="Support messages" onClose={onClose}>
      <NotifyBlock shopId={null} label="Get a notification on this phone when a shop writes to you." />
      {err && <p className="hint warn-text" role="alert">{err}</p>}
      {all && list.length === 0 && <p className="muted">No messages yet.</p>}
      <ul className="people">
        {list.map(([shop, ms]) => {
          const last = ms[ms.length - 1]
          return (
            <li key={shop}>
              <button className="person" onClick={() => setOpen(shop)}>
                <span className="avatar">{(names[shop] ?? '?').trim()[0]?.toUpperCase()}</span>
                <span className="person-main">
                  <span className="person-name">{names[shop] ?? 'Shop'}{!last.fromAdmin ? ' · needs a reply' : ''}</span>
                  <span className="muted">{last.fromAdmin ? 'You: ' : ''}{last.body.slice(0, 60)}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}

const ASKED_KEY = 'tallify.notifyAsked'

/** Shown once after signing in, only if notifications are off. "Not now" is remembered. */
export function NotifyAsk() {
  const { shopId } = useAuth()
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    let asked = false
    try {
      asked = localStorage.getItem(ASKED_KEY) === '1'
    } catch {
      /* ignore */
    }
    if (asked) return
    void pushState().then((s) => {
      if (s === 'off') setShow(true)
    })
  }, [])
  const remember = () => {
    try {
      localStorage.setItem(ASKED_KEY, '1')
    } catch {
      /* ignore */
    }
  }
  if (!show) return null
  const no = () => {
    remember()
    setShow(false)
  }
  const yes = async () => {
    setBusy(true)
    setErr('')
    try {
      await enablePush(shopId)
      remember()
      setShow(false)
    } catch (e) {
      setErr(errText(e))
      setBusy(false)
    }
  }
  return (
    <Sheet title="Turn on notifications?" onClose={no}>
      <p>Get a notification on this phone when someone on your team records a sale, and when Tallyfy support replies. You can change this any time in the menu.</p>
      <button className="btn primary block" disabled={busy} onClick={yes}>Turn notifications on</button>
      <button className="btn outline block" disabled={busy} onClick={no}>Not now</button>
      {err && <p className="hint warn-text" role="alert">{err}</p>}
    </Sheet>
  )
}
