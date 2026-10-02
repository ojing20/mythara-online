#!/usr/bin/env node
/* ============================================================
 * Mythara Online — tools/render-perf.js
 * ------------------------------------------------------------
 * Measures how long one 3D frame takes on the CPU (no GPU) and
 * breaks the cost down per render section, so regressions are easy
 * to spot. Software rasterisation is the slow path — a real browser
 * with a GPU-backed canvas is several times faster.
 *
 *   node tools/render-perf.js                 # chapter 1, high quality
 *   node tools/render-perf.js --stage=c8-5 --frames=120
 *   node tools/render-perf.js --skip=terrain,detail
 *   node tools/render-perf.js --scene=hub --quality=medium
 *
 * Options: --scene --stage --class --frames --quality --skip --no-clouds --json
 * ============================================================ */
'use strict';

const { createHarness } = require('./lib/harness');

const args = {};
process.argv.slice(2).forEach((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
});
const FRAMES = parseInt(args.frames || '100', 10);
const WARMUP = parseInt(args.warmup || '12', 10);
const SCENE = args.scene || 'battle';
const STAGE = args.stage || (SCENE === 'boss' ? 'c1-5' : 'c1-1');
const SECTIONS = ['sky', 'horizon', 'terrain', 'ground', 'actors', 'flush', 'weather', 'labels', 'post', 'total'];

function percentile(sorted, p) {
  return +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(2);
}

(async () => {
  const h = await createHarness({
    quality: args.quality || 'high',
    skip: args.skip ? String(args.skip).split(',') : null,
    noClouds: !!args['no-clouds'],
    profile: true
  });

  await h.signIn({});
  await h.createHero(args.class || 'warrior', 'Jingle');
  if (/^c\d+-\d+$/.test(STAGE)) h.unlockThrough(STAGE);
  const ok = await h.enterScene({ scene: SCENE, stage: STAGE });
  if (!ok) console.error('WARNING: could not enter ' + SCENE + '/' + STAGE);

  h.pump(WARMUP);
  h.resetProfile();

  const times = [];
  const sectionTotals = {};
  SECTIONS.forEach((k) => { sectionTotals[k] = 0; });
  for (let i = 0; i < FRAMES; i++) {
    times.push(h.step(16.7));
    const p = h.profile();
    SECTIONS.forEach((k) => { sectionTotals[k] += p[k] || 0; });
    h.resetProfile();
  }

  const sorted = times.slice().sort((a, b) => a - b);
  const sectionAvg = {};
  SECTIONS.forEach((k) => { sectionAvg[k] = +(sectionTotals[k] / FRAMES).toFixed(2); });
  const over = (ms) => sorted.filter((t) => t > ms).length;

  const report = {
    scene: SCENE, stage: STAGE, quality: args.quality || 'high',
    frames: FRAMES,
    medianMs: percentile(sorted, 0.5),
    p75Ms: percentile(sorted, 0.75),
    p90Ms: percentile(sorted, 0.9),
    maxMs: +sorted[sorted.length - 1].toFixed(2),
    framesOver33ms: over(33),
    framesOver60ms: over(60),
    sectionMs: sectionAvg,
    stats: h.stats(),
    errors: h.errors.slice(0, 2),
    consoleErrors: h.consoleErrors.slice(0, 2)
  };
  if (args.json) console.log(JSON.stringify(report));
  else {
    console.log('# ' + SCENE + ' / ' + STAGE + ' @ ' + report.quality);
    console.log('frames ' + FRAMES + '  median ' + report.medianMs + ' ms  p75 ' + report.p75Ms +
      ' ms  p90 ' + report.p90Ms + ' ms  max ' + report.maxMs + ' ms');
    console.log('over 33 ms: ' + report.framesOver33ms + '   over 60 ms: ' + report.framesOver60ms);
    const rows = SECTIONS.filter((k) => k !== 'total').map((k) => [k, sectionAvg[k]]).sort((a, b) => b[1] - a[1]);
    rows.forEach((r) => { console.log('  ' + r[0].padEnd(9) + r[1].toFixed(2) + ' ms/frame'); });
    console.log('  ' + 'total'.padEnd(9) + sectionAvg.total.toFixed(2) + ' ms/frame (render only)');
    if (report.stats) console.log('polys ' + report.stats.polys + '  fills ' + report.stats.fills + '  deferred ' + report.stats.deferred);
  }
  h.close();
  process.exit(report.errors.length ? 1 : 0);
})();
