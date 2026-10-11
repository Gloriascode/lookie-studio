// Camera waypoints for the scroll tour, in scene metres (Y-up, conservatory centred at the
// origin, entrance facing +Z). Each stop frames a group of products a designer can dress.
//
// Tuning: run with `?dev`, press O to toggle orbit controls, frame the shot, press P to log
// a ready-to-paste `pos` / `target` pair to the console.
//
// hideFromNav stops are still reached by scrolling; they just don't get a nav dot.
// mobile overrides apply at <= 768px wide, where the portrait frustum is much narrower.
export const STOPS = [
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
    navLabel: 'The Glass Garden',
    title: 'The Glass Garden',
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

export const NAV_STOPS = STOPS.map((s, i) => ({ ...s, index: i })).filter((s) => !s.hideFromNav)
