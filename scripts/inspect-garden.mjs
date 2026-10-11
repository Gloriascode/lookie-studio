import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
import { getBounds } from '@gltf-transform/core';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.decoder': MeshoptDecoder,
});
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
const f = (v) => v.map((n) => +n.toFixed(2)).join(',');
function walk(node, depth) {
  const m = node.getMesh();
  let info = '';
  if (m) {
    const prims = m.listPrimitives();
    const tris = prims.reduce((s, p) => s + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
    const mats = prims.map((p) => { const mt = p.getMaterial(); if (!mt) return 'none'; const c = mt.getBaseColorFactor(); return `${mt.getName()||'mat'}[${f(c)} r${mt.getRoughnessFactor()} m${mt.getMetallicFactor()} ${mt.getAlphaMode()}${mt.getBaseColorTexture()?' TEX':''}]`; });
    info = ` mesh tris=${tris} ${mats.join(' ')}`;
  }
  const t = node.getTranslation(), s = node.getScale(), r = node.getRotation();
  const b = depth <= 2 ? (() => { try { const bb = getBounds(node); return ` bb=[${f(bb.min)}]..[${f(bb.max)}]`; } catch { return ''; } })() : '';
  console.log(`${'  '.repeat(depth)}${node.getName() || '(node)'} t=${f(t)} s=${f(s)} r=${f(r)}${info}${b} kids=${node.listChildren().length}`);
  if (depth < 3) node.listChildren().forEach((c) => walk(c, depth + 1));
}
for (const scene of root.listScenes()) scene.listChildren().forEach((n) => walk(n, 0));
console.log('textures', root.listTextures().map((t) => `${t.getName()} ${t.getMimeType()} ${f(t.getSize() ?? [0,0])} ${(t.getImage()?.byteLength/1024|0)}KB`).join(' | '));
console.log('materials', root.listMaterials().length, 'meshes', root.listMeshes().length, 'nodes', root.listNodes().length);
