// Minimal history-API router: `/` landing, `/studio` create mode, `/s/:slug` a creator's shop.
// Route changes also set appStore.mode so the 3D scene can react without importing this.
import { useSyncExternalStore } from 'react'
import { appStore } from '../state/appStore'

function parse(pathname) {
  if (/^\/studio\/?$/.test(pathname)) return { name: 'studio', mode: 'create' }
  const m = pathname.match(/^\/s\/([^/]+)\/?$/)
  if (m) return { name: 'shop', mode: 'shop', slug: decodeURIComponent(m[1]).toLowerCase() }
  return { name: 'landing', mode: 'landing' }
}

let route = parse(location.pathname)
const listeners = new Set()

function apply(next) {
  route = next
  appStore.set({
    mode: next.mode,
    selectedSlot: null,
    hoveredSlot: null,
    preview: null,
    // Products/shop belong to the route; each screen reloads its own.
    products: [],
    shop: next.mode === 'create' ? appStore.get().shop : null,
  })
  listeners.forEach((l) => l())
}

export function navigate(path, { replace = false } = {}) {
  if (path === location.pathname) return
  history[replace ? 'replaceState' : 'pushState'](null, '', path)
  apply(parse(location.pathname))
}

window.addEventListener('popstate', () => apply(parse(location.pathname)))
appStore.set({ mode: route.mode })

export function useRoute() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => route,
  )
}

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
