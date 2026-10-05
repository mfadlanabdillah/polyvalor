import { KEY_ACTIONS, keyLabel, renderCrosshair, resetSection, saveSettings } from './settings.js';

const $ = (id) => document.getElementById(id);
const COLORS = ['#6fffb0', '#ffffff', '#ffe27a', '#4fe0c8', '#ff5fd2', '#ff4655', '#00e5ff'];

export class SettingsUI {
  constructor(game) {
    this.game = game;
    this.tab = 'general';
    this.capture = null;
    this.root = $('settings');
    this.root.querySelectorAll('.set-tabs button').forEach((b) => {
      b.onclick = () => { this.tab = b.dataset.tab; this.render(); };
    });
    $('set-close').onclick = () => this.close();
    $('set-reset').onclick = () => {
      const map = { general: null, gameplay: 'gameplay', crosshair: 'crosshair', graphics: 'graphics', controls: 'keys' };
      const s = this.game.settings;
      if (map[this.tab]) resetSection(s, map[this.tab]);
      else { s.sens = 0.4; s.volume = 0.6; }
      this.changed();
      this.render();
    };
    window.addEventListener('keydown', (e) => this.onCaptureKey(e), true);
    window.addEventListener('mousedown', (e) => this.onCaptureMouse(e), true);
  }

  get s() { return this.game.settings; }
  get isOpen() { return !this.root.classList.contains('hidden'); }

  open(onClose) {
    this.onClose = onClose;
    this.root.classList.remove('hidden');
    this.render();
  }

  close() {
    this.capture = null;
    this.root.classList.add('hidden');
    this.onClose?.();
  }

  changed() {
    saveSettings(this.s);
    this.game.applySettings();
  }

