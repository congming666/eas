# Farm Cards Expedition - Architecture Notes

## Runtime modules

- `js/config.js`: rules, map metadata, crops, cards, monsters, and the single runtime `GameState` object.
- `js/save.js`: local persistence and recovery of farm, inventory, loadout, and reward state.
- `js/ui.js`: shared screens, toast notifications, audio controls, and HUD helpers.
- `js/card.js`: card inventory, rarity, selected expedition boosts, and permanent skill upgrades.
- `js/farm.js`: plot unlocks, crop growth, harvest rewards, and farm rendering.
- `js/expedition.js`: camera-based sandbox movement, terrain, obstacles, traps, monsters, missions, events, bosses, loot, and extraction.
- `js/game.js`: screen transitions and orchestration between farm, expedition preparation, expedition runtime, and results.

`index.html` loads the modules in dependency order: config, save, UI, card, farm, expedition, game.

## Expedition systems

- Four map backgrounds use compressed WebP assets in `assets/maps/`; source PNGs remain as backups.
- Tier scaling is centralized in `Expedition.getBalanceProfile()` so enemy stats and rewards grow together.
- Missions rotate between hunting monsters, opening chests, and capturing towers. Completing a mission spawns a tier-specific boss.
- Map events include healing rain, blood moon, canyon mist, and crystal meteor drops. Event modifiers are applied without changing base map data.
- Boars, locusts, wolves, elites, raiders, and bosses use different movement/attack patterns. Boss defeat creates a core and a tier-scaled bounty.

## Verification

All JavaScript modules pass `node --check`. WebP references resolve to four files totaling less than 1 MB; original PNGs are preserved for future re-export.

