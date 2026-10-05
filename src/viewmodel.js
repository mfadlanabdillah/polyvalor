import * as THREE from 'three';
import { buildGun, flatMat, disposeTree } from './models.js';
import { clamp } from './utils.js';

const Z = new THREE.Vector3(0, 0, 1);
const ease = (t) => t * t * (3 - 2 * t);
const seg = (p, a, b) => ease(clamp((p - a) / (b - a), 0, 1));

// A box stretched between two points (used for forearms so they follow the moving hands).
class Limb {
  constructor(parent, thick, mat) {
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(thick, thick, 1), mat);
    parent.add(this.mesh);
    this._d = new THREE.Vector3();
  }

  set(from, to) {
    const d = this._d.subVectors(to, from);
    const len = d.length() || 1e-4;
    this.mesh.position.addVectors(from, to).multiplyScalar(0.5);
    this.mesh.quaternion.setFromUnitVectors(Z, d.divideScalar(len));
    this.mesh.scale.z = len;
  }
}

const OFFSETS = {
  pistol: new THREE.Vector3(0.17, -0.19, -0.4),
  smg: new THREE.Vector3(0.19, -0.2, -0.42),
  rifle: new THREE.Vector3(0.2, -0.21, -0.44),
  sniper: new THREE.Vector3(0.2, -0.21, -0.42),
  melee: new THREE.Vector3(0.24, -0.24, -0.4),
  knives: new THREE.Vector3(0.24, -0.22, -0.4),
  spike: new THREE.Vector3(0.05, -0.2, -0.42),
};

