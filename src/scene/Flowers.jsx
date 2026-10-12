// ez-tree's three demo flowers (MIT), instanced. The demo clones a full mesh per flower;
// here each flower's sub-meshes become one InstancedMesh apiece, so every flower of a
// variety costs the same handful of draw calls whether there are 10 or 1000.
// Placement is drift-planted: colours come in clumps (noise), the way beds are planted.
import { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { applyWind } from './wind'
import { useQuality } from '../perf/quality'
import { BEDS, BUILDING, LAWN_RADIUS, PATH, buildingDist, inBed, mulberry32, noise2, onPath } from './layout'

const VARIETIES = ['/nature/flower_white.glb', '/nature/flower_blue.glb', '/nature/flower_yellow.glb']

/** Flatten a flower GLB into [{ geometry, material }] parts, base at y=0, height 1. */
function extractParts(scene) {
  scene.updateMatrixWorld(true)
  const parts = []
  const box = new THREE.Box3()
  scene.traverse((o) => {
    if (!o.isMesh) return
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld)
    g.computeBoundingBox()
    box.union(g.boundingBox)
    const src = o.material
    const material = new THREE.MeshLambertMaterial({ name: src.name, color: src.color, map: src.map ?? null, side: THREE.DoubleSide })
    if (material.map) material.map.colorSpace = THREE.SRGBColorSpace
    parts.push({ geometry: g, material })
  })
  const h = box.max.y - box.min.y
  const cx = (box.min.x + box.max.x) / 2
  const cz = (box.min.z + box.max.z) / 2
  for (const p of parts) {
    p.geometry.translate(-cx, -box.min.y, -cz)
    p.geometry.scale(1 / h, 1 / h, 1 / h)
    applyWind(p.material, { weight: 'height', height: 1, amount: 0.55 })
  }
  return parts
}

/** Returns [variety, x, z, height] tuples, deterministic. */
function plant() {
  const rand = mulberry32(42)
  const out = []
  const variety = (x, z) => {
    // Colour drifts: noise picks the dominant variety, with a little mixing at the edges.
    const n = noise2(x * 0.45 + 11, z * 0.45 - 3)
    const jitter = (rand() - 0.5) * 0.25
    return Math.min(2, Math.floor(THREE.MathUtils.clamp(n + jitter, 0, 0.999) * 3))
  }

  // 1. Beds around the plinth: dense.
  const bedOuterX = BEDS.innerX + BEDS.width
  const bedOuterZ = BEDS.innerZ + BEDS.width
  for (let i = 0; i < 900; i++) {
    const x = (rand() * 2 - 1) * bedOuterX
    const z = (rand() * 2 - 1) * bedOuterZ
    if (!inBed(x, z)) continue
    out.push([variety(x, z), x, z, 0.32 + rand() * 0.22])
  }
  // 2. Borders along both sides of the path.
  for (let z = PATH.start + 0.6; z < 19; z += 0.22) {
    for (const side of [-1, 1]) {
      if (rand() < 0.25) continue
      const x = side * (PATH.halfWidth + 0.2 + rand() * 0.45)
      out.push([variety(x, z), x, z + (rand() - 0.5) * 0.15, 0.25 + rand() * 0.18])
    }
  }
  // 3. Wildflower patches in the lawn.
  for (let i = 0; i < 2600; i++) {
    const r = BUILDING.halfZ + 2 + Math.pow(rand(), 1.3) * (LAWN_RADIUS * 0.7)
    const a = rand() * Math.PI * 2
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (onPath(x, z, 0.6) || buildingDist(x, z) < BEDS.width + 0.6) continue
    if (noise2(x * 0.22 + 5, z * 0.22 + 9) < 0.68) continue
    out.push([variety(x, z), x, z, 0.2 + rand() * 0.2])
  }
  // Shuffle so quality tiers can take an even prefix.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function Flowers() {
  const gltfs = useGLTF(VARIETIES)
  const q = useQuality()
  const planted = useMemo(plant, [])

  const groups = useMemo(() => {
    const rand = mulberry32(5)
    const m = new THREE.Matrix4()
    const quat = new THREE.Quaternion()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    const euler = new THREE.Euler()

    return gltfs.map((gltf, v) => {
      const mine = planted.filter((p) => p[0] === v)
      const matrices = mine.map(([, x, z, h]) => {
        // A slight random lean so rows don't look combed.
        euler.set((rand() - 0.5) * 0.25, rand() * Math.PI * 2, (rand() - 0.5) * 0.25)
        return m.compose(pos.set(x, -0.075, z), quat.setFromEuler(euler), scl.setScalar(h)).clone()
      })
      const meshes = extractParts(gltf.scene).map(({ geometry, material }) => {
        const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, matrices.length))
        matrices.forEach((mat, i) => mesh.setMatrixAt(i, mat))
        mesh.computeBoundingSphere()
        mesh.castShadow = false
        mesh.receiveShadow = true
        mesh.matrixAutoUpdate = false
        return mesh
      })
      return { meshes, max: matrices.length }
    })
  }, [gltfs, planted])

  useEffect(() => {
    for (const g of groups) for (const mesh of g.meshes) mesh.count = Math.floor(g.max * q.flowers)
  }, [groups, q.flowers])

  // Each part's geometry and material were cloned for instancing: free them with the meshes.
  useEffect(
    () => () =>
      groups.forEach((g) =>
        g.meshes.forEach((m) => {
          m.geometry.dispose()
          m.material.dispose()
          m.dispose()
        }),
      ),
    [groups],
  )

  return (
    <group>
      {groups.flatMap((g, i) => g.meshes.map((mesh, j) => <primitive key={`${i}-${j}`} object={mesh} />))}
    </group>
  )
}

useGLTF.preload(VARIETIES)
