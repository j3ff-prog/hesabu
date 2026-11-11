import { useCallback, useEffect, useState } from 'react'
import type { Role } from './db'
import { useToast } from './Toast'
import { useAuth } from './Auth'
import { api } from './api'
import { ApiError, type Member } from './cloudApi'
import { DELEGABLE, GRANTS, MATRIX, RIGHTS_TABLE, ROLE_HINT, ROLE_LABEL, type Perm } from './rights'
import { tempPin, validPin } from './pin'
import { showPhone, toWaNumber } from './format'
import { openWhatsApp, waLink } from './summary'
import { Sheet } from './Sheet'

const errText = (e: unknown): string => {
  if (e instanceof ApiError) return e.code === 'network' ? 'No internet. Connect and try again.' : e.message
  return 'Something went wrong. Try again.'
}

/** Add staff, set their role, give them a PIN, and send the login details on WhatsApp. */
export function TeamSheet({ onClose }: { onClose: () => void }) {
  const { shopId, shopName, me } = useAuth()
  const [list, setList] = useState<Member[] | null>(null)
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [edit, setEdit] = useState<Member | null>(null)

  const load = useCallback(async () => {
    try {
      setList(await api.members(shopId))
      setErr('')
    } catch (e) {
      setErr(errText(e))
    }
  }, [shopId])
  useEffect(() => {
    void load()
  }, [load])

  if (adding) return <StaffForm shopId={shopId} shopName={shopName} onClose={() => { setAdding(false); void load() }} />
  if (edit) return <EditMember shopId={shopId} shopName={shopName} member={edit} isMe={edit.userId === me.id} onClose={() => { setEdit(null); void load() }} />

  return (
    <Sheet title="Team" onClose={onClose}>
      {err && <p className="hint warn-text" role="alert">{err}</p>}
      {!list && !err && <p className="muted">Loading…</p>}
      {list && (
        <ul className="people">
          {list.map((u) => (
            <li key={u.userId}>
              <button className={'person' + (u.active ? '' : ' off')} onClick={() => setEdit(u)} disabled={u.role === 'owner' && u.userId !== me.id}>
                <span className="avatar">{u.name.trim()[0]?.toUpperCase()}</span>
                <span className="person-main">
                  <span className="person-name">{u.name}{u.userId === me.id ? ' (you)' : ''}</span>
                  <span className="muted">{ROLE_LABEL[u.role]}{u.perms ? ' · Own rights' : ''} · {showPhone(u.phone)}{u.active ? '' : ' · Switched off'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="btn primary block" onClick={() => setAdding(true)}>Add a person</button>
      <p className="hint spaced">Each person signs in on their own phone with their number and PIN. Their sales are saved under their name.</p>

      <h3 className="muted-head">What each role can do</h3>
      <table className="rights">
        <thead>
          <tr><th></th>{(['owner', 'manager', 'attendant'] as Role[]).map((r) => <th key={r}>{ROLE_LABEL[r]}</th>)}</tr>
        </thead>
        <tbody>
          {RIGHTS_TABLE.map((r) => (
            <tr key={r.perm}>
              <td>{r.label}</td>
              {(['owner', 'manager', 'attendant'] as Role[]).map((role) => (
                <td key={role} className={MATRIX[role].includes(r.perm) ? 'yes' : 'no'}>
                  <span aria-label={MATRIX[role].includes(r.perm) ? 'Yes' : 'No'}>{MATRIX[role].includes(r.perm) ? '✓' : '–'}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Sheet>
  )
}

const loginText = (shop: string, name: string, phone: string, pin: string): string =>
  `Hello ${name}, you can now use Tallyfy for ${shop}.\n\nOpen the app, choose "Sign in", and use:\nPhone: ${showPhone(phone)}\nPIN: ${pin}\n\nYou can change your PIN from the menu after you sign in.`

function PinCard({ shop, name, phone, pin, onDone }: { shop: string; name: string; phone: string; pin: string; onDone: () => void }) {
  return (
    <>
      <p>
        <strong>{name}</strong> can now sign in with <strong>{showPhone(phone)}</strong> and the PIN:
      </p>
      <p className="temp-pin" aria-label="PIN">{pin}</p>
      <p className="hint">Send it to them now. For safety it is not shown again.</p>
      <button className="btn amber block" onClick={() => openWhatsApp(waLink(phone, loginText(shop, name, phone, pin)))}>Send on WhatsApp</button>
      <button className="btn outline block gap-top" onClick={onDone}>Done</button>
    </>
  )
}

function StaffForm({ shopId, shopName, onClose }: { shopId: string; shopName: string; onClose: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<'manager' | 'attendant'>('attendant')
  const [pin, setPin] = useState(tempPin)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [made, setMade] = useState<{ existing: boolean } | null>(null)
  const wa = toWaNumber(phone)
  const ok = name.trim().length >= 2 && !!wa && validPin(pin)

  if (made && wa)
    return (
      <Sheet title="Person added" onClose={onClose}>
        {made.existing ? (
          <>
            <p><strong>{name}</strong> already has a Tallyfy account, so they keep their own PIN. They can open the app and choose your shop.</p>
            <button className="btn primary block" onClick={onClose}>Done</button>
          </>
        ) : (
          <PinCard shop={shopName} name={name.trim()} phone={wa} pin={pin} onDone={onClose} />
        )}
      </Sheet>
    )

  return (
    <Sheet title="Add a person" onClose={onClose}>
      <label className="field">
        <span>Their name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </label>
      <label className="field">
        <span>Phone number</span>
        <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
        {phone.trim() && !wa && <small className="hint warn-text">Enter a Kenyan number like 0712 345 678.</small>}
      </label>
      <fieldset className="field">
        <legend>Role</legend>
        <div className="segment" role="radiogroup">
          {(['attendant', 'manager'] as const).map((r) => (
            <button key={r} role="radio" aria-checked={role === r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>{ROLE_LABEL[r]}</button>
          ))}
        </div>
        <p className="hint spaced">{ROLE_HINT[role]}</p>
      </fieldset>
      <label className="field">
        <span>Their PIN (6 digits)</span>
        <input className="pin-input" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        <small className="hint">We made one up. You can change it. If they already use Tallyfy, their own PIN stays.</small>
      </label>
      {err && <p className="hint warn-text" role="alert">{err}</p>}
      <button
        className="btn primary block"
        disabled={!ok || busy}
        onClick={async () => {
          if (!wa) return
          setBusy(true)
          setErr('')
          try {
            setMade(await api.addStaff(shopId, name.trim(), wa, role, pin))
          } catch (e) {
            setErr(errText(e))
            setBusy(false)
          }
        }}
      >
        Add person
      </button>
    </Sheet>
  )
}

const sameSet = (a: Iterable<Perm>, b: Iterable<Perm>): boolean => {
  const x = new Set(a)
  const y = new Set(b)
  return x.size === y.size && [...x].every((p) => y.has(p))
}
const usual = (role: Role): Perm[] => MATRIX[role].filter((p) => DELEGABLE.includes(p))

function EditMember({ shopId, shopName, member, isMe, onClose }: { shopId: string; shopName: string; member: Member; isMe: boolean; onClose: () => void }) {
  const toast = useToast()
  const [role, setRole] = useState<Role>(member.role)
  const [active, setActive] = useState(member.active)
  const startPerms = member.perms ? member.perms.filter((p) => DELEGABLE.includes(p)) : usual(member.role)
  const [perms, setPerms] = useState<Set<Perm>>(new Set(startPerms))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [newPin, setNewPin] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const isOwner = member.role === 'owner'
  const isUsual = sameSet(perms, usual(role))
  const changed = role !== member.role || active !== member.active || !sameSet(perms, startPerms)

  if (newPin)
    return (
      <Sheet title="New PIN" onClose={onClose}>
        <PinCard shop={shopName} name={member.name} phone={member.phone} pin={newPin} onDone={onClose} />
      </Sheet>
    )

  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    setErr('')
    try {
      await f()
    } catch (e) {
      setErr(errText(e))
      setBusy(false)
    }
  }

  const pickRole = (r: Role) => {
    setRole(r)
    setPerms(new Set(usual(r)))
  }
  const toggle = (g: { perms: Perm[] }, on: boolean) => {
    const next = new Set(perms)
    for (const p of g.perms) (on ? next.add(p) : next.delete(p))
    setPerms(next)
  }

  return (
    <Sheet title={member.name} onClose={onClose}>
      <p className="muted">{ROLE_LABEL[member.role]} · {showPhone(member.phone)}</p>
      {!isOwner && (
        <>
          <fieldset className="field">
            <legend>Role</legend>
            <div className="segment" role="radiogroup">
              {(['attendant', 'manager'] as const).map((r) => (
                <button key={r} role="radio" aria-checked={role === r} className={role === r ? 'on' : ''} onClick={() => pickRole(r)}>{ROLE_LABEL[r]}</button>
              ))}
            </div>
            <p className="hint spaced">{ROLE_HINT[role]}</p>
          </fieldset>

          <h3 className="muted-head first">What {member.name} can do</h3>
          <p className="hint spaced">Switch on only what they need. Changing the role puts these back to the usual ones for that role.</p>
          <ul className="grants">
            {GRANTS.map((g) => {
              const on = g.perms.every((p) => perms.has(p))
              return (
                <li key={g.label}>
                  <label className="grant">
                    <input type="checkbox" checked={on} onChange={(e) => toggle(g, e.target.checked)} />
                    <span className="grant-text">
                      <span className="grant-name">{g.label}</span>
                      <span className="muted">{g.hint}</span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          {!isUsual && (
            <button className="link" onClick={() => setPerms(new Set(usual(role)))}>Go back to the usual rights for a {ROLE_LABEL[role].toLowerCase()}</button>
          )}

          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Can use the app</span>
          </label>
          {!active && <p className="hint">Switched off people cannot sign in. Switch them back on any time.</p>}
          <button
            className="btn primary block"
            disabled={busy || !changed}
            onClick={() =>
              run(async () => {
                await api.setMember(shopId, member.userId, role as 'manager' | 'attendant', active, isUsual ? null : [...perms])
                toast.show({ text: 'Saved', sub: `${member.name}’s access was updated` })
                onClose()
              })
            }
          >
            Save changes
          </button>
          <button
            className="btn outline block gap-top"
            disabled={busy}
            onClick={() => run(async () => { const p = tempPin(); await api.resetPin(shopId, member.phone, p); setNewPin(p); setBusy(false) })}
          >
            Set a new PIN for them
          </button>

          {!removing ? (
            <button className="btn text-danger block" disabled={busy} onClick={() => setRemoving(true)}>Remove from team</button>
          ) : (
            <div className="confirm-box" role="alertdialog" aria-label={`Remove ${member.name}?`}>
              <p className="confirm-q">Remove {member.name} from your team?</p>
              <p className="hint spaced">They lose access straight away. Their past sales stay in your records under their name.</p>
              <button
                className="btn danger block"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.removeMember(shopId, member.userId)
                    toast.show({ text: 'Removed', sub: `${member.name} is no longer on your team` })
                    onClose()
                  })
                }
              >
                Yes, remove them
              </button>
              <button className="btn outline block gap-top" onClick={() => setRemoving(false)}>No, keep them</button>
            </div>
          )}
        </>
      )}
      {isOwner && isMe && <p className="hint">You are the owner. Change your own PIN from the menu.</p>}
      {err && <p className="hint warn-text" role="alert">{err}</p>}
    </Sheet>
  )
}
