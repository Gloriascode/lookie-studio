import { useEffect, useState } from 'react'
import { ZoomableImage, productImages } from './Lightbox'
import { api } from '../api'
import { appStore, useApp } from '../state/appStore'
import { SLOT_BY_ID } from '../slots'
import { clearSelection, selectSlot } from './focus'
import { formatPrice } from './format'
import { Link } from './router'

const bagKey = (slug) => `lookie:bag:${slug}`

function loadBag(slug) {
  try {
    const raw = JSON.parse(localStorage.getItem(bagKey(slug)) ?? '[]')
    return Array.isArray(raw) ? raw.filter((l) => l?.productId && l.quantity > 0) : []
  } catch {
    return []
  }
}

function saveBag(slug, cart) {
  try {
    localStorage.setItem(bagKey(slug), JSON.stringify(cart))
  } catch {
    /* private mode etc. — the bag still works for this visit */
  }
}

function setCart(slug, cart) {
  appStore.set({ cart })
  saveBag(slug, cart)
}

function QtyStepper({ value, onChange, label }) {
  return (
    <div className="qty" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(1, value - 1))} aria-label="Decrease quantity" disabled={value <= 1}>
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(20, value + 1))} aria-label="Increase quantity">
        +
      </button>
    </div>
  )
}

function ProductCard({ product, slug, onAdded }) {
  const [qty, setQty] = useState(1)
  const slot = SLOT_BY_ID[product.slot]
  function add() {
    const cart = appStore.get().cart
    const existing = cart.find((l) => l.productId === product.id)
    const next = existing
      ? cart.map((l) => (l.productId === product.id ? { ...l, quantity: l.quantity + qty } : l))
      : [...cart, { productId: product.id, quantity: qty }]
    setCart(slug, next)
    onAdded(product)
    setQty(1)
  }
  return (
    <aside className="panel product-card" aria-label={product.title} onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
      <button type="button" className="panel__close" aria-label="Close" onClick={clearSelection}>
        ×
      </button>
      <div className="panel__scroll">
        <div className="product-card__media">
          <ZoomableImage images={productImages(product)} className="product-card__zoom">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt={`${product.title}`} />
            ) : (
              <img src={product.pattern?.imageUrl} alt="" className="product-card__swatch" />
            )}
          </ZoomableImage>
          {product.pattern?.thumbUrl && product.imageUrl && (
            <ZoomableImage images={productImages(product)} index={1} className="product-card__chip" label="View the print">
              <img src={product.pattern.thumbUrl} alt="Pattern swatch" />
            </ZoomableImage>
          )}
        </div>
        <div className="product-card__body">
          <span className="eyebrow">{slot?.label}</span>
          <h2>{product.title}</h2>
          {product.selectionLabel && <p className="muted">{product.selectionLabel}</p>}
          <p className="price price--lg">{formatPrice(product.unitPrice)}</p>
          <div className="product-card__buy">
            <QtyStepper value={qty} onChange={setQty} label="Quantity" />
            <button type="button" className="btn btn--primary btn--grow" onClick={add}>
              Add to bag · {formatPrice(product.unitPrice, qty)}
            </button>
          </div>
          <p className="fine">Made to order by Arcade and shipped to you.</p>
        </div>
      </div>
    </aside>
  )
}

