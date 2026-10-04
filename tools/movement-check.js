/* ============================================================
 * Mythara Online — tools/movement-check.js
 * ------------------------------------------------------------
 * Regression suite for how the hero moves: keyboard, the on-screen
 * D-pad, camera-independent direction mapping, solid buildings and
 * the walk from the battlefield up into Silverstone village.
 *
 *   node tools/movement-check.js
 *   node tools/movement-check.js --json
 * ============================================================ */
'use strict';

const { createHarness } = require('./lib/harness.js');

const args = {};
process.argv.slice(2).forEach(function (a) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
});

const results = [];
function check(name, ok, note) {
  results.push({ name: name, ok: !!ok, note: note === undefined ? '' : String(note) });
}

(async function main() {
  const h = await createHarness({ quality: 'high', width: 960, height: 540 });
  const win = h.win;
  await h.signIn('movement@test.dev');
  await h.createHero('warrior', 'Jingle');
  await h.unlockThrough(1);
  await h.enterScene('hub');
  h.Game.clearEnemies();
  h.pump(6);

  const S = h.Game.state;
  const world = h.Render3D.state.world;
  const p = S.player;
  const dist = (x, z) => Math.hypot(p.pos.x - x, p.pos.y - z);
  const walk = (dir, frames) => { h.move(dir, true); h.pump(frames); h.move(dir, false); h.pump(2); };
  const place = (x, z) => {
    h.Game.clearEnemies();
    p.pos.x = x; p.pos.y = z; h.pump(3);
  };

  // --- 1. keyboard drives all four directions -----------------------------
  place(480, 400);
  const x0 = p.pos.x, y0 = p.pos.y;
  walk('up', 30);    const north = y0 - p.pos.y;
  place(480, 400);   walk('down', 30);   const south = p.pos.y - y0;
  place(480, 400);   walk('left', 30);   const west = x0 - p.pos.x;
  place(480, 400);   walk('right', 30);  const east = p.pos.x - x0;
  check('W moves north', north > 20, north.toFixed(0) + 'u');
  check('S moves south', south > 20, south.toFixed(0) + 'u');
  check('A moves west', west > 20, west.toFixed(0) + 'u');
  check('D moves east', east > 20, east.toFixed(0) + 'u');

  // --- 2. traversal speed (the field never shrank, so pace must not either)
  place(480, 460);
  const t0 = p.pos.y;
  walk('up', 60);                       // 1 second at 60fps
  const perSecond = (t0 - p.pos.y) / 1;
  check('crosses ground at the pre-rescale pace', perSecond > 80 && perSecond < 140, perSecond.toFixed(0) + ' u/s');

  // --- 3. the on-screen D-pad ---------------------------------------------
  const btn = h.doc.querySelector('[data-dir="up"]');
  place(320, 460);
  const beforePad = p.pos.y;
  if (btn) {
    const down = new win.Event('pointerdown', { bubbles: true, cancelable: true });
    down.pointerId = 7; btn.dispatchEvent(down);
    h.pump(30);
    const up = new win.Event('pointerup', { bubbles: true, cancelable: true });
    up.pointerId = 7; btn.dispatchEvent(up);
  }
  check('D-pad walks the hero', !!btn && beforePad - p.pos.y > 20, (beforePad - p.pos.y).toFixed(0) + 'u');

  // --- 4. the village is reachable ----------------------------------------
  place(480, 480);
  walk('up', 200);
  check('can walk from the field into the village', p.pos.y < 260, 'reached z=' + p.pos.y.toFixed(0));
  place(480, 240); walk('up', 40);
  check('reaches the plaza fountain', dist(480, 214) < 40, dist(480, 214).toFixed(0) + 'u from it');

  // --- 5. buildings are solid ---------------------------------------------
  const house = world.props.filter((q) => q.type === 'house').sort((a, b) => b.z - a.z)[0];
  const stall = world.props.filter((q) => q.type === 'market')[0];
  place(house.x, house.z + 60);
  walk('up', 90);
  const houseGap = Math.hypot(p.pos.x - house.x, p.pos.y - house.z);
  check('cannot walk through a house', houseGap > 20, houseGap.toFixed(0) + 'u from its centre');
  if (stall) {
    place(stall.x, stall.z + 60);
    walk('up', 90);
    const stallGap = Math.hypot(p.pos.x - stall.x, p.pos.y - stall.z);
    check('cannot walk through a stall', stallGap > 14, stallGap.toFixed(0) + 'u from its centre');
  }

  // --- 6. never leaves the walkable band ----------------------------------
  place(480, 400);
  walk('up', 600);
  const northLimit = p.pos.y;
  place(480, 165);                     // start at the very top of the band
  walk('up', 90);
  const clampedNorth = p.pos.y;
  place(60, 400); walk('left', 200);
  const westLimit = p.pos.x;
  check('never walks out of the world to the north', northLimit >= 150 && clampedNorth >= 150,
    'walked to z=' + clampedNorth.toFixed(0) + ', bound is 150');
  check('stays inside the world to the west', westLimit >= 34 && westLimit <= 40, 'x=' + westLimit.toFixed(0));

  // --- 7. movement survives a knock-down and respawn ----------------------
  // Free roam is the mode with the auto-revive path (adventure stages hand
  // death to the battle system instead), so exercise it explicitly.
  h.Game.setMode('free');
  place(480, 400);
  p.hp = 1;
  h.Game.clearEnemies();
  const goblinDef = win.MYTHARA_ENEMIES.list().filter((d) => d.id === 'forestGoblin')[0];
  const goblin = h.Game.createEnemy(goblinDef, 3, { spawn: { x: 480, y: 385 } });
  h.Game.spawnEnemies([goblin]);
  const m = h.Game.state.monsters[0];
  m.pos.x = 480; m.pos.y = 385; m.aggro = true;
  p.hp = 1;
  for (let i = 0; i < 240 && !p.downed; i++) h.pump(2);
  const wasDowned = p.downed;
  for (let i = 0; i < 240 && p.downed; i++) h.pump(2);
  h.Game.clearEnemies();
  h.pump(4);
  place(p.pos.x, p.pos.y);
  const beforeMove = p.pos.y;
  walk('up', 30);
  check('can still move after a knock-down', !p.downed && beforeMove - p.pos.y > 15,
    (wasDowned ? 'was downed, ' : '') + (beforeMove - p.pos.y).toFixed(0) + 'u');

  const failed = results.filter((r) => !r.ok);
  if (args.json) {
    console.log(JSON.stringify({ checks: results, passed: results.length - failed.length, failed: failed.length }, null, 2));
  } else {
    results.forEach(function (r) {
      console.log((r.ok ? '  ok   ' : '  FAIL ') + r.name.padEnd(44) + (r.note ? ' (' + r.note + ')' : ''));
    });
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' movement checks passed');
  }
  await h.close();
  process.exit(failed.length ? 1 : 0);
})().catch(function (err) { console.error(err); process.exit(1); });
