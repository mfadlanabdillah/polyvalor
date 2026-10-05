// Global tuning values. Distances are meters, times are seconds, angles are degrees unless noted.

export const CELL = 2;
export const WALL_H = 5;

export const MOVE = {
  radius: 0.35,
  height: 1.8,
  crouchHeight: 1.3,
  eye: 1.62,
  crouchEye: 1.12,
  run: 5.4,
  walkMult: 0.6,
  crouchMult: 0.4,
  knifeMult: 1.25,
  jump: 7.2,
  gravity: 21,
  accel: 16,
  airAccel: 2.5,
};

export const ROUND = {
  buyTime: 20,
  roundTime: 100,
  spikeTime: 45,
  plantTime: 4,
  defuseTime: 7,
  endDelay: 5,
  startCredits: 800,
  maxCredits: 9000,
  winReward: 3000,
  lossRewards: [1900, 2400, 2900],
  killReward: 200,
  plantReward: 300,
  spikeRadius: 14,
};

export const MODES = {
  quick: { firstTo: 5, label: 'Swiftplay — first to 5' },
  standard: { firstTo: 13, label: 'Standard — first to 13' },
};

export const DIFFICULTY = {
  easy: { label: 'Easy', reaction: 0.65, aimError: 3.2, errorFloor: 1.0, turnSpeed: 5, headRatio: 0.1, recoilControl: 0.25, strafe: false, fov: 85, counterStrafe: false, wallbang: 0, duck: 0, sneak: false },
  normal: { label: 'Normal', reaction: 0.38, aimError: 2.0, errorFloor: 0.55, turnSpeed: 8, headRatio: 0.25, recoilControl: 0.55, strafe: true, fov: 100, counterStrafe: true, wallbang: 0.25, duck: 0.12, sneak: true },
  hard: { label: 'Hard', reaction: 0.22, aimError: 1.1, errorFloor: 0.25, turnSpeed: 12, headRatio: 0.65, recoilControl: 0.8, strafe: true, fov: 110, counterStrafe: true, wallbang: 0.5, duck: 0.3, sneak: true },
};

