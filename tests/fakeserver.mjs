// A small stand-in for the Supabase side, used only by tests. Mirrors the rules of the real database.
import http from 'node:http'
import { randomUUID } from 'node:crypto'

const users = new Map() // phone -> {id, pin}
const byId = new Map()
const shops = new Map()
const members = [] // {shop_id,user_id,role,name,phone,active}
const T = { products: new Map(), product_costs: new Map(), sales: new Map(), sale_lines: new Map(), sale_line_costs: new Map(), customers: new Map(), payments: new Map(), expenses: new Map(), closings: new Map() }
let tick = 0
const stamp = () => new Date(Date.UTC(2026, 0, 1) + ++tick).toISOString()
const err = (code, message) => { const e = new Error(message); e.code = code; throw e }
const roleOf = (shop, uid) => members.find((m) => m.shop_id === shop && m.user_id === uid && m.active)?.role
const money = (r) => r === 'owner' || r === 'manager'
const writable = (shop) => shops.get(shop)?.status !== 'suspended'
const keyOf = { products: (r) => r.id, product_costs: (r) => r.product_id, sales: (r) => r.id, customers: (r) => r.shop_id + '|' + r.key, payments: (r) => r.id, expenses: (r) => r.id, closings: (r) => r.shop_id + '|' + r.day }

function need(uid, shop, perm) {
  const r = roleOf(shop, uid)
  if (!r) err('denied', 'Not allowed')
  if (perm === 'money' && !money(r)) err('denied', 'Not allowed')
  if (perm !== 'read' && !writable(shop)) err('denied', 'Not allowed')
  return r
}
const stock = (id, shop, d) => { const p = T.products.get(id); if (p && p.shop_id === shop) { p.stock = Number(p.stock) + d; p.updated_at = stamp() } }

