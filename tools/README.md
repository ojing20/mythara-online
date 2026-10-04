# Mythara Online — development tools

These scripts render the game headlessly so the presentation layer can be reviewed without a
browser: they boot the real `index.html` (scripts + styles inlined), sign in through the real
forms, create a hero, enter a scene and write PNG frames.

They are **development tools only** — nothing here ships with the game, and the game itself keeps
its "no dependencies, no build step" rule.

## Requirements

The tools need two dev-only packages (installed anywhere and pointed at with `NODE_PATH`, or in a
local `node_modules/`):

```bash
npm install --no-save jsdom @napi-rs/canvas
export NODE_PATH="$PWD/node_modules"
```

`@napi-rs/canvas` provides a real Skia-backed 2D canvas inside jsdom, so the software 3D
renderer actually rasterises frames.

## render-check.js — one scene, a handful of frames

```bash
node tools/render-check.js tools/shots --scene=battle --stage=c1-1 --frames=40 --combat
node tools/render-check.js tools/shots --scene=boss --stage=c8-5 --combat
node tools/render-check.js tools/shots --scene=hub --class=fireMage --time=0.8
```

| Option | Meaning |
| --- | --- |
| `--scene=hub\|battle\|boss\|arena` | scene to enter (default `battle`) |
| `--stage=cN-X` | adventure stage for `battle`/`boss` |
| `--class=<classId>` | hero class (`warrior`, `fireMage`, …) |
| `--frames=N` | frames to pump (shots at 5 points across the run) |
| `--combat` | press `Space` on the real keyboard input path |
| `--time=0..1` | time of day |
| `--quality=low\|medium\|high\|auto` | renderer quality preset |
| `--skip=terrain,detail` | skip render sections while debugging |
| `--no-clouds` | disable the cloud layer |
| `--render-2d` | boot the legacy 2D renderer (regression check for the fallback path) |
| `--wedge` | dev artifact hunt: colour-code fills by layer (props magenta, road blue, detail yellow, terrain cyan, actors orange) so holes and pale bands can be traced to a source |

## render-suite.js — batch sheets

```bash
node tools/render-suite.js tools/shots/suite --what=chapters   # 10 chapter environments
node tools/render-suite.js tools/shots/suite --what=bosses     # every chapter boss
node tools/render-suite.js tools/shots/suite --what=classes    # all 10 hero previews
node tools/render-suite.js tools/shots/suite --what=combat     # swings, hub dusk/night
node tools/render-suite.js tools/shots/suite --what=all
```

Writes one PNG per entry plus `suite.json` with per-entry timings and any failures.

## rig-check.js — animation/rig regression

```bash
node tools/rig-check.js
```

Draws all ten monster body archetypes, all ten hero classes and the seven hero animation states
through the painter with a real camera and counts the polygons each emits. A broken matrix emits
zero geometry, so this catches "invisible monster" bugs that a screenshot can miss.
Currently **27/27 rigs draw geometry**.

## gameflow-check.js — gameplay smoke test

```bash
node tools/gameflow-check.js
```

Boots the real game headlessly and drives the real systems: register, character creation, class
locks, stage unlock/start, attack damage through the real key path, skill cast, potion, battle
exit, every menu, save/reload and an arena bot duel. Currently **27/27 checks pass**
(register → character → stage → combat → targeting → AI → kill rewards → loot → death →
respawn → respawned monsters → save/reload → arena duel).

## render-perf.js — frame cost

```bash
node tools/render-perf.js                       # chapter 1, high quality
node tools/render-perf.js --stage=c8-5 --frames=120
node tools/render-perf.js --skip=terrain,detail --json
```

Reports median / p75 / p90 / max frame time, the per-section breakdown (sky, terrain, ground,
actors, flush, weather, labels, post) and a `fills/frame by layer` line (props, terrain, detail,
actors, road) for spotting hot layers. The 3D renderer is a software rasteriser, so these numbers
are a CPU-only baseline: a real browser with a GPU-backed canvas is several times faster.

Current baseline in the hub village: ≈21 ms median / p75 24 ms; chapter-1 battle: ≈23 ms median;
chapter-8 boss ≈24 ms (960×540, high quality, `--frames=60`). The p90/max figures include V8 GC pauses; the
section breakdown excludes them.

## scale-check.js — world & character proportions

`node tools/scale-check.js` boots the game headlessly, hides the name plates, and measures the
hero, four monster archetypes and ten village/world props straight from rendered frames (a
two-frame diff of the live subject against the same scene with the subject hidden, so background
props cancel out). Sizes are averaged over the hub and four chapters, then reported as
hero-heights against a target band. Exit code is non-zero when a band fails.

```bash
node tools/scale-check.js                 # table of 14 proportions
node tools/scale-check.js --json          # machine-readable
node tools/scale-check.js --shot=/tmp/d   # write the diff masks it measures from
```

Current build: **14/14 in band** — hero 22 u, house 2.0 hero-heights, conifer 2.8, broadleaf 2.6,
market stall 0.76, fence 0.39, lantern 0.75, well 1.04, NPC 0.94, road 2.7, goblin 0.68,
wolf 0.69, elite 0.95, boss 1.74.

## Notes

- `tools/lib/inline.js` — inlines `index.html` for jsdom.
- `tools/lib/harness.js` — the shared harness: boot, sign-in, hero creation, stage unlocks, scene
  entry with retries, frame pumping, screenshots, stats and the section profiler.
- Attacks are driven through the real input path (a `Space` keydown/keyup on `document`), the same
  way a player plays — `Game.playerAttack()` is not a supported entry point from outside the loop.
- `tools/shots/` output is disposable; keep it out of commits.

## build-standalone.js — the offline single-file build

`node tools/build-standalone.js` inlines every stylesheet and script into
`mythara-standalone.html` in the repository root (~880 KB). Double-click that file and the game
runs with no server, no network and no CDN — useful when a preview host is unavailable.

## standalone-check.js — does the single-file build run?

`node tools/standalone-check.js` boots the generated file with the same jsdom + Skia canvas rig
the other suites use and asserts it reaches the hub: no external `<script src>`, no external
stylesheet links, the game/3D/world/account namespaces booted, the auth screen on screen, a hero
created, the hub scene started and **zero boot errors**. Currently 11/11.

## movement-check.js — how the hero moves

`node tools/movement-check.js` boots the hub and checks movement the way a player experiences it:
all four keyboard directions, traversal pace, the on-screen D-pad (real `pointerdown`/`pointerup`),
the walk from the battlefield north into Silverstone, solid buildings, the walkable bounds and
free-roam knock-down/revive. Currently **13/13**.

```bash
node tools/movement-check.js          # 13 checks
node tools/movement-check.js --json
```

Tuning that keeps it passing (v0.7.1):

| Knob | Where | Why |
| --- | --- | --- |
| `CONFIG.world.floorTop` (150) | `data.js` | north edge of the walkable band — the plaza, market row, blacksmith, well and NPCs sit between z=180 and z=320, so the hero can walk up into the village |
| `BLOCKER_RADIUS` | `js/render3d-world.js` | circle radii of solid props; a 40x30 home blocks 17 units, a 26x18 stall 9.5, barrels/crates/benches 2.6-3.4 |
| class `speed` (96-152) | `data.js` | world units per second. The playfield never shrank, so these are the original pre-rescale values |
| plaza furniture lanes | `js/render3d-world.js` | barrels/crates/benches keep clear of the four approach lanes so the square is walkable from any side |

Keyboard input needs the frame to have focus: clicking the world focuses the canvas
(`focusGame()`), and a one-time toast nudges first-time players in embedded previews.
