#!/usr/bin/env node
/* ============================================================
 * Mythara Online — tools/render-check.js
 * ------------------------------------------------------------
 * Renders one scene headlessly and writes PNG frames so the 3D
 * presentation can be inspected without a browser.
 *
 *   node tools/render-check.js shots/ --scene=battle --stage=c1-1 --frames=26
 *   node tools/render-check.js shots/ --scene=boss --stage=c8-5 --combat
 *   node tools/render-check.js shots/ --scene=hub  --class=fireMage --time=0.8
 *
 * Options
 *   --scene=hub|battle|boss|arena   scene to enter (default battle)
 *   --stage=cN-X                    adventure stage for battle/boss
 *   --arena=normal|hard|elite       arena difficulty
 *   --class=<classId>               hero class (warrior, fireMage, ...)
 *   --frames=N                      frames to pump before the last shot
 *   --combat                        press Space on the real input path
 *   --time=0..1                     time of day
 *   --quality=low|medium|high|auto
 *   --skip=a,b,c                    skip render sections (terrain, detail, ...)
 *   --no-clouds                     disable the cloud layer
 * ============================================================ */
'use strict';

const path = require('path');
const { createHarness } = require('./lib/harness');

const args = {};
process.argv.slice(2).forEach((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
});
const positional = process.argv.slice(2).filter((a) => a.charAt(0) !== '-')[0];
const OUT = path.resolve(args.out || positional || 'tools/shots');
const SCENE = args.scene || 'battle';
const FRAMES = parseInt(args.frames || '26', 10);
const CLASS = args.class || 'warrior';
const STAGE = args.stage || (SCENE === 'boss' ? 'c1-5' : 'c1-1');

(async () => {
  const h = await createHarness({
    quality: args.quality || 'high',
    time: args.time === undefined ? undefined : parseFloat(args.time),
    skip: args.skip ? String(args.skip).split(',') : null,
    noClouds: !!args['no-clouds'],
    render2d: !!args['render-2d'],
    wedgeDebug: !!args.wedge
  });

  await h.signIn({});
  await h.createHero(CLASS, args.name || 'Jingle');
  if (/^c\d+-\d+$/.test(STAGE)) h.unlockThrough(STAGE);
  const ok = await h.enterScene({ scene: SCENE, stage: STAGE, arena: args.arena });
  if (!ok) console.error('WARNING: could not enter scene ' + SCENE + '/' + STAGE);

  h.pump(14);                                          // world build + camera settle
  const shots = [];
  const at = [1, 8, Math.round(FRAMES * 0.4), Math.round(FRAMES * 0.75), FRAMES - 1];
  const times = [];
  for (let i = 0; i < FRAMES; i++) {
    times.push(h.step(16.7));
    h.Render3D.tickHud(0.0167, h.Game.state);
    if (args.combat && i % 11 === 5) h.attack();
    if (args.combat && i % 11 === 6) h.attack();
    if (at.indexOf(i) >= 0) {
      shots.push(h.shot(path.join(OUT, SCENE + '-f' + String(i).padStart(3, '0') + '.png')));
    }
  }
  const preview = h.doc.getElementById('preview-canvas');
  if (preview) {
    const cls = h.win.Mythara.DATA.getClass(CLASS);
    h.Render3D.drawPreviewHero(h.canvasMap.get(preview).ctx, preview, cls, 1.1);
    shots.push(h.shotElement('preview-canvas', path.join(OUT, 'preview-' + CLASS + '.png')));
  }
  shots.push(h.shotElement('minimap-canvas', path.join(OUT, 'minimap.png')));

  const sorted = times.slice().sort((a, b) => a - b);
  console.log(JSON.stringify({
    scene: SCENE, stage: STAGE, class: CLASS, frames: FRAMES,
    medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(2),
    maxMs: +sorted[sorted.length - 1].toFixed(2),
    shots: shots.filter(Boolean),
    summary: h.summary()
  }, null, 2));
  h.close();
  process.exit(h.errors.length ? 1 : 0);
})();
