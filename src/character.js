import * as THREE from 'three';
import { MOVE, AGENTS, COLORS, WEAPONS } from './config.js';
import { Weapon } from './weapons.js';
import { CharacterModel } from './models.js';
import { lerp, raySphere, rayCylinder, dirFromAngles } from './utils.js';

let markerTex = null;
function getMarkerTexture() {
  if (markerTex) return markerTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ff4655';
  g.strokeStyle = '#fff';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(32, 4); g.lineTo(58, 32); g.lineTo(32, 60); g.lineTo(6, 32); g.closePath();
  g.fill(); g.stroke();
  markerTex = new THREE.CanvasTexture(c);
  markerTex.colorSpace = THREE.SRGBColorSpace;
  return markerTex;
}

export class Character {
  constructor(world, { id, name, squad, agentId, isPlayer = false }) {
    this.world = world;
    this.id = id;
    this.name = name;
    this.squad = squad;
    this.agentId = agentId;
    this.isPlayer = isPlayer;

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;
    this.crouching = false;
    this.crouchT = 0;
    this.walking = false;

    this.hp = 100;
    this.armor = 0;
    this.alive = true;
    this.credits = 800;
    this.kills = 0;
    this.deaths = 0;
    this.assists = 0;
    this.ult = 0;
    this.charges = { C: 0, Q: 0, E: 0 };

    this.slots = { primary: null, secondary: new Weapon('classic'), melee: new Weapon('knife'), special: null };
    this.slot = 'secondary';
    this.equipEnd = 0;
    this.lastFire = -9;
    this.hasSpike = false;
    this.action = null;
    this.blindUntil = 0;
    this.blindStart = 0;
    this.revealedUntil = 0;
    this.slowUntil = 0;
    this.tagUntil = 0;
    this.stimUntil = 0;
    this.overdriveUntil = 0;
    this.healRate = 0;
    this.healUntil = 0;
    this.dash = null;
    this.damageLog = new Map();
    this.lastStep = 0;
    this.deathT = 0;
    this.killedBy = null;
    this.landDip = 0;
    this.fallSpeed = 0;
    // match stats
    this.damageDealt = 0;
    this.roundDamage = 0;
    this.roundKills = 0;
    this.shots = 0;
    this.hits = 0;
    this.headHits = 0;
    this.firstBloods = 0;
    this.plants = 0;
    this.defuses = 0;

    const color = squad === world.playerSquad ? COLORS.ally : COLORS.enemy;
    this.model = new CharacterModel(color, AGENTS[agentId].color);
    this.model.root.rotation.order = 'YXZ';
    world.scene.add(this.model.root);

    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: getMarkerTexture(), depthTest: false, transparent: true }));
    this.marker.scale.set(0.45, 0.45, 1);
    this.marker.renderOrder = 999;
    this.marker.visible = false;
    world.scene.add(this.marker);
  }

  get team() { return this.world.match.sideOf(this.squad); }
  get agent() { return AGENTS[this.agentId]; }
  get weapon() { return this.slots[this.slot] || this.slots.secondary || this.slots.melee; }
  get isEnemyOfPlayer() { return this.squad !== this.world.playerSquad; }

  isEnemy(other) { return other.squad !== this.squad; }

  eyeHeight() { return lerp(MOVE.eye, MOVE.crouchEye, this.crouchT); }
  eyePos(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.eyeHeight(), this.pos.z); }
  chestPos(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + lerp(1.2, 0.85, this.crouchT), this.pos.z); }
  headPos(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + lerp(1.6, 1.15, this.crouchT), this.pos.z); }
  forward(out = new THREE.Vector3()) { return dirFromAngles(this.yaw, this.pitch, out); }

  bestSlot() { return this.slots.special ? 'special' : this.slots.primary ? 'primary' : 'secondary'; }

  equip(slot) {
    if (!this.slots[slot] || slot === this.slot) return false;
    this.weapon.cancelReload();
    this.slot = slot;
    this.equipEnd = this.world.time + (this.weapon.def.equip || 0.5);
    this.weapon.spray = 0;
    this.world.audio.equip(this);
    return true;
  }

  giveWeapon(id) {
    const w = new Weapon(id);
    const slot = WEAPONS[id].slot;
    const old = this.slots[slot];
    this.slots[slot] = w;
    return { weapon: w, old };
  }

  fireRateMult() {
    const t = this.world.time;
    return (t < this.stimUntil ? 1.15 : 1) * (t < this.overdriveUntil ? 1.3 : 1);
  }

  maxSpeed() {
    const t = this.world.time;
    if (this.action) return 0;
    let s = MOVE.run;
    const def = this.weapon.def;
    s *= def.speedMult || (def.type === 'melee' ? MOVE.knifeMult : 1);
    if (this.crouchT > 0.5 && this.onGround) s *= MOVE.crouchMult;
    else if (this.walking) s *= MOVE.walkMult;
    if (t < this.slowUntil) s *= 0.5;
    if (t < this.tagUntil) s *= 0.55;
    if (t < this.stimUntil) s *= 1.1;
    if (this.zoomed && def.scope) s *= 0.75;
    return s;
  }

  physics(dt, wx, wz, jump) {
    const t = this.world.time;
    if (!this.alive) return;
    if (this.dash && t < this.dash.until) {
      this.vel.x = this.dash.x;
      this.vel.z = this.dash.z;
      if (this.vel.y < 0) this.vel.y = 0;
    } else {
      this.dash = null;
      const max = this.maxSpeed();
      const k = 1 - Math.exp(-(this.onGround ? MOVE.accel : MOVE.airAccel) * dt);
      this.vel.x += (wx * max - this.vel.x) * k;
      this.vel.z += (wz * max - this.vel.z) * k;
      if (jump && this.onGround && !this.action) {
        this.vel.y = MOVE.jump;
        this.onGround = false;
        this.world.audio.jump(this);
      }
      this.vel.y -= MOVE.gravity * dt;
    }
    const wasGround = this.onGround;
    if (!wasGround) this.fallSpeed = Math.min(this.fallSpeed, this.vel.y);
    const dx = this.vel.x * dt, dy = this.vel.y * dt, dz = this.vel.z * dt;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.2));
    for (let i = 0; i < steps; i++) {
      this.moveAxis('x', dx / steps);
      this.moveAxis('z', dz / steps);
      this.onGround = false;
      this.moveAxis('y', dy / steps);
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        if (this.vel.y < 0) this.vel.y = 0;
        this.onGround = true;
      }
    }
    if (!wasGround && this.onGround) {
      const v = -this.fallSpeed;
      if (v > 3.5) {
        this.landDip = Math.min(0.15, Math.max(0.03, v * 0.011));
        this.world.onLand?.(this, v);
      }
      this.fallSpeed = 0;
    } else if (this.onGround) this.fallSpeed = 0;
  }

  moveAxis(axis, d) {
    if (d === 0 && axis !== 'y') return;
    const p = this.pos;
    p[axis] += d;
    const r = MOVE.radius;
    const h = this.crouchT > 0.5 ? MOVE.crouchHeight : MOVE.height;
    this.world.map.forEachBox(p.x - r, p.x + r, p.z - r, p.z + r, this.team, (x0, x1, z0, z1, bh) => {
      if (p.x + r <= x0 || p.x - r >= x1 || p.z + r <= z0 || p.z - r >= z1) return;
      if (p.y >= bh - 1e-3 || p.y + h <= 0) return;
      if (axis === 'x') { p.x = d > 0 ? x0 - r - 1e-3 : x1 + r + 1e-3; this.vel.x = 0; }
      else if (axis === 'z') { p.z = d > 0 ? z0 - r - 1e-3 : z1 + r + 1e-3; this.vel.z = 0; }
      else if (d <= 0) {
        if (bh - p.y < 0.5) { p.y = bh; if (this.vel.y < 0) this.vel.y = 0; this.onGround = true; }
      } else { this.vel.y = 0; p.y -= d; }
    });
  }

  hitTest(o, d, maxT) {
    if (!this.alive) return null;
    const cx = this.pos.x, cy = this.pos.y + 0.9, cz = this.pos.z;
    const t0 = (cx - o.x) * d.x + (cy - o.y) * d.y + (cz - o.z) * d.z;
    if (t0 < -1.5 || t0 > maxT + 1.5) return null;
    const px = o.x + d.x * t0 - cx, py = o.y + d.y * t0 - cy, pz = o.z + d.z * t0 - cz;
    if (px * px + py * py + pz * pz > 2.0) return null;
    const c = this.crouchT;
    const headY = this.pos.y + lerp(1.6, 1.15, c);
    const bodyTop = this.pos.y + lerp(1.45, 1.0, c);
    const bodyBot = this.pos.y + lerp(0.85, 0.55, c);
    let best = null;
    const th = raySphere(o, d, { x: cx, y: headY, z: cz }, 0.19);
    if (th >= 0 && th < maxT) best = { t: th, part: 'head' };
    const tb = rayCylinder(o, d, cx, cz, 0.28, bodyBot, bodyTop);
    if (tb >= 0 && tb < maxT && (!best || tb < best.t - 0.02)) best = { t: tb, part: 'body' };
    const tl = rayCylinder(o, d, cx, cz, 0.21, this.pos.y, bodyBot);
    if (tl >= 0 && tl < maxT && (!best || tl < best.t)) best = { t: tl, part: 'leg' };
    return best;
  }

  takeDamage(amount, attacker, info = {}) {
    if (!this.alive || amount <= 0) return;
    if (this.world.match.phase === 'buy') return;
    let dmg = amount;
    const effective = Math.min(amount, this.hp + this.armor);
    const absorbed = Math.min(this.armor, dmg);
    this.armor -= absorbed;
    dmg -= absorbed;
    this.hp -= dmg;
    this.model.flash(0.9);
    if (attacker && attacker !== this) {
      this.damageLog.set(attacker.id, this.world.time);
      if (attacker.squad !== this.squad) {
        attacker.damageDealt += effective;
        attacker.roundDamage += effective;
      }
    }
    if (info.tag !== false) this.tagUntil = this.world.time + 0.25;
    this.world.onDamage(this, attacker, amount, info);
    if (this.hp <= 0) this.die(attacker, info);
  }

  heal(amount, cap = 100) {
    if (!this.alive) return;
    this.hp = Math.min(cap, this.hp + amount);
  }

  die(attacker, info) {
    this.alive = false;
    this.hp = 0;
    this.deaths++;
    this.action = null;
    this.deathT = 0;
    this.killedBy = attacker ? { name: attacker.name, weapon: info.weaponName } : null;
    this.ult = Math.min(this.ult + 1, this.agent.abilities.X.ult);
    this.world.onKill(this, attacker, info);
  }

  resetForRound(spawn, keepGear) {
    this.alive = true;
    this.hp = 100;
    if (!keepGear) {
      this.slots.primary = null;
      this.slots.secondary = new Weapon('classic');
      this.armor = 0;
    } else {
      for (const k of ['primary', 'secondary']) this.slots[k]?.refill();
    }
    this.slots.special = null;
    this.slots.melee = new Weapon('knife');
    this.slot = this.bestSlot();
    this.equipEnd = 0;
    this.pos.copy(spawn);
    this.vel.set(0, 0, 0);
    this.pitch = 0;
    this.crouching = false;
    this.crouchT = 0;
    this.blindUntil = this.revealedUntil = this.slowUntil = this.tagUntil = this.stimUntil = this.overdriveUntil = 0;
    this.healUntil = 0;
    this.action = null;
    this.hasSpike = false;
    this.dash = null;
    this.zoomed = false;
    this.damageLog.clear();
    this.killedBy = null;
    this.deathT = 0;
    this.landDip = 0;
    this.fallSpeed = 0;
    this.roundKills = 0;
    this.roundDamage = 0;
    this.model.resetFlash();
    const free = this.agent.abilities.E.free || 0;
    this.charges.E = Math.max(this.charges.E, free);
    this.model.root.rotation.x = 0;
    this.model.root.visible = true;
  }

  update(dt) {
    const t = this.world.time;
    for (const w of Object.values(this.slots)) w?.update(dt, t);
    if (!this.alive) {
      this.deathT += dt;
      this.updateModel(dt);
      return;
    }
    if (t < this.healUntil) this.heal(this.healRate * dt);
    this.landDip *= Math.exp(-10 * dt);
    this.crouchT += ((this.crouching ? 1 : 0) - this.crouchT) * Math.min(1, dt * 12);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && speed > 3.6 && !this.walking && t - this.lastStep > 0.34) {
      this.lastStep = t;
      this.world.onFootstep(this);
    }
    this.updateModel(dt);
  }

  updateModel(dt) {
    const m = this.model;
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    if (!this.alive) {
      const k = Math.min(1, this.deathT * 3.5);
      m.root.rotation.x = k * Math.PI / 2 * 0.95;
      m.root.position.y = this.pos.y + 0.15 * k;
      this.marker.visible = false;
      m.tickFlash(dt);
      return;
    }
    m.setGun(this.hasSpike && this.action?.type === 'plant' ? 'spike' : this.weapon.id);
    m.update(dt, {
      speed: Math.hypot(this.vel.x, this.vel.z),
      crouchT: this.crouchT,
      pitch: this.pitch,
      onGround: this.onGround,
    });
    const revealed = this.world.time < this.revealedUntil && this.isEnemyOfPlayer;
    this.marker.visible = revealed;
    if (revealed) this.marker.position.set(this.pos.x, this.pos.y + 2.25, this.pos.z);
  }
}
