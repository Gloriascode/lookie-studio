// Bright late-morning daylight for the bedroom. Same recipe as the conservatory (one
// procedural sky for the backdrop, a once-rendered environment map, a static shadow map),
// but the sun only gets in through the two windows in the left wall: the walls and ceiling
// cast shadows, so light pools on the floor and across the bed. Soft "window" area lights
// stand in for the sky bounce a real room gets, and the lamps are dim warm accents.
// The window fill uses wide soft spotlights rather than RectAreaLights: area lights cost a
// lot per pixel and ship ~100 kB of lookup tables, for a wash that a penumbra spot matches.
import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { RoomEnvironment, RoomSky } from './roomSky'
import * as THREE from 'three'
import { useQuality } from '../perf/quality'
import { fabricSun } from './productMaterial'
import { useShadowRefresh } from './Lighting'

// From the left (-X, outside the windows), fairly high, a little from the front: light crosses
// the room inward and back, so the patch from the rear window lands on the bed.
export const BEDROOM_SUN_DIR = new THREE.Vector3(-0.78, 0.6, 0.28).normalize()
const SKY = { turbidity: 4.5, rayleigh: 1.2, mieCoefficient: 0.004, mieDirectionalG: 0.8 }
const ROOM_CENTER = new THREE.Vector3(0, 1.2, 0)

// Window openings in the left wall (x = -1.96): centre z, width, centre y, height (metres).
const WINDOWS = [
  { z: 1.65, w: 1.2, y: 1.4, h: 2.1 },
  { z: -0.17, w: 1.05, y: 1.4, h: 2.1 },
]

/** Soft daylight spilling in through one window: a wide, fully feathered spot, no shadows. */
function WindowFill({ z, w, y, h, intensity }) {
  const ref = useRef()
  useEffect(() => {
    const light = ref.current
    if (!light) return
    light.target.position.set(2, y - 0.6, z)
    light.target.updateMatrixWorld()
  }, [y, z])
  // Scale by the opening's area so both windows read like the same sky.
  return (
    <spotLight
      ref={ref}
      position={[-1.85, y + 0.2, z]}
      color="#eef1f3"
      intensity={intensity * w * h * 1.12}
      angle={1.25}
      penumbra={1}
      decay={1.6}
      distance={0}
    />
  )
}

export function BedroomLighting() {
  const gl = useThree((s) => s.gl)
  const q = useQuality()
  const sun = useRef()
  const refreshShadows = useShadowRefresh()
  const sunPosition = useMemo(() => BEDROOM_SUN_DIR.clone().multiplyScalar(100), [])
  const sunLightPos = useMemo(() => BEDROOM_SUN_DIR.clone().multiplyScalar(14).add(ROOM_CENTER), [])
  const formers = useMemo(
    () => [
      { form: 'circle', color: '#8aa36a', intensity: 1.3, scale: 60, position: [0, -12, 0], rotationX: -Math.PI / 2 },
      // Warm sun-side panel balancing the blue sky dome (same recipe as the conservatory).
      { form: 'rect', color: '#fff3df', intensity: 8, scale: [10, 4], position: sunPosition.clone().setLength(20).toArray(), target: [0, 0, 0] },
    ],
    [sunPosition],
  )

  // Drapes glow when the sun is behind them.
  useEffect(() => {
    fabricSun.uSunDir.value.copy(BEDROOM_SUN_DIR)
    if (sun.current) fabricSun.uSunColor.value.copy(sun.current.color).multiplyScalar(sun.current.intensity)
    sun.current?.target.position.copy(ROOM_CENTER)
    sun.current?.target.updateMatrixWorld()
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
      <fog attach="fog" args={['#dfe7ea', 30, 140]} />
      {/* Indoors the outdoor sky dome is only a reflection source: most of the fill comes from
          the warm hemisphere below (light bounced off oak and plaster), which keeps whites from
          turning sky-blue. Tuned (pixel-matched) to the room's first look. */}
      <RoomEnvironment sunPosition={sunPosition} sky={SKY} formers={formers} intensity={0.2} />

      <hemisphereLight args={['#f6efe4', '#b49a7c', 1.1]} />

      <directionalLight
        ref={sun}
        position={sunLightPos}
        intensity={4.2}
        color="#fff0d8"
        castShadow
        shadow-mapSize={[q.shadowMap, q.shadowMap]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.02}
        shadow-radius={4}
        shadow-camera-near={4}
        shadow-camera-far={26}
        shadow-camera-left={-4.2}
        shadow-camera-right={4.2}
        shadow-camera-top={4.2}
        shadow-camera-bottom={-4.2}
      />

      {/* Sky through the glass, spread over the window openings. */}
      {WINDOWS.map((w, i) => (
        <WindowFill key={i} {...w} intensity={q.effects ? 3.2 : 2.6} />
      ))}

      {/* Bedside lamps and the pendant: warm, dim, no shadows. */}
      <pointLight position={[-1.2, 1.12, -1.98]} color="#ffc98a" intensity={0.9} distance={2.6} decay={2} />
      <pointLight position={[1.2, 1.12, -1.98]} color="#ffc98a" intensity={0.9} distance={2.6} decay={2} />
      <pointLight position={[0, 2.25, -0.5]} color="#ffd9a8" intensity={0.7} distance={3.5} decay={2} />
    </>
  )
}
