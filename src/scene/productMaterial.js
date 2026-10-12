// Material for the dressable products (pillows, curtains, duvet...): printed textiles.
//
// Pattern mapping, picked per geometry when the material is made:
//   - UV path (geometry has `uv`): scripts/optimize-scene.mjs unwraps each product into
//     panels with uv in METRES of surface distance (+v = print up), so the print follows the
//     cloth like a real sewn product. Pattern coord = uv / SLOTS[].repeat.
//   - Triplanar path (no `uv`): world-space projection blended by the normal. The fallback.
// Each path is one shader program for every product (customProgramCacheKey).
//
// On top of the print, a fabric layer (all procedural, no extra textures):
//   - weave: a plain-weave bump at thread scale, faded out by screen-space derivatives so it
//     never shimmers or moirés at a distance, plus per-thread / slub albedo variation
//   - quilting: puffed channels with stitched seams every `quilt` metres (quilt, quilted shams)
//   - sheen tinted by the print colour (white sheen washes prints out)
//   - translucency: thin fabric glows when the sun is behind it (curtains)
//   - glow: the lampshade picks up its own bulb
//   - vertex AO (`_ao`, baked by the asset pipeline) darkens folds and contacts
//
// Per-mesh uniforms (material.userData.u), driven by Products.jsx:
//   uTexA/uAmountA  current pattern and its visibility (0 = blank linen)
//   uTexB/uAmountB  incoming pattern, cross-faded over A while it loads in
//   uHighlight      0..1 warm rim glow for hover (1) / selection (~0.45)
import * as THREE from 'three'

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
WHITE.needsUpdate = true
export const BLANK_TEXTURE = WHITE

const HIGHLIGHT = new THREE.Color('#ffb066')

// Sun (world direction towards the sun + linear colour * intensity), shared by every product
// for translucency. Lighting.jsx keeps it in sync with the directional light.
export const fabricSun = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
}

// Fabric presets. threads = threads per metre (exaggerated a little so the weave reads at
// room scale), weave = bump strength, slub = yarn irregularity, quilt = channel spacing (m).
const FABRICS = {
  cotton: { roughness: 0.86, sheen: 0.55, sheenRoughness: 0.65, specular: 0.25, threads: 700, weave: 0.65, slub: 0.35 },
  linen: { roughness: 0.9, sheen: 0.45, sheenRoughness: 0.8, specular: 0.22, threads: 520, weave: 1.15, slub: 1 },
  canvas: { roughness: 0.92, sheen: 0.35, sheenRoughness: 0.85, specular: 0.2, threads: 380, weave: 1.0, slub: 0.55 },
  silk: { roughness: 0.38, sheen: 1, sheenRoughness: 0.28, specular: 0.7, threads: 2200, weave: 0.2, slub: 0.08 },
}
const SLOT_FABRIC = {
  'lounge-pillow': { fabric: 'cotton' },
  'daybed-pillow': { fabric: 'cotton' },
  'lumbar-pillow': { fabric: 'canvas' },
  'floor-pillow': { fabric: 'canvas' },
  scarf: { fabric: 'silk' },
  curtains: { fabric: 'linen', translucency: 0.75 },
  lampshade: { fabric: 'linen', translucency: 0.5, glow: 0.12 },
  tablecloth: { fabric: 'linen' },
  placemats: { fabric: 'linen' },
  napkins: { fabric: 'linen' },
  'tea-towel': { fabric: 'linen' },
  'fabric-bolt': { fabric: 'cotton' },
  duvet: { fabric: 'cotton' },
  shams: { fabric: 'cotton' },
  quilt: { fabric: 'cotton', quilt: 0.085 },
  'quilted-shams': { fabric: 'cotton', quilt: 0.06 },
  // Bedroom
  'bed-duvet': { fabric: 'cotton' },
  'bed-throw': { fabric: 'cotton', quilt: 0.085 },
  'bed-pillows': { fabric: 'cotton' },
  'bed-bolster': { fabric: 'cotton' },
  'bed-accent-pillow': { fabric: 'linen' },
  'bed-wall-scarf': { fabric: 'silk' },
  'bed-armchair-pillows': { fabric: 'linen' },
  // Sheer drapes hang close to the wall under the ceiling: their baked AO is deep (~0.5) and
  // reads as grime on pale linen, so it only gets part of it.
  'bed-drapes': { fabric: 'linen', translucency: 0.75, ao: 0.45 },
}

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

