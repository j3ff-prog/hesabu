import type { ProductRow } from './db'

/** Spreadsheets run text that starts with = + - @ as a formula. Put a quote in front so it stays text. */
const safe = (v: string): string => (/^[=+\-@\t\r]/.test(v) ? "'" + v : v)

const cell = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'number' ? String(v) : safe(v)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** Rows to CSV text. The leading mark lets Excel read it as UTF-8. */
export const toCsv = (rows: (string | number | null | undefined)[][]): string =>
  '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'

export function downloadFile(name: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Read CSV text. Handles quotes, commas inside quotes, line breaks inside quotes, and ; or tab as the separator. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const count = (c: string) => firstLine.split(c).length - 1
  const delim = count('\t') > count(',') && count('\t') >= count(';') ? '\t' : count(';') > count(',') ? ';' : ','

  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += c
    } else if (c === '"') quoted = true
    else if (c === delim) {
      row.push(cur)
      cur = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cur)
      cur = ''
      rows.push(row)
      row = []
    } else cur += c
  }
  if (cur !== '' || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '')
const SYN: Record<'name' | 'price' | 'cost' | 'stock' | 'low' | 'type', string[]> = {
  type: ['type', 'kind', 'itemtype', 'goodsorservice'],
  name: ['name', 'product', 'productname', 'item', 'itemname', 'description'],
  price: ['price', 'sellingprice', 'sellprice', 'selling', 'sp', 'retailprice'],
  cost: ['cost', 'buyingprice', 'buyprice', 'buying', 'bp', 'costprice'],
  stock: ['stock', 'qty', 'quantity', 'instock', 'openingstock', 'onhand'],
  low: ['warn', 'warnat', 'low', 'lowstock', 'reorder', 'reorderlevel', 'min', 'minimum']
}

/** "KES 1,200.50" becomes 1200.5. Anything that is not a number becomes NaN. */
export function parseAmount(s: string): number {
  const t = s.trim()
  if (t === '') return NaN
  const n = Number(t.replace(/(kes|ksh|kshs)/gi, '').replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : NaN
}

export interface ImportPreview {
  rows: ProductRow[]
  errors: { line: number; text: string }[]
  duplicates: number
  missingColumns: string[]
}

/** Turn a parsed CSV into products, with a plain-English list of what was wrong. */
export function readProducts(table: string[][]): ImportPreview {
  const out: ImportPreview = { rows: [], errors: [], duplicates: 0, missingColumns: [] }
  if (table.length === 0) {
    out.missingColumns = ['name', 'price']
    return out
  }
  const head = table[0].map(norm)
  const at = (k: keyof typeof SYN) => head.findIndex((h) => SYN[k].includes(h))
  const col = { name: at('name'), price: at('price'), cost: at('cost'), stock: at('stock'), low: at('low'), type: at('type') }
  if (col.name < 0) out.missingColumns.push('Name')
  if (col.price < 0) out.missingColumns.push('Price')
  if (out.missingColumns.length) return out

  const seen = new Map<string, number>()
  for (let i = 1; i < table.length && i <= 5001; i++) {
    const r = table[i]
    const line = i + 1
    const name = (r[col.name] ?? '').trim().replace(/\s+/g, ' ')
    if (!name) {
      out.errors.push({ line, text: 'No name' })
      continue
    }
    const price = parseAmount(r[col.price] ?? '')
    if (!(price > 0)) {
      out.errors.push({ line, text: `${name}: price must be a number above 0` })
      continue
    }
    const num = (c: number, label: string): number | null | 'bad' => {
      if (c < 0) return null
      const raw = (r[c] ?? '').trim()
      if (raw === '') return null
      const n = parseAmount(raw)
      if (Number.isNaN(n) || n < 0) {
        out.errors.push({ line, text: `${name}: ${label} “${raw}” is not valid` })
        return 'bad'
      }
      return n
    }
    const typeRaw = col.type >= 0 ? (r[col.type] ?? '').trim().toLowerCase() : ''
    const service = /serv|food|made|meal|cook|prepared/.test(typeRaw)
    const cost = num(col.cost, 'buying price')
    const stock = num(col.stock, 'stock')
    const low = num(col.low, 'warn level')
    if (cost === 'bad' || stock === 'bad' || low === 'bad') continue

    const key = name.toLowerCase()
    if (seen.has(key)) {
      out.duplicates++
      out.rows[seen.get(key)!] = undefined as never // later row wins; cleaned below
    }
    seen.set(key, out.rows.length)
    out.rows.push({
      name,
      price,
      cost: service ? 0 : cost ?? 0,
      stock: service ? 0 : Math.round(stock ?? 0),
      lowAt: service ? 0 : Math.round(low ?? 5),
      hasCost: service || cost !== null,
      hasStock: service || stock !== null,
      hasLow: service || low !== null,
      service
    })
  }
  out.rows = out.rows.filter(Boolean)
  return out
}

export const TEMPLATE = toCsv([
  ['Name', 'Type', 'Selling price', 'Buying price', 'In stock', 'Warn at'],
  ['Sugar 1kg', 'Goods', 180, 160, 24, 5],
  ['Cooking oil 1L', 'Goods', 320, 290, 12, 4],
  ['Porridge cup', 'Service', 30, '', '', '']
])
