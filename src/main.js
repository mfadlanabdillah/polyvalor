import * as THREE from 'three';
import { AGENTS, WEAPONS, SHIELDS, MODES, BOT_NAMES, ROUND, PENETRATION, PENETRABLE, COLORS } from './config.js';
import { GameMap } from './map.js';
import { Character } from './character.js';
import { PlayerController } from './player.js';
import { BotController, TeamBrain } from './bot.js';
import { Match } from './match.js';
import { AbilitySystem } from './abilities.js';
import { Effects } from './effects.js';
import { GameAudio } from './audio.js';
import { HUD } from './hud.js';
import { ViewModel } from './viewmodel.js';
import { buildGun, flatMat, disposeTree } from './models.js';
import { renderThumbnails } from './icons.js';
import { weaponDamage } from './weapons.js';
import { shuffle, dirFromAngles, clamp } from './utils.js';
import { loadSettings, saveSettings, keyLabel } from './settings.js';
import { SettingsUI } from './settings-ui.js';

const $ = (id) => document.getElementById(id);
const BASE_FOV = 74;
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();

class Game {
  constructor() {
    this.canvas = $('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.map = new GameMap(this.scene);
    this.effects = new Effects(this.scene);
    this.audio = new GameAudio(this);
    this.abilities = new AbilitySystem(this);
    this.hud = new HUD(this);
    this.viewmodel = new ViewModel();
    this.brain = new TeamBrain(this);
    this.icons = renderThumbnails();
    this.orbs = [];
    this.killcam = null;
    this.spikeMarker = this.makeSpikeMarker();
    this.lastCallout = -9;

    this.settings = Object.assign(loadSettings(), { side: 'atk', agent: 'gale', fullscreen: true });
    this.settingsUI = new SettingsUI(this);
    this.fps = { frames: 0, acc: 0, last: 0 };
    this.playerSquad = 0;
    this.time = 0;
    this.chars = [];
    this.bots = [];
    this.pickups = [];
    this.running = false;
    this.paused = false;
    this.locked = false;
    this.viewTarget = null;
    this.viewYaw = 0;
    this.menuCamT = 0;

    this.setupMenu();
    this.setupPointerLock();
    addEventListener('resize', () => this.resize());
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ menu
  setupMenu() {
    const list = $('agent-list');
    for (const ag of Object.values(AGENTS)) {
      const d = document.createElement('div');
      d.className = 'agent-card' + (ag.id === this.settings.agent ? ' sel' : '');
      const face = this.icons.agents[ag.id];
      const portrait = face
        ? `<img class="face" src="${face}" alt="${ag.name}" style="background:${ag.color}" />`
        : `<div class="gem" style="background:${ag.color}"></div>`;
      d.innerHTML = `${portrait}<div class="nm">${ag.name}</div><div class="rl">${ag.role}</div>`;
      d.onclick = () => {
        this.settings.agent = ag.id;
        list.querySelectorAll('.agent-card').forEach((e) => e.classList.remove('sel'));
        d.classList.add('sel');
        this.renderAgentDetail();
      };
      list.appendChild(d);
    }
    this.renderAgentDetail();
    const sens = $('opt-sens'), sens2 = $('opt-sens2');
    sens.oninput = () => { this.settings.sens = +sens.value; this.saveAndApply(); };
    sens2.oninput = () => { this.settings.sens = +sens2.value; this.saveAndApply(); };
    $('opt-vol').oninput = () => { this.settings.volume = +$('opt-vol').value; this.saveAndApply(); };
    $('opt-diff').value = this.settings.difficulty;
    $('opt-mode').value = this.settings.mode;
    this.applySettings();

    $('btn-settings').onclick = () => this.settingsUI.open();
    $('btn-settings2').onclick = () => this.settingsUI.open();
    $('btn-play').onclick = () => this.startMatch();
    $('btn-resume').onclick = () => this.requestLock();
    $('btn-quit').onclick = () => this.quitToMenu();
    $('btn-again').onclick = () => this.startMatch();
    $('btn-menu').onclick = () => this.quitToMenu();
    if (window.desktop?.isDesktop) {
      document.body.classList.add('desktop');
      $('btn-exit').onclick = $('btn-exit2').onclick = () => window.desktop.quit();
    }
  }

  renderAgentDetail() {
    const ag = AGENTS[this.settings.agent];
    let html = `<div class="desc"><b style="color:${ag.color}">${ag.name}</b> — ${ag.desc}</div>`;
    for (const k of ['C', 'Q', 'E', 'X']) {
      const a = ag.abilities[k];
      const cost = k === 'X' ? `${a.ult} pts` : a.cost ? `¤${a.cost}` : 'free';
      html += `<div class="ab"><b>${k}</b><span class="an">${a.name}</span><span>${a.desc} <i style="color:#9aa3b2">(${cost})</i></span></div>`;
    }
    $('agent-detail').innerHTML = html;
  }

  saveAndApply() {
    saveSettings(this.settings);
    this.applySettings();
  }

  // Pushes current settings into the renderer, audio and menu widgets.
  applySettings() {
    const s = this.settings;
    const g = s.graphics;
    this.audio.setVolume(s.volume);
    for (const [id, vid] of [['opt-sens', 'sens-val'], ['opt-sens2', 'sens-val2']]) {
      $(id).value = s.sens;
      $(vid).textContent = s.sens.toFixed(2);
    }
    $('opt-vol').value = s.volume;
    $('vol-val').textContent = Math.round(s.volume * 100) + '%';

    const r = this.renderer;
    const ratio = Math.min(devicePixelRatio, 1.5) * g.renderScale;
    if (Math.abs(r.getPixelRatio() - ratio) > 1e-3) {
      r.setPixelRatio(ratio);
      r.setSize(innerWidth, innerHeight);
    }
    const shadowsOn = g.shadows !== 'off';
    const size = g.shadows === 'high' ? 2048 : 1024;
    const sun = this.map.sun;
    if (r.shadowMap.enabled !== shadowsOn || (sun && sun.shadow.mapSize.x !== size)) {
      r.shadowMap.enabled = shadowsOn;
      r.shadowMap.type = g.shadows === 'high' ? THREE.PCFShadowMap : THREE.BasicShadowMap;
      if (sun) {
        sun.shadow.mapSize.set(size, size);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
      this.scene.traverse((o) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
      });
    }
    $('fps').classList.toggle('hidden', !g.showFps);

    // Controls help table on the main menu
    const k = s.keys;
    const L = keyLabel;
    const rows = [
      [`${L(k.forward)} ${L(k.left)} ${L(k.back)} ${L(k.right)}`, 'Move'],
      [L(k.walk), 'Walk (silent, accurate)'], [L(k.crouch), 'Crouch'], [L(k.jump), 'Jump'],
      ['LMB / RMB', 'Fire / Zoom (knife: heavy)'],
      [`${L(k.primary)} ${L(k.secondary)} ${L(k.melee)}`, 'Primary / Sidearm / Knife'],
      ['Hold ' + L(k.spike), 'Plant / Defuse Spike'],
      [`${L(k.abilityC)} ${L(k.abilityQ)} ${L(k.abilityE)} ${L(k.ult)}`, 'Abilities / Ultimate'],
      [L(k.reload), 'Reload'], [L(k.inspect), 'Inspect weapon'], [L(k.buy), 'Buy menu'],
      [`${L(k.use)} / ${L(k.drop)}`, 'Pick up / Drop weapon'], [L(k.scoreboard), 'Scoreboard'], ['Esc', 'Pause'],
    ];
    $('controls-table').innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');

    this.applyEnemyColor(s.gameplay.enemyColor);
    this.hud.invalidate();
  }

  // Enemy highlight color: 3D bodies, HUD text and minimap all follow it.
  applyEnemyColor(hex) {
    if (COLORS.base !== hex) {
      COLORS.base = hex;
      COLORS.enemy = new THREE.Color(hex).getHex();
      COLORS.enemyCss = new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), 0.2).getStyle();
      document.documentElement.style.setProperty('--enemy', COLORS.enemyCss);
    }
    for (const c of this.chars) if (c.squad !== this.playerSquad) c.model.setTeamColor(COLORS.enemy);
  }

