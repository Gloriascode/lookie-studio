// Per-vertex ambient occlusion, baked offline with three-mesh-bvh.
//
// Rays: cosine-weighted hemisphere around each vertex normal, MAX_DIST reach with a smooth
// falloff, so near contact (pillow against an armchair, a duvet on the daybed, cloth folds)
// darkens while open surfaces stay at 1. The result is smoothed once over each vertex's
// neighbours (shared triangles + coincident split vertices) to hide sampling noise.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const RAYS = 64;
const MAX_DIST = 350; // mm (the raw document is in mm)
const BIAS = 2.5; // mm, start rays just off the surface
// Only FRONT faces occlude (occluder winding is matched to its normals below). A ray from a
// vertex buried inside another part, or from under a cloth lying on furniture, would otherwise
// hit back faces at once and read as black.
const SIDE = THREE.FrontSide;

/**
 * @param {Array<{positions: Float32Array, index: ArrayLike<number>, world: number[]}>} occluders
 * @param {Array<{positions: Float32Array, normals: Float32Array, index: ArrayLike<number>, world: number[]}>} receivers
 * @returns {Float32Array[]} AO per receiver vertex (1 = open, 0 = fully occluded)
 */
export function bakeAO(occluders, receivers) {
  // One merged world-space geometry for every occluder.
  let triCount = 0;
  for (const o of occluders) triCount += o.index.length / 3;
  const pos = new Float32Array(triCount * 9);
  let w = 0;
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), gn = new THREE.Vector3();
  let flippedTris = 0;
  for (const o of occluders) {
    m.fromArray(o.world);
    for (let t = 0; t < o.index.length; t += 3) {
      const [i0, i1, i2] = [o.index[t], o.index[t + 1], o.index[t + 2]];
      a.fromArray(o.positions, 3 * i0).applyMatrix4(m);
      b.fromArray(o.positions, 3 * i1).applyMatrix4(m);
      c.fromArray(o.positions, 3 * i2).applyMatrix4(m);
      // Make the winding agree with the authored normals so FrontSide = the side they face.
      if (o.normals) {
        gn.subVectors(b, a).cross(c.clone().sub(a));
        const nx = o.normals[3 * i0] + o.normals[3 * i1] + o.normals[3 * i2];
        const ny = o.normals[3 * i0 + 1] + o.normals[3 * i1 + 1] + o.normals[3 * i2 + 1];
        const nz = o.normals[3 * i0 + 2] + o.normals[3 * i1 + 2] + o.normals[3 * i2 + 2];
        n.set(nx, ny, nz).applyMatrix3(nm.getNormalMatrix(m));
        if (gn.dot(n) < 0) { const tmp = b.clone(); b.copy(c); c.copy(tmp); flippedTris++; }
      }
      for (const p of [a, b, c]) { pos[w++] = p.x; pos[w++] = p.y; pos[w++] = p.z; }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const bvh = new MeshBVH(geo, { targetLeafSize: 8 });

  // Cosine-weighted directions on a Fibonacci spiral (stratified, no clumping).
  const dirs = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < RAYS; i++) {
    const r = Math.sqrt((i + 0.5) / RAYS);
    const phi = i * golden;
    dirs.push([r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(Math.max(0, 1 - r * r))]);
  }

  const ray = new THREE.Ray();
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();

  return receivers.map((rcv) => {
    m.fromArray(rcv.world);
    nm.getNormalMatrix(m);
    const vc = rcv.positions.length / 3;
    const occl = new Float32Array(vc);
    for (let i = 0; i < vc; i++) {
      v.set(rcv.positions[3 * i], rcv.positions[3 * i + 1], rcv.positions[3 * i + 2]).applyMatrix4(m);
      n.set(rcv.normals[3 * i], rcv.normals[3 * i + 1], rcv.normals[3 * i + 2]).applyMatrix3(nm).normalize();
      // Tangent frame, randomly spun per vertex so the spiral's pattern doesn't band.
      t1.set(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0).cross(n).normalize();
      t2.crossVectors(n, t1);
      const spin = (Math.sin(i * 12.9898) * 43758.5453) % (2 * Math.PI);
      const cs = Math.cos(spin), sn = Math.sin(spin);
      ray.origin.copy(v).addScaledVector(n, BIAS);
      let blocked = 0;
      for (const [x0, y0, z] of dirs) {
        const x = x0 * cs - y0 * sn, y = x0 * sn + y0 * cs;
        ray.direction.set(0, 0, 0).addScaledVector(t1, x).addScaledVector(t2, y).addScaledVector(n, z).normalize();
        const hit = bvh.raycastFirst(ray, SIDE, 0, MAX_DIST);
        if (hit) {
          const f = hit.distance / MAX_DIST;
          blocked += (1 - f) * (1 - f); // contact counts fully, far hits fade out quickly
        }
      }
      occl[i] = blocked / RAYS;
    }
    return smooth(rcv, occl);
  });
}

/**
 * One pass of neighbour averaging. Coincident split vertices are merged only when their normals
 * agree: a box corner's top face must not inherit its fully occluded bottom face.
 */
function smooth(rcv, occl) {
  const vc = occl.length;
  const P = rcv.positions, N = rcv.normals;
  const groups = new Map(); // position key -> [vertex ids]
  const weld = new Int32Array(vc);
  for (let i = 0; i < vc; i++) {
    const k = `${Math.round(P[3 * i] * 2)},${Math.round(P[3 * i + 1] * 2)},${Math.round(P[3 * i + 2] * 2)}`;
    let list = groups.get(k);
    if (!list) groups.set(k, (list = []));
    let rep = i;
    for (const j of list) {
      if (N[3 * i] * N[3 * j] + N[3 * i + 1] * N[3 * j + 1] + N[3 * i + 2] * N[3 * j + 2] > 0.85) { rep = weld[j]; break; }
    }
    weld[i] = rep;
    list.push(i);
  }
  const sum = new Float64Array(vc), cnt = new Float64Array(vc);
  for (let i = 0; i < vc; i++) { sum[weld[i]] += occl[i]; cnt[weld[i]]++; }
  const base = new Float64Array(vc);
  for (let i = 0; i < vc; i++) base[i] = sum[weld[i]] / cnt[weld[i]];
  const nsum = new Float64Array(vc), ncnt = new Float64Array(vc);
  const idx = rcv.index;
  for (let t = 0; t < idx.length; t += 3) {
    const a = weld[idx[t]], b = weld[idx[t + 1]], c = weld[idx[t + 2]];
    nsum[a] += base[b] + base[c]; ncnt[a] += 2;
    nsum[b] += base[a] + base[c]; ncnt[b] += 2;
    nsum[c] += base[a] + base[b]; ncnt[c] += 2;
  }
  const ao = new Float32Array(vc);
  for (let i = 0; i < vc; i++) {
    const g = weld[i];
    const o = ncnt[g] ? 0.6 * base[i] + 0.4 * (nsum[g] / ncnt[g]) : base[i];
    // Soft floor: hidden faces (undersides, parts buried in other parts) bottom out at 0 and
    // would bleed into visible triangle edges. Map [0, 0.5] -> [0.35, 0.5]; leave the rest.
    const raw = Math.min(1, Math.max(0, 1 - o));
    ao[i] = raw >= 0.5 ? raw : 0.35 + 0.3 * raw;
  }
  return ao;
}
