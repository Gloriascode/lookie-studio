// Scroll / swipe / keys page through STOPS, one stop per gesture. Ported from
// merchtailor-3d's ScrollCameraDirector: a gesture accumulates past a threshold, jumps one
// stop, then a cooldown swallows trackpad inertia. The camera flies straight to the stop
// (eased position + look-at) and the rig does no work at all once it has settled.
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { STOPS } from './stops'
import { tourStore } from './tourStore'

const WHEEL_THRESHOLD = 36 // accumulated deltaY before a wheel gesture counts
const WHEEL_GAP_MS = 220 // pause that starts a fresh gesture
const COOLDOWN_MS = 900 // swallow inertia after a jump
const SWIPE_THRESHOLD = 50 // px
const AUTO_INTRO_MS = 1800 // fly from the aerial arrival shot to the first real stop

// Duration scales with distance so short hops feel snappy and the outdoor swings don't rush.
const flightDuration = (dist) => THREE.MathUtils.clamp(0.75 + dist * 0.07, 0.85, 2.1)
// Ease in-out (quintic-ish) for a gentle departure and a soft landing.
const ease = (t) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2)

const isNarrow = () => window.innerWidth <= 768

export function stopPose(stop) {
  const m = isNarrow() ? stop.mobile ?? {} : {}
  return { pos: m.pos ?? stop.pos, target: m.target ?? stop.target }
}

export function ScrollCameraDirector({ blocked = false }) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked

  // Pre-allocated so the per-frame path never allocates.
  const v = useRef({
    fromPos: new THREE.Vector3(),
    fromTgt: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    toTgt: new THREE.Vector3(),
    curTgt: new THREE.Vector3(),
    // arc: lift the camera a little mid-flight when crossing between inside and outside
    lift: 0,
    t: 1,
    duration: 1,
  }).current

  // Initial pose.
  useEffect(() => {
    const { pos, target } = stopPose(STOPS[tourStore.active])
    camera.position.set(...pos)
    v.curTgt.set(...target)
    camera.lookAt(v.curTgt)
    invalidate()
  }, [camera, invalidate, v])

  // Keep framing correct when the viewport crosses the mobile breakpoint.
  useEffect(() => {
    let narrow = isNarrow()
    const onResize = () => {
      if (isNarrow() === narrow) return
      narrow = isNarrow()
      tourStore.pendingJump = { toIdx: tourStore.active, init: true }
      invalidate()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [invalidate])

  // Input → one stop per gesture.
  useEffect(() => {
    const el = gl.domElement.parentElement ?? gl.domElement
    let lastJump = 0
    let wheelAccum = 0
    let lastWheel = 0
    let touchStart = null

    const inCooldown = () => Date.now() - lastJump < COOLDOWN_MS
    const advance = (dir) => {
      if (blockedRef.current || inCooldown()) return
      const before = tourStore.active
      tourStore.step(dir)
      if (tourStore.active !== before) {
        lastJump = Date.now()
        wheelAccum = 0
      }
    }

    const onWheel = (e) => {
      if (blockedRef.current) return
      e.preventDefault()
      const now = Date.now()
      if (now - lastWheel > WHEEL_GAP_MS) wheelAccum = 0
      lastWheel = now
      if (inCooldown()) {
        wheelAccum = 0
        return
      }
      wheelAccum += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      if (Math.abs(wheelAccum) >= WHEEL_THRESHOLD) advance(wheelAccum > 0 ? 1 : -1)
    }
    const onTouchStart = (e) => {
      const t = e.touches[0]
      touchStart = { x: t.clientX, y: t.clientY }
    }
    const onTouchMove = (e) => {
      if (touchStart) e.preventDefault()
    }
    const onTouchEnd = (e) => {
      if (!touchStart) return
      const t = e.changedTouches[0]
      const dx = touchStart.x - t.clientX
      const dy = touchStart.y - t.clientY
      touchStart = null
      const d = Math.abs(dy) > Math.abs(dx) ? dy : dx
      if (Math.abs(d) >= SWIPE_THRESHOLD) advance(d > 0 ? 1 : -1)
    }
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(e.key)) advance(1)
      else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) advance(-1)
      else if (e.key === 'Home') tourStore.navigate(0)
      else if (e.key === 'End') tourStore.navigate(STOPS.length - 1)
      else return
      e.preventDefault()
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    window.addEventListener('keydown', onKey)

    const intro = setTimeout(() => {
      if (tourStore.active === 0 && !tourStore.moving) tourStore.jumpTo(1)
    }, AUTO_INTRO_MS)

    return () => {
      clearTimeout(intro)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('keydown', onKey)
    }
  }, [gl])

  useFrame((_, delta) => {
    const j = tourStore.pendingJump
    if (j?.init) {
      const { pos, target } = j.pose ?? stopPose(STOPS[j.toIdx])
      v.fromPos.copy(camera.position)
      v.fromTgt.copy(v.curTgt)
      v.toPos.set(...pos)
      v.toTgt.set(...target)
      const dist = v.fromPos.distanceTo(v.toPos)
      v.duration = flightDuration(dist)
      // Crossing the glass (one end inside, one outside)? Arc up so we don't clip the frame.
      const inside = (p) => Math.abs(p.x) < 3.3 && Math.abs(p.z) < 3.95
      v.lift = inside(v.fromPos) !== inside(v.toPos) ? Math.min(2.2, dist * 0.12) : 0
      v.t = 0
      j.init = false
      tourStore.setMoving(true)
    }
    if (v.t >= 1) return // settled: zero per-frame work

    v.t = Math.min(1, v.t + delta / v.duration)
    const e = ease(v.t)
    camera.position.lerpVectors(v.fromPos, v.toPos, e)
    camera.position.y += Math.sin(Math.PI * e) * v.lift
    v.curTgt.lerpVectors(v.fromTgt, v.toTgt, e)
    camera.lookAt(v.curTgt)

    if (v.t >= 1) {
      tourStore.pendingJump = null
      tourStore.setMoving(false)
    }
  })

  return null
}

/** Current look-at target, for the dev orbit controls to pick up where the tour left off. */
export function getTourTarget(stopIndex = tourStore.active) {
  return stopPose(STOPS[stopIndex]).target
}
