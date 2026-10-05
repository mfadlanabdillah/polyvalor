// Persistent user settings (localStorage) with defaults.

export const KEY_ACTIONS = [
  ['forward', 'Move forward'], ['back', 'Move back'], ['left', 'Strafe left'], ['right', 'Strafe right'],
  ['walk', 'Walk'], ['crouch', 'Crouch'], ['jump', 'Jump'],
  ['primary', 'Primary weapon'], ['secondary', 'Sidearm'], ['melee', 'Knife'], ['spike', 'Plant / defuse (hold)'],
  ['reload', 'Reload'], ['inspect', 'Inspect weapon'], ['use', 'Pick up weapon'], ['drop', 'Drop weapon'],
  ['abilityC', 'Ability C'], ['abilityQ', 'Ability Q'], ['abilityE', 'Ability E (signature)'], ['ult', 'Ultimate'],
  ['buy', 'Buy menu'], ['scoreboard', 'Scoreboard'],
];

export const DEFAULTS = {
  sens: 0.4,
  volume: 0.6,
  difficulty: 'normal',
  mode: 'quick',
  crosshair: {
    color: '#6fffb0', thickness: 2, length: 6, gap: 3,
    outline: true, outlineOpacity: 0.6, dot: false, dynamic: true,
  },
  graphics: { shadows: 'high', renderScale: 1, fpsCap: 0, showFps: false, fov: 74 },
  gameplay: {
    hitMarkers: true, damageNumbers: false, callouts: true, viewBob: true, hints: true,
    enemyColor: '#e2505a',
  },
  keys: {
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
    walk: 'ShiftLeft', crouch: 'ControlLeft', jump: 'Space',
    primary: 'Digit1', secondary: 'Digit2', melee: 'Digit3', spike: 'Digit4',
    reload: 'KeyR', inspect: 'KeyY', use: 'KeyF', drop: 'KeyG',
    abilityC: 'KeyC', abilityQ: 'KeyQ', abilityE: 'KeyE', ult: 'KeyX',
    buy: 'KeyB', scoreboard: 'Tab',
  },
};

const STORE = 'polyvalor-settings-v2';

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over || {})) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = merge(base[k], over[k]);
    else if (k in base) out[k] = over[k];
  }
  return out;
}

export function loadSettings() {
  try {
    return merge(DEFAULTS, JSON.parse(localStorage.getItem(STORE) || '{}'));
  } catch {
    return merge(DEFAULTS, {});
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

export function resetSection(s, section) {
  s[section] = JSON.parse(JSON.stringify(DEFAULTS[section]));
}

export function keyLabel(code) {
  if (!code) return '—';
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Numpad/, 'Num ')
    .replace('ControlLeft', 'L-Ctrl').replace('ControlRight', 'R-Ctrl')
    .replace('ShiftLeft', 'L-Shift').replace('ShiftRight', 'R-Shift')
    .replace('AltLeft', 'L-Alt').replace('AltRight', 'R-Alt')
    .replace('Mouse3', 'Mouse 4').replace('Mouse4', 'Mouse 5');
}

// Renders a crosshair into an element (used for HUD and settings preview).
export function renderCrosshair(el, ch, extraGap = 0) {
  const g = ch.gap + extraGap;
  const t = ch.thickness, l = ch.length;
  const ol = ch.outline ? `box-shadow:0 0 0 1px rgba(0,0,0,${ch.outlineOpacity});` : '';
  const base = `position:absolute;background:${ch.color};${ol}`;
  const half = t / 2;
  let html = '';
  if (l > 0) {
    html += `<i style="${base}width:${t}px;height:${l}px;left:${-half}px;top:${-(g + l)}px"></i>`;
    html += `<i style="${base}width:${t}px;height:${l}px;left:${-half}px;top:${g}px"></i>`;
    html += `<i style="${base}height:${t}px;width:${l}px;top:${-half}px;left:${-(g + l)}px"></i>`;
    html += `<i style="${base}height:${t}px;width:${l}px;top:${-half}px;left:${g}px"></i>`;
  }
  if (ch.dot) html += `<i style="${base}width:${t}px;height:${t}px;left:${-half}px;top:${-half}px"></i>`;
  el.innerHTML = html;
}
