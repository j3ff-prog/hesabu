import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ApiError, PHONE_EMAIL, PIN_PASSWORD, type AdminShop, type Api, type Member, type Row, type Session, type ShopInfo, type ShopState } from './cloudApi'
import type { Role } from './db'

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://rkvjhveblhiprvyttxus.supabase.co'
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY as string | undefined) || 'sb_publishable_J68GDYMBQ0RI-7zS4kHn5A_0MW500RO'

let client: SupabaseClient | null = null
const sb = (): SupabaseClient => {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  return client
}

/** Turn a Supabase error into one of ours. A failed fetch means we are offline. */
function fail(e: { message?: string; status?: number; code?: string } | null | undefined): never {
  const m = e?.message ?? 'Something went wrong'
  if (/fetch|network|Failed to|load failed/i.test(m) || e?.status === 0) throw new ApiError('network', 'No internet')
  if (/already registered|already exists/i.test(m)) throw new ApiError('exists', 'That number already has an account')
  if (/invalid login/i.test(m)) throw new ApiError('wrong', 'Wrong phone number or PIN')
  if (e?.code === '42501' || /row-level security|permission denied|not allowed|only the owner/i.test(m)) throw new ApiError('denied', 'Not allowed')
  throw new ApiError('unknown', m)
}
const ok = <T>(r: { data: T | null; error: { message?: string } | null }): T => {
  if (r.error) fail(r.error)
  return r.data as T
}

const phoneOf = (email: string | undefined): string => (email ?? '').replace('@hesabu.app', '')
const session = (u: { id: string; email?: string }): Session => ({ userId: u.id, phone: phoneOf(u.email) })

