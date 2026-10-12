// The bedroom from ixi (canvas "Lookie", model3d "bedroom scene"), optimised by
// scripts/optimize-scene.mjs into public/models/bedroom.glb (root "Bedroom", Y-up metres).
// Like the conservatory, every mesh gets a material by role; the products share the same
// fabric material path (patterns, weave, AO, hover/selection) through Products.jsx.
import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SLOT_BY_ID } from '../slots'
import { SCENE_BY_ID } from '../scenes'
import { makeProductMaterial, withVertexAo } from './productMaterial'
import { setPatternAnisotropy } from './patternTextures'
import { ProductEffects, registerSlotMesh, unregisterSlotMeshes, useInteractiveSlots, useProductPointer } from './Products'
import { keepGLTF } from './dispose'

export const BEDROOM_URL = SCENE_BY_ID.bedroom.model

function makeMaterials() {
  const std = (name, color, roughness, extra = {}) => new THREE.MeshStandardMaterial({ name, color, roughness, ...extra })
  return {
    // Warm limewash plaster; the ceiling a touch lighter so the room doesn't feel boxed in.
    wall: std('plaster', '#ece2d4', 0.93),
    ceiling: std('ceiling', '#f4efe7', 0.95),
    bathroom: std('bathroom', '#e4ded4', 0.9),
    // Honey oak boards; the seams/joints between them are a separate darker mesh.
    oak: std('oak', '#c69a6a', 0.55),
    seam: std('oak-seam', '#5a4130', 0.8),
    trim: std('trim', '#f5f1ea', 0.42),
    vanity: std('vanity', '#e8e0d3', 0.6),
    mirror: std('mirror', '#d7dfdf', 0.06, { metalness: 0.9 }),
    ground: std('lawn', '#6f8d4c', 1),
    glass: new THREE.MeshPhysicalMaterial({
      name: 'glass',
      color: '#eef6f4',
      transparent: true,
      opacity: 0.08,
      roughness: 0.03,
      ior: 1.5,
      specularIntensity: 1,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    // Furniture arrives with vertex colours from ixi (cream upholstery, black legs, brass lamp
    // bases); keep them, on a slightly soft painted/upholstered finish.
    furniture: std('furniture', '#ffffff', 0.62, { vertexColors: true }),
    furniturePlain: std('furniture-plain', '#f1ece3', 0.6),
    product: new THREE.MeshPhysicalMaterial({
      name: 'product',
      color: '#fbf9f4',
      roughness: 0.85,
      sheen: 1,
      sheenRoughness: 0.75,
      envMapIntensity: 0.8,
      sheenColor: new THREE.Color('#ffffff'),
    }),
  }
}

// GLTFLoader sanitises node names (spaces -> underscores, repeats get _1, _2...).
const clean = (raw) => raw.replace(/_/g, ' ').replace(/ \d+$/, '').trim()

function roleFor(rawName, geometry) {
  const name = clean(rawName)
  if (name === 'Wall') return 'wall'
  if (name === 'Ceiling') return 'ceiling'
  if (/^Bathroom/.test(name)) return 'bathroom'
  if (name === 'Oak floor') return 'oak'
  if (/^Plank (seams|joints)/.test(name)) return 'seam'
  if (/^Garden ground/.test(name)) return 'ground'
  if (name === 'White trim') return 'trim'
  if (name === 'Window glass') return 'glass'
  if (name === 'Vanity') return 'vanity'
  if (name === 'Mirror') return 'mirror'
  // Printed pieces that aren't for sale keep their own artwork.
  if (/^(Rug top|Bench upholstery)/.test(name)) return 'textured'
  return geometry.attributes.color ? 'furniture' : 'furniturePlain'
}

// Pointer rays skip what can't hide a product: glass, the floor, the ground and the shell
// around the room (walls stay pickable so they occlude, e.g. the bathroom behind the door).
const NO_RAYCAST = new Set(['glass', 'oak', 'seam', 'ground', 'textured', 'ceiling'])
const noRaycast = () => {}
// Big flat shells: they receive light and AO but needn't fill the shadow map's precision.
const NO_CAST = new Set(['glass', 'ground', 'seam'])

export function Bedroom(props) {
  const { scene } = useGLTF(BEDROOM_URL)
  const materials = useMemo(makeMaterials, [])
  const gl = useThree((s) => s.gl)
  const interactive = useInteractiveSlots('bedroom')

  useEffect(() => setPatternAnisotropy(gl.capabilities.getMaxAnisotropy()), [gl])
  const pointer = useProductPointer(interactive)

  useLayoutEffect(() => {
    const registered = []
    // One material per slot: a slot spanning several meshes (the two drapes) shares it, so
    // patterns and highlights land on all of them at once.
    const slotMaterials = new Map()
    scene.traverse((o) => {
      if (!o.isMesh) return
      const slotId = o.userData.slot
      const attrs = o.geometry.attributes
      const role = slotId && SLOT_BY_ID[slotId] ? 'product' : roleFor(o.name, o.geometry)

      if (role === 'product') {
        let m = slotMaterials.get(slotId)
        if (!m) {
          m = makeProductMaterial(materials.product, SLOT_BY_ID[slotId], { hasUv: !!attrs.uv, hasAo: !!attrs._ao })
          m.name = `product:${slotId}`
          slotMaterials.set(slotId, m)
        }
        o.material = m
        registerSlotMesh(slotId, o)
        registered.push(o)
      } else if (role === 'textured') {
        const src = o.material
        if (src.map) src.map.anisotropy = 8
        const m = new THREE.MeshStandardMaterial({ name: o.name, map: src.map ?? null, roughness: 0.9 })
        o.material = attrs._ao ? withVertexAo(m) : m
      } else {
        const base = materials[role]
        o.material = attrs._ao && role !== 'glass' ? withVertexAo(base) : base
      }

      const isGlass = role === 'glass'
      o.castShadow = !NO_CAST.has(role)
      o.receiveShadow = !isGlass
      if (isGlass) o.renderOrder = 2
      if (NO_RAYCAST.has(role)) o.raycast = noRaycast
      o.updateMatrixWorld(true)
      o.matrixAutoUpdate = false
    })
    scene.updateMatrixWorld(true)
    scene.matrixAutoUpdate = false
    return () => unregisterSlotMeshes(registered)
  }, [scene, materials])

  // Leaving the bedroom (room switch): free its GPU memory.
  useEffect(() => keepGLTF(BEDROOM_URL, scene), [scene])

  return (
    <>
      <primitive object={scene} {...props} {...pointer} />
      <ProductEffects interactive={interactive} />
    </>
  )
}
