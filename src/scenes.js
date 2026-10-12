// The rooms of a Lookie Studio shop. Every shop has all of them; products live in a room via
// SLOTS[].scene. URL: /s/<slug> and /studio show the first room, /s/<slug>/<id> and
// /studio/<id> the others.
//
//   path       URL segment after /s/<slug> or /studio ('' = the default room)
//   camBounds  where product close-ups may put the camera (inside the room, clear of walls)
//   interior   the middle of the room proper (close-ups of spread-out pairs favour the piece
//              nearest it)
export const SCENES = [
  {
    id: 'garden',
    label: 'Conservatory',
    path: '',
    model: '/models/glass-garden.glb',
    raw: 'raw/glass-garden.glb',
    camBounds: { minX: -3.0, maxX: 3.0, minZ: -3.55, maxZ: 3.55, minY: 0.45, maxY: 2.4 },
    interior: [0, 1.2, 0],
  },
  {
    id: 'bedroom',
    label: 'Bedroom',
    path: 'bedroom',
    model: '/models/bedroom.glb',
    raw: 'raw/bedroom.glb',
    // Walls at x = ±1.9, back wall z = -2.2, open front at z = +2.8 (the camera may step out).
    camBounds: { minX: -1.7, maxX: 1.7, minZ: -1.95, maxZ: 3.6, minY: 0.45, maxY: 2.4 },
    interior: [0, 1.2, 0.2],
  },
]
export const DEFAULT_SCENE = SCENES[0].id
export const SCENE_BY_ID = Object.fromEntries(SCENES.map((s) => [s.id, s]))
export const SCENE_BY_PATH = Object.fromEntries(SCENES.map((s) => [s.path, s]))

/** URL for a room under a base path: roomPath('/studio', 'bedroom') -> '/studio/bedroom'. */
export function roomPath(base, scene) {
  const path = SCENE_BY_ID[scene]?.path
  return path ? `${base}/${path}` : base
}
