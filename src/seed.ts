import { db, type Product } from './db'

export type StarterKind = 'grocery' | 'hardware' | 'beauty' | 'none'

// name, selling price, buying price, example stock, warn at
type Row = [string, number, number, number, number]

// Sample prices only. The owner edits these to match their shop.
const LISTS: Record<Exclude<StarterKind, 'none'>, Row[]> = {
  grocery: [
    ['Maize flour 2kg', 150, 138, 24, 6],
    ['Wheat flour 2kg', 185, 170, 12, 4],
    ['Sugar 1kg', 200, 184, 20, 6],
    ['Rice 1kg', 170, 155, 15, 5],
    ['Cooking oil 1L', 320, 295, 10, 4],
    ['Salt 500g', 40, 34, 18, 5],
    ['Bread 400g', 65, 58, 12, 4],
    ['Milk 500ml', 60, 54, 20, 6],
    ['Bar soap', 80, 68, 16, 5],
    ['Tea leaves 100g', 60, 52, 14, 5]
  ],
  hardware: [
    ['Nails 3 inch (kg)', 250, 215, 20, 5],
    ['Cement 50kg', 750, 700, 15, 5],
    ['Paint brush 2 inch', 150, 120, 12, 4],
    ['Padlock', 250, 190, 10, 3],
    ['Door hinges (pair)', 120, 90, 14, 4],
    ['Wood screws (box)', 200, 150, 10, 3],
    ['Sandpaper sheet', 40, 28, 30, 8],
    ['Masking tape', 100, 75, 12, 4],
    ['Light bulb', 100, 70, 20, 6],
    ['Electric cable (metre)', 60, 48, 50, 10]
  ],
  beauty: [
    ['Body lotion 400ml', 350, 290, 10, 3],
    ['Petroleum jelly 250g', 230, 190, 12, 4],
    ['Bar soap', 90, 72, 20, 6],
    ['Shampoo 400ml', 420, 350, 8, 3],
    ['Toothpaste', 120, 95, 15, 5],
    ['Hair oil 250ml', 250, 190, 10, 3],
    ['Nail polish', 150, 100, 18, 5],
    ['Deodorant', 250, 200, 10, 3],
    ['Body spray', 350, 270, 8, 3],
    ['Face powder', 400, 300, 6, 2]
  ]
}

export async function seedStarter(kind: StarterKind): Promise<void> {
  if (kind === 'none') return
  const now = Date.now()
  const rows = LISTS[kind].map(
    ([name, price, cost, stock, lowAt], i): Omit<Product, 'id'> => ({
      name,
      price,
      cost,
      stock,
      lowAt,
      createdAt: now + i
    })
  )
  await db.products.bulkAdd(rows as Product[])
}
