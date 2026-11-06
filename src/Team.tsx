import { useState } from 'react'
import { db, saveUser, updateUser, type Role, type User } from './db'
import { useAuth } from './Auth'
import { MATRIX, RIGHTS_TABLE, ROLE_HINT, ROLE_LABEL } from './rights'
import { hashPin, newSalt, recoveryCode, saveRecovery, hasRecovery, tempPin, validPin, clearFail } from './pin'
import { showPhone, toWaNumber } from './format'
import { openWhatsApp, waLink } from './summary'
import { Sheet } from './Sheet'
import { useShop } from './shop'
import { getOwnerPhone } from './shop'

/** Add staff, set their role, give them a temporary PIN, and send the login details on WhatsApp. */
export function TeamSheet({ onClose }: { onClose: () => void }) {
  const { users, teamOn, me } = useAuth()
  const [adding, setAdding] = useState<null | 'owner' | 'staff'>(null)
  const [edit, setEdit] = useState<User | null>(null)

  if (!teamOn && !adding) {
    return (
      <Sheet title="Team" onClose={onClose}>
        <p>Right now anyone holding this phone can see everything. Protect the shop with your own PIN, then add your staff.</p>
        <p className="hint spaced">Attendants will only be able to sell, see stock and take credit payments. They won’t see buying prices, profit or expenses.</p>
        <button className="btn primary block" onClick={() => setAdding('owner')}>Set my PIN</button>
      </Sheet>
    )
  }
  if (adding === 'owner') return <OwnerSetup onClose={onClose} />
  if (adding === 'staff') return <StaffForm onClose={() => setAdding(null)} />
  if (edit) return <EditUser user={edit} isMe={edit.id === me.id} onClose={() => setEdit(null)} />

  return (
    <Sheet title="Team" onClose={onClose}>
      <ul className="people">
        {users.map((u) => (
          <li key={u.id}>
            <button className={'person' + (u.active ? '' : ' off')} onClick={() => setEdit(u)}>
              <span className="avatar">{u.name.trim()[0]?.toUpperCase()}</span>
              <span className="person-main">
                <span className="person-name">{u.name}{u.id === me.id ? ' (you)' : ''}</span>
                <span className="muted">{ROLE_LABEL[u.role]} · {showPhone(u.phone)}{u.active ? '' : ' · Switched off'}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button className="btn primary block" onClick={() => setAdding('staff')}>Add a person</button>

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
      <p className="hint spaced">
        Staff sign in on this phone with their name and PIN. Staff using their own phones will need online sync, which comes later.
      </p>
    </Sheet>
  )
}

function OwnerSetup({ onClose }: { onClose: () => void }) {
  const { startSession, claimOwner } = useAuth()
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [phone, setPhone] = useState(getOwnerPhone() ? showPhone(getOwnerPhone()) : '')
  const [code, setCode] = useState('')
  const [newId, setNewId] = useState(0)
  const wa = toWaNumber(phone)
  const ok = name.trim().length >= 2 && validPin(pin) && !!wa

  if (code) {
    return (
      <Sheet title="Keep this code safe" onClose={() => startSession(newId) ?? onClose()}>
        <p>If you ever forget your PIN, this code lets you choose a new one. It is shown only once.</p>
        <p className="recovery">{code}</p>
        <p className="hint spaced">Write it down or send it to yourself on WhatsApp. Don’t leave it in the shop.</p>
        <button className="btn primary block" onClick={() => { startSession(newId); onClose() }}>I have saved it</button>
      </Sheet>
    )
  }
  return (
    <Sheet title="Set my PIN" onClose={onClose}>
      <label className="field">
        <span>Your name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </label>
      <label className="field">
        <span>Your phone number</span>
        <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
      </label>
      <label className="field">
        <span>PIN (4 to 6 digits)</span>
        <input className="pin-input" type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
      </label>
      <button
        className="btn primary block"
        disabled={!ok}
        onClick={async () => {
          const salt = newSalt()
          claimOwner()
          const id = await saveUser({
            name: name.trim(), phone: wa!, role: 'owner', salt, pinHash: await hashPin(pin, salt),
            mustChange: false, active: true, createdAt: Date.now()
          })
          const c = recoveryCode()
          await saveRecovery(c)
          setNewId(id)
          setCode(c)
        }}
      >
        Save and protect the shop
      </button>
    </Sheet>
  )
}

function StaffForm({ onClose }: { onClose: () => void }) {
  const { users } = useAuth()
  const [shop] = useShop()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<Role>('attendant')
  const [made, setMade] = useState<{ name: string; phone: string; pin: string; role: Role } | null>(null)
  const wa = toWaNumber(phone)
  const dup = wa ? users.some((u) => u.phone === wa) : false
  const ok = name.trim().length >= 2 && !!wa && !dup

  if (made) {
    const msg = `Hello ${made.name}, you have been added to ${shop} on Hesabu as ${ROLE_LABEL[made.role]}.\nOpen the Hesabu app, choose your name and type this PIN: ${made.pin}\nYou will be asked to choose your own PIN the first time.`
    return (
      <Sheet title="Person added" onClose={onClose}>
        <p><strong>{made.name}</strong> can now sign in.</p>
        <p className="muted">Temporary PIN</p>
        <p className="recovery">{made.pin}</p>
        <p className="hint spaced">They will choose their own PIN the first time they sign in. Tell them the PIN or send it on WhatsApp.</p>
        <button className="btn primary block" onClick={() => openWhatsApp(waLink(made.phone, msg))}>Send login details on WhatsApp</button>
        <button className="btn plain-btn block" onClick={onClose}>Done</button>
      </Sheet>
    )
  }
  return (
    <Sheet title="Add a person" onClose={onClose}>
      <label className="field">
        <span>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </label>
      <label className="field">
        <span>Phone number (no email needed)</span>
        <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
      </label>
      {phone.trim() && !wa && <p className="hint warn-text">Enter a Kenyan number like 0712 345 678.</p>}
      {dup && <p className="hint warn-text">Someone with this number is already on your team.</p>}
      <fieldset className="field">
        <legend>Role</legend>
        <div className="segment" role="radiogroup">
          {(['attendant', 'manager'] as Role[]).map((r) => (
            <button key={r} role="radio" aria-checked={role === r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>{ROLE_LABEL[r]}</button>
          ))}
        </div>
        <p className="hint spaced">{ROLE_HINT[role]}</p>
      </fieldset>
      <button
        className="btn primary block"
        disabled={!ok}
        onClick={async () => {
          const pin = tempPin()
          const salt = newSalt()
          await saveUser({
            name: name.trim(), phone: wa!, role, salt, pinHash: await hashPin(pin, salt),
            mustChange: true, active: true, createdAt: Date.now()
          })
          setMade({ name: name.trim(), phone: wa!, pin, role })
        }}
      >
        Add person
      </button>
    </Sheet>
  )
}

function EditUser({ user, isMe, onClose }: { user: User; isMe: boolean; onClose: () => void }) {
  const { users } = useAuth()
  const [pin, setPin] = useState<string | null>(null)
  const [sure, setSure] = useState(false)
  const owners = users.filter((u) => u.role === 'owner' && u.active).length
  const lastOwner = user.role === 'owner' && owners <= 1

  return (
    <Sheet title={user.name} onClose={onClose}>
      <p className="muted">{ROLE_LABEL[user.role]} · {showPhone(user.phone)}</p>
      {user.role !== 'owner' && (
        <fieldset className="field">
          <legend>Role</legend>
          <div className="segment" role="radiogroup">
            {(['attendant', 'manager'] as Role[]).map((r) => (
              <button key={r} role="radio" aria-checked={user.role === r} className={user.role === r ? 'on' : ''} onClick={async () => { await updateUser(user.id, { role: r }); onClose() }}>{ROLE_LABEL[r]}</button>
            ))}
          </div>
        </fieldset>
      )}
      {pin ? (
        <>
          <p className="muted">New temporary PIN</p>
          <p className="recovery">{pin}</p>
          <p className="hint spaced">{user.name} will choose their own PIN at next sign-in.</p>
        </>
      ) : (
        <button
          className="btn outline block"
          onClick={async () => {
            const p = tempPin()
            const salt = newSalt()
            await updateUser(user.id, { salt, pinHash: await hashPin(p, salt), mustChange: !isMe })
            clearFail(user.id)
            setPin(p)
          }}
        >
          Give a new PIN
        </button>
      )}
      {!isMe && (
        <button
          className="btn outline block gap-top"
          onClick={async () => { await updateUser(user.id, { active: !user.active }); onClose() }}
        >
          {user.active ? 'Switch off (can’t sign in)' : 'Switch back on'}
        </button>
      )}
      {!isMe && !lastOwner && (
        <button
          className={'btn text-danger block' + (sure ? ' armed' : '')}
          onClick={async () => {
            if (!sure) return setSure(true)
            await db.users.delete(user.id)
            onClose()
          }}
        >
          {sure ? 'Tap again to remove for good' : 'Remove person'}
        </button>
      )}
      {!isMe && <p className="hint center">Their past sales stay in your records.</p>}
      {isMe && !hasRecovery() && <p className="hint">No recovery code was saved for this PIN.</p>}
    </Sheet>
  )
}
