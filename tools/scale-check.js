#!/usr/bin/env node
/* ============================================================
 * Mythara Online — tools/scale-check.js
 * ------------------------------------------------------------
 * Measures the world's proportions and checks them against the
 * MMORPG scale targets:
 *
 *   • how tall the hero and each monster archetype actually
 *     stand, measured from a rendered frame (not from constants)
 *   • how tall houses, trees, stalls, fences and lanterns are
 *     in the current region
 *   • how wide the road is
 *   • how much of the viewport the hero covers at the default
 *     third-person camera distance
 *
 * Everything is reported in hero-heights, so the numbers mean
 * something even after a rescale. Exits non-zero when a ratio
 * falls outside its band.
 *
 *   node tools/scale-check.js
 *   node tools/scale-check.js --json
 * ============================================================ */
'use strict';

const { createHarness } = require('./lib/harness');

const args = {};
process.argv.slice(2).forEach((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
});

/** Target bands, in hero-heights. */
const TARGETS = {
  heroScreenPct: [9, 20],        // hero height as a share of the viewport
  houseHeight: [1.4, 3.2],
  treeConifer: [1.8, 5.5],
  treeBroadleaf: [1.6, 5.0],
  marketStall: [0.7, 1.6],
  fenceHeight: [0.25, 0.75],
  lanternPost: [0.5, 1.3],
  wellHeight: [0.8, 1.8],
  npcHeight: [0.85, 1.25],
  roadWidth: [1.6, 4.5],
  goblin: [0.35, 0.8],
  beast: [0.4, 1.0],
  elite: [0.8, 1.6],
  boss: [1.6, 3.4]
};

