// Car catalogue, the player's saved progress (credits, owned cars, paint jobs),
// and the garage screen where cars are bought, selected and customised.
// Progress lives in localStorage, so it is per browser.

// Resistance terms shared with the physics in main.js.
export const ROLL_DRAG = 0.5;
export const AIR_DRAG = 0.0007;

// Ordered by tier. top = m/s the engine pulls toward, accel/grip/brake = m/s^2.
// `mats` names the materials in each model file that the garage is allowed to recolour;
// a car without an entry for a part simply doesn't offer that option.
export const CARS = [
  {
    id: 'strada', name: 'Nissan GT-R', file: 'assets/cars/gtr.glb', price: 0, top: 78, accel: 15, grip: 25, brake: 32, paint: 9,
    mats: { paint: ['r35_paint'], rims: ['r35_wheel_05a'], caliper: ['amdb11_caliper.002'], interior: ['r35_leather'], glass: ['r35_glass', 'r35_glass.001'], tail: ['r35_taillight_2017'] },
  },
  {
    id: 'veloce', name: 'Ferrari 458', file: 'assets/cars/ferrari.glb', price: 1200, top: 81, accel: 16, grip: 26.2, brake: 34, paint: 0,
    mats: { paint: ['Body_Color'], rims: ['metal_gray'], interior: ['Leather'], glass: ['Glass_Gray'], tail: ['Taillight_Glass'] },
  },
  {
    id: 'corsa', name: 'Porsche 911 GT3 RS', file: 'assets/cars/gt3rs.glb', price: 3000, top: 84, accel: 17, grip: 27.4, brake: 36, paint: 8,
    mats: { paint: ['lens_3'], rims: ['lens_16'], caliper: ['lens_20'], glass: ['lens_8', 'lens_59', 'lens_77'] },
  },
  {
    id: 'furia', name: 'Lamborghini Huracán EVO', file: 'assets/cars/huracan.glb', price: 6000, top: 87, accel: 18, grip: 28.6, brake: 38, paint: 1,
    mats: { paint: ['Huracan_EVO_Paint'], rims: ['Gloss_Black', 'Chrome'], caliper: ['Caliper_Color'], interior: ['Meshesleatherdarkdif1_diff'], glass: ['Glass_Parts'], tail: ['Red_Glass'] },
  },
  {
    id: 'apex', name: 'McLaren Spider', file: 'assets/cars/mclaren.glb', price: 10000, top: 90, accel: 19, grip: 29.8, brake: 40, paint: 5,
    mats: { paint: ['Primary_Paint'], rims: ['Wheel_1A'], interior: ['Suede_BMP'], glass: ['Glass_Full'], tail: ['Brake_Light'] },
  },
];

const FINISHES = [
  { name: 'Gloss', metalness: 0.1, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.03 },
  { name: 'Metallic', metalness: 1, roughness: 0.5, clearcoat: 1, clearcoatRoughness: 0.03 },
  { name: 'Matte', metalness: 0.3, roughness: 0.8, clearcoat: 0, clearcoatRoughness: 0 },
  { name: 'Chrome', metalness: 1, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0 },
];
const TINTS = [{ name: 'Light', opacity: 0.45 }, { name: 'Dark', opacity: 0.72 }, { name: 'Limo', opacity: 0.94 }];

const OPTIONS = [
  { key: 'paint', label: 'Paint', colors: [0xc8102e, 0xff5a1f, 0xf2c200, 0x2bb54a, 0x0f6b4f, 0x1463ff, 0x0b1f4d, 0x7a2bd6, 0xe9edf2, 0x8a8f98, 0x101114, 0xff4fa3] },
  { key: 'finish', label: 'Finish', names: FINISHES.map((f) => f.name) },
  { key: 'rims', label: 'Rims', part: 'rims', names: ['Stock'], colors: [0xffffff, 0x6b7078, 0x0c0c0e, 0xc9a24a, 0x8a5a33, 0xc8102e, 0x1463ff] },
  { key: 'caliper', label: 'Brakes', part: 'caliper', names: ['Stock'], colors: [ 0xd11a1a, 0xf2c200, 0x1463ff, 0x2bb54a, 0xff7a1f] },
  { key: 'interior', label: 'Interior', part: 'interior', names: ['Stock'], colors: [0x28282b, 0xb08a5a, 0x7a1c1c, 0xd9cfbd, 0x1d2f55] },
  { key: 'tint', label: 'Windows', part: 'glass', names: TINTS.map((t) => t.name) },
  { key: 'glow', label: 'Underglow', names: ['Off'], colors: [0x2ad4ff, 0xff2bd6, 0x39ff6a, 0xff7a1f, 0xffffff, 0x8a4dff] },
];
const colorsOf = (key) => OPTIONS.find((o) => o.key === key).colors;
const DEFAULT_LOOK = { paint: 0, finish: 1, rims: 0, caliper: 0, interior: 0, tint: 1, glow: 0 };

