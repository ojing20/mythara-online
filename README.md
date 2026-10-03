# mythara-online
Original fantasy MMORPG game project

---

## Playable game (MVP foundation → character classes → full RPG progression)

The build now ships a complete single-player RPG loop on top of the canvas combat engine:
accounts, a main menu, 10 chapters × 5 stages (50 stages, 10 bosses), bot arena duels, levels,
equipment with upgrades, optional summoning, daily quests and rewards — all local-first, with an
optional **Mythara account server** so one account carries the same items and progress across a
phone, a PC and a tablet.

A browser fantasy MMORPG built with plain **HTML + CSS + JavaScript** — no frameworks, no build
step, no dependencies, and no external art assets (every sprite and background is drawn with
canvas code).

**Run it:** open `index.html` in any modern browser, or serve the folder:

```bash
# with accounts + multi-device sync (recommended)
node server/server.js
# prints:  PC http://localhost:8123 · Phone http://<your-lan-ip>:8123 · Tablet the same URL

# or offline-only, no accounts server
python3 -m http.server 8123
# then visit http://localhost:8123
```

## Character selection

The game opens on a fantasy character-selection screen with **10 playable classes**. Each card
shows the class portrait, name, role, a short description, the five core stats (HP / ATK / DEF /
SPD / MAG) and a 1–5 difficulty rating.

Clicking a class highlights it and updates the preview panel with a large animated character
sprite (which idle-bobs and swings on a loop), the full stat breakdown as bars, the **starting
weapon**, the **starting armor**, the **starting skills** (each with cost, cooldown and
description) and the difficulty rating.

- **[CREATE CHARACTER]** — saves the class and name, applies the class stats, hands over the
  starting gear and skills, and drops you into the world.
- **[BACK]** — returns to the game with the character you already have.
- **Change Character** (in-game footer) reopens the selection screen at any time.
- Character name is editable and defaults to **Jingle**; your choice is remembered in
  `localStorage`, so reloading restores the same class and name.

On phones the same screen becomes a tappable card grid with a bottom-sheet detail panel
(backdrop tap or the chevron collapses it), and all in-game touch controls still work.

### The 10 classes (all original designs)

| Class | Role | HP | ATK | DEF | SPD | MAG | Difficulty | Weapon | Armor | Signature abilities |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Warrior | Melee · Tank | 150 | 13 | 10 | 165 | 2 | Easy | Iron Longsword | Guard Plate | Shield Bash · Iron Guard · Whirlwind |
| Archer | Ranged · DPS | 105 | 15 | 4 | 215 | 3 | Easy | Yew Shortbow | Ranger's Leathers | Power Shot · Rain of Arrows · Eagle Eye |
| Fire Mage | Ranged · AoE | 88 | 5 | 3 | 175 | 20 | Normal | Emberwood Staff | Emberweave Robe | Fireball · Flame Nova · Molten Armor |
| Ice Mage | Ranged · Control | 92 | 5 | 3 | 175 | 18 | Normal | Frostpine Staff | Frostveil Robe | Frost Bolt · Glacial Prison · Ice Barrier |
| Assassin | Melee · Burst | 104 | 16 | 4 | 215 | 4 | Normal | Twin Fang Daggers | Shadowweave Garb | Shadow Strike · Venom Blades · Fan of Knives |
| Paladin | Melee · Support | 160 | 12 | 13 | 155 | 9 | Easy | Dawnbreaker Sword | Aegis of Dawn | Holy Smite · Lay on Hands · Divine Aegis |
| Priest | Ranged · Healer | 90 | 4 | 4 | 170 | 17 | Normal | Suncall Staff | Vestments of Mercy | Heal · Blessing · Smite |
| Berserker | Melee · Damage | 135 | 24 | 3 | 175 | 2 | Hard | Bloodhowl Greataxe | Warshide Harness | Cleave · Blood Rage · Reckless Charge |
| Ninja | Melee · Skirmisher | 106 | 15 | 4 | 245 | 5 | Hard | Kage Twin Blades | Shinobi Wraps | Shuriken · Smoke Bomb · Shadow Step |
| Dragon Knight | Melee · Ultimate | 147 | 18 | 10 | 170 | 8 | Normal | Wyrmfang Greatsword | Dragonplate | Dragon Cleave · Wyrm Guard · Dragon's Breath |

