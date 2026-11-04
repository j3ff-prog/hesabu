import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, removeProduct, saveProduct, type Product } from './db'
import { money, toNum } from './format'
import { Sheet } from './Sheet'
import { PlusIcon, SearchIcon } from './Icons'
import { dismissSeedNote, seedNoteDismissed } from './shop'
import { useAuth } from './Auth'

export function Stock() {
  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), [])
  const location = useLocation()
  const [filter, setFilter] = useState<'all' | 'low'>(
    (location.state as { filter?: 'low' } | null)?.filter === 'low' ? 'low' : 'all'
  )
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [noteGone, setNoteGone] = useState(seedNoteDismissed)
  const { can } = useAuth()
  const edit = can('editStock')

  if (!products) return <main className="page" />

  const isLow = (p: Product) => p.stock <= p.lowAt
  const lowCount = products.filter(isLow).length
  const needle = q.trim().toLowerCase()
  const shown = products
    .filter((p) => (filter === 'low' ? isLow(p) : true))
    .filter((p) => (needle ? p.name.toLowerCase().includes(needle) : true))

  return (
    <main className="page has-fab">
      <h1>Stock</h1>

      {edit && products.length > 0 && !noteGone && (
        <div className="note">
          <p>If you started with a sample list, the prices and counts are examples. Tap a product to set your real ones.</p>
          <button
            className="link"
            onClick={() => {
              dismissSeedNote()
              setNoteGone(true)
            }}
          >
            Got it
          </button>
        </div>
      )}

      {products.length > 0 && (
        <>
          <label className="search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search products"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search products"
            />
          </label>
          <div className="segment small" role="radiogroup" aria-label="Filter">
            <button role="radio" aria-checked={filter === 'all'} className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
              All ({products.length})
            </button>
            <button role="radio" aria-checked={filter === 'low'} className={filter === 'low' ? 'on' : ''} onClick={() => setFilter('low')}>
              Running low ({lowCount})
            </button>
          </div>
        </>
      )}

      {products.length === 0 && (
        <div className="empty">
          <p className="empty-title">Your shelf is empty</p>
          <p>{edit ? 'Add your first product. You only need a name, a price and how many you have.' : 'The owner has not added any products yet.'}</p>
        </div>
      )}

      {products.length > 0 && shown.length === 0 && (
        <p className="muted pad">{filter === 'low' ? 'Nothing is running low.' : `Nothing matches “${q}”.`}</p>
      )}

      <ul className="rows">
        {shown.map((p) => (
          <li key={p.id}>
            <button className="row" onClick={() => edit && setEditing(p)} disabled={!edit}>
              <span className="row-main">
                <span className="row-name">{p.name}</span>
                <span className="muted">KES {money(p.price)}</span>
              </span>
              <span className={'row-stock' + (p.stock <= 0 ? ' out' : isLow(p) ? ' low' : '')}>
                <span className="row-num">{p.stock}</span>
                {isLow(p) && <span className="row-tag">{p.stock <= 0 ? 'Out of stock' : 'Running low'}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {edit && (
        <button className="fab" onClick={() => setEditing('new')}>
          <PlusIcon /> Add product
        </button>
      )}

      {editing && edit && <ProductSheet product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </main>
  )
}

function ProductSheet({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const [name, setName] = useState(product?.name ?? '')
  const [price, setPrice] = useState(product ? String(product.price) : '')
  const [cost, setCost] = useState(product && product.cost ? String(product.cost) : '')
  const [stock, setStock] = useState(product ? String(product.stock) : '')
  const [lowAt, setLowAt] = useState(product ? String(product.lowAt) : '5')
  const [confirmRemove, setConfirmRemove] = useState(false)

  const valid = name.trim().length > 0 && toNum(price) > 0

  const save = async () => {
    if (!valid) return
    await saveProduct(
      {
        name: name.trim(),
        price: toNum(price),
        cost: toNum(cost),
        stock: Math.round(toNum(stock)),
        lowAt: Math.max(0, Math.round(toNum(lowAt)))
      },
      product?.id
    )
    onClose()
  }

  return (
    <Sheet title={product ? 'Edit product' : 'Add product'} onClose={onClose}>
      <label className="field">
        <span>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sugar 1kg" autoComplete="off" />
      </label>
      <div className="two">
        <label className="field">
          <span>Selling price (KES)</span>
          <input type="text" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
        </label>
        <label className="field">
          <span>Buying price (KES)</span>
          <input type="text" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Optional" />
        </label>
      </div>
      <p className="hint">The buying price lets Hesabu estimate your profit. You can leave it empty.</p>
      <div className="two">
        <label className="field">
          <span>In stock now</span>
          <input type="text" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="0" />
        </label>
        <label className="field">
          <span>Warn me at</span>
          <input type="text" inputMode="numeric" value={lowAt} onChange={(e) => setLowAt(e.target.value)} placeholder="5" />
        </label>
      </div>
      <p className="hint">You’ll see “Running low” when stock reaches the number in “Warn me at”.</p>

      <button className="btn primary block" disabled={!valid} onClick={save}>
        Save product
      </button>

      {product && (
        <button
          className={'btn text-danger block' + (confirmRemove ? ' armed' : '')}
          onClick={async () => {
            if (!confirmRemove) return setConfirmRemove(true)
            await removeProduct(product.id)
            onClose()
          }}
        >
          {confirmRemove ? 'Tap again to remove for good' : 'Remove product'}
        </button>
      )}
    </Sheet>
  )
}
