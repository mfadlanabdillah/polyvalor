import * as THREE from 'three';
import { WEAPONS, AGENTS } from './config.js';
import { buildGun, CharacterModel } from './models.js';

// ---------------------------------------------------------------------------
// Ability glyphs (inline SVG, stroke = currentColor)
// ---------------------------------------------------------------------------
const SHAPES = {
  arrowUp: '<path d="M12 20V6M6 12l6-6 6 6"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 0-8 5 5 0 0 0-9.6-1A4 4 0 0 0 7 18z"/>',
  dash: '<path d="M3 7l7 5-7 5M12 7l7 5-7 5"/>',
  blades: '<path d="M12 3l2 8-2 3-2-3zM5 6l4 6-2 2-3-5zM19 6l-4 6 2 2 3-5zM12 15v6"/>',
  flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z"/>',
  flash: '<circle cx="12" cy="12" r="2.5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5L19 19M19 5l-3.5 3.5M8.5 15.5L5 19"/>',
  heal: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10"/>',
  bolt: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  beacon: '<circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="10" opacity=".5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>',
  cloud2: '<circle cx="9" cy="14" r="5"/><circle cx="15" cy="11" r="6"/>',
  strike: '<circle cx="12" cy="12" r="6"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5"/><circle cx="12" cy="12" r="1.5"/>',
  dart: '<path d="M4 20L19 5M19 5l-1 6M19 5l-6-1M7 17l-3 3"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6"/>',
  beam: '<path d="M2 12h20M16 6l6 6-6 6"/><path d="M2 8h9M2 16h9" opacity=".6"/>',
  trap: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  field: '<circle cx="12" cy="12" r="9"/><path d="M8 7h8M8 17h8M9 7c0 4 6 4 6 5s-6 1-6 5M15 7c0 4-6 4-6 5s6 1 6 5"/>',
  revive: '<path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5"/><path d="M12 8.5v7M8.5 12h7"/>',
};

const ABILITY_SHAPE = {
  updraft: 'arrowUp', cloudburst: 'cloud', tailwind: 'dash', bladestorm: 'blades',
  hothands: 'flame', curveball: 'flash', warmth: 'heal', overdrive: 'bolt',
  stim: 'beacon', nearsight: 'eye', shroud: 'cloud2', orbital: 'strike',
  shockdart: 'dart', flare: 'flash', recon: 'radar', fury: 'beam',
  tripwire: 'trap', slowfield: 'field', mend: 'heal', resurrect: 'revive',
};

export function abilityIcon(id) {
  const s = SHAPES[ABILITY_SHAPE[id]] || SHAPES.flash;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${s}</svg>`;
}

// ---------------------------------------------------------------------------
// Thumbnails: renders every weapon (side view) and agent (bust) once into PNG data URLs.
// ---------------------------------------------------------------------------
export function renderThumbnails() {
  const out = { weapons: {}, agents: {} };
  const canvas = document.createElement('canvas');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  } catch {
    return out;
  }
  try {
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#7c8496', 2.1));
    const key = new THREE.DirectionalLight('#ffffff', 2.4);
    key.position.set(2, 3, 5);
    scene.add(key);

    // Weapons: barrel pointing right, viewed from the gun's right side.
    const WW = 260, WH = 100;
    renderer.setSize(WW, WH, false);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
    for (const id of Object.keys(WEAPONS)) {
      const gun = buildGun(id);
      gun.rotation.y = -Math.PI / 2;
      scene.add(gun);
      gun.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gun);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const aspect = WW / WH;
      let halfW = size.x * 0.56, halfH = size.y * 0.56;
      if (halfW / halfH < aspect) halfW = halfH * aspect; else halfH = halfW / aspect;
      ortho.left = -halfW; ortho.right = halfW; ortho.top = halfH; ortho.bottom = -halfH;
      ortho.position.set(center.x, center.y, 5);
      ortho.lookAt(center.x, center.y, 0);
      ortho.updateProjectionMatrix();
      renderer.render(scene, ortho);
      out.weapons[id] = canvas.toDataURL('image/png');
      scene.remove(gun);
    }

    // Agents: upper-body portraits.
    const PS = 128;
    renderer.setSize(PS, PS, false);
    const persp = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    for (const ag of Object.values(AGENTS)) {
      const model = new CharacterModel(0x5d6b82, ag.color);
      model.root.rotation.y = 0.5;
      scene.add(model.root);
      persp.position.set(0.12, 1.5, 2.0);
      persp.lookAt(0, 1.4, 0);
      renderer.render(scene, persp);
      out.agents[ag.id] = canvas.toDataURL('image/png');
      scene.remove(model.root);
    }
  } catch (e) {
    console.warn('thumbnail rendering failed', e);
  }
  renderer.dispose();
  renderer.forceContextLoss?.();
  return out;
}
