/* ============================================================
 * Mythara Online — tools/lib/harness.js
 * ------------------------------------------------------------
 * Boots Mythara Online headlessly in jsdom with a real Skia-backed
 * canvas (@napi-rs/canvas), signs in through the real forms, creates
 * a hero and drives the real gameplay entry points (App.handleAction,
 * keyboard input) so the 3D renderer produces inspectable frames.
 *
 *   const h = await createHarness({ quality: 'high' });
 *   await h.signIn({ user: 'shotdemo', pass: 'swordfish7' });
 *   await h.createHero('warrior', 'Jingle');
 *   await h.unlockThrough('c4-2');
 *   await h.enterScene({ scene: 'battle', stage: 'c4-2' });
 *   h.pump(30);
 *   h.shot('shots/c4-2.png');
 *   await h.close();
 *
 * Dev tool only — requires `npm i --no-save jsdom @napi-rs/canvas`.
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { createCanvas } = require('@napi-rs/canvas');
const { buildInlineHtml } = require('./inline');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} [o]
 * @param {string} [o.quality]  low | medium | high | auto (URL flag)
 * @param {boolean} [o.render2d] boot the legacy 2D renderer instead
 * @param {number}  [o.time]    0..1 time of day
 * @param {string[]} [o.skip]   render sections to skip (__MM_SKIP__)
 * @param {boolean} [o.noClouds] disable the cloud layer
 * @param {boolean} [o.profile] collect per-section frame timings
 * @param {number}  [o.width]   canvas width in CSS pixels (default 960)
 * @param {number}  [o.height]  canvas height in CSS pixels (default 540)
 */