Stats above are the effective level-1 values (class base + starting gear).

### Class mechanics

- **Melee vs ranged** — melee classes swing at close range; ranged classes (Archer, Fire Mage,
  Ice Mage, Priest) fire aimed projectiles with distinct visuals (arrows, fireballs, frost
  shards, holy bolts).
- **Passives** — Warrior −15% damage taken, Archer +10% crit, Fire Mage +25% burn damage,
  Ice Mage stronger chills, Assassin +35% crit damage, Paladin +25% healing received,
  Priest +50% MP regen, Berserker rage (up to +25% attack), Ninja +15% evasion, Dragon Knight
  −10% damage taken.
- **Status effects** — burning, poison, slow and freeze/stun, with on-canvas visuals and status
  chips on the enemy plate.
- **Rage** — the Berserker builds rage by dealing and taking damage, shown as a fourth HUD bar,
  and spends it on Blood Rage.
- **Stealth** — the Ninja's Smoke Bomb hides the player (enemies lose aggro) and guarantees
  critical hits.
- **Skills** — three per class on a skill bar (click or keys **1**, **2**, **3**) with MP costs,
  cooldowns and cooldown sweeps.
- **Leveling** — every class has its own HP/MP/ATK/DEF/MAG growth curve per level.

## Gameplay

- **World** — height-field terrain (grass, dirt paths, sand, rock, cliffs) with the Silverstone
  village, a dirt road to the hunting grounds, water, weather and a day/night cycle.
- **Movement** — arrow keys or WASD, normalised diagonals, constrained to the walkable floor and
  blocked by cliffs, houses, big rocks and tree trunks (with wall sliding).
- **Combat** — Attack button, `Space`/`J`/`Enter`, or tap/click the world; per-class swing timing,
  damage variance, crits, floating numbers, hit flash, hit reactions, particles, screen shake and
  procedural WebAudio attack/hit/death sounds.
- **Targeting** — tap/click a monster to lock it (highlighted with a reticle and its own HP plate),
  `Tab` cycles targets, `Esc` clears. Attacks check range *and* line of fire, so nothing is hit
  through a wall, a cliff or a house.
- **Enemies** — a seven-state AI (idle → patrol → detect → chase → attack → return to spawn →
  death) with aggro ranges, leashes, obstacle avoidance and 4s respawn timers after death.
- **Rewards** — EXP and gold per kill (paid exactly once per life), floating +EXP/+gold text, and
  loot drops in rarity colours that you walk over to collect.
- **Loot** — coins, potions, materials and equipment roll from per-tier drop tables
  (`js/data-loot.js`); drops never land in water or inside solid props, and fade after 90s.
- **Falling** — at 0 HP the hero is knocked down, combat stops, and after 3s they revive at the
  nearest safe ground (the village gate when close to Silverstone) with full HP/MP.
- **Mobile** — on-screen D-pad and Attack button, auto-shown on touch devices and toggleable
  from the footer.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | Arrow keys / WASD | On-screen D-pad |
| Attack | `Space`, `J` or `Enter` | Attack button, or tap the world |
| Skills | `1`, `2`, `3` | Skill bar buttons |
| Select target | Tap/click a monster | Tap a monster |
| Cycle target | `Tab` / `Shift`+`Tab` | — |
| Clear target | `Esc` | — |
| Change character | — | "Change Character" button |

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Character-select screen, HUD, canvas stage, skill bar, touch controls, log |
| `style.css` | Theme tokens, HUD/bar styling, selection screen, responsive + touch layouts |
| `data.js` | All content: config, combat rules, progression, items, projectiles, skills, the 10 classes, monsters, zones |
| `game.js` | Engine: `Utils`, `Input`, `Combat`, `Statuses`, `Projectiles`, `Skills`, `Stats`, entities, monster AI, loot, `Effects`, `Renderer`, `HUD`, `Log`, `CharacterSelect`, `Game` |
| `js/sfx.js` | Procedural WebAudio sound kit — no audio files, honours the Settings → Sound toggle |
| `js/data-loot.js` | Per-tier drop tables (coins, potions, materials, equipment) + rarity colours |

