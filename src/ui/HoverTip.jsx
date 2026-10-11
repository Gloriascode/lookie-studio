// Small label that follows the pointer while the 3D scene reports a hovered product slot.
import { useEffect, useRef } from 'react'
import { useApp } from '../state/appStore'
import { SLOT_BY_ID } from '../slots'
import { formatPrice } from './format'

export function HoverTip() {
  const el = useRef()
  const mode = useApp((s) => s.mode)
  const hovered = useApp((s) => s.hoveredSlot)
  const selected = useApp((s) => s.selectedSlot)
  const product = useApp((s) => (s.hoveredSlot ? s.products.find((p) => p.slot === s.hoveredSlot) : null))

  useEffect(() => {
    const move = (e) => {
      if (!el.current) return
      el.current.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 18}px)`
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => window.removeEventListener('pointermove', move)
  }, [])

  const slot = hovered && SLOT_BY_ID[hovered]
  let title = null
  let sub = null
  if (slot && hovered !== selected) {
    if (mode === 'create') {
      title = slot.label
      sub =
        product?.status === 'succeeded'
          ? `${formatPrice(product.unitPrice)} · click to edit`
          : product?.status === 'pending'
            ? 'Creating product…'
            : slot.category
              ? 'Click to design'
              : 'Click to preview a pattern'
    } else if (mode === 'shop' && product) {
      title = product.title
      sub = formatPrice(product.unitPrice)
    }
  }

  return (
    <div ref={el} className={`hover-tip${title ? ' hover-tip--show' : ''}`} aria-hidden="true">
      {title && (
        <>
          <strong>{title}</strong>
          {sub && <span>{sub}</span>}
        </>
      )}
    </div>
  )
}
