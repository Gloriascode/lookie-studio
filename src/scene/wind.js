// Shared wind for grass, flowers and leaves: one set of uniforms, ticked once per frame.
// The sway is applied in world space after the instance matrix, so randomly rotated
// instances all lean the same way, and it works for InstancedMesh and plain meshes alike.
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'

export const windUniforms = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
  uWindStrength: { value: 0.12 },
  uWindFrequency: { value: 1.1 },
  uWindScale: { value: 0.08 },
}

const NOISE = /* glsl */ `
  uniform float uTime;
  uniform vec2 uWindDir;
  uniform float uWindStrength;
  uniform float uWindFrequency;
  uniform float uWindScale;
  uniform float uSwayHeight;
  uniform float uSwayAmount;

  // Cheap value noise: we only need slowly varying phase offsets across the field.
  float windHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float windNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(windHash(i), windHash(i + vec2(1, 0)), u.x),
               mix(windHash(i + vec2(0, 1)), windHash(i + vec2(1, 1)), u.x), u.y);
  }
`

/**
 * Patch a material so its vertices sway in the wind.
 * @param {THREE.Material} material
 * @param {object} opts
 * @param {'height'|'uv'} opts.weight  what drives the sway: local vertex height, or uv.y (leaf cards)
 * @param {number} opts.height  local height that gets the full sway (for weight: 'height')
 * @param {number} opts.amount  multiplier on the global strength
 */
export function applyWind(material, { weight = 'height', height = 1, amount = 1 } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms, {
      uSwayHeight: { value: height },
      uSwayAmount: { value: amount },
    })
    shader.vertexShader = NOISE + shader.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `
      vec4 mvPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      vec4 windWorld = modelMatrix * mvPosition;
      float sway = ${weight === 'uv' ? 'uv.y' : 'clamp(position.y / uSwayHeight, 0.0, 1.0)'};
      sway *= sway;
      float phase = 6.2831 * windNoise(windWorld.xz * uWindScale - uWindDir * uTime * 0.35);
      float gust = 0.6 + 0.4 * windNoise(windWorld.xz * uWindScale * 0.35 + uTime * 0.15);
      float wave = sin(uTime * uWindFrequency + phase) * 0.6 + sin(uTime * uWindFrequency * 2.3 + phase * 1.7) * 0.25 + 0.35;
      windWorld.xz += uWindDir * (wave * gust * sway * uWindStrength * uSwayAmount);
      mvPosition = viewMatrix * windWorld;
      gl_Position = projectionMatrix * mvPosition;
      `,
    )
  }
  // Distinct program per weighting mode; the uniforms themselves are shared objects.
  material.customProgramCacheKey = () => `wind-${weight}`
  return material
}

/** Advances the shared wind clock. Mount once inside the Canvas. */
export function WindClock() {
  useFrame((_, delta) => {
    // Clamp so a backgrounded tab doesn't snap every blade on return.
    windUniforms.uTime.value += Math.min(delta, 0.1)
  })
  return null
}