  render() {
    this.root.querySelectorAll('.set-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    const body = $('set-body');
    body.innerHTML = this[`page_${this.tab}`]();
    this[`bind_${this.tab}`]?.(body);
  }

  // ---------- helpers ----------
  slider(id, label, min, max, step, value, fmt = (v) => v) {
    return `<label class="set-row"><span>${label}</span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" /><b id="${id}-v">${fmt(value)}</b></label>`;
  }
  check(id, label, on) {
    return `<label class="set-row"><span>${label}</span><input id="${id}" type="checkbox" ${on ? 'checked' : ''} /><b></b></label>`;
  }
  select(id, label, opts, value) {
    return `<label class="set-row"><span>${label}</span><select id="${id}">${opts.map(([v, t]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${t}</option>`).join('')}</select><b></b></label>`;
  }
  onSlider(id, fn, fmt = (v) => v) {
    const el = $(id);
    el.oninput = () => { const v = +el.value; $(id + '-v').textContent = fmt(v); fn(v); this.changed(); };
  }
  onCheck(id, fn) { const el = $(id); el.onchange = () => { fn(el.checked); this.changed(); }; }
  onSelect(id, fn) { const el = $(id); el.onchange = () => { fn(el.value); this.changed(); }; }

  // ---------- pages ----------
  page_general() {
    return this.slider('st-sens', 'Mouse sensitivity', 0.05, 1.5, 0.01, this.s.sens, (v) => v.toFixed(2)) +
      this.slider('st-vol', 'Master volume', 0, 1, 0.01, this.s.volume, (v) => Math.round(v * 100) + '%');
  }
  bind_general() {
    this.onSlider('st-sens', (v) => { this.s.sens = v; }, (v) => v.toFixed(2));
    this.onSlider('st-vol', (v) => { this.s.volume = v; }, (v) => Math.round(v * 100) + '%');
  }

  page_gameplay() {
    const p = this.s.gameplay;
    const cols = [['#e2505a', 'Red'], ['#f2d24a', 'Yellow'], ['#a86bff', 'Purple'], ['#ff9a3c', 'Orange']];
    return `<div class="set-row"><span>Enemy highlight color</span><div class="swatches">${cols.map(([c, n]) => `<i data-ecol="${c}" title="${n}" class="${c === p.enemyColor ? 'on' : ''}" style="background:${c}"></i>`).join('')}</div><b></b></div>` +
      this.check('gp-hit', 'Hit markers', p.hitMarkers) +
      this.check('gp-dmg', 'Damage numbers', p.damageNumbers) +
      this.check('gp-call', 'Teammate callouts feed', p.callouts) +
      this.check('gp-bob', 'Weapon sway and bob', p.viewBob) +
      this.check('gp-hint', 'Show gameplay hints', p.hints) +
      '<p class="set-note">Enemy highlight color changes enemy bodies, the minimap and the kill feed (useful for color-blind players).</p>';
  }
  bind_gameplay(body) {
    const p = this.s.gameplay;
    body.querySelectorAll('.swatches i').forEach((sw) => {
      sw.onclick = () => {
        p.enemyColor = sw.dataset.ecol;
        body.querySelectorAll('.swatches i').forEach((x) => x.classList.toggle('on', x === sw));
        this.changed();
      };
    });
    this.onCheck('gp-hit', (v) => { p.hitMarkers = v; });
    this.onCheck('gp-dmg', (v) => { p.damageNumbers = v; });
    this.onCheck('gp-call', (v) => { p.callouts = v; });
    this.onCheck('gp-bob', (v) => { p.viewBob = v; });
    this.onCheck('gp-hint', (v) => { p.hints = v; });
  }

  page_crosshair() {
    const c = this.s.crosshair;
    return `<div class="xh-wrap"><div class="xh-preview"><div id="xh-prev" class="xh-center"></div></div><div class="xh-controls">
      <div class="set-row"><span>Color</span><div class="swatches">${COLORS.map((col) => `<i data-col="${col}" class="${col === c.color ? 'on' : ''}" style="background:${col}"></i>`).join('')}<input id="xh-color" type="color" value="${c.color}" /></div><b></b></div>
      ${this.slider('xh-thick', 'Thickness', 1, 6, 1, c.thickness)}
      ${this.slider('xh-len', 'Line length', 0, 16, 1, c.length)}
      ${this.slider('xh-gap', 'Center gap', 0, 14, 1, c.gap)}
      ${this.check('xh-outline', 'Outline', c.outline)}
      ${this.slider('xh-oo', 'Outline opacity', 0, 1, 0.05, c.outlineOpacity, (v) => Math.round(v * 100) + '%')}
      ${this.check('xh-dot', 'Center dot', c.dot)}
      ${this.check('xh-dyn', 'Movement / firing error', c.dynamic)}
    </div></div>`;
  }
  bind_crosshair(body) {
    const c = this.s.crosshair;
    const prev = () => renderCrosshair($('xh-prev'), c);
    prev();
    const after = () => { prev(); };
    body.querySelectorAll('.swatches i').forEach((sw) => {
      sw.onclick = () => { c.color = sw.dataset.col; $('xh-color').value = c.color; body.querySelectorAll('.swatches i').forEach((x) => x.classList.toggle('on', x === sw)); this.changed(); after(); };
    });
    $('xh-color').oninput = () => { c.color = $('xh-color').value; body.querySelectorAll('.swatches i').forEach((x) => x.classList.remove('on')); this.changed(); after(); };
    this.onSlider('xh-thick', (v) => { c.thickness = v; after(); });
    this.onSlider('xh-len', (v) => { c.length = v; after(); });
    this.onSlider('xh-gap', (v) => { c.gap = v; after(); });
    this.onCheck('xh-outline', (v) => { c.outline = v; after(); });
    this.onSlider('xh-oo', (v) => { c.outlineOpacity = v; after(); }, (v) => Math.round(v * 100) + '%');
    this.onCheck('xh-dot', (v) => { c.dot = v; after(); });
    this.onCheck('xh-dyn', (v) => { c.dynamic = v; });
  }

  page_graphics() {
    const g = this.s.graphics;
    return this.select('gx-shadow', 'Shadows', [['high', 'High'], ['low', 'Low'], ['off', 'Off']], g.shadows) +
      this.slider('gx-scale', 'Render resolution', 0.5, 1.5, 0.05, g.renderScale, (v) => Math.round(v * 100) + '%') +
      this.select('gx-fps', 'FPS limit', [[0, 'Unlimited (V-Sync)'], [30, '30'], [60, '60'], [120, '120'], [144, '144']], g.fpsCap) +
      this.check('gx-showfps', 'Show FPS counter', g.showFps) +
      this.slider('gx-fov', 'Field of view', 60, 100, 1, g.fov, (v) => v + '°') +
      '<p class="set-note">Lower the render resolution or turn shadows off if the game feels choppy.</p>';
  }
  bind_graphics() {
    const g = this.s.graphics;
    this.onSlider('gx-fov', (v) => { g.fov = v; }, (v) => v + '°');
    this.onSelect('gx-shadow', (v) => { g.shadows = v; });
    this.onSlider('gx-scale', (v) => { g.renderScale = v; }, (v) => Math.round(v * 100) + '%');
    this.onSelect('gx-fps', (v) => { g.fpsCap = +v; });
    this.onCheck('gx-showfps', (v) => { g.showFps = v; });
  }

  page_controls() {
    const k = this.s.keys;
    return '<div class="keybinds">' + KEY_ACTIONS.map(([id, label]) =>
      `<div class="kb-row"><span>${label}</span><button data-act="${id}" class="${this.capture === id ? 'cap' : ''}">${this.capture === id ? 'PRESS A KEY… (Esc to cancel)' : keyLabel(k[id])}</button></div>`).join('') +
      '</div><p class="set-note">Fire / zoom stay on the left / right mouse buttons. Mouse 4 and 5 can be bound. Esc always pauses.</p>';
  }
  bind_controls(body) {
    body.querySelectorAll('.kb-row button').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); this.capture = b.dataset.act; this.render(); };
    });
  }

  assign(code) {
    const k = this.s.keys;
    const act = this.capture;
    const prev = k[act];
    for (const [other, c] of Object.entries(k)) if (c === code && other !== act) k[other] = prev; // swap
    k[act] = code;
    this.capture = null;
    this.changed();
    this.render();
  }

  onCaptureKey(e) {
    if (!this.capture || !this.isOpen) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') { this.capture = null; this.render(); return; }
    this.assign(e.code);
  }

  onCaptureMouse(e) {
    if (!this.capture || !this.isOpen) return;
    if (e.button === 3 || e.button === 4) {
      e.preventDefault();
      e.stopPropagation();
      this.assign('Mouse' + e.button);
    }
  }
}
