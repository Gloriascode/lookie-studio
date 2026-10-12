// Procedural trees from ez-tree (github.com/dgreenheck/ez-tree, MIT).
// - ez-tree is code-split and only imported after the first frame, so it never delays the
//   conservatory appearing
// - each species is generated ONCE (one per idle slice, so generation never janks the tour),
//   then drawn everywhere it grows as two InstancedMeshes: branches + leaves
// - ez-tree's Phong materials are swapped for PBR ones that pick up the sky lighting; leaves
//   get the same world-space wind as the grass
import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { applyWind } from './wind'
import { useShadowRefresh } from './Lighting'
import { mulberry32 } from './layout'

// species: ez-tree preset, seed, target height (m)
const SPECIES = {
  oak: { preset: 'Oak Medium', seed: 1207, height: 11 },
  ash: { preset: 'Ash Medium', seed: 77, height: 13 },
  aspen: { preset: 'Aspen Medium', seed: 512, height: 10 },
  pine: { preset: 'Pine Medium', seed: 9, height: 15 },
  bush: { preset: 'Bush 1', seed: 3, height: 1.5 },
  bush2: { preset: 'Bush 2', seed: 21, height: 1.2 },
}

// Hand-placed for composition (entrance faces +Z, path runs out along +Z):
// a grove behind, loose groups at the sides, a pair framing the approach, pines on the horizon,
// and shrubs anchoring the conservatory's corners.
const PLANTING = [
  // grove behind
  ['oak', -6, -14], ['ash', 3, -17], ['oak', 11, -12], ['aspen', -13, -9], ['ash', -2, -25], ['oak', 9, -26],
  // sides
  ['aspen', 15, -2], ['oak', 19, 6], ['ash', -17, 3], ['aspen', -20, 12],
  // framing the approach (kept clear of the path and the approach camera)
  ['aspen', -8.5, 19], ['oak', 10.5, 27],
  // horizon pines
  ['pine', -30, -22], ['pine', -24, -34], ['pine', 26, -30], ['pine', 36, -8], ['pine', -38, 8], ['pine', 33, 22], ['pine', -28, 30],
  // shrubs at the corners and along the sides
  ['bush', -4.7, -5.3], ['bush2', 4.8, -5.2], ['bush', 5.0, 5.4], ['bush2', -5.0, 5.3], ['bush', -5.1, 0.5], ['bush2', 5.2, -1.2],
]

function dispose(meshes) {
  meshes.forEach((m) => {
    m.geometry.dispose()
    m.material.dispose()
    m.dispose()
  })
}

/** Yield to the browser between expensive steps. */
const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 400 }) : setTimeout(r, 30)))

function pbrMaterials(tree) {
  const bark = tree.branchesMesh.material
  const leaf = tree.leavesMesh.material
  const barkMat = new THREE.MeshStandardMaterial({
    name: 'bark',
    color: bark.color,
    map: bark.map ?? null,
    normalMap: bark.normalMap ?? null,
    aoMap: bark.aoMap ?? null,
    roughnessMap: bark.roughnessMap ?? null,
    roughness: 1,
  })
  const leafMat = new THREE.MeshStandardMaterial({
    name: 'leaves',
    color: leaf.color,
    map: leaf.map,
    alphaTest: leaf.alphaTest || 0.5,
    side: THREE.DoubleSide,
    roughness: 0.75,
  })
  applyWind(leafMat, { weight: 'uv', amount: 0.35 })
  bark.dispose()
  leaf.dispose()
  return { barkMat, leafMat }
}

async function growSpecies(EzTree, key, rand, planting, castShadow) {
  const s = SPECIES[key]
  const tree = new EzTree.Tree()
  tree.loadFromJson({ ...structuredClone(EzTree.TreePreset[s.preset]), seed: s.seed })
  const { barkMat, leafMat } = pbrMaterials(tree)

  const branches = tree.branchesMesh.geometry
  const leaves = tree.leavesMesh.geometry
  branches.computeBoundingBox()
  leaves.computeBoundingBox()
  const box = branches.boundingBox.clone().union(leaves.boundingBox)
  const scale = s.height / (box.max.y - box.min.y)

  const spots = planting.filter(([k]) => k === key)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const matrices = spots.map(([, x, z]) => {
    const sc = scale * (0.85 + rand() * 0.3)
    return m.compose(new THREE.Vector3(x, -0.08, z), q.setFromAxisAngle(up, rand() * Math.PI * 2), new THREE.Vector3(sc, sc, sc)).clone()
  })

  const make = (geometry, material) => {
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length)
    matrices.forEach((mat, i) => mesh.setMatrixAt(i, mat))
    mesh.computeBoundingSphere()
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    mesh.matrixAutoUpdate = false
    return mesh
  }
  return { key, meshes: [make(branches, barkMat), make(leaves, leafMat)] }
}

/**
 * @param {object} props
 * @param {Array<[string, number, number]>} [props.planting]  [species, x, z] (default: the
 *   conservatory's garden)
 * @param {boolean} [props.castShadow]  false for trees outside a room's shadow frustum
 */
export function Trees({ planting = PLANTING, castShadow = true }) {
  const [grown, setGrown] = useState([])
  const refreshShadows = useShadowRefresh()

  useEffect(() => {
    let cancelled = false
    const meshes = []
    ;(async () => {
      await idle()
      const EzTree = await import('ez-tree-src/index.js')
      const rand = mulberry32(99)
      // Nearest-first, so the shrubs and the grove behind the glass appear before the horizon.
      const wanted = new Set(planting.map(([k]) => k))
      for (const key of ['bush', 'bush2', 'oak', 'ash', 'aspen', 'pine'].filter((k) => wanted.has(k))) {
        await idle()
        if (cancelled) return
        const species = await growSpecies(EzTree, key, rand, planting, castShadow)
        meshes.push(...species.meshes)
        // Room left while this species was growing: the cleanup below already ran.
        if (cancelled) return dispose(species.meshes)
        setGrown((g) => [...g, species])
        refreshShadows()
      }
      // Leaf cut-outs only reach the shadow map once their textures are in.
      const { texturesSettled } = await import('./ezTreeTextures.js')
      await texturesSettled()
      if (!cancelled) refreshShadows()
    })()
    return () => {
      cancelled = true
      dispose(meshes)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <group>
      {grown.flatMap((s) => s.meshes.map((mesh, i) => <primitive key={`${s.key}-${i}`} object={mesh} />))}
    </group>
  )
}
