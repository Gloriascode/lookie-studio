import { useEffect, useRef } from 'react'

/** Calls fn every `ms` while `active` is true (and the tab is visible). */
export function usePoll(fn, active, ms = 5000) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    if (!active) return
    let stopped = false
    let timer
    const tick = async () => {
      if (stopped) return
      if (document.visibilityState === 'visible') {
        try {
          await fnRef.current()
        } catch {
          /* transient; try again next tick */
        }
      }
      if (!stopped) timer = setTimeout(tick, ms)
    }
    timer = setTimeout(tick, ms)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [active, ms])
}
