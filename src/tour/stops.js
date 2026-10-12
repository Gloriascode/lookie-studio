// Camera waypoints for the scroll tour, per room, in scene metres (Y-up). Each stop frames a
// group of products a designer can dress; SLOTS[].stop points at one of its room's stops.
//
// Conservatory: centred at the origin, entrance facing +Z.
// Bedroom: walls at x = ±1.9, bed against the back wall (z = -2.2), windows in the left
// wall, the front (z = +2.8) open like a stage set.
//
// Tuning: run with `?dev`, press O to toggle orbit controls, frame the shot, press P to log
// a ready-to-paste `pos` / `target` pair to the console.
//
// hideFromNav stops are still reached by scrolling; they just don't get a nav dot.
// mobile overrides apply at <= 768px wide, where the portrait frustum is much narrower.
const GARDEN_STOPS = [
  {
    id: 'arrival',
    navLabel: 'Arrival',
    hideFromNav: true,
    pos: [13, 7.5, 18],
    target: [0, 1.2, 0],
    mobile: { pos: [15, 9, 23] },
  },
  {
    id: 'approach',
    navLabel: 'Lookie Studio',
    title: 'Lookie Studio',
    subtitle: 'A shopfront that grows with your designs',
    pos: [2.2, 1.7, 12],
    target: [0, 2, 0],
    mobile: { pos: [2.6, 1.8, 15] },
  },
  {
    id: 'lounge',
    navLabel: 'Lounge',
    title: 'The Lounge',
    subtitle: 'Pillows, scarves, curtains & rugs',
    // Off-axis, so the shiba cutout on the rug sits to the side instead of blocking the chairs.
    pos: [1.05, 1.5, 1.35],
    target: [-0.35, 0.7, -2.55],
    mobile: { pos: [1.2, 1.6, 2.4] },
  },
  {
    id: 'armchair',
    navLabel: 'Silk Scarf',
    hideFromNav: true,
    title: 'Silk Scarf & Lumbar Pillow',
    pos: [1.25, 1.2, -1.0],
    target: [0.62, 0.68, -2.7],
  },
  {
    id: 'dining',
    navLabel: 'Dining',
    title: 'The Dining Table',
    subtitle: 'Tablecloths, placemats & napkins',
    pos: [0.1, 1.5, 1.0],
    target: [1.9, 0.75, -0.95],
    mobile: { pos: [-0.4, 1.6, 1.8] },
  },
  {
    id: 'tea',
    navLabel: 'Tea Cart',
    title: 'The Tea Cart',
    subtitle: 'Tea towels & fabric by the yard',
    pos: [1.3, 1.25, 2.2],
    target: [2.5, 0.6, 0.45],
  },
  {
    id: 'daybed',
    navLabel: 'Daybed',
    title: 'The Daybed',
    subtitle: 'Duvets, quilts & shams',
    pos: [-0.2, 1.5, 1.7],
    target: [-2.0, 0.55, -0.3],
    mobile: { pos: [0.4, 1.7, 2.6] },
  },
  {
    id: 'garden',
    navLabel: 'Garden',
    title: 'The Garden',
    subtitle: 'Step outside',
    pos: [-11, 2.4, 7],
    target: [0, 1.8, -1],
    mobile: { pos: [-13, 2.8, 9] },
  },
]

const BEDROOM_STOPS = [
  {
    id: 'bedroom-arrival',
    navLabel: 'Bedroom',
    hideFromNav: true,
    pos: [0.5, 1.75, 6.2],
    target: [0, 1.15, -0.4],
    mobile: { pos: [0.6, 2.0, 8.6] },
  },
  {
    id: 'bed',
    navLabel: 'The Bed',
    title: 'The Bedroom',
    subtitle: 'Duvets, throws & shams',
    pos: [1.25, 1.7, 1.75],
    target: [-0.15, 0.5, -0.95],
    mobile: { pos: [1.35, 2.0, 2.9] },
  },
  {
    id: 'headboard',
    navLabel: 'Headboard',
    title: 'Pillows & Wall Scarf',
    subtitle: 'Shams, bolsters & a silk carré',
    pos: [0.3, 1.5, 0.85],
    target: [0, 1.42, -2.1],
    mobile: { pos: [0.3, 1.55, 2.0] },
  },
  {
    id: 'armchairs',
    navLabel: 'Reading Corner',
    title: 'The Reading Corner',
    subtitle: 'Armchair pillows',
    // The armchairs face the open front, so this one looks in from outside the room.
    pos: [0.25, 1.45, 3.25],
    target: [0, 0.62, 1.15],
    mobile: { pos: [0.3, 1.6, 4.4] },
  },
  {
    id: 'window',
    navLabel: 'Window',
    title: 'The Window',
    subtitle: 'Sheer linen drapes',
    pos: [1.55, 1.45, 1.6],
    target: [-1.9, 1.35, 0.6],
    // Portrait is too narrow to see past the armchairs: stand by the foot of the bed and look
    // at the rear window and its drape instead.
    mobile: { pos: [1.65, 1.6, 0.75], target: [-1.9, 1.25, -0.55] },
  },
]

export const STOPS_BY_SCENE = { garden: GARDEN_STOPS, bedroom: BEDROOM_STOPS }

/** The tour stops of a room (the conservatory's for unknown ids). */
export const stopsFor = (scene) => STOPS_BY_SCENE[scene] ?? GARDEN_STOPS

/** Stops that get a nav dot, with their index into stopsFor(scene). */
const navCache = new Map()
export function navStopsFor(scene) {
  let nav = navCache.get(scene)
  if (!nav) {
    nav = stopsFor(scene).map((s, i) => ({ ...s, index: i })).filter((s) => !s.hideFromNav)
    navCache.set(scene, nav)
  }
  return nav
}