// dmg: [[maxRange, head, body, leg], ...]
export const WEAPONS = {
  knife: {
    id: 'knife', name: 'Tactical Knife', slot: 'melee', type: 'melee', cost: 0,
    rate: 1.8, range: 2.3, dmg: [[999, 50, 50, 50]], altDmg: 75, equip: 0.35, speedMult: 1.25,
  },
  classic: {
    id: 'classic', name: 'Classic', slot: 'secondary', type: 'pistol', cost: 0, pen: 'low',
    rate: 6.75, auto: false, mag: 12, reserve: 36, reload: 1.75, equip: 0.75,
    dmg: [[30, 78, 26, 22], [999, 66, 22, 18]],
    spread: { base: 0.4, move: 2.2, air: 6, spray: 1.6 },
    recoil: { vert: 0.9, horiz: 0.4, climb: 3, recover: 22 }, zoom: 1,
  },
  ghost: {
    id: 'ghost', name: 'Ghost', slot: 'secondary', type: 'pistol', cost: 500, pen: 'low',
    rate: 6.75, auto: false, mag: 15, reserve: 45, reload: 1.5, equip: 0.75,
    dmg: [[30, 105, 30, 25], [999, 87, 25, 21]],
    spread: { base: 0.25, move: 2.0, air: 6, spray: 1.3 },
    recoil: { vert: 0.8, horiz: 0.35, climb: 3, recover: 22 }, zoom: 1,
  },
  sheriff: {
    id: 'sheriff', name: 'Sheriff', slot: 'secondary', type: 'pistol', cost: 800, pen: 'high',
    rate: 4, auto: false, mag: 6, reserve: 24, reload: 2.25, equip: 0.75,
    dmg: [[30, 159, 55, 46], [999, 145, 50, 42]],
    spread: { base: 0.25, move: 3.2, air: 7, spray: 2.8 },
    recoil: { vert: 2.8, horiz: 0.8, climb: 2, recover: 12 }, zoom: 1,
  },
  spectre: {
    id: 'spectre', name: 'Spectre', slot: 'primary', type: 'smg', cost: 1600, pen: 'med',
    rate: 13.33, auto: true, mag: 30, reserve: 90, reload: 2.25, equip: 0.75,
    dmg: [[20, 78, 26, 22], [999, 66, 22, 18]],
    spread: { base: 0.45, move: 1.5, air: 5, spray: 1.8 },
    recoil: { vert: 0.35, horiz: 0.3, climb: 8, recover: 20 }, zoom: 1.15, speedMult: 1.0,
  },
  bulldog: {
    id: 'bulldog', name: 'Bulldog', slot: 'primary', type: 'rifle', cost: 2050, pen: 'med',
    rate: 9.15, auto: true, mag: 24, reserve: 72, reload: 2.5, equip: 1.0,
    dmg: [[50, 116, 35, 29], [999, 99, 30, 25]],
    spread: { base: 0.3, move: 4.0, air: 8, spray: 2.2 },
    recoil: { vert: 0.5, horiz: 0.35, climb: 6, recover: 18 }, zoom: 1.25,
  },
  guardian: {
    id: 'guardian', name: 'Guardian', slot: 'primary', type: 'rifle', cost: 2250, pen: 'high',
    rate: 5.25, auto: false, mag: 12, reserve: 36, reload: 2.5, equip: 1.0,
    dmg: [[999, 195, 65, 49]],
    spread: { base: 0.12, move: 4.5, air: 8, spray: 1.0 },
    recoil: { vert: 1.2, horiz: 0.3, climb: 3, recover: 16 }, zoom: 1.5,
  },
  phantom: {
    id: 'phantom', name: 'Phantom', slot: 'primary', type: 'rifle', cost: 2900, pen: 'med',
    rate: 11, auto: true, mag: 30, reserve: 60, reload: 2.5, equip: 1.0,
    dmg: [[15, 156, 39, 33], [30, 140, 35, 29], [999, 124, 31, 26]],
    spread: { base: 0.2, move: 4.5, air: 8, spray: 2.0 },
    recoil: { vert: 0.5, horiz: 0.38, climb: 7, recover: 20 }, zoom: 1.25,
  },
  vandal: {
    id: 'vandal', name: 'Vandal', slot: 'primary', type: 'rifle', cost: 2900, pen: 'med',
    rate: 9.75, auto: true, mag: 25, reserve: 50, reload: 2.5, equip: 1.0,
    dmg: [[999, 160, 40, 34]],
    spread: { base: 0.25, move: 4.5, air: 8, spray: 2.5 },
    recoil: { vert: 0.62, horiz: 0.45, climb: 7, recover: 18 }, zoom: 1.25,
  },
  marshal: {
    id: 'marshal', name: 'Marshal', slot: 'primary', type: 'sniper', cost: 950, pen: 'med',
    rate: 1.5, auto: false, mag: 5, reserve: 10, reload: 2.5, equip: 1.0,
    dmg: [[999, 202, 101, 85]],
    spread: { base: 1.5, scoped: 0.05, move: 5, air: 10, spray: 0 },
    recoil: { vert: 1.5, horiz: 0.2, climb: 1, recover: 10 }, zoom: 3.5, scope: true,
  },
  operator: {
    id: 'operator', name: 'Operator', slot: 'primary', type: 'sniper', cost: 4700, pen: 'high',
    rate: 0.6, auto: false, mag: 5, reserve: 10, reload: 3.7, equip: 1.25,
    dmg: [[999, 255, 150, 127]],
    spread: { base: 4, scoped: 0, move: 8, air: 12, spray: 0 },
    recoil: { vert: 2.5, horiz: 0.2, climb: 1, recover: 8 }, zoom: 2.5, scope: true, speedMult: 0.94,
  },
  knives: {
    id: 'knives', name: 'Blade Storm', slot: 'special', type: 'knives', cost: 0, pen: 'low',
    rate: 3.3, auto: false, mag: 5, reserve: 0, reload: 0, equip: 0.4,
    dmg: [[999, 150, 50, 50]],
    spread: { base: 0.05, move: 0.1, air: 0.2, spray: 0 },
    recoil: { vert: 0.2, horiz: 0, climb: 1, recover: 30 }, zoom: 1, speedMult: 1.25,
  },
};

// Wall penetration: max material thickness (m) a bullet can pass and damage kept per pass.
// Crates, tall crates and planters are penetrable; building walls are not.
export const PENETRATION = {
  low: { maxThick: 0.6, mult: 0.5 },
  med: { maxThick: 2.1, mult: 0.6 },
  high: { maxThick: 4.2, mult: 0.8 },
};
export const PENETRABLE = new Set(['c', 'C', 'P']);

export const BUY_LIST = {
  Sidearms: ['classic', 'ghost', 'sheriff'],
  SMGs: ['spectre'],
  Rifles: ['bulldog', 'guardian', 'phantom', 'vandal'],
  Snipers: ['marshal', 'operator'],
};

export const SHIELDS = {
  light: { id: 'light', name: 'Light Shield', cost: 400, value: 25 },
  heavy: { id: 'heavy', name: 'Heavy Shield', cost: 1000, value: 50 },
};

