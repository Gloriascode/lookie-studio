// Everything that makes the products (pillows, curtains, duvet...) alive in the scene:
//  - pointer hover / click on product meshes -> appStore.hoveredSlot / selectedSlot
//  - warm rim highlight for the hovered and the selected product
//  - pattern textures from slotTextureMap(appStore), cross-faded in as they load
//  - camera close-up on the selected product (tourStore.focus), back to the tour on clear
//
// The meshes are registered by <GlassGarden> into `slotMeshes`; this module never walks
// the scene graph per frame. All animation lives in one useFrame that returns immediately
// when nothing is fading.
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { appStore, slotTextureMap, useApp } from '../state/appStore'
import { SLOTS, SLOT_BY_ID } from '../slots'
import { STOPS } from '../tour/stops'
import { stopPose } from '../tour/ScrollCameraDirector'
import { tourStore } from '../tour/tourStore'
import { BLANK_TEXTURE, makeOutlineMaterial } from './productMaterial'
import { acquirePattern, releasePattern, setPatternAnisotropy } from './patternTextures'

/** slot id -> product Mesh (filled by GlassGarden once the GLB is in). */
export const slotMeshes = new Map()

const PATTERN_FADE = 1 / 0.6 // per second
const HIGHLIGHT_FADE = 1 / 0.18
const HOVER_GLOW = 1
const SELECTED_GLOW = 0.45
const CLICK_SLOP = 6 // px of pointer travel before a click counts as a drag/swipe

// ── Per-slot animation state ───────────────────────────────────────────────────
const states = new Map() // slot -> state
const animating = new Set()

function stateFor(slot) {
  let st = states.get(slot)
  if (!st) {
    const mesh = slotMeshes.get(slot)
    if (!mesh?.material.userData.u) return null
    st = { slot, u: mesh.material.userData.u, want: null, aUrl: null, bUrl: null, tA: 0, tB: 0, tHl: 0 }
    states.set(slot, st)
  }
  return st
}

function setPattern(slot, url) {
  const st = stateFor(slot)
  if (!st || st.want === url) return
  st.want = url
  if (!url) {
    st.tA = 0
    st.tB = 0
    animating.add(st)
    return
  }
  acquirePattern(url).then(
    (tex) => {
      if (st.want !== url) return releasePattern(url)
      if (!st.aUrl || st.u.uAmountA.value < 0.01) {
        if (st.aUrl) releasePattern(st.aUrl)
        st.aUrl = url
        st.u.uTexA.value = tex
        st.u.uAmountA.value = 0
        st.tA = 1
      } else {
        if (st.bUrl) releasePattern(st.bUrl)
        st.bUrl = url
        st.u.uTexB.value = tex
        st.tB = 1
      }
      animating.add(st)
    },
    (err) => console.warn(err.message),
  )
}

function step(st, dt) {
  const u = st.u
  let busy = false
  const toward = (cur, target, rate) => {
    if (cur === target) return cur
    busy = true
    const d = target - cur
    const s = rate * dt
    return Math.abs(d) <= s ? target : cur + Math.sign(d) * s
  }
  u.uAmountA.value = toward(u.uAmountA.value, st.tA, PATTERN_FADE)
  u.uAmountB.value = toward(u.uAmountB.value, st.tB, PATTERN_FADE)
  u.uHighlight.value = toward(u.uHighlight.value, st.tHl, HIGHLIGHT_FADE)

  // B fully in: promote it to A.
  if (st.bUrl && u.uAmountB.value >= 1) {
    if (st.aUrl) releasePattern(st.aUrl)
    st.aUrl = st.bUrl
    u.uTexA.value = u.uTexB.value
    u.uAmountA.value = 1
    st.tA = 1
    st.bUrl = null
    u.uTexB.value = BLANK_TEXTURE
    u.uAmountB.value = 0
    st.tB = 0
  }
  // Faded out: let go of the textures.
  if (st.tA === 0 && u.uAmountA.value === 0 && st.aUrl) {
    releasePattern(st.aUrl)
    st.aUrl = null
    u.uTexA.value = BLANK_TEXTURE
  }
  if (st.tB === 0 && u.uAmountB.value === 0 && st.bUrl) {
    releasePattern(st.bUrl)
    st.bUrl = null
    u.uTexB.value = BLANK_TEXTURE
  }
  return busy
}

