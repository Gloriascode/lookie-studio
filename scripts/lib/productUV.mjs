// Product UVs: xatlas unwrap (or a product's own ixi layout) -> per-chart clean-up -> TEXCOORD_0
// in METRES.
//
// Convention (the runtime shader relies on it — see src/scene/productMaterial.js):
//   uv is surface distance in metres, so `uv / SLOT.repeat` gives a uniform print scale.
//   Each chart is un-mirrored (u right, v up when looking at the outside of the surface),
//   +v points uphill on sloped/vertical charts, and along the product's long horizontal axis
//   on near-flat charts. Charts are then placed at globally coherent coordinates (chart centroid
//   = world position projected onto the chart's u/v directions) so the print continues across
//   seams and parallel channels (quilts, quilted shams) instead of jumping at every chart.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Api } from '../../node_modules/xatlasjs/dist/node/api.mjs';

const require = createRequire(import.meta.url);
const createXAtlasModule = require('../../node_modules/xatlasjs/dist/node/xatlas.js');
const WASM = fileURLToPath(new URL('../../node_modules/xatlasjs/dist/node/xatlas.wasm', import.meta.url));

let xatlasPromise;
function getXAtlas() {
  xatlasPromise ??= new Promise((resolve) => {
    const XA = Api(createXAtlasModule);
    const xa = new XA(() => resolve(xa), (p, d) => (p === 'xatlas.wasm' ? WASM : d + p));
  });
  return xatlasPromise;
}

// Chart presets. Drapes are (near-)developable sheets: let charts run over folds so the print
// flows like real fabric. Sewn items are panels: split at creases like front/back/gusset.
const CHART_OPTIONS = {
  drape: { maxCost: 16, normalDeviationWeight: 0.35, normalSeamWeight: 1, straightnessWeight: 2, roundnessWeight: 0.01, maxIterations: 2 },
  sewn: { maxCost: 2, normalDeviationWeight: 2, normalSeamWeight: 4, straightnessWeight: 6, roundnessWeight: 0.01, maxIterations: 2 },
};

/** Union-find connected components over an index buffer. Returns chart id per vertex. */
function componentsByVertex(index, vertexCount) {
  const parent = Int32Array.from({ length: vertexCount }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[a] = b;
  };
  for (let t = 0; t < index.length; t += 3) {
    union(index[t], index[t + 1]);
    union(index[t], index[t + 2]);
  }
  const ids = new Map();
  const chart = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const r = find(i);
    if (!ids.has(r)) ids.set(r, ids.size);
    chart[i] = ids.get(r);
  }
  return { chart, count: ids.size };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

/**
 * Per triangle: tangents T = dP/du, B = dP/dv (world units per uv unit), uv area, 3D area.
 * Returns null for degenerate uv triangles.
 */
function triFrame(P, UV, i0, i1, i2) {
  const p0 = [P[3 * i0], P[3 * i0 + 1], P[3 * i0 + 2]];
  const e1 = sub([P[3 * i1], P[3 * i1 + 1], P[3 * i1 + 2]], p0);
  const e2 = sub([P[3 * i2], P[3 * i2 + 1], P[3 * i2 + 2]], p0);
  const du1 = UV[2 * i1] - UV[2 * i0], dv1 = UV[2 * i1 + 1] - UV[2 * i0 + 1];
  const du2 = UV[2 * i2] - UV[2 * i0], dv2 = UV[2 * i2 + 1] - UV[2 * i0 + 1];
  const det = du1 * dv2 - du2 * dv1;
  const area3 = len(cross(e1, e2)) / 2;
  if (Math.abs(det) < 1e-12 || area3 < 1e-12) return null;
  const r = 1 / det;
  const T = [(e1[0] * dv2 - e2[0] * dv1) * r, (e1[1] * dv2 - e2[1] * dv1) * r, (e1[2] * dv2 - e2[2] * dv1) * r];
  const B = [(e2[0] * du1 - e1[0] * du2) * r, (e2[1] * du1 - e1[1] * du2) * r, (e2[2] * du1 - e1[2] * du2) * r];
  return { T, B, areaUV: Math.abs(det) / 2, area3, det, e1, e2, p0 };
}

