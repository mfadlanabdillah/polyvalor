import * as THREE from 'three';
import { DIFFICULTY, ROUND, WEAPONS, PENETRATION } from './config.js';
import { fireWeapon } from './weapons.js';
import { DEG, clamp, rand, pick, shuffle, wrapAngle, anglesFromDir, dirFromAngles } from './utils.js';

const _v = new THREE.Vector3();
const _e = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Team-level coordination: attack plan, defender assignments and shared intel.
// ---------------------------------------------------------------------------
export class TeamBrain {
  constructor(world) {
    this.world = world;
    this.intel = [new Map(), new Map()]; // per squad: enemyId -> { pos, time }
    this.reset();
  }

  reset() {
    this.atkSite = pick(['A', 'B']);
    this.executeAt = Infinity;
    this.executed = false;
    this.hotSite = null;
    this.rotated = false;
    this.intel[0].clear();
    this.intel[1].clear();
  }

  report(squad, enemy, pos = enemy.pos, reporter = null) {
    const prev = this.intel[squad].get(enemy.id);
    this.intel[squad].set(enemy.id, { pos: pos.clone(), time: this.world.time, enemy });
    // Voice a callout the first time an enemy is (re)spotted
    if (reporter && (!prev || this.world.time - prev.time > 5)) this.world.onCallout?.(reporter, enemy, pos);
  }

  recentIntel(squad, maxAge = 4) {
    const out = [];
    for (const v of this.intel[squad].values()) {
      if (this.world.time - v.time < maxAge && v.enemy.alive) out.push(v);
    }
    return out;
  }

  onRoundStart() {
    this.reset();
    const w = this.world;
    const map = w.map;
    // Attackers: choose a site and roles
    const atkBots = w.bots.filter((b) => b.char.team === 'atk');
    shuffle(atkBots).forEach((b, i) => {
      b.role = i === 0 && Math.random() < 0.5 ? 'mid' : 'main';
      b.site = this.atkSite;
    });
    // Defenders: spread across sites
    const defBots = shuffle(w.bots.filter((b) => b.char.team === 'def'));
    const humanDef = w.player.team === 'def';
    const order = humanDef ? ['A', 'B', 'mid', 'B', 'A'] : ['A', 'B', 'A', 'B', 'mid'];
    const used = { A: 0, B: 0, mid: 0 };
    defBots.forEach((b, i) => {
      const area = order[i % order.length];
      this.assignHold(b, area, used[area]++);
    });
    this.mapRef = map;
  }

  assignHold(bot, area, index) {
    const map = this.world.map;
    const info = area === 'mid' ? map.poi.mid : map.poi.sites[area];
    const hold = info.holds[index % info.holds.length];
    bot.assign = area;
    bot.holdPos = map.randomWalkableNear(map.toWorld(hold[0], hold[1]), 1.2);
    const look = pick(info.defLook);
    bot.holdLook = map.toWorld(look[0], look[1], 1.5);
  }

  onCombatStart() {
    this.executeAt = this.world.time + rand(12, 24);
  }

