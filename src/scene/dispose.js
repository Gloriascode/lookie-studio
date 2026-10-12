// Free a room's GPU memory when it leaves the screen. Disposing is not destructive in three:
// a disposed geometry/material/texture that renders again is simply re-uploaded, so this is
// safe under React StrictMode's mount/unmount/mount.
import { useGLTF } from '@react-three/drei'

const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'metalnessMap', 'bumpMap']

export function disposeObject(root) {
  const materials = new Set()
  root.traverse((o) => {
    if (!o.isMesh) return
    o.geometry?.dispose()
    for (const m of [o.material].flat()) if (m) materials.add(m)
  })
  for (const m of materials) {
    // Pattern textures live in shader uniforms and are ref-counted by patternTextures.js;
    // only the material's own maps (baked artwork) belong to the room.
    for (const k of TEXTURE_SLOTS) m[k]?.dispose?.()
    m.dispose()
  }
}

/** Dispose a loaded GLB and drop it from drei's cache so a revisit parses it fresh. */
export function releaseGLTF(url, scene) {
  disposeObject(scene)
  useGLTF.clear(url)
}

// Releases wait a tick and are cancelled by a remount of the same model: React StrictMode
// (dev) unmounts and remounts every effect once, and clearing the cache in between would make
// the room suspend and re-parse into new meshes mid-mount.
const pending = new Map()

/** useEffect(() => keepGLTF(url, scene), [scene]): free the model when the room really leaves. */
export function keepGLTF(url, scene) {
  clearTimeout(pending.get(url))
  pending.delete(url)
  return () => {
    pending.set(
      url,
      setTimeout(() => {
        pending.delete(url)
        releaseGLTF(url, scene)
      }, 0),
    )
  }
}

