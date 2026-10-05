import * as THREE from 'three';
import { Weapon } from './weapons.js';
import { clamp, dirFromAngles } from './utils.js';
import { flatMat, disposeTree } from './models.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class AbilitySystem {
  constructor(world) {
    this.world = world;
    this.smokes = [];
    this.fires = [];
    this.slowFields = [];
    this.traps = [];
    this.projectiles = [];
    this.strikes = [];
    this.recons = [];
    this.beams = [];
  }

  get time() { return this.world.time; }
  get scene() { return this.world.scene; }

  // Remove an effect mesh from the scene and free its GPU buffers.
  drop(obj) {
    this.scene.remove(obj);
    disposeTree(obj);
  }

  clear() {
    for (const list of [this.smokes, this.fires, this.slowFields, this.traps, this.projectiles, this.strikes, this.recons, this.beams]) {
      for (const o of list) if (o.mesh) this.drop(o.mesh);
      list.length = 0;
    }
  }

  cost(char, key) {
    return key === 'X' ? char.agent.abilities.X.ult : 1;
  }

  canUse(char, key) {
    if (!char.alive || char.action) return false;
    if (this.world.match.phase !== 'combat') return false;
    if (key === 'X') return char.ult >= char.agent.abilities.X.ult;
    return char.charges[key] > 0;
  }

  use(char, key, target = null) {
    if (!this.canUse(char, key)) return false;
    const ab = char.agent.abilities[key];
    const fn = this[ab.id];
    if (!fn) return false;
    const ok = fn.call(this, char, target);
    if (!ok) return false;
    if (key === 'X') {
      char.ult = 0;
      this.world.audio.ability('ult', char.pos);
      this.world.hud?.announceUlt(char, ab.name);
    } else char.charges[key]--;
    return true;
  }

  // ---------- helpers ----------
  aimDir(char, target) {
    if (target) return _w.subVectors(target, char.eyePos(_v)).normalize().clone();
    return char.forward();
  }

  aimPoint(char, maxDist, target) {
    if (target) return target.clone();
    const o = char.eyePos();
    const d = char.forward();
    const hit = this.world.map.raycast(o, d, maxDist);
    if (hit) return hit.point.addScaledVector(hit.normal, 0.4);
    return o.addScaledVector(d, maxDist);
  }

  groundBelow(p) {
    const hit = this.world.map.raycast(new THREE.Vector3(p.x, Math.max(p.y, 0.2), p.z), new THREE.Vector3(0, -1, 0), 20);
    return hit ? hit.point : new THREE.Vector3(p.x, 0, p.z);
  }

  lobVel(char, target, speed = 16, g = 18) {
    const from = char.eyePos();
    if (target) {
      const dx = target.x - from.x, dz = target.z - from.z, dy = target.y - from.y;
      const horiz = Math.hypot(dx, dz);
      const T = clamp(horiz / 15, 0.35, 1.6);
      return new THREE.Vector3(dx / T, (dy + 0.5 * g * T * T) / T, dz / T);
    }
    return char.forward().multiplyScalar(speed).add(new THREE.Vector3(0, 3, 0)).addScaledVector(char.vel, 0.3);
  }

  projectile(char, vel, { gravity = 18, bounce = 0, fuse = 5, landOnFloor = false, stick = false, color = '#ffffff', size = 0.1, onEnd }) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), flatMat(color, { emissive: color, emissiveIntensity: 0.8 }));
    const pos = char.eyePos().addScaledVector(char.forward(), 0.4);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.projectiles.push({ owner: char, pos, vel, gravity, bounce, end: this.time + fuse, landOnFloor, stick, onEnd, mesh });
    this.world.audio.ability('throw', pos);
    return true;
  }

  enemiesOf(char) { return this.world.chars.filter((c) => c.alive && c.squad !== char.squad); }
  alliesOf(char) { return this.world.chars.filter((c) => c.alive && c.squad === char.squad); }

  addSmoke(pos, radius, duration, color = '#b9b0cf') {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: true });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), mat);
    g.add(core);
    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * (0.35 + Math.random() * 0.2), 0), mat);
      const a = Math.random() * Math.PI * 2;
      puff.position.set(Math.cos(a) * radius * 0.75, (Math.random() - 0.2) * radius * 0.6, Math.sin(a) * radius * 0.75);
      g.add(puff);
    }
    const c = pos.clone();
    c.y = Math.max(c.y, radius * 0.45);
    g.position.copy(c);
    this.scene.add(g);
    this.smokes.push({ pos: c, radius, start: this.time, end: this.time + duration, mesh: g, mat });
    this.world.audio.ability('smoke', c);
  }

  blind(char, dur) {
    if (!char.alive) return;
    const t = this.time;
    if (t + dur > char.blindUntil) {
      char.blindUntil = t + dur;
      char.blindStart = t;
      char.blindDur = dur;
    }
  }

  reveal(char, dur) {
    char.revealedUntil = Math.max(char.revealedUntil, this.time + dur);
    this.world.onReveal?.(char);
  }

  flashAt(pos, owner) {
    this.world.effects.blast(pos, 2.5, 0xffffff, 0.25);
    this.world.audio.ability('flash', pos);
    for (const c of this.enemiesOf(owner)) {
      const eye = c.eyePos();
      const to = _v.subVectors(pos, eye);
      const dist = to.length();
      if (dist > 45) continue;
      if (!this.world.map.lineOfSight(eye, pos) || this.smokeBlocks(eye, pos)) continue;
      to.divideScalar(dist);
      const dot = c.forward(_w).dot(to);
      const dur = dot > 0.55 ? 2.2 : dot > 0.1 ? 1.3 : 0.3;
      this.blind(c, dur);
    }
  }

  explode(pos, radius, dmg, owner, name) {
    for (const c of this.enemiesOf(owner)) {
      const chest = c.chestPos();
      const d = chest.distanceTo(pos);
      if (d > radius) continue;
      const lifted = pos.clone(); lifted.y += 0.3;
      if (!this.world.map.lineOfSight(lifted, chest)) continue;
      c.takeDamage(Math.round(dmg * (1 - (d / radius) * 0.6)), owner, { weaponName: name, ability: true });
    }
  }

  smokeBlocks(a, b) {
    if (!this.smokes.length) return false;
    const d = _w.subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return false;
    d.divideScalar(len);
    for (const s of this.smokes) {
      if (this.time - s.start < 0.4) continue;
      const r = s.radius * 0.92;
      const t = clamp((s.pos.x - a.x) * d.x + (s.pos.y - a.y) * d.y + (s.pos.z - a.z) * d.z, 0, len);
      const px = a.x + d.x * t - s.pos.x, py = a.y + d.y * t - s.pos.y, pz = a.z + d.z * t - s.pos.z;
      if (px * px + py * py + pz * pz < r * r) return true;
    }
    return false;
  }

  inSmoke(p) {
    for (const s of this.smokes) if (p.distanceTo(s.pos) < s.radius * 0.95) return true;
    return false;
  }

  // ---------- ability implementations ----------
  updraft(char) {
    char.vel.y = 11.5;
    char.onGround = false;
    this.world.audio.ability('dash', char.pos);
    return true;
  }

  tailwind(char, target) {
    let dx = char.vel.x, dz = char.vel.z;
    if (target) { dx = target.x - char.pos.x; dz = target.z - char.pos.z; }
    let len = Math.hypot(dx, dz);
    if (len < 0.5) { const f = dirFromAngles(char.yaw, 0); dx = f.x; dz = f.z; len = 1; }
    char.dash = { x: (dx / len) * 26, z: (dz / len) * 26, until: this.time + 0.22 };
    this.world.audio.ability('dash', char.pos);
    this.world.effects.burst(char.pos.clone().setY(char.pos.y + 0.5), 0xdff4ff, 10, 4, 0.4, 2);
    return true;
  }

  cloudburst(char, target) {
    const vel = this.aimDir(char, target).multiplyScalar(22);
    return this.projectile(char, vel, {
      gravity: 5, fuse: 0.9, color: '#dff4ff', size: 0.15,
      onEnd: (p) => this.addSmoke(p, 3.2, 5.5, '#dbe8f2'),
    });
  }

  bladestorm(char) {
    char.slots.special = new Weapon('knives');
    char.slot = 'special';
    char.equipEnd = this.time + 0.4;
    return true;
  }

  hothands(char, target) {
    return this.projectile(char, this.lobVel(char, target), {
      gravity: 18, bounce: 0.35, fuse: 3, landOnFloor: true, color: '#ff8a3a', size: 0.14,
      onEnd: (p) => this.addFire(this.groundBelow(p), char),
    });
  }

  addFire(pos, owner) {
    const g = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.35 + Math.random() * 0.3, 0.8 + Math.random() * 0.9, 4), flatMat(i % 2 ? '#ff7a2a' : '#ffc040', { emissive: i % 2 ? '#ff5010' : '#ff9a20', emissiveIntensity: 1.2 }));
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 2.8;
      cone.position.set(Math.cos(a) * r, 0.4, Math.sin(a) * r);
      g.add(cone);
    }
    g.position.copy(pos);
    this.scene.add(g);
    this.fires.push({ pos: pos.clone(), radius: 3.2, end: this.time + 4, owner, mesh: g, dps: 45 });
    this.world.audio.ability('fire', pos);
  }

  curveball(char, target) {
    const vel = this.aimDir(char, target).multiplyScalar(16);
    return this.projectile(char, vel, {
      gravity: 0, fuse: 0.45, color: '#fff3c0', size: 0.12,
      onEnd: (p) => this.flashAt(p, char),
    });
  }

  flare(char, target) { return this.curveball(char, target); }

  warmth(char) {
    if (char.hp >= 100) return false;
    char.healRate = 15;
    char.healUntil = this.time + 4;
    this.world.audio.ability('heal', char.pos);
    return true;
  }

  mend(char) { return this.warmth(char); }

  overdrive(char) {
    char.hp = 100;
    char.overdriveUntil = this.time + 10;
    return true;
  }

  stim(char) {
    for (const a of this.alliesOf(char)) if (a.pos.distanceTo(char.pos) < 9) a.stimUntil = this.time + 8;
    this.world.effects.blast(char.pos.clone().setY(1), 9, 0x9d7bff, 0.5);
    this.world.audio.ability('heal', char.pos);
    return true;
  }

  nearsight(char) {
    const eye = char.eyePos();
    const fwd = dirFromAngles(char.yaw, 0);
    for (const c of this.enemiesOf(char)) {
      const ce = c.eyePos();
      const to = _v.subVectors(ce, eye);
      const d = to.length();
      if (d > 24) continue;
      to.y = 0; to.normalize();
      if (to.dot(fwd) < 0.64) continue;
      if (!this.world.map.lineOfSight(eye, ce)) continue;
      this.blind(c, 2.6);
    }
    this.world.effects.blast(eye.clone().addScaledVector(fwd, 5), 6, 0x6a4bd8, 0.5);
    this.world.audio.ability('zap', eye);
    return true;
  }

  shroud(char, target) {
    const p = this.aimPoint(char, 55, target);
    const g = this.groundBelow(p);
    this.addSmoke(new THREE.Vector3(p.x, g.y + 2.0, p.z), 4.2, 15, '#8f84b8');
    return true;
  }

  orbital(char, target) {
    const p = this.aimPoint(char, 70, target);
    const g = this.groundBelow(p);
    const ring = new THREE.Mesh(new THREE.RingGeometry(5.2, 5.8, 16), new THREE.MeshBasicMaterial({ color: 0xff3040, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(g.x, g.y + 0.05, g.z);
    this.scene.add(ring);
    this.strikes.push({ pos: g.clone(), at: this.time + 1.6, owner: char, radius: 5.8, dmg: 150, mesh: ring });
    return true;
  }

  shockdart(char, target) {
    const vel = target ? this.lobVel(char, target, 30, 12) : this.aimDir(char, null).multiplyScalar(30);
    return this.projectile(char, vel, {
      gravity: 12, fuse: 4, stick: true, color: '#7fe8ff', size: 0.1,
      onEnd: (p) => {
        this.world.effects.blast(p, 4, 0x7fe8ff, 0.4);
        this.world.audio.ability('zap', p);
        this.explode(p, 4.2, 80, char, 'Shock Dart');
      },
    });
  }

  recon(char, target) {
    const vel = target ? this.lobVel(char, target, 30, 12) : this.aimDir(char, null).multiplyScalar(30);
    return this.projectile(char, vel, {
      gravity: 12, fuse: 4, stick: true, color: '#6fe0b0', size: 0.12,
      onEnd: (p) => {
        const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.25, 0), flatMat('#6fe0b0', { emissive: '#3fd090', emissiveIntensity: 1.5 }));
        mesh.position.copy(p);
        this.scene.add(mesh);
        this.recons.push({ pos: p.clone(), owner: char, next: this.time + 0.3, pulses: 3, mesh });
      },
    });
  }

  fury(char, target) {
    const o = char.eyePos();
    const d = this.aimDir(char, target);
    const len = 90;
    for (const c of this.enemiesOf(char)) {
      const ch = c.chestPos();
      const t = clamp((ch.x - o.x) * d.x + (ch.y - o.y) * d.y + (ch.z - o.z) * d.z, 0, len);
      const px = o.x + d.x * t - ch.x, py = o.y + d.y * t - ch.y, pz = o.z + d.z * t - ch.z;
      if (px * px + py * py + pz * pz < 1.4 * 1.4) {
        c.takeDamage(80, char, { weaponName: "Hunter's Fury", ability: true });
        this.reveal(c, 3);
      }
    }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, len, 6), new THREE.MeshBasicMaterial({ color: 0x6fffd0, transparent: true, opacity: 0.85 }));
    beam.position.copy(o).addScaledVector(d, len / 2);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    this.scene.add(beam);
    this.beams.push({ mesh: beam, end: this.time + 0.6 });
    this.world.audio.ability('zap', o);
    return true;
  }

  tripwire(char, target) {
    const p = this.aimPoint(char, 12, target);
    const g = this.groundBelow(p);
    if (g.distanceTo(char.pos) > 14) return false;
    const mesh = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.12, 6), flatMat('#f2e27a', { emissive: '#f2c02a', emissiveIntensity: 0.6 }));
    base.position.y = 0.06;
    mesh.add(base);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.6, 20), new THREE.MeshBasicMaterial({ color: 0xf2e27a, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    mesh.add(ring);
    mesh.position.copy(g);
    mesh.visible = char.squad === this.world.playerSquad;
    this.scene.add(mesh);
    this.traps.push({ pos: g.clone(), owner: char, armed: this.time + 1, mesh });
    this.world.audio.ability('trap', g);
    return true;
  }

  slowfield(char, target) {
    return this.projectile(char, this.lobVel(char, target), {
      gravity: 18, bounce: 0.3, fuse: 3, landOnFloor: true, color: '#a8d8ff', size: 0.13,
      onEnd: (p) => {
        const g = this.groundBelow(p);
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.3, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
        mesh.position.set(g.x, g.y + 0.15, g.z);
        this.scene.add(mesh);
        this.slowFields.push({ pos: g.clone(), radius: 5, end: this.time + 6, owner: char, mesh });
        this.world.audio.ability('smoke', g);
      },
    });
  }

  resurrect(char) {
    let best = null, bd = 12;
    for (const c of this.world.chars) {
      if (c.alive || c.squad !== char.squad || c === char) continue;
      const d = c.pos.distanceTo(char.pos);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return false;
    best.alive = true;
    best.hp = 100;
    best.armor = 0;
    best.deathT = 0;
    best.model.root.rotation.x = 0;
    best.slot = best.bestSlot();
    best.equipEnd = this.time + 1;
    this.world.onRevive?.(best, char);
    this.world.effects.blast(best.pos.clone().setY(1), 3, 0xf2e27a, 0.8);
    return true;
  }

  // ---------- simulation ----------
  update(dt) {
    const t = this.time;
    const map = this.world.map;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.vel.y -= p.gravity * dt;
      const step = p.vel.clone().multiplyScalar(dt);
      const len = step.length();
      let ended = false;
      if (len > 1e-5) {
        const dir = step.clone().divideScalar(len);
        const hit = map.raycast(p.pos, dir, len);
        if (hit) {
          if (p.stick || (p.landOnFloor && hit.normal.y > 0.7) || (!p.bounce && !p.landOnFloor)) {
            p.pos.copy(hit.point).addScaledVector(hit.normal, 0.15);
            ended = true;
          } else {
            const vn = p.vel.dot(hit.normal);
            p.vel.addScaledVector(hit.normal, -2 * vn).multiplyScalar(p.bounce || 0.5);
            p.pos.copy(hit.point).addScaledVector(hit.normal, 0.05);
          }
        } else p.pos.add(step);
      }
      if (ended || t >= p.end || p.pos.y < -2) {
        this.drop(p.mesh);
        this.projectiles.splice(i, 1);
        if (p.pos.y < 0.1) p.pos.y = 0.1;
        p.onEnd?.(p.pos);
        continue;
      }
      p.mesh.position.copy(p.pos);
    }

    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      const age = t - s.start, left = s.end - t;
      s.mat.opacity = Math.min(1, age / 0.4) * Math.min(1, left / 0.8) * 0.97;
      s.mesh.scale.setScalar(Math.min(1, 0.4 + age * 1.8));
      s.mesh.rotation.y += dt * 0.08;
      if (left <= 0) { this.drop(s.mesh); this.smokes.splice(i, 1); }
    }

    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.mesh.children.forEach((c, k) => { c.scale.y = 0.7 + Math.abs(Math.sin(t * 9 + k * 1.7)) * 0.6; });
      for (const c of this.world.chars) {
        if (!c.alive || Math.abs(c.pos.y - f.pos.y) > 1.5) continue;
        const d = Math.hypot(c.pos.x - f.pos.x, c.pos.z - f.pos.z);
        if (d > f.radius) continue;
        if (c === f.owner) c.heal(12 * dt);
        else if (c.squad !== f.owner.squad) {
          f.acc = (f.acc || 0);
          c.fireAcc = (c.fireAcc || 0) + f.dps * dt;
          if (c.fireAcc >= 5) { c.takeDamage(Math.floor(c.fireAcc), f.owner, { weaponName: 'Hot Hands', ability: true, tag: false }); c.fireAcc %= 1; }
        }
      }
      if (t >= f.end) { this.drop(f.mesh); this.fires.splice(i, 1); }
    }

    for (let i = this.slowFields.length - 1; i >= 0; i--) {
      const s = this.slowFields[i];
      for (const c of this.world.chars) {
        if (!c.alive || c.squad === s.owner.squad) continue;
        if (Math.hypot(c.pos.x - s.pos.x, c.pos.z - s.pos.z) < s.radius && c.pos.y - s.pos.y < 2) c.slowUntil = t + 0.15;
      }
      s.mesh.material.opacity = 0.2 + Math.sin(t * 4) * 0.08;
      if (t >= s.end) { this.drop(s.mesh); this.slowFields.splice(i, 1); }
    }

    for (let i = this.traps.length - 1; i >= 0; i--) {
      const tr = this.traps[i];
      if (t < tr.armed || !tr.owner) continue;
      for (const c of this.enemiesOf(tr.owner)) {
        if (Math.hypot(c.pos.x - tr.pos.x, c.pos.z - tr.pos.z) < 1.6 && Math.abs(c.pos.y - tr.pos.y) < 1.5) {
          this.reveal(c, 4);
          c.slowUntil = t + 3;
          this.world.audio.ability('trap', tr.pos);
          this.world.effects.blast(tr.pos.clone().setY(0.5), 1.8, 0xf2e27a, 0.4);
          this.world.onTrapTriggered?.(tr, c);
          this.drop(tr.mesh);
          this.traps.splice(i, 1);
          break;
        }
      }
    }

    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.mesh.material.opacity = 0.4 + Math.abs(Math.sin(t * 12)) * 0.5;
      if (t >= s.at) {
        this.world.effects.blast(s.pos.clone().setY(1.5), s.radius + 1, 0xff5a3a, 0.9);
        this.world.audio.explosion(s.pos);
        for (const c of this.enemiesOf(s.owner)) {
          const d = Math.hypot(c.pos.x - s.pos.x, c.pos.z - s.pos.z);
          if (d < s.radius) c.takeDamage(s.dmg, s.owner, { weaponName: 'Orbital Strike', ability: true });
        }
        this.drop(s.mesh);
        this.strikes.splice(i, 1);
      }
    }

    for (let i = this.recons.length - 1; i >= 0; i--) {
      const r = this.recons[i];
      r.mesh.rotation.y += dt * 3;
      if (t >= r.next) {
        r.next = t + 1;
        r.pulses--;
        this.world.effects.blast(r.pos, 3, 0x6fe0b0, 0.5);
        this.world.audio.ability('reveal', r.pos);
        for (const c of this.enemiesOf(r.owner)) {
          const ce = c.chestPos();
          if (ce.distanceTo(r.pos) < 30 && this.world.map.lineOfSight(r.pos, ce) && !this.smokeBlocks(r.pos, ce)) this.reveal(c, 2);
        }
        if (r.pulses <= 0) { this.drop(r.mesh); this.recons.splice(i, 1); }
      }
    }

    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.mesh.material.opacity = Math.max(0, (b.end - t) / 0.6) * 0.85;
      if (t >= b.end) { this.drop(b.mesh); this.beams.splice(i, 1); }
    }
  }
}
