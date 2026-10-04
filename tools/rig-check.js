#!/usr/bin/env node
/* ============================================================
 * Mythara Online — tools/rig-check.js
 * ------------------------------------------------------------
 * Rig regression test. Draws every monster body archetype and
 * every hero class straight through the painter with a real camera
 * and counts the polygons each one emits. A rig that silently
 * produces NaN transforms (broken matrix maths) emits zero
 * geometry — exactly the kind of bug a screenshot can miss when
 * the name plate is all you see.
 *
 *   node tools/rig-check.js
 *   node tools/rig-check.js --json
 *
 * Exits non-zero if any archetype or class fails to draw.
 * ============================================================ */
'use strict';

const { createHarness } = require('./lib/harness');

const args = {};
process.argv.slice(2).forEach((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
});

const MIN_POLYS = 12;

(async () => {
  const h = await createHarness({ quality: 'low' });
  await h.signIn({ user: 'rigcheck', email: 'rig@mythara.gg' });
  await h.createHero('warrior', 'Jingle');

  const win = h.win;
  const M = win.Mythara3D;
  const Actors = win.MytharaActors3D;
  const P = h.Render3D.painter;
  const ctx = h.canvasMap.get(h.doc.getElementById('game-canvas')).ctx;
  const vp = { width: 960, height: 540 };
  const light = M.Light.build({ skyTop: '#4a6fa8', skyBottom: '#bcd3ea', accent: '#f2c14e', fog: '#bccbdc', fogDensity: 0.0006 }, 0.36, null);

  const rows = [];

  /** Draw a rig with the camera parked in front of it and count polygons. */
  function measure(draw) {
    const cam = M.createCamera({ x: 480, y: 0, z: 400, yaw: 0, pitch: 0.3, dist: 120, fov: 46 });
    cam.state.look = M.v3(480, 16, 400);
    cam.state.eye = M.v3(480, 40, 510);
    cam.updateEye();
    P.begin(ctx, cam, vp, light, {});
    Actors.setGround(function () { return 0; });
    draw();
    P.flush();
    return P.state.stats.polys;
  }

  // --- every monster body archetype --------------------------------------
  const bodies = {};
  h.Enemies.list().forEach((e) => { if (!bodies[e.body]) bodies[e.body] = e; });
  Object.keys(bodies).forEach((body) => {
    const def = bodies[body];
    const polys = measure(function () {
      Actors.drawActor(P, {
        kind: 'monster', def: def, body: def.body, pos: { x: 480, y: 460 },
        facing: { x: 0, y: 1 }, scale: def.size || 1, radius: 16, alive: true, hp: 50, maxHp: 50,
        level: 5, name: def.name, walkPhase: 0, spawnPulse: 0,
        anim: { state: 'idle', t: 0.4, progress: 0.4, durationMs: 900 }
      }, { time: 1.2, equipment: {} });
    });
    rows.push({ kind: 'monster', name: body, sample: def.id, polys: polys });
  });

  // --- every hero class ---------------------------------------------------
  const classes = win.Mythara.DATA.CLASSES || win.Mythara.DATA.classes;
  Object.keys(classes).forEach((id) => {
    const cls = classes[id];
    const polys = measure(function () {
      Actors.drawHero(P, {
        kind: 'player', classId: id, look: cls.look, pos: { x: 480, y: 460 },
        facing: { x: 0, y: 1 }, walkPhase: 0, moving: false, running: false, radius: 16,
        spawnPulse: 0, anim: { state: 'idle', t: 0.4, progress: 0.4, durationMs: 900 }, equipment: {}
      }, { time: 1.2, equipment: {} });
    });
    rows.push({ kind: 'class', name: id, sample: cls.name, polys: polys });
  });

  // --- animation states on a representative rig ---------------------------
  const states = ['idle', 'walk', 'run', 'attack', 'skill', 'hurt', 'death'];
  states.forEach((state) => {
    const polys = measure(function () {
      Actors.drawHero(P, {
        kind: 'player', classId: 'warrior', pos: { x: 480, y: 460 }, facing: { x: 0, y: 1 },
        walkPhase: 1.4, moving: state === 'walk' || state === 'run', running: state === 'run',
        radius: 16, spawnPulse: 0, hp: state === 'death' ? 0 : 50, downed: state === 'death',
        anim: { state: state, t: 0.35, progress: 0.35, durationMs: 600 }
      }, { time: 1.2, equipment: {} });
    });
    rows.push({ kind: 'state', name: state, sample: 'warrior', polys: polys });
  });

  const failed = rows.filter((r) => r.polys < MIN_POLYS);
  const report = {
    checked: rows.length,
    failed: failed.length,
    rows: rows,
    errors: h.errors.slice(0, 3),
    consoleErrors: h.consoleErrors.slice(0, 3)
  };
  if (args.json) console.log(JSON.stringify(report));
  else {
    rows.forEach((r) => {
      const ok = r.polys >= MIN_POLYS;
      console.log('  ' + (ok ? 'ok  ' : 'FAIL') + ' ' + r.kind.padEnd(8) + r.name.padEnd(12) +
        String(r.polys).padStart(4) + ' polys   ' + r.sample);
    });
    console.log('\n' + (rows.length - failed.length) + '/' + rows.length + ' rigs draw geometry' +
      (failed.length ? '  ·  FAILED: ' + failed.map((f) => f.kind + ':' + f.name).join(', ') : ''));
    if (report.errors.length) console.log('js errors: ' + report.errors.join(' | '));
  }
  h.close();
  process.exit(failed.length || h.errors.length ? 1 : 0);
})();
