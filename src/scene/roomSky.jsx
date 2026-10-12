// Sky + image-based lighting for a room, with an owner that cleans up after itself.
//
// drei's <Sky> and <Environment> leave GPU resources behind when a room unmounts (the sky is
// a <primitive>, and the environment's light shapes live in a portal R3F never disposes), so
// rooms that come and go (Conservatory <-> Bedroom) would leak a little on every switch. This
// builds the same thing directly: a procedural sky backdrop, and the same sky plus a few soft
// light shapes rendered ONCE into a small cube map for scene.environment.
import { useLayoutEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Sky as SkyImpl } from 'three/examples/jsm/objects/Sky.js'

function makeSky(sunPosition, { turbidity, rayleigh, mieCoefficient, mieDirectionalG }, distance) {
  const sky = new SkyImpl()
  sky.scale.setScalar(distance)
  const u = sky.material.uniforms
  u.turbidity.value = turbidity
  u.rayleigh.value = rayleigh
  u.mieCoefficient.value = mieCoefficient
  u.mieDirectionalG.value = mieDirectionalG
  u.sunPosition.value.copy(sunPosition)
  return sky
}

/** The visible sky dome. */
export function RoomSky({ sunPosition, sky, distance = 4500 }) {
  const obj = useMemo(() => makeSky(sunPosition, sky, distance), [sunPosition, sky, distance])
  useLayoutEffect(
    () => () => {
      obj.geometry.dispose()
      obj.material.dispose()
    },
    [obj],
  )
  return <primitive object={obj} />
}

/**
 * scene.environment for the room: the sky plus `formers` (soft emissive light shapes, like
 * drei's Lightformer) rendered once into a cube map.
 *   formers: [{ form: 'rect' | 'circle', color, intensity, scale: number | [w, h], position, target? }]
 */
export function RoomEnvironment({ sunPosition, sky, formers = [], resolution = 128, intensity = 1 }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  useLayoutEffect(() => {
    const virtual = new THREE.Scene()
    const owned = []
    const skyObj = makeSky(sunPosition, sky, 900)
    virtual.add(skyObj)
    owned.push(skyObj)
    for (const f of formers) {
      const [w, h] = Array.isArray(f.scale) ? f.scale : [f.scale, f.scale]
      const geometry = f.form === 'circle' ? new THREE.CircleGeometry(0.5, 48) : new THREE.PlaneGeometry(1, 1)
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(f.color).multiplyScalar(f.intensity ?? 1),
        side: THREE.DoubleSide,
        toneMapped: false,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.scale.set(w, h, 1)
      mesh.position.set(...f.position)
      if (f.target) mesh.lookAt(...f.target)
      if (f.rotationX != null) mesh.rotation.x = f.rotationX
      virtual.add(mesh)
      owned.push(mesh)
    }

    const target = new THREE.WebGLCubeRenderTarget(resolution, { type: THREE.HalfFloatType })
    const camera = new THREE.CubeCamera(0.1, 1000, target)
    const autoClear = gl.autoClear
    gl.autoClear = true
    camera.update(gl, virtual)
    gl.autoClear = autoClear
    // Prefilter here rather than letting the renderer do it: three never frees its own
    // prefiltered copy of a render-target environment, so every room visit would leak one.
    const pmrem = new THREE.PMREMGenerator(gl)
    const prefiltered = pmrem.fromCubemap(target.texture)
    pmrem.dispose()
    target.dispose()

    const prev = { environment: scene.environment, intensity: scene.environmentIntensity }
    scene.environment = prefiltered.texture
    scene.environmentIntensity = intensity
    return () => {
      if (scene.environment === prefiltered.texture) {
        scene.environment = prev.environment
        scene.environmentIntensity = prev.intensity
      }
      prefiltered.dispose()
      for (const o of owned) {
        o.geometry.dispose()
        o.material.dispose()
      }
    }
  }, [gl, scene, sunPosition, sky, formers, resolution, intensity])

  return null
}
