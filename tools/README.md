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

Current baseline in the hub village: ≈28 ms median / p90 49 ms; chapter-1 battle: ≈27 ms median /
p90 67 ms (960×540, high quality, `--frames=60`). The p90/max figures include V8 GC pauses; the
section breakdown excludes them.

## Notes

- `tools/lib/inline.js` — inlines `index.html` for jsdom.
- `tools/lib/harness.js` — the shared harness: boot, sign-in, hero creation, stage unlocks, scene
  entry with retries, frame pumping, screenshots, stats and the section profiler.
- Attacks are driven through the real input path (a `Space` keydown/keyup on `document`), the same
  way a player plays — `Game.playerAttack()` is not a supported entry point from outside the loop.
- `tools/shots/` output is disposable; keep it out of commits.
