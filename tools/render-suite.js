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
    try {
      await fn();
      results.push({ name: name, ok: true, ms: Date.now() - t0 });
    } catch (e) {
      results.push({ name: name, ok: false, error: e.stack, ms: Date.now() - t0 });
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
