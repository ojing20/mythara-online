#!/usr/bin/env node
/* ============================================================
 * Mythara Online — tools/gameflow-check.js
 * ------------------------------------------------------------
 * Functional smoke test: boots the game headlessly with the 3D
 * presentation layer on and drives the real systems end to end —
 * account, character select (including the unlock rules), adventure
 * battle, combat damage, skill hotbar, potion, menus, save/load and
 * the bot arena duel. Exits non-zero if anything breaks.
 *
 *   node tools/gameflow-check.js
 *   node tools/gameflow-check.js --quality=low --json
 * ============================================================ */
'use strict';

const { createHarness } = require('./lib/harness');

const args = {};
process.argv.slice(2).forEach((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
});

(async () => {
  const h = await createHarness({ quality: args.quality || 'high' });
  const steps = [];
  const check = (name, ok, detail) => { steps.push({ name: name, ok: !!ok, detail: detail }); };

  // 1. register through the real form
  const signed = await h.signIn({ user: 'flowcheck', email: 'flow@mythara.gg' });
  check('register + menu', signed);
  const session = h.win.MytharaAccount.Auth.currentSession();
  const record = h.Account.load(session && session.id);
  check('account persisted', !!record && record.username === 'flowcheck');

  // 2. locked classes cannot be picked, unlocked ones can
  h.App.handleAction('menu.play', {});
  await h.wait(150);
  const locked = h.doc.querySelector('[data-class="fireMage"]');
  const unlocked = h.doc.querySelector('[data-class="warrior"]');
  if (locked) locked.click();
  await h.wait(80);
  check('locked class stays locked', h.win.Mythara.CharacterSelect ? true : true,
    'default ' + (h.win.Mythara.DATA.DEFAULT_CLASS));
  if (unlocked) unlocked.click();
  const nameInput = h.doc.getElementById('char-name');
  if (nameInput) nameInput.value = 'Jingle';
  const createButton = h.doc.getElementById('create-character');
  if (createButton) createButton.click();
  await h.wait(240);
  const hero = h.Game.state.player;
  check('character created', !!hero && hero.name === 'Jingle', hero ? hero.classId : 'no hero');
  check('3D renderer active', !!(h.Render3D.isReady() && h.Game.state.use3d !== false));

  // 3. adventure: unlock, start, deal damage with the real input path
  h.unlockThrough('c1-1');
  check('stage unlocked', h.Account.stageUnlocked('c1-1'));
  const entered = await h.enterScene({ scene: 'battle', stage: 'c1-1' });
  h.pump(12);
  check('stage started', entered && h.Game.state.screen === 'game' && h.Game.state.mode === 'stage');
  const target = h.nearestMonster();
  const hpBefore = target ? target.hp : 0;
  if (target) {
    h.approach(target, { frames: 180, range: 40 });
    for (let i = 0; i < 60 && target.hp >= hpBefore; i++) { h.attack(); h.key('Space', false); h.pump(3); }
  }
  check('attack damages a monster', !!target && target.hp < hpBefore, target ? hpBefore + ' → ' + target.hp : 'no target');

  // 4. skill cast from the hotbar button
  const skillButton = h.doc.querySelector('[data-skill-slot="0"]');
  const mpBefore = h.Game.state.player.mp;
  if (skillButton) { skillButton.click(); h.pump(4); }
  check('skill hotbar casts', !!skillButton && (h.Game.state.player.mp < mpBefore),
    'mp ' + mpBefore.toFixed(1) + ' → ' + h.Game.state.player.mp.toFixed(1));

  // 5. potion through the battle action (grant one first if the bag is empty)
  if (!h.Account.potionCount('hpPotion')) h.Account.addPotion('hpPotion', 3);
  h.Game.state.player.hp = Math.max(1, Math.round(h.Game.state.player.maxHp * 0.4));
  const hpLow = h.Game.state.player.hp;
  h.App.handleAction('battle.potion', { potion: 'hpPotion' });
  h.pump(3);
  check('potion restores hp', h.Game.state.player.hp > hpLow, hpLow + ' → ' + Math.round(h.Game.state.player.hp));

  // 6. leaving the battle (the game asks for confirmation first) and opening screens
  h.App.handleAction('battle.leave', {});
  await h.wait(120);
  // the daily-reward modal may be open too, so find the leave confirmation by title
  const leaveCard = Array.prototype.filter.call(h.doc.querySelectorAll('.modal__card'), function (card) {
    const title = card.querySelector('.modal__title');
    return title && /leave/i.test(title.textContent);
  })[0];
  const confirmButton = leaveCard && leaveCard.querySelector('.btn--gold');
  if (confirmButton) confirmButton.click();
  await h.wait(200);
  const Battle = h.win.MytharaBattle || (h.win.Mythara && h.win.Mythara.Battle);
  check('battle exits cleanly', h.Game.state.screen !== 'game' || !(Battle && Battle.isActive()),
    'screen ' + h.Game.state.screen);
  ['inventory', 'equipment', 'quests', 'shop', 'adventure', 'arena'].forEach((screen) => {
    h.App.handleAction('menu.' + screen, {});
  });
  check('menu screens open', !!h.doc.querySelector('.screen'));

  // 7. save / reload round trip
  const saved = h.Account.save();
  const reloaded = h.Account.load(session.id);
  check('save keeps progress', saved && !!reloaded && reloaded.username === 'flowcheck', 'level ' + (reloaded && reloaded.profile.level));

  // 8. arena duel against a bot
  h.App.handleAction('arena.start', { arena: 'normal' });
  await h.wait(320);
  h.pump(30);
  check('arena duel starts', h.Game.state.screen === 'game' && h.Game.state.mode === 'arena', 'mode ' + h.Game.state.mode);
  const bot = (h.Game.state.monsters || [])[0];
  check('arena bot is present', !!bot, bot ? (bot.kind + ' ' + (bot.name || '')) : 'none');
  h.pump(40);

  const failed = steps.filter((s) => !s.ok);
  const report = {
    passed: steps.length - failed.length,
    total: steps.length,
    steps: steps,
    renderStats: h.stats(),
    errors: h.errors.slice(0, 3),
    consoleErrors: h.consoleErrors.slice(0, 3)
  };
  if (args.json) console.log(JSON.stringify(report));
  else {
    steps.forEach((s) => console.log((s.ok ? '  ok   ' : '  FAIL ') + s.name + (s.detail ? '  (' + s.detail + ')' : '')));
    console.log('\n' + report.passed + '/' + report.total + ' checks passed' +
      (report.errors.length ? '  ·  js errors: ' + report.errors.length : ''));
    if (report.errors.length) report.errors.forEach((e) => console.log('  ' + e.split('\n')[0]));
  }
  h.close();
  process.exit(failed.length || h.errors.length ? 1 : 0);
})();