/**
 * Unwrap one product primitive.
 * @param {object} mesh  { positions: Float32Array (local mm), normals, colors?, index: Uint32Array|Uint16Array }
 * @param {number[]} world  column-major 4x4 node world matrix (raw doc: Z-up, mm)
 * @param {object} opts  { mode: 'drape'|'sewn', horizontalAxis: [x,y,z] (world, unit) }
 * @returns { positions, normals, colors, index, uv (metres), stats }
 */
export async function unwrapProduct(mesh, world, { mode, horizontalAxis, chartOptions }) {
  const xa = await getXAtlas();
  const vc = mesh.positions.length / 3;
  if (vc > 65535) throw new Error(`unwrapProduct: ${vc} vertices exceeds xatlasjs' 16-bit index limit`);

  // Unwrap the TOPOLOGY with coincident positions welded: the source splits vertices wherever
  // normals change, which would otherwise shred folds into dozens of 2-triangle charts.
  const weldId = new Int32Array(vc);
  const weldPos = [];
  {
    const seen = new Map();
    for (let i = 0; i < vc; i++) {
      const p = mesh.positions;
      const k = `${Math.round(p[3 * i] * 100)},${Math.round(p[3 * i + 1] * 100)},${Math.round(p[3 * i + 2] * 100)}`;
      if (!seen.has(k)) { seen.set(k, weldPos.length / 3); weldPos.push(p[3 * i], p[3 * i + 1], p[3 * i + 2]); }
      weldId[i] = seen.get(k);
    }
  }
  const weldIndex = Uint16Array.from(mesh.index, (i) => weldId[i]);
  if (weldPos.length / 3 > 65535) throw new Error('unwrapProduct: too many welded vertices for xatlasjs');

  xa.createAtlas();
  xa.addMesh(weldIndex, Float32Array.from(weldPos), null, null, 'm');
  const atlas = xa.generateAtlas({ ...CHART_OPTIONS[mode], ...chartOptions }, { rotateCharts: false, rotateChartsToAxis: false, padding: 1, texelsPerUnit: 0.05, bruteForce: false });
  const out = atlas.meshes[0];
  xa.destroyAtlas();
  if (out.index.length !== mesh.index.length) throw new Error('unwrapProduct: xatlas changed the triangle count');

  // Rebuild vertices as unique (uv vertex, original vertex) pairs: keeps the source's normal
  // splits AND the new uv seams. xatlas keeps face order, so corner k of triangle t lines up.
  const pairId = new Map();
  const srcOf = [], uvOf = [];
  const index = new Uint32Array(mesh.index.length);
  for (let c = 0; c < mesh.index.length; c++) {
    const o = mesh.index[c], u = out.index[c];
    if (out.oldIndexes[u] !== weldId[o]) throw new Error('unwrapProduct: xatlas reordered faces');
    const key = u * 4194304 + o;
    let id = pairId.get(key);
    if (id === undefined) { id = srcOf.length; pairId.set(key, id); srcOf.push(o); uvOf.push(u); }
    index[c] = id;
  }
  const nv = srcOf.length;
  const remap = (src, size) => {
    if (!src) return null;
    const dst = new (src.constructor)(nv * size);
    for (let i = 0; i < nv; i++) for (let k = 0; k < size; k++) dst[i * size + k] = src[srcOf[i] * size + k];
    return dst;
  };
  const positions = remap(mesh.positions, 3);
  const normals = remap(mesh.normals, 3);
  const colors = mesh.colors ? remap(mesh.colors, mesh.colorSize) : null;
  // xatlas returns uv normalised by atlas width AND height separately; back to (isotropic) pixels.
  const uv = new Float64Array(nv * 2);
  for (let i = 0; i < nv; i++) {
    uv[2 * i] = out.vertex.coords1[2 * uvOf[i]] * atlas.width;
    uv[2 * i + 1] = out.vertex.coords1[2 * uvOf[i] + 1] * atlas.height;
  }

  // World-space copies (mm) for orientation/placement maths.
  const W = new Float64Array(nv * 3);
  const WN = new Float64Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    W[3 * i] = world[0] * x + world[4] * y + world[8] * z + world[12];
    W[3 * i + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
    W[3 * i + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
    const a = normals[3 * i], b = normals[3 * i + 1], c = normals[3 * i + 2];
    WN[3 * i] = world[0] * a + world[4] * b + world[8] * c;
    WN[3 * i + 1] = world[1] * a + world[5] * b + world[9] * c;
    WN[3 * i + 2] = world[2] * a + world[6] * b + world[10] * c;
  }

  // Charts = connected pieces in uv space (split normals share their uv vertex).
  const uvIndex = Uint32Array.from(index, (i) => uvOf[i]);
  const byUv = componentsByVertex(uvIndex, out.vertexCount);
  const chart = Int32Array.from({ length: nv }, (_, i) => byUv.chart[uvOf[i]]);
  const count = byUv.count;
  const stats = finishCharts({ index, uv, W, WN, chart, count, H: horizontalAxis });
  stats.charts = count;
  return { positions, normals, colors, index, uv: Float32Array.from(uv), stats };
}

/**
 * Per-chart clean-up shared by unwrapProduct and orientSourceUV (mutates `uv` in place):
 *   1. un-mirror (u x v along the outward normal), 2. scale to metres (area-preserving),
 *   3. rotate +v uphill (or along H on near-flat charts), 4. place at world-coherent coords.
 * @param {object} p  { index, uv: Float64Array, W: world positions (mm), WN: world normals,
 *                      chart: chart id per vertex, count, H: horizontal axis (world, unit) }
 * @returns stats { charts, flipped, horizontal, stretch: { p50, p95, max } }
 */
function finishCharts({ index, uv, W, WN, chart, count, H }) {
  const nv = chart.length;
  const chartTris = Array.from({ length: count }, () => []);
  for (let t = 0; t < index.length; t += 3) chartTris[chart[index[t]]].push(t);
  const chartVerts = Array.from({ length: count }, () => []);
  for (let i = 0; i < nv; i++) chartVerts[chart[i]].push(i);

  const UP = [0, 0, 1]; // raw document is Z-up
  const stats = { charts: count, flipped: 0, horizontal: 0, stretch: [] };

  for (let c = 0; c < count; c++) {
    const tris = chartTris[c];
    const verts = chartVerts[c];
    if (!tris.length) continue;

    // 1. Mirror: the uv frame must agree with the outward normal (T x B along N).
    let orient = 0;
    for (const t of tris) {
      const f = triFrame(W, uv, index[t], index[t + 1], index[t + 2]);
      if (!f) continue;
      const n = [WN[3 * index[t]] + WN[3 * index[t + 1]] + WN[3 * index[t + 2]], WN[3 * index[t] + 1] + WN[3 * index[t + 1] + 1] + WN[3 * index[t + 2] + 1], WN[3 * index[t] + 2] + WN[3 * index[t + 1] + 2] + WN[3 * index[t + 2] + 2]];
      orient += Math.sign(dot(cross(f.T, f.B), n)) * f.area3;
    }
    if (orient < 0) {
      for (const i of verts) uv[2 * i] = -uv[2 * i];
      stats.flipped++;
    }

    // 2. Scale to metres (area-preserving on average).
    let a3 = 0, auv = 0;
    for (const t of tris) {
      const f = triFrame(W, uv, index[t], index[t + 1], index[t + 2]);
      if (!f) continue;
      a3 += f.area3;
      auv += f.areaUV;
    }
    const s = Math.sqrt(a3 / Math.max(auv, 1e-18)) / 1000; // mm per uv unit -> m per uv unit
    for (const i of verts) {
      uv[2 * i] *= s;
      uv[2 * i + 1] *= s;
    }

    // 3. Rotate: gradient (in uv) of world height; fall back to the horizontal axis on flat charts.
    //    For a linear field f, grad_uv f = (T·∇f, B·∇f) with ∇f the world direction (unit).
    const gradOf = (dir) => {
      let gu = 0, gv = 0, A = 0;
      for (const t of tris) {
        const f = triFrame(W, uv, index[t], index[t + 1], index[t + 2]);
        if (!f) continue;
        // T, B are mm per metre-of-uv; normalise to metres per metre.
        gu += (dot(f.T, dir) / 1000) * f.area3;
        gv += (dot(f.B, dir) / 1000) * f.area3;
        A += f.area3;
      }
      return [gu / A, gv / A];
    };
    let g = gradOf(UP);
    const slope = Math.hypot(g[0], g[1]);
    if (slope < 0.3) {
      g = gradOf(H);
      stats.horizontal++;
    }
    if (process.env.UV_DEBUG) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], nrm = [0, 0, 0];
      for (const i of verts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], W[3 * i + k]); hi[k] = Math.max(hi[k], W[3 * i + k]); nrm[k] += WN[3 * i + k]; }
      const nl = len(nrm) || 1;
      console.log(`  chart ${c}: tris ${tris.length} area ${(a3 / 1e6).toFixed(4)} m² slope ${slope.toFixed(2)} ${slope < 0.3 ? 'flat' : 'up  '} z ${lo[2].toFixed(0)}..${hi[2].toFixed(0)} y ${lo[1].toFixed(0)}..${hi[1].toFixed(0)} n ${nrm.map((x) => (x / nl).toFixed(2)).join(',')}`);
    }
    const theta = Math.atan2(g[0], g[1]); // rotate g onto +v
    const cs = Math.cos(theta), sn = Math.sin(theta);
    for (const i of verts) {
      const u = uv[2 * i], v = uv[2 * i + 1];
      uv[2 * i] = u * cs - v * sn;
      uv[2 * i + 1] = u * sn + v * cs;
    }

    // 4. Place: chart centroid -> world centroid projected on the chart's u/v world directions.
    let Td = [0, 0, 0], Bd = [0, 0, 0], C = [0, 0, 0], Cuv = [0, 0], A = 0;
    const sv = [];
    for (const t of tris) {
      const f = triFrame(W, uv, index[t], index[t + 1], index[t + 2]);
      if (!f) continue;
      for (let k = 0; k < 3; k++) {
        Td[k] += f.T[k] * f.area3;
        Bd[k] += f.B[k] * f.area3;
        C[k] += (W[3 * index[t] + k] + W[3 * index[t + 1] + k] + W[3 * index[t + 2] + k]) / 3 * f.area3;
      }
      Cuv[0] += (uv[2 * index[t]] + uv[2 * index[t + 1]] + uv[2 * index[t + 2]]) / 3 * f.area3;
      Cuv[1] += (uv[2 * index[t] + 1] + uv[2 * index[t + 1] + 1] + uv[2 * index[t + 2] + 1]) / 3 * f.area3;
      A += f.area3;
      // stretch: singular values of J = [T B] (mm per metre-of-uv -> m per m)
      const E = dot(f.T, f.T) / 1e6, F = dot(f.T, f.B) / 1e6, G = dot(f.B, f.B) / 1e6;
      const tr = E + G, dt = Math.sqrt(Math.max(0, (E - G) ** 2 + 4 * F * F));
      const s1 = Math.sqrt((tr + dt) / 2), s2 = Math.sqrt(Math.max(1e-12, (tr - dt) / 2));
      sv.push([Math.max(s1, 1 / s2), f.area3]);
    }
    const Tn = len(Td) || 1, Bn = len(Bd) || 1;
    const Ud = Td.map((x) => x / Tn), Vd = Bd.map((x) => x / Bn);
    C = C.map((x) => x / A / 1000); // metres
    const target = [dot(C, Ud), dot(C, Vd)];
    const off = [target[0] - Cuv[0] / A, target[1] - Cuv[1] / A];
    for (const i of verts) {
      uv[2 * i] += off[0];
      uv[2 * i + 1] += off[1];
    }
    stats.stretch.push(...sv);
  }

  // area-weighted stretch percentiles (1 = isometric)
  stats.stretch.sort((a, b) => a[0] - b[0]);
  const total = stats.stretch.reduce((n, s) => n + s[1], 0);
  const pct = (p) => {
    let acc = 0;
    for (const [v, w] of stats.stretch) if ((acc += w) >= p * total) return v;
    return stats.stretch.at(-1)?.[0] ?? 1;
  };
  stats.stretch = { p50: +pct(0.5).toFixed(3), p95: +pct(0.95).toFixed(3), max: +(stats.stretch.at(-1)?.[0] ?? 1).toFixed(2) };

  return stats;
}

