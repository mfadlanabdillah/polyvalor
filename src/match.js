import * as THREE from 'three';
import { ROUND } from './config.js';
import { buildSpikeMesh } from './models.js';
import { shuffle, pick } from './utils.js';

// Round flow, economy, spike state and win conditions.
export class Match {
  constructor(world, { firstTo, playerSide }) {
    this.world = world;
    this.firstTo = firstTo;
    this.halfAt = firstTo - 1;
    this.score = [0, 0]; // by squad
    this.round = 0;
    this.phase = 'pre';
    this.timer = 0;
    this.startSide = playerSide; // side of squad 0 in first half
    this.lossStreak = [0, 0];
    this.spike = { state: 'none', pos: new THREE.Vector3(), carrier: null, plantedAt: 0, site: null, defuseProgress: 0, halfDone: false, nextBeep: 0 };
    this.spikeMesh = buildSpikeMesh();
    this.spikeMesh.visible = false;
    world.scene.add(this.spikeMesh);
    this.roundResult = null;
    this.history = [];
    this.swapped = false;
    this.plantedThisRound = false;
    this.inOvertime = false;
    this.firstBloodDone = false;
  }

  // Win by reaching the target with a 2-round lead; sudden-death cap 3 rounds past the target.
  isOver() {
    const [a, b] = this.score;
    const top = Math.max(a, b);
    return (top >= this.firstTo && Math.abs(a - b) >= 2) || top >= this.firstTo + 3;
  }

  sideOf(squad) {
    const s0 = this.swapped ? (this.startSide === 'atk' ? 'def' : 'atk') : this.startSide;
    return squad === 0 ? s0 : s0 === 'atk' ? 'def' : 'atk';
  }
  squadOf(side) { return this.sideOf(0) === side ? 0 : 1; }

  get attackers() { return this.world.chars.filter((c) => c.team === 'atk'); }
  get defenders() { return this.world.chars.filter((c) => c.team === 'def'); }
  aliveOf(side) { return this.world.chars.filter((c) => c.alive && c.team === side); }

  // True when some team wins the match by taking the next round.
  isMatchPoint() {
    const wins = (x, y) => (x + 1 >= this.firstTo && x + 1 - y >= 2) || x + 1 >= this.firstTo + 3;
    return wins(this.score[0], this.score[1]) || wins(this.score[1], this.score[0]);
  }

  startRound() {
    const w = this.world;
    // Overtime starts once both teams are one round short of the target and level.
    let otStart = false;
    if (!this.inOvertime && this.score[0] === this.score[1] && this.score[0] >= this.firstTo - 1 && this.round > 0) {
      this.inOvertime = true;
      otStart = true;
    }
    if (this.inOvertime) {
      this.swapped = !this.swapped; // sides swap every overtime round
      this.lossStreak = [0, 0];
    }
    const firstOfHalf = this.round === 0 || this.round === this.halfAt || this.inOvertime;
    if (this.round === this.halfAt && !this.swapped && !this.inOvertime) {
      this.swapped = true;
      this.lossStreak = [0, 0];
      w.hud.banner('SWITCHING SIDES', 'Economy has been reset', '#f2e27a');
    }
    this.firstBloodDone = false;
    this.round++;
    this.phase = 'buy';
    this.timer = ROUND.buyTime;
    this.roundResult = null;
    this.plantedThisRound = false;
    w.map.setBarrier(true);
    w.abilities.clear();
    w.clearPickups();
    w.effects.clear();

    for (const side of ['atk', 'def']) {
      const cells = shuffle([...w.map.cellsByType[side === 'atk' ? 'T' : 'D']]);
      const chars = w.chars.filter((c) => c.team === side);
      chars.forEach((c, i) => {
        const [cc, rr] = cells[i * 3 % cells.length];
        const p = w.map.toWorld(cc, rr);
        p.x += (Math.random() - 0.5) * 0.6;
        p.z += (Math.random() - 0.5) * 0.6;
        const keep = !firstOfHalf && c.alive;
        if (firstOfHalf) {
          c.credits = this.inOvertime ? 5000 : ROUND.startCredits;
          c.charges = { C: 0, Q: 0, E: 0 };
          c.ult = this.round === 1 ? 0 : c.ult;
        }
        c.resetForRound(p, keep);
        c.yaw = side === 'atk' ? 0 : Math.PI;
      });
    }
    // Spike goes to a random attacker
    const atk = this.attackers;
    const carrier = pick(atk);
    carrier.hasSpike = true;
    this.spike.state = 'carried';
    this.spike.carrier = carrier;
    this.spike.defuseProgress = 0;
    this.spike.halfDone = false;
    this.spikeMesh.visible = false;

    w.onRoundStart();
    const side = this.sideOf(0) === 'atk' ? 'ATTACK — plant the Spike' : 'DEFEND — stop the Spike';
    let title = `ROUND ${this.round}`;
    let sub = this.isMatchPoint() ? `MATCH POINT · ${side}` : side;
    if (otStart) { title = 'OVERTIME'; sub = 'Lead by 2 rounds to win · sides swap every round'; }
    else if (this.inOvertime) sub = `OVERTIME · ${sub}`;
    w.hud.banner(title, sub, otStart || this.isMatchPoint() ? '#ff5f6a' : '#ffffff');
    w.audio.ui('roundStart');
  }

