// Drop-in replacement for @dgreenheck/ez-tree/src/lib/textures.js (wired up in vite.config.js).
// The original loads all 16 bark maps and 4 leaf atlases on import; this loads each one the
// first time a tree asks for it, so the page only downloads the species it actually grows.
import * as THREE from 'three'

// Converted to 512 px WebP by `npm run assets` (scripts/optimize-scene.mjs, convertTreeTextures).
const BASE = '/nature/ez-tree'

const loader = new THREE.TextureLoader()
const cache = new Map()
const pending = new Set()

/** Resolves once every texture requested so far has finished loading. */
export function texturesSettled() {
  return Promise.allSettled([...pending])
}

function load(rel, srgb) {
  let tex = cache.get(rel)
  if (!tex) {
    let done
    const p = new Promise((r) => (done = r))
    pending.add(p)
    tex = loader.load(`${BASE}/${rel}`, done, undefined, done)
    p.then(() => pending.delete(p))
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    cache.set(rel, tex)
  }
  return tex
}

export function getBarkTexture(barkType, fileType, scale = { x: 1, y: 1 }) {
  // AO and roughness maps don't show at our viewing distances: don't download them.
  if (fileType === 'ao' || fileType === 'roughness') return null
  const tex = load(`bark/${barkType}_${fileType}.webp`, fileType === 'color')
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(scale.x, 1 / scale.y)
  return tex
}

export function getLeafTexture(leafType) {
  return load(`leaves/${leafType}_color.webp`, true)
}
