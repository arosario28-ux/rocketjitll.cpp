import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const ROAD_HALF = 7.5;          // half the tarmac width, metres
export const WALL = ROAD_HALF + 7;     // guard-rail distance from the centre line

// Each track is a closed loop through these points (x, z), scaled to metres.
// The start line is at the first point, facing the second. `theme` picks its scene.
const ring = (radii) => radii.map((r, i) => {
  const a = (i / radii.length) * Math.PI * 2;
  return [Math.round(Math.sin(a) * r), Math.round(-Math.cos(a) * r)];
});

export const TRACKS = [
  {
    id: 'sunset', name: 'Sunset Circuit', theme: 'forest', blurb: 'sunset forest', scale: 1.4, seed: 20261002,
    points: [
      [0, 0], [90, 0], [170, -20], [220, -80], [200, -160], [130, -190], [70, -150], [10, -170],
      [-40, -240], [-130, -250], [-190, -190], [-170, -110], [-100, -80], [-110, -20], [-60, 0],
    ],
  },
  {
    id: 'city', name: 'Neon District', theme: 'city', blurb: 'rain-soaked neon streets', scale: 1, seed: 808,
    points: [
      [0, 0], [120, 0], [240, 0], [285, -15], [300, -60], [300, -140], [285, -185], [240, -200], [150, -200],
      [110, -215], [100, -260], [100, -330], [85, -375], [40, -390], [-120, -390], [-165, -375], [-180, -330],
      [-180, -250], [-195, -205], [-240, -190], [-300, -190], [-345, -175], [-360, -130], [-360, -60],
      [-345, -15], [-300, 0], [-150, 0],
    ],
  },
  {
    id: 'volcano', name: 'Ember Peak', theme: 'volcano', blurb: 'lava fields around a live volcano', scale: 1.3, seed: 451,
    points: ring([230, 250, 215, 240, 270, 225, 205, 240, 262, 218, 236, 256]),
  },
  {
    // A point-to-point sprint: the race ends `sprint` metres down the first straight.
    id: 'drag', name: 'Half-Mile Drag', theme: 'dragstrip', blurb: 'flat-out drag strip', scale: 1, seed: 402, sprint: 804,
    points: [
      [0, 0], [300, 0], [600, 0], [900, 0], [1080, -30], [1140, -110], [1080, -190], [900, -220],
      [450, -220], [0, -220], [-180, -190], [-240, -110], [-180, -30],
    ],
  },
  {
    id: 'island', name: 'Palm Island', theme: 'coast', blurb: 'island coast road', scale: 1.2, seed: 77,
    points: [
      [0, 0], [120, 10], [220, -40], [260, -130], [200, -210], [100, -200], [40, -140], [-40, -180],
      [-60, -270], [-160, -300], [-240, -230], [-220, -130], [-140, -90], [-150, -20], [-80, 10],
    ],
  },
  {
    id: 'autumn', name: 'Autumn Park', theme: 'autumn', blurb: 'parkland in autumn', scale: 1.3, seed: 1031,
    points: [
      [0, 0], [110, 0], [190, -40], [200, -120], [140, -170], [150, -250], [90, -310], [0, -290],
      [-30, -210], [-110, -190], [-180, -240], [-250, -190], [-230, -100], [-150, -60], [-120, 0],
    ],
  },
  {
    id: 'speedway', name: 'Pinewood Speedway', theme: 'speedway', blurb: 'sunlit oval', scale: 1.6, seed: 7,
    points: [
      [0, 0], [150, 0], [230, -30], [270, -100], [230, -170], [150, -200],
      [-150, -200], [-230, -170], [-270, -100], [-230, -30], [-150, 0],
    ],
  },
  {
    id: 'switchback', name: 'Switchback Ridge', theme: 'alpine', blurb: 'snowy mountain pass', scale: 1.3, seed: 99,
    points: [
      [0, 0], [100, 0], [160, -20], [180, -80], [140, -120], [60, -110], [20, -150], [60, -200],
      [150, -210], [200, -260], [160, -320], [60, -320], [-40, -290], [-80, -220], [-60, -140],
      [-120, -90], [-180, -120], [-220, -60], [-160, 0], [-80, 10],
    ],
  },
  {
    id: 'grandtour', name: 'Grand Tour', theme: 'desert', blurb: 'desert canyon country', scale: 1.5, seed: 2024,
    points: [
      [0, 0], [140, 0], [260, -30], [330, -110], [300, -210], [200, -250], [120, -200], [40, -240],
      [20, -340], [-80, -400], [-200, -360], [-240, -250], [-170, -170], [-220, -80], [-320, -60],
      [-360, 40], [-280, 110], [-160, 80], [-80, 10],
    ],
  },
];