## Designed to expand

`data.js` is pure content — new skills, items, monsters, zones and classes can be added without
touching the engine. Adding an eleventh class means adding one entry to `CLASSES`; the selection
screen, cards, previews, HUD and skill bar build themselves from the data.

`game.js` exposes `window.Mythara` with an event bus (`Game.on('levelUp', …)`,
`'characterCreated'`, `'skillCast'`, `'monsterKilled'`, …), `Game.registerSystem()` for extra
update systems, and debug hooks (`Game.createCharacter`, `Game.castSkill`, `Game.damageMonster`,
`Game.teleportPlayer`) used by the test harness.

## Full RPG progression systems

The progression layer lives in `js/` and is deliberately decoupled from the canvas engine:
the engine knows nothing about accounts, and the account layer knows nothing about rendering.

### Flow

`Loading → Login/Register → Main Menu → Character Selection → Adventure / Arena / Characters /
Inventory / Equipment / Summon / Quests / Shop / Settings → Battle → Rewards → Save → Main Menu`

### Accounts

- Register with username, email and password; log in with either username or email, with
  **remember me** supported. A remembered session is restored on the next visit.
- Passwords are never stored in plain text: each account keeps a random salt and a hashed
  password. The prototype uses a local (browser) auth backend, and `Auth.setBackend()` swaps in a
  real server later without touching the UI.
- Everything is account-bound: active character, character levels and EXP, coins, gems, tickets,
  energy, HP/MP state, inventory, equipment, skills, unlocks, chapter/stage progress,
  arena rating, potions, materials, quests and settings.
- Old saves from the earlier canvas-only build (`mythara.character.v1`) are imported on first
  login so no progress is lost.

### Unlocks (10 classes)

| Class | Coins | Account level | Fragments | | Class | Coins | Account level | Fragments |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Warrior | free | 1 | — | | Paladin | 2,500 | 25 | 60 |
| Archer | 500 | 5 | 20 | | Priest | 3,000 | 30 | 70 |
| Fire Mage | 1,000 | 10 | 30 | | Berserker | 3,500 | 35 | 80 |
| Ice Mage | 1,500 | 15 | 40 | | Ninja | 4,000 | 40 | 90 |
| Assassin | 2,000 | 20 | 50 | | Dragon Knight | 5,000 | 50 | 100 |

Locked cards show a lock icon, the required account level, the coin price and fragment progress,
plus an unlock sheet that spends coins or fragments when you can afford it. Fragments drop from
stages, dailies and summons, so every class is reachable without spending a gem.

### Adventure

- **10 chapters × 5 stages = 50 stages.** Stages 1–4 are normal runs of **4 mob waves + a final
  wave**; stage 5 is a **boss fight** with a dedicated health bar, telegraphed special attacks,
  summoned reinforcements and multiple phases where the boss has them.
- Each chapter has its own palette and bestiary — Silverstone Beginning (Forest Goblin / Wild
  Wolf → Goblin King), Ancient Forest, Dark Caverns, Frozen Valley, Desert Ruins, Haunted Swamp,
  Demon Castle, Dragon Mountain, Shadow Realm and Mythara's End (→ MYTHARA LORD).
- The chapter palette re-skins the battle background, so the ten chapters look distinct.
- Stage screen shows name, chapter, recommended level and power, energy cost, wave count, enemy
  preview, possible rewards, best time and stars.
- **Stars:** ★★★ cleared without falling and never dropping below 70% HP · ★★ cleared without
  falling · ★ cleared using the one Second Wind revive. Rewards scale with stars, and first
  clears pay bonus gems (bosses also grant a summon ticket).

### Arena (bot duels — not online multiplayer)

- 1v1 duels against an **AI opponent** built from a random class kit; the opponent moves, strafes,
  dodges your wind-ups, casts class skills, heals, and fires ranged basics.
