// Turns the raw ixi "glass garden" export into a web-ready GLB.
//
//   node scripts/optimize-garden.mjs [in=raw/glass-garden.glb] [out=public/models/glass-garden.glb]
//
// - Z-up millimetres (ixi model3d) -> Y-up metres (three.js), baked into one root node
// - drops the flat lawn plane (the app draws its own ground, grass and flowers)
// - tags product meshes with extras.slot = <slot id> (src/slots.js) for the studio/shop
// - cutout figures: alpha BLEND -> MASK (no sorting, writes depth, casts proper shadows)
// - product slot meshes get TEXCOORD_0 in METRES of surface distance (scripts/lib/productUV.mjs)
// - products + furniture get baked per-vertex ambient occlusion as _AO (scripts/lib/bakeAO.mjs)
// - the lumbar pillow's separate rib strips are dropped (they z-fought the body and broke the print)
// - textures -> WebP <= 2048px, meshes deduped/welded and meshopt-compressed
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, textureCompress, meshopt, resample, simplify } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { SLOT_BY_MESH } from '../src/slots.js';
import { unwrapProduct, horizontalAxis } from './lib/productUV.mjs';
import { bakeAO } from './lib/bakeAO.mjs';

const [input = 'raw/glass-garden.glb', output = 'public/models/glass-garden.glb'] = process.argv.slice(2);

// Product slots (src/slots.js) tag their meshes with extras.slot; see SLOT_BY_MESH below.
const DROP = new Set(['Lawn']);
const CUTOUTS = /^Cutout /;

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.encoder': MeshoptEncoder,
  });

const doc = await io.read(input);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];

// The source is a flat list of nodes; drop / tag / fix materials per node.
for (const node of scene.listChildren()) {
  const name = node.getName();
  if (DROP.has(name)) {
    node.dispose();
    continue;
  }
  const slot = SLOT_BY_MESH[name];
  node.setExtras({ ...node.getExtras(), ...(slot ? { slot: slot.id, product: slot.category } : {}) });

  if (CUTOUTS.test(name)) {
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      prim.getMaterial()?.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
    }
  }
}

// Every material is unnamed; name them after their first user so the app can restyle by role.
for (const node of scene.listChildren()) {
  for (const prim of node.getMesh()?.listPrimitives() ?? []) {
    const mat = prim.getMaterial();
    if (mat && !mat.getName()) mat.setName(node.getName());
  }
}

// ── Product UVs + baked AO ───────────────────────────────────────────────────
// Everything below works in the raw document's space (Z-up, mm), before the root re-parent.

// Draped sheets get fold-spanning charts; the rest are treated as sewn panels.
const DRAPE = new Set(['curtains', 'scarf', 'tea-towel', 'fabric-bolt', 'duvet', 'quilt', 'napkins', 'placemats']);
// Meshes that receive AO: every product plus the furniture they sit on.
const FURNITURE = /^(Daybed|Armchair [AB]|Dining table|Dining chair [NSEW]|Side table \+ lamp|Tea cart \+ tea set|Rug|Curtain rod \+ hardware|Lampshade rims \+ fitter|Fabric bolt core)$/;
// Meshes that don't block AO rays (transparent, cut-out or negligible).
const NOT_OCCLUDER = /^(Lawn|Glass |Cutout |Strut )/;

const t0 = Date.now();
const buffer = root.listBuffers()[0];
const nodes = scene.listChildren().filter((n) => n.getMesh());
const primOf = (n) => n.getMesh().listPrimitives()[0];
const arr = (prim, semantic) => prim.getAttribute(semantic)?.getArray() ?? null;
const accessor = (type, array, normalized = false) => doc.createAccessor().setType(type).setArray(array).setNormalized(normalized).setBuffer(buffer);