  update() {
    const w = this.world;
    const m = w.match;
    if (m.phase !== 'combat') return;
    // Attack execute trigger
    if (!this.executed) {
      const atkSquad = m.squadOf('atk');
      const siteC = w.map.poi.sites[this.atkSite].center;
      const contact = this.recentIntel(atkSquad, 3).some((i) => i.pos.distanceTo(siteC) < 22);
      if (w.time >= this.executeAt || m.timer < 45 || contact || m.spike.state === 'planted') {
        this.executed = true;
        w.onExecute?.(this.atkSite);
      }
    }
    // Defender rotation
    if (!this.rotated && m.spike.state !== 'planted') {
      const defSquad = m.squadOf('def');
      const intel = this.recentIntel(defSquad, 5);
      for (const site of ['A', 'B']) {
        const c = w.map.poi.sites[site].center;
        const n = intel.filter((i) => i.pos.distanceTo(c) < 24).length;
        if (n >= 2) {
          this.hotSite = site;
          this.rotated = true;
          const defBots = w.bots.filter((b) => b.char.team === 'def' && b.char.alive && b.assign !== site);
          const mid = defBots.filter((b) => b.assign === 'mid');
          const others = defBots.filter((b) => b.assign !== 'mid');
          const rotators = [...mid, ...others.slice(0, 1)];
          rotators.forEach((b, k) => this.assignHold(b, site, 2 + k));
          break;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Individual bot controller
// ---------------------------------------------------------------------------
export class BotController {
  constructor(world, char, difficulty) {
    this.world = world;
    this.char = char;
    this.diff = DIFFICULTY[difficulty];
    this.reset();
  }

  reset() {
    this.path = [];
    this.pathIdx = 0;
    this.goalKey = '';
    this.repathAt = 0;
    this.target = null;
    this.targetVisible = false;
    this.targetSeenAt = -9;
    this.reactionEnd = 0;
    this.err = { y: 0, p: 0 };
    this.floorErr = { y: 0, p: 0, next: 0 };
    this.aimPart = 'chest';
    this.lastKnown = null;
    this.alert = null;
    this.burstLeft = 0;
    this.pauseUntil = 0;
    this.nextSemi = 0;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeUntil = 0;
    this.nextPerceive = 0;
    this.nextAbility = 0;
    this.buyDone = false;
    this.buyAt = this.world.time + rand(0.5, 4);
    this.stuckT = 0;
    this.stuckCount = 0;
    this.plantSpot = null;
    this.siteSpot = null;
    this.postSpot = null;
    this.usedExecUtil = false;
    this.trapPlaced = false;
    this.lookSway = Math.random() * 10;
    this.goalLook = null;
    this.chase = false;
    this.duck = false;
    this.wantsOrb = Math.random() < 0.45;
    this.wbBurst = 0;
    this.nextWb = 0;
    this.wbFor = -1;
    this.wbDecided = false;
  }

  onRoundStart() { this.reset(); }

  get t() { return this.world.time; }

  // ---------------- perception ----------------
  perceive() {
    const c = this.char;
    const w = this.world;
    const t = this.t;
    const eye = c.eyePos();
    const blinded = t < c.blindUntil;
    const fwd = dirFromAngles(c.yaw, 0);
    const halfFov = (this.diff.fov / 2) * DEG;
    let best = null, bestScore = Infinity;
    let curVisible = false;
    for (const e of w.chars) {
      if (!e.alive || e.squad === c.squad) continue;
      if (t < e.revealedUntil) w.brain.report(c.squad, e, e.pos, null);
      if (blinded) continue;
      const chest = e.chestPos(_e);
      const to = _v.subVectors(chest, eye);
      const d = to.length();
      if (d > 62) continue;
      const flat = Math.atan2(Math.abs(to.x * fwd.z - to.z * fwd.x), to.x * fwd.x + to.z * fwd.z);
      if (flat > halfFov && e !== this.target && d > 2.5) continue;
      const head = e.headPos();
      const seeChest = w.map.lineOfSight(eye, chest) && !w.abilities.smokeBlocks(eye, chest);
      const seeHead = !seeChest && w.map.lineOfSight(eye, head) && !w.abilities.smokeBlocks(eye, head);
      if (!seeChest && !seeHead) continue;
      w.brain.report(c.squad, e, e.pos, c);
      if (e === this.target) curVisible = true;
      const score = d * (e === this.target ? 0.6 : 1);
      if (score < bestScore) { bestScore = score; best = e; }
      e._headOnly = !seeChest;
    }
    if (best) {
      if (best !== this.target) {
        const recent = this.lastKnown && t - this.lastKnown.time < 1.2 && this.lastKnown.id === best.id;
        this.target = best;
        this.reactionEnd = t + (recent ? 0.08 : this.diff.reaction * rand(0.8, 1.35));
        const moving = Math.hypot(best.vel.x, best.vel.z) > 3 ? 1.35 : 1;
        const mag = this.diff.aimError * rand(0.6, 1.3) * moving * (recent ? 0.5 : 1);
        const a = Math.random() * Math.PI * 2;
        this.err = { y: Math.cos(a) * mag, p: Math.sin(a) * mag * 0.7 };
        this.aimPart = Math.random() < this.diff.headRatio ? 'head' : 'chest';
        this.duck = Math.random() < this.diff.duck;
        this.burstLeft = 0;
      }
      this.targetVisible = true;
      this.targetSeenAt = t;
      this.lastKnown = { pos: best.pos.clone(), time: t, id: best.id };
    } else {
      this.targetVisible = false;
      if (this.target && (t - this.targetSeenAt > 0.5 || !this.target.alive)) this.target = null;
    }
    void curVisible;
  }

  hear(pos, kind) {
    if (this.targetVisible) return;
    const t = this.t;
    this.alert = { pos: pos.clone(), until: t + (kind === 'shot' ? 2.5 : 1.6) };
  }

  onDamaged(attacker) {
    if (!attacker || attacker === this.char) return;
    if (!this.targetVisible) {
      this.lastKnown = { pos: attacker.pos.clone(), time: this.t, id: attacker.id };
      this.alert = { pos: attacker.eyePos(), until: this.t + 2 };
    }
    const c = this.char;
    // Low health escape with Tailwind
    if (c.hp < 55 && c.agentId === 'gale' && Math.random() < 0.6) {
      const away = _v.subVectors(c.pos, attacker.pos).setY(0).normalize();
      const side = new THREE.Vector3(-away.z, 0, away.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
      this.world.abilities.use(c, 'E', c.pos.clone().add(away.add(side).multiplyScalar(4)));
    }
  }

  // ---------------- buying ----------------
  buy() {
    this.buyDone = true;
    const w = this.world;
    const c = this.char;
    const m = w.match;
    const pistol = m.round === 1 || m.round === m.halfAt + 1;
    if (pistol) {
      const r = Math.random();
      if (r < 0.45) w.buyShield(c, 'light');
      else if (r < 0.75) w.buyWeapon(c, 'ghost');
      else w.buyWeapon(c, 'sheriff');
    } else if (!c.slots.primary) {
      const cr = c.credits;
      if (cr >= 5700 && Math.random() < (this.diff === DIFFICULTY.easy ? 0.05 : 0.15)) w.buyWeapon(c, 'operator');
      else if (cr >= 3900) w.buyWeapon(c, Math.random() < 0.5 ? 'vandal' : 'phantom');
      else if (cr >= 2900 && Math.random() < 0.6) w.buyWeapon(c, Math.random() < 0.5 ? 'vandal' : 'phantom');
      else if (cr >= 2450 && Math.random() < 0.5) w.buyWeapon(c, pick(['bulldog', 'guardian']));
      else if (cr >= 2000) w.buyWeapon(c, 'spectre');
      else if (cr >= 1300 && Math.random() < 0.4) w.buyWeapon(c, 'sheriff');
      else if (cr >= 1000 && Math.random() < 0.3) w.buyWeapon(c, 'marshal');
    }
    if (!pistol) {
      if (c.armor < 50 && c.credits >= 1000 + (c.slots.primary ? 0 : 400)) w.buyShield(c, 'heavy');
      else if (c.armor < 25 && c.credits >= 400) w.buyShield(c, 'light');
    }
    for (const key of ['E', 'Q', 'C']) {
      const ab = c.agent.abilities[key];
      let guard = 3;
      while (guard-- > 0 && c.charges[key] < ab.max && ab.cost <= c.credits && (pistol ? c.credits - ab.cost >= 0 : true)) {
        if (!w.buyAbility(c, key)) break;
      }
    }
    c.slot = c.bestSlot();
  }

  // ---------------- goals ----------------
  chooseGoal() {
    const w = this.world;
    const c = this.char;
    const m = w.match;
    const s = m.spike;
    const map = w.map;
    const brain = w.brain;
    const t = this.t;

    // Chase a recently seen enemy when being aggressive
    if (this.lastKnown && t - this.lastKnown.time < 3.5 && this.chase) {
      return { key: 'chase' + Math.floor(this.lastKnown.time), pos: this.lastKnown.pos, look: this.lastKnown.pos.clone().setY(1.4), walk: c.pos.distanceTo(this.lastKnown.pos) < 12 };
    }

    // Detour for a nearby ult orb (only some bots, never the Spike carrier or during the execute)
    if (this.wantsOrb && !c.hasSpike && c.ult < c.agent.abilities.X.ult && s.state !== 'planted' && !(c.team === 'atk' && brain.executed) && w.orbs.length) {
      let best = null, bd = 18;
      for (const o of w.orbs) {
        const d = Math.hypot(o.pos.x - c.pos.x, o.pos.z - c.pos.z);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) return { key: `orb${Math.round(best.pos.x)}_${Math.round(best.pos.z)}`, pos: best.pos };
    }

    if (c.team === 'atk') {
      if (s.state === 'planted') {
        if (!this.postSpot) this.postSpot = map.randomWalkableNear(s.pos, 9);
        return { key: 'post', pos: this.postSpot, look: s.pos.clone().setY(1), hold: true };
      }
      if (s.state === 'dropped') {
        const nearest = w.match.aliveOf('atk').filter((a) => !a.isPlayer).sort((a, b) => a.pos.distanceTo(s.pos) - b.pos.distanceTo(s.pos))[0];
        if (nearest === c) return { key: 'spike', pos: s.pos };
      }
      const site = map.poi.sites[brain.atkSite];
      if (c.hasSpike) {
        if (brain.executed) {
          if (!this.plantSpot) {
            const cells = map.cellsByType[brain.atkSite].filter(([cc, rr]) => !map.nearWall[map.idx(cc, rr)]);
            const [cc, rr] = pick(cells);
            this.plantSpot = map.toWorld(cc, rr);
          }
          return { key: 'plant', pos: this.plantSpot, plant: true };
        }
        const sp = this.stagePos(site.stage, 3);
        return { key: 'stage', pos: sp, look: map.toWorld(site.chokes[0][0], site.chokes[0][1], 1.5), hold: true, walk: c.pos.distanceTo(sp) < 10 };
      }
      if (brain.executed) {
        if (!this.siteSpot) {
          const hold = pick(site.holds);
          this.siteSpot = map.randomWalkableNear(map.toWorld(hold[0], hold[1]), 2.5);
        }
        this.chase = true;
        return { key: 'site', pos: this.siteSpot, look: site.center.clone().setY(1.5), hold: true };
      }
      const stage = this.role === 'mid' ? map.poi.mid.stage : site.stage;
      const lookC = this.role === 'mid' ? map.poi.mid.chokes[0] : site.chokes[0];
      const sp = this.stagePos(stage, 2.5);
      return { key: 'stage', pos: sp, look: map.toWorld(lookC[0], lookC[1], 1.5), hold: true, walk: c.pos.distanceTo(sp) < 10 };
    }

    // Defenders
    if (s.state === 'planted') {
      this.chase = true;
      return { key: 'defuse', pos: s.pos, defuse: true, look: s.pos.clone().setY(1) };
    }
    this.chase = false;
    if (!this.holdPos) w.brain.assignHold(this, 'mid', 0);
    return { key: 'hold' + this.assign, pos: this.holdPos, look: this.holdLook, hold: true, walk: c.pos.distanceTo(this.holdPos) < 10 };
  }

  stagePos(cell, spread) {
    if (!this._stage || this._stageKey !== cell) {
      this._stageKey = cell;
      this._stage = this.world.map.randomWalkableNear(this.world.map.toWorld(cell[0], cell[1]), spread);
    }
    return this._stage;
  }

  // ---------------- main update ----------------
  update(dt) {
    const c = this.char;
    const w = this.world;
    const t = this.t;
    if (!c.alive) return;
    const phase = w.match.phase;
    c.walking = false;
    c.crouching = t < (this.duckUntil ?? 0);
    if (phase === 'buy') {
      if (!this.buyDone && t >= this.buyAt) this.buy();
      this.idleLook(dt);
      c.physics(dt, 0, 0, false);
      return;
    }
    if (phase !== 'combat') {
      c.physics(dt, 0, 0, false);
      return;
    }

    if (t >= this.nextPerceive) {
      this.nextPerceive = t + 0.08;
      this.perceive();
    }

    let want = c.bestSlot();
    const pr = c.slots.primary;
    if (want === 'primary' && pr.ammo + pr.reserve === 0 && c.slots.secondary) want = 'secondary';
    if (c.slot !== want) c.equip(want);
    const weapon = c.weapon;

    let wishX = 0, wishZ = 0, jump = false;
    const target = this.targetVisible ? this.target : null;
    const blinded = t < c.blindUntil;

    // ----- aim point -----
    let aimPoint = null;
    if (target) {
      aimPoint = this.aimPart === 'head' || target._headOnly ? target.headPos() : target.chestPos();
    } else if (this.lastKnown && t - this.lastKnown.time < 2.5) {
      aimPoint = this.lastKnown.pos.clone().setY(this.lastKnown.pos.y + 1.4);
    } else if (this.alert && t < this.alert.until) {
      aimPoint = this.alert.pos.clone();
      if (aimPoint.y < 0.8) aimPoint.y = 1.4;
    }

    // ----- movement / goal -----
    let firing = false;
    if (target && !c.action) {
      const dist = target.pos.distanceTo(c.pos);
      const inBurstPause = t < this.pauseUntil;
      // Strafe between bursts, stand still while shooting
      if (this.diff.strafe && (inBurstPause || t < this.reactionEnd)) {
        if (t > this.strafeUntil) { this.strafeDir *= -1; this.strafeUntil = t + rand(0.25, 0.6); }
        const d = _v.subVectors(target.pos, c.pos).setY(0).normalize();
        wishX = -d.z * this.strafeDir;
        wishZ = d.x * this.strafeDir;
        if (dist < 3 && weapon.def.type !== 'melee') { wishX -= d.x * 0.5; wishZ -= d.z * 0.5; }
      }
      firing = this.tryShoot(target, dist, aimPoint);
      if (firing || (this.diff.counterStrafe && t >= this.reactionEnd && !inBurstPause)) { wishX = 0; wishZ = 0; }
      // Crouch-spray at range: tighter spread and a smaller hitbox
      if (this.duck && firing && dist > 9 && weapon.def.type !== 'sniper' && weapon.def.type !== 'melee') this.duckUntil = t + 0.45;
      if (c.slots.primary?.def.scope || weapon.def.scope) c.zoomed = weapon.def.scope && t >= this.reactionEnd - 0.1;
    } else {
      c.zoomed = false;
      const goal = this.chooseGoal();
      c.walking = this.diff.sneak && !!goal.walk;
      if (goal.key !== this.goalKey || t > this.repathAt) {
        this.goalKey = goal.key;
        this.path = w.map.findPath(c.pos, goal.pos);
        this.pathIdx = 0;
        this.repathAt = t + 2.5;
      }
      const moved = this.followPath();
      if (moved) {
        wishX = moved.x; wishZ = moved.z;
        if (!aimPoint) {
          aimPoint = this.lookAhead();
        }
        // stuck handling
        const sp = Math.hypot(c.vel.x, c.vel.z);
        if (sp < 0.6) {
          this.stuckT += dt;
          if (this.stuckT > 0.7) {
            jump = true;
            this.stuckT = 0;
            this.stuckCount++;
            this.repathAt = 0;
            if (this.stuckCount > 3) { this.path = []; this.stuckCount = 0; this.siteSpot = null; this.postSpot = null; this._stage = null; }
          }
        } else this.stuckT = 0;
      } else {
        // arrived at goal
        this.stuckT = 0;
        if (!aimPoint && goal.look) aimPoint = this.sway(goal.look);
        if (goal.plant && c.hasSpike && w.map.plantSiteAt(c.pos) && !c.action && c.onGround) {
          c.action = { type: 'plant', start: t };
        } else if (goal.plant && c.hasSpike && !w.map.plantSiteAt(c.pos)) {
          this.plantSpot = null;
        }
        if (goal.defuse && !c.action && w.match.spike.state === 'planted' && c.pos.distanceTo(w.match.spike.pos) < 2) {
          c.action = { type: 'defuse', start: t };
        }
        if (this.lastKnown && t - this.lastKnown.time > 3.5) this.chase = c.team === 'atk' ? this.chase : false;
      }
      if (weapon.canReload() && weapon.ammo < weapon.def.mag * 0.5 && !this.lastKnownRecent(2)) weapon.startReload(t);
    }

    // Cancel plant/defuse when an enemy is in sight (unless desperate)
    if (c.action && target && t > this.reactionEnd && this.diff !== DIFFICULTY.easy) {
      const s = w.match.spike;
      const desperate = c.action.type === 'defuse' && (s.plantedAt + ROUND.spikeTime - t) < (ROUND.defuseTime - s.defuseProgress) + 1.5;
      if (!desperate) c.action = null;
    }

    // Wallbang: spray through cover at the spot where an enemy was just seen
    const wb = !target && !c.action ? this.tryWallbang() : null;
    if (wb) {
      aimPoint = wb;
      wishX = 0; wishZ = 0;
    } else this.wbBurst = 0;

    if (aimPoint) this.aimAt(dt, aimPoint, !!target, blinded);
    if (wb) this.wallbangFire();

    if (t >= this.nextAbility) {
      this.nextAbility = t + 0.5;
      this.useAbilities(target);
    }

    // Normalize wish
    const len = Math.hypot(wishX, wishZ);
    if (len > 1) { wishX /= len; wishZ /= len; }
    c.physics(dt, wishX, wishZ, jump);
  }

  lastKnownRecent(sec) { return this.lastKnown && this.t - this.lastKnown.time < sec; }

  // Returns a world point to shoot through cover at, or null.
  tryWallbang() {
    const c = this.char;
    const w = this.world;
    const t = this.t;
    const lk = this.lastKnown;
    if (!this.diff.wallbang || !lk || t - lk.time > 1.4 || t < c.blindUntil) return null;
    const weapon = c.weapon;
    const def = weapon.def;
    if (def.type === 'melee' || def.type === 'sniper' || def.type === 'knives') return null;
    if (weapon.reloading || t < c.equipEnd || weapon.ammo <= 0) return null;
    if (this.wbFor !== lk.time) {
      this.wbFor = lk.time;
      this.wbDecided = Math.random() < this.diff.wallbang;
    }
    if (!this.wbDecided) return null;
    const eye = c.eyePos();
    const chest = _e.set(lk.pos.x, lk.pos.y + 0.9, lk.pos.z);
    const dist = eye.distanceTo(chest);
    if (dist < 3 || dist > 35) return null;
    // If nothing blocks the line, normal vision already handles it.
    if (w.map.lineOfSight(eye, chest)) return null;
    const hit = w.map.penetrationBetween(eye, chest, PENETRATION[def.pen || 'low']);
    if (!hit || hit.mult < 0.45) return null;
    return chest.clone();
  }

  wallbangFire() {
    const c = this.char;
    const t = this.t;
    if ((this.aimDelta ?? 1) > 0.05) return;
    if (this.wbBurst <= 0 && t >= this.nextWb) { this.wbBurst = 4; this.nextWb = t + 2.4; }
    if (this.wbBurst > 0 && fireWeapon(this.world, c, { recoilScale: 1 - this.diff.recoilControl })) this.wbBurst--;
  }

  followPath() {
    const c = this.char;
    while (this.pathIdx < this.path.length) {
      const p = this.path[this.pathIdx];
      const dx = p.x - c.pos.x, dz = p.z - c.pos.z;
      const d = Math.hypot(dx, dz);
      const last = this.pathIdx === this.path.length - 1;
      if (d < (last ? 0.35 : 0.6)) { this.pathIdx++; continue; }
      return { x: dx / d, z: dz / d };
    }
    return null;
  }

  lookAhead() {
    const c = this.char;
    // Look at a point a few meters ahead along the path
    let acc = 0;
    let prev = c.pos;
    for (let i = this.pathIdx; i < this.path.length; i++) {
      const p = this.path[i];
      acc += Math.hypot(p.x - prev.x, p.z - prev.z);
      if (acc > 6 || i === this.path.length - 1) return new THREE.Vector3(p.x, 1.55, p.z);
      prev = p;
    }
    return null;
  }

  sway(p) {
    const t = this.t + this.lookSway;
    const c = this.char;
    const d = _v.subVectors(p, c.pos);
    const base = Math.atan2(-d.x, -d.z);
    const yaw = base + Math.sin(t * 0.5) * 0.25;
    const len = Math.max(4, Math.hypot(d.x, d.z));
    return new THREE.Vector3(c.pos.x - Math.sin(yaw) * len, p.y, c.pos.z - Math.cos(yaw) * len);
  }

  idleLook(dt) {
    const c = this.char;
    c.yaw += Math.sin(this.t * 0.7 + this.lookSway) * dt * 0.4;
    c.pitch *= 0.95;
  }

  aimAt(dt, point, tracking, blinded) {
    const c = this.char;
    const eye = c.eyePos();
    const d = _v.subVectors(point, eye);
    if (d.lengthSq() < 0.01) return;
    let { yaw, pitch } = anglesFromDir(d);
    if (tracking) {
      const t = this.t;
      const k = Math.exp(-1.9 * dt);
      this.err.y *= k; this.err.p *= k;
      if (t > this.floorErr.next) {
        const f = this.diff.errorFloor;
        this.floorErr = { y: rand(-f, f), p: rand(-f, f) * 0.6, next: t + rand(0.25, 0.5) };
      }
      yaw += (this.err.y + this.floorErr.y) * DEG;
      pitch += (this.err.p + this.floorErr.p) * DEG;
    }
    const rate = this.diff.turnSpeed * (blinded ? 0.25 : 1) * (tracking ? 1 : 0.6);
    const k = 1 - Math.exp(-rate * dt);
    const dy = wrapAngle(yaw - c.yaw);
    const maxStep = 12 * dt;
    c.yaw += clamp(dy * k, -maxStep, maxStep);
    c.pitch += clamp((pitch - c.pitch) * k, -maxStep, maxStep);
    c.pitch = clamp(c.pitch, -1.4, 1.4);
    this.aimDelta = Math.abs(dy) + Math.abs(pitch - c.pitch);
  }

  tryShoot(target, dist, aimPoint) {
    const c = this.char;
    const w = this.world;
    const t = this.t;
    const weapon = c.weapon;
    const def = weapon.def;
    if (t < this.reactionEnd || t < c.blindUntil || c.action) return false;
    if (weapon.reloading || t < c.equipEnd) return false;
    if (def.type === 'melee') return false;
    if (t < this.pauseUntil) return false;
    // Aim settle check
    const tol = Math.max(1.2 * DEG, Math.atan(0.45 / Math.max(dist, 1)));
    if ((this.aimDelta ?? 1) > tol * 2.2) return false;
    if (this.diff.counterStrafe && Math.hypot(c.vel.x, c.vel.z) > 2.2 && dist > 6) return false;

    if (def.auto) {
      if (this.burstLeft <= 0) this.burstLeft = dist > 25 ? Math.floor(rand(2, 4)) : dist > 14 ? Math.floor(rand(4, 7)) : Math.floor(rand(8, 14));
      const fired = fireWeapon(w, c, { recoilScale: 1 - this.diff.recoilControl, zoomed: false });
      if (fired) {
        this.burstLeft--;
        if (this.burstLeft <= 0) this.pauseUntil = t + (dist > 25 ? rand(0.3, 0.5) : rand(0.12, 0.3));
      }
      return true;
    }
    if (t < this.nextSemi) return true;
    const fired = fireWeapon(w, c, { recoilScale: 1 - this.diff.recoilControl, zoomed: !!c.zoomed });
    if (fired) this.nextSemi = t + 1 / def.rate + (def.type === 'sniper' ? rand(0.1, 0.3) : rand(0.05, 0.22)) * (this.diff === DIFFICULTY.easy ? 2 : 1);
    return true;
  }

  // ---------------- abilities ----------------
  useAbilities(target) {
    const c = this.char;
    const w = this.world;
    const ab = w.abilities;
    const t = this.t;
    const m = w.match;
    if (m.phase !== 'combat' || c.action) return;
    const agent = c.agentId;
    const map = w.map;
    const brain = w.brain;
    const known = this.lastKnown && t - this.lastKnown.time < 3 ? this.lastKnown.pos : null;
    const try_ = (key, tgt) => ab.canUse(c, key) && ab.use(c, key, tgt);

    // Heals
    if (!target && c.hp < 60 && (agent === 'ember' || agent === 'warden')) try_('E');

    // Ultimates
    if (ab.canUse(c, 'X')) {
      if (agent === 'gale' && target) try_('X');
      else if (agent === 'ember' && target && c.hp < 80) try_('X');
      else if (agent === 'echo' && known && !target && known.distanceTo(c.pos) < 60) try_('X', known.clone().setY(1.2));
      else if (agent === 'shade') {
        if (c.team === 'atk' && m.spike.state === 'planted' && m.spike.defuseProgress > 0) try_('X', m.spike.pos.clone());
        else if (known && brain.recentIntel(c.squad, 2).filter((i) => i.pos.distanceTo(known) < 6).length >= 2) try_('X', known.clone());
      } else if (agent === 'warden' && !target) {
        const dead = w.chars.find((o) => !o.alive && o.squad === c.squad && o.pos.distanceTo(c.pos) < 10);
        if (dead) try_('X');
      }
    }

    // Execute utility for attackers
    if (c.team === 'atk' && brain.executed && !this.usedExecUtil) {
      const site = map.poi.sites[brain.atkSite];
      if (c.pos.distanceTo(site.center) < 30) {
        this.usedExecUtil = true;
        const center = site.center.clone().setY(1.5);
        if (agent === 'shade') {
          const sm = site.smokes[0];
          try_('E', map.toWorld(sm[0], sm[1], 1.5));
          try_('C');
        } else if (agent === 'gale') {
          const sm = site.smokes[1];
          try_('Q', map.toWorld(sm[0], sm[1], 1.5));
        } else if (agent === 'echo') {
          try_('E', center.clone().setY(3));
        } else if (agent === 'ember') {
          try_('Q', center);
        } else if (agent === 'warden') {
          // nothing special
        }
      }
    }

    // Defensive utility at contact
    if (c.team === 'def' && brain.hotSite && !this.usedExecUtil && known) {
      this.usedExecUtil = true;
      if (agent === 'shade') try_('E', known.clone().setY(1.5));
      else if (agent === 'warden') try_('Q', known.clone());
      else if (agent === 'ember') try_('C', known.clone());
      else if (agent === 'echo') try_('C', known.clone());
    }

    // Tripwire at hold position
    if (agent === 'warden' && c.team === 'def' && !this.trapPlaced && this.holdPos && c.pos.distanceTo(this.holdPos) < 1.5 && this.holdLook) {
      const dir = _v.subVectors(this.holdLook, c.pos).setY(0);
      const d = Math.min(10, dir.length());
      dir.normalize();
      const p = c.pos.clone().addScaledVector(dir, d);
      this.trapPlaced = true;
      if (map.walkable(map.toCell(p.x, p.z).c, map.toCell(p.x, p.z).r)) try_('C', p);
    }

    // Flash / nearsight / dart before re-peeking a known enemy
    if (!target && known && known.distanceTo(c.pos) < 22 && Math.random() < 0.35) {
      if (agent === 'ember' || agent === 'echo') try_('Q', known.clone().setY(1.6));
      else if (agent === 'shade') {
        const to = _v.subVectors(known, c.pos).setY(0).normalize();
        const fwd = dirFromAngles(c.yaw, 0);
        if (to.dot(fwd) > 0.8) try_('Q');
      } else if (agent === 'warden') try_('Q', known.clone());
    }
    if (!target && known && agent === 'echo' && Math.random() < 0.3) try_('C', known.clone());

    // Post-plant molly on the spike
    if (agent === 'ember' && c.team === 'atk' && m.spike.state === 'planted' && m.spike.defuseProgress > 0 && c.pos.distanceTo(m.spike.pos) < 30) {
      try_('C', m.spike.pos.clone());
    }
  }
}
