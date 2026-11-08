import type { Role } from './db'

/** Everything the app needs from the server, in one place. The real one talks to Supabase. */

export class ApiError extends Error {
  constructor(public code: 'exists' | 'bad' | 'network' | 'denied' | 'unknown' | 'wrong', message: string) {
    super(message)
  }
}

export interface Session {
  userId: string
  phone: string // 2547XXXXXXXX
}

export interface ShopInfo {
  id: string
  name: string
  role: Role
  memberName: string
  ownerPhone: string
}

export interface ShopState {
  writable: boolean
  status: 'trial' | 'active' | 'suspended'
  until: string | null
  message: string
}

export interface Member {
  userId: string
  name: string
  phone: string
  role: Role
  active: boolean
}

export interface AdminShop {
  id: string
  name: string
  owner_phone: string
  created_at: string
  status: 'trial' | 'active' | 'suspended'
  trial_ends_at: string
  paid_until: string | null
  plan: string
  admin_note: string
  message: string
  staff: number
  products: number
  sales30: number
  revenue30: number
  last_sale: string | null
}

export interface SupportMsg {
  id: string
  shopId: string
  fromAdmin: boolean
  sender: string
  body: string
  createdAt: string
}

export interface PushSub {
  endpoint: string
  p256dh: string
  auth: string
}

export type SyncTable = 'products' | 'product_costs' | 'sales' | 'payments' | 'customers' | 'expenses' | 'closings'
export type Row = Record<string, unknown>

export interface Api {
  getSession(): Promise<Session | null>
  signUp(phone: string, pin: string): Promise<Session>
  signIn(phone: string, pin: string): Promise<Session>
  signOut(): Promise<void>
  changePin(current: string, next: string): Promise<void>

  myShops(): Promise<ShopInfo[]>
  createShop(name: string, ownerName: string, phone: string): Promise<string>
  updateShop(id: string, name: string, phone: string): Promise<void>
  shopState(id: string): Promise<ShopState | null>
  members(shopId: string): Promise<Member[]>
  addStaff(shopId: string, name: string, phone: string, role: 'manager' | 'attendant', pin: string): Promise<{ existing: boolean }>
  resetPin(shopId: string, phone: string, pin: string): Promise<void>
  setMember(shopId: string, userId: string, role: 'manager' | 'attendant', active: boolean): Promise<void>

  /** Rows changed since `since` (an ISO time or null for everything), oldest first, at most 500. */
  pull(shopId: string, table: SyncTable, since: string | null): Promise<Row[]>
  /** The lines (and, for owners and managers, their costs) of these sales. */
  pullLines(saleIds: string[]): Promise<{ lines: Row[]; costs: Row[] }>
  /** Insert or update rows. `ignoreDuplicates` makes a retry harmless for records that never change. */
  upsert(table: SyncTable, rows: Row[], onConflict: string, ignoreDuplicates: boolean): Promise<void>
  pushSale(sale: Row, lines: Row[]): Promise<void>
  voidSale(id: string, at: string): Promise<void>
  softDelete(table: 'products' | 'payments' | 'expenses', id: string): Promise<void>

  savePush(shopId: string | null, sub: PushSub): Promise<void>
  removePush(endpoint: string): Promise<void>
  supportMessages(shopId: string): Promise<SupportMsg[]>
  sendSupport(shopId: string, sender: string, body: string): Promise<void>
  adminSupport(): Promise<SupportMsg[]>
  adminReply(shopId: string, body: string): Promise<void>

  adminShops(): Promise<AdminShop[]>
  adminResetOwner(shopId: string, pin: string): Promise<{ phone: string }>
  adminSetShop(id: string, status: string, plan: string, paidUntil: string | null, note: string, message: string): Promise<void>
}

export const PHONE_EMAIL = (phone: string): string => `${phone}@tallify.app`
/** Supabase wants a password of at least 6 characters, so the 6-digit PIN gets a short prefix. */
export const PIN_PASSWORD = (pin: string): string => `hs-${pin}`
