const nf = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 })

export const money = (n: number): string => nf.format(Math.round(n))

export const timeOf = (ts: number): string =>
  new Date(ts).toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' })

export const dateLabel = (ts = Date.now()): string =>
  new Date(ts).toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' })

export const startOfDay = (ts = Date.now()): number => {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Turn what someone typed into a number. Empty or invalid becomes 0. */
export const toNum = (s: string): number => {
  const n = Number(s.replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export const methodLabel = { cash: 'Cash', mpesa: 'M-Pesa', credit: 'On credit' } as const

export const shortDate = (ts: number): string =>
  new Date(ts).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })

export const daysSince = (ts: number): number => Math.floor((startOfDay() - startOfDay(ts)) / 86400000)

/** Turn a Kenyan number (0712 345 678, +254712345678, 712345678) into 254712345678, or null if it doesn't look right. */
export const toWaNumber = (input: string): string | null => {
  const d = input.replace(/\D/g, '')
  if (/^0[17]\d{8}$/.test(d)) return '254' + d.slice(1)
  if (/^254[17]\d{8}$/.test(d)) return d
  if (/^[17]\d{8}$/.test(d)) return '254' + d
  return null
}

export const showPhone = (wa: string): string => '0' + wa.slice(3)

export const addDays = (ts: number, n: number): number => {
  const d = new Date(ts)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

const pad = (n: number) => String(n).padStart(2, '0')
export const isoDate = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const isoTime = (ts: number): string => {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Short numbers for chart axes: 1.2k, 3.4M. */
export const compact = (n: number): string => {
  const a = Math.abs(n)
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k'
  return String(Math.round(n))
}

/** Where customers go for help. */
export const SUPPORT_EMAIL = 'nexus.softwareske@gmail.com'
export const supportLink = (subject = 'Tallify help'): string => `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`

/** Where shops pay their KES 500 a month. */
export const PAY_URL = 'https://paystack.shop/pay/tallify'
export const PRICE = 500
