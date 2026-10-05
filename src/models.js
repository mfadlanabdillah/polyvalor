import * as THREE from 'three';
import { WEAPONS } from './config.js';

const cache = new Map();
export function flatMat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!cache.has(key)) {
    cache.set(key, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, metalness: 0.05, ...extra }));
  }
  return cache.get(key);
}

function box(parent, w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function cyl(parent, rt, rb, h, seg, mat, x = 0, y = 0, z = 0, rx = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, 0, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

// Frees GPU buffers of every mesh under `obj` (materials are shared and stay alive).
export function disposeTree(obj) {
  obj.traverse((o) => { if (o.geometry && !o.isSprite) o.geometry.dispose(); });
}

const GUN_ACCENT = {
  classic: '#5a6172', ghost: '#3e5560', sheriff: '#8a6a3c', spectre: '#4f5d6e', bulldog: '#6f7d4a',
  guardian: '#7b6d4f', phantom: '#3b3f58', vandal: '#b33b3b', marshal: '#5f6f4f', operator: '#3f5f7a',
};
const HALF = Math.PI / 2;

/**
 * Builds a low-poly weapon pointing toward -Z with its grip near the origin.
 * userData carries everything the first-person rig and effects need:
 *   parts.mag / parts.slide / parts.bolt  animated sub-groups
 *   muzzle / eject                        local anchor points
 *   lh / rh / charge / magSeat / magDir   hand anchors for reload animation
 */
export function buildGun(id) {
  const def = WEAPONS[id];
  const g = new THREE.Group();
  const dark = flatMat('#2a2d35');
  const mid = flatMat('#474c59');
  const metal = flatMat('#9aa2b2', { metalness: 0.55, roughness: 0.35 });
  const wood = flatMat('#7d4b2b');
  const glass = flatMat('#8feaff', { emissive: '#3cc8ff', emissiveIntensity: 0.7 });
  const red = flatMat('#ff3b3b', { emissive: '#ff1a1a', emissiveIntensity: 1.1 });
  const acc = flatMat(GUN_ACCENT[id] || '#555');
  const mag = new THREE.Group();
  const slide = new THREE.Group();
  g.add(mag);
  g.add(slide);
  const ud = g.userData;
  Object.assign(ud, {
    parts: { mag, slide, bolt: null },
    muzzle: new THREE.Vector3(0, 0.04, -0.3),
    eject: new THREE.Vector3(0.03, 0.05, -0.02),
    lh: new THREE.Vector3(-0.012, -0.08, 0.02),
    rh: new THREE.Vector3(0, -0.065, 0.03),
    magSeat: new THREE.Vector3(0, -0.14, 0.05),
    magDir: new THREE.Vector3(0, -1, 0.12).normalize(),
    charge: new THREE.Vector3(0, 0.07, 0.03),
    hasMag: true,
    slideTravel: 0.04,
    ejects: true,
  });
  const boltAssembly = (x, y, z) => {
    const b = new THREE.Group();
    b.position.set(x, y, z);
    b.userData.rest = b.position.clone();
    cyl(b, 0.006, 0.006, 0.05, 6, metal, 0.025, 0, 0, 0, HALF);
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.014, 0), mid);
    ball.position.x = 0.055;
    ball.castShadow = true;
    b.add(ball);
    g.add(b);
    ud.parts.bolt = b;
    return b;
  };

  switch (id) {
    case 'classic':
      box(g, 0.036, 0.04, 0.17, dark, 0, 0, -0.05);
      box(slide, 0.042, 0.05, 0.19, acc, 0, 0.04, -0.07);
      box(slide, 0.008, 0.014, 0.012, metal, 0, 0.07, -0.16);
      box(slide, 0.016, 0.012, 0.012, metal, 0, 0.07, 0.015);
      box(g, 0.04, 0.11, 0.048, dark, 0, -0.07, 0.035, 0.22);
      box(g, 0.006, 0.028, 0.05, dark, 0, -0.035, -0.03);
      box(mag, 0.034, 0.1, 0.044, mid, 0, -0.075, 0.03, 0.22);
      ud.muzzle.set(0, 0.04, -0.175);
      ud.magSeat.set(0, -0.13, 0.05);
      ud.lh.set(-0.012, -0.09, 0.02);
      ud.slideTravel = 0.045;
      ud.eject.set(0.026, 0.06, -0.03);
      break;
    case 'ghost':
      box(g, 0.034, 0.04, 0.16, dark, 0, 0, -0.05);
      box(slide, 0.038, 0.046, 0.18, acc, 0, 0.038, -0.06);
      box(slide, 0.008, 0.012, 0.012, metal, 0, 0.066, -0.15);
      box(slide, 0.014, 0.01, 0.012, metal, 0, 0.066, 0.015);
      box(g, 0.038, 0.11, 0.046, dark, 0, -0.07, 0.035, 0.22);
      box(g, 0.006, 0.028, 0.05, dark, 0, -0.035, -0.03);
      box(mag, 0.032, 0.1, 0.042, mid, 0, -0.075, 0.03, 0.22);
      cyl(g, 0.017, 0.017, 0.13, 8, dark, 0, 0.036, -0.215, HALF);
      ud.muzzle.set(0, 0.036, -0.285);
      ud.magSeat.set(0, -0.13, 0.05);
      ud.lh.set(-0.012, -0.09, 0.02);
      ud.slideTravel = 0.04;
      ud.eject.set(0.024, 0.058, -0.03);
      break;
    case 'sheriff':
      box(g, 0.04, 0.06, 0.13, acc, 0, 0.005, -0.03);
      cyl(mag, 0.036, 0.036, 0.075, 8, mid, 0, 0.012, -0.05, HALF);
      box(g, 0.02, 0.026, 0.19, mid, 0, 0.03, -0.19);
      box(slide, 0.012, 0.03, 0.03, dark, 0, 0.07, 0.03);
      box(slide, 0.008, 0.014, 0.012, metal, 0, 0.055, -0.27);
      box(g, 0.044, 0.12, 0.05, wood, 0, -0.07, 0.055, 0.3);
      box(g, 0.006, 0.028, 0.05, dark, 0, -0.03, -0.02);
      ud.muzzle.set(0, 0.03, -0.29);
      ud.magSeat.set(0, -0.03, -0.05);
      ud.magDir.set(-1, -0.15, 0).normalize();
      ud.lh.set(-0.014, -0.09, 0.03);
      ud.slideTravel = 0.02;
      ud.ejects = false;
      break;
    case 'spectre':
      box(g, 0.055, 0.075, 0.28, acc, 0, 0.03, -0.12);
      box(slide, 0.02, 0.02, 0.06, dark, 0.034, 0.045, -0.1);
      box(g, 0.038, 0.06, 0.12, dark, 0, 0.02, 0.14);
      box(g, 0.038, 0.09, 0.05, dark, 0, -0.06, 0.04, 0.28);
      box(mag, 0.03, 0.15, 0.045, mid, 0, -0.1, -0.08, -0.12);
      box(g, 0.05, 0.05, 0.11, mid, 0, 0.035, -0.31);
      box(g, 0.024, 0.024, 0.08, dark, 0, 0.035, -0.42);
      box(g, 0.02, 0.028, 0.16, dark, 0, 0.078, -0.12);
      box(g, 0.036, 0.04, 0.05, dark, 0, -0.03, -0.26);
      ud.muzzle.set(0, 0.035, -0.47);
      ud.magSeat.set(0, -0.17, -0.09);
      ud.lh.set(0, -0.06, -0.26);
      ud.slideTravel = 0.03;
      ud.eject.set(0.03, 0.05, -0.08);
      break;
    case 'bulldog':
      box(g, 0.06, 0.09, 0.5, acc, 0, 0.02, -0.02);
      box(g, 0.04, 0.05, 0.06, dark, 0, -0.005, 0.24);
      box(g, 0.04, 0.1, 0.05, dark, 0, -0.07, -0.08, 0.3);
      box(mag, 0.036, 0.14, 0.05, mid, 0, -0.09, 0.09);
      box(g, 0.045, 0.055, 0.12, dark, 0, 0.03, -0.3);
      cyl(g, 0.02, 0.02, 0.18, 8, mid, 0, 0.03, -0.42, HALF);
      box(g, 0.03, 0.03, 0.09, dark, 0, 0.088, -0.06);
      cyl(g, 0.02, 0.02, 0.02, 8, glass, 0, 0.098, -0.11, HALF);
      box(slide, 0.02, 0.02, 0.05, metal, 0.036, 0.05, 0.02);
      ud.muzzle.set(0, 0.03, -0.52);
      ud.magSeat.set(0, -0.165, 0.09);
      ud.lh.set(0, -0.03, -0.3);
      ud.slideTravel = 0.035;
      ud.eject.set(0.032, 0.05, 0.04);
      ud.charge.set(0.02, 0.06, 0.03);
      break;
    case 'guardian':
      box(g, 0.05, 0.07, 0.42, acc, 0, 0.02, -0.12);
      box(g, 0.045, 0.08, 0.22, wood, 0, 0, 0.2);
      box(g, 0.04, 0.1, 0.045, dark, 0, -0.07, 0.02, 0.28);
      box(mag, 0.032, 0.09, 0.05, mid, 0, -0.07, -0.1);
      box(g, 0.04, 0.05, 0.16, dark, 0, 0, -0.32);
      cyl(g, 0.014, 0.014, 0.3, 8, mid, 0, 0.03, -0.5, HALF);
      cyl(g, 0.025, 0.025, 0.2, 8, dark, 0, 0.09, -0.12, HALF);
      cyl(g, 0.027, 0.027, 0.02, 8, glass, 0, 0.09, -0.225, HALF);
      box(g, 0.014, 0.03, 0.03, dark, 0, 0.065, -0.05);
      box(slide, 0.018, 0.018, 0.05, metal, 0.03, 0.05, -0.02);
      ud.muzzle.set(0, 0.03, -0.66);
      ud.magSeat.set(0, -0.12, -0.1);
      ud.lh.set(0, -0.03, -0.33);
      ud.slideTravel = 0.04;
      ud.eject.set(0.03, 0.05, -0.03);
      break;
    case 'phantom':
      box(g, 0.058, 0.09, 0.4, dark, 0, 0.02, -0.08);
      box(g, 0.02, 0.03, 0.34, acc, 0, 0.07, -0.08);
      box(g, 0.05, 0.075, 0.2, mid, 0, 0.01, 0.22);
      box(g, 0.04, 0.1, 0.05, dark, 0, -0.075, -0.05, 0.3);
      box(mag, 0.034, 0.15, 0.055, mid, 0, -0.1, -0.12, -0.18);
      box(g, 0.05, 0.06, 0.14, mid, 0, 0.025, -0.26);
      cyl(g, 0.026, 0.026, 0.3, 8, dark, 0, 0.03, -0.44, HALF);
      box(g, 0.04, 0.04, 0.06, dark, 0, 0.1, -0.06);
      box(g, 0.02, 0.02, 0.006, red, 0, 0.104, -0.092);
      box(slide, 0.02, 0.02, 0.05, metal, 0.036, 0.05, -0.02);
      ud.muzzle.set(0, 0.03, -0.6);
      ud.magSeat.set(0, -0.175, -0.13);
      ud.lh.set(0, -0.03, -0.26);
      ud.slideTravel = 0.035;
      ud.eject.set(0.032, 0.05, -0.03);
      break;
    case 'vandal':
      box(g, 0.058, 0.088, 0.36, dark, 0, 0.02, -0.08);
      box(g, 0.02, 0.01, 0.2, acc, 0, 0.068, -0.08);
      box(g, 0.05, 0.08, 0.24, wood, 0, 0, 0.24);
      box(g, 0.05, 0.065, 0.2, wood, 0, 0.01, -0.3);
      box(g, 0.04, 0.1, 0.05, dark, 0, -0.075, -0.04, 0.3);
      box(mag, 0.032, 0.09, 0.05, mid, 0, -0.085, -0.115, -0.1);
      box(mag, 0.032, 0.07, 0.05, mid, 0, -0.155, -0.14, -0.35);
      cyl(g, 0.016, 0.016, 0.22, 8, mid, 0, 0.03, -0.52, HALF);
      box(g, 0.008, 0.03, 0.01, red, 0, 0.058, -0.6);
      box(g, 0.014, 0.02, 0.012, dark, 0, 0.078, 0.06);
      box(slide, 0.02, 0.02, 0.05, metal, 0.036, 0.05, -0.02);
      ud.muzzle.set(0, 0.03, -0.64);
      ud.magSeat.set(0, -0.19, -0.14);
      ud.lh.set(0, -0.03, -0.3);
      ud.slideTravel = 0.04;
      ud.eject.set(0.032, 0.05, -0.03);
      break;
    case 'marshal':
      box(g, 0.05, 0.075, 0.5, acc, 0, 0.02, -0.15);
      box(g, 0.05, 0.09, 0.22, wood, 0, 0, 0.22);
      box(g, 0.04, 0.1, 0.045, dark, 0, -0.07, 0.04, 0.28);
      cyl(g, 0.013, 0.013, 0.36, 8, mid, 0, 0.032, -0.58, HALF);
      cyl(g, 0.03, 0.03, 0.3, 8, dark, 0, 0.1, -0.14, HALF);
      cyl(g, 0.034, 0.034, 0.02, 8, glass, 0, 0.1, -0.3, HALF);
      cyl(g, 0.034, 0.034, 0.02, 8, glass, 0, 0.1, 0.01, HALF);
      box(g, 0.014, 0.03, 0.03, dark, 0, 0.066, -0.08);
      box(mag, 0.03, 0.05, 0.05, mid, 0, -0.045, -0.08);
      boltAssembly(0.03, 0.05, 0.03);
      ud.muzzle.set(0, 0.032, -0.76);
      ud.magSeat.set(0, -0.075, -0.08);
      ud.magDir.set(0, -1, 0).normalize();
      ud.lh.set(0, -0.02, -0.3);
      ud.charge.set(0.05, 0.06, 0.04);
      ud.slideTravel = 0;
      ud.eject.set(0.03, 0.05, 0.0);
      ud.ejects = false;
      break;
    case 'operator':
      box(g, 0.065, 0.09, 0.62, acc, 0, 0.02, -0.15);
      box(g, 0.06, 0.11, 0.3, dark, 0, -0.005, 0.26);
      box(g, 0.05, 0.12, 0.05, dark, 0, -0.08, 0.04, 0.28);
      cyl(g, 0.02, 0.02, 0.4, 8, mid, 0, 0.035, -0.66, HALF);
      cyl(g, 0.03, 0.03, 0.07, 8, dark, 0, 0.035, -0.88, HALF);
      cyl(g, 0.04, 0.04, 0.36, 8, dark, 0, 0.115, -0.15, HALF);
      cyl(g, 0.048, 0.048, 0.02, 8, glass, 0, 0.115, -0.34, HALF);
      cyl(g, 0.048, 0.048, 0.02, 8, glass, 0, 0.115, 0.03, HALF);
      box(g, 0.02, 0.04, 0.04, dark, 0, 0.075, -0.1);
      box(mag, 0.04, 0.06, 0.06, mid, 0, -0.055, -0.08);
      boltAssembly(0.036, 0.05, 0.05);
      ud.muzzle.set(0, 0.035, -0.92);
      ud.magSeat.set(0, -0.09, -0.08);
      ud.magDir.set(0, -1, 0).normalize();
      ud.lh.set(0, -0.02, -0.34);
      ud.charge.set(0.06, 0.06, 0.06);
      ud.slideTravel = 0;
      ud.eject.set(0.036, 0.05, 0.03);
      ud.ejects = false;
      break;
    case 'knife': {
      const blade = flatMat('#d6dbe3', { metalness: 0.6, roughness: 0.3 });
      box(g, 0.012, 0.045, 0.24, blade, 0, 0.02, -0.16);
      box(g, 0.012, 0.03, 0.05, blade, 0, 0.012, -0.31, 0.35);
      box(g, 0.032, 0.04, 0.11, dark, 0, 0, 0.02);
      box(g, 0.05, 0.05, 0.02, mid, 0, 0.01, -0.04);
      ud.muzzle.set(0, 0.02, -0.3);
      ud.hasMag = false;
      ud.ejects = false;
      ud.rh.set(0, -0.01, 0.02);
      break;
    }
    case 'knives': {
      const blade = flatMat('#bfefff', { emissive: '#5fc8ff', emissiveIntensity: 0.8 });
      for (const [x, ry] of [[-0.03, 0.18], [0, 0], [0.03, -0.18]]) {
        box(g, 0.01, 0.04, 0.22, blade, x, 0.02, -0.15, 0, ry);
        box(g, 0.026, 0.034, 0.08, dark, x, 0, 0.01, 0, ry);
      }
      ud.muzzle.set(0, 0.02, -0.3);
      ud.hasMag = false;
      ud.ejects = false;
      ud.rh.set(0, -0.01, 0.02);
      break;
    }
    default: {
      // planted-spike prop carried in hand
      cyl(g, 0.09, 0.11, 0.28, 6, flatMat('#3a3d48'), 0, 0, -0.1);
      cyl(g, 0.1, 0.1, 0.05, 6, flatMat('#ff6a4a', { emissive: '#ff3a2a', emissiveIntensity: 1.2 }), 0, 0.05, -0.1);
      ud.hasMag = false;
      ud.ejects = false;
      ud.muzzle.set(0, 0, -0.2);
      ud.rh.set(0.07, -0.05, -0.05);
    }
  }
  void def;
  return g;
}

