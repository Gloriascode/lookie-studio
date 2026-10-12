// Turns each room's raw ixi export into a web-ready GLB (rooms: src/scenes.js, settings:
// scripts/scenes.config.mjs).
//
//   node scripts/optimize-scene.mjs [room ...] [--no-bake]     (no room = all rooms)
//
// - Z-up millimetres (ixi model3d) -> Y-up metres (three.js), baked into one root node
// - tags product meshes with extras.slot = <slot id> (src/slots.js) for the studio/shop
// - cutout figures: alpha BLEND -> MASK (no sorting, writes depth, casts proper shadows)
// - product slot meshes get TEXCOORD_0 in METRES of surface distance (scripts/lib/productUV.mjs)
// - products + furniture get baked per-vertex ambient occlusion as _AO (scripts/lib/bakeAO.mjs)
// - hardware merged into product meshes is split off (or dropped) per the room's `trims`
// - textures -> WebP <= 2048px, meshes deduped/welded and meshopt-compressed
// --no-bake skips UVs + AO (a quick, untextured-products preview of a new room).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, textureCompress, meshopt, resample, simplify } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { SCENES } from '../src/scenes.js';
import { SLOT_BY_MESH } from '../src/slots.js';
import { SCENE_CONFIG } from './scenes.config.mjs';
import { unwrapProduct, orientSourceUV, horizontalAxis } from './lib/productUV.mjs';
import { bakeAO } from './lib/bakeAO.mjs';

const args = process.argv.slice(2);
const bake = !args.includes('--no-bake');
const wanted = args.filter((a) => !a.startsWith('--'));
const rooms = wanted.length ? SCENES.filter((s) => wanted.includes(s.id)) : SCENES;
if (wanted.length && rooms.length !== wanted.length) throw new Error(`Unknown room in ${wanted.join(', ')} (have ${SCENES.map((s) => s.id).join(', ')})`);

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.encoder': MeshoptEncoder,
  });

for (const room of rooms) await buildRoom(room, SCENE_CONFIG[room.id]);
if (rooms.some((r) => r.id === 'garden')) await copyNatureAssets();

async function buildRoom(room, cfg) {
  if (!cfg) throw new Error(`No scripts/scenes.config.mjs entry for room "${room.id}"`);
  const input = room.raw;
  const output = path.join('public', room.model);
  console.log(`\n── ${room.id}: ${input} -> ${output}${bake ? '' : ' (no bake)'}`);

  const doc = await io.read(input);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];

  // The source is a flat list of nodes; drop / tag / fix materials per node.
  for (const node of scene.listChildren()) {
    const name = node.getName();
    if (cfg.drop.has(name)) {
      node.dispose();
      continue;
    }
    const slot = SLOT_BY_MESH[`${room.id}:${name}`];
    node.setExtras({ ...node.getExtras(), ...(slot ? { slot: slot.id, product: slot.category } : {}) });

    if (cfg.cutouts?.test(name)) {
      for (const prim of node.getMesh()?.listPrimitives() ?? []) {
        prim.getMaterial()?.setAlphaMode('MASK').setAlphaCutoff(0.5).setDoubleSided(true);
      }
    }
    // Products render blank linen + the creator's print: the baked ixi design isn't shipped.
    if (slot && cfg.stripProductTextures) {
      for (const prim of node.getMesh()?.listPrimitives() ?? []) {
        const mat = prim.getMaterial();
        if (mat?.getBaseColorTexture()) prim.setMaterial(mat.clone().setBaseColorTexture(null));
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

  if (bake) await bakeProducts(doc, scene, room, cfg);
  else {
    // Unbaked product UVs aren't in metres: drop them so the app falls back to triplanar.
    for (const node of scene.listChildren()) {
      const slot = node.getExtras().slot;
      if (!slot || cfg.uvSkip.has(slot)) continue;
      for (const prim of node.getMesh()?.listPrimitives() ?? []) prim.setAttribute('TEXCOORD_0', null);
    }
  }

  // Bake units + axes into one root: rotate -90° about X (Z-up -> Y-up), mm -> m.
  const top = doc.createNode(cfg.root)
    .setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2])
    .setScale([0.001, 0.001, 0.001]);
  for (const node of scene.listChildren()) {
    scene.removeChild(node);
    top.addChild(node);
  }
  scene.addChild(top);

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
}

