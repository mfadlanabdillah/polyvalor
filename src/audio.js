// Fully synthesized audio (no external assets): per-weapon gun voices, a shared reverb bus and simple panning.

// crack: high-frequency snap; body: mid-band noise; thump: low sine drop; tail: reverb send length/level.
const GUN_SFX = {
  classic: { crack: 3200, body: 1500, bodyDur: 0.09, thump: 190, tdur: 0.1, gain: 0.75, tail: 0.12, wet: 0.18 },
  ghost: { crack: 1800, body: 900, bodyDur: 0.07, thump: 150, tdur: 0.08, gain: 0.45, tail: 0.05, wet: 0.08, soft: true },
  sheriff: { crack: 2400, body: 700, bodyDur: 0.16, thump: 95, tdur: 0.22, gain: 1.0, tail: 0.3, wet: 0.3 },
  spectre: { crack: 2600, body: 1900, bodyDur: 0.07, thump: 170, tdur: 0.07, gain: 0.6, tail: 0.1, wet: 0.14 },
  bulldog: { crack: 2000, body: 1100, bodyDur: 0.1, thump: 110, tdur: 0.12, gain: 0.8, tail: 0.2, wet: 0.22 },
  guardian: { crack: 1800, body: 800, bodyDur: 0.14, thump: 90, tdur: 0.18, gain: 0.95, tail: 0.26, wet: 0.26 },
  phantom: { crack: 1500, body: 700, bodyDur: 0.08, thump: 130, tdur: 0.09, gain: 0.5, tail: 0.05, wet: 0.08, soft: true },
  vandal: { crack: 2200, body: 900, bodyDur: 0.13, thump: 100, tdur: 0.14, gain: 1.0, tail: 0.3, wet: 0.28 },
  marshal: { crack: 1900, body: 650, bodyDur: 0.22, thump: 75, tdur: 0.28, gain: 1.0, tail: 0.5, wet: 0.4 },
  operator: { crack: 1500, body: 450, bodyDur: 0.35, thump: 55, tdur: 0.5, gain: 1.4, tail: 0.9, wet: 0.55 },
};