export function buildSpikeMesh() {
  const g = new THREE.Group();
  cyl(g, 0.22, 0.28, 0.5, 6, flatMat('#3a3d48'), 0, 0.25, 0);
  const ring = cyl(g, 0.25, 0.25, 0.08, 6, flatMat('#ff6a4a', { emissive: '#ff3a2a', emissiveIntensity: 1.5 }), 0, 0.32, 0);
  cyl(g, 0.08, 0.14, 0.18, 6, flatMat('#555a68'), 0, 0.58, 0);
  const light = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), new THREE.MeshBasicMaterial({ color: '#ff3a2a' }));
  light.position.y = 0.72;
  g.add(light);
  g.userData.ring = ring;
  g.userData.light = light;
  return g;
}

export class CharacterModel {
  constructor(teamColor, accent) {
    this.root = new THREE.Group();
    // Per-character materials so a hit can flash this body without affecting others.
    const mk = (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.8, metalness: 0.05 });
    const body = mk(teamColor);
    const bodyDark = mk(new THREE.Color(teamColor).multiplyScalar(0.7));
    this.teamMats = [body, bodyDark];
    this.bodyMat = body;
    this.bodyDarkMat = bodyDark;
    const dark = flatMat('#343847');
    const acc = flatMat(accent);
    const visor = flatMat('#111318', { emissive: accent, emissiveIntensity: 0.9 });

