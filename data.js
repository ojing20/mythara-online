/* ============================================================
 * Mythara Online — data.js
 * ------------------------------------------------------------
 * All static, tunable game data lives here. Gameplay logic
 * (game.js) reads from MYTHARA_DATA only, so new content —
 * monsters, zones, items, and later the 10 classes, guilds and
 * dungeons — can be added without touching the engine.
 * ============================================================ */
(function (root) {
  'use strict';

  /** Global engine tuning. */
  const CONFIG = {
    world: {
      width: 960,          // logical canvas units (matches index.html canvas)
      height: 540,
      margin: 34           // keep entities this far from the world edge
    },
    loop: {
      maxDeltaSeconds: 0.05,   // clamp long frames (tab switches, hitches)
      maxDeltaMs: 50
    },
    feedback: {
      maxLogEntries: 6,
      floaterLifetimeMs: 1100,
      bannerDurationMs: 1400,
      shakeDecayPerSecond: 6
    }
  };

  /** Combat math rules shared by every actor. */
  const COMBAT = {
    varianceMin: 0.85,     // damage roll range (multiplier of attack)
    varianceMax: 1.15,
    critChance: 0.12,
    critMultiplier: 1.75,
    minDamage: 1,
    outOfCombatRegenDelayMs: 3500   // HP regen pauses this long after being hit
  };

  /** Level curve and per-level growth for the player. */
  const PROGRESSION = {
    baseExpToLevel: 50,
    expGrowth: 1.6,        // each level needs 60% more EXP
    hpPerLevel: 20,
    mpPerLevel: 6,
    attackPerLevel: 2,
    defensePerLevel: 1,
    fullHealOnLevelUp: true
  };

  /** The starting hero (step 1: a single fixed character). */
  const PLAYER = {
    id: 'jingle',
    name: 'Jingle',
    title: 'Adventurer',
    level: 1,
    maxHp: 100,
    maxMp: 30,
    attack: 9,
    defense: 2,
    speed: 190,                 // world units per second
    radius: 16,
    attackRange: 46,            // measured edge-to-edge, added to both radii
    attackCooldownMs: 550,
    hpRegenPerSecond: 1.5,
    mpRegenPerSecond: 1.0,
    spawn: { x: 320, y: 400 },
    facing: { x: 1, y: 0 }
  };

  /** Monsters available in the training grounds. */
  const MONSTERS = {
    greenSlime: {
      id: 'greenSlime',
      name: 'Green Slime',
      level: 1,
      maxHp: 45,
      attack: 6,
      defense: 1,
      speed: 62,
      radius: 17,
      aggroRange: 210,
      attackRange: 12,
      attackCooldownMs: 1200,
      wanderRadius: 96,
      respawnMs: 4000,
      rewards: { exp: 25, goldMin: 5, goldMax: 13 },
      spawn: { x: 655, y: 360 },
      palette: {
        body: '#5fd36a',
        bodyDark: '#2f8a3f',
        shine: '#c8ffcd',
        eye: '#123314'
      }
    }
  };

  /** Which monster populates the starting zone. */
  const ZONES = {
    verdantHollow: {
      id: 'verdantHollow',
      name: 'Verdant Hollow — Training Grounds',
      monsters: ['greenSlime'],
      palette: {
        skyTop: '#4a6fa8',
        skyBottom: '#bcd3ea',
        sun: '#fff3c4',
        mountainFar: '#6d7fa8',
        mountainNear: '#4d5c85',
        hillFar: '#5f9a5c',
        hillNear: '#3f7a45',
        groundTop: '#6cb35f',
        groundBottom: '#3a6d3c',
        path: '#c2a06a',
        tree: '#2f6b3a',
        treeDark: '#1f4a29',
        trunk: '#5a3d24',
        rock: '#8b8fa3'
      }
    }
  };

  const DATA = {
    CONFIG,
    COMBAT,
    PROGRESSION,
    PLAYER,
    MONSTERS,
    ZONES,
    activeZone: 'verdantHollow',
    activeMonster: 'greenSlime'
  };

  root.MYTHARA_DATA = DATA;
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;

})(typeof globalThis !== 'undefined' ? globalThis : this);