const PRIZES = [1000, 400, 200, 100];
// Prizes are quoted for a three-lap race and scale with distance, so short races can't be farmed.
export const prizeFor = (place, tier, laps) => Math.round(PRIZES[place - 1] * (1 + 0.25 * tier) * laps / 3);

// Speed where engine pull and drag balance: what the car actually reaches on a long straight.
export function terminalSpeed(car) {
  const b = car.accel / car.top;
  return (-b + Math.sqrt(b * b + 4 * AIR_DRAG * (car.accel - ROLL_DRAG))) / (2 * AIR_DRAG);
}

// Turns saved option indices into the values the renderer needs.
function resolveLook(look) {
  return {
    paint: colorsOf('paint')[look.paint],
    finish: FINISHES[look.finish],
    rims: look.rims ? colorsOf('rims')[look.rims - 1] : null,
    caliper: look.caliper ? colorsOf('caliper')[look.caliper - 1] : null,
    interior: look.interior ? colorsOf('interior')[look.interior - 1] : null,
    tint: TINTS[look.tint].opacity,
    glow: look.glow ? colorsOf('glow')[look.glow - 1] : null,
  };
}

export const rivalLook = (paint) => ({ ...resolveLook(DEFAULT_LOOK), paint });

const SAVE_KEY = 'sc_save';

function loadSave() {
  const save = { credits: 0, owned: [CARS[0].id], selected: CARS[0].id, looks: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (raw && typeof raw === 'object') {
      if (Number.isFinite(raw.credits)) save.credits = Math.max(0, raw.credits);
      if (Array.isArray(raw.owned)) for (const id of raw.owned) if (CARS.some((c) => c.id === id) && !save.owned.includes(id)) save.owned.push(id);
      if (save.owned.includes(raw.selected)) save.selected = raw.selected;
      if (raw.looks && typeof raw.looks === 'object') save.looks = raw.looks;
    }
  } catch { /* corrupt or blocked storage: start fresh */ }
  return save;
}