- Five difficulties — Easy, Normal, Hard, Elite and Boss-tier — set the bot's level offset,
  reaction time, aggression, dodge/skill/ultimate chances and rewards.
- Ranked tiers: Bronze → Silver → Gold → Platinum → Diamond → Mythic, fed by arena rating,
  with wins/losses, streak and win rate shown on the rank card.
- **There is no online PvP.** The UI says so on the arena screen, and 3v3 is described as a
  possible future mode only.

### Resources, levels and equipment

- **Coins** (unlocks, gear upgrades, potions, shop), **gems** (optional summons, energy refill,
  special items), **EXP**, **energy** (stages; 100 max, one point per 240s), **potions**
  (HP / MP / Full Recovery) and **materials** (upgrade stones, chapter ores).
- Account level caps at 100; every character also levels 1–100 with its own EXP bar, level-up
  animation and stat growth, unlocking skills along the way
  (HP / MP / ATK / DEF / MAGIC / SPEED / CRITICAL / EVASION).
- **9 equipment slots** — Weapon, Helmet, Armor, Gloves, Pants, Boots, Necklace, Ring, Wings —
  across **6 rarities** (Common, Uncommon, Rare, Epic, Legendary, Mythic) with **+1 … +15**
  upgrades (100% success below +5, then 90% / 75% / 60%, +6% stats per level).

### Summoning (optional)

Free tickets and earned gems only — no real-money purchases exist in the prototype. Single pulls
cost 100 gems, ten-pulls cost 900. Rarities are Common, Uncommon, Rare, Epic, Legendary and
Mythic with published rates, animated result cards and rarity effects. Summoning is a shortcut,
not a requirement: characters are also unlockable with coins and stage fragments.

### Daily rewards and quests

- **7-day login rewards:** coins → potions → gems → equipment chest → summon ticket → upgrade
  materials → character fragments, with a streak that resets if you miss a day.
- **Daily quests:** defeat 10 monsters, clear 3 stages, win 1 arena battle, use 3 potions, upgrade
  equipment — each paying coins/XP/gems/potions/materials/tickets, resetting every 24 hours.

### Interface

Dark-fantasy theme with gold accents, large tappable buttons, animated panels, progress bars,
portraits, icons and a battle HUD (wave counter, objective, boss bar with phase, potion bar).
Layouts adapt to desktop, tablet and phone widths, and combat is comfortable in landscape.

## 3D presentation layer (v0.5.0-3d)

The game now renders its world with a **software 3D renderer** — a depth-sorted painter's
algorithm (flat lambert lighting, aerial-perspective fog, back-face culling, ring-stack geometry)
drawn onto the same 2D canvas the engine always used. No WebGL, no CDN, no build step, and no
copyrighted assets: every mesh, monster and prop is generated from code and the existing data
files. The original 2D renderer stays in the build untouched and can be selected with
`?render=2d`.

| Feature | Detail |
| --- | --- |
| Camera | Third-person, behind the character, follows with smoothing, pitch/zoom/rotate, lock-on to the current target |
| Environments | 12 themed biomes (hub + 10 chapters + arena) with terrain height fields, carved water channels, a dirt road, props (trees, rocks, villages, castles, ruins, crystals, braziers), dynamic sun/sky/day-night cycle, fog, weather particles and post-grade tints |
| Heroes | All 10 classes share one rig with per-class armour, capes, hoods, helmets, pauldrons, shields and weapons (bow/quiver, staves, daggers, dual blades, greataxe, great-swords) plus idle, walk, run, attack, skill, hit and death animation states |
| Monsters & bosses | Body archetypes (beast, goblin, skeleton, golem, treant, wraith, bat, serpent, scorpion, blob, elemental) with animated limbs, hit flashes, HP/name plates, boss auras, target rings and telegraphs |
| Combat | Weapon swings, impact bursts, spell particles (fire/ice/lightning/holy), floating damage and crit numbers, screen shake, ground decals, projectiles |
| UI | Loading screen with animated logo, percentage and rotating tips; gold-ringed portrait, level/class, ornate HP/MP/XP bars, equipment slots, skill hotbar, quest tracker, minimap, chat frame, wallet (coins/gems/potions) and a boss HP bar |

