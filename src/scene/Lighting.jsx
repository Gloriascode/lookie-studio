// Late-afternoon light. One procedural sky drives everything so it all agrees:
//   - the visible backdrop (<Sky>)
//   - image-based lighting: the same sky + a few soft "lightformers" rendered ONCE into a
//     small cube map (frames={1}), so reflections on the glass and the fill light are free
//     after the first frame, and no HDRI download is needed
//   - a warm directional sun from the same direction, the only shadow caster
// Shadows are static: the shadow map re-renders only when something asks (see useShadowRefresh),
// not every frame. The wind sway in grass/leaves is too small to need moving shadows.
import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { RoomEnvironment, RoomSky } from './roomSky'
import * as THREE from 'three'
import { useQuality } from '../perf/quality'
import { fabricSun } from './productMaterial'

// Sun: ~24° above the horizon, from the front-left, so the iron frame throws long diagonal
// shadows across the tiled floor inside.
const SUN_ELEVATION = THREE.MathUtils.degToRad(24)
const SUN_AZIMUTH = THREE.MathUtils.degToRad(-38)
export const SUN_DIR = new THREE.Vector3(
  Math.cos(SUN_ELEVATION) * Math.sin(SUN_AZIMUTH),
  Math.sin(SUN_ELEVATION),
  Math.cos(SUN_ELEVATION) * Math.cos(SUN_AZIMUTH),
).normalize()

const SKY = { turbidity: 5.5, rayleigh: 1.4, mieCoefficient: 0.004, mieDirectionalG: 0.82 }
export const FOG_COLOR = '#d9e3e4'

let shadowRefreshQueued = false
/** Ask for one shadow-map re-render (after something static has loaded or moved). */
export function useShadowRefresh() {
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  return () => {
    if (shadowRefreshQueued) return
    shadowRefreshQueued = true
    // Wait a frame so freshly mounted meshes have their matrices before we render depth.
    requestAnimationFrame(() => {
      shadowRefreshQueued = false
      gl.shadowMap.needsUpdate = true
      invalidate()
    })
  }
}

export function Lighting() {
  const gl = useThree((s) => s.gl)
  const q = useQuality()
  const sun = useRef()
  const refreshShadows = useShadowRefresh()
  const sunPosition = useMemo(() => SUN_DIR.clone().multiplyScalar(100), [])
  const formers = useMemo(
    () => [
      // Ground bounce: a big, grass-tinted disc below the horizon.
      { form: 'circle', color: '#7f9a5c', intensity: 1.5, scale: 60, position: [0, -12, 0], rotationX: -Math.PI / 2 },
      // Warm sun-side panel: keeps the fill light afternoon-warm against the blue sky dome
      // (and gives the glass a soft highlight to catch).
      { form: 'rect', color: '#fff2dc', intensity: 10, scale: [12, 4], position: sunPosition.clone().setLength(20).toArray(), target: [0, 0, 0] },
      { form: 'rect', color: '#e8f0ff', intensity: 0.8, scale: [20, 6], position: [0, 8, -18], target: [0, 0, 0] },
    ],
    [sunPosition],
  )

  // Fabric translucency (curtains) needs the sun's direction and colour.
  useEffect(() => {
    fabricSun.uSunDir.value.copy(SUN_DIR)
    if (sun.current) fabricSun.uSunColor.value.copy(sun.current.color).multiplyScalar(sun.current.intensity)
  }, [])

  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    refreshShadows()
    const light = sun.current
    // The room is leaving: free the sun's shadow map with it.
    return () => {
      if (!light) return
      light.shadow.dispose()
      light.shadow.map = null
    }
  }, [gl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resize the shadow map when the quality tier changes.
  useEffect(() => {
    const light = sun.current
    if (!light || light.shadow.mapSize.x === q.shadowMap) return
    light.shadow.mapSize.set(q.shadowMap, q.shadowMap)
    light.shadow.map?.dispose()
    light.shadow.map = null
    refreshShadows()
  }, [q.shadowMap]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <RoomSky sunPosition={sunPosition} sky={SKY} />
      <fog attach="fog" args={[FOG_COLOR, 35, 170]} />
      {/* Tuned against the earlier drei <Environment> look (A/B pixel-matched). */}
      <RoomEnvironment sunPosition={sunPosition} sky={SKY} formers={formers} intensity={0.32} />

      {/* Fill for the Lambert foliage (it ignores the environment map). */}
      <hemisphereLight args={['#cfe2f3', '#5d6b3a', 0.38]} />

      <directionalLight
        ref={sun}
        position={sunPosition.clone().setLength(30)}
        intensity={3.8}
        color="#ffe2b8"
        castShadow
        shadow-mapSize={[q.shadowMap, q.shadowMap]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.025}
        shadow-radius={3}
        shadow-camera-near={5}
        shadow-camera-far={70}
        shadow-camera-left={-17}
        shadow-camera-right={17}
        shadow-camera-top={17}
        shadow-camera-bottom={-17}
      />

      {/* The table lamp in the lounge: a small warm accent, no shadows. */}
      <pointLight position={[-1.05, 1.12, -1.3]} color="#ffc98a" intensity={1.6} distance={3.2} decay={2} />
    </>
  )
}
