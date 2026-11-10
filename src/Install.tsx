import { useEffect, useState, useSyncExternalStore } from 'react'
import { Sheet } from './Sheet'
import { Logo } from './Icons'
import { startOfDay } from './format'

/** The browser's "install this app" offer, kept so we can show it at a good moment. */
interface InstallEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const ASKED_KEY = 'tallify.installAsked'

let offer: InstallEvent | null = null
let open = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((f) => f())
const subscribe = (f: () => void) => {
  listeners.add(f)
  return () => listeners.delete(f)
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    offer = e as InstallEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    offer = null
    open = false
    emit()
  })
}

const standalone = (): boolean => {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}
const onIos = (): boolean => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/** Can this phone install the app right now? Android and desktop browsers hand us a prompt; iPhones need the steps shown. */
export const canInstall = (): boolean => !standalone() && (offer !== null || onIos())

const recentlyAsked = (): boolean => {
  try {
    const t = Number(localStorage.getItem(ASKED_KEY) ?? 0)
    return t > 0 && startOfDay(t) === startOfDay()
  } catch {
    return false
  }
}
const markAsked = () => {
  try {
    localStorage.setItem(ASKED_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

/** Whether the install popup is on screen, so other popups can wait their turn. */
export const useInstallOpen = (): boolean => useSyncExternalStore(subscribe, () => open)
/** Whether there is something to install (for the menu item). */
export const useCanInstall = (): boolean => useSyncExternalStore(subscribe, () => canInstall())

/** Run the install: the browser's own dialog where there is one. Returns false if we need to show steps instead. */
export async function runInstall(): Promise<boolean> {
  if (!offer) return false
  const e = offer
  offer = null
  emit()
  try {
    await e.prompt()
    await e.userChoice
  } catch {
    /* the browser can refuse a second use */
  }
  return true
}

/** Opens the install sheet from anywhere, like the menu. */
export function showInstall(): void {
  open = true
  emit()
}

/** Pops up once after the site opens, offering to install it. "Not now" hides it until tomorrow. */
export function InstallAsk() {
  const isOpen = useInstallOpen()
  const can = useCanInstall()
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 2500)
    return () => clearTimeout(t)
  }, [])

  // Offer on its own once, a moment after the page opens.
  useEffect(() => {
    if (armed && can && !open && !recentlyAsked()) {
      open = true
      emit()
    }
  }, [armed, can])

  if (!isOpen) return null
  const close = () => {
    markAsked()
    open = false
    emit()
  }
  const ios = !offer
  const yes = async () => {
    if (await runInstall()) {
      markAsked()
      open = false
      emit()
    }
  }
  return (
    <Sheet title="Install Tallyfy" onClose={close}>
      <div className="install-art"><Logo size={56} /></div>
      <p>Put Tallyfy on your home screen. It opens faster, works without internet, and is how you get notifications.</p>
      {ios ? (
        <>
          <ol className="install-steps">
            <li>Tap the <strong>Share</strong> button in Safari (the square with an arrow).</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong>, then open Tallyfy from your home screen.</li>
          </ol>
          <button className="btn primary block" onClick={close}>Got it</button>
        </>
      ) : (
        <>
          <button className="btn primary block" onClick={yes}>Install Tallyfy</button>
          <button className="btn outline block gap-top" onClick={close}>Not now</button>
        </>
      )}
    </Sheet>
  )
}