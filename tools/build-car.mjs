// Converts a downloaded car GLB into the layout the game expects:
//   - metres, y up, nose toward +z, tyres resting on y = 0, centred on x/z
//   - one "body" mesh plus four wheel nodes (wheel_fl, wheel_fr, wheel_rl, wheel_rr)
//     whose origins sit on the axle, so the game can spin and steer them
//   - geometry merged per material, simplified, textures shrunk, Draco compressed
//
// usage: node build-car.mjs <in.glb> <out.glb> '<json config>'
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const [, , input, output, cfgJson = '{}'] = process.argv;
const cfg = { length: 4.5, yaw: null, tris: 60000, error: 0.004, texture: 512, drop: [], ...JSON.parse(cfgJson) };

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});
const doc = await io.read(input);
const root = doc.getRoot();
const scene = root.getDefaultScene() || root.listScenes()[0];

// ---- collect every triangle primitive with its world matrix
const xf = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const dropRe = cfg.drop.length ? new RegExp(cfg.drop.join('|'), 'i') : null;
const parts = [];
scene.traverse((node) => {
  const mesh = node.getMesh();
  if (!mesh) return;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMode() !== 4 || !prim.getAttribute('POSITION')) continue;
    const mat = prim.getMaterial();
    if (dropRe && (dropRe.test(mat?.getName() || '') || dropRe.test(node.getName()))) continue;
    const pos = prim.getAttribute('POSITION');
    const world = new Float32Array(pos.getCount() * 3);
    const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); world.set(xf(m, v[0], v[1], v[2]), i * 3); }
    parts.push({ prim, mat, m, world, name: node.getName() });
  }
});

// ---- normalise: scale to real length, nose to +z, wheels on the ground, centred
const bounds = (arrays, pick = () => true) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const a of arrays) for (let i = 0; i < a.length; i += 3) {
    if (!pick(a[i], a[i + 1], a[i + 2])) continue;
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a[i + k]); hi[k] = Math.max(hi[k], a[i + k]); }
  }
  return { lo, hi, size: hi.map((h, k) => h - lo[k]), mid: hi.map((h, k) => (h + lo[k]) / 2) };
};
let b = bounds(parts.map((p) => p.world));
const yaw = (cfg.yaw ?? (b.size[0] > b.size[2] ? 90 : 0)) * Math.PI / 180;
const cy = Math.cos(yaw), sy = Math.sin(yaw);
const scale = cfg.length / Math.max(b.size[0], b.size[2]);
for (const p of parts) {
  const a = p.world;
  for (let i = 0; i < a.length; i += 3) {
    const x = a[i] - b.mid[0], y = a[i + 1] - b.lo[1], z = a[i + 2] - b.mid[2];
    a[i] = (x * cy + z * sy) * scale; a[i + 1] = y * scale; a[i + 2] = (-x * sy + z * cy) * scale;
  }
}
b = bounds(parts.map((p) => p.world));
console.log(`size  ${b.size.map((n) => n.toFixed(2)).join(' x ')} m (w,h,l), scale ${scale.toFixed(4)}, yaw ${Math.round(yaw * 180 / Math.PI)}`);

// ---- find the wheels: four clusters of vertices touching the ground
const wheels = [];
for (const [name, sx, sz] of [['wheel_fl', 1, 1], ['wheel_fr', -1, 1], ['wheel_rl', 1, -1], ['wheel_rr', -1, -1]]) {
  const o = cfg.wheels?.[name] || {};
  const inQuad = (x, z) => x * sx > 0.3 && z * sz > 0.4;
  const patch = bounds(parts.map((p) => p.world), (x, y, z) => y < 0.02 && inQuad(x, z));
  const cz = o.z ?? patch.mid[2], cx0 = patch.mid[0];
  // radius: a tyre of radius r is 2*sqrt(2rh - h^2) long at height h; measure that just above the ground
  let r = o.r ?? (sz > 0 ? cfg.rFront : cfg.rRear);
  if (r == null) {
    const est = [];
    for (let h = 0.04; h <= 0.101; h += 0.01) {
      const band = bounds(parts.map((p) => p.world), (x, y, z) => Math.abs(y - h) < 0.004 && Math.abs(x - cx0) < 0.12 && Math.abs(z - cz) < 0.45);
      const e = band.size[2] / 2;
      if (e > 0.05) est.push((e * e + h * h) / (2 * h));
    }
    est.sort((x, y) => x - y);
    r = est.length ? est[est.length >> 1] : 0.34;
  }
  const near = bounds(parts.map((p) => p.world), (x, y, z) => inQuad(x, z) && Math.hypot(z - cz, y - r) < r * 0.6 && Math.abs(x - cx0) < 0.3);
  const outer = sx > 0 ? near.hi[0] : near.lo[0];
  const width = o.width ?? cfg.wheelWidth ?? 0.34;
  wheels.push({ name, sx, r, cz, outer, inner: outer - sx * width, cx: outer - sx * width / 2 });
}
for (const [i, j] of [[0, 1], [2, 3]]) if (!cfg.wheels && cfg.rFront == null) wheels[i].r = wheels[j].r = (wheels[i].r + wheels[j].r) / 2;
for (const w of wheels) console.log(`${w.name} r=${w.r.toFixed(3)} z=${w.cz.toFixed(3)} x=${w.cx.toFixed(3)} outer=${w.outer.toFixed(3)}`);

