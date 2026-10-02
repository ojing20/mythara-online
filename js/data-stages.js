/* ============================================================
 * Mythara Online — js/data-stages.js
 * ------------------------------------------------------------
 * Adventure content: 10 chapters × 5 stages = 50 stages.
 *
 * Stages 1–4 are normal stages (4 mob waves + a final enemy wave).
 * Stage 5 of every chapter is the BOSS stage (2 waves, then the boss
 * with its mechanics and phases — see data-enemies.js).
 *
 * Stage records are generated from the chapter table below, which keeps
 * the content editable in one place while still producing distinct
 * per-stage names, waves, rewards and requirements.
 * ============================================================ */
(function (root) {
  'use strict';

  /** Chapter themes — enemies and bosses come from data-enemies.js. */
  const CHAPTERS = [
    {
      id: 'chapter1', index: 1, name: 'Silverstone Beginning',
      tagline: 'The road out of Silverstone is quiet. Too quiet.',
      mobs: ['forestGoblin', 'wildWolf'], elite: 'wildWolf', boss: 'goblinKing',
      material: 'ironOre',
      palette: { sky: ['#4a6fa8', '#bcd3ea'], ground: ['#6cb35f', '#3a6d3c'], accent: '#f2c14e' },
      stageNames: ['Silverstone Outskirts', 'Wolf Den Trail', 'Goblin Camp', 'Broken Watchtower', 'Throne of the Goblin King']
    },
    {
      id: 'chapter2', index: 2, name: 'Ancient Forest',
      tagline: 'Trees older than kingdoms remember every trespasser.',
      mobs: ['treant', 'poisonSpider'], elite: 'forestBeast', boss: 'ancientForestGuardian',
      material: 'beastHide',
      palette: { sky: ['#2f5a44', '#8fc49a'], ground: ['#4f8a4a', '#274f28'], accent: '#9be36a' },
      stageNames: ['Whispering Roots', 'Spider Hollow', 'Beast Grove', 'Heartwood Shrine', "The Guardian's Circle"]
    },
    {
      id: 'chapter3', index: 3, name: 'Dark Caverns',
      tagline: 'Below the roots, the dark has teeth.',
      mobs: ['caveBat', 'stoneGolem'], elite: 'shadowBeast', boss: 'caveOverlord',
      material: 'stoneCore',
      palette: { sky: ['#1f2433', '#4a5266'], ground: ['#4a4f5c', '#20242c'], accent: '#8fe3ff' },
      stageNames: ['Cavern Mouth', 'Bat Warrens', 'Golem Quarry', 'Shadowed Depths', "The Overlord's Hall"]
    },
    {
      id: 'chapter4', index: 4, name: 'Frozen Valley',
      tagline: 'Breath freezes before it leaves your lips.',
      mobs: ['iceWolf', 'frostGoblin'], elite: 'frozenGolem', boss: 'frostQueen',
      material: 'frostShard',
      palette: { sky: ['#4a7fa8', '#dff2ff'], ground: ['#cfe8f7', '#7fa8c4'], accent: '#7fdcff' },
      stageNames: ['Frozen Pass', 'Wolf Icefield', 'Frost Goblin Camp', 'Glacier Vault', "The Queen's Winter Court"]
    },
    {
      id: 'chapter5', index: 5, name: 'Desert Ruins',
      tagline: 'The sand keeps what it takes.',
      mobs: ['sandScorpion', 'desertRaider'], elite: 'sandGolem', boss: 'ancientSandKing',
      material: 'sandGlass',
      palette: { sky: ['#b98a4a', '#f0d9a8'], ground: ['#e0c48a', '#b39a5f'], accent: '#ffb347' },
      stageNames: ['Dune Approach', 'Scorpion Sands', 'Raider Encampment', 'Buried Colonnade', "The Sand King's Tomb"]
    },
    {
      id: 'chapter6', index: 6, name: 'Haunted Swamp',
      tagline: 'Something beneath the water is still awake.',
      mobs: ['swampSlime', 'poisonBeast'], elite: 'undeadWarrior', boss: 'swampDemon',
      material: 'venomSac',
      palette: { sky: ['#2f4a3a', '#7a9a6a'], ground: ['#4f6b3a', '#243a1f'], accent: '#9be36a' },
      stageNames: ['Bog Edge', 'Slime Marsh', 'Poison Fen', 'Drowned Graveyard', "The Demon's Mire"]
    },
    {
      id: 'chapter7', index: 7, name: 'Demon Castle',
      tagline: 'The gates open for you. They always do.',
      mobs: ['demonSoldier', 'darkMage'], elite: 'demonBeast', boss: 'demonGeneral',
      material: 'demonHorn',
      palette: { sky: ['#3a1f24', '#8a4a4a'], ground: ['#4a2a2a', '#241414'], accent: '#ff5f3a' },
      stageNames: ['Black Gate', 'Soldier Barracks', 'Dark Sanctum', 'Beast Kennels', "The General's Throne"]
    },
    {
      id: 'chapter8', index: 8, name: 'Dragon Mountain',
      tagline: 'The mountain is not a mountain.',
      mobs: ['dragonWhelp', 'fireBeast'], elite: 'dragonKnightEnemy', boss: 'ancientDragon',
      material: 'dragonScale',
      palette: { sky: ['#5c2a1c', '#d98a5a'], ground: ['#6b3f2a', '#2f1a12'], accent: '#ff7a3a' },
      stageNames: ['Ashen Foothills', 'Whelp Nest', 'Fire Ravine', "Knight's Perch", "The Ancient's Peak"]
    },
    {
      id: 'chapter9', index: 9, name: 'Shadow Realm',
      tagline: 'Here, your shadow walks a step behind you.',
      mobs: ['shadowAssassin', 'voidBeast'], elite: 'darkSpirit', boss: 'shadowLord',
      material: 'voidShard',
      palette: { sky: ['#1a1530', '#5c4a8a'], ground: ['#2f2850', '#120d22'], accent: '#c46bff' },
      stageNames: ['Veil Threshold', 'Umbral Gardens', 'Void Expanse', 'Spirit Choir', "The Shadow Lord's Court"]
    },
    {
      id: 'chapter10', index: 10, name: "Mythara's End",
      tagline: 'Everything you have fought for ends here.',
      mobs: ['eliteDemon', 'ancientGuardian'], elite: 'mythicBeast', boss: 'mytharaLord',
      material: 'mythicCore',
      palette: { sky: ['#2b1440', '#8a5cff'], ground: ['#3a1259', '#160725'], accent: '#ffd76a' },
      stageNames: ['Last Road', 'Guardian Gate', 'Legion of Ashes', 'Shattered Spire', "Mythara's End"]
    }
  ];

  const STAGE_COUNT_PER_CHAPTER = 5;
  const BOSS_STAGE_INDEX = 5;

  /** Ids like "c3-4" for chapter 3 stage 4. */
  function stageId(chapterIndex, stageIndex) {
    return 'c' + chapterIndex + '-' + stageIndex;
  }

  function buildNormalWaves(chapter, stageIndex) {
    const mobA = chapter.mobs[0];
    const mobB = chapter.mobs[1];
    const extra = Math.floor(stageIndex / 2);          // later stages are heavier
    return [
      { label: 'Wave 1', enemies: [{ id: mobA, count: 3 }] },
      { label: 'Wave 2', enemies: [{ id: mobA, count: 2 }, { id: mobB, count: 1 }] },
      { label: 'Wave 3', enemies: [{ id: mobA, count: 2 }, { id: mobB, count: 2 }] },
      { label: 'Wave 4', enemies: [{ id: mobB, count: 3 }, { id: chapter.elite, count: 1 + (extra > 0 ? 1 : 0) }] },
      { label: 'Final Wave', enemies: [{ id: chapter.elite, count: 2 + extra }], final: true }
    ];
  }

  function buildBossWaves(chapter) {
    const mobA = chapter.mobs[0];
    const mobB = chapter.mobs[1];
    return [
      { label: 'Wave 1', enemies: [{ id: mobA, count: 3 }] },
      { label: 'Wave 2', enemies: [{ id: mobA, count: 2 }, { id: mobB, count: 2 }] },
      { label: 'BOSS', enemies: [{ id: chapter.boss, count: 1, boss: true }], boss: true }
    ];
  }

  function buildRewards(chapter, stageIndex, isBoss) {
    const base = { coins: 45 + chapter.index * 38 + stageIndex * 12, xp: 32 + chapter.index * 30 + stageIndex * 10 };
    const materials = [
      { id: chapter.material, count: isBoss ? 4 : 1 + Math.floor(chapter.index / 3) },
      { id: 'upgradeStone', count: isBoss ? 3 : 1 }
    ];
    const rewards = {
      coins: Math.round(base.coins * (isBoss ? 2.4 : 1)),
      xp: Math.round(base.xp * (isBoss ? 2.6 : 1)),
      gems: isBoss ? 12 + chapter.index * 2 : (stageIndex === 3 ? 3 : 1),
      materials: materials,
      equipmentChance: isBoss ? 1 : 0.35,
      equipmentRarityBoost: isBoss ? chapter.index * 0.02 : 0
    };
    if (isBoss) rewards.tickets = chapter.index >= 5 ? 1 : 0;
    return rewards;
  }

  /** Build every stage record once at load time. */
  const STAGES = [];
  const CHAPTERS_BY_ID = {};

  CHAPTERS.forEach(function (chapter) {
    chapter.stages = [];
    CHAPTERS_BY_ID[chapter.id] = chapter;

    for (let stageIndex = 1; stageIndex <= STAGE_COUNT_PER_CHAPTER; stageIndex++) {
      const isBoss = stageIndex === BOSS_STAGE_INDEX;
      const level = (chapter.index - 1) * 10 + stageIndex;
      const stage = {
        id: stageId(chapter.index, stageIndex),
        chapterId: chapter.id,
        chapterIndex: chapter.index,
        chapterName: chapter.name,
        index: stageIndex,
        name: chapter.stageNames[stageIndex - 1],
        isBoss: isBoss,
        level: level,
        recommendedLevel: level,
        recommendedPower: Math.round(70 + level * 26 + chapter.index * 12),
        energy: isBoss ? 10 : 6,
        waves: isBoss ? buildBossWaves(chapter) : buildNormalWaves(chapter, stageIndex),
        enemyPreview: isBoss
          ? [chapter.boss].concat(chapter.mobs.slice(0, 1))
          : [chapter.mobs[0], chapter.mobs[1], chapter.elite],
        rewards: buildRewards(chapter, stageIndex, isBoss),
        palette: chapter.palette,
        material: chapter.material
      };
      chapter.stages.push(stage);
      STAGES.push(stage);
    }
  });

  const DATA = {
    CHAPTERS: CHAPTERS,
    STAGES: STAGES,
    STAGE_COUNT_PER_CHAPTER: STAGE_COUNT_PER_CHAPTER,
    chapter: function (id) { return CHAPTERS_BY_ID[id] || null; },
    stage: function (id) {
      return STAGES.filter(function (s) { return s.id === id; })[0] || null;
    },
    stagesOf: function (chapterId) {
      const chapter = CHAPTERS_BY_ID[chapterId];
      return chapter ? chapter.stages.slice() : [];
    },
    totalStages: function () { return STAGES.length; },
    nextStage: function (stageIdValue) {
      const index = STAGES.map(function (s) { return s.id; }).indexOf(stageIdValue);
      return index >= 0 && index + 1 < STAGES.length ? STAGES[index + 1] : null;
    }
  };

  root.MYTHARA_STAGES = DATA;
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;

})(typeof globalThis !== 'undefined' ? globalThis : this);
