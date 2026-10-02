import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildTrack, ROAD_HALF, WALL } from './track.js';
import { fetchBoard, submitLap } from './leaderboard.js';
import { CARS, ROLL_DRAG, AIR_DRAG, createGarage, prizeFor, rivalLook, terminalSpeed } from './garage.js';

const LAPS = 3;
const WHEELBASE = 2.6;
const WHEEL_RADIUS = 0.33;
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

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 4000);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
  type: THREE.HalfFloatType,
  samples: 4,
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

const SUN_AZIMUTH = THREE.MathUtils.degToRad(112);
const skySun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 4), SUN_AZIMUTH);
// The key light sits a little higher than the visible sun so shadows stay readable.
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 13), SUN_AZIMUTH);

const sky = new Sky();
sky.scale.setScalar(3500);
Object.assign(sky.material.uniforms.turbidity, { value: 10 });
Object.assign(sky.material.uniforms.rayleigh, { value: 3 });
Object.assign(sky.material.uniforms.mieCoefficient, { value: 0.005 });
Object.assign(sky.material.uniforms.mieDirectionalG, { value: 0.75 });
sky.material.uniforms.sunPosition.value.copy(skySun);

// Bake the sky into an environment map so paint and glass reflect the sunset.
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(sky);
scene.environment = pmrem.fromScene(envScene).texture;
scene.add(sky);

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
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0x9db4ff, 0x4a3b2c, 0.7));

// ---------------------------------------------------------------- world

const track = buildTrack(scene, renderer);
const { pts, tan, nrm, N, DS, speedProfile } = track;

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
const carbon = new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.6, roughness: 0.38 });

function styleCar(model) {
  // One set per car, so each can be painted independently.
  const mats = {
    body: new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.5, clearcoat: 1, clearcoatRoughness: 0.03 }),
    rims: new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.4 }),
    caliper: new THREE.MeshStandardMaterial({ metalness: 0.5, roughness: 0.45 }),
    interior: new THREE.MeshStandardMaterial({ roughness: 0.7 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0c0f14, metalness: 1, roughness: 0.04, transparent: true, opacity: 0.72 }),
  };
  const trim = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.45 });
  const set = (name, mat) => { const o = model.getObjectByName(name); if (o && o.isMesh) o.material = mat; };

  set('body', mats.body);
  for (const n of ['rim_fl', 'rim_fr', 'rim_rr', 'rim_rl']) set(n, mats.rims);
  set('trim', trim);
  set('glass', mats.glass);
  for (const n of ['leather', 'steering_leather']) set(n, mats.interior);

  let tail = null;
  const tailMesh = model.getObjectByName('lights_red');
  if (tailMesh && tailMesh.isMesh) {
    tail = tailMesh.material = tailMesh.material.clone();
    tail.emissive = new THREE.Color(0xff1408);
  }
  const head = model.getObjectByName('lights');
  if (head && head.isMesh) {
    head.material = head.material.clone();
    head.material.emissive = new THREE.Color(0xfff2d8);
    head.material.emissiveIntensity = 2.5;
  }

  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    if (/^brake(_\d+)?$/.test(o.name)) o.material = mats.caliper;
  });

  const wheels = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map((n) => model.getObjectByName(n)).filter(Boolean);
  for (const w of wheels) w.rotation.order = 'YXZ';
  return { wheels, tail, mats };
}

// Bolt-on aero that marks out the higher-tier cars. Sized from the body's bounding box.
function buildKit(box) {
  const rear = box.min.z, front = box.max.z, halfW = (box.max.x - box.min.x) / 2, deck = box.max.y * 0.76;
  const part = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), carbon);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  };
  const lip = part(1.4, 0.04, 0.24, 0, deck + 0.04, rear + 0.3);
  lip.rotation.x = 0.3;
  const wing = new THREE.Group();
  wing.add(part(1.72, 0.035, 0.38, 0, 0.3, 0), part(0.03, 0.17, 0.44, 0.87, 0.3, 0), part(0.03, 0.17, 0.44, -0.87, 0.3, 0));
  wing.add(part(0.04, 0.3, 0.2, 0.48, 0.15, 0.02), part(0.04, 0.3, 0.2, -0.48, 0.15, 0.02));
  wing.position.set(0, deck, rear + 0.48);
  const splitter = part(halfW * 1.7, 0.03, 0.45, 0, 0.11, front - 0.34);
  const skirts = new THREE.Group();
  skirts.add(part(0.1, 0.05, 1.75, halfW - 0.06, 0.12, -0.17), part(0.1, 0.05, 1.75, 0.06 - halfW, 0.12, -0.17));
  return { lip, wing, splitter, skirts };
}

