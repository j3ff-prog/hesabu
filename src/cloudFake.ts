import { ApiError, type Api } from './cloudApi'

/** Test stand-in: forwards every call to a small server (tests/fakeserver.mjs) that behaves like the Supabase side. */
const base = (import.meta.env.VITE_FAKE_CLOUD as string | undefined) ?? ''
const TOKEN = 'tallify.fakeToken'
const token = (): string => {
  try {
    return localStorage.getItem(TOKEN) ?? ''
  } catch {
    return ''
  }
}

async function call(method: string, args: unknown[]): Promise<unknown> {
  let r: Response
  try {
    r = await fetch(base + '/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, args, token: token() }) })
  } catch {
    throw new ApiError('network', 'No internet')
  }
  const j = (await r.json()) as { ok?: unknown; error?: { code: ApiError['code']; message: string } }
  if (j.error) throw new ApiError(j.error.code, j.error.message)
  if (method === 'signIn' || method === 'signUp') {
    try {
      localStorage.setItem(TOKEN, (j.ok as { userId: string }).userId)
    } catch { /* ignore */ }
  }
  if (method === 'signOut') {
    try {
      localStorage.removeItem(TOKEN)
    } catch { /* ignore */ }
  }
  return j.ok
}

const names = [
  'getSession', 'signUp', 'signIn', 'signOut', 'changePin', 'myShops', 'createShop', 'updateShop', 'shopState', 'members', 'addStaff',
  'resetPin', 'setMember', 'removeMember', 'pull', 'pullLines', 'upsert', 'pushSale', 'voidSale', 'softDelete', 'savePush', 'removePush', 'supportMessages', 'sendSupport', 'adminSupport', 'adminReply', 'adminShops', 'adminResetOwner', 'adminSetShop'
] as const
export const fakeApi = Object.fromEntries(names.map((n) => [n, (...a: unknown[]) => call(n, a)])) as unknown as Api
