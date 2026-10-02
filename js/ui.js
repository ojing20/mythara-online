/* ============================================================
 * Mythara Online — js/ui.js
 * ------------------------------------------------------------
 * Every screen of the app flow, built from plain DOM nodes:
 *
 *   Loading → Login/Register → Main Menu → Character Select →
 *   Adventure / Arena / Characters / Inventory / Equipment /
 *   Summon / Quests / Shop / Settings → Battle → Rewards
 *
 * The UI never talks to the engine directly — it reads saved data
 * through MytharaSystems/MytharaAccount and emits `ui:action`
 * events that js/app.js turns into game flow.
 * ============================================================ */
(function (root) {
  'use strict';

  const Core = root.MytharaCore;
  const Format = Core.Format;
  const Dom = Core.Dom;
  const Bus = Core.Bus;
  const Items = root.MYTHARA_ITEMS;
  const Stages = root.MYTHARA_STAGES;
  const Enemies = root.MYTHARA_ENEMIES;
  const AccountRef = root.MytharaAccount;
  const Account = AccountRef ? AccountRef.Account : null;
  const Systems = root.MytharaSystems;
  const Sync = root.MytharaSync;

  const VERSION = (root.Mythara && root.Mythara.version) || '0.4.0-cloud';

  const TIPS = [
    'Tip: every class can clear the story — pick the one you enjoy.',
    'Tip: 3★ stage clears need full health, so carry HP potions.',
    'Tip: Arena duels are against AI bots, not online players.',
    'Tip: unlocking new classes costs coins and account levels.',
    'Tip: upgrade stones raise equipment in +1 steps.',
    'Tip: summoning is optional — fragments also drop in the story.',
    'Tip: bosses change phase and hit much harder when enraged.',
    'Tip: energy refills over time; gems can refill it instantly.'
  ];

  /* ============================================================
   * DOM helpers
   * ========================================================== */
  let doc = null;
  let rootEl = null;
  const ui = {};
  const screens = {};
  let activeScreen = null;

  function h(tag, className, text) {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function button(label, className, action, payload) {
    const el = h('button', 'btn ' + (className || ''), label);
    el.type = 'button';
    el.setAttribute('data-action', action);
    if (payload) {
      Object.keys(payload).forEach(function (key) { el.setAttribute('data-' + key, payload[key]); });
    }
    return el;
  }

  function section(id, title, subtitle) {
    const el = h('section', 'app-screen app-screen--' + id);
    el.id = 'screen-' + id;
    el.hidden = true;
    const head = h('header', 'app-screen__head');
    if (title) head.appendChild(h('h2', 'app-screen__title', title));
    if (subtitle) head.appendChild(h('p', 'app-screen__sub', subtitle));
    el.appendChild(head);
    el.appendChild(headerBar());
    const body = h('div', 'app-screen__body');
    el.appendChild(body);
    return { el: el, head: head, body: body };
  }

  /** Shared top strip: currency HUD + back button. */
  function headerBar() {
    const bar = h('div', 'app-hud');
    const back = button('‹ Back', 'btn--ghost btn--back', 'menu');
    bar.appendChild(back);
    const res = h('div', 'app-hud__res');
    ['coins', 'gems', 'energy', 'tickets'].forEach(function (key) {
      const chip = h('span', 'res-chip res-chip--' + key);
      chip.appendChild(h('span', 'res-chip__icon', { coins: '🪙', gems: '💎', energy: '⚡', tickets: '🎫' }[key]));
      chip.appendChild(h('span', 'res-chip__value', '0'));
      chip.setAttribute('data-res', key);
      res.appendChild(chip);
    });
    bar.appendChild(res);
    return bar;
  }

  function prompt(message) {
    const el = h('p', 'panel-hint', message);
    return el;
  }

  /* ============================================================
   * Toasts + confirm dialog
   * ========================================================== */
  function toast(message, kind) {
    if (!ui.toastStack) return;
    const el = h('div', 'toast' + (kind ? ' toast--' + kind : ''), message);
    ui.toastStack.appendChild(el);
    const life = setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2600);
    el.addEventListener('click', function () { clearTimeout(life); el.remove(); });
    return el;
  }

  function openModal(id, node) {
    const existing = ui.modals[id];
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    ui.modals[id] = node;
    node.classList.add('modal');
    (ui.modalRoot || rootEl).appendChild(node);
    return node;
  }

  function closeModal(id) {
    const node = ui.modals[id];
    if (node && node.parentNode) node.parentNode.removeChild(node);
    delete ui.modals[id];
  }

  function confirmDialog(options) {
    const wrap = h('div', 'modal__backdrop');
    const card = h('div', 'modal__card');
    card.appendChild(h('h3', 'modal__title', options.title || 'Are you sure?'));
    if (options.body) card.appendChild(h('p', 'modal__body', options.body));
    const row = h('div', 'modal__row');
    const cancel = button(options.cancelLabel || 'Cancel', 'btn--ghost', '');
    const ok = button(options.okLabel || 'Confirm', 'btn--gold', '');
    cancel.addEventListener('click', function () { closeModal('confirm'); });
    ok.addEventListener('click', function () {
      closeModal('confirm');
      if (options.onOk) options.onOk();
    });
    row.appendChild(cancel);
    row.appendChild(ok);
    card.appendChild(row);
    wrap.appendChild(card);
    openModal('confirm', wrap);
    return wrap;
  }

  /* ============================================================
   * Screen manager
   * ========================================================== */
  function register(name, node, renderFn) {
    screens[name] = { el: node, render: renderFn };
    node.hidden = true;
    rootEl.appendChild(node);
  }

  function show(name) {
    if (!screens[name]) return null;
    Object.keys(screens).forEach(function (key) {
      if (key === name) return;
      screens[key].el.hidden = true;
    });
    const target = screens[name];
    target.el.hidden = false;
    activeScreen = name;
    if (target.render) target.render();
    rootEl.hidden = false;
    rootEl.classList.add('is-open');
    Bus.emit('ui:screen', { screen: name });
    return target.el;
  }

  function current() { return activeScreen; }

  function refresh() {
    if (activeScreen && screens[activeScreen] && screens[activeScreen].render) screens[activeScreen].render();
  }

  /** Refresh the currency chips on every header bar. */
  function refreshHud() {
    if (!Account || !Account.isReady()) return;
    const p = Account.profile();
    const energy = Account.refreshEnergy();
    const values = { coins: p.coins, gems: p.gems, energy: energy + '/' + Items.ENERGY.max, tickets: p.tickets || 0 };
    Object.keys(values).forEach(function (key) {
      Array.prototype.forEach.call(rootEl.querySelectorAll('[data-res="' + key + '"] .res-chip__value'), function (el) {
        el.textContent = Format.int(values[key]);
      });
    });
  }

  /* ============================================================
   * Action wiring — every [data-action] click becomes a ui:action
   * ========================================================== */
  function bindActions() {
    // Delegated from <body> so modals (rendered outside #app-root during
    // battles) keep working.
    (doc.body || rootEl).addEventListener('click', function (event) {
      const target = event.target.closest ? event.target.closest('[data-action]') : null;
      if (!target) return;
      const action = target.getAttribute('data-action');
      const payload = {};
      Array.prototype.forEach.call(target.attributes, function (attr) {
        if (attr.name.indexOf('data-') === 0 && attr.name !== 'data-action') {
          payload[attr.name.slice(5)] = attr.value;
        }
      });
      Bus.emit('ui:action', { action: action, payload: payload, element: target });
    });
  }

  /* ============================================================
   * 1. Auth — login + register
   * ========================================================== */
  function buildAuth() {
    const parts = section('auth', 'Mythara Online', 'Sign in to your legend');
    const panel = h('div', 'auth-panel');

    // tabs
    const tabs = h('div', 'tabs');
    const loginTab = button('Login', 'tab is-active', '');
    const registerTab = button('Register', 'tab', '');
    loginTab.setAttribute('data-tab', 'login');
    registerTab.setAttribute('data-tab', 'register');
    tabs.appendChild(loginTab);
    tabs.appendChild(registerTab);
    panel.appendChild(tabs);

    function field(label, id, type, placeholder, autocomplete) {
      const wrap = h('label', 'field');
      wrap.setAttribute('for', id);
      wrap.appendChild(h('span', 'field__label', label));
      const input = doc.createElement('input');
      input.type = type;
      input.id = id;
      input.placeholder = placeholder || '';
      input.autocomplete = autocomplete || 'off';
      wrap.appendChild(input);
      return wrap;
    }

    // login form
    const loginForm = h('form', 'auth-form');
    loginForm.id = 'login-form';
    loginForm.appendChild(field('Username or email', 'login-user', 'text', 'jingle@mythara.gg', 'username'));
    loginForm.appendChild(field('Password', 'login-pass', 'password', '••••••••', 'current-password'));
    const remember = h('label', 'check');
    const rememberInput = doc.createElement('input');
    rememberInput.type = 'checkbox';
    rememberInput.id = 'login-remember';
    rememberInput.checked = true;
    remember.appendChild(rememberInput);
    remember.appendChild(h('span', '', 'Remember me on this device'));
    loginForm.appendChild(remember);
    loginForm.appendChild(button('Enter Mythara', 'btn--gold btn--wide', 'auth.login'));
    loginForm.appendChild(h('p', 'panel-hint', 'Prototype accounts are stored locally on this device. Passwords are salted and hashed — never plain text.'));
    panel.appendChild(loginForm);

    // register form
    const registerForm = h('form', 'auth-form');
    registerForm.id = 'register-form';
    registerForm.hidden = true;
    registerForm.appendChild(field('Username', 'reg-user', 'text', 'Jingle', 'username'));
    registerForm.appendChild(field('Email', 'reg-email', 'email', 'jingle@mythara.gg', 'email'));
    registerForm.appendChild(field('Password', 'reg-pass', 'password', 'At least 6 characters', 'new-password'));
    registerForm.appendChild(field('Confirm password', 'reg-pass2', 'password', 'Repeat password', 'new-password'));
    registerForm.appendChild(button('Create account', 'btn--gold btn--wide', 'auth.register'));
    registerForm.appendChild(h('p', 'panel-hint', 'Progress is saved to this account: characters, level, gear, inventory, chapters, arena rating and quests.'));
    panel.appendChild(registerForm);

    const error = h('p', 'auth-error', '');
    error.id = 'auth-error';
    error.hidden = true;
    panel.appendChild(error);

    parts.body.appendChild(panel);

    function switchTab(tab) {
      loginTab.classList.toggle('is-active', tab === 'login');
      registerTab.classList.toggle('is-active', tab === 'register');
      loginForm.hidden = tab !== 'login';
      registerForm.hidden = tab !== 'register';
      error.hidden = true;
    }
    loginTab.addEventListener('click', function () { switchTab('login'); });
    registerTab.addEventListener('click', function () { switchTab('register'); });

    return parts;
  }

  function showAuthError(message) {
    if (!ui.authError) return;
    ui.authError.textContent = message;
    ui.authError.hidden = !message;
  }

  /* ============================================================
   * 2. Main menu
   * ========================================================== */
  const TILES = [
    { id: 'play', label: 'PLAY', glyph: '⚔', hint: 'Continue your adventure' },
    { id: 'characters', label: 'CHARACTERS', glyph: '✦', hint: 'Choose or unlock a class' },
    { id: 'adventure', label: 'ADVENTURE', glyph: '🗺', hint: '10 chapters · 50 stages' },
    { id: 'arena', label: 'ARENA', glyph: '🤖', hint: '1v1 versus bot fighters' },
    { id: 'inventory', label: 'INVENTORY', glyph: '🎒', hint: 'Potions, materials, gear' },
    { id: 'equipment', label: 'EQUIPMENT', glyph: '🛡', hint: '9 slots · upgrade to +15' },
    { id: 'summon', label: 'SUMMON', glyph: '✧', hint: 'Optional — tickets & gems' },
    { id: 'quests', label: 'QUESTS', glyph: '📜', hint: 'Daily objectives' },
    { id: 'shop', label: 'SHOP', glyph: '🏬', hint: 'Potions & upgrades' },
    { id: 'settings', label: 'SETTINGS', glyph: '⚙', hint: 'Audio, controls, account' }
  ];

  function buildMenu() {
    const parts = section('menu');
    const hero = h('div', 'menu-hero');
    const left = h('div', 'menu-hero__identity');
    left.appendChild(h('span', 'menu-hero__portrait', '✦'));
    const names = h('div', 'menu-hero__names');
    names.appendChild(h('h2', 'menu-hero__name', 'Jingle'));
    names.appendChild(h('span', 'menu-hero__class', 'Lv. 1 Warrior'));
    names.appendChild(h('span', 'menu-hero__rank', 'Bronze · 0 rating'));
    left.appendChild(names);
    hero.appendChild(left);
    hero.appendChild(button('Enter battle', 'btn--gold', 'play.continue'));

    const bars = h('div', 'menu-bars');
    [['exp', 'Account EXP'], ['chenergy', 'Character']].forEach(function (entry) {
      const wrap = h('div', 'menu-bar menu-bar--' + entry[0]);
      wrap.appendChild(h('span', 'menu-bar__label', entry[1]));
      const track = h('div', 'menu-bar__track');
      const fill = h('i', 'menu-bar__fill');
      track.appendChild(fill);
      wrap.appendChild(track);
      wrap.appendChild(h('span', 'menu-bar__value', '0/0'));
      bars.appendChild(wrap);
    });
    hero.appendChild(bars);
    parts.body.appendChild(hero);

    const grid = h('div', 'tile-grid');
    TILES.forEach(function (tile) {
      const el = button('', 'tile tile--' + tile.id, 'menu.' + tile.id);
      el.appendChild(h('span', 'tile__glyph', tile.glyph));
      el.appendChild(h('span', 'tile__label', tile.label));
      el.appendChild(h('span', 'tile__hint', tile.hint));
      if (tile.id === 'characters' || tile.id === 'summon' || tile.id === 'adventure' || tile.id === 'quests') {
        const badge = h('span', 'tile__badge', '');
        badge.setAttribute('data-badge', tile.id);
        el.appendChild(badge);
      }
      grid.appendChild(el);
    });
    parts.body.appendChild(grid);
    return parts;
  }

  function renderMenu() {
    if (!Account || !Account.isReady()) return;
    const p = Account.profile();
    const classId = Account.activeCharacterId();
    const char = Account.character(classId) || { level: 1, exp: 0 };
    const classDef = (root.Mythara.Classes || {})[classId];
    const arenaStats = Systems.Arena.stats();

    if (ui.menuName) ui.menuName.textContent = p.characterName || p.username || 'Jingle';
    if (ui.menuClass) ui.menuClass.textContent = 'Lv. ' + char.level + ' ' + ((classDef && classDef.name) || classId);
    if (ui.menuRank) ui.menuRank.textContent = arenaStats.tier.tier.name + ' · ' + Format.int(arenaStats.rating) + ' rating';
    if (ui.menuPortrait) {
      ui.menuPortrait.textContent = (classDef && classDef.look && classDef.look.emblem) || '✦';
      ui.menuPortrait.style.color = (classDef && classDef.look && classDef.look.accent) || '#f2c14e';
    }

    const expMax = Items.ACCOUNT_LEVEL.expFor(p.level);
    const expFill = rootEl.querySelector('.menu-bar--exp .menu-bar__fill');
    const expText = rootEl.querySelector('.menu-bar--exp .menu-bar__value');
    if (expFill) expFill.style.width = Math.min(100, Math.round((p.exp / expMax) * 100)) + '%';
    if (expText) expText.textContent = Format.int(p.exp) + ' / ' + Format.int(expMax);

    const charMax = Account.characterExpToNext(classId) || 1;
    const charFill = rootEl.querySelector('.menu-bar--chenergy .menu-bar__fill');
    const charText = rootEl.querySelector('.menu-bar--chenergy .menu-bar__value');
    if (charFill) charFill.style.width = Math.min(100, Math.round((char.exp / charMax) * 100)) + '%';
    if (charText) charText.textContent = Format.int(char.exp) + ' / ' + Format.int(charMax);

    // badges: locked classes · claimable quests/daily · new stages
    const lockedCount = Object.keys(p.characters).filter(function (id) { return !p.characters[id].unlocked; }).length;
    const claimable = Systems.Quests.claimable().length + (Systems.Daily.canClaim() ? 1 : 0);
    const nextStage = nextStageInfo();
    setBadge('characters', lockedCount ? lockedCount + ' locked' : '');
    setBadge('summon', (p.tickets || 0) > 0 ? p.tickets + ' ticket' + (p.tickets > 1 ? 's' : '') : '');
    setBadge('adventure', nextStage ? 'Next: ' + nextStage.stage.id.toUpperCase() : '');
    setBadge('quests', claimable ? claimable + ' to claim' : '');
  }

  function setBadge(id, text) {
    Array.prototype.forEach.call(rootEl.querySelectorAll('[data-badge="' + id + '"]'), function (el) {
      el.textContent = text || '';
      el.hidden = !text;
    });
  }

  function chapterByIndex(index) { return Stages.CHAPTERS[index - 1] || null; }

  function nextStageInfo() {
    if (!Account || !Account.isReady()) return null;
    for (let c = 0; c < Stages.CHAPTERS.length; c++) {
      const chapter = Stages.CHAPTERS[c];
      const stages = Stages.stagesOf(chapter.id);
      for (let i = 0; i < stages.length; i++) {
        const record = Account.stageRecord(stages[i].id);
        if (!record.cleared) return { stage: stages[i], chapter: chapter };
      }
    }
    return null;
  }

  /* ============================================================
   * 3. Adventure — chapters + stages + stage detail
   * ========================================================== */
  function buildAdventure() {
    const parts = section('adventure', 'Adventure', 'Ten chapters · fifty stages');
    const tabs = h('div', 'chapter-tabs');
    tabs.id = 'chapter-tabs';
    parts.body.appendChild(tabs);

    const meta = h('div', 'chapter-meta');
    meta.id = 'chapter-meta';
    parts.body.appendChild(meta);

    const grid = h('div', 'stage-grid');
    grid.id = 'stage-grid';
    parts.body.appendChild(grid);

    const detail = h('div', 'stage-detail');
    detail.id = 'stage-detail';
    detail.hidden = true;
    parts.body.appendChild(detail);

    let selectedChapter = 1;
    tabs.addEventListener('click', function (event) {
      const tab = event.target.closest ? event.target.closest('[data-chapter]') : null;
      if (!tab) return;
      selectedChapter = parseInt(tab.getAttribute('data-chapter'), 10);
      renderAdventure(selectedChapter);
    });
    ui.adventureTabs = tabs;
    ui.adventureGrid = grid;
    ui.adventureMeta = meta;
    ui.adventureDetail = detail;
    ui.adventureChapter = 1;
    return parts;
  }

  function renderAdventure(chapterIndex) {
    if (!Account || !Account.isReady()) return;
    const chapter = chapterByIndex(chapterIndex || ui.adventureChapter || 1);
    if (!chapter) { ui.adventureChapter = 1; return; }
    ui.adventureChapter = chapter.index;

    // tabs
    ui.adventureTabs.innerHTML = '';
    Stages.CHAPTERS.forEach(function (entry) {
      const unlocked = Account.chapterUnlocked(entry.index);
      const tab = h('button', 'chapter-tab' + (entry.index === chapter.index ? ' is-active' : '') + (unlocked ? '' : ' is-locked'), '');
      tab.type = 'button';
      tab.setAttribute('data-chapter', entry.index);
      tab.appendChild(h('span', 'chapter-tab__num', 'C' + entry.index));
      tab.appendChild(h('span', 'chapter-tab__name', unlocked ? entry.name : 'Locked'));
      if (!unlocked) tab.appendChild(h('span', 'chapter-tab__lock', '🔒'));
      ui.adventureTabs.appendChild(tab);
    });

    const cleared = Stages.stagesOf(chapter.id).filter(function (stage) { return Account.stageRecord(stage.id).cleared; }).length;
    ui.adventureMeta.innerHTML = '';
    ui.adventureMeta.appendChild(h('h3', 'chapter-meta__name', 'Chapter ' + chapter.index + ' — ' + chapter.name));
    ui.adventureMeta.appendChild(h('p', 'chapter-meta__tag', chapter.tagline));
    ui.adventureMeta.appendChild(h('p', 'chapter-meta__progress', cleared + ' / 5 stages cleared · Boss: ' + (Enemies.get(chapter.boss) || {}).name));

    // stages
    ui.adventureGrid.innerHTML = '';
    Stages.stagesOf(chapter.id).forEach(function (stage) {
      const record = Account.stageRecord(stage.id);
      const unlocked = Account.stageUnlocked(stage.id);
      const card = h('button', 'stage-card' + (stage.isBoss ? ' stage-card--boss' : '') + (unlocked ? '' : ' is-locked'), '');
      card.type = 'button';
      card.setAttribute('data-stage', stage.id);
      card.appendChild(h('span', 'stage-card__index', stage.isBoss ? 'BOSS' : 'Stage ' + stage.index));
      card.appendChild(h('span', 'stage-card__name', unlocked ? stage.name : 'Locked'));
      const stars = h('span', 'stage-card__stars');
      for (let i = 1; i <= 3; i++) stars.appendChild(h('i', 'star' + (record.stars >= i ? ' is-on' : ''), '★'));
      card.appendChild(stars);
      card.appendChild(h('span', 'stage-card__meta', 'Lv. ' + stage.recommendedLevel + ' · ⚡' + stage.energy));
      if (record.bestTimeMs) card.appendChild(h('span', 'stage-card__time', 'Best ' + Format.duration(record.bestTimeMs)));
      if (!unlocked) card.appendChild(h('span', 'stage-card__lock', '🔒'));
      card.addEventListener('click', function () {
        if (!unlocked) { toast('Clear the previous stage first.', 'warn'); return; }
        openStageDetail(stage.id);
      });
      ui.adventureGrid.appendChild(card);
    });

    // scroll the selected tab into view on mobile
    const active = ui.adventureTabs.querySelector('.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function openStageDetail(stageId) {
    const stage = Stages.stage(stageId);
    if (!stage) return;
    const record = Account.stageRecord(stageId);
    const detail = ui.adventureDetail;
    detail.innerHTML = '';
    detail.hidden = false;

    const card = h('div', 'stage-sheet');
    card.appendChild(h('h3', 'stage-sheet__name', stage.name));
    card.appendChild(h('p', 'stage-sheet__chapter', 'Chapter ' + stage.chapterIndex + ' · ' + stage.chapterName + (stage.isBoss ? ' · BOSS STAGE' : '')));

    const facts = h('ul', 'stage-sheet__facts');
    [
      ['Recommended level', 'Lv. ' + stage.recommendedLevel],
      ['Recommended power', Format.int(stage.recommendedPower)],
      ['Energy cost', '⚡ ' + stage.energy],
      ['Waves', String(stage.waves.length)],
      ['Best time', record.bestTimeMs ? Format.duration(record.bestTimeMs) : '—'],
      ['Stars', '★'.repeat(record.stars) + '☆'.repeat(3 - record.stars)]
    ].forEach(function (row) {
      const li = h('li');
      li.appendChild(h('span', 'fact__label', row[0]));
      li.appendChild(h('span', 'fact__value', row[1]));
      facts.appendChild(li);
    });
    card.appendChild(facts);

    const enemyRow = h('div', 'stage-sheet__enemies');
    enemyRow.appendChild(h('h4', 'block-title', 'Enemies'));
    const enemyList = h('div', 'enemy-preview');
    stage.enemyPreview.forEach(function (enemyId) {
      const def = Enemies.get(enemyId);
      if (!def) return;
      const chip = h('span', 'enemy-chip' + (def.tier === 'boss' ? ' enemy-chip--boss' : ''), def.name);
      chip.setAttribute('data-enemy', enemyId);
      enemyList.appendChild(chip);
    });
    enemyRow.appendChild(enemyList);
    card.appendChild(enemyRow);

    const rewardRow = h('div', 'stage-sheet__rewards');
    rewardRow.appendChild(h('h4', 'block-title', 'Possible rewards'));
    const rewardList = h('div', 'reward-preview');
    [
      { icon: '🪙', text: Format.int(stage.rewards.coins) + ' coins' },
      { icon: '✦', text: Format.int(stage.rewards.xp) + ' EXP' },
      { icon: '💎', text: stage.rewards.gems + ' gems' + (stage.isBoss ? ' +10 first clear' : '') },
      { icon: '◆', text: stage.rewards.materials.map(function (m) { return (Items.material(m.id) || { name: m.id }).name + ' ×' + m.count; }).join(', ') },
      { icon: '⚔︎', text: Math.round(stage.rewards.equipmentChance * 100) + '% equipment drop' }
    ].forEach(function (row) {
      const li = h('span', 'reward-pill', row.icon + '  ' + row.text);
      rewardList.appendChild(li);
    });
    rewardRow.appendChild(rewardList);
    card.appendChild(rewardRow);

    const actions = h('div', 'stage-sheet__actions');
    const startBtn = button('▶  Start stage', 'btn--gold btn--wide', 'stage.start', { stage: stage.id });
    const power = currentPower();
    if (stage.recommendedPower > power * 1.15) startBtn.classList.add('is-risky');
    actions.appendChild(startBtn);
    const nextEnergy = Account.energySecondsToNext();
    actions.appendChild(h('p', 'panel-hint', 'Energy ' + Account.refreshEnergy() + '/' + Items.ENERGY.max +
      (nextEnergy ? ' (next in ' + Format.duration(nextEnergy * 1000) + ')' : '') +
      ' · ' + (stage.recommendedPower > power ? 'Underpowered for this stage — expect a hard fight.' : 'Your power is on par with this stage.')));
    const close = button('Close', 'btn--ghost', '');
    close.addEventListener('click', function () { detail.hidden = true; detail.innerHTML = ''; });
    actions.appendChild(close);
    card.appendChild(actions);

    detail.appendChild(card);
    if (detail.scrollIntoView) detail.scrollIntoView({ block: 'nearest' });
  }

  /** Live player stats when the engine is booted, otherwise class base stats. */
  function playerSheet() {
    const state = root.Mythara && root.Mythara.Game && root.Mythara.Game.state;
    if (state && state.player) return state.player;
    const classId = Account.activeCharacterId();
    const classDef = (root.Mythara.Classes || {})[classId] || {};
    return classDef.base || { maxHp: 100, attack: 10, defense: 5 };
  }

  function currentPower() { return Items.powerScore(playerSheet()); }

  /* ============================================================
   * 4. Arena — rank + bot difficulties
   * ========================================================== */
  function buildArena() {
    const parts = section('arena', 'Arena', '1v1 duels versus AI opponents');
    const banner = h('div', 'arena-banner');
    banner.appendChild(h('p', 'arena-banner__note', 'Arena opponents are bots trained by the realm — Mythara is single-player, never online PvP.'));
    banner.appendChild(h('p', 'arena-banner__note', 'Duels are 1v1. Team modes such as 3v3 are a possible future addition, not part of this prototype.'));
    parts.body.appendChild(banner);

    const rank = h('div', 'arena-rank');
    rank.id = 'arena-rank';
    parts.body.appendChild(rank);

    const list = h('div', 'arena-modes');
    list.id = 'arena-modes';
    parts.body.appendChild(list);
    ui.arenaRank = rank;
    ui.arenaModes = list;
    return parts;
  }

  function renderArena() {
    if (!Account || !Account.isReady()) return;
    const stats = Systems.Arena.stats();
    ui.arenaRank.innerHTML = '';
    const info = h('div', 'rank-card');
    info.appendChild(h('span', 'rank-card__badge', stats.tier.tier.glyph || '🥉'));
    const body = h('div', 'rank-card__body');
    body.appendChild(h('h3', 'rank-card__name', stats.tier.tier.name + ' · ' + Format.int(stats.rating) + ' rating'));
    body.appendChild(h('p', 'rank-card__sub', stats.wins + 'W / ' + stats.losses + 'L · ' + stats.winRate + '% win rate · streak ' + stats.streak));
    if (stats.tier.next) {
      const track = h('div', 'menu-bar__track');
      const fill = h('i', 'menu-bar__fill');
      fill.style.width = Math.round(stats.tier.progress * 100) + '%';
      track.appendChild(fill);
      body.appendChild(track);
      body.appendChild(h('p', 'panel-hint', 'Next tier: ' + stats.tier.next.name + ' at ' + Format.int(stats.tier.next.min) + ' rating'));
    }
    info.appendChild(body);
    ui.arenaRank.appendChild(info);

    ui.arenaModes.innerHTML = '';
    Systems.Arena.difficulties().forEach(function (entry) {
      const card = h('button', 'arena-card', '');
      card.type = 'button';
      card.setAttribute('data-arena', entry.def.id);
      card.appendChild(h('span', 'arena-card__name', entry.def.name));
      card.appendChild(h('span', 'arena-card__level', 'Bot level ' + entry.botLevel));
      card.appendChild(h('span', 'arena-card__desc', entry.def.description));
      const rewards = h('span', 'arena-card__rewards',
        '🪙 ' + Format.int(entry.rewards.coins) + ' · ✦ ' + Format.int(entry.rewards.xp) + ' · 💎 ' + entry.rewards.gems + ' · rating +' + entry.rating);
      card.appendChild(rewards);
      card.appendChild(h('span', 'arena-card__ai', 'AI: reaction ' + entry.ai.reactionMs + 'ms · dodge ' + Math.round(entry.ai.dodgeChance * 100) + '%'));
      card.addEventListener('click', function () {
        Bus.emit('ui:action', { action: 'arena.start', payload: { arena: entry.def.id } });
      });
      ui.arenaModes.appendChild(card);
    });
  }

  /* ============================================================
   * 5. Inventory
   * ========================================================== */
  function buildInventory() {
    const parts = section('inventory', 'Inventory', 'Potions · materials · equipment');
    const grid = h('div', 'inventory-grid');
    grid.id = 'inventory-grid';
    parts.body.appendChild(grid);
    ui.inventoryGrid = grid;
    return parts;
  }

  function renderInventory() {
    if (!Account || !Account.isReady()) return;
    const p = Account.profile();
    ui.inventoryGrid.innerHTML = '';

    const potions = h('section', 'panel');
    potions.appendChild(h('h3', 'block-title', '🧪 Potions'));
    const potionList = h('div', 'chip-list');
    Object.keys(Items.POTIONS).forEach(function (id) {
      const potion = Items.potion(id);
      const count = Account.potionCount(id);
      const chip = h('span', 'item-chip' + (count ? '' : ' is-empty'), potion.glyph + ' ' + potion.name + ' ×' + count);
      chip.setAttribute('data-potion', id);
      potionList.appendChild(chip);
    });
    potions.appendChild(potionList);
    ui.inventoryGrid.appendChild(potions);

    const materials = h('section', 'panel');
    materials.appendChild(h('h3', 'block-title', '◆ Materials'));
    const materialList = h('div', 'chip-list');
    Object.keys(Items.MATERIALS).forEach(function (id) {
      const count = Account.materialCount(id);
      const chip = h('span', 'item-chip' + (count ? '' : ' is-empty'), Items.MATERIALS[id].glyph + ' ' + Items.MATERIALS[id].name + ' ×' + count);
      materialList.appendChild(chip);
    });
    materials.appendChild(materialList);
    ui.inventoryGrid.appendChild(materials);

    const gear = h('section', 'panel');
    gear.appendChild(h('h3', 'block-title', '⚔︎ Equipment (' + p.inventory.length + ' items)'));
    const list = h('div', 'gear-mini-list');
    const entries = Systems.Gear.inventory().slice(0, 40);
    if (!entries.length) list.appendChild(h('p', 'panel-hint', 'No equipment yet — clear stages and open chests.'));
    entries.forEach(function (entry) {
      const row = h('div', 'gear-mini' + (entry.equipped ? ' is-equipped' : ''));
      row.appendChild(h('span', 'gear-mini__icon', '⚔︎'));
      row.appendChild(h('span', 'gear-mini__name', entry.name));
      row.appendChild(h('span', 'gear-mini__slot', entry.slotName));
      const rarity = h('span', 'gear-mini__rarity', entry.rarity.name);
      rarity.style.color = entry.rarity.color;
      row.appendChild(rarity);
      list.appendChild(row);
    });
    gear.appendChild(list);
    ui.inventoryGrid.appendChild(gear);

    const fragments = h('section', 'panel');
    fragments.appendChild(h('h3', 'block-title', '✦ Character fragments'));
    const fragList = h('div', 'chip-list');
    Object.keys(p.characters).forEach(function (classId) {
      const state = p.characters[classId];
      const classDef = (root.Mythara.Classes || {})[classId];
      if (!state.fragments && state.unlocked) return;
      const chip = h('span', 'item-chip' + (state.fragments ? '' : ' is-empty'),
        (classDef ? classDef.name : classId) + ' ×' + (state.fragments || 0) + (state.unlocked ? ' (unlocked)' : ''));
      fragList.appendChild(chip);
    });
    fragments.appendChild(fragList);
    ui.inventoryGrid.appendChild(fragments);
  }

  /* ============================================================
   * 6. Equipment — slots + upgrade
   * ========================================================== */
  function buildEquipment() {
    const parts = section('equipment', 'Equipment', 'Nine slots · upgrade up to +15');
    const slots = h('div', 'slot-grid');
    slots.id = 'slot-grid';
    parts.body.appendChild(slots);
    const totals = h('div', 'panel equip-totals');
    totals.id = 'equip-totals';
    parts.body.appendChild(totals);
    const bag = h('div', 'panel');
    bag.appendChild(h('h3', 'block-title', '🎒 Inventory'));
    const list = h('div', 'gear-list');
    list.id = 'gear-list';
    bag.appendChild(list);
    parts.body.appendChild(bag);
    ui.slotGrid = slots;
    ui.equipTotals = totals;
    ui.gearList = list;
    return parts;
  }

  function renderEquipment() {
    if (!Account || !Account.isReady()) return;
    const equipped = Account.equippedItems();
    ui.slotGrid.innerHTML = '';
    Items.SLOTS.forEach(function (slot) {
      const item = equipped[slot.id];
      const cell = h('div', 'slot-cell' + (item ? ' is-filled' : ''));
      cell.setAttribute('data-slot', slot.id);
      cell.appendChild(h('span', 'slot-cell__name', slot.name));
      if (item) {
        cell.appendChild(h('span', 'slot-cell__item', Systems.Items.name(item)));
        const stats = Systems.Items.stats(item);
        const statLine = Object.keys(stats).slice(0, 3).map(function (key) {
          return '+' + stats[key] + ' ' + (Items.STAT_LABELS[key] || key);
        }).join(' · ');
        cell.appendChild(h('span', 'slot-cell__stats', statLine));
        const off = button('Unequip', 'btn--tiny btn--ghost', 'equip.off', { slot: slot.id });
        cell.appendChild(off);
      } else {
        cell.appendChild(h('span', 'slot-cell__empty', '— empty —'));
      }
      ui.slotGrid.appendChild(cell);
    });

    const bonuses = Account.equipmentBonuses();
    ui.equipTotals.innerHTML = '';
    ui.equipTotals.appendChild(h('h3', 'block-title', '📊 Equipment bonuses'));
    const line = h('div', 'chip-list');
    const keys = Object.keys(bonuses);
    if (!keys.length) line.appendChild(h('span', 'panel-hint', 'Equip gear to raise your stats.'));
    keys.forEach(function (key) {
      const value = bonuses[key];
      const text = (key === 'critChance' || key === 'evasion' || key === 'attackSpeed')
        ? (value > 0 ? '+' : '') + Math.round(value * 100) + '% ' + (Items.STAT_LABELS[key] || key)
        : '+' + value + ' ' + (Items.STAT_LABELS[key] || key);
      line.appendChild(h('span', 'item-chip', text));
    });
    ui.equipTotals.appendChild(line);

    ui.gearList.innerHTML = '';
    const entries = Systems.Gear.inventory();
    if (!entries.length) ui.gearList.appendChild(h('p', 'panel-hint', 'No equipment in the bag yet.'));
    entries.forEach(function (entry) {
      const row = h('div', 'gear-row' + (entry.equipped ? ' is-equipped' : ''));
      row.setAttribute('data-item', entry.item.uid);
      const head = h('div', 'gear-row__head');
      head.appendChild(h('span', 'gear-row__name', entry.name));
      const rarity = h('span', 'gear-row__rarity', entry.rarity.name);
      rarity.style.color = entry.rarity.color;
      head.appendChild(rarity);
      row.appendChild(head);
      row.appendChild(h('span', 'gear-row__meta', entry.slotName + ' · power ' + Format.int(entry.power) + (entry.equipped ? ' · equipped' : '')));
      const actions = h('div', 'gear-row__actions');
      actions.appendChild(button(entry.equipped ? 'Unequip' : 'Equip', 'btn--tiny btn--gold', entry.equipped ? 'equip.off' : 'equip.on', { item: entry.item.uid, slot: entry.item.slot }));
      const up = entry.upgrade;
      if (up && !up.maxed) {
        const label = 'Upgrade +' + up.next + ' (' + Math.round(up.chance * 100) + '%)';
        const btn = button(label, 'btn--tiny', 'gear.upgrade', { item: entry.item.uid });
        if (!up.hasCoins || !up.hasStones) btn.classList.add('is-disabled');
        actions.appendChild(btn);
      } else {
        actions.appendChild(h('span', 'gear-row__maxed', entry.upgrade && entry.upgrade.maxed ? 'MAX +' + Items.UPGRADE.maxLevel : ''));
      }
      actions.appendChild(button('Sell', 'btn--tiny btn--ghost', 'gear.sell', { item: entry.item.uid }));
      row.appendChild(actions);
      ui.gearList.appendChild(row);
    });
  }

  /* ============================================================
   * 7. Summon (optional)
   * ========================================================== */
  function buildSummon() {
    const parts = section('summon', 'Summoning Gate', 'Optional — free tickets and earned gems only');
    const note = h('div', 'summon-note');
    note.appendChild(h('p', '', 'Optional: summoning is a shortcut, never a requirement. Characters are also unlockable with coins, fragments from stages and daily rewards. No real-money purchases exist in this prototype.'));
    parts.body.appendChild(note);

    const wallet = h('div', 'summon-wallet');
    wallet.id = 'summon-wallet';
    parts.body.appendChild(wallet);

    const actions = h('div', 'summon-actions');
    const single = button('Summon ×1', 'btn--gold', 'summon.pull', { count: '1' });
    const ten = button('Summon ×10', 'btn--gold btn--wide', 'summon.pull', { count: '10' });
    single.id = 'summon-single';
    ten.id = 'summon-ten';
    actions.appendChild(single);
    actions.appendChild(ten);
    parts.body.appendChild(actions);

    const rates = h('div', 'panel summon-rates');
    rates.id = 'summon-rates';
    parts.body.appendChild(rates);

    const results = h('div', 'summon-results');
    results.id = 'summon-results';
    parts.body.appendChild(results);
    ui.summonWallet = wallet;
    ui.summonRates = rates;
    ui.summonResults = results;
    return parts;
  }

  function renderSummon() {
    if (!Account || !Account.isReady()) return;
    const state = Systems.Summon.canPull(1);
    ui.summonWallet.innerHTML = '';
    ui.summonWallet.appendChild(h('span', 'item-chip', '🎫 Tickets ×' + state.tickets));
    ui.summonWallet.appendChild(h('span', 'item-chip', '💎 Gems ×' + Format.int(state.gems)));
    ui.summonWallet.appendChild(h('span', 'item-chip', state.useTicket ? 'Next pull uses a free ticket' : 'Next pull costs ' + state.cost + ' gems'));

    const single = rootEl.querySelector('#summon-single');
    const ten = rootEl.querySelector('#summon-ten');
    const tenState = Systems.Summon.canPull(10);
    if (single) single.classList.toggle('is-disabled', !state.affordable);
    if (ten) ten.classList.toggle('is-disabled', !tenState.affordable);

    ui.summonRates.innerHTML = '';
    ui.summonRates.appendChild(h('h3', 'block-title', 'Rates'));
    const list = h('div', 'chip-list');
    Systems.Summon.rates().forEach(function (rate) {
      const rarity = Items.RARITIES[rate.rarity];
      const chip = h('span', 'item-chip', rarity.name + ' ' + rate.chance + '%');
      chip.style.color = rarity.color;
      list.appendChild(chip);
    });
    ui.summonRates.appendChild(list);
  }

  function showSummonResults(results) {
    ui.summonResults.innerHTML = '';
    const title = h('h3', 'block-title', results.length > 1 ? 'Summon ×' + results.length : 'Summon');
    ui.summonResults.appendChild(title);
    const grid = h('div', 'summon-grid');
    results.forEach(function (result, index) {
      const card = h('div', 'summon-card summon-card--' + result.rarity);
      card.style.setProperty('--rarity-color', result.color || '#f2c14e');
      card.style.animationDelay = (index * 90) + 'ms';
      card.appendChild(h('span', 'summon-card__glyph', result.glyph));
      card.appendChild(h('span', 'summon-card__label', result.label));
      card.appendChild(h('span', 'summon-card__rarity', (Items.RARITIES[result.rarity] || {}).name || result.rarity));
      grid.appendChild(card);
    });
    ui.summonResults.appendChild(grid);
    if (ui.summonResults.scrollIntoView) ui.summonResults.scrollIntoView({ block: 'nearest' });
  }

  /* ============================================================
   * 8. Quests
   * ========================================================== */
  function buildQuests() {
    const parts = section('quests', 'Quests', 'Daily objectives reset every 24 hours');
    const list = h('div', 'quest-list');
    list.id = 'quest-list';
    parts.body.appendChild(list);
    ui.questList = list;
    return parts;
  }

  function renderQuests() {
    if (!Account || !Account.isReady()) return;
    Systems.Quests.refresh();
    ui.questList.innerHTML = '';
    Systems.Quests.list().forEach(function (entry) {
      const quest = entry.quest;
      const row = h('div', 'quest-row' + (entry.complete ? ' is-complete' : '') + (entry.claimed ? ' is-claimed' : ''));
      row.setAttribute('data-quest', quest.id);
      const head = h('div', 'quest-row__head');
      head.appendChild(h('span', 'quest-row__name', quest.name));
      head.appendChild(h('span', 'quest-row__progress', entry.progress + ' / ' + quest.target));
      row.appendChild(head);
      const track = h('div', 'menu-bar__track');
      const fill = h('i', 'menu-bar__fill');
      fill.style.width = Math.min(100, Math.round((entry.progress / quest.target) * 100)) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(h('span', 'quest-row__rewards', Systems.Rewards.text(quest.rewards)));
      if (entry.claimed) row.appendChild(h('span', 'quest-row__state', '✔ Claimed'));
      else if (entry.complete) {
        const claim = button('Claim', 'btn--tiny btn--gold', 'quest.claim', { quest: quest.id });
        row.appendChild(claim);
      } else row.appendChild(h('span', 'quest-row__state', 'In progress'));
      ui.questList.appendChild(row);
    });
  }

  /* ============================================================
   * 9. Shop
   * ========================================================== */
  function buildShop() {
    const parts = section('shop', 'Shop', 'Spend coins and gems earned in battle');
    const grid = h('div', 'shop-grid');
    grid.id = 'shop-grid';
    parts.body.appendChild(grid);
    ui.shopGrid = grid;
    return parts;
  }

  function renderShop() {
    if (!Account || !Account.isReady()) return;
    ui.shopGrid.innerHTML = '';
    Systems.Shop.entries().forEach(function (entry) {
      const def = entry.def;
      const card = h('div', 'shop-card');
      card.setAttribute('data-shop', def.id);
      card.appendChild(h('span', 'shop-card__glyph', def.glyph || '◆'));
      card.appendChild(h('span', 'shop-card__name', def.name));
      card.appendChild(h('span', 'shop-card__desc', def.description || ''));
      const price = h('span', 'shop-card__price', (entry.currency === 'gems' ? '💎 ' : '🪙 ') + Format.int(def.price));
      card.appendChild(price);
      if (def.kind === 'potion') card.appendChild(h('span', 'shop-card__owned', 'Owned ×' + entry.owned));
      const buy = button('Buy', 'btn--tiny ' + (entry.affordable ? 'btn--gold' : ''), 'shop.buy', { shop: def.id });
      if (!entry.affordable) buy.classList.add('is-disabled');
      card.appendChild(buy);
      ui.shopGrid.appendChild(card);
    });
  }

  /* ============================================================
   * 10. Settings
   * ========================================================== */
  function buildSettings() {
    const parts = section('settings', 'Settings', 'Audio · controls · account');
    const list = h('div', 'settings-list');
    [
      { key: 'music', label: 'Music', note: 'Ambient fantasy score' },
      { key: 'sfx', label: 'Sound effects', note: 'Attacks, hits, rewards' },
      { key: 'showDamage', label: 'Damage numbers', note: 'Floating combat text' },
      { key: 'touchControls', label: 'Touch controls', note: 'On-screen D-pad and attack' },
      { key: 'screenShake', label: 'Screen shake', note: 'Impact feedback' }
    ].forEach(function (row) {
      const item = h('label', 'settings-row');
      item.appendChild(h('span', 'settings-row__label', row.label));
      item.appendChild(h('span', 'settings-row__note', row.note));
      const input = doc.createElement('input');
      input.type = 'checkbox';
      input.id = 'setting-' + row.key;
      input.setAttribute('data-setting', row.key);
      item.appendChild(input);
      list.appendChild(item);
    });
    parts.body.appendChild(list);

    const accountPanel = h('div', 'panel');
    accountPanel.appendChild(h('h3', 'block-title', 'Account'));
    accountPanel.appendChild(h('p', 'panel-hint', 'Signed in as'));
    const who = h('p', 'settings-who', '—');
    who.id = 'settings-who';
    accountPanel.appendChild(who);
    const row = h('div', 'modal__row');
    row.appendChild(button('Save now', 'btn--tiny btn--gold', 'save'));
    row.appendChild(button('Sync now', 'btn--tiny', 'sync.now'));
    row.appendChild(button('Log out', 'btn--tiny btn--ghost', 'auth.logout'));
    accountPanel.appendChild(row);

    const syncLine = h('p', 'panel-hint settings-sync', '');
    syncLine.id = 'settings-sync';
    accountPanel.appendChild(syncLine);
    accountPanel.appendChild(h('p', 'panel-hint', 'Version ' + VERSION + ' · prototype build. Progress is saved on this device and synced to the Mythara server whenever it is reachable.'));
    parts.body.appendChild(accountPanel);

    const credits = h('div', 'panel');
    credits.appendChild(h('h3', 'block-title', 'About'));
    credits.appendChild(h('p', 'panel-hint', 'Mythara Online — an original fantasy RPG prototype. All characters, monsters, art, effects and animations are generated procedurally by this project. Arena duels are against AI bots; there is no online multiplayer.'));
    parts.body.appendChild(credits);

    return parts;
  }

  function renderSettings() {
    if (!Account || !Account.isReady()) return;
    const settings = Account.settings();
    Array.prototype.forEach.call(rootEl.querySelectorAll('[data-setting]'), function (input) {
      const key = input.getAttribute('data-setting');
      input.checked = !!settings[key];
    });
    if (ui.settingsWho) {
      const p = Account.profile();
      ui.settingsWho.textContent = (p.username || 'player') + (p.email ? ' · ' + p.email : '') + ' · account Lv. ' + p.level;
    }
    refreshSyncStatus();
  }

  /** One human-readable line about the account server. */
  function refreshSyncStatus() {
    const el = (ui && ui.settingsSync) || doc.getElementById('settings-sync');
    if (!el) return;
    if (!Sync) { el.textContent = 'Sync: offline build — progress lives on this device.'; return; }
    const state = Sync.status();
    if (state.mode !== 'cloud') {
      el.textContent = 'Sync: offline — ' + (state.lastError || 'playing on this device only.');
      return;
    }
    const labels = {
      online: 'connected',
      syncing: 'syncing…',
      connecting: 'connecting…',
      conflict: 'merging changes…',
      error: 'retrying'
    };
    const when = state.lastSyncAt ? ' · last sync ' + Format.timeAgo(state.lastSyncAt) : '';
    const pending = state.pending ? ' · unsaved changes queued' : '';
    el.textContent = 'Sync: ' + (labels[state.status] || state.status) + when + pending + ' · server: ' + state.server;
  }

  /* ============================================================
   * 11. Modals — daily rewards, unlock, results
   * ========================================================== */
  function showDailyModal() {
    const state = Systems.Daily.state();
    const wrap = h('div', 'modal__backdrop');
    const card = h('div', 'modal__card modal__card--daily');
    card.appendChild(h('h3', 'modal__title', 'Seven-day rewards'));
    card.appendChild(h('p', 'modal__body', state.canClaim
      ? 'Day ' + state.nextDay + ' is ready to claim.'
      : 'Come back in ' + Format.duration(state.nextInMs) + ' for the next reward.'));
    const strip = h('div', 'daily-strip');
    Items.DAILY_REWARDS.forEach(function (reward) {
      const claimed = state.streak >= reward.day && !state.canClaim || (state.canClaim && reward.day < state.nextDay);
      const today = state.canClaim ? reward.day === state.nextDay : false;
      const cell = h('div', 'daily-cell' + (claimed ? ' is-claimed' : '') + (today ? ' is-today' : ''));
      cell.setAttribute('data-day', reward.day);
      cell.appendChild(h('span', 'daily-cell__day', 'Day ' + reward.day));
      cell.appendChild(h('span', 'daily-cell__glyph', reward.glyph || '◆'));
      cell.appendChild(h('span', 'daily-cell__label', reward.label));
      cell.appendChild(h('span', 'daily-cell__amount', '×' + reward.amount));
      if (claimed) cell.appendChild(h('span', 'daily-cell__state', '✔'));
      strip.appendChild(cell);
    });
    card.appendChild(strip);

    const row = h('div', 'modal__row');
    if (state.canClaim) {
      const claim = button('Claim Day ' + state.nextDay, 'btn--gold', 'daily.claim');
      row.appendChild(claim);
    }
    const close = button(state.canClaim ? 'Later' : 'Close', 'btn--ghost', '');
    close.addEventListener('click', function () { closeModal('daily'); });
    row.appendChild(close);
    card.appendChild(row);
    wrap.appendChild(card);
    openModal('daily', wrap);
  }

  /** Character unlock sheet used by the (legacy) select screen. */
  function showUnlockModal(classId) {
    const status = Account.unlockStatus(classId);
    const classDef = (root.Mythara.Classes || {})[classId];
    if (!status.known || status.unlocked) { closeModal('unlock'); return; }

    const wrap = h('div', 'modal__backdrop');
    const card = h('div', 'modal__card');
    card.appendChild(h('h3', 'modal__title', 'Unlock ' + (classDef ? classDef.name : classId)));
    card.appendChild(h('p', 'modal__body', classDef ? classDef.description : ''));
    const facts = h('ul', 'stage-sheet__facts');
    const accountLevel = Account.profile().level;
    [
      ['Required account level', 'Lv. ' + status.level + (accountLevel >= status.level ? ' ✔' : ' ✖')],
      ['Coins', Format.int(status.coins) + (status.canAffordCoins ? ' ✔' : ' ✖')],
      ['Fragments', status.fragments + ' / ' + status.fragmentsRequired]
    ].forEach(function (row) {
      const li = h('li');
      li.appendChild(h('span', 'fact__label', row[0]));
      li.appendChild(h('span', 'fact__value', row[1]));
      facts.appendChild(li);
    });
    card.appendChild(facts);

    const row = h('div', 'modal__row');
    const unlock = button('Unlock now', 'btn--gold', 'unlock.buy', { class: classId });
    if (!status.canUnlock) unlock.classList.add('is-disabled');
    row.appendChild(unlock);
    if (!status.canAffordFragments) row.appendChild(h('span', 'panel-hint', 'Collect more fragments from stages and summons.'));
    const close = button('Close', 'btn--ghost', '');
    close.addEventListener('click', function () { closeModal('unlock'); });
    row.appendChild(close);
    card.appendChild(row);
    wrap.appendChild(card);
    openModal('unlock', wrap);
  }

  function showBattleResult(summary) {
    if (!summary) return;
    const wrap = h('div', 'modal__backdrop modal__backdrop--result');
    const card = h('div', 'modal__card modal__card--result ' + (summary.victory ? 'is-victory' : 'is-defeat'));
    card.appendChild(h('h3', 'modal__title', summary.victory ? (summary.kind === 'arena' ? 'Victory!' : 'Stage cleared!') : 'Defeat'));

    if (summary.kind === 'stage' && summary.victory) {
      const stars = h('div', 'result-stars');
      for (let i = 1; i <= 3; i++) {
        const star = h('span', 'result-star' + (summary.stars >= i ? ' is-on' : ''), '★');
        star.style.animationDelay = (i * 160) + 'ms';
        stars.appendChild(star);
      }
      card.appendChild(stars);
      const rules = h('p', 'result-rules', summary.stars === 3
        ? 'Flawless — no knockouts and 70%+ HP kept.'
        : (summary.stars === 2 ? 'Cleared without falling in battle.' : 'Cleared with a Second Wind revive.'));
      card.appendChild(rules);
    }

    const facts = h('ul', 'stage-sheet__facts');
    facts.appendChild(factRow('Time', Format.duration(summary.elapsedMs)));
    facts.appendChild(factRow('Monsters defeated', String(summary.kills)));
    if (summary.kind === 'arena') {
      facts.appendChild(factRow('Bot difficulty', summary.difficulty ? summary.difficulty.name : '—'));
      if (summary.ratingAfter !== null && summary.ratingAfter !== undefined) {
        facts.appendChild(factRow('Rating', (summary.ratingChange >= 0 ? '+' : '') + summary.ratingChange + ' → ' + summary.ratingAfter));
      }
    }
    card.appendChild(facts);

    if (summary.rewards) {
      const rewards = h('div', 'result-rewards');
      rewards.appendChild(h('h4', 'block-title', 'Rewards'));
      resultRewardRows(summary.rewards).forEach(function (text) {
        rewards.appendChild(h('span', 'reward-pill', text));
      });
      card.appendChild(rewards);
    }

    const row = h('div', 'modal__row');
    if (summary.kind === 'stage' && summary.victory) {
      const next = Stages.nextStage(summary.stage.id);
      if (next) row.appendChild(button('Next stage ▶', 'btn--gold', 'stage.start', { stage: next.id }));
      row.appendChild(button('Adventure', '', 'menu.adventure'));
    } else if (summary.kind === 'arena') {
      row.appendChild(button('Duel again', 'btn--gold', 'menu.arena'));
      row.appendChild(button('Main menu', '', 'menu'));
    } else {
      row.appendChild(button('Retry', 'btn--gold', 'stage.start', { stage: summary.stage.id }));
      row.appendChild(button('Adventure', '', 'menu.adventure'));
    }
    card.appendChild(row);
    wrap.appendChild(card);
    openModal('result', wrap);
  }

  function factRow(label, value) {
    const li = h('li');
    li.appendChild(h('span', 'fact__label', label));
    li.appendChild(h('span', 'fact__value', value));
    return li;
  }

  function resultRewardRows(rewards) {
    const out = [];
    if (rewards.coins) out.push('🪙 ' + Format.int(rewards.coins) + ' coins');
    if (rewards.gems) out.push('💎 ' + Format.int(rewards.gems) + ' gems');
    if (rewards.xp) out.push('✦ ' + Format.int(rewards.xp) + ' EXP');
    if (rewards.tickets) out.push('🎫 ' + rewards.tickets + ' summon ticket' + (rewards.tickets > 1 ? 's' : ''));
    (rewards.materials || []).forEach(function (entry) {
      out.push('◆ ' + (Items.material(entry.id) || { name: entry.id }).name + ' ×' + entry.count);
    });
    (rewards.equipment || []).forEach(function (item) { if (item) out.push('⚔︎ ' + Systems.Items.name(item)); });
    if (rewards.firstClear) out.push('★ First clear bonus');
    return out;
  }

  /* ============================================================
   * 12. Battle HUD overlay
   * ========================================================== */
  function buildBattleHud() {
    const overlay = h('div', 'battle-hud');
    overlay.id = 'battle-hud';
    overlay.hidden = true;

    const top = h('div', 'battle-hud__top');
    const wave = h('span', 'wave-pill', 'Wave 1 / 5');
    wave.id = 'battle-wave';
    top.appendChild(wave);
    const objective = h('span', 'objective-pill', '');
    objective.id = 'battle-objective';
    top.appendChild(objective);
    top.appendChild(button('⏸ Leave', 'btn--tiny btn--ghost', 'battle.leave'));
    overlay.appendChild(top);

    const bossWrap = h('div', 'boss-bar');
    bossWrap.id = 'boss-bar';
    bossWrap.hidden = true;
    const bossHead = h('div', 'boss-bar__head');
    bossHead.appendChild(h('span', 'boss-bar__name', 'Boss'));
    bossHead.appendChild(h('span', 'boss-bar__phase', ''));
    bossWrap.appendChild(bossHead);
    const track = h('div', 'menu-bar__track menu-bar__track--big');
    const fill = h('i', 'menu-bar__fill menu-bar__fill--boss');
    track.appendChild(fill);
    bossWrap.appendChild(track);
    overlay.appendChild(bossWrap);

    const bottom = h('div', 'battle-hud__bottom');
    const potions = h('div', 'potion-bar');
    potions.id = 'potion-bar';
    bottom.appendChild(potions);
    overlay.appendChild(bottom);

    rootEl.appendChild(overlay);
    ui.battleHud = overlay;
    ui.battleWave = wave;
    ui.battleObjective = objective;
    ui.bossBar = bossWrap;
    ui.bossFill = fill;
    ui.bossName = bossHead.querySelector('.boss-bar__name');
    ui.bossPhase = bossHead.querySelector('.boss-bar__phase');
    ui.potionBar = potions;
    return overlay;
  }

  function showBattleHud(info) {
    if (!ui.battleHud) return;
    ui.battleHud.hidden = false;
    updateBattleHud(info);
    renderPotionBar();
  }

  function hideBattleHud() {
    if (ui.battleHud) ui.battleHud.hidden = true;
  }

  function updateBattleHud(info) {
    if (!ui.battleHud || ui.battleHud.hidden) return;
    if (info && info.wave) {
      ui.battleWave.textContent = info.wave.label
        ? info.wave.label.replace('Wave', 'Wave') + ' · ' + info.wave.index + '/' + info.wave.total
        : 'Wave ' + info.wave.index + ' / ' + info.wave.total;
    }
    if (info && info.objective) ui.battleObjective.textContent = info.objective;

    const boss = root.MytharaBattle && root.MytharaBattle.current() && root.MytharaBattle.boss();
    if (boss && boss.isBoss) {
      ui.bossBar.hidden = false;
      ui.bossName.textContent = boss.name + ' · Lv. ' + boss.level;
      const ratio = Math.max(0, boss.hp / boss.maxHp);
      ui.bossFill.style.width = Math.round(ratio * 100) + '%';
      ui.bossPhase.textContent = boss.phaseIndex !== undefined ? ('Phase ' + (boss.phaseIndex + 1) + (boss.enraged ? ' · ENRAGED' : '')) : '';
    } else if (ui.bossBar) {
      ui.bossBar.hidden = true;
    }
    renderPotionBar();
  }

  function renderPotionBar() {
    if (!ui.potionBar || !Account || !Account.isReady()) return;
    ui.potionBar.innerHTML = '';
    Object.keys(Items.POTIONS).forEach(function (id) {
      const potion = Items.potion(id);
      const count = Account.potionCount(id);
      const btn = button('', 'potion-btn' + (count ? '' : ' is-empty'), 'battle.potion', { potion: id });
      btn.appendChild(h('span', 'potion-btn__glyph', potion.glyph || '❤'));
      btn.appendChild(h('span', 'potion-btn__count', '×' + count));
      btn.setAttribute('aria-label', potion.name + ', ' + count + ' left');
      ui.potionBar.appendChild(btn);
    });
  }

  /* ============================================================
   * 13. Character-select decorator (locks + unlock buttons)
   * ========================================================== */
  function decorateCharacterSelect() {
    const grid = doc.getElementById('class-grid');
    if (!grid || !Account || !Account.isReady()) return;
    const p = Account.profile();

    Array.prototype.forEach.call(grid.querySelectorAll('[data-class]'), function (card) {
      const classId = card.getAttribute('data-class');
      const status = Account.unlockStatus(classId);
      const oldLock = card.querySelector('.class-lock');
      if (oldLock) oldLock.remove();

      if (status.known && status.unlocked) {
        card.classList.remove('is-locked');
        card.removeAttribute('aria-disabled');
        return;
      }
      if (!status.known) { card.classList.add('is-locked'); return; }

      card.classList.add('is-locked');
      card.setAttribute('aria-disabled', 'true');
      const lock = h('span', 'class-lock');
      lock.appendChild(h('span', 'class-lock__icon', '🔒'));
      lock.appendChild(h('span', 'class-lock__line', 'Lv. ' + status.level));
      lock.appendChild(h('span', 'class-lock__line', '🪙 ' + Format.int(status.coins)));
      lock.appendChild(h('span', 'class-lock__line', status.fragments + '/' + status.fragmentsRequired + ' ✦'));
      lock.appendChild(h('span', 'class-lock__badge', status.canUnlock ? 'READY' : 'LOCKED'));
      if (status.canUnlock) lock.classList.add('is-ready');
      card.appendChild(lock);
    });
    void p;
  }

  /** In app mode, locked cards open the unlock sheet instead of the preview. */
  function bindCharacterSelect() {
    const grid = doc.getElementById('class-grid');
    if (!grid) return;
    grid.addEventListener('click', function (event) {
      const card = event.target.closest ? event.target.closest('[data-class]') : null;
      if (!card) return;
      const classId = card.getAttribute('data-class');
      if (card.classList.contains('is-locked')) {
        event.stopPropagation();
        event.preventDefault();
        toast('Locked class — see requirements.', 'warn');
        showUnlockModal(classId);
      }
    }, true);
  }

  /* ============================================================
   * 14. Loading screen helpers
   * ========================================================== */
  function loadingStep(percent, text) {
    const fill = doc.getElementById('loading-fill');
    const label = doc.getElementById('loading-text');
    if (fill) fill.style.width = Math.round(Core.clamp(percent, 0, 100)) + '%';
    if (label && text) label.textContent = text;
  }

  function setLoadingTip() {
    const tip = doc.getElementById('loading-tip');
    if (tip) tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  }

  function setLoadingVersion() {
    const el = doc.getElementById('loading-version');
    if (el) el.textContent = 'v' + VERSION;
  }

  /* ============================================================
   * Mount
   * ========================================================== */
  function mount(document_, options) {
    doc = document_;
    const opts = options || {};
    rootEl = opts.root || doc.getElementById('app-root') || doc.body;
    ui.modals = {};
    ui.toastStack = doc.getElementById('toast-stack');
    ui.modalRoot = doc.getElementById('modal-root');
    if (!ui.modalRoot) {
      ui.modalRoot = doc.createElement('div');
      ui.modalRoot.id = 'modal-root';
      (doc.body || rootEl).appendChild(ui.modalRoot);
    }

    const nodes = {
      auth: buildAuth(),
      menu: buildMenu(),
      adventure: buildAdventure(),
      arena: buildArena(),
      inventory: buildInventory(),
      equipment: buildEquipment(),
      summon: buildSummon(),
      quests: buildQuests(),
      shop: buildShop(),
      settings: buildSettings()
    };

    const renderers = {
      auth: function () { showAuthError(''); },
      menu: renderMenu,
      adventure: function () { renderAdventure(ui.adventureChapter); },
      arena: renderArena,
      inventory: renderInventory,
      equipment: renderEquipment,
      summon: renderSummon,
      quests: renderQuests,
      shop: renderShop,
      settings: renderSettings
    };

    Object.keys(nodes).forEach(function (name) {
      register(name, nodes[name].el, renderers[name]);
    });

    // menu hero element handles
    ui.menuName = rootEl.querySelector('.menu-hero__name');
    ui.menuClass = rootEl.querySelector('.menu-hero__class');
    ui.menuRank = rootEl.querySelector('.menu-hero__rank');
    ui.menuPortrait = rootEl.querySelector('.menu-hero__portrait');
    ui.authError = doc.getElementById('auth-error');
    ui.settingsWho = doc.getElementById('settings-who');
    ui.settingsSync = doc.getElementById('settings-sync');

    buildBattleHud();
    bindActions();
    bindSettingToggles();
    bindCharacterSelect();
    setLoadingVersion();
    setLoadingTip();

    Bus.on('account:changed', function () { refreshHud(); refresh(); });
    Bus.on('gear:changed', refreshHud);
    Bus.on('gear:upgraded', refreshHud);
    Bus.on('sync:status', function () { refreshSyncStatus(); });

    return { screens: screens, show: show };
  }

  function bindSettingToggles() {
    (doc.body || rootEl).addEventListener('change', function (event) {
      const input = event.target;
      if (!input || !input.getAttribute || !input.getAttribute('data-setting')) return;
      Bus.emit('ui:action', {
        action: 'settings.toggle',
        payload: { key: input.getAttribute('data-setting'), value: input.checked ? '1' : '' }
      });
    });
  }

  /* ============================================================
   * Public API
   * ========================================================== */
  const UI = {
    mount: mount,
    show: show,
    current: current,
    refresh: refresh,
    refreshHud: refreshHud,
    refreshSyncStatus: refreshSyncStatus,
    toast: toast,
    confirm: confirmDialog,
    openModal: openModal,
    closeModal: closeModal,
    showDailyModal: showDailyModal,
    showUnlockModal: showUnlockModal,
    showBattleResult: showBattleResult,
    showSummonResults: showSummonResults,
    decorateCharacterSelect: decorateCharacterSelect,
    loadingStep: loadingStep,
    setLoadingTip: setLoadingTip,
    showBattleHud: showBattleHud,
    hideBattleHud: hideBattleHud,
    updateBattleHud: updateBattleHud,
    renderPotionBar: renderPotionBar,
    openStageDetail: openStageDetail,
    nextStageInfo: nextStageInfo,
    TILES: TILES,
    TIPS: TIPS,
    get ui() { return ui; }
  };

  root.MytharaUI = UI;
  if (typeof module !== 'undefined' && module.exports) module.exports = UI;

})(typeof globalThis !== 'undefined' ? globalThis : this);
