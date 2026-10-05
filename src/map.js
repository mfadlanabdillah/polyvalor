import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, WALL_H, PENETRABLE } from './config.js';
import { hash2, rayBox, pick } from './utils.js';

// ---------------------------------------------------------------------------
// Layout: 44 x 40 cells, 2m each. North (row 0) = defender spawn, south = attacker spawn.
// # wall/building   . floor   c crate (1m, jumpable)   C tall crate   P planter with tree
// A / B plant zones   D defender spawn   T attacker spawn
// ---------------------------------------------------------------------------
const W = (n) => '#'.repeat(n);
const D = (n, ch = '.') => ch.repeat(n);

function lane(r) {
  const bm = { 20: '..####', 21: '..####', 23: '..c...', 25: '....C.', 27: '####..', 28: '####..' }[r] ?? D(6);
  const mid = { 19: '.c....', 21: '..CC..', 23: '....c.', 26: '..####', 27: '..####', 29: 'P.....' }[r] ?? D(6);
  const am = { 20: '####..', 21: '####..', 23: '....c.', 25: '.C....', 27: '..####', 28: '..####' }[r] ?? D(6);
  const conn = r === 24 || r === 25 ? D(10) : W(10);
  return W(3) + bm + W(10) + mid + conn + am + W(3);
}

function siteRow(b, mid, a, link = false) {
  return '#' + b + (link ? D(5) : W(5)) + mid + (link ? D(5) : W(5)) + a + '#';
}

const LAYOUT = [
  W(44),
  W(16) + D(12, 'D') + W(16),
  W(16) + D(12, 'D') + W(16),
  W(9) + D(7) + D(12, 'D') + D(7) + W(9),
  W(9) + D(7) + D(12, 'D') + D(7) + W(9),
  W(9) + D(2) + W(6) + D(4) + W(2) + D(4) + W(6) + D(2) + W(9),
  '#' + D(13) + W(3) + D(10) + W(3) + D(13) + '#',
  '#' + D(13) + W(3) + '..c....c..' + W(3) + D(13) + '#',
  siteRow(D(13), D(6), '............P'),
  siteRow('..BBBBBBBB...', '...###', '..AAAAAAAAA..'),
  siteRow('..BcBBBBCB...', '...###', '..AAcAAAAAA..'),
  siteRow('..BcBBBBBB...', D(6), '..AAcAAAACA..'),
  siteRow('..BBBBBBBB.C.', D(6), '..AAAAAAAAA..'),
  siteRow('..BBBBBBBB...', D(6), '..AAAAACcAA..', true),
  siteRow('..BBBCcBBB...', D(6), '..AAAAAAAAA..', true),
  siteRow(D(13), '####..', '.C...........'),
  siteRow('..c........P.', '####..', D(13)),
  siteRow(D(13), D(6), '..........c..'),
  ...Array.from({ length: 14 }, (_, i) => lane(18 + i)),
  W(3) + D(38) + W(3),
  W(3) + D(5) + 'c' + D(26) + 'c' + D(5) + W(3),
  W(16) + D(12, 'T') + W(16),
  W(16) + D(12, 'T') + W(16),
  W(16) + D(12, 'T') + W(16),
  W(16) + D(12, 'T') + W(16),
  W(44),
  W(44),
];

const SOLID_H = { c: 1.0, C: 2.2, P: 1.3 };
const INSET = { c: 0.1, C: 0.1, P: 0.15 };

