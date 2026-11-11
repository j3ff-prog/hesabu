import type { Role } from './db'

/** Everything a person can be allowed to do. Roles below decide who gets which. */
export type Perm =
  | 'sell' // record a sale
  | 'voidSale' // cancel a sale
  | 'viewStock' // see the stock list
  | 'editStock' // add, change, remove products
  | 'seeCost' // see buying prices and profit
  | 'credit' // see who owes, record payments
  | 'expenses' // see expenses
  | 'addExpense' // add or remove an expense
  | 'today' // the day's summary and close-the-day
  | 'dashboard' // charts over time
  | 'export' // download sales, stock and other data as CSV
  | 'importStock' // bulk upload products
  | 'settings' // shop name, backup and restore
  | 'team' // add and manage staff

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Manager',
  attendant: 'Attendant'
}

export const ROLE_HINT: Record<Role, string> = {
  owner: 'Everything, including staff and settings.',
  manager: 'Everything except staff and settings.',
  attendant: 'Sells, looks at stock, takes credit payments. Cannot see buying prices, profit or expenses.'
}

export const MATRIX: Record<Role, Perm[]> = {
  owner: ['sell', 'voidSale', 'viewStock', 'editStock', 'seeCost', 'credit', 'expenses', 'addExpense', 'today', 'dashboard', 'export', 'importStock', 'settings', 'team'],
  manager: ['sell', 'voidSale', 'viewStock', 'editStock', 'seeCost', 'credit', 'expenses', 'addExpense', 'today', 'dashboard', 'export', 'importStock'],
  attendant: ['sell', 'viewStock', 'credit']
}

/** Rows for the "what can each role do" table on the Team screen. */
export const RIGHTS_TABLE: { label: string; perm: Perm }[] = [
  { label: 'Record sales', perm: 'sell' },
  { label: 'See stock', perm: 'viewStock' },
  { label: 'Take credit payments', perm: 'credit' },
  { label: 'Cancel a sale', perm: 'voidSale' },
  { label: 'Add or change products', perm: 'editStock' },
  { label: 'See buying prices and profit', perm: 'seeCost' },
  { label: 'Expenses', perm: 'expenses' },
  { label: 'Day summary and closing', perm: 'today' },
  { label: 'Dashboard charts', perm: 'dashboard' },
  { label: 'Download data, upload stock', perm: 'export' },
  { label: 'Shop settings and backup', perm: 'settings' },
  { label: 'Add and manage staff', perm: 'team' }
]

/** Things that change data. They switch off when a subscription has ended (view and download only). */
export const WRITES: ReadonlySet<Perm> = new Set<Perm>(['sell', 'voidSale', 'editStock', 'addExpense', 'importStock'])

export const roleCan = (role: Role, perm: Perm): boolean => MATRIX[role].includes(perm)

/** What one person can do: their own list if the owner set one, otherwise the usual rights for their role. */
export const memberCan = (role: Role, perms: Perm[] | null | undefined, perm: Perm): boolean =>
  role === 'owner' ? true : perms ? perms.includes(perm) : roleCan(role, perm)

/** The rights an owner can hand out, in plain words. Settings and managing the team always stay with the owner. */
export const GRANTS: { label: string; hint: string; perms: Perm[] }[] = [
  { label: 'Record sales', hint: 'Make new sales', perms: ['sell'] },
  { label: 'Cancel a sale', hint: 'Undo a sale that was recorded', perms: ['voidSale'] },
  { label: 'See stock', hint: 'Look at the items and how many are left', perms: ['viewStock'] },
  { label: 'Add or change items', hint: 'Add, edit and remove items', perms: ['editStock'] },
  { label: 'Take credit payments', hint: 'See who owes you and record what they pay', perms: ['credit'] },
  { label: 'See buying prices and profit', hint: 'What you paid for items, and what you earned', perms: ['seeCost'] },
  { label: 'Expenses and bills', hint: 'See and add expenses, pay bills', perms: ['expenses', 'addExpense'] },
  { label: 'Reports and closing the day', hint: 'The day’s report and the cash count', perms: ['today'] },
  { label: 'Overview charts', hint: 'Sales and profit over time', perms: ['dashboard'] },
  { label: 'Download and upload data', hint: 'Spreadsheets in and out', perms: ['export', 'importStock'] }
]

/** The rights that can be handed to a manager or attendant. */
export const DELEGABLE: Perm[] = GRANTS.flatMap((g) => g.perms)
