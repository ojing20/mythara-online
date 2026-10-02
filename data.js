/* ============================================================
 * Mythara Online — data.js
 * ------------------------------------------------------------
 * All static, tunable game data lives here. Gameplay logic
 * (game.js) reads from MYTHARA_DATA only, so new content —
 * classes, monsters, zones, items, skills — can be added
 * without touching the engine.
 *
 * Sections:
 *   1. CONFIG       — engine tuning
 *   2. COMBAT       — shared damage rules
 *   3. PROGRESSION  — EXP curve and level-up rules
 *   4. PLAYER       — base hero template + defaults
 *   5. ITEMS        — starting equipment (weapons / armor)
 *   6. PROJECTILES  — ranged attack definitions
 *   7. SKILLS       — active abilities granted by classes
 *   8. CLASSES      — the 10 playable classes
 *   9. MONSTERS     — enemies
 *  10. ZONES        — world areas
 * ============================================================ */
(function (root) {
  'use strict';

  /** Global engine tuning. */
  const CONFIG = {
    world: {
      width: 960,          // logical canvas units (matches index.html canvas)
      height: 540,
      margin: 34,          // keep entities this far from the world edge
      floorTop: 300        // upper walkable bound: above this is scenery, not floor
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
    },
    storage: {
      saveKey: 'mythara.character.v1'   // localStorage key for the created character
    }
  };

  /** Combat math rules shared by every actor. */
  const COMBAT = {
    varianceMin: 0.85,     // damage roll range (multiplier of power)
    varianceMax: 1.15,
    critChance: 0.12,      // fallback when an actor defines none
    critMultiplier: 1.75,
    defenseFactor: 0.8,    // how much of the defender's DEF is subtracted
    minDamage: 1,
    outOfCombatRegenDelayMs: 3500   // HP regen pauses this long after being hit
  };

  /** Level curve and per-level growth defaults (classes override growth). */
  const PROGRESSION = {
    baseExpToLevel: 50,
    expGrowth: 1.6,        // each level needs 60% more EXP
    hpPerLevel: 20,
    mpPerLevel: 6,
    attackPerLevel: 2,
    defensePerLevel: 1,
    fullHealOnLevelUp: true
  };

  /** Base hero template. Every class starts from these and overrides them. */
  const PLAYER = {
    id: 'jingle',
    name: 'Jingle',          // default character name
    title: 'Adventurer',
    level: 1,
    maxHp: 100,
    maxMp: 30,
    attack: 9,
    defense: 2,
    magic: 2,
    critChance: 0.08,
    critMultiplier: 1.6,
    evasion: 0.02,
    damageReduction: 0,
    speed: 190,
    radius: 16,
    attackRange: 46,         // melee reach, measured edge-to-edge
    autoTargetRange: 0,      // >0 lets ranged classes auto-aim
    attackCooldownMs: 550,
    hpRegenPerSecond: 1.5,
    mpRegenPerSecond: 1.0,
    spawn: { x: 320, y: 400 },
    facing: { x: 1, y: 0 }
  };

  /* ============================================================
   * 5. ITEMS — starting equipment
   * ========================================================== */
  const ITEMS = {
    weapons: {
      ironLongsword: {
        id: 'ironLongsword', name: 'Iron Longsword', type: 'sword', slot: 'weapon',
        description: 'Honest steel, balanced for shield work.', bonus: { attack: 2 }
      },
      yewShortbow: {
        id: 'yewShortbow', name: 'Yew Shortbow', type: 'bow', slot: 'weapon',
        description: 'Quick to draw, quicker to loose.', bonus: { attack: 3, attackSpeed: 0.05 }
      },
      emberwoodStaff: {
        id: 'emberwoodStaff', name: 'Emberwood Staff', type: 'staff', slot: 'weapon',
        description: 'Still warm to the touch; smoulders when roused.', bonus: { magic: 4 }
      },
      frostpineStaff: {
        id: 'frostpineStaff', name: 'Frostpine Staff', type: 'staff', slot: 'weapon',
        description: 'Carved from a tree that never thawed.', bonus: { magic: 4 }
      },
      twinFangDaggers: {
        id: 'twinFangDaggers', name: 'Twin Fang Daggers', type: 'daggers', slot: 'weapon',
        description: 'A matched pair that find the seam in any armour.', bonus: { attack: 3, critChance: 0.05 }
      },
      dawnbreakerSword: {
        id: 'dawnbreakerSword', name: 'Dawnbreaker Sword', type: 'sword', slot: 'weapon',
        description: 'Blessed at first light; kind to the faithful.', bonus: { attack: 2, magic: 1 }
      },
      suncallStaff: {
        id: 'suncallStaff', name: 'Suncall Staff', type: 'staff', slot: 'weapon',
        description: 'Channels dawn-light into mending warmth.', bonus: { magic: 4, maxMp: 5 }
      },
      bloodhowlGreataxe: {
        id: 'bloodhowlGreataxe', name: 'Bloodhowl Greataxe', type: 'greataxe', slot: 'weapon',
        description: 'Too heavy to block with; that is the point.', bonus: { attack: 5, defense: -1 }
      },
      kageTwinBlades: {
        id: 'kageTwinBlades', name: 'Kage Twin Blades', type: 'dual-blades', slot: 'weapon',
        description: 'Folded shadow-steel, silent on the draw.', bonus: { attack: 3, critChance: 0.04 }
      },
      wyrmfangGreatsword: {
        id: 'wyrmfangGreatsword', name: 'Wyrmfang Greatsword', type: 'dragon-greatsword', slot: 'weapon',
        description: 'Forged around a dragon fang; it remembers the fire.', bonus: { attack: 4, magic: 1 }
      }
    },

    armors: {
      guardPlate: {
        id: 'guardPlate', name: 'Guard Plate', type: 'plate', slot: 'armor',
        description: 'Banded mail over a padded gambeson.', bonus: { defense: 3, maxHp: 10 }
      },
      rangersLeathers: {
        id: 'rangersLeathers', name: "Ranger's Leathers", type: 'leather', slot: 'armor',
        description: 'Supple hide that never catches on a bowstring.', bonus: { defense: 1, maxHp: 5, speed: 5 }
      },
      emberweaveRobe: {
        id: 'emberweaveRobe', name: 'Emberweave Robe', type: 'robe', slot: 'armor',
        description: 'Woven with cooling threads for those who play with fire.', bonus: { defense: 1, maxMp: 8 }
      },
      frostveilRobe: {
        id: 'frostveilRobe', name: 'Frostveil Robe', type: 'robe', slot: 'armor',
        description: 'The hem frosts over in humid air.', bonus: { defense: 1, maxMp: 8 }
      },
      shadowweaveGarb: {
        id: 'shadowweaveGarb', name: 'Shadowweave Garb', type: 'leather', slot: 'armor',
        description: 'Dyes the wearer into the dark.', bonus: { defense: 1, maxHp: 8, evasion: 0.03 }
      },
      aegisOfDawn: {
        id: 'aegisOfDawn', name: 'Aegis of Dawn', type: 'plate', slot: 'armor',
        description: 'A tower shield and plate that turn blows aside.', bonus: { defense: 4, maxHp: 15 }
      },
      vestmentsOfMercy: {
        id: 'vestmentsOfMercy', name: 'Vestments of Mercy', type: 'robe', slot: 'armor',
        description: 'White cloth that stays clean on any road.', bonus: { defense: 1, maxMp: 10 }
      },
      warshideHarness: {
        id: 'warshideHarness', name: 'Warshide Harness', type: 'leather', slot: 'armor',
        description: 'Bare arms, bare nerves, plenty of scars.', bonus: { defense: 2, maxHp: 5, attack: 1 }
      },
      shinobiWraps: {
        id: 'shinobiWraps', name: 'Shinobi Wraps', type: 'leather', slot: 'armor',
        description: 'Layered cloth that muffles every step.', bonus: { defense: 1, maxHp: 8, evasion: 0.04 }
      },
      dragonplate: {
        id: 'dragonplate', name: 'Dragonplate', type: 'plate', slot: 'armor',
        description: 'Overlapping scales, still faintly warm.', bonus: { defense: 4, maxHp: 12 }
      }
    }
  };

  /* ============================================================
   * 6. PROJECTILES — ranged attacks & spells
   * ========================================================== */
  const PROJECTILES = {
    arrow: {
      id: 'arrow', name: 'Arrow', style: 'arrow', speed: 560, radius: 5, stat: 'attack',
      color: '#f0e2b0', trail: '#c9b87a', damageMultiplier: 1.0
    },
    powerArrow: {
      id: 'powerArrow', name: 'Power Shot', style: 'arrow', speed: 700, radius: 6, stat: 'attack',
      color: '#fff3c0', trail: '#ffd76a', damageMultiplier: 1.9, shake: 4
    },
    fireball: {
      id: 'fireball', name: 'Fireball', style: 'orb', speed: 400, radius: 11, stat: 'magic',
      color: '#ffb347', trail: '#ff5f1f', damageMultiplier: 1.6, explodeRadius: 80,
      apply: { burn: { dpsPct: 0.18, durationMs: 4000 } }, shake: 5
    },
    frostbolt: {
      id: 'frostbolt', name: 'Frost Bolt', style: 'shard', speed: 470, radius: 8, stat: 'magic',
      color: '#bfefff', trail: '#5ec8f0', damageMultiplier: 1.3,
      apply: { slow: { factor: 0.45, durationMs: 3000 } }
    },
    holyBolt: {
      id: 'holyBolt', name: 'Smite', style: 'orb', speed: 500, radius: 9, stat: 'magic',
      color: '#fff0b8', trail: '#ffe08a', damageMultiplier: 1.5
    },
    shuriken: {
      id: 'shuriken', name: 'Shuriken', style: 'star', speed: 640, radius: 7, stat: 'attack',
      color: '#d7e0f2', trail: '#9aa6c4', damageMultiplier: 1.4
    },

    /* --- enemy projectiles (fired by monsters in adventure stages) --- */
    goblinStone: {
      id: 'goblinStone', name: 'Goblin Stone', style: 'star', speed: 340, radius: 6, stat: 'attack',
      color: '#a89a86', trail: '#6f6553', damageMultiplier: 1.0
    },
    poisonSpit: {
      id: 'poisonSpit', name: 'Poison Spit', style: 'orb', speed: 330, radius: 7, stat: 'attack',
      color: '#9be36a', trail: '#4f7a2a', damageMultiplier: 1.05,
      apply: { poison: { dpsPct: 0.18, durationMs: 3000 } }
    },
    iceShard: {
      id: 'iceShard', name: 'Ice Shard', style: 'shard', speed: 420, radius: 7, stat: 'attack',
      color: '#bfefff', trail: '#5ec8f0', damageMultiplier: 1.1,
      apply: { slow: { factor: 0.3, durationMs: 2500 } }
    },
    fireBreath: {
      id: 'fireBreath', name: 'Fire Breath', style: 'orb', speed: 380, radius: 10, stat: 'attack',
      color: '#ffb347', trail: '#ff5f1f', damageMultiplier: 1.25,
      apply: { burn: { dpsPct: 0.16, durationMs: 3500 } }, explodeRadius: 46
    },
    voidOrb: {
      id: 'voidOrb', name: 'Void Orb', style: 'orb', speed: 360, radius: 9, stat: 'attack',
      color: '#c46bff', trail: '#5c1f8a', damageMultiplier: 1.3
    },
    shadowBolt: {
      id: 'shadowBolt', name: 'Shadow Bolt', style: 'orb', speed: 430, radius: 8, stat: 'attack',
      color: '#8a5cff', trail: '#2f1d52', damageMultiplier: 1.2
    },
    rockShard: {
      id: 'rockShard', name: 'Rock Shard', style: 'star', speed: 400, radius: 8, stat: 'attack',
      color: '#b9b2a0', trail: '#6f6a5a', damageMultiplier: 1.15
    },
    thornVolley: {
      id: 'thornVolley', name: 'Thorn Volley', style: 'shard', speed: 450, radius: 6, stat: 'attack',
      color: '#9be36a', trail: '#3f7a33', damageMultiplier: 1.05
    }
  };

  /* ============================================================
   * 7. SKILLS — active abilities (kind drives the executor in game.js)
   *    kinds: meleeStrike | aoeSelf | projectile | heal | buff |
   *           stealth | dash | inflict
   * ========================================================== */
  const SKILLS = {
    /* --- Warrior --- */
    shieldBash: {
      id: 'shieldBash', name: 'Shield Bash', glyph: '\u25C6', mp: 6, cooldownMs: 6000,
      kind: 'meleeStrike', description: 'Slam with the shield for 180% weapon damage and stun the target.',
      params: { multiplier: 1.8, stunMs: 900 }
    },
    ironGuard: {
      id: 'ironGuard', name: 'Iron Guard', glyph: '\u2726', mp: 8, cooldownMs: 12000,
      kind: 'buff', description: 'Brace behind the shield: +80% defense for 6s.',
      params: { durationMs: 6000, mods: { defensePct: 0.8 } }
    },
    whirlwind: {
      id: 'whirlwind', name: 'Whirlwind', glyph: '\u2727', mp: 12, cooldownMs: 9000, ultimate: true,
      kind: 'aoeSelf', description: 'Spin with the blade, striking everything within 95 units.',
      params: { multiplier: 1.3, radius: 95 }
    },

    /* --- Archer --- */
    powerShot: {
      id: 'powerShot', name: 'Power Shot', glyph: '\u25C6', mp: 7, cooldownMs: 5000,
      kind: 'projectile', description: 'A drawn-to-the-ear shot dealing 190% damage.',
      params: { projectile: 'powerArrow' }
    },
    rainOfArrows: {
      id: 'rainOfArrows', name: 'Rain of Arrows', glyph: '\u2726', mp: 12, cooldownMs: 9000, ultimate: true,
      kind: 'projectile', description: 'Loose three arrows in a wide fan.',
      params: { projectile: 'arrow', count: 3, spread: 0.26, multiplier: 0.9 }
    },
    eagleEye: {
      id: 'eagleEye', name: 'Eagle Eye', glyph: '\u2727', mp: 10, cooldownMs: 14000,
      kind: 'buff', description: 'Sharpen your aim: +25% crit chance and +15% speed for 7s.',
      params: { durationMs: 7000, mods: { critChance: 0.25, speedPct: 0.15 } }
    },

    /* --- Fire Mage --- */
    fireball: {
      id: 'fireball', name: 'Fireball', glyph: '\u25C6', mp: 10, cooldownMs: 1800,
      kind: 'projectile', description: 'Hurl a fireball that bursts for area damage and burns.',
      params: { projectile: 'fireball' }
    },
    flameNova: {
      id: 'flameNova', name: 'Flame Nova', glyph: '\u2726', mp: 18, cooldownMs: 9000, ultimate: true,
      kind: 'aoeSelf', description: 'Erupt in flame, scorching everything within 120 units.',
      params: { multiplier: 1.9, radius: 120, apply: { burn: { dpsPct: 0.22, durationMs: 5000 } } }
    },
    moltenArmor: {
      id: 'moltenArmor', name: 'Molten Armor', glyph: '\u2727', mp: 12, cooldownMs: 16000,
      kind: 'buff', description: 'Superheated wards: +25% magic and +3 defense for 8s.',
      params: { durationMs: 8000, mods: { magicPct: 0.25, defense: 3 } }
    },

    /* --- Ice Mage --- */
    frostBolt: {
      id: 'frostBolt', name: 'Frost Bolt', glyph: '\u25C6', mp: 8, cooldownMs: 1600,
      kind: 'projectile', description: 'A shard of ice that chills the target, slowing it by 45%.',
      params: { projectile: 'frostbolt' }
    },
    glacialPrison: {
      id: 'glacialPrison', name: 'Glacial Prison', glyph: '\u2726', mp: 16, cooldownMs: 10000, ultimate: true,
      kind: 'inflict', description: 'Encase the target in ice: 120% damage and a 1.8s freeze.',
      params: { multiplier: 1.2, freezeMs: 1800 }
    },
    iceBarrier: {
      id: 'iceBarrier', name: 'Ice Barrier', glyph: '\u2727', mp: 14, cooldownMs: 15000,
      kind: 'buff', description: 'A shell of ice absorbs 35% of incoming damage for 6s.',
      params: { durationMs: 6000, mods: { damageReduction: 0.35 } }
    },

    /* --- Assassin --- */
    shadowStrike: {
      id: 'shadowStrike', name: 'Shadow Strike', glyph: '\u25C6', mp: 8, cooldownMs: 5000,
      kind: 'meleeStrike', description: 'A guaranteed critical blow for 200% damage.',
      params: { multiplier: 2.0, alwaysCrit: true }
    },
    venomBlades: {
      id: 'venomBlades', name: 'Venom Blades', glyph: '\u2726', mp: 12, cooldownMs: 12000,
      kind: 'buff', description: 'Coat your daggers: attacks poison for 8s.',
      params: { durationMs: 8000, mods: { attackPct: 0.1 }, poisonOnHit: { dpsPct: 0.25, durationMs: 5000 } }
    },
    fanOfKnives: {
      id: 'fanOfKnives', name: 'Fan of Knives', glyph: '\u2727', mp: 10, cooldownMs: 8000, ultimate: true,
      kind: 'aoeSelf', description: 'Fling blades in every direction, hitting all foes within 100 units.',
      params: { multiplier: 1.2, radius: 100 }
    },

    /* --- Paladin --- */
    holySmite: {
      id: 'holySmite', name: 'Holy Smite', glyph: '\u25C6', mp: 9, cooldownMs: 6000,
      kind: 'meleeStrike', description: 'A radiant strike for 170% damage that heals you for 8% HP.',
      params: { multiplier: 1.7, selfHealPct: 0.08 }
    },
    layOnHands: {
      id: 'layOnHands', name: 'Lay on Hands', glyph: '\u2726', mp: 20, cooldownMs: 18000,
      kind: 'heal', description: 'Channel light to restore 40% of maximum HP.',
      params: { percent: 0.4 }
    },
    divineAegis: {
      id: 'divineAegis', name: 'Divine Aegis', glyph: '\u2727', mp: 16, cooldownMs: 16000, ultimate: true,
      kind: 'buff', description: 'Aegis of light: +25% damage reduction, +4 defense and 4 HP/s for 8s.',
      params: { durationMs: 8000, mods: { damageReduction: 0.25, defense: 4 }, regenPerSecond: 4 }
    },

    /* --- Priest --- */
    heal: {
      id: 'heal', name: 'Heal', glyph: '\u25C6', mp: 12, cooldownMs: 7000,
      kind: 'heal', description: 'Mend your wounds, restoring 35% of maximum HP.',
      params: { percent: 0.35 }
    },
    blessing: {
      id: 'blessing', name: 'Blessing', glyph: '\u2726', mp: 14, cooldownMs: 15000, ultimate: true,
      kind: 'buff', description: 'Invoke dawn: +20% attack and +25% magic for 9s.',
      params: { durationMs: 9000, mods: { attackPct: 0.2, magicPct: 0.25 } }
    },
    smite: {
      id: 'smite', name: 'Smite', glyph: '\u2727', mp: 8, cooldownMs: 2500,
      kind: 'projectile', description: 'A lance of holy light dealing 150% magic damage.',
      params: { projectile: 'holyBolt', multiplier: 1.0 }
    },

    /* --- Berserker --- */
    cleave: {
      id: 'cleave', name: 'Cleave', glyph: '\u25C6', mp: 8, cooldownMs: 7000, ultimate: true,
      kind: 'aoeSelf', description: 'A wide axe sweep hitting everything within 105 units for 150%.',
      params: { multiplier: 1.5, radius: 105 }
    },
    bloodRage: {
      id: 'bloodRage', name: 'Blood Rage', glyph: '\u2726', mp: 0, cooldownMs: 2000,
      kind: 'buff', description: 'Spend 35 rage: +60% attack for 7s but 15% more damage taken.',
      params: { durationMs: 7000, rageCost: 35, mods: { attackPct: 0.6, damageReduction: -0.15 } }
    },
    recklessCharge: {
      id: 'recklessCharge', name: 'Reckless Charge', glyph: '\u2727', mp: 10, cooldownMs: 9000,
      kind: 'dash', description: 'Barrel into the target for 160% damage.',
      params: { distance: 190, multiplier: 1.6 }
    },

    /* --- Ninja --- */
    shuriken: {
      id: 'shuriken', name: 'Shuriken', glyph: '\u25C6', mp: 6, cooldownMs: 3000,
      kind: 'projectile', description: 'Throw a steel star for 140% damage.',
      params: { projectile: 'shuriken' }
    },
    smokeBomb: {
      id: 'smokeBomb', name: 'Smoke Bomb', glyph: '\u2726', mp: 12, cooldownMs: 14000, ultimate: true,
      kind: 'stealth', description: 'Vanish for 4s: enemies lose you and your crit chance surges.',
      params: { durationMs: 4000, critChance: 0.4, speedPct: 0.1 }
    },
    shadowStep: {
      id: 'shadowStep', name: 'Shadow Step', glyph: '\u2727', mp: 8, cooldownMs: 6000,
      kind: 'dash', description: 'Slip through the shadows to close the gap instantly.',
      params: { distance: 200, multiplier: 0 }
    },

    /* --- Dragon Knight --- */
    dragonCleave: {
      id: 'dragonCleave', name: 'Dragon Cleave', glyph: '\u25C6', mp: 9, cooldownMs: 6000,
      kind: 'meleeStrike', description: 'A fang-shaped arc for 180% damage that sets the target burning.',
      params: { multiplier: 1.8, apply: { burn: { dpsPct: 0.15, durationMs: 4000 } } }
    },
    wyrmGuard: {
      id: 'wyrmGuard', name: 'Wyrm Guard', glyph: '\u2726', mp: 14, cooldownMs: 16000,
      kind: 'buff', description: 'Scale-hard skin: +4 defense, +20% damage reduction, 3 HP/s for 8s.',
      params: { durationMs: 8000, mods: { defense: 4, damageReduction: 0.2 }, regenPerSecond: 3 }
    },
    dragonsBreath: {
      id: 'dragonsBreath', name: "Dragon's Breath", glyph: '\u2727', mp: 25, cooldownMs: 20000, ultimate: true,
      kind: 'aoeSelf', description: 'ULTIMATE — exhale draconic fire in a 150 unit blast for 260% damage and heavy burn.',
      params: {
        multiplier: 2.6, radius: 150, shake: 9,
        apply: { burn: { dpsPct: 0.3, durationMs: 6000 } }
      }
    }
  };

  /* ============================================================
   * 8. CLASSES — the 10 playable classes
   *    All designs are original to Mythara Online.
   * ========================================================== */
  const CLASSES = {
    warrior: {
      id: 'warrior',
      name: 'Warrior',
      emblem: '\u2694',
      role: 'Melee \u00B7 Tank',
      difficulty: 1,
      difficultyLabel: 'Easy',
      attackType: 'melee',
      description: 'A frontline veteran who trades finesse for staying power. Sword and shield, hold the line.',
      playstyle: 'High HP and defense with solid melee damage. The most forgiving class to learn.',
      base: { maxHp: 140, maxMp: 20, attack: 11, defense: 7, magic: 2, speed: 165, critChance: 0.08, critMultiplier: 1.6, evasion: 0.02, attackCooldownMs: 700, attackRange: 48 },
      growth: { maxHp: 26, maxMp: 3, attack: 2.4, defense: 1.3, magic: 0.2 },
      weaponId: 'ironLongsword',
      armorId: 'guardPlate',
      skillIds: ['shieldBash', 'ironGuard', 'whirlwind'],
      passive: { id: 'sturdy', name: 'Sturdy', description: 'Takes 15% less damage from all sources.', mods: { damageReduction: 0.15 } },
      look: { skin: '#f2c79c', hair: '#7a4a22', primary: '#3f5ecf', secondary: '#5c7ae8', cloth: '#2b3a7a', accent: '#c9d4ea', metal: '#b9c2d6', weapon: 'sword-shield', cape: true, shield: true, helm: true }
    },

    archer: {
      id: 'archer',
      name: 'Archer',
      emblem: '\u25B2',
      role: 'Ranged \u00B7 DPS',
      difficulty: 2,
      difficultyLabel: 'Easy',
      attackType: 'ranged',
      basicProjectile: 'arrow',
      description: 'A keen-eyed hunter who never lets a target close. Fast draws, faster arrows.',
      playstyle: 'Long-range bow attacks with the fastest base attack speed and high agility.',
      base: { maxHp: 100, maxMp: 30, attack: 12, defense: 3, magic: 3, speed: 210, critChance: 0.15, critMultiplier: 1.75, evasion: 0.06, attackCooldownMs: 380, attackRange: 46, autoTargetRange: 430 },
      growth: { maxHp: 18, maxMp: 4, attack: 2.6, defense: 0.7, magic: 0.4 },
      weaponId: 'yewShortbow',
      armorId: 'rangersLeathers',
      skillIds: ['powerShot', 'rainOfArrows', 'eagleEye'],
      passive: { id: 'eagleEye', name: 'Keen Eye', description: '+10% critical chance.', mods: { critChance: 0.1 } },
      look: { skin: '#f0c49a', hair: '#3f7a45', primary: '#3f7a45', secondary: '#5f9a5c', cloth: '#2f5a34', accent: '#d9b26a', metal: '#a8b0c0', weapon: 'bow', cape: false, quiver: true }
    },

    fireMage: {
      id: 'fireMage',
      name: 'Fire Mage',
      emblem: '\u2726',
      role: 'Ranged \u00B7 AoE',
      difficulty: 2,
      difficultyLabel: 'Normal',
      attackType: 'ranged',
      basicProjectile: 'fireball',
      description: 'A student of the Emberwood school. Answers most problems with an explosion.',
      playstyle: 'Fire projectiles that burst for area damage, plus stacking burn effects.',
      base: { maxHp: 88, maxMp: 60, attack: 5, defense: 2, magic: 16, speed: 175, critChance: 0.08, critMultiplier: 1.7, evasion: 0.03, attackCooldownMs: 700, attackRange: 46, autoTargetRange: 420 },
      growth: { maxHp: 15, maxMp: 9, attack: 0.8, defense: 0.5, magic: 3.4 },
      weaponId: 'emberwoodStaff',
      armorId: 'emberweaveRobe',
      skillIds: ['fireball', 'flameNova', 'moltenArmor'],
      passive: { id: 'kindling', name: 'Kindling', description: 'Burn effects deal 25% more damage.', mods: { burnBonus: 0.25 } },
      look: { skin: '#f0c49a', hair: '#a83f1c', primary: '#b3370d', secondary: '#e2683a', cloth: '#7a230a', accent: '#ffb347', metal: '#d9a05a', weapon: 'staff', robe: true, aura: '#ff7a3a' }
    },

    iceMage: {
      id: 'iceMage',
      name: 'Ice Mage',
      emblem: '\u2744',
      role: 'Ranged \u00B7 Control',
      difficulty: 3,
      difficultyLabel: 'Normal',
      attackType: 'ranged',
      basicProjectile: 'frostbolt',
      description: 'A frost scholar from the northern spires. Fights by taking the fight out of enemies.',
      playstyle: 'Chilling bolts slow and freeze, keeping dangerous foes locked in place.',
      base: { maxHp: 92, maxMp: 62, attack: 5, defense: 2, magic: 14, speed: 175, critChance: 0.08, critMultiplier: 1.7, evasion: 0.03, attackCooldownMs: 720, attackRange: 46, autoTargetRange: 420 },
      growth: { maxHp: 16, maxMp: 9, attack: 0.8, defense: 0.5, magic: 3.0 },
      weaponId: 'frostpineStaff',
      armorId: 'frostveilRobe',
      skillIds: ['frostBolt', 'glacialPrison', 'iceBarrier'],
      passive: { id: 'deepChill', name: 'Deep Chill', description: 'Slow effects are 30% stronger and last longer.', mods: { chillBonus: 0.3 } },
      look: { skin: '#f4d3b0', hair: '#d8ecff', primary: '#2f7fb5', secondary: '#5ec8f0', cloth: '#1d4f75', accent: '#bfefff', metal: '#cfe3f2', weapon: 'staff', robe: true, aura: '#7fdcff' }
    },

    assassin: {
      id: 'assassin',
      name: 'Assassin',
      emblem: '\u2727',
      role: 'Melee \u00B7 Burst',
      difficulty: 3,
      difficultyLabel: 'Normal',
      attackType: 'melee',
      description: 'A blade for hire out of the Lantern Quarter. Precision over power, every time.',
      playstyle: 'Blistering attack speed and the highest critical chance in Mythara.',
      base: { maxHp: 96, maxMp: 35, attack: 13, defense: 3, magic: 4, speed: 215, critChance: 0.3, critMultiplier: 2.1, evasion: 0.08, attackCooldownMs: 380, attackRange: 44 },
      growth: { maxHp: 17, maxMp: 4, attack: 2.9, defense: 0.6, magic: 0.4 },
      weaponId: 'twinFangDaggers',
      armorId: 'shadowweaveGarb',
      skillIds: ['shadowStrike', 'venomBlades', 'fanOfKnives'],
      passive: { id: 'lethality', name: 'Lethality', description: '+35% critical damage.', mods: { critDamage: 0.35 } },
      look: { skin: '#e8bd93', hair: '#1f1a2e', primary: '#2b2440', secondary: '#453a68', cloth: '#191428', accent: '#8f6ad6', metal: '#b8c2d8', weapon: 'daggers', hood: true, cape: true }
    },

    paladin: {
      id: 'paladin',
      name: 'Paladin',
      emblem: '\u271A',
      role: 'Melee \u00B7 Support',
      difficulty: 1,
      difficultyLabel: 'Easy',
      attackType: 'melee',
      description: 'An oath-sworn shield of the Dawnhold. Hard to break, harder to discourage.',
      playstyle: 'The toughest class in the game, with self-healing and group-friendly support.',
      base: { maxHp: 145, maxMp: 45, attack: 10, defense: 9, magic: 8, speed: 155, critChance: 0.07, critMultiplier: 1.6, evasion: 0.02, attackCooldownMs: 720, attackRange: 48 },
      growth: { maxHp: 27, maxMp: 6, attack: 2.1, defense: 1.6, magic: 1.4 },
      weaponId: 'dawnbreakerSword',
      armorId: 'aegisOfDawn',
      skillIds: ['holySmite', 'layOnHands', 'divineAegis'],
      passive: { id: 'devotion', name: 'Devotion', description: 'All healing you receive is 25% stronger.', mods: { healingBonus: 0.25 } },
      look: { skin: '#f2c79c', hair: '#e0c060', primary: '#eef2f8', secondary: '#ffffff', cloth: '#b9a678', accent: '#f2c14e', metal: '#cbd6e6', weapon: 'sword-shield', shield: true, cape: true, helm: true }
    },

    priest: {
      id: 'priest',
      name: 'Priest',
      emblem: '\u2600',
      role: 'Ranged \u00B7 Healer',
      difficulty: 2,
      difficultyLabel: 'Normal',
      attackType: 'ranged',
      basicProjectile: 'holyBolt',
      description: 'A keeper of the dawn rites. Mends wounds, lifts spirits, and smites when needed.',
      playstyle: 'Strong self-healing and buffs backed by holy ranged magic.',
      base: { maxHp: 90, maxMp: 70, attack: 4, defense: 3, magic: 13, speed: 170, critChance: 0.06, critMultiplier: 1.6, evasion: 0.03, attackCooldownMs: 760, attackRange: 46, autoTargetRange: 400 },
      growth: { maxHp: 15, maxMp: 10, attack: 0.7, defense: 0.6, magic: 2.8 },
      weaponId: 'suncallStaff',
      armorId: 'vestmentsOfMercy',
      skillIds: ['heal', 'blessing', 'smite'],
      passive: { id: 'dawnTide', name: 'Dawn Tide', description: 'Mana regenerates 50% faster.', mods: { mpRegenPct: 0.5 } },
      look: { skin: '#f4d3b0', hair: '#f0e2b0', primary: '#f4f0e2', secondary: '#ffffff', cloth: '#d9cfa8', accent: '#f2c14e', metal: '#e8e0c0', weapon: 'staff', robe: true, aura: '#ffeeb0' }
    },

    berserker: {
      id: 'berserker',
      name: 'Berserker',
      emblem: '\u2716',
      role: 'Melee \u00B7 Damage',
      difficulty: 4,
      difficultyLabel: 'Hard',
      attackType: 'melee',
      description: 'A warshide raider who fights best when the odds are worst. Armour is for the cautious.',
      playstyle: 'Enormous melee damage with paper-thin defense. Rage builds as you fight, empowering you.',
      base: { maxHp: 130, maxMp: 15, attack: 18, defense: 2, magic: 2, speed: 175, critChance: 0.12, critMultiplier: 1.85, evasion: 0.03, attackCooldownMs: 780, attackRange: 52 },
      growth: { maxHp: 24, maxMp: 2, attack: 3.4, defense: 0.4, magic: 0.2 },
      weaponId: 'bloodhowlGreataxe',
      armorId: 'warshideHarness',
      skillIds: ['cleave', 'bloodRage', 'recklessCharge'],
      passive: { id: 'rage', name: 'Rage', description: 'Builds rage as you deal and take damage, up to +25% attack.', mods: { rage: true } },
      look: { skin: '#e8b183', hair: '#c2451f', primary: '#8d4a2a', secondary: '#b8643a', cloth: '#5f2f18', accent: '#d9a05a', metal: '#9aa0ae', weapon: 'greataxe', bareArms: true, cape: false, helm: true, horns: true }
    },

    ninja: {
      id: 'ninja',
      name: 'Ninja',
      emblem: '\u263E',
      role: 'Melee \u00B7 Skirmisher',
      difficulty: 4,
      difficultyLabel: 'Hard',
      attackType: 'melee',
      description: 'A shadow-walker from the eastern isles. Arrives unseen, leaves before the body falls.',
      playstyle: 'The fastest mover in Mythara with strong evasion and a stealth escape.',
      base: { maxHp: 98, maxMp: 40, attack: 12, defense: 3, magic: 5, speed: 245, critChance: 0.18, critMultiplier: 1.9, evasion: 0.15, attackCooldownMs: 400, attackRange: 46 },
      growth: { maxHp: 18, maxMp: 5, attack: 2.6, defense: 0.6, magic: 0.6 },
      weaponId: 'kageTwinBlades',
      armorId: 'shinobiWraps',
      skillIds: ['shuriken', 'smokeBomb', 'shadowStep'],
      passive: { id: 'shadowstep', name: 'Shadowstep', description: '+15% evasion, and attacks from stealth always crit.', mods: { evasion: 0.15 } },
      look: { skin: '#e8bd93', hair: '#221a2a', primary: '#232838', secondary: '#3a4258', cloth: '#141822', accent: '#c23b3b', metal: '#b0b8cc', weapon: 'dual-blades', hood: true, scarf: true }
    },

    dragonKnight: {
      id: 'dragonKnight',
      name: 'Dragon Knight',
      emblem: '\u2694',
      role: 'Melee \u00B7 Ultimate',
      difficulty: 3,
      difficultyLabel: 'Normal',
      attackType: 'melee',
      description: 'A knight of the Wyrmguard, bound to a dragon bloodline older than any kingdom.',
      playstyle: 'Heavy armour, powerful strikes and the most destructive ultimate in the game.',
      base: { maxHp: 135, maxMp: 40, attack: 14, defense: 6, magic: 7, speed: 170, critChance: 0.1, critMultiplier: 1.75, evasion: 0.03, attackCooldownMs: 720, attackRange: 50 },
      growth: { maxHp: 25, maxMp: 5, attack: 2.8, defense: 1.2, magic: 1.2 },
      weaponId: 'wyrmfangGreatsword',
      armorId: 'dragonplate',
      skillIds: ['dragonCleave', 'wyrmGuard', 'dragonsBreath'],
      passive: { id: 'dragonblood', name: 'Dragonblood', description: 'Takes 10% less damage; scales resist magic.', mods: { damageReduction: 0.1, magicResist: 0.1 } },
      look: { skin: '#e8b183', hair: '#2b1f2e', primary: '#6b1f24', secondary: '#8f2f30', cloth: '#3a1418', accent: '#d9a05a', metal: '#a98546', weapon: 'dragon-greatsword', helm: true, horns: true, cape: true }
    }
  };

  /** Which class a fresh player gets if they never open the selection screen. */
  const DEFAULT_CLASS = 'warrior';

  /* ============================================================
   * 9. MONSTERS
   * ========================================================== */
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

  /* ============================================================
   * 10. ZONES
   * ========================================================== */
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
    ITEMS,
    PROJECTILES,
    SKILLS,
    CLASSES,
    DEFAULT_CLASS,
    MONSTERS,
    ZONES,
    activeZone: 'verdantHollow',
    activeMonster: 'greenSlime',

    /* Helpers used by the UI and the engine. */
    getClass: function (id) { return CLASSES[id] || null; },
    getSkill: function (id) { return SKILLS[id] || null; },
    getItem: function (id) { return ITEMS.weapons[id] || ITEMS.armors[id] || null; },
    classList: function () { return Object.keys(CLASSES).map(function (id) { return CLASSES[id]; }); },
    /** Weapon + armor bonuses summed into one object. */
    gearBonus: function (classDef) {
      const total = {};
      [classDef.weaponId, classDef.armorId].forEach(function (id) {
        const item = DATA.getItem(id);
        if (!item || !item.bonus) return;
        Object.keys(item.bonus).forEach(function (key) {
          total[key] = (total[key] || 0) + item.bonus[key];
        });
      });
      return total;
    },
    /** Base stats + gear, rounded for display. */
    effectiveBaseStats: function (classDef) {
      const bonus = DATA.gearBonus(classDef);
      const out = {};
      ['maxHp', 'maxMp', 'attack', 'defense', 'magic', 'speed'].forEach(function (key) {
        out[key] = Math.round((classDef.base[key] || 0) + (bonus[key] || 0));
      });
      return out;
    }
  };

  root.MYTHARA_DATA = DATA;
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;

})(typeof globalThis !== 'undefined' ? globalThis : this);