/** Connected pieces of a primitive (shared vertices or coincident positions), per triangle. */
function components(prim) {
  const P = arr(prim, 'POSITION'), idx = prim.getIndices().getArray();
  const vc = P.length / 3;
  const parent = Int32Array.from({ length: vc }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const seen = new Map();
  for (let i = 0; i < vc; i++) {
    const k = `${Math.round(P[3 * i] * 10)},${Math.round(P[3 * i + 1] * 10)},${Math.round(P[3 * i + 2] * 10)}`;
    if (seen.has(k)) union(i, seen.get(k)); else seen.set(k, i);
  }
  for (let t = 0; t < idx.length; t += 3) { union(idx[t], idx[t + 1]); union(idx[t], idx[t + 2]); }
  const ids = new Map();
  const comps = [];
  const triComp = new Int32Array(idx.length / 3);
  for (let t = 0; t < idx.length; t += 3) {
    const r = find(idx[t]);
    if (!ids.has(r)) { ids.set(r, comps.length); comps.push({ tris: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }); }
    const c = comps[ids.get(r)];
    triComp[t / 3] = ids.get(r);
    c.tris++;
    for (const v of [idx[t], idx[t + 1], idx[t + 2]]) for (let k = 0; k < 3; k++) { c.min[k] = Math.min(c.min[k], P[3 * v + k]); c.max[k] = Math.max(c.max[k], P[3 * v + k]); }
  }
  comps.forEach((c) => (c.size = c.max.map((x, k) => x - c.min[k])));
  return { comps, triComp, idx };
}

/** A copy of `prim` holding only the given triangles, with unused vertices compacted away. */
function subsetPrim(prim, triIds) {
  const idx = prim.getIndices().getArray();
  const remap = new Map();
  const newIdx = [];
  for (const t of triIds) for (let k = 0; k < 3; k++) {
    const v = idx[3 * t + k];
    if (!remap.has(v)) remap.set(v, remap.size);
    newIdx.push(remap.get(v));
  }
  const order = [...remap.keys()];
  const out = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(prim.getMode());
  for (const semantic of prim.listSemantics()) {
    const src = prim.getAttribute(semantic);
    const size = src.getElementSize(), a = src.getArray();
    const dst = new (a.constructor)(order.length * size);
    order.forEach((o, i) => { for (let k = 0; k < size; k++) dst[i * size + k] = a[o * size + k]; });
    out.setAttribute(semantic, accessor(src.getType(), dst, src.getNormalized()));
  }
  out.setIndices(accessor('SCALAR', Uint32Array.from(newIdx)));
  return out;
}

// Hardware that the ixi composition merged into product meshes. It must not take the print,
// so it moves to its own (non-product) node: painted like furniture, still casting AO.
//   predicate(piece) -> true for hardware. Sizes are mm in the node's local (Z-up) frame.
const TRIMS = {
  curtains: { name: 'Curtain rod + hardware', test: (c) => c.min[2] > 2400 }, // rod, finials, rings, brackets
  lampshade: { name: 'Lampshade rims + fitter', test: (c) => c.size[2] < 10 }, // flat rings top/bottom
  'fabric-bolt': { name: 'Fabric bolt core', test: (c, i) => i > 0 }, // everything but the fabric roll
  // The lumbar pillow's "texture ribs" are 9 thin strips lying on the cover: they z-fight the
  // body (horizontal banding) and would chop the print into strips. Drop them outright.
  'lumbar-pillow': { drop: true, test: (c, i) => i > 0 },
  // Same story on the tea towel: 4 thin "woven stripe" boxes 4 mm proud of each leaf near the
  // hem. A printed towel carries its design in the print, so they go too.
  'tea-towel': { drop: true, test: (c, i) => i > 0 },
};

for (const node of nodes.slice()) {
  const slotId = node.getExtras().slot;
  const trim = TRIMS[slotId];
  if (!trim) continue;
  const prim = primOf(node);
  const { comps, triComp } = components(prim);
  const rank = comps.map((c, i) => i).sort((a, b) => comps[b].tris - comps[a].tris);
  const isTrim = new Set(rank.filter((ci, r) => trim.test(comps[ci], r)));
  const keep = [], move = [];
  triComp.forEach((ci, t) => (isTrim.has(ci) ? move : keep).push(t));
  const fabric = subsetPrim(prim, keep);
  if (!trim.drop && move.length) {
    const hw = subsetPrim(prim, move);
    hw.setMaterial(prim.getMaterial()?.clone().setName(trim.name) ?? null);
    const hwNode = doc.createNode(trim.name).setMatrix(node.getMatrix()).setMesh(doc.createMesh(trim.name).addPrimitive(hw));
    scene.addChild(hwNode);
    nodes.push(hwNode);
  }
  node.getMesh().removePrimitive(prim);
  node.getMesh().addPrimitive(fabric);
  console.log(`${slotId}: ${trim.drop ? 'dropped' : `split "${trim.name}"`} ${isTrim.size} pieces / ${move.length} triangles; fabric keeps ${keep.length}`);
}

for (const node of nodes) {
  const slotId = node.getExtras().slot;
  if (!slotId || slotId === 'rug') continue; // the rug top already has its own textured 0..1 quad
  const prim = primOf(node);
  const world = node.getWorldMatrix();

  // The tablecloth ships with a real flat-cloth layout in mm: keep it, just convert to metres.
  const existing = prim.getAttribute('TEXCOORD_0');
  if (existing) {
    const uv = Float32Array.from(existing.getArray(), (x) => x / 1000);
    prim.setAttribute('TEXCOORD_0', accessor('VEC2', uv));
    console.log(`uv ${slotId.padEnd(14)} kept source cloth layout (mm -> m)`);
    continue;
  }

  // Unwrap only the vertices the index buffer actually uses.
  const idx = prim.getIndices().getArray();
  const used = new Int32Array(arr(prim, 'POSITION').length / 3).fill(-1);
  const order = [];
  for (const i of idx) if (used[i] < 0) { used[i] = order.length; order.push(i); }
  const pick = (src, size) => {
    if (!src) return null;
    const dst = new (src.constructor)(order.length * size);
    order.forEach((o, i) => { for (let k = 0; k < size; k++) dst[i * size + k] = src[o * size + k]; });
    return dst;
  };
  const colorAcc = prim.getAttribute('COLOR_0');
  const mesh = {
    positions: pick(arr(prim, 'POSITION'), 3),
    normals: pick(arr(prim, 'NORMAL'), 3),
    colors: colorAcc ? pick(colorAcc.getArray(), colorAcc.getElementSize()) : null,
    colorSize: colorAcc?.getElementSize(),
    index: Uint32Array.from(idx, (i) => used[i]),
  };
  // World positions for the product's long horizontal axis (flat charts' "up").
  const W = new Float64Array(mesh.positions.length);
  for (let i = 0; i < W.length; i += 3) {
    const x = mesh.positions[i], y = mesh.positions[i + 1], z = mesh.positions[i + 2];
    W[i] = world[0] * x + world[4] * y + world[8] * z + world[12];
    W[i + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
    W[i + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
  }
  const res = await unwrapProduct(mesh, world, { mode: DRAPE.has(slotId) ? 'drape' : 'sewn', horizontalAxis: horizontalAxis(W) });
  prim.setAttribute('POSITION', accessor('VEC3', res.positions));
  prim.setAttribute('NORMAL', accessor('VEC3', res.normals));
  if (res.colors) prim.setAttribute('COLOR_0', accessor(colorAcc.getType(), res.colors, colorAcc.getNormalized()));
  prim.setAttribute('TEXCOORD_0', accessor('VEC2', res.uv));
  prim.setIndices(accessor('SCALAR', res.index));
  const st = res.stats;
  console.log(`uv ${slotId.padEnd(14)} ${DRAPE.has(slotId) ? 'drape' : 'sewn '} charts ${String(st.charts).padStart(3)} (flat ${st.horizontal}, mirrored ${st.flipped})  stretch p50 ${st.stretch.p50} p95 ${st.stretch.p95} max ${st.stretch.max}  verts ${order.length} -> ${res.positions.length / 3}`);
}

{
  const occluders = [];
  const receivers = [];
  for (const node of nodes) {
    const name = node.getName();
    if (NOT_OCCLUDER.test(name)) continue;
    for (const prim of node.getMesh().listPrimitives()) {
      const entry = { name, positions: arr(prim, 'POSITION'), normals: arr(prim, 'NORMAL'), index: prim.getIndices().getArray(), world: node.getWorldMatrix(), prim };
      occluders.push(entry);
      const slot = node.getExtras().slot;
      if ((slot && slot !== 'rug') || FURNITURE.test(name)) receivers.push(entry);
    }
  }
  const tAO = Date.now();
  const aos = bakeAO(occluders, receivers);
  receivers.forEach((r, i) => r.prim.setAttribute('_AO', accessor('SCALAR', aos[i])));
  if (process.env.AO_STATS) {
    // Stats over up/side-facing vertices (world normal z > -0.3): undersides are never seen.
    receivers.forEach((r, i) => {
      const a = aos[i], N = r.normals, w = r.world;
      const vis = [];
      for (let k = 0; k < a.length; k++) {
        const nz = w[2] * N[3 * k] + w[6] * N[3 * k + 1] + w[10] * N[3 * k + 2];
        if (nz > -0.3) vis.push(a[k]);
      }
      vis.sort((x, y) => x - y);
      const mean = vis.reduce((n, x) => n + x, 0) / vis.length;
      const all = Math.min(...a);
      console.log(`  ao ${r.name.padEnd(28)} visible mean ${mean.toFixed(2)} p10 ${vis[(vis.length * 0.1) | 0].toFixed(2)} p50 ${vis[(vis.length * 0.5) | 0].toFixed(2)} p90 ${vis[(vis.length * 0.9) | 0].toFixed(2)} | min ${all.toFixed(2)}`);
    });
  }
  const nv = receivers.reduce((n, r) => n + r.positions.length / 3, 0);
  console.log(`baked AO: ${receivers.length} meshes, ${nv} vertices, ${occluders.reduce((n, o) => n + o.index.length / 3, 0)} occluder triangles, ${((Date.now() - tAO) / 1000).toFixed(1)} s`);
}
console.log(`uv + ao: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// Bake units + axes into one root: rotate -90° about X (Z-up -> Y-up), mm -> m.
const garden = doc.createNode('GlassGarden')
  .setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2])
  .setScale([0.001, 0.001, 0.001]);
for (const node of scene.listChildren()) {
  scene.removeChild(node);
  garden.addChild(node);
}
scene.addChild(garden);

// Draco is decoded on read; drop the extension so meshopt can take over.
root.listExtensionsUsed().find((e) => e.extensionName === 'KHR_draco_mesh_compression')?.dispose();

await doc.transform(
  // keepAttributes: the product UVs and _AO aren't referenced by any glTF texture, and plain
  // prune() would strip them as "unused".
  prune({ keepAttributes: true }),
  dedup(),
  weld(),
  resample(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048], quality: 82 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

await mkdir(path.dirname(output), { recursive: true });
await io.write(output, doc);

const before = (await stat(input)).size;
const after = (await stat(output)).size;
console.log(`${input} ${(before / 1e6).toFixed(2)} MB -> ${output} ${(after / 1e6).toFixed(2)} MB`);

// ez-tree's demo assets (MIT): grass clump, three flower varieties, ground textures.
// The flowers are ~790 triangles each, far more than a 30 cm plant needs when hundreds are
// planted; simplify them to roughly a third.
const EZ = 'node_modules/@dgreenheck/ez-tree/src/app/public';
await mkdir('public/nature', { recursive: true });
await MeshoptSimplifier.ready;
for (const f of ['flower_white.glb', 'flower_blue.glb', 'flower_yellow.glb']) {
  const flower = await io.read(path.join(EZ, f));
  const count = () => flower.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);
  const before = count();
  await flower.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.3, error: 0.03, lockBorder: false }), prune());
  await io.write(path.join('public/nature', f), flower);
  console.log(`${f}: ${before} -> ${count()} triangles`);
}
for (const f of ['grass.glb', 'grass.jpg', 'dirt_color.jpg', 'dirt_normal.jpg']) {
  await copyFile(path.join(EZ, f), path.join('public/nature', f));
}
console.log('copied ez-tree nature assets -> public/nature');
