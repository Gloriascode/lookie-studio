// Per-room settings for scripts/optimize-scene.mjs. Rooms themselves (ids, raw + output paths)
// come from src/scenes.js; product slots (mesh names -> slot ids) from src/slots.js.
//
//   root           name of the single Y-up / metres root node the room is re-parented under
//   drop           node names removed outright
//   cutouts        textured cut-out figures: alpha BLEND -> MASK
//   drape          slot ids unwrapped as draped sheets (fold-spanning charts); others are "sewn"
//   sourceUv       how a product's own TEXCOORD_0 is used, when it has one:
//                    'mm'   -> the layout is already in mm (garden tablecloth): just convert
//                    'fit'  -> 0..1 per-product layout: fit its u/v scale, then orient + place
//                              charts like an unwrap; falls back to an unwrap when too stretched
//                              (p95 > 1.25) or too fragmented (more than sourceUvMaxCharts charts)
//   flatUp         print "up" on near-flat charts (raw Z-up world axis); default = the product's
//                  longest horizontal axis (toward the back of the room, see horizontalAxis)
//   uvSkip         slot ids that keep their own UVs untouched (and get no metre UVs)
//   stripProductTextures  drop baked design textures from product slot materials
//   furniture      non-product meshes that receive baked AO
//   notOccluder    meshes that don't block AO rays
//   trims          hardware merged into product meshes: split off or dropped (see optimize-scene)
export const SCENE_CONFIG = {
  garden: {
    root: 'GlassGarden',
    drop: new Set(['Lawn']),
    cutouts: /^Cutout /,
    drape: new Set(['curtains', 'scarf', 'tea-towel', 'fabric-bolt', 'duvet', 'quilt', 'napkins', 'placemats']),
    sourceUv: 'mm',
    uvSkip: new Set(['rug']), // the rug top keeps its own textured 0..1 quad
    stripProductTextures: false,
    furniture: /^(Daybed|Armchair [AB]|Dining table|Dining chair [NSEW]|Side table \+ lamp|Tea cart \+ tea set|Rug|Curtain rod \+ hardware|Lampshade rims \+ fitter|Fabric bolt core)$/,
    notOccluder: /^(Lawn|Glass |Cutout |Strut )/,
    // predicate(piece, rank) -> true for hardware. Sizes are mm in the node's local (Z-up) frame.
    trims: {
      curtains: { name: 'Curtain rod + hardware', test: (c) => c.min[2] > 2400 }, // rod, finials, rings, brackets
      lampshade: { name: 'Lampshade rims + fitter', test: (c) => c.size[2] < 10 }, // flat rings top/bottom
      'fabric-bolt': { name: 'Fabric bolt core', test: (c, i) => i > 0 }, // everything but the fabric roll
      // The lumbar pillow's "texture ribs" are 9 thin strips lying on the cover: they z-fight the
      // body (horizontal banding) and would chop the print into strips. Drop them outright.
      'lumbar-pillow': { drop: true, test: (c, i) => i > 0 },
      // Same story on the tea towel: 4 thin "woven stripe" boxes 4 mm proud of each leaf near the
      // hem. A printed towel carries its design in the print, so they go too.
      'tea-towel': { drop: true, test: (c, i) => i > 0 },
    },
  },

  bedroom: {
    root: 'Bedroom',
    drop: new Set(),
    cutouts: null,
    drape: new Set(['bed-duvet', 'bed-throw', 'bed-drapes', 'bed-wall-scarf']),
    sourceUv: 'fit',
    sourceUvMaxCharts: 16,
    // Bedding reads from the foot of the bed: prints on the duvet top, throw and pillow tops run
    // toward the headboard (the back wall, +Y raw) rather than across the bed.
    flatUp: [0, 1, 0],
    uvSkip: new Set(),
    stripProductTextures: true,
    // Furniture + the hardware that came as separate pieces of each product. The architectural
    // boxes (walls, floor, ceiling, white trim) are a handful of vertices spanning metres, where
    // per-vertex AO means nothing, so they only occlude.
    furniture: /^(Bed|Nightstand [LR]|Table lamp [LR]|Pendant lantern|Pedestal table \+ vase|Armchair [LR]|Bench upholstery|Bench legs \+ base|Rug|Wall scarf rail \+ tassels|Drapery rod (front|back)|Bed pillow flanges|Bolster buttons)$/,
    notOccluder: /^(Window glass|Garden ground)$/,
    trims: {},
  },
}
