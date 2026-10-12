// Dev-only helpers (`?dev`): FPS/draw-call stats, and a free camera for framing tour stops.
//   O  toggle orbit controls (starts from the current tour pose)
//   P  log the current camera as a STOPS entry ({ pos, target })
import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Stats } from '@react-three/drei'
import { getTourTarget } from './tour/ScrollCameraDirector'
import { tourStore } from './tour/tourStore'

const r = (n) => Math.round(n * 100) / 100

function RendererInfo() {
  const gl = useThree((s) => s.gl)
  const el = useRef()
  useEffect(() => {
    const div = document.createElement('div')
    div.className = 'dev-info'
    document.body.appendChild(div)
    el.current = div
    return () => div.remove()
  }, [])
  let n = 0
  useFrame(() => {
    if (++n % 30 || !el.current) return
    const { calls, triangles } = gl.info.render
    el.current.textContent = `calls ${calls} · tris ${(triangles / 1000).toFixed(0)}k · dpr ${gl.getPixelRatio()}`
  })
  return null
}

/** Triangles per material across the scene (instanced counts included), for budgeting. */
function triangleBudget(scene) {
  const out = {}
  scene.traverseVisible((o) => {
    if (!o.isMesh) return
    const g = o.geometry
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3
    const n = o.isInstancedMesh ? o.count : 1
    const key = o.material?.name || o.name || o.type
    out[key] = (out[key] ?? 0) + Math.round(tris * n)
  })
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]))
}

export function DevTools({ onOrbitChange }) {
  const [orbit, setOrbit] = useState(false)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  const controls = useRef()

  useEffect(() => {
    window.__three = { scene, gl, camera, triangleBudget: () => triangleBudget(scene) }
    // Also in production builds (?dev only), so perf scripts can drive the tour.
    window.__tour = tourStore
  }, [scene, gl, camera])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'o' || e.key === 'O') setOrbit((o) => !o)
      if (e.key === 'p' || e.key === 'P') {
        const t = controls.current?.target ?? { x: 0, y: 0, z: 0 }
        console.log(`pos: [${r(camera.position.x)}, ${r(camera.position.y)}, ${r(camera.position.z)}],\ntarget: [${r(t.x)}, ${r(t.y)}, ${r(t.z)}],`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [camera])

  useEffect(() => onOrbitChange?.(orbit), [orbit, onOrbitChange])

  return (
    <>
      <Stats />
      <RendererInfo />
      {orbit && <OrbitControls ref={controls} makeDefault target={getTourTarget()} enableDamping />}
    </>
  )
}