  startCombat() {
    this.phase = 'combat';
    this.timer = ROUND.roundTime;
    this.world.map.setBarrier(false);
    this.world.hud.closeBuy();
    this.world.onCombatStart();
  }

  dropSpike(pos) {
    const s = this.spike;
    if (s.carrier) s.carrier.hasSpike = false;
    s.carrier = null;
    s.state = 'dropped';
    s.pos.set(pos.x, 0, pos.z);
    const ground = this.world.abilities.groundBelow(new THREE.Vector3(pos.x, pos.y + 0.5, pos.z));
    s.pos.y = ground.y;
    this.spikeMesh.position.copy(s.pos);
    this.spikeMesh.visible = true;
    this.spikeMesh.scale.setScalar(0.7);
    this.world.onSpikeDropped?.(s.pos);
  }

  pickupSpike(char) {
    const s = this.spike;
    s.state = 'carried';
    s.carrier = char;
    char.hasSpike = true;
    this.spikeMesh.visible = false;
    if (char.isPlayer) this.world.hud.toast('You picked up the Spike');
    else this.world.onSpikePickup?.(char);
  }

  plant(char) {
    const w = this.world;
    const s = this.spike;
    char.hasSpike = false;
    s.state = 'planted';
    s.carrier = null;
    s.pos.copy(char.pos);
    s.plantedAt = w.time;
    s.site = w.map.plantSiteAt(char.pos);
    s.nextBeep = w.time;
    this.plantedThisRound = true;
    this.timer = ROUND.spikeTime;
    this.spikeMesh.position.copy(s.pos);
    this.spikeMesh.scale.setScalar(1);
    this.spikeMesh.visible = true;
    char.ult = Math.min(char.ult + 1, char.agent.abilities.X.ult);
    char.plants++;
    for (const c of w.chars) if (c.team === 'atk') c.credits = Math.min(ROUND.maxCredits, c.credits + ROUND.plantReward);
    w.hud.banner('SPIKE PLANTED', `Site ${s.site}`, '#ff5f6a');
    w.audio.ui('plant');
    w.onSpikePlanted(char);
  }

  defuse(char) {
    const s = this.spike;
    s.state = 'defused';
    char.ult = Math.min(char.ult + 1, char.agent.abilities.X.ult);
    char.defuses++;
    this.world.hud.banner('SPIKE DEFUSED', '', '#4fe0c8');
    this.endRound('def', 'defuse');
  }

