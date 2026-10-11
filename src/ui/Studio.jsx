import { useEffect, useState } from 'react'
import { api } from '../api'
import { appStore, useApp } from '../state/appStore'
import { SLOTS, SLOT_BY_ID } from '../slots'
import { STOPS } from '../tour/stops'
import { AuthCard } from './Auth'
import { clearSelection, selectSlot } from './focus'
import { SLUG_RE, formatPrice, shopUrl } from './format'
import { PatternTile, PatternsTab, PromptComposer, mergePatterns } from './Patterns'
import { usePoll } from './usePoll'

// Slots grouped by the room (tour stop) they live in, in tour order.
const ROOMS = STOPS.map((stop) => ({ stop, slots: SLOTS.filter((s) => s.stop === stop.id) })).filter((r) => r.slots.length)

function upsertProduct(product) {
  const rest = appStore.get().products.filter((p) => p.slot !== product.slot)
  appStore.set({ products: [...rest, product] })
}

function StatusPill({ slot, product }) {
  if (!slot.category) return <span className="pill pill--muted">Display only</span>
  if (!product) return <span className="pill pill--muted">Empty</span>
  if (product.status === 'pending') return <span className="pill pill--pending">Creating…</span>
  if (product.status === 'failed') return <span className="pill pill--bad">Failed</span>
  return <span className="pill pill--live">{formatPrice(product.unitPrice) || 'Live'}</span>
}

