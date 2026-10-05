import { fireWeapon } from './weapons.js';
import { clamp } from './utils.js';

// Human input -> character. Key bindings come from settings.keys (action -> KeyboardEvent.code).
export class PlayerController {
  constructor(world, char) {
    this.world = world;
    this.char = char;
    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.dx = 0;
    this.dy = 0;
    this.leftEdge = false;
    this.rightEdge = false;
    this.bind();
  }

  get binds() { return this.world.settings.keys; }
  down(action) { return this.keys.has(this.binds[action]); }
  actionFor(code) {
    for (const [a, c] of Object.entries(this.binds)) if (c === code) return a;
    return null;
  }

  bind() {
    this.onKeyDown = (e) => this.press(e.code, e);
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onMouseMove = (e) => {
      if (!this.world.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    };
    this.onMouseDown = (e) => {
      if (!this.world.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.leftEdge = true; }
      else if (e.button === 2) { this.mouse.right = true; this.rightEdge = true; }
      else if (e.button === 3 || e.button === 4) { e.preventDefault(); this.press('Mouse' + e.button, null); }
    };
    this.onMouseUp = (e) => {
      if (e.button === 0) this.mouse.left = false;
      else if (e.button === 2) this.mouse.right = false;
      else this.keys.delete('Mouse' + e.button);
    };
    this.onWheel = (e) => {
      if (!this.world.locked || this.world.hud.buyOpen) return;
      const order = ['primary', 'secondary', 'melee'].filter((s) => this.char.slots[s]);
      const i = order.indexOf(this.char.slot);
      const n = order[(i + (e.deltaY > 0 ? 1 : -1) + order.length) % order.length];
      if (n) this.char.equip(n);
    };
    this.onContext = (e) => e.preventDefault();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('contextmenu', this.onContext);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('contextmenu', this.onContext);
  }

  press(code, e) {
    const w = this.world;
    const action = this.actionFor(code);
    if (action === 'scoreboard') { e?.preventDefault(); if (w.locked) w.hud.setScoreboard(true); }
    if (!w.locked) return;
    if (e && (action || code === 'Tab' || code.startsWith('Control'))) e.preventDefault();
    if (e?.repeat) return;
    this.keys.add(code);
    const c = this.char;
    switch (action) {
      case 'buy': w.hud.toggleBuy(); break;
      case 'primary': c.equip('primary'); break;
      case 'secondary': c.equip('secondary'); break;
      case 'melee': c.equip('melee'); break;
      case 'reload': if (c.weapon.startReload(w.time)) w.audio.reload(c); break;
      case 'inspect': if (c.alive) w.viewmodel.inspect(w.time); break;
      case 'use': w.tryPickup(c); break;
      case 'drop': w.dropCurrent(c); break;
      case 'abilityC': case 'abilityQ': case 'abilityE': case 'ult': {
        if (!c.alive) break;
        const key = { abilityC: 'C', abilityQ: 'Q', abilityE: 'E', ult: 'X' }[action];
        if (!w.abilities.use(c, key)) {
          if (w.match.phase === 'buy') w.hud.toast('Abilities unlock when the round starts');
          else if (key === 'X' && c.ult < c.agent.abilities.X.ult) w.hud.toast(`Ultimate not ready (${c.ult}/${c.agent.abilities.X.ult})`);
          else if (key !== 'X' && c.charges[key] <= 0) w.hud.toast('No charges left');
        }
        break;
      }
    }
  }

  releaseAll() {
    this.keys.clear();
    this.mouse.left = this.mouse.right = false;
    this.world.hud.setScoreboard(false);
  }

  update(dt) {
    const w = this.world;
    const c = this.char;
    const t = w.time;
    const sens = w.settings.sens * 0.0022;
    const dx = this.dx, dy = this.dy;
    this.dx = this.dy = 0;
    if (!this.down('scoreboard') && w.hud.scoreboardOn) w.hud.setScoreboard(false);

    if (!c.alive) {
      if (this.leftEdge) w.cycleSpectate();
      this.leftEdge = this.rightEdge = false;
      return;
    }

    const buy = w.hud.buyOpen;
    if (buy) {
      w.hud.moveCursor(dx, dy);
      if (this.leftEdge) w.hud.clickCursor();
    } else {
      const zoomK = c.zoomed ? 1 / (c.weapon.def.zoom || 1) : 1;
      c.yaw -= dx * sens * zoomK;
      c.pitch = clamp(c.pitch - dy * sens * zoomK, -1.5, 1.5);
    }

    const def = c.weapon.def;
    const canZoom = (def.zoom || 1) > 1 && !c.weapon.reloading && t >= c.equipEnd && !buy;
    c.zoomed = canZoom && this.mouse.right && def.type !== 'melee';

    // movement
    let f = 0, s = 0;
    if (this.down('forward')) f += 1;
    if (this.down('back')) f -= 1;
    if (this.down('right')) s += 1;
    if (this.down('left')) s -= 1;
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    let wx = -sy * f + cy * s;
    let wz = -cy * f - sy * s;
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }
    c.walking = this.down('walk');
    // V stays as a fallback crouch key unless it is bound to something else
    c.crouching = this.down('crouch') || (this.keys.has('KeyV') && !this.actionFor('KeyV'));
    const jump = this.down('jump');

    // plant / defuse (hold)
    const holding = this.down('spike');
    const m = w.match;
    if (holding && !c.action && m.phase === 'combat' && c.onGround) {
      if (c.hasSpike && w.map.plantSiteAt(c.pos)) c.action = { type: 'plant', start: t };
      else if (c.team === 'def' && m.spike.state === 'planted' && c.pos.distanceTo(m.spike.pos) < 2) c.action = { type: 'defuse', start: t };
    } else if (!holding && c.action) c.action = null;

    // firing
    if (!buy && !c.action && m.phase !== 'buy' && m.phase !== 'pre') {
      if (def.type === 'melee') {
        if (this.leftEdge || (this.mouse.left && t >= c.weapon.nextFire)) fireWeapon(w, c, {});
        else if (this.rightEdge) fireWeapon(w, c, { alt: true });
      } else if (def.auto ? this.mouse.left : this.leftEdge) {
        fireWeapon(w, c, { zoomed: c.zoomed, recoilScale: 1 });
      }
    } else if (!buy && m.phase === 'buy' && this.leftEdge && def.type !== 'melee') {
      w.hud.toast('Weapons are locked during the buy phase');
    }
    this.leftEdge = this.rightEdge = false;

    c.physics(dt, wx, wz, jump);
  }
}
