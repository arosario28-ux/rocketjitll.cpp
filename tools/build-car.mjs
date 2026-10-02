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

// ---- find the wheels
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

// Direction in which a point cloud is thinnest. For a tyre and rim that is the axle.
function thinAxis(pts) {
  const n = pts.length / 3, mean = [0, 0, 0];
  for (let i = 0; i < pts.length; i += 3) for (let k = 0; k < 3; k++) mean[k] += pts[i + k] / n;
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < pts.length; i += 3) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) c[j][k] += (pts[i + j] - mean[j]) * (pts[i + k] - mean[k]) / n;
  // Jacobi eigen-decomposition of the 3x3 covariance
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
    if (Math.abs(c[p][q]) < 1e-12) continue;
    const th = 0.5 * Math.atan2(2 * c[p][q], c[q][q] - c[p][p]), co = Math.cos(th), si = Math.sin(th);
    for (let k = 0; k < 3; k++) { const a = c[k][p], b2 = c[k][q]; c[k][p] = co * a - si * b2; c[k][q] = si * a + co * b2; }
    for (let k = 0; k < 3; k++) { const a = c[p][k], b2 = c[q][k]; c[p][k] = co * a - si * b2; c[q][k] = si * a + co * b2; }
    for (let k = 0; k < 3; k++) { const a = v[k][p], b2 = v[k][q]; v[k][p] = co * a - si * b2; v[k][q] = si * a + co * b2; }
  }
  const m = [0, 1, 2].reduce((best, k) => (c[k][k] < c[best][best] ? k : best), 0);
  return unit([v[0][m], v[1][m], v[2][m]]);
}

// cfg.wheelParts names materials (or nodes) that only occur on wheels. With it, each wheel's
// centre, radius and width are measured from that geometry; cfg.unsteer also straightens wheels
// the artist posed turned or cambered. Without it, the wheel is assumed to be a cylinder of the
// configured radius standing on the ground above its contact patch.
const partsRe = cfg.wheelParts ? new RegExp(cfg.wheelParts, 'i') : null;
const wheels = [];
for (const [name, sx, sz] of [['wheel_fl', 1, 1], ['wheel_fr', -1, 1], ['wheel_rl', 1, -1], ['wheel_rr', -1, -1]]) {
  const inQuad = (x, z) => x * sx > 0.3 && z * sz > 0.4;
  const patch = bounds(parts.map((p) => p.world), (x, y, z) => y < 0.06 && inQuad(x, z));
  const r0 = (sz > 0 ? cfg.rFront : cfg.rRear) ?? 0.34;
  const cz0 = patch.mid[2], cx0 = patch.mid[0];
  let ax = [1, 0, 0], c, r, inA, outA;
  if (partsRe) {
    const pts = [];
    for (const p of parts) {
      if (!partsRe.test(p.mat?.getName() || '') && !partsRe.test(p.name)) continue;
      for (let i = 0, a = p.world; i < a.length; i += 3) {
        if (inQuad(a[i], a[i + 2]) && Math.abs(a[i] - cx0) < 0.4 && Math.hypot(a[i + 2] - cz0, a[i + 1] - r0) < r0 + 0.12) pts.push(a[i], a[i + 1], a[i + 2]);
      }
    }
    if (pts.length < 30) throw new Error(`wheelParts matched nothing near ${name}`);
    if (cfg.unsteer) { ax = thinAxis(pts); if (ax[0] < 0) ax = ax.map((v) => -v); }
    const up = unit([0, 1, 0].map((v, k) => v - ax[1] * ax[k])), fw = cross(ax, up);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pts.length; i += 3) [ax, up, fw].forEach((e, k) => { const d = pts[i] * e[0] + pts[i + 1] * e[1] + pts[i + 2] * e[2]; lo[k] = Math.min(lo[k], d); hi[k] = Math.max(hi[k], d); });
    const mid = lo.map((l, k) => (l + hi[k]) / 2);
    c = [0, 1, 2].map((k) => ax[k] * mid[0] + up[k] * mid[1] + fw[k] * mid[2]);
    r = Math.max(hi[1] - lo[1], hi[2] - lo[2]) / 2 + (cfg.rPad ?? 0);
    const hw = (hi[0] - lo[0]) / 2;
    inA = -(hw + 0.03); outA = hw + 0.03;
    wheels.push({ name, sx, ax, up, fw, c, r, inA, outA });
  } else {
    r = r0;
    const near = bounds(parts.map((p) => p.world), (x, y, z) => inQuad(x, z) && Math.hypot(z - cz0, y - r) < r * 0.6 && Math.abs(x - cx0) < 0.3);
    const outer = sx > 0 ? near.hi[0] : near.lo[0];
    const width = cfg.wheelWidth ?? 0.34;
    wheels.push({ name, sx, ax, up: [0, 1, 0], fw: [0, 0, 1], c: [outer - sx * width / 2, r, cz0], r, inA: -width / 2, outA: width / 2 + 0.045 });
  }
}
if (partsRe) {
  // stand the car on its tyres, whatever else hangs lower in the file
  const ground = Math.min(...wheels.map((w) => w.c[1] - w.r));
  for (const p of parts) for (let i = 1; i < p.world.length; i += 3) p.world[i] -= ground;
  for (const w of wheels) w.c[1] -= ground;
}
for (const w of wheels) console.log(`${w.name} r=${w.r.toFixed(3)} centre=${w.c.map((v) => v.toFixed(3)).join(',')} axle=${w.ax.map((v) => v.toFixed(3)).join(',')} width=${(w.outA - w.inA).toFixed(3)}`);

const keepRe = cfg.keep ? new RegExp(cfg.keep, 'i') : null;   // materials that always stay on the body (paint)
const bucketOf = (a, i0, i1, i2, mat) => {
  if (keepRe && keepRe.test(mat?.getName() || '')) return 0;
  for (let k = 0; k < 4; k++) {
    const w = wheels[k], lim = w.r * 1.012;
    let inside = true;
    for (const i of [i0, i1, i2]) {
      const d = [a[i * 3] - w.c[0], a[i * 3 + 1] - w.c[1], a[i * 3 + 2] - w.c[2]];
      const along = dot(d, w.ax) * w.sx;
      if (along < w.inA || along > w.outA || Math.hypot(dot(d, w.up), dot(d, w.fw)) > lim) { inside = false; break; }
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
        // wheel vertices are stored in the wheel's own frame: x along the axle, origin on it
        const local = (v) => (w ? [dot(v, w.ax), dot(v, w.up), dot(v, w.fw)] : v);
        const wp = [world[i * 3], world[i * 3 + 1], world[i * 3 + 2]];
        g.pos.push(...local(w ? wp.map((v, k) => v - w.c[k]) : wp));
        if (nrm) {
          nrm.getElement(i, tmp);
          // rotation-only approximation of the normal matrix (models here use uniform scale)
          const wx = m[0] * tmp[0] + m[4] * tmp[1] + m[8] * tmp[2], wy = m[1] * tmp[0] + m[5] * tmp[1] + m[9] * tmp[2], wz = m[2] * tmp[0] + m[6] * tmp[1] + m[10] * tmp[2];
          const rx = wx * cy + wz * sy, rz = -wx * sy + wz * cy, len = Math.hypot(rx, wy, rz) || 1;
          g.nrm.push(...local([rx / len, wy / len, rz / len]));
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
  if (k) node.setTranslation(wheels[k - 1].c);
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