// Everything that makes one scene look different from another. main.js reads the lighting
// half (sky, sun, hemi, fog, exposure, bloom, weather); buildTrack reads the rest.
//   sky   day:   { elev, az, turbidity, rayleigh, mie, mieG }   night: { night, top, horizon, stars }
//   sun   [colour, intensity, elevation in degrees]      hemi  [sky colour, ground colour, intensity]
//   lamps HDR colours cycled along the track             pools brightness of the light pooled under them
const THEMES = {
  forest: {
    verge: ['#52722f', '#476428'], gravel: '#b9a57e',
    sky: { elev: 4, az: 112, turbidity: 10, rayleigh: 3, mie: 0.005, mieG: 0.75 },
    sun: [0xffc38f, 4.2, 13], hemi: [0x9db4ff, 0x4a3b2c, 0.7], fog: [0xb98f78, 0.0011], exposure: 0.5, bloom: 0.35,
    ground: { base: '#46612c', hue: [82, 26], sat: [32, 22], lum: [18, 20] },
    road: { roughness: 0.82, metalness: 0.05 }, hills: [0x39424f, 0x39424f], lamps: [[9, 6.2, 3.2]], pools: 0.25,
    clouds: 0xffc9a8,
  },
  speedway: {
    verge: ['#5f9f37', '#528e2f'], gravel: '#c9b68c',
    sky: { elev: 38, az: 140, turbidity: 3, rayleigh: 1.1, mie: 0.004, mieG: 0.8 },
    sun: [0xfff4e0, 3.4, 42], hemi: [0xbfd8ff, 0x5a6b3a, 1.0], fog: [0xbcd3e6, 0.0006], exposure: 0.42, bloom: 0.15,
    ground: { base: '#4f8a2e', hue: [88, 22], sat: [45, 20], lum: [24, 18] },
    road: { roughness: 0.85, metalness: 0.03 }, hills: [0x4d6a45, 0x4d6a45], lamps: [[1.2, 1.2, 1.2]], pools: 0,
    clouds: 0xffffff,
  },
  dragstrip: {
    verge: ['#5f9f37', '#528e2f'], gravel: null,
    sky: { elev: 46, az: 180, turbidity: 2.5, rayleigh: 1, mie: 0.004, mieG: 0.8 },
    sun: [0xfff6e6, 3.5, 50], hemi: [0xbfd8ff, 0x5a6b3a, 1.0], fog: [0xc3d8ea, 0.0005], exposure: 0.42, bloom: 0.15,
    ground: { base: '#4f8a2e', hue: [88, 22], sat: [45, 20], lum: [24, 18] },
    road: { roughness: 0.85, metalness: 0.03 }, hills: [0x55724a, 0x55724a], lamps: [[1.2, 1.2, 1.2]], pools: 0,
    clouds: 0xffffff,
  },
  coast: {
    verge: ['#e2cf9c', '#d8c38d'], gravel: '#eadbb0',
    sky: { elev: 52, az: 150, turbidity: 2, rayleigh: 0.8, mie: 0.003, mieG: 0.8 },
    sun: [0xfff8ea, 3.8, 55], hemi: [0xbfe4ff, 0xc9b98a, 1.1], fog: [0xbfe3f2, 0.00045], exposure: 0.42, bloom: 0.15,
    ground: { base: '#dcc890', hue: [44, 10], sat: [42, 14], lum: [62, 14] },
    road: { roughness: 0.85, metalness: 0.03 }, hills: [0x4f8a4a, 0x6aa85a], lamps: [[1.2, 1.2, 1.2]], pools: 0,
    clouds: 0xffffff,
  },
  autumn: {
    verge: ['#7c7a35', '#6d6b2d'], gravel: '#b8a47c',
    sky: { elev: 14, az: 250, turbidity: 6, rayleigh: 2, mie: 0.005, mieG: 0.8 },
    sun: [0xffcf9a, 3.8, 20], hemi: [0xb9c6e6, 0x5a4326, 0.8], fog: [0xd6b890, 0.001], exposure: 0.45, bloom: 0.25,
    ground: { base: '#6f6a2c', hue: [48, 24], sat: [38, 20], lum: [20, 18] },
    road: { roughness: 0.82, metalness: 0.05 }, hills: [0x6b4a2e, 0x8a5a30], lamps: [[6, 4.2, 2.2]], pools: 0.1,
    clouds: 0xffd9b0,
  },
  alpine: {
    verge: ['#f6f9fc', '#e4ebf2'], gravel: '#cdd5de',
    sky: { elev: 16, az: 70, turbidity: 2.5, rayleigh: 1.4, mie: 0.003, mieG: 0.8 },
    sun: [0xfff0e2, 3.0, 22], hemi: [0xcfe2ff, 0x8a93a3, 1.1], fog: [0xd7e2ee, 0.0013], exposure: 0.42, bloom: 0.2,
    ground: { base: '#e9eef3', hue: [205, 15], sat: [10, 15], lum: [84, 12] },
    road: { roughness: 0.7, metalness: 0.05 }, hills: [0x5a6472, 0xf4f7fb], lamps: [[4, 4.4, 5]], pools: 0,
    clouds: 0xffffff, weather: 'snow',
  },
  desert: {
    verge: ['#d2a970', '#c59a62'], gravel: '#dcbc8c',
    sky: { elev: 20, az: 200, turbidity: 6, rayleigh: 1.6, mie: 0.006, mieG: 0.85 },
    sun: [0xffd9a8, 4.0, 26], hemi: [0xcfe0ff, 0x9a6a3c, 0.9], fog: [0xe2c39c, 0.0007], exposure: 0.42, bloom: 0.2,
    ground: { base: '#c79b63', hue: [30, 12], sat: [38, 18], lum: [46, 16] },
    road: { roughness: 0.88, metalness: 0.03 }, hills: [0xa5532f, 0xc0683a], lamps: [[3, 2.6, 2]], pools: 0,
    clouds: 0xffe6cc,
  },
  city: {
    verge: ['#2c2c36', '#25252e'], gravel: null,
    sky: { night: true, top: 0x04030c, horizon: 0x35164f, stars: 0, glow: [0xff2bd6, 0x2ad4ff, 0x7a3cff] },
    sun: [0x8fa0ff, 0.5, 55], hemi: [0x6a4cff, 0x1a1020, 0.4], fog: [0x1a0c2c, 0.0038], exposure: 0.9, bloom: 0.5,
    ground: { base: '#17171d', hue: [250, 20], sat: [6, 10], lum: [7, 9] },
    road: { roughness: 0.2, metalness: 0.55, tint: 0x8a8a9a }, hills: null,
    lamps: [[1.2, 7, 9], [9, 1, 7]], pools: 0.6, clouds: null, weather: 'rain', neonRails: [[0.25, 2.4, 3.4], [3.4, 0.3, 2.4]],
  },
  volcano: {
    verge: ['#262019', '#1e1916'], gravel: '#3d312c',
    sky: { night: true, top: 0x0b0607, horizon: 0x7a1d08, stars: 0, glow: [0xff5a14, 0xff2a00, 0x7a1d08] },
    sun: [0xffa070, 1.3, 30], hemi: [0xff8a5a, 0x2a1510, 0.8], fog: [0x2a0f0a, 0.0017], exposure: 0.85, bloom: 0.45,
    ground: { base: '#1b1716', hue: [15, 12], sat: [8, 10], lum: [7, 9], cracks: true },
    road: { roughness: 0.75, metalness: 0.1 }, hills: [0x1c1514, 0x2a1a16],
    lamps: [[9, 3.2, 0.8]], pools: 0.8, clouds: null, weather: 'embers',
  },
};

// Trees, grass, bushes and rocks are small models from Kenney's Nature Kit (CC0), loaded once and
// instanced thousands of times. Each is stored standing on y = 0 and one unit tall.
const NATURE_FILES = [
  'tree_pineTallA_detailed', 'tree_pineTallB_detailed', 'tree_pineRoundC', 'tree_pineDefaultA',
  'tree_oak', 'tree_detailed', 'tree_default', 'tree_oak_fall', 'tree_detailed_fall', 'tree_default_fall',
  'tree_palmDetailedTall', 'tree_palmBend', 'tree_palmDetailedShort',
  'grass_large', 'grass_leafsLarge', 'grass', 'plant_bushDetailed', 'plant_bushLarge',
  'rock_largeA', 'rock_largeC', 'rock_tallB', 'stone_largeB', 'stone_tallD',
  'cactus_tall', 'cactus_short', 'flower_yellowA', 'flower_redA', 'flower_purpleA',
];
const nature = {};   // name -> [{ geometry, color, kind }]
// The kit ships in a pastel palette; these are the natural colours used instead, by material name.
const NATURE_COLORS = [
  [/leafsDark/, 0x2c5a30], [/leafsFall/, 0xc46f24], [/leafs/, 0x4b8a34], [/grass/, 0x5c9140],
  [/woodBirch/, 0xa89479], [/wood/, 0x58402e], [/stone|_defaultMat/, 0x86827c], [/dirt/, 0x6d5a46],
];

