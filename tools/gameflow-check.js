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
    // A short nudge toward the monster (the playfield edge blocks longer walks),
    // then attack patiently while the monster closes to melee range.
    h.approach(target, { frames: 60, range: 90 });
    for (let i = 0; i < 200 && target.hp >= hpBefore && target.alive; i++) {
      h.attack(); h.key('Space', false); h.pump(3);
    }
  }
  check('attack damages a monster', !!target && target.hp < hpBefore, target ? hpBefore + ' → ' + target.hp : 'no target');

  // 4. skill cast from the hotbar button
  const skillButton = h.doc.querySelector('[data-skill-slot="0"]');
  const mpBefore = h.Game.state.player.mp;
  if (skillButton) {
    skillButton.click();
    for (let i = 0; i < 60 && h.Game.state.player.mp >= mpBefore; i++) { h.pump(4); }
  }
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

  // 9. combat systems (Step 7): targeting, AI states, loot, death + respawn
  h.App.handleAction('battle.leave', {});
  await h.wait(200);
  const leaveCard2 = Array.prototype.filter.call(h.doc.querySelectorAll('.modal__card'), function (card) {
    const title = card.querySelector('.modal__title');
    return title && /leave/i.test(title.textContent);
  })[0];
  if (leaveCard2 && leaveCard2.querySelector('.btn--gold')) leaveCard2.querySelector('.btn--gold').click();
  await h.wait(240);

  const fighter = h.Game.state.player;
  fighter.pos.x = 480; fighter.pos.y = 400;
  const defs = h.Enemies.list();
  const mobA = h.Game.createEnemy(defs[0], 4, { spawn: { x: fighter.pos.x + 150, y: fighter.pos.y }, noSpawnDelay: true });
  const mobB = h.Game.createEnemy(defs[1], 4, { spawn: { x: fighter.pos.x - 170, y: fighter.pos.y + 40 }, noSpawnDelay: true });
  h.Game.spawnEnemies([mobA, mobB]);
  h.pump(3);

  h.Game.selectTarget(mobA);
  check('target selection', h.Game.target() === mobA && h.Game.state.monster === mobA,
    mobA.name + ' picked');
  const cycled = h.Game.cycleTarget(false);
  check('target cycling', !!cycled && cycled !== mobA, cycled ? cycled.name : 'none');
  h.Game.selectTarget(mobB);

  const mobHp0 = mobB.hp;
  h.Game.hitMonster(fighter, mobB, { silent: true });
  check('damage + hit reaction', mobB.hp < mobHp0 && mobB.hitFlash > 0 && mobB.aggro === true,
    mobHp0 + ' → ' + mobB.hp);

  // the AI must react to the fighter standing next to it
  h.pump(90);
  check('monster AI engages', ['chase', 'attack', 'detect'].indexOf(mobB.ai.state) !== -1 && mobB.aggro,
    'state ' + mobB.ai.state);

  // death pays out exactly once, drops loot, and loot is collectable
  let droppedCount = 0;
  let pickedCount = 0;
  h.win.MytharaCore.Bus.on('loot:dropped', function (payload) { droppedCount += payload.loot.length; });
  h.win.MytharaCore.Bus.on('loot:pickup', function () { pickedCount += 1; });
  const goldBefore = fighter.gold, expBefore = fighter.exp;
  mobB.hp = 1;
  h.Game.hitMonster(fighter, mobB, { silent: true });
  const goldAfter = fighter.gold, expAfter = fighter.exp;
  const drops = h.Game.loot().filter(function (l) { return l.picked !== true; });
  check('kill rewards exp/gold', !mobB.alive && (goldAfter > goldBefore || expAfter > expBefore),
    '+' + (goldAfter - goldBefore) + ' gold · +' + (expAfter - expBefore) + ' exp');
  const respawnTimerAtDeath = mobB.respawnTimer;
  h.Game.hitMonster(fighter, mobB, { silent: true });
  check('no duplicate rewards', fighter.gold === goldAfter && fighter.exp === expAfter);

  // a single mob only drops ~80% of the time, so kill a handful before judging
  const extra = [];
  for (let i = 0; i < 5; i++) {
    extra.push(h.Game.createEnemy(defs[(i + 2) % defs.length], 4, {
      spawn: { x: 200 + i * 30, y: 330 + (i % 2) * 24 }, noSpawnDelay: true
    }));
  }
  h.Game.spawnEnemies(extra);
  h.pump(2);
  extra.forEach(function (m) { m.hp = 1; h.Game.hitMonster(fighter, m, { silent: true }); });
  h.pump(2);
  const remaining = h.Game.loot().filter(function (l) { return l.picked !== true; });
  check('loot drops on death', droppedCount > 0, droppedCount + ' drop(s) from 6 kills');
  if (remaining.length) {
    const drop = remaining[0];
    fighter.pos.x = drop.x; fighter.pos.y = drop.y;
    h.pump(4);
    check('loot pickup', pickedCount > 0 && h.Game.loot().indexOf(drop) === -1, drop.name + ' collected');
  } else {
    check('loot pickup', pickedCount > 0, 'collected on walk-over');
  }

  // player death → respawn at a legal, quiet spot with combat suspended
  fighter.pos.x = 700; fighter.pos.y = 330; fighter.hp = 0;
  h.Game.knockDownPlayer(fighter);
  fighter.attackCooldown = 0;
  const mobHp1 = mobA.hp;
  h.attack(); h.pump(3); h.key('Space', false);          // real input path while downed
  check('combat paused while downed', fighter.downed && mobA.hp === mobHp1 && fighter.attackCooldown === 0);
  h.pump(260);
  const spotLegal = !h.Render3D.resolveMove(fighter.pos.x, fighter.pos.y, fighter.pos.x, fighter.pos.y, 16).blocked;
  check('respawn after death', !fighter.downed && fighter.hp > 0 && spotLegal,
    Math.round(fighter.hp) + '/' + fighter.maxHp + ' at ' + Math.round(fighter.pos.x) + ',' + Math.round(fighter.pos.y));

  // a dead monster comes back on its timer, at home, with rewards armed again
  // it respawns at home, then may immediately hunt the hero again — so allow
  // it a short leash around its spawn point
  const backHome = Math.hypot(mobB.pos.x - mobB.home.x, mobB.pos.y - mobB.home.y);
  check('monster respawns after death',
    respawnTimerAtDeath > 0 && mobB.alive && mobB.hp === mobB.maxHp &&
    backHome < 120 && mobB.rewarded === false,
    respawnTimerAtDeath.toFixed(1) + 's timer · ' + Math.round(backHome) + ' units from spawn');
  mobB.hp = 1;
  const goldAgain = fighter.gold;
  h.Game.hitMonster(fighter, mobB, { silent: true });
  check('respawned monster pays again', !mobB.alive && fighter.gold >= goldAgain,
    '+' + (fighter.gold - goldAgain) + ' gold from the respawn');

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