export class GameAudio {
  constructor(world) {
    this.world = world;
    this.ctx = null;
    this.volume = 0.6;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Reverb bus: generated impulse response (decaying stereo noise).
    const rate = this.ctx.sampleRate;
    const irLen = Math.floor(rate * 1.7);
    const ir = this.ctx.createBuffer(2, irLen, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.8);
    }
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = ir;
    const wetOut = this.ctx.createGain();
    wetOut.gain.value = 0.55;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    this.reverbIn = this.ctx.createGain();
    this.reverbIn.connect(lp);
    lp.connect(this.reverb);
    this.reverb.connect(wetOut);
    wetOut.connect(this.master);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  spatial(pos) {
    const cam = this.world.camera;
    if (!pos || !cam) return { g: 1, pan: 0 };
    const dx = pos.x - cam.position.x, dy = pos.y - cam.position.y, dz = pos.z - cam.position.z;
    const dist = Math.hypot(dx, dy, dz);
    const g = 1 / (1 + Math.pow(dist / 9, 1.4));
    const yaw = this.world.viewYaw ?? 0;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const pan = dist > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / dist)) * 0.85 : 0;
    return { g, pan };
  }

  out(pan, wet = 0) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.master);
    if (wet > 0) {
      const s = this.ctx.createGain();
      s.gain.value = wet;
      p.connect(s);
      s.connect(this.reverbIn);
    }
    return p;
  }

  noiseBurst({ dur = 0.15, type = 'bandpass', freq = 1000, q = 1, gain = 0.5, pan = 0, attack = 0.002, sweepTo = null, wet = 0 }) {
    if (!this.ctx || gain < 0.01) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.out(pan, wet));
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone({ freq = 440, dur = 0.2, type = 'sine', gain = 0.3, pan = 0, slideTo = null, delay = 0, attack = 0.005, wet = 0 }) {
    if (!this.ctx || gain < 0.01) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.out(pan, wet));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  isLocal(char) { return char && char === this.world.viewTarget; }

  shot(char, def) {
    if (!this.ctx) return;
    const local = this.isLocal(char);
    const { g, pan } = local ? { g: 1, pan: 0 } : this.spatial(char.pos);
    if (def.type === 'knives') {
      this.noiseBurst({ dur: 0.12, type: 'highpass', freq: 2500, gain: 0.25 * g, pan, sweepTo: 6000 });
      return;
    }
    const p = GUN_SFX[def.id] || GUN_SFX.classic;
    const vol = (local ? 0.6 : 0.85) * g * p.gain;
    if (p.soft) {
      // suppressed: muffled "thup" plus a mechanical clack
      this.noiseBurst({ dur: p.bodyDur, type: 'lowpass', freq: p.body, q: 0.7, gain: vol * 0.9, pan, wet: p.wet });
      this.tone({ freq: 2600, dur: 0.03, type: 'square', gain: 0.05 * g, pan });
    } else {
      this.noiseBurst({ dur: 0.035, type: 'highpass', freq: p.crack, gain: vol * 0.9, pan, attack: 0.001 });
      this.noiseBurst({ dur: p.bodyDur, type: 'bandpass', freq: p.body, q: 0.7, gain: vol * 0.8, pan, sweepTo: p.body * 0.5, wet: p.wet });
    }
    this.tone({ freq: p.thump, dur: p.tdur, type: 'sine', gain: vol * 0.6, pan, slideTo: p.thump * 0.45 });
    this.noiseBurst({ dur: 0.1 + p.tail, type: 'lowpass', freq: 520, gain: vol * 0.22, pan, sweepTo: 120, wet: Math.min(1, p.wet * 1.6) });
  }

  melee(char) {
    const { g, pan } = this.isLocal(char) ? { g: 1, pan: 0 } : this.spatial(char.pos);
    this.noiseBurst({ dur: 0.16, type: 'bandpass', freq: 1200, q: 2, gain: 0.3 * g, pan, sweepTo: 3500 });
  }

  footstep(char) {
    if (!this.ctx) return;
    const local = this.isLocal(char);
    const { g, pan } = local ? { g: 0.35, pan: 0 } : this.spatial(char.pos);
    this.noiseBurst({ dur: 0.07, type: 'lowpass', freq: 380 + Math.random() * 120, gain: 0.7 * g, pan });
    this.noiseBurst({ dur: 0.04, type: 'bandpass', freq: 2400, q: 1.5, gain: 0.12 * g, pan });
  }

  jump(char) {
    const { g, pan } = this.isLocal(char) ? { g: 0.4, pan: 0 } : this.spatial(char.pos);
    this.noiseBurst({ dur: 0.08, type: 'lowpass', freq: 300, gain: 0.5 * g, pan });
  }

  land(char, force = 1) {
    const { g, pan } = this.isLocal(char) ? { g: 0.6, pan: 0 } : this.spatial(char.pos);
    this.noiseBurst({ dur: 0.11, type: 'lowpass', freq: 260, gain: 0.7 * g * Math.min(1.4, force), pan });
    this.noiseBurst({ dur: 0.05, type: 'bandpass', freq: 1500, q: 1.2, gain: 0.12 * g, pan });
  }

  hit(head) {
    if (head) {
      this.tone({ freq: 1650, dur: 0.25, type: 'sine', gain: 0.22 });
      this.tone({ freq: 2480, dur: 0.18, type: 'sine', gain: 0.1 });
    } else this.tone({ freq: 700, dur: 0.06, type: 'square', gain: 0.06 });
  }

  hurt() { this.noiseBurst({ dur: 0.12, type: 'lowpass', freq: 500, gain: 0.35 }); }

  killConfirm(n = 1) {
    const base = 520 + Math.min(n, 5) * 90;
    this.tone({ freq: base, dur: 0.14, type: 'triangle', gain: 0.18 });
    this.tone({ freq: base * 1.5, dur: 0.22, type: 'triangle', gain: 0.16, delay: 0.07 });
  }

  equip(char) {
    if (!this.isLocal(char)) return;
    this.noiseBurst({ dur: 0.06, type: 'highpass', freq: 3000, gain: 0.12 });
    this.noiseBurst({ dur: 0.05, type: 'bandpass', freq: 1500, q: 3, gain: 0.12 });
    this.tone({ freq: 240, dur: 0.06, type: 'triangle', gain: 0.08 });
  }

  // Called from the viewmodel as the reload animation passes each stage.
  reloadPhase(char, phase) {
    if (!this.isLocal(char) || !this.ctx) return;
    switch (phase) {
      case 'magOut':
        this.noiseBurst({ dur: 0.05, type: 'bandpass', freq: 1800, q: 4, gain: 0.16 });
        this.tone({ freq: 420, dur: 0.07, type: 'triangle', gain: 0.1 });
        break;
      case 'magIn':
        this.noiseBurst({ dur: 0.07, type: 'bandpass', freq: 1100, q: 3, gain: 0.22 });
        this.tone({ freq: 260, dur: 0.09, type: 'triangle', gain: 0.14 });
        break;
      case 'charge':
        this.noiseBurst({ dur: 0.05, type: 'highpass', freq: 2400, gain: 0.16 });
        this.noiseBurst({ dur: 0.06, type: 'bandpass', freq: 1400, q: 3, gain: 0.2 });
        this.tone({ freq: 320, dur: 0.05, type: 'square', gain: 0.05, delay: 0.09 });
        break;
      default:
    }
  }

  reload(char) { void char; }

  dryFire(char) {
    if (!this.isLocal(char)) return;
    this.tone({ freq: 2000, dur: 0.03, type: 'square', gain: 0.05 });
  }

  beep(pos, urgency = 0) {
    const { g, pan } = this.spatial(pos);
    this.tone({ freq: 1400 + urgency * 600, dur: 0.08, type: 'square', gain: Math.max(0.05, 0.25 * g), pan });
  }

  explosion(pos) {
    const { g, pan } = this.spatial(pos);
    this.noiseBurst({ dur: 1.2, type: 'lowpass', freq: 900, gain: 0.9 * Math.max(0.3, g), pan, sweepTo: 80, wet: 0.5 });
    this.tone({ freq: 70, dur: 1.0, type: 'sine', gain: 0.5, slideTo: 30 });
  }

  ability(kind, pos) {
    const { g, pan } = pos ? this.spatial(pos) : { g: 1, pan: 0 };
    switch (kind) {
      case 'throw': this.noiseBurst({ dur: 0.2, type: 'bandpass', freq: 800, q: 1, gain: 0.25 * g, pan, sweepTo: 2400 }); break;
      case 'flash': this.tone({ freq: 3000, dur: 0.35, type: 'sine', gain: 0.25 * g, pan, slideTo: 1200 }); this.noiseBurst({ dur: 0.3, type: 'highpass', freq: 3000, gain: 0.3 * g, pan }); break;
      case 'smoke': this.noiseBurst({ dur: 0.9, type: 'lowpass', freq: 600, gain: 0.35 * g, pan, sweepTo: 200 }); break;
      case 'fire': this.noiseBurst({ dur: 0.8, type: 'bandpass', freq: 500, q: 0.5, gain: 0.35 * g, pan }); break;
      case 'dash': this.noiseBurst({ dur: 0.25, type: 'bandpass', freq: 600, q: 0.8, gain: 0.4 * g, pan, sweepTo: 3000 }); break;
      case 'heal': this.tone({ freq: 520, dur: 0.4, gain: 0.15 * g, pan, slideTo: 780 }); break;
      case 'reveal': this.tone({ freq: 900, dur: 0.25, type: 'triangle', gain: 0.2 * g, pan }); this.tone({ freq: 1350, dur: 0.25, type: 'triangle', gain: 0.15 * g, pan, delay: 0.12 }); break;
      case 'ult': this.tone({ freq: 220, dur: 0.8, type: 'sawtooth', gain: 0.12, slideTo: 880 }); break;
      case 'zap': this.noiseBurst({ dur: 0.5, type: 'bandpass', freq: 2500, q: 3, gain: 0.4 * g, pan, sweepTo: 400 }); break;
      case 'trap': this.tone({ freq: 1100, dur: 0.12, type: 'square', gain: 0.18 * g, pan }); this.tone({ freq: 800, dur: 0.12, type: 'square', gain: 0.18 * g, pan, delay: 0.12 }); break;
      default: this.noiseBurst({ dur: 0.15, gain: 0.2 * g, pan });
    }
  }

  ui(kind) {
    if (!this.ctx) return;
    switch (kind) {
      case 'buy': this.tone({ freq: 880, dur: 0.08, type: 'triangle', gain: 0.12 }); this.tone({ freq: 1320, dur: 0.1, type: 'triangle', gain: 0.1, delay: 0.05 }); break;
      case 'deny': this.tone({ freq: 220, dur: 0.12, type: 'square', gain: 0.08 }); break;
      case 'roundStart': [440, 554, 659].forEach((f, i) => this.tone({ freq: f, dur: 0.3, type: 'triangle', gain: 0.12, delay: i * 0.08 })); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, dur: 0.45, type: 'triangle', gain: 0.14, delay: i * 0.1 })); break;
      case 'lose': [392, 330, 262].forEach((f, i) => this.tone({ freq: f, dur: 0.5, type: 'triangle', gain: 0.14, delay: i * 0.14 })); break;
      case 'plant': [700, 700].forEach((f, i) => this.tone({ freq: f, dur: 0.18, type: 'square', gain: 0.1, delay: i * 0.25 })); break;
      case 'click': this.tone({ freq: 1200, dur: 0.03, type: 'square', gain: 0.05 }); break;
      case 'orb': this.tone({ freq: 660, dur: 0.12, type: 'sine', gain: 0.16 }); this.tone({ freq: 990, dur: 0.18, type: 'sine', gain: 0.14, delay: 0.07 }); this.tone({ freq: 1480, dur: 0.25, type: 'sine', gain: 0.1, delay: 0.14 }); break;
      case 'callout': this.tone({ freq: 1000, dur: 0.05, type: 'triangle', gain: 0.05 }); break;
      case 'mvp': [659, 784, 988, 1319].forEach((f, i) => this.tone({ freq: f, dur: 0.5, type: 'triangle', gain: 0.12, delay: i * 0.09, wet: 0.3 })); break;
    }
  }
}