function Bag({ slug, products, open, onClose }) {
  const cart = useApp((s) => s.cart)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const byId = Object.fromEntries(products.map((p) => [p.id, p]))
  const lines = cart.filter((l) => byId[l.productId])
  const currency = lines[0] && byId[lines[0].productId].unitPrice?.currency
  const subtotal = lines.reduce((sum, l) => sum + Number(byId[l.productId].unitPrice?.amount ?? 0) * l.quantity, 0)

  const update = (productId, quantity) =>
    setCart(slug, quantity > 0 ? cart.map((l) => (l.productId === productId ? { ...l, quantity } : l)) : cart.filter((l) => l.productId !== productId))

  async function checkout() {
    setBusy(true)
    setError(null)
    try {
      const { checkoutUrl } = await api.checkout(slug, lines)
      window.location.assign(checkoutUrl)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className={`drawer${open ? ' drawer--open' : ''}`} aria-hidden={!open} inert={!open}>
      <button type="button" className="drawer__scrim" aria-label="Close bag" tabIndex={-1} onClick={onClose} />
      <aside className="drawer__sheet" role="dialog" aria-modal="true" aria-label="Your bag" onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
        <header className="drawer__head">
          <h2>Your bag</h2>
          <button type="button" className="panel__close panel__close--static" aria-label="Close bag" onClick={onClose}>
            ×
          </button>
        </header>
        {lines.length === 0 ? (
          <p className="empty">Your bag is empty. Click something in the room you like.</p>
        ) : (
          <ul className="bag-lines">
            {lines.map((l) => {
              const p = byId[l.productId]
              return (
                <li key={l.productId} className="bag-line">
                  <img src={p.imageUrl || p.pattern?.thumbUrl} alt="" />
                  <div className="bag-line__text">
                    <strong>{p.title}</strong>
                    {p.selectionLabel && <small>{p.selectionLabel}</small>}
                    <div className="bag-line__row">
                      <QtyStepper value={l.quantity} onChange={(q) => update(l.productId, q)} label={`Quantity of ${p.title}`} />
                      <span className="price">{formatPrice(p.unitPrice, l.quantity)}</span>
                    </div>
                    <button type="button" className="link-btn link-btn--danger" onClick={() => update(l.productId, 0)}>
                      Remove
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {lines.length > 0 && (
          <footer className="drawer__foot">
            <div className="subtotal">
              <span>Subtotal</span>
              <strong>{formatPrice({ amount: subtotal, currency })}</strong>
            </div>
            <p className="fine">Shipping and taxes are calculated at checkout.</p>
            <p className="form__error" role="alert">
              {error}
            </p>
            <button type="button" className="btn btn--primary btn--block" disabled={busy} onClick={checkout}>
              {busy ? 'Opening checkout…' : 'Checkout'}
            </button>
          </footer>
        )}
      </aside>
    </div>
  )
}

export function ShopView({ slug }) {
  const shop = useApp((s) => s.shop)
  const products = useApp((s) => s.products)
  const cart = useApp((s) => s.cart)
  const selectedSlot = useApp((s) => s.selectedSlot)
  const [state, setState] = useState('loading')
  const [bagOpen, setBagOpen] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    appStore.set({ cart: loadBag(slug) })
    api
      .getShop(slug)
      .then((res) => {
        if (cancelled) return
        appStore.set({ shop: res.shop, products: res.products })
        setState('ready')
      })
      .catch((err) => !cancelled && setState(err.status === 404 ? 'missing' : 'error'))
    return () => {
      cancelled = true
    }
  }, [slug])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setBagOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (state === 'missing' || state === 'error')
    return (
      <div className="center-stage">
        <section className="card">
          <h1 className="card__title">{state === 'missing' ? 'No shop here' : 'Couldn’t open this shop'}</h1>
          <p className="card__lede">
            {state === 'missing' ? `There’s no shop at /s/${slug}. The link may have changed.` : 'Something went wrong loading the shop. Try again in a moment.'}
          </p>
          <Link to="/" className="btn btn--primary">
            Browse shops
          </Link>
        </section>
      </div>
    )

  const selected = products.find((p) => p.slot === selectedSlot)
  const count = cart.reduce((n, l) => n + (products.some((p) => p.id === l.productId) ? l.quantity : 0), 0)

  return (
    <>
      {shop && (
        <header className="shop-head">
          <Link to="/" className="shop-head__back">
            ← All shops
          </Link>
          <h1>{shop.name}</h1>
          {shop.tagline && <p>{shop.tagline}</p>}
          {state === 'ready' && products.length === 0 && <p className="shop-head__note">Nothing in this room is for sale yet.</p>}
        </header>
      )}

      {state === 'ready' && products.length > 0 && !selected && (
        <nav className="shop-index" aria-label="Products in this shop">
          {products.map((p) => (
            <button key={p.id} type="button" className="shop-index__item" onClick={() => selectSlot(p.slot)}>
              <img src={p.pattern?.thumbUrl || p.imageUrl} alt="" />
              <span>{SLOT_BY_ID[p.slot]?.label ?? p.title}</span>
            </button>
          ))}
        </nav>
      )}

      <button type="button" className="bag-btn" onClick={() => setBagOpen(true)} aria-label={`Bag, ${count} item${count === 1 ? '' : 's'}`}>
        <span aria-hidden="true">Bag</span>
        <span className="bag-btn__count" aria-hidden="true">
          {count}
        </span>
      </button>

      {selected && <ProductCard key={selected.id} product={selected} slug={slug} onAdded={(p) => setToast(`${p.title} added to your bag`)} />}

      <Bag slug={slug} products={products} open={bagOpen} onClose={() => setBagOpen(false)} />

      <div className={`toast${toast ? ' toast--show' : ''}`} role="status" aria-live="polite">
        {toast}
        {toast && (
          <button type="button" className="link-btn" onClick={() => setBagOpen(true)}>
            View bag
          </button>
        )}
      </div>
    </>
  )
}
