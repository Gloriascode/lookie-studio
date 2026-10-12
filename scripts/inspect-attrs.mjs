import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;
for (const n of doc.getRoot().listNodes()) {
  const m = n.getMesh(); if (!m) continue;
  if (only && !only.test(n.getName())) continue;
  const ps = m.listPrimitives();
  const info = ps.map((p) => {
    const uv = p.getAttribute('TEXCOORD_0');
    let r = '';
    if (uv) { const a = uv.getArray(); let mn = [1e9, 1e9], mx = [-1e9, -1e9]; for (let i = 0; i < a.length; i += 2) { mn[0] = Math.min(mn[0], a[i]); mn[1] = Math.min(mn[1], a[i + 1]); mx[0] = Math.max(mx[0], a[i]); mx[1] = Math.max(mx[1], a[i + 1]) } r = ` uv[${mn.map((x) => x.toFixed(2))}..${mx.map((x) => x.toFixed(2))}]` }
    return `${p.listSemantics().join(',')} v${p.getAttribute('POSITION').getCount()} t${(p.getIndices()?.getCount() ?? 0) / 3}${r} ${p.getMaterial()?.getBaseColorTexture() ? 'TEX' : ''}`
  })
  console.log(n.getName().padEnd(28), JSON.stringify(n.getExtras()), info.join(' | '))
}
