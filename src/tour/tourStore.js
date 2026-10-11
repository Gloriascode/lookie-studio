// Tiny pub-sub shared by the in-Canvas camera rig and the HTML nav (same pattern as
// merchtailor-3d's tourStore): no React context has to cross the <Canvas> boundary.
import { useSyncExternalStore } from 'react'
import { STOPS } from './stops'

const listeners = new Set()
const notify = () => listeners.forEach((l) => l())

export const tourStore = {
  /** index of the stop the camera is at / flying to */
  active: 0,
  /** set by jumpTo, consumed by the camera rig */
  pendingJump: null,
  /** true while the camera is in flight */
  moving: false,
  /** true while the camera is on an ad-hoc close-up (focus) instead of a stop */
  focused: false,
  /** bumped on every user-driven navigation (scroll / swipe / keys / nav dots) */
  userNavSeq: 0,

  jumpTo(index) {
    const next = Math.max(0, Math.min(STOPS.length - 1, index))
    if (next === this.active && !this.moving && !this.focused) return
    this.active = next
    this.focused = false
    this.pendingJump = { toIdx: next, init: true }
    notify()
  },
  /** User gesture: one stop forward/back. Leaves any close-up and bumps userNavSeq. */
  step(dir) {
    this.userNavSeq++
    this.jumpTo(this.active + dir)
  },
  /** User picked a stop from the nav. */
  navigate(index) {
    this.userNavSeq++
    this.jumpTo(index)
  },
  /**
   * Fly to an ad-hoc pose ({ pos: [x,y,z], target: [x,y,z] }) without changing the active
   * stop or nav dots. The next scroll continues the tour from the active stop.
   */
  focus(pose) {
    this.focused = true
    this.pendingJump = { pose, init: true }
    notify()
  },
  /** Leave a close-up and fly back to the active stop. */
  returnToStop() {
    if (!this.focused) return
    this.focused = false
    this.pendingJump = { toIdx: this.active, init: true }
    notify()
  },
  setMoving(moving) {
    if (moving === this.moving) return
    this.moving = moving
    notify()
  },
  subscribe(l) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

const subscribe = (l) => tourStore.subscribe(l)

export function useActiveStop() {
  return useSyncExternalStore(subscribe, () => tourStore.active)
}

export function useTourMoving() {
  return useSyncExternalStore(subscribe, () => tourStore.moving)
}

export function useTourFocused() {
  return useSyncExternalStore(subscribe, () => tourStore.focused)
}

// Dev builds: drive the tour from the console / headless screenshot scripts.
if (import.meta.env.DEV) window.__tour = tourStore
