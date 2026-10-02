/* ============================================================
 * Mythara Online — js/data-enemies.js
 * ------------------------------------------------------------
 * Every enemy and boss in the adventure, as pure data.
 *
 *   body    — which procedural sprite the renderer draws
 *             blob | humanoid | beast | arachnid | treant | golem |
 *             bat | serpent | wraith | scorpion | elemental
 *   base    — stats at the enemy's reference level (stages scale them)
 *   abilities — telegraphed special moves the battle AI can trigger
 *   flags   — flying / armored / undead / demon (used for visuals + quirks)
 *
 * All creatures are original designs for Mythara Online.
 * ============================================================ */
(function (root) {
  'use strict';

  const ENEMIES = {
    /* ================= CHAPTER 1 — Silverstone Beginning ================= */
    forestGoblin: {
      id: 'forestGoblin', name: 'Forest Goblin', body: 'humanoid', tier: 'mob', size: 0.92,
      base: { maxHp: 46, attack: 7, defense: 1, speed: 74, xp: 12, coins: 6 },
      palette: { primary: '#6fae4a', secondary: '#3f7a33', dark: '#2c5626', eye: '#ffe27a', accent: '#b5763a' },
      weapon: 'club', horns: false,
      abilities: [{ type: 'shoot', projectile: 'goblinStone', cooldownMs: 4200, range: 300, windupMs: 600 }]
    },
    wildWolf: {
      id: 'wildWolf', name: 'Wild Wolf', body: 'beast', tier: 'mob', size: 1.0,
      base: { maxHp: 52, attack: 9, defense: 2, speed: 108, xp: 15, coins: 7 },
      palette: { primary: '#8a7a68', secondary: '#5d5145', dark: '#3a322a', eye: '#ffd76a' },
      abilities: [{ type: 'dash', multiplier: 1.6, cooldownMs: 5200, range: 260, speed: 2.6 }]
    },
    goblinKing: {
      id: 'goblinKing', name: 'Goblin King', body: 'humanoid', tier: 'boss', size: 1.7,
      base: { maxHp: 420, attack: 13, defense: 4, speed: 78, xp: 120, coins: 80 },
      palette: { primary: '#7fbb52', secondary: '#3f7a33', dark: '#24471f', eye: '#ff6b4a', accent: '#f2c14e' },
      weapon: 'greatclub', horns: false, crown: true, boss: true,
      abilities: [
        { type: 'aoe', name: 'Ground Pound', radius: 105, multiplier: 1.5, cooldownMs: 6500, windupMs: 800, shake: 8 },
        { type: 'summon', summon: 'forestGoblin', count: 2, cooldownMs: 12000 }
      ],
      phases: [{ hpPct: 0.5, enrage: 0.3, text: 'The Goblin King flies into a rage!' }]
    },

    /* ================= CHAPTER 2 — Ancient Forest ================= */
    treant: {
      id: 'treant', name: 'Treant', body: 'treant', tier: 'mob', size: 1.15,
      base: { maxHp: 96, attack: 10, defense: 6, speed: 52, xp: 24, coins: 11 },
      palette: { primary: '#5d7a3a', secondary: '#3d5a24', dark: '#26381a', eye: '#c8e06a', accent: '#7a5230' },
      abilities: [{ type: 'aoe', name: 'Root Slam', radius: 84, multiplier: 1.35, cooldownMs: 6200, windupMs: 700 }]
    },
    poisonSpider: {
      id: 'poisonSpider', name: 'Poison Spider', body: 'arachnid', tier: 'mob', size: 0.95,
      base: { maxHp: 62, attack: 11, defense: 3, speed: 96, xp: 22, coins: 10 },
      palette: { primary: '#6b3f7a', secondary: '#452a52', dark: '#2a1832', eye: '#9be36a', accent: '#9be36a' },
      abilities: [{ type: 'shoot', projectile: 'poisonSpit', cooldownMs: 3600, range: 320, windupMs: 500 }]
    },
    forestBeast: {
      id: 'forestBeast', name: 'Forest Beast', body: 'beast', tier: 'elite', size: 1.25,
      base: { maxHp: 130, attack: 14, defense: 5, speed: 104, xp: 34, coins: 16 },
      palette: { primary: '#4f7a45', secondary: '#33512c', dark: '#20351c', eye: '#ffb347', horns: true },
      abilities: [
        { type: 'dash', multiplier: 1.8, cooldownMs: 4800, range: 280, speed: 3.0 },
        { type: 'aoe', name: 'Rend', radius: 70, multiplier: 1.2, cooldownMs: 7000, windupMs: 500 }
      ]
    },
    ancientForestGuardian: {
      id: 'ancientForestGuardian', name: 'Ancient Forest Guardian', body: 'treant', tier: 'boss', size: 1.95,
      base: { maxHp: 760, attack: 18, defense: 9, speed: 58, xp: 260, coins: 170 },
      palette: { primary: '#4f7a3a', secondary: '#2f4f22', dark: '#1d3216', eye: '#c8ff8a', accent: '#8a6a3a' },
      boss: true, aura: '#8ad06a',
      abilities: [
        { type: 'aoe', name: 'Verdant Wrath', radius: 120, multiplier: 1.7, cooldownMs: 6200, windupMs: 850, shake: 9 },
        { type: 'summon', summon: 'poisonSpider', count: 2, cooldownMs: 13000 },
        { type: 'shoot', projectile: 'thornVolley', cooldownMs: 4200, range: 420, windupMs: 600, count: 3 }
      ],
      phases: [
        { hpPct: 0.65, enrage: 0.15, text: 'Roots burst from the earth!' },
        { hpPct: 0.3, enrage: 0.35, text: 'The Guardian awakens fully!' }
      ]
    },

    /* ================= CHAPTER 3 — Dark Caverns ================= */
    caveBat: {
      id: 'caveBat', name: 'Cave Bat', body: 'bat', tier: 'mob', size: 0.85,
      base: { maxHp: 74, attack: 13, defense: 3, speed: 132, xp: 30, coins: 13 },
      palette: { primary: '#5a4a6b', secondary: '#3a2f48', dark: '#241c2e', eye: '#ff6b6b' },
      flying: true,
      abilities: [{ type: 'dash', multiplier: 1.5, cooldownMs: 3800, range: 320, speed: 3.4 }]
    },
    stoneGolem: {
      id: 'stoneGolem', name: 'Stone Golem', body: 'golem', tier: 'mob', size: 1.3,
      base: { maxHp: 165, attack: 15, defense: 12, speed: 46, xp: 40, coins: 18 },
      palette: { primary: '#7a7f8c', secondary: '#565b66', dark: '#373b44', eye: '#8fe3ff' },
      armored: true,
      abilities: [{ type: 'aoe', name: 'Stone Crash', radius: 92, multiplier: 1.6, cooldownMs: 6800, windupMs: 780, shake: 7 }]
    },
    shadowBeast: {
      id: 'shadowBeast', name: 'Shadow Beast', body: 'beast', tier: 'elite', size: 1.2,
      base: { maxHp: 160, attack: 19, defense: 6, speed: 112, xp: 48, coins: 22 },
      palette: { primary: '#3a2f56', secondary: '#251d3a', dark: '#151024', eye: '#c46bff' },
      aura: '#8a5cff',
      abilities: [
        { type: 'dash', multiplier: 2.0, cooldownMs: 4600, range: 300, speed: 3.2 },
        { type: 'shoot', projectile: 'shadowBolt', cooldownMs: 5000, range: 340, windupMs: 550 }
      ]
    },
    caveOverlord: {
      id: 'caveOverlord', name: 'Cave Overlord', body: 'golem', tier: 'boss', size: 2.05,
      base: { maxHp: 1150, attack: 24, defense: 14, speed: 54, xp: 420, coins: 280 },
      palette: { primary: '#5f6472', secondary: '#41454f', dark: '#26292f', eye: '#ff8a3a' },
      boss: true, armored: true, aura: '#ff8a3a',
      abilities: [
        { type: 'aoe', name: 'Seismic Slam', radius: 135, multiplier: 1.8, cooldownMs: 6000, windupMs: 900, shake: 11 },
        { type: 'summon', summon: 'caveBat', count: 3, cooldownMs: 12000 },
        { type: 'shoot', projectile: 'rockShard', cooldownMs: 3800, range: 460, windupMs: 520, count: 2 }
      ],
      phases: [
        { hpPct: 0.6, enrage: 0.2, text: 'The Overlord hardens its shell!' },
        { hpPct: 0.25, enrage: 0.4, text: 'The cavern shakes with fury!' }
      ]
    },

    /* ================= CHAPTER 4 — Frozen Valley ================= */
    iceWolf: {
      id: 'iceWolf', name: 'Ice Wolf', body: 'beast', tier: 'mob', size: 1.0,
      base: { maxHp: 96, attack: 17, defense: 5, speed: 118, xp: 38, coins: 16 },
      palette: { primary: '#cfe8f7', secondary: '#8fbedd', dark: '#4f7d9e', eye: '#7fdcff' },
      abilities: [{ type: 'dash', multiplier: 1.7, cooldownMs: 4600, range: 280, speed: 2.9 }]
    },
    frostGoblin: {
      id: 'frostGoblin', name: 'Frost Goblin', body: 'humanoid', tier: 'mob', size: 0.92,
      base: { maxHp: 88, attack: 16, defense: 4, speed: 80, xp: 36, coins: 15 },
      palette: { primary: '#7fb8d6', secondary: '#4a7f9e', dark: '#2f536b', eye: '#eafaff', accent: '#cfe8f7' },
      weapon: 'axe',
      abilities: [{ type: 'shoot', projectile: 'iceShard', cooldownMs: 3800, range: 320, windupMs: 520 }]
    },
    frozenGolem: {
      id: 'frozenGolem', name: 'Frozen Golem', body: 'golem', tier: 'elite', size: 1.35,
      base: { maxHp: 230, attack: 19, defense: 16, speed: 48, xp: 62, coins: 28 },
      palette: { primary: '#9fd0e6', secondary: '#6ba3c0', dark: '#3f6d87', eye: '#ffffff' },
      armored: true,
      abilities: [{ type: 'aoe', name: 'Frost Crush', radius: 96, multiplier: 1.55, cooldownMs: 6600, windupMs: 760, shake: 7, apply: { slow: { factor: 0.3, durationMs: 2500 } } }]
    },
    frostQueen: {
      id: 'frostQueen', name: 'Frost Queen', body: 'humanoid', tier: 'boss', size: 1.85,
      base: { maxHp: 1650, attack: 28, defense: 12, speed: 84, xp: 620, coins: 400 },
      palette: { primary: '#bfe6f7', secondary: '#7fb8d6', dark: '#3f6d87', eye: '#7fdcff', accent: '#ffffff' },
      boss: true, aura: '#7fdcff', crown: true, robe: true, weapon: 'staff',
      abilities: [
        { type: 'shoot', projectile: 'iceShard', cooldownMs: 2800, range: 480, windupMs: 480, count: 3, spread: 0.22 },
        { type: 'aoe', name: 'Glacial Bloom', radius: 140, multiplier: 1.7, cooldownMs: 7000, windupMs: 900, apply: { freezeMs: 900 }, shake: 9 },
        { type: 'summon', summon: 'iceWolf', count: 2, cooldownMs: 14000 }
      ],
      phases: [
        { hpPct: 0.6, enrage: 0.2, text: 'The Queen summons a blizzard!' },
        { hpPct: 0.25, enrage: 0.4, text: 'Absolute zero approaches!' }
      ]
    },

    /* ================= CHAPTER 5 — Desert Ruins ================= */
    sandScorpion: {
      id: 'sandScorpion', name: 'Sand Scorpion', body: 'scorpion', tier: 'mob', size: 1.05,
      base: { maxHp: 120, attack: 21, defense: 7, speed: 92, xp: 46, coins: 20 },
      palette: { primary: '#d9b26a', secondary: '#a8863a', dark: '#6b5522', eye: '#ff6b4a' },
      abilities: [{ type: 'shoot', projectile: 'poisonSpit', cooldownMs: 3600, range: 300, windupMs: 520 }]
    },
    desertRaider: {
      id: 'desertRaider', name: 'Desert Raider', body: 'humanoid', tier: 'mob', size: 1.0,
      base: { maxHp: 130, attack: 23, defense: 8, speed: 96, xp: 48, coins: 21 },
      palette: { primary: '#c9a06a', secondary: '#8a6a3a', dark: '#543f22', eye: '#f2c14e', accent: '#b3370d' },
      weapon: 'sword',
      abilities: [{ type: 'dash', multiplier: 1.75, cooldownMs: 5000, range: 300, speed: 2.9 }]
    },
    sandGolem: {
      id: 'sandGolem', name: 'Sand Golem', body: 'golem', tier: 'elite', size: 1.4,
      base: { maxHp: 300, attack: 24, defense: 18, speed: 50, xp: 78, coins: 34 },
      palette: { primary: '#e0c48a', secondary: '#b39a5f', dark: '#6f5c33', eye: '#ffb347' },
      armored: true,
      abilities: [{ type: 'aoe', name: 'Sand Burst', radius: 110, multiplier: 1.6, cooldownMs: 6400, windupMs: 780, shake: 8 }]
    },
    ancientSandKing: {
      id: 'ancientSandKing', name: 'Ancient Sand King', body: 'golem', tier: 'boss', size: 2.1,
      base: { maxHp: 2300, attack: 33, defense: 20, speed: 58, xp: 900, coins: 560 },
      palette: { primary: '#e8cf95', secondary: '#b89a4f', dark: '#6f5c22', eye: '#ff9b4a', accent: '#f2c14e' },
      boss: true, armored: true, crown: true, aura: '#ffb347',
      abilities: [
        { type: 'aoe', name: 'Sandstorm', radius: 150, multiplier: 1.9, cooldownMs: 6000, windupMs: 900, shake: 11, apply: { slow: { factor: 0.3, durationMs: 2500 } } },
        { type: 'summon', summon: 'sandScorpion', count: 3, cooldownMs: 13000 },
        { type: 'shoot', projectile: 'rockShard', cooldownMs: 3400, range: 500, windupMs: 500, count: 3 }
      ],
      phases: [
        { hpPct: 0.6, enrage: 0.25, text: 'The ruins tremble!' },
        { hpPct: 0.25, enrage: 0.45, text: 'The Sand King unleashes the desert!' }
      ]
    },

    /* ================= CHAPTER 6 — Haunted Swamp ================= */
    swampSlime: {
      id: 'swampSlime', name: 'Swamp Slime', body: 'blob', tier: 'mob', size: 1.05,
      base: { maxHp: 165, attack: 24, defense: 9, speed: 62, xp: 54, coins: 23 },
      palette: { primary: '#6fae5a', secondary: '#3f6d33', dark: '#24401f', eye: '#e8ffb0' },
      abilities: [{ type: 'shoot', projectile: 'poisonSpit', cooldownMs: 4000, range: 280, windupMs: 560 }]
    },
    poisonBeast: {
      id: 'poisonBeast', name: 'Poison Beast', body: 'beast', tier: 'mob', size: 1.15,
      base: { maxHp: 180, attack: 27, defense: 10, speed: 100, xp: 58, coins: 25 },
      palette: { primary: '#7a8a3a', secondary: '#4f5c22', dark: '#2e3514', eye: '#9be36a', horns: true },
      abilities: [
        { type: 'dash', multiplier: 1.8, cooldownMs: 4800, range: 300, speed: 3.0 },
        { type: 'aoe', name: 'Venom Spray', radius: 88, multiplier: 1.3, cooldownMs: 6600, windupMs: 620, apply: { poison: { dpsPct: 0.25, durationMs: 4000 } } }
      ]
    },
    undeadWarrior: {
      id: 'undeadWarrior', name: 'Undead Warrior', body: 'humanoid', tier: 'elite', size: 1.1,
      base: { maxHp: 320, attack: 31, defense: 14, speed: 78, xp: 92, coins: 40 },
      palette: { primary: '#8a9a8a', secondary: '#5a6b5a', dark: '#33402f', eye: '#9be36a', accent: '#6b5522' },
      undead: true, weapon: 'sword',
      abilities: [{ type: 'aoe', name: 'Grave Cleave', radius: 96, multiplier: 1.7, cooldownMs: 6000, windupMs: 700, shake: 7 }]
    },
    swampDemon: {
      id: 'swampDemon', name: 'Swamp Demon', body: 'humanoid', tier: 'boss', size: 2.0,
      base: { maxHp: 3100, attack: 38, defense: 18, speed: 88, xp: 1300, coins: 760 },
      palette: { primary: '#4f7a3a', secondary: '#2f4f22', dark: '#1d3216', eye: '#c46bff', accent: '#9be36a' },
      boss: true, horns: true, demon: true, aura: '#7ad06a', wings: true,
      abilities: [
        { type: 'aoe', name: 'Miasma', radius: 145, multiplier: 1.85, cooldownMs: 6200, windupMs: 880, apply: { poison: { dpsPct: 0.3, durationMs: 5000 } }, shake: 10 },
        { type: 'shoot', projectile: 'poisonSpit', cooldownMs: 3000, range: 460, windupMs: 480, count: 3, spread: 0.2 },
        { type: 'summon', summon: 'undeadWarrior', count: 2, cooldownMs: 14000 }
      ],
      phases: [
        { hpPct: 0.6, enrage: 0.25, text: 'The swamp boils!' },
        { hpPct: 0.25, enrage: 0.45, text: 'The Demon sheds its mortal shell!' }
      ]
    },

    /* ================= CHAPTER 7 — Demon Castle ================= */
    demonSoldier: {
      id: 'demonSoldier', name: 'Demon Soldier', body: 'humanoid', tier: 'mob', size: 1.05,
      base: { maxHp: 230, attack: 32, defense: 13, speed: 92, xp: 70, coins: 30 },
      palette: { primary: '#8a3a3a', secondary: '#5c2424', dark: '#331414', eye: '#ffd76a', accent: '#3a2f2f' },
      demon: true, horns: true, weapon: 'sword',
      abilities: [{ type: 'dash', multiplier: 1.85, cooldownMs: 4600, range: 320, speed: 3.0 }]
    },
    darkMage: {
      id: 'darkMage', name: 'Dark Mage', body: 'humanoid', tier: 'mob', size: 1.0,
      base: { maxHp: 200, attack: 36, defense: 9, speed: 74, xp: 74, coins: 32 },
      palette: { primary: '#3f2f5c', secondary: '#281d3d', dark: '#171024', eye: '#c46bff', accent: '#8a5cff' },
      robe: true, weapon: 'staff',
      abilities: [{ type: 'shoot', projectile: 'voidOrb', cooldownMs: 3400, range: 420, windupMs: 620 }]
    },
    demonBeast: {
      id: 'demonBeast', name: 'Demon Beast', body: 'beast', tier: 'elite', size: 1.3,
      base: { maxHp: 420, attack: 41, defense: 16, speed: 108, xp: 120, coins: 52 },
      palette: { primary: '#7a2f2f', secondary: '#4f1d1d', dark: '#2b1010', eye: '#ff9b4a', horns: true },
      demon: true,
      abilities: [
        { type: 'dash', multiplier: 2.0, cooldownMs: 4400, range: 320, speed: 3.3 },
        { type: 'aoe', name: 'Hellfire', radius: 110, multiplier: 1.6, cooldownMs: 6400, windupMs: 700, apply: { burn: { dpsPct: 0.2, durationMs: 4000 } } }
      ]
    },
    demonGeneral: {
      id: 'demonGeneral', name: 'Demon General', body: 'humanoid', tier: 'boss', size: 2.05,
      base: { maxHp: 4200, attack: 46, defense: 22, speed: 94, xp: 1900, coins: 1000 },
      palette: { primary: '#6b1f24', secondary: '#42121a', dark: '#260a0e', eye: '#ffd76a', accent: '#f2c14e' },
      boss: true, demon: true, horns: true, wings: true, weapon: 'greataxe', aura: '#ff5f3a',
      abilities: [
        { type: 'aoe', name: 'Infernal Cleave', radius: 140, multiplier: 1.95, cooldownMs: 5800, windupMs: 850, shake: 11 },
        { type: 'shoot', projectile: 'voidOrb', cooldownMs: 3000, range: 500, windupMs: 460, count: 3, spread: 0.25 },
        { type: 'summon', summon: 'demonSoldier', count: 3, cooldownMs: 13000 }
      ],
      phases: [
        { hpPct: 0.7, enrage: 0.2, text: 'The General rallies his legion!' },
        { hpPct: 0.35, enrage: 0.45, text: 'Infernal power floods the hall!' }
      ]
    },

    /* ================= CHAPTER 8 — Dragon Mountain ================= */
    dragonWhelp: {
      id: 'dragonWhelp', name: 'Dragon Whelp', body: 'serpent', tier: 'mob', size: 0.95,
      base: { maxHp: 280, attack: 40, defense: 14, speed: 104, xp: 88, coins: 38 },
      palette: { primary: '#c8562a', secondary: '#8a3418', dark: '#4f1c0c', eye: '#ffe27a', accent: '#f2c14e' },
      flying: true, wings: true,
      abilities: [{ type: 'shoot', projectile: 'fireBreath', cooldownMs: 3600, range: 380, windupMs: 620 }]
    },
    fireBeast: {
      id: 'fireBeast', name: 'Fire Beast', body: 'beast', tier: 'mob', size: 1.2,
      base: { maxHp: 320, attack: 44, defense: 15, speed: 100, xp: 94, coins: 40 },
      palette: { primary: '#e2683a', secondary: '#a83f1c', dark: '#5c200c', eye: '#fff3c0', horns: true },
      aura: '#ff7a3a',
      abilities: [{ type: 'aoe', name: 'Flame Burst', radius: 100, multiplier: 1.6, cooldownMs: 6200, windupMs: 640, apply: { burn: { dpsPct: 0.22, durationMs: 4000 } } }]
    },
    dragonKnightEnemy: {
      id: 'dragonKnightEnemy', name: 'Dragon Knight', body: 'humanoid', tier: 'elite', size: 1.25,
      base: { maxHp: 620, attack: 50, defense: 24, speed: 92, xp: 170, coins: 74 },
      palette: { primary: '#8f2f30', secondary: '#5f1f20', dark: '#351010', eye: '#ffd76a', accent: '#d9a05a' },
      armored: true, weapon: 'greatsword', horns: true,
      abilities: [
        { type: 'dash', multiplier: 2.0, cooldownMs: 4600, range: 340, speed: 3.2 },
        { type: 'aoe', name: 'Wyrm Cleave', radius: 120, multiplier: 1.75, cooldownMs: 6000, windupMs: 720, shake: 8 }
      ]
    },
    ancientDragon: {
      id: 'ancientDragon', name: 'Ancient Dragon', body: 'serpent', tier: 'boss', size: 2.4,
      base: { maxHp: 5800, attack: 56, defense: 26, speed: 86, xp: 2600, coins: 1400 },
      palette: { primary: '#b3370d', secondary: '#7a230a', dark: '#3f1206', eye: '#fff3c0', accent: '#f2c14e' },
      boss: true, wings: true, horns: true, aura: '#ff7a3a',
      abilities: [
        { type: 'shoot', projectile: 'fireBreath', cooldownMs: 2600, range: 520, windupMs: 460, count: 3, spread: 0.2 },
        { type: 'aoe', name: "Dragon's Fury", radius: 160, multiplier: 2.1, cooldownMs: 6200, windupMs: 900, shake: 12, apply: { burn: { dpsPct: 0.25, durationMs: 5000 } } },
        { type: 'summon', summon: 'dragonWhelp', count: 2, cooldownMs: 15000 }
      ],
      phases: [
        { hpPct: 0.7, enrage: 0.2, text: 'The Ancient Dragon takes flight!' },
        { hpPct: 0.4, enrage: 0.35, text: 'Molten fury erupts!' },
        { hpPct: 0.15, enrage: 0.55, text: 'The mountain itself burns!' }
      ]
    },

    /* ================= CHAPTER 9 — Shadow Realm ================= */
    shadowAssassin: {
      id: 'shadowAssassin', name: 'Shadow Assassin', body: 'humanoid', tier: 'mob', size: 1.0,
      base: { maxHp: 340, attack: 52, defense: 16, speed: 128, xp: 110, coins: 46 },
      palette: { primary: '#2b2440', secondary: '#1a1530', dark: '#0f0b1e', eye: '#c46bff', accent: '#8a5cff' },
      weapon: 'daggers',
      abilities: [{ type: 'dash', multiplier: 2.1, cooldownMs: 4200, range: 360, speed: 3.6 }]
    },
    voidBeast: {
      id: 'voidBeast', name: 'Void Beast', body: 'beast', tier: 'mob', size: 1.25,
      base: { maxHp: 420, attack: 55, defense: 18, speed: 110, xp: 118, coins: 48 },
      palette: { primary: '#3a2f56', secondary: '#251d3a', dark: '#141024', eye: '#c46bff', horns: true },
      aura: '#8a5cff',
      abilities: [
        { type: 'shoot', projectile: 'voidOrb', cooldownMs: 3400, range: 400, windupMs: 560 },
        { type: 'dash', multiplier: 1.9, cooldownMs: 5000, range: 320, speed: 3.1 }
      ]
    },
    darkSpirit: {
      id: 'darkSpirit', name: 'Dark Spirit', body: 'wraith', tier: 'elite', size: 1.15,
      base: { maxHp: 560, attack: 60, defense: 20, speed: 96, xp: 210, coins: 88 },
      palette: { primary: '#4a3f6b', secondary: '#2f2850', dark: '#1a1533', eye: '#c46bff' },
      undead: true, flying: true, aura: '#8a5cff',
      abilities: [
        { type: 'shoot', projectile: 'shadowBolt', cooldownMs: 3000, range: 440, windupMs: 520, count: 2 },
        { type: 'aoe', name: 'Soul Drain', radius: 110, multiplier: 1.7, cooldownMs: 6400, windupMs: 700, heal: 0.15 }
      ]
    },
    shadowLord: {
      id: 'shadowLord', name: 'Shadow Lord', body: 'wraith', tier: 'boss', size: 2.2,
      base: { maxHp: 7600, attack: 66, defense: 30, speed: 92, xp: 3400, coins: 1900 },
      palette: { primary: '#3a2f5c', secondary: '#231a3d', dark: '#120d22', eye: '#ff5fd7', accent: '#c46bff' },
      boss: true, undead: true, aura: '#c46bff', crown: true,
      abilities: [
        { type: 'shoot', projectile: 'shadowBolt', cooldownMs: 2400, range: 520, windupMs: 440, count: 3, spread: 0.24 },
        { type: 'aoe', name: 'Umbral Nova', radius: 165, multiplier: 2.05, cooldownMs: 6000, windupMs: 880, shake: 12 },
        { type: 'summon', summon: 'shadowAssassin', count: 3, cooldownMs: 14000 },
        { type: 'teleport', cooldownMs: 9000 }
      ],
      phases: [
        { hpPct: 0.7, enrage: 0.2, text: 'The Shadow Lord splits the veil!' },
        { hpPct: 0.4, enrage: 0.4, text: 'Darkness devours the arena!' },
        { hpPct: 0.15, enrage: 0.6, text: 'The realm itself strikes back!' }
      ]
    },

    /* ================= CHAPTER 10 — Mythara's End ================= */
    eliteDemon: {
      id: 'eliteDemon', name: 'Elite Demon', body: 'humanoid', tier: 'mob', size: 1.15,
      base: { maxHp: 620, attack: 62, defense: 26, speed: 104, xp: 160, coins: 66 },
      palette: { primary: '#6b1f24', secondary: '#42121a', dark: '#240a0e', eye: '#ffd76a', accent: '#f2c14e' },
      demon: true, horns: true, wings: true, weapon: 'greataxe',
      abilities: [{ type: 'aoe', name: 'Ruinous Sweep', radius: 110, multiplier: 1.8, cooldownMs: 5800, windupMs: 700, shake: 8 }]
    },
    ancientGuardian: {
      id: 'ancientGuardian', name: 'Ancient Guardian', body: 'golem', tier: 'mob', size: 1.45,
      base: { maxHp: 900, attack: 58, defense: 38, speed: 56, xp: 190, coins: 80 },
      palette: { primary: '#8a8f9c', secondary: '#5f6472', dark: '#383c46', eye: '#f2c14e', accent: '#f2c14e' },
      armored: true,
      abilities: [
        { type: 'aoe', name: 'Guardian Slam', radius: 125, multiplier: 1.85, cooldownMs: 6000, windupMs: 820, shake: 9 },
        { type: 'shoot', projectile: 'rockShard', cooldownMs: 3600, range: 460, windupMs: 520, count: 2 }
      ]
    },
    mythicBeast: {
      id: 'mythicBeast', name: 'Mythic Beast', body: 'beast', tier: 'elite', size: 1.5,
      base: { maxHp: 1250, attack: 74, defense: 32, speed: 116, xp: 320, coins: 130 },
      palette: { primary: '#c46bff', secondary: '#8a3fd6', dark: '#4a1d75', eye: '#fff3c0', horns: true },
      aura: '#c46bff',
      abilities: [
        { type: 'dash', multiplier: 2.2, cooldownMs: 4200, range: 360, speed: 3.5 },
        { type: 'aoe', name: 'Mythic Roar', radius: 140, multiplier: 1.9, cooldownMs: 6200, windupMs: 760, shake: 10 }
      ]
    },
    mytharaLord: {
      id: 'mytharaLord', name: 'MYTHARA LORD', body: 'serpent', tier: 'boss', size: 2.6,
      base: { maxHp: 11000, attack: 82, defense: 36, speed: 98, xp: 6000, coins: 3200 },
      palette: { primary: '#5c1f8a', secondary: '#3a1259', dark: '#1e0930', eye: '#ffd76a', accent: '#f2c14e' },
      boss: true, demon: true, wings: true, horns: true, crown: true, aura: '#c46bff',
      abilities: [
        { type: 'shoot', projectile: 'voidOrb', cooldownMs: 2200, range: 560, windupMs: 420, count: 3, spread: 0.22 },
        { type: 'aoe', name: 'Cataclysm', radius: 185, multiplier: 2.3, cooldownMs: 5800, windupMs: 950, shake: 14 },
        { type: 'summon', summon: 'eliteDemon', count: 3, cooldownMs: 13000 },
        { type: 'teleport', cooldownMs: 8000 }
      ],
      phases: [
        { hpPct: 0.75, enrage: 0.2, text: 'The Lord of Mythara descends!' },
        { hpPct: 0.5, enrage: 0.35, text: 'Reality fractures around him!' },
        { hpPct: 0.25, enrage: 0.55, text: 'The end of Mythara is at hand!' },
        { hpPct: 0.1, enrage: 0.75, text: 'FINAL STAND!' }
      ]
    }
  };

  /** Difficulty presets for the Arena's bot opponents. */
  const ARENA_DIFFICULTIES = [
    { id: 'easy', name: 'Easy', levelOffset: -3, ai: { reactionMs: 620, aggression: 0.45, dodgeChance: 0.10, skillChance: 0.25, ultimateChance: 0.10, speedPct: 0.9 }, rating: 15, rewards: { coins: 90, xp: 60, gems: 1 } },
    { id: 'normal', name: 'Normal', levelOffset: 0, ai: { reactionMs: 460, aggression: 0.6, dodgeChance: 0.18, skillChance: 0.4, ultimateChance: 0.2, speedPct: 1.0 }, rating: 25, rewards: { coins: 140, xp: 95, gems: 2 } },
    { id: 'hard', name: 'Hard', levelOffset: 3, ai: { reactionMs: 340, aggression: 0.72, dodgeChance: 0.28, skillChance: 0.55, ultimateChance: 0.35, speedPct: 1.08 }, rating: 40, rewards: { coins: 210, xp: 150, gems: 3 } },
    { id: 'elite', name: 'Elite', levelOffset: 7, ai: { reactionMs: 240, aggression: 0.85, dodgeChance: 0.38, skillChance: 0.7, ultimateChance: 0.5, speedPct: 1.16 }, rating: 60, rewards: { coins: 320, xp: 240, gems: 5 } },
    { id: 'bossTier', name: 'Boss', levelOffset: 12, ai: { reactionMs: 170, aggression: 0.95, dodgeChance: 0.48, skillChance: 0.85, ultimateChance: 0.7, speedPct: 1.24 }, rating: 90, rewards: { coins: 470, xp: 380, gems: 8 } }
  ];

  const PVP_TIERS = [
    { id: 'bronze', name: 'Bronze', min: 0, color: '#b9834a' },
    { id: 'silver', name: 'Silver', min: 900, color: '#c9d4ea' },
    { id: 'gold', name: 'Gold', min: 1100, color: '#f2c14e' },
    { id: 'platinum', name: 'Platinum', min: 1350, color: '#8fe3ff' },
    { id: 'diamond', name: 'Diamond', min: 1600, color: '#b07bff' },
    { id: 'mythic', name: 'Mythic', min: 1900, color: '#ff5fd7' }
  ];

  const DATA = {
    ENEMIES: ENEMIES,
    ARENA_DIFFICULTIES: ARENA_DIFFICULTIES,
    PVP_TIERS: PVP_TIERS,
    list: function () { return Object.keys(ENEMIES).map(function (id) { return ENEMIES[id]; }); },
    get: function (id) { return ENEMIES[id] || null; },
    arenaDifficulty: function (id) {
      return ARENA_DIFFICULTIES.filter(function (d) { return d.id === id; })[0] || ARENA_DIFFICULTIES[1];
    },
    tierFor: function (rating) {
      let current = PVP_TIERS[0];
      PVP_TIERS.forEach(function (tier) { if (rating >= tier.min) current = tier; });
      return current;
    },
    nextTier: function (rating) {
      return PVP_TIERS.filter(function (tier) { return tier.min > rating; })[0] || null;
    }
  };

  root.MYTHARA_ENEMIES = DATA;
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;

})(typeof globalThis !== 'undefined' ? globalThis : this);