const cr = (n) => `${Math.round(n).toLocaleString('en-US')} CR`;
const css = (hex) => '#' + hex.toString(16).padStart(6, '0');

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function createGarage({ onPreview }) {
  const save = loadSave();
  const $ = (id) => document.getElementById(id);
  const ui = {
    root: $('garage'), credits: $('g-credits'), name: $('g-name'), tag: $('g-tag'),
    stats: $('g-stats'), action: $('g-action'), custom: $('g-custom'),
  };
  let view = CARS.findIndex((c) => c.id === save.selected);

  const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* storage blocked */ } };
  const selectedTier = () => CARS.findIndex((c) => c.id === save.selected);
  const owns = (tier) => save.owned.includes(CARS[tier].id);

  function lookOf(tier) {
    const car = CARS[tier];
    const look = { ...DEFAULT_LOOK, paint: car.paint, ...save.looks[car.id] };
    for (const opt of OPTIONS) {
      const count = (opt.names?.length || 0) + (opt.colors?.length || 0);
      if (!Number.isInteger(look[opt.key]) || look[opt.key] < 0 || look[opt.key] >= count) look[opt.key] = DEFAULT_LOOK[opt.key];
    }
    return look;
  }

  const STATS = [
    { label: 'Top speed', unit: 'km/h', value: (c) => terminalSpeed(c) * 3.6, digits: 0 },
    { label: 'Acceleration', unit: 'm/s²', value: (c) => c.accel, digits: 1 },
    { label: 'Handling', unit: 'g', value: (c) => c.grip / 9.81, digits: 2 },
    { label: 'Braking', unit: 'g', value: (c) => c.brake / 9.81, digits: 2 },
  ];

  function renderStats(car) {
    const current = CARS[selectedTier()];
    const best = CARS[CARS.length - 1];
    ui.stats.replaceChildren();
    for (const stat of STATS) {
      const v = stat.value(car), base = stat.value(current);
      const row = make('div', 'stat-row');
      const head = make('div', 'stat-head');
      const val = make('span', 'stat-val', `${v.toFixed(stat.digits)} ${stat.unit}`);
      const diff = v - base;
      if (Math.abs(diff) >= 0.5 * 10 ** -stat.digits) {
        val.append(make('span', diff > 0 ? 'up' : 'down', ` ${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(stat.digits)}`));
      }
      head.append(make('span', null, stat.label), val);
      const bar = make('div', 'bar');
      const fill = make('i');
      fill.style.width = `${(v / stat.value(best)) * 100}%`;
      bar.append(fill);
      row.append(head, bar);
      ui.stats.append(row);
    }
  }

  function renderCustom(tier) {
    ui.custom.replaceChildren();
    if (!owns(tier)) return;
    const look = lookOf(tier);
    for (const opt of OPTIONS) {
      if (opt.part && !CARS[tier].mats[opt.part]) continue;
      const row = make('div', 'opt-row');
      row.append(make('span', 'opt-label', opt.label));
      const choices = make('div', 'choices');
      const add = (index, node) => {
        node.type = 'button';
        if (look[opt.key] === index) node.classList.add('on');
        node.addEventListener('click', () => {
          save.looks[CARS[tier].id] = { ...look, [opt.key]: index };
          persist();
          render();
        });
        choices.append(node);
      };
      (opt.names || []).forEach((name, i) => add(i, make('button', 'chip', name)));
      (opt.colors || []).forEach((hex, i) => {
        const swatch = make('button', 'swatch');
        swatch.style.background = css(hex);
        swatch.setAttribute('aria-label', `${opt.label} ${css(hex)}`);
        add(i + (opt.names?.length || 0), swatch);
      });
      row.append(choices);
      ui.custom.append(row);
    }
  }

  function render() {
    const car = CARS[view];
    ui.credits.textContent = cr(save.credits);
    ui.name.textContent = car.name;
    ui.tag.textContent = `Car ${view + 1} of ${CARS.length} · ${view === 0 ? 'Starter' : cr(car.price)} · Rivals level ${view + 1}`;
    renderStats(car);

    const btn = ui.action;
    btn.disabled = false;
    if (view === selectedTier()) { btn.textContent = 'SELECTED'; btn.disabled = true; }
    else if (owns(view)) btn.textContent = 'SELECT THIS CAR';
    else if (save.credits >= car.price) btn.textContent = `BUY · ${cr(car.price)}`;
    else { btn.textContent = `NEED ${cr(car.price - save.credits)} MORE`; btn.disabled = true; }

    renderCustom(view);
    ui.root.classList.add('busy');
    const shown = view;
    Promise.resolve(onPreview(view, resolveLook(lookOf(view)))).finally(() => {
      if (shown === view) ui.root.classList.remove('busy');
    });
  }

  ui.action.addEventListener('click', () => {
    const car = CARS[view];
    if (!owns(view)) {
      if (save.credits < car.price) return;
      save.credits -= car.price;
      save.owned.push(car.id);
    }
    save.selected = car.id;
    persist();
    render();
  });

  const garage = {
    get credits() { return save.credits; },
    get isOpen() { return !ui.root.hidden; },
    selected() {
      const tier = selectedTier();
      return { tier, car: CARS[tier], look: resolveLook(lookOf(tier)) };
    },
    addCredits(n) { save.credits += n; persist(); },
    step(d) { view = (view + d + CARS.length) % CARS.length; render(); },
    open() { view = selectedTier(); ui.root.hidden = false; render(); },
    close() { ui.root.hidden = true; },
    format: cr,
  };
  $('g-prev').addEventListener('click', () => garage.step(-1));
  $('g-next').addEventListener('click', () => garage.step(1));
  return garage;
}