const keepRe = cfg.keep ? new RegExp(cfg.keep, 'i') : null;   // materials that always stay on the body (paint)
const bucketOf = (a, i0, i1, i2, mat) => {
  if (keepRe && keepRe.test(mat?.getName() || '')) return 0;
  for (let k = 0; k < 4; k++) {
    const w = wheels[k], lim = w.r * 1.012;
    let inside = true;
    for (const i of [i0, i1, i2]) {
      const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
      const lat = (x - w.inner) * w.sx;
      if (lat < 0 || lat > Math.abs(w.outer - w.inner) + 0.045 || Math.hypot(z - w.cz, y - w.r) > lim) { inside = false; break; }
    }
    if (inside) return k + 1;
  }
  return 0;
};

// ---- re-bucket every triangle into body / wheel, merged per material
const groups = new Map();   // "bucket|materialIndex" -> arrays
const mats = root.listMaterials();
for (const p of parts) {
  const { prim, world, m } = p;
  const idx = prim.getIndices();
  const count = idx ? idx.getCount() : world.length / 3;
  const nrm = prim.getAttribute('NORMAL'), uv = prim.getAttribute('TEXCOORD_0');
  const flip = (m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5])) < 0;
  const remap = new Map();
  const tmp = [0, 0, 0], t2 = [0, 0];
  for (let t = 0; t < count; t += 3) {
    const tri = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k));
    if (flip) tri.reverse();
    const bucket = bucketOf(world, tri[0], tri[1], tri[2], p.mat);
    const key = `${bucket}|${mats.indexOf(p.mat)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { bucket, mat: p.mat, pos: [], nrm: [], uv: [], idx: [], hasUv: false });
    for (const i of tri) {
      const rk = `${bucket}:${i}`;
      let ni = remap.get(rk);
      if (ni == null) {
        ni = g.pos.length / 3;
        remap.set(rk, ni);
        const w = bucket ? wheels[bucket - 1] : null;
        g.pos.push(world[i * 3] - (w ? w.cx : 0), world[i * 3 + 1] - (w ? w.r : 0), world[i * 3 + 2] - (w ? w.cz : 0));
        if (nrm) {
          nrm.getElement(i, tmp);
          // rotation-only approximation of the normal matrix (models here use uniform scale)
          const wx = m[0] * tmp[0] + m[4] * tmp[1] + m[8] * tmp[2], wy = m[1] * tmp[0] + m[5] * tmp[1] + m[9] * tmp[2], wz = m[2] * tmp[0] + m[6] * tmp[1] + m[10] * tmp[2];
          const rx = wx * cy + wz * sy, rz = -wx * sy + wz * cy, len = Math.hypot(rx, wy, rz) || 1;
          g.nrm.push(rx / len, wy / len, rz / len);
        } else g.nrm.push(0, 1, 0);
        if (uv) { uv.getElement(i, t2); g.uv.push(t2[0], t2[1]); g.hasUv = true; } else g.uv.push(0, 0);
      }
      g.idx.push(ni);
    }
  }
}

// ---- rebuild the scene from the merged groups
for (const s of root.listScenes()) for (const n of s.listChildren()) n.dispose();
for (const a of root.listAnimations()) a.dispose();
for (const s of root.listSkins()) s.dispose();
const buffer = root.listBuffers()[0];
const names = ['body', ...wheels.map((w) => w.name)];
const nodes = names.map((name, k) => {
  const node = doc.createNode(name).setMesh(doc.createMesh(name));
  if (k) node.setTranslation([wheels[k - 1].cx, wheels[k - 1].r, wheels[k - 1].cz]);
  scene.addChild(node);
  return node;
});
for (const g of groups.values()) {
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.pos)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.nrm)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(g.idx)).setBuffer(buffer));
  if (g.hasUv) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(g.uv)).setBuffer(buffer));
  if (g.mat) prim.setMaterial(g.mat);
  nodes[g.bucket].getMesh().addPrimitive(prim);
}

// Glass that uses transmission costs a whole extra scene render per frame in three.js; use plain blending.
for (const mat of mats) {
  if (mat.getExtension('KHR_materials_transmission')) {
    mat.setExtension('KHR_materials_transmission', null);
    const c = mat.getBaseColorFactor();
    mat.setBaseColorFactor([c[0], c[1], c[2], Math.min(c[3], 0.45)]).setAlphaMode('BLEND');
  }
  mat.setExtension('KHR_materials_volume', null);
}

const total = [...groups.values()].reduce((n, g) => n + g.idx.length / 3, 0);
await MeshoptSimplifier.ready;
await doc.transform(
  prune(),
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, cfg.tris / total), error: cfg.error }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.texture, cfg.texture], quality: 80 }),
  prune(),
);
doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER });
await io.write(output, doc);

// ---- report, so the game's per-car material config can be written
const after = {};
for (const node of nodes) for (const prim of node.getMesh().listPrimitives()) {
  const n = prim.getMaterial()?.getName() || '(none)';
  after[n] = after[n] || { body: 0, wheel: 0, mat: prim.getMaterial() };
  after[n][node.getName() === 'body' ? 'body' : 'wheel'] += prim.getIndices().getCount() / 3;
}
let sum = 0;
for (const [n, a] of Object.entries(after).sort((x, y) => (y[1].body + y[1].wheel) - (x[1].body + x[1].wheel))) {
  sum += a.body + a.wheel;
  const c = a.mat?.getBaseColorFactor().map((x) => x.toFixed(2)).join(',');
  console.log(`  ${n.padEnd(34)} body ${String(Math.round(a.body)).padStart(6)}  wheel ${String(Math.round(a.wheel)).padStart(6)}  rgba ${c} ${a.mat?.getBaseColorTexture() ? 'TEX' : ''} ${a.mat?.getAlphaMode() !== 'OPAQUE' ? a.mat?.getAlphaMode() : ''}`);
}
console.log(`triangles ${Math.round(total)} -> ${Math.round(sum)}, materials ${Object.keys(after).length}`);