// ── Product UVs + baked AO ───────────────────────────────────────────────────
// Everything here works in the raw document's space (Z-up, mm), before the root re-parent.
async function bakeProducts(doc, scene, room, cfg) {
  const t0 = Date.now();
  const root = doc.getRoot();
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
  for (const node of nodes.slice()) {
    const slotId = node.getExtras().slot;
    const trim = cfg.trims[slotId];
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

  // Mesh shared by several nodes (e.g. two identical pillows): give each node its own copy so
  // UVs (world-placed) and AO (position-dependent) can differ per node.
  {
    const users = new Map();
    for (const node of nodes) {
      const m = node.getMesh();
      if (users.has(m)) node.setMesh(m.clone());
      else users.set(m, node);
    }
  }

  for (const node of nodes) {
    const slotId = node.getExtras().slot;
    if (!slotId || cfg.uvSkip.has(slotId)) continue;
    const prim = primOf(node);
    const world = node.getWorldMatrix();
    const mode = cfg.drape.has(slotId) ? 'drape' : 'sewn';
    const label = `${slotId}${node.getName() !== slotId ? ` (${node.getName()})` : ''}`;
    const existing = prim.getAttribute('TEXCOORD_0');

    // The garden tablecloth ships with a real flat-cloth layout in mm: keep it, just convert.
    if (existing && cfg.sourceUv === 'mm') {
      const uv = Float32Array.from(existing.getArray(), (x) => x / 1000);
      prim.setAttribute('TEXCOORD_0', accessor('VEC2', uv));
      console.log(`uv ${label.padEnd(14)} kept source cloth layout (mm -> m)`);
      continue;
    }

    // Work on the vertices the index buffer actually uses.
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
    const opts = { mode, horizontalAxis: cfg.flatUp ?? horizontalAxis(W) };

    let res = null;
    let how = mode === 'drape' ? 'drape' : 'sewn ';
    if (existing && cfg.sourceUv === 'fit') {
      // A 0..1 layout from ixi: fit its scale and reuse it unless it's too stretched.
      const fit = orientSourceUV({ ...mesh, uv: pick(existing.getArray(), 2) }, world, opts);
      const maxCharts = cfg.sourceUvMaxCharts ?? Infinity;
      if (fit.stats.stretch.p95 <= 1.25 && fit.stats.charts <= maxCharts) {
        res = fit;
        how = 'source';
      } else {
        const why = fit.stats.charts > maxCharts ? `fragmented (${fit.stats.charts} charts)` : `stretched (p50 ${fit.stats.stretch.p50} p95 ${fit.stats.stretch.p95})`;
        console.log(`uv ${label.padEnd(14)} source layout ${why} -> unwrap`);
      }
    }
    res ??= await unwrapProduct(mesh, world, opts);
    prim.setAttribute('POSITION', accessor('VEC3', res.positions));
    prim.setAttribute('NORMAL', accessor('VEC3', res.normals));
    if (res.colors) prim.setAttribute('COLOR_0', accessor(colorAcc.getType(), res.colors, colorAcc.getNormalized()));
    prim.setAttribute('TEXCOORD_0', accessor('VEC2', res.uv));
    prim.setIndices(accessor('SCALAR', res.index));
    const st = res.stats;
    console.log(`uv ${label.padEnd(14)} ${how} charts ${String(st.charts).padStart(3)} (flat ${st.horizontal}, mirrored ${st.flipped})  stretch p50 ${st.stretch.p50} p95 ${st.stretch.p95} max ${st.stretch.max}  verts ${order.length} -> ${res.positions.length / 3}`);
  }

  {
    const occluders = [];
    const receivers = [];
    for (const node of nodes) {
      const name = node.getName();
      if (cfg.notOccluder.test(name)) continue;
      for (const prim of node.getMesh().listPrimitives()) {
        const entry = { name, positions: arr(prim, 'POSITION'), normals: arr(prim, 'NORMAL'), index: prim.getIndices().getArray(), world: node.getWorldMatrix(), prim };
        occluders.push(entry);
        const slot = node.getExtras().slot;
        if ((slot && !cfg.uvSkip.has(slot)) || cfg.furniture.test(name)) receivers.push(entry);
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
}

// ez-tree's demo assets (MIT) for the garden: grass clump, three flower varieties, ground
// textures. The flowers are ~790 triangles each, far more than a 30 cm plant needs when hundreds
// are planted; simplify them to roughly a third.
async function copyNatureAssets() {
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
  await copyFile(path.join(EZ, 'grass.glb'), path.join('public/nature', 'grass.glb'));
  // Ground detail textures: the lawn shader tiles them every few metres, so 512 px is plenty.
  for (const f of ['grass', 'dirt_color']) {
    await sharp(path.join(EZ, `${f}.jpg`)).resize(512, 512, { fit: 'inside' }).webp({ quality: 78 }).toFile(path.join('public/nature', `${f}.webp`));
  }
  await convertTreeTextures();
  console.log('copied ez-tree nature assets -> public/nature');
}

// ez-tree's bark maps (1k JPEGs, four per species) and leaf atlases (1k PNGs) are sized for a
// close-up tree editor. Our trees stand across a lawn or outside a window: colour + normal at
// 512 px WebP are plenty, and the AO / roughness maps are dropped (src/scene/ezTreeTextures.js).
async function convertTreeTextures() {
  const SRC = 'node_modules/@dgreenheck/ez-tree/src/lib/assets';
  const OUT = 'public/nature/ez-tree';
  await mkdir(path.join(OUT, 'bark'), { recursive: true });
  await mkdir(path.join(OUT, 'leaves'), { recursive: true });
  let before = 0, after = 0;
  const convert = async (src, dst, size, webp) => {
    await sharp(src).resize(size, size, { fit: 'inside' }).webp(webp).toFile(dst);
    before += (await stat(src)).size;
    after += (await stat(dst)).size;
  };
  for (const type of ['birch', 'oak', 'pine', 'willow']) {
    for (const map of ['color', 'normal']) {
      await convert(path.join(SRC, 'bark', `${type}_${map}_1k.jpg`), path.join(OUT, 'bark', `${type}_${map}.webp`), 512, { quality: map === 'normal' ? 90 : 80 });
    }
  }
  // Leaves are alpha-tested cut-outs: keep the alpha channel exact. Leaf cards are small on
  // screen, so 512 px atlases hold up.
  for (const type of ['ash', 'aspen', 'oak', 'pine']) {
    await convert(path.join(SRC, 'leaves', `${type}_color.png`), path.join(OUT, 'leaves', `${type}_color.webp`), 512, { quality: 82, alphaQuality: 100 });
  }
  console.log(`tree textures: ${(before / 1e6).toFixed(2)} MB -> ${(after / 1e6).toFixed(2)} MB`);
}
