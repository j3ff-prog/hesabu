import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, isService, removeProduct, saveProduct, type Product } from './db'
import { money, toNum } from './format'
import { Sheet } from './Sheet'
import { PlusIcon, SearchIcon } from './Icons'
import { dismissSeedNote, seedNoteDismissed } from './shop'
import { useAuth } from './Auth'

export function Stock() {
  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), [])
  const location = useLocation()
  const [filter, setFilter] = useState<'all' | 'goods' | 'service' | 'low'>(
    (location.state as { filter?: 'low' } | null)?.filter === 'low' ? 'low' : 'all'
  )
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [noteGone, setNoteGone] = useState(seedNoteDismissed)
  const { can } = useAuth()
  const edit = can('editStock')

  if (!products) return <main className="page" />

  const isLow = (p: Product) => !isService(p) && p.stock <= p.lowAt
  const goodsCount = products.filter((p) => !isService(p)).length
  const serviceCount = products.length - goodsCount
  const lowCount = products.filter(isLow).length
  const needle = q.trim().toLowerCase()
  const shown = products
    .filter((p) => (filter === 'low' ? isLow(p) : filter === 'goods' ? !isService(p) : filter === 'service' ? isService(p) : true))
    .filter((p) => (needle ? p.name.toLowerCase().includes(needle) : true))

  return (
    <main className="page has-fab">
      <h1>Items</h1>

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
            {goodsCount > 0 && serviceCount > 0 && (
              <>
                <button role="radio" aria-checked={filter === 'goods'} className={filter === 'goods' ? 'on' : ''} onClick={() => setFilter('goods')}>
                  Goods ({goodsCount})
                </button>
                <button role="radio" aria-checked={filter === 'service'} className={filter === 'service' ? 'on' : ''} onClick={() => setFilter('service')}>
                  Food &amp; services ({serviceCount})
                </button>
              </>
            )}
            {goodsCount > 0 && (
              <button role="radio" aria-checked={filter === 'low'} className={filter === 'low' ? 'on' : ''} onClick={() => setFilter('low')}>
                Running low ({lowCount})
              </button>
            )}
          </div>
        </>
      )}

      {products.length === 0 && (
        <div className="empty">
          <p className="empty-title">Nothing here yet</p>
          <p>{edit ? 'Add your first item. You only need a name and a price. Goods you stock can also have a count.' : 'The owner has not added any items yet.'}</p>
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
              {isService(p) ? (
                <span className="row-stock">
                  <span className="row-tag plain">Food or service</span>
                </span>
              ) : (
                <span className={'row-stock' + (p.stock <= 0 ? ' out' : isLow(p) ? ' low' : '')}>
                  <span className="row-num">{p.stock}</span>
                  {isLow(p) && <span className="row-tag">{p.stock <= 0 ? 'Out of stock' : 'Running low'}</span>}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {edit && (
        <button className="fab" onClick={() => setEditing('new')}>
          <PlusIcon /> Add item
        </button>
      )}

      {editing && edit && <ProductSheet product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </main>
  )
}

function ProductSheet({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const [service, setService] = useState(product ? isService(product) : false)
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
        kind: service ? 'service' : 'goods',
        // Food and services have no buying price and no count.
        cost: service ? 0 : toNum(cost),
        stock: service ? 0 : Math.round(toNum(stock)),
        lowAt: service ? 0 : Math.max(0, Math.round(toNum(lowAt)))
      },
      product?.id
    )
    onClose()
  }

  return (
    <Sheet title={product ? 'Edit item' : 'Add item'} onClose={onClose}>
      <fieldset className="field">
        <legend>What is it?</legend>
        <div className="segment" role="radiogroup">
          <button role="radio" aria-checked={!service} className={!service ? 'on' : ''} onClick={() => setService(false)}>Goods I stock</button>
          <button role="radio" aria-checked={service} className={service ? 'on' : ''} onClick={() => setService(true)}>Food or service</button>
        </div>
        <p className="hint spaced">
          {service
            ? 'Cooked food, drinks you make, haircuts and the like. No count to keep. Record what you spend on ingredients under Expenses.'
            : 'Things you buy and resell. Tallyfy counts them and warns you when they run low.'}
        </p>
      </fieldset>
      <label className="field">
        <span>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={service ? 'e.g. Porridge cup' : 'e.g. Sugar 1kg'} autoComplete="off" />
      </label>
      <label className="field">
        <span>Selling price (KES)</span>
        <input type="text" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
      </label>
      {!service && (
        <>
          <label className="field">
            <span>Buying price (KES)</span>
            <input type="text" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Optional" />
          </label>
          <p className="hint">The buying price lets Tallyfy work out your profit. Without it, this item is left out of profit.</p>
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
        </>
      )}

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
