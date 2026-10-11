// The conservatory from ixi (canvas "Lookie", model3d "glass garden"), optimised by
// scripts/optimize-garden.mjs. The export carries flat CAD colours; here every mesh gets a
// material by role so the room reads as painted iron, glazed tile, glass and linen.
import { useLayoutEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { SLOT_BY_ID } from '../slots'
import { makeProductMaterial } from './productMaterial'
import { ProductEffects, slotMeshes, useInteractiveSlots, useProductPointer } from './Products'

export const GARDEN_URL = '/models/glass-garden.glb'

function makeMaterials() {
  return {
    // Thin float glass: no transmission pass (it re-renders the scene), just a faint tint with
    // strong environment reflections, which is most of what reads as "glass" at a glance.
    glass: new THREE.MeshPhysicalMaterial({
      name: 'glass',
      color: '#eaf5f2',
      transparent: true,
      opacity: 0.1,
      roughness: 0.03,
      metalness: 0,
      ior: 1.5,
      specularIntensity: 1,
      envMapIntensity: 2.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    // Painted cast iron.
    frame: new THREE.MeshStandardMaterial({ name: 'frame', color: '#f2efe8', roughness: 0.42, metalness: 0.05 }),
    // Victorian encaustic floor: terracotta squares + glazed cream diamonds on dark grout.
    terracotta: new THREE.MeshStandardMaterial({ name: 'terracotta', color: '#c4683f', roughness: 0.62 }),
    glazed: new THREE.MeshStandardMaterial({ name: 'glazed', color: '#efe7da', roughness: 0.22 }),
    grout: new THREE.MeshStandardMaterial({ name: 'grout', color: '#2b2824', roughness: 0.92 }),
    // Painted furniture (not for sale).
    furniture: new THREE.MeshStandardMaterial({ name: 'furniture', color: '#f3efe8', roughness: 0.55 }),
    wood: new THREE.MeshStandardMaterial({ name: 'wood', color: '#7a4f2a', roughness: 0.8 }),
    // Blank product: soft undyed linen with a little sheen. Cloned per product mesh so each
    // can take its own print later.
    product: new THREE.MeshPhysicalMaterial({
      name: 'product',
      color: '#fbf9f4',
      roughness: 0.85,
      sheen: 0.6,
      sheenRoughness: 0.75,
      sheenColor: new THREE.Color('#ffffff'),
    }),
  }
}

// GLTFLoader sanitises node names (spaces -> underscores, duplicates get _1, _2...).
function roleFor(rawName) {
  const name = rawName.replace(/_/g, ' ')
  if (/^Glass /.test(name)) return 'glass'
  if (/^(White frame|Knee wall|Arches|Arched ribs)/.test(name)) return 'frame'
  if (/^Orange tiles/.test(name)) return 'terracotta'
  if (/^White diamond/.test(name)) return 'glazed'
  if (/^Grout/.test(name)) return 'grout'
  if (/^Strut /.test(name)) return 'wood'
  if (/^(Cutout |Rug top)/.test(name)) return 'textured'
  return 'furniture'
}

// Pointer rays skip these: they sit below/behind everything or are see-through cut-outs.
// Frame and furniture stay pickable so they occlude the products behind them.
const NO_RAYCAST = new Set(['glass', 'grout', 'terracotta', 'glazed', 'wood', 'textured'])
const noRaycast = () => {}

export function GlassGarden(props) {
  const { scene } = useGLTF(GARDEN_URL)
  const materials = useMemo(makeMaterials, [])
  const interactive = useInteractiveSlots()
  const pointer = useProductPointer(interactive)

  useLayoutEffect(() => {
    scene.traverse((o) => {
      if (!o.isMesh) return
      const product = o.userData.product
      const role = product ? 'product' : roleFor(o.name)

      if (role === 'textured') {
        // Keep the baked artwork; cutouts were switched to alpha MASK in the optimiser.
        const src = o.material
        o.material = new THREE.MeshStandardMaterial({
          name: o.name,
          map: src.map,
          alphaTest: src.alphaTest || 0,
          transparent: false,
          side: src.side,
          roughness: 0.9,
        })
        if (src.map) src.map.anisotropy = 8
      } else if (role === 'product') {
        o.material = makeProductMaterial(materials.product, SLOT_BY_ID[o.userData.slot])
        o.material.name = `product:${product}`
      } else {
        o.material = materials[role]
      }

      const isGlass = role === 'glass'
      o.castShadow = !isGlass
      o.receiveShadow = !isGlass
      if (isGlass) o.renderOrder = 2
      if (NO_RAYCAST.has(role)) o.raycast = noRaycast
      if (role === 'product' && o.userData.slot) slotMeshes.set(o.userData.slot, o)
      // Static scene: compute matrices once, then stop three from recomputing them every frame.
      o.updateMatrixWorld(true)
      o.matrixAutoUpdate = false
    })
    scene.updateMatrixWorld(true)
    scene.matrixAutoUpdate = false
  }, [scene, materials])

  return (
    <>
      <primitive object={scene} {...props} {...pointer} />
      <ProductEffects interactive={interactive} />
    </>
  )
}

useGLTF.preload(GARDEN_URL)
