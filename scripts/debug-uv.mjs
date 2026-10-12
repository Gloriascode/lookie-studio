// Debug one product's unwrap: node scripts/debug-uv.mjs <room> <node name> [drape|sewn]
// Prints per-chart area / slope / extent (UV_DEBUG) without writing anything.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { SCENE_BY_ID } from '../src/scenes.js';
import { unwrapProduct, horizontalAxis } from './lib/productUV.mjs';
process.env.UV_DEBUG = '1';
const [room, name, mode = 'sewn'] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const doc = await io.read(SCENE_BY_ID[room].raw);
const node = doc.getRoot().listNodes().find((n) => n.getName() === name);
const prim = node.getMesh().listPrimitives()[0];
const idx = prim.getIndices().getArray();
const P = prim.getAttribute('POSITION').getArray(), N = prim.getAttribute('NORMAL').getArray();
const used = new Int32Array(P.length / 3).fill(-1), order = [];
for (const i of idx) if (used[i] < 0) { used[i] = order.length; order.push(i); }
const pick = (src, size) => { const d = new src.constructor(order.length * size); order.forEach((o, i) => { for (let k = 0; k < size; k++) d[i * size + k] = src[o * size + k]; }); return d; };
const mesh = { positions: pick(P, 3), normals: pick(N, 3), index: Uint32Array.from(idx, (i) => used[i]) };
const w = node.getWorldMatrix();
const W = new Float64Array(mesh.positions.length);
for (let i = 0; i < W.length; i += 3) { const [x, y, z] = [mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]; W[i] = w[0] * x + w[4] * y + w[8] * z + w[12]; W[i + 1] = w[1] * x + w[5] * y + w[9] * z + w[13]; W[i + 2] = w[2] * x + w[6] * y + w[10] * z + w[14]; }
const res = await unwrapProduct(mesh, w, { mode, horizontalAxis: horizontalAxis(W) });
console.log(res.stats);