/** Shared AO patch: `_ao` attribute -> occlusion on indirect light, a little on direct. */
const AO_VERTEX_PARS = /* glsl */ `
#ifdef USE_VERTEX_AO
  attribute float _ao;
  varying float vVertexAo;
#endif`
const AO_VERTEX = /* glsl */ `
#ifdef USE_VERTEX_AO
  vVertexAo = _ao;
#endif`
const AO_FRAGMENT_PARS = /* glsl */ `
#ifdef USE_VERTEX_AO
  varying float vVertexAo;
#endif`
// `extraAo` lets the fabric shader fold its quilting seams into the same term.
// The baked AO is applied at partial strength: it is a per-vertex approximation (no
// contact with the floor or neighbours' exact shapes), so at full strength it reads as
// dirty smudges on white paint and linen. Indirect light takes most of it; direct sun a
// little, because shadows already cover direct occlusion.
const aoFragment = (extraAo = '1.0', indirect = '0.6', direct = '0.18') => /* glsl */ `
{
  float bakedAo = 1.0;
  #ifdef USE_VERTEX_AO
    bakedAo = clamp(vVertexAo, 0.0, 1.0);
  #endif
  float occ = mix(1.0, bakedAo, ${indirect}) * ${extraAo};
  reflectedLight.indirectDiffuse *= occ;
  reflectedLight.indirectSpecular *= occ;
  float directOcc = mix(1.0, bakedAo, ${direct}) * mix(1.0, ${extraAo}, 0.5);
  reflectedLight.directDiffuse *= directOcc;
  reflectedLight.directSpecular *= directOcc;
}`

/**
 * Clone of a furniture/frame material that reads the baked `_ao` vertex attribute. Only use
 * on geometry that has `_ao` (a missing attribute reads as 0 = black). Cached per source.
 * Furniture is low-poly with big flat cushions, where per-vertex AO turns blotchy, so it
 * gets a lighter touch than the denser product meshes.
 */
