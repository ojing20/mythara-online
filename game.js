/* ============================================================
 * Mythara Online — game.js
 * ------------------------------------------------------------
 * MVP foundation engine. Pure HTML/CSS/JS, no dependencies.
 *
 * Module map (all attached to window.Mythara for later expansion):
 *   Utils     — math + injectable RNG helpers
 *   Input     — keyboard + touch/pointer input for movement & attack
 *   Combat    — damage rolls and range checks
 *   Effects   — floating combat text, particles, screen shake, banners
 *   Renderer  — procedural fantasy background + entity drawing
 *   HUD       — DOM status bars (HP / MP / EXP / gold / target)
 *   Log       — combat log
 *   Game      — state, update loop, public API
 *
 * Planned next steps (NOT implemented here): 10 classes, guilds,
 * PvP, dungeons, multiplayer. The Game already exposes hooks
 * (`Game.on`, `Game.registerSystem`) for those.
 * ============================================================ */
(function (root) {
  'use strict';

  const DATA = root.MYTHARA_DATA;
  if (!DATA) throw new Error('Mythara Online: data.js must be loaded before game.js');

  const CONFIG = DATA.CONFIG;
  const COMBAT = DATA.COMBAT;
  const PROGRESSION = DATA.PROGRESSION;
  const PLAYER_DEF = DATA.PLAYER;
  const ZONE = DATA.ZONES[DATA.activeZone];
  const MONSTER_DEF = DATA.MONSTERS[DATA.activeMonster];
  const WORLD = CONFIG.world;

  /* ============================================================
   * 1. UTILS
   * ========================================================== */
  const Utils = (function () {
    let rng = Math.random;          // swappable for deterministic tests

    function clamp(value, min, max) {
      return value < min ? min : value > max ? max : value;
    }

    function random() { return rng(); }

    function randRange(min, max) { return min + random() * (max - min); }

    function randInt(min, max) { return Math.floor(randRange(min, max + 1)); }

    function pick(list) { return list[Math.floor(random() * list.length)]; }

    function distance(ax, ay, bx, by) {
      const dx = bx - ax;
      const dy = by - ay;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function hexToRgb(hex) {
      const value = hex.replace('#', '');
      const full = value.length === 3 ? value.split('').map(function (c) { return c + c; }).join('') : value;
      const num = parseInt(full, 16);
      return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    }

    function rgba(hex, alpha) {
      const c = hexToRgb(hex);
      return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + alpha + ')';
    }

    /** Deterministic 0..1 generator (mulberry32) used for the background art. */
    function seededRandom(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function setRng(fn) { rng = typeof fn === 'function' ? fn : Math.random; }
    function resetRng() { rng = Math.random; }

    return {
      clamp: clamp, random: random, randRange: randRange, randInt: randInt, pick: pick,
      distance: distance, rgba: rgba, seededRandom: seededRandom,
      setRng: setRng, resetRng: resetRng
    };
  })();

  /* ============================================================
   * 2. INPUT — keyboard, on-screen D-pad and attack button
   * ========================================================== */
  const Input = (function () {
    const DIRECTIONS = ['up', 'down', 'left', 'right'];
    const KEY_MAP = {
      ArrowUp: 'up', KeyW: 'up',
      ArrowDown: 'down', KeyS: 'down',
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right'
    };
    const ATTACK_KEYS = { Space: true, KeyJ: true, Enter: true };

    // Independent sources so keyboard and touch never cancel each other out.
    const sources = {
      keyboard: { up: false, down: false, left: false, right: false },
      touch: { up: false, down: false, left: false, right: false }
    };

    let attackHeld = false;
    let attackQueued = false;
    let bound = false;
    const listeners = { attack: [] };

    function isDown(dir) { return sources.keyboard[dir] || sources.touch[dir]; }

    function axis() {
      const x = (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0);
      const y = (isDown('down') ? 1 : 0) - (isDown('up') ? 1 : 0);
      if (x === 0 && y === 0) return { x: 0, y: 0, active: false };
      const length = Math.hypot(x, y) || 1;
      return { x: x / length, y: y / length, active: true };
    }

    function setDirection(source, dir, pressed) {
      if (!sources[source] || DIRECTIONS.indexOf(dir) === -1) return;
      sources[source][dir] = !!pressed;
    }

    function clearDirections(source) {
      if (!sources[source]) return;
      DIRECTIONS.forEach(function (d) { sources[source][d] = false; });
    }

    /** Queue a single attack (button tap / key press / canvas tap). */
    function queueAttack() { attackQueued = true; }

    function setAttackHeld(held) {
      attackHeld = !!held;
      if (attackHeld) attackQueued = true;
    }

    function consumeAttack() {
      const queued = attackQueued;
      attackQueued = false;
      return queued;
    }

    function isAttackHeld() { return attackHeld; }

    function on(name, handler) {
      if (listeners[name]) listeners[name].push(handler);
    }

    function emit(name, payload) {
      (listeners[name] || []).forEach(function (fn) { fn(payload); });
    }

    function bindKeyboard(target) {
      const doc = target || root.document;
      if (!doc || !doc.addEventListener) return;

      doc.addEventListener('keydown', function (event) {
        const dir = KEY_MAP[event.code];
        if (dir) {
          setDirection('keyboard', dir, true);
          event.preventDefault();
        }
        if (ATTACK_KEYS[event.code]) {
          setAttackHeld(true);
          event.preventDefault();
        }
      });

      doc.addEventListener('keyup', function (event) {
        const dir = KEY_MAP[event.code];
        if (dir) {
          setDirection('keyboard', dir, false);
          event.preventDefault();
        }
        if (ATTACK_KEYS[event.code]) {
          setAttackHeld(false);
          event.preventDefault();
        }
      });

      // Never keep moving if focus is lost (alt-tab, phone call, ...).
      root.addEventListener('blur', function () {
        clearDirections('keyboard');
        clearDirections('touch');
        setAttackHeld(false);
      });
    }

    /** Wire the DOM controls: D-pad, attack buttons, canvas tap. */
    function bindControls(doc, canvas) {
      if (!doc || bound) return;
      bound = true;

      const claim = function (element, event) {
        if (element.setPointerCapture && event.pointerId !== undefined) {
          try { element.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
        }
      };

      // --- D-pad buttons ---
      Array.prototype.forEach.call(doc.querySelectorAll('[data-dir]'), function (button) {
        const dir = button.getAttribute('data-dir');

        const press = function (event) {
          claim(button, event);
          setDirection('touch', dir, true);
          button.classList.add('is-active');
          if (event.cancelable) event.preventDefault();
        };
        const release = function (event) {
          setDirection('touch', dir, false);
          button.classList.remove('is-active');
          if (event && event.cancelable) event.preventDefault();
        };

        button.addEventListener('pointerdown', press);
        button.addEventListener('pointerup', release);
        button.addEventListener('pointercancel', release);
        button.addEventListener('pointerleave', release);
        button.addEventListener('lostpointercapture', release);
        button.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      });

      // --- Attack buttons (action bar + touch cluster) ---
      Array.prototype.forEach.call(doc.querySelectorAll('#attack-button, #touch-attack'), function (button) {
        button.addEventListener('pointerdown', function (event) {
          claim(button, event);
          setAttackHeld(true);
          if (event.cancelable) event.preventDefault();
        });
        const release = function () { setAttackHeld(false); };
        button.addEventListener('pointerup', release);
        button.addEventListener('pointercancel', release);
        button.addEventListener('pointerleave', release);
        button.addEventListener('click', function (event) {
          queueAttack();                 // keyboard / assistive-tech activation
          emit('attack', { source: 'button', event: event });
        });
        button.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      });

      // --- Tap the world to attack ---
      if (canvas && canvas.addEventListener) {
        canvas.addEventListener('pointerdown', function (event) {
          setAttackHeld(true);
          claim(canvas, event);
          if (event.cancelable) event.preventDefault();
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
          canvas.addEventListener(type, function () { setAttackHeld(false); });
        });
      }
    }

    function reset() {
      clearDirections('keyboard');
      clearDirections('touch');
      attackHeld = false;
      attackQueued = false;
    }

    return {
      axis: axis,
      isDown: isDown,
      setDirection: setDirection,
      clearDirections: clearDirections,
      queueAttack: queueAttack,
      setAttackHeld: setAttackHeld,
      isAttackHeld: isAttackHeld,
      consumeAttack: consumeAttack,
      bindKeyboard: bindKeyboard,
      bindControls: bindControls,
      on: on,
      reset: reset,
      sources: sources
    };
  })();

  /* ============================================================
   * 3. COMBAT — damage math shared by all actors
   * ========================================================== */
  const Combat = (function () {
    /** Roll damage from `attacker` against `defender`. */
    function rollDamage(attacker, defender) {
      const variance = Utils.randRange(COMBAT.varianceMin, COMBAT.varianceMax);
      const raw = attacker.attack * variance - defender.defense * 0.8;
      let damage = Math.max(COMBAT.minDamage, Math.round(raw));
      const crit = Utils.random() < COMBAT.critChance;
      if (crit) damage = Math.round(damage * COMBAT.critMultiplier);
      return { damage: damage, crit: crit };
    }

    /** True when two circular actors are within `range` of each other's edge. */
    function inRange(a, b, range) {
      const gap = Utils.distance(a.pos.x, a.pos.y, b.pos.x, b.pos.y) - (a.radius + b.radius);
      return gap <= range;
    }

    return { rollDamage: rollDamage, inRange: inRange };
  })();

  /* ============================================================
   * 4. ENTITIES
   * ========================================================== */
  function createPlayer() {
    return {
      kind: 'player',
      id: PLAYER_DEF.id,
      name: PLAYER_DEF.name,
      title: PLAYER_DEF.title,
      level: PLAYER_DEF.level,
      hp: PLAYER_DEF.maxHp,
      maxHp: PLAYER_DEF.maxHp,
      mp: PLAYER_DEF.maxMp,
      maxMp: PLAYER_DEF.maxMp,
      attack: PLAYER_DEF.attack,
      defense: PLAYER_DEF.defense,
      speed: PLAYER_DEF.speed,
      radius: PLAYER_DEF.radius,
      exp: 0,
      expToNext: PROGRESSION.baseExpToLevel,
      gold: 0,
      pos: { x: PLAYER_DEF.spawn.x, y: PLAYER_DEF.spawn.y },
      facing: { x: PLAYER_DEF.facing.x, y: PLAYER_DEF.facing.y },
      moving: false,
      walkPhase: 0,
      attackCooldown: 0,
      attackAnim: 0,
      hitFlash: 0,
      hurtTimer: 0,
      downed: false,
      respawnTimer: 0,
      kills: 0
    };
  }

  function createMonster(def, zone) {
    void zone; // reserved for per-zone stat scaling later
    return {
      kind: 'monster',
      def: def,
      id: def.id,
      name: def.name,
      level: def.level,
      hp: def.maxHp,
      maxHp: def.maxHp,
      attack: def.attack,
      defense: def.defense,
      speed: def.speed,
      radius: def.radius,
      pos: { x: def.spawn.x, y: def.spawn.y },
      home: { x: def.spawn.x, y: def.spawn.y },
      alive: true,
      aggro: false,
      wanderTarget: { x: def.spawn.x, y: def.spawn.y },
      wanderTimer: Utils.randRange(0.4, 1.6),
      attackCooldown: 0,
      attackAnim: 0,
      hitFlash: 0,
      deathTimer: 0,
      respawnTimer: 0,
      spawnPulse: 0,
      bob: Utils.randRange(0, Math.PI * 2)
    };
  }

  /* ============================================================
   * 5. EFFECTS — floaters, particles, shake, banner
   * ========================================================== */
  const Effects = (function () {
    const floaters = [];
    const particles = [];
    let shake = 0;
    let bannerTimer = 0;

    function addFloater(x, y, text, options) {
      const opts = options || {};
      floaters.push({
        x: x, y: y, text: String(text),
        color: opts.color || '#ffffff',
        size: opts.size || 16,
        life: (opts.life || CONFIG.feedback.floaterLifetimeMs) / 1000,
        maxLife: (opts.life || CONFIG.feedback.floaterLifetimeMs) / 1000,
        vy: opts.vy !== undefined ? opts.vy : -34,
        vx: opts.vx !== undefined ? opts.vx : Utils.randRange(-8, 8),
        outline: opts.outline !== false
      });
      if (floaters.length > 40) floaters.shift();
    }

    function burst(x, y, color, count, options) {
      const opts = options || {};
      for (let i = 0; i < count; i++) {
        const angle = Utils.randRange(0, Math.PI * 2);
        const speed = Utils.randRange(opts.speedMin || 40, opts.speedMax || 150);
        particles.push({
          x: x, y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - (opts.lift || 30),
          size: Utils.randRange(opts.sizeMin || 2, opts.sizeMax || 5),
          color: color,
          life: Utils.randRange(0.35, 0.75),
          maxLife: 0.75,
          gravity: opts.gravity !== undefined ? opts.gravity : 220
        });
      }
      if (particles.length > 260) particles.splice(0, particles.length - 260);
    }

    function addShake(amount) { shake = Math.min(14, shake + amount); }

    function showBanner(text, durationMs) {
      bannerTimer = (durationMs || CONFIG.feedback.bannerDurationMs) / 1000;
      const el = HUD.el.banner;
      if (!el) return;
      el.textContent = text;
      el.hidden = false;
      // retrigger the CSS animation
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    }

    function update(dt) {
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.life -= dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.vy += 26 * dt;                 // gentle arc
        if (f.life <= 0) floaters.splice(i, 1);
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += p.gravity * dt;
        if (p.life <= 0) particles.splice(i, 1);
      }

      if (shake > 0) shake = Math.max(0, shake - CONFIG.feedback.shakeDecayPerSecond * dt);

      if (bannerTimer > 0) {
        bannerTimer -= dt;
        if (bannerTimer <= 0 && HUD.el.banner) HUD.el.banner.hidden = true;
      }
    }

    function reset() {
      floaters.length = 0;
      particles.length = 0;
      shake = 0;
      bannerTimer = 0;
      if (HUD.el.banner) HUD.el.banner.hidden = true;
    }

    return {
      floaters: floaters,
      particles: particles,
      addFloater: addFloater,
      burst: burst,
      addShake: addShake,
      showBanner: showBanner,
      update: update,
      reset: reset,
      getShake: function () { return shake; }
    };
  })();

  /* ============================================================
   * 6. RENDERER — procedural fantasy background + entities
   * ========================================================== */
  const Renderer = (function () {
    const ctx = { canvas: null, ctx2d: null, background: null, dpr: 1 };

    /* ---------- background (built once, cached) ---------- */
    function buildBackground() {
      const canvas = document.createElement('canvas');
      canvas.width = WORLD.width;
      canvas.height = WORLD.height;
      const c = canvas.getContext('2d');
      const p = ZONE.palette;
      const rand = Utils.seededRandom(20261001);
      const W = WORLD.width;
      const H = WORLD.height;
      const horizon = H * 0.44;
      const floorTop = WORLD.floorTop || horizon;

      // Sky
      const sky = c.createLinearGradient(0, 0, 0, horizon + 40);
      sky.addColorStop(0, p.skyTop);
      sky.addColorStop(1, p.skyBottom);
      c.fillStyle = sky;
      c.fillRect(0, 0, W, horizon + 40);

      // Sun with soft glow
      const sunX = W * 0.76;
      const sunY = H * 0.16;
      const glow = c.createRadialGradient(sunX, sunY, 8, sunX, sunY, 150);
      glow.addColorStop(0, 'rgba(255,246,205,0.95)');
      glow.addColorStop(0.35, 'rgba(255,240,190,0.35)');
      glow.addColorStop(1, 'rgba(255,240,190,0)');
      c.fillStyle = glow;
      c.beginPath();
      c.arc(sunX, sunY, 150, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = p.sun;
      c.beginPath();
      c.arc(sunX, sunY, 34, 0, Math.PI * 2);
      c.fill();

      drawMountainRange(c, p.mountainFar, horizon + 6, 168, W, rand, 5);
      drawMountainRange(c, p.mountainNear, horizon + 10, 112, W, rand, 8);

      // Rolling hills
      drawHills(c, p.hillFar, horizon + 26, 46, W, rand, 0.9);
      drawHills(c, p.hillNear, horizon + 74, 40, W, rand, 1.6);

      // Ground
      const ground = c.createLinearGradient(0, horizon, 0, H);
      ground.addColorStop(0, p.groundTop);
      ground.addColorStop(1, p.groundBottom);
      c.fillStyle = ground;
      c.fillRect(0, horizon, W, H - horizon);

      // Dirt path winding through the arena
      c.save();
      c.beginPath();
      c.moveTo(-20, H * 0.92);
      c.bezierCurveTo(W * 0.28, H * 0.86, W * 0.40, H * 0.68, W * 0.62, H * 0.70);
      c.bezierCurveTo(W * 0.82, H * 0.72, W * 0.92, H * 0.86, W + 20, H * 0.84);
      c.lineWidth = 62;
      c.lineCap = 'round';
      c.strokeStyle = Utils.rgba(p.path, 0.55);
      c.stroke();
      c.lineWidth = 34;
      c.strokeStyle = Utils.rgba(p.path, 0.45);
      c.stroke();
      c.restore();

      // Grass tufts (only on the playable floor)
      for (let i = 0; i < 150; i++) {
        const x = rand() * W;
        const y = floorTop + rand() * (H - floorTop - 14);
        const scale = 0.7 + (y - horizon) / (H - horizon) * 1.1;
        c.strokeStyle = Utils.rgba(rand() > 0.5 ? p.tree : p.treeDark, 0.35 + rand() * 0.3);
        c.lineWidth = 1.4;
        c.beginPath();
        c.moveTo(x, y);
        c.quadraticCurveTo(x + 2 * scale, y - 5 * scale, x + 4 * scale, y - 9 * scale);
        c.stroke();
      }

      // Wildflowers
      for (let i = 0; i < 26; i++) {
        const x = rand() * W;
        const y = floorTop + 34 + rand() * (H - floorTop - 54);
        c.fillStyle = ['#f7d1e0', '#ffe9a8', '#dcd0ff', '#fff5f5'][Math.floor(rand() * 4)];
        c.beginPath();
        c.arc(x, y, 2.2, 0, Math.PI * 2);
        c.fill();
      }

      // Rocks
      for (let i = 0; i < 9; i++) {
        const x = 40 + rand() * (W - 80);
        const y = floorTop + 26 + rand() * (H - floorTop - 62);
        const r = 6 + rand() * 12;
        c.fillStyle = Utils.rgba(p.rock, 0.75);
        c.beginPath();
        c.ellipse(x, y, r, r * 0.7, rand() * 0.6, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(255,255,255,0.18)';
        c.beginPath();
        c.ellipse(x - r * 0.25, y - r * 0.3, r * 0.45, r * 0.28, 0, 0, Math.PI * 2);
        c.fill();
      }

      // Distant tree line, sitting behind the horizon
      c.globalAlpha = 0.85;
      for (let i = 0; i < 14; i++) {
        const x = 20 + i * ((W - 40) / 13) + (rand() - 0.5) * 24;
        const y = horizon - 2 + rand() * 8;
        drawTree(c, x, y, 0.55 + rand() * 0.3, p, rand);
      }
      c.globalAlpha = 1;

      // Near tree line framing the arena from the scenery band
      for (let i = 0; i < 11; i++) {
        const x = 26 + i * ((W - 60) / 10) + (rand() - 0.5) * 30;
        const y = horizon + 12 + rand() * 14;
        drawTree(c, x, y, 0.95 + rand() * 0.45, p, rand);
      }

      // Low foreground bushes at the very edges (depth cue, out of the way)
      drawTree(c, 22, H - 12, 0.62, p, rand);
      drawTree(c, W - 24, H - 16, 0.58, p, rand);

      // Vignette to focus the play area
      const vignette = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.92);
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, 'rgba(6,4,18,0.42)');
      c.fillStyle = vignette;
      c.fillRect(0, 0, W, H);

      return canvas;
    }

    function drawMountainRange(c, color, baseY, height, width, rand, steps) {
      c.fillStyle = color;
      const step = width / steps;
      for (let i = 0; i < steps; i++) {
        const cx = i * step + step * (0.3 + rand() * 0.4);
        const h = height * (0.55 + rand() * 0.55);
        const half = step * (0.62 + rand() * 0.35);
        c.beginPath();
        c.moveTo(cx - half, baseY);
        c.lineTo(cx, baseY - h);
        c.lineTo(cx + half, baseY);
        c.closePath();
        c.fill();
        // snow / light cap
        c.fillStyle = 'rgba(255,255,255,0.16)';
        c.beginPath();
        c.moveTo(cx, baseY - h);
        c.lineTo(cx - half * 0.22, baseY - h * 0.74);
        c.lineTo(cx + half * 0.22, baseY - h * 0.74);
        c.closePath();
        c.fill();
        c.fillStyle = color;
      }
    }

    function drawHills(c, color, baseY, height, width, rand, wobble) {
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(0, baseY + height);
      for (let x = 0; x <= width; x += 24) {
        const y = baseY - Math.sin((x / width) * Math.PI * 2 * wobble + rand() * 0.02) * height * 0.35 - height * 0.25;
        c.lineTo(x, y);
      }
      c.lineTo(width, baseY + height);
      c.closePath();
      c.fill();
    }

    function drawTree(c, x, y, scale, p, rand) {
      c.fillStyle = p.trunk;
      c.fillRect(x - 3 * scale, y - 16 * scale, 6 * scale, 20 * scale);
      const blobs = [
        { dx: 0, dy: -30, r: 20 },
        { dx: -14, dy: -20, r: 14 },
        { dx: 14, dy: -21, r: 13 },
        { dx: 0, dy: -12, r: 15 }
      ];
      blobs.forEach(function (b, index) {
        c.fillStyle = index % 2 === 0 ? p.tree : p.treeDark;
        c.beginPath();
        c.arc(x + b.dx * scale, y + b.dy * scale, b.r * scale * (0.92 + rand() * 0.16), 0, Math.PI * 2);
        c.fill();
      });
    }

    /* ---------- canvas sizing ---------- */
    function init(canvas) {
      ctx.canvas = canvas;
      ctx.ctx2d = canvas.getContext('2d');
      ctx.background = buildBackground();
      resize();
      if (root.addEventListener) root.addEventListener('resize', resize);
      return ctx.ctx2d;
    }

    function resize() {
      if (!ctx.canvas) return;
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      ctx.dpr = dpr;
      ctx.canvas.width = Math.round(WORLD.width * dpr);
      ctx.canvas.height = Math.round(WORLD.height * dpr);
      if (ctx.ctx2d && ctx.ctx2d.setTransform) {
        ctx.ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }

    /* ---------- frame ---------- */
    function render(state) {
      const c = ctx.ctx2d;
      if (!c) return;

      c.save();
      const shake = Effects.getShake();
      if (shake > 0.05) {
        c.translate(Utils.randRange(-shake, shake), Utils.randRange(-shake, shake));
      }

      if (ctx.background) c.drawImage(ctx.background, 0, 0, WORLD.width, WORLD.height);
      else { c.fillStyle = ZONE.palette.groundBottom; c.fillRect(0, 0, WORLD.width, WORLD.height); }

      const actors = [state.monster, state.player].filter(function (a) { return a; });
      actors.sort(function (a, b) { return a.pos.y - b.pos.y; });

      actors.forEach(function (actor) {
        if (actor.kind === 'monster') drawMonster(c, actor, state);
        else drawPlayer(c, actor, state);
      });

      drawParticles(c);
      drawFloaters(c);
      c.restore();
    }

    function drawShadow(c, x, y, radius, alpha) {
      c.fillStyle = 'rgba(10,20,10,' + alpha + ')';
      c.beginPath();
      c.ellipse(x, y + radius * 0.75, radius * 1.15, radius * 0.45, 0, 0, Math.PI * 2);
      c.fill();
    }

    function drawPlayer(c, player, state) {
      const p = player.pos;
      const bob = player.moving ? Math.sin(player.walkPhase * 2) * 2 : Math.sin(state.time * 2) * 0.9;
      const y = p.y + bob;
      const facingLeft = player.facing.x < 0;

      if (player.downed) {
        c.save();
        c.globalAlpha = 0.45;
        c.translate(p.x, p.y + 6);
        c.rotate(Math.PI / 2.4);
        c.translate(-p.x, -p.y);
      }

      drawShadow(c, p.x, p.y, player.radius, 0.32);

      // Respawn aura while downed
      if (player.downed) {
        c.fillStyle = 'rgba(120,160,255,0.18)';
        c.beginPath();
        c.arc(p.x, p.y, player.radius * 2.4, 0, Math.PI * 2);
        c.fill();
      }

      c.save();
      c.translate(p.x, y);

      // Slash arc while attacking
      if (player.attackAnim > 0) {
        const t = 1 - player.attackAnim;
        const dir = facingLeft ? -1 : 1;
        c.save();
        c.translate(dir * 6, -4);
        c.rotate(dir * (-1.7 + t * 2.4));
        c.strokeStyle = 'rgba(255,247,214,' + (0.85 * player.attackAnim) + ')';
        c.lineWidth = 5;
        c.lineCap = 'round';
        c.beginPath();
        c.arc(0, 0, player.radius + 16, -0.9, 0.5);
        c.stroke();
        c.strokeStyle = 'rgba(255,205,120,' + (0.4 * player.attackAnim) + ')';
        c.lineWidth = 10;
        c.beginPath();
        c.arc(0, 0, player.radius + 20, -0.8, 0.4);
        c.stroke();
        c.restore();
      }

      // Cloak / body
      c.fillStyle = '#3f5ecf';
      c.beginPath();
      c.moveTo(-11, 12);
      c.quadraticCurveTo(-13, -6, 0, -9);
      c.quadraticCurveTo(13, -6, 11, 12);
      c.closePath();
      c.fill();

      // Tunic highlight
      c.fillStyle = '#5c7ae8';
      c.beginPath();
      c.moveTo(-8, 11);
      c.quadraticCurveTo(-9, -4, 0, -7);
      c.quadraticCurveTo(9, -4, 8, 11);
      c.closePath();
      c.fill();

      // Belt
      c.fillStyle = '#7a5a2e';
      c.fillRect(-10, 6, 20, 4);
      c.fillStyle = '#f2c14e';
      c.fillRect(-2.5, 6, 5, 4);

      // Head
      c.fillStyle = '#f2c79c';
      c.beginPath();
      c.arc(0, -17, 8.5, 0, Math.PI * 2);
      c.fill();

      // Hair / hood
      c.fillStyle = '#4a3320';
      c.beginPath();
      c.arc(0, -19, 8.6, Math.PI * 1.05, Math.PI * 2.0);
      c.fill();
      c.beginPath();
      c.ellipse(facingLeft ? 6 : -6, -18, 3.4, 6, 0, 0, Math.PI * 2);
      c.fill();

      // Eyes
      c.fillStyle = '#25313f';
      const eyeShift = player.facing.x * 1.6;
      c.beginPath(); c.arc(-3 + eyeShift, -16, 1.4, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(3 + eyeShift, -16, 1.4, 0, Math.PI * 2); c.fill();

      // Sword on the back / in hand while swinging
      c.save();
      if (player.attackAnim > 0) {
        const t = 1 - player.attackAnim;
        const dir = facingLeft ? -1 : 1;
        c.translate(dir * 12, -6);
        c.rotate(dir * (-2.2 + t * 3.0));
        c.fillStyle = '#c9d4ea';
        c.fillRect(0, -1.6, 26, 3.2);
        c.fillStyle = '#8b93a8';
        c.fillRect(0, -1.6, 6, 3.2);
        c.fillStyle = '#a8792f';
        c.fillRect(-4, -3.4, 4, 6.8);
      } else {
        c.translate(-(facingLeft ? -1 : 1) * 2, -6);
        c.rotate(0.5);
        c.fillStyle = '#b8c2d8';
        c.fillRect(-2, -22, 3.4, 24);
        c.fillStyle = '#8b93a8';
        c.fillRect(-2, -22, 3.4, 5);
        c.fillStyle = '#a8792f';
        c.fillRect(-4, 0, 7.4, 3.4);
      }
      c.restore();

      c.restore(); // translate

      // Hit flash
      if (player.hitFlash > 0) {
        c.save();
        c.globalAlpha = Utils.clamp(player.hitFlash, 0, 1) * 0.55;
        c.fillStyle = '#ff6b6b';
        c.beginPath();
        c.arc(p.x, y - 6, player.radius + 6, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }

      if (player.downed) c.restore();

      // Name plate (stacked: name → level → HP bar)
      drawNameTag(c, p.x, y - 52, player.name, 'Lv. ' + player.level, '#ffe9a8');
      drawMiniBar(c, p.x, y - 34, 46, 5, player.hp / player.maxHp, '#ff5f6d', '#3a0d12');
    }

    function drawMonster(c, monster, state) {
      const def = monster.def;
      const pal = def.palette;

      if (!monster.alive) {
        // respawn indicator at home
        const remaining = Math.max(0, monster.respawnTimer);
        c.save();
        c.globalAlpha = 0.55;
        c.setLineDash([6, 6]);
        c.strokeStyle = Utils.rgba(pal.body, 0.8);
        c.lineWidth = 2;
        c.beginPath();
        c.ellipse(monster.home.x, monster.home.y + 4, 22, 9, 0, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = '#e9f5ea';
        c.font = '600 11px "Segoe UI", sans-serif';
        c.textAlign = 'center';
        c.fillText('Respawning in ' + remaining.toFixed(1) + 's', monster.home.x, monster.home.y + 34);
        c.restore();
        return;
      }

      const p = monster.pos;
      const speedFactor = monster.aggro ? 1 : 0.6;
      const squash = Math.sin(state.time * 5 * speedFactor + monster.bob);
      const hop = Math.abs(Math.sin(state.time * 3 * speedFactor + monster.bob)) * 3;
      const w = monster.radius * (1.06 + squash * 0.06);
      const h = monster.radius * (0.88 - squash * 0.06);

      drawShadow(c, p.x, p.y, monster.radius, 0.3);

      c.save();
      c.translate(p.x, p.y - hop);

      if (monster.spawnPulse > 0) {
        c.globalAlpha = Utils.clamp(monster.spawnPulse, 0, 1);
      }

      // Body
      const grad = c.createLinearGradient(0, -h, 0, h);
      grad.addColorStop(0, pal.body);
      grad.addColorStop(1, pal.bodyDark);
      c.fillStyle = grad;
      c.beginPath();
      c.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
      c.fill();

      // Base puddle
      c.fillStyle = Utils.rgba(pal.bodyDark, 0.85);
      c.beginPath();
      c.ellipse(0, h * 0.62, w * 0.92, h * 0.36, 0, 0, Math.PI * 2);
      c.fill();

      // Shine
      c.fillStyle = Utils.rgba(pal.shine, 0.65);
      c.beginPath();
      c.ellipse(-w * 0.32, -h * 0.42, w * 0.22, h * 0.16, -0.5, 0, Math.PI * 2);
      c.fill();

      // Eyes
      const lookX = Utils.clamp((state.player.pos.x - p.x) / 120, -1, 1) * 2.2;
      c.fillStyle = pal.eye;
      c.beginPath(); c.arc(-5 + lookX, -3, 2.6, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(5 + lookX, -3, 2.6, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.beginPath(); c.arc(-5 + lookX + 0.9, -3.9, 0.9, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(5 + lookX + 0.9, -3.9, 0.9, 0, Math.PI * 2); c.fill();
      c.strokeStyle = pal.eye;
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(lookX, 4, 3.4, 0.25, Math.PI - 0.25);
      c.stroke();

      // Attack lunge indicator
      if (monster.attackAnim > 0) {
        c.strokeStyle = 'rgba(255,120,90,' + (0.7 * monster.attackAnim) + ')';
        c.lineWidth = 3;
        c.beginPath();
        c.arc(0, 0, monster.radius + 10 * (1 - monster.attackAnim), 0, Math.PI * 2);
        c.stroke();
      }

      // Hit flash
      if (monster.hitFlash > 0) {
        c.globalAlpha = Utils.clamp(monster.hitFlash, 0, 1) * 0.75;
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
      }

      c.restore();

      // Enemy name plate (stacked: name → level → HP bar)
      drawNameTag(c, p.x, p.y - 52, monster.name, 'Lv. ' + monster.level, '#ffd9c6');
      drawMiniBar(c, p.x, p.y - 34, 54, 6, monster.hp / monster.maxHp, '#ff8a5c', '#3a1206');

      if (monster.aggro) {
        c.fillStyle = '#ff9b6a';
        c.font = '700 14px "Segoe UI", sans-serif';
        c.textAlign = 'center';
        c.fillText('!', p.x, p.y - 66);
      }
    }

    function drawNameTag(c, x, y, name, sub, color) {
      c.save();
      c.textAlign = 'center';
      c.font = '600 12px "Segoe UI", sans-serif';
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(8,6,20,0.85)';
      c.strokeText(name, x, y);
      c.fillStyle = color;
      c.fillText(name, x, y);
      if (sub) {
        c.font = '500 10px "Segoe UI", sans-serif';
        c.strokeText(sub, x, y + 11);
        c.fillStyle = 'rgba(232,230,245,0.8)';
        c.fillText(sub, x, y + 11);
      }
      c.restore();
    }

    function drawMiniBar(c, cx, y, width, height, ratio, color, back) {
      const x = cx - width / 2;
      const clamped = Utils.clamp(ratio, 0, 1);
      c.save();
      c.fillStyle = 'rgba(8,6,20,0.75)';
      c.fillRect(x - 1, y - 1, width + 2, height + 2);
      c.fillStyle = back;
      c.fillRect(x, y, width, height);
      c.fillStyle = color;
      c.fillRect(x, y, width * clamped, height);
      c.restore();
    }

    function drawParticles(c) {
      c.save();
      Effects.particles.forEach(function (p) {
        const alpha = Utils.clamp(p.life / p.maxLife, 0, 1);
        c.globalAlpha = alpha;
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        c.fill();
      });
      c.restore();
    }

    function drawFloaters(c) {
      c.save();
      c.textAlign = 'center';
      Effects.floaters.forEach(function (f) {
        const alpha = Utils.clamp(f.life / f.maxLife, 0, 1);
        const scale = 1 + (1 - alpha) * 0.25;
        c.save();
        c.globalAlpha = alpha;
        c.translate(f.x, f.y);
        c.scale(scale, scale);
        c.font = '700 ' + f.size + 'px "Segoe UI", sans-serif';
        if (f.outline) {
          c.lineWidth = 3.5;
          c.strokeStyle = 'rgba(10,6,20,0.85)';
          c.strokeText(f.text, 0, 0);
        }
        c.fillStyle = f.color;
        c.fillText(f.text, 0, 0);
        c.restore();
      });
      c.restore();
    }

    return {
      init: init,
      resize: resize,
      render: render,
      context2d: function () { return ctx.ctx2d; },
      getBackground: function () { return ctx.background; }
    };
  })();

  /* ============================================================
   * 7. HUD — DOM status display
   * ========================================================== */
  const HUD = (function () {
    const el = {};
    const cache = {};

    function init(doc) {
      el.name = doc.getElementById('player-name');
      el.level = doc.getElementById('player-level');
      el.hpFill = doc.getElementById('hp-fill');
      el.hpValue = doc.getElementById('hp-value');
      el.hpBar = doc.getElementById('hp-bar');
      el.mpFill = doc.getElementById('mp-fill');
      el.mpValue = doc.getElementById('mp-value');
      el.mpBar = doc.getElementById('mp-bar');
      el.expFill = doc.getElementById('exp-fill');
      el.expValue = doc.getElementById('exp-value');
      el.expBar = doc.getElementById('exp-bar');
      el.gold = doc.getElementById('gold-value');
      el.attackButton = doc.getElementById('attack-button');
      el.touchAttack = doc.getElementById('touch-attack');
      el.touchToggle = doc.getElementById('touch-toggle');
      el.touchControls = doc.getElementById('touch-controls');
      el.banner = doc.getElementById('banner');
      el.log = doc.getElementById('combat-log');
      el.zone = doc.getElementById('zone-name');
      el.targetPlate = doc.getElementById('target-plate');
      el.targetName = doc.getElementById('target-name');
      el.targetLevel = doc.getElementById('target-level');
      el.targetHpFill = doc.getElementById('target-hp-fill');
      el.targetHpValue = doc.getElementById('target-hp-value');
    }

    function setBar(fill, valueEl, barEl, current, max, label) {
      const ratio = max > 0 ? Utils.clamp(current / max, 0, 1) : 0;
      const text = Math.max(0, Math.round(current)) + ' / ' + Math.round(max);
      if (cache[fill.id] !== ratio) {
        fill.style.width = (ratio * 100).toFixed(2) + '%';
        cache[fill.id] = ratio;
      }
      if (cache[valueEl.id] !== text) {
        valueEl.textContent = text;
        cache[valueEl.id] = text;
      }
      if (barEl && barEl.setAttribute) {
        barEl.setAttribute('aria-valuenow', Math.max(0, Math.round(current)));
        barEl.setAttribute('aria-valuemax', Math.round(max));
        barEl.setAttribute('aria-valuetext', label + ' ' + text);
      }
    }

    function render(state) {
      const player = state.player;
      if (!el.hpFill) return;

      setBar(el.hpFill, el.hpValue, el.hpBar, player.hp, player.maxHp, 'Hit points');
      setBar(el.mpFill, el.mpValue, el.mpBar, player.mp, player.maxMp, 'Mana');
      setBar(el.expFill, el.expValue, el.expBar, player.exp, player.expToNext, 'Experience');

      const levelText = 'Lv. ' + player.level + ' ' + (player.title || '');
      if (cache.level !== levelText) { el.level.textContent = levelText; cache.level = levelText; }

      const goldText = String(player.gold);
      if (cache.gold !== goldText) { el.gold.textContent = goldText; cache.gold = goldText; }

      const nameText = player.name;
      if (cache.name !== nameText) { el.name.textContent = nameText; cache.name = nameText; }

      // Target plate
      const monster = state.monster;
      if (el.targetPlate && monster) {
        const visible = !monster.alive || monster.hp < monster.maxHp || monster.aggro;
        if (el.targetPlate.hidden !== !visible) el.targetPlate.hidden = !visible;
        if (visible) {
          if (cache.targetName !== monster.name) { el.targetName.textContent = monster.name; cache.targetName = monster.name; }
          const tl = 'Lv. ' + monster.level;
          if (cache.targetLevel !== tl) { el.targetLevel.textContent = tl; cache.targetLevel = tl; }
          const ratio = Math.max(0, monster.hp / monster.maxHp);
          if (cache.targetHp !== ratio) {
            el.targetHpFill.style.width = (ratio * 100).toFixed(2) + '%';
            cache.targetHp = ratio;
          }
          const hpText = Math.max(0, Math.round(monster.hp)) + ' / ' + monster.maxHp;
          if (cache.targetHpText !== hpText) { el.targetHpValue.textContent = hpText; cache.targetHpText = hpText; }
        }
      }

      if (el.attackButton) {
        const cooling = player.attackCooldown > 0;
        if (cache.cooling !== cooling) {
          el.attackButton.classList.toggle('is-cooling', cooling);
          if (el.touchAttack) el.touchAttack.classList.toggle('is-cooling', cooling);
          cache.cooling = cooling;
        }
      }
    }

    function setZone(name) {
      if (el.zone && cache.zone !== name) { el.zone.textContent = name; cache.zone = name; }
    }

    return { el: el, init: init, render: render, setZone: setZone };
  })();

  /* ============================================================
   * 8. LOG — combat log panel
   * ========================================================== */
  const Log = (function () {
    function push(message, className) {
      const el = HUD.el.log;
      if (!el) return;
      const item = document.createElement('li');
      item.textContent = message;
      if (className) item.className = className;
      el.insertBefore(item, el.firstChild);
      while (el.children.length > CONFIG.feedback.maxLogEntries) {
        el.removeChild(el.lastChild);
      }
    }

    function clear() {
      const el = HUD.el.log;
      if (el) el.innerHTML = '';
    }

    return { push: push, clear: clear };
  })();

  /* ============================================================
   * 9. GAME — state, loop and rules
   * ========================================================== */
  const Game = (function () {
    const state = {
      running: false,
      paused: false,
      time: 0,
      player: null,
      monster: null,
      rafId: 0,
      lastTimestamp: 0,
      systems: [],          // extra update systems registered by later modules
      handlers: {}          // event bus
    };

    /* ---------- tiny event bus (used by future classes/guilds/PvP) ---------- */
    function on(event, handler) {
      (state.handlers[event] || (state.handlers[event] = [])).push(handler);
      return function off() {
        state.handlers[event] = state.handlers[event].filter(function (h) { return h !== handler; });
      };
    }

    function emit(event, payload) {
      (state.handlers[event] || []).forEach(function (handler) { handler(payload); });
    }

    function registerSystem(system) {
      if (system && typeof system.update === 'function') state.systems.push(system);
    }

    /* ---------- setup ---------- */
    function create() {
      state.player = createPlayer();
      state.monster = createMonster(MONSTER_DEF, ZONE);
      state.time = 0;
    }

    function init(options) {
      const opts = options || {};
      const doc = opts.document || root.document;
      if (!doc) throw new Error('Mythara Online: no document available');

      HUD.init(doc);
      Renderer.init(doc.getElementById('game-canvas'));

      Input.bindKeyboard(root);
      Input.bindControls(doc, doc.getElementById('game-canvas'));

      state.player = null;
      state.monster = null;
      create();
      Effects.reset();
      Log.clear();

      HUD.setZone(ZONE.name);
      Log.push('Welcome to ' + ZONE.name + ', ' + state.player.name + '!', null);
      Log.push('A wild ' + state.monster.name + ' blocks the path.', null);

      bindTouchToggle(doc);
      bindVisibilityPause(doc);

      emit('ready', state);
      if (opts.autoStart !== false) start();
      return state;
    }

    function bindTouchToggle(doc) {
      const toggle = doc.getElementById('touch-toggle');
      if (!toggle || !doc.body) return;

      const coarse = root.matchMedia && root.matchMedia('(pointer: coarse)').matches;
      if (coarse || ('ontouchstart' in root && root.innerWidth < 900)) {
        doc.body.classList.add('is-touch');
      }

      toggle.addEventListener('click', function () {
        const forced = doc.body.classList.toggle('force-touch');
        toggle.setAttribute('aria-pressed', forced ? 'true' : 'false');
      });
    }

    function bindVisibilityPause(doc) {
      doc.addEventListener('visibilitychange', function () {
        if (doc.hidden) {
          state.paused = true;
        } else if (state.running) {
          state.paused = false;
          state.lastTimestamp = 0;   // avoid a giant delta after unpausing
        }
      });
    }

    /* ---------- loop ---------- */
    function start() {
      if (state.running) return;
      state.running = true;
      state.paused = false;
      state.lastTimestamp = 0;
      if (root.requestAnimationFrame) {
        state.rafId = root.requestAnimationFrame(loop);
      }
    }

    function stop() {
      state.running = false;
      if (state.rafId && root.cancelAnimationFrame) root.cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }

    function loop(timestamp) {
      if (!state.running) return;
      if (state.paused) {
        state.rafId = root.requestAnimationFrame ? root.requestAnimationFrame(loop) : 0;
        return;
      }

      if (!state.lastTimestamp) state.lastTimestamp = timestamp;
      let deltaMs = timestamp - state.lastTimestamp;
      state.lastTimestamp = timestamp;
      if (!isFinite(deltaMs) || deltaMs < 0) deltaMs = 0;
      deltaMs = Math.min(deltaMs, CONFIG.loop.maxDeltaMs);

      tick(deltaMs / 1000);
      state.rafId = root.requestAnimationFrame ? root.requestAnimationFrame(loop) : 0;
    }

    /** Advance the simulation + draw one frame. `dt` is in seconds. */
    function tick(dt) {
      if (!state.player) return;
      const clamped = Utils.clamp(dt, 0, CONFIG.loop.maxDeltaSeconds);
      state.time += clamped;
      update(clamped);
      Renderer.render(state);
      HUD.render(state);
    }

    function update(dt) {
      const player = state.player;
      const monster = state.monster;

      updatePlayer(player, dt);
      updateMonster(monster, dt);
      updateRegen(player, dt);
      Effects.update(dt);

      state.systems.forEach(function (system) {
        if (system.update) system.update(dt, state);
      });
    }

    /* ---------- player ---------- */
    function updatePlayer(player, dt) {
      player.attackCooldown = Math.max(0, player.attackCooldown - dt * 1000);
      player.attackAnim = Math.max(0, player.attackAnim - dt * 4);
      player.hitFlash = Math.max(0, player.hitFlash - dt * 3);
      player.hurtTimer = Math.max(0, player.hurtTimer - dt * 1000);

      if (player.downed) {
        player.respawnTimer -= dt;
        if (player.respawnTimer <= 0) revivePlayer(player);
        return;
      }

      const axis = Input.axis();
      player.moving = axis.active;

      if (axis.active) {
        const step = player.speed * dt;
        player.pos.x += axis.x * step;
        player.pos.y += axis.y * step;
        player.facing.x = axis.x;
        player.facing.y = axis.y;
        player.walkPhase += dt * 9;
      }

      clampToWorld(player);
      separateFromMonster(player, state.monster);

      // Attack (queued tap or held button, respecting cooldown)
      if ((Input.consumeAttack() || Input.isAttackHeld()) && player.attackCooldown <= 0) {
        playerAttack(player, state.monster);
      }
    }

    /** Keep an entity inside the walkable floor of the zone. */
    function clampToWorld(entity) {
      const floorTop = WORLD.floorTop || WORLD.margin;
      entity.pos.x = Utils.clamp(entity.pos.x, WORLD.margin, WORLD.width - WORLD.margin);
      entity.pos.y = Utils.clamp(entity.pos.y, floorTop, WORLD.height - WORLD.margin);
    }

    function separateFromMonster(player, monster) {
      if (!monster || !monster.alive) return;
      const minDistance = player.radius + monster.radius;
      const dx = player.pos.x - monster.pos.x;
      const dy = player.pos.y - monster.pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
      if (dist < minDistance) {
        const push = (minDistance - dist) / dist;
        player.pos.x += dx * push;
        player.pos.y += dy * push;
      }
    }

    function updateRegen(player, dt) {
      if (player.downed) return;
      if (player.hurtTimer <= 0) {
        player.hp = Math.min(player.maxHp, player.hp + PLAYER_DEF.hpRegenPerSecond * dt);
      }
      player.mp = Math.min(player.maxMp, player.mp + PLAYER_DEF.mpRegenPerSecond * dt);
    }

    /* ---------- attacks ---------- */
    function playerAttack(player, monster) {
      // Magic numbers live in data.js so future classes can override them.
      player.attackCooldown = PLAYER_DEF.attackCooldownMs;
      player.attackAnim = 1;
      emit('playerAttack', { player: player, monster: monster });

      if (!monster || !monster.alive) {
        Effects.addFloater(player.pos.x, player.pos.y - 64, 'Nothing here...', { color: '#c9c4e6', size: 12 });
        return;
      }

      if (!Combat.inRange(player, monster, PLAYER_DEF.attackRange)) {
        Effects.addFloater(player.pos.x + player.facing.x * 22, player.pos.y - 64, 'Too far!', {
          color: '#e6e1ff', size: 12, life: 620
        });
        return;
      }

      const result = Combat.rollDamage(player, monster);
      monster.hp = Math.max(0, monster.hp - result.damage);
      monster.hitFlash = 1;
      monster.aggro = true;

      const dx = monster.pos.x - player.pos.x;
      const dy = monster.pos.y - player.pos.y;
      const len = Math.hypot(dx, dy) || 1;
      monster.pos.x += (dx / len) * 6;
      monster.pos.y += (dy / len) * 6;
      clampToWorld(monster);

      Effects.addFloater(monster.pos.x, monster.pos.y - 62, result.damage, {
        color: result.crit ? '#ffd76a' : '#ffffff',
        size: result.crit ? 26 : 19
      });
      if (result.crit) {
        Effects.addFloater(monster.pos.x, monster.pos.y - 86, 'CRIT!', { color: '#ffca3a', size: 14, life: 700 });
        Effects.burst(monster.pos.x, monster.pos.y - 6, '#ffe9a8', 14, { speedMin: 70, speedMax: 220 });
      }
      Effects.burst(monster.pos.x, monster.pos.y, '#b8f5c0', result.crit ? 12 : 7);
      Effects.addShake(result.crit ? 5 : 2.4);

      Log.push(player.name + ' hits ' + monster.name + ' for ' + result.damage + (result.crit ? ' (critical)!' : ' damage.'),
        'log--hit');

      if (monster.hp <= 0) killMonster(monster);
    }

    function killMonster(monster) {
      monster.alive = false;
      monster.aggro = false;
      monster.deathTimer = 0.4;
      monster.respawnTimer = (monster.def.respawnMs || 4000) / 1000;
      monster.attackCooldown = 0;

      Effects.burst(monster.pos.x, monster.pos.y, monster.def.palette.body, 22, { speedMax: 200, lift: 80 });
      Effects.addShake(6);

      const rewards = monster.def.rewards || { exp: 0, goldMin: 0, goldMax: 0 };
      const expGain = rewards.exp || 0;
      const goldGain = Utils.randInt(rewards.goldMin || 0, rewards.goldMax || 0);

      state.player.kills += 1;
      state.player.gold += goldGain;
      state.player.exp += expGain;

      Effects.addFloater(monster.pos.x - 30, monster.pos.y - 70, '+' + expGain + ' EXP', {
        color: '#c4a7ff', size: 15, life: 1200, vy: -30, vx: -6
      });
      Effects.addFloater(monster.pos.x + 32, monster.pos.y - 54, '+' + goldGain + ' gold', {
        color: '#f2c14e', size: 14, life: 1300, vy: -26, vx: 6
      });

      Log.push(monster.name + ' defeated! +' + expGain + ' EXP, +' + goldGain + ' gold.', 'log--kill');
      emit('monsterKilled', { monster: monster, exp: expGain, gold: goldGain });
      checkLevelUp(state.player);
    }

    /* ---------- monster AI ---------- */
    function updateMonster(monster, dt) {
      if (!monster) return;

      if (!monster.alive) {
        monster.respawnTimer -= dt;
        if (monster.respawnTimer <= 0) respawnMonster(monster);
        return;
      }

      monster.hitFlash = Math.max(0, monster.hitFlash - dt * 3.2);
      monster.attackAnim = Math.max(0, monster.attackAnim - dt * 3);
      monster.attackCooldown = Math.max(0, monster.attackCooldown - dt * 1000);
      monster.spawnPulse = Math.max(0, monster.spawnPulse - dt * 2);

      const player = state.player;
      const distanceToPlayer = Utils.distance(monster.pos.x, monster.pos.y, player.pos.x, player.pos.y);

      if (player.downed || distanceToPlayer > monster.def.aggroRange) {
        monster.aggro = false;
        wander(monster, dt);
      } else {
        monster.aggro = true;
        const reach = monster.radius + player.radius + monster.def.attackRange;
        if (distanceToPlayer > reach) {
          moveToward(monster, player.pos.x, player.pos.y, monster.speed * dt);
        } else if (monster.attackCooldown <= 0) {
          monsterAttack(monster, player);
        }
      }

      clampToWorld(monster);
    }

    function wander(monster, dt) {
      monster.wanderTimer -= dt;
      if (monster.wanderTimer <= 0) {
        monster.wanderTimer = Utils.randRange(1.1, 2.8);
        const angle = Utils.randRange(0, Math.PI * 2);
        const radius = Utils.randRange(0, monster.def.wanderRadius);
        monster.wanderTarget = {
          x: Utils.clamp(monster.home.x + Math.cos(angle) * radius, WORLD.margin, WORLD.width - WORLD.margin),
          y: Utils.clamp(monster.home.y + Math.sin(angle) * radius * 0.6, WORLD.margin, WORLD.height - WORLD.margin)
        };
      }

      const dx = monster.wanderTarget.x - monster.pos.x;
      const dy = monster.wanderTarget.y - monster.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 4) {
        const step = monster.speed * 0.45 * dt;
        monster.pos.x += (dx / dist) * step;
        monster.pos.y += (dy / dist) * step;
      }
    }

    function moveToward(monster, targetX, targetY, step) {
      const dx = targetX - monster.pos.x;
      const dy = targetY - monster.pos.y;
      const dist = Math.hypot(dx, dy) || 1;
      monster.pos.x += (dx / dist) * Math.min(step, dist);
      monster.pos.y += (dy / dist) * Math.min(step, dist);
    }

    function monsterAttack(monster, player) {
      monster.attackCooldown = monster.def.attackCooldownMs;
      monster.attackAnim = 1;

      const result = Combat.rollDamage(monster, player);
      player.hp = Math.max(0, player.hp - result.damage);
      player.hitFlash = 1;
      player.hurtTimer = COMBAT.outOfCombatRegenDelayMs;

      Effects.addFloater(player.pos.x, player.pos.y - 64, '-' + result.damage, {
        color: '#ff8080', size: 18
      });
      Effects.burst(player.pos.x, player.pos.y - 4, '#ff9b9b', 6);
      Effects.addShake(4);

      Log.push(monster.name + ' hits ' + player.name + ' for ' + result.damage + ' damage.', 'log--hurt');
      emit('playerDamaged', { monster: monster, damage: result.damage });

      if (player.hp <= 0) knockDownPlayer(player);
    }

    /* ---------- death / respawn ---------- */
    function knockDownPlayer(player) {
      player.downed = true;
      player.respawnTimer = 3;
      player.attackAnim = 0;
      Input.reset();
      Log.push(player.name + ' has fallen! Recovering...', 'log--down');
      Effects.addShake(9);
      emit('playerDowned', { player: player });
    }

    function revivePlayer(player) {
      player.downed = false;
      player.hp = player.maxHp;
      player.mp = player.maxMp;
      player.pos.x = PLAYER_DEF.spawn.x;
      player.pos.y = PLAYER_DEF.spawn.y;
      player.hurtTimer = 0;
      Effects.burst(player.pos.x, player.pos.y, '#9ad1ff', 16, { speedMax: 130, lift: 60 });
      Log.push(player.name + ' is back on their feet.', 'log--level');
      emit('playerRevived', { player: player });
    }

    function respawnMonster(monster) {
      monster.alive = true;
      monster.hp = monster.maxHp;
      monster.pos.x = monster.home.x;
      monster.pos.y = monster.home.y;
      monster.aggro = false;
      monster.hitFlash = 0;
      monster.spawnPulse = 1;
      monster.wanderTimer = Utils.randRange(0.6, 1.8);
      Effects.burst(monster.pos.x, monster.pos.y, monster.def.palette.shine, 18, { speedMax: 120, lift: 20 });
      Effects.addFloater(monster.pos.x, monster.pos.y - 66, monster.name + ' appears!', {
        color: '#b8f5c0', size: 13, life: 1000
      });
      Log.push('A ' + monster.name + ' appears.', null);
      emit('monsterSpawned', { monster: monster });
    }

    /* ---------- progression ---------- */
    function expNeededForLevel(level) {
      return Math.round(PROGRESSION.baseExpToLevel * Math.pow(PROGRESSION.expGrowth, level - 1));
    }

    function checkLevelUp(player) {
      let leveled = false;
      while (player.exp >= player.expToNext) {
        player.exp -= player.expToNext;
        player.level += 1;
        player.maxHp += PROGRESSION.hpPerLevel;
        player.maxMp += PROGRESSION.mpPerLevel;
        player.attack += PROGRESSION.attackPerLevel;
        player.defense += PROGRESSION.defensePerLevel;
        player.expToNext = expNeededForLevel(player.level);
        if (PROGRESSION.fullHealOnLevelUp) {
          player.hp = player.maxHp;
          player.mp = player.maxMp;
        }
        leveled = true;
        Log.push('LEVEL UP! ' + player.name + ' reached level ' + player.level + '.', 'log--level');
        emit('levelUp', { player: player });
      }
      if (leveled) {
        Effects.showBanner('Level ' + player.level + '!');
        Effects.burst(player.pos.x, player.pos.y, '#ffe9a8', 30, { speedMax: 240, lift: 120 });
        Effects.addShake(5);
      }
      return leveled;
    }

    /* ---------- debug / test helpers ---------- */
    function damageMonster(amount) {
      const monster = state.monster;
      if (!monster || !monster.alive) return;
      monster.hp = Math.max(0, monster.hp - amount);
      monster.hitFlash = 1;
      if (monster.hp <= 0) killMonster(monster);
    }

    function teleportPlayer(x, y) {
      state.player.pos.x = x;
      state.player.pos.y = y;
    }

    function getState() { return state; }

    return {
      state: state,
      init: init,
      start: start,
      stop: stop,
      tick: tick,
      update: update,
      loop: loop,
      getState: getState,
      on: on,
      emit: emit,
      registerSystem: registerSystem,
      playerAttack: playerAttack,
      damageMonster: damageMonster,
      teleportPlayer: teleportPlayer,
      expNeededForLevel: expNeededForLevel,
      revivePlayer: revivePlayer,
      respawnMonster: respawnMonster
    };
  })();

  /* ============================================================
   * 10. PUBLIC API + BOOTSTRAP
   * ========================================================== */
  const Mythara = {
    version: '0.1.0-mvp',
    Game: Game,
    Input: Input,
    Combat: Combat,
    Effects: Effects,
    Renderer: Renderer,
    HUD: HUD,
    Log: Log,
    Utils: Utils,
    DATA: DATA
  };

  root.Mythara = Mythara;
  if (typeof module !== 'undefined' && module.exports) module.exports = Mythara;

  if (root.document) {
    const boot = function () { Game.init(); };
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
