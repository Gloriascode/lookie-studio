// Minimal history-API router:
//   /                       landing (conservatory)
//   /studio[/<room>]        create mode
//   /s/:slug[/<room>]       a creator's shop
// <room> is a SCENES[].path ('' = the conservatory). Route changes set appStore.mode/scene and
// the tour's room, so the 3D scene can react without importing this.
import { useSyncExternalStore } from 'react'
import { appStore } from '../state/appStore'
import { tourStore } from '../tour/tourStore'
import { DEFAULT_SCENE, SCENE_BY_PATH, roomPath } from '../scenes'

const sceneFor = (segment) => SCENE_BY_PATH[segment ?? '']?.id ?? null

function parse(pathname) {
  let m = pathname.match(/^\/studio(?:\/([^/]+))?\/?$/)
  if (m && sceneFor(m[1])) return { name: 'studio', mode: 'create', scene: sceneFor(m[1]) }
  m = pathname.match(/^\/s\/([^/]+)(?:\/([^/]+))?\/?$/)
  if (m && sceneFor(m[2])) return { name: 'shop', mode: 'shop', slug: decodeURIComponent(m[1]).toLowerCase(), scene: sceneFor(m[2]) }
  return { name: 'landing', mode: 'landing', scene: DEFAULT_SCENE }
}

let route = parse(location.pathname)
const listeners = new Set()

function apply(next) {
  const prev = route
  route = next
  // Switching rooms inside the same shop/studio keeps the shop, its products and the bag.
  const sameShop = prev.name === next.name && prev.slug === next.slug
  appStore.set({
    mode: next.mode,
    scene: next.scene,
    selectedSlot: null,
    hoveredSlot: null,
    preview: null,
    ...(sameShop
      ? {}
      : {
          // Products/shop belong to the route; each screen reloads its own.
          products: [],
          shop: next.mode === 'create' ? appStore.get().shop : null,
        }),
  })
  tourStore.setScene(next.scene)
  listeners.forEach((l) => l())
}

export function navigate(path, { replace = false } = {}) {
  if (path === location.pathname) return
  history[replace ? 'replaceState' : 'pushState'](null, '', path)
  apply(parse(location.pathname))
}

/** Same page, another room: /s/demo -> /s/demo/bedroom. */
export function navigateRoom(scene) {
  if (route.scene === scene) return
  const base = route.name === 'studio' ? '/studio' : route.name === 'shop' ? `/s/${encodeURIComponent(route.slug)}` : null
  if (base) navigate(roomPath(base, scene))
}

window.addEventListener('popstate', () => apply(parse(location.pathname)))
appStore.set({ mode: route.mode, scene: route.scene })
tourStore.scene = route.scene

export function useRoute() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => route,
  )
}

export const currentRoute = () => route

/** <a> that routes client-side (keeps cmd/ctrl-click working). */
export function Link({ to, onClick, ...props }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
      {...props}
    />
  )
}