class MinHeap {
  constructor() { this.a = []; }
  push(node, f) {
    const a = this.a;
    a.push([f, node]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[1];
  }
  get size() { return this.a.length; }
}

export class GameMap {
  constructor(scene) {
    this.scene = scene;
    this.rows = LAYOUT.length;
    this.cols = 44;
    LAYOUT.forEach((r, i) => { if (r.length !== this.cols) console.warn('Layout row', i, 'has length', r.length); });
    this.grid = LAYOUT.map((r) => r.padEnd(this.cols, '#').slice(0, this.cols).split(''));
    this.w = this.cols * CELL;
    this.h = this.rows * CELL;
    this.ox = -this.w / 2;
    this.oz = -this.h / 2;

    const N = this.rows * this.cols;
    this.heights = new Float32Array(N);
    this.insets = new Float32Array(N);
    this.cellsByType = {};
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const ch = this.grid[r][c];
        const i = r * this.cols + c;
        if (ch === '#') this.heights[i] = this.wallHeight(c, r);
        else if (SOLID_H[ch]) { this.heights[i] = SOLID_H[ch]; this.insets[i] = INSET[ch]; }
        (this.cellsByType[ch] ||= []).push([c, r]);
      }
    }
    this.nearWall = new Uint8Array(N);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.walkable(c, r)) continue;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (!this.walkable(c + dc, r + dr)) this.nearWall[r * this.cols + c] = 1;
        }
      }
    }

    // Spawn barriers
    this.barrierActive = false;
    this.barriers = { atk: new Set(), def: new Set() };
    for (const [type, team] of [['T', 'atk'], ['D', 'def']]) {
      for (const [c, r] of this.cellsByType[type]) {
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = c + dc, nr = r + dr;
          const ch = this.ch(nc, nr);
          if (ch !== type && this.walkable(nc, nr)) this.barriers[team].add(nr * this.cols + nc);
        }
      }
    }

    this.poi = {
      sites: {
        A: {
          center: this.toWorld(36, 11), holds: [[33, 8], [40, 9], [32, 16], [41, 13], [38, 15]],
          chokes: [[37, 18], [29, 13]], smokes: [[37, 17], [28, 13]], stage: [37, 22],
          defLook: [[37, 19], [26, 13]],
        },
        B: {
          center: this.toWorld(6, 11), holds: [[3, 8], [12, 8], [2, 15], [12, 15], [8, 16]],
          chokes: [[5, 18], [15, 13]], smokes: [[5, 17], [16, 13]], stage: [5, 22],
          defLook: [[5, 19], [17, 13]],
        },
      },
      mid: { holds: [[21, 7], [25, 6], [19, 9]], chokes: [[21, 17]], stage: [21, 24], defLook: [[21, 20]] },
    };

    if (scene) {
      this.buildMeshes(scene);
      this.buildEnvironment(scene);
    }
  }

  wallHeight(c, r) {
    // Walls touching playable space are 5m; interior blocks become taller "buildings".
    let boundary = false;
    for (let dr = -1; dr <= 1 && !boundary; dr++) for (let dc = -1; dc <= 1; dc++) {
      const ch = this.ch(c + dc, r + dr);
      if (ch !== '#' && !(c + dc < 0 || r + dr < 0 || c + dc >= this.cols || r + dr >= this.rows)) { boundary = true; break; }
    }
    if (boundary) return WALL_H + Math.floor(hash2(c, r) * 3) * 0.25;
    const bx = Math.floor(c / 3), bz = Math.floor(r / 3);
    return 6 + Math.floor(hash2(bx, bz) * 5) * 1.2;
  }

  ch(c, r) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return '#';
    return this.grid[r][c];
  }
  idx(c, r) { return r * this.cols + c; }
  height(c, r) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return 99;
    return this.heights[r * this.cols + c];
  }
  walkable(c, r) { return this.height(c, r) === 0; }

  toWorld(c, r, y = 0) {
    return new THREE.Vector3(this.ox + (c + 0.5) * CELL, y, this.oz + (r + 0.5) * CELL);
  }
  toCell(x, z) {
    return { c: Math.floor((x - this.ox) / CELL), r: Math.floor((z - this.oz) / CELL) };
  }
  chAt(x, z) { const { c, r } = this.toCell(x, z); return this.ch(c, r); }
  plantSiteAt(pos) {
    const ch = this.chAt(pos.x, pos.z);
    return ch === 'A' || ch === 'B' ? ch : null;
  }
  randomCell(type) {
    const [c, r] = pick(this.cellsByType[type]);
    return this.toWorld(c, r);
  }

  // Iterates solid AABBs overlapping the given XZ rect: cb(x0, x1, z0, z1, h)
  forEachBox(minX, maxX, minZ, maxZ, team, cb) {
    const c0 = Math.floor((minX - this.ox) / CELL), c1 = Math.floor((maxX - this.ox) / CELL);
    const r0 = Math.floor((minZ - this.oz) / CELL), r1 = Math.floor((maxZ - this.oz) / CELL);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const x0 = this.ox + c * CELL, z0 = this.oz + r * CELL;
        const h = this.height(c, r);
        if (h > 0) {
          const ins = c >= 0 && r >= 0 && c < this.cols && r < this.rows ? this.insets[r * this.cols + c] : 0;
          cb(x0 + ins, x0 + CELL - ins, z0 + ins, z0 + CELL - ins, h);
        } else if (this.barrierActive && team && this.barriers[team].has(r * this.cols + c)) {
          cb(x0, x0 + CELL, z0, z0 + CELL, 50);
        }
      }
    }
  }

  // Ray vs world (floor + cell boxes). d must be normalized.
  raycast(o, d, maxDist = 300) {
    let best = maxDist;
    let nx = 0, ny = 0, nz = 0, hit = false, hc = -1, hr = -1;
    if (d.y < -1e-6) {
      const t = -o.y / d.y;
      if (t >= 0 && t < best) { best = t; nx = 0; ny = 1; nz = 0; hit = true; }
    }
    const gx = (o.x - this.ox) / CELL, gz = (o.z - this.oz) / CELL;
    let c = Math.floor(gx), r = Math.floor(gz);
    const stepC = d.x > 0 ? 1 : -1, stepR = d.z > 0 ? 1 : -1;
    const tDeltaC = Math.abs(d.x) > 1e-9 ? CELL / Math.abs(d.x) : Infinity;
    const tDeltaR = Math.abs(d.z) > 1e-9 ? CELL / Math.abs(d.z) : Infinity;
    let tMaxC = Math.abs(d.x) > 1e-9 ? (d.x > 0 ? c + 1 - gx : gx - c) * tDeltaC : Infinity;
    let tMaxR = Math.abs(d.z) > 1e-9 ? (d.z > 0 ? r + 1 - gz : gz - r) * tDeltaR : Infinity;
    let tEnter = 0;
    let guard = 0;
    while (tEnter <= best && guard++ < 400) {
      if (c < -1 || r < -1 || c > this.cols || r > this.rows) break;
      const h = this.height(c, r);
      if (h > 0) {
        const ins = c >= 0 && r >= 0 && c < this.cols && r < this.rows ? this.insets[r * this.cols + c] : 0;
        const x0 = this.ox + c * CELL + ins, z0 = this.oz + r * CELL + ins;
        const bh = rayBox(o, d, x0, 0, z0, x0 + CELL - 2 * ins, h, z0 + CELL - 2 * ins);
        if (bh && bh.t < best) {
          best = bh.t; nx = bh.nx; ny = bh.ny; nz = bh.nz; hit = true; hc = c; hr = r;
          if (ins === 0) break;
        }
      }
      if (tMaxC < tMaxR) { tEnter = tMaxC; tMaxC += tDeltaC; c += stepC; }
      else { tEnter = tMaxR; tMaxR += tDeltaR; r += stepR; }
    }
    if (!hit) return null;
    return {
      t: best,
      point: new THREE.Vector3(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best),
      normal: new THREE.Vector3(nx, ny, nz),
      c: hc,
      r: hr,
      ch: hc >= 0 ? this.ch(hc, hr) : null,
    };
  }

  // Callout name for a world position. A is the east side of the map, B the west side.
  zoneName(pos) {
    const { c, r } = this.toCell(pos.x, pos.z);
    if (r >= 34) return 'Attacker Spawn';
    if (r >= 32) return 'Attacker Yard';
    if (r <= 4) return 'Defender Spawn';
    if (r >= 18) {
      if (c <= 13) return 'B Main';
      if (c >= 35) return 'A Main';
      if (c >= 25 && (r === 24 || r === 25)) return 'Connector';
      return 'Mid';
    }
    // rows 5..17: the two sites, links and the top of mid
    const west = c <= 13, east = c >= 30;
    if (west || east) {
      const s = west ? 'B' : 'A';
      if (r >= 15) return `${s} Entrance`;
      if (r <= 8) return `${s} Back`;
      return `${s} Site`;
    }
    if (c < 19) return r >= 13 && r <= 14 ? 'B Link' : 'B Back';
    if (c > 24) return r >= 13 && r <= 14 ? 'A Link' : 'A Back';
    return r >= 15 ? 'Mid' : 'Top Mid';
  }

  // Can a bullet with penetration `pen` travel from a to b through only penetrable cover?
  // Returns { mult, thick } (damage multiplier / metres of cover) or null when blocked.
  penetrationBetween(a, b, pen) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-3) return { mult: 1, thick: 0 };
    d.divideScalar(len);
    let from = 0, mult = 1, thick = 0;
    for (let pass = 0; pass < 3; pass++) {
      const o = new THREE.Vector3().copy(a).addScaledVector(d, from);
      const h = this.raycast(o, d, len - from);
      if (!h) return { mult, thick };
      if (!PENETRABLE.has(h.ch)) return null;
      const exit = this.exitDistance(o, d, h.c, h.r);
      const th = exit - h.t;
      if (th > pen.maxThick) return null;
      thick += th;
      mult *= pen.mult;
      from += exit + 0.02;
      if (from >= len) return { mult, thick };
    }
    return null;
  }

  // Distance along the ray at which it leaves the solid box of cell (c, r).
  exitDistance(o, d, c, r) {
    const ins = this.insets[r * this.cols + c] || 0;
    const x0 = this.ox + c * CELL + ins, z0 = this.oz + r * CELL + ins;
    const x1 = x0 + CELL - 2 * ins, z1 = z0 + CELL - 2 * ins, y1 = this.height(c, r);
    let tmax = Infinity;
    for (const [p, v, lo, hi] of [[o.x, d.x, x0, x1], [o.y, d.y, 0, y1], [o.z, d.z, z0, z1]]) {
      if (Math.abs(v) < 1e-12) continue;
      const t = Math.max((lo - p) / v, (hi - p) / v);
      if (t < tmax) tmax = t;
    }
    return tmax;
  }

  lineOfSight(a, b) {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 1e-4) return true;
    d.divideScalar(len);
    const h = this.raycast(a, d, len);
    return !h || h.t >= len - 0.05;
  }

  // ---------------- Navigation ----------------
  nearestWalkable(c, r) {
    if (this.walkable(c, r)) return { c, r };
    for (let rad = 1; rad < 8; rad++) {
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        if (this.walkable(c + dc, r + dr)) return { c: c + dc, r: r + dr };
      }
    }
    return { c, r };
  }

  walkLine(a, b, rad = 0.42) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / 0.35));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + dx * t, z = a.z + dz * t;
      for (const [ox, oz] of [[0, 0], [rad, rad], [rad, -rad], [-rad, rad], [-rad, -rad]]) {
        const { c, r } = this.toCell(x + ox, z + oz);
        if (!this.walkable(c, r)) return false;
      }
    }
    return true;
  }

  findPath(from, to) {
    const s0 = this.toCell(from.x, from.z), g0 = this.toCell(to.x, to.z);
    const s = this.nearestWalkable(s0.c, s0.r), g = this.nearestWalkable(g0.c, g0.r);
    const cols = this.cols, N = this.rows * cols;
    const start = s.r * cols + s.c, goal = g.r * cols + g.c;
    const gScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    const hfn = (i) => {
      const dx = Math.abs((i % cols) - g.c), dz = Math.abs(Math.floor(i / cols) - g.r);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    gScore[start] = 0;
    heap.push(start, hfn(start));
    let found = false;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cc = cur % cols, cr = Math.floor(cur / cols);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = cc + dc, nr = cr + dr;
        if (!this.walkable(nc, nr)) continue;
        if (dr && dc && (!this.walkable(cc + dc, cr) || !this.walkable(cc, cr + dr))) continue;
        const ni = nr * cols + nc;
        if (closed[ni]) continue;
        const cost = (dr && dc ? 1.414 : 1) + (this.nearWall[ni] ? 0.35 : 0);
        const ng = gScore[cur] + cost;
        if (ng < gScore[ni]) {
          gScore[ni] = ng;
          came[ni] = cur;
          heap.push(ni, ng + hfn(ni));
        }
      }
    }
    if (!found) return [to.clone()];
    const cells = [];
    for (let i = goal; i !== -1; i = came[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => this.toWorld(i % cols, Math.floor(i / cols)));
    if (g.c === g0.c && g.r === g0.r) pts[pts.length - 1] = new THREE.Vector3(to.x, 0, to.z);
    // String pulling
    const out = [];
    let cur = new THREE.Vector3(from.x, 0, from.z);
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.walkLine(cur, pts[j])) j--;
      out.push(pts[j]);
      cur = pts[j];
      i = j + 1;
    }
    return out;
  }

  randomWalkableNear(pos, radius, tries = 30) {
    for (let k = 0; k < tries; k++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * radius;
      const x = pos.x + Math.cos(a) * d, z = pos.z + Math.sin(a) * d;
      const { c, r } = this.toCell(x, z);
      if (this.walkable(c, r) && !this.nearWall[r * this.cols + c]) return this.toWorld(c, r);
    }
    const { c, r } = this.toCell(pos.x, pos.z);
    const n = this.nearestWalkable(c, r);
    return this.toWorld(n.c, n.r);
  }

  // ---------------- Visuals ----------------
  buildMeshes(scene) {
    const geos = [];
    const decor = [];
    const col = new THREE.Color();
    const colorize = (g, faceColor) => {
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        faceColor(Math.floor(v / 6), col);
        arr[v * 3] = col.r; arr[v * 3 + 1] = col.g; arr[v * 3 + 2] = col.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return g;
    };
    const addBox = (list, x0, y0, z0, x1, y1, z1, side, top, bottomTint = 1) => {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      list.push(colorize(g, (f, c) => { c.set(f === 2 ? top : side); if (f === 3) c.multiplyScalar(bottomTint); }));
    };

    const wallPal = ['#ead8b8', '#e4cfab', '#dfc79f', '#e9d3ae'];
    const bldPal = ['#f0dcc0', '#e8c6a4', '#dcb391', '#cfd6c2', '#e6d1b8', '#d8c0a8'];
    const roofPal = ['#c8674a', '#b95a42', '#d27a55', '#8f9a8a', '#a86a50'];
    const roofed = new Set();

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const ch = this.grid[r][c];
        const h = this.height(c, r);
        const x0 = this.ox + c * CELL, z0 = this.oz + r * CELL;
        if (ch === '#') {
          const bx = Math.floor(c / 3), bz = Math.floor(r / 3);
          const boundary = h < 6;
          const side = boundary ? wallPal[Math.floor(hash2(c * 7, r) * wallPal.length)] : bldPal[Math.floor(hash2(bx, bz * 3) * bldPal.length)];
          const top = boundary ? '#cdb28a' : roofPal[Math.floor(hash2(bx * 5, bz) * roofPal.length)];
          addBox(geos, x0, 0, z0, x0 + CELL, h, z0 + CELL, side, top);
          if (boundary) {
            // trim cap
            addBox(geos, x0 - 0.06, h, z0 - 0.06, x0 + CELL + 0.06, h + 0.25, z0 + CELL + 0.06, '#c9a77c', '#d6b88d');
          } else if (!roofed.has(bx + ',' + bz) && hash2(bx * 11, bz * 13) < 0.45) {
            // pitched roof over a full interior 3x3 block
            let full = true;
            for (let dr = 0; dr < 3 && full; dr++) for (let dc = 0; dc < 3; dc++) {
              const cc = bx * 3 + dc, rr = bz * 3 + dr;
              if (this.ch(cc, rr) !== '#' || this.height(cc, rr) < 6 || cc >= this.cols || rr >= this.rows) { full = false; break; }
            }
            roofed.add(bx + ',' + bz);
            if (full) {
              const bh = this.height(bx * 3, bz * 3);
              const cone = new THREE.ConeGeometry(CELL * 3 * 0.72, 2.6, 4, 1).toNonIndexed();
              cone.rotateY(Math.PI / 4);
              cone.translate(this.ox + (bx * 3 + 1.5) * CELL, bh + 1.3, this.oz + (bz * 3 + 1.5) * CELL);
              const rc = roofPal[Math.floor(hash2(bx, bz * 7) * 3)];
              geos.push(colorize(cone, (f, c) => c.set(rc).multiplyScalar(0.9 + (f % 4) * 0.05)));
            }
          }
        } else if (ch === 'c' || ch === 'C') {
          const ins = INSET[ch];
          addBox(geos, x0 + ins, 0, z0 + ins, x0 + CELL - ins, 1.0, z0 + CELL - ins, '#b8834f', '#caa06a');
          addBox(geos, x0 + ins - 0.03, 0.42, z0 + ins - 0.03, x0 + CELL - ins + 0.03, 0.58, z0 + CELL - ins + 0.03, '#8e6038', '#9c6a40');
          if (ch === 'C') {
            addBox(geos, x0 + ins + 0.15, 1.0, z0 + ins + 0.15, x0 + CELL - ins - 0.15, 2.2, z0 + CELL - ins - 0.15, '#a8774a', '#bf935f');
          }
        } else if (ch === 'P') {
          const ins = INSET.P;
          addBox(geos, x0 + ins, 0, z0 + ins, x0 + CELL - ins, 1.3, z0 + CELL - ins, '#b9b3a6', '#6f5a45');
          const trunk = new THREE.CylinderGeometry(0.12, 0.18, 2.2, 5).toNonIndexed();
          trunk.translate(x0 + CELL / 2, 2.4, z0 + CELL / 2);
          decor.push(colorize(trunk, (f, c) => c.set('#7a5638')));
          const leaves = new THREE.IcosahedronGeometry(1.3, 0);
          leaves.translate(x0 + CELL / 2, 3.9, z0 + CELL / 2);
          decor.push(colorize(leaves, (f, c) => c.set(f % 2 ? '#6fae5a' : '#5f9e4f')));
        }
      }
    }

    // Trees growing out of some building blocks for skyline flavour
    for (let r = 1; r < this.rows - 1; r += 3) {
      for (let c = 1; c < this.cols - 1; c += 3) {
        if (this.ch(c, r) !== '#' || this.height(c, r) < 6 || hash2(c * 3, r * 5) > 0.22) continue;
        const bx = Math.floor(c / 3), bz = Math.floor(r / 3);
        if (roofed.has(bx + ',' + bz) && hash2(bx * 11, bz * 13) < 0.45) continue;
        const p = this.toWorld(c, r, this.height(c, r));
        const trunk = new THREE.CylinderGeometry(0.15, 0.22, 1.6, 5).toNonIndexed();
        trunk.translate(p.x, p.y + 0.8, p.z);
        decor.push(colorize(trunk, (f, cc) => cc.set('#7a5638')));
        const leaves = new THREE.IcosahedronGeometry(1.5 + hash2(c, r) * 0.8, 0);
        leaves.translate(p.x, p.y + 2.6, p.z);
        decor.push(colorize(leaves, (f, cc) => cc.set(f % 3 ? '#79b565' : '#5f9e4f')));
      }
    }

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 });
    const walls = new THREE.Mesh(mergeGeometries(geos), mat);
    walls.castShadow = true;
    walls.receiveShadow = true;
    scene.add(walls);
    const dmesh = new THREE.Mesh(mergeGeometries(decor), mat);
    dmesh.castShadow = true;
    scene.add(dmesh);

    // Floor tiles
    const floorGeos = [];
    const floorColors = { '.': '#d9cfbd', A: '#dcc48f', B: '#dcc48f', T: '#d4c2c8', D: '#c3d3d6', c: '#d9cfbd', C: '#d9cfbd', P: '#d9cfbd' };
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const ch = this.grid[r][c];
        if (ch === '#') continue;
        const g = new THREE.PlaneGeometry(CELL, CELL).toNonIndexed();
        g.rotateX(-Math.PI / 2);
        const p = this.toWorld(c, r);
        g.translate(p.x, 0, p.z);
        const base = new THREE.Color(floorColors[ch] || '#d9cfbd');
        const k = 0.94 + hash2(c * 13, r * 17) * 0.08 + ((c + r) % 2 ? 0.015 : 0);
        floorGeos.push(colorize(g, (f, cc) => cc.copy(base).multiplyScalar(k)));
      }
    }
    const floor = new THREE.Mesh(mergeGeometries(floorGeos), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    floor.receiveShadow = true;
    scene.add(floor);

    // Big site letters painted on the floor
    for (const [site, cellRC] of [['A', [36, 11]], ['B', [6, 11]]]) {
      const cvs = document.createElement('canvas');
      cvs.width = cvs.height = 256;
      const ctx = cvs.getContext('2d');
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = 'rgba(190,70,55,0.85)';
      ctx.lineWidth = 14;
      ctx.strokeRect(20, 20, 216, 216);
      ctx.fillStyle = 'rgba(190,70,55,0.85)';
      ctx.font = 'bold 190px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(site, 128, 140);
      const tex = new THREE.CanvasTexture(cvs);
      tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      const p = this.toWorld(cellRC[0], cellRC[1]);
      m.position.set(p.x - 1, 0.02, p.z + 1);
      scene.add(m);
    }

    // Spawn barriers
    this.barrierGroup = new THREE.Group();
    const bmat = new THREE.MeshBasicMaterial({ color: 0x6ff0c8, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    for (const team of ['atk', 'def']) {
      for (const i of this.barriers[team]) {
        const c = i % this.cols, r = Math.floor(i / this.cols);
        const p = this.toWorld(c, r);
        const m = new THREE.Mesh(new THREE.BoxGeometry(CELL, 4, CELL), bmat);
        m.position.set(p.x, 2, p.z);
        this.barrierGroup.add(m);
      }
    }
    scene.add(this.barrierGroup);
  }

  setBarrier(on) {
    this.barrierActive = on;
    if (this.barrierGroup) this.barrierGroup.visible = on;
  }

  buildEnvironment(scene) {
    // Sky dome with vertex-color gradient
    const skyGeo = new THREE.SphereGeometry(500, 24, 12);
    const cols = [];
    const top = new THREE.Color('#5aa2e0'), hor = new THREE.Color('#f6dcb8'), c = new THREE.Color();
    const pos = skyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 500);
      c.copy(hor).lerp(top, Math.pow(t, 0.55));
      cols.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    scene.add(sky);

    scene.fog = new THREE.Fog('#f0d8b8', 90, 330);

    const hemi = new THREE.HemisphereLight('#cfe4ff', '#d8c29a', 1.35);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
    sun.position.set(45, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 60;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 220 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    this.sun = sun;

    // Low-poly mountains ring
    const mg = [];
    const mcol = ['#8fae7a', '#7f9e70', '#a3b58a', '#9a8fb0', '#b7a48a'];
    for (let i = 0; i < 38; i++) {
      const a = (i / 38) * Math.PI * 2 + hash2(i, 3) * 0.1;
      const dist = 150 + hash2(i, 7) * 80;
      const hgt = 30 + hash2(i, 11) * 55;
      const g = new THREE.ConeGeometry(25 + hash2(i, 5) * 30, hgt, 5 + (i % 3), 1).toNonIndexed();
      g.translate(Math.cos(a) * dist, hgt / 2 - 4, Math.sin(a) * dist);
      const base = new THREE.Color(mcol[i % mcol.length]);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        const y = g.attributes.position.getY(v);
        const k = y > hgt * 0.75 ? 1.25 : 0.9 + ((v / 3) % 3) * 0.05;
        const cc = y > hgt * 0.8 ? new THREE.Color('#f4f1ea') : base.clone().multiplyScalar(k);
        arr[v * 3] = cc.r; arr[v * 3 + 1] = cc.g; arr[v * 3 + 2] = cc.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      mg.push(g);
    }
    const mountains = new THREE.Mesh(mergeGeometries(mg), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    scene.add(mountains);

    // Clouds
    const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1, emissive: '#dde6f0', emissiveIntensity: 0.35 });
    this.clouds = new THREE.Group();
    for (let i = 0; i < 14; i++) {
      const cl = new THREE.Group();
      const n = 3 + Math.floor(hash2(i, 1) * 3);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(5 + hash2(i, k) * 5, 0), cloudMat);
        m.position.set(k * 6 - n * 3, hash2(k, i) * 3, hash2(i * 3, k) * 5);
        m.scale.y = 0.6;
        cl.add(m);
      }
      const a = hash2(i, 9) * Math.PI * 2, d = 60 + hash2(i, 4) * 140;
      cl.position.set(Math.cos(a) * d, 55 + hash2(i, 2) * 30, Math.sin(a) * d);
      this.clouds.add(cl);
    }
    scene.add(this.clouds);
  }

  update(dt) {
    if (this.clouds) this.clouds.rotation.y += dt * 0.004;
  }
}