function applyKit(car, tier) {
  const { lip, wing, splitter, skirts } = car.kit;
  lip.visible = tier === 1;
  wing.visible = tier >= 2;
  wing.scale.set(tier >= 4 ? 1.06 : 1, tier >= 4 ? 1.25 : 1, tier >= 4 ? 1.15 : 1);
  splitter.visible = skirts.visible = tier >= 3;
}

function applyLook(car, look) {
  const { body, rims, caliper, interior, glass } = car.mats;
  body.color.setHex(look.paint);
  body.metalness = look.finish.metalness;
  body.roughness = look.finish.roughness;
  body.clearcoat = look.finish.clearcoat;
  body.clearcoatRoughness = look.finish.clearcoatRoughness;
  rims.color.setHex(look.rims);
  caliper.color.setHex(look.caliper);
  interior.color.setHex(look.interior);
  glass.opacity = look.tint;
  car.glow.visible = look.glow != null;
  if (look.glow != null) car.glow.material.color.setHex(look.glow).multiplyScalar(1.6);
  car.color = look.paint;
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

// Used only if the GLB can't be fetched, so the game still runs.
function fallbackCarModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.4), new THREE.MeshStandardMaterial());
  body.name = 'body';
  body.position.y = 0.55;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 2), new THREE.MeshStandardMaterial());
  cabin.name = 'glass';
  cabin.position.set(0, 1.02, -0.3);
  g.add(body, cabin);
  const tire = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.28, 20).rotateZ(Math.PI / 2);
  const rubber = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  for (const [n, x, z] of [['wheel_fl', 0.9, 1.4], ['wheel_fr', -0.9, 1.4], ['wheel_rl', 0.9, -1.4], ['wheel_rr', -0.9, -1.4]]) {
    const w = new THREE.Mesh(tire, rubber);
    w.name = n;
    w.position.set(x, WHEEL_RADIUS, z);
    g.add(w);
  }
  return g;
}

function makeCar(template) {
  const model = template.clone(true);
  const { wheels, tail, mats } = styleCar(model);
  model.rotation.y = Math.PI;      // the GLB faces -z; the game treats +z as forward
  const tilt = new THREE.Group();  // body roll and pitch
  const root = new THREE.Group();
  tilt.add(model);
  const kit = buildKit(new THREE.Box3().setFromObject(tilt));
  tilt.add(...Object.values(kit));
  const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
    map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.position.y = 0.05;
  root.add(tilt, glow);
  scene.add(root);
  return {
    root, tilt, wheels, tail, mats, kit, glow, color: 0xffffff,
    x: 0, z: 0, heading: 0, vx: 0, vz: 0, speed: 0,
    steer: 0, spin: 0, roll: 0, pitch: 0,
    idx: 0, lat: 0, prog: 0, laps: 0,
    offset: 0, skill: 1, baseSkill: 1,
  };
}

function placeOnGrid(car, slot, offset) {
  const k = wrap(-slot * 5);
  car.idx = k;
  car.offset = car.lat = offset;
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
  car.spin += (car.speed * dt) / WHEEL_RADIUS;
  car.wheels.forEach((w, i) => {
    w.rotation.x = -car.spin;
    if (i < 2) w.rotation.y = car.steer * 0.45;
  });
  if (car.tail) car.tail.emissiveIntensity = braking ? 7 : 1.2;
}

// ---------------------------------------------------------------- input

const input = { up: false, down: false, left: false, right: false, hand: false };
const KEYS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'hand',
};
const typing = () => document.activeElement === $('name');

