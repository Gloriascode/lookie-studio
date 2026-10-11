// Shared outdoor layout (metres, Y-up, entrance facing +Z) so the ground shader, grass,
// flowers and trees all agree on where the path, beds and building are.

// Conservatory footprint incl. the dark plinth (from the ixi export: 6.8 x 8 m slab).
export const BUILDING = { halfX: 3.4, halfZ: 4.0 }

// Gravel path from the front door out along +Z.
export const PATH = { halfWidth: 0.85, start: 4.0, end: 60 }

// Soil beds: a ring around the plinth, `width` metres wide.
export const BEDS = { innerX: BUILDING.halfX + 0.05, innerZ: BUILDING.halfZ + 0.05, width: 0.9 }

export const LAWN_RADIUS = 46

export function onPath(x, z, pad = 0) {
  return z > PATH.start - pad && Math.abs(x) < PATH.halfWidth + pad
}

/** Signed distance to the building's rectangle (negative inside). */
export function buildingDist(x, z) {
  const dx = Math.abs(x) - BUILDING.halfX
  const dz = Math.abs(z) - BUILDING.halfZ
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0)
}

export function inBed(x, z) {
  const d = buildingDist(x, z) - 0.05
  return d >= 0 && d <= BEDS.width && !onPath(x, z, 0.15)
}

// Deterministic PRNG so every load (and every quality tier) gets the same garden.
export function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Smooth 2D value noise for patchiness (same idea as the shader's).
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
export function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}
