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
  /** Procedural sound kit (js/sfx.js); a silent stub keeps the engine safe without it. */
  const Sfx = root.MytharaSFX || { play: function () { return false; } };

  /** How enemy stats grow with stage level (see data-enemies.js for bases). */
  const ENEMY_SCALING = {
    mob: { hp: 9, attack: 1.6, defense: 0.35 },
    elite: { hp: 26, attack: 2.2, defense: 0.6 },
    boss: { hp: 70, attack: 2.4, defense: 1.0 }
  };

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

    /** Blend a hex colour toward white (amount > 0) or black (amount < 0). */
    function shade(hex, amount) {
      const parsed = hexToRgb(hex);
      const target = amount >= 0 ? 255 : 0;
      const t = Math.abs(Utils.clamp(amount, -1, 1));
      const mix = function (channel) { return Math.round(channel + (target - channel) * t); };
      const toHex = function (value) { return ('0' + mix(value).toString(16)).slice(-2); };
      return '#' + toHex(parsed.r) + toHex(parsed.g) + toHex(parsed.b);
    }

    return {
      clamp: clamp,
      shade: shade, random: random, randRange: randRange, randInt: randInt, pick: pick,
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
    let specialKey = null;      // engine hook for Tab / Esc
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
        // Tab / Esc reach the engine through a hook it installs itself,
        // so the Input module stays free of game-state dependencies.
        if (specialKey && !(event.target && /^(INPUT|TEXTAREA)$/.test(event.target.tagName || ''))) {
          specialKey(event);
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
          // A tap that lands on a monster selects it (see Game.pickTargetAt);
          // every other tap is a plain attack, exactly as before.
          if (event.clientX !== undefined && canvas.getBoundingClientRect) {
            const rect = canvas.getBoundingClientRect();
            emit('canvasPick', { x: event.clientX - rect.left, y: event.clientY - rect.top });
          }
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
      onSpecialKey: function (fn) { specialKey = typeof fn === 'function' ? fn : null; },
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
    /**
     * Roll damage from `attacker` against `defender`.
     * `options` (all optional): power, multiplier, critChance, critMultiplier,
     * alwaysCrit, ignoreDefense, bonusPct, statKey.
     */
    function rollDamage(attacker, defender, options) {
      const opts = options || {};
      const statPower = opts.power !== undefined ? opts.power
        : (opts.statKey ? (attacker[opts.statKey] || 0) : attacker.attack);
      const power = statPower * (opts.multiplier || 1);
      const variance = Utils.randRange(COMBAT.varianceMin, COMBAT.varianceMax);
      const defense = opts.ignoreDefense ? 0 : (defender.defense || 0) * COMBAT.defenseFactor;
      let damage = Math.max(COMBAT.minDamage, Math.round(power * variance - defense));

      const critChance = opts.critChance !== undefined ? opts.critChance
        : (attacker.critChance !== undefined ? attacker.critChance : COMBAT.critChance);
      const critMultiplier = opts.critMultiplier !== undefined ? opts.critMultiplier
        : (attacker.critMultiplier || COMBAT.critMultiplier);
      const crit = opts.alwaysCrit ? true : Utils.random() < critChance;
      if (crit) damage = Math.round(damage * critMultiplier);
      if (opts.bonusPct) damage = Math.round(damage * (1 + opts.bonusPct));
      return { damage: damage, crit: crit };
    }

    /** True when two circular actors are within `range` of each other's edge. */
    function inRange(a, b, range) {
      const gap = Utils.distance(a.pos.x, a.pos.y, b.pos.x, b.pos.y) - (a.radius + b.radius);
      return gap <= range;
    }

    /** Damage after the defender's damage-reduction (passives, barriers, ...). */
    function mitigate(defender, damage) {
      const reduction = Utils.clamp(defender.damageReduction || 0, 0, 0.85);
      return Math.max(COMBAT.minDamage, Math.round(damage * (1 - reduction)));
    }

    return { rollDamage: rollDamage, inRange: inRange, mitigate: mitigate };
  })();

  /* ============================================================
   * 3b. STATUSES — burns, poison, slows, freezes and stuns on monsters
   * ========================================================== */
  const Statuses = (function () {
    const DOT_TICK_SECONDS = 0.5;   // damage-over-time is applied in half-second ticks

    function blank() {
      return { burn: null, poison: null, slow: null, freezeMs: 0, stunMs: 0, pool: 0, poolTimer: 0 };
    }

    function ensure(monster) {
      if (!monster.status) monster.status = blank();
      return monster.status;
    }

    function dotPower(def, power) {
      return status_power(power, def.dpsPct);
    }

    /** burn/poison damage per second derived from the caster's power. */
    function status_power(power, pct) {
      return Math.max(1, power * pct);
    }

    /**
     * Apply a status payload ({ burn, poison, slow, freezeMs, stunMs }) to a monster.
     * `casterMods` lets class passives (chillBonus, burnBonus) strengthen the effect.
     */
    function apply(monster, payload, source, casterMods) {
      if (!monster || !payload) return [];
      const status = ensure(monster);
      const mods = casterMods || {};
      const applied = [];
      const power = source ? (source.magic > source.attack ? source.magic : source.attack) : 10;

      if (payload.burn) {
        const pct = payload.burn.dpsPct * (1 + (mods.burnBonus || 0));
        status.burn = {
          dps: status_power(power, pct),
          remaining: payload.burn.durationMs / 1000,
          source: source
        };
        applied.push('burn');
      }
      if (payload.poison) {
        status.poison = {
          dps: status_power(power, payload.poison.dpsPct),
          remaining: payload.poison.durationMs / 1000,
          source: source
        };
        applied.push('poison');
      }
      if (payload.slow) {
        const factor = payload.slow.factor * (1 + (mods.chillBonus || 0));
        status.slow = { factor: Utils.clamp(factor, 0, 0.9), remaining: payload.slow.durationMs / 1000 };
        applied.push('slow');
      }
      if (payload.freezeMs) {
        status.freezeMs = Math.max(status.freezeMs, payload.freezeMs);
        applied.push('freeze');
      }
      if (payload.stunMs) {
        status.stunMs = Math.max(status.stunMs, payload.stunMs);
        applied.push('stun');
      }
      return applied;
    }

    /** Advance timers; returns damage-over-time that should be dealt this frame. */
    function update(monster, dt) {
      if (!monster.status) return 0;
      const s = monster.status;

      [ 'burn', 'poison' ].forEach(function (kind) {
        const effect = s[kind];
        if (!effect) return;
        effect.remaining -= dt;
        s.pool += effect.dps * dt;
        if (effect.remaining <= 0) s[kind] = null;
      });

      if (s.slow) {
        s.slow.remaining -= dt;
        if (s.slow.remaining <= 0) s.slow = null;
      }
      s.freezeMs = Math.max(0, s.freezeMs - dt * 1000);
      s.stunMs = Math.max(0, s.stunMs - dt * 1000);

      s.poolTimer += dt;
      let damage = 0;
      if (s.poolTimer >= DOT_TICK_SECONDS) {
        damage = s.pool;
        s.pool = 0;
        s.poolTimer = 0;
      }
      return damage;
    }

    function speedMultiplier(monster) {
      const s = monster.status;
      if (!s || !s.slow) return 1;
      return Utils.clamp(1 - s.slow.factor, 0.15, 1);
    }

    /** Frozen or stunned monsters cannot move or attack. */
    function isIncapacitated(monster) {
      const s = monster.status;
      return !!s && (s.freezeMs > 0 || s.stunMs > 0);
    }

    function labels(monster) {
      const s = monster.status;
      const out = [];
      if (!s) return out;
      if (s.burn) out.push({ id: 'burn', label: 'Burning' });
      if (s.poison) out.push({ id: 'poison', label: 'Poisoned' });
      if (s.freezeMs > 0) out.push({ id: 'freeze', label: 'Frozen' });
      else if (s.slow) out.push({ id: 'slow', label: 'Chilled' });
      if (s.stunMs > 0) out.push({ id: 'stun', label: 'Stunned' });
      return out;
    }

    function clear(monster) { if (monster) monster.status = blank(); }

    return {
      apply: apply, update: update, speedMultiplier: speedMultiplier,
      isIncapacitated: isIncapacitated, labels: labels, clear: clear,
      isSlowed: function (m) { return !!(m.status && m.status.slow); },
      isBurning: function (m) { return !!(m.status && (m.status.burn || m.status.poison)); },
      isFrozen: function (m) { return !!(m.status && (m.status.freezeMs > 0 || m.status.stunMs > 0)); }
    };
  })();

  /* ============================================================
   * 3c. PROJECTILES — arrows, spells and thrown weapons
   * ========================================================== */
  const Projectiles = (function () {
    const list = [];

    function spawn(def, x, y, angle, payload) {
      list.push({
        def: def,
        x: x, y: y,
        angle: angle,
        vx: Math.cos(angle) * def.speed,
        vy: Math.sin(angle) * def.speed,
        radius: def.radius || 6,
        life: (payload && payload.life) || 2.2,
        spin: 0,
        payload: payload || {},
        hit: []
      });
      if (list.length > 60) list.shift();
    }

    /** ctx: { onHit(projectile, monster), monsters(), onExpire(projectile), world } */
    function update(dt, ctx) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        p.spin += dt * 12;

        const outOfBounds = p.x < -40 || p.x > WORLD.width + 40 || p.y < -40 || p.y > WORLD.height + 40;
        if (p.life <= 0 || outOfBounds) {
          if (ctx.onExpire) ctx.onExpire(p);
          list.splice(i, 1);
          continue;
        }

        const targets = (p.payload && p.payload.hostile)
          ? (ctx.players ? ctx.players() : [])
          : (ctx.monsters() || []);
        for (let m = 0; m < targets.length; m++) {
          const target = targets[m];
          if (!target || (target.alive === false) || p.hit.indexOf(target) !== -1) continue;
          const reach = p.radius + (target.radius || 14);
          if (Utils.distance(p.x, p.y, target.pos.x, target.pos.y) <= reach) {
            if (p.payload && p.payload.hostile) { if (ctx.onHitPlayer) ctx.onHitPlayer(p, target); }
            else { ctx.onHit(p, target); }
            p.hit.push(target);
            if (!p.payload.pierce) { list.splice(i, 1); }
            break;
          }
        }
      }
    }

    function clear() { list.length = 0; }

    return { list: list, spawn: spawn, update: update, clear: clear };
  })();

  /* ============================================================
   * 3d. SKILLS — cooldowns, buffs, rage and validity checks
   *    (effect execution lives in Game.castSkill, which owns the world)
   * ========================================================== */
  const Skills = (function () {
    const RAGE_MAX = 100;

    function initPlayer(player) {
      player.cooldowns = {};
      player.buffs = [];
      player.rage = 0;
      player.stealthMs = 0;
    }

    function tick(player, dt) {
      const ms = dt * 1000;
      Object.keys(player.cooldowns).forEach(function (id) {
        if (player.cooldowns[id] > 0) player.cooldowns[id] = Math.max(0, player.cooldowns[id] - ms);
      });

      let changed = false;
      player.buffs = player.buffs.filter(function (buff) {
        buff.remaining -= ms;
        if (buff.remaining <= 0) { changed = true; return false; }
        return true;
      });
      if (changed) Stats.recompute(player);

      player.stealthMs = Math.max(0, player.stealthMs - ms);
      if (player.rage > 0) player.rage = Utils.clamp(player.rage - dt * 3, 0, RAGE_MAX);   // slow decay
      return changed;
    }

    /** Sum of class passive mods + active buff mods (numeric values only). */
    function aggregateMods(player) {
      const total = {};
      const sources = [];
      if (player.classDef && player.classDef.passive) sources.push(player.classDef.passive.mods || {});
      (player.buffs || []).forEach(function (buff) { sources.push(buff.mods || {}); });

      sources.forEach(function (mods) {
        Object.keys(mods).forEach(function (key) {
          if (typeof mods[key] !== 'number') return;
          total[key] = (total[key] || 0) + mods[key];
        });
      });

      if (hasRage(player)) total.attackPct = (total.attackPct || 0) + rageAttackBonus(player);
      return total;
    }

    function hasRage(player) {
      return !!(player.classDef && player.classDef.passive && player.classDef.passive.mods.rage);
    }

    function rageAttackBonus(player) {
      return 0.25 * Utils.clamp((player.rage || 0) / RAGE_MAX, 0, 1);
    }

    /** Extra HP/MP per second granted by buffs (e.g. Divine Aegis). */
    function buffRegen(player) {
      let hp = 0;
      (player.buffs || []).forEach(function (buff) { hp += buff.regenPerSecond || 0; });
      return hp;
    }

    /** Poison applied by basic attacks while a buff (Venom Blades) is active. */
    function attackPoison(player) {
      let payload = null;
      (player.buffs || []).forEach(function (buff) {
        if (buff.poisonOnHit) payload = buff.poisonOnHit;
      });
      return payload;
    }

    function isStealthed(player) { return (player.stealthMs || 0) > 0; }

    /** Crit bonus while stealthed (Smoke Bomb) or from buffs. */
    function stealthCritBonus(player) {
      let bonus = 0;
      (player.buffs || []).forEach(function (buff) { if (buff.stealthCrit) bonus += buff.stealthCrit; });
      return bonus;
    }

    function canCast(player, skill) {
      if (!skill) return { ok: false, reason: 'unknown' };
      if (player.downed) return { ok: false, reason: 'downed' };
      if ((player.cooldowns[skill.id] || 0) > 0) return { ok: false, reason: 'cooldown' };
      const rageCost = skill.params && skill.params.rageCost;
      if (rageCost && player.rage < rageCost) return { ok: false, reason: 'rage' };
      if (skill.mp > player.mp) return { ok: false, reason: 'mana' };
      return { ok: true };
    }

    /** Deduct costs and start the cooldown. Returns true when the cast may proceed. */
    function beginCast(player, skill) {
      const check = canCast(player, skill);
      if (!check.ok) return check;
      if (skill.mp) player.mp = Math.max(0, player.mp - skill.mp);
      const rageCost = skill.params && skill.params.rageCost;
      if (rageCost) player.rage = Math.max(0, player.rage - rageCost);
      player.cooldowns[skill.id] = skill.cooldownMs;
      player.lastCast = skill.id;
      return { ok: true };
    }

    function addBuff(player, id, name, mods, durationMs, extras) {
      const extra = extras || {};
      player.buffs = player.buffs.filter(function (b) { return b.id !== id; });
      player.buffs.push({
        id: id, name: name, mods: mods || {}, remaining: durationMs,
        regenPerSecond: extra.regenPerSecond || 0,
        poisonOnHit: extra.poisonOnHit || null,
        stealthCrit: extra.stealthCrit || 0
      });
      Stats.recompute(player);
    }

    function addRage(player, amount) {
      if (!hasRage(player)) return;
      player.rage = Utils.clamp((player.rage || 0) + amount, 0, RAGE_MAX);
    }

    return {
      RAGE_MAX: RAGE_MAX,
      initPlayer: initPlayer, tick: tick, aggregateMods: aggregateMods,
      buffRegen: buffRegen, attackPoison: attackPoison,
      isStealthed: isStealthed, stealthCritBonus: stealthCritBonus,
      canCast: canCast, beginCast: beginCast, addBuff: addBuff, addRage: addRage,
      hasRage: hasRage, rageAttackBonus: rageAttackBonus
    };
  })();

  /* ============================================================
   * 3e. STATS — derive effective player stats from class + gear +
   *     level + passives + buffs. Keeps player.attack etc. up to date
   *     so all existing combat code keeps working unchanged.
   * ========================================================== */
  const Stats = (function () {
    function recompute(player) {
      const cls = player.classDef;
      if (!cls) return player;

      const base = cls.base || {};
      const growth = cls.growth || {};
      const bonus = DATA.gearBonus(cls);
      const mods = Skills.aggregateMods(player);
      const lv = Math.max(0, player.level - 1);
      // gear from the account's equipment screen (set by the battle/app layer)
      const equipped = player.equipmentBonus || {};
      const flat = player.flatBonus || {};
      const num = function (key) {
        return (base[key] || 0) + (growth[key] || 0) * lv + (bonus[key] || 0) + (equipped[key] || 0) + (flat[key] || 0);
      };

      const prevMaxHp = player.maxHp || 1;
      const hpRatio = player.hp !== undefined ? Utils.clamp(player.hp / prevMaxHp, 0, 1) : 1;

      player.maxHp = Math.round(num('maxHp') * (1 + (mods.maxHpPct || 0)));
      player.maxMp = Math.round(num('maxMp') * (1 + (mods.maxMpPct || 0)));
      player.attack = Math.max(1, Math.round(num('attack') * (1 + (mods.attackPct || 0))));
      player.defense = Math.max(0, Math.round(num('defense') * (1 + (mods.defensePct || 0)) + (mods.defense || 0)));
      player.magic = Math.max(0, Math.round(num('magic') * (1 + (mods.magicPct || 0))));
      player.speed = Math.max(40, Math.round(num('speed') * (1 + (mods.speedPct || 0))));

      player.critChance = Utils.clamp((base.critChance || 0) + (bonus.critChance || 0) + (mods.critChance || 0), 0, 0.95);
      player.critMultiplier = (base.critMultiplier || 1.6) + (mods.critDamage || 0);
      player.evasion = Utils.clamp((base.evasion || 0) + (bonus.evasion || 0) + (equipped.evasion || 0) + (mods.evasion || 0), 0, 0.75);
      player.gearBonus = equipped;
      player.damageReduction = Utils.clamp(mods.damageReduction || 0, -0.5, 0.85);

      player.attackCooldownMs = Math.max(180, (base.attackCooldownMs || 600) * (1 - Utils.clamp(bonus.attackSpeed || 0, 0, 0.5)));
      player.attackRange = base.attackRange || PLAYER_DEF.attackRange;
      player.autoTargetRange = base.autoTargetRange || 0;
      player.attackType = cls.attackType || 'melee';

      player.hpRegenPerSecond = (PLAYER_DEF.hpRegenPerSecond || 1.5) + Skills.buffRegen(player);
      player.mpRegenPerSecond = (PLAYER_DEF.mpRegenPerSecond || 1) * (1 + (mods.mpRegenPct || 0));

      if (player.hp !== undefined) player.hp = Utils.clamp(player.hp, 0, player.maxHp);
      else player.hp = player.maxHp;
      if (player.mp !== undefined) player.mp = Utils.clamp(player.mp, 0, player.maxMp);
      else player.mp = player.maxMp;
      void hpRatio;

      return player;
    }

    return { recompute: recompute };
  })();

  /* ============================================================
   * 3f. ANIM — actor animation states
   *    idle | walk | run | attack | skill | ultimate | hurt | death
   *    One-shot states return to idle/walk when they finish; `death`
   *    is terminal until the actor is revived.
   * ========================================================== */
  const Anim = (function () {
    const ONE_SHOT = {
      attack: 420, skill: 720, ultimate: 1500, hurt: 340, death: 1100
    };
    const TERMINAL = { death: true };

    function set(actor, state, options) {
      if (!actor) return;
      const opts = options || {};
      const duration = opts.durationMs !== undefined ? opts.durationMs : (ONE_SHOT[state] || 0);
      if (!actor.anim) actor.anim = { state: 'idle', t: 0, durationMs: 0, progress: 0 };
      if (actor.anim.state === state && state === 'idle') return;
      actor.anim.state = state;
      actor.anim.t = 0;
      actor.anim.durationMs = duration;
      actor.anim.progress = 0;
      actor.anim.terminal = !!TERMINAL[state];
    }

    function update(actor, dt, fallback) {
      if (!actor || !actor.anim) return actor && actor.anim;
      const anim = actor.anim;
      anim.t += dt * 1000;
      if (anim.durationMs > 0) {
        anim.progress = Utils.clamp(anim.t / anim.durationMs, 0, 1);
        if (anim.t >= anim.durationMs && !anim.terminal) {
          set(actor, fallback || 'idle');
        }
      } else {
        anim.progress = 0;
      }
      return anim;
    }

    function is(actor, state) { return !!(actor && actor.anim && actor.anim.state === state); }
    function current(actor) { return (actor && actor.anim && actor.anim.state) || 'idle'; }
    function progress(actor) { return (actor && actor.anim && actor.anim.progress) || 0; }
    function isBusy(actor) {
      const state = current(actor);
      return state === 'attack' || state === 'skill' || state === 'ultimate' || state === 'hurt';
    }

    return { set: set, update: update, is: is, current: current, progress: progress, isBusy: isBusy, ONE_SHOT: ONE_SHOT };
  })();

  /* ============================================================
   * 4. ENTITIES
   * ========================================================== */
  function createPlayer(classId, name) {
    const classDef = DATA.getClass(classId) || DATA.getClass(DATA.DEFAULT_CLASS);
    const player = {
      kind: 'player',
      id: classDef.id,
      name: (name && String(name).trim()) || PLAYER_DEF.name,
      title: classDef.name,
      classId: classDef.id,
      classDef: classDef,
      look: classDef.look,

      level: 1,
      hp: 0, maxHp: 0,
      mp: 0, maxMp: 0,
      attack: 0, defense: 0, magic: 0, speed: 0,
      critChance: 0, critMultiplier: 1.6, evasion: 0, damageReduction: 0,

      attackType: classDef.attackType || 'melee',
      attackCooldownMs: 600, attackRange: PLAYER_DEF.attackRange, autoTargetRange: 0,

      exp: 0, expToNext: PROGRESSION.baseExpToLevel, gold: 0,
      weapon: DATA.getItem(classDef.weaponId),
      armor: DATA.getItem(classDef.armorId),
      skills: (classDef.skillIds || []).map(function (id) { return DATA.getSkill(id); }).filter(Boolean),

      cooldowns: {}, buffs: [], rage: 0, stealthMs: 0, lastCast: null,

      pos: { x: PLAYER_DEF.spawn.x, y: PLAYER_DEF.spawn.y },
      facing: { x: PLAYER_DEF.facing.x, y: PLAYER_DEF.facing.y },
      moving: false, running: false, walkPhase: 0, radius: PLAYER_DEF.radius,
      anim: { state: 'idle', t: 0, durationMs: 0, progress: 0 },

      attackCooldown: 0, attackAnim: 0, attackKind: 'melee', hitFlash: 0, hurtTimer: 0,
      downed: false, respawnTimer: 0, kills: 0
    };

    Skills.initPlayer(player);
    Stats.recompute(player);
    player.hp = player.maxHp;
    player.mp = player.maxMp;
    return player;
  }

  /**
   * Build a battle enemy from a data-enemies.js record.
   * `level` drives the linear stat scaling used across all 50 stages.
   */
  function createEnemy(enemyDef, level, options) {
    const opts = options || {};
    const def = enemyDef || {};
    const base = def.base || { maxHp: 40, attack: 6, defense: 1, speed: 60, xp: 10, coins: 5 };
    const tier = ENEMY_SCALING[def.tier] || ENEMY_SCALING.mob;
    const lv = Math.max(1, Math.round(level || 1));
    const steps = lv - 1;

    const maxHp = Math.round(base.maxHp + tier.hp * steps);
    const attack = Math.round(base.attack + tier.attack * steps);
    const defense = Math.round(base.defense + tier.defense * steps);
    const spawn = opts.spawn || { x: 620, y: 360 };

    return {
      kind: 'monster',
      def: def,
      enemyId: def.id,
      name: def.name,
      body: def.body || 'humanoid',
      level: lv,
      tier: def.tier || 'mob',
      isBoss: !!def.boss || def.tier === 'boss',
      hp: maxHp,
      maxHp: maxHp,
      attack: attack,
      defense: defense,
      speed: base.speed || 70,
      radius: Math.round((def.size || 1) * 10.5),
      scale: def.size || 1,
      xp: Math.round((base.xp || 10) * (1 + 0.5 * steps)),
      coins: Math.round((base.coins || 5) * (1 + 0.45 * steps)),
      palette: def.palette || {},
      abilities: (def.abilities || []).map(function (ability) { return Object.assign({ timerMs: 1200 + Math.random() * 1800 }, ability); }),
      phases: (def.phases || []).slice(),
      phaseIndex: 0,
      enrage: 0,
      telegraphMs: 0,
      telegraph: null,
      boss: !!opts.boss || !!def.boss || def.tier === 'boss',

      pos: { x: spawn.x, y: spawn.y },
      home: { x: spawn.x, y: spawn.y },
      alive: true,
      aggro: opts.aggro !== false,
      wanderTarget: { x: spawn.x, y: spawn.y },
      wanderTimer: Utils.randRange(0.4, 1.6),
      // No enemy record carries attackCooldownMs, so derive a sane swing rate
      // from the tier — otherwise the counter goes NaN and a monster swings
      // once, then stands there forever.
      attackCooldownMs: Math.round((def.attackCooldownMs ||
        (def.tier === 'boss' ? 2200 : def.tier === 'elite' ? 1800 : 1500)) *
        Utils.randRange(0.9, 1.12)),
      // --- AI: patrol radius, leash and a reaction delay before committing ---
      ai: { state: 'idle', timer: Utils.randRange(0.2, 1.2) },
      aiOffset: Utils.randInt(0, 4),
      leash: def.leashRange || (def.boss || def.tier === 'boss' ? 400 : 220),
      losTimer: Utils.randRange(0, 0.4),
      patrolTarget: null,
      attackCooldown: 0,
      attackAnim: 0,
      hitFlash: 0,
      deathTimer: 0,
      respawnTimer: 0,
      spawnPulse: opts.noSpawnDelay ? 0 : 1,
      bob: Utils.randRange(0, Math.PI * 2),
      status: null,
      anim: { state: 'idle', t: 0 },
      facing: { x: -1, y: 0 },
      rewardValue: opts.reward !== false
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
      attackCooldownMs: Math.round((def.attackCooldownMs || 1500) * Utils.randRange(0.9, 1.12)),
      ai: { state: 'idle', timer: Utils.randRange(0.2, 1.2) },
      aiOffset: Utils.randInt(0, 4),
      leash: def.leashRange || 220,
      losTimer: Utils.randRange(0, 0.4),
      patrolTarget: null,
      attackCooldown: 0,
      attackAnim: 0,
      hitFlash: 0,
      deathTimer: 0,
      respawnTimer: 0,
      status: null,
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

    /** Player settings (Settings screen) can silence feedback effects. */
    function bodyHas(className) {
      const body = root.document && root.document.body;
      return !!(body && body.classList && body.classList.contains(className));
    }

    function addFloater(x, y, text, options) {
      if (bodyHas('no-damage')) return;
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

    function addShake(amount) {
      if (bodyHas('no-shake')) return;
      shake = Math.min(14, shake + amount);
    }

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
      // MMORPG presentation layer: when present it takes over the frame
      // (its own camera, world, rigs and VFX). The 2D renderer below stays
      // intact as the fallback, so nothing about the engine changes.
      if (root.MytharaRender3D && root.MytharaRender3D.attach(canvas)) {
        ctx.use3d = true;
        if (ctx.background === null) ctx.background = null;
        if (root.document && root.document.body) root.document.body.classList.add('render-3d');
        return ctx.ctx2d;
      }
      ctx.background = buildBackground();
      resize();
      if (root.addEventListener) root.addEventListener('resize', resize);
      return ctx.ctx2d;
    }

    function resize() {
      if (!ctx.canvas) return;
      if (ctx.use3d && root.MytharaRender3D && root.MytharaRender3D.isReady()) {
        root.MytharaRender3D.resize();
        return;
      }
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

      // 3D MMORPG frame (sky, terrain, props, rigs, VFX, weather, labels)
      if (ctx.use3d && root.MytharaRender3D && root.MytharaRender3D.isReady()) {
        root.MytharaRender3D.render(state, state.lastDeltaSeconds || 0.0167);
        root.MytharaRender3D.tickHud(state.lastDeltaSeconds || 0.0167, state);
        return;
      }

      c.save();
      const shake = Effects.getShake();
      if (shake > 0.05) {
        c.translate(Utils.randRange(-shake, shake), Utils.randRange(-shake, shake));
      }

      if (ctx.background) c.drawImage(ctx.background, 0, 0, WORLD.width, WORLD.height);
      else { c.fillStyle = ZONE.palette.groundBottom; c.fillRect(0, 0, WORLD.width, WORLD.height); }

      const monsters = state.monsters || (state.monster ? [state.monster] : []);
      const actors = monsters.concat([state.player]).filter(function (a) { return a; });
      actors.sort(function (a, b) { return a.pos.y - b.pos.y; });

      actors.forEach(function (actor) {
        if (actor.kind === 'duelist') drawDuelist(c, actor, state);
        else if (actor.kind === 'monster') drawMonster(c, actor, state);
        else drawPlayer(c, actor, state);
      });

      drawProjectiles(c);
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

    /* ---------- hero sprites (shared with the character-select preview) ---------- */
    function drawCape(c, look) {
      c.fillStyle = look.cloth || look.primary;
      c.beginPath();
      c.moveTo(-9, -8);
      c.quadraticCurveTo(-17, 6, -12, 17);
      c.lineTo(12, 17);
      c.quadraticCurveTo(17, 6, 9, -8);
      c.closePath();
      c.fill();
    }

    function drawBody(c, look) {
      const primary = look.primary || '#3f5ecf';
      const secondary = look.secondary || primary;
      const bare = look.bareArms;

      if (look.robe) {
        // flowing robe down to the ground
        c.fillStyle = primary;
        c.beginPath();
        c.moveTo(-9, -9);
        c.quadraticCurveTo(-16, 8, -13, 15);
        c.lineTo(13, 15);
        c.quadraticCurveTo(16, 8, 9, -9);
        c.closePath();
        c.fill();
        c.fillStyle = secondary;
        c.beginPath();
        c.moveTo(-6, -7);
        c.quadraticCurveTo(-9, 8, -6, 14);
        c.lineTo(6, 14);
        c.quadraticCurveTo(9, 8, 6, -7);
        c.closePath();
        c.fill();
      } else {
        // legs
        c.fillStyle = bare ? (look.skin || '#e8b183') : (look.cloth || '#2b3a7a');
        c.fillRect(-7, 4, 6, 11);
        c.fillRect(1, 4, 6, 11);
        c.fillStyle = '#3a2a1c';
        c.fillRect(-8, 13, 7, 4);
        c.fillRect(1, 13, 7, 4);
        // torso
        c.fillStyle = primary;
        c.beginPath();
        c.moveTo(-11, 6);
        c.quadraticCurveTo(-13, -6, 0, -9);
        c.quadraticCurveTo(13, -6, 11, 6);
        c.closePath();
        c.fill();
        c.fillStyle = secondary;
        c.beginPath();
        c.moveTo(-7, 5);
        c.quadraticCurveTo(-9, -4, 0, -7);
        c.quadraticCurveTo(9, -4, 7, 5);
        c.closePath();
        c.fill();
      }

      // belt / sash
      c.fillStyle = look.accent || '#a8792f';
      c.fillRect(-10, 5, 20, 3.4);
      c.fillStyle = look.metal || '#d8d2b0';
      c.fillRect(-2.4, 5, 4.8, 3.4);

      // bare arms for the berserker / dragon knight
      if (bare) {
        c.fillStyle = look.skin || '#e8b183';
        c.beginPath();
        c.ellipse(-11, -2, 3.6, 7, 0.25, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.ellipse(11, -2, 3.6, 7, -0.25, 0, Math.PI * 2);
        c.fill();
      }

      // shoulder guard
      if (look.metal) {
        c.fillStyle = look.metal;
        c.beginPath();
        c.ellipse(-10, -6, 5.4, 4, -0.3, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.ellipse(10, -6, 5.4, 4, 0.3, 0, Math.PI * 2);
        c.fill();
      }
    }

    function drawHead(c, look, facing) {
      // head
      c.fillStyle = look.skin || '#f2c79c';
      c.beginPath();
      c.arc(0, -17, 8.4, 0, Math.PI * 2);
      c.fill();

      // hood or hair
      if (look.hood) {
        c.fillStyle = look.cloth || '#191428';
        c.beginPath();
        c.arc(0, -18, 9.4, Math.PI * 0.92, Math.PI * 2.08);
        c.fill();
        c.beginPath();
        c.moveTo(-9, -16);
        c.quadraticCurveTo(-11, -6, -6, -4);
        c.lineTo(6, -4);
        c.quadraticCurveTo(11, -6, 9, -16);
        c.closePath();
        c.fill();
      } else {
        c.fillStyle = look.hair || '#4a3320';
        c.beginPath();
        c.arc(0, -19, 8.6, Math.PI * 1.02, Math.PI * 2.02);
        c.fill();
        c.beginPath();
        c.ellipse(facing < 0 ? 6 : -6, -18, 3.2, 5.6, 0, 0, Math.PI * 2);
        c.fill();
      }

      // helmet
      if (look.helm) {
        c.fillStyle = look.metal || '#b9c2d6';
        c.beginPath();
        c.arc(0, -18.5, 9.2, Math.PI, Math.PI * 2);
        c.fill();
        c.fillRect(-9.2, -19, 18.4, 3);
        c.fillStyle = look.accent || '#f2c14e';
        c.fillRect(-1.6, -27, 3.2, 5);
      }

      // dragon horns
      if (look.horns) {
        c.fillStyle = look.accent || '#d9a05a';
        [[-1, -1], [1, 1]].forEach(function (dir) {
          c.beginPath();
          c.moveTo(dir[0] * 5, -25);
          c.quadraticCurveTo(dir[0] * 13, -32, dir[0] * 7, -36);
          c.quadraticCurveTo(dir[0] * 8, -29, dir[0] * 2, -24);
          c.closePath();
          c.fill();
        });
      }

      // eyes
      if (!look.helm) {
        c.fillStyle = '#25313f';
        const shift = facing < 0 ? -1.6 : 1.6;
        c.beginPath(); c.arc(-3 + shift, -16, 1.4, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(3 + shift, -16, 1.4, 0, Math.PI * 2); c.fill();
      }

      // scarf / mask
      if (look.scarf) {
        c.fillStyle = look.accent || '#c23b3b';
        c.fillRect(-8.6, -12.6, 17.2, 4);
      }
    }

    function drawWeapon(c, look, facing, attack, attackKind) {
      const type = look.weapon || 'sword';
      const t = 1 - attack;
      const swing = facing * (-2.3 + t * 3.0);
      const metal = look.metal || '#c9d4ea';
      const accent = look.accent || '#a8792f';

      c.save();
      c.scale(facing, 1);         // weapons are drawn facing right, then mirrored

      if (type === 'sword-shield' || type === 'sword') {
        if (attack > 0) {
          c.save();
          c.translate(2, -8);
          c.rotate(-1.9 + t * 2.6);
          c.fillStyle = metal; c.fillRect(0, -1.7, 25, 3.4);
          c.fillStyle = '#8b93a8'; c.fillRect(0, -1.7, 6, 3.4);
          c.fillStyle = accent; c.fillRect(-4.4, -3.6, 4.4, 7.2);
          c.restore();
        } else {
          c.save();
          c.translate(2, -6);
          c.rotate(0.42);
          c.fillStyle = metal; c.fillRect(-2, -21, 3.4, 23);
          c.fillStyle = '#8b93a8'; c.fillRect(-2, -21, 3.4, 5);
          c.fillStyle = accent; c.fillRect(-4, 0, 7.4, 3.4);
          c.restore();
        }
        if (look.shield) {
          c.save();
          c.translate(-3.5, -6);
          c.rotate(0.12);
          c.fillStyle = look.secondary || '#e8e2d0';
          c.beginPath();
          c.moveTo(-9, -8); c.lineTo(9, -8); c.lineTo(9, 4);
          c.quadraticCurveTo(0, 13, -9, 4);
          c.closePath(); c.fill();
          c.fillStyle = accent;
          c.beginPath();
          c.moveTo(-3, -6); c.lineTo(3, -6); c.lineTo(3, 3); c.lineTo(0, 6.5); c.lineTo(-3, 3);
          c.closePath(); c.fill();
          c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1.2; c.stroke();
          c.restore();
        }
      }

      if (type === 'greataxe') {
        c.save();
        c.translate(6, -4);
        c.rotate(attack > 0 ? (-2.0 + t * 2.8) : 0.82);
        c.fillStyle = '#6b4a2a'; c.fillRect(-2, -20, 4, 40);
        c.fillStyle = metal;
        c.beginPath();
        c.moveTo(0, -21);
        c.quadraticCurveTo(17, -17, 15, -3);
        c.quadraticCurveTo(8, -8, 0, -7);
        c.closePath(); c.fill();
        c.beginPath();
        c.moveTo(0, -21);
        c.quadraticCurveTo(-15, -18, -14, -5);
        c.quadraticCurveTo(-8, -8, 0, -7);
        c.closePath(); c.fill();
        c.fillStyle = accent; c.fillRect(-2.4, -22, 4.8, 4);
        c.restore();
      }

      if (type === 'daggers' || type === 'dual-blades') {
        const long = type === 'dual-blades';
        const bladeLen = long ? 22 : 13;
        // off-hand blade
        c.save();
        c.translate(-12, -1);
        c.rotate(-0.85);
        c.fillStyle = '#8b93a8'; c.fillRect(-1.6, -bladeLen, 3.2, bladeLen);
        c.fillStyle = accent; c.fillRect(-3, -1.6, 6, 3.2);
        c.restore();
        // main blade
        c.save();
        c.translate(4, -2);
        c.rotate(attack > 0 ? (-1.9 + t * 2.9) : 0.8);
        c.fillStyle = metal; c.fillRect(-1.8, -bladeLen, 3.6, bladeLen);
        c.fillStyle = '#8b93a8'; c.fillRect(-1.8, -bladeLen, 3.6, bladeLen * 0.3);
        c.fillStyle = accent; c.fillRect(-3.4, -1.8, 6.8, 3.6);
        c.restore();
      }

      if (type === 'bow') {
        const draw = attack > 0 ? 1 - Math.abs(0.5 - t) * 2 : 0;   // string pull
        c.save();
        c.translate(6, -7);
        c.rotate(0.24);
        c.strokeStyle = '#7a5230'; c.lineWidth = 3.2; c.lineCap = 'round';
        c.beginPath();
        c.moveTo(0, -20);
        c.quadraticCurveTo(13, 0, 0, 20);
        c.stroke();
        c.strokeStyle = 'rgba(240,240,255,0.75)'; c.lineWidth = 1.1;
        c.beginPath();
        c.moveTo(0, -20);
        c.lineTo(-5 - draw * 7, 0);
        c.lineTo(0, 20);
        c.stroke();
        if (attack > 0) {
          c.fillStyle = '#e8d9a0';
          c.fillRect(-8 - draw * 6, -1, 18, 2);
        }
        c.restore();
      }

      if (type === 'staff') {
        const casting = attack > 0 && attackKind === 'cast';
        c.save();
        c.translate(7, -6);
        c.rotate(casting ? -0.35 : 0.2);
        c.fillStyle = '#6b4a2a';
        c.fillRect(-2, -22, 4, 42);
        c.fillStyle = accent;
        c.beginPath(); c.arc(0, -25, 5.6, 0, Math.PI * 2); c.fill();
        c.globalAlpha = casting ? 0.95 : 0.55;
        c.fillStyle = look.aura || accent;
        c.beginPath(); c.arc(0, -25, casting ? 7.6 : 4.4, 0, Math.PI * 2); c.fill();
        c.restore();
      }

      if (type === 'dragon-greatsword') {
        c.save();
        c.translate(3, -9);
        c.rotate(attack > 0 ? (-2.2 + t * 3.0) : -0.42);
        c.fillStyle = metal;
        c.beginPath();
        c.moveTo(0, -2);
        c.lineTo(30, -1.4);
        c.lineTo(26, 3.4);
        c.lineTo(0, 2.6);
        c.closePath(); c.fill();
        c.fillStyle = '#8b93a8';
        c.beginPath();
        c.moveTo(0, -6.5); c.lineTo(27, -3.2); c.lineTo(30, -1.4); c.lineTo(0, -2);
        c.closePath(); c.fill();
        c.fillStyle = accent;
        c.fillRect(-4.6, -5, 4.6, 10);
        c.fillStyle = look.primary || '#6b1f24';
        c.fillRect(-9, -2.2, 5, 4.4);
        c.restore();
      }

      c.restore();
    }

    /**
     * Draw a hero. Shared by the world renderer and the character-select preview.
     * opts: { look, x, y, scale, facing, walkPhase, moving, attackAnim,
     *         attackKind, time, alpha, downed, stealth }
     */
    function drawHero(c, opts) {
      const o = opts || {};
      const look = o.look || {};
      const facing = o.facing === undefined ? 1 : (o.facing >= 0 ? 1 : -1);
      const attack = o.attackAnim || 0;

      // animation state drives pose, offset and effects
      const animState = o.animState || (attack > 0 ? 'attack' : (o.downed ? 'death' : (o.moving ? (o.running ? 'run' : 'walk') : 'idle')));
      const animProgress = Utils.clamp(o.animProgress === undefined ? 0 : o.animProgress, 0, 1);
      const speed = animState === 'run' ? 2.4 : 1.9;

      let swing = 0;
      if (animState === 'attack') swing = animProgress;
      else swing = attack > 0 ? 1 - attack : 0;

      const walk = Math.sin((o.walkPhase || 0) * 2 * speed) * (o.moving ? (animState === 'run' ? 2.8 : 1.8) : 0);
      let bob = o.moving ? walk : Math.sin((o.time || 0) * 2) * 0.9;
      let offsetX = 0;
      let extraRotation = 0;

      if (animState === 'run') extraRotation = -facing * 0.1;
      if (animState === 'hurt') {
        offsetX = -facing * 4 * (1 - animProgress);
        extraRotation = -facing * 0.16 * (1 - animProgress);
      }
      if (animState === 'ultimate') {
        bob = -6 - Math.sin(animProgress * Math.PI) * 3;
      }
      if (animState === 'skill') {
        bob = -2 - Math.sin(animProgress * Math.PI) * 2;
      }

      c.save();
      c.translate(o.x || 0, o.y || 0);
      if (o.scale && o.scale !== 1) c.scale(o.scale, o.scale);
      if (o.alpha !== undefined) c.globalAlpha = o.alpha;

      // death: fall over and fade
      if (animState === 'death' || o.downed) {
        const fall = animState === 'death' ? Utils.clamp(animProgress * 1.6, 0, 1) : 1;
        c.rotate((Math.PI / 2.4) * fall);
        c.globalAlpha = (o.alpha === undefined ? 1 : o.alpha) * (1 - fall * 0.35);
      } else if (extraRotation) {
        c.rotate(extraRotation);
      }

      // shadow
      c.fillStyle = 'rgba(10,20,10,0.3)';
      c.beginPath();
      c.ellipse(0, 0, 17, 6, 0, 0, Math.PI * 2);
      c.fill();

      c.translate(offsetX, bob);

      // ultimate / skill energy
      if (animState === 'ultimate' || animState === 'skill') {
        const pulse = animState === 'ultimate' ? 1 - animProgress * 0.4 : 0.6;
        const radius = (animState === 'ultimate' ? 30 + animProgress * 34 : 24) * (o.scale || 1);
        c.save();
        c.globalAlpha = 0.35 * pulse;
        c.strokeStyle = look.accent || '#f2c14e';
        c.lineWidth = 3;
        c.beginPath();
        c.arc(0, -6, radius, 0, Math.PI * 2);
        c.stroke();
        c.globalAlpha = 0.2 * pulse;
        c.fillStyle = look.aura || look.accent || '#f2c14e';
        c.beginPath();
        c.arc(0, -6, radius * 0.8, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }

      // run dust puffs
      if (animState === 'run') {
        c.save();
        c.globalAlpha = 0.25;
        c.fillStyle = '#ffffff';
        [-8, -2, 6].forEach(function (dx, i) {
          c.beginPath();
          c.ellipse(dx, 8 + Math.sin((o.walkPhase || 0) * 6 + i) * 1.5, 4, 2, 0, 0, Math.PI * 2);
          c.fill();
        });
        c.restore();
      }

      // magic aura: a soft glow that sits behind the body, never over the face
      if (look.aura) {
        const pulse = 0.55 + Math.sin((o.time || 0) * 3) * 0.15;
        const baseAlpha = (o.alpha === undefined ? 1 : o.alpha) * pulse;
        const glow = c.createRadialGradient(0, -6, 4, 0, -6, 34);
        glow.addColorStop(0, Utils.rgba(look.aura, 0.34 * baseAlpha));
        glow.addColorStop(0.55, Utils.rgba(look.aura, 0.16 * baseAlpha));
        glow.addColorStop(1, Utils.rgba(look.aura, 0));
        c.fillStyle = glow;
        c.beginPath();
        c.ellipse(0, -6, 30, 38, 0, 0, Math.PI * 2);
        c.fill();
      }

      if (look.cape) drawCape(c, look);

      if (o.stealth) {
        c.globalAlpha = (o.alpha === undefined ? 1 : o.alpha) * 0.45;
      }

      drawBody(c, look);
      drawHead(c, look, facing);
      drawWeapon(c, look, facing, animState === 'attack' ? (1 - swing) : attack,
        animState === 'ultimate' || animState === 'skill' ? 'cast' : o.attackKind);

      // hurt tint
      if (animState === 'hurt') {
        c.globalAlpha = 0.45 * (1 - animProgress);
        c.fillStyle = '#ff5f6d';
        c.beginPath();
        c.arc(0, -14, 16, 0, Math.PI * 2);
        c.fill();
      }

      c.restore();
    }

    function drawPlayer(c, player, state) {
      const p = player.pos;
      const isPlayer = state.player === player;
      const stealthed = Skills.isStealthed(player);

      // respawn aura while downed
      if (player.downed) {
        c.fillStyle = 'rgba(120,160,255,0.18)';
        c.beginPath();
        c.arc(p.x, p.y, player.radius * 2.4, 0, Math.PI * 2);
        c.fill();
      }

      // stealth shimmer
      if (stealthed) {
        c.save();
        c.globalAlpha = 0.5;
        c.strokeStyle = 'rgba(180,200,255,0.7)';
        c.setLineDash([5, 5]);
        c.lineWidth = 2;
        c.beginPath();
        c.ellipse(p.x, p.y - 6, player.radius + 10, player.radius + 16, 0, 0, Math.PI * 2);
        c.stroke();
        c.restore();
      }

      drawHero(c, {
        look: player.look,
        x: p.x,
        y: p.y,
        facing: player.facing.x === 0 ? 1 : (player.facing.x < 0 ? -1 : 1),
        walkPhase: player.walkPhase,
        moving: player.moving,
        attackAnim: player.attackAnim,
        attackKind: player.attackType === 'ranged' ? 'cast' : 'melee',
        time: state.time,
        downed: player.downed,
        stealth: stealthed,
        alpha: isPlayer && player.hitFlash > 0 ? 1 : 1
      });

      if (player.hitFlash > 0) {
        c.save();
        c.globalAlpha = Utils.clamp(player.hitFlash, 0, 1) * 0.5;
        c.fillStyle = '#ff6b6b';
        c.beginPath();
        c.arc(p.x, p.y - 8, player.radius + 7, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }

      // name plate (stacked: name → level → HP bar)
      drawNameTag(c, p.x, p.y - 52, player.name, 'Lv. ' + player.level + ' ' + player.title, '#ffe9a8');
      drawMiniBar(c, p.x, p.y - 34, 46, 5, player.hp / player.maxHp, '#ff5f6d', '#3a0d12');
    }

    /** Arena opponents: player-style heroes driven by the bot AI. */
    function drawDuelist(c, duelist, state) {
      if (!duelist.alive) { drawCreature(c, duelist, state); return; }
      const p = duelist.pos;

      if (duelist.telegraphMs > 0) {
        c.save();
        c.globalAlpha = 0.35;
        c.strokeStyle = '#ff6b4a';
        c.lineWidth = 3;
        c.beginPath();
        c.ellipse(p.x, p.y, 34, 15, 0, 0, Math.PI * 2);
        c.stroke();
        c.restore();
      }

      drawHero(c, {
        look: duelist.look,
        x: p.x,
        y: p.y,
        facing: duelist.facing && duelist.facing.x < 0 ? -1 : 1,
        walkPhase: duelist.walkPhase || 0,
        moving: duelist.moving,
        running: true,
        animState: duelist.anim ? duelist.anim.state : 'idle',
        animProgress: duelist.anim ? duelist.anim.progress : 0,
        attackAnim: duelist.attackAnim || 0,
        attackKind: duelist.attackType === 'ranged' ? 'cast' : 'melee',
        time: state.time
      });

      if (duelist.hitFlash > 0) {
        c.save();
        c.globalAlpha = MathUtilsClamp(duelist.hitFlash, 0, 1) * 0.5;
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.arc(p.x, p.y - 8, duelist.radius + 7, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }

      drawNameTag(c, p.x, p.y - 52, duelist.name, 'Lv. ' + duelist.level + ' ' + duelist.title, '#ff9aa2');
      drawMiniBar(c, p.x, p.y - 34, 46, 5, duelist.hp / duelist.maxHp, '#ff5f6d', '#3a0d12');
    }

    function MathUtilsClamp(value, min, max) { return Utils.clamp(value, min, max); }

    function drawProjectiles(c) {
      c.save();
      Projectiles.list.forEach(function (p) {
        const def = p.def;
        const angle = Math.atan2(p.vy, p.vx);
        c.save();
        c.translate(p.x, p.y);

        // trail
        if (def.trail) {
          c.globalAlpha = 0.45;
          c.strokeStyle = def.trail;
          c.lineWidth = p.radius * 1.3;
          c.lineCap = 'round';
          c.beginPath();
          c.moveTo(0, 0);
          c.lineTo(-Math.cos(angle) * p.radius * 3.4, -Math.sin(angle) * p.radius * 3.4);
          c.stroke();
          c.globalAlpha = 1;
        }

        if (def.style === 'arrow') {
          c.rotate(angle);
          c.fillStyle = def.color;
          c.fillRect(0, -1.4, 18, 2.8);
          c.fillStyle = '#9aa6c4';
          c.beginPath();
          c.moveTo(18, -3.4); c.lineTo(25, 0); c.lineTo(18, 3.4);
          c.closePath(); c.fill();
        } else if (def.style === 'shard') {
          c.rotate(angle + p.spin * 0.2);
          c.fillStyle = def.color;
          c.beginPath();
          c.moveTo(9, 0); c.lineTo(0, -5); c.lineTo(-7, 0); c.lineTo(0, 5);
          c.closePath(); c.fill();
          c.strokeStyle = def.trail; c.lineWidth = 1.4; c.stroke();
        } else if (def.style === 'star') {
          c.rotate(p.spin);
          c.fillStyle = def.color;
          for (let i = 0; i < 4; i++) {
            c.rotate(Math.PI / 2);
            c.beginPath();
            c.moveTo(0, 0); c.lineTo(p.radius * 1.3, -p.radius * 0.4); c.lineTo(p.radius * 1.3, p.radius * 0.4);
            c.closePath(); c.fill();
          }
        } else {
          // glowing orb
          const grad = c.createRadialGradient(-p.radius * 0.3, -p.radius * 0.3, 1, 0, 0, p.radius * 1.4);
          grad.addColorStop(0, '#ffffff');
          grad.addColorStop(0.45, def.color);
          grad.addColorStop(1, def.trail || def.color);
          c.fillStyle = grad;
          c.beginPath();
          c.arc(0, 0, p.radius, 0, Math.PI * 2);
          c.fill();
        }
        c.restore();
      });
      c.restore();
    }

    function drawMonster(c, monster, state) {
      if (monster.enemyId || !monster.def || !monster.def.palette) { drawCreature(c, monster, state); return; }
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

      // --- status effects ---
      if (Statuses.isFrozen(monster)) {
        c.globalAlpha = 0.5;
        c.fillStyle = '#bfefff';
        c.beginPath();
        c.ellipse(0, 0, w * 1.12, h * 1.2, 0, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 0.9;
        c.fillStyle = '#eafaff';
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + state.time;
          c.beginPath();
          c.moveTo(Math.cos(a) * w * 0.9, Math.sin(a) * h * 0.9 - 4);
          c.lineTo(Math.cos(a) * w * 1.35, Math.sin(a) * h * 1.35 + 6);
          c.lineTo(Math.cos(a) * w * 1.5, Math.sin(a) * h * 0.6 - 4);
          c.closePath();
          c.fill();
        }
        c.globalAlpha = 1;
      } else if (Statuses.isSlowed(monster)) {
        c.globalAlpha = 0.28;
        c.fillStyle = '#8fe3ff';
        c.beginPath();
        c.ellipse(0, 0, w * 1.1, h * 1.12, 0, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
      }

      if (Statuses.isBurning(monster)) {
        for (let i = 0; i < 3; i++) {
          const phase = state.time * 6 + i * 2.1;
          const fx = Math.sin(phase) * w * 0.65;
          const fy = -h - 4 - (Math.sin(phase * 1.4) * 0.5 + 0.5) * 12;
          c.fillStyle = monster.status && monster.status.poison ? 'rgba(155,227,106,0.75)' : 'rgba(255,155,74,0.8)';
          c.beginPath();
          c.ellipse(fx, fy, 3.2, 5.4, Math.sin(phase) * 0.6, 0, Math.PI * 2);
          c.fill();
        }
      }

      if (monster.status && monster.status.stunMs > 0) {
        c.fillStyle = '#ffe9a8';
        for (let i = 0; i < 3; i++) {
          const a = state.time * 5 + (i / 3) * Math.PI * 2;
          c.beginPath();
          c.arc(Math.cos(a) * 16, -h - 12 + Math.sin(a) * 4, 2.2, 0, Math.PI * 2);
          c.fill();
        }
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

    /* ---------- data-driven enemy art (js/data-enemies.js) ---------- */
    /** Rounded body helper used by most creature types. */
    function blob(c, x, y, rx, ry, fill, outline) {
      c.fillStyle = fill;
      c.beginPath();
      c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      c.fill();
      if (outline) {
        c.strokeStyle = outline;
        c.lineWidth = 1.4;
        c.stroke();
      }
    }

    function glowEyes(c, x, y, spacing, size, color) {
      c.fillStyle = color;
      c.beginPath(); c.arc(x - spacing, y, size, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(x + spacing, y, size, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 0.4;
      c.beginPath(); c.arc(x - spacing, y, size * 2.2, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(x + spacing, y, size * 2.2, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1;
    }

    function drawWings(c, pal, scale, flap) {
      c.fillStyle = Utils.rgba(pal.dark || '#1a1428', 0.92);
      [-1, 1].forEach(function (dir) {
        c.save();
        c.scale(dir, 1);
        c.rotate(-0.35 + flap * 0.5);
        c.beginPath();
        c.moveTo(4 * scale, -6 * scale);
        c.quadraticCurveTo(34 * scale, -30 * scale, 40 * scale, -2 * scale);
        c.quadraticCurveTo(26 * scale, 2 * scale, 4 * scale, 4 * scale);
        c.closePath();
        c.fill();
        c.restore();
      });
    }

    function drawHorns(c, pal, scale) {
      c.fillStyle = pal.accent || '#e8d9a0';
      [-1, 1].forEach(function (dir) {
        c.beginPath();
        c.moveTo(dir * 4 * scale, -16 * scale);
        c.quadraticCurveTo(dir * 13 * scale, -26 * scale, dir * 8 * scale, -30 * scale);
        c.quadraticCurveTo(dir * 8 * scale, -22 * scale, dir * 2 * scale, -15 * scale);
        c.closePath();
        c.fill();
      });
    }

    /** Draws the creature body for a `body` type, facing right by default. */
    function drawCreatureShape(c, monster, time) {
      const pal = monster.palette || {};
      const primary = pal.primary || '#7a9a6a';
      const secondary = pal.secondary || primary;
      const dark = pal.dark || '#2f3a2a';
      const accent = pal.accent || '#f2c14e';
      const eye = pal.eye || '#ffe27a';
      const def = monster.def || {};
      const scale = monster.scale || 1;
      const attack = monster.attackAnim || 0;
      const lunge = attack > 0 ? Math.sin((1 - attack) * Math.PI) * 3 : 0;
      const body = monster.body || 'humanoid';

      c.save();
      c.translate(lunge, 0);

      if (body === 'blob') {
        const squash = Math.sin(time * 4 + monster.bob) * 0.06;
        const w = 20 * scale * (1 + squash);
        const h = 15 * scale * (1 - squash);
        blob(c, 0, -h * 0.9, w, h, primary, dark);
        blob(c, 0, -h * 0.6, w * 0.9, h * 0.55, secondary);
        c.fillStyle = Utils.rgba(pal.shine || '#ffffff', 0.5);
        blob(c, -w * 0.35, -h * 1.4, w * 0.22, h * 0.16, Utils.rgba('#ffffff', 0.5));
        glowEyes(c, 0, -h * 1.1, 5 * scale, 2.2 * scale, eye);
      }

      else if (body === 'humanoid') {
        const robe = def.robe;
        // legs
        c.fillStyle = dark;
        if (!robe) {
          c.fillRect(-6 * scale, -6 * scale, 5 * scale, 12 * scale);
          c.fillRect(1 * scale, -6 * scale, 5 * scale, 12 * scale);
        }
        // torso
        c.fillStyle = primary;
        c.beginPath();
        c.moveTo(-10 * scale, 6 * scale);
        c.quadraticCurveTo(-12 * scale, -8 * scale, 0, -11 * scale);
        c.quadraticCurveTo(12 * scale, -8 * scale, 10 * scale, 6 * scale);
        if (robe) c.quadraticCurveTo(0, 16 * scale, -10 * scale, 6 * scale);
        c.closePath();
        c.fill();
        c.fillStyle = secondary;
        c.beginPath();
        c.moveTo(-6 * scale, 4 * scale);
        c.quadraticCurveTo(-8 * scale, -6 * scale, 0, -9 * scale);
        c.quadraticCurveTo(8 * scale, -6 * scale, 6 * scale, 4 * scale);
        c.closePath();
        c.fill();
        // arms
        c.fillStyle = secondary;
        c.beginPath(); c.ellipse(-11 * scale, -2 * scale, 3 * scale, 6 * scale, 0.3, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.ellipse(11 * scale, -2 * scale, 3 * scale, 6 * scale, -0.3, 0, Math.PI * 2); c.fill();
        // head
        blob(c, 0, -17 * scale, 8 * scale, 8 * scale, primary);
        c.fillStyle = dark;
        c.beginPath();
        c.arc(0, -19 * scale, 8.2 * scale, Math.PI * 1.05, Math.PI * 2);
        c.fill();
        glowEyes(c, 0, -16 * scale, 3.4 * scale, 1.6 * scale, eye);
        if (def.horns) drawHorns(c, pal, scale);
        if (def.crown) {
          c.fillStyle = accent;
          c.beginPath();
          c.moveTo(-8 * scale, -25 * scale);
          c.lineTo(-5 * scale, -31 * scale);
          c.lineTo(-2 * scale, -25 * scale);
          c.lineTo(1 * scale, -32 * scale);
          c.lineTo(4 * scale, -25 * scale);
          c.lineTo(7 * scale, -31 * scale);
          c.lineTo(8 * scale, -24 * scale);
          c.closePath();
          c.fill();
        }
        // weapon
        const weapon = def.weapon;
        if (weapon) {
          c.save();
          c.translate(12 * scale, -6 * scale);
          c.rotate(attack > 0 ? (-1.9 + (1 - attack) * 2.7) : 0.55);
          if (weapon === 'club' || weapon === 'greatclub') {
            c.fillStyle = '#6b4a2a';
            c.fillRect(-2 * scale, -18 * scale, 4 * scale, 22 * scale);
            blob(c, 0, -22 * scale, 6 * scale, 7 * scale, dark, accent);
          } else if (weapon === 'axe') {
            c.fillStyle = '#6b4a2a'; c.fillRect(-2 * scale, -16 * scale, 4 * scale, 24 * scale);
            c.fillStyle = '#b9c2d6';
            c.beginPath();
            c.moveTo(0, -18 * scale); c.quadraticCurveTo(11 * scale, -14 * scale, 9 * scale, -2 * scale);
            c.quadraticCurveTo(4 * scale, -7 * scale, 0, -6 * scale); c.closePath(); c.fill();
          } else if (weapon === 'greataxe') {
            c.fillStyle = '#5a3d24'; c.fillRect(-2.5 * scale, -22 * scale, 5 * scale, 34 * scale);
            c.fillStyle = '#b9c2d6';
            c.beginPath();
            c.moveTo(0, -24 * scale); c.quadraticCurveTo(16 * scale, -18 * scale, 13 * scale, 0);
            c.quadraticCurveTo(6 * scale, -6 * scale, 0, -5 * scale); c.closePath(); c.fill();
          } else if (weapon === 'staff') {
            c.fillStyle = '#6b4a2a'; c.fillRect(-2 * scale, -20 * scale, 4 * scale, 30 * scale);
            blob(c, 0, -23 * scale, 5 * scale, 5 * scale, accent);
            c.globalAlpha = 0.5;
            blob(c, 0, -23 * scale, 9 * scale, 9 * scale, Utils.rgba(accent, 0.4));
            c.globalAlpha = 1;
          } else if (weapon === 'daggers' || weapon === 'dual-blades') {
            c.fillStyle = '#d7e0f2'; c.fillRect(-1.6 * scale, -16 * scale, 3.2 * scale, 16 * scale);
          } else {
            c.fillStyle = '#c9d4ea'; c.fillRect(-2 * scale, -22 * scale, 4 * scale, 26 * scale);
            c.fillStyle = accent; c.fillRect(-4 * scale, -1 * scale, 8 * scale, 3 * scale);
          }
          c.restore();
        }
        if (def.wings) drawWings(c, pal, scale, Math.sin(time * 3 + monster.bob) * 0.4);
      }

      else if (body === 'beast') {
        const walk = Math.sin(time * 6 + monster.bob) * 1.6;
        // legs
        c.strokeStyle = dark;
        c.lineWidth = 3.4 * scale;
        c.lineCap = 'round';
        [[-10, 6], [-4, -6], [6, 6], [12, -6]].forEach(function (pair, i) {
          const swing = i % 2 === 0 ? walk : -walk;
          c.beginPath();
          c.moveTo(pair[0] * scale, -4 * scale);
          c.lineTo((pair[0] + swing) * scale, 12 * scale);
          c.stroke();
        });
        // body
        blob(c, 0, -8 * scale, 18 * scale, 10 * scale, primary, dark);
        blob(c, 3 * scale, -11 * scale, 12 * scale, 6 * scale, secondary);
        // tail
        c.strokeStyle = primary;
        c.lineWidth = 4 * scale;
        c.beginPath();
        c.moveTo(-16 * scale, -10 * scale);
        c.quadraticCurveTo(-28 * scale, -16 * scale + Math.sin(time * 5) * 3 * scale, -32 * scale, -24 * scale);
        c.stroke();
        // head
        c.save();
        c.translate(16 * scale, -14 * scale);
        c.rotate(attack > 0 ? -0.3 : 0);
        blob(c, 0, 0, 9 * scale, 8 * scale, primary, dark);
        c.fillStyle = dark;
        c.beginPath();
        c.moveTo(8 * scale, -2 * scale);
        c.lineTo(16 * scale, 1 * scale);
        c.lineTo(8 * scale, 4 * scale);
        c.closePath();
        c.fill();
        glowEyes(c, 1 * scale, -2 * scale, 3.4 * scale, 1.5 * scale, eye);
        if (def.horns) drawHorns(c, pal, scale * 0.8);
        c.restore();
      }

      else if (body === 'arachnid') {
        c.strokeStyle = dark;
        c.lineWidth = 2.4 * scale;
        c.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          const angle = -0.2 + i * 0.5;
          [-1, 1].forEach(function (dir) {
            const baseX = dir * 4 * scale;
            const step = Math.sin(time * 5 + i + monster.bob) * 2 * scale;
            c.beginPath();
            c.moveTo(baseX, -6 * scale);
            c.quadraticCurveTo((dir * 16) * scale, -14 * scale + step, (dir * 24) * scale, 6 * scale + step);
            c.stroke();
            void angle;
          });
        }
        blob(c, 0, -9 * scale, 12 * scale, 10 * scale, primary, dark);
        blob(c, -2 * scale, -12 * scale, 7 * scale, 6 * scale, secondary);
        glowEyes(c, 5 * scale, -12 * scale, 2.6 * scale, 1.8 * scale, eye);
        c.fillStyle = eye;
        c.globalAlpha = 0.8;
        blob(c, 8 * scale, -4 * scale, 2.4 * scale, 1.8 * scale, eye);
        c.globalAlpha = 1;
      }

      else if (body === 'treant') {
        c.fillStyle = pal.accent || '#7a5230';
        c.fillRect(-5 * scale, -6 * scale, 10 * scale, 18 * scale);
        c.strokeStyle = pal.accent || '#7a5230';
        c.lineWidth = 4 * scale;
        c.lineCap = 'round';
        [-1, 1].forEach(function (dir) {
          c.beginPath();
          c.moveTo(0, -4 * scale);
          c.quadraticCurveTo(dir * 14 * scale, -10 * scale, dir * 20 * scale, 2 * scale);
          c.stroke();
        });
        blob(c, 0, -16 * scale, 16 * scale, 13 * scale, primary, dark);
        c.fillStyle = secondary;
        c.beginPath();
        c.arc(-8 * scale, -20 * scale, 8 * scale, 0, Math.PI * 2);
        c.arc(8 * scale, -20 * scale, 8 * scale, 0, Math.PI * 2);
        c.arc(0, -26 * scale, 9 * scale, 0, Math.PI * 2);
        c.fill();
        glowEyes(c, 0, -12 * scale, 4 * scale, 2 * scale, eye);
        if (monster.tier === 'boss') {
          c.strokeStyle = Utils.rgba(eye, 0.5);
          c.lineWidth = 2;
          c.beginPath();
          c.arc(0, -16 * scale, 26 * scale + Math.sin(time * 2) * 2, 0, Math.PI * 2);
          c.stroke();
        }
      }

      else if (body === 'golem') {
        // floating limbs
        const float = Math.sin(time * 2 + monster.bob) * 2;
        c.fillStyle = dark;
        blob(c, -15 * scale, -6 * scale + float, 6 * scale, 7 * scale, dark);
        blob(c, 15 * scale, -6 * scale - float, 6 * scale, 7 * scale, dark);
        // torso chunks
        c.fillStyle = primary;
        c.beginPath();
        c.moveTo(-13 * scale, 6 * scale);
        c.lineTo(-10 * scale, -16 * scale);
        c.lineTo(10 * scale, -16 * scale);
        c.lineTo(13 * scale, 6 * scale);
        c.closePath();
        c.fill();
        c.fillStyle = secondary;
        c.fillRect(-9 * scale, -12 * scale, 18 * scale, 5 * scale);
        // head
        blob(c, 0, -22 * scale, 8 * scale, 7 * scale, primary, dark);
        glowEyes(c, 0, -22 * scale, 3.4 * scale, 2.2 * scale, eye);
        if (def.crown) {
          c.fillStyle = accent;
          c.fillRect(-8 * scale, -30 * scale, 16 * scale, 3 * scale);
          [-6, 0, 6].forEach(function (dx) {
            c.beginPath();
            c.moveTo(dx * scale - 2 * scale, -30 * scale);
            c.lineTo(dx * scale, -36 * scale);
            c.lineTo(dx * scale + 2 * scale, -30 * scale);
            c.closePath();
            c.fill();
          });
        }
      }

      else if (body === 'bat') {
        const flap = Math.sin(time * 12 + monster.bob);
        drawWings(c, pal, scale * 1.1, flap);
        blob(c, 0, -12 * scale, 9 * scale, 8 * scale, primary, dark);
        c.fillStyle = dark;
        [-1, 1].forEach(function (dir) {
          c.beginPath();
          c.moveTo(dir * 3 * scale, -18 * scale);
          c.lineTo(dir * 7 * scale, -25 * scale);
          c.lineTo(dir * 1 * scale, -19 * scale);
          c.closePath();
          c.fill();
        });
        glowEyes(c, 0, -13 * scale, 3.4 * scale, 1.7 * scale, eye);
      }

      else if (body === 'serpent') {
        const flap = Math.sin(time * 3 + monster.bob);
        if (def.wings) drawWings(c, pal, scale * 1.3, flap);
        // coiling tail
        c.strokeStyle = primary;
        c.lineWidth = 9 * scale;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(-6 * scale, 4 * scale);
        c.quadraticCurveTo(-24 * scale, 6 * scale, -28 * scale, -14 * scale + flap * 2);
        c.stroke();
        c.strokeStyle = secondary;
        c.lineWidth = 5 * scale;
        c.beginPath();
        c.moveTo(-8 * scale, 2 * scale);
        c.quadraticCurveTo(-22 * scale, 3 * scale, -25 * scale, -12 * scale + flap * 2);
        c.stroke();
        // body + neck
        blob(c, 0, -12 * scale, 13 * scale, 12 * scale, primary, dark);
        c.strokeStyle = primary;
        c.lineWidth = 9 * scale;
        c.beginPath();
        c.moveTo(4 * scale, -18 * scale);
        c.quadraticCurveTo(10 * scale, -30 * scale, 6 * scale, -38 * scale);
        c.stroke();
        // head
        c.save();
        c.translate(7 * scale, -40 * scale);
        c.rotate(attack > 0 ? -0.25 : 0.1);
        blob(c, 0, 0, 9 * scale, 7 * scale, primary, dark);
        c.fillStyle = dark;
        c.beginPath();
        c.moveTo(6 * scale, -3 * scale);
        c.lineTo(18 * scale, 1 * scale);
        c.lineTo(6 * scale, 5 * scale);
        c.closePath();
        c.fill();
        glowEyes(c, 2 * scale, -3 * scale, 3 * scale, 1.7 * scale, eye);
        drawHorns(c, pal, scale * 0.9);
        c.restore();
        if (monster.tier === 'boss' && monster.enrage > 0) {
          c.globalAlpha = 0.2 + monster.enrage * 0.25;
          blob(c, 0, -18 * scale, 26 * scale, 30 * scale, Utils.rgba(pal.eye || '#ff7a3a', 1));
          c.globalAlpha = 1;
        }
      }

      else if (body === 'wraith') {
        const float = Math.sin(time * 2 + monster.bob) * 3;
        c.save();
        c.translate(0, float);
        c.globalAlpha = 0.9;
        // tattered cloak
        c.fillStyle = primary;
        c.beginPath();
        c.moveTo(0, -34 * scale);
        c.quadraticCurveTo(-18 * scale, -14 * scale, -14 * scale, 8 * scale);
        for (let i = 0; i < 4; i++) {
          const x = -14 * scale + i * (28 * scale / 4);
          c.quadraticCurveTo(x + 4 * scale, 2 * scale, x + 7 * scale, 8 * scale);
        }
        c.quadraticCurveTo(18 * scale, -14 * scale, 0, -34 * scale);
        c.closePath();
        c.fill();
        // hood
        c.fillStyle = secondary;
        c.beginPath();
        c.arc(0, -26 * scale, 9 * scale, Math.PI * 0.9, Math.PI * 2.1);
        c.fill();
        c.fillStyle = dark;
        c.beginPath();
        c.arc(0, -25 * scale, 6.5 * scale, 0, Math.PI * 2);
        c.fill();
        glowEyes(c, 0, -25 * scale, 3 * scale, 1.8 * scale, eye);
        // arms
        c.strokeStyle = primary;
        c.lineWidth = 4 * scale;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(-10 * scale, -18 * scale);
        c.lineTo(-18 * scale, -6 * scale);
        c.moveTo(10 * scale, -18 * scale);
        c.lineTo(18 * scale, -8 * scale);
        c.stroke();
        c.globalAlpha = 1;
        c.restore();
        if (def.crown) {
          c.fillStyle = accent;
          c.beginPath();
          c.moveTo(-8 * scale, -34 * scale);
          c.lineTo(-4 * scale, -41 * scale);
          c.lineTo(0, -34 * scale);
          c.lineTo(4 * scale, -41 * scale);
          c.lineTo(8 * scale, -34 * scale);
          c.closePath();
          c.fill();
        }
      }

      else if (body === 'scorpion') {
        // claws
        [-1, 1].forEach(function (dir) {
          c.save();
          c.scale(dir, 1);
          c.strokeStyle = primary;
          c.lineWidth = 4.4 * scale;
          c.lineCap = 'round';
          c.beginPath();
          c.moveTo(6 * scale, -6 * scale);
          c.quadraticCurveTo(20 * scale, -12 * scale, 24 * scale, -4 * scale);
          c.stroke();
          blob(c, 25 * scale, -3 * scale, 6 * scale, 5 * scale, secondary, dark);
          c.fillStyle = dark;
          c.beginPath();
          c.moveTo(28 * scale, -6 * scale); c.lineTo(34 * scale, -8 * scale); c.lineTo(29 * scale, -1 * scale);
          c.closePath(); c.fill();
          c.restore();
        });
        // legs
        c.strokeStyle = dark;
        c.lineWidth = 2.6 * scale;
        for (let i = 0; i < 3; i++) {
          [-1, 1].forEach(function (dir) {
            const step = Math.sin(time * 6 + i) * 1.6 * scale;
            c.beginPath();
            c.moveTo(dir * 6 * scale, -6 * scale);
            c.lineTo(dir * 16 * scale, 4 * scale + step);
            c.stroke();
          });
        }
        // body + tail
        blob(c, 0, -10 * scale, 15 * scale, 9 * scale, primary, dark);
        c.strokeStyle = primary;
        c.lineWidth = 5 * scale;
        c.beginPath();
        c.moveTo(-6 * scale, -12 * scale);
        c.quadraticCurveTo(-22 * scale, -18 * scale, -20 * scale, -30 * scale + Math.sin(time * 3) * 2);
        c.stroke();
        blob(c, -20 * scale, -32 * scale, 4.6 * scale, 5 * scale, accent, dark);
        glowEyes(c, 3 * scale, -12 * scale, 3 * scale, 1.6 * scale, eye);
      }

      else {
        // elemental / fallback: swirling core
        const pulse = 1 + Math.sin(time * 4 + monster.bob) * 0.08;
        c.globalAlpha = 0.4;
        blob(c, 0, -14 * scale, 22 * scale * pulse, 24 * scale * pulse, Utils.rgba(pal.accent || primary, 0.5));
        c.globalAlpha = 1;
        blob(c, 0, -14 * scale, 13 * scale, 15 * scale, primary, dark);
        glowEyes(c, 0, -16 * scale, 4 * scale, 2.2 * scale, eye);
      }

      if (def.aura) {
        c.globalAlpha = 0.16 + Math.sin(time * 2.4) * 0.05;
        blob(c, 0, -14 * scale, 26 * scale, 30 * scale, Utils.rgba(def.aura, 1));
        c.globalAlpha = 1;
      }
      c.restore();
    }

    /** Full creature draw: shadow, body, telegraph, bars and status overlays. */
    function drawCreature(c, monster, state) {
      if (!monster.alive) {
        const remaining = Math.max(0, monster.respawnTimer);
        const home = monster.home || monster.pos;
        c.save();
        c.globalAlpha = 0.55;
        c.setLineDash([6, 6]);
        c.strokeStyle = Utils.rgba((monster.palette && monster.palette.primary) || '#999999', 0.8);
        c.lineWidth = 2;
        c.beginPath();
        c.ellipse(home.x, home.y + 4, 22, 9, 0, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
        c.restore();
        void remaining;
        return;
      }

      const p = monster.pos;
      const scale = monster.scale || 1;
      const speedFactor = monster.aggro ? 1 : 0.6;
      const hop = Math.abs(Math.sin(state.time * 3 * speedFactor + monster.bob)) * 2.4;
      const bob = -hop;

      drawShadow(c, p.x, p.y, monster.radius, 0.3);

      // boss ground aura
      if (monster.isBoss) {
        c.save();
        c.globalAlpha = 0.18 + Math.sin(state.time * 2) * 0.05;
        c.fillStyle = (monster.def && monster.def.aura) || (monster.palette && monster.palette.eye) || '#ff8a3a';
        c.beginPath();
        c.ellipse(p.x, p.y, monster.radius * 2.1, monster.radius * 0.7, 0, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }

      c.save();
      c.translate(p.x, p.y + bob - (monster.body === 'wraith' || monster.body === 'bat' ? 8 * scale : 0));
      c.scale(monster.facing && monster.facing.x > 0 ? 1 : -1, 1);
      if (monster.spawnPulse > 0) c.globalAlpha = Utils.clamp(monster.spawnPulse, 0.2, 1);

      drawCreatureShape(c, monster, state.time);

      // ability telegraph ring
      if (monster.telegraphMs > 0) {
        const ratio = Utils.clamp(monster.telegraphMs / Math.max(1, monster.telegraphTotal || 1), 0, 1);
        const radius = (monster.telegraphRadius || 90);
        c.globalAlpha = 0.35 + (1 - ratio) * 0.35;
        c.strokeStyle = '#ff6b4a';
        c.lineWidth = 4;
        c.beginPath();
        c.ellipse(0, -4, radius, radius * 0.42, 0, 0, Math.PI * 2);
        c.stroke();
        c.globalAlpha = 0.18;
        c.fillStyle = '#ff6b4a';
        c.fill();
        c.globalAlpha = 1;
      }

      // hit flash
      if (monster.hitFlash > 0) {
        c.globalAlpha = Utils.clamp(monster.hitFlash, 0, 1) * 0.7;
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.ellipse(0, -14 * scale, 20 * scale, 22 * scale, 0, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
      }

      // status effects
      if (Statuses.isFrozen(monster)) {
        c.globalAlpha = 0.45;
        c.fillStyle = '#bfefff';
        c.beginPath();
        c.ellipse(0, -12 * scale, 22 * scale, 24 * scale, 0, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
      } else if (Statuses.isSlowed(monster)) {
        c.globalAlpha = 0.25;
        c.fillStyle = '#8fe3ff';
        c.beginPath();
        c.ellipse(0, -12 * scale, 21 * scale, 23 * scale, 0, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
      }
      if (Statuses.isBurning(monster)) {
        for (let i = 0; i < 3; i++) {
          const phase = state.time * 6 + i * 2.1;
          c.fillStyle = (monster.status && monster.status.poison) ? 'rgba(155,227,106,0.75)' : 'rgba(255,155,74,0.8)';
          c.beginPath();
          c.ellipse(Math.sin(phase) * 12 * scale, -26 * scale - (Math.sin(phase * 1.4) * 0.5 + 0.5) * 12, 3.2, 5.4, Math.sin(phase) * 0.6, 0, Math.PI * 2);
          c.fill();
        }
      }
      if (monster.status && monster.status.stunMs > 0) {
        c.fillStyle = '#ffe9a8';
        for (let i = 0; i < 3; i++) {
          const a = state.time * 5 + (i / 3) * Math.PI * 2;
          c.beginPath();
          c.arc(Math.cos(a) * 16, -34 * scale + Math.sin(a) * 4, 2.2, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.restore();

      // name plate + hp bar (flipped back to screen space)
      const plateY = p.y - (28 + 24 * scale);
      drawNameTag(c, p.x, plateY, monster.name, 'Lv. ' + monster.level, monster.isBoss ? '#ffd76a' : '#ffd9c6');
      drawMiniBar(c, p.x, plateY + 10, monster.isBoss ? 76 : 54, monster.isBoss ? 7 : 6,
        monster.hp / monster.maxHp, '#ff8a5c', '#3a1206');
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

    /** Re-skin the battle background (chapter themes). */
    function setPalette(palette, zoneName) {
      if (!palette) return null;
      Object.keys(palette).forEach(function (key) {
        if (typeof palette[key] === 'string') ZONE.palette[key] = palette[key];
      });
      // The 3D world rebuilds itself per region; the cached 2D backdrop is
      // only needed by the fallback renderer.
      if (ctx.use3d && root.MytharaRender3D) {
        root.MytharaRender3D.setPalette(palette, zoneName || ZONE.name);
        return ZONE.palette;
      }
      ctx.background = buildBackground();   // rebuild immediately (once per stage)
      return ZONE.palette;
    }

    return {
      init: init,
      resize: resize,
      render: render,
      setPalette: setPalette,
      drawHero: drawHero,
      /** Screen-space monster pick (3D presentation layer only). */
      pickAt: function (x, y, gameState) {
        if (!ctx.use3d || !root.MytharaRender3D || !root.MytharaRender3D.pickAt) return null;
        return root.MytharaRender3D.pickAt(x, y, gameState);
      },
      /** Terrain / building line of fire, or false in the flat 2D fallback. */
      blocked: function (ax, ay, bx, by) {
        if (!ctx.use3d || !root.MytharaRender3D || !root.MytharaRender3D.blocked) return false;
        return root.MytharaRender3D.blocked(ax, ay, bx, by);
      },
      /** Water depth at a world point (0 in the flat 2D fallback). */
      waterDepth: function (x, y) {
        if (!ctx.use3d || !root.MytharaRender3D || !root.MytharaRender3D.waterDepth) return 0;
        return root.MytharaRender3D.waterDepth(x, y);
      },
      /** Slide a circle around cliffs and solid props (no-op in 2D mode). */
      resolveMove: function (fromX, fromY, toX, toY, radius) {
        if (!ctx.use3d || !root.MytharaRender3D || !root.MytharaRender3D.resolveMove) {
          return { x: toX, z: toY, blocked: false };
        }
        return root.MytharaRender3D.resolveMove(fromX, fromY, toX, toY, radius);
      },
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
      el.emblem = doc.getElementById('player-emblem');
      el.portrait = doc.getElementById('player-portrait');
      el.gear = doc.getElementById('player-gear');
      el.rageRow = doc.getElementById('rage-row');
      el.rageFill = doc.getElementById('rage-fill');
      el.rageValue = doc.getElementById('rage-value');
      el.rageBar = doc.getElementById('rage-bar');
      el.skillBar = doc.getElementById('skill-bar');
      el.targetStatus = doc.getElementById('target-status');
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

      const emblemText = player.classDef ? player.classDef.emblem : '\u2694';
      if (cache.emblem !== emblemText && el.emblem) { el.emblem.textContent = emblemText; cache.emblem = emblemText; }
      if (el.portrait && player.look && cache.portrait !== player.classId) {
        el.portrait.style.borderColor = player.look.accent || '#8a6d2f';
        el.portrait.style.color = player.look.accent || '#f2c14e';
        cache.portrait = player.classId;
      }

      const gearText = (player.weapon ? player.weapon.name : '—') + ' \u00B7 ' + (player.armor ? player.armor.name : '—');
      if (cache.gear !== gearText && el.gear) { el.gear.textContent = gearText; cache.gear = gearText; }

      renderRage(player);
      renderSkillBar(player);

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
        renderStatusChips(monster);
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

    /** Build one button per class skill. Rebuilt whenever a character is created. */
    function buildSkillBar(player) {
      if (!el.skillBar) return;
      el.skillBar.innerHTML = '';
      cache.skills = {};
      (player.skills || []).forEach(function (skill, index) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'skill-btn';
        button.setAttribute('data-skill-slot', String(index));
        button.setAttribute('data-skill-id', skill.id);
        button.setAttribute('aria-label', skill.name);
        button.title = skill.name + ' — ' + skill.description;

        const glyph = document.createElement('span');
        glyph.className = 'skill-btn__glyph';
        glyph.textContent = skill.glyph || '\u25C6';

        const text = document.createElement('span');
        text.className = 'skill-btn__text';
        const name = document.createElement('span');
        name.className = 'skill-btn__name';
        name.textContent = skill.name;
        const cost = document.createElement('span');
        cost.className = 'skill-btn__cost';
        const rageCost = skill.params && skill.params.rageCost;
        cost.textContent = rageCost ? (rageCost + ' RAGE') : (skill.mp > 0 ? (skill.mp + ' MP') : 'FREE');
        text.appendChild(name);
        text.appendChild(cost);

        const cd = document.createElement('span');
        cd.className = 'skill-btn__cd';
        const cdTime = document.createElement('span');
        cdTime.className = 'skill-btn__cdtime';

        button.appendChild(glyph);
        button.appendChild(text);
        button.appendChild(cd);
        button.appendChild(cdTime);
        el.skillBar.appendChild(button);

        cache.skills[skill.id] = { button: button, cd: cd, time: cdTime, label: null, disabled: null };
      });
    }

    function renderSkillBar(player) {
      (player.skills || []).forEach(function (skill) {
        const entry = cache.skills && cache.skills[skill.id];
        if (!entry) return;
        const remaining = player.cooldowns[skill.id] || 0;
        const fraction = skill.cooldownMs > 0 ? Utils.clamp(remaining / skill.cooldownMs, 0, 1) : 0;
        entry.cd.style.transform = 'scaleY(' + fraction.toFixed(3) + ')';

        const seconds = remaining > 0 ? (Math.ceil(remaining / 100) / 10).toFixed(1) + 's' : '';
        if (entry.time.textContent !== seconds) entry.time.textContent = seconds;

        const check = Skills.canCast(player, skill);
        const disabled = !check.ok;
        if (entry.disabled !== disabled) {
          entry.button.disabled = disabled;
          entry.disabled = disabled;
        }
        const rageless = check.reason === 'rage';
        if (entry.label !== rageless) {
          entry.button.classList.toggle('is-rageless', rageless);
          entry.label = rageless;
        }
      });
    }

    function renderRage(player) {
      const hasRage = Skills.hasRage(player);
      if (el.rageRow && cache.hasRage !== hasRage) {
        el.rageRow.hidden = !hasRage;
        cache.hasRage = hasRage;
      }
      if (hasRage) {
        setBar(el.rageFill, el.rageValue, el.rageBar, player.rage, Skills.RAGE_MAX, 'Rage');
      }
    }

    function renderStatusChips(monster) {
      if (!el.targetStatus || !monster) return;
      const labels = monster.alive ? Statuses.labels(monster) : [];
      const signature = labels.map(function (l) { return l.id; }).join(',');
      if (cache.statusSignature === signature) return;
      cache.statusSignature = signature;
      el.targetStatus.innerHTML = '';
      labels.forEach(function (label) {
        const chip = document.createElement('li');
        chip.className = 'chip chip--' + label.id;
        chip.textContent = label.label;
        el.targetStatus.appendChild(chip);
      });
    }

    function setZone(name) {
      if (el.zone && cache.zone !== name) { el.zone.textContent = name; cache.zone = name; }
    }

    return { el: el, init: init, render: render, setZone: setZone, buildSkillBar: buildSkillBar };
  })();

  /* ============================================================
   * 8. LOG — combat log panel
   * ========================================================== */
  const Log = (function () {
    function push(message, className) {
      if (root.MytharaCore && root.MytharaCore.Bus) {
        root.MytharaCore.Bus.emit('log', { message: message, className: className || '' });
      }
      const el = HUD.el.log;
      if (!el || !el.insertBefore) return;
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
   * 8b. CHARACTER SELECT — the class picker screen
   * ========================================================== */
  const CharacterSelect = (function () {
    const ui = {};
    let selectedId = null;
    let rafId = 0;
    let loopRunning = false;

    const STAT_ROWS = [
      { key: 'maxHp', label: 'HP', className: 'stat--hp' },
      { key: 'attack', label: 'ATK', className: 'stat--atk' },
      { key: 'defense', label: 'DEF', className: 'stat--def' },
      { key: 'speed', label: 'SPD', className: 'stat--spd' },
      { key: 'magic', label: 'MAG', className: 'stat--mag' }
    ];

    const BONUS_LABELS = {
      attack: 'Attack', defense: 'Defense', magic: 'Magic', maxHp: 'HP', maxMp: 'MP',
      speed: 'Speed', critChance: 'Crit', evasion: 'Evasion', attackSpeed: 'Atk Speed'
    };

    /** Per-stat maxima so preview bars are comparable between classes. */
    function statMaxima() {
      const max = {};
      STAT_ROWS.forEach(function (row) { max[row.key] = 1; });
      DATA.classList().forEach(function (cls) {
        const stats = DATA.effectiveBaseStats(cls);
        STAT_ROWS.forEach(function (row) { max[row.key] = Math.max(max[row.key], stats[row.key]); });
      });
      return max;
    }

    /* ---------- rendering ---------- */
    function buildCards() {
      if (!ui.grid) return;
      ui.grid.innerHTML = '';
      ui.cards = {};

      DATA.classList().forEach(function (cls) {
        const card = ui.doc.createElement('button');
        card.type = 'button';
        card.className = 'class-card';
        card.setAttribute('data-class', cls.id);
        card.setAttribute('role', 'option');
        card.setAttribute('aria-selected', 'false');

        const art = ui.doc.createElement('span');
        art.className = 'class-card__art';
        const canvas = ui.doc.createElement('canvas');
        canvas.width = 124;
        canvas.height = 148;
        art.appendChild(canvas);

        const body = ui.doc.createElement('span');
        body.className = 'class-card__body';

        const top = ui.doc.createElement('span');
        top.className = 'class-card__top';
        const name = ui.doc.createElement('span');
        name.className = 'class-card__name';
        name.textContent = cls.name;
        const role = ui.doc.createElement('span');
        role.className = 'class-card__role';
        role.textContent = cls.role;
        top.appendChild(name);
        top.appendChild(role);

        const desc = ui.doc.createElement('span');
        desc.className = 'class-card__desc';
        desc.textContent = cls.description;

        const stats = ui.doc.createElement('span');
        stats.className = 'class-card__stats';
        const effective = DATA.effectiveBaseStats(cls);
        STAT_ROWS.forEach(function (row) {
          const pill = ui.doc.createElement('span');
          pill.className = 'stat-pill';
          const label = ui.doc.createElement('span');
          label.className = 'stat-pill__label';
          label.textContent = row.label;
          const value = ui.doc.createElement('span');
          value.className = 'stat-pill__value';
          value.textContent = String(effective[row.key]);
          pill.appendChild(label);
          pill.appendChild(value);
          stats.appendChild(pill);
        });

        const foot = ui.doc.createElement('span');
        foot.className = 'class-card__foot';
        const diffLabel = ui.doc.createElement('span');
        diffLabel.className = 'diff-label';
        diffLabel.textContent = 'Difficulty';
        const pips = ui.doc.createElement('span');
        pips.className = 'pips';
        for (let i = 1; i <= 5; i++) {
          const pip = ui.doc.createElement('span');
          pip.className = 'pip' + (i <= cls.difficulty ? ' is-on' : '') +
            (cls.difficulty >= 4 && i <= cls.difficulty ? ' is-hard' : '');
          pips.appendChild(pip);
        }
        foot.appendChild(diffLabel);
        foot.appendChild(pips);

        body.appendChild(top);
        body.appendChild(desc);
        body.appendChild(stats);
        body.appendChild(foot);

        card.appendChild(art);
        card.appendChild(body);
        ui.grid.appendChild(card);

        ui.cards[cls.id] = { card: card, canvas: canvas, ctx: canvas.getContext('2d') };
      });
    }

    /** Static idle portrait for each card. */
    function drawCardPortraits() {
      DATA.classList().forEach(function (cls) {
        const entry = ui.cards && ui.cards[cls.id];
        if (!entry || !entry.ctx) return;
        const c = entry.ctx;
        c.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
        Renderer.drawHero(c, {
          look: cls.look,
          x: entry.canvas.width / 2,
          y: entry.canvas.height - 26,
          scale: 1.55,
          facing: 1,
          moving: false,
          walkPhase: 0,
          attackAnim: 0,
          attackKind: cls.attackType === 'ranged' ? 'cast' : 'melee',
          time: 0.6
        });
      });
    }

    function fillPips(container, difficulty) {
      container.innerHTML = '';
      for (let i = 1; i <= 5; i++) {
        const pip = ui.doc.createElement('span');
        pip.className = 'pip' + (i <= difficulty ? ' is-on' : '') +
          (difficulty >= 4 && i <= difficulty ? ' is-hard' : '');
        container.appendChild(pip);
      }
    }

    function bonusText(item) {
      if (!item || !item.bonus) return '';
      const parts = [];
      Object.keys(item.bonus).forEach(function (key) {
        const value = item.bonus[key];
        const label = BONUS_LABELS[key] || key;
        if (key === 'critChance' || key === 'evasion') {
          parts.push((value > 0 ? '+' : '') + Math.round(value * 100) + '% ' + label);
        } else {
          parts.push((value > 0 ? '+' : '') + value + ' ' + label);
        }
      });
      return parts.join('  \u00B7  ');
    }

    function renderPreview(cls) {
      const stats = DATA.effectiveBaseStats(cls);
      const max = statMaxima();

      ui.previewName.textContent = cls.name;
      ui.previewRole.textContent = cls.role;
      ui.previewDesc.textContent = cls.description + ' ' + cls.playstyle;

      ui.previewStats.innerHTML = '';
      STAT_ROWS.forEach(function (row) {
        const item = ui.doc.createElement('li');
        item.className = row.className;
        const label = ui.doc.createElement('span');
        label.className = 'stat__label';
        label.textContent = row.label;
        const value = ui.doc.createElement('span');
        value.className = 'stat__val';
        value.textContent = String(stats[row.key]);
        const bar = ui.doc.createElement('span');
        bar.className = 'stat__bar';
        const fill = ui.doc.createElement('i');
        fill.style.width = Math.round(Utils.clamp(stats[row.key] / max[row.key], 0.05, 1) * 100) + '%';
        bar.appendChild(fill);
        item.appendChild(label);
        item.appendChild(value);
        item.appendChild(bar);
        ui.previewStats.appendChild(item);
      });

      const weapon = DATA.getItem(cls.weaponId);
      const armor = DATA.getItem(cls.armorId);
      ui.previewWeapon.textContent = weapon ? weapon.name : '—';
      ui.previewWeaponBonus.textContent = weapon ? bonusText(weapon) : '';
      ui.previewArmor.textContent = armor ? armor.name : '—';
      ui.previewArmorBonus.textContent = armor ? bonusText(armor) : '';

      ui.previewSkills.innerHTML = '';
      (cls.skillIds || []).forEach(function (id) {
        const skill = DATA.getSkill(id);
        if (!skill) return;
        const item = ui.doc.createElement('li');

        const glyph = ui.doc.createElement('span');
        glyph.className = 'skill__glyph';
        glyph.textContent = skill.glyph || '\u25C6';

        const body = ui.doc.createElement('span');
        const name = ui.doc.createElement('span');
        name.className = 'skill__name';
        name.textContent = skill.name;
        const desc = ui.doc.createElement('span');
        desc.className = 'skill__desc';
        desc.textContent = skill.description;
        const meta = ui.doc.createElement('span');
        meta.className = 'skill__meta';
        const rageCost = skill.params && skill.params.rageCost;
        meta.textContent = rageCost ? (rageCost + ' RAGE') : (skill.mp > 0 ? (skill.mp + ' MP') : 'No cost');
        const cd = ui.doc.createElement('span');
        cd.className = 'skill__cd';
        cd.textContent = (skill.cooldownMs / 1000).toFixed(1) + 's cooldown';
        meta.appendChild(cd);

        body.appendChild(name);
        body.appendChild(desc);
        body.appendChild(meta);

        item.appendChild(glyph);
        item.appendChild(body);
        ui.previewSkills.appendChild(item);
      });

      fillPips(ui.previewDifficulty, cls.difficulty);
      ui.previewDifficulty.setAttribute('aria-label', 'Difficulty ' + cls.difficulty + ' of 5');
      if (ui.previewGlow) {
        ui.previewGlow.style.background = 'radial-gradient(circle, ' +
          Utils.rgba(cls.look.accent || '#f2c14e', 0.55) + ', rgba(0,0,0,0) 70%)';
      }
    }

    /* ---------- preview animation ---------- */
    function drawPreviewFrame(timestamp) {
      const cls = DATA.getClass(selectedId);
      if (!cls || !ui.previewCtx) return;
      const c = ui.previewCtx;
      const w = ui.previewCanvas.width;
      const h = ui.previewCanvas.height;
      const time = (timestamp || 0) / 1000;

      c.clearRect(0, 0, w, h);

      // emblem watermark
      c.save();
      c.globalAlpha = 0.09;
      c.fillStyle = '#ffffff';
      c.font = '700 190px "Palatino Linotype", Georgia, serif';
      c.textAlign = 'center';
      c.fillText(cls.emblem, w / 2, h / 2 + 62);
      c.restore();

      // ground glow
      const glow = c.createRadialGradient(w / 2, h - 54, 6, w / 2, h - 54, 130);
      glow.addColorStop(0, Utils.rgba(cls.look.accent || '#f2c14e', 0.34));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = glow;
      c.fillRect(0, 0, w, h);

      c.strokeStyle = Utils.rgba(cls.look.accent || '#f2c14e', 0.4);
      c.lineWidth = 2;
      c.beginPath();
      c.ellipse(w / 2, h - 50, 92, 24, 0, 0, Math.PI * 2);
      c.stroke();

      // 3D hero turntable (idle + a swing every few seconds)
      if (root.MytharaRender3D && root.MytharaRender3D.isReady()
        && root.MytharaRender3D.drawPreviewHero(c, ui.previewCanvas, cls, time)) {
        return;
      }

      // idle, with a swing every few seconds
      const cycle = time % 3.2;
      const attackAnim = cycle < 0.55 ? 1 - cycle / 0.55 : 0;

      Renderer.drawHero(c, {
        look: cls.look,
        x: w / 2,
        y: h - 48,
        scale: 3.4,
        facing: 1,
        walkPhase: 0,
        moving: false,
        attackAnim: attackAnim,
        attackKind: cls.attackType === 'ranged' ? 'cast' : 'melee',
        time: time
      });
    }

    function startLoop() {
      if (loopRunning || !root.requestAnimationFrame) return;
      loopRunning = true;
      const step = function (timestamp) {
        if (!loopRunning) return;
        drawPreviewFrame(timestamp);
        rafId = root.requestAnimationFrame(step);
      };
      rafId = root.requestAnimationFrame(step);
    }

    function stopLoop() {
      loopRunning = false;
      if (rafId && root.cancelAnimationFrame) root.cancelAnimationFrame(rafId);
      rafId = 0;
    }

    /* ---------- selection ---------- */
    function select(classId, options) {
      const cls = DATA.getClass(classId);
      if (!cls) return;
      const opts = options || {};
      const changed = selectedId !== cls.id;
      selectedId = cls.id;

      Object.keys(ui.cards || {}).forEach(function (id) {
        const entry = ui.cards[id];
        const on = id === cls.id;
        entry.card.classList.toggle('is-selected', on);
        entry.card.setAttribute('aria-selected', on ? 'true' : 'false');
      });

      renderPreview(cls);
      drawPreviewFrame(root.performance ? root.performance.now() : 0);
      if (opts.openSheet) openSheet();
      if (changed) Game.emit('classSelected', { classId: cls.id, classDef: cls });
      return cls;
    }

    function selectedClass() { return DATA.getClass(selectedId); }

    /* ---------- mobile bottom sheet ---------- */
    function openSheet() {
      if (ui.preview && isCompact()) ui.preview.classList.add('is-open');
    }

    function closeSheet() {
      if (ui.preview) ui.preview.classList.remove('is-open');
    }

    function isCompact() {
      return !!(root.matchMedia && root.matchMedia('(max-width: 900px)').matches);
    }

    /* ---------- screens ---------- */
    function open() {
      Game.setScreen('select');
      closeSheet();
      if (ui.nameInput && Game.state.player) ui.nameInput.value = Game.state.player.name;
      select(selectedId || (Game.state.player && Game.state.player.classId) || DATA.DEFAULT_CLASS);
      startLoop();
    }

    function confirm() {
      const name = sanitizeName(ui.nameInput ? ui.nameInput.value : '');
      const player = Game.createCharacter({ classId: selectedId, name: name });
      if (ui.nameInput) ui.nameInput.value = player.name;
      closeSheet();
      stopLoop();
      Game.setScreen('game');
      return player;
    }

    function back() {
      closeSheet();
      stopLoop();
      Game.setScreen('game');        // keep playing with the current character
      return Game.state.player;
    }

    function sanitizeName(raw) {
      const value = (raw === undefined || raw === null ? '' : String(raw))
        .replace(/[<>&"'`\\]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 14);
      return value || PLAYER_DEF.name;
    }

    /* ---------- wiring ---------- */
    function bindEvents() {
      if (ui.grid) {
        ui.grid.addEventListener('click', function (event) {
          const card = event.target && event.target.closest ? event.target.closest('[data-class]') : null;
          if (!card) return;
          select(card.getAttribute('data-class'), { openSheet: true });
        });
      }

      if (ui.createButton) ui.createButton.addEventListener('click', confirm);
      if (ui.backButton) ui.backButton.addEventListener('click', back);
      if (ui.collapseButton) ui.collapseButton.addEventListener('click', closeSheet);
      if (ui.backdrop) ui.backdrop.addEventListener('click', closeSheet);

      if (ui.nameInput) {
        ui.nameInput.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') { confirm(); event.preventDefault(); }
        });
        ui.nameInput.addEventListener('focus', function () { ui.nameInput.select(); });
      }

      // Arrow keys walk through the class list while the screen is open.
      ui.doc.addEventListener('keydown', function (event) {
        if (Game.state.screen !== 'select') return;
        if (ui.nameInput && event.target === ui.nameInput) return;
        const steps = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        const step = steps[event.code];
        if (step === undefined) return;
        const list = DATA.classList();
        const index = list.findIndex(function (cls) { return cls.id === selectedId; });
        const next = list[(index + step + list.length) % list.length];
        select(next.id);
        if (ui.cards[next.id]) ui.cards[next.id].card.focus();
        if (event.cancelable) event.preventDefault();
      });
    }

    function init(doc, saved) {
      ui.doc = doc;
      ui.grid = doc.getElementById('class-grid');
      ui.preview = doc.getElementById('preview');
      ui.previewCanvas = doc.getElementById('preview-canvas');
      ui.previewCtx = ui.previewCanvas ? ui.previewCanvas.getContext('2d') : null;
      ui.previewName = doc.getElementById('preview-name');
      ui.previewRole = doc.getElementById('preview-role');
      ui.previewDesc = doc.getElementById('preview-desc');
      ui.previewStats = doc.getElementById('preview-stats');
      ui.previewWeapon = doc.getElementById('preview-weapon');
      ui.previewWeaponBonus = doc.getElementById('preview-weapon-bonus');
      ui.previewArmor = doc.getElementById('preview-armor');
      ui.previewArmorBonus = doc.getElementById('preview-armor-bonus');
      ui.previewSkills = doc.getElementById('preview-skills');
      ui.previewDifficulty = doc.getElementById('preview-difficulty');
      ui.previewGlow = doc.getElementById('preview-glow');
      ui.createButton = doc.getElementById('create-character');
      ui.backButton = doc.getElementById('back-button');
      ui.collapseButton = doc.getElementById('preview-collapse');
      ui.backdrop = doc.getElementById('preview-backdrop');
      ui.nameInput = doc.getElementById('char-name');

      buildCards();
      drawCardPortraits();
      bindEvents();

      const initial = (saved && DATA.getClass(saved.classId)) ? saved.classId : DATA.DEFAULT_CLASS;
      if (ui.nameInput) ui.nameInput.value = (saved && saved.name) || PLAYER_DEF.name;
      select(initial);
      return ui;
    }

    /** Stop the preview animation loop (used when leaving the screen). */
    function close() {
      closeSheet();
      stopLoop();
    }

    return {
      init: init,
      open: open,
      close: close,
      closeSheet: closeSheet,
      select: select,
      confirm: confirm,
      back: back,
      selectedClass: selectedClass,
      sanitizeName: sanitizeName,
      ui: ui,
      isOpen: function () { return loopRunning; }
    };
  })();

  /* ============================================================
   * 9. GAME — state, loop and rules
   * ========================================================== */
  const Game = (function () {
    const state = {
      running: false,
      paused: false,
      screen: 'select',      // 'select' | 'game'
      time: 0,
      player: null,
      monster: null,         // primary target shown by the HUD
      target: null,          // explicitly selected monster (tap / Tab)
      monsters: [],          // every monster in the zone
      loot: [],              // dropped items lying in the world
      character: null,       // { classId, name }
      mode: 'free',          // 'free' | 'stage' | 'boss' | 'arena'
      battle: null,          // battle context supplied by js/battle.js
      rewardSink: null,      // override for coins/xp payouts (battle modes)
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

    /**
     * Emit an engine event to both the internal handler map (legacy
     * Game.on listeners) and the shared MytharaCore.Bus used by the
     * progression modules (battle.js, systems.js, ui.js).
     */
    function emit(event, payload) {
      (state.handlers[event] || []).forEach(function (handler) {
        try { handler(payload); } catch (err) { if (root.console) root.console.error('[game:' + event + ']', err); }
      });
      const core = root.MytharaCore;
      if (core && core.Bus) core.Bus.emit(event, payload);
    }

    function registerSystem(system) {
      if (system && typeof system.update === 'function') state.systems.push(system);
    }

    /* ---------- setup ---------- */
    /** Build the monster population for the active zone. */
    function createMonsters() {
      state.monsters = (ZONE.monsters || []).map(function (id) {
        return createMonster(DATA.MONSTERS[id] || MONSTER_DEF, ZONE);
      });
      state.monster = state.monsters[0] || null;
      return state.monsters;
    }

    /**
     * Create (or replace) the player character from a class definition.
     * Starting stats, gear and skills all come from data.js.
     */
    function createCharacter(options) {
      const opts = options || {};
      const classDef = DATA.getClass(opts.classId) || DATA.getClass(DATA.DEFAULT_CLASS);
      const name = (opts.name && String(opts.name).trim()) || PLAYER_DEF.name;

      state.character = { classId: classDef.id, name: name };
      void 0;
      state.player = createPlayer(classDef.id, name);
      if (opts.level && opts.level > 1) state.player.level = Math.min(100, Math.round(opts.level));
      if (opts.equipmentBonus) state.player.equipmentBonus = opts.equipmentBonus;
      if (opts.maxHpBonus || opts.maxMpBonus) state.player.flatBonus = { maxHp: opts.maxHpBonus || 0, maxMp: opts.maxMpBonus || 0 };
      Projectiles.clear();
      state.loot = [];
      createMonsters();
      Effects.reset();

      if (HUD.el.skillBar) HUD.buildSkillBar(state.player);
      HUD.render(state);

      Log.push(state.player.name + ' the ' + classDef.name + ' enters ' + ZONE.name + '.', 'log--level');
      Log.push('Equipped ' + (state.player.weapon ? state.player.weapon.name : 'nothing') +
        ' and ' + (state.player.armor ? state.player.armor.name : 'nothing') + '.', null);
      if (state.monster) Log.push('A wild ' + state.monster.name + ' blocks the path.', null);

      saveCharacter();
      emit('characterCreated', { player: state.player, classDef: classDef, name: state.player.name });
      return state.player;
    }

    /* ---------- persistence ---------- */
    function saveCharacter() {
      try {
        if (!root.localStorage || !state.character) return false;
        root.localStorage.setItem(CONFIG.storage.saveKey, JSON.stringify({
          classId: state.character.classId,
          name: state.character.name,
          savedAt: Date.now()
        }));
        return true;
      } catch (err) {
        return false;   // private mode / storage disabled — the game still works
      }
    }

    function loadSavedCharacter() {
      try {
        if (!root.localStorage) return null;
        const raw = root.localStorage.getItem(CONFIG.storage.saveKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !DATA.getClass(parsed.classId)) return null;
        return { classId: parsed.classId, name: parsed.name || PLAYER_DEF.name };
      } catch (err) {
        return null;
      }
    }

    /* ---------- battle modes ---------- */
    /**
     * 'free' — the original Verdant Hollow playground (slime respawns forever).
     * 'stage' / 'boss' — adventure waves driven by js/battle.js.
     * 'arena' — a duel against an AI opponent.
     */
    function setMode(mode, context) {
      state.mode = mode || 'free';
      state.battle = context || null;
      emit('modeChange', { mode: state.mode, context: state.battle });
      return state.mode;
    }

    /** Add enemies created by createEnemy() to the live battle. */
    function spawnEnemies(enemies) {
      (enemies || []).forEach(function (enemy) {
        if (!enemy || enemy.invalid) return;
        state.monsters.push(enemy);
      });
      return state.monsters.length;
    }

    function clearEnemies() {
      state.monsters = [];
      state.monster = null;
      Projectiles.clear();
    }

    /** Convenience used by the UI: current primary target. */
    function primaryTarget() { return state.monster; }

    function aliveEnemies() {
      return (state.monsters || []).filter(function (monster) { return monster.alive; });
    }

    /** Switch between the character-select screen and the game. */
    /**
     * Apply a chapter's colour theme to the playfield. `theme` accepts the
     * stage palette shape ({ sky:[top,bottom], ground:[top,bottom], accent })
     * or null to restore the default zone look.
     */
    function setZoneTheme(theme, zoneName, doc) {
      const base = Object.assign({}, DATA.ZONES[DATA.activeZone].palette);
      if (theme) {
        if (theme.sky) { base.skyTop = theme.sky[0]; base.skyBottom = theme.sky[1]; }
        if (theme.ground) { base.groundTop = theme.ground[0]; base.groundBottom = theme.ground[1]; }
        if (theme.accent) base.sun = theme.accent;
        base.mountainFar = Utils.shade(base.skyTop, -0.12);
        base.mountainNear = Utils.shade(base.skyTop, -0.34);
        base.hillFar = Utils.shade(base.groundTop, 0.14);
        base.hillNear = Utils.shade(base.groundTop, -0.2);
        base.tree = Utils.shade(base.groundTop, -0.32);
        base.treeDark = Utils.shade(base.groundTop, -0.52);
        base.trunk = Utils.shade(base.groundBottom, -0.3);
        base.rock = Utils.shade(base.mountainNear, 0.18);
        base.path = Utils.shade(base.groundBottom, 0.3);
      }
      Renderer.setPalette(base, zoneName);
      if (zoneName) HUD.setZone(zoneName);
      void doc;
      return base;
    }

    function setScreen(name) {
      state.screen = name;
      const doc = root.document;
      if (doc) {
        const gameScreen = doc.getElementById('screen-game');
        const selectScreen = doc.getElementById('screen-select');
        if (gameScreen) gameScreen.classList.toggle('is-hidden', name !== 'game');
        if (selectScreen) selectScreen.classList.toggle('is-hidden', name === 'game');
      }
      if (name === 'game') Renderer.resize();
      emit('screenChange', { screen: name });
    }

    function init(options) {
      const opts = options || {};
      const doc = opts.document || root.document;
      if (!doc) throw new Error('Mythara Online: no document available');

      HUD.init(doc);
      Renderer.init(doc.getElementById('game-canvas'));

      Input.bindKeyboard(root);
      Input.bindControls(doc, doc.getElementById('game-canvas'));
      on('canvasPick', function (payload) { pickTargetAt(payload.x, payload.y); });
      on('targetCycle', function (payload) { cycleTarget(payload && payload.reverse); });
      on('targetClear', function () { clearTarget(); });
      Input.onSpecialKey(function (event) {
        if (state.screen !== 'game') return;
        if (event.code === 'Tab') {
          cycleTarget(!!event.shiftKey);
          if (event.cancelable) event.preventDefault();
        } else if (event.code === 'Escape') {
          clearTarget();
        }
      });
      bindSkillControls(doc);

      Effects.reset();
      Log.clear();
      HUD.setZone(ZONE.name);

      // The game is always backed by a valid character; the select screen sits on top.
      const saved = loadSavedCharacter();
      createCharacter(saved || { classId: DATA.DEFAULT_CLASS, name: PLAYER_DEF.name });

      bindTouchToggle(doc);
      bindVisibilityPause(doc);

      CharacterSelect.init(doc, saved);
      setScreen(opts.screen || 'select');

      emit('ready', state);
      if (opts.autoStart !== false) start();
      return state;
    }

    /** Skill bar clicks + 1/2/3 hotkeys. */
    function bindSkillControls(doc) {
      const bar = doc.getElementById('skill-bar');
      if (bar && bar.addEventListener) {
        bar.addEventListener('click', function (event) {
          const button = event.target && event.target.closest ? event.target.closest('[data-skill-slot]') : null;
          if (!button) return;
          castSkill(parseInt(button.getAttribute('data-skill-slot'), 10));
        });
      }

      const hotkeys = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 };
      doc.addEventListener('keydown', function (event) {
        if (hotkeys[event.code] === undefined) return;
        if (event.target && /^(INPUT|TEXTAREA)$/.test(event.target.tagName || '')) return;
        castSkill(hotkeys[event.code]);
        if (event.cancelable) event.preventDefault();
      });

      const changeButton = doc.getElementById('change-class');
      if (changeButton) {
        changeButton.addEventListener('click', function () { CharacterSelect.open(); });
      }
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

      state.lastDeltaSeconds = deltaMs / 1000;
      tick(deltaMs / 1000);
      state.rafId = root.requestAnimationFrame ? root.requestAnimationFrame(loop) : 0;
    }

    /** Advance the simulation + draw one frame. `dt` is in seconds. */
    function tick(dt) {
      if (!state.player) return;
      const clamped = Utils.clamp(dt, 0, CONFIG.loop.maxDeltaSeconds);
      state.time += clamped;
      if (state.screen !== 'game') return;      // paused behind the character-select screen
      update(clamped);
      Renderer.render(state);
      HUD.render(state);
    }

    let clearEmitted = false;

    function update(dt) {
      const player = state.player;

      updatePlayer(player, dt);
      updateMonsters(dt);
      checkBattleProgress();
      updateProjectiles(dt);
      updateLoot(dt);
      Skills.tick(player, dt);
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
        Anim.set(player, 'death');
        Anim.update(player, dt);
        if (state.mode === 'free') {
          player.respawnTimer -= dt;
          if (player.respawnTimer <= 0) revivePlayer(player);
        }
        return;
      }

      // status effects on the player: burn/poison damage, slow, freeze/stun
      const dotDamage = Statuses.update(player, dt);
      if (dotDamage > 0) {
        player.hp = Math.max(0, player.hp - dotDamage);
        Effects.addFloater(player.pos.x + Utils.randRange(-8, 8), player.pos.y - 58,
          '-' + Math.max(1, Math.round(dotDamage)), {
            color: player.status && player.status.poison ? '#9be36a' : '#ff9b4a',
            size: 14, life: 620, vy: -22
          });
        if (player.hp <= 0) { knockDownPlayer(player); return; }
      }
      if (Statuses.isIncapacitated(player)) {
        player.moving = false;
        Anim.update(player, dt, 'idle');
        clampToWorld(player);
        return;
      }

      const axis = Input.axis();
      player.moving = axis.active;
      player.running = state.mode === 'free' && axis.active;

      if (axis.active) {
        const step = player.speed * Statuses.speedMultiplier(player) * dt;
        const solved = Renderer.resolveMove(player.pos.x, player.pos.y,
          player.pos.x + axis.x * step, player.pos.y + axis.y * step, player.radius);
        player.pos.x = solved.x;
        player.pos.y = solved.z;
        player.facing.x = axis.x;
        player.facing.y = axis.y;
        player.walkPhase += dt * 9;
      }

      // animation state follows what the player is doing
      if (!Anim.isBusy(player)) {
        Anim.set(player, player.moving ? (player.running ? 'run' : 'walk') : 'idle');
      }
      Anim.update(player, dt, player.moving ? 'walk' : 'idle');

      clampToWorld(player);
      separateFromMonster(player, nearestMonster(player.pos.x, player.pos.y, 60));

      // Basic attack (queued tap or held button, respecting the class cooldown)
      if ((Input.consumeAttack() || Input.isAttackHeld()) && player.attackCooldown <= 0) {
        playerBasicAttack(player);
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
        player.hp = Math.min(player.maxHp, player.hp + (player.hpRegenPerSecond || 0) * dt);
      }
      player.mp = Math.min(player.maxMp, player.mp + (player.mpRegenPerSecond || 0) * dt);
    }

    /** Fire an event once per wave/room clear so battle.js can advance. */
    function checkBattleProgress() {
      if (state.mode === 'free') { clearEmitted = false; return; }
      const remaining = aliveEnemies().length;
      if (remaining === 0 && !clearEmitted) {
        clearEmitted = true;
        emit('battle:cleared', { mode: state.mode });
      } else if (remaining > 0) {
        clearEmitted = false;
      }
    }

    /** Public: let battle.js re-arm the clear detector after spawning a wave. */
    function rearmBattleProgress() {
      clearEmitted = false;
      return true;
    }

    /** Nearest alive monster to a point (optionally within a max distance). */
    function nearestMonster(x, y, maxDistance) {
      let best = null;
      let bestDistance = maxDistance === undefined ? Infinity : maxDistance;
      (state.monsters || []).forEach(function (monster) {
        if (!monster.alive) return;
        const distance = Utils.distance(x, y, monster.pos.x, monster.pos.y);
        if (distance < bestDistance) { bestDistance = distance; best = monster; }
      });
      return best;
    }

    /** All monsters within `radius` of a point. */
    function monstersNear(x, y, radius) {
      return (state.monsters || []).filter(function (monster) {
        return monster.alive && Utils.distance(x, y, monster.pos.x, monster.pos.y) <= radius + monster.radius;
      });
    }

    /* ---------- targeting ---------- */

    /** How far a selected target stays selected while it is alive. */
    const TARGET_KEEP_RANGE = 690;
    const TARGET_MELEE_LEASH = 60;

    function isValidTarget(monster) {
      if (!monster || !monster.alive) return false;
      if ((state.monsters || []).indexOf(monster) === -1) return false;
      const player = state.player;
      if (!player) return false;
      return Utils.distance(monster.pos.x, monster.pos.y, player.pos.x, player.pos.y) <= TARGET_KEEP_RANGE;
    }

    /** Public: choose a monster as the active target. */
    function selectTarget(monster, options) {
      const opts = options || {};
      if (!monster || !monster.alive) return false;
      if (state.target === monster) return true;
      state.target = monster;
      state.monster = monster;
      HUD.render(state);
      if (!opts.silent) {
        Sfx.play('select');
        Effects.addFloater(monster.pos.x, monster.pos.y - 74, monster.name + ' targeted', {
          color: '#ffd76a', size: 12, life: 700
        });
        emit('targetSelected', { monster: monster });
      }
      return true;
    }

    function clearTarget() {
      if (!state.target) return false;
      state.target = null;
      emit('targetCleared', {});
      return true;
    }

    /** Tab / T: cycle through the living monsters nearest-first. */
    function cycleTarget(reverse) {
      const player = state.player;
      if (!player) return null;
      const list = (state.monsters || []).filter(function (m) { return m.alive; })
        .filter(function (m) {
          return Utils.distance(m.pos.x, m.pos.y, player.pos.x, player.pos.y) <= TARGET_KEEP_RANGE;
        })
        .sort(function (a, b) {
          return Utils.distance(a.pos.x, a.pos.y, player.pos.x, player.pos.y) -
            Utils.distance(b.pos.x, b.pos.y, player.pos.x, player.pos.y);
        });
      if (!list.length) { clearTarget(); return null; }
      const index = list.indexOf(state.target);
      const step = reverse ? -1 : 1;
      const next = list[(index + step + list.length + (index === -1 ? 1 : 0)) % list.length] || list[0];
      selectTarget(next, { silent: false });
      return next;
    }

    /** The target the player is acting on: their pick, else the nearest threat. */
    function currentTarget(maxDistance) {
      if (isValidTarget(state.target)) return state.target;
      return nearestMonster(state.player ? state.player.pos.x : 0, state.player ? state.player.pos.y : 0, maxDistance);
    }

    /** Screen tap → monster. Returns the picked monster (or null). */
    function pickTargetAt(x, y) {
      const picked = Renderer.pickAt(x, y, state);
      if (!picked) return null;
      if (state.screen !== 'game') return null;
      return selectTarget(picked) ? picked : null;
    }

    /**
     * Line of fire between the player and a monster. Point-blank swings always
     * connect, so brawling next to a wall keeps working.
     */
    function lineOfSight(from, to) {
      const reach = Utils.distance(from.pos.x, from.pos.y, to.pos.x, to.pos.y);
      if (reach <= (from.radius || 16) + (to.radius || 16) + TARGET_MELEE_LEASH) return true;
      return !Renderer.blocked(from.pos.x, from.pos.y, to.pos.x, to.pos.y);
    }

    /* ---------- attacks ---------- */
    /** Basic attack: melee classes swing, ranged classes loose a projectile. */
    function playerBasicAttack(player) {
      if (!player || player.downed) return;      // no combat while the hero is down
      player.attackCooldown = player.attackCooldownMs;
      player.attackAnim = 1;
      player.attackKind = player.attackType;
      Anim.set(player, 'attack', { durationMs: Math.min(420, player.attackCooldownMs) });
      Sfx.play('swing');
      emit('playerAttack', { player: player });

      if (player.attackType === 'ranged') rangedBasicAttack(player);
      else meleeBasicAttack(player);
    }

    function stealthedCrit(player) {
      return Skills.isStealthed(player);   // attacks from stealth always crit
    }

    function meleeBasicAttack(player) {
      const reach = player.attackRange + player.radius + 60;
      // the player's chosen target wins when it is in reach, otherwise the nearest
      let target = currentTarget(reach);
      if (target && !Combat.inRange(player, target, player.attackRange)) {
        const close = nearestMonster(player.pos.x, player.pos.y, reach);
        if (close && close !== target && Combat.inRange(player, close, player.attackRange)) target = close;
      }
      if (!target || !Combat.inRange(player, target, player.attackRange)) {
        // report "Too far!" whenever a monster exists, even if it is way out of reach
        showAttackFeedback(player, nearestMonster(player.pos.x, player.pos.y, Infinity));
        return;
      }
      if (!lineOfSight(player, target)) {
        Effects.addFloater(target.pos.x, target.pos.y - 70, 'No line of sight', { color: '#ffd0a0', size: 12, life: 700 });
        return;
      }
      hitMonster(player, target, {
        statKey: 'attack',
        multiplier: 1,
        alwaysCrit: stealthedCrit(player),
        apply: Skills.attackPoison(player),
        label: 'basic'
      });
    }

    function rangedBasicAttack(player) {
      const def = DATA.PROJECTILES[(player.classDef && player.classDef.basicProjectile) || 'arrow'];
      if (!def) return;
      const rangeLimit = player.autoTargetRange || 99999;
      const selected = isValidTarget(state.target) ? state.target : null;
      const target = currentTarget(rangeLimit);
      // A picked target that is out of reach is a range failure, not a licence
      // to loose arrows into the scenery.
      if (selected && !Combat.inRange(player, selected, rangeLimit)) {
        showAttackFeedback(player, selected);
        return;
      }
      if (selected && !target) { showAttackFeedback(player, selected); return; }
      if (target && !lineOfSight(player, target)) {
        Effects.addFloater(target.pos.x, target.pos.y - 70, 'No line of sight', { color: '#ffd0a0', size: 12, life: 700 });
        return;
      }
      const angle = target
        ? Math.atan2(target.pos.y - player.pos.y, target.pos.x - player.pos.x)
        : Math.atan2(player.facing.y, player.facing.x);
      fireProjectile(player, def, angle, { multiplier: def.damageMultiplier || 1 });
    }

    function showAttackFeedback(player, target) {
      if (target) {
        Effects.addFloater(player.pos.x + (player.facing.x || 1) * 22, player.pos.y - 64, 'Too far!', {
          color: '#e6e1ff', size: 12, life: 620
        });
      } else {
        Effects.addFloater(player.pos.x, player.pos.y - 64, 'Nothing here...', { color: '#c9c4e6', size: 12 });
      }
    }

    /** Spawn a projectile from the player, carrying its damage payload. */
    function fireProjectile(player, def, angle, options) {
      const opts = options || {};
      const mods = Skills.aggregateMods(player);
      const payload = {
        multiplier: opts.multiplier !== undefined ? opts.multiplier : (def.damageMultiplier || 1),
        statKey: def.stat || 'attack',
        critChance: player.critChance + (opts.critBonus || 0),
        critMultiplier: player.critMultiplier,
        alwaysCrit: stealthedCrit(player),
        apply: def.apply || null,
        poison: Skills.attackPoison(player),
        explodeRadius: def.explodeRadius || 0,
        strong: !!opts.strong,
        mods: mods
      };

      const originX = player.pos.x + Math.cos(angle) * (player.radius + 6);
      const originY = player.pos.y - 8 + Math.sin(angle) * (player.radius + 6);
      Projectiles.spawn(def, originX, originY, angle, payload);
      Effects.burst(originX, originY, def.color, 4, { speedMax: 70, gravity: 40 });
    }

    /**
     * Apply damage from `attacker` to a monster: rolls, floaters, particles,
     * status effects, rage gain, death handling. Used by melee, projectiles and skills.
     */
    function hitMonster(attacker, monster, options) {
      if (!monster || !monster.alive) return null;
      const opts = options || {};

      const result = Combat.rollDamage(attacker, monster, {
        statKey: opts.statKey || 'attack',
        multiplier: opts.multiplier || 1,
        critChance: opts.critChance,
        critMultiplier: opts.critMultiplier,
        alwaysCrit: opts.alwaysCrit,
        ignoreDefense: opts.ignoreDefense,
        bonusPct: opts.bonusPct
      });

      monster.hp = Math.max(0, monster.hp - result.damage);
      monster.hitFlash = 1;
      monster.aggro = true;
      Sfx.play(result.crit ? 'crit' : 'hit');
      if (!monster.telegraphMs) Anim.set(monster, 'hurt');

      const source = opts.source || 'player';
      void source;
      const color = result.crit ? '#ffd76a' : (opts.color || '#ffffff');
      Effects.addFloater(monster.pos.x, monster.pos.y - 62, result.damage, {
        color: color, size: result.crit ? 26 : 19
      });
      if (result.crit) {
        Effects.addFloater(monster.pos.x, monster.pos.y - 86, 'CRIT!', { color: '#ffca3a', size: 14, life: 700 });
        Effects.burst(monster.pos.x, monster.pos.y - 6, '#ffe9a8', 14, { speedMin: 70, speedMax: 220 });
      }
      Effects.burst(monster.pos.x, monster.pos.y, opts.particleColor || '#b8f5c0', result.crit ? 12 : 7);
      Effects.addShake(opts.shake !== undefined ? opts.shake : (result.crit ? 5 : 2.4));

      const statusPayload = mergeStatusPayloads(opts.apply, opts.poison);
      if (statusPayload) {
        Statuses.apply(monster, statusPayload, attacker, Skills.aggregateMods(attacker));
      }

      if (attacker && attacker.kind === 'player') Skills.addRage(attacker, 6);

      const verb = opts.label === 'skill' ? 'blasts' : (opts.label === 'spell' ? 'hits' : 'hits');
      if (!opts.silent) {
        Log.push(attacker.name + ' ' + verb + ' ' + monster.name + ' for ' + result.damage +
          (result.crit ? ' (critical)!' : ' damage.'), 'log--hit');
      }

      if (monster.hp <= 0) killMonster(monster, attacker);
      return result;
    }

    function mergeStatusPayloads(a, b) {
      if (!a && !b) return null;
      if (!a) return b;
      if (!b) return a;
      return {
        burn: a.burn || b.burn || null,
        poison: a.poison || b.poison || null,
        slow: a.slow || b.slow || null,
        freezeMs: a.freezeMs || b.freezeMs || 0,
        stunMs: a.stunMs || b.stunMs || 0
      };
    }

    /* ---------- skills ---------- */
    function castSkill(slot) {
      const player = state.player;
      if (!player || player.downed) return false;
      const skill = typeof slot === 'number' ? (player.skills || [])[slot] : DATA.getSkill(slot);
      if (!skill) return false;

      const check = Skills.canCast(player, skill);
      if (!check.ok) {
        notifySkillBlocked(player, skill, check.reason);
        return false;
      }

      const target = currentTarget(330);
      const needsTarget = skill.kind === 'meleeStrike' || skill.kind === 'inflict';
      if (needsTarget && (!target || !Combat.inRange(player, target, player.attackRange + 24))) {
        Effects.addFloater(player.pos.x, player.pos.y - 64, 'No target in range', { color: '#e6e1ff', size: 12, life: 700 });
        return false;
      }
      if (target && !lineOfSight(player, target)) {
        Effects.addFloater(target.pos.x, target.pos.y - 70, 'No line of sight', { color: '#ffd0a0', size: 12, life: 700 });
        return false;
      }

      const started = Skills.beginCast(player, skill);
      if (!started.ok) return false;

      player.attackAnim = 1;
      player.attackKind = 'cast';
      Anim.set(player, skill.ultimate ? 'ultimate' : 'skill', { durationMs: skill.ultimate ? 1500 : 720 });
      Sfx.play('cast');
      applySkillEffect(player, skill, target);
      Log.push(player.name + ' uses ' + skill.name + '.', 'log--level');
      emit('skillCast', { player: player, skill: skill, target: target });
      return true;
    }

    function notifySkillBlocked(player, skill, reason) {
      const messages = {
        cooldown: 'Not ready yet',
        mana: 'Not enough MP',
        rage: 'Not enough rage',
        downed: 'You are down'
      };
      const text = messages[reason] || 'Cannot cast';
      Effects.addFloater(player.pos.x, player.pos.y - 70, text, { color: '#ffb3a0', size: 12, life: 700 });
    }

    function applySkillEffect(player, skill, target) {
      const params = skill.params || {};
      const mods = Skills.aggregateMods(player);
      const magic = player.magic >= player.attack ? 'magic' : 'attack';

      switch (skill.kind) {
        case 'meleeStrike': {
          const healPct = params.selfHealPct;
          hitMonster(player, target, {
            statKey: magic,
            multiplier: params.multiplier || 1.5,
            alwaysCrit: params.alwaysCrit || stealthedCrit(player),
            apply: params.apply || null,
            label: 'skill',
            particleColor: '#ffd9a0'
          });
          if (healPct) healPlayer(player, player.maxHp * healPct, '#b8f5c0');
          break;
        }

        case 'aoeSelf': {
          const radius = params.radius || 100;
          const victims = monstersNear(player.pos.x, player.pos.y, radius);
          Effects.burst(player.pos.x, player.pos.y - 6, params.color || '#ffb347', 26, { speedMax: 240, lift: 40 });
          Effects.addShake(params.shake || 5);
          if (!victims.length) {
            Effects.addFloater(player.pos.x, player.pos.y - 64, 'No enemies in range', { color: '#e6e1ff', size: 12, life: 700 });
          }
          victims.forEach(function (monster) {
            hitMonster(player, monster, {
              statKey: magic,
              multiplier: params.multiplier || 1.2,
              apply: params.apply || null,
              label: 'skill',
              silent: victims.length > 1,
              particleColor: params.color || '#ffb347',
              shake: 0
            });
          });
          break;
        }

        case 'projectile': {
          const def = DATA.PROJECTILES[params.projectile] || DATA.PROJECTILES.arrow;
          const count = params.count || 1;
          const spread = params.spread || 0;
          const baseAngle = target
            ? Math.atan2(target.pos.y - player.pos.y, target.pos.x - player.pos.x)
            : Math.atan2(player.facing.y, player.facing.x);
          for (let i = 0; i < count; i++) {
            const offset = count === 1 ? 0 : (i - (count - 1) / 2) * spread;
            fireProjectile(player, def, baseAngle + offset, {
              multiplier: params.multiplier || def.damageMultiplier || 1,
              strong: true
            });
          }
          break;
        }

        case 'heal': {
          healPlayer(player, player.maxHp * (params.percent || 0.3), '#b8f5c0');
          break;
        }

        case 'buff': {
          Skills.addBuff(player, skill.id, skill.name, params.mods, params.durationMs, {
            regenPerSecond: params.regenPerSecond || 0,
            poisonOnHit: params.poisonOnHit || null,
            stealthCrit: params.stealthCrit || 0
          });
          Effects.burst(player.pos.x, player.pos.y - 10, '#cbb2ff', 18, { speedMax: 120, lift: 70 });
          Effects.addFloater(player.pos.x, player.pos.y - 68, skill.name + '!', { color: '#cbb2ff', size: 14, life: 900 });
          break;
        }

        case 'stealth': {
          player.stealthMs = params.durationMs || 3000;
          Skills.addBuff(player, skill.id, skill.name, { speedPct: params.speedPct || 0 }, params.durationMs || 3000, {
            stealthCrit: params.critChance || 0
          });
          (state.monsters || []).forEach(function (monster) { monster.aggro = false; });
          Effects.burst(player.pos.x, player.pos.y - 8, '#9aa6c4', 22, { speedMax: 110, lift: 30 });
          Effects.addFloater(player.pos.x, player.pos.y - 68, 'Hidden!', { color: '#bfd0ff', size: 14, life: 900 });
          break;
        }

        case 'dash': {
          const angle = target
            ? Math.atan2(target.pos.y - player.pos.y, target.pos.x - player.pos.x)
            : Math.atan2(player.facing.y, player.facing.x);
          let distance = params.distance || 150;
          if (target) {
            const gap = Utils.distance(player.pos.x, player.pos.y, target.pos.x, target.pos.y) -
              (player.radius + target.radius);
            distance = Math.min(distance, Math.max(0, gap));
          }
          const fromX = player.pos.x, fromY = player.pos.y;
          player.pos.x += Math.cos(angle) * distance;
          player.pos.y += Math.sin(angle) * distance;
          player.facing.x = Math.cos(angle);
          player.facing.y = Math.sin(angle);
          clampToWorld(player);
          Effects.burst(fromX, fromY - 8, '#cfe0ff', 14, { speedMax: 90, lift: 20 });
          Effects.burst(player.pos.x, player.pos.y - 8, '#cfe0ff', 14, { speedMax: 90, lift: 20 });
          if (params.multiplier > 0 && target && Combat.inRange(player, target, player.attackRange + 12)) {
            hitMonster(player, target, {
              statKey: 'attack',
              multiplier: params.multiplier,
              label: 'skill',
              particleColor: '#ffd0a0',
              shake: 5
            });
          }
          break;
        }

        case 'inflict': {
          hitMonster(player, target, {
            statKey: 'magic',
            multiplier: params.multiplier || 1,
            apply: {
              freezeMs: params.freezeMs || 0,
              slow: params.slow || null,
              burn: params.burn || null
            },
            label: 'spell',
            color: '#bfefff',
            particleColor: '#bfefff',
            shake: 4
          });
          break;
        }

        default:
          break;
      }
    }

    function healPlayer(player, amount, color) {
      const mods = Skills.aggregateMods(player);
      const healed = Math.max(1, Math.round(amount * (1 + (mods.healingBonus || 0))));
      const before = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + healed);
      const actual = Math.round(player.hp - before);
      Effects.addFloater(player.pos.x, player.pos.y - 64, '+' + actual, { color: color || '#b8f5c0', size: 18 });
      Effects.burst(player.pos.x, player.pos.y - 8, color || '#b8f5c0', 16, { speedMax: 110, lift: 70, gravity: -30 });
      emit('playerHealed', { player: player, amount: actual });
      return actual;
    }

    /* ---------- projectiles ---------- */
    function updateProjectiles(dt) {
      Projectiles.update(dt, {
        monsters: function () { return state.monsters || []; },
        players: function () { return state.player && !state.player.downed ? [state.player] : []; },
        onHitPlayer: function (projectile, target) {
          const payload = projectile.payload || {};
          const owner = payload.owner || { name: 'Enemy', attack: 10 };
          const player = target;
          if (Utils.random() < (player.evasion || 0)) {
            Effects.addFloater(player.pos.x, player.pos.y - 64, 'MISS', { color: '#bfefff', size: 16, life: 700 });
            return;
          }
          const result = Combat.rollDamage(owner, player, { multiplier: payload.multiplier || 1 });
          const damage = Combat.mitigate(player, result.damage);
          player.hp = Math.max(0, player.hp - damage);
          player.hitFlash = 1;
          player.hurtTimer = COMBAT.outOfCombatRegenDelayMs;
          Anim.set(player, 'hurt');
          Effects.addFloater(player.pos.x, player.pos.y - 64, '-' + damage, { color: '#ff8080', size: 18 });
          Effects.burst(projectile.x, projectile.y, projectile.def.color, 8, { speedMax: 90 });
          Effects.addShake(3);
          if (projectile.def.apply) Statuses.apply(player, projectile.def.apply, owner, {});
          if (player.hp <= 0) knockDownPlayer(player);
        },
        onHit: function (projectile, monster) {
          const payload = projectile.payload || {};
          const player = state.player;

          hitMonster(player, monster, {
            statKey: payload.statKey || 'attack',
            multiplier: payload.multiplier || 1,
            critChance: payload.critChance,
            critMultiplier: payload.critMultiplier,
            alwaysCrit: payload.alwaysCrit,
            apply: mergeStatusPayloads(payload.apply, payload.poison),
            label: 'spell',
            color: projectile.def.color,
            particleColor: projectile.def.trail || projectile.def.color,
            shake: projectile.def.shake || 2.4
          });

          // area burst (Fireball)
          if (payload.explodeRadius) {
            Effects.burst(projectile.x, projectile.y, '#ffb347', 26, { speedMax: 240, lift: 60 });
            Effects.addShake(4);
            monstersNear(projectile.x, projectile.y, payload.explodeRadius).forEach(function (other) {
              if (other === monster) return;
              hitMonster(player, other, {
                statKey: payload.statKey || 'attack',
                multiplier: (payload.multiplier || 1) * 0.7,
                apply: payload.apply,
                label: 'spell',
                silent: true,
                particleColor: '#ffb347'
              });
            });
          }
        },
        onExpire: function (projectile) {
          Effects.burst(projectile.x, projectile.y, projectile.def.trail || projectile.def.color, 4, {
            speedMax: 60, sizeMin: 1, sizeMax: 3, gravity: 20
          });
        }
      });
    }

    function killMonster(monster, attacker) {
      // A DoT tick and a swing can land in the same frame — the first death
      // wins, so exp/gold/loot can never be paid out twice for one kill.
      if (!monster.alive || monster.rewarded) return null;
      monster.rewarded = true;
      monster.alive = false;
      monster.aggro = false;
      monster.deathTimer = 0.4;
      monster.respawnTimer = monster.isDuelist ? 99999 : ((monster.def && monster.def.respawnMs) || 4000) / 1000;
      monster.attackCooldown = 0;
      Anim.set(monster, 'death');
      if (monster.isDuelist) { emit('arena:botDown', { duelist: monster }); }
      Sfx.play(monster.isBoss ? 'boss' : 'death');

      const burstColor = (monster.def && monster.def.palette && monster.def.palette.body) || '#c9b2ff';
      Effects.burst(monster.pos.x, monster.pos.y, burstColor, 22, { speedMax: 200, lift: 80 });
      Effects.addShake(6);

      const rewards = (monster.def && monster.def.rewards) || null;
      const expGain = (rewards && rewards.exp) || monster.xp || 0;
      const goldGain = rewards && rewards.goldMin !== undefined
        ? Utils.randInt(rewards.goldMin || 0, rewards.goldMax || 0)
        : (monster.coins || 0);

      state.player.kills += 1;
      // Stage/boss/arena fights pay through battle.js's reward sink; out in the
      // world the kill pays the hero directly.
      if (typeof state.rewardSink !== 'function') {
        state.player.gold += goldGain;
        state.player.exp += expGain;
      }
      if (attacker && attacker.kind === 'player') Skills.addRage(attacker, 12);
      Statuses.clear(monster);

      // battle modes route rewards through the account instead of the local player
      const enemyCoins = monster.coins || goldGain;
      const enemyXp = monster.xp || expGain;
      if (typeof state.rewardSink === 'function') {
        state.rewardSink({ coins: enemyCoins, xp: enemyXp, monster: monster });
      }
      emit('enemy:killed', { monster: monster, coins: enemyCoins, xp: enemyXp, isBoss: !!monster.isBoss });

      Effects.addFloater(monster.pos.x - 30, monster.pos.y - 70, '+' + expGain + ' EXP', {
        color: '#c4a7ff', size: 15, life: 1200, vy: -30, vx: -6
      });
      Effects.addFloater(monster.pos.x + 32, monster.pos.y - 54, '+' + goldGain + ' gold', {
        color: '#f2c14e', size: 14, life: 1300, vy: -26, vx: 6
      });

      Log.push(monster.name + ' defeated! +' + expGain + ' EXP, +' + goldGain + ' gold.', 'log--kill');
      emit('monsterKilled', { monster: monster, exp: expGain, gold: goldGain });
      if (!monster.isDuelist) dropLoot(monster);
      checkLevelUp(state.player);
      return { exp: expGain, gold: goldGain };
    }

    /* ---------- loot ---------- */
    const LOOT_PICKUP_RADIUS = 34;
    const LOOT_LIFETIME = 90;          // seconds before a drop fades away
    const LOOT_MAX = 40;

    /** Is this spot dry land the player can stand on? */
    function dryGround(x, y) {
      if (Renderer.waterDepth && Renderer.waterDepth(x, y) > 0.06) return false;
      const solved = Renderer.resolveMove(x, y, x, y, 12);
      return !solved.blocked;
    }

    /** Find a legal spot for a drop near where the monster fell. */
    function lootSpot(x, y) {
      if (dryGround(x, y)) return { x: x, y: y };
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI * 2;
        const radius = 26 + i * 6;
        const sx = x + Math.cos(angle) * radius;
        const sy = y + Math.sin(angle) * radius * 0.7;
        if (!isInsideWorld(sx, sy)) continue;
        if (dryGround(sx, sy)) return { x: sx, y: sy };
      }
      const fallback = Renderer.resolveMove(x, y, x, y, 12);
      return { x: fallback.x, y: fallback.z };
    }

    function isInsideWorld(x, y) {
      const top = WORLD.floorTop || WORLD.margin;
      return x > WORLD.margin && x < WORLD.width - WORLD.margin && y > top && y < WORLD.height - WORLD.margin;
    }

    /** Turn a kill into drops on the ground. */
    function dropLoot(monster) {
      const data = root.MytharaLootData;
      if (!data) return [];
      const rolled = data.roll(monster, monster.level, Utils.random);
      if (!rolled.length) return [];
      const spot = lootSpot(monster.pos.x, monster.pos.y);
      const dropped = [];
      rolled.forEach(function (drop, index) {
        if (state.loot.length >= LOOT_MAX) state.loot.shift();
        const angle = (index / Math.max(1, rolled.length)) * Math.PI * 2 + Utils.randRange(-0.4, 0.4);
        const spread = rolled.length > 1 ? 16 + index * 9 : 0;
        const entry = {
          uid: 'loot' + Math.round(state.time * 1000) + '_' + index,
          kind: drop.kind,
          id: drop.id,
          name: drop.name,
          rarity: drop.rarity,
          colour: drop.colour,
          glyph: drop.glyph,
          amount: drop.amount,
          x: Utils.clamp(spot.x + Math.cos(angle) * spread, WORLD.margin + 6, WORLD.width - WORLD.margin - 6),
          y: Utils.clamp(spot.y + Math.sin(angle) * spread * 0.7, (WORLD.floorTop || WORLD.margin) + 4, WORLD.height - WORLD.margin - 4),
          bob: Utils.randRange(0, Math.PI * 2),
          age: 0,
          picked: false
        };
        state.loot.push(entry);
        dropped.push(entry);
      });
      emit('loot:dropped', { monster: monster, loot: dropped });
      return dropped;
    }

    /** Award one drop to the hero (and the saved account when available). */
    function collectLoot(entry) {
      if (!entry || entry.picked) return null;
      entry.picked = true;
      const player = state.player;
      const Account = root.MytharaAccount && root.MytharaAccount.Account;
      const ready = !!(Account && Account.isReady && Account.isReady());
      let label = entry.name;

      if (entry.kind === 'coins') {
        player.gold += entry.amount;
        if (ready && Account.addCoins) Account.addCoins(entry.amount);
        Sfx.play('coin');
        label = '+' + entry.amount + ' gold';
      } else if (entry.kind === 'potion') {
        player.potions = player.potions || {};
        player.potions[entry.id] = (player.potions[entry.id] || 0) + entry.amount;
        if (ready && Account.addPotion) Account.addPotion(entry.id, entry.amount);
        Sfx.play('potion');
        label = '+' + entry.name;
      } else if (entry.kind === 'material') {
        player.materials = player.materials || {};
        player.materials[entry.id] = (player.materials[entry.id] || 0) + entry.amount;
        if (ready && Account.addMaterial) Account.addMaterial(entry.id, entry.amount);
        Sfx.play('loot');
        label = '+' + entry.amount + ' ' + entry.name;
      } else {
        let item = null;
        if (ready && Account.rollItem) item = Account.rollItem({ minRarity: entry.rarity });
        if (item) label = '+' + item.name;
        else {
          player.lootBag = player.lootBag || [];
          player.lootBag.push({ kind: 'item', rarity: entry.rarity });
          label = '+' + entry.name;
        }
        Sfx.play('loot');
      }

      Effects.addFloater(entry.x, entry.y - 34, label, {
        color: entry.colour || '#f2c14e', size: entry.kind === 'item' ? 15 : 13, life: 1100, vy: -30
      });
      Effects.burst(entry.x, entry.y, entry.colour || '#f2c14e', entry.kind === 'item' ? 12 : 6,
        { speedMax: 90, lift: 40 });
      Log.push('Picked up ' + label.replace(/^\+/, '').trim() + '.', 'log--loot');
      emit('loot:pickup', { loot: entry, label: label });
      return entry;
    }

    /** Walk-over pickup plus ageing. */
    function updateLoot(dt) {
      const player = state.player;
      if (!state.loot.length) return;
      for (let i = state.loot.length - 1; i >= 0; i--) {
        const entry = state.loot[i];
        if (entry.picked) { state.loot.splice(i, 1); continue; }
        entry.age += dt;
        const distance = Utils.distance(entry.x, entry.y, player.pos.x, player.pos.y);
        if (!player.downed && distance <= LOOT_PICKUP_RADIUS) {
          collectLoot(entry);
          state.loot.splice(i, 1);
          continue;
        }
        if (entry.age > LOOT_LIFETIME) {
          state.loot.splice(i, 1);
          emit('loot:expired', { loot: entry });
        }
      }
    }

    /** Public: pick up the nearest drop (used by tests and touch helpers). */
    function pickupLoot(entry) {
      const target = entry || state.loot.filter(function (l) { return !l.picked; })[0];
      return collectLoot(target);
    }

    /* ---------- monster AI ---------- */
    let aiTick = 0;
    /**
     * Distance LOD: monsters near the player think every frame, ones further
     * away every 2nd–5th frame, so a busy zone never costs a full AI pass.
     */
    function aiStride(monster, player) {
      const d = Utils.distance(monster.pos.x, monster.pos.y, player.pos.x, player.pos.y);
      if (d < 300) return 1;
      if (d < 640) return 2;
      return 5;
    }

    function updateMonsters(dt) {
      aiTick += 1;
      const player = state.player;
      (state.monsters || []).forEach(function (monster) {
        if (!monster.alive) { updateMonster(monster, dt); return; }
        const stride = aiStride(monster, player);
        if (stride > 1 && (aiTick + (monster.aiOffset || 0)) % stride !== 0) return;
        updateMonster(monster, dt * stride);
      });
      // primary target for the HUD: the player's pick, else the nearest one
      state.monster = currentTarget(Infinity) || (state.monsters || [])[0] || null;
    }

    function updateMonster(monster, dt) {
      if (!monster) return;

      if (!monster.alive) {
        if (state.mode === 'free' && !monster.isDuelist) {
          monster.respawnTimer -= dt;
          if (monster.respawnTimer <= 0) respawnMonster(monster);
        }
        return;
      }

      monster.hitFlash = Math.max(0, monster.hitFlash - dt * 3.2);
      monster.attackAnim = Math.max(0, monster.attackAnim - dt * 3);
      monster.attackCooldown = Math.max(0, (monster.attackCooldown || 0) - dt * 1000);
      monster.spawnPulse = Math.max(0, monster.spawnPulse - dt * 2);

      const player = state.player;

      // ---------- telegraphed ability wind-up ----------
      if (monster.telegraphMs > 0) {
        monster.telegraphMs -= dt * 1000;
        if (monster.telegraphMs <= 0 && monster.telegraph) {
          executeAbility(monster, monster.telegraph, player);
          monster.telegraph = null;
        }
        clampToWorld(monster);
        return;
      }

      // ---------- ability cooldowns (bosses and casters) ----------
      updateAbilities(monster, dt, player);

      // damage-over-time (burn / poison) ticks
      const dotDamage = Statuses.update(monster, dt);
      if (dotDamage > 0) {
        monster.hp = Math.max(0, monster.hp - dotDamage);
        Effects.addFloater(monster.pos.x + Utils.randRange(-8, 8), monster.pos.y - 52,
          '-' + Math.max(1, Math.round(dotDamage)), {
            color: monster.status && monster.status.poison ? '#9be36a' : '#ff9b4a',
            size: 14, life: 650, vy: -22
          });
        if (monster.hp <= 0) { killMonster(monster, player); return; }
      }

      // frozen / stunned monsters skip their turn entirely
      if (Statuses.isIncapacitated(monster)) {
        monster.aggro = true;
        clampToWorld(monster);
        return;
      }

      const speedMultiplier = Statuses.speedMultiplier(monster);
      const hidden = Skills.isStealthed(player);
      const distanceToPlayer = Utils.distance(monster.pos.x, monster.pos.y, player.pos.x, player.pos.y);
      const homeDistance = Utils.distance(monster.pos.x, monster.pos.y, monster.home.x, monster.home.y);
      const aggroRange = monster.isBoss ? 560 : effectiveAggroRange(monster);
      const leash = monster.leash || 220;
      const reach = monster.radius + player.radius + (monster.def.attackRange || 14);
      const ai = monster.ai || (monster.ai = { state: 'idle', timer: 0.6 });

      // Line of sight is only needed to start a chase; checking it a few times
      // a second keeps detection honest without paying for it every frame.
      monster.losTimer = (monster.losTimer || 0) - dt;
      if (monster.losTimer <= 0 || ai.state === 'idle' || ai.state === 'patrol') {
        monster.losTimer = 0.35;
        monster.canSee = player.downed || hidden ? false : lineOfSight(monster, player);
      }
      const playerVisible = !player.downed && !hidden && distanceToPlayer <= aggroRange && monster.canSee !== false;

      const goHome = function () {
        ai.state = 'return';
        ai.timer = 0;
        monster.aggro = false;
      };

      switch (ai.state) {
        case 'idle':
          if (playerVisible) {
            ai.state = 'detect';
            ai.timer = monster.isBoss ? 0.2 : 0.35;
            monster.aggro = true;
            Effects.addFloater(monster.pos.x, monster.pos.y - 78, '!', { color: '#ffd76a', size: 18, life: 620, vy: -26 });
          } else if (homeDistance > 26) {
            goHome();
          } else {
            ai.timer -= dt;
            if (ai.timer <= 0) {
              ai.state = 'patrol';
              ai.timer = Utils.randRange(1.6, 3.4);
              const angle = Utils.randRange(0, Math.PI * 2);
              const radius = Utils.randRange(12, Math.max(16, (monster.def.wanderRadius || 70) * 0.7));
              monster.patrolTarget = { x: monster.home.x + Math.cos(angle) * radius, y: monster.home.y + Math.sin(angle) * radius * 0.7 };
            }
          }
          break;

        case 'patrol': {
          if (playerVisible) {
            ai.state = 'detect';
            ai.timer = monster.isBoss ? 0.2 : 0.35;
            monster.aggro = true;
            Effects.addFloater(monster.pos.x, monster.pos.y - 78, '!', { color: '#ffd76a', size: 18, life: 620, vy: -26 });
            break;
          }
          ai.timer -= dt;
          const target = monster.patrolTarget;
          if (!target || ai.timer <= 0) { ai.state = 'idle'; ai.timer = Utils.randRange(0.6, 1.8); break; }
          const gap = Utils.distance(monster.pos.x, monster.pos.y, target.x, target.y);
          if (gap < 8) { ai.state = 'idle'; ai.timer = Utils.randRange(0.8, 2.2); break; }
          stepMonster(monster, target.x, target.y, monster.speed * 0.42 * speedMultiplier * dt);
          if (!Anim.isBusy(monster)) Anim.set(monster, 'walk');
          break;
        }

        case 'detect':
          monster.aggro = true;
          monster.facing = { x: player.pos.x - monster.pos.x, y: player.pos.y - monster.pos.y };
          ai.timer -= dt;
          if (!playerVisible) { ai.state = 'idle'; ai.timer = 0.4; monster.aggro = false; break; }
          if (ai.timer <= 0) ai.state = 'chase';
          break;

        case 'chase':
        case 'attack':
          monster.aggro = true;
          if (player.downed || hidden || homeDistance > leash) {
            goHome();
            break;
          }
          monster.facing = { x: player.pos.x - monster.pos.x, y: player.pos.y - monster.pos.y };
          if (distanceToPlayer > reach) {
            const chasing = monster.speed * speedMultiplier * (1 + (monster.enrage || 0)) * dt;
            stepMonster(monster, player.pos.x, player.pos.y, chasing);
            if (!Anim.isBusy(monster)) Anim.set(monster, distanceToPlayer > 220 ? 'run' : 'walk');
            ai.state = 'chase';
          } else {
            ai.state = 'attack';
            if (monster.attackCooldown <= 0) monsterAttack(monster, player);
          }
          break;

        case 'return': {
          monster.aggro = false;
          if (playerVisible && homeDistance < leash * 0.6) {
            ai.state = 'detect';
            ai.timer = 0.35;
            monster.aggro = true;
            break;
          }
          if (homeDistance <= 12) { ai.state = 'idle'; ai.timer = Utils.randRange(0.5, 1.6); break; }
          // catch its breath while walking home
          if (monster.hp < monster.maxHp) {
            monster.hp = Math.min(monster.maxHp, monster.hp + monster.maxHp * 0.09 * dt);
          }
          stepMonster(monster, monster.home.x, monster.home.y, monster.speed * 0.7 * speedMultiplier * dt);
          if (!Anim.isBusy(monster)) Anim.set(monster, 'walk');
          break;
        }

        default:
          ai.state = 'idle';
          ai.timer = 0.5;
      }

      Anim.update(monster, dt, monster.aggro ? 'walk' : 'idle');
      clampToWorld(monster);
    }

    /** Bosses keep hunting; normal enemies use their data range plus alert radius. */
    function effectiveAggroRange(monster) {
      const base = (monster.def && monster.def.aggroRange) || 150;
      return base + (monster.aggro ? 160 : 0);
    }

    /* ---------------- enemy abilities ---------------- */
    function updateAbilities(monster, dt, player) {
      if (!monster.abilities || !monster.abilities.length) return;
      if (player.downed) return;
      const distance = Utils.distance(monster.pos.x, monster.pos.y, player.pos.x, player.pos.y);

      // boss phase transitions
      if (monster.phases && monster.phases.length) {
        const ratio = monster.hp / monster.maxHp;
        while (monster.phaseIndex < monster.phases.length && ratio <= monster.phases[monster.phaseIndex].hpPct) {
          const phase = monster.phases[monster.phaseIndex];
          monster.phaseIndex += 1;
          if (phase.enrage) {
            monster.enrage = (monster.enrage || 0) + phase.enrage;
            monster.attack = Math.round(monster.attack * (1 + phase.enrage * 0.5));
          }
          if (phase.text) {
            Effects.addFloater(monster.pos.x, monster.pos.y - 96, phase.text, { color: '#ffd76a', size: 15, life: 1800, vy: -14 });
          }
          Effects.addShake(7);
          Effects.burst(monster.pos.x, monster.pos.y - 10, (monster.def && monster.def.aura) || '#ff8a3a', 30, { speedMax: 260, lift: 90 });
          emit('boss:phase', { monster: monster, phase: phase, index: monster.phaseIndex });
        }
      }

      for (let i = 0; i < monster.abilities.length; i++) {
        const ability = monster.abilities[i];
        if (ability.timerMs > 0) { ability.timerMs -= dt * 1000; continue; }
        if (distance > (ability.range || 220) && ability.type !== 'summon' && ability.type !== 'teleport') continue;
        // start the telegraph (wind-up) — the hit lands when it completes
        const windup = ability.windupMs || 600;
        monster.telegraph = ability;
        monster.telegraphMs = windup;
        monster.telegraphTotal = windup;
        monster.telegraphRadius = ability.radius || 80;
        ability.timerMs = ability.cooldownMs || 6000;
        if (ability.name) {
          Effects.addFloater(monster.pos.x, monster.pos.y - 84, ability.name, { color: '#ff9b6a', size: 13, life: windup + 200, vy: -8 });
        }
        break;
      }
    }

    function executeAbility(monster, ability, player) {
      if (!monster.alive) return;
      Effects.addShake(ability.shake || 3);

      if (ability.type === 'aoe') {
        Effects.burst(monster.pos.x, monster.pos.y - 6, '#ff8a5c', 24, { speedMax: 240, lift: 60 });
        const radius = ability.radius || 90;
        const distance = Utils.distance(monster.pos.x, monster.pos.y, player.pos.x, player.pos.y);
        if (!player.downed && distance <= radius + player.radius) {
          const result = Combat.rollDamage(monster, player, { multiplier: ability.multiplier || 1.4 });
          const damage = Combat.mitigate(player, result.damage);
          player.hp = Math.max(0, player.hp - damage);
          player.hurtTimer = COMBAT.outOfCombatRegenDelayMs;
          Anim.set(player, 'hurt');
          Effects.addFloater(player.pos.x, player.pos.y - 64, '-' + damage, { color: '#ff8080', size: 20 });
          Log.push(monster.name + ' hits ' + player.name + ' with ' + (ability.name || 'a special attack') + ' for ' + damage + ' damage.', 'log--hurt');
          if (ability.apply) Statuses.apply(player, ability.apply, monster, {});
          if (ability.heal) {
            const healed = Math.round(monster.maxHp * ability.heal);
            monster.hp = Math.min(monster.maxHp, monster.hp + healed);
            Effects.addFloater(monster.pos.x, monster.pos.y - 70, '+' + healed, { color: '#b8f5c0', size: 16 });
          }
          if (player.hp <= 0) knockDownPlayer(player);
        }
      }

      if (ability.type === 'shoot') {
        const def = DATA.PROJECTILES[ability.projectile];
        if (!def) return;
        const count = ability.count || 1;
        const spread = ability.spread || 0.18;
        const baseAngle = Math.atan2(player.pos.y - monster.pos.y, player.pos.x - monster.pos.x);
        for (let i = 0; i < count; i++) {
          const offset = count === 1 ? 0 : (i - (count - 1) / 2) * spread;
          Projectiles.spawn(def, monster.pos.x, monster.pos.y - 10, baseAngle + offset, {
            hostile: true,
            multiplier: ability.multiplier || 1,
            owner: monster
          });
        }
      }

      if (ability.type === 'summon' && state.monsters.length < 12) {
        const catalog = root.MYTHARA_ENEMIES || DATA.ENEMIES || null;
        const def = catalog && catalog.get ? catalog.get(ability.summon) : null;
        if (!def) return;
        const count = ability.count || 2;
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          const minion = createEnemy(def, Math.max(1, monster.level - 3), {
            spawn: {
              x: Utils.clamp(monster.pos.x + Math.cos(angle) * 70, WORLD.margin, WORLD.width - WORLD.margin),
              y: Utils.clamp(monster.pos.y + Math.sin(angle) * 50, WORLD.floorTop || WORLD.margin, WORLD.height - WORLD.margin)
            }
          });
          state.monsters.push(minion);
        }
        Effects.burst(monster.pos.x, monster.pos.y - 10, '#c46bff', 22, { speedMax: 160, lift: 60 });
        Log.push(monster.name + ' summons reinforcements!', 'log--hurt');
        emit('battle:summon', { monster: monster, summon: ability.summon, count: count });
      }

      if (ability.type === 'dash') {
        const angle = Math.atan2(player.pos.y - monster.pos.y, player.pos.x - monster.pos.x);
        monster.pos.x = Utils.clamp(monster.pos.x + Math.cos(angle) * 90, WORLD.margin, WORLD.width - WORLD.margin);
        monster.pos.y = Utils.clamp(monster.pos.y + Math.sin(angle) * 70, WORLD.floorTop || WORLD.margin, WORLD.height - WORLD.margin);
        Effects.burst(monster.pos.x, monster.pos.y - 8, '#ffb347', 16, { speedMax: 170, lift: 40 });
        if (!player.downed && Utils.distance(monster.pos.x, monster.pos.y, player.pos.x, player.pos.y) <= monster.radius + player.radius + 18) {
          const result = Combat.rollDamage(monster, player, { multiplier: ability.multiplier || 1.5 });
          const damage = Combat.mitigate(player, result.damage);
          player.hp = Math.max(0, player.hp - damage);
          Anim.set(player, 'hurt');
          Effects.addFloater(player.pos.x, player.pos.y - 64, '-' + damage, { color: '#ff8080', size: 20 });
          if (player.hp <= 0) knockDownPlayer(player);
        }
      }

      if (ability.type === 'teleport') {
        Effects.burst(monster.pos.x, monster.pos.y - 10, '#c46bff', 18, { speedMax: 140, lift: 50 });
        const corners = [
          { x: WORLD.width - 140, y: (WORLD.floorTop || 300) + 60 },
          { x: 140, y: WORLD.height - 90 },
          { x: WORLD.width - 160, y: WORLD.height - 90 }
        ];
        const spot = Utils.pick(corners);
        monster.pos.x = spot.x;
        monster.pos.y = spot.y;
        Effects.burst(monster.pos.x, monster.pos.y - 10, '#c46bff', 18, { speedMax: 140, lift: 50 });
      }
    }

    /** Move a monster toward a point, respecting cliffs and solid props. */
    function stepMonster(monster, targetX, targetY, step) {
      const dx = targetX - monster.pos.x;
      const dy = targetY - monster.pos.y;
      const dist = Math.hypot(dx, dy) || 1;
      const move = Math.min(step, dist);
      const toX = monster.pos.x + (dx / dist) * move;
      const toY = monster.pos.y + (dy / dist) * move;
      const solved = Renderer.resolveMove(monster.pos.x, monster.pos.y, toX, toY, monster.radius);
      monster.pos.x = solved.x;
      monster.pos.y = solved.z;
      monster.facing = { x: dx, y: dy };
      if (solved.blocked) {
        // nudge sideways so a monster does not grind against a wall forever
        const side = (monster.aiOffset % 2 ? 1 : -1) * 0.9;
        const px = -dy / dist * side;
        const py = dx / dist * side;
        const slide = Renderer.resolveMove(monster.pos.x, monster.pos.y,
          monster.pos.x + px * move, monster.pos.y + py * move, monster.radius);
        monster.pos.x = slide.x;
        monster.pos.y = slide.z;
      }
      return solved;
    }

    function wander(monster, dt, speedMultiplier) {
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
        const step = monster.speed * 0.45 * (speedMultiplier === undefined ? 1 : speedMultiplier) * dt;
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
      monster.attackCooldown = monster.attackCooldownMs || 1500;
      monster.attackAnim = 1;
      Sfx.play('swing');

      // evasion (Ninja passives, light armour)
      if (Utils.random() < (player.evasion || 0)) {
        Effects.addFloater(player.pos.x, player.pos.y - 64, 'MISS', { color: '#bfefff', size: 16, life: 700 });
        Sfx.play('miss');
        Log.push(monster.name + ' misses ' + player.name + '.', null);
        emit('playerDodged', { monster: monster, player: player });
        return;
      }

      const result = Combat.rollDamage(monster, player);
      const damage = Combat.mitigate(player, result.damage);
      player.hp = Math.max(0, player.hp - damage);
      player.hitFlash = 1;
      player.hurtTimer = COMBAT.outOfCombatRegenDelayMs;
      Anim.set(player, 'hurt');
      Skills.addRage(player, 5);
      Sfx.play('hurt');

      Effects.addFloater(player.pos.x, player.pos.y - 64, '-' + damage, {
        color: '#ff8080', size: 18
      });
      Effects.burst(player.pos.x, player.pos.y - 4, '#ff9b9b', 6);
      Effects.addShake(4);

      Log.push(monster.name + ' hits ' + player.name + ' for ' + damage + ' damage.', 'log--hurt');
      emit('playerDamaged', { monster: monster, damage: damage });

      if (player.hp <= 0) knockDownPlayer(player);
    }

    /* ---------- death / respawn ---------- */
    function knockDownPlayer(player) {
      player.downed = true;
      player.respawnTimer = 3;
      player.attackAnim = 0;
      player.stealthMs = 0;
      player.buffs = [];
      Stats.recompute(player);
      Input.reset();
      Anim.set(player, 'death');
      if (state.mode === 'free') {
        Log.push(player.name + ' has fallen! Recovering...', 'log--down');
      }
      Effects.addShake(9);
      Sfx.play('downed');
      Effects.showBanner('YOU DIED — recovering...');
      emit('playerDowned', { player: player });
      if (state.mode !== 'free') emit('battle:playerDown', { player: player, mode: state.mode });
    }

    /**
     * Nearest place it is actually safe to stand back up: the village safe
     * ring when the hero fell near the hometown, otherwise the class spawn,
     * and never inside a rock, a wall or the lake.
     */
    function countMonstersNear(x, y, radius) {
      let count = 0;
      (state.monsters || []).forEach(function (monster) {
        if (!monster.alive) return;
        if (Utils.distance(monster.pos.x, monster.pos.y, x, y) <= radius) count += 1;
      });
      return count;
    }

    function safeRespawnPoint(fromX, fromY) {
      const floorTop = (WORLD.floorTop || WORLD.margin) + 20;
      const inside = function (spot) {
        // the village and the mountains are scenery; only the floor is walkable
        spot.x = Utils.clamp(spot.x, WORLD.margin + 16, WORLD.width - WORLD.margin - 16);
        spot.y = Utils.clamp(spot.y, floorTop, WORLD.height - WORLD.margin - 16);
        return spot;
      };

      const candidates = [];
      const village = root.MytharaRender3D && root.MytharaRender3D.safeZone ? root.MytharaRender3D.safeZone() : null;
      if (village && Utils.distance(fromX, fromY, village.x, village.z) <= 900) {
        // the village gate — the closest walkable ground to the safe ring
        candidates.push(inside({ x: village.x, y: village.z + 110 }));
        candidates.push(inside({ x: village.x - 60, y: village.z + 130 }));
        candidates.push(inside({ x: village.x + 60, y: village.z + 130 }));
      }
      candidates.push({ x: PLAYER_DEF.spawn.x, y: PLAYER_DEF.spawn.y });
      candidates.push({ x: PLAYER_DEF.spawn.x + 46, y: PLAYER_DEF.spawn.y });
      candidates.push({ x: PLAYER_DEF.spawn.x - 46, y: PLAYER_DEF.spawn.y });

      let fallback = null;
      for (let i = 0; i < candidates.length; i++) {
        const spot = candidates[i];
        if (!isInsideWorld(spot.x, spot.y)) continue;
        const solved = Renderer.resolveMove(spot.x, spot.y, spot.x, spot.y, 16);
        if (solved.blocked) continue;
        if (Renderer.waterDepth && Renderer.waterDepth(spot.x, spot.y) > 0.05) continue;
        if (countMonstersNear(spot.x, spot.y, 150) === 0) return spot;    // quiet ground first
        if (!fallback) fallback = spot;
      }
      return fallback || { x: PLAYER_DEF.spawn.x, y: PLAYER_DEF.spawn.y };
    }

    function revivePlayer(player) {
      player.downed = false;
      player.hp = player.maxHp;
      player.mp = player.maxMp;
      const spot = safeRespawnPoint(player.pos.x, player.pos.y);
      player.pos.x = spot.x;
      player.pos.y = spot.y;
      player.hurtTimer = 0;
      Stats.recompute(player);
      player.hp = player.maxHp;
      player.mp = player.maxMp;
      Effects.burst(player.pos.x, player.pos.y, '#9ad1ff', 16, { speedMax: 130, lift: 60 });
      Sfx.play('revive');
      Log.push(player.name + ' is back on their feet.', 'log--level');
      emit('playerRevived', { player: player });
    }

    function respawnMonster(monster) {
      if (state.mode !== 'free') return;      // stage enemies stay down
      monster.alive = true;
      monster.hp = monster.maxHp;
      monster.pos.x = monster.home.x;
      monster.pos.y = monster.home.y;
      monster.aggro = false;
      monster.hitFlash = 0;
      monster.spawnPulse = 1;
      // A new life must be able to pay rewards again — without clearing this
      // the respawned monster would be unkillable and reward nothing.
      monster.rewarded = false;
      monster.respawnTimer = 0;
      monster.attackCooldown = 0;
      monster.deathTimer = 0;
      if (monster.ai) { monster.ai.state = 'idle'; monster.ai.timer = Utils.randRange(0.4, 1.4); }
      monster.patrolTarget = null;
      Statuses.clear(monster);
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
        player.expToNext = expNeededForLevel(player.level);
        Stats.recompute(player);              // per-class growth curve
        if (PROGRESSION.fullHealOnLevelUp) {
          player.hp = player.maxHp;
          player.mp = player.maxMp;
        }
        leveled = true;
        Log.push('LEVEL UP! ' + player.name + ' the ' + player.title + ' reached level ' + player.level + '.', 'log--level');
        emit('levelUp', { player: player });
      }
      if (leveled) {
        Sfx.play('level');
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
      if (monster.hp <= 0) killMonster(monster, state.player);
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
      playerAttack: playerBasicAttack,
      playerBasicAttack: playerBasicAttack,
      castSkill: castSkill,
      hitMonster: hitMonster,
      nearestMonster: nearestMonster,
      monstersNear: monstersNear,
      target: function () { return isValidTarget(state.target) ? state.target : null; },
      loot: function () { return state.loot; },
      dropLoot: dropLoot,
      pickupLoot: pickupLoot,
      selectTarget: selectTarget,
      clearTarget: clearTarget,
      cycleTarget: cycleTarget,
      currentTarget: currentTarget,
      pickTargetAt: pickTargetAt,
      lineOfSight: lineOfSight,
      healPlayer: healPlayer,
      createCharacter: createCharacter,
      createMonsters: createMonsters,
      setScreen: setScreen,
      setZoneTheme: setZoneTheme,
      saveCharacter: saveCharacter,
      loadSavedCharacter: loadSavedCharacter,
      damageMonster: damageMonster,
      knockDownPlayer: knockDownPlayer,
      speedMultiplier: Statuses.speedMultiplier,
      setMode: setMode,
      spawnEnemies: spawnEnemies,
      clearEnemies: clearEnemies,
      aliveEnemies: aliveEnemies,
      primaryTarget: primaryTarget,
      createEnemy: createEnemy,
      rearmBattleProgress: rearmBattleProgress,
      Anim: Anim,
      ENEMY_SCALING: ENEMY_SCALING,
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
    version: '0.4.0-cloud',
    Game: Game,
    Input: Input,
    Combat: Combat,
    Statuses: Statuses,
    Projectiles: Projectiles,
    Skills: Skills,
    Stats: Stats,
    Effects: Effects,
    Anim: Anim,
    Renderer: Renderer,
    HUD: HUD,
    Log: Log,
    CharacterSelect: CharacterSelect,
    Classes: DATA.CLASSES,
    Utils: Utils,
    DATA: DATA
  };

  root.Mythara = Mythara;
  if (typeof module !== 'undefined' && module.exports) module.exports = Mythara;

  /**
   * Boot the playfield. The application shell (js/app.js) calls this once the
   * player has loaded, signed in and picked a character. Calling it twice is
   * safe — the second call is ignored.
   */
  let booted = false;
  function boot(options) {
    if (booted) return Game.state;
    booted = true;
    return Game.init(options || {});
  }
  Mythara.boot = boot;
  Mythara.isBooted = function () { return booted; };
  Mythara.resetBoot = function () { booted = false; };

})(typeof globalThis !== 'undefined' ? globalThis : this);
