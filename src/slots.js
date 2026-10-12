// Product slots: the dressable items in each room. Shared by the GLB pipeline
// (scripts/optimize-scene.mjs tags meshes with extras.slot = id), the 3D scene (hover /
// click / pattern textures), the studio + shop UI, and the worker (Arcade category lookup).
// One shop spans every room: products are keyed by slot id, so ids are unique across rooms.
//
//   id         stable key stored in D1 (shop_products.slot); never rename a live one
//   scene      which room it lives in (src/scenes.js)
//   mesh       node name in that room's ixi export; an array when one product is several
//              meshes (a pair of curtain panels, two matching armchair pillows)
//   label      shown in the UI
//   category   Arcade print category name (`categories/list` .name); null = display only
//   repeat     metres per pattern tile for the 3D preview (triplanar projection)
//   stop       tour stop id that frames it best (src/tour/stops.js, same scene)
export const SLOTS = [
  { id: 'lounge-pillow', scene: 'garden', mesh: 'Decorative pillow', label: 'Decorative pillow', category: 'Decorative Pillows', repeat: 0.2, stop: 'lounge' },
  { id: 'lumbar-pillow', scene: 'garden', mesh: 'Outdoor lumbar pillow', label: 'Lumbar pillow', category: 'Outdoor Decorative Pillows', repeat: 0.2, stop: 'armchair' },
  { id: 'scarf', scene: 'garden', mesh: 'Silk scarf (on armchair B)', label: 'Silk scarf', category: 'Scarves', repeat: 0.16, stop: 'armchair' },
  { id: 'floor-pillow', scene: 'garden', mesh: 'Floor pillow', label: 'Floor pillow', category: 'Floor Pillows', repeat: 0.28, stop: 'lounge' },
  { id: 'curtains', scene: 'garden', mesh: 'Curtains', label: 'Curtains', category: 'Curtains', repeat: 0.42, stop: 'lounge' },
  { id: 'lampshade', scene: 'garden', mesh: 'Rectangular lampshade', label: 'Lampshade', category: 'Rectangular Lampshades', repeat: 0.18, stop: 'lounge' },
  { id: 'rug', scene: 'garden', mesh: 'Rug top', label: 'Rug', category: null, repeat: 0.8, stop: 'lounge' },
  { id: 'tablecloth', scene: 'garden', mesh: 'Tablecloth', label: 'Tablecloth', category: 'Tablecloths', repeat: 0.34, stop: 'dining' },
  { id: 'placemats', scene: 'garden', mesh: 'Placemats ×4', label: 'Placemats', category: 'Placemats', repeat: 0.2, stop: 'dining' },
  { id: 'napkins', scene: 'garden', mesh: 'Napkins ×4', label: 'Napkins', category: 'Napkins', repeat: 0.14, stop: 'dining' },
  { id: 'tea-towel', scene: 'garden', mesh: 'Tea towel', label: 'Tea towel', category: 'Tea Towels', repeat: 0.18, stop: 'tea' },
  { id: 'fabric-bolt', scene: 'garden', mesh: 'Fabric by the yard (bolt)', label: 'Fabric by the yard', category: 'Fabric By The Yard', repeat: 0.16, stop: 'tea' },
  { id: 'duvet', scene: 'garden', mesh: 'Duvet', label: 'Duvet', category: 'Duvets', repeat: 0.42, stop: 'daybed' },
  { id: 'quilt', scene: 'garden', mesh: 'Quilt', label: 'Quilt', category: 'Quilts', repeat: 0.32, stop: 'daybed' },
  { id: 'shams', scene: 'garden', mesh: 'Shams ×2', label: 'Shams', category: 'Shams', repeat: 0.24, stop: 'daybed' },
  { id: 'quilted-shams', scene: 'garden', mesh: 'Quilted shams ×2', label: 'Quilted shams', category: 'Quilted Shams', repeat: 0.24, stop: 'daybed' },
  { id: 'daybed-pillow', scene: 'garden', mesh: 'Decorative pillow (daybed)', label: 'Daybed pillow', category: 'Decorative Pillows', repeat: 0.2, stop: 'daybed' },

  // ── Bedroom (ixi model3d-1718adt "bedroom scene") ──
  { id: 'bed-duvet', scene: 'bedroom', mesh: 'Duvet', label: 'Duvet', category: 'Duvets', repeat: 0.42, stop: 'bed' },
  { id: 'bed-throw', scene: 'bedroom', mesh: 'Throw', label: 'Throw', category: 'Quilts', repeat: 0.3, stop: 'bed' },
  { id: 'bed-pillows', scene: 'bedroom', mesh: 'Bed pillows', label: 'Bed pillows', category: 'Shams', repeat: 0.24, stop: 'headboard' },
  { id: 'bed-bolster', scene: 'bedroom', mesh: 'Lumbar bolster', label: 'Lumbar bolster', category: 'Decorative Pillows', repeat: 0.18, stop: 'headboard' },
  { id: 'bed-accent-pillow', scene: 'bedroom', mesh: 'Accent pillow', label: 'Accent pillow', category: 'Decorative Pillows', repeat: 0.18, stop: 'headboard' },
  { id: 'bed-wall-scarf', scene: 'bedroom', mesh: 'Wall scarf (silk)', label: 'Wall scarf', category: 'Scarves', repeat: 0.2, stop: 'headboard' },
  { id: 'bed-armchair-pillows', scene: 'bedroom', mesh: ['Armchair pillow L', 'Armchair pillow R'], label: 'Armchair pillows', category: 'Decorative Pillows', repeat: 0.2, stop: 'armchairs' },
  { id: 'bed-drapes', scene: 'bedroom', mesh: ['Drapery panel front', 'Drapery panel back'], label: 'Drapes', category: 'Curtains', repeat: 0.42, stop: 'window' },
]

export const SLOT_BY_ID = Object.fromEntries(SLOTS.map((s) => [s.id, s]))
/** `${scene}:${mesh name}` -> slot (mesh names repeat across rooms, e.g. "Duvet"). */
export const SLOT_BY_MESH = Object.fromEntries(SLOTS.flatMap((s) => [s.mesh].flat().map((m) => [`${s.scene}:${m}`, s])))
export const slotsInScene = (scene) => SLOTS.filter((s) => s.scene === scene)
