// Car catalogue, the player's saved progress (credits, owned cars, paint jobs),
// and the garage screen where cars are bought, selected and customised.
// Progress is kept in localStorage, and mirrored to the player's account when signed in.

// Resistance terms shared with the physics in main.js.
export const ROLL_DRAG = 0.5;
export const AIR_DRAG = 0.0007;

// Stats come from a car's level: 0 is the starter, 1 the fastest car money can buy.
// top = m/s the engine pulls toward, accel/grip/brake = m/s^2.
const stats = (level) => ({ level, top: 78 + 12 * level, accel: 15 + 4 * level, grip: 25 + 4.8 * level, brake: 32 + 8 * level });

// Ordered slowest to fastest. `mats` names the materials in each model that the garage may
// recolour; a car without an entry for a part simply doesn't offer that option.
// `file` is a GLB in the shared layout (see tools/build-car.mjs). `engine` shapes the synthesised
// engine note in main.js: cylinder count, redline, and how much burble, scream and turbo whistle.
export const CARS = [
  {
    id: 'evo', engine: { cyl: 4, redline: 7000, burble: 0.35, scream: 0.15, turbo: 1 },
    name: 'Mitsubishi Lancer Evo X', file: 'assets/cars/evo.glb', price: 0, paint: 5, ...stats(0),
    mats: { paint: ['material_0'], rims: ['material_18'], glass: ['material_34', 'material_30'] },
  },
  {
    id: 'm4', engine: { cyl: 6, redline: 7200, burble: 0.3, scream: 0.3, turbo: 1 },
    name: 'BMW M4', file: 'assets/cars/m4.glb', price: 700, paint: 6, ...stats(0.125),
    mats: { paint: ['Material_692'], rims: ['Material_753'], caliper: ['Material_773'], glass: ['Material_775', 'Material_699'] },
  },
  {
    id: 'strada', engine: { cyl: 6, redline: 7000, burble: 0.35, scream: 0.25, turbo: 1 },
    name: 'Nissan GT-R', file: 'assets/cars/gtr.glb', price: 1500, paint: 9, ...stats(0.25),
    mats: { paint: ['r35_paint'], rims: ['r35_wheel_05a'], caliper: ['amdb11_caliper.002'], interior: ['r35_leather'], glass: ['r35_glass', 'r35_glass.001'], tail: ['r35_taillight_2017'] },
  },
  {
    id: 'c8', engine: { cyl: 8, redline: 6500, burble: 0.9, scream: 0.1, turbo: 0 },
    name: 'Chevrolet Corvette C8', file: 'assets/cars/c8.glb', price: 2500, paint: 2, ...stats(0.375),
    mats: { paint: ['Body_Color'], rims: ['material'], glass: ['Windshield', 'Other_Glasses_than_Windshield'] },
  },
  {
    id: 'veloce', engine: { cyl: 8, redline: 9000, burble: 0.2, scream: 0.6, turbo: 0 },
    name: 'Ferrari 458', file: 'assets/cars/ferrari.glb', price: 4000, paint: 0, ...stats(0.5),
    mats: { paint: ['Body_Color'], rims: ['metal_gray'], interior: ['Leather'], glass: ['Glass_Gray'], tail: ['Taillight_Glass'] },
  },
  {
    id: 'corsa', engine: { cyl: 6, redline: 9000, burble: 0.2, scream: 0.55, turbo: 0 },
    name: 'Porsche 911 GT3 RS', file: 'assets/cars/gt3rs.glb', price: 6000, paint: 8, ...stats(0.625),
    mats: { paint: ['lens_3'], rims: ['lens_16'], caliper: ['lens_20'], glass: ['lens_8', 'lens_59', 'lens_77'] },
  },
  {
    id: 'furia', engine: { cyl: 10, redline: 8500, burble: 0.25, scream: 0.6, turbo: 0 },
    name: 'Lamborghini Huracán EVO', file: 'assets/cars/huracan.glb', price: 8500, paint: 1, ...stats(0.75),
    mats: { paint: ['Huracan_EVO_Paint'], rims: ['Gloss_Black', 'Chrome'], caliper: ['Caliper_Color'], interior: ['Meshesleatherdarkdif1_diff'], glass: ['Glass_Parts'], tail: ['Red_Glass'] },
  },
  {
    id: 'apex', engine: { cyl: 8, redline: 8500, burble: 0.3, scream: 0.45, turbo: 1 },
    name: 'McLaren Spider', file: 'assets/cars/mclaren.glb', price: 11500, paint: 7, ...stats(0.875),
    mats: { paint: ['Primary_Paint'], rims: ['Wheel_1A'], interior: ['Suede_BMP'], glass: ['Glass_Full'], tail: ['Brake_Light'] },
  },
  {
    id: 'veyron', engine: { cyl: 16, redline: 6500, burble: 0.6, scream: 0.2, turbo: 1 },
    name: 'Bugatti Veyron', file: 'assets/cars/veyron.glb', price: 15000, paint: 0, ...stats(1),
    mats: { paint: ['secondary'], rims: ['wheel_rf.1'], glass: ['glass.001'] },
  },
  {
    // Granted to one account by name in the database (players.special_cars); nobody else sees it.
    id: 'connor', engine: { cyl: 12, redline: 6500, burble: 0.35, scream: 0.5, turbo: 1 },
    name: "Connor's Car", file: 'assets/cars/huayra.glb', special: true, price: 0, paint: 7,
    level: 1.2, top: 102, accel: 24, grip: 35, brake: 50,
    mats: { paint: ['PAG_HUAYRA_PAINT'], rims: ['pag_wheels_b'], caliper: ['amdb11_caliper.002'], interior: ['PAG_HUAYRA_LEATHER'], glass: ['pag_glass'], tail: ['pag_taillight_L'] },
  },
  {
    // Not for sale: only developer accounts see it. White paint leaves its livery untouched.
    id: 'f1', engine: { cyl: 6, redline: 12000, burble: 0.15, scream: 0.7, turbo: 1 },
    name: 'McLaren MCL35M F1', file: 'assets/cars/f1.glb', devOnly: true, price: 0, paint: 8, finish: 0,
    level: 1.3, top: 104, accel: 26, grip: 37, brake: 52,
    mats: { paint: ['mcl35m_c_png', 'mcl35m_png'], rims: ['rim_png'] },
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
  { key: 'caliper', label: 'Brakes', part: 'caliper', names: ['Stock'], colors: [0xd11a1a, 0xf2c200, 0x1463ff, 0x2bb54a, 0xff7a1f] },
  { key: 'interior', label: 'Interior', part: 'interior', names: ['Stock'], colors: [0x28282b, 0xb08a5a, 0x7a1c1c, 0xd9cfbd, 0x1d2f55] },
  { key: 'tint', label: 'Windows', part: 'glass', names: TINTS.map((t) => t.name) },
  { key: 'glow', label: 'Underglow', names: ['Off'], colors: [0x2ad4ff, 0xff2bd6, 0x39ff6a, 0xff7a1f, 0xffffff, 0x8a4dff] },
];
const colorsOf = (key) => OPTIONS.find((o) => o.key === key).colors;
const DEFAULT_LOOK = { paint: 0, finish: 1, rims: 0, caliper: 0, interior: 0, tint: 1, glow: 0 };

const PRIZES = [1000, 400, 200, 100];
// Prizes are quoted for a three-lap race and scale with distance, so short races can't be farmed.
export const prizeFor = (place, level, laps) => Math.round(PRIZES[place - 1] * (1 + level) * laps / 3);

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

const GUEST_KEY = 'sc_save';

// Builds a valid save out of whatever was stored, dropping anything that doesn't belong.
function cleanSave(raw) {
  const save = { credits: 0, owned: [CARS[0].id], selected: CARS[0].id, looks: {} };
  if (raw && typeof raw === 'object') {
    if (Number.isFinite(raw.credits)) save.credits = Math.max(0, raw.credits);
    if (Array.isArray(raw.owned)) for (const id of raw.owned) if (CARS.some((c) => c.id === id) && !save.owned.includes(id)) save.owned.push(id);
    if (CARS.some((c) => c.id === raw.selected)) save.selected = raw.selected;
    if (raw.looks && typeof raw.looks === 'object') save.looks = raw.looks;
  }
  return save;
}

function readLocal(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

const cr = (n) => `${Math.round(n).toLocaleString('en-US')} CR`;
const css = (hex) => '#' + hex.toString(16).padStart(6, '0');

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// onPreview(car, look) shows a car on screen; onSave(save) is called whenever progress changes.
export function createGarage({ onPreview, onSave }) {
  let key = GUEST_KEY;
  let isDev = false;
  let specials = [];   // ids of cars granted to this account alone
  let save = cleanSave(readLocal(key));
  const $ = (id) => document.getElementById(id);
  const ui = {
    root: $('garage'), credits: $('g-credits'), name: $('g-name'), tag: $('g-tag'),
    stats: $('g-stats'), action: $('g-action'), custom: $('g-custom'),
  };
  let view = 0;   // index into cars()

  const cars = () => CARS.filter((c) => (c.special ? specials.includes(c.id) : !c.devOnly || isDev));
  const owns = (car) => {
    if (car.special) return specials.includes(car.id);
    if (car.devOnly) return isDev;
    return isDev || save.owned.includes(car.id);
  };
  const selectedCar = () => {
    const car = CARS.find((c) => c.id === save.selected);
    return car && owns(car) ? car : CARS[0];
  };
  const persist = () => {
    try { localStorage.setItem(key, JSON.stringify(save)); } catch { /* storage blocked */ }
    onSave?.(save);
  };

  function lookOf(car) {
    const look = { ...DEFAULT_LOOK, paint: car.paint, finish: car.finish ?? DEFAULT_LOOK.finish, ...save.looks[car.id] };
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
    const current = selectedCar();
    const best = cars().at(-1);
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

  function renderCustom(car) {
    ui.custom.replaceChildren();
    if (!owns(car)) return;
    const look = lookOf(car);
    for (const opt of OPTIONS) {
      if (opt.part && !car.mats[opt.part]) continue;
      const row = make('div', 'opt-row');
      row.append(make('span', 'opt-label', opt.label));
      const choices = make('div', 'choices');
      const add = (index, node) => {
        node.type = 'button';
        if (look[opt.key] === index) node.classList.add('on');
        node.addEventListener('click', () => {
          save.looks[car.id] = { ...look, [opt.key]: index };
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
    const list = cars();
    const car = list[view];
    ui.credits.textContent = cr(save.credits);
    ui.name.textContent = car.name;
    const cost = car.special ? 'Yours alone' : car.devOnly ? 'Developers only' : car === CARS[0] ? 'Starter' : cr(car.price);
    ui.tag.textContent = `Car ${view + 1} of ${list.length} · ${cost} · Rivals level ${Math.round(car.level * 8) + 1}`;
    renderStats(car);

    const btn = ui.action;
    btn.disabled = false;
    if (car === selectedCar()) { btn.textContent = 'SELECTED'; btn.disabled = true; }
    else if (owns(car)) btn.textContent = 'SELECT THIS CAR';
    else if (save.credits >= car.price) btn.textContent = `BUY · ${cr(car.price)}`;
    else { btn.textContent = `NEED ${cr(car.price - save.credits)} MORE`; btn.disabled = true; }

    renderCustom(car);
    ui.root.classList.add('busy');
    Promise.resolve(onPreview(car, resolveLook(lookOf(car)))).finally(() => {
      if (cars()[view] === car) ui.root.classList.remove('busy');
    });
  }

  ui.action.addEventListener('click', () => {
    const car = cars()[view];
    if (!owns(car)) {
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
      const car = selectedCar();
      return { car, look: resolveLook(lookOf(car)) };
    },
    addCredits(n) { save.credits += n; persist(); },
    step(d) { const n = cars().length; view = (view + d + n) % n; render(); },
    open() { view = Math.max(0, cars().indexOf(selectedCar())); ui.root.hidden = false; render(); },
    close() { ui.root.hidden = true; },
    format: cr,

    // Switches whose progress the garage is showing. `account` is { username, isDev, specialCars, save } or
    // null for a guest. An account that has never saved starts from the guest's progress.
    setAccount(account) {
      isDev = !!account?.isDev;
      specials = account?.specialCars || [];
      if (!account) {
        key = GUEST_KEY;
        save = cleanSave(readLocal(key));
        return;
      }
      key = `sc_save_${account.username.toLowerCase()}`;
      const remote = account.save && Object.keys(account.save).length ? account.save : null;
      save = cleanSave(remote || readLocal(key) || readLocal(GUEST_KEY));
      persist();
    },
  };
  $('g-prev').addEventListener('click', () => garage.step(-1));
  $('g-next').addEventListener('click', () => garage.step(1));
  return garage;
}