    this.hips = new THREE.Group();
    this.hips.position.y = 0.9;
    this.root.add(this.hips);
    this.legs = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.12, 0, 0);
      box(pivot, 0.17, 0.86, 0.2, dark, 0, -0.43, 0);
      box(pivot, 0.19, 0.12, 0.28, bodyDark, 0, -0.84, -0.04);
      this.hips.add(pivot);
      this.legs.push(pivot);
    }
    box(this.hips, 0.38, 0.2, 0.24, dark, 0, 0.02, 0);

    this.torso = new THREE.Group();
    this.torso.position.y = 0.1;
    this.hips.add(this.torso);
    cyl(this.torso, 0.25, 0.2, 0.5, 6, body, 0, 0.27, 0);
    box(this.torso, 0.3, 0.3, 0.12, bodyDark, 0, 0.3, 0.2);
    box(this.torso, 0.16, 0.1, 0.22, acc, 0.25, 0.47, 0);
    box(this.torso, 0.16, 0.1, 0.22, acc, -0.25, 0.47, 0);
    this.head = new THREE.Group();
    this.head.position.y = 0.6;
    this.torso.add(this.head);
    const headMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0), acc);
    headMesh.castShadow = true;
    this.head.add(headMesh);
    box(this.head, 0.22, 0.06, 0.08, visor, 0, 0.02, -0.13);

    this.arms = new THREE.Group();
    this.arms.position.set(0, 0.45, 0);
    this.torso.add(this.arms);
    box(this.arms, 0.1, 0.1, 0.44, body, 0.2, -0.06, -0.18, 0, 0.15);
    box(this.arms, 0.1, 0.1, 0.46, body, -0.12, -0.08, -0.26, 0, -0.5);
    this.gunMount = new THREE.Group();
    this.gunMount.position.set(0.1, -0.08, -0.36);
    this.arms.add(this.gunMount);
    this.gunId = null;
    this.phase = 0;
    this.flashT = 0;
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  setTeamColor(hex) {
    this.bodyMat.color.set(hex);
    this.bodyDarkMat.color.set(hex).multiplyScalar(0.7);
  }

  // 0..1 white-red pulse when the character takes a hit
  flash(k) {
    this.flashT = Math.max(this.flashT, k);
  }

  setGun(id) {
    if (this.gunId === id) return;
    this.gunId = id;
    for (const child of this.gunMount.children) disposeTree(child);
    this.gunMount.clear();
    if (!id) return;
    const g = buildGun(id);
    g.scale.setScalar(1.25);
    this.gunMount.add(g);
    this.muzzle = g.userData.muzzle.clone().multiplyScalar(1.25);
  }

  muzzleWorld(out = new THREE.Vector3()) {
    const g = this.gunMount.children[0];
    if (!g) return this.gunMount.getWorldPosition(out);
    out.copy(g.userData.muzzle);
    return g.localToWorld(out);
  }

  ejectWorld(out = new THREE.Vector3()) {
    const g = this.gunMount.children[0];
    if (!g) return this.gunMount.getWorldPosition(out);
    out.copy(g.userData.eject);
    return g.localToWorld(out);
  }

  update(dt, st) {
    const moveAmt = Math.min(1, st.speed / 5);
    if (st.onGround && st.speed > 0.3) this.phase += dt * (4 + st.speed * 1.4);
    else this.phase *= 0.9;
    const swing = Math.sin(this.phase) * 0.6 * moveAmt;
    const c = st.crouchT;
    this.hips.position.y = 0.9 - 0.33 * c + Math.abs(Math.cos(this.phase)) * 0.03 * moveAmt;
    this.legs[0].rotation.x = swing + 0.9 * c;
    this.legs[1].rotation.x = -swing - 0.35 * c;
    this.torso.rotation.x = -0.12 * c;
    this.arms.rotation.x = st.pitch + 0.12 * c;
    this.head.rotation.x = st.pitch * 0.5;
    if (!st.onGround) {
      this.legs[0].rotation.x = 0.5;
      this.legs[1].rotation.x = -0.2;
    }
    this.tickFlash(dt);
  }

  tickFlash(dt) {
    if (this.flashT <= 0) return;
    this.flashT = Math.max(0, this.flashT - dt * 5);
    const k = this.flashT;
    for (const m of this.teamMats) m.emissive.setRGB(k * 0.95, k * 0.3, k * 0.3);
  }

  resetFlash() {
    this.flashT = 0;
    for (const m of this.teamMats) m.emissive.setRGB(0, 0, 0);
  }
}
