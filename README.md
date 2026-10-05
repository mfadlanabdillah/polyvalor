# PolyValor

A low-poly, browser-based 5v5 tactical shooter inspired by Valorant, playable solo against AI bots.
Built with [Three.js](https://threejs.org/) and Vite — every model, map and sound is generated in code (no asset files).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173, choose an agent, and click **LOCK IN & PLAY**.

## Desktop app (Electron)

| Command | What it does |
| --- | --- |
| `npm run app` | Build the game and open it in a desktop window |
| `npm run app:dev` | Open the desktop window against the running `npm run dev` server (live reload) |
| `npm run dist` | Build Windows installer + portable exe into `release/` |
| `npm run dist:dir` | Build an unpacked app folder only (`release/win-unpacked/`) |

In the desktop app: **F11** toggles fullscreen, **F12** opens devtools, and there is no app menu, so Ctrl+W / Ctrl+R can't close or reload the game mid-match (Ctrl is safe to use for crouch). An **Exit to desktop** button appears in the main and pause menus.

Note: after `npm install`, if `node_modules/electron/dist/electron.exe` is missing (npm may block Electron's download script), run `node node_modules/electron/install.js`.

## What's in it

### Match flow
- **Round-based Spike mode**: buy phase with spawn barriers, 1:40 rounds, plant (4s) / defuse (7s, with half-defuse checkpoint), 45s spike timer, side swap at halftime, match point, Swiftplay (first to 5) or Standard (first to 13).
- **Overtime**: tied at one round short of the target → sides swap every round, everyone gets 5000 credits, and a team must lead by 2 (sudden-death cap three rounds past the target).
- **Economy**: 800 pistol rounds, win 3000 / loss bonus 1900→2400→2900, 200 per kill, 300 plant bonus, 9000 cap, buy/sell during buy phase, weapons carry over if you survive, dropped weapons can be picked up. **Quick Buy** picks the best loadout you can afford.
- **Ultimate orbs**: two orbs spawn in contested spots each round and give +1 ultimate point; bots fight for them too.
- **Killcam**: after you die you watch your killer for a few seconds, then your teammates.
- **Round MVP** in the round-end banner, plus **Match MVP / Team MVP** on the end screen with ACS, K/D/A, ADR, HS% and first bloods.

### Gunplay
- Classic, Ghost, Sheriff, Spectre, Bulldog, Guardian, Phantom (damage falloff), Vandal (no falloff), Marshal, Operator (scopes). Head/body/leg multipliers, first-shot accuracy, running/jumping inaccuracy, spray patterns with recoil recovery, tagging slow, light/heavy shields.
- **Wallbang**: every weapon has a penetration level (low / medium / high). Bullets pass through crates and planters with reduced damage (medium = 60%, high = 80%); building walls stop everything. Bots wallbang known positions too.
- **Game feel**: detailed low-poly weapons with moving slide / bolt, a staged reload animation (mag out → new mag → seat → rack) with the off-hand, dropped magazines and ejected brass, star-shaped muzzle flash with a dynamic light, per-weapon synthesized gun sounds with a reverb tail, staged reload sounds, landing dip and thud, hit markers, optional damage numbers, weapon inspect.

### Agents (4 abilities each)
- **Gale** (Duelist) — Updraft, Cloudburst smoke, Tailwind dash, *Blade Storm* knives
- **Ember** (Duelist) — Hot Hands molly, Curveball flash, Warmth heal, *Overdrive*
- **Shade** (Controller) — Stim Beacon, Nearsight blind, Shroud smokes, *Orbital Strike*
- **Echo** (Initiator) — Shock Dart, Flare, Recon Bolt reveal, *Hunter's Fury* wall-piercing beam
- **Warden** (Sentinel) — Tripwire, Slow Field, Mend, *Resurrect*

### AI bots (Easy / Normal / Hard)
A* navigation, field of view + line of sight (smokes block vision), reaction time, aim error that settles while tracking, tap/burst/spray by range, counter-strafing, crouch-spraying at range, silent walking on the final approach, sound awareness (footsteps, gunshots, landings), shared team intel, attack executes on a chosen site, defender site holds and rotations, spike plant/defuse/retake, economy-aware buying, ability usage, wallbanging the spot where an enemy was just seen, and detours for ult orbs. Teammates **call out** enemies, kills and the Spike in a chat-style feed.

### HUD & UX
- Agent portraits and 3D-rendered weapon icons (buy menu, weapon panel, kill feed), SVG ability icons whose key labels follow your bindings.
- Buy menu with stat bars (damage, fire rate, magazine, penetration), item descriptions and Quick Buy.
- Minimap with callout location label, scoreboard (ACS, round history strip), damage direction indicators, flash / smoke / scope overlays, world markers for the dropped and planted Spike, first-two-rounds gameplay hints.

### Settings (main menu or pause menu)
- **General**: sensitivity, volume.
- **Gameplay**: enemy highlight color (red / yellow / purple / orange for color-blind players), hit markers, damage numbers, callouts feed, weapon sway, hints.
- **Crosshair**: color, thickness, length, gap, outline, dot, dynamic error — with live preview.
- **Graphics**: shadow quality, render resolution, FPS limit, FPS counter, field of view.
- **Controls**: rebind every key (Mouse 4/5 supported).

All settings are saved automatically.

## Default controls

| Key | Action |
| --- | --- |
| WASD / Shift / Ctrl or V / Space | Move / walk / crouch / jump |
| LMB / RMB | Fire / zoom (knife: heavy attack) |
| 1 / 2 / 3, mouse wheel | Primary / sidearm / knife |
| Hold 4 | Plant or defuse the Spike |
| C / Q / E / X | Abilities / ultimate |
| R / Y | Reload / inspect weapon |
| B | Buy menu |
| F / G | Pick up / drop weapon |
| Tab | Scoreboard |
| Esc | Pause |

## Project layout

```
src/
  main.js         game bootstrap, loop, camera/killcam, combat callbacks, economy, orbs, stats
  config.js       weapons, penetration, agents, economy, difficulty tuning
  settings.js     persisted settings, default keybinds, crosshair renderer
  settings-ui.js  settings screen (general / gameplay / crosshair / graphics / controls)
  map.js          grid map, collision, raycasting, penetration, callout zones, A* pathfinding, environment
  character.js    shared player/bot body: physics, hitboxes, damage, landing, stats
  weapons.js      firing, spread, recoil, damage falloff
  abilities.js    smokes, flashes, mollies, reveals, ultimates
  bot.js          TeamBrain (strategy, callouts) + BotController (per-bot AI)
  player.js       keyboard/mouse input using the bound keys
  match.js        rounds, overtime, spike, win conditions, economy rewards
  hud.js          DOM HUD, buy menu, scoreboard, end table, minimap
  icons.js        SVG ability glyphs + 3D-rendered weapon/agent thumbnails
  viewmodel.js    first-person weapon rig: hands, reload/slide/bolt animation, inspect
  models.js       low-poly characters and detailed weapons
  effects.js      tracers, impacts, particles, muzzle flash, shells, dropped mags
  audio.js        synthesized WebAudio: per-weapon gun voices, reverb, UI sounds
```
