// Material for the dressable products (pillows, curtains, duvet...).
//
// The ixi export has no UVs on any product mesh, so patterns are projected triplanar in
// world space: SLOTS[].repeat metres per tile, blended by the surface normal. Arcade patterns
// are seamless repeats, so the seams between projections are hard to see on soft furnishings.
//
// Per-mesh uniforms (material.userData.u):
//   uTexA/uAmountA  current pattern and its visibility (0 = blank linen)
//   uTexB/uAmountB  incoming pattern, cross-faded over A while it loads in
//   uHighlight      0..1 warm rim glow for hover (1) / selection (~0.45)
// Everything shares one shader program (customProgramCacheKey), so 17 products = 1 compile.
import * as THREE from 'three'

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
WHITE.needsUpdate = true
export const BLANK_TEXTURE = WHITE

const HIGHLIGHT = new THREE.Color('#ffb066')

/**
 * Inverted-hull outline: the product's own geometry drawn back-faces-only, pushed out
 * along world normals by a width proportional to view depth, so the line stays ~N px wide
 * at any distance. One extra draw call per outlined product, no postprocessing.
 */
export function makeOutlineMaterial(color = '#f08a3c') {
  return new THREE.ShaderMaterial({
    name: 'product-outline',
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
      uWidth: { value: 0.004 },
    },
    vertexShader: /* glsl */ `
      uniform float uWidth;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 wn = normalize(mat3(modelMatrix) * normal);
        float depth = -(viewMatrix * wp).z;
        wp.xyz += wn * uWidth * depth;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        gl_FragColor = vec4(uColor, uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
}

export function makeProductMaterial(base, slot) {
  const m = base.clone()
  const u = {
    uTexA: { value: WHITE },
    uTexB: { value: WHITE },
    uAmountA: { value: 0 },
    uAmountB: { value: 0 },
    uTileScale: { value: 1 / (slot?.repeat ?? 0.4) },
    uHighlight: { value: 0 },
    uHighlightColor: { value: HIGHLIGHT },
  }
  m.userData.u = u
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriN;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTriN = normalize(mat3(modelMatrix) * objectNormal);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vTriPos;
        varying vec3 vTriN;
        uniform sampler2D uTexA, uTexB;
        uniform float uAmountA, uAmountB, uTileScale, uHighlight;
        uniform vec3 uHighlightColor;
        // Triplanar sample; each projection's u axis is flipped by the normal sign so prints
        // read the right way round on both sides of a pillow.
        vec3 triSample(sampler2D t, vec3 p, vec3 n, vec3 w) {
          vec3 cx = texture2D(t, vec2(-p.z * sign(n.x), p.y)).rgb;
          vec3 cy = texture2D(t, vec2(p.x, -p.z * sign(n.y))).rgb;
          vec3 cz = texture2D(t, vec2(p.x * sign(n.z), p.y)).rgb;
          return cx * w.x + cy * w.y + cz * w.z;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        // Uniform-only branches: safe for mip derivatives, and free when no pattern is set.
        if (uAmountA + uAmountB > 0.001) {
          vec3 tp = vTriPos * uTileScale;
          vec3 tn = normalize(vTriN);
          vec3 tw = pow(abs(tn), vec3(4.0));
          tw /= (tw.x + tw.y + tw.z);
          vec3 pc = diffuseColor.rgb;
          if (uAmountA > 0.001) pc = mix(pc, triSample(uTexA, tp, tn, tw), uAmountA);
          if (uAmountB > 0.001) pc = mix(pc, triSample(uTexB, tp, tn, tw), uAmountB);
          diffuseColor.rgb = pc;
        }
        // Hover/selection: a gentle warm wash (visible even on white linen) + rim below.
        diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0, 0.9, 0.78), uHighlight * 0.55);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        if (uHighlight > 0.001) {
          float fres = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.2);
          totalEmissiveRadiance += uHighlightColor * uHighlight * (0.04 + 0.8 * fres);
        }`,
      )
  }
  m.customProgramCacheKey = () => 'product-triplanar-v1'
  return m
}
