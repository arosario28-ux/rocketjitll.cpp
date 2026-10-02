import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildTrack, loadNature, ROAD_HALF, WALL, TRACKS } from './track.js';
import { fetchBoard, submitLap } from './leaderboard.js';
import { CARS, ROLL_DRAG, AIR_DRAG, createGarage, prizeFor, rivalLook, terminalSpeed } from './garage.js';
import { account } from './account.js';
import { createOnline } from './online.js';

const LAP_CHOICES = [1, 3, 5, 10];
const WHEELBASE = 2.6;
const CAR_RADIUS = 2.1;
const DRACO_PATH = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');   // autostart with an autopilot, for smoke-testing

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (ms) => {
  if (ms == null) return '–:––.–––';
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};

// ---------------------------------------------------------------- renderer

const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;
renderer.info.autoReset = false;   // so the per-frame totals cover every pass (see frame())

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 4000);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
  type: THREE.HalfFloatType,
  samples: 2,
}));
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.6, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- sky & light

const rad = THREE.MathUtils.degToRad;
const sunDir = new THREE.Vector3(0, 1, 0);

// Daytime scenes use the analytic sky; night scenes use a plain gradient dome.
const sky = new Sky();
sky.scale.setScalar(3500);

const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, stars: { value: 0 } },
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww;   // pinned to the far plane
    }`,
  fragmentShader: `
    uniform vec3 top; uniform vec3 horizon; uniform float stars;
    varying vec3 vDir;
    void main() {
      float h = clamp(vDir.y, 0.0, 1.0);
      vec3 c = mix(horizon, top, pow(h, 0.42));
      vec3 cell = floor(normalize(vDir) * 190.0);
      float n = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      c += step(0.9987, n) * stars * h;
      gl_FragColor = vec4(c, 1.0);
    }`,
}));
dome.scale.setScalar(3400);
dome.frustumCulled = false;

scene.fog = new THREE.FogExp2(0xb98f78, 0.0011);

const sun = new THREE.DirectionalLight(0xffc38f, 4.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -70;
sun.shadow.camera.right = sun.shadow.camera.top = 70;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 400;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
const hemi = new THREE.HemisphereLight(0x9db4ff, 0x4a3b2c, 0.7);
scene.add(sun, sun.target, hemi, sky, dome);

// Reflections come from the sky baked into an environment map. Night scenes add a few
// coloured panels to that bake so paint and wet tarmac pick up the neon (or lava) around them.
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
let envTarget = null;
let nightScene = false;

function applyTheme(theme) {
  const t = theme.sky;
  nightScene = !!t.night;
  renderer.toneMappingExposure = theme.exposure;
  bloom.strength = theme.bloom;
  scene.fog.color.setHex(theme.fog[0]);
  scene.fog.density = theme.fog[1];
  sun.color.setHex(theme.sun[0]);
  sun.intensity = theme.sun[1];
  sunDir.setFromSphericalCoords(1, rad(90 - theme.sun[2]), rad(t.az ?? 112));
  hemi.color.setHex(theme.hemi[0]);
  hemi.groundColor.setHex(theme.hemi[1]);
  hemi.intensity = theme.hemi[2];

  sky.visible = !nightScene;
  dome.visible = nightScene;
  envScene.clear();
  if (nightScene) {
    dome.material.uniforms.top.value.setHex(t.top);
    dome.material.uniforms.horizon.value.setHex(t.horizon);
    dome.material.uniforms.stars.value = t.stars;
    envScene.add(dome);
    t.glow.forEach((hex, i) => {
      for (let j = 0; j < 3; j++) {
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(26, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(5), side: THREE.DoubleSide }));
        const a = (i * 3 + j) * 0.7;
        panel.position.set(Math.cos(a) * 40, 6 + j * 9, Math.sin(a) * 40);
        panel.lookAt(0, 4, 0);
        envScene.add(panel);
      }
    });
  } else {
    const u = sky.material.uniforms;
    u.turbidity.value = t.turbidity;
    u.rayleigh.value = t.rayleigh;
    u.mieCoefficient.value = t.mie;
    u.mieDirectionalG.value = t.mieG;
    u.sunPosition.value.setFromSphericalCoords(1, rad(90 - t.elev), rad(t.az));
    envScene.add(sky);
  }
  envTarget?.dispose();
  envTarget = pmrem.fromScene(envScene);
  scene.environment = envTarget.texture;
  scene.add(sky, dome);   // the bake borrowed whichever one it used
  setWeather(theme.weather);
  if (player) player.headlight.visible = nightScene;
}

// ---------------------------------------------------------------- graphics quality

// Resolution, shadows and bloom are the expensive parts. On "Auto" the game starts high and steps
// down a level whenever the frame rate stays low; it never steps back up, to avoid flip-flopping.
const QUALITY = [
  { name: 'High', dpr: 1.75, shadow: 2048, bloom: true },
  { name: 'Medium', dpr: 1.25, shadow: 1024, bloom: true },
  { name: 'Low', dpr: 1, shadow: 0, bloom: true },
  { name: 'Lowest', dpr: 0.75, shadow: 0, bloom: false },
];
let quality = 0;
let autoQuality = true;
const perf = { frames: 0, time: 0, settle: 90 };

function setQuality(level) {
  quality = clamp(level, 0, QUALITY.length - 1);
  const q = QUALITY[quality];
  const dpr = Math.min(devicePixelRatio, q.dpr);
  renderer.setPixelRatio(dpr);
  composer.setPixelRatio(dpr);
  if (q.shadow && sun.shadow.mapSize.x !== q.shadow) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
  sun.castShadow = q.shadow > 0;
  bloom.enabled = q.bloom;
  if (player) player.blob.visible = !q.shadow;   // a soft blob stands in when real shadows are off
  perf.frames = perf.time = 0;
  perf.settle = 90;   // ignore the hitch while shaders rebuild
  for (const chip of $('quality-choices').children) chip.classList.toggle('on', chip.dataset.level === (autoQuality ? 'auto' : String(quality)));
  $('quality-now').textContent = autoQuality ? `Auto · ${q.name}` : q.name;
}

function watchFrameRate(rawDt) {
  // a long gap means the tab was in the background, not that the game is slow
  if (!autoQuality || quality >= QUALITY.length - 1 || rawDt > 0.25) return;
  if (perf.settle > 0) { perf.settle--; return; }
  perf.frames++;
  perf.time += rawDt;
  if (perf.frames < 100) return;
  const fps = perf.frames / perf.time;
  perf.frames = perf.time = 0;
  if (fps < 45) setQuality(quality + 1);
}

// ---------------------------------------------------------------- weather & smoke

// Rain is drawn as short streaks, snow and embers as soft dots. All of them live in a box
// around the camera and wrap, so a few thousand particles cover the whole track.
const WEATHER_BOX = 70;
const dotTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const WEATHER = {
  rain: { count: 2600, fall: -38, drift: 5, streak: 1.1 },
  snow: { count: 1800, fall: -2.2, drift: 1.2, size: 0.22, color: 0xffffff, blending: THREE.NormalBlending },
  embers: { count: 700, fall: 2.6, drift: 2.2, size: 0.32, color: new THREE.Color(6, 1.6, 0.2), blending: THREE.AdditiveBlending },
};
let weather = null;

function setWeather(kind) {
  if (weather) {
    scene.remove(weather.object);
    weather.object.geometry.dispose();
    weather.object.material.dispose();
    weather = null;
  }
  const w = WEATHER[kind];
  if (!w) return;
  const per = w.streak ? 2 : 1;
  const base = new Float32Array(w.count * 3);
  for (let i = 0; i < base.length; i++) base[i] = Math.random() * WEATHER_BOX;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(w.count * per * 3), 3));
  const object = w.streak
    ? new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaab8ff, transparent: true, opacity: 0.35, fog: false }))
    : new THREE.Points(geo, new THREE.PointsMaterial({ map: dotTex, color: w.color, size: w.size, transparent: true, depthWrite: false, blending: w.blending, fog: false }));
  object.frustumCulled = false;
  scene.add(object);
  weather = { ...w, base, object, time: 0 };
}

function updateWeather(dt) {
  if (!weather) return;
  const { base, object, fall, drift, streak } = weather;
  weather.time += dt;
  const pos = object.geometry.attributes.position.array;
  const half = WEATHER_BOX / 2, cam = camera.position, t = weather.time;
  const wrapTo = (value, centre) => centre + (((value - centre) % WEATHER_BOX) + WEATHER_BOX * 1.5) % WEATHER_BOX - half;
  for (let i = 0, o = 0; i < base.length; i += 3) {
    const x = wrapTo(base[i] + drift * t + Math.sin(base[i + 1] + t) * (streak ? 0 : 0.6), cam.x);
    const y = wrapTo(base[i + 1] + fall * t, cam.y + half * 0.6);
    const z = wrapTo(base[i + 2], cam.z);
    pos[o++] = x; pos[o++] = y; pos[o++] = z;
    if (streak) { pos[o++] = x - drift * 0.03; pos[o++] = y + streak; pos[o++] = z; }
  }
  object.geometry.attributes.position.needsUpdate = true;
}

// Tyre smoke (or dust, off the road): a small ring buffer of fading puffs.
const SMOKE_MAX = 90;
const smoke = (() => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SMOKE_MAX * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SMOKE_MAX * 4), 4));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ map: dotTex, size: 2.6, vertexColors: true, transparent: true, depthWrite: false }));
  points.frustumCulled = false;
  scene.add(points);
  return { points, life: new Float32Array(SMOKE_MAX), next: 0, clock: 0 };
})();

function puffSmoke(x, z, dusty) {
  const i = smoke.next = (smoke.next + 1) % SMOKE_MAX;
  const pos = smoke.points.geometry.attributes.position.array, c = smoke.points.geometry.attributes.color.array;
  pos[i * 3] = x + (Math.random() - 0.5) * 0.6; pos[i * 3 + 1] = 0.35; pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.6;
  const tone = dusty ? [0.5, 0.42, 0.3] : [0.8, 0.8, 0.82];
  c[i * 4] = tone[0]; c[i * 4 + 1] = tone[1]; c[i * 4 + 2] = tone[2];
  smoke.life[i] = 1;
}

function updateSmoke(dt) {
  const pos = smoke.points.geometry.attributes.position.array, c = smoke.points.geometry.attributes.color.array;
  for (let i = 0; i < SMOKE_MAX; i++) {
    if (smoke.life[i] <= 0) continue;
    smoke.life[i] = Math.max(0, smoke.life[i] - dt * 0.9);
    pos[i * 3 + 1] += dt * 1.1;
    c[i * 4 + 3] = smoke.life[i] * 0.4;
  }
  smoke.points.geometry.attributes.position.needsUpdate = true;
  smoke.points.geometry.attributes.color.needsUpdate = true;
}

// ---------------------------------------------------------------- world

let track, trackDef, pts, tan, nrm, N, DS, speedProfile;

function loadTrack(def) {
  if (track) {
    scene.remove(track.group);
    track.dispose();
  }
  trackDef = def;
  track = buildTrack(renderer, def);
  ({ pts, tan, nrm, N, DS, speedProfile } = track);
  scene.add(track.group);
  applyTheme(track.theme);
  drawMapBase();
}

const wrap = (i) => ((i % N) + N) % N;
const wrapDiff = (d) => (d > N / 2 ? d - N : d < -N / 2 ? d + N : d);

function nearestIndex(x, z, hint) {
  let best = hint, bestD = Infinity;
  const span = hint == null ? N : 30;
  const from = hint == null ? 0 : hint - span;
  const to = hint == null ? N : hint + span;
  for (let i = from; i <= to; i++) {
    const k = wrap(i);
    const dx = x - pts[k].x, dz = z - pts[k].z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

// ---------------------------------------------------------------- cars

const RIVAL_COLORS = [0x1463ff, 0xf2c200, 0xe9edf2];
const WHEEL_NAMES = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];
const WHEEL_ONLY = { rims: true, caliper: true };
const BODY_ONLY = { paint: true, interior: true };
const gltfLoader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath(DRACO_PATH));
const modelCache = new Map();
let pending = 0;   // car models still loading

// Every car file shares one layout (see tools/build-car.mjs): a "body" mesh and four wheel
// nodes centred on their axles, nose toward +z, tyres resting on y = 0.
function loadModel(def) {
  if (!modelCache.has(def.id)) {
    modelCache.set(def.id, gltfLoader.loadAsync(def.file).then((gltf) => gltf.scene, (err) => {
      console.warn(`${def.name} failed to load, using a stand-in.`, err);
      return fallbackCarModel(def);
    }));
  }
  return modelCache.get(def.id);
}

// Used only if a GLB can't be fetched, so the game still runs.
function fallbackCarModel(def) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial();
  paint.name = def.mats.paint[0];
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.4).translate(0, 0.6, 0), paint);
  body.name = 'body';
  g.add(body);
  const tire = new THREE.CylinderGeometry(0.33, 0.33, 0.28, 20).rotateZ(Math.PI / 2);
  const rubber = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  for (const [i, x, z] of [[0, 0.9, 1.4], [1, -0.9, 1.4], [2, 0.9, -1.4], [3, -0.9, -1.4]]) {
    const w = new THREE.Mesh(tire, rubber);
    w.name = WHEEL_NAMES[i];
    w.position.set(x, 0.33, z);
    g.add(w);
  }
  return g;
}

// Clones a model for one car and gives it its own copies of the materials the garage can change.
function buildVisual(template, def, shadow) {
  const model = template.clone(true);
  const slots = { paint: [], rims: [], caliper: [], interior: [], glass: [], tail: [] };
  const made = new Map();
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = shadow;
    const inWheel = WHEEL_NAMES.includes(o.name) || WHEEL_NAMES.includes(o.parent.name);
    const src = o.material;
    const key = Object.keys(slots).find((k) => def.mats[k]?.includes(src.name) && !(WHEEL_ONLY[k] && !inWheel) && !(BODY_ONLY[k] && inWheel));
    if (!key) return;
    const id = `${key}:${src.uuid}`;
    if (!made.has(id)) {
      let mat;
      if (key === 'paint') mat = new THREE.MeshPhysicalMaterial({ map: src.map });
      else if (key === 'glass') mat = new THREE.MeshPhysicalMaterial({ color: 0x0c0f14, metalness: 1, roughness: 0.04, transparent: true });
      else {
        mat = src.clone();
        mat.userData.stock = src.color.clone();
        if (key === 'tail') mat.emissive = new THREE.Color(0xff1408);
      }
      made.set(id, mat);
      slots[key].push(mat);
    }
    o.material = made.get(id);
  });
  const wheels = WHEEL_NAMES.map((n) => model.getObjectByName(n)).filter(Boolean);
  for (const w of wheels) w.rotation.order = 'YXZ';
  return { model, wheels, slots };
}

function applyLook(car, look) {
  const { paint, rims, caliper, interior, glass } = car.visual.slots;
  for (const m of paint) {
    m.color.setHex(look.paint);
    m.metalness = look.finish.metalness;
    m.roughness = look.finish.roughness;
    m.clearcoat = look.finish.clearcoat;
    m.clearcoatRoughness = look.finish.clearcoatRoughness;
  }
  // null means "leave it as the model shipped"
  const tint = (mats, hex) => { for (const m of mats) hex == null ? m.color.copy(m.userData.stock) : m.color.setHex(hex); };
  tint(rims, look.rims);
  tint(caliper, look.caliper);
  tint(interior, look.interior);
  for (const m of glass) m.opacity = look.tint;
  car.glow.visible = look.glow != null;
  if (look.glow != null) car.glow.material.color.setHex(look.glow).multiplyScalar(1.6);
  car.color = look.paint;
}

// Puts the model for `def` on a car (loading it if needed) and paints it.
async function dressCar(car, def, look) {
  const token = ++car.token;
  setPending(1);
  try {
    const template = await loadModel(def);
    if (token !== car.token) return;   // a newer request replaced this one
    if (car.def !== def) {
      if (car.visual) {
        car.tilt.remove(car.visual.model);
        for (const mats of Object.values(car.visual.slots)) for (const m of mats) m.dispose();
      }
      // only the player's car casts a real shadow; the others get a cheap blob underneath
      car.visual = buildVisual(template, def, car === player);
      car.def = def;
      car.tilt.add(car.visual.model);
    }
    applyLook(car, look);
  } finally {
    setPending(-1);
  }
}

function setPending(d) {
  pending += d;
  $('start').disabled = pending > 0;
}

const glowGeo = new THREE.PlaneGeometry(3.4, 6.2).rotateX(-Math.PI / 2);
const glowTex = (() => {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 128, 256);
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 38;
  ctx.fillStyle = '#fff';
  ctx.fillRect(46, 76, 36, 104);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();

function makeCar() {
  const tilt = new THREE.Group();  // body roll and pitch
  const root = new THREE.Group();
  const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
    map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.position.y = 0.05;
  glow.visible = false;
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    map: dotTex, color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false,
  }));
  blob.position.y = 0.045;
  const headlight = new THREE.SpotLight(0xdfe8ff, 220, 110, 0.55, 0.7, 1.6);
  headlight.position.set(0, 0.8, 1.6);
  headlight.target.position.set(0, 0, 30);
  headlight.visible = false;
  root.add(tilt, glow, blob, headlight, headlight.target);
  scene.add(root);
  return {
    root, tilt, glow, blob, headlight, visual: null, def: null, token: 0, color: 0xffffff,
    x: 0, z: 0, heading: 0, vx: 0, vz: 0, speed: 0,
    steer: 0, spin: 0, roll: 0, pitch: 0,
    idx: 0, lat: 0, prog: 0, laps: 0,
    offset: 0, skill: 1, baseSkill: 1,
  };
}

function placeOnGrid(car, slot, offset) {
  const k = wrap(-slot * 5);
  car.idx = k;
  car.offset = car.lat = car.lane = offset;
  car.mistake = 0;
  car.latVel = 0;
  car.passSide = 0;
  car.passHold = 0;
  car.inBrakeZone = false;
  car.react = 0.12 + Math.random() * 0.38;
  car.x = pts[k].x + nrm[k].x * offset;
  car.z = pts[k].z + nrm[k].z * offset;
  car.heading = Math.atan2(tan[k].x, tan[k].z);
  car.vx = car.vz = car.speed = car.steer = car.roll = car.pitch = 0;
  car.prog = -slot * 5;
  car.laps = 0;
  syncCar(car, 0, false);
}

function syncCar(car, dt, braking) {
  car.root.position.set(car.x, 0, car.z);
  car.root.rotation.y = car.heading;
  car.tilt.rotation.z = car.roll;
  car.tilt.rotation.x = car.pitch;
  car.spin += car.speed * dt;   // distance rolled
  if (!car.visual) return;
  for (const w of car.visual.wheels) {
    w.rotation.x = car.spin / w.position.y;   // a wheel's axle height is its radius
    if (w.position.z > 0) w.rotation.y = car.steer * 0.45;
  }
  for (const m of car.visual.slots.tail) m.emissiveIntensity = braking ? 7 : 1.2;
}

// ---------------------------------------------------------------- input

const input = { up: false, down: false, left: false, right: false, hand: false };
const KEYS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'hand',
};
const typing = () => document.activeElement?.tagName === 'INPUT';

addEventListener('keydown', (e) => {
  if (typing()) {
    if (e.code !== 'Enter') return;
    const id = document.activeElement.id;
    if (id === 'name') startRace();
    else if (id === 'acct-code') redeemCode();
    else signIn('login');
    return;
  }
  if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat && (state === 'race' || state === 'countdown' || state === 'paused')) {
    togglePause();
    return;
  }
  if (state === 'paused') {
    if (e.code === 'KeyR' && !e.repeat) startRace();
    return;
  }
  if (state === 'garage') {
    if (e.code === 'ArrowLeft') garage.step(-1);
    else if (e.code === 'ArrowRight') garage.step(1);
    else if (e.code === 'Escape') closeGarage();
    return;
  }
  if (KEYS[e.code]) { input[KEYS[e.code]] = true; e.preventDefault(); }
  else if (e.code === 'KeyC' && !e.repeat) camMode = (camMode + 1) % 2;
  else if (e.code === 'KeyR' && !e.repeat && state !== 'loading' && !online) startRace();
  else if (e.code === 'KeyM' && !e.repeat) audio.toggleMute();
  else if (e.code === 'Enter' && (state === 'menu' || (state === 'finished' && finishShow <= 0))) startRace();
});
addEventListener('keyup', (e) => { if (KEYS[e.code]) input[KEYS[e.code]] = false; });
addEventListener('blur', () => { for (const k in input) input[k] = false; });

const touchUI = $('touch');
const isTouch = matchMedia('(pointer: coarse)').matches;
for (const btn of touchUI.querySelectorAll('button')) {
  const set = (on) => (e) => { e.preventDefault(); input[btn.dataset.key] = on; btn.classList.toggle('on', on); };
  btn.addEventListener('pointerdown', set(true));
  btn.addEventListener('pointerup', set(false));
  btn.addEventListener('pointercancel', set(false));
  btn.addEventListener('pointerleave', set(false));
}

// ---------------------------------------------------------------- engine sound

// The engine is a recorded loop, pitched with the revs, with a little synthesis on top so each
// engine type keeps its character: `burble` is the half-speed throb of a cross-plane V8, `scream`
// the upper harmonics of a high-revving engine, `turbo` an induction whistle. Tyre squeal and
// impacts are recordings too.
const audio = {
  ctx: null, muted: false, buffers: {}, lastHit: 0,
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.fx = ctx.createGain();   // one-shots and beeps, not tied to the engine's volume
    this.fx.connect(ctx.destination);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 1.2;
    const shaper = ctx.createWaveShaper();   // soft clipping, for exhaust rasp
    shaper.curve = Float32Array.from({ length: 512 }, (_, i) => Math.tanh((i / 255.5 - 1) * 2.4));
    const voice = (type) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = type;
      gain.gain.value = 0;
      osc.connect(gain).connect(shaper);
      osc.start();
      return { osc, gain };
    };
    this.fire = voice('sawtooth');
    this.sub = voice('square');
    this.high = voice('triangle');
    shaper.connect(this.filter).connect(this.master);

    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = buffer;
    noise.loop = true;
    this.whistle = ctx.createBiquadFilter();
    this.whistle.type = 'bandpass';
    this.whistle.Q.value = 9;
    this.turbo = ctx.createGain();
    this.turbo.gain.value = 0;
    noise.connect(this.whistle).connect(this.turbo).connect(this.master);
    noise.start();

    // recordings, fetched once the player has clicked something
    const loop = (name, out) => {
      const src = ctx.createBufferSource(), gain = ctx.createGain();
      const buf = this.buffers[name];
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0.06;                 // skip the MP3 padding at each end so the loop is seamless
      src.loopEnd = buf.duration - 0.08;
      gain.gain.value = 0;
      src.connect(gain).connect(out);
      src.start(0, 0.06);
      return { src, gain };
    };
    Promise.all(['engine', 'tire-brake', 'crash'].map(async (name) => {
      const res = await fetch(`assets/audio/${name}.mp3`);
      this.buffers[name] = await ctx.decodeAudioData(await res.arrayBuffer());
    })).then(() => {
      this.engine = loop('engine', this.master);
      this.skid = loop('tire-brake', this.fx);
    }).catch((err) => console.warn('Sound recordings failed to load; using synthesis only.', err));
  },
  update(speed, throttle, active, slip = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, e = spec.engine;
    const r = clamp(Math.abs(speed) / spec.top, 0, 1) * 6;
    const gear = Math.min(5, Math.floor(r));
    const rev = 0.2 + 0.8 * clamp(r - gear, 0, 1);          // share of the rev range in this gear
    const f = Math.min(900, (e.redline * rev / 60) * e.cyl / 2);   // firing frequency
    const recorded = !!this.engine;
    const synth = recorded ? 0.3 : 1;   // the synthesis only colours the recording
    this.fire.osc.frequency.setTargetAtTime(f, t, 0.04);
    this.sub.osc.frequency.setTargetAtTime(f / 2, t, 0.04);
    this.high.osc.frequency.setTargetAtTime(f * 2, t, 0.04);
    this.fire.gain.gain.setTargetAtTime(0.5 * synth, t, 0.05);
    this.sub.gain.gain.setTargetAtTime(e.burble * 0.6 * synth, t, 0.05);
    this.high.gain.gain.setTargetAtTime(e.scream * (0.25 + rev * 0.5) * synth, t, 0.05);
    this.filter.frequency.setTargetAtTime(300 + rev * 2300 + throttle * 1300, t, 0.05);
    this.whistle.frequency.setTargetAtTime(2400 + rev * 3600, t, 0.08);
    const on = active && !this.muted;
    if (recorded) {
      // more cylinders and a higher redline both raise the note
      const pitch = (0.72 + e.cyl / 28) * (e.redline / 7500);
      this.engine.src.playbackRate.setTargetAtTime((0.5 + rev * 1.25) * pitch, t, 0.05);
      this.engine.gain.gain.setTargetAtTime(1.6 + throttle * 1.2, t, 0.08);
      this.skid.gain.gain.setTargetAtTime(on ? clamp((slip - 3) / 7, 0, 1) * 0.5 : 0, t, 0.06);
      this.skid.src.playbackRate.setTargetAtTime(0.85 + clamp(Math.abs(speed) / 60, 0, 1) * 0.4, t, 0.1);
    }
    this.turbo.gain.setTargetAtTime(on ? e.turbo * throttle * rev * 0.35 : 0, t, 0.12);
    this.master.gain.setTargetAtTime(on ? 0.05 + throttle * 0.05 : 0, t, 0.08);
  },
  // A thump when the car hits something; harder hits are louder.
  hit(strength) {
    if (!this.ctx || this.muted || !this.buffers.crash) return;
    const now = this.ctx.currentTime;
    if (now - this.lastHit < 0.35) return;
    this.lastHit = now;
    const src = this.ctx.createBufferSource(), gain = this.ctx.createGain();
    src.buffer = this.buffers.crash;
    src.playbackRate.value = 0.9 + Math.random() * 0.3;
    gain.gain.value = clamp(strength, 0.15, 1) * 0.5;
    src.connect(gain).connect(this.fx);
    src.start();
  },
  beep(freq, length = 0.16) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);
    osc.connect(gain).connect(this.fx);
    osc.start(now);
    osc.stop(now + length);
  },
  toggleMute() { this.muted = !this.muted; },
};

// ---------------------------------------------------------------- game state

let state = 'loading';          // loading | menu | garage | countdown | race | paused | finished
let resumeState = 'race';       // what a paused game goes back to
let camMode = 0;                // 0 chase, 1 bonnet
let player, rivals = [], cars = [];
let garage;
let spec = CARS[0];                           // the car the player races
const rivalPace = { corner: 1, top: 70 };     // rivals scale with the player's car
let raceClock = 0, lapStart = 0, lastLap = null, raceBest = null, countdown = 0;
const LIGHT_STEP = 0.7;      // seconds between start lights coming on
let lightsTotal = 0;         // length of this start's countdown: five lights, then a random hold
let lightsLit = 0;
let goTimer = 0;             // how long "GO!" stays up
let finishShow = 0;          // seconds of finish-line camera left before the results appear
const finishCam = new THREE.Vector3();
let raceLaps = 3;
let online = null;       // while in an online race: { players, me, peers, myFinish, sendClock, restore }
let timeAttack = null;   // while in Time Attack: { lap, rec, recClock, ghost, best }
let net;
// the cars sharing the track with the player right now
const activeRivals = () => (online ? online.peers.map((p) => p.car) : timeAttack ? [] : rivals);
let allTimeBest = null;   // best lap on the current track, in this browser

const hud = {
  root: $('hud'), pos: $('hud-pos'), lap: $('hud-lap'), time: $('hud-time'),
  last: $('hud-last'), best: $('hud-best'), speed: $('hud-speed'), banner: $('banner'),
};
const overlay = $('overlay'), menu = $('menu'), results = $('results'), sub = $('overlay-sub');
const menuText = () => (track.finish
  ? `Drag race · ${trackDef.sprint} m · 3 rivals · ${trackDef.blurb}.`
  : `${raceLaps} ${raceLaps === 1 ? 'lap' : 'laps'} · 3 rivals · ${(track.length / 1000).toFixed(1)} km of ${trackDef.blurb}.`);
const nameInput = $('name');
nameInput.value = localStorage.getItem('sc_name') || '';

function togglePause() {
  if (online) {   // an online race can't be frozen; this is just the leave menu
    if (state === 'race' || state === 'countdown') $('pause').hidden = !$('pause').hidden;
    return;
  }
  if (state === 'paused') {
    state = resumeState;
    $('pause').hidden = true;
    clock.getDelta();   // don't count the time spent paused
    return;
  }
  if (state !== 'race' && state !== 'countdown') return;
  resumeState = state;
  state = 'paused';
  for (const k in input) input[k] = false;
  audio.update(0, 0, false);
  $('pause').hidden = false;
}

// Abandons the race and goes back to the start screen. No prize, no leaderboard entry.
function exitToMenu() {
  if (online) endOnline(true);
  if (timeAttack) endTimeAttack();
  state = 'menu';
  $('pause').hidden = true;
  hud.root.hidden = true;
  hud.banner.hidden = true;
  $('lights').hidden = true;
  finishShow = 0;
  touchUI.hidden = true;
  results.hidden = true;
  for (const k in input) input[k] = false;
  audio.update(0, 0, false);
  resetGrid();
  sub.textContent = menuText();
  $('start').textContent = 'START RACE';
  overlay.hidden = false;
}

// The five red lights, on the gantry and mirrored on the HUD.
function setStartLights(lit) {
  track.startLights.forEach((bulb, i) => bulb.material.color.setRGB(...(i < lit ? [4, 0.12, 0.06] : [0.13, 0.012, 0.012])));
  [...$('lights').children].forEach((dot, i) => dot.classList.toggle('on', i < lit));
  $('lights').hidden = state !== 'countdown' && lit === 0;
}

// Shows the results card, after the finish-line shot if one is playing.
function revealResults() {
  if (finishShow > 0) return;   // frame() calls again when the shot ends
  hud.root.hidden = true;
  hud.banner.hidden = true;
  overlay.hidden = false;
}

function resetGrid() {
  if (online) {   // two by two, in the order the host drew up
    const slot = (k) => [1 + Math.floor(k / 2), k % 2 ? -3 : 3];
    placeOnGrid(player, ...slot(online.me));
    for (const peer of online.peers) placeOnGrid(peer.car, ...slot(peer.index));
  } else if (timeAttack) {   // a run-up, so the first timed lap starts at speed
    placeOnGrid(player, 12, 0);
  } else if (track.finish) {   // a drag race lines everyone up abreast
    rivals.forEach((r, i) => placeOnGrid(r, 1, [4.5, 1.5, -1.5][i]));
    placeOnGrid(player, 1, -4.5);
  } else {
    rivals.forEach((r, i) => placeOnGrid(r, i + 1, [3, -3, 3][i]));
    placeOnGrid(player, 4, -3);
  }
  camPos.set(0, 0, 0);
}

function startRace(fromNet) {
  if (state === 'loading' || state === 'countdown' || state === 'garage' || pending) return;
  if ((online || net.active) && fromNet !== true) return;   // online races are started by the match, not the button
  localStorage.setItem('sc_name', nameInput.value.trim());
  document.activeElement?.blur();
  audio.start();
  resetGrid();
  raceClock = lapStart = 0;
  lastLap = raceBest = null;
  lightsTotal = countdown = TEST ? 0.01 : LIGHT_STEP * 5 + 0.5 + Math.random() * 0.9;
  lightsLit = 0;
  finishShow = 0;
  hud.banner.hidden = true;
  state = 'countdown';
  setStartLights(0);
  overlay.hidden = true;
  $('pause').hidden = true;
  hud.root.hidden = false;
  touchUI.hidden = !isTouch;
  $('hud-total').textContent = `/${1 + activeRivals().length}`;
  $('hud-laps').textContent = timeAttack ? '' : `/${track.finish ? 1 : raceLaps}`;
  $('pause-restart').hidden = !!online || !!timeAttack;
  hud.last.textContent = fmt(null);
  hud.best.textContent = fmt(allTimeBest);
}

function finishRace() {
  state = 'finished';
  $('pause').hidden = true;
  // a trackside camera just past the line watches the car go by before the results come up
  finishShow = 2.8;
  const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
  finishCam.set(player.x + fx * 26 + fz * 7.5, 2.2, player.z + fz * 26 - fx * 7.5);
  hud.banner.hidden = false;
  hud.banner.textContent = 'FINISH';
  audio.beep(1320, 0.5);
  for (const k in input) input[k] = false;
  if (online) {
    online.myFinish = { time: raceClock, best: raceBest };
    net.sendFinish(online.myFinish);
    const name = account.current?.username || nameInput.value.trim();
    if (name && raceBest && !TEST) submitLap(name, raceBest, trackDef.id).then(refreshBoard);
    settleOnline();
    return;
  }
  const place = standing();
  const suffix = ['st', 'nd', 'rd', 'th'][place - 1];
  results.replaceChildren();
  const placeEl = document.createElement('div');
  placeEl.className = 'place';
  placeEl.textContent = `${place}${suffix} place`;
  const dl = document.createElement('dl');
  const prize = prizeFor(place, spec.level, track.finish ? 1 : raceLaps);
  garage.addCredits(prize);
  showWallet();
  for (const [k, v] of [['Race time', fmt(raceClock * 1000)], ['Best lap', fmt(raceBest)], ['Winnings', `+${garage.format(prize)}`]]) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
  results.append(placeEl, dl);
  results.hidden = false;
  sub.textContent = 'Race complete. Press Enter to go again.';
  $('start').textContent = 'RACE AGAIN';
  hud.banner.textContent = place === 1 ? 'WINNER' : `${place}${suffix} PLACE`;
  revealResults();
  touchUI.hidden = true;

  const name = account.current?.username || nameInput.value.trim();
  if (name && raceBest && !TEST) submitLap(name, raceBest, trackDef.id).then(refreshBoard);
}

// ---- online races (two to four players)

function onlineStatus(text) {
  $('online-status').textContent = text;
  $('online-btn').textContent = net.active ? 'CANCEL' : 'ONLINE RACE';
}

function toggleOnlineSearch() {
  if (state !== 'menu' && state !== 'finished') return;
  if (net.active) {
    if (online) endOnline(true); else net.leave();
    onlineStatus('');
    return;
  }
  if (pending) return;
  audio.start();   // needs a click, and the race will start without one
  if (state === 'finished') { state = 'menu'; results.hidden = true; }
  const sel = garage.selected();
  net.search({
    name: account.current?.username || nameInput.value.trim() || 'Guest',
    carId: sel.car.id, look: sel.look, track: trackDef.id, laps: raceLaps,
  });
  onlineStatus('Searching for opponents…');
}

// The grid is set: put the other players' cars on it, on the host's track.
function beginOnline({ players, me, track: trackId, laps }) {
  online = {
    players, me, myFinish: null, sendClock: 0,
    restore: { track: trackDef.id, laps: raceLaps },
    peers: players.map((p, index) => ({ ...p, index })).filter((p) => p.index !== me)
      .map((p, i) => ({ ...p, car: rivals[i], snap: null, finish: null, left: false })),
  };
  if (trackDef.id !== trackId) loadTrack(TRACKS.find((t) => t.id === trackId) || trackDef);
  raceLaps = laps;
  rivals.forEach((r, i) => { r.root.visible = i < online.peers.length; });
  for (const peer of online.peers) dressCar(peer.car, CARS.find((c) => c.id === peer.carId) || CARS[0], peer.look);
  resetGrid();
  const names = online.peers.map((p) => p.name).join(', ');
  onlineStatus(`Racing ${names} · ${trackDef.name}${track.finish ? '' : `, ${laps} ${laps === 1 ? 'lap' : 'laps'}`}`);
}

// Leaves the race and puts the single-player rivals, track and lap count back.
function endOnline(tellPeers) {
  if (!online) return;
  const { restore } = online;
  if (tellPeers) net.leave();
  online = null;
  for (const r of rivals) r.root.visible = true;
  if (trackDef.id !== restore.track) loadTrack(TRACKS.find((t) => t.id === restore.track));
  selectLaps(restore.laps);
  resetGrid();
  $('track-name').textContent = trackDef.name;
  applySelection();
  onlineStatus('');
  menu.hidden = false;
}

// Called whenever something about the result changes. Each player is timed from their own
// green light, so the order is by race time no matter whose connection is slower.
function settleOnline() {
  const o = online;
  if (!o || !o.myFinish) return;
  results.replaceChildren();
  const head = document.createElement('div');
  head.className = 'place';
  const dl = document.createElement('dl');
  const row = (k, v) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  };
  const waiting = o.peers.filter((p) => !p.finish && !p.left);
  const table = [{ name: 'You', time: o.myFinish.time }, ...o.peers.filter((p) => p.finish).map((p) => ({ name: p.name, time: p.finish.time }))]
    .sort((a, b) => a.time - b.time);
  table.forEach((entry, i) => row(`${i + 1}. ${entry.name}`, fmt(entry.time * 1000)));
  for (const p of o.peers) if (!p.finish) row(p.name, p.left ? 'left the race' : 'still racing…');
  results.append(head, dl);

  if (waiting.length) {
    head.textContent = 'Finished';
    sub.textContent = `Waiting for ${waiting.map((p) => p.name).join(', ')} to finish.`;
    menu.hidden = true;
    const quit = document.createElement('button');
    quit.className = 'link';
    quit.textContent = 'Leave without waiting (no prize)';
    quit.addEventListener('click', () => { endOnline(true); state = 'menu'; results.hidden = true; sub.textContent = menuText(); });
    results.append(quit);
  } else {
    const place = 1 + table.findIndex((entry) => entry.name === 'You');
    head.textContent = place === 1 ? 'You win' : `${place}${['st', 'nd', 'rd', 'th'][place - 1]} place`;
    row('Best lap', fmt(o.myFinish.best));
    const prize = prizeFor(place, spec.level, track.finish ? 1 : raceLaps);
    garage.addCredits(prize);
    row('Winnings', `+${garage.format(prize)}`);
    sub.textContent = 'Online race complete.';
    $('start').textContent = 'START RACE';
    hud.banner.textContent = place === 1 ? 'WINNER' : 'FINISH';
    endOnline(true);
    showWallet();
  }
  results.hidden = false;
  revealResults();
  touchUI.hidden = true;
}

function peerLeft(id) {
  const peer = online?.peers.find((p) => p.id === id);
  if (!peer || peer.left) return;
  peer.left = true;
  peer.car.root.visible = false;
  if (online.myFinish) { settleOnline(); return; }
  if (online.peers.every((p) => p.left) && (state === 'race' || state === 'countdown')) {
    hud.banner.hidden = false;
    hud.banner.textContent = 'Opponents left';
    goTimer = 2.2;   // the banner clears itself after this
  }
}

// Another player's car: glide toward where their last report says they are by now.
function updateRemote(peer, dt) {
  const r = peer.car, snap = peer.snap;
  if (!snap) { syncCar(r, dt, false); return; }
  const age = Math.min(0.4, (performance.now() - snap.at) / 1000);
  const tx = snap.x + Math.sin(snap.h) * snap.v * age, tz = snap.z + Math.cos(snap.h) * snap.v * age;
  const k = Math.min(1, dt * 12);
  if (Math.hypot(tx - r.x, tz - r.z) > 30) { r.x = tx; r.z = tz; }   // too far to glide: jump
  r.x += (tx - r.x) * k;
  r.z += (tz - r.z) * k;
  let dh = snap.h - r.heading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  r.heading += dh * k;
  r.speed = snap.v;
  r.steer = snap.s;
  r.prog = snap.p;
  r.laps = snap.l;
  syncCar(r, dt, snap.b);
}

function sendOnlineState(dt) {
  if ((online.sendClock += dt) < 0.1) return;
  online.sendClock = 0;
  const p = player, round = (n) => Math.round(n * 100) / 100;
  net.sendState({ x: round(p.x), z: round(p.z), h: round(p.heading), v: round(p.speed), s: round(p.steer), p: round(p.prog), l: p.laps, b: input.down && p.speed > 1 });
}

// ---- time attack: no rivals, endless laps, and a ghost of your best lap to chase

const GHOST_RATE = 15;   // position samples per second
const ghostMaterial = new THREE.MeshBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: 0.3, depthWrite: false });

function loadGhost() {
  try {
    const saved = JSON.parse(localStorage.getItem(`sc_ghost_${trackDef.id}`));
    if (saved && Array.isArray(saved.s) && saved.s.length > 30) return saved;
  } catch { /* corrupt or blocked storage: no ghost */ }
  return null;
}

async function startTimeAttack() {
  if ((state !== 'menu' && state !== 'finished') || online || net.active || pending) return;
  if (track.finish) { onlineStatus('Time Attack needs a circuit. Pick another track.'); return; }
  onlineStatus('');
  audio.start();
  const saved = loadGhost();
  timeAttack = { lap: -1, rec: [], recClock: 0, ghost: saved?.s || null, best: saved?.ms || null };
  // the ghost is the player's own car, drawn see-through
  const ghost = rivals[0], sel = garage.selected();
  rivals[1].root.visible = rivals[2].root.visible = false;
  ghost.root.visible = false;
  ghost.blob.visible = false;
  await dressCar(ghost, sel.car, sel.look);
  ghost.visual.model.traverse((o) => { if (o.isMesh) { o.material = ghostMaterial; o.castShadow = false; } });
  startRace(true);
  hud.best.textContent = fmt(timeAttack.best);
}

function endTimeAttack() {
  timeAttack = null;
  for (const r of rivals) { r.root.visible = true; r.blob.visible = true; }
  rivals[0].def = null;   // forces the see-through car to be rebuilt as a normal one
  applySelection();
}

// Lap timing and ghost recording, run from the player's physics step.
function stepTimeAttack(p, dt) {
  const ta = timeAttack;
  const lap = Math.floor(p.prog / N);
  if (lap > ta.lap) {
    if (ta.lap >= 0) {   // a timed lap just ended
      lastLap = (raceClock - lapStart) * 1000;
      hud.last.textContent = fmt(lastLap);
      hud.banner.hidden = false;
      goTimer = 2;
      if (!ta.best || lastLap < ta.best) {
        hud.banner.textContent = ta.best ? `NEW BEST  −${((ta.best - lastLap) / 1000).toFixed(3)}` : 'LAP SET';
        ta.best = lastLap;
        ta.ghost = ta.rec;
        try { localStorage.setItem(`sc_ghost_${trackDef.id}`, JSON.stringify({ ms: Math.round(lastLap), s: ta.rec })); } catch { /* storage full or blocked */ }
        if (!allTimeBest || lastLap < allTimeBest) {
          allTimeBest = lastLap;
          localStorage.setItem(`sc_best_${trackDef.id}`, String(Math.round(lastLap)));
        }
        const name = account.current?.username || nameInput.value.trim();
        if (name && !TEST) submitLap(name, lastLap, trackDef.id).then(refreshBoard);
        audio.beep(1320, 0.4);
      } else {
        hud.banner.textContent = `+${((lastLap - ta.best) / 1000).toFixed(3)}`;
      }
      hud.best.textContent = fmt(ta.best);
    }
    ta.lap = lap;
    p.laps = Math.max(0, lap);
    lapStart = raceClock;
    ta.rec = [];
    ta.recClock = 0;
  }
  if (ta.lap >= 0 && (ta.recClock -= dt) <= 0) {
    ta.recClock += 1 / GHOST_RATE;
    ta.rec.push(Math.round(p.x * 10), Math.round(p.z * 10), Math.round(p.heading * 100));
  }
}

// Plays the best lap back alongside the current one.
function updateGhost(dt) {
  const ta = timeAttack, car = rivals[0];
  const at = (raceClock - lapStart) * GHOST_RATE, i = Math.floor(at);
  const s = ta.ghost;
  car.root.visible = !!s && ta.lap >= 0 && state === 'race' && (i + 1) * 3 + 2 < s.length;
  if (!car.root.visible) return;
  const f = at - i, a = i * 3, b = a + 3;
  const x = (s[a] + (s[b] - s[a]) * f) / 10, z = (s[a + 1] + (s[b + 1] - s[a + 1]) * f) / 10;
  let dh = (s[b + 2] - s[a + 2]) / 100;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  car.speed = Math.hypot(x - car.x, z - car.z) / Math.max(dt, 1e-3);
  if (car.speed > 150) car.speed = 0;   // the jump back to the start of the lap
  car.x = x;
  car.z = z;
  car.heading = s[a + 2] / 100 + dh * f;
  car.steer = 0;
  syncCar(car, dt, false);
}

// ---- accounts

function showAccount(message = '') {
  const me = account.current;
  $('acct-guest').hidden = !!me;
  $('acct-user-row').hidden = !me;
  if (me) {
    $('acct-name').textContent = me.username;
    $('acct-dev').hidden = !me.isDev;
    $('acct-devbtn').hidden = me.isDev;
    $('acct-devform').hidden = true;
  }
  $('acct-msg').textContent = message;
}

// Points the garage at this player's progress (or the guest's, for null) and puts their car on track.
function useAccount(me, message) {
  garage.setAccount(me);
  showAccount(message);
  return applySelection();
}

async function signIn(action) {
  $('acct-msg').textContent = 'Working…';
  const reply = await account[action]($('acct-user').value.trim(), $('acct-pass').value);
  $('acct-pass').value = '';
  if (reply.error) { $('acct-msg').textContent = reply.error; return; }
  document.activeElement?.blur();
  useAccount(reply, action === 'register' ? 'Account created.' : '');
}

async function redeemCode() {
  $('acct-msg').textContent = 'Working…';
  const reply = await account.redeemDevCode($('acct-code').value.trim());
  $('acct-code').value = '';
  if (reply.error) { $('acct-msg').textContent = reply.error; return; }
  document.activeElement?.blur();
  useAccount(account.current, 'Developer access unlocked: every car is yours.');
}

function showWallet() {
  $('wallet').textContent = `${garage.format(garage.credits)} · ${spec.name}`;
}

// Puts the selected car, its paint job and matching rivals on track.
function applySelection() {
  const sel = garage.selected();
  spec = sel.spec;
  rivalPace.corner = Math.sqrt(spec.grip / CARS[0].grip);
  rivalPace.top = terminalSpeed(spec) * 0.97;
  showWallet();
  // rivals drive what the player drives, unless it is an exclusive car
  const rivalCar = spec.devOnly || spec.special ? CARS.filter((c) => !c.devOnly && !c.special).at(-1) : sel.car;
  return Promise.all([
    dressCar(player, sel.car, sel.look),
    ...rivals.map((r, i) => {
      r.skill = r.baseSkill + 0.05 * spec.level;
      return dressCar(r, rivalCar, rivalLook(RIVAL_COLORS[i]));
    }),
  ]);
}

function openGarage() {
  if ((state !== 'menu' && state !== 'finished') || online || net.active || timeAttack) return;
  state = 'garage';
  overlay.hidden = true;
  resetGrid();
  garage.open();
}

function closeGarage() {
  garage.close();
  applySelection();
  state = 'menu';
  results.hidden = true;
  sub.textContent = menuText();
  $('start').textContent = 'START RACE';
  overlay.hidden = false;
}

// Switches circuit. Only reachable from the menu, so no race is in progress.
function selectTrack(index) {
  if (online || net?.active) return;
  const def = TRACKS[(index + TRACKS.length) % TRACKS.length];
  loadTrack(def);
  localStorage.setItem('sc_track', def.id);
  // the original circuit's best was stored under 'sc_best' before there were several tracks
  allTimeBest = Number(localStorage.getItem(`sc_best_${def.id}`) || (def.id === 'sunset' && localStorage.getItem('sc_best'))) || null;
  $('track-name').textContent = def.name;
  $('lap-choices').classList.toggle('off', !!track.finish);
  if (state === 'finished') {
    state = 'menu';
    results.hidden = true;
    $('start').textContent = 'START RACE';
  }
  if (player) resetGrid();
  sub.textContent = menuText();
  refreshBoard();
}

function selectLaps(n) {
  if (online || net?.active) return;
  raceLaps = n;
  localStorage.setItem('sc_laps', String(n));
  $('hud-laps').textContent = `/${n}`;
  for (const chip of $('lap-choices').children) chip.classList.toggle('on', Number(chip.textContent) === n);
  if (track) sub.textContent = menuText();
}

function standing() {
  return 1 + activeRivals().filter((r) => r.prog > player.prog).length;
}

async function refreshBoard() {
  const list = $('board-list');
  const shown = trackDef;
  $('board-title').textContent = `Fastest laps · ${shown.name}`;
  const rows = await fetchBoard(shown.id);
  if (shown !== trackDef) return;   // the player switched track while this was loading
  list.replaceChildren();
  if (!rows || !rows.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = rows ? 'No times yet — set the first one.' : 'Leaderboard unavailable.';
    list.append(li);
    return;
  }
  rows.forEach((row, i) => {
    const li = document.createElement('li');
    const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = i + 1;
    const who = document.createElement('span'); who.className = 'who'; who.textContent = row.player_name;
    const time = document.createElement('span'); time.textContent = fmt(row.lap_ms);
    li.append(rank, who, time);
    list.append(li);
  });
}

// ---------------------------------------------------------------- simulation

function autopilot(car) {
  const look = wrap(car.idx + 5 + Math.floor(car.speed * 0.3));
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const tx = pts[look].x - car.x, tz = pts[look].z - car.z;
  const err = Math.atan2(fz * tx - fx * tz, fx * tx + fz * tz);
  const target = speedProfile[wrap(car.idx + 3)] * 1.05 * rivalPace.corner;
  input.left = err > 0.03; input.right = err < -0.03;
  input.up = car.speed < target; input.down = car.speed > target + 3;
}

function updatePlayer(dt, live) {
  const p = player;
  if (TEST && live) autopilot(p);
  const throttle = live && input.up ? 1 : 0;
  const brake = live && input.down ? 1 : 0;
  const hand = live && input.hand;
  const steerIn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  p.steer += (steerIn - p.steer) * Math.min(1, dt * 9);

  let fx = Math.sin(p.heading), fz = Math.cos(p.heading);
  let vF = p.vx * fx + p.vz * fz;
  let vL = p.vx * fz - p.vz * fx;
  const onGrass = Math.abs(p.lat) > ROAD_HALF + 1.2;

  let a = 0;
  if (throttle) a += vF > -0.5 ? spec.accel * (1 - Math.max(vF, 0) / spec.top) : spec.brake;
  if (brake) a -= vF > 0.5 ? spec.brake : (vF > -14 ? 9 : 0);
  if (Math.abs(vF) > 0.2) {
    a -= Math.sign(vF) * (ROLL_DRAG + AIR_DRAG * vF * vF + (hand ? 9 : 0));
    if (onGrass) a -= vF * 0.8;
  } else if (!throttle && !brake) {
    vF = 0;
  }
  vF += a * dt;

  // Steering lock tightens with speed, and yaw is capped by available grip.
  const maxSteer = 0.5 / (1 + Math.pow(Math.abs(vF) / 25, 1.2));
  const grip = spec.grip * (onGrass ? 0.48 : 1) * (hand ? 1.5 : 1);
  const yawCap = grip / Math.max(Math.abs(vF), 4);
  const yaw = clamp((vF * Math.tan(p.steer * maxSteer)) / WHEELBASE, -yawCap, yawCap);

  // Velocity keeps its world direction while the body turns, then tyres pull it back in line.
  const wx = fx * vF + fz * vL, wz = fz * vF - fx * vL;
  p.heading += yaw * dt;
  fx = Math.sin(p.heading); fz = Math.cos(p.heading);
  vF = wx * fx + wz * fz;
  const slide = wx * fz - wz * fx;
  vL = slide * Math.exp(-(hand ? 1.8 : onGrass ? 4 : 9) * dt);
  // Gripping tyres turn most of a slide back into forward speed; without this, long fast
  // corners would bleed speed far faster than a real car does.
  if (!hand && !onGrass) vF = Math.sign(vF) * Math.sqrt(vF * vF + 0.6 * (slide * slide - vL * vL));
  p.vx = fx * vF + fz * vL;
  p.vz = fz * vF - fx * vL;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  p.speed = vF;
  p.slip = Math.abs(vL) + (hand && Math.abs(vF) > 8 ? 6 : 0);   // how hard the tyres are sliding, for the squeal

  // Rivals are solid.
  for (const r of activeRivals()) {
    if (!r.root.visible) continue;
    const dx = p.x - r.x, dz = p.z - r.z;
    const d = Math.hypot(dx, dz);
    if (d < CAR_RADIUS && d > 1e-3) {
      const push = (CAR_RADIUS - d) / d;
      p.x += dx * push; p.z += dz * push;
      p.vx *= 0.985; p.vz *= 0.985;
      r.speed *= 0.99;
      audio.hit(Math.abs(p.speed - r.speed) / 14 + 0.2);
    }
  }

  // Guard rails.
  const prev = p.idx;
  p.idx = nearestIndex(p.x, p.z, p.idx);
  const n = nrm[p.idx];
  p.lat = (p.x - pts[p.idx].x) * n.x + (p.z - pts[p.idx].z) * n.z;
  const limit = WALL - 1.2;
  if (Math.abs(p.lat) > limit) {
    const s = Math.sign(p.lat);
    const over = Math.abs(p.lat) - limit;
    p.x -= n.x * s * over; p.z -= n.z * s * over;
    const vn = (p.vx * n.x + p.vz * n.z) * s;
    if (vn > 0) {
      p.vx -= n.x * s * vn * 1.3; p.vz -= n.z * s * vn * 1.3;
      if (vn > 4) audio.hit(vn / 18);
      const scrub = Math.exp(-1.5 * dt) * (vn > 4 ? 0.8 : 1);
      p.vx *= scrub; p.vz *= scrub;
    }
    p.lat = s * limit;
  }
  p.prog += wrapDiff(p.idx - prev);

  p.roll += (clamp(yaw * vF * 0.0028, -0.07, 0.07) - p.roll) * Math.min(1, dt * 6);
  p.pitch += (clamp(-a * 0.0016, -0.04, 0.04) - p.pitch) * Math.min(1, dt * 6);
  if (Math.abs(vF) > 6 && (onGrass || hand || Math.abs(vL) > 3.5) && (smoke.clock += dt) > 0.035) {
    smoke.clock = 0;
    const side = Math.random() < 0.5 ? 0.8 : -0.8;
    puffSmoke(p.x - fx * 1.5 + fz * side, p.z - fz * 1.5 - fx * side, onGrass);
  }
  syncCar(p, dt, brake && vF > 1);

  if (live && timeAttack) {
    stepTimeAttack(p, dt);
  } else if (live && track.finish) {
    // sprint: one timed run to the finish line
    if (p.prog >= track.finish) {
      p.laps = 1;
      lastLap = raceBest = raceClock * 1000;
      if (!allTimeBest || lastLap < allTimeBest) {
        allTimeBest = lastLap;
        localStorage.setItem(`sc_best_${trackDef.id}`, String(Math.round(lastLap)));
      }
      finishRace();
    }
  } else if (live) {
    const done = Math.floor(p.prog / N);
    if (done > p.laps) {
      p.laps = done;
      lastLap = (raceClock - lapStart) * 1000;
      lapStart = raceClock;
      if (!raceBest || lastLap < raceBest) raceBest = lastLap;
      if (!allTimeBest || lastLap < allTimeBest) {
        allTimeBest = lastLap;
        localStorage.setItem(`sc_best_${trackDef.id}`, String(Math.round(lastLap)));
      }
      hud.last.textContent = fmt(lastLap);
      hud.best.textContent = fmt(allTimeBest);
      if (p.laps >= raceLaps) finishRace();
    }
  }
  return throttle;
}

// Rivals follow a racing line rather than a fixed lane, pull out to pass slower cars, cover the
// inside when the player is on their tail, and now and then get a corner wrong and run wide.
function updateRival(r, dt, live) {
  const i = wrap(Math.floor(r.prog));
  if (live && r.react > 0) { r.react -= dt; live = false; }   // reaction time off the line
  let target = live ? Math.min(speedProfile[wrap(i + 2)] * r.skill * rivalPace.corner, rivalPace.top) : 0;
  if (track.finish ? r.prog >= track.finish : r.laps >= raceLaps) target = Math.min(target, 22);

  // where on the road it wants to be
  let want = track.finish ? r.lane : track.line[wrap(i + 6)] * 0.8 + r.lane * 0.3;   // drag racers keep their lane
  for (const o of cars) {
    if (o === r || !o.root.visible) continue;
    const gap = wrapDiff(wrap(Math.floor(o.prog)) - i) * DS;   // metres ahead (+) or behind (-)
    if (gap > 0 && gap < 18 && Math.abs(o.lat - r.lat) < 2.5) {
      // a car in the way: go round on the side with more room, and don't run into it meanwhile.
      // Once a side is chosen it is kept, so the car doesn't dither from one to the other.
      if (!r.passSide) r.passSide = o.lat > 0 ? -1 : 1;
      r.passHold = 1.2;
      want = o.lat + r.passSide * 3.4;
      if (gap < 7) target = Math.min(target, o.speed + 1);
    } else if (o === player && r.defends && gap < 0 && gap > -12 && o.speed > r.speed - 2) {
      want = want * 0.45 + o.lat * 0.55;   // cover the line the player is taking
    }
  }
  // misjudging a corner: brake late, run wide, lose time
  const braking = speedProfile[wrap(i + 12)] < speedProfile[i] - 6;
  if (live && braking && !r.inBrakeZone && Math.random() < 0.05 + (0.92 - r.baseSkill) * 0.5) {
    r.mistake = 1.6;
    r.wide = track.bend[wrap(i + 14)] > 0 ? -1 : 1;   // toward the outside of the bend
  }
  r.inBrakeZone = braking;
  if (r.mistake > 0) {
    r.mistake -= dt;
    want += r.wide * 3;
    target *= 0.84;
  }
  if (r.passHold > 0 && (r.passHold -= dt) <= 0) r.passSide = 0;
  want = clamp(want, -(ROAD_HALF - 1.4), ROAD_HALF - 1.4);
  // Ease across the road: sideways speed builds up and bleeds off rather than snapping, so
  // lane changes look like steering and not like a sidestep. A parked car can't move sideways.
  const wantVel = clamp((want - r.offset) * 1.4, -3, 3) * Math.min(1, r.speed / 8);
  r.latVel += clamp(wantVel - r.latVel, -5 * dt, 5 * dt);
  r.offset += r.latVel * dt;
  r.lat = r.offset;

  const slowing = r.speed > target + 0.5;
  // Same engine and drag as the player's car, a touch weaker, so straights are a fair fight.
  // On a drag strip nothing but power separates the field, so rivals differ there too.
  const pull = (track.finish ? 0.93 * (r.baseSkill + 0.08) : 0.93) * (spec.accel * (1 - r.speed / spec.top) - ROLL_DRAG - AIR_DRAG * r.speed * r.speed);
  r.speed += clamp(target - r.speed, -spec.brake * 0.8 * dt, Math.max(pull, 0.5) * dt);
  r.prog += (r.speed * dt) / DS;
  r.laps = Math.max(r.laps, Math.floor(r.prog / N));

  const f = r.prog - Math.floor(r.prog);
  const a = wrap(Math.floor(r.prog)), b = wrap(a + 1);
  const nx = nrm[a].x + (nrm[b].x - nrm[a].x) * f, nz = nrm[a].z + (nrm[b].z - nrm[a].z) * f;
  r.x = pts[a].x + (pts[b].x - pts[a].x) * f + nx * r.offset;
  r.z = pts[a].z + (pts[b].z - pts[a].z) * f + nz * r.offset;
  const tx = tan[a].x + (tan[b].x - tan[a].x) * f, tz = tan[a].z + (tan[b].z - tan[a].z) * f;
  // point the nose where the car is actually going, including its sideways drift across the road
  const heading = Math.atan2(tx, tz) + Math.atan2(r.latVel, Math.max(r.speed, 8));
  let dh = heading - r.heading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  // the nose follows the path through a short lag, and the front wheels ease toward the turn
  const turn = dh * Math.min(1, dt * 9);
  r.heading += turn;
  r.steer += (clamp(turn / Math.max(dt, 1e-3) * 0.6, -1, 1) - r.steer) * Math.min(1, dt * 6);
  syncCar(r, dt, slowing && live);
}

// ---------------------------------------------------------------- camera

const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
let camHeading = 0;
let menuAngle = 0;

function updateCamera(dt) {
  const p = player;
  if (state === 'finished' && finishShow > 0) {
    camera.position.copy(finishCam);
    camera.lookAt(p.x, 0.8, p.z);
    camera.fov += (34 - camera.fov) * Math.min(1, dt * 6);
    camera.updateProjectionMatrix();
    camPos.set(0, 0, 0);
    return;
  }
  if (state === 'menu' || state === 'finished' || state === 'garage') {
    menuAngle += dt * 0.18;
    const sx = Math.sin(menuAngle), cz = Math.cos(menuAngle);
    // In the garage, aim to the car's side so it sits clear of the panel; on the start screen
    // it is the centrepiece, held a little above the dock.
    const inGarage = state === 'garage';
    const shift = inGarage && innerWidth > 720 ? 1.7 : 0;
    camera.position.set(p.x + sx * 7.5, 1.7, p.z + cz * 7.5);
    camera.lookAt(p.x - cz * shift, inGarage ? 0.7 : 0.25, p.z + sx * shift);
    camera.fov += (42 - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
    return;
  }
  const speedK = clamp(Math.abs(p.speed) / spec.top, 0, 1);
  if (camMode === 1) {
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    camera.position.set(p.x + fx * 0.9, 1.15, p.z + fz * 0.9);
    camera.lookAt(p.x + fx * 20, 0.9, p.z + fz * 20);
    camPos.set(0, 0, 0);
  } else {
    let dh = p.heading - camHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const fresh = camPos.lengthSq() === 0;
    camHeading = fresh ? p.heading : camHeading + dh * Math.min(1, dt * 5);
    // while the lights come on, sweep round from the front of the car to its usual place behind
    const intro = state === 'countdown' ? clamp(1 - (lightsTotal - countdown) / 2.6, 0, 1) : 0;
    const ease = intro * intro * (3 - 2 * intro);
    const fx = Math.sin(camHeading + ease * 2.7), fz = Math.cos(camHeading + ease * 2.7);
    const back = 6.6 + speedK * 1.6 + ease * 3;
    camPos.set(p.x - fx * back, 2.35 + speedK * 0.25 + ease * 0.8, p.z - fz * back);
    camera.position.copy(camPos);
    camLook.set(p.x + fx * 6 * (1 - ease), 0.9, p.z + fz * 6 * (1 - ease));
    camera.lookAt(camLook);
  }
  camera.fov += (58 + speedK * 22 - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- minimap

const mini = $('minimap');
const mctx = mini.getContext('2d');
const mapBase = document.createElement('canvas');
mapBase.width = mapBase.height = mini.width;
let mapXf;

function drawMapBase() {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const s = (mini.width - 36) / Math.max(maxX - minX, maxZ - minZ);
  const ox = (mini.width - (maxX - minX) * s) / 2 - minX * s;
  const oz = (mini.height - (maxZ - minZ) * s) / 2 - minZ * s;
  mapXf = (x, z) => [x * s + ox, z * s + oz];

  const c = mapBase.getContext('2d');
  c.clearRect(0, 0, mapBase.width, mapBase.height);
  c.beginPath();
  pts.forEach((p, i) => { const [x, y] = mapXf(p.x, p.z); i ? c.lineTo(x, y) : c.moveTo(x, y); });
  c.closePath();
  c.lineJoin = 'round';
  c.strokeStyle = 'rgba(255,255,255,.9)';
  c.lineWidth = 5;
  c.stroke();
  const [sx, sy] = mapXf(pts[0].x, pts[0].z);
  c.fillStyle = '#ff8a3c';
  c.fillRect(sx - 2, sy - 6, 4, 12);
}

function drawMinimap() {
  mctx.clearRect(0, 0, mini.width, mini.height);
  mctx.drawImage(mapBase, 0, 0);
  [player, ...activeRivals()].forEach((car) => {
    if (!car.root.visible) return;
    const [x, y] = mapXf(car.x, car.z);
    mctx.beginPath();
    mctx.arc(x, y, car === player ? 6 : 4.5, 0, Math.PI * 2);
    mctx.fillStyle = '#' + car.color.toString(16).padStart(6, '0');
    mctx.fill();
    mctx.lineWidth = 1.5;
    mctx.strokeStyle = car === player ? '#fff' : 'rgba(0,0,0,.6)';
    mctx.stroke();
  });
}

// ---------------------------------------------------------------- loop

const clock = new THREE.Clock();
let hudTick = 0;

function frame() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 1 / 20);
  if (state !== 'loading' && state !== 'paused') watchFrameRate(rawDt);
  renderer.info.reset();
  if (state === 'paused') {   // hold the picture, advance nothing
    composer.render(0);
    requestAnimationFrame(frame);
    return;
  }
  let throttle = 0;

  if (state === 'countdown') {
    countdown -= dt;
    const lit = Math.min(5, Math.floor((lightsTotal - countdown) / LIGHT_STEP));
    if (lit !== lightsLit) {
      lightsLit = lit;
      setStartLights(lit);
      audio.beep(440);
    }
    if (countdown <= 0) {   // lights out
      state = 'race';
      setStartLights(0);
      audio.beep(880, 0.45);
      hud.banner.hidden = false;
      hud.banner.textContent = 'GO!';
      goTimer = 0.9;
    }
  } else if (state === 'race') {
    raceClock += dt;
    if (goTimer > 0 && (goTimer -= dt) <= 0) hud.banner.hidden = true;
  } else if (state === 'finished' && finishShow > 0) {
    if ((finishShow -= dt) <= 0) revealResults();
  }

  if (state !== 'loading') {
    const live = state === 'race';
    // Two substeps keep wall and car contacts stable at top speed.
    for (let i = 0; i < 2; i++) throttle = updatePlayer(dt / 2, live && state === 'race');
    if (online) {
      for (const peer of online.peers) if (!peer.left) updateRemote(peer, dt);
      sendOnlineState(dt);
    } else if (timeAttack) {
      updateGhost(dt);
    } else {
      for (const r of rivals) updateRival(r, dt, live || state === 'finished');
    }
    updateCamera(dt);
    audio.update(player.speed, throttle, state === 'race' || state === 'countdown' || finishShow > 0, state === 'race' ? player.slip : 0);

    sun.target.position.set(player.x, 0, player.z);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 180);
    sky.position.copy(camera.position);
    dome.position.copy(camera.position);
    updateWeather(dt);
    updateSmoke(dt);

    if (!hud.root.hidden && (hudTick = (hudTick + 1) % 3) === 0) {
      hud.speed.textContent = Math.round(Math.abs(player.speed) * 3.6);
      hud.pos.textContent = standing();
      hud.lap.textContent = timeAttack ? player.laps + 1 : track.finish ? 1 : Math.min(raceLaps, player.laps + 1);
      hud.time.textContent = fmt((raceClock - lapStart) * 1000);
      drawMinimap();
    }
  }

  composer.render(dt);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot

async function boot() {
  for (const [level, label] of [['auto', 'Auto'], ['0', 'High'], ['1', 'Med'], ['2', 'Low'], ['3', 'Min']]) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = label;
    chip.dataset.level = level;
    chip.addEventListener('click', () => {
      autoQuality = level === 'auto';
      localStorage.setItem('sc_quality', level);
      setQuality(autoQuality ? 0 : Number(level));
    });
    $('quality-choices').append(chip);
  }
  const savedQuality = localStorage.getItem('sc_quality') || 'auto';
  autoQuality = savedQuality === 'auto';
  // phones and tablets start a step down
  setQuality(autoQuality ? (matchMedia('(pointer: coarse)').matches ? 1 : 0) : Number(savedQuality) || 0);
  await loadNature();   // scenery models, needed before the first track is built
  for (const n of LAP_CHOICES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = n;
    chip.addEventListener('click', () => selectLaps(n));
    $('lap-choices').append(chip);
  }
  const savedLaps = Number(params.get('laps') || localStorage.getItem('sc_laps'));
  selectLaps(LAP_CHOICES.includes(savedLaps) ? savedLaps : 3);
  const savedTrack = params.get('track') || localStorage.getItem('sc_track');
  selectTrack(Math.max(0, TRACKS.findIndex((t) => t.id === savedTrack)));
  $('track-prev').addEventListener('click', () => selectTrack(TRACKS.indexOf(trackDef) - 1));
  $('track-next').addEventListener('click', () => selectTrack(TRACKS.indexOf(trackDef) + 1));

  rivals = [0.9, 0.86, 0.82].map((baseSkill, i) => Object.assign(makeCar(), { baseSkill, defends: i < 2 }));
  player = makeCar();
  player.headlight.visible = nightScene;
  player.blob.visible = !QUALITY[quality].shadow;
  cars = [player, ...rivals];
  garage = createGarage({
    onPreview: (car, look) => dressCar(player, car, look),
    onSave: (save) => account.queueSave(save),
  });
  garage.setAccount(await account.resume());
  showAccount();
  $('acct-open').addEventListener('click', () => { $('acct-form').hidden = false; $('acct-open').hidden = true; $('acct-user').focus(); });
  $('acct-login').addEventListener('click', () => signIn('login'));
  $('acct-signup').addEventListener('click', () => signIn('register'));
  $('acct-logout').addEventListener('click', () => { account.logout(); useAccount(null); });
  $('acct-devbtn').addEventListener('click', () => { $('acct-devform').hidden = false; $('acct-code').focus(); });
  $('acct-redeem').addEventListener('click', redeemCode);
  await applySelection();
  resetGrid();

  state = 'menu';
  sub.textContent = menuText();
  menu.hidden = false;
  $('start').addEventListener('click', startRace);
  $('open-garage').addEventListener('click', openGarage);
  $('pause-btn').addEventListener('click', togglePause);
  $('pause-resume').addEventListener('click', togglePause);
  $('pause-restart').addEventListener('click', startRace);
  $('pause-exit').addEventListener('click', exitToMenu);
  net = createOnline({
    onStatus: onlineStatus,
    onMatched: beginOnline,
    // the opponent's car may still be loading when the start is called
    onStart: function go() { if (pending) setTimeout(go, 100); else startRace(true); },
    onPeerState: (id, snap) => { const peer = online?.peers.find((p) => p.id === id); if (peer) peer.snap = { ...snap, at: performance.now() }; },
    onPeerFinish: (id, result) => { const peer = online?.peers.find((p) => p.id === id); if (peer) { peer.finish = result; settleOnline(); } },
    onPeerLeft: peerLeft,
  });
  $('online-btn').addEventListener('click', toggleOnlineSearch);
  $('ta-btn').addEventListener('click', startTimeAttack);
  $('g-back').addEventListener('click', closeGarage);
  refreshBoard();
  if (TEST && params.has('online')) toggleOnlineSearch();
  else if (TEST && params.has('ta')) startTimeAttack();
  else if (TEST) startRace();
}

window.__game = { get state() { return state; }, get stats() { return { ...renderer.info.render, quality: QUALITY[quality].name }; }, get online() { return online; }, get timeAttack() { return timeAttack; }, get garage() { return garage; }, get player() { return player; }, get rivals() { return rivals; }, get clock() { return raceClock; } };

requestAnimationFrame(frame);
boot();
