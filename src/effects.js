import * as THREE from 'three';
import { flatMat } from './models.js';
import { makeFlashTexture } from './viewmodel.js';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.particles = [];
    this.decals = [];
    this.flashes = [];
    this.blasts = [];
    this.debris = [];

    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.8 });
    this.particleGeo = new THREE.TetrahedronGeometry(0.05, 0);
    this.particleMats = {};
    this.decalGeo = new THREE.PlaneGeometry(0.09, 0.09);
    this.decalMat = new THREE.MeshBasicMaterial({ color: 0x2a2520, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.flashTex = makeFlashTexture();
    this.flashMat = new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.shellGeo = new THREE.BoxGeometry(0.014, 0.014, 0.04);
    this.shellMat = new THREE.MeshStandardMaterial({ color: '#d9a441', metalness: 0.7, roughness: 0.35, flatShading: true });
    this.magGeo = new THREE.BoxGeometry(0.03, 0.11, 0.045);
    this.magMat = flatMat('#474c59');

    // One pooled light that pops on every muzzle flash (always in the scene to avoid shader recompiles).
    this.light = new THREE.PointLight('#ffcf8a', 0, 16, 2);
    this.lightPulse = 0;
    scene.add(this.light);
  }

  pmat(color) {
    if (!this.particleMats[color]) this.particleMats[color] = new THREE.MeshBasicMaterial({ color });
    return this.particleMats[color];
  }

  tracer(from, to) {
    const g = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const line = new THREE.Line(g, this.tracerMat.clone());
    this.scene.add(line);
    this.tracers.push({ obj: line, life: 0.07, max: 0.07 });
  }

  burst(pos, color, count = 6, speed = 3, life = 0.45, gravity = 9) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length > 260) break;
      const m = new THREE.Mesh(this.particleGeo, this.pmat(color));
      m.position.copy(pos);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      this.scene.add(m);
      this.particles.push({ obj: m, vel: v, life: life * (0.6 + Math.random() * 0.6), gravity });
    }
  }

  impact(point, normal) {
    const d = new THREE.Mesh(this.decalGeo, this.decalMat);
    d.position.copy(point).addScaledVector(normal, 0.01);
    d.lookAt(point.clone().add(normal));
    this.scene.add(d);
    this.decals.push(d);
    if (this.decals.length > 90) {
      const old = this.decals.shift();
      this.scene.remove(old);
    }
    this.burst(point.clone().addScaledVector(normal, 0.05), 0xd8c8a8, 4, 2.2, 0.35);
  }

  blood(point) { this.burst(point, 0xc8283a, 7, 2.5, 0.4); }

  muzzle(pos, strength = 1) {
    const s = new THREE.Sprite(this.flashMat);
    const size = (0.28 + Math.random() * 0.22) * strength;
    s.scale.set(size, size, 1);
    s.position.copy(pos);
    this.scene.add(s);
    this.flashes.push({ obj: s, life: 0.05 });
    this.light.position.copy(pos);
    this.lightPulse = 1;
  }

  // Light pop without a sprite (used for the first-person muzzle, whose flash lives in the viewmodel scene).
  pulseLight(pos) {
    this.light.position.copy(pos);
    this.lightPulse = 0.8;
  }

  // Ejected brass. `dir` is a unit vector for the eject direction (roughly out of the right side).
  shell(pos, dir, inherit) {
    const m = new THREE.Mesh(this.shellGeo, this.shellMat);
    m.position.copy(pos);
    const vel = dir.clone().multiplyScalar(1.6 + Math.random() * 1.2);
    vel.y += 1.2 + Math.random() * 1.0;
    if (inherit) vel.addScaledVector(inherit, 0.4);
    this.addDebris(m, vel, 1.6);
  }

  // A dropped magazine (viewmodel reload).
  dropMag(pos, camera) {
    const m = new THREE.Mesh(this.magGeo, this.magMat);
    m.position.copy(pos);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const vel = right.multiplyScalar(-0.5 - Math.random() * 0.4);
    vel.y += 0.3;
    this.addDebris(m, vel, 3.5);
  }

  addDebris(mesh, vel, bounce) {
    if (this.debris.length >= 60) {
      const old = this.debris.shift();
      this.scene.remove(old.obj);
    }
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.scene.add(mesh);
    this.debris.push({
      obj: mesh, vel, life: 2.4 + Math.random() * 0.8, bounce,
      spin: new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18),
    });
  }

  blast(pos, radius, color = 0xffa040, life = 0.6) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
    m.position.copy(pos);
    this.scene.add(m);
    this.blasts.push({ obj: m, life, max: life, radius });
  }

  update(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.obj.material.opacity = Math.max(0, t.life / t.max) * 0.8;
      if (t.life <= 0) {
        this.scene.remove(t.obj);
        t.obj.geometry.dispose();
        t.obj.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      p.obj.position.addScaledVector(p.vel, dt);
      p.obj.rotation.x += dt * 8;
      if (p.obj.position.y < 0.02) { p.obj.position.y = 0.02; p.vel.multiplyScalar(0.5); p.vel.y = 0; }
      if (p.life <= 0) {
        this.scene.remove(p.obj);
        this.particles.splice(i, 1);
      }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.vel.y -= 9.8 * dt;
      d.obj.position.addScaledVector(d.vel, dt);
      const grounded = d.obj.position.y <= 0.02;
      if (grounded) {
        d.obj.position.y = 0.02;
        if (Math.abs(d.vel.y) > 0.6) d.vel.y *= -0.35; else d.vel.y = 0;
        d.vel.x *= 0.6; d.vel.z *= 0.6;
        d.spin.multiplyScalar(0.5);
      } else {
        d.obj.rotation.x += d.spin.x * dt;
        d.obj.rotation.y += d.spin.y * dt;
        d.obj.rotation.z += d.spin.z * dt;
      }
      if (d.life < 0.4) d.obj.scale.setScalar(Math.max(0.01, d.life / 0.4));
      if (d.life <= 0) {
        this.scene.remove(d.obj);
        this.debris.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) { this.scene.remove(f.obj); this.flashes.splice(i, 1); }
    }
    this.lightPulse = Math.max(0, this.lightPulse - dt * 22);
    this.light.intensity = this.lightPulse * 7;
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.life -= dt;
      const k = 1 - b.life / b.max;
      b.obj.scale.setScalar(0.3 + b.radius * Math.sqrt(k));
      b.obj.material.opacity = 0.8 * (1 - k);
      if (b.life <= 0) {
        this.scene.remove(b.obj);
        b.obj.geometry.dispose();
        b.obj.material.dispose();
        this.blasts.splice(i, 1);
      }
    }
  }

  clear() {
    for (const d of this.decals) this.scene.remove(d);
    this.decals = [];
    for (const d of this.debris) this.scene.remove(d.obj);
    this.debris = [];
  }
}
