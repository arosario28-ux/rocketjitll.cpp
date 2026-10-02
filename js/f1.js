// The developer-only single-seater, built from three.js primitives rather than loaded from a file.
// It follows the same layout as the GLB cars (see tools/build-car.mjs): nose toward +z, tyres on
// y = 0, and four wheel nodes centred on their axles so the game can spin and steer them.

import * as THREE from 'three';

const WHEELBASE_FRONT = 1.75, WHEELBASE_REAR = -1.7, TRACK = 0.82;

export function buildF1() {
  const car = new THREE.Group();
  const named = (mat, name) => { mat.name = name; return mat; };
  const paint = named(new THREE.MeshStandardMaterial({ color: 0xc8102e }), 'f1_paint');
  const carbon = named(new THREE.MeshStandardMaterial({ color: 0x111316, metalness: 0.6, roughness: 0.35 }), 'f1_carbon');
  const accent = named(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, metalness: 0.3, roughness: 0.4 }), 'f1_accent');
  const tyre = named(new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.9 }), 'f1_tyre');
  const rim = named(new THREE.MeshStandardMaterial({ color: 0x1a1b1e, metalness: 0.9, roughness: 0.3 }), 'f1_rim');
  const tail = named(new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1408 }), 'f1_tail');
  const visor = named(new THREE.MeshStandardMaterial({ color: 0x0a0f18, metalness: 1, roughness: 0.1 }), 'f1_visor');

  const body = new THREE.Group();
  body.name = 'body';
  car.add(body);
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    body.add(mesh);
    return mesh;
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  // a tube lying along the car, radius r0 at the back end and r1 at the front end
  const tube = (r0, r1, len, seg = 16) => new THREE.CylinderGeometry(r1, r0, len, seg).rotateX(Math.PI / 2);

  // floor, with the stepped edges and diffuser
  add(box(1.5, 0.05, 3.3), carbon, 0, 0.09, -0.15);
  add(box(0.9, 0.05, 1.0), carbon, 0, 0.09, 1.9);
  add(box(1.3, 0.2, 0.55), carbon, 0, 0.2, -2.0, 0.28);

  // survival cell and nose
  add(tube(0.34, 0.3, 1.5), paint, 0, 0.42, 0.55).scale.set(1, 0.82, 1);
  add(tube(0.3, 0.1, 1.9), paint, 0, 0.36, 2.15).scale.set(1, 0.7, 1);
  add(new THREE.SphereGeometry(0.1, 12, 8), paint, 0, 0.36, 3.1).scale.set(1, 0.7, 1.4);

  // cockpit, driver and halo
  add(box(0.44, 0.1, 0.8), carbon, 0, 0.66, 0.35);
  add(new THREE.SphereGeometry(0.15, 16, 12), accent, 0, 0.78, 0.2);
  add(box(0.24, 0.07, 0.1), visor, 0, 0.8, 0.33);
  add(new THREE.TorusGeometry(0.3, 0.03, 8, 20, Math.PI), carbon, 0, 0.9, 0.3, -Math.PI / 2);
  add(box(0.045, 0.28, 0.06), carbon, 0, 0.78, 0.6, 0.35);
  add(box(0.6, 0.045, 0.06), carbon, 0, 0.9, 0.3);

  // engine cover, airbox and shark fin
  add(tube(0.14, 0.36, 2.1), paint, 0, 0.5, -1.05).scale.set(1, 0.95, 1);
  add(tube(0.12, 0.17, 0.5, 12), carbon, 0, 0.98, -0.2).scale.set(1, 1.25, 1);
  add(box(0.22, 0.36, 0.7), paint, 0, 0.8, -0.5);
  add(box(0.025, 0.34, 1.25), paint, 0, 0.78, -1.5);

  // sidepods, undercut at the front
  for (const side of [1, -1]) {
    add(box(0.46, 0.34, 1.5), paint, side * 0.52, 0.33, -0.35);
    add(box(0.42, 0.24, 0.5), paint, side * 0.5, 0.36, -1.3, 0, side * 0.2);
    add(box(0.4, 0.26, 0.12), carbon, side * 0.52, 0.36, 0.42);
    add(box(0.05, 0.3, 0.9), carbon, side * 0.78, 0.26, 0.9, 0, side * -0.12);   // bargeboard
    add(box(0.26, 0.05, 0.1), carbon, side * 0.42, 0.72, 0.78);                 // mirror
  }

  // front wing: main plane, two flaps, endplates
  add(box(1.9, 0.03, 0.42), paint, 0, 0.12, 2.85);
  add(box(1.9, 0.03, 0.22), accent, 0, 0.2, 2.72, -0.3);
  add(box(1.9, 0.03, 0.16), paint, 0, 0.27, 2.62, -0.5);
  for (const side of [1, -1]) add(box(0.03, 0.24, 0.55), accent, side * 0.95, 0.2, 2.8);
  add(box(0.08, 0.16, 0.3), carbon, 0, 0.22, 2.8);

  // rear wing: two elements, endplates, swan-neck pillar, beam wing
  add(box(1.04, 0.04, 0.34), paint, 0, 0.95, -2.5, 0.18);
  add(box(1.04, 0.04, 0.2), accent, 0, 1.06, -2.66, 0.5);
  for (const side of [1, -1]) add(box(0.03, 0.66, 0.6), paint, side * 0.52, 0.76, -2.52);
  add(box(0.06, 0.5, 0.18), carbon, 0, 0.68, -2.35, -0.3);
  add(box(0.98, 0.03, 0.2), carbon, 0, 0.5, -2.5, 0.2);
  add(box(0.16, 0.09, 0.05), tail, 0, 0.36, -2.78);

  // wishbones tying the wheels to the chassis
  const arm = (x0, y0, x1, y1, z) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    add(box(len, 0.022, 0.07), carbon, (x0 + x1) / 2, (y0 + y1) / 2, z, 0, 0, Math.atan2(y1 - y0, x1 - x0));
  };
  for (const side of [1, -1]) for (const [z, inner] of [[WHEELBASE_FRONT, 0.22], [WHEELBASE_REAR, 0.2]]) {
    for (const dz of [-0.2, 0.2]) {
      arm(side * inner, 0.5, side * (TRACK - 0.18), 0.48, z + dz);
      arm(side * inner, 0.24, side * (TRACK - 0.18), 0.22, z + dz);
    }
  }

  // wheels: fat slicks, wider at the rear, each in its own node
  const wheel = (name, x, z, radius, width) => {
    const node = new THREE.Group();
    node.name = name;
    node.position.set(x, radius, z);
    const tyreMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 28).rotateZ(Math.PI / 2), tyre);
    const face = Math.sign(x) * (width / 2 + 0.005);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.64, radius * 0.64, 0.02, 24).rotateZ(Math.PI / 2), rim);
    disc.position.x = face;
    node.add(tyreMesh, disc);
    // spokes, so the wheel visibly turns
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(box(0.012, radius * 1.2, 0.05), accent);
      spoke.position.x = face + Math.sign(x) * 0.012;
      spoke.rotation.x = (i / 5) * Math.PI;
      node.add(spoke);
    }
    car.add(node);
  };
  wheel('wheel_fl', TRACK, WHEELBASE_FRONT, 0.36, 0.32);
  wheel('wheel_fr', -TRACK, WHEELBASE_FRONT, 0.36, 0.32);
  wheel('wheel_rl', TRACK, WHEELBASE_REAR, 0.36, 0.42);
  wheel('wheel_rr', -TRACK, WHEELBASE_REAR, 0.36, 0.42);

  return car;
}
