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

        const targets = ctx.monsters() || [];
        for (let m = 0; m < targets.length; m++) {
          const monster = targets[m];
          if (!monster.alive || p.hit.indexOf(monster) !== -1) continue;
          const reach = p.radius + monster.radius;
          if (Utils.distance(p.x, p.y, monster.pos.x, monster.pos.y) <= reach) {
            ctx.onHit(p, monster);
            p.hit.push(monster);
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
      const num = function (key) { return (base[key] || 0) + (growth[key] || 0) * lv + (bonus[key] || 0); };

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
      player.evasion = Utils.clamp((base.evasion || 0) + (bonus.evasion || 0) + (mods.evasion || 0), 0, 0.75);
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
      moving: false, walkPhase: 0, radius: PLAYER_DEF.radius,

      attackCooldown: 0, attackAnim: 0, attackKind: 'melee', hitFlash: 0, hurtTimer: 0,
      downed: false, respawnTimer: 0, kills: 0
    };

    Skills.initPlayer(player);
    Stats.recompute(player);
    player.hp = player.maxHp;
    player.mp = player.maxMp;
    return player;
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

      const monsters = state.monsters || (state.monster ? [state.monster] : []);
      const actors = monsters.concat([state.player]).filter(function (a) { return a; });
      actors.sort(function (a, b) { return a.pos.y - b.pos.y; });

      actors.forEach(function (actor) {
        if (actor.kind === 'monster') drawMonster(c, actor, state);
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
      const walk = Math.sin((o.walkPhase || 0) * 2) * (o.moving ? 1.8 : 0);
      const bob = o.moving ? walk : Math.sin((o.time || 0) * 2) * 0.9;

      c.save();
      c.translate(o.x || 0, o.y || 0);
      if (o.scale && o.scale !== 1) c.scale(o.scale, o.scale);
      if (o.alpha !== undefined) c.globalAlpha = o.alpha;

      if (o.downed) {
        c.rotate(Math.PI / 2.4);
        c.globalAlpha = (o.alpha === undefined ? 1 : o.alpha) * 0.75;
      }

      // shadow
      c.fillStyle = 'rgba(10,20,10,0.3)';
      c.beginPath();
      c.ellipse(0, 0, 17, 6, 0, 0, Math.PI * 2);
      c.fill();

      c.translate(0, bob);

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
      drawWeapon(c, look, facing, attack, o.attackKind);

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
      drawHero: drawHero,
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

    return {
      init: init,
      open: open,
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
      monster: null,         // primary target (nearest alive monster)
      monsters: [],          // every monster in the zone
      character: null,       // { classId, name }
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
      state.player = createPlayer(classDef.id, name);
      Projectiles.clear();
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

    /** Switch between the character-select screen and the game. */
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

    function update(dt) {
      const player = state.player;

      updatePlayer(player, dt);
      updateMonsters(dt);
      updateProjectiles(dt);
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

    /* ---------- attacks ---------- */
    /** Basic attack: melee classes swing, ranged classes loose a projectile. */
    function playerBasicAttack(player) {
      player.attackCooldown = player.attackCooldownMs;
      player.attackAnim = 1;
      player.attackKind = player.attackType;
      emit('playerAttack', { player: player });

      if (player.attackType === 'ranged') rangedBasicAttack(player);
      else meleeBasicAttack(player);
    }

    function stealthedCrit(player) {
      return Skills.isStealthed(player);   // attacks from stealth always crit
    }

    function meleeBasicAttack(player) {
      const target = nearestMonster(player.pos.x, player.pos.y, player.attackRange + player.radius + 60);
      if (!target || !Combat.inRange(player, target, player.attackRange)) {
        // report "Too far!" whenever a monster exists, even if it is way out of reach
        showAttackFeedback(player, nearestMonster(player.pos.x, player.pos.y, Infinity));
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
      const target = nearestMonster(player.pos.x, player.pos.y, player.autoTargetRange || 99999);
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

      const source = opts.source || 'player';
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

      const target = nearestMonster(player.pos.x, player.pos.y, 520);
      const needsTarget = skill.kind === 'meleeStrike' || skill.kind === 'inflict';
      if (needsTarget && (!target || !Combat.inRange(player, target, player.attackRange + 24))) {
        Effects.addFloater(player.pos.x, player.pos.y - 64, 'No target in range', { color: '#e6e1ff', size: 12, life: 700 });
        return false;
      }

      const started = Skills.beginCast(player, skill);
      if (!started.ok) return false;

      player.attackAnim = 1;
      player.attackKind = 'cast';
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
      if (attacker && attacker.kind === 'player') Skills.addRage(attacker, 12);
      Statuses.clear(monster);

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
    function updateMonsters(dt) {
      (state.monsters || []).forEach(function (monster) { updateMonster(monster, dt); });
      // primary target for the HUD: nearest alive monster, else the first one
      state.monster = nearestMonster(state.player.pos.x, state.player.pos.y, Infinity) ||
        (state.monsters || [])[0] || null;
    }

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

      if (player.downed || hidden || distanceToPlayer > monster.def.aggroRange) {
        monster.aggro = false;
        wander(monster, dt, speedMultiplier);
      } else {
        monster.aggro = true;
        const reach = monster.radius + player.radius + monster.def.attackRange;
        if (distanceToPlayer > reach) {
          moveToward(monster, player.pos.x, player.pos.y, monster.speed * speedMultiplier * dt);
        } else if (monster.attackCooldown <= 0) {
          monsterAttack(monster, player);
        }
      }

      clampToWorld(monster);
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
      monster.attackCooldown = monster.def.attackCooldownMs;
      monster.attackAnim = 1;

      // evasion (Ninja passives, light armour)
      if (Utils.random() < (player.evasion || 0)) {
        Effects.addFloater(player.pos.x, player.pos.y - 64, 'MISS', { color: '#bfefff', size: 16, life: 700 });
        Log.push(monster.name + ' misses ' + player.name + '.', null);
        emit('playerDodged', { monster: monster, player: player });
        return;
      }

      const result = Combat.rollDamage(monster, player);
      const damage = Combat.mitigate(player, result.damage);
      player.hp = Math.max(0, player.hp - damage);
      player.hitFlash = 1;
      player.hurtTimer = COMBAT.outOfCombatRegenDelayMs;
      Skills.addRage(player, 5);

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
      Stats.recompute(player);
      player.hp = player.maxHp;
      player.mp = player.maxMp;
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
      healPlayer: healPlayer,
      createCharacter: createCharacter,
      createMonsters: createMonsters,
      setScreen: setScreen,
      saveCharacter: saveCharacter,
      loadSavedCharacter: loadSavedCharacter,
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
    version: '0.2.0-classes',
    Game: Game,
    Input: Input,
    Combat: Combat,
    Statuses: Statuses,
    Projectiles: Projectiles,
    Skills: Skills,
    Stats: Stats,
    Effects: Effects,
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

  if (root.document) {
    const boot = function () { Game.init(); };
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
