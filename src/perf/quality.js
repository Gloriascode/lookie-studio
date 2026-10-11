// Global render-quality tier, driven by drei's <PerformanceMonitor> (see AdaptiveQuality).
// Lives outside React so scene code and HTML can both read it without crossing the Canvas.
import { useSyncExternalStore } from 'react'

const isMobile =
  typeof navigator !== 'undefined' &&
  (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024))

// `?q=0|1|2` pins a tier (handy for profiling); otherwise start high on desktop, medium on mobile.
const pinned = new URLSearchParams(location.search).get('q')

export const TIERS = [
  // low: no postprocessing, small shadow map, sparse grass
  { name: 'low', dpr: 1, shadowMap: 1024, grass: 0.3, flowers: 0.4, effects: false },
  // medium: still no postprocessing (the biggest single cost), denser foliage
  { name: 'medium', dpr: 1.25, shadowMap: 2048, grass: 0.6, flowers: 0.7, effects: false },
  // high: AO + vignette, full foliage, sharp shadows
  { name: 'high', dpr: 2, shadowMap: 2048, grass: 1, flowers: 1, effects: true },
]

let tier = pinned != null ? Math.max(0, Math.min(2, Number(pinned))) : isMobile ? 1 : 2
const listeners = new Set()

export const quality = {
  pinned: pinned != null,
  isMobile,
  get tier() {
    return tier
  },
  get settings() {
    return TIERS[tier]
  },
  set(next) {
    next = Math.max(0, Math.min(TIERS.length - 1, next))
    if (next === tier || this.pinned) return
    tier = next
    listeners.forEach((l) => l())
  },
  subscribe(l) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

export function useQuality() {
  const t = useSyncExternalStore(quality.subscribe.bind(quality), () => tier)
  return TIERS[t]
}