const rpc = {
  getSession: (u, uid) => (uid ? { userId: uid, phone: byId.get(uid).phone } : null),
  signUp: (u, uid, phone, pin) => {
    if (users.has(phone)) err('exists', 'exists')
    const id = randomUUID(); users.set(phone, { id, pin, phone }); byId.set(id, { id, pin, phone })
    return { userId: id, phone }
  },
  signIn: (u, uid, phone, pin) => {
    const x = users.get(phone)
    if (!x || x.pin !== pin) err('wrong', 'Wrong phone number or PIN')
    return { userId: x.id, phone }
  },
  signOut: () => null,
  changePin: (u, uid, cur, next) => { if (u.pin !== cur) err('wrong', 'Your current PIN is not right'); u.pin = next; return null },
  myShops: (u, uid) => members.filter((m) => m.user_id === uid && m.active).map((m) => ({ id: m.shop_id, name: shops.get(m.shop_id).name, role: m.role, memberName: m.name, ownerPhone: shops.get(m.shop_id).owner_phone })),
  createShop: (u, uid, name, ownerName, phone) => {
    const id = randomUUID(); shops.set(id, { id, name, owner_phone: phone, status: 'trial' })
    members.push({ shop_id: id, user_id: uid, role: 'owner', name: ownerName, phone: u.phone, active: true })
    return id
  },
  updateShop: (u, uid, id, name, phone) => { if (roleOf(id, uid) !== 'owner') err('denied', 'Not allowed'); Object.assign(shops.get(id), { name, owner_phone: phone }); return null },
  shopState: (u, uid, id) => { if (!roleOf(id, uid)) return null; const s = shops.get(id); return { writable: s.status !== 'suspended', status: s.status, until: null, message: '' } },
  members: (u, uid, id) => { need(uid, id, 'read'); return members.filter((m) => m.shop_id === id).map((m) => ({ userId: m.user_id, name: m.name, phone: m.phone, role: m.role, active: m.active })) },
  addStaff: (u, uid, shop, name, phone, role, pin) => {
    if (roleOf(shop, uid) !== 'owner') err('denied', 'Only the owner can do this')
    let x = users.get(phone), existing = !!x
    if (!x) { const id = randomUUID(); x = { id, pin, phone }; users.set(phone, x); byId.set(id, x) }
    members.push({ shop_id: shop, user_id: x.id, role, name, phone, active: true })
    return { existing }
  },
  resetPin: (u, uid, shop, phone, pin) => { if (roleOf(shop, uid) !== 'owner') err('denied', 'Only the owner can do this'); users.get(phone).pin = pin; return null },
  setMember: (u, uid, shop, user, role, active) => { if (roleOf(shop, uid) !== 'owner') err('denied', 'Not allowed'); Object.assign(members.find((m) => m.shop_id === shop && m.user_id === user), { role, active }); return null },
  pull: (u, uid, shop, table, since) => {
    const r = need(uid, shop, 'read')
    if (['product_costs', 'expenses', 'closings'].includes(table) && !money(r)) return []
    return [...T[table].values()].filter((x) => x.shop_id === shop && (!since || x.updated_at >= since)).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)).slice(0, 500)
  },
  pullLines: (u, uid, ids) => {
    const lines = [...T.sale_lines.values()].filter((l) => ids.includes(l.sale_id) && roleOf(l.shop_id, uid))
    const costs = lines.filter((l) => money(roleOf(l.shop_id, uid))).map((l) => T.sale_line_costs.get(l.id)).filter(Boolean)
    return { lines, costs }
  },
  upsert: (u, uid, table, rows, onConflict, ignore) => {
    for (const r of rows) {
      const shop = r.shop_id
      if (table === 'products' || table === 'product_costs' || table === 'closings') need(uid, shop, 'money')
      else need(uid, shop, 'write')
      if (['sales', 'payments', 'expenses'].includes(table) && r.by_user !== uid) err('denied', 'Not allowed')
      const k = keyOf[table](r)
      const cur = T[table].get(k)
      if (cur && ignore) continue
      const row = { ...(cur ?? {}), ...r, updated_at: stamp() }
      T[table].set(k, row)
      if (table === 'expenses' && !cur && r.category === 'New stock') for (const i of r.items ?? []) { stock(i.productId, shop, Number(i.qty)); if (i.cost > 0) T.product_costs.set(i.productId, { product_id: i.productId, shop_id: shop, cost: i.cost, updated_at: stamp() }) }
    }
    return null
  },
  pushSale: (u, uid, sale, lines) => {
    need(uid, sale.shop_id, 'write')
    if (sale.by_user !== uid) err('denied', 'Not allowed')
    if (T.sales.has(sale.id)) return null
    T.sales.set(sale.id, { ...sale, voided_at: null, updated_at: stamp() })
    for (const l of lines) {
      if (T.sale_lines.has(l.id)) continue
      T.sale_lines.set(l.id, { ...l, sale_id: sale.id, shop_id: sale.shop_id, updated_at: stamp() })
      if (!l.service && l.product_id) {
        stock(l.product_id, sale.shop_id, -Number(l.qty))
        T.sale_line_costs.set(l.id, { line_id: l.id, shop_id: sale.shop_id, cost: T.product_costs.get(l.product_id)?.cost ?? 0, updated_at: stamp() })
      }
    }
    return null
  },
  voidSale: (u, uid, id, at) => {
    const s = T.sales.get(id); need(uid, s.shop_id, 'money')
    if (!s.voided_at) { s.voided_at = at; s.updated_at = stamp(); for (const l of T.sale_lines.values()) if (l.sale_id === id && !l.service) stock(l.product_id, s.shop_id, Number(l.qty)) }
    return null
  },
  softDelete: (u, uid, table, id) => {
    const r = T[table].get(id); if (!r) return null
    need(uid, r.shop_id, table === 'payments' ? 'write' : 'money')
    if (!r.deleted_at) { r.deleted_at = new Date().toISOString(); r.updated_at = stamp(); if (table === 'expenses' && r.category === 'New stock') for (const i of r.items ?? []) stock(i.productId, r.shop_id, -Number(i.qty)) }
    return null
  },
  adminShops: () => err('denied', 'not allowed'),
  adminSetShop: () => err('denied', 'not allowed')
}

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
let down = false
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end()
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    if (req.url === '/admin') { const j = JSON.parse(body); if (j.suspend) { shops.get(j.suspend).status = 'suspended' } if (j.dump) return res.writeHead(200, cors).end(JSON.stringify({ products: [...T.products.values()], sales: [...T.sales.values()], shops: [...shops.values()] })); return res.writeHead(200, cors).end('{}') }
    const { method, args, token } = JSON.parse(body)
    try {
      const uid = byId.has(token) ? token : null
      const u = uid ? byId.get(uid) : null
      if (!['signUp', 'signIn', 'getSession', 'signOut'].includes(method) && !uid) err('denied', 'Not signed in')
      const out = rpc[method](u, uid, ...args)
      res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ ok: out ?? null }))
    } catch (e) {
      res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: e.code ?? 'unknown', message: e.message } }))
    }
  })
}).listen(8799, () => console.log('fake cloud on 8799'))