Quality presets (`?quality=low|medium|high`, default `auto`) scale view distance and detail for
phones. `?time=0..1` pins the time of day.

### Living world (v0.5.1-field)

| System | Detail |
| --- | --- |
| Height-field terrain | Fixed-seed noise per region gives rolling hills and shallow valleys everywhere, with the mountain rim and carved river/lake beds outside the field. Nothing is flat: actors, shadows, name plates, projectiles, spell impacts, decals and the camera all sample the same height field, so nothing floats or sinks |
| Ground shading | Grass/dirt/rock/cliff/snow blended by height and slope, plus wet sand/gravel ringing every shoreline and a smooth dirt road across the field |
| Village (Silverstone Beginning) | Central plaza with fountain and banner poles, houses, a well, market stalls, a blacksmith forge with anvil and weapon rack, lanterns, a safe-zone ground ring and three NPCs (quest giver **!**, trader **$**, healer **+**) with floating name tags |
| Road furniture | Split-rail fences, signposts and lanterns follow the road; scenery is kept out of the road corridor and the village plaza |
| Ambient life | Fireflies and lantern/village glow after dark, drifting leaves and dust motes by day, footstep dust on dry ground and splashes when walking through water |
| Water | A flat water plane with a gentle swell and shoreline foam where cells are barely submerged, so banks rise out of the water instead of water stacking into terraces |
| Artefact fixes | Terrain culling now keeps heavily foreshortened near cells (no more sky showing through under the camera), the road is fine-segmented so it hugs hills, and the plaza/market/blacksmith/NPC set is limited to the hometown chapter |
| Performance | Density LOD thins distant scenery deterministically, closed shapes back-face cull, small furniture is near-only, and the Low/Medium/High presets scale prop distance, detail distance, render scale and weather density |
| World scale | Every prop, building and character is sized against the 22-unit hero; larger props read from closer, so the high preset draws props to 1150 and thins the far field harder (the far half of the ring keeps ~20% of trees on high, ~7% on low) |

Representative CPU frame times (software rasteriser, 960×540, no GPU): **≈21 ms median** in the hub
village, **≈23 ms median** in a chapter-1 battle and **≈24 ms** on the chapter-8 boss (p75 ≈ 25 ms
across all three). Combat, the seven-state monster AI and loot rendering added no measurable cost —
distant monsters simply think on a slower tick. A real browser with a GPU-backed canvas is several
times faster; the legacy 2D renderer stays under 1 ms.

### Development tools (`tools/`)

Headless render harnesses that boot the real game in jsdom with a Skia-backed canvas, drive the
real login/character/stage flow and write PNG frames for visual review:

```bash
npm install --no-save jsdom @napi-rs/canvas
export NODE_PATH="$PWD/node_modules"
node tools/render-check.js tools/shots --scene=battle --stage=c1-1 --frames=40 --combat
node tools/render-suite.js tools/shots/suite --what=chapters
node tools/render-perf.js --stage=c8-5
```

See `tools/README.md` for every option. These are dev-only scripts: the shipped game keeps its
zero-dependency, no-build-step rule.

## Combat, AI, loot & death (v0.6-combat)

**Attack loop.** One cooldown source per class (`attackCooldownMs`, shortened by attack-speed
bonuses) gates every basic attack, so holding the button or tapping repeatedly cannot skip swings.
Melee classes apply damage in a cone in front of the hero; ranged classes loose their class
projectile (`arrow`, `fireball`, `icyShard`, `holyBolt`). Every attack checks **range** and
**line of fire** — `Renderer.blocked()` traces the terrain height field and the solid prop list
(houses, ruins, wells, big rocks, tree trunks), so nothing lands through a wall, a cliff or a
building. Point-blank swings always connect so brawling beside a wall still works.

**Targeting.** Tap or click a monster to select it; the pick is a real screen-space test against
the same camera that drew the frame, so what you touch is what you get. `Tab` cycles the nearest
living monsters, `Esc` drops the target. The HUD plate (name, level, HP bar, status chips) and the
3D lock-on reticle follow the selection; with no selection the engine falls back to the nearest
threat, exactly as before.

