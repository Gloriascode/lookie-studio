// Lawn + gravel path + soil flower beds as ONE material on one big disc: the masks are
// computed from world position in the fragment shader, so there are no decals, no extra
// draw calls and no seams. Textures are ez-tree's demo grass/dirt (MIT).
import { useMemo } from 'react'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { PATH, BEDS } from './layout'

export function Ground() {
  const [grass, dirt] = useTexture(['/nature/grass.webp', '/nature/dirt_color.webp'])

  const material = useMemo(() => {
    for (const t of [grass, dirt]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.anisotropy = 8
    }
    grass.colorSpace = dirt.colorSpace = THREE.SRGBColorSpace

    const m = new THREE.MeshStandardMaterial({ name: 'ground', roughness: 0.95, color: '#ffffff' })
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uGrass: { value: grass },
        uDirt: { value: dirt },
        uPathHalfWidth: { value: PATH.halfWidth },
        uPathStart: { value: PATH.start },
        uBedInner: { value: new THREE.Vector2(BEDS.innerX, BEDS.innerZ) },
        uBedWidth: { value: BEDS.width },
      })
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          varying vec3 vGroundPos;
          uniform sampler2D uGrass, uDirt;
          uniform float uPathHalfWidth, uPathStart, uBedWidth;
          uniform vec2 uBedInner;
          float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float gNoise(vec2 p) {
            vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(gHash(i), gHash(i + vec2(1,0)), u.x), mix(gHash(i + vec2(0,1)), gHash(i + vec2(1,1)), u.x), u.y);
          }
          float boxDist(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
          `,
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          vec2 gp = vGroundPos.xz;
          // The ez-tree grass texture is a dark olive; use it only as detail around its own mean
          // (linear ~0.056,0.063,0.025) over a fresh lawn colour. Two scales break up tiling;
          // macro noise drifts between lush and sun-dried green.
          vec3 detail = mix(texture2D(uGrass, gp * 0.23).rgb, texture2D(uGrass, gp * 0.051 + 0.37).rgb, 0.4)
                      / vec3(0.056, 0.063, 0.025);
          float macro = gNoise(gp * 0.06) * 0.6 + gNoise(gp * 0.21) * 0.4;
          vec3 lawnTone = mix(vec3(0.075, 0.2, 0.03), vec3(0.17, 0.27, 0.055), macro);
          vec3 lawn = lawnTone * mix(vec3(1.0), clamp(detail, 0.0, 2.0), 0.55);
          vec3 soil = texture2D(uDirt, gp * 0.55).rgb;

          float edge = (gNoise(gp * 3.1) - 0.5) * 0.18;
          // Gravel path from the entrance out along +Z.
          float pathMask = 1.0 - smoothstep(uPathHalfWidth - 0.05, uPathHalfWidth + 0.08, abs(gp.x) + edge);
          pathMask *= smoothstep(uPathStart - 0.2, uPathStart, gp.y);
          // Soil beds hugging the knee wall (a rectangular ring), broken where the path meets the door.
          float bd = boxDist(gp, uBedInner);
          float bedMask = (1.0 - smoothstep(uBedWidth - 0.04, uBedWidth + 0.06, bd + edge)) * step(-0.05, bd);
          bedMask *= 1.0 - step(abs(gp.x), uPathHalfWidth + 0.15) * step(0.0, gp.y);

          vec3 gravel = mix(soil, vec3(0.78, 0.72, 0.62), 0.55) * (0.85 + 0.3 * gHash(floor(gp * 40.0)));
          vec3 ground = mix(lawn, soil * 0.75, bedMask);
          ground = mix(ground, gravel, pathMask);
          // Fade the lawn into a hazier, flatter tone with distance so the horizon reads soft.
          float far = smoothstep(25.0, 90.0, length(gp));
          ground = mix(ground, lawnTone * 1.1, far * 0.7);

          diffuseColor.rgb *= ground;
          `,
        )
    }
    return m
  }, [grass, dirt])

  return (
    <mesh rotation-x={-Math.PI / 2} position-y={-0.075} receiveShadow material={material} matrixAutoUpdate={false} onUpdate={(o) => o.updateMatrix()}>
      <circleGeometry args={[180, 64]} />
    </mesh>
  )
}