export const realApi: Api = {
  async getSession() {
    const { data } = await sb().auth.getSession()
    return data.session ? session(data.session.user) : null
  },
  async signUp(phone, pin) {
    const r = await sb().auth.signUp({ email: PHONE_EMAIL(phone), password: PIN_PASSWORD(pin) })
    if (r.error) fail(r.error)
    // With email confirmation off, a repeat sign-up returns a user with no identities instead of an error.
    if (!r.data.user || (r.data.user.identities ?? []).length === 0) throw new ApiError('exists', 'That number already has an account')
    if (!r.data.session) throw new ApiError('unknown', 'Sign-up needs "Confirm email" switched off in Supabase')
    return session(r.data.user)
  },
  async signIn(phone, pin) {
    const r = await sb().auth.signInWithPassword({ email: PHONE_EMAIL(phone), password: PIN_PASSWORD(pin) })
    if (r.error) fail(r.error)
    return session(r.data.user)
  },
  async signOut() {
    await sb().auth.signOut()
  },
  async changePin(current, next) {
    const s = await sb().auth.getSession()
    const email = s.data.session?.user.email
    if (!email) throw new ApiError('denied', 'Not signed in')
    const check = await sb().auth.signInWithPassword({ email, password: PIN_PASSWORD(current) })
    if (check.error) throw new ApiError('wrong', 'Your current PIN is not right')
    const r = await sb().auth.updateUser({ password: PIN_PASSWORD(next) })
    if (r.error) fail(r.error)
  },

  async myShops() {
    const uid = (await sb().auth.getUser()).data.user?.id
    const rows = ok(await sb().from('members').select('role, name, shop:shops(id, name, owner_phone)').eq('user_id', uid ?? '').eq('active', true)) as unknown as {
      role: Role
      name: string
      shop: { id: string; name: string; owner_phone: string } | { id: string; name: string; owner_phone: string }[] | null
    }[]
    const out: ShopInfo[] = []
    for (const m of rows) {
      const s = Array.isArray(m.shop) ? m.shop[0] : m.shop
      if (s) out.push({ id: s.id, name: s.name, role: m.role, memberName: m.name, ownerPhone: s.owner_phone })
    }
    return out
  },
  async createShop(name, ownerName, phone) {
    return ok(await sb().rpc('create_shop', { p_name: name, p_owner_name: ownerName, p_phone: phone })) as string
  },
  async updateShop(id, name, phone) {
    ok(await sb().from('shops').update({ name, owner_phone: phone }).eq('id', id).select('id'))
  },
  async shopState(id) {
    const rows = ok(await sb().rpc('shop_state', { p_shop: id })) as { writable: boolean; status: ShopState['status']; until: string | null; message: string }[]
    const r = rows?.[0]
    return r ? { writable: r.writable, status: r.status, until: r.until, message: r.message } : null
  },
  async members(shopId) {
    const rows = ok(await sb().from('members').select('user_id, name, phone, role, active').eq('shop_id', shopId).order('created_at')) as {
      user_id: string; name: string; phone: string; role: Role; active: boolean
    }[]
    return rows.map((m): Member => ({ userId: m.user_id, name: m.name, phone: m.phone, role: m.role, active: m.active }))
  },
  async addStaff(shopId, name, phone, role, pin) {
    const r = await sb().functions.invoke('add-staff', { body: { action: 'add', shopId, name, phone, role, pin } })
    if (r.error) {
      let msg = r.error.message
      try { msg = (await (r.error as unknown as { context: Response }).context.json()).error ?? msg } catch { /* keep message */ }
      throw new ApiError(/more than one|Only the owner/.test(msg) ? 'denied' : 'unknown', msg)
    }
    return { existing: !!(r.data as { existing?: boolean }).existing }
  },
  async resetPin(shopId, phone, pin) {
    const r = await sb().functions.invoke('add-staff', { body: { action: 'reset-pin', shopId, phone, pin } })
    if (r.error) {
      let msg = r.error.message
      try { msg = (await (r.error as unknown as { context: Response }).context.json()).error ?? msg } catch { /* keep message */ }
      throw new ApiError('unknown', msg)
    }
  },
  async setMember(shopId, userId, role, active) {
    ok(await sb().rpc('set_member', { p_shop: shopId, p_user: userId, p_role: role, p_active: active }))
  },

  async pull(shopId, table, since) {
    const key = table === 'closings' || table === 'customers' ? undefined : 'updated_at'
    let q = sb().from(table).select('*').eq('shop_id', shopId)
    if (since) q = q.gte('updated_at', since)
    return ok(await q.order(key ?? 'updated_at', { ascending: true }).limit(500)) as Row[]
  },
  async pullLines(saleIds) {
    if (saleIds.length === 0) return { lines: [], costs: [] }
    const lines = ok(await sb().from('sale_lines').select('*').in('sale_id', saleIds)) as Row[]
    const ids = lines.map((l) => l.id as string)
    // Attendants get no rows back from this table, by design.
    const costs = ids.length ? (ok(await sb().from('sale_line_costs').select('*').in('line_id', ids)) as Row[]) : []
    return { lines, costs }
  },
  async upsert(table, rows, onConflict, ignoreDuplicates) {
    if (rows.length === 0) return
    ok(await sb().from(table).upsert(rows, { onConflict, ignoreDuplicates }))
  },
  async pushSale(sale, lines) {
    ok(await sb().rpc('push_sale', { p_sale: sale, p_lines: lines }))
  },
  async voidSale(id, at) {
    ok(await sb().from('sales').update({ voided_at: at }).eq('id', id).select('id'))
  },
  async softDelete(table, id) {
    ok(await sb().from(table).update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id'))
  },

  async adminShops() {
    return ok(await sb().rpc('admin_shops')) as AdminShop[]
  },
  async adminResetOwner(shopId, pin) {
    const r = await sb().functions.invoke('add-staff', { body: { action: 'admin-reset', shopId, pin } })
    if (r.error) {
      let msg = r.error.message
      try { msg = (await (r.error as unknown as { context: Response }).context.json()).error ?? msg } catch { /* keep message */ }
      throw new ApiError('unknown', msg)
    }
    return { phone: (r.data as { phone: string }).phone }
  },
  async adminSetShop(id, status, plan, paidUntil, note, message) {
    ok(await sb().rpc('admin_set_shop', { p_shop: id, p_status: status, p_plan: plan, p_paid_until: paidUntil, p_note: note, p_message: message }))
  }
}
