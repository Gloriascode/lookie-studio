// The conservatory from ixi (canvas "Lookie", model3d "glass garden"), optimised by
// scripts/optimize-scene.mjs. The export carries flat CAD colours; here every mesh gets a
// material by role so the room reads as painted iron, glazed tile, glass and linen.
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SLOT_BY_ID } from '../slots'
import { makeProductMaterial, withVertexAo } from './productMaterial'
import { setPatternAnisotropy } from './patternTextures'
import { ProductEffects, registerSlotMesh, unregisterSlotMeshes, useInteractiveSlots, useProductPointer } from './Products'
import { keepGLTF } from './dispose'
import { SCENE_BY_ID } from '../scenes'

export const GARDEN_URL = SCENE_BY_ID.garden.model

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
      // Fabric presets in productMaterial.js set roughness/sheen per product.
      sheen: 1,
      sheenRoughness: 0.75,
      // Matte cloth: the bright sky reflected at full strength greys out dark prints.
      envMapIntensity: 0.8,
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
  const gl = useThree((s) => s.gl)
  const interactive = useInteractiveSlots('garden')

  // Prints are viewed at grazing angles a lot (tablecloth, duvet): use all the anisotropy
  // the GPU offers. Runs after ProductEffects' own default (child effects run first).
  useEffect(() => setPatternAnisotropy(gl.capabilities.getMaxAnisotropy()), [gl])
  const pointer = useProductPointer(interactive)

  useLayoutEffect(() => {
    const registered = []
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
        const attrs = o.geometry.attributes
        o.material = makeProductMaterial(materials.product, SLOT_BY_ID[o.userData.slot], { hasUv: !!attrs.uv, hasAo: !!attrs._ao })
        o.material.name = `product:${product}`
      } else {
        // Baked vertex AO (from the asset pipeline) when this mesh carries it.
        o.material = o.geometry.attributes._ao && role !== 'glass' ? withVertexAo(materials[role]) : materials[role]
      }

      const isGlass = role === 'glass'
      o.castShadow = !isGlass
      o.receiveShadow = !isGlass
      if (isGlass) o.renderOrder = 2
      if (NO_RAYCAST.has(role)) o.raycast = noRaycast
      if (role === 'product' && o.userData.slot) {
        registerSlotMesh(o.userData.slot, o)
        registered.push(o)
      }
      // Static scene: compute matrices once, then stop three from recomputing them every frame.
      o.updateMatrixWorld(true)
      o.matrixAutoUpdate = false
    })
    scene.updateMatrixWorld(true)
    scene.matrixAutoUpdate = false
    return () => unregisterSlotMeshes(registered)
  }, [scene, materials])

  // Leaving the conservatory (room switch): free its GPU memory.
  useEffect(() => keepGLTF(GARDEN_URL, scene), [scene])

  return (
    <>
      <primitive object={scene} {...props} {...pointer} />
      <ProductEffects interactive={interactive} />
    </>
  )
}

