import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const ROAD_HALF = 7.5;          // half the tarmac width, metres
export const WALL = ROAD_HALF + 7;     // guard-rail distance from the centre line

const SCALE = 1.4;
const CONTROL = [
  [0, 0], [90, 0], [170, -20], [220, -80], [200, -160], [130, -190], [70, -150], [10, -170],
  [-40, -240], [-130, -250], [-190, -190], [-170, -110], [-100, -80], [-110, -20], [-60, 0],
];

// Small deterministic PRNG so the scenery is identical on every load.
function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(size, draw, renderer) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

function speckle(ctx, size, count, rand, shade) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = shade(rand());
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
}

export function buildTrack(scene, renderer) {
  const rand = mulberry(20261002);

  // ------------------------------------------------------------ centre line
  const curve = new THREE.CatmullRomCurve3(
    CONTROL.map(([x, z]) => new THREE.Vector3(x * SCALE, 0, z * SCALE)), true, 'centripetal',
  );
  const length = curve.getLength();
  const N = Math.round(length / 2);
  const DS = length / N;
  const pts = curve.getSpacedPoints(N);
  pts.pop();
  const at = (i) => pts[((i % N) + N) % N];
  const tan = pts.map((_, i) => at(i + 1).clone().sub(at(i - 1)).normalize());
  const nrm = tan.map((t) => new THREE.Vector3(t.z, 0, -t.x));   // points to the driver's left

  // Rival pace: corner speed from curvature, then a backwards pass for braking distances.
  const speedProfile = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = tan[(i + N - 3) % N], b = tan[(i + 3) % N];
    const kappa = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)) / (6 * DS);
    speedProfile[i] = Math.min(76, Math.sqrt(24 / Math.max(kappa, 1e-4)));
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) {
      const next = speedProfile[(i + 1) % N];
      speedProfile[i] = Math.min(speedProfile[i], Math.sqrt(next * next + 2 * 20 * DS));
    }
  }

  // A strip that follows the track between two lateral offsets (a = left edge, b = right edge).
  function ribbon(a, b, ya, yb, vScale) {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const k = i % N, p = pts[k], n = nrm[k];
      pos.push(p.x + n.x * a, ya, p.z + n.z * a, p.x + n.x * b, yb, p.z + n.z * b);
      uv.push(0, (i * DS) / vScale, 1, (i * DS) / vScale);
      if (i < N) { const j = i * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // ------------------------------------------------------------ ground
  const grassTex = canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = '#46612c';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 9000, rand, (r) => `hsl(${82 + r * 26}, ${32 + r * 22}%, ${18 + r * 20}%)`);
  }, renderer);
  grassTex.repeat.set(700, 700);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(5000, 5000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }),
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // ------------------------------------------------------------ tarmac
  const roadTex = canvasTexture(1024, (ctx, s) => {
    ctx.fillStyle = '#2b2c30';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 26000, rand, (r) => `rgba(${r > 0.5 ? '255,255,255' : '0,0,0'},${0.03 + r * 0.07})`);
    // tyre-worn racing line
    const g = ctx.createLinearGradient(0, 0, s, 0);
    g.addColorStop(0.15, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,.22)');
    g.addColorStop(0.85, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#e9e9e4';
    ctx.fillRect(s * 0.025, 0, s * 0.014, s);
    ctx.fillRect(s * 0.961, 0, s * 0.014, s);
    ctx.fillRect(s * 0.495, 0, s * 0.01, s * 0.45);
  }, renderer);
  const road = new THREE.Mesh(
    ribbon(ROAD_HALF, -ROAD_HALF, 0.02, 0.02, 14),
    new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.82, metalness: 0.05 }),
  );
  road.receiveShadow = true;
  scene.add(road);

  const kerbTex = canvasTexture(64, (ctx, s) => {
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#c0261f';
    ctx.fillRect(0, 0, s, s / 2);
  }, renderer);
  const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.7 });
  for (const [a, b] of [[ROAD_HALF + 1.2, ROAD_HALF], [-ROAD_HALF, -ROAD_HALF - 1.2]]) {
    const kerb = new THREE.Mesh(ribbon(a, b, 0.035, 0.035, 4), kerbMat);
    kerb.receiveShadow = true;
    scene.add(kerb);
  }

  // ------------------------------------------------------------ guard rails
  const railMat = new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide });
  for (const side of [1, -1]) {
    const rail = new THREE.Mesh(ribbon(side * WALL, side * WALL, 0.95, 0.35, 4), railMat);
    rail.castShadow = rail.receiveShadow = true;
    scene.add(rail);
  }
  const postGeo = new THREE.BoxGeometry(0.14, 0.9, 0.14).translate(0, 0.45, 0);
  const postCount = Math.floor(N / 2) * 2;
  const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x6d727a, metalness: 0.7, roughness: 0.5 }), postCount);
  const m4 = new THREE.Matrix4();
  for (let i = 0, c = 0; i < Math.floor(N / 2); i++) {
    const k = i * 2;
    for (const side of [1, -1]) {
      m4.makeTranslation(pts[k].x + nrm[k].x * side * (WALL + 0.1), 0, pts[k].z + nrm[k].z * side * (WALL + 0.1));
      posts.setMatrixAt(c++, m4);
    }
  }
  scene.add(posts);

  // ------------------------------------------------------------ street lamps
  const lampEvery = 22;
  const lampCount = Math.floor(N / lampEvery);
  const poles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.09, 0.13, 8, 8).translate(0, 4, 0),
    new THREE.MeshStandardMaterial({ color: 0x30343b, metalness: 0.8, roughness: 0.4 }), lampCount,
  );
  const arms = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.6, 0.1, 0.16).translate(-1.2, 8, 0),
    poles.material, lampCount,
  );
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 6.2, 3.2) });
  const glows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.08, 0.3).translate(-2.1, 7.92, 0), glowMat, lampCount);
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  for (let i = 0; i < lampCount; i++) {
    const k = i * lampEvery, side = i % 2 ? 1 : -1;
    v.set(pts[k].x + nrm[k].x * side * (WALL + 1.6), 0, pts[k].z + nrm[k].z * side * (WALL + 1.6));
    // local -x (the arm) should point back toward the road
    q.setFromAxisAngle(up, Math.atan2(-nrm[k].z * side, nrm[k].x * side));
    m4.compose(v, q, one);
    poles.setMatrixAt(i, m4); arms.setMatrixAt(i, m4); glows.setMatrixAt(i, m4);
  }
  poles.castShadow = true;
  scene.add(poles, arms, glows);

  // ------------------------------------------------------------ start / finish
  const checkTex = canvasTexture(256, (ctx, s) => {
    const c = s / 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#f2f2f2';
      ctx.fillRect(x * c, y * c, c, c);
    }
  }, renderer);
  const startYaw = Math.atan2(tan[0].x, tan[0].z);
  const lineTex = checkTex.clone();
  lineTex.needsUpdate = true;
  lineTex.repeat.set(4, 0.5);
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_HALF * 2, 2).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: lineTex, roughness: 0.8 }),
  );
  line.position.set(pts[0].x, 0.03, pts[0].z);
  line.rotation.y = startYaw;
  line.receiveShadow = true;
  scene.add(line);

  const gantry = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x23262c, metalness: 0.85, roughness: 0.35 });
  for (const side of [1, -1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), steel);
    leg.position.set(side * (WALL + 0.6), 4, 0);
    leg.castShadow = true;
    gantry.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(WALL * 2 + 1.8, 1.6, 0.7), steel);
  beam.position.y = 7.6;
  beam.castShadow = true;
  const bannerTex = checkTex.clone();
  bannerTex.needsUpdate = true;
  bannerTex.repeat.set(5, 0.25);
  const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTex, emissiveMap: bannerTex, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.6 });
  for (const dz of [0.37, -0.37]) {
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(WALL * 2, 1.2), bannerMat);
    banner.position.set(0, 7.6, dz);
    if (dz < 0) banner.rotation.y = Math.PI;
    gantry.add(banner);
  }
  gantry.add(beam);
  gantry.position.set(pts[0].x, 0, pts[0].z);
  gantry.rotation.y = startYaw;
  scene.add(gantry);

  // ------------------------------------------------------------ trees
  const cx = pts.reduce((s, p) => s + p.x, 0) / N, cz = pts.reduce((s, p) => s + p.z, 0) / N;
  const distToTrack = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < N; i += 2) {
      const dx = x - pts[i].x, dz = z - pts[i].z;
      best = Math.min(best, dx * dx + dz * dz);
    }
    return Math.sqrt(best);
  };
  const spots = [];
  for (let tries = 0; spots.length < 900 && tries < 20000; tries++) {
    const x = cx + (rand() - 0.5) * 1100, z = cz + (rand() - 0.5) * 1000;
    const d = distToTrack(x, z);
    if (d > WALL + 6 && d < 230 && rand() < 1.15 - d / 230) spots.push([x, z]);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3, 6).translate(0, 1.5, 0);
  const crownGeo = mergeGeometries([
    new THREE.ConeGeometry(2.7, 4.2, 8).translate(0, 4.2, 0),
    new THREE.ConeGeometry(2.1, 3.8, 8).translate(0, 6.4, 0),
    new THREE.ConeGeometry(1.4, 3.4, 8).translate(0, 8.5, 0),
  ]);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 1 }), spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), spots.length);
  const col = new THREE.Color();
  spots.forEach(([x, z], i) => {
    const s = 0.8 + rand() * 0.9;
    v.set(x, 0, z);
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    m4.compose(v, q, new THREE.Vector3(s, s * (0.85 + rand() * 0.4), s));
    trunks.setMatrixAt(i, m4);
    crowns.setMatrixAt(i, m4);
    crowns.setColorAt(i, col.setHSL(0.26 + rand() * 0.08, 0.45 + rand() * 0.2, 0.07 + rand() * 0.07));
  });
  trunks.castShadow = crowns.castShadow = true;
  scene.add(trunks, crowns);

  // ------------------------------------------------------------ distant hills
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x39424f, roughness: 1, flatShading: true });
  for (let i = 0; i < 46; i++) {
    const ang = (i / 46) * Math.PI * 2 + rand() * 0.12;
    const dist = 760 + rand() * 520;
    const h = 90 + rand() * 230;
    const hill = new THREE.Mesh(new THREE.ConeGeometry(190 + rand() * 230, h, 7, 3), hillMat);
    hill.position.set(cx + Math.cos(ang) * dist, h / 2 - 6, cz + Math.sin(ang) * dist);
    hill.rotation.y = rand() * Math.PI;
    scene.add(hill);
  }

  return { pts, tan, nrm, N, DS, speedProfile, length };
}
