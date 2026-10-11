// Turns the raw ixi "glass garden" export into a web-ready GLB.
//
//   node scripts/optimize-garden.mjs [in=raw/glass-garden.glb] [out=public/models/glass-garden.glb]
//
// - Z-up millimetres (ixi model3d) -> Y-up metres (three.js), baked into one root node
// - drops the flat lawn plane (the app draws its own ground, grass and flowers)
// - tags product meshes with extras.slot = <slot id> (src/slots.js) for the studio/shop
// - cutout figures: alpha BLEND -> MASK (no sorting, writes depth, casts proper shadows)
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
  prune(),
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