// Reload timeline (p = 0..1): hand goes to the mag, pulls it, fetches a fresh one, seats it, slaps it, racks.
function reloadState(p) {
  const s = { hs: 'rest', a: 0, magOff: 0, magVis: true, tilt: 0, slap: 0, rack: 0 };
  s.tilt = seg(p, 0, 0.12) * (1 - seg(p, 0.88, 1));
  if (p < 0.14) { s.hs = 'toMag'; s.a = seg(p, 0, 0.14); }
  else if (p < 0.31) { s.hs = 'pull'; s.magOff = seg(p, 0.14, 0.31); }
  else if (p < 0.5) { s.hs = 'pouch'; s.magVis = false; s.a = seg(p, 0.31, 0.5); }
  else if (p < 0.72) { s.hs = 'insert'; s.magOff = 1.7 * (1 - seg(p, 0.5, 0.72)); }
  else if (p < 0.8) { s.hs = 'slap'; s.slap = Math.sin(((p - 0.72) / 0.08) * Math.PI); }
  else if (p < 0.9) { s.hs = 'toCharge'; s.a = seg(p, 0.8, 0.9); }
  else if (p < 0.96) { s.hs = 'charge'; s.rack = Math.sin(((p - 0.9) / 0.06) * Math.PI); }
  else { s.hs = 'back'; s.a = seg(p, 0.96, 1); }
  return s;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _hand = new THREE.Vector3();
const RIGHT_ARM_END = new THREE.Vector3(0.12, -0.32, 0.5);
const LEFT_ARM_END = new THREE.Vector3(-0.3, -0.32, 0.3);

// First-person weapon rendered in its own scene on top of the world.
export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight('#dfeaff', '#8a7a60', 1.6));
    const d = new THREE.DirectionalLight('#fff4de', 1.8);
    d.position.set(1, 2, 1);
    this.scene.add(d);
    this.fireLight = new THREE.PointLight('#ffcf8a', 0, 2.2, 2);
    this.scene.add(this.fireLight);
    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.key = null;
    this.kick = 0;
    this.slideK = 0;
    this.bob = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.lastYaw = 0;
    this.lastPitch = 0;
    this.flashT = 0;
    this.swing = 0;
    this.inspectStart = null;
    this.boltStart = -9;
    this.adsK = 0;
    this.reloadFlags = {};
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeFlashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false;
    this.sleeve = flatMat('#2c3040');
    this.type = 'pistol';
  }

  setWeapon(id, type, gloveColor) {
    const key = id + gloveColor;
    if (this.key === key) return;
    this.key = key;
    this.id = id;
    this.type = type;
    for (const child of this.holder.children) disposeTree(child);
    this.holder.clear();
    this.reloadFlags = {};
    const gun = buildGun(id);
    gun.scale.setScalar(0.85);
    this.gun = gun;
    this.ud = gun.userData;
    this.holder.add(gun);
    const glove = flatMat(gloveColor);
    const handBox = () => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.08), glove);
      gun.add(b);
      return b;
    };
    this.rhMesh = handBox();
    this.rhMesh.position.copy(this.ud.rh);
    this.rArm = new Limb(gun, 0.07, this.sleeve);
    this.rArm.set(this.ud.rh, RIGHT_ARM_END);
    this.twoHanded = this.ud.hasMag || id === 'spike';
    this.lhMesh = null;
    this.lArm = null;
    if (this.twoHanded && id !== 'spike') {
      this.lhMesh = handBox();
      this.lhMesh.position.copy(this.ud.lh);
      this.lArm = new Limb(gun, 0.07, this.sleeve);
      this.lArm.set(this.ud.lh, LEFT_ARM_END);
    } else if (id === 'spike') {
      this.lhMesh = handBox();
      this.lhMesh.position.set(-0.07, -0.05, -0.05);
      this.lArm = new Limb(gun, 0.07, this.sleeve);
      this.lArm.set(this.lhMesh.position, LEFT_ARM_END);
    }
    this.flash.position.copy(this.ud.muzzle);
    gun.add(this.flash);
    this.flashScale = this.type === 'sniper' ? 0.26 : this.type === 'pistol' ? 0.13 : 0.17;
  }

  inspect(now) { this.inspectStart = now; }

  onFire(def) {
    this.inspectStart = null;
    const k = { pistol: 1, smg: 0.6, rifle: 0.8, sniper: 2.5, knives: 0.5, melee: 0 }[def.type] ?? 0.8;
    this.kick = Math.min(3, this.kick + k);
    if (def.type === 'melee') this.swing = 1;
    else if (def.type === 'knives') this.swing = 0.6;
    else {
      this.flashT = 0.05;
      this.slideK = 1;
      this.fireLight.intensity = 2.4;
      if (def.type === 'sniper') this.boltStart = this._t ?? 0;
    }
  }

  // Muzzle position in world space (viewmodel space re-projected through the main camera).
  muzzleWorld(camera, out = new THREE.Vector3()) {
    if (!this.gun) return out.copy(camera.position);
    this.scene.updateMatrixWorld();
    out.copy(this.ud.muzzle);
    this.gun.localToWorld(out);
    return camera.localToWorld(out);
  }

  ejectWorld(camera, out = new THREE.Vector3()) {
    if (!this.gun) return out.copy(camera.position);
    this.scene.updateMatrixWorld();
    out.copy(this.ud.eject);
    this.gun.localToWorld(out);
    return camera.localToWorld(out);
  }

  // World position of the magazine (for the dropped-mag effect).
  magWorld(camera, out = new THREE.Vector3()) {
    if (!this.gun) return out.copy(camera.position);
    this.scene.updateMatrixWorld();
    out.copy(this.ud.magSeat);
    this.gun.localToWorld(out);
    return camera.localToWorld(out);
  }

  update(dt, char, world) {
    const w = char.weapon;
    const def = w.def;
    const t = world.time;
    this._t = t;
    const planting = char.hasSpike && char.action?.type === 'plant';
    this.setWeapon(planting ? 'spike' : w.id, planting ? 'spike' : def.type, char.agent.color);
    const ud = this.ud;
    const parts = ud.parts;
    const off = OFFSETS[this.type] || OFFSETS.rifle;
    const speed = Math.hypot(char.vel.x, char.vel.z);
    const moveK = clamp(speed / 5.4, 0, 1) * (char.onGround ? 1 : 0.2);

    this.bob += dt * (3 + speed * 1.6);
    this.kick *= Math.exp(-14 * dt);
    this.slideK *= Math.exp(-28 * dt);
    this.swing = Math.max(0, this.swing - dt * 3.5);
    const ads = char.zoomed && !def.scope && def.zoom > 1 ? 1 : 0;
    this.adsK += (ads - this.adsK) * Math.min(1, dt * 14);

    const dyaw = char.yaw - this.lastYaw, dpitch = char.pitch - this.lastPitch;
    this.lastYaw = char.yaw; this.lastPitch = char.pitch;
    const swayScale = world.settings.gameplay?.viewBob === false ? 0 : 1;
    this.swayX += (clamp(dyaw * 2, -0.08, 0.08) - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (clamp(dpitch * 2, -0.08, 0.08) - this.swayY) * Math.min(1, dt * 10);

    const steady = 1 - this.adsK * 0.75;
    let y = off.y + Math.abs(Math.cos(this.bob)) * 0.012 * moveK * steady * swayScale;
    let x = off.x + Math.sin(this.bob) * 0.012 * moveK * steady * swayScale + this.swayX * 0.4 * swayScale;
    let z = off.z + this.kick * 0.035;
    let rx = this.kick * 0.06 + this.swayY * 0.5 * swayScale;
    let ry = this.swayX * 0.6 * swayScale;
    let rz = 0;
    x += (0.03 - x) * this.adsK * 0.9;
    y += 0.045 * this.adsK;
    z += 0.02 * this.adsK;

    // equip raise
    const eq = def.equip || 0.5;
    const eqT = ease(clamp(1 - (char.equipEnd - t) / eq, 0, 1));
    y -= (1 - eqT) * 0.25;
    rx -= (1 - eqT) * 0.6;

    // reload animation ---------------------------------------------------
    let slideAmt = this.slideK;
    let hand = null;
    if (w.reloading && ud.hasMag) {
      const p = clamp(1 - (w.reloadEnd - t) / def.reload, 0, 1);
      const s = reloadState(p);
      const seat = ud.magSeat;
      const dir = ud.magDir;
      const at = (o, out) => out.copy(seat).addScaledVector(dir, o * 0.2);
      switch (s.hs) {
        case 'toMag': hand = _hand.copy(ud.lh).lerp(at(0, _a), s.a); break;
        case 'pull': hand = at(s.magOff, _hand); break;
        case 'pouch': hand = _hand.copy(at(1, _a)).lerp(at(1.7, _b).add(_b.set(0, -0.03, 0.02)), s.a); break;
        case 'insert': hand = at(s.magOff, _hand); break;
        case 'slap': hand = at(0, _hand); hand.y += s.slap * 0.012; break;
        case 'toCharge': hand = _hand.copy(at(0, _a)).lerp(ud.charge, s.a); break;
        case 'charge': hand = _hand.copy(ud.charge); hand.z += 0.05 * s.rack; break;
        case 'back': hand = _hand.copy(ud.charge).lerp(ud.lh, s.a); break;
        default: hand = _hand.copy(ud.lh);
      }
      parts.mag.position.copy(dir).multiplyScalar(s.magOff * 0.2);
      parts.mag.visible = s.magVis;
      if (!s.magVis && !this.reloadFlags.dropped) {
        this.reloadFlags.dropped = true;
        world.effects.dropMag(this.magWorld(world.camera), world.camera);
      }
      slideAmt = Math.max(slideAmt, s.rack);
      const rl = this.reloadFlags;
      if (p > 0.16 && !rl.out) { rl.out = true; world.audio.reloadPhase(char, 'magOut'); }
      if (p > 0.62 && !rl.in) { rl.in = true; world.audio.reloadPhase(char, 'magIn'); }
      if (p > 0.9 && !rl.charge) { rl.charge = true; world.audio.reloadPhase(char, 'charge'); }
      // gun cants toward the camera while the off-hand works
      rx -= s.tilt * 0.12;
      ry += s.tilt * 0.3;
      rz += s.tilt * 0.45;
      y += s.tilt * 0.17;
      x -= s.tilt * 0.1;
      z += s.tilt * 0.04;
    } else {
      this.reloadFlags = {};
      parts.mag.position.set(0, 0, 0);
      parts.mag.visible = true;
    }

    // slide / bolt ------------------------------------------------------------
    parts.slide.position.z = slideAmt * ud.slideTravel;
    if (parts.bolt) {
      const cycle = Math.min(0.6, 1 / (def.rate || 1));
      const p = clamp((t - this.boltStart) / cycle, 0, 1);
      let raise = 0, back = 0;
      if (p < 1 && this.boltStart > -8) {
        raise = seg(p, 0, 0.2) * (1 - seg(p, 0.8, 1));
        back = seg(p, 0.2, 0.5) * (1 - seg(p, 0.5, 0.8));
      }
      if (w.reloading) { raise = Math.max(raise, this.reloadFlags.charge ? 0 : 0); }
      parts.bolt.rotation.z = -raise * 1.0;
      parts.bolt.position.z = parts.bolt.userData.rest.z + back * 0.07;
    }

    // hands follow their anchors
    if (this.lhMesh && this.id !== 'spike') {
      const lh = hand || _hand.copy(ud.lh);
      this.lhMesh.position.copy(lh);
      this.lArm.set(lh, LEFT_ARM_END);
    }

    // crouch nudge
    y += char.crouchT * 0.01;

    // melee swing
    if (this.swing > 0) {
      const s = Math.sin(this.swing * Math.PI);
      x -= s * 0.18;
      ry += s * 1.2;
      rz -= s * 0.6;
    }

    // inspect: tilt the weapon toward the camera, then return (cancelled by reload / switching)
    if (this.inspectStart != null) {
      const p = (t - this.inspectStart) / 2.2;
      if (p >= 1 || w.reloading || t < char.equipEnd) this.inspectStart = null;
      else {
        const s = Math.sin(Math.min(1, p) * Math.PI);
        ry += s * 0.9;
        rz += s * 0.55;
        x -= s * 0.1;
        y += s * 0.04;
      }
    }
    if (this.type === 'melee' || this.type === 'knives') { rx += 0.25; rz += 0.3; }
    if (this.type === 'spike') { y -= 0.05; z += 0.08; }

    this.holder.position.set(x, y, z);
    this.holder.rotation.set(rx, ry, rz);

    // muzzle flash sprite + light
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    if (this.flash.visible) {
      const s = this.flashScale * (0.7 + Math.random() * 0.7);
      this.flash.scale.set(s, s, 1);
      this.flash.material.rotation = Math.random() * Math.PI;
    }
    this.fireLight.position.set(x, y + 0.05, z - 0.3);
    this.fireLight.intensity *= Math.exp(-40 * dt);
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
}

export function makeFlashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,250,220,1)');
  grad.addColorStop(0.25, 'rgba(255,200,110,0.9)');
  grad.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,235,170,0.95)';
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = i % 2 ? 9 : 31;
    g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
