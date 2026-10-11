// Full-screen image viewer for Arcade product mockups (and their pattern swatch).
// Rendered into <body> so it sits above every panel. While open it owns the keyboard:
// Escape closes it (without also closing the product panel) and arrows page between images
// (without also moving the scroll tour).
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * @param {{ images: { src: string, alt: string, label?: string }[], index: number, onClose: () => void }} props
 */
export function Lightbox({ images, index: startIndex = 0, onClose }) {
  const [index, setIndex] = useState(startIndex)
  const [loaded, setLoaded] = useState(false)
  const closeBtn = useRef(null)
  const image = images[index]
  const many = images.length > 1

  const go = useCallback((dir) => {
    setLoaded(false)
    setIndex((i) => (i + dir + images.length) % images.length)
  }, [images.length])

  useEffect(() => {
    const previous = document.activeElement
    closeBtn.current?.focus()
    // Capture phase on window runs before the app's own key handlers (Escape → clear selection,
    // arrows → tour), and stopping it there keeps them from seeing the key at all.
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (many && e.key === 'ArrowRight') go(1)
      else if (many && e.key === 'ArrowLeft') go(-1)
      else if (e.key !== 'Tab') return
      if (e.key !== 'Tab') {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [onClose, go, many])

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={image.alt} onClick={onClose}>
      <figure className="lightbox__figure" onClick={(e) => e.stopPropagation()}>
        <img
          key={image.src}
          className={`lightbox__img${loaded ? ' lightbox__img--loaded' : ''}`}
          src={image.src}
          alt={image.alt}
          onLoad={() => setLoaded(true)}
        />
        {!loaded && <span className="spinner lightbox__spinner" aria-hidden="true" />}
        {(image.label || many) && (
          <figcaption className="lightbox__caption">
            {image.label}
            {many && <span className="lightbox__count">{index + 1} / {images.length}</span>}
          </figcaption>
        )}
      </figure>
      {many && (
        <>
          <button type="button" className="lightbox__nav lightbox__nav--prev" aria-label="Previous image" onClick={(e) => { e.stopPropagation(); go(-1) }}>
            ‹
          </button>
          <button type="button" className="lightbox__nav lightbox__nav--next" aria-label="Next image" onClick={(e) => { e.stopPropagation(); go(1) }}>
            ›
          </button>
        </>
      )}
      <button ref={closeBtn} type="button" className="lightbox__close" aria-label="Close image" onClick={onClose}>
        ×
      </button>
    </div>,
    document.body,
  )
}

/** The product's viewable images: the Arcade mockup first, then the print itself. */
export function productImages(product) {
  const out = []
  if (product?.imageUrl) out.push({ src: product.imageUrl, alt: `${product.title ?? 'Product'} mockup`, label: product.title })
  if (product?.pattern?.imageUrl) out.push({ src: product.pattern.imageUrl, alt: 'Pattern', label: 'The print' })
  return out
}

/** A thumbnail that opens the lightbox. Renders `children` (the <img>) inside a zoom button. */
export function ZoomableImage({ images, index = 0, className = '', label = 'View larger image', children }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  if (!images.length) return children
  return (
    <>
      <button type="button" className={`zoomable ${className}`} aria-label={label} onClick={() => setOpen(true)}>
        {children}
        <span className="zoomable__hint" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path d="M6.5 1.5h-5v5M1.5 1.5l5 5M9.5 14.5h5v-5M14.5 14.5l-5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      </button>
      {open && <Lightbox images={images} index={index} onClose={close} />}
    </>
  )
}