**Monster AI.** Each monster runs a small state machine:

| State | Behaviour |
| --- | --- |
| `idle` | stands at ease, picks the next thing to do |
| `patrol` | walks to a random spot inside its spawn radius |
| `detect` | 0.35s of noticing you (a `!` pops above its head) |
| `chase` | runs at the hero while inside aggro range *and* line of sight |
| `attack` | swings on its own cooldown and re-checks reach every frame |
| `return` | leashed home, regenerating, ignoring you until you re-enter |
| `death` | plays out, then respawns at its spawn point after `respawnMs` |

Aggro range comes from the enemy data plus an alert bonus; the leash (340 units, 620 for bosses)
pulls a monster home if it is dragged too far. Monsters steer with `Renderer.resolveMove()`, so
they walk around cliffs and buildings instead of through them.

**Damage & death.** Damage rolls attacker stats vs defender defence with variance and crits;
floating numbers show white/yellow for hits and crits and red for damage taken. Deaths fire a
particle burst, a death animation and a boss sting. Rewards (`+EXP`, `+gold`) are paid **once** per
life — a `rewarded` flag stops a damage-over-time tick and a swing from double-paying, and it is
cleared when the monster respawns, so the next life pays again.

**Loot.** `js/data-loot.js` rolls coins, potions, region materials and equipment by tier:
mobs drop one roll ~80% of the time, elites two, and bosses three including a guaranteed piece of
equipment. Items appear as rarity-coloured gems on the ground with a label, a glow and a ring;
drops are placed on dry, walkable ground (never in the lake or inside a prop), pick up when you
walk within 52 units, and fade after 90 seconds. Coins, potions and materials are credited to the
signed-in account through `Account.addCoins` / `addPotion` / `addMaterial`; equipment rolls a real
item into the inventory via `Account.rollItem`.

**Death & respawn.** At 0 HP the hero is knocked down, all attacks are refused (including the
public API), and after 3 seconds they stand up at the nearest safe ground — the Silverstone gate
when the fight happened near the hometown, otherwise the class spawn — with full HP and MP and a
clean bill of health. Stage and arena battles keep using the existing `battle:playerDown` flow.

**World scale (v0.7).** The third-person world is sized against a 22-unit hero (about 1.75 m):
homes are 40x30x28 with a walk-in doorway, market stalls stand 17 units to the awning, conifers
reach 60 and giant trees 122, the road is 60 wide (~3 characters abreast) and the plaza 104
across, with barrels, crates, benches, signposts, fences, lanterns and NPCs to match. Monsters
are 0.5-1.7 hero-heights (goblins and wolves waist-high, elites chest-high, bosses ~1.7x), so the
environment reads larger than the characters. `tools/scale-check.js` measures all fourteen
proportions from rendered frames and fails the build when one leaves its band.

**Performance.** Monsters further than 420 units from the hero think every other frame, beyond
900 units every fifth frame (scaled dt keeps their motion smooth). Cooldowns are decremented, not
recomputed; line-of-sight checks are throttled to ~3/second per monster; loot rendering only
touches the drops the hero has not collected, and only the nearest four loot labels are drawn.

**Sound.** `js/sfx.js` synthesises every effect with WebAudio oscillators and noise buffers —
swings, hits, crits, misses, casts, monster deaths, loot pickups, coins, potions, level-ups and
the death sting. The AudioContext is created on the first user gesture, repeats are throttled per
sound, and the whole kit turns into a silent no-op when WebAudio is missing or the account's
Settings → Sound effects switch is off.

## Cloud accounts — MYTHARA SERVER → DATABASE → Phone · PC · Tablet

