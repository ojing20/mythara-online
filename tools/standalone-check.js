/* ============================================================
 * Mythara Online — tools/standalone-check.js
 * ------------------------------------------------------------
 * Verifies the single-file build (mythara-standalone.html) boots
 * and reaches a playable screen with no console errors — the same
 * jsdom + Skia canvas rig the other suites use, pointed at the
 * generated file instead of the inlined sources.
 *
 *   node tools/build-standalone.js       # regenerate the file first
 *   node tools/standalone-check.js
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { createHarness } = require('./lib/harness.js');

const REPO = path.resolve(__dirname, '..');
const FILE = process.env.MYTHARA_HTML || path.join(REPO, 'mythara-standalone.html');

(async function main() {
  if (!fs.existsSync(FILE)) {
    console.error('missing ' + FILE + ' — run: node tools/build-standalone.js');
    process.exit(1);
  }
  const h = await createHarness({ quality: 'high', html: FILE });
  const html = h.page;
  const checks = [];
  const check = (name, ok, note) => { checks.push({ name, ok, note }); };

  check('no external script tags', !/<script[^>]+src=/.test(html));
  check('no external stylesheet links', !/<link[^>]+rel="stylesheet"/.test(html));
  check('game namespace booted', !!(h.win.Mythara && h.win.Mythara.Game));
  check('3D renderer present', !!h.win.MytharaRender3D);
  check('world module present', !!h.win.MytharaWorld3D);
  check('account module present', !!(h.win.MytharaAccount && h.win.MytharaAccount.Account));
  // the auth screen is the first thing a player sees; make sure it is on screen
  const authVisible = !!(h.doc.querySelector('.auth-card, #auth-card, [data-screen="auth"], #login-form'));
  check('auth screen rendered', authVisible);
  check('no boot errors', h.errors.length === 0 && h.consoleErrors.length === 0);

  // prove a hero can actually be created and enter a scene from this build
  await h.signIn('standalone@test.dev');
  await h.createHero('warrior', 'Jingle');
  await h.unlockThrough(1);
  const entered = await h.enterScene('hub');
  h.pump(12);
  check('hero created', !!(h.Game.state.player && h.Game.state.player.name === 'Jingle'));
  check('hub scene starts', !!entered && h.Game.state.screen === 'game');
  check('3D renderer active', !!h.Render3D.isReady());

  let failed = 0;
  checks.forEach(function (c) {
    if (!c.ok) failed++;
    console.log((c.ok ? '  ok   ' : '  FAIL ') + c.name + (c.note ? '  (' + c.note + ')' : ''));
  });
  console.log('\n' + (checks.length - failed) + '/' + checks.length + ' standalone checks passed');
  if (h.errors.length) console.log('errors:', h.errors.slice(0, 3));
  await h.close();
  process.exit(failed ? 1 : 0);
})().catch(function (err) { console.error(err); process.exit(1); });