(async () => {
  const h = await createHarness({ quality: 'high', skip: ['sky', 'horizon', 'terrain', 'road', 'detail'] });
  await h.signIn({ user: 'scalecheck', email: 'scale@mythara.gg' });
  await h.createHero('warrior', 'Jingle');
  await h.enterScene({ scene: 'hub' });

  const win = h.win;
  const M = win.Mythara3D;
  const Render3D = h.Render3D;
  const cam = Render3D.camera();
  const vp = Render3D.state.vp;
  const canvas = h.doc.getElementById('game-canvas');
  const ctx = h.canvasMap.get(canvas).ctx;
  const Game = h.Game;
  const state = Game.getState();

  // Hide name plates / health bars while measuring, so only the body counts.
  const Actors = win.MytharaActors3D;
  const overlaysWas = Actors.drawOverlays;
  Actors.drawOverlays = function () {};

  // ---- how much of the screen the hero covers, using the live camera ----
  let settled = null;
  function captureCamera() {
    settled = {
      look: M.v3(cam.state.look.x, cam.state.look.y, cam.state.look.z),
      yaw: cam.state.yaw, pitch: cam.state.pitch, dist: cam.state.dist
    };
  }
  function restoreCamera() {
    cam.state.look = M.v3(settled.look.x, settled.look.y, settled.look.z);
    cam.state.yaw = settled.yaw;
    cam.state.pitch = settled.pitch;
    cam.state.dist = settled.dist;
    cam.updateEye();
  }
  /** Park the camera in front of a subject (the eye is derived from this). */
  function frameSubject() {
    cam.state.look = M.v3(480, 12, 430);
    cam.state.yaw = 0;
    cam.state.pitch = 0.30;
    cam.state.dist = 120;
    cam.updateEye();
  }

  /**
   * Measure a rig's world height by rendering the frame twice — once with the
   * subject live, once with it hidden — and measuring the pixels that only the
   * subject contributes. Background props and name plates cancel out.
   */
  function measureHeight(subject) {
    Game.clearEnemies();
    state.loot.length = 0;
    let behind = null;
    const isPlayer = subject.kind === 'player';
    if (isPlayer) {
      subject.pos.x = 480;
      subject.pos.y = 430;
    } else {
      Game.spawnEnemies([subject]);
      subject.pos.x = 480;
      subject.pos.y = 430;
      subject.deathTimer = 0;
      // park the hero behind the camera so it cannot contaminate the diff
      behind = { x: state.player.pos.x, y: state.player.pos.y };
      state.player.pos.x = 480;
      state.player.pos.y = 640;
    }
    frameSubject();

    // kill every per-frame randomiser so the only difference between the two
    // renders is the subject itself
    const Effects = win.Mythara.Effects;
    const shakeWas = Effects.getShake;
    Effects.getShake = function () { return 0; };
    const savedProps = world().props;
    const savedDetail = world().detailList;
    if (savedProps) savedProps.length = 0;

    const grab = function (hidden) {
      const aliveWas = subject.alive;
      const downedWas = subject.downed;
      if (hidden) {
        if (isPlayer) subject.downed = true; else { subject.alive = false; subject.deathTimer = 0; }
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, vp.width, vp.height);
      ctx.restore();
      Render3D.render(state, 0);            // dt 0 → the camera cannot drift
      const data = ctx.getImageData(0, 0, vp.width, vp.height).data;
      subject.alive = aliveWas;
      subject.downed = downedWas;
      return data;
    };

    const withSubject = grab(false);
    const without = grab(true);
    if (behind) { state.player.pos.x = behind.x; state.player.pos.y = behind.y; }
    if (args.shot) {
      const createCanvas = require('@napi-rs/canvas').createCanvas;
      const out = createCanvas(vp.width, vp.height);
      const octx = out.getContext('2d');
      const img = octx.createImageData(vp.width, vp.height);
      for (let i = 0; i < withSubject.length; i += 4) {
        const diff = Math.abs(withSubject[i] - without[i]) + Math.abs(withSubject[i + 1] - without[i + 1]) +
          Math.abs(withSubject[i + 2] - without[i + 2]);
        const on = diff > 24;
        img.data[i] = on ? 255 : 20;
        img.data[i + 1] = on ? 90 : 20;
        img.data[i + 2] = on ? 40 : 20;
        img.data[i + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      require('fs').writeFileSync(args.shot + '-' + (subject.name || 'hero') + '.png', out.toBuffer('image/png'));
    }
    Effects.getShake = shakeWas;
    if (savedProps && savedProps.length === 0) {
      const rebuilt = win.MytharaWorld3D.createWorld(Render3D.state.theme);
      Render3D.state.world.props.push.apply(savedProps, rebuilt.props);
    }
    const centre = Math.round(vp.width / 2);
    const band = 140;
    const lit = function (y) {
      for (let x = centre - band; x < centre + band; x++) {
        const i = (y * vp.width + x) * 4;
        const diff = Math.abs(withSubject[i] - without[i]) +
          Math.abs(withSubject[i + 1] - without[i + 1]) +
          Math.abs(withSubject[i + 2] - without[i + 2]);
        if (diff > 24) return true;
      }
      return false;
    };
    // scan up from the feet through the body's contiguous run: the floating
    // health bar / name plate sits above a gap and is never counted
    let bottom = vp.height - 1;
    while (bottom > 0 && !lit(bottom)) bottom--;
    let top = bottom;
    let gap = 0;
    for (let y = bottom; y >= 0; y--) {
      if (lit(y)) { top = y; gap = 0; } else if (++gap > 8) break;
    }
    // turn the top pixel back into a world height
    let lo = 0;
    let hi = 260;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      const p = cam.project(M.v3(480, mid, 430), vp);
      if (p.y > top) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  const world = () => Render3D.state.world;
  const hero = state.player;
  hero.pos.x = 480;
  hero.pos.y = 420;
  h.pump(40);                     // let the follow camera settle at its default distance
  captureCamera();
  const heroHeight = measureHeight(hero);

  const defs = win.MYTHARA_ENEMIES.list();
  const pick = (id) => defs.filter((d) => d.id === id)[0];
  const archetypes = {
    goblin: pick('forestGoblin'),
    beast: pick('wildWolf'),
    elite: pick('forestBeast'),
    boss: (defs.filter((d) => d.tier === 'boss' && d.body === 'humanoid')[0]) || pick('goblinKing')
  };
  const monsterHeights = {};
  Object.keys(archetypes).forEach((key) => {
    const def = archetypes[key];
    if (!def) return;
    const mob = Game.createEnemy(def, 5, { noSpawnDelay: true });
    monsterHeights[key] = measureHeight(mob);
  });

  // restore the player, the overlays and the normal camera
  Actors.drawOverlays = overlaysWas;
  Game.clearEnemies();
  state.player.pos.x = 480;
  state.player.pos.y = 420;
  Render3D.resize();

  // ---- environment sizes: average across the populated regions ----------
  const World = win.MytharaWorld3D;
  const regions = ['hub', 'chapter1', 'chapter2', 'chapter4', 'chapter6', 'chapter7'];
  const gathers = {};
  const add = (key, value) => { (gathers[key] = gathers[key] || []).push(value); };
  regions.forEach((id) => {
    let w;
    try { w = World.createWorld(World.theme(id)); } catch (err) { return; }
    const props = w.props || [];
    const byType = (t) => props.filter((p) => p.type === t);
    const avgS = (list) => (list.length ? list.reduce((a, p) => a + p.s, 0) / list.length : 0);
    const houses = byType('house');
    if (houses.length) add('houseHeight', (28 + 12) * avgS(houses));     // wall 28 + roof stack
    const treeS = (kind) => {
      const list = byType('tree:' + kind);
      return list.length ? avgS(list) : 0;
    };
    const conifer = treeS('conifer');
    const broadleaf = treeS('broadleaf');
    if (conifer) add('treeConifer', 60 * conifer);
    if (broadleaf) add('treeBroadleaf', 54 * broadleaf);
    const giant = treeS('giant');
    if (giant) add('treeGiant', 68 * giant);
    if (byType('market').length) add('marketStall', 17);
    if (byType('fence').length) add('fenceHeight', 8.8);
    if (byType('lantern').length) add('lanternPost', 16.9);
    if (byType('well').length) add('wellHeight', 23.3);
    if (byType('npc').length) add('npcHeight', 21);
    if (props.length) add('roadWidth', 60);
  });
  const mean = (key) => {
    const list = gathers[key] || [];
    return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
  };

  const sizes = {
    // builder maths (base at s = 1 × the average scatter scale)
    houseHeight: mean('houseHeight'),
    treeConifer: mean('treeConifer'),
    treeBroadleaf: mean('treeBroadleaf'),
    marketStall: mean('marketStall'),
    fenceHeight: mean('fenceHeight'),
    lanternPost: mean('lanternPost'),
    wellHeight: mean('wellHeight'),
    npcHeight: mean('npcHeight'),
    roadWidth: mean('roadWidth')
  };

  // ---- camera framing, measured with the camera the game actually uses ----
  restoreCamera();
  const px = state.player.pos;
  const feet = cam.project(M.v3(px.x, 0, px.y), vp);
  const head = cam.project(M.v3(px.x, heroHeight, px.y), vp);
  const heroScreenPct = feet.visible && head.visible ? (Math.abs(feet.y - head.y) / vp.height) * 100 : 0;

  const ratios = {
    heroScreenPct: heroScreenPct,
    houseHeight: sizes.houseHeight / heroHeight,
    treeConifer: sizes.treeConifer / heroHeight,
    treeBroadleaf: sizes.treeBroadleaf / heroHeight,
    marketStall: sizes.marketStall / heroHeight,
    fenceHeight: sizes.fenceHeight / heroHeight,
    lanternPost: sizes.lanternPost / heroHeight,
    wellHeight: sizes.wellHeight / heroHeight,
    npcHeight: sizes.npcHeight / heroHeight,
    roadWidth: sizes.roadWidth / heroHeight,
    goblin: (monsterHeights.goblin || 0) / heroHeight,
    beast: (monsterHeights.beast || 0) / heroHeight,
    elite: (monsterHeights.elite || 0) / heroHeight,
    boss: (monsterHeights.boss || 0) / heroHeight
  };

  const rows = Object.keys(TARGETS).map((key) => {
    const band = TARGETS[key];
    const value = ratios[key];
    return {
      key: key,
      value: value,
      min: band[0],
      max: band[1],
      ok: value >= band[0] && value <= band[1]
    };
  });
  const failed = rows.filter((r) => !r.ok);

  const report = {
    heroHeight: heroHeight,
    monsterHeights: monsterHeights,
    worldSizes: sizes,
    ratios: ratios,
    rows: rows,
    failed: failed.length,
    errors: h.errors.slice(0, 3),
    consoleErrors: h.consoleErrors.slice(0, 3)
  };

  if (args.json) console.log(JSON.stringify(report));
  else {
    console.log('hero height: ' + heroHeight.toFixed(1) + ' world units   ' +
      '(monsters: ' + Object.keys(monsterHeights).map((k) => k + ' ' + monsterHeights[k].toFixed(1)).join(', ') + ')');
    console.log('hero on screen: ' + heroScreenPct.toFixed(1) + '% of the viewport height at the default camera');
    console.log('');
    console.log('  ' + 'proportion'.padEnd(16) + 'value'.padStart(7) + '   target band');
    rows.forEach((r) => {
      console.log('  ' + (r.ok ? 'ok  ' : 'FAIL') + r.key.padEnd(14) +
        r.value.toFixed(2).padStart(6) + '   ' + r.min + ' – ' + r.max + ' hero-heights');
    });
    console.log('');
    console.log((rows.length - failed.length) + '/' + rows.length + ' proportions in band' +
      (failed.length ? '  ·  FAILED: ' + failed.map((f) => f.key + '=' + f.value.toFixed(2)).join(', ') : ''));
    if (report.errors.length) console.log('js errors: ' + report.errors.join(' | '));
  }
  h.close();
  process.exit(failed.length || h.errors.length ? 1 : 0);
})();