`node server/server.js` hosts the game **and** the account API on one origin (zero dependencies —
Node's own `http`/`fs`/`crypto` only). Open the printed address on every device, log in with the
same username and password, and the same account, items and progress are there:

```
MYTHARA SERVER ── DATABASE ──┬── Phone   ┐
                             ├── PC      ├── JINGLE · same account · same items · same progress
                             └── Tablet  ┘
```

```bash
node server/server.js            # http://localhost:8123 + LAN URL for phones/tablets
PORT=9000 node server/server.js  # custom port
QUIET=1 node server/server.js    # no request log
```

### How a device stays in sync

1. **Local-first.** Every change is written to this device's storage immediately, so the game keeps
   working offline — on a plane, in a tunnel, or opened straight from `file://`.
2. **Revision-checked saves.** Each account has a `revision` number. A device may only overwrite the
   copy it last downloaded (`baseRevision`). A stale write gets `409 Conflict` instead of silently
   clobbering the other device's work.
3. **Merge instead of lose.** On a conflict the client merges both copies and retries: stage stars,
   clears, levels, unlocks and inventory items are the **union**, while counters and currencies take
   the higher value, so nothing earned on either device disappears. (Honest note: that policy is
   player-friendly but not cheat-proof. A production server would store an operation log instead.)
4. **Push on every save.** `Account.save()` schedules a push; hiding the tab or closing the page
   flushes with `keepalive`. The Settings screen shows *Sync: connected · last sync 2m ago*, offers
   **[Sync now]**, and falls back to *Sync: offline* when the server is unreachable.

`?server=http://192.168.1.20:8123` on the URL (or a saved setting) points a `file://` copy at a
server, so you can play from a local folder and still sync.

### API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | service name, version, account/session counts |
| `POST /api/register` | `{username, email, password, confirm}` → `{token, account}` |
| `POST /api/login` | `{identifier, password}` (username **or** email) → `{token, account}` |
| `GET /api/session` | validate a `Bearer` token |
| `GET /api/account` | the account document + `revision` |
| `PUT /api/account` | `{account, baseRevision, force}` → `200` or `409 {conflict, revision, account}` |
| `POST /api/password` | change password and revoke every other session |
| `POST /api/logout` | revoke this token |

### Server side: what it does and does not do

- ✅ Passwords are hashed with **scrypt** (N=16384, r=8, p=1) and a per-account random salt —
  plain text or the client-side prototype digest is never stored. Login compares with
  `timingSafeEqual`; tokens are `crypto.randomBytes(32)`.
- ✅ Durable storage in `server/data/mythara-db.json` (atomic temp-file + rename writes, 120 ms
  debounce, corrupt-file quarantine, 30-day session TTL). The data shape is SQL-swappable:
  `{version, accounts, sessions}`.
- ✅ Static hosting that refuses to serve `server/` or dotfiles, 1 MB request cap, 512 KB profile cap.
- ⚠️ No TLS, no rate limiting and no email verification yet — put it behind a reverse proxy
  (Caddy/nginx/Cloudflare) before exposing it to the internet, and treat the JSON file as a
  single-writer database for one host.
- ⚠️ **It synchronises accounts, it is not live multiplayer.** Arena duels are still against the
  game's own AI bots, and two devices never share a fight.

## Files (RPG progression build)

| File | Purpose |
| --- | --- |
| `index.html` | Loading screen, legacy character-select + canvas screens, app shell mount points, script order |
| `style.css` | Theme tokens, HUD/bars, selection screen, and the full app shell (menus, cards, modals, battle HUD) with responsive + landscape rules |
| `data.js` | Legacy content + combat rules: config, items, projectiles, skills, the 10 classes, monsters, zones |
| `game.js` | Canvas engine: `Utils`, `Input`, `Combat`, `Statuses`, `Projectiles`, `Skills`, `Stats`, `Anim`, entities, `Effects`, `Renderer`, `HUD`, `Log`, `CharacterSelect`, `Game` (modes, waves, enemy AI, boss phases) |
| `js/core.js` | `MytharaCore`: event bus, namespaced storage with memory fallback, formatting, DOM and RNG helpers |
| `js/data-items.js` | Rarities, slots, 54 equipment templates, potions, materials, unlock table, summon table, shop, daily rewards, quests, energy and level curves |
| `js/data-enemies.js` | 39 enemies + 10 bosses (body types, palettes, abilities, phases), arena difficulty presets, PvP tiers |
| `js/data-stages.js` | 10 chapters × 5 stages with waves, rewards, recommendations and palettes |
| `js/account.js` | `MytharaAccount`: swappable `Auth` (salted hashing, sessions) and the `Account` progression API |
| `js/systems.js` | Reusable systems: quests, daily rewards, shop, summon, gear, arena ranks, reward formatting |
| `js/battle.js` | Battle controller: stage waves, boss encounters, stars and rewards, arena bot AI |
| `js/ui.js` | Every app screen (auth, menu, adventure, arena, inventory, equipment, summon, quests, shop, settings) plus modals, toasts and the battle HUD |
| `js/app.js` | Flow controller: loading → auth → menu → select → battle → rewards, saving, settings, account sync and legacy-save import |
| `js/sync.js` | `MytharaSync`: server detection, cloud auth backend, push/pull/reconcile, conflict merge, offline queue |
| `style-mmorph.css` | MMORPG skin: cinematic loading screen, gold-ringed portrait, ornate bars, wallet, minimap, quest tracker, chat frame, boss bar |
| `js/render3d.js` | 3D facade: camera follow/lock-on, frame pipeline, day-night, quality presets, minimap, HUD, class preview, 2D fallback switch |
| `js/render3d-core.js` | Math (vec3/mat4), value + fBm noise, colour helpers, lighting model, camera, depth-sorted painter with fog |
| `js/render3d-shapes.js` | Procedural geometry: box, plate, cylinder, cone, blob, billboard, ribbon, ring, grass blade |
| `js/render3d-world.js` | Biome themes, terrain height fields, water carving, road, prop scatter, sky/horizon/weather/post passes |
| `js/render3d-actors.js` | Hero rig (10 classes + equipment), monster archetypes, animation states, name/HP plates |
| `js/render3d-vfx.js` | Combat visuals: swings, impacts, spells, projectiles, decals, floating numbers |
| `tools/` | Development-only headless render harnesses (jsdom + Skia canvas) — see `tools/README.md` |
| `server/server.js` | Zero-dependency static host + API (`node server/server.js`), LAN URL banner, graceful DB flush |
| `server/api.js` | Routes, `Bearer` auth, body/profile caps, CORS, revision conflict responses |
| `server/auth.js` | scrypt hashing, credential validation, token minting, `publicAccount()` |
| `server/db.js` | JSON file database: atomic writes, debounce, sessions, TTL pruning, quarantine |
| `server/tests/api.test.js` | `node --test` — 13 end-to-end server checks |

### Tests

The server suite ships in the repository and runs with no dependencies:

```bash
node --test                   # 13 server checks (register, login, conflicts, restart)
```

Presentation work is verified with the `tools/` render harnesses, which boot the real game
headlessly and write PNG frames (`render-check.js` for one scene, `render-suite.js` for the 10
chapters / 10 bosses / 10 hero previews, `render-perf.js` for frame cost, `scale-check.js` for the
                fourteen world-scale proportions).


| Suite | Checks | Covers |
| --- | --- | --- |
| `test.js` | 85 | Engine boot, HUD, combat, skills, touch controls, long-run stability |
| `classes.test.js` | 129 | All 10 classes, previews, persistence, mobile selection, original-art rules |
| `storage.test.js` | 6 | Storage-blocked fallback paths |
| `appflow.js` | 133 | Loading → register → menu → select → stage battle → bosses → arena → shop/summon → save/reload |
| `campaign.test.js` | 113 | All 50 stages and 10 bosses, unlocks, energy, quests, dailies, equipment, mobile, login variants, legacy import |
| `server/tests/api.test.js` | 13 | Register/login, hashed storage, two devices pulling one account, 409 conflicts, token revocation, restart persistence |
| `sync.test.js` | 35 | Three jsdom "devices" (PC, phone, same-origin tablet) against a real server: same coins/items/stages/levels, offline edits merge instead of clobbering, logout revokes the token |

## Roadmap (not implemented yet)

Guilds · dungeons · live online multiplayer (accounts sync, but fights are against bots) ·
3v3 team battles.