  update(dt) {
    const w = this.world;
    if (this.phase === 'pre' || this.phase === 'over') return;
    this.timer -= dt;

    if (this.phase === 'buy') {
      if (this.timer <= 0) this.startCombat();
      return;
    }

    if (this.phase === 'post') {
      if (this.timer <= 0) {
        if (this.isOver()) {
          this.phase = 'over';
          w.onMatchOver(this.score[0] > this.score[1] ? 0 : 1);
        } else this.startRound();
      }
      this.updateSpikeVisual();
      return;
    }

    // combat
    const s = this.spike;
    // Plant / defuse actions
    for (const c of w.chars) {
      if (!c.alive || !c.action) continue;
      const a = c.action;
      const el = w.time - a.start;
      if (a.type === 'plant') {
        if (!c.hasSpike || !w.map.plantSiteAt(c.pos) || s.state !== 'carried') { c.action = null; continue; }
        if (el >= ROUND.plantTime) { c.action = null; this.plant(c); }
      } else if (a.type === 'defuse') {
        if (s.state !== 'planted' || c.pos.distanceTo(s.pos) > 2.2) { c.action = null; continue; }
        const prog = el + (s.halfDone ? ROUND.defuseTime / 2 : 0);
        s.defuseProgress = prog;
        if (prog >= ROUND.defuseTime / 2 && !s.halfDone && el > 0.05) a.reachedHalf = true;
        if (prog >= ROUND.defuseTime) { c.action = null; this.defuse(c); return; }
      }
    }
    // Remember half-defuse checkpoint when defusing stops
    const defusing = w.chars.some((c) => c.alive && c.action?.type === 'defuse');
    if (!defusing && s.state === 'planted' && s.defuseProgress >= ROUND.defuseTime / 2) s.halfDone = true;
    if (!defusing) s.defuseProgress = s.halfDone ? ROUND.defuseTime / 2 : 0;

    // Spike pickup
    if (s.state === 'dropped') {
      for (const c of this.aliveOf('atk')) {
        if (Math.hypot(c.pos.x - s.pos.x, c.pos.z - s.pos.z) < 1.3 && Math.abs(c.pos.y - s.pos.y) < 1.5) { this.pickupSpike(c); break; }
      }
    }

    this.updateSpikeVisual();

    // Win conditions
    const atkAlive = this.aliveOf('atk').length;
    const defAlive = this.aliveOf('def').length;
    if (s.state === 'planted') {
      const left = s.plantedAt + ROUND.spikeTime - w.time;
      this.timer = left;
      if (w.time >= s.nextBeep) {
        const k = 1 - left / ROUND.spikeTime;
        s.nextBeep = w.time + Math.max(0.12, 1.0 - k * k * 0.9);
        w.audio.beep(s.pos, k);
      }
      if (left <= 0) {
        this.detonate();
        return;
      }
      if (defAlive === 0) this.endRound('atk', 'elim');
    } else {
      if (defAlive === 0) this.endRound('atk', 'elim');
      else if (atkAlive === 0) this.endRound('def', 'elim');
      else if (this.timer <= 0) this.endRound('def', 'time');
    }
  }

  updateSpikeVisual() {
    const s = this.spike;
    if (!this.spikeMesh.visible) return;
    const t = this.world.time;
    if (s.state === 'planted') {
      const left = s.plantedAt + ROUND.spikeTime - t;
      const rate = left < 10 ? 10 : left < 20 ? 5 : 2;
      this.spikeMesh.userData.light.visible = Math.sin(t * rate * Math.PI) > 0;
      this.spikeMesh.userData.ring.rotation.y += 0.05;
    } else if (s.state === 'defused') {
      this.spikeMesh.userData.light.visible = false;
    }
  }

  detonate() {
    const w = this.world;
    const s = this.spike;
    s.state = 'exploded';
    w.effects.blast(s.pos.clone().setY(2), ROUND.spikeRadius, 0xfff0d0, 1.4);
    w.effects.blast(s.pos.clone().setY(1), ROUND.spikeRadius * 0.7, 0xff7a3a, 1.8);
    w.audio.explosion(s.pos);
    this.spikeMesh.visible = false;
    for (const c of w.chars) {
      if (c.alive && c.pos.distanceTo(s.pos) < ROUND.spikeRadius) {
        c.hp = 1; c.armor = 0;
        c.takeDamage(999, null, { weaponName: 'Spike', ability: true });
      }
    }
    this.endRound('atk', 'detonate');
  }

  endRound(winSide, reason) {
    if (this.phase !== 'combat') return;
    const w = this.world;
    this.phase = 'post';
    this.timer = ROUND.endDelay;
    const winSquad = this.squadOf(winSide);
    const loseSquad = 1 - winSquad;
    this.score[winSquad]++;
    this.lossStreak[winSquad] = 0;
    const lossBonus = ROUND.lossRewards[Math.min(this.lossStreak[loseSquad], ROUND.lossRewards.length - 1)];
    this.lossStreak[loseSquad]++;
    for (const c of w.chars) {
      const reward = c.squad === winSquad ? ROUND.winReward : lossBonus;
      c.credits = Math.min(ROUND.maxCredits, c.credits + reward);
      c.action = null;
    }
    this.history.push({ winSquad, winSide, reason });
    this.roundResult = { winSquad, reason };
    const won = winSquad === w.playerSquad;
    const reasonText = { elim: 'Team eliminated', time: 'Time expired', detonate: 'Spike detonated', defuse: 'Spike defused' }[reason];
    const mvp = w.pickRoundMvp?.(winSquad);
    const sub = mvp ? `${reasonText} · MVP ${mvp.name}` : reasonText;
    w.hud.banner(won ? 'ROUND WIN' : 'ROUND LOSS', sub, won ? '#4fe0c8' : '#ff5f6a', 3.5);
    w.audio.ui(won ? 'win' : 'lose');
    w.onRoundEnd(winSquad);
  }
}