  get baseFov() { return this.settings.graphics.fov; }

  setupPointerLock() {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.running) return;
      if (!this.locked) {
        this.paused = true;
        this.playerCtl?.releaseAll();
        $('pause').classList.remove('hidden');
      } else {
        this.paused = false;
        $('pause').classList.add('hidden');
      }
    });
    this.canvas.addEventListener('click', () => {
      if (this.running && !this.locked) this.requestLock();
    });
  }

  requestLock() {
    this.audio.init();
    const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => {
      const p2 = this.canvas.requestPointerLock();
      if (p2 && p2.catch) p2.catch(() => {});
    });
  }

  startMatch() {
    this.settings.difficulty = $('opt-diff').value;
    this.settings.mode = $('opt-mode').value;
    this.settings.side = $('opt-side').value;
    this.settings.fullscreen = $('opt-fs').checked;
    saveSettings(this.settings);
    this.audio.init();
    this.audio.setVolume(this.settings.volume);
    this.teardownMatch();

    this.match = new Match(this, { firstTo: MODES[this.settings.mode].firstTo, playerSide: this.settings.side });
    const names = shuffle([...BOT_NAMES]);
    const agentIds = Object.keys(AGENTS);
    let id = 0;
    const allyAgents = shuffle(agentIds.filter((a) => a !== this.settings.agent));
    this.player = new Character(this, { id: id++, name: 'You', squad: 0, agentId: this.settings.agent, isPlayer: true });
    this.chars.push(this.player);
    for (let i = 0; i < 4; i++) {
      this.chars.push(new Character(this, { id: id++, name: names.pop(), squad: 0, agentId: allyAgents[i % allyAgents.length] }));
    }
    const enemyAgents = shuffle([...agentIds]);
    for (let i = 0; i < 5; i++) {
      this.chars.push(new Character(this, { id: id++, name: names.pop(), squad: 1, agentId: enemyAgents[i] }));
    }
    this.bots = this.chars.filter((c) => !c.isPlayer).map((c) => {
      const b = new BotController(this, c, this.settings.difficulty);
      c.bot = b;
      return b;
    });
    this.playerCtl = new PlayerController(this, this.player);
    this.viewTarget = this.player;
    this.killcam = null;
    this.time = 0;
    this.running = true;
    this.paused = false;
    this.applyEnemyColor(this.settings.gameplay.enemyColor);

    $('menu').classList.add('hidden');
    $('end-screen').classList.add('hidden');
    $('pause').classList.add('hidden');
    this.hud.show(true);
    this.hud.setupMatch();
    this.match.startRound();

    if (this.settings.fullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().then(() => {
        navigator.keyboard?.lock?.(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'ControlLeft', 'Tab']).catch(() => {});
      }).catch(() => {});
    }
    this.requestLock();
  }

  teardownMatch() {
    for (const c of this.chars) {
      this.scene.remove(c.model.root);
      this.scene.remove(c.marker);
    }
    this.chars = [];
    this.bots = [];
    this.playerCtl?.dispose();
    this.playerCtl = null;
    this.clearPickups();
    this.clearOrbs();
    this.abilities.clear();
    this.effects.clear();
    this.spikeMarker.visible = false;
    if (this.match) {
      this.scene.remove(this.match.spikeMesh);
      this.match = null;
    }
    this.map.setBarrier(false);
  }

  quitToMenu() {
    this.running = false;
    this.teardownMatch();
    document.exitPointerLock?.();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    this.hud.show(false);
    $('pause').classList.add('hidden');
    $('end-screen').classList.add('hidden');
    $('menu').classList.remove('hidden');
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.viewmodel.resize();
  }

  // ------------------------------------------------------------------ economy
  buyWeapon(c, id) {
    const def = WEAPONS[id];
    const m = this.match;
    if (m.phase !== 'buy' || !c.alive) return false;
    const cur = c.slots[def.slot];
    if (cur?.id === id || c.credits < def.cost) return false;
    c.credits -= def.cost;
    const { weapon, old } = c.giveWeapon(id);
    weapon.boughtRound = m.round;
    if (old) {
      if (old.boughtRound === m.round) c.credits += old.def.cost;
      else if (old.id !== 'classic') this.spawnPickup(old, c.pos);
    }
    c.slot = def.slot;
    c.equipEnd = this.time + 0.3;
    return true;
  }

  sellWeapon(c, slot) {
    const w = c.slots[slot];
    if (!w || w.boughtRound !== this.match.round) return false;
    c.credits += w.def.cost;
    c.slots[slot] = slot === 'secondary' ? new (w.constructor)('classic') : null;
    c.slot = c.bestSlot();
    return true;
  }

  buyShield(c, type) {
    const s = SHIELDS[type];
    if (this.match.phase !== 'buy' || c.armor >= s.value || c.credits < s.cost) return false;
    if (c.shieldBuy && c.shieldBuy.round === this.match.round) {
      c.credits += SHIELDS[c.shieldBuy.type].cost;
      c.armor = c.shieldBuy.prev;
    }
    c.credits -= s.cost;
    c.shieldBuy = { type, round: this.match.round, prev: c.armor };
    c.armor = s.value;
    return true;
  }

  sellShield(c) {
    const sb = c.shieldBuy;
    if (!sb || sb.round !== this.match.round) return false;
    c.credits += SHIELDS[sb.type].cost;
    c.armor = sb.prev;
    c.shieldBuy = null;
    return true;
  }

  buyAbility(c, key) {
    const ab = c.agent.abilities[key];
    if (this.match.phase !== 'buy' || !ab.cost || c.charges[key] >= ab.max || c.credits < ab.cost) return false;
    c.credits -= ab.cost;
    c.charges[key]++;
    return true;
  }

  // Buys the strongest primary that leaves room for a shield, then shield and abilities.
  quickBuy(c) {
    const m = this.match;
    if (m.phase !== 'buy' || !c.alive) return false;
    const before = c.credits;
    const pistol = m.round === 1 || m.round === m.halfAt + 1;
    if (pistol) {
      if (c.slots.secondary?.id === 'classic') {
        if (c.credits >= 500 + 400) this.buyWeapon(c, 'ghost');
        else if (c.credits >= 800 + 25) this.buyWeapon(c, 'sheriff');
      }
      if (c.armor < 25) this.buyShield(c, 'light');
    } else {
      if (!c.slots.primary) {
        const plan = [['vandal', 1000], ['phantom', 1000], ['vandal', 400], ['phantom', 400], ['bulldog', 400], ['guardian', 0], ['spectre', 400], ['marshal', 0]];
        for (const [id, reserve] of plan) {
          if (c.credits >= WEAPONS[id].cost + reserve) { this.buyWeapon(c, id); break; }
        }
      }
      if (c.armor < 50 && c.credits >= 1000) this.buyShield(c, 'heavy');
      else if (c.armor < 25 && c.credits >= 400) this.buyShield(c, 'light');
    }
    for (const key of ['E', 'Q', 'C']) {
      const ab = c.agent.abilities[key];
      let guard = 3;
      while (guard-- > 0 && ab.cost && c.charges[key] < ab.max && ab.cost <= c.credits) {
        if (!this.buyAbility(c, key)) break;
      }
    }
    return c.credits !== before;
  }

  // ------------------------------------------------------------------ stats
  roundsPlayed() { return Math.max(1, this.match?.history.length || 1); }
  acs(c) { return Math.round((c.damageDealt + c.kills * 100 + c.assists * 25 + c.plants * 50 + c.defuses * 50) / this.roundsPlayed()); }
  adr(c) { return Math.round(c.damageDealt / this.roundsPlayed()); }
  hsPct(c) { return c.hits ? Math.round((100 * c.headHits) / c.hits) : 0; }

  // Best performer of the winning team this round.
  pickRoundMvp(winSquad) {
    let best = null, bs = -1;
    for (const c of this.chars) {
      if (c.squad !== winSquad) continue;
      const score = c.roundKills * 120 + c.roundDamage + (c.alive ? 40 : 0);
      if (score > bs) { bs = score; best = c; }
    }
    return best && bs > 0 ? best : null;
  }

  // Match MVP (winning team) and team MVP (losing team) by combat score.
  matchMvps() {
    const m = this.match;
    const winSquad = m.score[0] > m.score[1] ? 0 : 1;
    const top = (sq) => this.chars.filter((c) => c.squad === sq).sort((a, b) => this.acs(b) - this.acs(a))[0];
    return { mvp: top(winSquad), svp: top(1 - winSquad) };
  }

  // ------------------------------------------------------------------ ult orbs
  spawnOrbs() {
    this.clearOrbs();
    const spots = shuffle([[21, 13], [21, 24], [12, 13], [30, 13], [21, 8]]).slice(0, 2);
    for (const [c, r] of spots) {
      if (!this.map.walkable(c, r)) continue;
      const pos = this.map.toWorld(c, r, 0.9);
      const mesh = new THREE.Group();
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), flatMat('#ffd84a', { emissive: '#ffb400', emissiveIntensity: 1.4 }));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 6, 20), new THREE.MeshBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0.8 }));
      ring.rotation.x = Math.PI / 2;
      mesh.add(core, ring);
      mesh.position.copy(pos);
      this.scene.add(mesh);
      this.orbs.push({ pos, mesh, spin: Math.random() * 6 });
    }
  }

  clearOrbs() {
    for (const o of this.orbs) this.scene.remove(o.mesh);
    this.orbs = [];
  }

  updateOrbs(dt) {
    if (!this.orbs.length) return;
    const t = this.time;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.mesh.rotation.y += dt * 1.8;
      o.mesh.position.y = o.pos.y + Math.sin(t * 2.4 + o.spin) * 0.08;
      for (const c of this.chars) {
        if (!c.alive || Math.hypot(c.pos.x - o.pos.x, c.pos.z - o.pos.z) > 1.15 || Math.abs(c.pos.y - o.pos.y + 0.9) > 2) continue;
        const max = c.agent.abilities.X.ult;
        if (c.ult >= max) continue;
        c.ult++;
        if (c === this.viewTarget) { this.audio.ui('orb'); this.hud.toast('+1 ULTIMATE POINT'); }
        this.scene.remove(o.mesh);
        this.orbs.splice(i, 1);
        break;
      }
    }
  }

  makeSpikeMarker() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#ff4655';
    g.strokeStyle = '#fff';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(32, 5); g.lineTo(58, 32); g.lineTo(32, 59); g.lineTo(6, 32); g.closePath();
    g.fill(); g.stroke();
    g.fillStyle = '#fff';
    g.fillRect(29, 20, 6, 15);
    g.fillRect(29, 39, 6, 6);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
    s.scale.set(0.05, 0.05, 1);
    s.renderOrder = 998;
    s.visible = false;
    this.scene.add(s);
    return s;
  }

  // ------------------------------------------------------------------ pickups
  spawnPickup(weapon, pos) {
    const mesh = buildGun(weapon.id);
    mesh.scale.setScalar(1.4);
    mesh.rotation.set(0, Math.random() * Math.PI * 2, Math.PI / 2);
    const g = this.abilities.groundBelow(new THREE.Vector3(pos.x, pos.y + 0.5, pos.z));
    mesh.position.set(pos.x + (Math.random() - 0.5) * 0.6, g.y + 0.06, pos.z + (Math.random() - 0.5) * 0.6);
    mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(mesh);
    weapon.reloading = false;
    this.pickups.push({ weapon, mesh, pos: mesh.position });
  }

  clearPickups() {
    for (const p of this.pickups) { this.scene.remove(p.mesh); disposeTree(p.mesh); }
    this.pickups = [];
  }

  nearestPickup(c, range = 2.2) {
    let best = null, bd = range;
    for (const p of this.pickups) {
      const d = Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z);
      if (d < bd && Math.abs(p.pos.y - c.pos.y) < 1.6) { bd = d; best = p; }
    }
    return best;
  }

  takePickup(c, p) {
    const slot = p.weapon.def.slot;
    const old = c.slots[slot];
    c.slots[slot] = p.weapon;
    this.scene.remove(p.mesh);
    disposeTree(p.mesh);
    this.pickups.splice(this.pickups.indexOf(p), 1);
    if (old && old.id !== 'classic') this.spawnPickup(old, c.pos);
    c.slot = slot;
    c.equipEnd = this.time + (p.weapon.def.equip || 0.6);
    this.audio.equip(c);
  }

  tryPickup(c) {
    if (!c.alive) return;
    const p = this.nearestPickup(c);
    if (p) this.takePickup(c, p);
  }

  dropCurrent(c) {
    if (!c.alive) return;
    if (c.slot === 'melee' || c.slot === 'special') {
      if (c.hasSpike && this.match.phase === 'combat') { this.match.dropSpike(c.pos.clone().addScaledVector(dirFromAngles(c.yaw, 0), 1)); }
      return;
    }
    const w = c.slots[c.slot];
    if (!w || (c.slot === 'secondary' && w.id === 'classic' && !c.slots.primary)) return;
    c.slots[c.slot] = null;
    this.spawnPickup(w, c.pos.clone().addScaledVector(dirFromAngles(c.yaw, 0), 1.2));
    c.slot = c.slots.primary ? 'primary' : c.slots.secondary ? 'secondary' : 'melee';
    c.equipEnd = this.time + 0.5;
  }

  // ------------------------------------------------------------------ combat callbacks
  traceShot(char, origin, dir, def) {
    // Walk the ray through penetrable cover (crates/planters), losing damage per pass.
    const pen = PENETRATION[def.pen || 'low'];
    let from = 0, dmgMult = 1, best = null, mh = null, maxT = 250;
    for (let pass = 0; pass < 3; pass++) {
      const o = origin.clone().addScaledVector(dir, from);
      mh = this.map.raycast(o, dir, 250 - from);
      maxT = mh ? from + mh.t : 250;
      for (const c of this.chars) {
        if (c === char || !c.alive || c.squad === char.squad) continue;
        const h = c.hitTest(origin, dir, maxT);
        if (h && h.t >= from - 0.01 && (!best || h.t < best.t)) best = { ...h, char: c };
      }
      if (best || !mh || !PENETRABLE.has(mh.ch)) break;
      const exitT = this.map.exitDistance(o, dir, mh.c, mh.r);
      if (exitT - mh.t > pen.maxThick) break;
      this.effects.impact(mh.point, mh.normal);
      this.effects.impact(o.clone().addScaledVector(dir, exitT), dir.clone());
      dmgMult *= pen.mult;
      from += exitT + 0.02;
      mh = null;
    }
    const endT = best ? best.t : maxT;
    const end = origin.clone().addScaledVector(dir, endT);
    const start = char === this.viewTarget ? this.viewmodel.muzzleWorld(this.camera) : char.model.muzzleWorld();
    if (def.type !== 'knives' && Math.random() < 0.8) this.effects.tracer(start, end);
    if (def.type === 'knives') this.effects.tracer(start, end);
    if (best) {
      const dmg = Math.round(weaponDamage(def, best.t, best.part) * dmgMult);
      const headshot = best.part === 'head';
      char.hits++;
      if (headshot) char.headHits++;
      if (char.isPlayer) this.audio.hit(headshot);
      best.char.takeDamage(dmg, char, { weaponName: def.name, weaponId: def.id, headshot, part: best.part });
      if (char.isPlayer) {
        const killed = !best.char.alive;
        this.hud.hitMarker(headshot, killed);
        this.hud.damageNumber(end, dmg, headshot, killed);
      }
      this.effects.blood(end);
    } else if (mh) {
      this.effects.impact(mh.point, mh.normal);
    }
  }

  meleeAttack(char, alt) {
    const o = char.eyePos();
    const d = char.forward();
    const def = WEAPONS.knife;
    const mh = this.map.raycast(o, d, def.range);
    const maxT = mh ? mh.t : def.range;
    let best = null;
    for (const c of this.chars) {
      if (c === char || !c.alive || c.squad === char.squad) continue;
      const h = c.hitTest(o, d, maxT);
      if (h && (!best || h.t < best.t)) best = { ...h, char: c };
    }
    this.audio.melee(char);
    if (char === this.viewTarget) this.viewmodel.onFire(def);
    if (best) {
      const back = best.char.forward().setY(0).normalize().dot(d.clone().setY(0).normalize()) > 0.5;
      let dmg = alt ? 75 : 50;
      if (back) dmg *= 2;
      char.hits++;
      best.char.takeDamage(dmg, char, { weaponName: 'Knife', weaponId: 'knife', headshot: false });
      if (char.isPlayer) this.hud.hitMarker(false, !best.char.alive);
      this.effects.blood(o.clone().addScaledVector(d, best.t));
    } else if (mh) this.effects.impact(mh.point, mh.normal);
  }

  onWeaponFired(char, def) {
    this.audio.shot(char, def);
    const ejects = def.type !== 'knives' && def.type !== 'sniper' && def.id !== 'sheriff';
    if (char === this.viewTarget) {
      this.viewmodel.onFire(def);
      this.effects.pulseLight(this.viewmodel.muzzleWorld(this.camera));
      if (ejects) {
        const ep = this.viewmodel.ejectWorld(this.camera);
        const right = _r.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
        const up = _u.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
        this.effects.shell(ep, right.multiplyScalar(0.9).addScaledVector(up, 0.35).normalize(), char.vel);
      }
    } else if (def.type !== 'knives') {
      const mp = char.model.muzzleWorld();
      const far = mp.distanceTo(this.camera.position);
      this.effects.muzzle(mp, far > 30 ? 1.7 : 1);
      if (ejects && far < 24) {
        const rx = Math.cos(char.yaw), rz = -Math.sin(char.yaw);
        this.effects.shell(char.model.ejectWorld(), _r.set(rx, 0.4, rz).normalize(), char.vel);
      }
    }
    const eye = char.eyePos();
    for (const b of this.bots) {
      const c = b.char;
      if (!c.alive || c.squad === char.squad) continue;
      if (c.pos.distanceTo(char.pos) < 55) b.hear(eye, 'shot');
    }
  }

  onFootstep(char) {
    this.audio.footstep(char);
    for (const b of this.bots) {
      const c = b.char;
      if (!c.alive || c.squad === char.squad) continue;
      if (c.pos.distanceTo(char.pos) < 16) b.hear(char.eyePos(), 'step');
    }
  }

  onDamage(victim, attacker, amount, info) {
    if (victim.isPlayer) {
      this.hud.damageFrom(attacker?.pos);
      this.audio.hurt();
    }
    if (victim.bot) victim.bot.onDamaged(attacker);
    void amount; void info;
  }

  onKill(victim, killer, info) {
    const m = this.match;
    const enemyKill = killer && killer !== victim && killer.squad !== victim.squad;
    if (enemyKill) {
      killer.kills++;
      killer.credits = Math.min(ROUND.maxCredits, killer.credits + ROUND.killReward);
      killer.ult = Math.min(killer.ult + 1, killer.agent.abilities.X.ult);
      killer.roundKills = (killer.roundKills || 0) + 1;
      if (!m.firstBloodDone && m.phase === 'combat') { m.firstBloodDone = true; killer.firstBloods++; }
      if (killer.slots.special && info.weaponName === 'Blade Storm') killer.slots.special.ammo = 5;
      if (killer.isPlayer) {
        this.audio.killConfirm(killer.roundKills);
        this.hud.playerKill(info.headshot);
      }
    }
    if (!victim.isPlayer && victim.squad === this.playerSquad && m.phase === 'combat') {
      this.hud.callout(victim.name, `is down at ${this.map.zoneName(victim.pos)}`, 'ally');
    }
    for (const [aid, t] of victim.damageLog) {
      if (this.time - t > 10 || (killer && aid === killer.id)) continue;
      const a = this.chars[aid];
      if (a && a.squad !== victim.squad) a.assists++;
    }
    this.hud.addKill(killer, victim, info);
    // drops
    if (victim.slots.primary) { this.spawnPickup(victim.slots.primary, victim.pos); victim.slots.primary = null; }
    else if (victim.slots.secondary && victim.slots.secondary.id !== 'classic') { this.spawnPickup(victim.slots.secondary, victim.pos); victim.slots.secondary = null; }
    victim.slots.special = null;
    if (victim.hasSpike && m.phase === 'combat') m.dropSpike(victim.pos);
    victim.hasSpike = false;
    victim.marker.visible = false;
    if (victim.isPlayer) {
      // Killcam: watch the killer for a few seconds before moving on to teammates.
      this.killcam = enemyKill && killer.alive ? { target: killer, until: this.time + 4.5 } : null;
    }
  }

  onLand(char, speed) {
    this.audio.land(char, speed / 8);
    if (speed < 6) return;
    for (const b of this.bots) {
      const c = b.char;
      if (!c.alive || c.squad === char.squad) continue;
      if (c.pos.distanceTo(char.pos) < 14) b.hear(char.eyePos(), 'step');
    }
  }

  // Teammate voice line when they first spot an enemy.
  onCallout(reporter, enemy, pos) {
    if (reporter.squad !== this.playerSquad || reporter.isPlayer) return;
    if (this.time - this.lastCallout < 1.4) return;
    this.lastCallout = this.time;
    this.hud.callout(`${reporter.name}:`, `${enemy.agent.name} spotted — ${this.map.zoneName(pos)}`, 'ally');
  }

  onSpikeDropped(pos) {
    if (this.player?.team === 'atk') this.hud.callout('', `Spike dropped — ${this.map.zoneName(pos)}`, 'sys');
  }

  onSpikePickup(char) {
    if (this.player?.team === 'atk' && char.squad === this.playerSquad) this.hud.callout(char.name, 'picked up the Spike', 'ally');
  }

  onRevive(char) {
    if (char.isPlayer) {
      this.viewTarget = this.player;
      this.hud.toast('You have been resurrected!');
    }
  }

  onReveal() {}

  playerSees(c) {
    // enemy visible on the player's screen (for minimap)
    const p = this.viewTarget;
    if (!p || !p.alive || p.squad !== this.playerSquad) return false;
    if (!c._seenCheck || this.time - c._seenCheck.t > 0.2) {
      const eye = p.eyePos();
      const chest = c.chestPos();
      const to = chest.clone().sub(eye);
      const fwd = p.forward();
      const vis = to.clone().normalize().dot(fwd) > 0.55 && this.map.lineOfSight(eye, chest) && !this.abilities.smokeBlocks(eye, chest);
      c._seenCheck = { t: this.time, vis };
    }
    return c._seenCheck.vis;
  }

  cycleSpectate(reset = false) {
    if (!reset) this.killcam = null; // a manual switch ends the killcam
    const allies = this.chars.filter((c) => c.squad === this.playerSquad && c.alive && !c.isPlayer);
    if (this.player?.alive) { this.viewTarget = this.player; return; }
    if (!allies.length) { this.viewTarget = null; return; }
    const i = reset ? -1 : allies.indexOf(this.viewTarget);
    this.viewTarget = allies[(i + 1) % allies.length];
  }

  onRoundStart() {
    this.brain.onRoundStart();
    for (const b of this.bots) b.onRoundStart();
    for (const c of this.chars) { c.roundKills = 0; c.roundDamage = 0; }
    this.viewTarget = this.player;
    this.killcam = null;
    this.clearOrbs();
    this.spikeMarker.visible = false;
    this.hud.closeBuy();
  }

  onCombatStart() {
    this.brain.onCombatStart();
    this.spawnOrbs();
  }

  onRoundEnd() {
    this.clearOrbs();
    for (const b of this.bots) b.char.action = null;
  }

  onSpikePlanted(char) {
    if (char.squad === this.playerSquad) this.hud.callout(char.name, `planted the Spike — Site ${this.match.spike.site}`, 'sys');
    else this.hud.callout('', `Spike planted — Site ${this.match.spike.site}`, 'sys');
  }

  onExecute(site) {
    const atk = this.match.aliveOf('atk').filter((c) => c.bot);
    if (!atk.length || atk[0].squad !== this.playerSquad) return;
    this.hud.callout(`${atk[0].name}:`, `Go ${site}!`, 'ally');
  }

  onMatchOver(winSquad) {
    this.running = false;
    document.exitPointerLock?.();
    const won = winSquad === this.playerSquad;
    const t = $('end-title');
    t.textContent = won ? 'VICTORY' : 'DEFEAT';
    t.className = won ? 'win' : 'lose';
    $('end-score').textContent = `${this.match.score[0]} — ${this.match.score[1]}`;
    this.hud.renderEndTable($('end-table'));
    $('end-screen').classList.remove('hidden');
    $('pause').classList.add('hidden');
    this.audio.ui(won ? 'win' : 'lose');
    const { mvp } = this.matchMvps();
    if (mvp?.isPlayer) setTimeout(() => this.audio.ui('mvp'), 900);
  }

  // ------------------------------------------------------------------ loop
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const cap = this.settings.graphics.fpsCap;
    if (cap && now - this.last < 1000 / cap - 1) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const f = this.fps;
    f.frames++;
    if (now - f.last >= 500) {
      if (this.settings.graphics.showFps) $('fps').textContent = Math.round((f.frames * 1000) / (now - f.last)) + ' FPS';
      f.frames = 0;
      f.last = now;
    }
    if (this.running && !this.paused) this.update(dt);
    else if (!this.running && !this.match) this.menuCamera(dt);
    this.map.update(dt);
    this.render();
  }

  menuCamera(dt) {
    this.menuCamT += dt * 0.05;
    const r = 58;
    this.camera.position.set(Math.cos(this.menuCamT) * r, 34, Math.sin(this.menuCamT) * r);
    this.camera.lookAt(0, 0, 0);
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.showViewmodel = false;
  }

  update(dt) {
    this.time += dt;
    const m = this.match;
    m.update(dt);
    if (!this.running) return;
    this.brain.update();
    this.playerCtl.update(dt);
    for (const b of this.bots) b.update(dt);
    for (const c of this.chars) c.update(dt);

    // Blade Storm expiry, soft separation, bot pickups
    for (const c of this.chars) {
      if (!c.alive) continue;
      if (c.slot === 'special' && c.slots.special && c.slots.special.ammo <= 0) {
        c.slots.special = null;
        c.slot = c.bestSlot();
        c.equipEnd = this.time + 0.5;
      }
      for (const o of this.chars) {
        if (o === c || !o.alive || o.id < c.id) continue;
        const dx = o.pos.x - c.pos.x, dz = o.pos.z - c.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.65 && d > 1e-4 && Math.abs(o.pos.y - c.pos.y) < 1.5) {
          const push = (0.65 - d) * 6;
          c.vel.x -= (dx / d) * push; c.vel.z -= (dz / d) * push;
          o.vel.x += (dx / d) * push; o.vel.z += (dz / d) * push;
        }
      }
      if (c.bot && m.phase === 'combat' && this.pickups.length) {
        const p = this.nearestPickup(c, 1.4);
        if (p && p.weapon.def.slot === 'primary' && p.weapon.def.cost > (c.slots.primary?.def.cost ?? -1) && (p.weapon.ammo + p.weapon.reserve) > 0) this.takePickup(c, p);
      }
    }

    this.abilities.update(dt);
    this.effects.update(dt);
    this.updateOrbs(dt);
    this.updateSpikeMarker();
    this.updateCamera(dt);
    this.hud.update(dt);
  }

  // World marker over a dropped spike (attackers) or a planted spike (everyone).
  updateSpikeMarker() {
    const s = this.match.spike;
    const show = (s.state === 'dropped' && this.player.team === 'atk') || s.state === 'planted';
    this.spikeMarker.visible = show;
    if (show) this.spikeMarker.position.set(s.pos.x, s.pos.y + 1.7, s.pos.z);
  }

  updateCamera(dt) {
    const p = this.player;
    let vt = this.viewTarget;
    if (!p.alive) {
      const kc = this.killcam;
      if (p.deathT < 1.3) vt = p; // death cam over your own body
      else if (kc && kc.target.alive && this.time < kc.until) vt = kc.target; // killcam
      else if (!vt || vt === p || !vt.alive || vt.squad !== this.playerSquad) { this.cycleSpectate(true); vt = this.viewTarget; }
    } else if (!vt || !vt.alive) vt = p;
    this.viewTarget = vt;

    for (const c of this.chars) c.model.root.visible = true;
    const deathCam = !!vt && vt === p && !p.alive;
    if (vt && (vt.alive || deathCam)) {
      if (vt.alive) vt.model.root.visible = false;
      const eye = vt.eyePos();
      if (deathCam) {
        // brief death cam: look down at your body from above
        eye.set(vt.pos.x, vt.pos.y + 1.2 + vt.deathT * 1.2, vt.pos.z + 1 + vt.deathT);
        vt.model.root.visible = true;
      } else eye.y -= vt.landDip;
      this.camera.position.copy(eye);
      const w = vt.weapon;
      const punch = vt.alive ? w.recoilP * 0.3 * Math.PI / 180 : -0.9;
      this.camera.rotation.set(vt.pitch + punch, vt.yaw + (vt.alive ? w.recoilY * 0.3 * Math.PI / 180 : 0), 0);
      this.camera.updateMatrixWorld();
      const base = this.baseFov;
      const targetFov = vt.alive && vt.zoomed ? base / (w.def.zoom || 1) : base;
      const fov = this.camera.fov + (targetFov - this.camera.fov) * Math.min(1, dt * 18);
      if (Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
      this.viewYaw = vt.yaw;
      this.showViewmodel = vt.alive && !(vt.zoomed && w.def.scope);
      if (vt.alive) this.viewmodel.update(dt, vt, this);
    } else {
      // Overview camera
      this.camera.position.set(0, 72, 42);
      this.camera.lookAt(0, 0, 2);
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
      this.viewYaw = 0;
      this.showViewmodel = false;
    }
  }

  render() {
    const r = this.renderer;
    r.clear();
    r.render(this.scene, this.camera);
    if (this.showViewmodel && this.running) {
      r.clearDepth();
      r.render(this.viewmodel.scene, this.viewmodel.camera);
    }
  }
}

window.game = new Game();
void clamp;