export async function loadNature() {
  const loader = new GLTFLoader();
  await Promise.all(NATURE_FILES.map(async (name) => {
    try {
      const { scene } = await loader.loadAsync(`assets/nature/${name}.glb`);
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const height = box.max.y - box.min.y || 1;
      const fit = new THREE.Matrix4().makeScale(1 / height, 1 / height, 1 / height)
        .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
      const parts = [];
      scene.traverse((o) => {
        if (o.isMesh) parts.push({ geometry: o.geometry.clone().applyMatrix4(o.matrixWorld).applyMatrix4(fit), color: o.material.color.clone(), kind: o.material.name });
      });
      nature[name] = parts;
    } catch (err) {
      console.warn(`Scenery model ${name} failed to load; plain shapes will stand in.`, err);
    }
  }));
}

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

// The driving line and everything the simulation needs to know about a track.
export function trackLine(def) {
  const curve = new THREE.CatmullRomCurve3(
    def.points.map(([x, z]) => new THREE.Vector3(x * def.scale, 0, z * def.scale)), true, 'centripetal',
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
  // on a sprint track the race ends part-way down the first straight
  const finish = def.sprint ? Math.round(def.sprint / DS) : 0;
  return { pts, tan, nrm, N, DS, speedProfile, length, finish };
}

// Builds the track's scenery into one group, so switching tracks is a single add/remove.
export function buildTrack(renderer, def) {
  const rand = mulberry(def.seed);
  const theme = THEMES[def.theme];
  const route = trackLine(def);
  const { pts, tan, nrm, N, DS, length } = route;
  const group = new THREE.Group();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
  const hdr = ([r, g, b]) => new THREE.Color(r, g, b);

  // A strip that follows the track between two lateral offsets (a = left edge, b = right edge).
  // `from`..`to` are sample indices and may run past N; the default is the whole lap.
  function ribbon(a, b, ya, yb, vScale, from = 0, to = N) {
    const pos = [], uv = [], idx = [];
    for (let i = from; i <= to; i++) {
      const k = ((i % N) + N) % N, p = pts[k], n = nrm[k];
      pos.push(p.x + n.x * a, ya, p.z + n.z * a, p.x + n.x * b, yb, p.z + n.z * b);
      uv.push(0, (i * DS) / vScale, 1, (i * DS) / vScale);
      if (i < to) { const j = (i - from) * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  const cx = pts.reduce((s, p) => s + p.x, 0) / N, cz = pts.reduce((s, p) => s + p.z, 0) / N;
  const box = new THREE.Box3().setFromPoints(pts);
  const spanX = box.max.x - box.min.x, spanZ = box.max.z - box.min.z;
  const distToTrack = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < N; i += 2) {
      const dx = x - pts[i].x, dz = z - pts[i].z;
      best = Math.min(best, dx * dx + dz * dz);
    }
    return Math.sqrt(best);
  };
  // Random spots between minD and maxD metres from the track, denser close to it.
  function scatter(count, minD, maxD) {
    const spots = [];
    for (let tries = 0; spots.length < count && tries < count * 30; tries++) {
      const x = cx + (rand() - 0.5) * (spanX + maxD * 2), z = cz + (rand() - 0.5) * (spanZ + maxD * 2);
      const d = distToTrack(x, z);
      if (d > minD && d < maxD && rand() < 1.15 - d / maxD) spots.push([x, z, d]);
    }
    return spots;
  }
  // One instanced mesh with an instance at each spot; place(i, spot) fills v, q, sc and may return a colour.
  function instances(geo, mat, spots, place, shadow = true) {
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    spots.forEach((spot, i) => {
      q.identity(); sc.copy(one);
      const c = place(i, spot);
      m4.compose(v, q, sc);
      mesh.setMatrixAt(i, m4);
      if (c) mesh.setColorAt(i, c);
    });
    mesh.castShadow = shadow;
    group.add(mesh);
    return mesh;
  }
  // Scatters nature models: each spot gets one of `names` at a random size and turn.
  // `tint(kind)` may return a colour to repaint a material (snow on pines, say). Returns false
  // if none of the models loaded, so the caller can fall back to plain shapes.
  function plant(names, spots, minH, maxH, tint) {
    const ready = names.filter((n) => nature[n]);
    if (!ready.length) return false;
    const picks = spots.map(() => ({ name: ready[Math.floor(rand() * ready.length)], h: minH + rand() * (maxH - minH), turn: rand() * Math.PI * 2 }));
    for (const name of ready) {
      const mine = spots.map((spot, i) => [spot, picks[i]]).filter(([, pick]) => pick.name === name);
      if (!mine.length) continue;
      for (const part of nature[name]) {
        const color = tint?.(part.kind) ?? NATURE_COLORS.find(([re]) => re.test(part.kind))?.[1] ?? part.color;
        instances(part.geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true }), mine, (i, [[x, z], pick]) => {
          v.set(x, 0, z);
          q.setFromAxisAngle(up, pick.turn);
          sc.setScalar(pick.h);
          return new THREE.Color().setScalar(0.78 + rand() * 0.44);   // no two quite the same shade
        });
      }
    }
    return true;
  }
  const leaves = (kind) => /leaf|grass/i.test(kind);

  const glowTex = canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }, renderer);
  const glowMat = (opacity = 1) => new THREE.MeshBasicMaterial({
    map: glowTex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });

  // ------------------------------------------------------------ ground
  const gt = theme.ground;
  const groundTex = canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = gt.base;
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 9000, rand, (r) => `hsl(${gt.hue[0] + r * gt.hue[1]}, ${gt.sat[0] + r * gt.sat[1]}%, ${gt.lum[0] + r * gt.lum[1]}%)`);
  }, renderer);
  groundTex.repeat.set(700, 700);
  const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 });
  if (gt.cracks) {
    // glowing lava seams, on a coarser repeat than the rock so the pattern isn't obviously tiled
    const crackTex = canvasTexture(512, (ctx, s) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, s, s);
      ctx.lineCap = 'round';
      for (let i = 0; i < 26; i++) {
        let x = rand() * s, y = rand() * s, a = rand() * Math.PI * 2;
        ctx.strokeStyle = `hsl(${14 + rand() * 22}, 100%, ${45 + rand() * 20}%)`;
        ctx.lineWidth = 1 + rand() * 2.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 9; k++) { a += (rand() - 0.5) * 1.4; x += Math.cos(a) * 22; y += Math.sin(a) * 22; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    }, renderer);
    crackTex.repeat.set(55, 55);
    groundMat.emissiveMap = crackTex;
    groundMat.emissive = new THREE.Color(0xffffff);
    groundMat.emissiveIntensity = 2.6;
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000).rotateX(-Math.PI / 2), groundMat);
  ground.receiveShadow = true;
  group.add(ground);

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
    // patched repairs and cracks
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.08 + rand() * 0.1})`;
      ctx.fillRect(s * (0.08 + rand() * 0.7), rand() * s, 30 + rand() * 90, 20 + rand() * 60);
    }
    ctx.fillStyle = '#e9e9e4';
    ctx.fillRect(s * 0.025, 0, s * 0.014, s);
    ctx.fillRect(s * 0.961, 0, s * 0.014, s);
    ctx.fillRect(s * 0.495, 0, s * 0.01, s * 0.45);
  }, renderer);
  const road = new THREE.Mesh(
    ribbon(ROAD_HALF, -ROAD_HALF, 0.02, 0.02, 14),
    new THREE.MeshStandardMaterial({ map: roadTex, color: theme.road.tint ?? 0xffffff, roughness: theme.road.roughness, metalness: theme.road.metalness }),
  );
  road.receiveShadow = true;
  group.add(road);

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
    group.add(kerb);
  }

  // ------------------------------------------------------------ verges, gravel traps, tyre walls
  // mown stripes (or paving, or packed snow) between the kerbs and the rails
  const vergeTex = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = theme.verge[0];
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = theme.verge[1];
    ctx.fillRect(0, 0, s, s / 2);
    speckle(ctx, s, 900, rand, (r) => `rgba(${r > 0.5 ? '255,255,255' : '0,0,0'},${0.02 + r * 0.05})`);
  }, renderer);
  const vergeMat = new THREE.MeshStandardMaterial({ map: vergeTex, roughness: 1 });
  for (const [a, b] of [[WALL - 0.2, ROAD_HALF + 1.2], [-ROAD_HALF - 1.2, -WALL + 0.2]]) {
    const verge = new THREE.Mesh(ribbon(a, b, 0.008, 0.008, 14), vergeMat);
    verge.receiveShadow = true;
    group.add(verge);
  }

  // corners get a gravel trap on the outside, backed by a tyre wall
  const corners = [];
  {
    const tight = (i) => route.speedProfile[((i % N) + N) % N] < 46;
    let start = 0;
    while (start < N && tight(start)) start++;
    for (let i = start; i < start + N; i++) {
      if (!tight(i)) continue;
      let end = i;
      while (end < start + N && tight(end + 1)) end++;
      const mid = ((Math.round((i + end) / 2) % N) + N) % N, ahead = (mid + 5) % N;
      const left = tan[ahead].x * nrm[mid].x + tan[ahead].z * nrm[mid].z > 0;   // which way the track bends
      corners.push({ from: i - 7, to: end + 7, outer: left ? -1 : 1 });
      i = end;
    }
  }
  if (theme.gravel) {
    const gravelTex = canvasTexture(256, (ctx, s) => {
      ctx.fillStyle = theme.gravel;
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, 5000, rand, (r) => `rgba(${r > 0.5 ? '255,255,255' : '0,0,0'},${0.05 + r * 0.12})`);
    }, renderer);
    const gravelMat = new THREE.MeshStandardMaterial({ map: gravelTex, roughness: 1 });
    const stacks = [];
    for (const c of corners) {
      const [a, b] = c.outer > 0 ? [WALL - 0.3, ROAD_HALF + 1.3] : [-ROAD_HALF - 1.3, -WALL + 0.3];
      const trap = new THREE.Mesh(ribbon(a, b, 0.014, 0.014, 6, c.from, c.to), gravelMat);
      trap.receiveShadow = true;
      group.add(trap);
      for (let i = c.from * 2; i <= c.to * 2; i++) stacks.push([((Math.floor(i / 2) % N) + N) % N, c.outer, i]);   // two stacks per sample
    }
    const red = new THREE.Color(0xc0261f), white = new THREE.Color(0xe9e9e4);
    instances(new THREE.CylinderGeometry(0.52, 0.52, 1, 12).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.9 }), stacks, (j, [k, side, i]) => {
      const along = i & 1 ? DS / 2 : 0;
      v.set(pts[k].x + nrm[k].x * side * (WALL - 0.75) + tan[k].x * along, 0, pts[k].z + nrm[k].z * side * (WALL - 0.75) + tan[k].z * along);
      return ((i >> 1) & 1 ? red : white).clone();
    });
  }

  // ------------------------------------------------------------ sponsor boards
  if (!theme.neonRails) {
    const boardTex = canvasTexture(512, (ctx, s) => {
      const panels = [['#c8102e', '#fff'], ['#f2f2f2', '#16181d'], ['#1463ff', '#fff'], ['#f2c200', '#16181d']];
      panels.forEach(([bg, fg], i) => {
        const y = (i * s) / 4, h = s / 4;
        ctx.fillStyle = bg;
        ctx.fillRect(0, y, s, h);
        ctx.fillStyle = fg;
        // shapes only, so the board reads the same from either side
        if (i % 2) for (let k = 0; k < 3; k++) ctx.fillRect(s * 0.3, y + h * (0.2 + k * 0.22), s * 0.4, h * 0.1);
        else { ctx.beginPath(); ctx.arc(s / 2, y + h / 2, h * 0.28, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(s / 2, y + h / 2, h * 0.14, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.fillRect(0, y, s, 3);
      });
    }, renderer);
    const boardMat = new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.55, side: THREE.DoubleSide });
    const stretches = [[-34, 46, 1], [-34, 46, -1]];
    for (const f of [0.22, 0.47, 0.72]) stretches.push([Math.round(N * f), Math.round(N * f) + 36, f === 0.47 ? -1 : 1]);
    for (const [from, to, side] of stretches) {
      const board = new THREE.Mesh(ribbon(side * (WALL + 0.3), side * (WALL + 0.3), 1.55, 0.2, 24, from, to), boardMat);
      board.castShadow = true;
      group.add(board);
    }
  }

  // ------------------------------------------------------------ guard rails
  const railMat = new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide });
  for (const side of [1, -1]) {
    const rail = new THREE.Mesh(ribbon(side * WALL, side * WALL, 0.95, 0.35, 4), railMat);
    rail.castShadow = rail.receiveShadow = true;
    group.add(rail);
    if (theme.neonRails) {
      const tube = new THREE.Mesh(
        ribbon(side * (WALL - 0.03), side * (WALL - 0.03), 1.12, 0.98, 4),
        new THREE.MeshBasicMaterial({ color: hdr(theme.neonRails[side > 0 ? 0 : 1]), side: THREE.DoubleSide }),
      );
      group.add(tube);
    }
  }
  const railSpots = [];
  for (let i = 0; i < Math.floor(N / 2); i++) for (const side of [1, -1]) railSpots.push([i * 2, side]);
  instances(
    new THREE.BoxGeometry(0.14, 0.9, 0.14).translate(0, 0.45, 0),
    new THREE.MeshStandardMaterial({ color: 0x6d727a, metalness: 0.7, roughness: 0.5 }),
    railSpots, (i, [k, side]) => { v.set(pts[k].x + nrm[k].x * side * (WALL + 0.1), 0, pts[k].z + nrm[k].z * side * (WALL + 0.1)); }, false,
  );

  // ------------------------------------------------------------ street lamps
  const lampSpots = [];
  for (let i = 0; i < Math.floor(N / 22); i++) lampSpots.push([i * 22, i % 2 ? 1 : -1]);
  const placeLamp = (i, [k, side]) => {
    v.set(pts[k].x + nrm[k].x * side * (WALL + 1.6), 0, pts[k].z + nrm[k].z * side * (WALL + 1.6));
    // local -x (the arm) should point back toward the road
    q.setFromAxisAngle(up, Math.atan2(-nrm[k].z * side, nrm[k].x * side));
  };
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x30343b, metalness: 0.8, roughness: 0.4 });
  instances(new THREE.CylinderGeometry(0.09, 0.13, 8, 8).translate(0, 4, 0), poleMat, lampSpots, placeLamp);
  instances(new THREE.BoxGeometry(2.6, 0.1, 0.16).translate(-1.2, 8, 0), poleMat, lampSpots, placeLamp, false);
  const lampColor = (i) => hdr(theme.lamps[i % theme.lamps.length]);
  instances(
    new THREE.BoxGeometry(0.9, 0.08, 0.3).translate(-2.1, 7.92, 0), new THREE.MeshBasicMaterial(),
    lampSpots, (i, spot) => { placeLamp(i, spot); return lampColor(i); }, false,
  );
  if (theme.pools) {
    // light pooling on the tarmac under each lamp
    instances(new THREE.CircleGeometry(11, 24).rotateX(-Math.PI / 2), glowMat(theme.pools), lampSpots, (i, [k, side]) => {
      v.set(pts[k].x + nrm[k].x * side * (WALL - 5), 0.05, pts[k].z + nrm[k].z * side * (WALL - 5));
      return lampColor(i).multiplyScalar(0.12);
    }, false);
  }

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
  group.add(line);

  // painted grid boxes behind the line
  const gridSpots = [];
  for (let slot = 1; slot <= 8; slot++) gridSpots.push([((-slot * 5 % N) + N) % N, slot % 2 ? 3 : -3]);
  instances(
    new THREE.PlaneGeometry(2.6, 0.25).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xd8d8d2 }),
    gridSpots, (i, [k, off]) => {
      v.set(pts[k].x + nrm[k].x * off + tan[k].x * 2.6, 0.031, pts[k].z + nrm[k].z * off + tan[k].z * 2.6);
      q.setFromAxisAngle(up, Math.atan2(tan[k].x, tan[k].z));
    }, false,
  );

  const steel = new THREE.MeshStandardMaterial({ color: 0x23262c, metalness: 0.85, roughness: 0.35 });
  function gantryAt(k, lights) {
  const gantry = new THREE.Group();
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
  if (lights) {
  // start lights, facing the grid
  const housing = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.8, 0.3), steel);
  housing.position.set(0, 6.35, -0.5);
  gantry.add(housing);
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.12, 0.06) });
  for (let i = 0; i < 5; i++) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), lamp);
    bulb.position.set((i - 2) * 1.0, 6.35, -0.68);
    gantry.add(bulb);
  }
  }
  gantry.position.set(pts[k].x, 0, pts[k].z);
  gantry.rotation.y = Math.atan2(tan[k].x, tan[k].z);
  group.add(gantry);
  }
  gantryAt(0, true);
  if (route.finish) {
    gantryAt(route.finish, false);
    const finishLine = line.clone();
    finishLine.position.set(pts[route.finish].x, 0.03, pts[route.finish].z);
    finishLine.rotation.y = Math.atan2(tan[route.finish].x, tan[route.finish].z);
    group.add(finishLine);
  }

  // A grandstand with a speckled "crowd" facing the track at sample k.
  const crowdTex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#2a2d33';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 5000, rand, (r) => `hsl(${r * 360}, 70%, ${45 + rand() * 30}%)`);
  }, renderer);
  crowdTex.repeat.set(6, 1);
  function grandstand(k, side, len = 46) {
    const stand = new THREE.Group();
    const seats = new THREE.Mesh(new THREE.BoxGeometry(len, 0.4, 13), new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 0.9 }));
    seats.rotation.x = -0.5;
    seats.position.set(0, 4.4, 0);
    const base = new THREE.Mesh(new THREE.BoxGeometry(len, 7, 11), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.8 }));
    base.position.set(0, 0.4, 0.4);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.3, 13), steel);
    roof.position.set(0, 11.5, 1);
    for (const m of [seats, base, roof]) { m.castShadow = true; stand.add(m); }
    const off = side * (WALL + 12);
    stand.position.set(pts[k].x + nrm[k].x * off, 0, pts[k].z + nrm[k].z * off);
    // local -z (the low front row) faces the track
    stand.rotation.y = Math.atan2(nrm[k].x * side, nrm[k].z * side);
    group.add(stand);
  }

  // A pit building with a row of garages, on the right of the start straight.
  function pits() {
    const k = ((-16 % N) + N) % N, off = -(WALL + 12);
    const building = new THREE.Group();
    const wall = new THREE.MeshStandardMaterial({ color: 0xd9dce1, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.5, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(9, 5.4, 66), wall);
    body.position.y = 2.7;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.35, 68), steel);
    roof.position.set(0.8, 5.6, 0);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.3, 62), new THREE.MeshStandardMaterial({ color: 0x24303c, roughness: 0.15, metalness: 0.8 }));
    glass.position.set(4.55, 4.3, 0);
    building.add(body, roof, glass);
    for (let i = 0; i < 10; i++) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.1, 4.8), dark);
      door.position.set(4.55, 1.55, (i - 4.5) * 6.2);   // local +x faces the track
      building.add(door);
    }
    for (const m of building.children) m.castShadow = true;
    building.position.set(pts[k].x + nrm[k].x * off, 0, pts[k].z + nrm[k].z * off);
    building.rotation.y = Math.atan2(tan[k].x, tan[k].z);
    group.add(building);
  }

  // ------------------------------------------------------------ shared scenery pieces
  function hills(count = 46) {
    const [rock, cap] = theme.hills.map((h) => new THREE.Color(h));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + rand() * 0.12;
      const dist = Math.max(760, Math.hypot(spanX, spanZ) / 2 + 420) + rand() * 520;
      const h = 90 + rand() * 230, r = 190 + rand() * 230;
      const geo = new THREE.ConeGeometry(r, h, 11, 5);
      const pos = geo.attributes.position, colors = [];
      for (let j = 0; j < pos.count; j++) {
        const y = pos.getY(j) / h + 0.5;   // 0 at the foot, 1 at the peak
        if (y > 0.02 && y < 0.98) pos.setXYZ(j, pos.getX(j) + (rand() - 0.5) * r * 0.22, pos.getY(j) + (rand() - 0.5) * h * 0.12, pos.getZ(j) + (rand() - 0.5) * r * 0.22);
        col.copy(rock).lerp(cap, y > 0.55 + rand() * 0.15 ? 1 : 0).multiplyScalar(0.85 + rand() * 0.3);
        colors.push(col.r, col.g, col.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const hill = new THREE.Mesh(geo, mat);
      hill.position.set(cx + Math.cos(ang) * dist, h / 2 - 6, cz + Math.sin(ang) * dist);
      hill.rotation.y = rand() * Math.PI;
      group.add(hill);
    }
  }

  function clouds(count = 26) {
    const mat = new THREE.SpriteMaterial({ map: glowTex, color: theme.clouds, transparent: true, opacity: 0.55, depthWrite: false, fog: false });
    for (let i = 0; i < count; i++) {
      const puff = new THREE.Sprite(mat);
      const ang = rand() * Math.PI * 2, dist = 500 + rand() * 1400, w = 380 + rand() * 520;
      puff.position.set(cx + Math.cos(ang) * dist, 260 + rand() * 260, cz + Math.sin(ang) * dist);
      puff.scale.set(w, w * (0.22 + rand() * 0.14), 1);
      group.add(puff);
    }
  }

  function pines(count, crownColor, tint) {
    const spots = scatter(count, WALL + 6, 230);
    if (plant(['tree_pineTallA_detailed', 'tree_pineTallB_detailed', 'tree_pineRoundC', 'tree_pineDefaultA'], spots, 8, 15, tint)) return;
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3, 6).translate(0, 1.5, 0);
    const crownGeo = mergeGeometries([
      new THREE.ConeGeometry(2.7, 4.2, 8).translate(0, 4.2, 0),
      new THREE.ConeGeometry(2.1, 3.8, 8).translate(0, 6.4, 0),
      new THREE.ConeGeometry(1.4, 3.4, 8).translate(0, 8.5, 0),
    ]);
    const sizes = spots.map(() => [0.8 + rand() * 0.9, 0.85 + rand() * 0.4, rand() * Math.PI * 2]);
    const place = (i, [x, z]) => {
      v.set(x, 0, z);
      q.setFromAxisAngle(up, sizes[i][2]);
      sc.set(sizes[i][0], sizes[i][0] * sizes[i][1], sizes[i][0]);
    };
    instances(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 1 }), spots, place);
    instances(crownGeo, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), spots, (i, s) => { place(i, s); return crownColor(); });
  }

  function broadleaf(count, hue, fall) {
    const spots = scatter(count, WALL + 8, 200);
    const names = fall ? ['tree_oak_fall', 'tree_detailed_fall', 'tree_default_fall'] : ['tree_oak', 'tree_detailed', 'tree_default'];
    if (plant(names, spots, 6.5, 11)) return;
    const sizes = spots.map(() => 0.8 + rand() * 0.8);
    instances(new THREE.CylinderGeometry(0.25, 0.4, 3.4, 6).translate(0, 1.7, 0), new THREE.MeshStandardMaterial({ color: 0x4f3a28, roughness: 1 }), spots, (i, [x, z]) => {
      v.set(x, 0, z);
      sc.setScalar(sizes[i]);
    });
    instances(new THREE.IcosahedronGeometry(2.6, 1).translate(0, 5, 0), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), spots, (i, [x, z]) => {
      v.set(x, 0, z);
      q.setFromAxisAngle(up, rand() * 6);
      sc.set(sizes[i] * (0.9 + rand() * 0.4), sizes[i], sizes[i] * (0.9 + rand() * 0.4));
      return col.setHSL(hue + rand() * 0.06, 0.45 + rand() * 0.15, 0.1 + rand() * 0.08).clone();
    });
  }

  function rocks(count, color, maxSize = 2.2, maxD = 160) {
    const spots = scatter(count, WALL + 3, maxD);
    const stone = new THREE.Color(color);
    if (plant(['rock_largeA', 'rock_largeC', 'rock_tallB', 'stone_largeB', 'stone_tallD'], spots, 0.5, maxSize * 1.1, (kind) => (leaves(kind) ? null : stone))) return;
    const base = new THREE.Color(color);
    instances(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), spots, (i, [x, z]) => {
      const s = 0.4 + rand() * maxSize;
      v.set(x, s * 0.25, z);
      q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
      sc.set(s * (0.7 + rand() * 0.7), s * (0.5 + rand() * 0.5), s * (0.7 + rand() * 0.7));
      return col.copy(base).multiplyScalar(0.7 + rand() * 0.6).clone();
    });
  }

  // tufts of grass and wild flowers close to the track
  function meadow(count, flowers = true, tint) {
    plant(['grass_large', 'grass_leafsLarge', 'grass'], scatter(count, WALL + 1.5, 60), 0.45, 1.0, tint);
    if (flowers) plant(['flower_yellowA', 'flower_redA', 'flower_purpleA'], scatter(Math.round(count / 5), WALL + 1.5, 45), 0.4, 0.7);
  }

  function palms(count) {
    const spots = scatter(count, WALL + 5, 170);
    if (!plant(['tree_palmDetailedTall', 'tree_palmBend', 'tree_palmDetailedShort'], spots, 7, 12)) pines(count, () => col.setHSL(0.3, 0.5, 0.14).clone());
  }

  function bushes(count, hue) {
    const spots = scatter(count, WALL + 2.5, 70);
    if (plant(['plant_bushDetailed', 'plant_bushLarge'], spots, 0.9, 2.2)) return;
    instances(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), spots, (i, [x, z]) => {
      const s = 0.6 + rand() * 1.1;
      v.set(x, s * 0.45, z);
      q.setFromAxisAngle(up, rand() * 6);
      sc.set(s * 1.3, s * 0.8, s * 1.3);
      return col.setHSL(hue + rand() * 0.06, 0.45, 0.1 + rand() * 0.1).clone();
    });
  }

  // ------------------------------------------------------------ the scene itself
  const SCENES = {
    forest() {
      pines(Math.min(1600, Math.round(length * 0.55)), () => col.setHSL(0.26 + rand() * 0.08, 0.45 + rand() * 0.2, 0.07 + rand() * 0.07).clone());
      broadleaf(Math.round(length * 0.1), 0.2);
      meadow(1400);
      bushes(260, 0.24);
      rocks(90, 0x6d6a66);
      grandstand(8, 1);
      pits();
      hills();
      clouds();
    },

    speedway() {
      pines(Math.round(length * 0.16), () => col.setHSL(0.28 + rand() * 0.06, 0.5, 0.12 + rand() * 0.08).clone());
      broadleaf(Math.round(length * 0.1), 0.25);
      meadow(1200);
      bushes(120, 0.27);
      pits();
      for (let k = 4; k < N * 0.2; k += 26) { grandstand(k, 1); grandstand(k, -1); }
      for (let k = Math.round(N * 0.52); k < N * 0.72; k += 26) grandstand(k, -1);
      hills();
      clouds(34);
    },

    dragstrip() {
      // stands down both sides of the strip, open country beyond
      for (let k = 6; k < route.finish + 20; k += 26) { grandstand(k, 1); grandstand(k, -1); }
      broadleaf(Math.round(length * 0.08), 0.25);
      pines(Math.round(length * 0.08), () => col.setHSL(0.3, 0.5, 0.14).clone());
      meadow(1500);
      bushes(160, 0.27);
      hills(40);
      clouds(34);
    },

    coast() {
      // the sea: everything beyond the island's shoreline
      const reach = Math.hypot(spanX, spanZ) / 2 + 190;
      const sea = new THREE.Mesh(
        new THREE.RingGeometry(reach, 4200, 72).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x1f8fb5, roughness: 0.18, metalness: 0.35 }),
      );
      sea.position.set(cx, 0.06, cz);
      group.add(sea);
      const shallows = new THREE.Mesh(
        new THREE.RingGeometry(reach - 18, reach + 46, 72).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0x5fd0d6, roughness: 0.2, metalness: 0.2, transparent: true, opacity: 0.75 }),
      );
      shallows.position.set(cx, 0.08, cz);
      group.add(shallows);
      palms(Math.round(length * 0.28));
      meadow(900, true, () => new THREE.Color(0x7fae4a));
      bushes(220, 0.27);
      rocks(110, 0x9a9488, 2.4);
      grandstand(8, 1);
      pits();
      hills(14);
      clouds(30);
    },

    autumn() {
      broadleaf(Math.min(1300, Math.round(length * 0.5)), 0.08, true);
      pines(Math.round(length * 0.1), () => col.setHSL(0.26, 0.4, 0.12).clone());
      meadow(1300, false, () => new THREE.Color(0x8a8236));
      bushes(240, 0.12);
      rocks(80, 0x6d6a66);
      grandstand(8, 1);
      pits();
      hills();
      clouds(22);
    },

    alpine() {
      pines(Math.min(1500, Math.round(length * 0.5)), () => (rand() < 0.7
        ? col.setHSL(0.58, 0.18, 0.72 + rand() * 0.2).clone()
        : col.setHSL(0.36, 0.3, 0.14 + rand() * 0.06).clone()), (kind) => (leaves(kind) ? new THREE.Color(0xe9eff5) : null));
      rocks(240, 0x7c8590, 3.2);
      grandstand(8, 1);
      pits();
      hills(54);
      clouds(30);
    },

    desert() {
      rocks(320, 0xa8643c, 2.8, 220);
      bushes(160, 0.16);
      // flat-topped mesas in the middle distance
      const mesaSpots = scatter(34, 70, 520);
      instances(new THREE.CylinderGeometry(0.82, 1, 1, 9, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), mesaSpots, (i, [x, z, d]) => {
        const r = 14 + rand() * Math.min(60, d * 0.35), h = 12 + rand() * 46;
        v.set(x, -1, z);
        q.setFromAxisAngle(up, rand() * 6);
        sc.set(r * (0.7 + rand() * 0.6), h, r);
        return col.setHSL(0.045 + rand() * 0.03, 0.55, 0.3 + rand() * 0.12).clone();
      });
      // saguaro cacti
      const cactus = mergeGeometries([
        new THREE.CylinderGeometry(0.32, 0.36, 4.6, 7).translate(0, 2.3, 0),
        new THREE.CylinderGeometry(0.2, 0.2, 1.3, 6).rotateZ(Math.PI / 2).translate(0.75, 2.2, 0),
        new THREE.CylinderGeometry(0.2, 0.2, 1.5, 6).translate(1.3, 2.9, 0),
        new THREE.CylinderGeometry(0.2, 0.2, 1.1, 6).rotateZ(Math.PI / 2).translate(-0.65, 2.9, 0),
        new THREE.CylinderGeometry(0.2, 0.2, 1.2, 6).translate(-1.1, 3.5, 0),
      ]);
      const cactusSpots = scatter(170, WALL + 5, 200);
      if (!plant(['cactus_tall', 'cactus_short'], cactusSpots, 1.6, 4.6)) instances(cactus, new THREE.MeshStandardMaterial({ color: 0x4d7a3a, roughness: 0.9, flatShading: true }), cactusSpots, (i, [x, z]) => {
        const s = 0.7 + rand() * 0.8;
        v.set(x, 0, z);
        q.setFromAxisAngle(up, rand() * 6);
        sc.setScalar(s);
      });
      grandstand(8, 1);
      pits();
      hills(40);
      clouds(14);
    },

    city() {
      // lit-window textures: dark facade, a random share of windows on
      const palette = ['#ffd9a0', '#9fe8ff', '#ff8ad8', '#fff3d6', '#b48cff'];
      const windowTex = (lit) => {
        const tex = canvasTexture(256, (ctx, s) => {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, s, s);
          const tint = palette[Math.floor(rand() * palette.length)];
          for (let y = 0; y < 22; y++) for (let x = 0; x < 10; x++) {
            if (rand() > lit) continue;
            ctx.fillStyle = rand() < 0.75 ? tint : palette[Math.floor(rand() * palette.length)];
            ctx.globalAlpha = 0.35 + rand() * 0.65;
            ctx.fillRect(x * 25.6 + 5, y * 11.6 + 3, 15, 6);
          }
          ctx.globalAlpha = 1;
        }, renderer);
        return new THREE.MeshStandardMaterial({ color: 0x0d0d14, roughness: 0.45, metalness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.5 });
      };
      const facades = [windowTex(0.55), windowTex(0.4), windowTex(0.7), windowTex(0.3)];
      const blocks = facades.map(() => []);
      const signSpots = [];
      const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

      // a wall of buildings down both sides of every street
      const step = Math.round(24 / DS);
      for (let k = 0; k < N; k += step) for (const side of [1, -1]) {
        const depth = 18 + rand() * 14, width = 19 + rand() * 4, height = 26 + rand() * rand() * 95;
        const off = WALL + 7 + depth / 2;
        const x = pts[k].x + nrm[k].x * side * off, z = pts[k].z + nrm[k].z * side * off;
        if (distToTrack(x, z) < off - 3) continue;   // would sit on another street
        const yaw = Math.atan2(tan[k].x, tan[k].z);
        blocks[Math.floor(rand() * facades.length)].push([x, z, yaw, depth, height, width]);
        if (rand() < 0.62) signSpots.push([k, side, off - depth / 2 - 0.4, Math.min(height - 6, 9 + rand() * 16)]);
      }
      // skyline behind them
      for (const [x, z, d] of scatter(190, 60, 650)) {
        const w = 22 + rand() * 30;
        blocks[Math.floor(rand() * facades.length)].push([x, z, rand() * 3, w, 50 + rand() * 60 + d * 0.28 * rand(), w * (0.7 + rand() * 0.5)]);
      }
      blocks.forEach((list, i) => instances(boxGeo, facades[i], list, (j, [x, z, yaw, depth, height, width]) => {
        v.set(x, 0, z);
        q.setFromAxisAngle(up, yaw);
        sc.set(depth, height, width);   // local x points away from the street
      }, false));

      // neon signs on the street-facing walls
      const words = ['NEON', 'ラーメン', 'HOTEL', '24H', 'DRIVE', '未来', 'BAR', 'TURBO', 'ARCADE', '東京', 'NOODLES', 'サイバー'];
      const hues = ['#ff2bd6', '#2ad4ff', '#ffe14d', '#ff3b3b', '#7dff5a', '#b05cff'];
      const signMats = words.map((word, i) => {
        const vertical = i % 2 === 1;
        const c = document.createElement('canvas');
        c.width = vertical ? 128 : 512; c.height = vertical ? 512 : 128;
        const ctx = c.getContext('2d');
        const hue = hues[i % hues.length];
        ctx.fillStyle = '#07060c';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.strokeStyle = hue; ctx.lineWidth = 8;
        ctx.strokeRect(8, 8, c.width - 16, c.height - 16);
        ctx.fillStyle = hue; ctx.shadowColor = hue; ctx.shadowBlur = 18;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (vertical) {
          const chars = [...word], size = Math.min(84, 440 / chars.length);
          ctx.font = `900 ${size}px sans-serif`;
          chars.forEach((ch, j) => ctx.fillText(ch, 64, 256 + (j - (chars.length - 1) / 2) * size * 1.08));
        } else {
          ctx.font = `900 ${Math.min(84, 760 / word.length)}px sans-serif`;
          ctx.fillText(word, 256, 68);
        }
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        return { vertical, hue, mat: new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.4, 2.4, 2.4) }) };
      });
      const signGeo = new THREE.PlaneGeometry(1, 1);
      const spill = [];
      for (const [k, side, off, y] of signSpots) {
        const sign = signMats[Math.floor(rand() * signMats.length)];
        const mesh = new THREE.Mesh(signGeo, sign.mat);
        const s = 5 + rand() * 4;
        mesh.scale.set(sign.vertical ? s * 0.55 : s * 2.2, sign.vertical ? s * 2.2 : s * 0.55, 1);
        mesh.position.set(pts[k].x + nrm[k].x * side * off, Math.max(y, mesh.scale.y / 2 + 3), pts[k].z + nrm[k].z * side * off);
        mesh.rotation.y = Math.atan2(-nrm[k].x * side, -nrm[k].z * side);   // face the street
        group.add(mesh);
        spill.push([k, side, sign.hue]);
      }
      // each sign's colour spilling across the wet road beneath it
      instances(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), glowMat(0.9), spill, (i, [k, side, hue]) => {
        v.set(pts[k].x + nrm[k].x * side * 6, 0.055, pts[k].z + nrm[k].z * side * 6);
        q.setFromAxisAngle(up, Math.atan2(tan[k].x, tan[k].z));
        sc.set(9, 1, 14);
        return col.set(hue).multiplyScalar(0.5).clone();
      }, false);
    },

    volcano() {
      // the cone, in the middle of the lap
      const H = 250, topR = 46, baseR = 185;
      const geo = new THREE.CylinderGeometry(topR, baseR, H, 40, 14, true);
      const pos = geo.attributes.position;
      for (let j = 0; j < pos.count; j++) {
        const t = pos.getY(j) / H + 0.5;
        if (t > 0.01) { const k = 1 + (rand() - 0.5) * 0.16; pos.setX(j, pos.getX(j) * k); pos.setZ(j, pos.getZ(j) * k); pos.setY(j, pos.getY(j) + (rand() - 0.5) * 9); }
      }
      geo.computeVertexNormals();
      const cone = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3d2c27, roughness: 1, flatShading: true }));
      cone.position.set(cx, H / 2 - 4, cz);
      group.add(cone);

      const lava = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 1.1, 0.12), side: THREE.DoubleSide, fog: false });
      const crater = new THREE.Mesh(new THREE.CircleGeometry(topR * 1.05, 28).rotateX(-Math.PI / 2), lava);
      crater.position.set(cx, H - 14, cz);
      group.add(crater);
      // rivers of lava running down the flanks
      for (let r = 0; r < 7; r++) {
        const a0 = (r / 7) * Math.PI * 2 + rand(), reach = 0.55 + rand() * 0.45, verts = [], idx = [];
        for (let s = 0; s <= 30; s++) {
          const t = (s / 30) * reach, a = a0 + Math.sin(t * 7 + r) * 0.16;
          const rad = topR + (baseR - topR) * t + 3.5, y = H * (1 - t) - 6, w = (2.5 + t * 9) / rad;
          verts.push(cx + Math.cos(a - w) * rad, y, cz + Math.sin(a - w) * rad, cx + Math.cos(a + w) * rad, y, cz + Math.sin(a + w) * rad);
          if (s < 30) { const j = s * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        g.setIndex(idx);
        group.add(new THREE.Mesh(g, lava));
      }
      // glow and smoke above the crater
      const haze = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(1.1, 0.32, 0.07), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      haze.position.set(cx, H + 40, cz);
      haze.scale.set(420, 300, 1);
      group.add(haze);
      const smoke = new THREE.SpriteMaterial({ map: glowTex, color: 0x2b2220, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
      for (let i = 0; i < 16; i++) {
        const puff = new THREE.Sprite(smoke);
        const t = i / 16, w = 130 + t * 420;
        puff.position.set(cx + t * 380 + (rand() - 0.5) * 60, H + 30 + t * 330, cz + t * 150 + (rand() - 0.5) * 60);
        puff.scale.set(w, w * 0.8, 1);
        group.add(puff);
      }
      // lava pools glowing among the rocks
      instances(new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2), glowMat(1), scatter(150, WALL + 4, 240), (i, [x, z]) => {
        const s = 4 + rand() * 12;
        v.set(x, 0.06, z);
        sc.set(s, 1, s * (0.6 + rand() * 0.8));
        return new THREE.Color(1.6, 0.45 + rand() * 0.25, 0.08);
      }, false);
      rocks(520, 0x2a211f, 3.6, 240);
      pits();
      // jagged spires
      instances(new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x1f1817, roughness: 1, flatShading: true }), scatter(110, WALL + 10, 330), (i, [x, z]) => {
        v.set(x, -0.5, z);
        q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.4, rand() * 6, (rand() - 0.5) * 0.4));
        sc.set(2 + rand() * 5, 8 + rand() * 26, 2 + rand() * 5);
      });
      hills(36);
    },
  };
  SCENES[def.theme]();

  const dispose = () => group.traverse((o) => {
    if (!o.isMesh && !o.isSprite) return;
    o.geometry.dispose();
    for (const key of ['map', 'emissiveMap']) o.material[key]?.dispose();
    o.material.dispose();
    if (o.isInstancedMesh) o.dispose();
  });
  return { ...route, theme, group, dispose };
}
