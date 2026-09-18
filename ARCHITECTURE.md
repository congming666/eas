# Farm Cards Expedition - Architecture Notes

## Runtime modules

- `js/config.js`: rules, map metadata, crops, cards, monsters, and the single runtime `GameState` object.
- `js/save.js`: local persistence and recovery of farm, inventory, loadout, and reward state.
- `js/ui.js`: shared screens, toast notifications, audio controls, and HUD helpers.
- `js/card.js`: card inventory, rarity, selected expedition boosts, and permanent skill upgrades.
- `js/farm.js`: plot unlocks, crop growth, harvest rewards, and farm rendering.
- `js/expedition/`: the expedition gameplay, split along the same boundaries as the Unity port (`Expedition / Combat / Effects / Render / Terrain / Types`). Because the game must run from `file://` without a bundler, each file is a prototype mixin (`Object.assign(Expedition.prototype, {...})`) loaded in a fixed order:
  - `expedition-types.js`: shared constants and type sets.
  - `expedition-core.js`: the `class Expedition` body — instance state, input handlers, pause menu; `update()` is only a fixed-step orchestrator that delegates to focused `updateXxx()` methods.
  - `expedition-terrain.js`: terrain patches, fog of war, collision/spatial queries, map generation, player movement, camera, and traps.
  - `expedition-combat.js`: monster AI, bosses, skills, plant defenses, projectiles, raiders, towers, pickup, extraction, and settlement.
  - `expedition-effects.js`: pooled particles, weapon/hit effect factories, and per-frame visual timers.
  - `expedition-render.js`: `render()` orchestrator plus layered entity/weather/day-night/HUD/minimap rendering, split into `renderXxx()` methods.
- `js/farm-ui.js`: farm screen DOM interaction (previously an inline `<script>` in `index.html`).
- `js/game.js`: screen transitions and orchestration between farm, expedition preparation, expedition runtime, and results.

`index.html` loads the modules in dependency order (config → save → UI → card → farm and expansions → renderer/vendor → the six expedition mixins in the order above → game). Styles live in `css/style.css`; the HTML holds only markup and `<script>`/`<link>` references.

## Expedition systems

- The expedition offers 24 sub-maps across tiers T1–T4, each with its own background, modifiers, and palette; map art lives under `assets/maps/` (with compressed WebP variants where available).
- Tier scaling is centralized in `Expedition.getBalanceProfile()` so enemy stats and rewards grow together.
- Missions rotate between hunting monsters, opening chests, and capturing towers. Completing a mission spawns a tier-specific boss.
- Map events include healing rain, blood moon, canyon mist, and crystal meteor drops. Event modifiers are applied without changing base map data.
- Boars, locusts, wolves, elites, raiders, and bosses use different movement/attack patterns. Boss defeat creates a core and a tier-scaled bounty.

## Verification

- `npm run check` runs `node --check` over every JavaScript file (35 modules at the time of writing).
- `npm test` runs `smoke_test.js`, a Playwright end-to-end pass: main menu → farm economy → card workshop → expedition prep → live expedition (collision, skills, pickup, HUD) → extraction settlement → save/reload recovery. Screenshots are written to `test-results/`.
- `npm run build` assembles the runtime-only site into `dist/` (entry, `css/`, `js/`, `vendor/`, `assets/`, `docs/art/`) and fails if any referenced local asset is missing. CI runs all three gates before publishing `dist/` to GitHub Pages.