// Two outlines: a bold one following the hovered product, a fine one on the selected one.
const outlines = []
function makeOutline(width, maxOpacity) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), makeOutlineMaterial())
  mesh.material.uniforms.uWidth.value = width
  mesh.matrixAutoUpdate = false
  mesh.visible = false
  mesh.raycast = () => {}
  mesh.renderOrder = 3
  const o = { mesh, slot: null, target: 0, maxOpacity }
  outlines.push(o)
  return o
}
const hoverOutline = makeOutline(0.0042, 0.95)
const selectOutline = makeOutline(0.0026, 0.7)

function pointOutline(o, slot) {
  if (slot) {
    const target = slotMeshes.get(slot)
    if (!target) return
    if (o.slot !== slot) {
      o.slot = slot
      o.mesh.geometry = target.geometry
      o.mesh.matrix.copy(target.matrixWorld)
      o.mesh.matrixWorld.copy(target.matrixWorld)
      o.mesh.material.uniforms.uOpacity.value = 0
    }
    o.target = o.maxOpacity
  } else {
    o.target = 0
  }
  o.mesh.visible = true
}

function stepOutline(o, dt) {
  const u = o.mesh.material.uniforms.uOpacity
  if (u.value === o.target) {
    if (o.target === 0) o.mesh.visible = false
    return false
  }
  const d = o.target - u.value
  const s = HIGHLIGHT_FADE * dt
  u.value = Math.abs(d) <= s ? o.target : u.value + Math.sign(d) * s
  return true
}

function applyHighlights() {
  const { hoveredSlot, selectedSlot } = appStore.get()
  pointOutline(hoverOutline, hoveredSlot)
  // Don't double-outline: the hover outline covers a hovered selected product.
  pointOutline(selectOutline, selectedSlot && selectedSlot !== hoveredSlot ? selectedSlot : null)
  for (const slot of slotMeshes.keys()) {
    const st = stateFor(slot)
    if (!st) continue
    const t = slot === hoveredSlot ? HOVER_GLOW : slot === selectedSlot ? SELECTED_GLOW : 0
    if (st.tHl !== t) {
      st.tHl = t
      animating.add(st)
    }
  }
}

// ── Camera close-up ───────────────────────────────────────────────────────────
const _box = new THREE.Box3()
const _center = new THREE.Vector3()
const _size = new THREE.Vector3()
const _dir = new THREE.Vector3()
const ROOM = { x: 3.0, z: 3.55, yMin: 0.45, yMax: 2.4 } // stay inside the glass

const _ray = new THREE.Raycaster()
const _cand = new THREE.Vector3()
const _to = new THREE.Vector3()
const _probe = new THREE.Vector3()

/** True if nothing but the slot itself (or other soft products) sits between the two points. */
function clearLine(root, mesh, from, to) {
  _to.subVectors(to, from)
  const len = _to.length()
  _ray.set(from, _to.divideScalar(len))
  _ray.near = 0.02
  _ray.far = len
  for (const hit of _ray.intersectObject(root, true)) {
    if (hit.object === mesh || hit.object.userData.slot) continue
    return false
  }
  return true
}

/**
 * Close-up camera pose for a product: framed to fill ~60% of the view, inside the glass,
 * with a clear line of sight. Prefers the side its tour stop sees it from; if furniture is
 * in the way it tries the other sides and steeper angles.
 */
