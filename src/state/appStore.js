// App-wide state shared by the 3D scene (inside <Canvas>) and the HTML UI (outside it).
// Same external-store pattern as tourStore: plain object + listeners + useSyncExternalStore.
//
// Ownership:
//   UI   writes: mode, scene, creator, shop, patterns, designs, products, preview, cart
//   3D   writes: hoveredSlot (pointer over a product), selectedSlot (click)
//   both read everything. Keep values immutable (replace, don't mutate) so selectors update.
import { useSyncExternalStore } from 'react'

const state = {
  /** 'landing' | 'shop' | 'create' */
  mode: 'landing',
  /** the room on screen (SCENES[].id); products of every room stay in `products` */
  scene: 'garden',
  /** Creator | null (create mode, from /api/me) */
  creator: null,
  /** Shop | null: the shop being viewed (shop mode) or edited (create mode) */
  shop: null,
  /** Product[] for the current shop. Create mode: all statuses; shop mode: succeeded only */
  products: [],
  /** Pattern[] (create mode) */
  patterns: [],
  /** Design[] uploaded by the creator (create mode) */
  designs: [],
  /** slot id | null */
  hoveredSlot: null,
  selectedSlot: null,
  /**
   * Unsaved preview in create mode: { slot, patternId, imageUrl } | null.
   * The scene shows this pattern on that slot before the product is created.
   */
  preview: null,
  /** Shop-mode bag: [{ productId, quantity }] (persisted per shop in localStorage by the UI) */
  cart: [],
}

const listeners = new Set()

export const appStore = {
  get: () => state,
  set(patch) {
    let changed = false
    for (const k in patch) {
      if (state[k] !== patch[k]) {
        state[k] = patch[k]
        changed = true
      }
    }
    if (changed) listeners.forEach((l) => l())
  },
  subscribe(l) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

/** useApp((s) => s.mode). Selector must return a stable value (primitive or stored reference). */
export function useApp(selector) {
  return useSyncExternalStore(appStore.subscribe, () => selector(state))
}

/**
 * What the scene should show on each slot: slot id -> { imageUrl, repeat? }.
 * Preview (create mode) wins over the slot's product pattern. Pending products show their
 * pattern too, so the creator sees the result immediately.
 */
export function slotTextureMap(s = state) {
  const map = {}
  for (const p of s.products) if (p.pattern?.imageUrl && p.status !== 'failed') map[p.slot] = p.pattern.imageUrl
  if (s.preview?.imageUrl) map[s.preview.slot] = s.preview.imageUrl
  return map
}

if (import.meta.env.DEV) window.__app = appStore
