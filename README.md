# mythara-online
Original fantasy MMORPG game project

---

## Playable game (MVP foundation + character classes)

A browser fantasy MMORPG built with plain **HTML + CSS + JavaScript** — no frameworks, no build
step, no dependencies, and no external art assets (every sprite and background is drawn with
canvas code).

**Run it:** open `index.html` in any modern browser, or serve the folder:

```bash
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

- **World** — Verdant Hollow training grounds with a procedural background (sky, sun, mountains,
  hills, tree line, dirt path, grass and wildflowers), generated once and cached.
- **Movement** — arrow keys or WASD, normalised diagonals, constrained to the walkable floor.
- **Combat** — Attack button, `Space`/`J`/`Enter`, or tap the world; damage variance, critical
  hits, floating numbers, hit flash, particles and screen shake.
- **Enemies** — the Green Slime wanders, aggros, chases, attacks, dies and respawns after 4s.
- **Rewards** — EXP and gold per kill, kill log, level-up banner, HP/MP regen, and knockdown +
  auto-revive if you fall.
- **Mobile** — on-screen D-pad and Attack button, auto-shown on touch devices and toggleable
  from the footer.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | Arrow keys / WASD | On-screen D-pad |
| Attack | `Space`, `J` or `Enter` | Attack button, or tap the world |
| Skills | `1`, `2`, `3` | Skill bar buttons |
| Change character | — | "Change Character" button |

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Character-select screen, HUD, canvas stage, skill bar, touch controls, log |
| `style.css` | Theme tokens, HUD/bar styling, selection screen, responsive + touch layouts |
| `data.js` | All content: config, combat rules, progression, items, projectiles, skills, the 10 classes, monsters, zones |
| `game.js` | Engine: `Utils`, `Input`, `Combat`, `Statuses`, `Projectiles`, `Skills`, `Stats`, entities, `Effects`, `Renderer`, `HUD`, `Log`, `CharacterSelect`, `Game` |

## Designed to expand

`data.js` is pure content — new skills, items, monsters, zones and classes can be added without
touching the engine. Adding an eleventh class means adding one entry to `CLASSES`; the selection
screen, cards, previews, HUD and skill bar build themselves from the data.

`game.js` exposes `window.Mythara` with an event bus (`Game.on('levelUp', …)`,
`'characterCreated'`, `'skillCast'`, `'monsterKilled'`, …), `Game.registerSystem()` for extra
update systems, and debug hooks (`Game.createCharacter`, `Game.castSkill`, `Game.damageMonster`,
`Game.teleportPlayer`) used by the test harness.

## Roadmap (not implemented yet)

Guilds · PvP · dungeons · multiplayer.