export function computeSlotPose(slot, camera) {
  const mesh = slotMeshes.get(slot)
  const def = SLOT_BY_ID[slot]
  if (!mesh || !def) return null
  let root = mesh
  while (root.parent) root = root.parent
  _box.setFromObject(mesh)
  _box.getCenter(_center)
  _box.getSize(_size)
  const radius = _size.length() / 2

  // Preferred side: towards the slot's tour stop camera (stops were framed by hand).
  const stop = STOPS.find((s) => s.id === def.stop) ?? STOPS[tourStore.active]
  const from = stopPose(stop).pos
  _dir.set(from[0] - _center.x, 0, from[2] - _center.z)
  if (_dir.lengthSq() < 1e-4) _dir.set(0, 0, 1)
  _dir.normalize()
  // Flat hanging things (curtains, tea towel): look straight at their face.
  const thinX = _size.x < 0.35 * _size.z
  const thinZ = _size.z < 0.35 * _size.x
  if (thinZ) _dir.set(0, 0, Math.sign(_dir.z) || 1)
  else if (thinX) _dir.set(Math.sign(_dir.x) || 1, 0, 0)

  const vfov = THREE.MathUtils.degToRad(camera.fov)
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect)
  const upright = _size.y > 0.8 * Math.max(_size.x, _size.z)
  const baseElev = upright ? 6 : radius > 0.8 ? 22 : 30

  // Sight lines from the centre and four points across the product to a candidate camera.
  const probes = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]
  const visibility = (dx, dz) => {
    let clear = 0
    for (const [a, b] of probes) {
      _probe.set(_center.x + dz * _size.x * a, _center.y + _size.y * b, _center.z - dx * _size.z * a)
      if (clearLine(root, mesh, _probe, _cand)) clear++
    }
    return clear
  }

  const sides = [[_dir.x, _dir.z], [-_dir.x, -_dir.z], [_dir.z, -_dir.x], [-_dir.z, _dir.x]]
  const elevs = [baseElev, baseElev + 18, 55]
  let best = null
  let bestScore = -1
  for (const elevDeg of elevs) {
    for (const [dx, dz] of sides) {
      // Face-on is the point for thin items; skip edge-on views of them.
      if ((thinZ && Math.abs(dz) < 0.5) || (thinX && Math.abs(dx) < 0.5)) continue
      const elev = THREE.MathUtils.degToRad(elevDeg)
      const width = Math.abs(_size.x * dz) + Math.abs(_size.z * dx)
      const depth = Math.abs(_size.x * dx) + Math.abs(_size.z * dz)
      const height = _size.y * Math.cos(elev) + depth * Math.sin(elev)
      // Fill ~60% of the frame, leaving room for the UI panel and some context.
      const fit = Math.max(width / 2 / Math.tan(hfov / 2), height / 2 / Math.tan(vfov / 2)) / 0.6
      const dist = Math.max(0.7, fit + depth / 2)
      _cand.set(dx * Math.cos(elev), Math.sin(elev), dz * Math.cos(elev)).multiplyScalar(dist).add(_center)
      _cand.x = THREE.MathUtils.clamp(_cand.x, -ROOM.x, ROOM.x)
      _cand.z = THREE.MathUtils.clamp(_cand.z, -ROOM.z, ROOM.z)
      _cand.y = THREE.MathUtils.clamp(_cand.y, Math.max(ROOM.yMin, _center.y + 0.15), ROOM.yMax)
      // First mostly-clear view wins (candidates are in preference order); otherwise the
      // least-blocked one.
      const score = visibility(dx, dz)
      if (score > bestScore) {
        best = _cand.clone()
        bestScore = score
      }
      if (score >= probes.length - 1) {
        elevs.length = 0 // break both loops
        break
      }
    }
  }

  const target = _center.clone()
  // Narrow screens put the UI in a bottom sheet: lift the product into the top half.
  if (window.innerWidth <= 768) target.y -= Math.min(0.35, radius * 0.55)
  return { pos: best.toArray(), target: target.toArray() }
}

// ── Interactivity ─────────────────────────────────────────────────────────────
/** Slots the pointer can pick in the current mode. */
export function useInteractiveSlots() {
  const mode = useApp((s) => s.mode)
  const products = useApp((s) => s.products)
  return useMemo(() => {
    if (mode === 'create') return new Set(SLOTS.filter((s) => s.category).map((s) => s.id))
    if (mode === 'shop') return new Set(products.filter((p) => p.status !== 'failed').map((p) => p.slot))
    return new Set()
  }, [mode, products])
}

