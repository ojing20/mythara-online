#!/usr/bin/env node
/* ============================================================
 * Mythara Online — tools/render-suite.js
 * ------------------------------------------------------------
 * Batch render suites used to review the whole presentation layer:
 *
 *   node tools/render-suite.js shots/suite --what=chapters   # all 10 chapters
 *   node tools/render-suite.js shots/suite --what=classes    # all 10 heroes
 *   node tools/render-suite.js shots/suite --what=bosses     # every chapter boss
 *   node tools/render-suite.js shots/suite --what=combat     # swings + skills
 *   node tools/render-suite.js shots/suite --what=all
 *
 * Each run writes one PNG per entry plus a JSON summary.
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { createHarness } = require('./lib/harness');

const args = {};
process.argv.slice(2).forEach((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
});
const positional = process.argv.slice(2).filter((a) => a.charAt(0) !== '-')[0];
const OUT = path.resolve(args.out || positional || 'tools/shots/suite');
const WHAT = args.what || 'all';
const CLASSES = ['warrior', 'archer', 'fireMage', 'iceMage', 'assassin', 'paladin', 'priest', 'berserker', 'ninja', 'dragonKnight'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const h = await createHarness({ quality: args.quality || 'high' });
  const results = [];

  await h.signIn({ user: 'suite', email: 'suite@mythara.gg' });
  await h.createHero('warrior', 'Jingle');

  const run = async (name, fn) => {
    const t0 = Date.now();
    const record = { name: name, ok: true };
    try {
      await fn(record);                       // suites can attach extra detail
      record.ms = Date.now() - t0;
      results.push(record);
    } catch (e) {
      record.ok = false;
      record.error = e.stack;
      record.ms = Date.now() - t0;
      results.push(record);
      console.error('FAIL ' + name + ': ' + e.message);
    }
  };

  const shoot = (name) => h.shot(path.join(OUT, name + '.png'));

  if (WHAT === 'chapters' || WHAT === 'all') {
    for (let chapter = 1; chapter <= 10; chapter++) {
      await run('chapter' + chapter, async () => {
        const stage = 'c' + chapter + '-1';
        h.unlockThrough(stage);
        if (!(await h.enterScene({ scene: 'battle', stage: stage }))) throw new Error('scene did not start');
        h.pump(24);
        shoot('chapter' + chapter);
      });
    }
  }

  if (WHAT === 'bosses' || WHAT === 'all') {
    for (let chapter = 1; chapter <= 10; chapter++) {
      await run('boss-c' + chapter, async () => {
        const stage = 'c' + chapter + '-5';
        h.unlockThrough(stage);
        if (!(await h.enterScene({ scene: 'boss', stage: stage }))) throw new Error('scene did not start');
        h.pump(30);
        if (h.Game.state.monsters && h.Game.state.monsters.length) h.attack();
        h.pump(14);
        shoot('boss-c' + chapter);
      });
    }
  }

  if (WHAT === 'classes' || WHAT === 'all') {
    for (let i = 0; i < CLASSES.length; i++) {
      const classId = CLASSES[i];
      await run('class-' + classId, async () => {
        const preview = h.doc.getElementById('preview-canvas');
        if (!preview) throw new Error('preview canvas missing');
        const cls = h.win.Mythara.DATA.getClass(classId);
        h.Render3D.drawPreviewHero(h.canvasMap.get(preview).ctx, preview, cls, 1.1);
        h.shotElement('preview-canvas', path.join(OUT, 'class-' + classId + '.png'));
      });
    }
  }

  if (WHAT === 'anim' || WHAT === 'all') {
    // Every hero animation state, driven through the real input path and the
    // engine's own Anim system. Movement states come from actually walking:
    // free mode → 'run', stage mode → 'walk' (the engine picks the state).
    const Anim = h.Game.Anim;
    const hold = () => { h.key('KeyD'); };
    const release = () => { h.key('KeyD', false); h.key('KeyA', false); h.key('KeyW', false); h.key('KeyS', false); };
    const states = [
      { name: 'idle', frames: 16, setup: () => { release(); h.Game.setMode('free'); Anim.set(h.Game.state.player, 'idle'); } },
      { name: 'walk', frames: 16, setup: () => { h.Game.setMode('stage'); hold(); } },
      { name: 'run', frames: 16, setup: () => { h.Game.setMode('free'); hold(); } },
      { name: 'attack', frames: 6, setup: () => { release(); h.Game.setMode('free'); h.attack(); h.key('Space', false); } },
      { name: 'skill', frames: 8, setup: () => { release(); Anim.set(h.Game.state.player, 'skill', { durationMs: 720 }); h.Game.state.player.attackAnim = 0.7; } },
      { name: 'hit', frames: 5, setup: () => { release(); Anim.set(h.Game.state.player, 'hurt'); h.Game.state.player.hitFlash = 0.85; } },
      { name: 'death', frames: 50, setup: () => { release(); h.Game.state.player.alive = false; h.Game.state.player.deathTimer = 1400; Anim.set(h.Game.state.player, 'death'); } }
    ];
    await run('anim-states', async (record) => {
      if (!(await h.enterScene({ scene: 'hub' }))) throw new Error('hub did not start');
      h.Game.clearEnemies && h.Game.clearEnemies();   // no plates/rings in the way
      h.Render3D.state.manualZoom = true;             // hold the close framing
      h.Render3D.camera().state.dist = 88;
      h.Render3D.camera().state.pitch = 0.2;
      h.Render3D.camera().state.yaw = Math.PI * 0.8;  // three-quarter front view
      h.Render3D.camera().state.desiredYaw = Math.PI * 0.8;

      const signatures = {};
      for (let i = 0; i < states.length; i++) {
        const st = states[i];
        st.setup();
        h.pump(st.frames);
        h.Render3D.camera().follow(h.Game.state.player, 1, { facing: h.Game.state.player.facing, lift: 22 });
        h.pump(2);
        signatures[st.name] = h.signature();
        shoot('anim-' + st.name);
      }
      release();

      // every state must actually look different from the others: compare the
      // per-cell luminance and count cells that moved
      const names = Object.keys(signatures);
      const collisions = [];
      const pairs = [];
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const a = signatures[names[i]], b = signatures[names[j]];
          let changed = 0, total = 0;
          for (let k = 0; k < a.length; k++) {
            const d = Math.abs(a[k] - b[k]);
            total += d;
            if (d > 1.5) changed++;
          }
          const mean = total / a.length;
          pairs.push(names[i] + '/' + names[j] + ' Δ' + mean.toFixed(2) + ' cells' + changed);
          if (mean < 0.05 || changed < 3) collisions.push(names[i] + '≈' + names[j]);
        }
      }
      record.pairs = pairs;
      record.distinct = names.length + ' states visually distinct';
      if (collisions.length) throw new Error('animation states render identically: ' + collisions.join(', ') + ' | ' + pairs.join(' '));

      // restore the hero for the remaining suites
      h.Render3D.state.manualZoom = false;
      h.Game.setMode('free');
      h.Game.state.player.alive = true;
      h.Game.state.player.deathTimer = 0;
      Anim.set(h.Game.state.player, 'idle');
    });
  }

  if (WHAT === 'camera' || WHAT === 'all') {
    // Camera requirement: third-person follow, mouse rotate, wheel zoom,
    // touch drag, lock-on — all through the real DOM event paths.
    await run('camera-controls', async (record) => {
      if (!(await h.enterScene({ scene: 'battle', stage: 'c1-1' }))) throw new Error('stage did not start');
      h.pump(20);
      const cam = h.Render3D.camera();
      const canvas = h.doc.getElementById('game-canvas');
      const hero = h.Game.state.player;
      const checks = {};

      // follow: the camera eye stays behind/above the hero and tracks it
      const before = { x: cam.state.eye.x, z: cam.state.eye.z };
      h.move('right'); h.pump(30); h.move('right', false); h.pump(6);
      const heroMoved = Math.abs(hero.pos.x - 320) > 20;
      const camMoved = Math.abs(cam.state.eye.x - before.x) > 10 || Math.abs(cam.state.eye.z - before.z) > 10;
      checks.follows = heroMoved && camMoved;
      // third-person: the eye sits behind the hero relative to its facing
      const toEye = { x: cam.state.eye.x - hero.pos.x, z: cam.state.eye.z - hero.pos.y };
      const facingLen = Math.hypot(hero.facing.x, hero.facing.y) || 1;
      checks.behind = (toEye.x * hero.facing.x + toEye.z * hero.facing.y) / facingLen < -10;

      // mouse drag rotates the camera (read straight after the event: the
      // chase camera deliberately eases back toward the hero over ~2.4 s)
      const yaw0 = cam.state.yaw;
      canvas.dispatchEvent(new h.win.MouseEvent('mousedown', { clientX: 400, clientY: 300, bubbles: true }));
      h.win.dispatchEvent(new h.win.MouseEvent('mousemove', { clientX: 520, clientY: 300, bubbles: true }));
      const mouseDelta = Math.abs(cam.state.yaw - yaw0);
      h.win.dispatchEvent(new h.win.MouseEvent('mouseup', { bubbles: true }));
      checks.mouseRotate = mouseDelta > 0.05;

      // Q / E rotate on the keyboard too
      const yaw1 = cam.state.yaw;
      h.key('KeyQ'); h.key('KeyQ', false);
      checks.keyRotate = Math.abs(cam.state.yaw - yaw1) > 0.05;
      checks.rotationHolds = cam.state.manualHold > 0;      // input holds the yaw briefly

      // wheel zooms in and out
      const dist0 = cam.state.dist;
      canvas.dispatchEvent(new h.win.WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
      h.pump(6);
      const distOut = cam.state.dist;
      canvas.dispatchEvent(new h.win.WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
      h.pump(6);
      const distIn = cam.state.dist;
      checks.zoomOut = distOut > dist0 + 1;
      checks.zoomIn = distIn < distOut - 1;
      checks.manualZoomFlag = h.Render3D.state.manualZoom === true;

      // touch drag rotates
      const yaw2 = cam.state.yaw;
      canvas.dispatchEvent(new h.win.TouchEvent('touchstart', { touches: [{ clientX: 400, clientY: 300 }], bubbles: true }));
      canvas.dispatchEvent(new h.win.TouchEvent('touchmove', { touches: [{ clientX: 300, clientY: 300 }], bubbles: true, cancelable: true }));
      canvas.dispatchEvent(new h.win.TouchEvent('touchend', { bubbles: true }));
      checks.touchRotate = Math.abs(cam.state.yaw - yaw2) > 0.05;

      // lock-on targets the nearest enemy and actually faces it
      h.Render3D.camera().state.dist = 150;
      h.Render3D.state.manualZoom = false;
      h.Render3D.setLock(false);
      h.pump(4);
      const noLockYaw = cam.state.yaw;
      h.Render3D.setLock(true);
      h.Game.teleportPlayer(380, 420);
      h.pump(40);
      const target = h.Render3D.state.lockTarget;
      checks.lockTargetFound = !!target;
      checks.lockCamTurned = Math.abs(cam.state.yaw - noLockYaw) > 0.05;
      if (target) {
        // camera sits behind the hero looking at the target, i.e. the camera
        // yaw points from the target toward the hero
        const want = Math.atan2(-(target.pos.x - hero.pos.x), -(target.pos.y - hero.pos.y));
        const wrap = (v) => Math.abs(((v % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
        checks.lockFacesTarget = wrap(cam.state.yaw - want) < 0.45;
        checks.lockDesiredMatches = wrap(cam.state.desiredYaw - want) < 0.2;
      }
      shoot('camera-lockon');

      const failed = Object.keys(checks).filter((k) => !checks[k]);
      record.checks = checks;
      if (failed.length) throw new Error('camera checks failed: ' + failed.join(', ') + ' ' + JSON.stringify(checks));
    });
  }

  if (WHAT === 'combat' || WHAT === 'all') {
    await run('combat-swings', async () => {
      h.unlockThrough('c1-2');
      if (!(await h.enterScene({ scene: 'battle', stage: 'c1-2' }))) throw new Error('scene did not start');
      h.pump(18);
      for (let i = 0; i < 5; i++) {
        h.attack();
        h.pump(3);
        shoot('combat-swing' + i);
        h.pump(6);
      }
    });
    await run('hub-dusk', async () => {
      if (!(await h.enterScene({ scene: 'hub' }))) throw new Error('hub did not start');
      h.setTime(0.78);
      h.pump(26);
      shoot('hub-dusk');
    });
    await run('hub-night', async () => {
      h.setTime(0.94);
      h.pump(26);
      shoot('hub-night');
    });
  }

  fs.writeFileSync(path.join(OUT, 'suite.json'), JSON.stringify({
    what: WHAT,
    quality: args.quality || 'high',
    results: results,
    summary: h.summary()
  }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(JSON.stringify({ what: WHAT, out: OUT, ran: results.length, failed: failed, summary: h.summary() }, null, 2));
  h.close();
  process.exit(failed ? 1 : 0);
})();