/**
 * Reuse a product's own 0..1 uv layout (ixi exports each product's design normalised per axis)
 * instead of unwrapping: fit each chart's u and v scale back to surface distance, then run the
 * same chart clean-up as an unwrap. Vertices and triangles are left as they are.
 * Check `stats.stretch` — a layout that wasn't made for cloth can be badly distorted.
 * @param {object} mesh  { positions, normals, colors?, colorSize?, index, uv: Float32Array (0..1) }
 */
export function orientSourceUV(mesh, world, { horizontalAxis }) {
  const nv = mesh.positions.length / 3;
  const index = Uint32Array.from(mesh.index);
  const uv = Float64Array.from(mesh.uv);
  const W = new Float64Array(nv * 3);
  const WN = new Float64Array(nv * 3);
  const P = mesh.positions, N = mesh.normals;
  for (let i = 0; i < nv; i++) {
    const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
    W[3 * i] = world[0] * x + world[4] * y + world[8] * z + world[12];
    W[3 * i + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
    W[3 * i + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
    const a = N[3 * i], b = N[3 * i + 1], c = N[3 * i + 2];
    WN[3 * i] = world[0] * a + world[4] * b + world[8] * c;
    WN[3 * i + 1] = world[1] * a + world[5] * b + world[9] * c;
    WN[3 * i + 2] = world[2] * a + world[6] * b + world[10] * c;
  }

  // Charts: vertices that share position AND uv are one (normal splits); uv seams split charts.
  const weld = new Int32Array(nv);
  {
    const seen = new Map();
    for (let i = 0; i < nv; i++) {
      const k = `${Math.round(P[3 * i] * 100)},${Math.round(P[3 * i + 1] * 100)},${Math.round(P[3 * i + 2] * 100)},${Math.round(uv[2 * i] * 1e5)},${Math.round(uv[2 * i + 1] * 1e5)}`;
      if (!seen.has(k)) seen.set(k, seen.size);
      weld[i] = seen.get(k);
    }
  }
  const byWeld = componentsByVertex(Uint32Array.from(index, (i) => weld[i]), nv);
  const chart = Int32Array.from({ length: nv }, (_, i) => byWeld.chart[weld[i]]);
  const count = byWeld.count;

  // Normalised layouts squash u and v by different amounts: per chart, rescale each axis to its
  // area-weighted mean surface length (mm per uv unit) so the chart is isotropic again.
  const su = new Float64Array(count), sv = new Float64Array(count), sa = new Float64Array(count);
  for (let t = 0; t < index.length; t += 3) {
    const f = triFrame(W, uv, index[t], index[t + 1], index[t + 2]);
    if (!f) continue;
    const c = chart[index[t]];
    su[c] += len(f.T) * f.area3;
    sv[c] += len(f.B) * f.area3;
    sa[c] += f.area3;
  }
  for (let i = 0; i < nv; i++) {
    const c = chart[i];
    if (!sa[c]) continue;
    uv[2 * i] *= su[c] / sa[c];
    uv[2 * i + 1] *= sv[c] / sa[c];
  }

  const stats = finishCharts({ index, uv, W, WN, chart, count, H: horizontalAxis });
  stats.charts = count;
  return {
    positions: mesh.positions,
    normals: mesh.normals,
    colors: mesh.colors ?? null,
    index,
    uv: Float32Array.from(uv),
    stats,
  };
}

/** Longest horizontal axis (world, Z-up) of a set of world positions (PCA in XY). */
export function horizontalAxis(W) {
  let mx = 0, my = 0;
  const n = W.length / 3;
  for (let i = 0; i < n; i++) { mx += W[3 * i]; my += W[3 * i + 1]; }
  mx /= n; my /= n;
  let xx = 0, xy = 0, yy = 0;
  for (let i = 0; i < n; i++) {
    const x = W[3 * i] - mx, y = W[3 * i + 1] - my;
    xx += x * x; xy += x * y; yy += y * y;
  }
  const ang = 0.5 * Math.atan2(2 * xy, xx - yy);
  let ax = [Math.cos(ang), Math.sin(ang), 0];
  // Consistent sign: point toward the back of the conservatory (+Y raw), else +X.
  if (ax[1] < -1e-3 || (Math.abs(ax[1]) <= 1e-3 && ax[0] < 0)) ax = ax.map((v) => -v);
  return ax;
}