/** Pointer handlers for the garden <primitive>; undefined when nothing is interactive. */
export function useProductPointer(interactive) {
  const gl = useThree((s) => s.gl)
  const down = useRef(null)

  return useMemo(() => {
    if (!interactive.size) return {}
    const slotOf = (e) => {
      const slot = e.object?.userData.slot
      return slot && interactive.has(slot) ? slot : null
    }
    const hover = (slot) => {
      if (appStore.get().hoveredSlot !== slot) appStore.set({ hoveredSlot: slot })
      gl.domElement.style.cursor = slot ? 'pointer' : ''
    }
    return {
      onPointerMove(e) {
        // Intersections arrive nearest-first; the frame and furniture occlude products.
        e.stopPropagation()
        hover(slotOf(e))
      },
      onPointerOut() {
        hover(null)
      },
      onPointerDown(e) {
        down.current = { x: e.clientX, y: e.clientY }
      },
      onClick(e) {
        e.stopPropagation()
        const d = down.current
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP) return
        appStore.set({ selectedSlot: slotOf(e) })
      },
      onPointerMissed(e) {
        if (e.type === 'click' && appStore.get().selectedSlot) appStore.set({ selectedSlot: null })
      },
    }
  }, [interactive, gl])
}

/**
 * Non-visual: binds pattern textures, highlights, and the selection camera.
 * Mount once, inside the Canvas, after the garden meshes are registered.
 */
export function ProductEffects({ interactive }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const pendingFocus = useRef(undefined) // slot | null (= clear) | undefined (= nothing to do)

  useEffect(() => setPatternAnisotropy(Math.min(8, gl.capabilities.getMaxAnisotropy())), [gl])

  // Patterns follow products + preview.
  const products = useApp((s) => s.products)
  const preview = useApp((s) => s.preview)
  useEffect(() => {
    const map = slotTextureMap({ products, preview })
    for (const slot of slotMeshes.keys()) setPattern(slot, map[slot] ?? null)
  }, [products, preview])

  // Hover/selection -> highlight targets; selection -> camera.
  useEffect(() => {
    let lastSelected = appStore.get().selectedSlot
    applyHighlights()
    return appStore.subscribe(() => {
      applyHighlights()
      const sel = appStore.get().selectedSlot
      if (sel !== lastSelected) {
        lastSelected = sel
        // Deferred to the next frame so a same-tick tourStore.jumpTo (e.g. the UI's
        // selectSlot) lands first and the close-up wins.
        pendingFocus.current = sel
      }
    })
  }, [])

  // Hovered slot no longer pickable (mode change, product removed): drop it.
  useEffect(() => {
    const { hoveredSlot, selectedSlot } = appStore.get()
    const patch = {}
    if (hoveredSlot && !interactive.has(hoveredSlot)) patch.hoveredSlot = null
    if (selectedSlot && !interactive.has(selectedSlot) && !SLOT_BY_ID[selectedSlot]) patch.selectedSlot = null
    if (Object.keys(patch).length) appStore.set(patch)
    if (!interactive.size) gl.domElement.style.cursor = ''
  }, [interactive, gl])

  // The user scrolling / using the nav leaves the close-up: clear the selection.
  useEffect(() => {
    let seq = tourStore.userNavSeq
    return tourStore.subscribe(() => {
      if (tourStore.userNavSeq === seq) return
      seq = tourStore.userNavSeq
      if (appStore.get().selectedSlot) appStore.set({ selectedSlot: null })
    })
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && appStore.get().selectedSlot) appStore.set({ selectedSlot: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useFrame((_, delta) => {
    if (pendingFocus.current !== undefined) {
      const slot = pendingFocus.current
      pendingFocus.current = undefined
      if (slot) {
        const pose = computeSlotPose(slot, camera)
        if (pose) tourStore.focus(pose)
      } else {
        tourStore.returnToStop()
      }
    }
    const dt = Math.min(delta, 0.05)
    for (const o of outlines) stepOutline(o, dt)
    if (!animating.size) return
    for (const st of animating) if (!step(st, dt)) animating.delete(st)
  })

  useEffect(
    () => () => {
      // Unmount (HMR / route change): release every texture we hold.
      for (const st of states.values()) {
        if (st.aUrl) releasePattern(st.aUrl)
        if (st.bUrl) releasePattern(st.bUrl)
      }
      states.clear()
      animating.clear()
    },
    [],
  )

  return outlines.map((o, i) => <primitive key={i} object={o.mesh} />)
}