addEventListener('keydown', (e) => {
  if (typing()) { if (e.code === 'Enter') startRace(); return; }
  if (state === 'garage') {
    if (e.code === 'ArrowLeft') garage.step(-1);
    else if (e.code === 'ArrowRight') garage.step(1);
    else if (e.code === 'Escape') closeGarage();
    return;
  }
  if (KEYS[e.code]) { input[KEYS[e.code]] = true; e.preventDefault(); }
  else if (e.code === 'KeyC' && !e.repeat) camMode = (camMode + 1) % 2;
  else if (e.code === 'KeyR' && !e.repeat && state !== 'loading') startRace();
  else if (e.code === 'KeyM' && !e.repeat) audio.toggleMute();
  else if (e.code === 'Enter' && (state === 'menu' || state === 'finished')) startRace();
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

const audio = {
  ctx: null, muted: false,
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.oscA = ctx.createOscillator(); this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator(); this.oscB.type = 'square';
    const subGain = ctx.createGain(); subGain.gain.value = 0.5;
    this.oscA.connect(this.filter);
    this.oscB.connect(subGain).connect(this.filter);
    this.filter.connect(this.master).connect(ctx.destination);
    this.oscA.start(); this.oscB.start();
  },
  update(speed, throttle, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const r = clamp(Math.abs(speed) / spec.top, 0, 1) * 5;
    const gear = Math.min(4, Math.floor(r));
    const rpm = 0.25 + 0.75 * clamp(r - gear, 0, 1);
    const f = 45 + rpm * 150;
    this.oscA.frequency.setTargetAtTime(f, t, 0.04);
    this.oscB.frequency.setTargetAtTime(f / 2, t, 0.04);
    this.filter.frequency.setTargetAtTime(350 + rpm * 1400 + throttle * 700, t, 0.05);
    this.master.gain.setTargetAtTime(active && !this.muted ? 0.05 + throttle * 0.05 : 0, t, 0.08);
  },
  toggleMute() { this.muted = !this.muted; },
};

// ---------------------------------------------------------------- game state

let state = 'loading';          // loading | menu | garage | countdown | race | finished
let camMode = 0;                // 0 chase, 1 bonnet
let player, rivals = [], cars = [];
let garage;
let spec = CARS[0], tier = 0;                 // the car the player races, and how far up the range it is
const rivalPace = { corner: 1, top: 70 };     // rivals scale with the player's car
let raceClock = 0, lapStart = 0, lastLap = null, raceBest = null, countdown = 0;
let allTimeBest = Number(localStorage.getItem('sc_best')) || null;

const hud = {
  root: $('hud'), pos: $('hud-pos'), lap: $('hud-lap'), time: $('hud-time'),
  last: $('hud-last'), best: $('hud-best'), speed: $('hud-speed'), banner: $('banner'),
};
const overlay = $('overlay'), menu = $('menu'), results = $('results'), sub = $('overlay-sub');
const MENU_TEXT = `${LAPS} laps · 3 rivals · ${(track.length / 1000).toFixed(1)} km of sunset tarmac.`;
const nameInput = $('name');
nameInput.value = localStorage.getItem('sc_name') || '';

function resetGrid() {
  rivals.forEach((r, i) => placeOnGrid(r, i + 1, [3, -3, 3][i]));
  placeOnGrid(player, 4, -3);
  camPos.set(0, 0, 0);
}

function startRace() {
  if (state === 'loading' || state === 'countdown' || state === 'garage') return;
  localStorage.setItem('sc_name', nameInput.value.trim());
  nameInput.blur();
  audio.start();
  resetGrid();
  raceClock = lapStart = 0;
  lastLap = raceBest = null;
  countdown = TEST ? 0.01 : 3.6;
  state = 'countdown';
  overlay.hidden = true;
  hud.root.hidden = false;
  touchUI.hidden = !isTouch;
  hud.last.textContent = fmt(null);
  hud.best.textContent = fmt(allTimeBest);
}

function finishRace() {
  state = 'finished';
  hud.root.hidden = true;
  for (const k in input) input[k] = false;
  const place = standing();
  const suffix = ['st', 'nd', 'rd', 'th'][place - 1];
  results.replaceChildren();
  const placeEl = document.createElement('div');
  placeEl.className = 'place';
  placeEl.textContent = `${place}${suffix} place`;
  const dl = document.createElement('dl');
  const prize = prizeFor(place, tier);
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
  overlay.hidden = false;
  touchUI.hidden = true;

  const name = nameInput.value.trim();
  if (name && raceBest && !TEST) submitLap(name, raceBest).then(refreshBoard);
}

function showWallet() {
  $('wallet').textContent = `${garage.format(garage.credits)} · ${spec.name}`;
}

// Puts the selected car, its paint job and matching rivals on track.
function applySelection() {
  const sel = garage.selected();
  spec = sel.car;
  tier = sel.tier;
  applyKit(player, tier);
  applyLook(player, sel.look);
  rivalPace.corner = Math.sqrt(spec.grip / CARS[0].grip);
  rivalPace.top = terminalSpeed(spec) * 0.97;
  for (const r of rivals) {
    applyKit(r, tier);
    r.skill = r.baseSkill + 0.012 * tier;
  }
  showWallet();
}

function openGarage() {
  if (state !== 'menu' && state !== 'finished') return;
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
  sub.textContent = MENU_TEXT;
  $('start').textContent = 'START RACE';
  overlay.hidden = false;
}

function standing() {
  return 1 + rivals.filter((r) => r.prog > player.prog).length;
}

async function refreshBoard() {
  const list = $('board-list');
  const rows = await fetchBoard();
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
  vL = (wx * fz - wz * fx) * Math.exp(-(hand ? 1.8 : onGrass ? 4 : 9) * dt);
  p.vx = fx * vF + fz * vL;
  p.vz = fz * vF - fx * vL;
  p.x += p.vx * dt;
  p.z += p.vz * dt;
  p.speed = vF;

  // Rivals are solid.
  for (const r of rivals) {
    const dx = p.x - r.x, dz = p.z - r.z;
    const d = Math.hypot(dx, dz);
    if (d < CAR_RADIUS && d > 1e-3) {
      const push = (CAR_RADIUS - d) / d;
      p.x += dx * push; p.z += dz * push;
      p.vx *= 0.985; p.vz *= 0.985;
      r.speed *= 0.99;
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
      const scrub = Math.exp(-1.5 * dt) * (vn > 4 ? 0.8 : 1);
      p.vx *= scrub; p.vz *= scrub;
    }
    p.lat = s * limit;
  }
  p.prog += wrapDiff(p.idx - prev);

  p.roll += (clamp(yaw * vF * 0.0028, -0.07, 0.07) - p.roll) * Math.min(1, dt * 6);
  p.pitch += (clamp(-a * 0.0016, -0.04, 0.04) - p.pitch) * Math.min(1, dt * 6);
  syncCar(p, dt, brake && vF > 1);

  if (live) {
    const done = Math.floor(p.prog / N);
    if (done > p.laps) {
      p.laps = done;
      lastLap = (raceClock - lapStart) * 1000;
      lapStart = raceClock;
      if (!raceBest || lastLap < raceBest) raceBest = lastLap;
      if (!allTimeBest || lastLap < allTimeBest) {
        allTimeBest = lastLap;
        localStorage.setItem('sc_best', String(Math.round(lastLap)));
      }
      hud.last.textContent = fmt(lastLap);
      hud.best.textContent = fmt(allTimeBest);
      if (p.laps >= LAPS) finishRace();
    }
  }
  return throttle;
}

function updateRival(r, dt, live) {
  const i = wrap(Math.floor(r.prog));
  let target = live ? Math.min(speedProfile[wrap(i + 2)] * r.skill * rivalPace.corner, rivalPace.top) : 0;
  if (r.laps >= LAPS) target = Math.min(target, 22);
  const braking = r.speed > target + 0.5;
  r.speed += clamp(target - r.speed, -spec.brake * 0.8 * dt, spec.accel * 0.92 * (1 - r.speed / spec.top) * dt);
  r.prog += (r.speed * dt) / DS;
  r.laps = Math.max(r.laps, Math.floor(r.prog / N));

  const f = r.prog - Math.floor(r.prog);
  const a = wrap(Math.floor(r.prog)), b = wrap(a + 1);
  const nx = nrm[a].x + (nrm[b].x - nrm[a].x) * f, nz = nrm[a].z + (nrm[b].z - nrm[a].z) * f;
  r.x = pts[a].x + (pts[b].x - pts[a].x) * f + nx * r.offset;
  r.z = pts[a].z + (pts[b].z - pts[a].z) * f + nz * r.offset;
  const tx = tan[a].x + (tan[b].x - tan[a].x) * f, tz = tan[a].z + (tan[b].z - tan[a].z) * f;
  const heading = Math.atan2(tx, tz);
  let dh = heading - r.heading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  r.steer = clamp(dh / Math.max(dt, 1e-3) * 0.6, -1, 1);
  r.heading = heading;
  syncCar(r, dt, braking && live);
}

// ---------------------------------------------------------------- camera

const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
let camHeading = 0;
let menuAngle = 0;

function updateCamera(dt) {
  const p = player;
  if (state === 'menu' || state === 'finished' || state === 'garage') {
    menuAngle += dt * 0.18;
    const sx = Math.sin(menuAngle), cz = Math.cos(menuAngle);
    // Aim to the car's side so it sits clear of the menu panel on wide screens.
    const shift = innerWidth > 720 ? 1.7 : 0;
    camera.position.set(p.x + sx * 7.5, 1.7, p.z + cz * 7.5);
    camera.lookAt(p.x - cz * shift, 0.7, p.z + sx * shift);
    camera.fov += (42 - camera.fov) * Math.min(1, dt * 4);
    camera.updateProjectionMatrix();
    return;
  }
  const speedK = clamp(Math.abs(p.speed) / spec.top, 0, 1);
  if (camMode === 1) {
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    camera.position.set(p.x + fx * 0.35, 1.08, p.z + fz * 0.35);
    camera.lookAt(p.x + fx * 20, 0.9, p.z + fz * 20);
    camPos.set(0, 0, 0);
  } else {
    let dh = p.heading - camHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const fresh = camPos.lengthSq() === 0;
    camHeading = fresh ? p.heading : camHeading + dh * Math.min(1, dt * 5);
    const fx = Math.sin(camHeading), fz = Math.cos(camHeading);
    const back = 6.6 + speedK * 1.6;
    camPos.set(p.x - fx * back, 2.35 + speedK * 0.25, p.z - fz * back);
    camera.position.copy(camPos);
    camLook.set(p.x + fx * 6, 0.9, p.z + fz * 6);
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
const mapXf = (() => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const s = (mini.width - 36) / Math.max(maxX - minX, maxZ - minZ);
  const ox = (mini.width - (maxX - minX) * s) / 2 - minX * s;
  const oz = (mini.height - (maxZ - minZ) * s) / 2 - minZ * s;
  return (x, z) => [x * s + ox, z * s + oz];
})();
{
  const c = mapBase.getContext('2d');
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
  cars.forEach((car) => {
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
  const dt = Math.min(clock.getDelta(), 1 / 20);
  let throttle = 0;

  if (state === 'countdown') {
    countdown -= dt;
    const n = Math.ceil(countdown - 0.6);
    hud.banner.hidden = false;
    hud.banner.textContent = n > 0 ? n : 'GO!';
    if (countdown <= 0.6 && state === 'countdown') state = 'race';
  } else if (state === 'race') {
    raceClock += dt;
    if (!hud.banner.hidden && (countdown -= dt) <= 0) hud.banner.hidden = true;
  }

  if (state !== 'loading') {
    const live = state === 'race';
    // Two substeps keep wall and car contacts stable at top speed.
    for (let i = 0; i < 2; i++) throttle = updatePlayer(dt / 2, live && state === 'race');
    for (const r of rivals) updateRival(r, dt, live || state === 'finished');
    updateCamera(dt);
    audio.update(player.speed, throttle, state === 'race' || state === 'countdown');

    sun.target.position.set(player.x, 0, player.z);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 180);
    sky.position.copy(camera.position);

    if (!hud.root.hidden && (hudTick = (hudTick + 1) % 3) === 0) {
      hud.speed.textContent = Math.round(Math.abs(player.speed) * 3.6);
      hud.pos.textContent = standing();
      hud.lap.textContent = Math.min(LAPS, player.laps + 1);
      hud.time.textContent = fmt((raceClock - lapStart) * 1000);
      drawMinimap();
    }
  }

  composer.render(dt);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot

async function loadCarTemplate() {
  try {
    const draco = new DRACOLoader().setDecoderPath(DRACO_PATH);
    const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync('assets/ferrari.glb');
    return gltf.scene.children[0] || gltf.scene;
  } catch (err) {
    console.warn('Car model failed to load, using fallback.', err);
    return fallbackCarModel();
  }
}

async function boot() {
  const template = await loadCarTemplate();
  rivals = [0.9, 0.86, 0.82].map((baseSkill, i) => {
    const car = Object.assign(makeCar(template), { baseSkill });
    applyLook(car, rivalLook(RIVAL_COLORS[i]));
    return car;
  });
  player = makeCar(template);
  cars = [player, ...rivals];
  garage = createGarage({ onPreview: (previewTier, look) => { applyKit(player, previewTier); applyLook(player, look); } });
  applySelection();
  resetGrid();

  state = 'menu';
  sub.textContent = MENU_TEXT;
  menu.hidden = false;
  $('start').addEventListener('click', startRace);
  $('open-garage').addEventListener('click', openGarage);
  $('g-back').addEventListener('click', closeGarage);
  refreshBoard();
  if (TEST) startRace();
}

window.__game = { get state() { return state; }, get garage() { return garage; }, get player() { return player; }, get rivals() { return rivals; }, get clock() { return raceClock; } };

requestAnimationFrame(frame);
boot();
