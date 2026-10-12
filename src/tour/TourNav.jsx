import { useEffect, useState } from 'react'
import { navStopsFor, stopsFor } from './stops'
import { tourStore, useActiveStop, useTourFocused, useTourMoving, useTourScene } from './tourStore'

// Hidden stops light up the nearest visible dot.
function nearestVisible(nav, index) {
  let best = nav[0]
  for (const s of nav) if (Math.abs(s.index - index) < Math.abs(best.index - index)) best = s
  return best
}

export function TourNav() {
  const active = useActiveStop()
  const scene = useTourScene()
  const [hovered, setHovered] = useState(null)
  const nav = navStopsFor(scene)
  const stops = stopsFor(scene)
  const current = nearestVisible(nav, active)
  const label = hovered != null && stops[hovered] ? stops[hovered].navLabel : current.navLabel

  return (
    <nav className="tour-nav" aria-label="Scene stops">
      <span className="tour-nav__label" aria-live="polite">
        {label}
      </span>
      <div className="tour-nav__dots">
        {nav.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`tour-nav__dot${s.index === current.index ? ' tour-nav__dot--active' : ''}`}
            aria-label={s.navLabel}
            aria-current={s.index === current.index ? 'step' : undefined}
            onClick={() => tourStore.navigate(s.index)}
            onMouseEnter={() => setHovered(s.index)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(s.index)}
            onBlur={() => setHovered(null)}
          />
        ))}
      </div>
    </nav>
  )
}

/** Big serif title for the current stop; fades out while the camera is flying. */
export function StopCaption() {
  const active = useActiveStop()
  const moving = useTourMoving()
  const focused = useTourFocused()
  const scene = useTourScene()
  const stop = stopsFor(scene)[active]
  if (!stop?.title) return null
  return (
    <header className={`stop-caption${moving || focused ? ' stop-caption--hidden' : ''}`} key={`${scene}:${stop.id}`}>
      <h1>{stop.title}</h1>
      {stop.subtitle && <p>{stop.subtitle}</p>}
    </header>
  )
}

/** "Scroll to explore" hint: appears after a beat, goes away after the first move. */
export function SwipeHint() {
  const active = useActiveStop()
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const show = setTimeout(() => setVisible(true), 3200)
    const hide = setTimeout(() => setDismissed(true), 14000)
    return () => {
      clearTimeout(show)
      clearTimeout(hide)
    }
  }, [])
  useEffect(() => {
    if (active > 1) setDismissed(true)
  }, [active])

  const touch = typeof window !== 'undefined' && 'ontouchstart' in window
  return (
    <div className={`swipe-hint${visible && !dismissed ? ' swipe-hint--visible' : ''}`} aria-hidden="true">
      <span className="swipe-hint__icon" />
      {touch ? 'Swipe to explore' : 'Scroll to explore'}
    </div>
  )
}