async function createHarness(o) {
  const opts = Object.assign({ quality: 'high', width: 960, height: 540 }, o || {});
  const canvasMap = new WeakMap();
  const rafQueue = [];
  const errors = [];
  const consoleErrors = [];
  const store = {};
  let clock = 0;

  function canvasFor(el) {
    let entry = canvasMap.get(el);
    if (!entry || entry.w !== el.width || entry.h !== el.height) {
      const canvas = createCanvas(Math.max(2, el.width), Math.max(2, el.height));
      entry = { w: el.width, h: el.height, canvas: canvas, ctx: canvas.getContext('2d') };
      canvasMap.set(el, entry);
    }
    return entry;
  }

  const url = 'http://localhost:8123/?quality=' + opts.quality + (opts.render2d ? '&render=2d' : '') +
    (opts.time === undefined ? '' : '&time=' + opts.time);

  const dom = new JSDOM(buildInlineHtml(), {
    url: url,
    runScripts: 'dangerously',
    pretendToBeVisual: false,
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = function (type) {
        if (type !== '2d') return null;
        return canvasFor(this).ctx;
      };
      window.HTMLCanvasElement.prototype.toDataURL = function () { return ''; };
      Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
      window.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
      window.cancelAnimationFrame = () => {};
      window.matchMedia = () => ({
        matches: false, media: '', addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}
      });
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
          getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); },
          removeItem: (k) => { delete store[k]; },
          clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
          key: (i) => Object.keys(store)[i] || null,
          get length() { return Object.keys(store).length; }
        }
      });
      if (opts.skip && opts.skip.length) {
        window.__MM_SKIP__ = opts.skip.reduce((a, k) => { a[k] = true; return a; }, {});
      }
      if (opts.noClouds) window.__MM_NO_CLOUDS__ = true;
      if (opts.profile) window.__MM_PROFILE__ = true;
      // deterministic high-resolution clock for the section profiler
      window.__MM_CLOCK__ = () => Number(process.hrtime.bigint()) / 1e6;
      window.addEventListener('error', (e) => errors.push(String((e.error && e.error.stack) || e.message)));
      window.console.error = (...a) => { consoleErrors.push(a.map(String).join(' ')); };
    }
  });

  const win = dom.window;
  const doc = win.document;
  await wait(2400);                                   // let the app boot

  const App = win.MytharaApp;
  const Game = win.Mythara && win.Mythara.Game;
  const Account = win.MytharaAccount && win.MytharaAccount.Account;
  const Render3D = win.MytharaRender3D;
  const Enemies = win.MYTHARA_ENEMIES;
  if (!App || !Game || !Account || !Render3D) throw new Error('boot failed — the game did not initialise in jsdom');

  const canvasSize = { width: opts.width, height: opts.height };

  function sizeCanvas() {
    const canvas = doc.getElementById('game-canvas');
    if (canvas) {
      canvas.width = canvasSize.width;
      canvas.height = canvasSize.height;
      Render3D.resize && Render3D.resize();
    }
  }

  /** Screen size the game should lay out for (jsdom has no clientWidth). */
  function resize(width, height) {
    canvasSize.width = width || canvasSize.width;
    canvasSize.height = height || canvasSize.height;
    sizeCanvas();
  }
  sizeCanvas();

  /** Run one animation frame per queued callback; returns the batch cost in ms. */
  function step(ms) {
    const batch = rafQueue.splice(0, rafQueue.length);
    clock += (ms || 16.7);
    const t0 = process.hrtime.bigint();
    batch.forEach((cb) => {
      try { cb(clock); } catch (e) { errors.push('raf: ' + e.stack); }
    });
    return Number(process.hrtime.bigint() - t0) / 1e6;
  }

  /** Pump N frames, keeping the HUD/minimap in step like the real loop does. */
  function pump(frames, onFrame) {
    const count = frames === undefined ? 1 : frames;
    const times = [];
    for (let i = 0; i < count; i++) {
      const ms = step(16.7);
      times.push(ms);
      try { Render3D.tickHud(0.0167, Game.state); } catch (e) { errors.push('hud: ' + e.stack); }
      if (onFrame) onFrame(i, ms);
    }
    return times;
  }

  function dismissModal() {
    const button = doc.querySelector('[data-action="modal.ok"], .modal__card .btn--gold, [data-action="battle.leave"]');
    if (button) { button.click(); return true; }
    return false;
  }

  function key(code, down) {
    const event = new win.KeyboardEvent(down === false ? 'keyup' : 'keydown', { code: code, key: code, bubbles: true });
    doc.dispatchEvent(event);
    return event;
  }

  /** Queue a player attack through the real keyboard input path. */
  function attack() {
    key('Space');
    return () => key('Space', false);
  }

  /** Walk in a direction (or stop) through the real keyboard input path. */
  function move(dir, held) {
    const codes = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };
    return key(codes[dir] || dir, held);
  }

  async function signIn(o2) {
    const creds = Object.assign({ user: 'shotdemo', pass: 'swordfish7', email: 'shot@mythara.gg' }, o2 || {});
    const loginTab = doc.querySelector('.tab[data-tab="login"]');
    const register = !doc.getElementById('reg-user') || !doc.getElementById('reg-user').closest('.is-hidden');
    if (register) {
      doc.querySelector('.tab[data-tab="register"]').click();
      doc.getElementById('reg-user').value = creds.user;
      doc.getElementById('reg-email').value = creds.email;
      doc.getElementById('reg-pass').value = creds.pass;
      doc.getElementById('reg-pass2').value = creds.pass;
      doc.querySelector('[data-action="auth.register"]').click();
    } else {
      if (loginTab) loginTab.click();
      doc.getElementById('login-user').value = creds.user;
      doc.getElementById('login-pass').value = creds.pass;
      doc.querySelector('[data-action="auth.login"]').click();
    }
    await wait(320);
    return !!(win.MytharaApp && doc.querySelector('[data-action="menu.play"]'));
  }

  async function createHero(classId, name) {
    App.handleAction('menu.play', {});
    await wait(160);
    const card = doc.querySelector('[data-class="' + (classId || 'warrior') + '"]');
    if (!card) throw new Error('class card missing for ' + classId);
    card.click();
    const nameInput = doc.getElementById('char-name');
    if (nameInput) nameInput.value = name || 'Jingle';
    await wait(90);
    const button = doc.getElementById('create-character');
    if (button) button.click();
    await wait(240);
    return Game.state.player;
  }

  /** Clear every stage before `stageId` the way normal play would. */
  function unlockThrough(stageId) {
    const m = /^c(\d+)-(\d+)$/.exec(stageId);
    if (!m) return false;
    const chapter = parseInt(m[1], 10), index = parseInt(m[2], 10);
    const before = [];
    for (let c = 1; c < chapter; c++) for (let s = 1; s <= 5; s++) before.push('c' + c + '-' + s);
    for (let s = 1; s < index; s++) before.push('c' + chapter + '-' + s);
    before.forEach((id) => Account.recordStageClear(id, { stars: 3, timeMs: 4000 }));
    const profile = Account.profile();
    profile.chaptersUnlocked = Math.max(chapter, profile.chaptersUnlocked || 1);
    for (let i = 0; i < 700; i++) Account.addExp(240);
    Account.addEnergy && Account.addEnergy(500);
    Account.save();
    return Account.stageUnlocked(stageId);
  }

  /** Enter a scene through the real gameplay entry points, with retries. */
  async function enterScene(o2) {
    const scene = (o2 && o2.scene) || 'battle';
    const stage = (o2 && o2.stage) || 'c1-1';
    const arena = (o2 && o2.arena) || 'normal';
    for (let attempt = 0; attempt < 4; attempt++) {
      if (scene === 'hub') {
        Game.setScreen('game');
        Game.setZoneTheme(null, 'Verdant Hollow — Training Grounds');
        Game.setMode('free');
        Game.clearEnemies && Game.clearEnemies();
        const def = Enemies && Enemies.get('forestGoblin');
        if (def) Game.spawnEnemies([Game.createEnemy(def, 3, {})]);
      } else if (scene === 'arena') {
        App.handleAction('arena.start', { arena: arena });
      } else {
        App.handleAction('stage.start', { stage: stage });
      }
      await wait(340);
      if (Game.state.screen === 'game') { pump(16); return true; }
      dismissModal();
      await wait(180);
    }
    return false;
  }

  function setTime(t) { Render3D.setTimeOfDay(t); }
  function setQuality(q) { Render3D.setQuality(q); }

  function shot(target) {
    const file = path.resolve(target);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const canvas = doc.getElementById('game-canvas');
    if (!canvas) throw new Error('game canvas missing');
    fs.writeFileSync(file, canvasFor(canvas).canvas.toBuffer('image/png'));
    return file;
  }

  function shotElement(id, target) {
    const el = doc.getElementById(id);
    if (!el) return null;
    const file = path.resolve(target);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, canvasFor(el).canvas.toBuffer('image/png'));
    return file;
  }

  function stats() { return Render3D.stats(); }
  function profile() {
    const p = Render3D.state && Render3D.state.profile;
    if (!p) return {};
    const copy = {};
    Object.keys(p).forEach((k) => { copy[k] = p[k]; });
    return copy;
  }
  function resetProfile() {
    const p = Render3D.state && Render3D.state.profile;
    if (p) Object.keys(p).forEach((k) => { p[k] = 0; });
  }

  function summary() {
    return {
      screen: Game.state.screen,
      mode: Game.state.mode,
      monsters: (Game.state.monsters || []).length,
      hero: Game.state.player ? Game.state.player.classId : null,
      theme: Render3D.themeId,
      stats: Render3D.stats(),
      errors: errors.slice(0, 3),
      consoleErrors: consoleErrors.slice(0, 3)
    };
  }

  return {
    dom, win, doc, errors, consoleErrors, store, canvasMap,
    App, Game, Account, Render3D, Enemies,
    wait, pump, step, resize, sizeCanvas, dismissModal, key, attack, move,
    signIn, createHero, unlockThrough, enterScene, setTime, setQuality,
    shot, shotElement, stats, profile, resetProfile, summary,
    close() { try { dom.window.close(); } catch (e) { /* jsdom already gone */ } }
  };
}

module.exports = { createHarness, wait };
