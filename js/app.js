/* ============================================================
 * Mythara Online — js/app.js
 * ------------------------------------------------------------
 * The application shell. It owns the screen flow:
 *
 *   Loading → Login/Register → Main Menu → Character Select →
 *   Adventure / Arena / Characters / Inventory / Equipment /
 *   Summon / Quests / Shop / Settings → Battle → Rewards → Menu
 *
 * It also keeps the saved account, the canvas engine and the UI
 * layer in sync. The engine itself never knows about accounts.
 * ============================================================ */
(function (root) {
  'use strict';

  const Core = root.MytharaCore;
  const Bus = Core.Bus;
  const Format = Core.Format;
  const AccountRef = root.MytharaAccount;
  const Auth = AccountRef.Auth;
  const Account = AccountRef.Account;
  const Systems = root.MytharaSystems;
  const UI = root.MytharaUI;
  const Mythara = root.Mythara;
  const Battle = root.MytharaBattle;
  const Sync = root.MytharaSync;
  const Items = root.MYTHARA_ITEMS;
  const Stages = root.MYTHARA_STAGES;
  const Enemies = root.MYTHARA_ENEMIES;

  const DAY_MS = 24 * 60 * 60 * 1000;

  const App = (function () {
    let started = false;
    let flow = 'app';                 // 'app' | 'legacy'
    let dailyShown = false;
    let session = null;
    let lastSummary = null;

    function doc() { return root.document; }
    function byId(id) { return doc().getElementById(id); }

    /* ============================================================
     * Startup
     * ========================================================== */
    function start() {
      if (started) return App;
      started = true;

      // Legacy/regression mode: the engine boots on its own and the
      // canvas-only screens behave exactly like the pre-RPG build.
      // (Used by the engine test harness.)
      if (root.__MYTHARA_LEGACY__ || (root.location && /(\?|&)flow=legacy(&|$)/.test(root.location.search))) {
        flow = 'legacy';
        Mythara.boot({});
        return App;
      }

      doc().body.classList.add('flow-app');
      // Look for the Mythara account server in the background; the
      // loading bar gives it time, and `ready()` never blocks the game.
      if (Sync) Sync.install();
      Mythara.boot({});
      Systems.install();
      UI.mount(doc());
      bindEvents();
      bindLegacyButtons();
      runLoadingSequence();
      return App;
    }

    /** Fake-but-smooth loading bar, then hand over to login/menu. */
    function runLoadingSequence() {
      const steps = [
        { at: 8, text: 'Waking the realm of Mythara…' },
        { at: 30, text: 'Forging weapons and armor…' },
        { at: 55, text: 'Rousing the beasts of ten chapters…' },
        { at: 78, text: 'Polishing the summoning gate…' },
        { at: 96, text: 'Almost ready…' }
      ];
      let progress = 0;
      const timer = setInterval(function () {
        progress = Math.min(100, progress + 6 + Math.random() * 9);
        UI.loadingStep(progress, null);
        steps.forEach(function (step) { if (progress >= step.at) UI.loadingStep(progress, step.text); });
        if (progress < 100) return;
        clearInterval(timer);
        UI.loadingStep(100, 'Loading Mythara…');
        setTimeout(finishLoading, 320);
      }, 130);
    }

    function finishLoading() {
      const loading = byId('screen-loading');
      if (loading) loading.classList.add('is-done');

      // Give the cloud probe a moment to refresh a remembered session,
      // then continue either way — offline play must never be blocked.
      const ready = Sync ? Sync.ready(3500) : Promise.resolve(null);
      ready.then(function () {
        const restored = Auth.restoreSession();
        if (restored && restored.id && Account.load(restored.id)) {
          session = { accountId: restored.id, username: restored.username };
          enterMenu({ silent: true });
          if (Sync && Sync.isCloud()) Sync.reconcile({ accountId: restored.id });
          return;
        }
        showAuth();
      });
    }

    /** Mirror saved settings onto body classes the engine reads. */
    function applySettings() {
      if (!Account.isReady()) return;
      const settings = Account.settings();
      const body = doc().body;
      body.classList.toggle('force-touch', !!settings.touchControls);
      body.classList.toggle('no-shake', settings.screenShake === false);
      body.classList.toggle('no-damage', settings.showDamage === false);
    }

    /** flow-app + in-select / in-battle decide which legacy screen shows. */
    function setBodyMode(mode) {
      const body = doc().body;
      body.classList.toggle('in-select', mode === 'select');
      body.classList.toggle('in-battle', mode === 'battle');
    }

    function showAppScreen(name) {
      setBodyMode('app');
      UI.show(name);
    }

    function showAuth() {
      byId('screen-loading').classList.add('is-hidden');
      showAppScreen('auth');
      const user = byId('login-user');
      if (user) user.focus();
    }

    /* ============================================================
     * Event wiring
     * ========================================================== */
    function bindEvents() {
      Bus.on('ui:action', function (event) { handleAction(event.action, event.payload || {}); });

      // engine feedback → HUD / toasts
      Bus.on('battle:start', function () { UI.updateBattleHud({}); });
      Bus.on('battle:wave', function (info) {
        const label = info.isBoss ? 'BOSS — ' + (info.label || 'Final') : (info.label || 'Wave');
        UI.updateBattleHud({ wave: { index: info.index + 1, total: info.total, label: label }, objective: info.isBoss ? 'Defeat the boss' : 'Clear the wave' });
        UI.toast(label + (info.total > 1 ? ' (' + (info.index + 1) + '/' + info.total + ')' : ''), info.isBoss ? 'warn' : '');
      });
      Bus.on('battle:boss', function (info) {
        UI.updateBattleHud({ objective: 'Boss fight' });
        if (info && info.monster) UI.toast('⚔ ' + info.monster.name + ' appears!', 'warn');
      });
      Bus.on('boss:phase', function (info) {
        if (info && info.monster) UI.toast(info.monster.name + ' enters phase ' + ((info.phaseIndex || 0) + 1) + '!', 'warn');
      });
      Bus.on('battle:revive', function () { UI.toast('Second wind! Fight on!', 'warn'); });
      Bus.on('battle:potion', function () { UI.renderPotionBar(); });
      Bus.on('battle:end', function (summary) { onBattleEnd(summary); });
      Bus.on('enemy:killed', function () { UI.renderPotionBar(); });
      Bus.on('summon:rolled', function () { UI.refreshHud(); UI.renderPotionBar(); });
      Bus.on('quests:reset', function () { UI.toast('Daily quests refreshed.', ''); });
      Bus.on('daily:claimed', function () { UI.refreshHud(); });
      Bus.on('log', function (info) { void info; });

      if (root.addEventListener) {
        root.addEventListener('beforeunload', function () {
          if (Account.isReady()) Account.save();
        });
      }
    }

    /** The canvas build's own buttons get app-flow behaviour. */
    function bindLegacyButtons() {
      const create = byId('create-character');
      if (create) {
        create.addEventListener('click', function (event) {
          event.stopPropagation();
          event.preventDefault();
          confirmCharacter();
        }, true);
      }
      const back = byId('back-button');
      if (back) {
        back.addEventListener('click', function (event) {
          event.stopPropagation();
          event.preventDefault();
          Mythara.CharacterSelect.close();
          enterMenu();
        }, true);
      }
      const change = byId('change-class');
      if (change) {
        change.addEventListener('click', function (event) {
          event.stopPropagation();
          event.preventDefault();
          enterCharacterSelect();
        }, true);
      }
    }

    /* ============================================================
     * Action dispatch table
     * ========================================================== */
    function handleAction(action, payload) {
      const table = {
        'auth.login': doLogin,
        'auth.register': doRegister,
        'auth.logout': doLogout,
        'menu': function () { enterMenu(); },
        'menu.play': function () { enterCharacterSelect(); },
        'menu.characters': function () { enterCharacterSelect(); },
        'menu.adventure': function () { showAppScreen('adventure'); },
        'menu.arena': function () { showAppScreen('arena'); },
        'menu.inventory': function () { showAppScreen('inventory'); },
        'menu.equipment': function () { showAppScreen('equipment'); },
        'menu.summon': function () { showAppScreen('summon'); },
        'menu.quests': function () { showAppScreen('quests'); },
        'menu.shop': function () { showAppScreen('shop'); },
        'menu.settings': function () { showAppScreen('settings'); },
        'play.continue': function () { quickContinue(); },
        'stage.start': function (data) { startStage(data.stage); },
        'arena.start': function (data) { startArena(data.arena); },
        'battle.potion': function (data) { usePotion(data.potion); },
        'battle.leave': function () { leaveBattle(); },
        'quest.claim': function (data) { claimQuest(data.quest); },
        'daily.claim': function () { claimDaily(); },
        'shop.buy': function (data) { buyShop(data.shop); },
        'summon.pull': function (data) { pullSummon(data.count); },
        'equip.on': function (data) { equipItem(data.item); },
        'equip.off': function (data) { unequipSlot(data.slot); },
        'gear.upgrade': function (data) { upgradeGear(data.item); },
        'gear.sell': function (data) { sellGear(data.item); },
        'unlock.buy': function (data) { unlockCharacter(data.class); },
        'settings.toggle': function (data) { toggleSetting(data.key, data.value); },
        'sync.now': function () { syncNow(); },
        'save': function () { Account.save(); UI.toast('Progress saved.', 'good'); }
      };
      const handler = table[action];
      if (!handler) return false;
      handler(payload);
      return true;
    }

    /* ============================================================
     * Auth
     * ========================================================== */
    function doLogin() {
      const username = (byId('login-user') || {}).value || '';
      const password = (byId('login-pass') || {}).value || '';
      const remember = !!(byId('login-remember') || {}).checked;
      if (Sync && Sync.isCloud()) UI.toast('Contacting the Mythara server…', '');
      Promise.resolve(Auth.login({ identifier: username, password: password, remember: remember })).then(function (result) {
        if (!result || !result.ok) { UI.toast((result && result.error) || 'Login failed.', 'bad'); return; }
        const record = Account.load(result.account.id);
        if (!record) { UI.toast('Account data is missing on this device.', 'bad'); return; }
        Auth.rememberSession(remember);
        session = { accountId: record.id, username: record.username };
        dailyShown = false;
        UI.toast('Welcome back, ' + record.username + '!', 'good');
        migrateLegacyCharacter();
        enterMenu();
        if (Sync && Sync.isCloud()) syncAfterLogin(record);
      });
    }

    function doRegister() {
      if (Sync && Sync.isCloud()) UI.toast('Creating your account on the server…', '');
      Promise.resolve(Auth.register({
        username: (byId('reg-user') || {}).value || '',
        email: (byId('reg-email') || {}).value || '',
        password: (byId('reg-pass') || {}).value || '',
        confirm: (byId('reg-pass2') || {}).value || ''
      })).then(function (result) {
        if (!result || !result.ok) { UI.toast((result && result.error) || 'Registration failed.', 'bad'); return; }
        Auth.rememberSession(true);
        const record = Account.load(result.account.id);
        if (!record) { UI.toast('Could not open the new account.', 'bad'); return; }
        session = { accountId: record.id, username: record.username };
        dailyShown = false;
        UI.toast('Account created. Welcome to Mythara!', 'good');
        migrateLegacyCharacter();
        enterMenu();
      });
    }

    /** After a cloud login, compare this device's copy with the server's. */
    function syncAfterLogin(record) {
      Sync.reconcile({ accountId: record.id }).then(function (out) {
        if (!out || !out.ok) return;
        UI.refreshHud();
        if (out.pulled) UI.toast('Progress synced from another device.', 'good');
      });
    }

    function doLogout() {
      UI.confirm({
        title: 'Log out?',
        body: 'Your progress is saved on this device.',
        okLabel: 'Log out',
        onOk: function () {
          if (Account.isReady()) Account.save();
          if (Sync) Sync.logout();
          Auth.logout();
          session = null;
          Battle.leave();
          UI.hideBattleHud();
          showAppScreen('auth');
          UI.toast('Logged out.', '');
        }
      });
    }

    /** Bring a pre-account (legacy) character save into the new profile. */
    function migrateLegacyCharacter() {
      if (!root.Mythara || !root.Mythara.Game) return;
      const saved = root.Mythara.Game.loadSavedCharacter ? root.Mythara.Game.loadSavedCharacter() : null;
      if (!saved) return;
      const result = Account.importLegacySave(saved);
      if (result && result.migrated) {
        UI.toast('Old save found — ' + (root.Mythara.Classes[result.classId] || {}).name + ' ' + result.name + ' restored.', 'good');
      }
    }

    /* ============================================================
     * Menu
     * ========================================================== */
    function enterMenu(options) {
      const opts = options || {};
      if (!session) { showAppScreen('auth'); return; }
      Account.refreshEnergy();
      Systems.Quests.refresh();
      applySettings();
      showAppScreen('menu');
      UI.refreshHud();
      if (opts.silent) UI.toast('Session restored — welcome back, ' + session.username + '!', 'good');
      if (!dailyShown && Systems.Daily.canClaim()) {
        dailyShown = true;
        setTimeout(function () { UI.showDailyModal(); }, 420);
      }
    }

    /** PLAY tile: jump straight into the next uncleared stage. */
    function quickContinue() {
      const next = UI.nextStageInfo();
      if (!next) { showAppScreen('adventure'); UI.toast('Every stage cleared — replay any chapter!', 'good'); return; }
      if (!Account.stageUnlocked(next.stage.id)) { showAppScreen('adventure'); return; }
      showAppScreen('adventure');
      UI.openStageDetail(next.stage.id);
    }

    /* ============================================================
     * Character select
     * ========================================================== */
    function enterCharacterSelect() {
      if (!session) { showAppScreen('auth'); return; }
      const state = Mythara.Game.state;
      const currentId = state.player ? state.player.classId : Account.activeCharacterId();
      doc().getElementById('app-root').hidden = true;
      setBodyMode('select');
      root.Mythara.Game.setScreen('select');
      root.Mythara.CharacterSelect.open();
      root.Mythara.CharacterSelect.select(currentId);
      UI.decorateCharacterSelect();
    }

    function confirmCharacter() {
      const input = byId('char-name');
      const name = ((input && input.value) || 'Jingle').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Jingle';
      const selected = root.Mythara.CharacterSelect.selectedClass();
      if (!selected) return;
      const status = Account.unlockStatus(selected.id);
      if (status.known && !status.unlocked) {
        UI.showUnlockModal(selected.id);
        return;
      }
      Mythara.CharacterSelect.close();
      if (!Account.setActiveCharacter(selected.id)) {
        UI.toast('That class is not unlocked yet.', 'warn');
        UI.showUnlockModal(selected.id);
        return;
      }
      Account.save();
      bootCharacter(selected.id, name);
      UI.toast(selected.name + ' enters the world.', 'good');
      enterMenu();
    }

    /** Rebuild the canvas hero from the saved account (class + level + gear). */
    function bootCharacter(classId, name) {
      const activeId = classId || Account.activeCharacterId();
      const character = Account.character(activeId) || { level: 1 };
      const state = Mythara.Game.state;
      Mythara.Game.createCharacter({
        classId: activeId,
        name: name || (state.player && state.player.name) || 'Jingle',
        level: character.level,
        equipmentBonus: Account.equipmentBonuses()
      });
      Account.profile().characterName = state.player.name;
      Account.save();
      return state.player;
    }

    /* ============================================================
     * Battles
     * ========================================================== */
    function showPlayfield(zoneName, theme) {
      doc().getElementById('app-root').hidden = true;
      doc().getElementById('screen-loading').classList.add('is-hidden');
      setBodyMode('battle');
      Mythara.Game.setScreen('game');
      Mythara.Game.setZoneTheme(theme || null, zoneName);
      Mythara.Game.start();
      Battle.registerSystem();
    }

    function startStage(stageId) {
      UI.closeModal('result');
      if (!session) { showAppScreen('auth'); return; }
      bootCharacter();
      const result = Battle.startStage(stageId);
      if (!result.ok) { UI.toast(result.error, 'bad'); return; }
      const stage = result.fight.stage;
      const chapter = Stages.CHAPTERS[stage.chapterIndex - 1];
      showPlayfield('C' + stage.chapterIndex + ' · ' + chapter.name + ' — ' + stage.name, stage.palette);
      UI.showBattleHud({ wave: { index: 1, total: stage.waves.length, label: 'Wave' }, objective: stage.isBoss ? 'Defeat the boss' : 'Clear the waves' });
      UI.toast(stage.isBoss ? '⚔ Boss stage: ' + stage.name : 'Stage: ' + stage.name, '');
    }

    function startArena(difficultyId) {
      UI.closeModal('result');
      if (!session) { showAppScreen('auth'); return; }
      bootCharacter();
      const preview = Systems.Arena.previewOpponent(difficultyId);
      const result = Battle.startArena(difficultyId);
      if (!result.ok) { UI.toast(result.error || 'Cannot start duel.', 'bad'); return; }
      showPlayfield('Arena — ' + preview.difficulty.name + ' duel', null);
      UI.showBattleHud({ wave: { index: 1, total: 1, label: 'Duel' }, objective: 'Defeat the rival bot' });
      UI.toast('Duel vs Rival ' + preview.className + ' (Lv. ' + preview.botLevel + ') — bot controlled.', '');
    }

    function usePotion(potionId) {
      if (!Battle.isActive()) { UI.toast('Potions are used in battle.', 'warn'); return; }
      const result = Battle.usePotion(potionId);
      if (!result.ok) UI.toast(result.error || 'Cannot use potion.', 'bad');
      else UI.toast('Used ' + result.potion.name, 'good');
      UI.renderPotionBar();
    }

    function leaveBattle() {
      if (!Battle.isActive()) return;
      UI.confirm({
        title: 'Leave the fight?',
        body: 'Energy is already spent and no rewards will be granted.',
        okLabel: 'Leave',
        onOk: function () {
          const kind = Battle.current().kind;
          Battle.leave();
          UI.hideBattleHud();
          UI.toast('Left the battle.', '');
          Mythara.Game.setZoneTheme(null, 'Verdant Hollow — Training Grounds');
        if (kind === 'arena') showAppScreen('arena'); else showAppScreen('adventure');
        }
      });
    }

    function onBattleEnd(summary) {
      lastSummary = summary;
      Account.refreshEnergy();
      UI.hideBattleHud();
      UI.showBattleResult(summary);
      UI.refreshHud();
      UI.refresh();
    }

    /* ============================================================
     * Small systems
     * ========================================================== */
    function claimQuest(questId) {
      const result = Systems.Quests.claim(questId);
      if (!result.ok) { UI.toast(result.error, 'bad'); return; }
      UI.toast('Quest complete — ' + Systems.Rewards.text(result.rewards), 'good');
      UI.refreshHud();
      UI.refresh();
    }

    function claimDaily() {
      const result = Systems.Daily.claim();
      if (!result.ok) { UI.toast(result.error, 'bad'); return; }
      UI.closeModal('daily');
      UI.toast('Day ' + result.day + ' claimed — ' + Systems.Rewards.text(result.reward), 'good');
      UI.refreshHud();
      UI.refresh();
    }

    function buyShop(entryId) {
      const result = Systems.Shop.buy(entryId, 1);
      if (!result.ok) { UI.toast(result.error, 'bad'); return; }
      UI.toast('Bought ' + result.granted.label + (result.granted.count ? ' ×' + result.granted.count : ''), 'good');
      UI.refreshHud();
      UI.refresh();
    }

    function pullSummon(count) {
      const result = Systems.Summon.pull(parseInt(count, 10) || 1);
      if (!result.ok) { UI.toast(result.error, 'bad'); return; }
      UI.showSummonResults(result.results);
      UI.refreshHud();
      UI.renderPotionBar();
      const best = result.results.reduce(function (acc, entry) {
        return Items.rarityRank(entry.rarity) > Items.rarityRank(acc.rarity) ? entry : acc;
      }, result.results[0]);
      UI.toast('Summoned ' + result.results.length + ' — best: ' + (Items.RARITIES[best.rarity] || {}).name + ' ' + best.label, 'good');
      UI.refresh();
    }

    function equipItem(uid) {
      const result = Systems.Gear.equip(uid);
      if (!result.ok) { UI.toast(result.error || 'Cannot equip.', 'bad'); return; }
      UI.toast('Equipped.', 'good');
      bootCharacter();
      UI.refresh();
    }

    function unequipSlot(slotId) {
      const result = Systems.Gear.unequip(slotId);
      if (!result.ok) { UI.toast(result.error || 'Cannot unequip.', 'bad'); return; }
      bootCharacter();
      UI.refresh();
    }

    function upgradeGear(uid) {
      const result = Systems.Gear.upgrade(uid);
      if (!result.ok) { UI.toast(result.error || 'Upgrade failed.', 'bad'); return; }
      if (result.success) {
        UI.toast('Upgrade success! → +' + result.level, 'good');
        bootCharacter();
      } else {
        UI.toast('Upgrade failed... the item survived.', 'warn');
      }
      UI.refreshHud();
      UI.refresh();
    }

    function sellGear(uid) {
      const item = Account.item(uid);
      if (!item) return;
      UI.confirm({
        title: 'Sell ' + Systems.Items.name(item) + '?',
        body: 'You receive coins and lose the item.',
        okLabel: 'Sell',
        onOk: function () {
          const result = Systems.Gear.sell(uid);
          if (result.ok) {
            UI.toast('Sold for 🪙 ' + Format.int(result.coins), 'good');
            UI.refreshHud();
            UI.refresh();
          }
        }
      });
    }

    function unlockCharacter(classId) {
      const result = Account.unlockCharacter(classId);
      if (!result.ok) { UI.toast(result.error || 'Cannot unlock yet.', 'bad'); return; }
      UI.closeModal('unlock');
      UI.decorateCharacterSelect();
      const classDef = (Mythara.Classes || {})[classId];
      UI.toast('Unlocked ' + ((classDef && classDef.name) || classId) + '!', 'good');
      UI.refreshHud();
      UI.refresh();
    }

    function toggleSetting(key, rawValue) {
      const value = rawValue === '1' || rawValue === true;
      Account.setSetting(key, value);
      const body = doc().body;
      if (key === 'touchControls') body.classList.toggle('force-touch', value);
      if (key === 'screenShake') body.classList.toggle('no-shake', !value);
      if (key === 'showDamage') body.classList.toggle('no-damage', !value);
      UI.toast('Settings saved.', 'good');
    }

    /* ============================================================
     * Boot
     * ========================================================== */
    function boot() {
      if (doc().readyState === 'loading') doc().addEventListener('DOMContentLoaded', start);
      else start();
    }

    function currentSummary() { return lastSummary; }
    /** Manual save + server round-trip from the settings screen. */
    function syncNow() {
      if (!Account.isReady()) { UI.toast('Log in first.', 'warn'); return; }
      Account.save();
      if (!Sync || !Sync.isCloud()) { UI.toast('Offline mode — progress is saved on this device.', 'warn'); return; }
      UI.toast('Syncing…', '');
      Sync.reconcile({ force: true }).then(function (out) {
        if (out && out.ok) UI.toast(out.pulled ? 'Downloaded the newest progress.' : 'Progress synced.', 'good');
        else UI.toast((out && out.error) || 'Sync failed — will retry.', 'bad');
        UI.refreshHud();
        UI.refreshSyncStatus();
      });
    }

    function sessionInfo() { return session; }
    function currentFlow() { return flow; }

    return {
      start: start,
      boot: boot,
      handleAction: handleAction,
      enterMenu: enterMenu,
      enterCharacterSelect: enterCharacterSelect,
      bootCharacter: bootCharacter,
      startStage: startStage,
      startArena: startArena,
      onBattleEnd: onBattleEnd,
      session: sessionInfo,
      flow: currentFlow,
      summary: currentSummary,
      _showAuth: showAuth,
      _finishLoading: finishLoading
    };
  })();

  root.MytharaApp = App;
  if (typeof module !== 'undefined' && module.exports) module.exports = App;

  if (root.document) App.boot();

})(typeof globalThis !== 'undefined' ? globalThis : this);
