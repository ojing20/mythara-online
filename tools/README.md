# Mythara Online — development tools

These scripts render the game headlessly so the presentation layer can be reviewed without a
browser: they boot the real `index.html` (scripts + styles inlined), sign in through the real
forms, create a hero, enter a scene and write PNG frames.

They are **development tools only** — nothing here ships with the game, and the game itself keeps
its "no dependencies, no build step" rule.

## Requirements

The tools need two dev-only packages (declared in `tools/package.json`):

```bash
npm --prefix tools install          # jsdom + @napi-rs/canvas
# ...or install them anywhere and point NODE_PATH at it
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

## render-suite.js — batch sheets

```bash
node tools/render-suite.js tools/shots/suite --what=chapters   # 10 chapter environments
node tools/render-suite.js tools/shots/suite --what=bosses     # every chapter boss
node tools/render-suite.js tools/shots/suite --what=classes    # all 10 hero previews
node tools/render-suite.js tools/shots/suite --what=anim       # idle/walk/run/attack/skill/hit/death
node tools/render-suite.js tools/shots/suite --what=camera     # follow, rotate, zoom, lock-on
node tools/render-suite.js tools/shots/suite --what=combat     # swings, hub dusk/night
node tools/render-suite.js tools/shots/suite --what=all
```

Writes one PNG per entry plus `suite.json` with per-entry timings and any failures. The `anim`
suite compares coarse canvas signatures and fails if two animation states render identically; the
`camera` suite drives the real DOM event paths (mouse drag, touch drag, wheel, Q/E, R) and fails on
any camera regression (13 checks).

## gameflow-check.js — do the game systems still work?

```bash
node tools/gameflow-check.js              # 15 checks, exits non-zero on failure
```

Boots with the 3D layer enabled and drives the real flows: registration, character creation,
stage unlock rules, adventure battle, melee damage, skill hotbar, potion use, leaving a fight,
the app screens, save/reload and a bot arena duel.

## render-perf.js — frame cost

```bash
node tools/render-perf.js                       # chapter 1, high quality
node tools/render-perf.js --stage=c8-5 --frames=120
node tools/render-perf.js --skip=terrain,detail --json
```

Reports median / p75 / p90 / max frame time and the per-section breakdown (sky, terrain, ground,
actors, flush, weather, labels, post). The 3D renderer is a software rasteriser, so these numbers
are a CPU-only baseline: a real browser with a GPU-backed canvas is several times faster.

## Notes

- `tools/lib/inline.js` — inlines `index.html` for jsdom.
- `tools/lib/harness.js` — the shared harness: boot, sign-in, hero creation, stage unlocks, scene
  entry with retries, frame pumping, screenshots, stats and the section profiler.
- Attacks are driven through the real input path (a `Space` keydown/keyup on `document`), the same
  way a player plays — `Game.playerAttack()` is not a supported entry point from outside the loop.
- `tools/shots/` output is disposable; keep it out of commits.
