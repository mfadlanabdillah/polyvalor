import * as THREE from 'three';
import { WEAPONS, MOVE } from './config.js';
import { DEG, clamp, dirFromAngles, spreadDir } from './utils.js';

export class Weapon {
  constructor(id) {
    this.id = id;
    this.def = WEAPONS[id];
    this.ammo = this.def.mag ?? 0;
    this.reserve = this.def.reserve ?? 0;
    this.nextFire = 0;
    this.reloading = false;
    this.reloadEnd = 0;
    this.spray = 0;
    this.recoilP = 0; // degrees, up
    this.recoilY = 0; // degrees, sideways
    this.lastShot = -99;
    this.boughtRound = -1;
    this.sideDir = 1;
  }

  refill() {
    this.ammo = this.def.mag ?? 0;
    this.reserve = this.def.reserve ?? 0;
    this.reloading = false;
    this.spray = 0;
    this.recoilP = this.recoilY = 0;
  }

  canReload() {
    return this.def.mag && !this.reloading && this.ammo < this.def.mag && this.reserve > 0;
  }

  startReload(now) {
    if (!this.canReload()) return false;
    this.reloading = true;
    this.reloadEnd = now + this.def.reload;
    return true;
  }

  cancelReload() { this.reloading = false; }

  update(dt, now) {
    if (this.reloading && now >= this.reloadEnd) {
      const need = this.def.mag - this.ammo;
      const take = Math.min(need, this.reserve);
      this.ammo += take;
      this.reserve -= take;
      this.reloading = false;
    }
    const interval = 1 / (this.def.rate || 1);
    if (now - this.lastShot > interval + 0.06) {
      const rec = (this.def.recoil?.recover ?? 20) * dt;
      this.recoilP = Math.max(0, this.recoilP - rec);
      this.recoilY -= Math.sign(this.recoilY) * Math.min(Math.abs(this.recoilY), rec * 0.7);
      if (now - this.lastShot > Math.max(0.28, interval + 0.1)) this.spray = Math.max(0, this.spray - dt * 12);
    }
  }
}

const _dir = new THREE.Vector3();
const _base = new THREE.Vector3();

// Computes current spread (degrees) of the character's weapon.
export function currentSpread(char, w, zoomed) {
  const def = w.def;
  if (!def.spread) return 0;
  const sp = def.spread;
  const speed = Math.hypot(char.vel.x, char.vel.z);
  const moveFrac = clamp((speed - 1.6) / (MOVE.run - 1.6), 0, 1);
  let base = sp.base;
  if (def.scope) base = zoomed ? sp.scoped : sp.base;
  let s = base + sp.move * moveFrac;
  if (!char.onGround) s += sp.air;
  if (char.crouchT > 0.5 && char.onGround) s *= 0.85;
  if (zoomed && !def.scope) s *= 0.8;
  s += sp.spray * clamp((w.spray - 1) / 8, 0, 1);
  return s;
}

/**
 * Fires the character's current weapon. Returns true when a shot happened.
 * opts: { zoomed, recoilScale (0..1 portion of recoil applied), alt }
 */
export function fireWeapon(world, char, opts = {}) {
  const w = char.weapon;
  if (!w) return false;
  const def = w.def;
  const now = world.time;
  if (now < w.nextFire || now < char.equipEnd) return false;
  if (def.type === 'melee') {
    w.nextFire = now + (opts.alt ? 1.0 : 1 / def.rate);
    char.lastFire = now;
    world.meleeAttack(char, opts.alt);
    return true;
  }
  if (w.reloading) return false;
  if (w.ammo <= 0) {
    if (!w.startReload(now)) world.audio.dryFire(char);
    return false;
  }
  const rateMult = char.fireRateMult();
  w.nextFire = now + 1 / (def.rate * rateMult);
  w.ammo--;
  char.shots++;
  const spread = currentSpread(char, w, opts.zoomed) + (opts.extraSpread || 0);
  const rs = opts.recoilScale ?? 1;
  // Direction includes accumulated recoil (first shot is perfectly on target)
  dirFromAngles(char.yaw + w.recoilY * DEG * rs, char.pitch + w.recoilP * DEG * rs, _base);
  const origin = char.eyePos();
  const pellets = def.pellets || 1;
  for (let i = 0; i < pellets; i++) {
    spreadDir(_base, spread, _dir);
    world.traceShot(char, origin, _dir.clone(), def);
  }
  // Accumulate recoil for the next shot
  const rec = def.recoil;
  const zoomK = opts.zoomed && !def.scope ? 0.85 : 1;
  if (w.spray < rec.climb) {
    w.recoilP += rec.vert * zoomK;
    w.recoilY += (Math.random() - 0.5) * rec.horiz * 0.5;
  } else {
    if (Math.random() < 0.18) w.sideDir *= -1;
    w.recoilY += w.sideDir * rec.horiz * zoomK * (0.6 + Math.random() * 0.8);
    w.recoilY = clamp(w.recoilY, -rec.horiz * 8, rec.horiz * 8);
    w.recoilP += rec.vert * 0.12 * (Math.random() - 0.3);
  }
  w.spray++;
  w.lastShot = now;
  char.lastFire = now;
  if (w.ammo === 0 && w.reserve > 0 && def.reload) w.startReload(now + 0.05);
  world.onWeaponFired(char, def);
  return true;
}

export function weaponDamage(def, dist, part) {
  let row = def.dmg[def.dmg.length - 1];
  for (const r of def.dmg) if (dist <= r[0]) { row = r; break; }
  return part === 'head' ? row[1] : part === 'body' ? row[2] : row[3];
}
