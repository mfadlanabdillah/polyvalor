import * as THREE from 'three';
import { WEAPONS, BUY_LIST, SHIELDS, ROUND, COLORS, PENETRATION } from './config.js';
import { fmtTime, clamp, wrapAngle } from './utils.js';
import { renderCrosshair, keyLabel } from './settings.js';
import { abilityIcon } from './icons.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();
const PEN_LABEL = { low: 'Low', med: 'Medium', high: 'High' };

export class HUD {
  constructor(world) {
    this.world = world;
    this.root = $('hud');
    this.buyOpen = false;
    this.cursor = { x: innerWidth / 2, y: innerHeight / 2 };
    this.bannerTimer = 0;
    this.toastTimer = 0;
    this.dmgInds = [];
    this.dmgNums = [];
    this.damageFlash = 0;
    this.minimap = $('minimap');
    this.mctx = this.minimap.getContext('2d');
    this.mmBg = null;
    this.hovered = null;
    this.scoreboardOn = false;
    this.hmTimer = 0;
    this.zoneTick = 0;
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  get icons() { return this.world.icons || { weapons: {}, agents: {} }; }
  get enemyCss() { return COLORS.enemyCss; }

  // ---------- setup per match ----------
  setupMatch() {
    this.buildMinimapBg();
    this.invalidate();
    $('killfeed').innerHTML = '';
    $('kill-icons').innerHTML = '';
    $('callouts').innerHTML = '';
    $('dmg-numbers').innerHTML = '';
    this.dmgNums = [];
    this._portraitKey = null;
    this._hint = null;
    this.closeBuy();
  }

  // Forces ability bar / portraits to rebuild (e.g. after rebinding keys or changing enemy color).
  invalidate() {
    this._abAgent = null;
    this._portraitKey = null;
  }

  buildAbilities(char = this.world.player) {
    const ag = char.agent;
    this._abAgent = ag.id;
    const k = this.world.settings.keys;
    const keys = { C: k.abilityC, Q: k.abilityQ, E: k.abilityE, X: k.ult };
    const el = $('abilities');
    el.innerHTML = '';
    for (const key of ['C', 'Q', 'E', 'X']) {
      const ab = ag.abilities[key];
      const d = document.createElement('div');
      d.className = 'abl' + (key === 'X' ? ' ult' : '');
      d.innerHTML = `<div class="k">${keyLabel(keys[key])}</div><div class="ic" style="color:${ag.color}">${abilityIcon(ab.id)}</div><div class="nm">${ab.name}</div>` +
        (key === 'X' ? '<div class="ultp"></div>' : '<div class="pips"></div>');
      el.appendChild(d);
      this['ab' + key] = d;
    }
  }

  buildMinimapBg() {
    const map = this.world.map;
    const W = this.minimap.width, H = this.minimap.height;
    const s = Math.min((W - 16) / map.cols, (H - 16) / map.rows);
    this.mmScale = s;
    this.mmOx = (W - map.cols * s) / 2;
    this.mmOy = (H - map.rows * s) / 2;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    for (let r = 0; r < map.rows; r++) {
      for (let col = 0; col < map.cols; col++) {
        const ch = map.grid[r][col];
        if (ch === '#') continue;
        g.fillStyle = ch === 'A' || ch === 'B' ? 'rgba(255,200,120,0.55)' : ch === 'c' || ch === 'C' || ch === 'P' ? 'rgba(90,90,100,0.9)' : ch === 'T' ? 'rgba(255,120,130,0.35)' : ch === 'D' ? 'rgba(120,220,210,0.35)' : 'rgba(220,225,235,0.45)';
        g.fillRect(this.mmOx + col * s, this.mmOy + r * s, s + 0.5, s + 0.5);
      }
    }
    g.fillStyle = '#fff';
    g.font = 'bold 16px Rajdhani, sans-serif';
    g.textAlign = 'center';
    for (const [site, cc] of [['A', [36, 11]], ['B', [6, 11]]]) {
      g.fillText(site, this.mmOx + (cc[0] + 0.5) * s, this.mmOy + (cc[1] + 0.8) * s);
    }
    this.mmBg = c;
  }

  mmPoint(p) {
    const map = this.world.map;
    return [this.mmOx + ((p.x - map.ox) / map.w) * map.cols * this.mmScale, this.mmOy + ((p.z - map.oz) / map.h) * map.rows * this.mmScale];
  }

  // ---------- messages ----------
  banner(title, sub = '', color = '#fff', dur = 2.6) {
    const b = $('banner');
    b.classList.remove('hidden');
    b.querySelector('.b-title').textContent = title;
    b.querySelector('.b-title').style.color = color;
    b.querySelector('.b-sub').textContent = sub;
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    this.bannerTimer = dur;
  }

  toast(msg, dur = 2.2) {
    const t = $('toast');
    t.textContent = msg;
    t.style.opacity = 1;
    this.toastTimer = dur;
  }

  announceUlt(char, name) {
    const ally = char.squad === this.world.playerSquad;
    if (char.isPlayer) return;
    this.toast(`${ally ? 'ALLY' : 'ENEMY'} ${char.agent.name.toUpperCase()} — ${name.toUpperCase()}`);
  }

  // Team chat-style line: kind = 'ally' | 'sys'
  callout(name, text, kind = 'ally') {
    if (!this.world.settings.gameplay.callouts) return;
    const feed = $('callouts');
    const d = document.createElement('div');
    d.className = 'co ' + kind;
    d.innerHTML = name ? `<b>${name}</b> ${text}` : text;
    feed.appendChild(d);
    while (feed.children.length > 5) feed.firstChild.remove();
    setTimeout(() => d.classList.add('fade'), 5200);
    setTimeout(() => d.remove(), 6000);
  }

  addKill(killer, victim, info) {
    const feed = $('killfeed');
    const d = document.createElement('div');
    const mine = killer?.isPlayer || victim.isPlayer;
    d.className = 'kf' + (mine ? ' mine' : '');
    const cls = (c) => (c.squad === this.world.playerSquad ? 'ally' : 'enemy');
    const kn = killer && killer !== victim ? `<span class="${cls(killer)}">${killer.name}</span>` : '';
    const icon = info.weaponId && this.icons.weapons[info.weaponId];
    const wp = icon ? `<img class="kf-ic" src="${icon}" alt="${info.weaponName || ''}" />` : `<span class="wp">${info.weaponName || '—'}</span>`;
    d.innerHTML = `${kn}${wp}${info.headshot ? '<span class="hs">◉</span>' : ''}<span class="${cls(victim)}">${victim.name}</span>`;
    feed.prepend(d);
    while (feed.children.length > 6) feed.lastChild.remove();
    setTimeout(() => d.remove(), 7000);
  }

  playerKill(headshot) {
    const el = $('kill-icons');
    const d = document.createElement('div');
    d.className = 'ki' + (headshot ? ' hs' : '');
    el.appendChild(d);
    this.killIconTimer = 3;
  }

  hitMarker(head, kill) {
    if (!this.world.settings.gameplay.hitMarkers) return;
    const hm = $('hitmarker');
    hm.className = '';
    void hm.offsetWidth;
    hm.className = 'show' + (head ? ' head' : '') + (kill ? ' kill' : '');
  }

  damageNumber(pos, dmg, head, kill) {
    if (!this.world.settings.gameplay.damageNumbers) return;
    const el = document.createElement('div');
    el.className = 'dn' + (head ? ' head' : '') + (kill ? ' kill' : '');
    el.textContent = dmg;
    $('dmg-numbers').appendChild(el);
    this.dmgNums.push({ pos: pos.clone(), el, life: 0.9, drift: (Math.random() - 0.5) * 0.6 });
    if (this.dmgNums.length > 14) this.dmgNums.shift().el.remove();
  }

  damageFrom(attackerPos) {
    const w = this.world;
    const p = w.player;
    this.damageFlash = 0.6;
    if (!attackerPos) return;
    const ang = Math.atan2(-(attackerPos.x - p.pos.x), -(attackerPos.z - p.pos.z));
    const rel = wrapAngle(ang - p.yaw);
    const d = document.createElement('div');
    d.className = 'dmg-ind';
    d.style.transform = `rotate(${-rel}rad)`;
    $('dmg-indicators').appendChild(d);
    this.dmgInds.push({ el: d, life: 1.2 });
  }

  // ---------- buy menu ----------
  toggleBuy() {
    if (this.buyOpen) this.closeBuy();
    else this.openBuy();
  }

  openBuy() {
    const w = this.world;
    if (w.match.phase !== 'buy' || !w.player.alive) {
      this.toast('You can only buy during the buy phase');
      return;
    }
    this.buyOpen = true;
    $('buy-menu').classList.remove('hidden');
    $('cursor').classList.remove('hidden');
    $('crosshair').classList.add('hidden');
    this.cursor = { x: innerWidth / 2, y: innerHeight / 2 };
    this.renderBuy();
    this.showDetail(null);
  }

  closeBuy() {
    this.buyOpen = false;
    $('buy-menu').classList.add('hidden');
    $('cursor').classList.add('hidden');
    $('crosshair').classList.remove('hidden');
  }

  renderBuy() {
    const w = this.world;
    const p = w.player;
    const k = w.settings.keys;
    $('buy-credits').textContent = p.credits;
    $('buy-menu').querySelector('.buy-tip').textContent = `Click to buy · click an item bought this round to sell it · ${keyLabel(k.buy)} to close`;
    const wi = this.icons.weapons;
    const row = (info, attrs, name, cost, sub, owned, poor, iconHtml = '') =>
      `<div class="buy-item${owned ? ' owned' : ''}${poor ? ' poor' : ''}" data-info="${info}" ${attrs}>${iconHtml}<div class="bi-txt">${name}${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="cost">${cost === 0 ? 'FREE' : '¤ ' + cost}</div></div>`;
    let html = '';
    for (const [cat, ids] of Object.entries(BUY_LIST)) {
      html += `<div class="buy-cat"><h4>${cat.toUpperCase()}</h4>`;
      for (const id of ids) {
        const def = WEAPONS[id];
        const owned = p.slots[def.slot]?.id === id;
        const poor = !owned && def.cost > p.credits;
        const ic = wi[id] ? `<img class="wpn-card-ic" src="${wi[id]}" alt="" />` : '';
        html += `<div class="buy-item card${owned ? ' owned' : ''}${poor ? ' poor' : ''}" data-buy="w:${id}" data-info="w:${id}">${ic}<div class="card-row"><span class="nm">${def.name}</span><span class="cost">${def.cost === 0 ? 'FREE' : '¤ ' + def.cost}</span></div></div>`;
      }
      html += '</div>';
    }
    $('buy-weapons').innerHTML = html;

    $('buy-quick').innerHTML = `<div class="buy-item quick" data-buy="q:auto" data-info="q:auto"><div class="bi-txt">QUICK BUY<div class="sub">Best loadout for your credits</div></div><div class="cost">★</div></div>`;

    let sh = '<div class="buy-cat"><h4>SHIELDS</h4>';
    for (const s of Object.values(SHIELDS)) {
      sh += row(`s:${s.id}`, `data-buy="s:${s.id}"`, s.name, s.cost, `+${s.value} armor`, p.armor >= s.value, p.armor < s.value && s.cost > p.credits);
    }
    $('buy-shields').innerHTML = sh + '</div>';
    let ab = '<div class="buy-cat"><h4>ABILITIES</h4>';
    const keyOf = { C: k.abilityC, Q: k.abilityQ, E: k.abilityE };
    for (const key of ['C', 'Q', 'E']) {
      const a = p.agent.abilities[key];
      const sub = `${p.charges[key]} / ${a.max} charges${a.free ? ' · 1 free per round' : ''}`;
      const ic = `<span class="ab-ic" style="color:${p.agent.color}">${abilityIcon(a.id)}</span>`;
      const name = `<span class="kk">${keyLabel(keyOf[key])}</span> ${a.name}`;
      if (a.cost === 0) ab += row(`a:${key}`, '', name, 0, sub, p.charges[key] >= a.max, false, ic);
      else ab += row(`a:${key}`, `data-buy="a:${key}"`, name, a.cost, sub, p.charges[key] >= a.max, a.cost > p.credits, ic);
    }
    $('buy-abilities').innerHTML = ab + '</div>';
    let tm = '<div class="buy-cat"><h4>TEAM</h4>';
    for (const c of w.chars.filter((c) => c.squad === w.playerSquad)) {
      tm += `<div class="tm"><span>${c.name} <span style="color:${c.agent.color}">${c.agent.name}</span></span><span>${c.slots.primary?.def.name || c.slots.secondary?.def.name || ''} <span class="c">¤${c.credits}</span></span></div>`;
    }
    $('buy-team').innerHTML = tm + '</div>';
  }

  bar(v, max, label, text) {
    return `<div class="bd-stat"><span>${label}</span><b>${text}</b><div class="bd-bar"><i style="width:${clamp((v / max) * 100, 3, 100)}%"></i></div></div>`;
  }

  showDetail(el) {
    const box = $('buy-detail');
    const info = el?.dataset?.info;
    const w = this.world;
    const p = w.player;
    if (!info) {
      box.innerHTML = '<div class="bd-empty">Hover an item to see its stats.</div>';
      return;
    }
    const [kind, id] = info.split(':');
    if (kind === 'w') {
      const d = WEAPONS[id];
      const r = d.dmg[0];
      const pen = PENETRATION[d.pen || 'low'];
      box.innerHTML = `<div class="bd-name">${d.name.toUpperCase()} <span>${d.type}</span></div>` +
        this.bar(r[2], 150, 'Body damage', `${r[1]} / ${r[2]} / ${r[3]}`) +
        this.bar(d.rate, 14, 'Fire rate', `${d.rate.toFixed(1)}/s ${d.auto ? '· auto' : '· semi'}`) +
        this.bar(d.mag, 30, 'Magazine', `${d.mag}`) +
        this.bar(pen.maxThick * pen.mult, 3.4, 'Wall penetration', PEN_LABEL[d.pen || 'low']);
    } else if (kind === 's') {
      const s = SHIELDS[id];
      box.innerHTML = `<div class="bd-name">${s.name.toUpperCase()}</div><div class="bd-text">Absorbs ${s.value} damage before your health is hit. Lost when you die.</div>`;
    } else if (kind === 'a') {
      const a = p.agent.abilities[id];
      box.innerHTML = `<div class="bd-name">${a.name.toUpperCase()} <span>${p.agent.name}</span></div><div class="bd-text">${a.desc}</div>`;
    } else if (kind === 'q') {
      box.innerHTML = '<div class="bd-name">QUICK BUY</div><div class="bd-text">Buys the strongest primary weapon you can afford while keeping money for a shield and your abilities.</div>';
    }
  }

  moveCursor(dx, dy) {
    this.cursor.x = clamp(this.cursor.x + dx, 0, innerWidth - 4);
    this.cursor.y = clamp(this.cursor.y + dy, 0, innerHeight - 4);
    const c = $('cursor');
    c.style.left = this.cursor.x + 'px';
    c.style.top = this.cursor.y + 'px';
    const el = document.elementFromPoint(this.cursor.x, this.cursor.y)?.closest?.('.buy-item');
    if (el !== this.hovered) {
      this.hovered?.classList.remove('hover');
      el?.classList.add('hover');
      this.hovered = el;
      this.showDetail(el);
    }
  }

  clickCursor() {
    const el = document.elementFromPoint(this.cursor.x, this.cursor.y)?.closest?.('[data-buy]');
    if (!el) return;
    const [kind, id] = el.dataset.buy.split(':');
    const w = this.world;
    const p = w.player;
    let ok = false;
    if (kind === 'w') {
      const def = WEAPONS[id];
      if (p.slots[def.slot]?.id === id) ok = w.sellWeapon(p, def.slot);
      else ok = w.buyWeapon(p, id);
    } else if (kind === 's') {
      if (p.shieldBuy && p.shieldBuy.round === w.match.round && p.shieldBuy.type === id) ok = w.sellShield(p);
      else ok = w.buyShield(p, id);
    } else if (kind === 'a') ok = w.buyAbility(p, id);
    else if (kind === 'q') ok = w.quickBuy(p);
    w.audio.ui(ok ? 'buy' : 'deny');
    this.renderBuy();
    this.hovered = null;
    this.moveCursor(0, 0);
  }

  // ---------- scoreboard ----------
  setScoreboard(on) {
    this.scoreboardOn = on;
    $('scoreboard').classList.toggle('hidden', !on);
    if (on) this.renderScoreboard($('scoreboard'), true);
  }

  historyStrip() {
    const m = this.world.match;
    const ps = this.world.playerSquad;
    const glyph = { elim: '✕', time: 'T', detonate: '◆', defuse: '✓' };
    return m.history.map((h, i) => {
      const sep = i === m.halfAt ? '<i class="sep"></i>' : '';
      return `${sep}<b class="rh ${h.winSquad === ps ? 'w' : 'l'}" title="Round ${i + 1}">${glyph[h.reason] || '•'}</b>`;
    }).join('');
  }

  renderScoreboard(el, live) {
    const w = this.world;
    const m = w.match;
    const rows = [...w.chars].sort((a, b) => (a.squad - b.squad) || (w.acs(b) - w.acs(a)));
    let html = `<div class="sb-head"><span style="color:var(--ally)">YOUR TEAM ${m.score[0]}</span><span class="sb-mode">${m.inOvertime ? 'OVERTIME' : `ROUND ${m.round}`}</span><span style="color:var(--enemy)">${m.score[1]} ENEMY TEAM</span></div>`;
    if (m.history.length) html += `<div class="sb-hist">${this.historyStrip()}</div>`;
    html += '<table><tr><th></th><th>PLAYER</th><th>ACS</th><th>K</th><th>D</th><th>A</th><th>CREDITS</th><th>ULT</th></tr>';
    for (const c of rows) {
      const ally = c.squad === w.playerSquad;
      const img = this.icons.agents[c.agentId] ? `<img class="sb-ag" src="${this.icons.agents[c.agentId]}" alt="" />` : '';
      html += `<tr class="${ally ? 'ally' : 'enemy'}${c.isPlayer ? ' me' : ''}${live && !c.alive ? ' dead' : ''}"><td class="ic">${img}</td><td>${c.name} <span class="ag" style="color:${c.agent.color}">${c.agent.name}</span></td><td>${w.acs(c)}</td><td>${c.kills}</td><td>${c.deaths}</td><td>${c.assists}</td><td>${ally ? '¤ ' + c.credits : '—'}</td><td>${c.ult}/${c.agent.abilities.X.ult}</td></tr>`;
    }
    el.innerHTML = html + '</table>';
  }

  // End-of-match table with MVP badges and extended stats.
  renderEndTable(el) {
    const w = this.world;
    const { mvp, svp } = w.matchMvps();
    const rows = [...w.chars].sort((a, b) => (a.squad - b.squad) || (w.acs(b) - w.acs(a)));
    let html = '<table><tr><th></th><th>PLAYER</th><th>ACS</th><th>K / D / A</th><th>ADR</th><th>HS%</th><th>FB</th><th></th></tr>';
    for (const c of rows) {
      const ally = c.squad === w.playerSquad;
      const img = this.icons.agents[c.agentId] ? `<img class="sb-ag" src="${this.icons.agents[c.agentId]}" alt="" />` : '';
      const badge = c === mvp ? '<span class="mvp">MATCH MVP</span>' : c === svp ? '<span class="mvp team">TEAM MVP</span>' : '';
      html += `<tr class="${ally ? 'ally' : 'enemy'}${c.isPlayer ? ' me' : ''}"><td class="ic">${img}</td><td>${c.name} <span class="ag" style="color:${c.agent.color}">${c.agent.name}</span></td><td>${w.acs(c)}</td><td>${c.kills} / ${c.deaths} / ${c.assists}</td><td>${w.adr(c)}</td><td>${w.hsPct(c)}%</td><td>${c.firstBloods}</td><td>${badge}</td></tr>`;
    }
    el.innerHTML = html + '</table>';
  }

  // ---------- per-frame ----------
  update(dt) {
    const w = this.world;
    const m = w.match;
    const p = w.player;
    const t = w.time;
    const vt = w.viewTarget || p;
    const k = w.settings.keys;

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) $('banner').classList.add('hidden');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) $('toast').style.opacity = 0;
    }
    if (this.killIconTimer > 0) {
      this.killIconTimer -= dt;
      if (this.killIconTimer <= 0) $('kill-icons').innerHTML = '';
    }

    // Top bar
    $('score-ally').textContent = m.score[0];
    $('score-enemy').textContent = m.score[1];
    const timer = $('timer');
    if (m.spike.state === 'planted' && m.phase === 'combat') {
      timer.textContent = '◆ ' + Math.ceil(Math.max(0, m.timer));
      timer.classList.add('spike');
    } else {
      timer.classList.remove('spike');
      timer.textContent = m.phase === 'post' || m.phase === 'over' ? '—' : fmtTime(m.timer);
    }
    $('round-label').textContent = m.phase === 'buy' ? 'BUY PHASE' : m.inOvertime ? `OVERTIME · R${m.round}` : `ROUND ${m.round}`;
    this.renderPortraits();

    // Vitals from view target
    const hpEl = $('hp-val');
    hpEl.textContent = Math.ceil(vt.hp);
    hpEl.classList.toggle('low', vt.hp < 30);
    $('armor-val').textContent = Math.ceil(vt.armor);
    const wpn = vt.weapon;
    if (wpn.def.mag) {
      $('ammo').textContent = wpn.reloading ? '…' : wpn.ammo;
      $('reserve').textContent = wpn.def.reserve ? '/ ' + wpn.reserve : '';
    } else {
      $('ammo').textContent = '∞';
      $('reserve').textContent = '';
    }
    $('weapon-name').textContent = wpn.def.name.toUpperCase();
    const wic = $('weapon-icon');
    const src = this.icons.weapons[wpn.id] || '';
    if (wic.dataset.id !== wpn.id) { wic.dataset.id = wpn.id; if (src) wic.src = src; wic.style.visibility = src ? 'visible' : 'hidden'; }
    $('credits-small').textContent = m.phase === 'buy' && vt === p ? `¤ ${p.credits}  ·  [${keyLabel(k.buy)}] BUY` : '';
    $('spike-carrier').classList.toggle('hidden', !vt.hasSpike);

    // Abilities
    if (this._abAgent !== vt.agentId) this.buildAbilities(vt);
    for (const key of ['C', 'Q', 'E', 'X']) {
      const el = this['ab' + key];
      if (!el) continue;
      const ab = vt.agent.abilities[key];
      if (key === 'X') {
        el.querySelector('.ultp').textContent = `${vt.ult} / ${ab.ult}`;
        el.classList.toggle('ready', vt.ult >= ab.ult);
        el.classList.toggle('empty', vt.ult < ab.ult);
      } else {
        const pips = el.querySelector('.pips');
        const want = ab.max + ':' + vt.charges[key];
        if (pips.dataset.v !== want) {
          pips.dataset.v = want;
          pips.innerHTML = Array.from({ length: ab.max }, (_, i) => `<div class="pip${i < vt.charges[key] ? ' on' : ''}"></div>`).join('');
        }
        el.classList.toggle('empty', vt.charges[key] <= 0);
      }
    }
    if (this.buyOpen) {
      if (m.phase !== 'buy' || !p.alive) this.closeBuy();
      else $('buy-credits').textContent = p.credits;
    }
    if (this.scoreboardOn && Math.floor(t * 4) !== this._sbTick) { this._sbTick = Math.floor(t * 4); this.renderScoreboard($('scoreboard'), true); }

    // Prompts & progress
    let prompt = '';
    let prog = null;
    if (p.alive && m.phase === 'combat') {
      const site = w.map.plantSiteAt(p.pos);
      if (p.hasSpike && site && !p.action) prompt = `Hold <kbd>${keyLabel(k.spike)}</kbd> to plant the Spike`;
      else if (p.team === 'def' && m.spike.state === 'planted' && p.pos.distanceTo(m.spike.pos) < 2 && !p.action) prompt = `Hold <kbd>${keyLabel(k.spike)}</kbd> to defuse`;
      const pu = w.nearestPickup(p);
      if (!prompt && pu) prompt = `<kbd>${keyLabel(k.use)}</kbd> Pick up ${pu.weapon.def.name}`;
    }
    const act = vt.alive ? vt.action : null;
    if (act?.type === 'plant') prog = { label: 'PLANTING', v: (t - act.start) / ROUND.plantTime, half: false };
    else if (act?.type === 'defuse') prog = { label: 'DEFUSING', v: m.spike.defuseProgress / ROUND.defuseTime, half: true };
    if (prompt !== this._prompt) { this._prompt = prompt; $('prompt').innerHTML = prompt; }
    const pe = $('progress');
    if (prog) {
      pe.classList.remove('hidden');
      pe.querySelector('.p-label').textContent = prog.label;
      pe.querySelector('.p-fill').style.width = clamp(prog.v, 0, 1) * 100 + '%';
      pe.querySelector('.p-half').style.display = prog.half ? 'block' : 'none';
    } else pe.classList.add('hidden');

    // Death / spectate / killcam
    const di = $('death-info');
    if (!p.alive && m.phase !== 'buy') {
      di.classList.remove('hidden');
      const kl = p.killedBy;
      const viewing = w.viewTarget;
      let sub;
      if (viewing && viewing.squad !== w.playerSquad) sub = `<div class="spec">KILLCAM — ${viewing.name} · ${Math.ceil(viewing.hp)} HP</div>`;
      else if (viewing && viewing !== p) sub = `<div class="spec">SPECTATING ${viewing.name} (${viewing.agent.name}) — click to switch</div>`;
      else sub = '<div class="spec">No teammates alive</div>';
      di.innerHTML = (kl ? `<div>KILLED BY <span class="killer">${kl.name}</span> · ${kl.weapon || ''}</div>` : '<div>YOU DIED</div>') + sub;
    } else di.classList.add('hidden');

    // Overlays
    const blindLeft = vt.blindUntil - t;
    $('flash-overlay').style.opacity = blindLeft > 0 ? Math.min(1, blindLeft / Math.min(0.8, vt.blindDur || 1)) : 0;
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.5);
    $('damage-overlay').style.opacity = this.damageFlash;
    $('smoke-overlay').style.opacity = w.abilities.inSmoke(w.camera.position) ? 1 : 0;
    const scoped = vt.alive && vt.zoomed && vt.weapon.def.scope;
    $('scope-overlay').classList.toggle('hidden', !scoped);
    const hideXh = scoped || this.buyOpen;
    if (hideXh !== this._hideXh) { this._hideXh = hideXh; $('crosshair').style.visibility = hideXh ? 'hidden' : 'visible'; }
    for (let i = this.dmgInds.length - 1; i >= 0; i--) {
      const d = this.dmgInds[i];
      d.life -= dt;
      d.el.style.opacity = clamp(d.life, 0, 1);
      if (d.life <= 0) { d.el.remove(); this.dmgInds.splice(i, 1); }
    }
    this.updateDamageNumbers(dt);
    this.updateCrosshair(vt);
    this.updateZone(dt, vt);
    this.updateHint(p, m);
    this.drawMinimap();
  }

  updateDamageNumbers(dt) {
    const w = this.world;
    for (let i = this.dmgNums.length - 1; i >= 0; i--) {
      const d = this.dmgNums[i];
      d.life -= dt;
      d.pos.y += dt * 0.7;
      d.pos.x += d.drift * dt;
      _v.copy(d.pos).project(w.camera);
      if (_v.z > 1 || d.life <= 0) {
        d.el.style.display = 'none';
      } else {
        d.el.style.display = 'block';
        d.el.style.transform = `translate(${((_v.x * 0.5 + 0.5) * innerWidth).toFixed(0)}px, ${((-_v.y * 0.5 + 0.5) * innerHeight).toFixed(0)}px)`;
        d.el.style.opacity = clamp(d.life / 0.4, 0, 1);
      }
      if (d.life <= 0) { d.el.remove(); this.dmgNums.splice(i, 1); }
    }
  }

  updateZone(dt, vt) {
    this.zoneTick -= dt;
    if (this.zoneTick > 0) return;
    this.zoneTick = 0.25;
    const name = this.world.map.zoneName(vt.pos);
    if (name !== this._zone) { this._zone = name; $('zone-label').textContent = '▸ ' + name.toUpperCase(); }
  }

  updateHint(p, m) {
    const w = this.world;
    const k = w.settings.keys;
    let text = '';
    if (w.settings.gameplay.hints && m.round <= 2 && p.alive) {
      if (m.phase === 'buy') text = `Press <kbd>${keyLabel(k.buy)}</kbd> to open the Armory · the round starts when the timer ends`;
      else if (m.phase === 'combat') {
        if (p.hasSpike) text = `You carry the Spike — take it to <b>A</b> or <b>B</b> and hold <kbd>${keyLabel(k.spike)}</kbd> to plant`;
        else if (p.team === 'atk') text = m.spike.state === 'planted' ? 'Guard the planted Spike until it detonates' : 'Escort the Spike carrier and take a site';
        else text = m.spike.state === 'planted' ? `Retake the site, then hold <kbd>${keyLabel(k.spike)}</kbd> next to the Spike to defuse` : 'Hold the sites and stop the attackers from planting';
      }
    }
    if (text !== this._hint) {
      this._hint = text;
      const el = $('hint-bar');
      el.innerHTML = text;
      el.classList.toggle('hidden', !text);
    }
  }

  updateCrosshair(vt) {
    const w = vt.weapon;
    const ch = this.world.settings.crosshair;
    let extra = 0;
    if (ch.dynamic && w.def.spread) {
      const speed = Math.hypot(vt.vel.x, vt.vel.z);
      extra = Math.round(Math.min(14, (speed > 1.6 ? (speed / 5.4) * 8 : 0) + (vt.onGround ? 0 : 8) + w.spray * 0.4));
    }
    const key = extra + JSON.stringify(ch);
    if (key !== this._xhKey) {
      this._xhKey = key;
      renderCrosshair($('crosshair'), ch, extra);
    }
  }

  renderPortraits() {
    const w = this.world;
    const key = w.chars.map((c) => (c.alive ? 1 : 0)).join('') + (w.viewTarget?.id ?? '') + COLORS.enemyCss;
    if (key === this._portraitKey) return;
    this._portraitKey = key;
    for (const [sq, id] of [[w.playerSquad, 'portraits-ally'], [1 - w.playerSquad, 'portraits-enemy']]) {
      const el = $(id);
      const border = sq === w.playerSquad ? COLORS.allyCss : COLORS.enemyCss;
      el.innerHTML = w.chars.filter((c) => c.squad === sq).map((c) => {
        const img = this.icons.agents[c.agentId];
        const inner = img ? `<img src="${img}" alt="${c.agent.name}" />` : c.agent.name[0];
        return `<div class="portrait${c.alive ? '' : ' dead'}${c.isPlayer ? ' me' : ''}" style="background:${c.agent.color};border-color:${border}">${inner}</div>`;
      }).join('');
    }
  }

  drawMinimap() {
    const w = this.world;
    const g = this.mctx;
    const W = this.minimap.width, H = this.minimap.height;
    g.clearRect(0, 0, W, H);
    if (this.mmBg) g.drawImage(this.mmBg, 0, 0);
    const t = w.time;
    const enemyCss = COLORS.enemyCss;
    // ult orbs
    for (const o of w.orbs) {
      const [x, y] = this.mmPoint(o.pos);
      g.fillStyle = '#ffd84a';
      g.beginPath(); g.arc(x, y, 3 + Math.sin(t * 5) * 0.8, 0, Math.PI * 2); g.fill();
    }
    // smokes
    for (const s of w.abilities.smokes) {
      const [x, y] = this.mmPoint(s.pos);
      g.fillStyle = 'rgba(170,150,220,0.55)';
      g.beginPath(); g.arc(x, y, (s.radius / 2) * this.mmScale, 0, Math.PI * 2); g.fill();
    }
    // spike
    const sp = w.match.spike;
    if (sp.state === 'dropped' || sp.state === 'planted') {
      const [x, y] = this.mmPoint(sp.pos);
      g.fillStyle = sp.state === 'planted' && Math.sin(t * 8) > 0 ? '#fff' : '#ff4655';
      g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillRect(-4, -4, 8, 8); g.restore();
    }
    const intel = w.brain.intel[w.playerSquad];
    for (const c of w.chars) {
      const ally = c.squad === w.playerSquad;
      const pos = c.pos;
      if (!ally) {
        if (!c.alive) continue;
        const seen = intel.get(c.id);
        const visible = (seen && t - seen.time < 0.35) || t < c.revealedUntil || w.playerSees(c);
        if (!visible) continue;
      }
      const [x, y] = this.mmPoint(pos);
      if (!c.alive) {
        g.strokeStyle = ally ? 'rgba(79,224,200,0.7)' : enemyCss;
        g.globalAlpha = ally ? 1 : 0.7;
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(x - 3, y - 3); g.lineTo(x + 3, y + 3); g.moveTo(x + 3, y - 3); g.lineTo(x - 3, y + 3); g.stroke();
        g.globalAlpha = 1;
        continue;
      }
      if (c.isPlayer) {
        // view cone
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.beginPath();
        g.moveTo(x, y);
        const a0 = -c.yaw - Math.PI / 2;
        g.arc(x, y, 28, a0 - 0.6, a0 + 0.6);
        g.closePath();
        g.fill();
      }
      g.fillStyle = c.isPlayer ? '#ffe27a' : ally ? '#4fe0c8' : enemyCss;
      g.beginPath(); g.arc(x, y, c.isPlayer ? 4.5 : 4, 0, Math.PI * 2); g.fill();
      const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
      g.strokeStyle = g.fillStyle;
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + fx * 8, y + fz * 8); g.stroke();
      if (c.hasSpike && ally) { g.fillStyle = '#ff4655'; g.fillRect(x - 2, y - 10, 4, 4); }
    }
  }
}