const aoVariants = new WeakMap()
export function withVertexAo(material) {
  let m = aoVariants.get(material)
  if (m) return m
  m = material.clone()
  m.name = `${material.name}+ao`
  m.defines = { ...(m.defines ?? {}), USE_VERTEX_AO: '' }
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${AO_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${AO_VERTEX}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${AO_FRAGMENT_PARS}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${aoFragment('1.0', '0.45', '0.1')}`)
  }
  m.customProgramCacheKey = () => `vertex-ao-${material.type}`
  aoVariants.set(material, m)
  return m
}

/**
 * @param {THREE.MeshPhysicalMaterial} base  blank-linen physical material (sheen > 0)
 * @param {object} slot  SLOTS entry (repeat, id)
 * @param {{ hasUv?: boolean, hasAo?: boolean }} geo  what the product geometry carries
 */
export function makeProductMaterial(base, slot, { hasUv = false, hasAo = false } = {}) {
  const m = base.clone()
  const spec = SLOT_FABRIC[slot?.id] ?? { fabric: 'cotton' }
  const f = FABRICS[spec.fabric]
  m.roughness = f.roughness
  m.sheen = 1
  m.specularIntensity = f.specular

  const u = {
    uTexA: { value: WHITE },
    uTexB: { value: WHITE },
    uAmountA: { value: 0 },
    uAmountB: { value: 0 },
    uTileScale: { value: 1 / (slot?.repeat ?? 0.4) },
    uHighlight: { value: 0 },
    uHighlightColor: { value: HIGHLIGHT },
    uThreads: { value: f.threads },
    uWeave: { value: f.weave },
    uSlub: { value: f.slub },
    uQuilt: { value: spec.quilt ?? 0 },
    uSheen: { value: f.sheen },
    uSheenRough: { value: f.sheenRoughness },
    uTranslucency: { value: spec.translucency ?? 0 },
    uGlow: { value: spec.glow ?? 0 },
    uAoStrength: { value: spec.ao ?? 1 },
  }
  m.userData.u = u
  m.defines = { ...(m.defines ?? {}) }
  if (hasUv) m.defines.USE_FABRIC_UV = ''
  if (hasAo) m.defines.USE_VERTEX_AO = ''

  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, fabricSun)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFabPos;
        varying vec3 vFabN;
        #ifdef USE_FABRIC_UV
          varying vec2 vFabUv;
        #endif
        ${AO_VERTEX_PARS}`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vFabPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vFabN = normalize(mat3(modelMatrix) * objectNormal);
        #ifdef USE_FABRIC_UV
          vFabUv = uv;
        #endif
        ${AO_VERTEX}`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vFabPos;
        varying vec3 vFabN;
        #ifdef USE_FABRIC_UV
          varying vec2 vFabUv;
        #endif
        ${AO_FRAGMENT_PARS}
        uniform sampler2D uTexA, uTexB;
        uniform float uAmountA, uAmountB, uTileScale, uHighlight;
        uniform vec3 uHighlightColor;
        uniform float uThreads, uWeave, uSlub, uQuilt, uSheen, uSheenRough, uTranslucency, uGlow, uAoStrength;
        uniform vec3 uSunDir, uSunColor;

        float fabHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float fabNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); vec2 w = f * f * (3.0 - 2.0 * f);
          return mix(mix(fabHash(i), fabHash(i + vec2(1, 0)), w.x), mix(fabHash(i + vec2(0, 1)), fabHash(i + vec2(1, 1)), w.x), w.y);
        }

        // 2D surface coordinate in metres: the unwrap, or the dominant triplanar projection.
        vec2 fabCoord() {
          #ifdef USE_FABRIC_UV
            return vFabUv;
          #else
            vec3 n = abs(vFabN);
            if (n.x > n.y && n.x > n.z) return vFabPos.zy;
            if (n.y > n.z) return vFabPos.xz;
            return vFabPos.xy;
          #endif
        }

        // Pattern sample. Slight negative LOD bias keeps prints crisp at grazing angles
        // (anisotropic filtering does the rest).
        vec3 patSample(sampler2D t) {
          #ifdef USE_FABRIC_UV
            return texture2D(t, vFabUv * uTileScale, -0.35).rgb;
          #else
            // Triplanar; each projection's u axis is flipped by the normal sign so prints
            // read the right way round on both sides of a pillow.
            vec3 p = vFabPos * uTileScale;
            vec3 n = normalize(vFabN);
            vec3 w = pow(abs(n), vec3(6.0));
            w /= (w.x + w.y + w.z);
            vec3 cx = texture2D(t, vec2(-p.z * sign(n.x), p.y), -0.35).rgb;
            vec3 cy = texture2D(t, vec2(p.x, -p.z * sign(n.y)), -0.35).rgb;
            vec3 cz = texture2D(t, vec2(p.x * sign(n.z), p.y), -0.35).rgb;
            return cx * w.x + cy * w.y + cz * w.z;
          #endif
        }

        // Fabric height field: returns (height in metres, d/dcoord.x, d/dcoord.y) and writes
        // the albedo modulation + seam occlusion it implies.
        vec3 fabHeight(vec2 c, out float albedo, out float seamAo) {
          albedo = 1.0;
          seamAo = 1.0;
          vec3 h = vec3(0.0);

          // Weave: threads along both axes. Fade by how many threads a pixel spans so the
          // bump vanishes (rather than aliasing) when threads get smaller than a pixel.
          vec2 st = c * uThreads;
          vec2 fw = fwidth(st);
          float weaveFade = 1.0 - smoothstep(0.3, 0.75, max(fw.x, fw.y));
          if (weaveFade > 0.001) {
            vec2 a = PI * st;
            float amp = uWeave * 0.1 / uThreads * weaveFade;
            // Plain weave: over/under bumps alternate like a checkerboard.
            h.x += amp * sin(a.x) * sin(a.y);
            h.yz += amp * PI * uThreads * vec2(cos(a.x) * sin(a.y), sin(a.x) * cos(a.y));
            // Per-thread tone: neighbouring yarns never take dye quite equally.
            albedo *= 1.0 + weaveFade * 0.06 * (fabHash(vec2(floor(st.x), 3.1)) + fabHash(vec2(7.7, floor(st.y))) - 1.0);
          }
          // Slubs: thicker, slightly lighter stretches along the yarn (linen); visible a bit
          // further out than single threads, so they fade later.
          float slubFade = 1.0 - smoothstep(0.6, 2.5, max(fw.x, fw.y) * 0.12);
          float slub = fabNoise(vec2(st.x * 0.04, floor(st.y)));
          albedo *= 1.0 + uSlub * slubFade * 0.07 * (slub - 0.5);

          // Quilting: puffed channels along v, sunk stitch lines between them.
          if (uQuilt > 0.0) {
            float q = c.y / uQuilt;
            float fq = fract(q);
            float puff = sin(PI * fq);
            float depth = 0.0045;
            h.x += depth * sqrt(max(puff, 0.0));
            h.z += depth * 0.5 / sqrt(max(puff, 0.02)) * PI * cos(PI * fq) / uQuilt;
            float edge = min(fq, 1.0 - fq);
            seamAo = mix(0.72, 1.0, smoothstep(0.0, 0.2, edge));
            // Running stitch: short dashes in the seam.
            float stitch = step(0.5, fract(c.x / 0.006)) * (1.0 - smoothstep(0.0, 0.012, edge));
            albedo *= 1.0 - 0.18 * stitch;
          }
          return h;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        // Uniform-only branches: safe for mip derivatives, and free when no pattern is set.
        if (uAmountA + uAmountB > 0.001) {
          vec3 pc = diffuseColor.rgb;
          if (uAmountA > 0.001) pc = mix(pc, patSample(uTexA), uAmountA);
          if (uAmountB > 0.001) pc = mix(pc, patSample(uTexB), uAmountB);
          // Dyed cloth never reflects 100%: keep print whites off paper-white so the tone
          // mapper doesn't bleach the colours next to them.
          diffuseColor.rgb = pc * 0.88;
        }
        vec2 fabC = fabCoord();
        float fabAlbedo, fabSeamAo;
        vec3 fabH = fabHeight(fabC, fabAlbedo, fabSeamAo);
        diffuseColor.rgb *= fabAlbedo;
        // Hover/selection: a gentle warm wash (visible even on white linen) + rim below.
        diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0, 0.9, 0.78), uHighlight * 0.55);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          // Bump from the analytic height gradient, mapped to screen space through the
          // coordinate's derivatives (no tangents needed). Same maths as perturbNormalArb.
          vec2 dcx = dFdx(fabC), dcy = dFdy(fabC);
          float dHdx = dot(fabH.yz, dcx), dHdy = dot(fabH.yz, dcy);
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1) * faceDirection;
          vec3 grad = sign(det) * (dHdx * r1 + dHdy * r2);
          normal = normalize(abs(det) * normal - grad);
        }`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        /* glsl */ `#include <lights_physical_fragment>
        // Sheen takes the colour of the dye: white sheen would haze every print.
        material.sheenColor = uSheen * mix(vec3(1.0), diffuseColor.rgb, 0.7);
        material.sheenRoughness = clamp(uSheenRough, 0.07, 1.0);`,
      )
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${aoFragment('fabSeamAo', '(0.6 * uAoStrength)', '(0.18 * uAoStrength)')}`)
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        if (uHighlight > 0.001) {
          float fres = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 2.2);
          totalEmissiveRadiance += uHighlightColor * uHighlight * (0.04 + 0.8 * fres);
        }
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.72, 0.42) * uGlow;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
        // Thin-fabric translucency: sunlight arriving from behind the visible face shows
        // through, strongest when looking towards the sun. Unshadowed, so keep it modest.
        if (uTranslucency > 0.0) {
          vec3 nW = normalize(vFabN) * faceDirection;
          float back = saturate(-dot(nW, uSunDir));
          vec3 toFrag = normalize(vFabPos - cameraPosition);
          float forward = pow(saturate(dot(toFrag, uSunDir)), 3.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * uTranslucency * back * (0.25 + 0.75 * forward) * RECIPROCAL_PI;
        }`,
      )
  }
  m.customProgramCacheKey = () => `product-fabric-v2${hasUv ? '-uv' : '-tri'}${hasAo ? '-ao' : ''}`
  return m
}
