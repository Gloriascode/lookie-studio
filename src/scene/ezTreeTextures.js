// Drop-in replacement for @dgreenheck/ez-tree/src/lib/textures.js (wired up in vite.config.js).
// The original loads all 16 bark maps and 4 leaf atlases on import; this loads each one the
// first time a tree asks for it, so the page only downloads the species it actually grows.
import * as THREE from 'three'

import bark_birch_ao_1k_jpg from 'ez-tree-src/assets/bark/birch_ao_1k.jpg?url'
import bark_birch_color_1k_jpg from 'ez-tree-src/assets/bark/birch_color_1k.jpg?url'
import bark_birch_normal_1k_jpg from 'ez-tree-src/assets/bark/birch_normal_1k.jpg?url'
import bark_birch_roughness_1k_jpg from 'ez-tree-src/assets/bark/birch_roughness_1k.jpg?url'
import bark_oak_ao_1k_jpg from 'ez-tree-src/assets/bark/oak_ao_1k.jpg?url'
import bark_oak_color_1k_jpg from 'ez-tree-src/assets/bark/oak_color_1k.jpg?url'
import bark_oak_normal_1k_jpg from 'ez-tree-src/assets/bark/oak_normal_1k.jpg?url'
import bark_oak_roughness_1k_jpg from 'ez-tree-src/assets/bark/oak_roughness_1k.jpg?url'
import bark_pine_ao_1k_jpg from 'ez-tree-src/assets/bark/pine_ao_1k.jpg?url'
import bark_pine_color_1k_jpg from 'ez-tree-src/assets/bark/pine_color_1k.jpg?url'
import bark_pine_normal_1k_jpg from 'ez-tree-src/assets/bark/pine_normal_1k.jpg?url'
import bark_pine_roughness_1k_jpg from 'ez-tree-src/assets/bark/pine_roughness_1k.jpg?url'
import bark_willow_ao_1k_jpg from 'ez-tree-src/assets/bark/willow_ao_1k.jpg?url'
import bark_willow_color_1k_jpg from 'ez-tree-src/assets/bark/willow_color_1k.jpg?url'
import bark_willow_normal_1k_jpg from 'ez-tree-src/assets/bark/willow_normal_1k.jpg?url'
import bark_willow_roughness_1k_jpg from 'ez-tree-src/assets/bark/willow_roughness_1k.jpg?url'
import leaves_ash_color_png from 'ez-tree-src/assets/leaves/ash_color.png?url'
import leaves_aspen_color_png from 'ez-tree-src/assets/leaves/aspen_color.png?url'
import leaves_oak_color_png from 'ez-tree-src/assets/leaves/oak_color.png?url'
import leaves_pine_color_png from 'ez-tree-src/assets/leaves/pine_color.png?url'

const URLS = {
  'bark/birch_ao_1k.jpg': bark_birch_ao_1k_jpg,
  'bark/birch_color_1k.jpg': bark_birch_color_1k_jpg,
  'bark/birch_normal_1k.jpg': bark_birch_normal_1k_jpg,
  'bark/birch_roughness_1k.jpg': bark_birch_roughness_1k_jpg,
  'bark/oak_ao_1k.jpg': bark_oak_ao_1k_jpg,
  'bark/oak_color_1k.jpg': bark_oak_color_1k_jpg,
  'bark/oak_normal_1k.jpg': bark_oak_normal_1k_jpg,
  'bark/oak_roughness_1k.jpg': bark_oak_roughness_1k_jpg,
  'bark/pine_ao_1k.jpg': bark_pine_ao_1k_jpg,
  'bark/pine_color_1k.jpg': bark_pine_color_1k_jpg,
  'bark/pine_normal_1k.jpg': bark_pine_normal_1k_jpg,
  'bark/pine_roughness_1k.jpg': bark_pine_roughness_1k_jpg,
  'bark/willow_ao_1k.jpg': bark_willow_ao_1k_jpg,
  'bark/willow_color_1k.jpg': bark_willow_color_1k_jpg,
  'bark/willow_normal_1k.jpg': bark_willow_normal_1k_jpg,
  'bark/willow_roughness_1k.jpg': bark_willow_roughness_1k_jpg,
  'leaves/ash_color.png': leaves_ash_color_png,
  'leaves/aspen_color.png': leaves_aspen_color_png,
  'leaves/oak_color.png': leaves_oak_color_png,
  'leaves/pine_color.png': leaves_pine_color_png,
}

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
    tex = loader.load(URLS[rel], done, undefined, done)
    p.then(() => pending.delete(p))
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    cache.set(rel, tex)
  }
  return tex
}

export function getBarkTexture(barkType, fileType, scale = { x: 1, y: 1 }) {
  const tex = load(`bark/${barkType}_${fileType}_1k.jpg`, fileType === 'color')
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(scale.x, 1 / scale.y)
  return tex
}

export function getLeafTexture(leafType) {
  return load(`leaves/${leafType}_color.png`, true)
}
