# mythara-online
Original fantasy MMORPG game project

---

## Playable foundation (MVP)

A first playable slice of Mythara Online, built with plain **HTML + CSS + JavaScript** — no
frameworks, no build step, no dependencies.

**Run it:** open `index.html` in any modern browser, or serve the folder:

```bash
python3 -m http.server 8123
# then visit http://localhost:8123
```

### What works today
- **Title screen art & HUD** — MYTHARA ONLINE banner, zone name, character "Jingle" at **Level 1**, HP / MP / EXP bars, gold counter.
- **Procedural fantasy background** — sky, sun, mountains, hills, tree line, dirt path, grass and wildflowers drawn on canvas (cached, no image assets).
- **Player character** — animated placeholder hero with walk bob, facing, and a sword-swing attack arc.
- **Movement** — arrow keys or WASD, normalised diagonal speed, kept inside the walkable floor.
- **Mobile touch controls** — on-screen D-pad plus a big Attack button (auto-shown on touch devices, toggleable from the footer).
- **One test monster** — a Green Slime that wanders, aggros, chases and attacks, then dies and respawns after 4 seconds.
- **Combat & damage system** — Attack button, `Space`, `J` or tapping the world; cooldowns, damage variance, critical hits, floating damage numbers, hit flash, particles and screen shake.
- **Rewards & progression** — EXP (25) and gold (5–13) per kill, kill log, level-up with banner, stat growth, HP/MP regen, and knockdown + auto-revive if Jingle falls.

### Controls
| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | Arrow keys / WASD | On-screen D-pad |
| Attack | `Space`, `J` or `Enter` | Attack button, or tap the world |

### Files
| File | Purpose |
| --- | --- |
| `index.html` | HUD markup, canvas stage, touch controls, log and action bar |
| `style.css` | Theme tokens, HUD/bar styling, responsive + touch layouts |
| `data.js` | All tunable content: world config, combat rules, progression, player, monsters, zones |
| `game.js` | Engine modules: `Utils`, `Input`, `Combat`, `Effects`, `Renderer`, `HUD`, `Log`, `Game` |

### Designed to expand
`data.js` is pure content — new monsters, zones and (later) classes can be added without touching
the engine. `game.js` exposes `window.Mythara` with an event bus (`Game.on('levelUp', …)`),
`Game.registerSystem()` for extra update systems, and debug hooks (`Game.damageMonster`,
`Game.teleportPlayer`) used by the test harness.

### Roadmap (not implemented yet)
10 playable classes · guilds · PvP · dungeons · multiplayer.
