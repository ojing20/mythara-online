/* ============================================================
 * Mythara Online — js/render3d-vfx.js
 * ------------------------------------------------------------
 * Combat presentation in 3D:
 *   • weapon swing arcs and bow/cast poses
 *   • impact bursts, sparks, dust and crit flashes
 *   • spell effects — fire, ice, lightning, holy, shadow, nature
 *   • ground decals (scorch, frost, holy light, poison pools)
 *   • floating damage numbers driven by the engine's own floaters
 *   • boss telegraphs, phase pulses, summon portals, level-up pillars
 *
 * Effects are spawned from the game's own events (see game.js/battle.js
 * `emit` calls) *and* from hit detection on enemy HP, so nothing about
 * the existing combat maths changes — this module only observes.
 * ============================================================ */
(function (root) {
  'use strict';

  const M = root.Mythara3D;
  const S = root.MytharaShapes3D;
  const v3 = M.v3;
  const Colour = M.Colour;
  const clamp = M.clamp;
  const lerp = M.lerp;
  const TAU = M.TAU;

  const ELEMENTS = {
    fire: { core: '#ffd76a', glow: '#ff6a2a', spark: '#ffb347' },
    ice: { core: '#eaffff', glow: '#7fdcff', spark: '#bfefff' },
    lightning: { core: '#ffffff', glow: '#b07bff', spark: '#e0d0ff' },
    holy: { core: '#fff6d0', glow: '#ffd76a', spark: '#ffeeb0' },
    shadow: { core: '#e0c0ff', glow: '#8a3fd6', spark: '#c46bff' },
    nature: { core: '#e8ffc0', glow: '#5fbf3a', spark: '#9be36a' },
    steel: { core: '#ffffff', glow: '#cfe3ff', spark: '#e8f0ff' },
    blood: { core: '#ffd0d0', glow: '#c8342c', spark: '#ff8a7a' }
  };

  function elementFor(skill, actor) {
    if (!skill) return 'steel';
    const id = (skill.id || '') + ' ' + (skill.name || '') + ' ' + (skill.kind || '');
    if (/fire|ember|flame|burn|emberwood/i.test(id)) return 'fire';
    if (/ice|frost|freeze|glacier|cold/i.test(id)) return 'ice';
    if (/storm|thunder|lightning|bolt|shock/i.test(id)) return 'lightning';
    if (/holy|heal|bless|divine|light|lumen|sanct/i.test(id)) return 'holy';
    if (/shadow|void|dark|curse|hex|necro/i.test(id)) return 'shadow';
    if (/nature|poison|root|thorn|vine|beast/i.test(id)) return 'nature';
    if (actor && actor.look && actor.look.aura) {
      const map = { '#ff7a3a': 'fire', '#7fdcff': 'ice', '#ffeeb0': 'holy', '#c46bff': 'shadow' };
      if (map[actor.look.aura]) return map[actor.look.aura];
    }
    return 'steel';
  }

  const VFX = (function () {
    /** effect kinds keep their own update/draw behaviour */
    const effects = [];
    const decals = [];
    const hpCache = {};             // monsterId → hp, used for hit detection
    let installed = false;
    let shakeAdd = 0;

    function spawn(effect) {
      effect.age = 0;
      effect.life = effect.life || 0.6;
      effects.push(effect);
      if (effects.length > 220) effects.splice(0, effects.length - 220);
      return effect;
    }

    /* ---------------- spawners ---------------- */
    function swing(actor, element, opts) {
      const o = opts || {};
      const kind = element || 'steel';
      return spawn({
        kind: 'swing', life: o.life || 0.34, actor: actor, element: kind,
        radius: o.radius || 34, arc: o.arc || Math.PI * 1.25, spin: o.spin || 0,
        y: o.y === undefined ? 16 : o.y, follow: o.follow !== false
      });
    }

    function impact(x, z, element, opts) {
      const o = opts || {};
      return spawn({
        kind: 'impact', life: o.life || 0.45, x: x, z: z, element: element || 'steel',
        size: o.size || 1, crit: !!o.crit, y: o.y === undefined ? 14 : o.y
      });
    }

    function burstEffect(x, z, colour, opts) {
      const o = opts || {};
      return spawn({ kind: 'burst', life: o.life || 0.7, x: x, z: z, colour: colour || '#ffffff', count: o.count || 10, spread: o.spread || 26, y: o.y === undefined ? 10 : o.y, rise: o.rise || 16 });
    }

    function ringEffect(x, z, colour, opts) {
      const o = opts || {};
      return spawn({ kind: 'ring', life: o.life || 0.8, x: x, z: z, colour: colour || '#ffffff', radius: o.radius || 90, thickness: o.thickness || 5 });
    }

    function beam(fromActor, toActor, element, opts) {
      const o = opts || {};
      return spawn({ kind: 'beam', life: o.life || 0.32, from: fromActor, to: toActor, element: element || 'steel', width: o.width || 3 });
    }

    function pillar(x, z, colour) {
      return spawn({ kind: 'pillar', life: 1.4, x: x, z: z, colour: colour || '#ffe9a0' });
    }

    function decal(x, z, colour, opts) {
      const o = opts || {};
      decals.push({ x: x, z: z, colour: colour, radius: o.radius || 30, life: o.life || 8, maxLife: o.life || 8 });
      if (decals.length > 26) decals.shift();
    }

    function portal(x, z, colour) {
      return spawn({ kind: 'portal', life: 1.1, x: x, z: z, colour: colour || '#c46bff' });
    }

    /* ---------------- event wiring ---------------- */
    function install() {
      if (installed) return;
      const Bus = root.MytharaCore && root.MytharaCore.Bus;
      const Game = root.Mythara && root.Mythara.Game;
      if (!Bus) return;
      installed = true;

      Bus.on('playerAttack', function (payload) {
        const player = payload && payload.player;
        if (!player) return;
        const ranged = player.attackType === 'ranged';
        const magic = player.attackType === 'magic';
        const element = magic ? elementFor({ id: player.classId }) : 'steel';
        swing(player, ranged ? 'steel' : element, { radius: ranged ? 18 : 36, life: ranged ? 0.22 : 0.3, y: ranged ? 14 : 17 });
        if (ranged) burstEffect(player.pos.x, player.pos.y, '#ffe6a0', { count: 5, y: 14, rise: 8 });
        if (magic) burstEffect(player.pos.x, player.pos.y, ELEMENTS[element].glow, { count: 7, y: 18, rise: 14 });
      });

      Bus.on('skillCast', function (payload) {
        const skill = payload && payload.skill;
        const player = payload && payload.player;
        if (!player) return;
        const element = elementFor(skill, player);
        const target = payload.target || (root.Mythara.Game.aliveEnemies()[0] || null);
        swing(player, element, { radius: skill && skill.ultimate ? 60 : 44, life: 0.6, arc: TAU });
        if (target && skill && skill.kind === 'projectile') beam(player, target, element, { life: 0.3, width: 2.4 });
        if (target && skill && (skill.kind === 'meleeStrike' || skill.kind === 'dash')) beam(player, target, element, { life: 0.18, width: 4 });
        if (skill && (skill.kind === 'aoeSelf' || skill.ultimate)) {
          ringEffect(player.pos.x, player.pos.y, ELEMENTS[element].glow, { radius: (skill.params && skill.params.radius) || 120, thickness: 7, life: 0.7 });
        }
        if (skill && skill.kind === 'heal') {
          pillar(player.pos.x, player.pos.y, ELEMENTS.holy.glow);
          burstEffect(player.pos.x, player.pos.y, ELEMENTS.holy.spark, { count: 14, rise: 26, spread: 22, life: 1.1 });
        }
        if (skill && (skill.kind === 'buff' || skill.kind === 'stealth')) {
          ringEffect(player.pos.x, player.pos.y, ELEMENTS[element].glow, { radius: 60, thickness: 4, life: 0.9 });
        }
      });

      Bus.on('playerHealed', function (payload) {
        const player = payload && payload.player;
        if (!player) return;
        pillar(player.pos.x, player.pos.y, ELEMENTS.holy.glow);
      });

      Bus.on('monsterSpawned', function (payload) {
        const monster = payload && payload.monster;
        if (!monster) return;
        const def = monster.def || {};
        if (def.summoned || monster.summoned) portal(monster.pos.x, monster.pos.y, def.aura || '#c46bff');
        burstEffect(monster.pos.x, monster.pos.y, '#c9a0ff', { count: 12, rise: 24, spread: 20 });
      });

      Bus.on('battle:summon', function (payload) {
        const monster = payload && payload.monster;
        if (!monster) return;
        portal(monster.pos.x, monster.pos.y, (monster.def && monster.def.aura) || '#c46bff');
      });

      Bus.on('enemy:killed', function (payload) {
        const monster = payload && payload.monster;
        if (!monster) return;
        const def = monster.def || {};
        burstEffect(monster.pos.x, monster.pos.y, def.aura || '#ffd76a', { count: monster.isBoss ? 34 : 14, rise: 30, spread: monster.isBoss ? 54 : 26, life: monster.isBoss ? 1.5 : 0.8 });
        ringEffect(monster.pos.x, monster.pos.y, def.aura || '#ffd76a', { radius: monster.isBoss ? 200 : 80, thickness: monster.isBoss ? 10 : 5, life: monster.isBoss ? 1.4 : 0.7 });
        if (monster.isBoss) {
          pillar(monster.pos.x, monster.pos.y, def.aura || '#ffd76a');
          decal(monster.pos.x, monster.pos.y, '#2a1a10', { radius: 90, life: 20 });
          shakeAdd = Math.max(shakeAdd, 8);
        }
      });

      Bus.on('boss:phase', function (payload) {
        const monster = payload && payload.monster;
        if (!monster) return;
        ringEffect(monster.pos.x, monster.pos.y, '#ff5f3a', { radius: 240, thickness: 12, life: 1.1 });
        pillar(monster.pos.x, monster.pos.y, '#ff8a3a');
        shakeAdd = Math.max(shakeAdd, 10);
      });

      Bus.on('battle:boss', function (payload) {
        const monster = payload && payload.monster;
        if (!monster) return;
        ringEffect(monster.pos.x, monster.pos.y, '#ffd76a', { radius: 260, thickness: 8, life: 1.6 });
        shakeAdd = Math.max(shakeAdd, 7);
      });

      Bus.on('battle:potion', function (payload) {
        const id = payload && payload.id;
        const player = root.Mythara.Game.state.player;
        if (!player) return;
        const colour = /mana/i.test(id || '') ? '#56b8ff' : '#ff8aa0';
        pillar(player.pos.x, player.pos.y, colour);
        burstEffect(player.pos.x, player.pos.y, colour, { count: 16, rise: 28, spread: 20, life: 1 });
      });

      Bus.on('levelUp', function () {
        const player = root.Mythara.Game.state.player;
        if (!player) return;
        pillar(player.pos.x, player.pos.y, '#ffe9a0');
        ringEffect(player.pos.x, player.pos.y, '#ffd76a', { radius: 140, thickness: 6, life: 1.2 });
      });

      Bus.on('playerDamaged', function (payload) {
        const player = root.Mythara.Game.state.player;
        if (!player) return;
        burstEffect(player.pos.x, player.pos.y, '#ff6a5a', { count: 6, rise: 12, spread: 14, life: 0.45 });
      });

      Bus.on('playerDodged', function () {
        const player = root.Mythara.Game.state.player;
        if (!player) return;
        burstEffect(player.pos.x, player.pos.y, '#cfe3ff', { count: 6, rise: 16, spread: 16, life: 0.4 });
      });

      if (Game) {
        Game.on('modeChange', function () { effects.length = 0; decals.length = 0; });
      }
    }

    /* ---------------- simulation ---------------- */
    function update(dt, state) {
      for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i];
        e.age += dt;
        if (e.age >= e.life) effects.splice(i, 1);
      }
      for (let i = decals.length - 1; i >= 0; i--) {
        decals[i].life -= dt;
        if (decals[i].life <= 0) decals.splice(i, 1);
      }

      // hit detection on enemy health → sparks, crit flashes, decals
      const monsters = (state && state.monsters) || [];
      const seen = {};
      for (let i = 0; i < monsters.length; i++) {
        const m = monsters[i];
        if (!m || !m.id === undefined) continue;
        const key = m.uid || (m.enemyId + ':' + i);
        seen[key] = true;
        const prev = hpCache[key];
        if (prev !== undefined && m.hp < prev && m.alive) {
          const dmg = prev - m.hp;
          const crit = dmg >= Math.max(28, m.maxHp * 0.12);
          const def = m.def || {};
          const element = def.aura ? elementFor({ id: def.id + ' ' + def.name }) : 'blood';
          impact(m.pos.x, m.pos.y, element, { size: clamp(dmg / 40, 0.7, 2.6), crit: crit });
          if (crit) {
            burstEffect(m.pos.x, m.pos.y, '#ffd76a', { count: 12, rise: 24, spread: 22, life: 0.5 });
            if (m.isBoss) decal(m.pos.x, m.pos.y, '#3a1a10', { radius: 40, life: 6 });
          }
        } else if (prev === undefined && m.alive && !m.spawnPulse) {
          burstEffect(m.pos.x, m.pos.y, '#c9a0ff', { count: 8, rise: 18, spread: 16, life: 0.5 });
        }
        hpCache[key] = m.hp;
        if (!m.alive) delete hpCache[key];
      }
      Object.keys(hpCache).forEach(function (k) { if (!seen[k]) delete hpCache[k]; });
      if (shakeAdd > 0) {
        if (root.Mythara && root.Mythara.Effects && root.Mythara.Effects.addShake) root.Mythara.Effects.addShake(shakeAdd);
        shakeAdd = 0;
      }
    }

    /* ---------------- drawing ---------------- */
    function drawDecals(P) {
      decals.forEach(function (d) {
        const alpha = clamp(d.life / d.maxLife, 0, 1) * 0.5;
        P.ellipseGround(d.x, d.z, d.radius, d.radius * 0.6, d.colour, alpha, 0.7);
      });
    }

    function draw(P, time) {
      drawDecals(P);
      effects.forEach(function (e) {
        const t = clamp(e.age / e.life, 0, 1);
        switch (e.kind) {
          case 'swing': {
            const actor = e.actor;
            if (!actor || !actor.pos) return;
            const el = ELEMENTS[e.element] || ELEMENTS.steel;
            const yaw = Math.atan2(actor.facing ? actor.facing.x : 0, actor.facing ? actor.facing.y : 1);
            const sweepFrom = -1.1;
            const sweepTo = 1.5;
            const ang = lerp(sweepFrom, sweepTo, t);
            const points = [];
            const steps = 9;
            const spinBase = e.spin ? t * TAU : 0;
            for (let i = 0; i <= steps; i++) {
              const a2 = ang - (i / steps) * e.arc * 0.9 + spinBase;
              const r = e.radius * (0.72 + (i / steps) * 0.4);
              points.push(v3(
                actor.pos.x + Math.sin(yaw + a2) * r,
                e.y + Math.sin(t * Math.PI) * 5,
                actor.pos.y + Math.cos(yaw + a2) * r
              ));
            }
            const alpha = (1 - t) * 0.9;
            S.ribbon(P, points, { width: e.radius * 0.22, color: el.core, color2: el.glow, alpha: alpha, blend: 'lighter' });
            break;
          }
          case 'impact': {
            const el = ELEMENTS[e.element] || ELEMENTS.blood;
            const size = e.size * (0.6 + t * 1.1);
            S.billboard(P, { pos: v3(e.x, e.y + t * 6, e.z), width: 8 * size, height: 8 * size, color: el.core, alpha: (1 - t) * 0.9, soft: true });
            S.billboard(P, { pos: v3(e.x, e.y + 2 + t * 3, e.z), width: 16 * size, height: 16 * size, color: el.glow, alpha: (1 - t) * 0.5, soft: true });
            for (let i = 0; i < 6; i++) {
              const a = i * 1.05 + e.x * 0.1;
              const r = 6 + t * 26 * e.size;
              S.billboard(P, {
                pos: v3(e.x + Math.cos(a) * r, e.y + 4 + Math.sin(t * 3 + i) * 6, e.z + Math.sin(a) * r * 0.7),
                width: 2.4 * e.size, height: 2.4 * e.size, color: el.spark, alpha: (1 - t) * 0.85, soft: true
              });
            }
            if (e.crit) {
              S.ring(P, { x: e.x, z: e.z, radius: 26 + t * 46, thickness: 3.4, color: el.core, alpha: (1 - t) * 0.8, segments: 22, y: 1.2 });
              P.label(v3(e.x, e.y + 22 + t * 6, e.z), 'CRIT', { color: '#ffd76a', size: 13 - t * 3, weight: '900', alpha: (1 - t) * 0.9 });
            }
            break;
          }
          case 'burst': {
            for (let i = 0; i < e.count; i++) {
              const a = (i / e.count) * TAU + e.x * 0.13;
              const r = e.spread * t;
              S.billboard(P, {
                pos: v3(e.x + Math.cos(a) * r, e.y + t * e.rise * (0.5 + (i % 3) * 0.3), e.z + Math.sin(a) * r * 0.8),
                width: 3.2, height: 3.2, color: e.colour, alpha: (1 - t) * 0.85, soft: true
              });
            }
            break;
          }
          case 'ring': {
            S.ring(P, {
              x: e.x, z: e.z, radius: e.radius * (0.35 + t * 0.75), thickness: e.thickness * (1 - t * 0.5),
              color: e.colour, alpha: (1 - t) * 0.7, segments: 30, y: 1.0
            });
            break;
          }
          case 'beam': {
            const from = e.from && e.from.pos, to = e.to && e.to.pos;
            if (!from || !to) return;
            const el = ELEMENTS[e.element] || ELEMENTS.steel;
            const points = [];
            const steps = 7;
            for (let i = 0; i <= steps; i++) {
              const k = i / steps;
              points.push(v3(
                lerp(from.x, to.x, k),
                lerp(16, 14, k) + Math.sin(k * Math.PI) * 6 + Math.sin(time * 22 + k * 6) * 1.6,
                lerp(from.y, to.y, k)
              ));
            }
            S.ribbon(P, points, { width: e.width, color: el.core, color2: el.glow, alpha: (1 - t) * 0.95, blend: 'lighter' });
            S.billboard(P, { pos: v3(to.x, 14, to.y), width: 12, height: 12, color: el.glow, alpha: (1 - t) * 0.6, soft: true });
            break;
          }
          case 'pillar': {
            const alpha = Math.sin(t * Math.PI);
            S.billboard(P, { pos: v3(e.x, 24, e.z), width: 22, height: 46 + t * 20, color: e.colour, alpha: alpha * 0.5, soft: true });
            S.ring(P, { x: e.x, z: e.z, radius: 30 + t * 20, thickness: 4, color: e.colour, alpha: alpha * 0.7, segments: 24, y: 1.1 });
            break;
          }
          case 'portal': {
            const alpha = Math.sin(t * Math.PI) * 0.9;
            for (let i = 0; i < 3; i++) {
              S.ring(P, {
                x: e.x, z: e.z, radius: 16 + i * 12 + t * 20, thickness: 3,
                color: e.colour, alpha: alpha * (0.7 - i * 0.15), segments: 24, phase: time * (1 + i * 0.4), y: 1 + i * 4
              });
            }
            S.billboard(P, { pos: v3(e.x, 8 + t * 10, e.z), width: 22, height: 26, color: e.colour, alpha: alpha * 0.5, soft: true });
            break;
          }
          default: break;
        }
      });
    }

    /** Engine floaters (damage numbers) drawn in 3D with crit styling. */
    function drawFloaters(P, state) {
      const floaters = (root.Mythara && root.Mythara.Effects && root.Mythara.Effects.floaters) || [];
      for (let i = 0; i < floaters.length; i++) {
        const f = floaters[i];
        const life = clamp(f.life / (f.maxLife || 1), 0, 1);
        const crit = (f.size || 0) >= 19;
        const z = f.y + 58;
        S.billboard(P, {
          pos: v3(f.x, 26 + (1 - life) * 22, z), width: crit ? 10 : 6, height: crit ? 10 : 6,
          color: crit ? '#ffd76a' : (f.color || '#ffffff'), alpha: life * 0.22 * (crit ? 1.5 : 1), soft: true
        });
        P.label(v3(f.x, 28 + (1 - life) * 24, z), f.text, {
          color: f.color || '#ffffff', size: crit ? 20 : 15, weight: crit ? '900' : '700',
          alpha: Math.min(1, life * 1.6)
        });
      }
      void state;
    }

    /** Engine particles (dust, sparks from the original systems) drawn in 3D. */
    function drawParticles(P) {
      const particles = (root.Mythara && root.Mythara.Effects && root.Mythara.Effects.particles) || [];
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const life = clamp(p.life / (p.maxLife || 1), 0, 1);
        S.billboard(P, {
          pos: v3(p.x, 8 + (1 - life) * 12, p.y), width: (p.size || 3) * 1.6, height: (p.size || 3) * 1.6,
          color: p.color || '#ffffff', alpha: life * 0.8, soft: true
        });
      }
    }

    /** Engine projectiles (arrows, orbs) drawn as glowing 3D shots with trails. */
    function drawProjectiles(P, time) {
      const list = (root.Mythara && root.Mythara.Projectiles && root.Mythara.Projectiles.list) || [];
      for (let i = 0; i < list.length; i++) {
        const pr = list[i];
        const style = pr.style || 'orb';
        const colour = pr.color || (style === 'arrow' ? '#e8dcc0' : style === 'shard' ? '#bfefff' : '#ff8a3a');
        const trail = [];
        for (let k = 0; k < 5; k++) {
          const back = k * 6;
          trail.push(v3(pr.x - Math.cos(pr.angle) * back, 14, pr.y - Math.sin(pr.angle) * back));
        }
        S.ribbon(P, trail, { width: style === 'arrow' ? 1.2 : 3.4, color: colour, color2: '#ffffff', alpha: 0.45, blend: 'lighter' });
        S.billboard(P, { pos: v3(pr.x, 14, pr.y), width: style === 'arrow' ? 4 : 8, height: style === 'arrow' ? 4 : 8, color: colour, alpha: 0.85, soft: true });
        if (style !== 'arrow') {
          S.billboard(P, { pos: v3(pr.x, 14, pr.y), width: 20, height: 20, color: colour, alpha: 0.22 + Math.sin(time * 20 + i) * 0.06, soft: true });
        }
      }
    }

    function reset() { effects.length = 0; decals.length = 0; Object.keys(hpCache).forEach(function (k) { delete hpCache[k]; }); }
    function count() { return effects.length; }

    return {
      install: install,
      update: update,
      draw: draw,
      drawFloaters: drawFloaters,
      drawParticles: drawParticles,
      drawProjectiles: drawProjectiles,
      drawDecals: drawDecals,
      swing: swing,
      impact: impact,
      burstEffect: burstEffect,
      ringEffect: ringEffect,
      beam: beam,
      pillar: pillar,
      portal: portal,
      decal: decal,
      reset: reset,
      count: count,
      ELEMENTS: ELEMENTS,
      elementFor: elementFor,
      _effects: effects,
      _decals: decals
    };
  })();

  root.MytharaVFX3D = VFX;
  if (typeof module !== 'undefined' && module.exports) module.exports = VFX;

})(typeof globalThis !== 'undefined' ? globalThis : this);
