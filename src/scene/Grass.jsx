// Instanced grass clumps (ez-tree's grass.glb card) split into a grid of chunks:
//  - each chunk is its own InstancedMesh with a tight bounding sphere, so chunks behind the
//    camera are frustum-culled
//  - instances inside a chunk are shuffled, so lowering `count` thins the chunk evenly; we
//    use that for distance LOD (recomputed only when the camera moves) and quality tiers
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { applyWind } from './wind'
import { useQuality } from '../perf/quality'
import { LAWN_RADIUS, buildingDist, inBed, mulberry32, noise2, onPath } from './layout'

const CHUNK = 7 // metres
const DENSITY = 30 // clump attempts per m², before patchiness and quality scaling
const CLUMP_HEIGHT = [0.2, 0.42] // metres

function buildChunks(rand) {
  const chunks = new Map()
  const area = Math.PI * LAWN_RADIUS * LAWN_RADIUS
  const attempts = Math.round(area * DENSITY * 0.55)
  for (let i = 0; i < attempts; i++) {
    // Denser near the conservatory, where the camera spends its time.
    const r = 3.3 + Math.pow(rand(), 1.6) * (LAWN_RADIUS - 3.3)
    const a = rand() * Math.PI * 2
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (buildingDist(x, z) < 0.12 || inBed(x, z) || onPath(x, z, 0.05)) continue
    // Patchy meadow: thin out in low-noise areas, keep a lush ring around the building.
    const patch = noise2(x * 0.18, z * 0.18)
    if (rand() > 0.35 + patch * 0.9) continue
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`
    let c = chunks.get(key)
    if (!c) chunks.set(key, (c = { items: [], center: new THREE.Vector3() }))
    c.items.push([x, z, patch])
  }
  return [...chunks.values()]
}

export function Grass() {
  const { scene: src } = useGLTF('/nature/grass.glb')
  const q = useQuality()
  const camera = useThree((s) => s.camera)

  const { geometry, material } = useMemo(() => {
    const srcMesh = src.getObjectByProperty('isMesh', true)
    const geometry = srcMesh.geometry.clone()
    geometry.computeBoundingBox()
    // Normalise: clump base at y=0, height 1, so instance Y scale == height in metres.
    const h = geometry.boundingBox.max.y - geometry.boundingBox.min.y
    geometry.translate(0, -geometry.boundingBox.min.y, 0)
    geometry.scale(1 / h, 1 / h, 1 / h)
    const material = new THREE.MeshLambertMaterial({
      name: 'grass',
      map: srcMesh.material.map,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      color: '#ffffff',
    })
    material.map.colorSpace = THREE.SRGBColorSpace
    applyWind(material, { weight: 'height', height: 1, amount: 1 })
    return { geometry, material }
  }, [src])

  const chunks = useMemo(() => {
    const rand = mulberry32(7)
    const m = new THREE.Matrix4()
    const quat = new THREE.Quaternion()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    const color = new THREE.Color()
    const up = new THREE.Vector3(0, 1, 0)
    return buildChunks(rand).map((c) => {
      // Shuffle so any prefix of the instance buffer is an even subsample.
      for (let i = c.items.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[c.items[i], c.items[j]] = [c.items[j], c.items[i]]
      }
      const mesh = new THREE.InstancedMesh(geometry, material, c.items.length)
      c.items.forEach(([x, z, patch], i) => {
        const h = THREE.MathUtils.lerp(CLUMP_HEIGHT[0], CLUMP_HEIGHT[1], rand()) * (0.75 + patch * 0.5)
        const w = h * (0.8 + rand() * 0.6)
        quat.setFromAxisAngle(up, rand() * Math.PI * 2)
        m.compose(pos.set(x, -0.07, z), quat, scl.set(w, h, w))
        mesh.setMatrixAt(i, m)
        // Linear colour, matched to the lawn shader: lush green, a little sun-dried in places.
        const dry = rand() * 0.6 + (1 - patch) * 0.4
        color.setRGB(0.12 + dry * 0.12, 0.3 + rand() * 0.1, 0.04 + dry * 0.03)
        mesh.setColorAt(i, color)
        c.center.x += x / c.items.length
        c.center.z += z / c.items.length
      })
      mesh.computeBoundingSphere()
      mesh.receiveShadow = true
      mesh.castShadow = false // thousands of alpha-tested cards in the shadow pass: not worth it
      mesh.matrixAutoUpdate = false
      c.mesh = mesh
      c.max = c.items.length
      return c
    })
  }, [geometry, material])

  useEffect(() => () => chunks.forEach((c) => c.mesh.dispose()), [chunks])

  // Distance LOD: full density within 12 m, fading to 12% at the lawn edge.
  const lastCam = useRef(new THREE.Vector3(Infinity, 0, 0))
  const lastTier = useRef(-1)
  useFrame(() => {
    if (camera.position.distanceToSquared(lastCam.current) < 0.25 && lastTier.current === q.grass) return
    lastCam.current.copy(camera.position)
    lastTier.current = q.grass
    for (const c of chunks) {
      const d = Math.hypot(c.center.x - camera.position.x, c.center.z - camera.position.z)
      const lod = THREE.MathUtils.clamp(1 - (d - 12) / 40, 0.12, 1)
      c.mesh.count = Math.max(1, Math.floor(c.max * lod * q.grass))
    }
  })

  return (
    <group>
      {chunks.map((c, i) => (
        <primitive key={i} object={c.mesh} />
      ))}
    </group>
  )
}

useGLTF.preload('/nature/grass.glb')
