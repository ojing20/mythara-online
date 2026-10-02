/* ============================================================
 * Mythara Online — js/render3d-actors.js
 * ------------------------------------------------------------
 * Fully procedural 3D hero and creature rigs.
 *
 * Heroes — one silhouette per class (heavy steel, leather, robes,
 * dual daggers, holy plate, dragon plate …), each with idle, walk,
 * run, attack, skill, hit and death poses plus equipment visuals
 * driven by the account's equipped gear (rarity trim, weapon type,
 * wings, shield, cape, helm).
 *
 * Creatures — ten original body plans (humanoid, beast, arachnid,
 * scorpion, bat, golem, treant, wraith, serpent, blob) with idle,
 * movement, attack, hit and death animation, palettes straight from
 * js/data-enemies.js, and boss extras (auras, crowns, horns).
 *
 * Everything is original geometry drawn through the painter; no
 * external models, textures or copyrighted assets are used.
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
  const mat4 = M.mat4;

  /* ============================================================
   * 1. HELPERS
   * ========================================================== */
  /**
   * Ground sampler. The world is a height field now, so every actor, shadow,
   * plate and ring is lifted onto the terrain instead of hovering over y = 0.
   * The facade attaches it once per world (see MytharaRender3D).
   */
  let groundSample = null;
  function setGround(fn) { groundSample = typeof fn === 'function' ? fn : null; }
  /** Ground height at a world position (0 when no world is attached). */
  function groundAt(x, z) { return groundSample ? groundSample(x, z) : 0; }

  const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };

  function account() {
    return root.MytharaAccount && root.MytharaAccount.Account && root.MytharaAccount.Account.isReady
      ? (root.MytharaAccount.Account.isReady() ? root.MytharaAccount.Account : null)
      : (root.MytharaAccount ? root.MytharaAccount.Account : null);
  }

  /**
   * Read the equipped gear once per frame: weapon type, rarity trim colour
   * and which cosmetic pieces are worn. Falls back to class defaults.
   */
  function equipment() {
    const out = { weaponType: null, rarity: 'common', trim: null, glow: null, wings: false, helm: false, best: 0 };
    const acc = account();
    const items = root.MYTHARA_ITEMS;
    if (!acc || !acc.profile || !items) return out;
    let profile = null;
    try { profile = acc.profile(); } catch (e) { profile = null; }
    if (!profile || !profile.equipment) return out;
    const equipped = profile.equipment;
    const inventory = profile.inventory || [];
    Object.keys(equipped).forEach(function (slot) {
      const uid = equipped[slot];
      if (!uid) return;
      const item = inventory.filter(function (i) { return i.uid === uid; })[0];
      if (!item) return;
      const rarity = item.rarity || 'common';
      const rank = RARITY_ORDER[rarity] || 0;
      if (rank >= out.best) {
        out.best = rank;
        out.rarity = rarity;
        const rarities = items.RARITIES && items.RARITIES[rarity];
        out.trim = rarities ? rarities.color : null;
        out.glow = rank >= 3 ? out.trim : null;
      }
      if (slot === 'weapon' && item.type) out.weaponType = item.type;
      if (slot === 'helmet') out.helm = true;
      if (slot === 'wings') out.wings = true;
    });
    return out;
  }

  function facingYaw(actor) {
    const f = actor.facing || { x: 0, y: 1 };
    return Math.atan2(f.x || 0, f.y === undefined ? 1 : f.y);
  }

  /** Animation progress helpers (engine keeps attackAnim 1 → 0). */
  function attackPhase(actor) {
    const a = clamp(actor.attackAnim || 0, 0, 1);
    return 1 - a;                                  // 0 = wind-up, 1 = recover
  }

  function stateOf(actor) {
    return (actor.anim && actor.anim.state) || 'idle';
  }

  function isDead(actor) {
    if (actor.alive === false) return true;
    const st = stateOf(actor);
    return st === 'death';
  }

  /** One-shot animation progress from the engine's Anim tracker. */
  function animProgress(actor) {
    return (actor.anim && actor.anim.progress) || 0;
  }

  function swingCurve(t) {
    // fast out, slow back — reads as a weapon arc rather than a linear push
    if (t < 0.32) return -0.5 * (t / 0.32);                     // wind-up (negative = back)
    if (t < 0.55) {
      const k = (t - 0.32) / 0.23;
      return lerp(-0.5, 1, k * k);
    }
    return lerp(1, 0, (t - 0.55) / 0.45);
  }

  /* body part: a box in local space, transformed by a matrix */
  function part(P, matrix, size, colours, opts) {
    const o = opts || {};
    S.box(P, {
      matrix: matrix,
      size: size,
      colours: colours,
      trim: o.trim,
      trimWidth: o.trimWidth,
      glow: o.glow,
      glowAlpha: o.glowAlpha,
      alpha: o.alpha,
      tint: o.tint,
      lit: o.lit,
      anchor: o.anchor
    });
  }

  function node(parentMatrix, t, r, s) {
    return mat4.multiply(parentMatrix, mat4.compose(t || v3(), r || v3(), s || v3(1, 1, 1)));
  }

  /* ============================================================
   * 2. HERO RIG
   * ========================================================== */
  function heroPose(actor, time) {
    const state = stateOf(actor);
    const walk = actor.walkPhase || 0;
    const moving = !!actor.moving;
    const running = !!actor.running;
    const attack = attackPhase(actor);
    const swing = state === 'attack' ? swingCurve(attack) : 0;
    const skillT = state === 'skill' || state === 'ultimate' ? animProgress(actor) : 0;
    const hurt = state === 'hurt' ? 1 - animProgress(actor) : 0;
    const dying = isDead(actor);
    const deadT = clamp((actor.deathTimer !== undefined ? (1 - actor.deathTimer / 0.9) : (dying ? 1 : 0)), 0, 1);

    const speed = running ? 12 : 8;
    const stride = moving ? Math.sin(walk * (running ? 1.5 : 1)) : 0;
    const stride2 = moving ? Math.cos(walk * (running ? 1.5 : 1)) : 0;
    const bob = moving ? Math.abs(Math.sin(walk * (running ? 1.5 : 1))) * (running ? 1.5 : 0.9)
      : Math.sin(time * 2.1 + (actor.bob || 0)) * 0.5;

    const pose = {
      root: { y: bob, rx: 0, rz: 0, ry: 0 },
      torso: { rx: 0.02 + (running ? 0.16 : 0), ry: 0, rz: 0 },
      head: { rx: 0, ry: 0, rz: 0 },
      chest: 1 + (moving ? 0.02 : Math.sin(time * 2.1) * 0.035),
      armL: { rx: -stride * 0.5, rz: 0.16, ry: 0 },
      armR: { rx: stride * 0.5, rz: -0.16, ry: 0 },
      foreL: { rx: -0.35 },
      foreR: { rx: -0.3 },
      legL: { rx: stride * (running ? 0.95 : 0.55), rz: 0 },
      legR: { rx: -stride * (running ? 0.95 : 0.55), rz: 0 },
      shinL: { rx: Math.max(0, -stride) * 0.7 },
      shinR: { rx: Math.max(0, stride) * 0.7 },
      cape: 0.16 + (running ? 0.5 : 0) + Math.sin(time * 3) * 0.06,
      weapon: { rx: 0.1, rz: 0.22, ry: 0, roll: 0.18 },
      shieldBlock: 0,
      glow: 0
    };

    // melee / ranged / cast flavoured attack poses
    if (state === 'attack') {
      const kind = actor.attackType;
      if (kind === 'ranged') {
        pose.armL.rx = -1.35 + swing * 0.6;
        pose.armR.rx = -1.1 - swing * 0.9;
        pose.armL.rz = 0.5;
        pose.armR.rz = -0.55;
        pose.torso.ry = 0.28 - swing * 0.15;
        pose.head.ry = 0.2;
        pose.weapon.rz = -swing * 0.2;
      } else if (kind === 'magic') {
        pose.armR.rx = -2.1 - swing * 0.5;
        pose.armR.rz = -0.35;
        pose.armL.rx = -0.6 - swing * 0.3;
        pose.torso.ry = -0.2 + swing * 0.3;
        pose.glow = clamp(swing * 1.6, 0, 1);
      } else {
        pose.armR.rx = -2.4 - swing * 1.5;         // swing the weapon through
        pose.armR.rz = -0.45 + swing * 0.85;
        pose.foreR.rx = -0.9 + swing * 0.7;
        pose.armL.rx = -0.4 - swing * 0.5;
        pose.armL.rz = 0.4;
        pose.torso.ry = -0.42 + swing * 0.95;
        pose.torso.rz = swing * 0.12;
        pose.head.ry = -0.18 + swing * 0.4;
        pose.weapon.rx = -0.35 + swing * 0.6;
        pose.weapon.roll = swing * 0.4;
        pose.shieldBlock = swing > 0.3 ? 1 : 0.4;
      }
    } else if (state === 'skill' || state === 'ultimate') {
      const big = state === 'ultimate';
      const spin = big ? clamp(skillT * 1.35, 0, 1) : 0;
      pose.root.ry = big ? spin * TAU * (actor.attackType === 'melee' ? 2 : 1) : 0;
      pose.armR.rx = -2.5 - skillT * 0.4;
      pose.armR.rz = -0.3;
      pose.armL.rx = -1.5 - skillT * 0.3;
      pose.armL.rz = 0.45;
      pose.torso.rx = -0.12;
      pose.head.rx = -0.18;
      pose.glow = clamp(skillT * 2.2, 0, 1);
      pose.cape = 0.5 + skillT * 0.8;
    } else if (state === 'hurt' || hurt > 0) {
      pose.torso.rx = -0.34 * hurt;
      pose.head.rx = -0.26 * hurt;
      pose.armL.rx = 0.5 * hurt;
      pose.armR.rx = 0.4 * hurt;
      pose.root.rz = 0.08 * hurt;
    }

    if (dying) {
      const t = isDead(actor) && actor.respawnTimer !== undefined ? deadT : deadT;
      pose.root.rx = -1.35 * clamp(t * 1.6, 0, 1);
      pose.root.y = -1.2 * clamp(t * 1.6, 0, 1);
      pose.torso.rx = 0.3 * clamp(t, 0, 1);
      pose.armL.rx = 0.6;
      pose.armR.rx = 0.5;
      pose.cape = 0.05;
      pose.dying = clamp(t, 0, 1);
    }

    // spell glow while a class aura is active (mage / priest / dragon knight)
    if (actor.attackType === 'magic' || (actor.look && actor.look.aura)) {
      pose.glow = Math.max(pose.glow, 0.25 + Math.sin(time * 2.4 + (actor.bob || 0)) * 0.08);
    }
    void speed; void stride2;
    return pose;
  }

  /** Weapon geometry per type. `m` is the hand matrix. */
  function drawWeapon(P, m, type, colours, opts) {
    const o = opts || {};
    const metal = colours.metal || '#c8ced8';
    const wood = colours.wood || '#5a4026';
    const accent = colours.accent || '#f2c14e';
    const glow = o.glow ? (o.glowColour || accent) : null;
    const glowAlpha = o.glow ? 0.3 + o.glow * 0.5 : 0;

    switch (type) {
      case 'bow': {
        part(P, node(m, v3(0, 0, 0.1), v3(0, 0, 0)), v3(0.5, 0.5, 0.5), { all: wood });
        for (let i = 0; i < 5; i++) {
          const t = (i / 4 - 0.5);
          part(P, node(m, v3(0, t * 3.4, 0.1 + Math.abs(t) * 0.5), v3(0, 0, t * 0.5)), v3(0.42, 0.9, 0.42), { all: Colour.mix(wood, '#8a6a3a', 1 - Math.abs(t)) });
        }
        part(P, node(m, v3(0, 0, 0.05), v3(0, 0, 0)), v3(0.06, 3.6, 0.06), { all: '#e8e4d0' });
        break;
      }
      case 'staff': {
        part(P, node(m, v3(0, -0.2, 0.6), v3(0.06, 0, 0)), v3(0.5, 9, 0.5), { all: wood });
        part(P, node(m, v3(0, 0, 0), v3(0, 0, 0)), v3(0.7, 0.7, 0.7), { all: metal });
        S.blob(P, {
          matrix: null, pos: mat4.transformPoint(m, v3(0, 4.6, 0.6)),
          radii: v3(1.1, 1.1, 1.1), slices: 6, rings: 3,
          color: glow ? Colour.mix(glow, '#ffffff', 0.25) : accent, glow: glow || accent, glowAlpha: glow ? glowAlpha : 0.25
        });
        break;
      }
      case 'daggers': case 'dual-blades': {
        const blade = colours.blade || metal;
        part(P, node(m, v3(0, 0.4, 0), v3(0, 0, 0)), v3(0.4, 2.6, 0.7), { all: blade, trim: o.trim });
        part(P, node(m, v3(0, -1, 0), v3(0, 0, 0)), v3(0.5, 1.2, 0.6), { all: '#2b2436' });
        part(P, node(m, v3(0, -1.9, 0), v3(0, 0, 0)), v3(0.4, 0.6, 0.5), { all: accent });
        break;
      }
      case 'greataxe': {
        part(P, node(m, v3(0, 0, 0.4), v3(0, 0, 0)), v3(0.6, 10, 0.6), { all: wood });
        part(P, node(m, v3(0.3, 3.6, 0.4), v3(0, 0, 0)), v3(3.4, 2.6, 0.5), { all: metal, trim: o.trim });
        part(P, node(m, v3(-0.3, 3.6, 0.4), v3(0, 0, 0)), v3(1.6, 2.2, 0.5), { all: Colour.shade(metal, -0.2) });
        break;
      }
      case 'club': case 'greatclub': {
        const big = type === 'greatclub';
        part(P, node(m, v3(0, 0, 0.3), v3(0, 0, 0)), v3(0.7, big ? 9 : 6, 0.7), { all: wood });
        S.blob(P, {
          matrix: null, pos: mat4.transformPoint(m, v3(0, big ? 4 : 2.6, 0.3)),
          radii: v3(big ? 2.6 : 1.8, big ? 2.2 : 1.5, big ? 2.6 : 1.8), slices: 6, rings: 3,
          color: '#6b4c2c', jitter: 0.2, seed: 4
        });
        break;
      }
      case 'dragon-greatsword': case 'greatsword': {
        const big = type === 'dragon-greatsword';
        part(P, node(m, v3(0, -1.2, 0), v3(0, 0, 0)), v3(0.55, 2.4, 0.55), { all: '#2a2430' });
        part(P, node(m, v3(0, 0.1, 0), v3(0, 0, 0)), v3(2.6, 0.6, 0.7), { all: accent, trim: o.trim });
        part(P, node(m, v3(0, big ? 5.2 : 3.8, 0), v3(0, 0, 0)), v3(big ? 2.0 : 1.4, big ? 8.6 : 6.4, 0.35), { all: colours.blade || metal, glow: big ? glow : null, glowAlpha: glowAlpha * 0.6 });
        part(P, node(m, v3(0, big ? 9.4 : 7, 0), v3(0, 0, 0)), v3(0.9, 1.4, 0.3), { all: Colour.shade(metal, 0.2) });
        if (big) {
          part(P, node(m, v3(1.3, 1.6, 0), v3(0, 0, -0.5)), v3(1.6, 1.2, 0.4), { all: accent });
          part(P, node(m, v3(-1.3, 1.6, 0), v3(0, 0, 0.5)), v3(1.6, 1.2, 0.4), { all: accent });
        }
        break;
      }
      default: {   // sword
        part(P, node(m, v3(0, -1, 0), v3(0, 0, 0)), v3(0.45, 1.6, 0.45), { all: '#2f2a38' });
        part(P, node(m, v3(0, 0, 0), v3(0, 0, 0)), v3(2.0, 0.45, 0.5), { all: accent, trim: o.trim });
        part(P, node(m, v3(0, 2.9, 0), v3(0, 0, 0)), v3(0.95, 5.6, 0.3), { all: colours.blade || metal, glow: glow, glowAlpha: glowAlpha * 0.5 });
        part(P, node(m, v3(0, 5.8, 0), v3(0, 0, 0)), v3(0.6, 0.9, 0.28), { all: Colour.shade(metal, 0.25) });
        break;
      }
    }
  }

  function drawShield(P, m, colours, block, trim) {
    const base = colours.shield || colours.primary;
    part(P, node(m, v3(0, 0.4, 0.10), v3(0, 0, block ? 0.5 : 0)), v3(0.5, 4.6, 5.4), { all: base, trim: trim || colours.trim });
    part(P, node(m, v3(0, 0.4, 0.42), v3(0, 0, 0)), v3(0.4, 1.1, 1.1), { all: colours.accent || '#f2c14e' });
    part(P, node(m, v3(0, 2.2, 0.42), v3(0, 0, 0)), v3(0.4, 0.7, 3.0), { all: colours.accent || '#f2c14e' });
  }

  function drawWings(P, root, colours, flap, glowColour) {
    [-1, 1].forEach(function (side) {
      const a = side * (0.5 + flap * 0.5);
      const m = node(root, v3(side * 1.6, 11, -1.4), v3(0, a, side * 0.25));
      part(P, m, v3(0.4, 4.4, 1.6), { all: colours.wing || colours.cloth });
      const m2 = node(m, v3(0, -3.4, -0.4), v3(0, a * 0.5, side * 0.3));
      part(P, m2, v3(0.3, 6.2, 1.2), { all: colours.wing || colours.secondary });
      if (glowColour) S.billboard(P, { pos: mat4.transformPoint(root, v3(side * 5, 9, -3)), width: 9, height: 9, color: glowColour, alpha: 0.12, soft: true });
    });
  }

  /**
   * Draw a hero (player or arena bot) at its world position.
   * opts: { time, hitFlash, equipment, target, ghost }
   */
  function drawHero(P, actor, opts) {
    const o = opts || {};
    const time = o.time || 0;
    const look = actor.look || {};
    const pose = heroPose(actor, time);
    const equip = o.equipment || equipment();
    const state = stateOf(actor);
    const dead = isDead(actor);
    // spawnPulse 0 means "already on the field" — the 2D renderer only fades
    // while it is > 0, so treating 0 as a fade value made monsters ghostly.
    const spawnPulse = actor.spawnPulse || 0;
    const spawnFade = spawnPulse > 0 && spawnPulse < 1 ? clamp(spawnPulse, 0.2, 1) : 1;

    const classScale = actor.kind === 'duelist' ? 1 : 1;
    const SCALE = 1.58 * classScale;                      // world units per rig unit (~34u tall hero)
    const root = node(
      mat4.compose(v3(actor.pos.x, groundAt(actor.pos.x, actor.pos.y) + 0.4 + pose.root.y * SCALE * 0.4, actor.pos.y), v3(pose.root.rx, facingYaw(actor) + pose.root.ry, pose.root.rz), v3(SCALE, SCALE, SCALE))
    );

    const colours = {
      primary: look.primary || '#3f5ecf',
      secondary: look.secondary || '#5c7ae8',
      cloth: look.cloth || '#2b3a7a',
      accent: look.accent || '#c9d4ea',
      metal: look.metal || '#b9c2d6',
      skin: look.skin || '#f2c79c',
      hair: look.hair || '#7a4a22',
      blade: Colour.mix(look.metal || '#c8ced8', '#ffffff', 0.25),
      trim: equip.trim || undefined,
      wing: Colour.mix(look.cloth || '#2b3a7a', '#ffffff', 0.2)
    };
    if (actor.kind === 'duelist' && look.primary) colours.primary = look.primary;

    const alpha = (dead ? 1 - clamp(pose.dying || 0, 0, 1) * 0.85 : 1) * spawnFade;
    const flash = clamp(actor.hitFlash || 0, 0, 1);
    const tint = flash > 0.02 ? Colour.mix('#ffffff', '#ff6a6a', flash * 0.6) : null;
    const glowColour = look.aura || equip.glow || null;
    const glowAmount = (pose.glow || 0) * 0.5 + (equip.glow ? 0.25 : 0);

    const body = {
      alpha: alpha,
      tint: tint,
      trim: equip.trim,
      trimWidth: 1
    };

    // --- legs ---
    const hips = node(root, v3(0, 8.6, 0), v3(0, 0, 0));
    [-1, 1].forEach(function (side) {
      const legPose = side < 0 ? pose.legL : pose.legR;
      const shinPose = side < 0 ? pose.shinL : pose.shinR;
      const leg = node(hips, v3(side * 1.5, -4.4, 0), v3(legPose.rx, 0, side * 0.05));
      part(P, leg, v3(2.1, 5.4, 2.1), { all: look.robe ? colours.cloth : Colour.shade(colours.primary, -0.25) }, body);
      const shin = node(leg, v3(0, -4.4, 0), v3(shinPose.rx, 0, 0));
      part(P, shin, v3(2.0, 5.0, 2.0), { all: colours.cloth }, body);
      part(P, node(shin, v3(0, -2.8, 0.6), v3(0, 0, 0)), v3(2.4, 1.5, 3.4), { all: Colour.shade(colours.cloth, -0.3) }, body);
    });

    // --- torso ---
    const torso = node(hips, v3(0, 4.6, 0), v3(pose.torso.rx, pose.torso.ry, pose.torso.rz));
    const chestScale = pose.chest;
    part(P, torso, v3(5.6, 7.6 * chestScale, 3.4), { front: colours.primary, back: Colour.shade(colours.primary, -0.15), side: colours.secondary, top: colours.secondary }, body);
    part(P, node(torso, v3(0, -4.2, 0), v3(0, 0, 0)), v3(6.0, 2.0, 3.6), { all: colours.cloth }, body);       // belt / tabard
    part(P, node(torso, v3(0, 3.9, 0.2), v3(0, 0, 0)), v3(4.4, 1.2, 3.0), { all: colours.accent || colours.secondary }, body); // gorget
    if (look.robe) {
      part(P, node(torso, v3(0, -4.6, 0), v3(0.12, 0, 0)), v3(6.4, 7.4, 4.0), { all: colours.cloth }, body);
      part(P, node(torso, v3(0, -8.2, 0), v3(0.2, 0, 0)), v3(7.4, 2.0, 4.6), { all: Colour.shade(colours.cloth, -0.2) }, body);
    }
    if (look.bareArms) {
      part(P, node(torso, v3(0, 3.2, -0.4), v3(0, 0, 0)), v3(7.2, 3.4, 3.8), { all: colours.skin }, body);   // muscled shoulders
    }

    // --- shoulders / pauldrons ---
    [-1, 1].forEach(function (side) {
      part(P, node(torso, v3(side * 3.2, 3.3, 0), v3(0, 0, side * 0.22)), v3(2.1, 1.7, 3.0), { all: colours.metal }, body);
      part(P, node(torso, v3(side * 3.3, 2.3, 0), v3(0, 0, side * 0.2)), v3(1.8, 1.1, 2.6), { all: Colour.shade(colours.metal, -0.28) }, body);
    });

    // --- head ---
    const headBase = node(torso, v3(0, 5.6, 0), v3(pose.head.rx, pose.head.ry, pose.head.rz));
    part(P, node(headBase, v3(0, 1.6, 0), v3(0, 0, 0)), v3(3.4, 3.6, 3.2), { all: colours.skin }, body);
    part(P, node(headBase, v3(0, 3.4, -0.2), v3(0, 0, 0)), v3(3.7, 1.2, 3.4), { all: colours.hair }, body);
    if (look.hood) {
      // hood shell sits behind the head, lighter than the robe so the shape reads
      part(P, node(headBase, v3(0, 2.4, -0.55), v3(0, 0, 0)), v3(4.4, 4.6, 3.6),
        { all: Colour.mix(colours.cloth, colours.accent || '#c9d4ea', 0.22) }, body);
      part(P, node(headBase, v3(0, 0.9, -0.9), v3(0, 0, 0)), v3(5.0, 3.4, 1.6), { all: colours.cloth }, body);
      // visible face in the hood opening + brow shadow
      part(P, node(headBase, v3(0, 1.5, 0.85), v3(0, 0, 0)), v3(2.5, 2.4, 1.0), { all: colours.skin }, body);
      part(P, node(headBase, v3(0, 3.0, 0.9), v3(0.22, 0, 0)), v3(2.7, 0.9, 1.2), { all: '#12101a' }, body);
    }
    if (look.helm || equip.helm) {
      part(P, node(headBase, v3(0, 2.2, 0), v3(0, 0, 0)), v3(3.9, 3.0, 3.7), { all: colours.metal }, body);
      part(P, node(headBase, v3(0, 0.9, 1.4), v3(0, 0, 0)), v3(3.0, 0.9, 1.0), { all: Colour.shade(colours.metal, -0.35) }, body);
      if (look.horns) {
        [-1, 1].forEach(function (side) {
          part(P, node(headBase, v3(side * 1.7, 3.6, 0), v3(0, 0, side * -0.6)), v3(0.8, 3.4, 0.8), { all: '#e0d6c0' }, body);
        });
      }
    } else if (!look.hood) {
      if (actor.classId === 'priest' || actor.classId === 'priest') part(P, node(headBase, v3(0, 3.2, 0), v3(0, 0, 0)), v3(1.0, 1.0, 1.0), { all: '#f2c14e' }, body);
    }

    // --- arms + weapon (right) ---
    const shoulderR = node(torso, v3(3.2, 2.6, 0), v3(pose.armR.rx, pose.armR.ry, pose.armR.rz));
    part(P, shoulderR, v3(2.0, 3.0, 2.0), { all: look.bareArms ? colours.skin : colours.secondary }, body);
    const foreR = node(shoulderR, v3(0, -3.6, 0), v3(pose.foreR.rx, 0, 0));
    part(P, foreR, v3(1.8, 3.2, 1.8), { all: look.bareArms ? colours.skin : Colour.shade(colours.secondary, -0.15) }, body);
    const handR = node(foreR, v3(0, -2.6, 0), v3(0.35 + pose.weapon.rx, pose.weapon.ry, pose.weapon.roll || 0));
    const weaponType = equip.weaponType || look.weapon || 'sword';
    drawWeapon(P, handR, weaponType, colours, { trim: equip.trim, glow: (pose.glow || 0) > 0.05, glowColour: look.aura || equip.glow });

    // --- left arm + shield / off-hand ---
    const shoulderL = node(torso, v3(-3.2, 2.6, 0), v3(pose.armL.rx, pose.armL.ry, pose.armL.rz));
    part(P, shoulderL, v3(2.0, 3.0, 2.0), { all: look.bareArms ? colours.skin : colours.secondary }, body);
    const foreL = node(shoulderL, v3(0, -3.6, 0), v3(pose.foreL.rx, 0, 0));
    part(P, foreL, v3(1.8, 3.2, 1.8), { all: look.bareArms ? colours.skin : Colour.shade(colours.secondary, -0.15) }, body);
    const handL = node(foreL, v3(0, -2.6, 0), v3(0, 0, 0));
    if (look.shield) drawShield(P, handL, colours, pose.shieldBlock, equip.trim);
    if (weaponType === 'daggers' || weaponType === 'dual-blades') {
      drawWeapon(P, handL, weaponType, colours, { trim: equip.trim, glow: (pose.glow || 0) > 0.05, glowColour: look.aura });
    }
    if (weaponType === 'staff' || weaponType === 'bow' || weaponType === 'greataxe' || weaponType === 'greatsword' || weaponType === 'dragon-greatsword' || weaponType === 'greatclub') {
      // two-handed grip: mirror the left hand onto the weapon
      const grip = node(foreL, v3(0, -1.4, 0.3), v3(0.2, 0, 0));
      part(P, grip, v3(1.4, 1.2, 1.4), { all: colours.skin }, body);
    }
    if (look.quiver) {
      part(P, node(torso, v3(-2.2, 1.6, -1.8), v3(0.25, 0, -0.5)), v3(1.6, 5.0, 1.6), { all: '#6b4c2c' }, body);
      for (let i = 0; i < 3; i++) {
        part(P, node(torso, v3(-2.6 + i * 0.5, 4.4, -1.9), v3(0.25, 0, -0.5)), v3(0.3, 2.2, 0.3), { all: '#d8d2c0' }, body);
      }
    }

    // --- cape / scarf ---
    if (look.cape) {
      const capeSwing = pose.cape;
      const capeMid = node(torso, v3(0, 2.2, -2.0), v3(capeSwing, 0, 0));
      part(P, capeMid, v3(4.0, 6.4, 0.4), { all: Colour.shade(colours.cloth, -0.14) }, body);
      const capeLow = node(capeMid, v3(0, -5.0, 0.2), v3(capeSwing * 0.8, 0, 0));
      part(P, capeLow, v3(4.6, 6.0, 0.35), { all: colours.cloth }, body);
    }
    if (look.scarf) {
      const scarf = node(torso, v3(0.6, 4.4, -0.6), v3(0.4 + Math.sin(time * 3.2) * 0.14, 0, 0.2));
      part(P, scarf, v3(3.0, 0.8, 1.4), { all: colours.accent }, body);
      part(P, node(scarf, v3(0.4, -2.6, -1.6), v3(0.3, 0, 0.2)), v3(1.2, 5.0, 0.4), { all: Colour.shade(colours.accent, -0.15) }, body);
    }
    if (look.wings || equip.wings) {
      drawWings(P, torso, colours, Math.sin(time * 2.2) * 0.5 + 0.5, equip.glow || look.aura);
    }

    // --- class aura + spell glow ---
    if (glowColour && glowAmount > 0.05) {
      const wp = mat4.transformPoint(torso, v3(0, 3, 0));
      S.billboard(P, { pos: wp, width: 16 + glowAmount * 12, height: 20 + glowAmount * 14, color: glowColour, alpha: 0.10 + glowAmount * 0.22, soft: true });
      const hand = mat4.transformPoint(handR, v3(0, 2.4, 0));
      S.billboard(P, { pos: hand, width: 7 + glowAmount * 9, height: 7 + glowAmount * 9, color: glowColour, alpha: 0.18 + glowAmount * 0.3, soft: true });
    }

    // --- ground shadow + target ring ---
    if (!dead) {
      P.sunShadow(actor.pos.x, actor.pos.y, 4.4 * 1.58 * (actor.radius ? actor.radius / 16 : 1), 14, 0.5);
    }
    if (o.target) {
      S.ring(P, { x: actor.pos.x, z: actor.pos.y, radius: 26, thickness: 2.4, color: o.targetColour || '#ff6a6a', alpha: 0.55, segments: 26 });
    }
    return alpha;
  }

  /* ============================================================
   * 3. CREATURE RIGS — ten original body plans
   * ========================================================== */
  function pal(monster) {
    const p = monster.palette || {};
    return {
      primary: p.primary || '#8a7a68',
      secondary: p.secondary || Colour.shade(p.primary || '#8a7a68', -0.25),
      dark: p.dark || Colour.shade(p.primary || '#8a7a68', -0.5),
      eye: p.eye || '#ffd76a',
      accent: p.accent || p.eye || '#f2c14e'
    };
  }

  function creatureAnimation(monster, time) {
    const state = stateOf(monster);
    const moving = state === 'walk' || state === 'run';
    const walk = (monster.walkPhase || time * 2);
    const attack = clamp(monster.attackAnim || 0, 0, 1);
    const lunge = state === 'attack' ? 1 - attack : 0;
    const hurt = state === 'hurt' ? 1 - animProgress(monster) : 0;
    const dead = isDead(monster);
    return {
      state: state,
      moving: moving,
      cycle: moving ? Math.sin(walk * (state === 'run' ? 9 : 6)) : Math.sin(time * 1.6 + (monster.bob || 0)) * 0.25,
      cycleOut: moving ? Math.cos(walk * (state === 'run' ? 9 : 6)) : Math.cos(time * 1.6 + (monster.bob || 0)) * 0.25,
      bob: moving ? Math.abs(Math.sin(walk * (state === 'run' ? 9 : 6))) * 0.9 : Math.sin(time * 1.9 + (monster.bob || 0)) * 0.4,
      lunge: lunge,
      telegraph: monster.telegraphMs ? clamp(1 - monster.telegraphMs / 900, 0, 1) : 0,
      hurt: hurt,
      dead: dead,
      death: dead ? clamp(monster.deathTimer !== undefined ? 1 - monster.deathTimer : 1, 0, 1) : 0,
      flap: Math.sin(time * (state === 'run' ? 9 : 5.5) + (monster.bob || 0))
    };
  }

  function drawHumanoid(P, monster, a, opts) {
    const c = pal(monster);
    const def = monster.def || {};
    const scale = (monster.scale || 1) * 1.6;
    const root = node(mat4.compose(
      groundAt(monster.pos.x, monster.pos.y) + 0.4 + a.bob * scale * 0.4,
      v3(0, facingYaw(monster), 0), v3(scale, scale, scale)
    ));
    const body = { alpha: opts.alpha, tint: opts.tint, trim: def.armored ? '#c9d2e0' : undefined };
    const swing = a.lunge;
    const walkSwing = a.cycle * (a.moving ? 0.7 : 0.12);

    // legs
    [-1, 1].forEach(function (side) {
      const leg = node(root, v3(side * 1.6, 6.0, 0), v3(walkSwing * (side < 0 ? 1 : -1), 0, 0));
      part(P, leg, v3(2.4, 6.4, 2.4), { all: c.dark }, body);
      part(P, node(leg, v3(0, -4.4, 0.4), v3(0, 0, 0)), v3(2.8, 2.0, 3.6), { all: Colour.shade(c.dark, -0.35) }, body);
    });
    // torso
    const torso = node(root, v3(0, 9.4, 0), v3(a.lunge * -0.18, 0, 0));
    part(P, torso, v3(5.4, 8.0, 3.6), { front: c.primary, back: c.secondary, side: c.secondary }, body);
    if (def.armored) part(P, node(torso, v3(0, 1.4, 0.4), v3(0, 0, 0)), v3(6.0, 3.4, 4.2), { all: c.secondary, trim: '#c9d2e0' }, body);
    part(P, node(torso, v3(0, -4.4, 0), v3(0, 0, 0)), v3(5.8, 2.0, 3.8), { all: c.dark }, body);
    // arms
    [-1, 1].forEach(function (side) {
      const armSwing = swing * (side > 0 ? -1.4 : 0.7) + walkSwing * (side > 0 ? -1 : 1);
      const shoulder = node(torso, v3(side * 3.4, 3.0, 0), v3(armSwing, 0, side * 0.2));
      part(P, shoulder, v3(2.2, 3.6, 2.2), { all: c.primary }, body);
      const fore = node(shoulder, v3(0, -4.2, 0), v3(-0.3 - Math.max(0, swing) * 0.6, 0, 0));
      part(P, fore, v3(2.0, 3.6, 2.0), { all: c.secondary }, body);
      if (side > 0 && def.weapon) {
        drawWeapon(P, node(fore, v3(0, -2.6, 0), v3(0.3, 0, 0)), def.weapon, c, { trim: '#c9d2e0', glow: a.telegraph > 0.3, glowColour: def.aura || c.accent });
      }
    });
    // head + horns + crown
    const head = node(torso, v3(0, 5.6, 0.2), v3(a.hurt * -0.3, 0, 0));
    part(P, head, v3(3.8, 3.8, 3.8), { all: c.primary }, body);
    part(P, node(head, v3(0, 0.4, 1.7), v3(0, 0, 0)), v3(2.2, 1.6, 1.2), { all: c.secondary }, body);
    [-1, 1].forEach(function (side) {
      part(P, node(head, v3(side * 1.0, 0.7, 1.9), v3(0, 0, 0)), v3(0.7, 0.7, 0.4), { all: c.eye, glow: c.eye, glowAlpha: 0.5 }, body);
    });
    if (def.horns) {
      [-1, 1].forEach(function (side) {
        part(P, node(head, v3(side * 1.8, 2.6, 0), v3(0, 0, side * -0.7)), v3(0.9, 3.6, 0.9), { all: '#e8dcc0' }, body);
      });
    }
    if (def.crown) {
      part(P, node(head, v3(0, 2.6, 0), v3(0, 0, 0)), v3(4.0, 1.0, 4.0), { all: c.accent, glow: c.accent, glowAlpha: 0.4 }, body);
      for (let i = 0; i < 4; i++) {
        part(P, node(head, v3(Math.cos(i * 1.57) * 1.4, 3.4, Math.sin(i * 1.57) * 1.4), v3(0, 0, 0)), v3(0.6, 1.6, 0.6), { all: c.accent }, body);
      }
    }
    void opts;
  }

  function drawBeast(P, monster, a, opts) {
    const c = pal(monster);
    const scale = (monster.scale || 1) * 1.55;
    const root = node(mat4.compose(
      groundAt(monster.pos.x, monster.pos.y) + 0.3 + a.bob * scale * 0.25,
      v3(0, facingYaw(monster), 0), v3(scale, scale, scale)
    ));
    const body = { alpha: opts.alpha, tint: opts.tint };
    const legPhase = a.cycle;
    // body + chest
    const torso = node(root, v3(0, 8.4, 0), v3(a.lunge * -0.12, 0, 0));
    part(P, torso, v3(4.6, 4.6, 10.5), { front: c.primary, back: c.secondary, side: c.secondary }, body);
    part(P, node(torso, v3(0, -0.4, 3.6), v3(0, 0, 0)), v3(4.8, 4.2, 4.0), { all: c.primary }, body);
    // four legs
    [[-1.7, 3.6], [1.7, 3.6], [-1.7, -3.4], [1.7, -3.4]].forEach(function (pos, index) {
      const phase = (index % 2 === 0 ? 1 : -1) * legPhase * (index < 2 ? 1 : -1);
      const leg = node(torso, v3(pos[0], -2.6, pos[1]), v3(phase * 0.75, 0, 0));
      part(P, leg, v3(1.5, 4.4, 1.5), { all: c.dark }, body);
      part(P, node(leg, v3(0, -2.6, 0.3), v3(Math.abs(phase) * 0.4, 0, 0)), v3(1.7, 3.2, 1.7), { all: Colour.shade(c.dark, -0.2) }, body);
    });
    // neck, head, snout, ears
    const neck = node(torso, v3(0, 2.4, 4.2), v3(-0.5 + a.lunge * 0.3, 0, 0));
    const head = node(neck, v3(0, 2.4, 1.4), v3(0.2, 0, 0));
    part(P, head, v3(3.4, 3.0, 3.8), { all: c.primary }, body);
    part(P, node(head, v3(0, -0.6, 2.4), v3(0.1, 0, 0)), v3(2.2, 1.8, 2.6), { all: Colour.shade(c.primary, -0.12) }, body);
    part(P, node(head, v3(0, -0.9, 3.6), v3(0, 0, 0)), v3(1.0, 0.9, 0.8), { all: c.dark }, body);
    [-1, 1].forEach(function (side) {
      part(P, node(head, v3(side * 1.5, 1.3, 0), v3(0, 0, side * -0.4)), v3(1.0, 1.8, 0.7), { all: c.secondary }, body);
      part(P, node(head, v3(side * 1.0, 0.5, 1.9), v3(0, 0, 0)), v3(0.7, 0.7, 0.4), { all: c.eye, glow: c.eye, glowAlpha: 0.55 }, body);
      // fangs while lunging
      if (a.lunge > 0.3) {
        part(P, node(head, v3(side * 0.6, -1.3, 2.6), v3(0, 0, 0)), v3(0.4, 1.0, 0.4), { all: '#f4f0e2' }, body);
      }
    });
    // tail
    const tail = node(torso, v3(0, 0.6, -5.2), v3(-0.3 + a.cycle * 0.12, a.cycle * 0.25, 0));
    part(P, tail, v3(1.3, 1.3, 4.0), { all: c.dark }, body);
    part(P, node(tail, v3(0, -0.6, -3.2), v3(0.3, 0, 0)), v3(1.0, 1.0, 3.4), { all: Colour.shade(c.dark, -0.15) }, body);
  }

  function drawArachnid(P, monster, a, opts) {
    const c = pal(monster);
    const scale = (monster.scale || 1) * 1.5;
    const root = node(mat4.compose(groundAt(monster.pos.x, monster.pos.y) + 0.3 + a.bob * 0.3, v3(0, facingYaw(monster), 0), v3(scale, scale, scale)));
    const body = { alpha: opts.alpha, tint: opts.tint };
    const abdomen = node(root, v3(0, 4.4, -3.2), v3(a.lunge * -0.1, 0, 0));
    S.blob(P, { matrix: null, pos: mat4.transformPoint(abdomen, v3(0, 0, 0)), radii: v3(4.4, 3.6, 5.0), slices: 6, rings: 3, color: c.dark, jitter: 0.12, seed: 3 });
    const head = node(root, v3(0, 4.2, 3.0), v3(a.lunge * -0.12, 0, 0));
    S.blob(P, { matrix: null, pos: mat4.transformPoint(head, v3(0, 0, 0)), radii: v3(3.2, 2.6, 3.4), slices: 6, rings: 3, color: c.primary, jitter: 0.1, seed: 5 });
    [-1, 1].forEach(function (side) {
      part(P, node(head, v3(side * 1.1, 1.0, 2.0), v3(0, 0, 0)), v3(0.8, 0.8, 0.5), { all: c.eye, glow: c.eye, glowAlpha: 0.6 }, body);
    });
    // eight legs
    for (let i = 0; i < 4; i++) {
      [-1, 1].forEach(function (side) {
        const phase = a.cycle * (i % 2 === 0 ? 1 : -1) * 0.9;
        const base = node(root, v3(side * 2.4, 4.0, 2.4 - i * 2.1), v3(Math.sin(phase) * 0.5, side * (0.6 + i * 0.1), side * 0.5));
        part(P, base, v3(1.0, 1.0, 5.2), { all: c.dark }, body);
        const knee = node(base, v3(0, 0, 4.6), v3(-1.15 - Math.sin(phase) * 0.2, 0, 0));
        part(P, knee, v3(0.9, 4.6, 0.9), { all: Colour.shade(c.dark, -0.15) }, body);
      });
    }
    void opts;
  }

  function drawScorpion(P, monster, a, opts) {
    const c = pal(monster);
    const scale = (monster.scale || 1) * 1.5;
    const root = node(mat4.compose(groundAt(monster.pos.x, monster.pos.y) + 0.3 + a.bob * 0.3, v3(0, facingYaw(monster), 0), v3(scale, scale, scale)));
    const body = { alpha: opts.alpha, tint: opts.tint };
    const torso = node(root, v3(0, 4.0, 0), v3(a.lunge * -0.12, 0, 0));
    S.blob(P, { matrix: null, pos: mat4.transformPoint(torso, v3(0, 0, -1.4)), radii: v3(4.0, 2.8, 5.4), slices: 6, rings: 3, color: c.primary, jitter: 0.12, seed: 7 });
    // tail curling over the back
    let nodeM = node(torso, v3(0, 0.6, -5.0), v3(-0.5, 0, 0));
    for (let i = 0; i < 5; i++) {
      part(P, nodeM, v3(1.8 - i * 0.15, 1.8 - i * 0.15, 2.2), { all: c.secondary }, body);
      const next = node(nodeM, v3(0, 1.0 + i * 0.25, -1.6), v3(-0.55 + Math.sin(a.cycle * 0.3) * 0.1, 0, 0));
      nodeM = next;
    }
    part(P, node(nodeM, v3(0, 0.8, 0), v3(0, 0, 0)), v3(1.3, 2.6, 1.3), { all: c.accent, glow: c.eye, glowAlpha: 0.6 }, body);
    // claws
    [-1, 1].forEach(function (side) {
      const arm = node(torso, v3(side * 3.4, 0.4, 3.6), v3(0, 0, side * -0.4));
      part(P, arm, v3(1.3, 1.3, 3.4), { all: c.dark }, body);
      const claw = node(arm, v3(0, 0, 3.2), v3(0, 0, 0));
      part(P, claw, v3(2.0, 1.6, 2.4), { all: c.secondary }, body);
      part(P, node(claw, v3(side * 0.6, 0.8, 1.6), v3(0, 0, side * -0.3)), v3(0.7, 0.7, 1.8), { all: c.accent }, body);
    });
    [-1, 1].forEach(function (side) {
      part(P, node(torso, v3(side * 1.0, 1.6, 3.0), v3(0, 0, 0)), v3(0.7, 0.7, 0.4), { all: c.eye, glow: c.eye, glowAlpha: 0.6 }, body);
    });
  }

  function drawBat(P, monster, a, opts) {
    const c = pal(monster);
    const scale = (monster.scale || 1) * 1.42;
    const hover = groundAt(monster.pos.x, monster.pos.y) + 16 + Math.sin(a.cycle * 0.8) * 2.4;
    const root = node(mat4.compose(v3(monster.pos.x, hover, monster.pos.y), v3(0, facingYaw(monster), 0), v3(scale, scale, scale)));
    const body = { alpha: opts.alpha, tint: opts.tint };
    const torso = node(root, v3(0, 0, a.lunge * 1.2), v3(a.lunge * -0.2, 0, 0));
    S.blob(P, { matrix: null, pos: mat4.transformPoint(torso, v3(0, 0, 0)), radii: v3(1.8, 2.2, 2.6), slices: 6, rings: 3, color: c.primary, jitter: 0.1, seed: 2 });
    part(P, node(torso, v3(0, 1.6, 1.6), v3(0, 0, 0)), v3(2.4, 2.0, 2.2), { all: c.dark }, body);
    [-1, 1].forEach(function (side) {
      part(P, node(torso, v3(side * 0.8, 1.8, 2.4), v3(0, 0, 0)), v3(0.6, 0.6, 0.4), { all: c.eye, glow: c.eye, glowAlpha: 0.7 }, body);
      // wings
      const flap = a.flap * 0.6 + (a.moving ? 0.35 : 0);
      const wing = node(torso, v3(side * 1.6, 1.0, 0), v3(0, side * 0.4, side * (0.5 + flap)));
      part(P, wing, v3(0.4, 3.2, 4.6), { all: c.secondary }, body);
      const wing2 = node(wing, v3(0, -1.2, -2.6), v3(0, side * 0.3, side * 0.5));
      part(P, wing2, v3(0.3, 2.2, 4.0), { all: c.dark }, body);
    });
    void opts;
  }

  function drawGolem(P, monster, a, opts) {
    const c = pal(monster);
    const scale = (monster.scale || 1) * 1.62;
    const root = node(mat4.compose(groundAt(monster.pos.x, monster.pos.y) + 0.4 + a.bob * 0.3, v3(0, facingYaw(monster), 0), v3(scale, scale, scale)));
    const body = { alpha: opts.alpha, tint: opts.tint, trim: '#9aa0ae' };
    const torso = node(root, v3(0, 10.0, 0), v3(a.lunge * -0.14, 0, 0));
    part(P, torso, v3(7.4, 8.4, 5.4), { front: c.primary, back: c.dark, side: c.secondary, top: Colour.shade(c.primary, 0.12) }, body);
    part(P, node(torso, v3(0, 0.4, 2.1), v3(0, 0, 0)), v3(3.4, 3.4, 1.4), { all: Colour.shade(c.secondary, -0.1) }, body);
    S.billboard(P, { pos: mat4.transformPoint(torso, v3(0, 0.4, 2.6)), width: 5.4, height: 5.4, color: c.eye, alpha: 0.5, soft: true });
    // arms (huge fists)
    [-1, 1].forEach(function (side) {
      const armSwing = a.lunge * (side > 0 ? -1.5 : 0.5) + a.cycle * (a.moving ? 0.4 : 0.1) * (side > 0 ? 1 : -1);
      const shoulder = node(torso, v3(side * 5.0, 2.8, 0), v3(armSwing, 0, side * 0.15));
      part(P, shoulder, v3(3.4, 4.6, 3.4), { all: c.secondary }, body);
      const fore = node(shoulder, v3(0, -4.6, 0), v3(-0.25, 0, 0));
      part(P, fore, v3(3.0, 4.6, 3.0), { all: c.primary }, body);
      S.blob(P, { matrix: null, pos: mat4.transformPoint(fore, v3(0, -3.2, 0)), radii: v3(2.4, 2.4, 2.4), slices: 5, rings: 2, color: c.dark, jitter: 0.2, seed: side + 3 });
    });
    // legs + head
    [-1, 1].forEach(function (side) {
      const leg = node(torso, v3(side * 2.4, -4.6, 0), v3(a.cycle * (a.moving ? 0.5 : 0.05) * (side < 0 ? 1 : -1), 0, 0));
      part(P, leg, v3(3.0, 5.4, 3.2), { all: c.dark }, body);
      part(P, node(leg, v3(0, -3.6, 0.6), v3(0, 0, 0)), v3(3.6, 2.2, 4.4), { all: Colour.shade(c.dark, -0.2) }, body);
    });
    const head = node(torso, v3(0, 5.6, 0.3), v3(a.hurt * -0.2, 0, 0));
    part(P, head, v3(4.0, 3.2, 3.8), { all: c.secondary }, body);
    [-1, 1].forEach(function (side) {
      part(P, node(head, v3(side * 1.0, 0.2, 1.9), v3(0, 0, 0)), v3(0.9, 0.9, 0.5), { all: c.eye, glow: c.eye, glowAlpha: 0.7 }, body);
    });
    if (monster.def && monster.def.crown) {
      part(P, node(head, v3(0, 2.2, 0), v3(0, 0, 0)), v3(4.4, 1.0, 4.4), { all: c.accent, glow: c.accent, glowAlpha: 0.4 }, body);
    }
  }

  function drawTreant(P, monster, a, opts) {
    const c = pal(monster);
    const scale = (monster.scale || 1) * 1.9;
    const root = node(mat4.compose(groundAt(monster.pos.x, monster.pos.y) + 0.4 + a.bob * 0.25, v3(0, facingYaw(monster), 0), v3(scale, scale, scale)));
    const body = { alpha: opts.alpha, tint: opts.tint };
    const trunk = node(root, v3(0, 9.0, 0), v3(a.lunge * -0.16, 0, 0));
    part(P, trunk, v3(5.0, 12.0, 4.6), { front: '#6b4c2c', back: '#54391f', side: '#5f4224' }, body);
    // root legs
    [-1, 1].forEach(function (side) {
      part(P, node(trunk, v3(side * 1.8, -6.0, 0.2), v3(a.cycle * (a.moving ? 0.35 : 0.05) * (side < 0 ? 1 : -1), 0, side * 0.1)), v3(2.2, 4.0, 2.4), { all: '#54391f' }, body);
    });
    // branch arms with a leafy fist
    [-1, 1].forEach(function (side) {
      const armSwing = a.lunge * (side > 0 ? -1.3 : 0.4) + Math.sin((monster.walkPhase || 0) * 3 + side) * 0.08;
      const arm = node(trunk, v3(side * 3.2, 3.6, 0), v3(armSwing, 0, side * -0.35));
      part(P, arm, v3(1.8, 7.0, 1.8), { all: '#5f4224' }, body);
      const branch = node(arm, v3(0, -4.4, 0), v3(0.4, 0, side * 0.3));
      part(P, branch, v3(1.3, 4.4, 1.3), { all: '#54391f' }, body);
      S.blob(P, { matrix: null, pos: mat4.transformPoint(branch, v3(0, -2.6, 0)), radii: v3(2.2, 2.0, 2.2), slices: 5, rings: 2, color: c.primary, jitter: 0.25, seed: side + 6 });
    });
    // head + crown of leaves
    const head = node(trunk, v3(0, 7.0, 0.4), v3(a.hurt * -0.2, 0, 0));
    part(P, head, v3(4.4, 3.6, 4.0), { all: '#6b4c2c' }, body);
    [-1, 1].forEach(function (side) {
      part(P, node(head, v3(side * 1.1, 0.2, 2.0), v3(0, 0, 0)), v3(0.9, 0.9, 0.5), { all: c.eye, glow: c.eye, glowAlpha: 0.6 }, body);
    });
    for (let i = 0; i < 3; i++) {
      S.blob(P, {
        matrix: null, pos: mat4.transformPoint(head, v3((i - 1) * 2.6, 3.4 + (i % 2) * 1.4, (i % 2 ? 1.4 : -1.2))),
        radii: v3(3.2, 2.6, 3.2), slices: 5, rings: 2, color: Colour.mix(c.primary, '#5fa348', i * 0.3), jitter: 0.28, seed: 11 + i
      });
    }
  }

  function drawWraith(P, monster, a, opts) {
    const c = pal(monster);
    const scale = (monster.scale || 1) * 1.62;
    const hover = groundAt(monster.pos.x, monster.pos.y) + 8 + Math.sin(a.cycle * 0.6) * 2.6 + (monster.def && monster.def.aura ? 2 : 0);
    const root = node(mat4.compose(v3(monster.pos.x, hover, monster.pos.y), v3(0, facingYaw(monster), 0), v3(scale, scale, scale)));
    const body = { alpha: opts.alpha * 0.94, tint: opts.tint };
    const torso = node(root, v3(0, 9.0, 0), v3(a.lunge * -0.2, 0, 0));
    // cloak: stacked tapered segments
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const sway = Math.sin(a.cycle * 0.7 + i) * 0.12 * (1 + t);
      part(P, node(torso, v3(sway, -2.2 - i * 2.0, -0.4 * t), v3(0, 0, sway * 0.2)), v3((5.8 - i * 0.9), 2.6, (3.6 - i * 0.5)), { all: Colour.mix(c.dark, c.primary, t * 0.4) }, body);
    }
    part(P, node(torso, v3(0, 1.0, 0), v3(0, 0, 0)), v3(5.2, 5.6, 3.4), { front: c.primary, back: c.secondary, side: c.secondary }, body);
    // hood + glowing eyes
    const head = node(torso, v3(0, 4.4, 0.3), v3(a.hurt * -0.25, 0, 0));
    part(P, head, v3(4.0, 4.4, 4.0), { all: c.dark }, body);
    part(P, node(head, v3(0, -0.2, 1.6), v3(0, 0, 0)), v3(2.6, 1.6, 1.2), { all: '#07070c' }, body);
    [-1, 1].forEach(function (side) {
      S.billboard(P, { pos: mat4.transformPoint(head, v3(side * 0.8, -0.2, 2.2)), width: 1.6, height: 1.6, color: c.eye, alpha: 0.9, soft: true });
    });
    // arms + claws
    [-1, 1].forEach(function (side) {
      const armSwing = a.lunge * (side > 0 ? -1.6 : 0.6);
      const arm = node(torso, v3(side * 3.0, 2.6, 0), v3(armSwing, 0, side * -0.4));
      part(P, arm, v3(1.6, 5.2, 1.6), { all: c.secondary }, body);
      const claw = node(arm, v3(0, -3.4, 0), v3(0.3, 0, 0));
      for (let i = 0; i < 3; i++) {
        part(P, node(claw, v3((i - 1) * 0.5, -1.4, 0.2), v3(0.2, 0, (i - 1) * 0.3)), v3(0.4, 2.2, 0.4), { all: '#e8e2d0' }, body);
      }
    });
    S.billboard(P, { pos: mat4.transformPoint(torso, v3(0, 0, 0)), width: 16, height: 20, color: monster.def && monster.def.aura ? monster.def.aura : c.eye, alpha: 0.1, soft: true });
  }

  function drawSerpent(P, monster, a, opts) {
    const c = pal(monster);
    const scale = (monster.scale || 1) * 1.9;
    const flying = a.moving || (monster.def && monster.def.flags && monster.def.flags.indexOf('flying') >= 0);
    const lift = groundAt(monster.pos.x, monster.pos.y) + (flying ? 12 + a.bob * 2 : 4);
    const root = node(mat4.compose(v3(monster.pos.x, lift, monster.pos.y), v3(0, facingYaw(monster), 0), v3(scale, scale, scale)));
    const body = { alpha: opts.alpha, tint: opts.tint };
    // tail + segmented spine, undulating
    let m = node(root, v3(0, 2.0, -12.0), v3(-0.1, 0, 0));
    const segments = 7;
    for (let i = 0; i < segments; i++) {
      const t = i / (segments - 1);
      const sway = Math.sin((monster.walkPhase || 0) * 2 + i * 0.7 + (a.lunge * 1.5)) * 1.4;
      const size = 3.4 - t * 1.4;
      part(P, node(m, v3(sway, t * 4.2, 2.6), v3(0, sway * 0.1, 0)), v3(size, size * 0.9, 3.2), { all: Colour.mix(c.dark, c.primary, t) }, body);
      m = node(m, v3(sway * 0.4, t * 4.2, 2.6), v3(0, 0, 0));
    }
    // chest + neck + head
    const chest = node(root, v3(0, 5.4, 3.0), v3(0.1, 0, 0));
    part(P, chest, v3(5.0, 4.8, 6.0), { front: c.primary, back: c.secondary, side: c.secondary }, body);
    const neck = node(chest, v3(0, 2.6, 4.0), v3(-0.5, 0, 0));
    part(P, neck, v3(3.2, 3.2, 5.0), { all: c.primary }, body);
    const head = node(neck, v3(0, 2.0, 3.0), v3(0.25, 0, 0));
    part(P, head, v3(3.4, 3.0, 4.4), { all: c.primary }, body);
    part(P, node(head, v3(0, -0.4, 2.8), v3(0, 0, 0)), v3(2.4, 2.0, 2.6), { all: Colour.shade(c.primary, -0.1) }, body);
    [-1, 1].forEach(function (side) {
      part(P, node(head, v3(side * 1.0, 0.8, 1.6), v3(0, 0, 0)), v3(0.8, 0.8, 0.5), { all: c.eye, glow: c.eye, glowAlpha: 0.65 }, body);
      if (a.lunge > 0.25) part(P, node(head, v3(side * 0.7, -1.0, 3.4), v3(0.2, 0, 0)), v3(0.5, 1.6, 0.5), { all: '#f0e8d0' }, body);
    });
    if (monster.def && monster.def.horns) {
      [-1, 1].forEach(function (side) {
        part(P, node(head, v3(side * 1.6, 1.6, -0.2), v3(0, 0, side * -0.6)), v3(0.9, 4.0, 0.9), { all: '#d8cba8' }, body);
      });
    }
    // wings
    const flap = a.flap * 0.7 + (a.moving ? 0.4 : 0.1);
    [-1, 1].forEach(function (side) {
      const wing = node(chest, v3(side * 2.6, 2.6, -0.6), v3(0, side * 0.5, side * (0.6 + flap)));
      part(P, wing, v3(0.5, 5.0, 7.0), { all: c.secondary }, body);
      const wing2 = node(wing, v3(0, -1.6, -4.6), v3(0, side * 0.4, side * 0.55));
      part(P, wing2, v3(0.4, 3.6, 6.0), { all: c.dark }, body);
    });
  }

  function drawBlob(P, monster, a, opts) {
    const c = pal(monster);
    const scale = (monster.scale || 1) * 1.9;
    const squash = 1 + Math.sin((monster.walkPhase || 0) * 6 + 1) * 0.12 + a.lunge * 0.18;
    const root = node(mat4.compose(groundAt(monster.pos.x, monster.pos.y) + 0.2 + a.bob * 0.3, v3(0, facingYaw(monster), 0), v3(scale, scale * squash, scale)));
    const body = { alpha: opts.alpha * 0.92, tint: opts.tint };
    S.blob(P, {
      matrix: null, pos: mat4.transformPoint(root, v3(0, 4.2, 0)),
      radii: v3(5.2, 4.4, 5.2), slices: 7, rings: 3, color: c.primary, jitter: 0.12, seed: monster.i || 2
    });
    S.blob(P, {
      matrix: null, pos: mat4.transformPoint(root, v3(0, 2.6, 0)),
      radii: v3(3.0, 2.6, 3.0), slices: 6, rings: 3, color: c.secondary, alpha: 0.5
    });
    [-1, 1].forEach(function (side) {
      S.billboard(P, { pos: mat4.transformPoint(root, v3(side * 1.4, 5.2, 2.6)), width: 1.5, height: 1.5, color: c.eye, alpha: 0.95, soft: true });
    });
    part(P, node(root, v3(0, -0.2, 0), v3(0, 0, 0)), v3(9.0, 0.6, 9.0), { all: c.dark }, body);
    void opts;
  }

  function drawElemental(P, monster, a, opts) {
    const c = pal(monster);
    const scale = (monster.scale || 1) * 1.55;
    const hover = groundAt(monster.pos.x, monster.pos.y) + 12 + a.bob * 2.4;
    const root = node(mat4.compose(v3(monster.pos.x, hover, monster.pos.y), v3(0, facingYaw(monster), 0), v3(scale, scale, scale)));
    const body = { alpha: opts.alpha, tint: opts.tint };
    S.blob(P, { matrix: null, pos: mat4.transformPoint(root, v3(0, 5, 0)), radii: v3(4.0, 4.6, 4.0), slices: 7, rings: 4, color: c.primary, jitter: 0.2, seed: 4, glow: c.eye, glowAlpha: 0.3 });
    // orbiting shards
    for (let i = 0; i < 5; i++) {
      const ang = (monster.walkPhase || 0) * 1.6 + i * (TAU / 5);
      const shard = mat4.transformPoint(root, v3(Math.cos(ang) * 6.4, 4.6 + Math.sin(ang * 2) * 1.6, Math.sin(ang) * 6.4));
      S.billboard(P, { pos: shard, width: 2.6, height: 2.6, color: c.eye, alpha: 0.75, soft: true });
      S.box(P, { matrix: null, pos: shard, size: v3(1.2, 1.2, 1.2), colours: { all: c.accent }, rot: v3(ang, ang * 0.6, 0), glow: c.eye, glowAlpha: 0.4 });
    }
    [-1, 1].forEach(function (side) {
      S.billboard(P, { pos: mat4.transformPoint(root, v3(side * 1.4, 6.4, 3.2)), width: 1.5, height: 1.5, color: c.eye, alpha: 0.95, soft: true });
    });
    S.billboard(P, { pos: mat4.transformPoint(root, v3(0, 5, 0)), width: 20, height: 20, color: c.eye, alpha: 0.18, soft: true });
    void body;
  }

  /* ============================================================
   * 4. DISPATCH
   * ========================================================== */
  function drawActor(P, actor, opts) {
    P.tag && P.tag('actors');
    const o = opts || {};
    const time = o.time || 0;
    if (actor.kind === 'monster' || actor.kind === 'duelist') {
      const a = creatureAnimation(actor, time);
      const spawnPulse = actor.spawnPulse || 0;
      const fade = spawnPulse > 0 && spawnPulse < 1 ? clamp(spawnPulse, 0.2, 1) : 1;
      const alpha = (a.dead ? clamp(1 - a.death * 0.9, 0.1, 1) : 1) * fade;
      const flash = clamp(actor.hitFlash || 0, 0, 1);
      const tint = flash > 0.02 ? Colour.mix('#ffffff', '#ff5f5f', flash * 0.7) : null;
      const body = o.body || actor.body || 'humanoid';

      if (actor.kind === 'duelist') {
        // arena bot: a hero rig wearing an enemy tint
        drawHero(P, {
          kind: 'duelist',
          classId: actor.classId,
          look: actor.look,
          pos: actor.pos,
          facing: actor.facing,
          walkPhase: actor.walkPhase,
          moving: a.moving,
          running: a.state === 'run',
          anim: actor.anim,
          attackAnim: actor.attackAnim,
          attackType: actor.attackType,
          hitFlash: actor.hitFlash,
          radius: actor.radius,
          deathTimer: actor.deathTimer,
          spawnPulse: actor.spawnPulse,
          bob: actor.bob
        }, { time: time, equipment: {}, target: o.target, targetColour: '#8fe3ff' });
        return;
      }

      P.sunShadow(actor.pos.x, actor.pos.y, 4.2 * (actor.scale || 1) * 1.8, 14 * (actor.scale || 1), 0.5);
      const tintOpts = { alpha: alpha, tint: tint };
      switch (body) {
        case 'beast': drawBeast(P, actor, a, tintOpts); break;
        case 'arachnid': drawArachnid(P, actor, a, tintOpts); break;
        case 'scorpion': drawScorpion(P, actor, a, tintOpts); break;
        case 'bat': drawBat(P, actor, a, tintOpts); break;
        case 'golem': drawGolem(P, actor, a, tintOpts); break;
        case 'treant': drawTreant(P, actor, a, tintOpts); break;
        case 'wraith': drawWraith(P, actor, a, tintOpts); break;
        case 'serpent': drawSerpent(P, actor, a, tintOpts); break;
        case 'blob': drawBlob(P, actor, a, tintOpts); break;
        case 'elemental': drawElemental(P, actor, a, tintOpts); break;
        default: drawHumanoid(P, actor, a, tintOpts); break;
      }

      // boss aura + telegraph marker
      const def = actor.def || {};
      if (def.aura) {
        S.billboard(P, { pos: v3(actor.pos.x, 8 * (actor.scale || 1), actor.pos.y), width: 30 * (actor.scale || 1), height: 30 * (actor.scale || 1), color: def.aura, alpha: 0.12, soft: true });
      }
      if (!a.dead && o.target) {
        S.ring(P, { x: actor.pos.x, z: actor.pos.y, radius: actor.radius + 12, thickness: 2.2, color: '#ff6a6a', alpha: 0.5, segments: 26 });
      }
      return;
    }
    return drawHero(P, actor, o);
  }

  /* ============================================================
   * 5. OVERLAYS — health bars, name tags, lock-on
   * ========================================================== */
  function drawOverlays(P, state, opts) {
    P.tag && P.tag('labels');
    const o = opts || {};
    const eye = P.cam.state ? P.cam.state.eye : P.cam.eye;
    // nearest enemies first so the closest plate always wins the space
    const monsters = (state.monsters || []).filter(function (m) { return m.alive; })
      .slice()
      .sort(function (a, b) { return ((a.pos.x - eye.x) * (a.pos.x - eye.x) + (a.pos.y - eye.z) * (a.pos.y - eye.z)) - ((b.pos.x - eye.x) * (b.pos.x - eye.x) + (b.pos.y - eye.z) * (b.pos.y - eye.z)); });
    const placed = [];        // screen-space claims, so plates never stack up
    monsters.forEach(function (m) {
      const height = 26 + (m.scale || 1) * 18;
      const pos = v3(m.pos.x, height, m.pos.y);
      const s = P.cam.project(pos, P.vp);
      if (!s.visible) return;
      const w = clamp(46 * (m.scale || 1) * clamp(s.scale / 0.6, 0.5, 1.6), 26, 190);
      const ratio = clamp(m.hp / m.maxHp, 0, 1);
      // the name above the bar is usually wider than the bar itself, so claim
      // the widest of the two — otherwise two labels overlap into a blur
      const nameText = (m.isBoss ? '' : 'Lv.' + m.level + ' ') + (m.name || '');
      const textW = nameText.length * (m.isBoss ? 8.6 : 7.0);
      const claimW = Math.max(w, textW);
      const crowded = placed.some(function (p) {
        return !m.isBoss && !p.boss && Math.abs(p.x - s.x) < (claimW + p.w) * 0.5 && Math.abs(p.y - s.y) < 30;
      });
      if (crowded) return;
      placed.push({ x: s.x, y: s.y, w: claimW, boss: !!m.isBoss });
      const c = P.ctx;
      c.save();
      // bar frame
      c.fillStyle = 'rgba(8,9,16,0.72)';
      c.fillRect(s.x - w / 2 - 1.5, s.y - 7, w + 3, 7.5);
      c.fillStyle = m.isBoss ? '#c8342c' : m.tier === 'elite' ? '#e08a2c' : '#d24b3f';
      c.fillRect(s.x - w / 2, s.y - 6, w * ratio, 5.5);
      c.fillStyle = 'rgba(255,255,255,0.22)';
      c.fillRect(s.x - w / 2, s.y - 6, w * ratio, 2);
      c.strokeStyle = m.isBoss ? 'rgba(242,193,78,0.9)' : 'rgba(0,0,0,0.6)';
      c.lineWidth = m.isBoss ? 1.4 : 1;
      c.strokeRect(s.x - w / 2 - 1.5, s.y - 7, w + 3, 7.5);
      c.restore();
      // name + level (bosses and the locked target only, to avoid clutter)
      if (m.isBoss || o.target === m || (o.showAllNames && s.depth < 420)) {
        P.label(v3(m.pos.x, height + 9, m.pos.y), (m.isBoss ? '' : 'Lv.' + m.level + ' ') + m.name, {
          color: m.isBoss ? '#ffd76a' : '#f0e9dc', size: m.isBoss ? 15 : 12, weight: m.isBoss ? '800' : '600'
        });
      }
      // status chips
      if (m.status && (m.status.burn || m.status.poison || m.status.freezeMs > 0 || m.status.stunMs > 0 || m.status.slow)) {
        const icons = [];
        if (m.status.burn) icons.push('🔥');
        if (m.status.poison) icons.push('☠');
        if (m.status.freezeMs > 0) icons.push('❄');
        if (m.status.stunMs > 0) icons.push('✦');
        if (m.status.slow) icons.push('⌛');
        P.label(v3(m.pos.x, height + 20, m.pos.y), icons.join(' '), { size: 11, weight: '600', color: '#ffffff' });
      }
    });

    // lock-on reticle + arrows
    if (o.lockTarget && o.lockTarget.alive) {
      const m = o.lockTarget;
      const pos = v3(m.pos.x, 14 + (m.scale || 1) * 16, m.pos.y);
      S.ring(P, { x: m.pos.x, z: m.pos.y, radius: (m.radius || 18) + 16, thickness: 2.6, color: '#ffd76a', alpha: 0.6, segments: 28, phase: (o.time || 0) * 0.9 });
      const s = P.cam.project(pos, P.vp);
      if (s.visible) {
        const c = P.ctx;
        c.save();
        c.strokeStyle = 'rgba(255,215,106,0.9)';
        c.lineWidth = 2;
        const r = 10 * clamp(s.scale / 0.6, 0.6, 1.4);
        [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (q) {
          c.beginPath();
          c.moveTo(s.x + q[0] * r, s.y + q[1] * r - q[1] * r * 0.35);
          c.lineTo(s.x + q[0] * r, s.y + q[1] * r);
          c.lineTo(s.x + q[0] * r - q[0] * r * 0.35, s.y + q[1] * r);
          c.stroke();
        });
        c.restore();
      }
    }
  }

  root.MytharaActors3D = {
    setGround: setGround,
    groundAt: groundAt,
    drawActor: drawActor,
    drawHero: drawHero,
    drawOverlays: drawOverlays,
    equipment: equipment,
    heroPose: heroPose,
    creatureAnimation: creatureAnimation
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MytharaActors3D;

})(typeof globalThis !== 'undefined' ? globalThis : this);