export const AGENTS = {
  gale: {
    id: 'gale', name: 'Gale', role: 'Duelist', color: '#8fd3ff',
    desc: 'A restless wind-walker who dashes in, takes the fight, and gets out.',
    abilities: {
      C: { id: 'updraft', name: 'Updraft', cost: 150, max: 2, desc: 'Launch yourself high into the air.' },
      Q: { id: 'cloudburst', name: 'Cloudburst', cost: 200, max: 2, desc: 'Throw a fast, short-lived smoke cloud.' },
      E: { id: 'tailwind', name: 'Tailwind', cost: 0, max: 1, free: 1, desc: 'Dash a short distance in your move direction.' },
      X: { id: 'bladestorm', name: 'Blade Storm', ult: 7, desc: 'Equip deadly throwing knives. Kills refill them.' },
    },
  },
  ember: {
    id: 'ember', name: 'Ember', role: 'Duelist', color: '#ff9a4a',
    desc: 'A fire-born brawler who blinds, burns and heals in the flames.',
    abilities: {
      C: { id: 'hothands', name: 'Hot Hands', cost: 200, max: 1, desc: 'Lob a fireball that burns the ground. Heals you.' },
      Q: { id: 'curveball', name: 'Curveball', cost: 250, max: 2, desc: 'Throw a flare that blinds enemies who look at it.' },
      E: { id: 'warmth', name: 'Warmth', cost: 0, max: 1, free: 1, desc: 'Heal yourself over time.' },
      X: { id: 'overdrive', name: 'Overdrive', ult: 6, desc: 'Fully heal and fire faster for 10 seconds.' },
    },
  },
  shade: {
    id: 'shade', name: 'Shade', role: 'Controller', color: '#9d7bff',
    desc: 'A tactician from the dark who splits sites with long-lasting smokes.',
    abilities: {
      C: { id: 'stim', name: 'Stim Beacon', cost: 200, max: 1, desc: 'Nearby allies move and fire faster.' },
      Q: { id: 'nearsight', name: 'Nearsight', cost: 250, max: 1, desc: 'Send a wave that blinds enemies in front of you.' },
      E: { id: 'shroud', name: 'Shroud', cost: 100, max: 2, free: 1, desc: 'Place a long-lasting smoke where you aim.' },
      X: { id: 'orbital', name: 'Orbital Strike', ult: 7, desc: 'Call a devastating strike on the aimed location.' },
    },
  },
  echo: {
    id: 'echo', name: 'Echo', role: 'Initiator', color: '#6fe0b0',
    desc: 'A tracker who hunts enemies down with darts and recon.',
    abilities: {
      C: { id: 'shockdart', name: 'Shock Dart', cost: 150, max: 2, desc: 'Fire a dart that explodes on impact.' },
      Q: { id: 'flare', name: 'Flare', cost: 250, max: 2, desc: 'Throw a blinding flare.' },
      E: { id: 'recon', name: 'Recon Bolt', cost: 0, max: 1, free: 1, desc: 'Fire a bolt that reveals enemies in its sight.' },
      X: { id: 'fury', name: "Hunter's Fury", ult: 7, desc: 'Fire a wall-piercing energy beam.' },
    },
  },
  warden: {
    id: 'warden', name: 'Warden', role: 'Sentinel', color: '#f2e27a',
    desc: 'A guardian who locks down sites and brings allies back.',
    abilities: {
      C: { id: 'tripwire', name: 'Tripwire', cost: 200, max: 1, desc: 'Place a hidden trap that reveals and slows enemies.' },
      Q: { id: 'slowfield', name: 'Slow Field', cost: 200, max: 2, desc: 'Lob an orb that creates a slowing field.' },
      E: { id: 'mend', name: 'Mend', cost: 0, max: 1, free: 1, desc: 'Heal yourself over time.' },
      X: { id: 'resurrect', name: 'Resurrect', ult: 7, desc: 'Revive a nearby fallen ally.' },
    },
  },
};

export const BOT_NAMES = [
  'Pixel', 'Nova', 'Vertex', 'Shard', 'Prism', 'Facet', 'Glint', 'Bevel', 'Cinder', 'Moss',
  'Rook', 'Talon', 'Quill', 'Ridge', 'Flint', 'Echoe', 'Sable', 'Kite', 'Marrow', 'Dune',
];

export const COLORS = {
  ally: 0x2fc7b2,
  enemy: 0xe2505a,
  allyCss: '#4fe0c8',
  enemyCss: '#ff5f6a',
};
