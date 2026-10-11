// Ref-counted pattern texture cache. The same pattern on three products is one GPU texture;
// it is disposed when the last product lets go of it.
//
// Arcade pattern images can be several thousand pixels square. A tile covers 0.2-0.8 m in
// the scene, so anything above MAX_SIZE is downscaled once on load (saves VRAM; Arcade's
// current 1024px patterns load untouched).
import * as THREE from 'three'

const MAX_SIZE = 2048
const cache = new Map() // url -> { refs, promise, texture }
let anisotropy = 8

export function setPatternAnisotropy(value) {
  anisotropy = value
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`pattern image failed to load: ${url}`))
    img.src = url
  })
}

async function createTexture(url) {
  const img = await loadImage(url)
  let source = img
  const big = Math.max(img.naturalWidth, img.naturalHeight)
  if (big > MAX_SIZE) {
    const k = MAX_SIZE / big
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * k)
    canvas.height = Math.round(img.naturalHeight * k)
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    source = canvas
  }
  const tex = source === img ? new THREE.Texture(img) : new THREE.CanvasTexture(source)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = anisotropy
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.needsUpdate = true
  return tex
}

/** Resolves to the texture for `url`; every acquire must be paired with a release. */
export function acquirePattern(url) {
  let entry = cache.get(url)
  if (!entry) {
    entry = { refs: 0, texture: null, promise: null }
    entry.promise = createTexture(url).then((t) => {
      entry.texture = t
      // Released while loading?
      if (entry.refs <= 0) {
        t.dispose()
        cache.delete(url)
      }
      return t
    })
    entry.promise.catch(() => cache.delete(url))
    cache.set(url, entry)
  }
  entry.refs++
  return entry.promise
}

export function releasePattern(url) {
  const entry = cache.get(url)
  if (!entry) return
  entry.refs--
  if (entry.refs > 0) return
  if (entry.texture) {
    entry.texture.dispose()
    cache.delete(url)
  }
  // Still loading: the load handler disposes it.
}
