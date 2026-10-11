// Product slots: the dressable items in the glass garden. Shared by the GLB pipeline
// (scripts/optimize-garden.mjs tags meshes with extras.slot = id), the 3D scene (hover /
// click / pattern textures), the studio + shop UI, and the worker (Arcade category lookup).
//
//   id         stable key stored in D1 (shop_products.slot)
//   mesh       node name in the ixi "glass garden" export
//   label      shown in the UI
//   category   Arcade print category name (`categories/list` .name); null = display only
//   repeat     metres per pattern tile for the 3D preview (triplanar projection)
//   stop       tour stop id that frames it best (src/tour/stops.js)
export const SLOTS = [
  { id: 'lounge-pillow', mesh: 'Decorative pillow', label: 'Decorative pillow', category: 'Decorative Pillows', repeat: 0.2, stop: 'lounge' },
  { id: 'lumbar-pillow', mesh: 'Outdoor lumbar pillow', label: 'Lumbar pillow', category: 'Outdoor Decorative Pillows', repeat: 0.2, stop: 'armchair' },
  { id: 'scarf', mesh: 'Silk scarf (on armchair B)', label: 'Silk scarf', category: 'Scarves', repeat: 0.16, stop: 'armchair' },
  { id: 'floor-pillow', mesh: 'Floor pillow', label: 'Floor pillow', category: 'Floor Pillows', repeat: 0.28, stop: 'lounge' },
  { id: 'curtains', mesh: 'Curtains', label: 'Curtains', category: 'Curtains', repeat: 0.42, stop: 'lounge' },
  { id: 'lampshade', mesh: 'Rectangular lampshade', label: 'Lampshade', category: 'Rectangular Lampshades', repeat: 0.18, stop: 'lounge' },
  { id: 'rug', mesh: 'Rug top', label: 'Rug', category: null, repeat: 0.8, stop: 'lounge' },
  { id: 'tablecloth', mesh: 'Tablecloth', label: 'Tablecloth', category: 'Tablecloths', repeat: 0.34, stop: 'dining' },
  { id: 'placemats', mesh: 'Placemats ×4', label: 'Placemats', category: 'Placemats', repeat: 0.2, stop: 'dining' },
  { id: 'napkins', mesh: 'Napkins ×4', label: 'Napkins', category: 'Napkins', repeat: 0.14, stop: 'dining' },
  { id: 'tea-towel', mesh: 'Tea towel', label: 'Tea towel', category: 'Tea Towels', repeat: 0.18, stop: 'tea' },
  { id: 'fabric-bolt', mesh: 'Fabric by the yard (bolt)', label: 'Fabric by the yard', category: 'Fabric By The Yard', repeat: 0.16, stop: 'tea' },
  { id: 'duvet', mesh: 'Duvet', label: 'Duvet', category: 'Duvets', repeat: 0.42, stop: 'daybed' },
  { id: 'quilt', mesh: 'Quilt', label: 'Quilt', category: 'Quilts', repeat: 0.32, stop: 'daybed' },
  { id: 'shams', mesh: 'Shams ×2', label: 'Shams', category: 'Shams', repeat: 0.24, stop: 'daybed' },
  { id: 'quilted-shams', mesh: 'Quilted shams ×2', label: 'Quilted shams', category: 'Quilted Shams', repeat: 0.24, stop: 'daybed' },
  { id: 'daybed-pillow', mesh: 'Decorative pillow (daybed)', label: 'Daybed pillow', category: 'Decorative Pillows', repeat: 0.2, stop: 'daybed' },
]

export const SLOT_BY_ID = Object.fromEntries(SLOTS.map((s) => [s.id, s]))
export const SLOT_BY_MESH = Object.fromEntries(SLOTS.map((s) => [s.mesh, s]))
