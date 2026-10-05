import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Deterministic hash -> [0,1)
export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// yaw = 0 looks toward -Z. Positive yaw turns left (counter-clockwise from above), like three.js camera rotation.y.
export function dirFromAngles(yaw, pitch, out = new THREE.Vector3()) {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

export function anglesFromDir(d) {
  const yaw = Math.atan2(-d.x, -d.z);
  const pitch = Math.asin(clamp(d.y / (d.length() || 1), -1, 1));
  return { yaw, pitch };
}

// Returns a direction randomly deviated within a cone of `deg` degrees (uniform over disc).
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
export function spreadDir(dir, deg, out = new THREE.Vector3()) {
  if (deg <= 0) return out.copy(dir);
  const r = Math.tan(deg * DEG) * Math.sqrt(Math.random());
  const a = Math.random() * Math.PI * 2;
  _t1.set(0, 1, 0);
  if (Math.abs(dir.y) > 0.95) _t1.set(1, 0, 0);
  _t2.crossVectors(dir, _t1).normalize();
  _t1.crossVectors(_t2, dir).normalize();
  return out.copy(dir).addScaledVector(_t1, Math.cos(a) * r).addScaledVector(_t2, Math.sin(a) * r).normalize();
}

export function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  return t;
}

// Vertical finite cylinder (axis Y) centered at cx,cz from y0 to y1.
export function rayCylinder(o, d, cx, cz, r, y0, y1) {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  let best = -1;
  if (a > 1e-9) {
    const b = ox * d.x + oz * d.z;
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      for (const t of [(-b - s) / a, (-b + s) / a]) {
        if (t < 0) continue;
        const y = o.y + d.y * t;
        if (y >= y0 && y <= y1) { best = t; break; }
      }
    }
  }
  // caps
  if (Math.abs(d.y) > 1e-9) {
    for (const cy of [y0, y1]) {
      const t = (cy - o.y) / d.y;
      if (t < 0) continue;
      const x = ox + d.x * t, z = oz + d.z * t;
      if (x * x + z * z <= r * r && (best < 0 || t < best)) best = t;
    }
  }
  return best;
}

// Slab test for AABB. Returns {t, nx, ny, nz} or null.
export function rayBox(o, d, x0, y0, z0, x1, y1, z1) {
  let tmin = -Infinity, tmax = Infinity, nx = 0, ny = 0, nz = 0;
  const axes = [[o.x, d.x, x0, x1, 0], [o.y, d.y, y0, y1, 1], [o.z, d.z, z0, z1, 2]];
  for (const [p, v, lo, hi, ax] of axes) {
    if (Math.abs(v) < 1e-12) {
      if (p < lo || p > hi) return null;
      continue;
    }
    let t1 = (lo - p) / v, t2 = (hi - p) / v, sign = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
    if (t1 > tmin) {
      tmin = t1;
      nx = ny = nz = 0;
      if (ax === 0) nx = sign; else if (ax === 1) ny = sign; else nz = sign;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  if (tmin < 0) return { t: 0, nx: -d.x, ny: -d.y, nz: -d.z };
  return { t: tmin, nx, ny, nz };
}

export function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}