function ProductsTab() {
  const products = useApp((s) => s.products)
  const bySlot = Object.fromEntries(products.map((p) => [p.slot, p]))
  const live = products.filter((p) => p.status === 'succeeded').length
  return (
    <div className="tab-body">
      <p className="muted">
        {live} of {SLOTS.filter((s) => s.category).length} products live. Click a piece in the room, or pick one below.
      </p>
      {ROOMS.map(({ stop, slots }) => (
        <section key={stop.id} className="room">
          <h3>{stop.title ?? stop.navLabel}</h3>
          <ul className="slot-list">
            {slots.map((slot) => {
              const product = bySlot[slot.id]
              return (
                <li key={slot.id}>
                  <button type="button" className="slot-row" onClick={() => selectSlot(slot.id)}>
                    <span className="slot-row__thumb" aria-hidden="true">
                      {product?.pattern?.thumbUrl && <img src={product.pattern.thumbUrl} alt="" />}
                    </span>
                    <span className="slot-row__text">
                      <strong>{slot.label}</strong>
                      <small>{slot.category ?? 'Scene piece'}</small>
                    </span>
                    <StatusPill slot={slot} product={product} />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function ShopTab() {
  const shop = useApp((s) => s.shop)
  const [form, setForm] = useState({ name: shop.name, tagline: shop.tagline ?? '', slug: shop.slug })
  const [status, setStatus] = useState(null)
  const [copied, setCopied] = useState(false)
  const slugOk = SLUG_RE.test(form.slug)
  const dirty = form.name !== shop.name || form.tagline !== (shop.tagline ?? '') || form.slug !== shop.slug

  async function save(e) {
    e.preventDefault()
    if (!slugOk) return setStatus({ bad: true, text: 'Shop link: 3–40 lowercase letters, numbers or dashes.' })
    setStatus({ text: 'Saving…' })
    try {
      const res = await api.updateShop(form)
      appStore.set({ shop: res.shop })
      setStatus({ text: 'Saved.' })
    } catch (err) {
      setStatus({ bad: true, text: err.status === 409 ? 'That link is taken — try another.' : err.message })
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shopUrl(shop.slug))
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked; the link is visible to copy by hand */
    }
  }

  return (
    <div className="tab-body">
      <div className="share">
        <span className="share__label">Your shop link</span>
        <code className="share__url">{shopUrl(shop.slug).replace(/^https?:\/\//, '')}</code>
        <div className="share__actions">
          <button type="button" className="btn btn--small" onClick={copy}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <a className="btn btn--small" href={`/s/${shop.slug}`} target="_blank" rel="noreferrer">
            View shop ↗
          </a>
        </div>
      </div>
      <form className="form" onSubmit={save}>
        <label className="field">
          <span>Shop name</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label className="field">
          <span>Tagline</span>
          <input value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="Prints for slow afternoons" />
        </label>
        <label className="field">
          <span>Shop link</span>
          <div className={`slug-input${!slugOk ? ' slug-input--bad' : ''}`}>
            <span className="slug-input__prefix">/s/</span>
            <input
              value={form.slug}
              spellCheck={false}
              onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
            />
          </div>
        </label>
        <p className={status?.bad ? 'form__error' : 'form__status'} role="status" aria-live="polite">
          {status?.text}
        </p>
        <button className="btn btn--primary" disabled={!dirty}>
          Save shop
        </button>
      </form>
    </div>
  )
}

function SlotView({ slotId }) {
  const slot = SLOT_BY_ID[slotId]
  const product = useApp((s) => s.products.find((p) => p.slot === slotId) ?? null)
  const patterns = useApp((s) => s.patterns)
  const preview = useApp((s) => s.preview)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [composer, setComposer] = useState(false)
  const ready = patterns.filter((p) => p.status === 'succeeded')
  const pendingPatterns = patterns.filter((p) => p.status === 'pending').length
  const chosen = preview?.slot === slotId ? preview : null

  function choose(p) {
    if (chosen?.patternId === p.id) appStore.set({ preview: null })
    else appStore.set({ preview: { slot: slotId, patternId: p.id, imageUrl: p.imageUrl } })
  }

  async function create() {
    if (!chosen) return
    setBusy(true)
    setError(null)
    // Show "creating" straight away: Arcade can take a minute just to accept the job.
    const previous = product
    const pattern = patterns.find((p) => p.id === chosen.patternId)
    upsertProduct({
      id: `pending-${slotId}`, slot: slotId, categoryName: slot.category, status: 'pending', error: null,
      title: null, selectionLabel: null, unitPrice: null, imageUrl: null,
      pattern: { id: chosen.patternId, imageUrl: chosen.imageUrl, thumbUrl: pattern?.thumbUrl ?? null },
    })
    appStore.set({ preview: null })
    try {
      const { product } = await api.createProduct(slotId, chosen.patternId)
      upsertProduct(product)
    } catch (err) {
      if (previous) upsertProduct(previous)
      else appStore.set({ products: appStore.get().products.filter((p) => p.slot !== slotId) })
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await api.deleteProduct(slotId)
      appStore.set({ products: appStore.get().products.filter((p) => p.slot !== slotId) })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tab-body slot-view">
      <button type="button" className="link-btn" onClick={clearSelection}>
        ← All products
      </button>
      <header className="slot-view__head">
        <h2>{slot.label}</h2>
        <span className="muted">{slot.category ?? 'Scene piece — preview only, not for sale'}</span>
      </header>

      {product && (
        <div className={`product-status product-status--${product.status}`} aria-live="polite">
          {product.status === 'succeeded' ? (
            <>
              {product.imageUrl && <img className="product-status__img" src={product.imageUrl} alt={`${product.title} mockup`} />}
              <div>
                <strong>{product.title}</strong>
                {product.selectionLabel && <small>{product.selectionLabel}</small>}
                <span className="price">{formatPrice(product.unitPrice)}</span>
              </div>
            </>
          ) : product.status === 'pending' ? (
            <>
              <span className="spinner" aria-hidden="true" />
              <div>
                <strong>Creating your product…</strong>
                <small>Arcade is laying the pattern onto the {slot.label.toLowerCase()}. This takes a minute or two.</small>
              </div>
            </>
          ) : (
            <div>
              <strong>That didn’t work</strong>
              <small>{product.error || 'Arcade couldn’t make this product. Try another pattern.'}</small>
            </div>
          )}
          {product.status !== 'pending' && (
            <button type="button" className="link-btn link-btn--danger" onClick={remove} disabled={busy}>
              Remove
            </button>
          )}
        </div>
      )}

      <div className="section-head">
        <h3>{product ? 'Change pattern' : 'Choose a pattern'}</h3>
        <button type="button" className="link-btn" onClick={() => setComposer((c) => !c)} aria-expanded={composer}>
          {composer ? 'Close' : '+ New pattern'}
        </button>
      </div>
      {composer && <PromptComposer compact onCreated={() => setComposer(false)} />}

      {ready.length === 0 ? (
        <p className="empty">
          {pendingPatterns ? `${pendingPatterns} pattern${pendingPatterns > 1 ? 's' : ''} weaving — they’ll appear here.` : 'No patterns yet. Upload a design in the Patterns tab, or create one from a prompt.'}
        </p>
      ) : (
        <div className="grid grid--picker" role="group" aria-label="Patterns">
          {ready.map((p) => (
            <PatternTile key={p.id} pattern={p} size="sm" selected={chosen?.patternId === p.id} onSelect={choose} />
          ))}
        </div>
      )}

      {slot.category && (
        <div className="slot-view__cta">
          <p className="muted">{chosen ? 'Previewing in the room. Happy with it?' : 'Pick a pattern to preview it in the room.'}</p>
          <button type="button" className="btn btn--primary btn--block" disabled={!chosen || busy || product?.status === 'pending'} onClick={create}>
            {busy ? 'Starting…' : product ? 'Replace product' : `Create ${slot.label.toLowerCase()}`}
          </button>
        </div>
      )}
      <p className="form__error" role="alert">
        {error}
      </p>
    </div>
  )
}

const TABS = [
  { id: 'products', label: 'Products' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'shop', label: 'Shop' },
]

export function StudioPanel() {
  const creator = useApp((s) => s.creator)
  const selectedSlot = useApp((s) => s.selectedSlot)
  const patterns = useApp((s) => s.patterns)
  const products = useApp((s) => s.products)
  const shopName = useApp((s) => s.shop?.name)
  const [tab, setTab] = useState('products')
  const [expanded, setExpanded] = useState(true)

  // Load everything once signed in.
  useEffect(() => {
    if (!creator) return
    let cancelled = false
    Promise.all([api.listPatterns(), api.listDesigns(), api.listProducts()])
      .then(([pa, de, pr]) => {
        if (cancelled) return
        appStore.set({ patterns: pa.patterns, designs: de.designs, products: pr.products })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [creator])

  usePoll(async () => mergePatterns((await api.listPatterns()).patterns), patterns.some((p) => p.status === 'pending'))
  usePoll(async () => appStore.set({ products: (await api.listProducts()).products }), products.some((p) => p.status === 'pending'))

  useEffect(() => {
    if (selectedSlot) setExpanded(true)
  }, [selectedSlot])

  async function logout() {
    await api.logout().catch(() => {})
    appStore.set({ creator: null, shop: null, patterns: [], designs: [], products: [], preview: null, selectedSlot: null })
  }

  return (
    <aside className={`panel studio${expanded ? '' : ' panel--collapsed'}`} aria-label="Studio" onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
      <header className="panel__head">
        <button type="button" className="panel__grip" aria-label={expanded ? 'Collapse studio' : 'Expand studio'} aria-expanded={expanded} onClick={() => setExpanded((x) => !x)} />
        <div className="panel__title">
          <span className="eyebrow">Studio</span>
          <strong>{shopName}</strong>
        </div>
        <button type="button" className="link-btn" onClick={logout}>
          Sign out
        </button>
      </header>
      {!selectedSlot && (
        <nav className="tabs" role="tablist" aria-label="Studio sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className="tabs__btn"
              onClick={() => {
                setTab(t.id)
                setExpanded(true)
              }}
            >
              {t.label}
              {t.id === 'patterns' && patterns.some((p) => p.status === 'pending') && <span className="dot" aria-label="in progress" />}
            </button>
          ))}
        </nav>
      )}
      <div className="panel__scroll">
        {selectedSlot ? <SlotView key={selectedSlot} slotId={selectedSlot} /> : tab === 'products' ? <ProductsTab /> : tab === 'patterns' ? <PatternsTab /> : <ShopTab />}
      </div>
    </aside>
  )
}

/** /studio: sign in, then the studio panel over the room. */
export function Studio() {
  const creator = useApp((s) => s.creator)
  const [checked, setChecked] = useState(!!creator)

  useEffect(() => {
    if (creator) return
    let cancelled = false
    api
      .me()
      .then((res) => !cancelled && appStore.set({ creator: res.creator, shop: res.shop }))
      .catch(() => {})
      .finally(() => !cancelled && setChecked(true))
    return () => {
      cancelled = true
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!checked) return null
  return creator ? <StudioPanel /> : <AuthCard />
}
