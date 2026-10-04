/* ============================================================
 * Mythara Online — js/data-items.js
 * ------------------------------------------------------------
 * Inventory-side content: equipment templates and rarities,
 * potions, materials, the (optional) summon pool, shop stock,
 * 7-day login rewards, daily quests and character unlock costs.
 * ============================================================ */
(function (root) {
  'use strict';

  /* ---------------- Rarities ---------------- */
  const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  const RARITIES = {
    common: { id: 'common', name: 'Common', color: '#b9c2d6', budget: 5, weight: 55, sell: 12 },
    uncommon: { id: 'uncommon', name: 'Uncommon', color: '#7ad06a', budget: 9, weight: 25, sell: 28 },
    rare: { id: 'rare', name: 'Rare', color: '#56b8ff', budget: 14, weight: 13, sell: 60 },
    epic: { id: 'epic', name: 'Epic', color: '#b07bff', budget: 20, weight: 5.5, sell: 130 },
    legendary: { id: 'legendary', name: 'Legendary', color: '#f2c14e', budget: 28, weight: 1.3, sell: 300 },
    mythic: { id: 'mythic', name: 'Mythic', color: '#ff5fd7', budget: 38, weight: 0.2, sell: 700 }
  };

  /* ---------------- Equipment slots ---------------- */
  const SLOTS = [
    { id: 'weapon', name: 'Weapon', glyph: '\u2694', primary: ['attack'], secondary: ['critChance'], noun: 'Blade' },
    { id: 'helmet', name: 'Helmet', glyph: '\u26D1', primary: ['defense'], secondary: ['maxHp'], noun: 'Helm' },
    { id: 'armor', name: 'Armor', glyph: '\u26E8', primary: ['defense'], secondary: ['maxHp'], noun: 'Plate' },
    { id: 'gloves', name: 'Gloves', glyph: '\u270B', primary: ['attack'], secondary: ['critChance'], noun: 'Gauntlets' },
    { id: 'pants', name: 'Pants', glyph: '\u{1F456}', primary: ['defense'], secondary: ['maxHp'], noun: 'Greaves' },
    { id: 'boots', name: 'Boots', glyph: '\u{1F462}', primary: ['speed'], secondary: ['evasion'], noun: 'Boots' },
    { id: 'necklace', name: 'Necklace', glyph: '\u{1F4FF}', primary: ['magic'], secondary: ['maxMp'], noun: 'Amulet' },
    { id: 'ring', name: 'Ring', glyph: '\u{1F48D}', primary: ['attack', 'magic'], secondary: ['critChance'], noun: 'Ring' },
    { id: 'wings', name: 'Wings', glyph: '\u{1FAB6}', primary: ['speed', 'magic'], secondary: ['evasion', 'maxHp'], noun: 'Wings' }
  ];

  const RARITY_PREFIX = {
    common: 'Worn', uncommon: 'Sturdy', rare: 'Silverstone',
    epic: 'Emberforged', legendary: 'Dawnbreaker', mythic: 'Worldbreaker'
  };

  const STAT_LABELS = {
    maxHp: 'HP', maxMp: 'MP', attack: 'ATK', defense: 'DEF',
    magic: 'MAGIC', speed: 'SPEED', critChance: 'CRIT', evasion: 'EVA'
  };

  /** Which stats roll for a slot + rarity (deterministic, so saves are stable). */
  function rollItemStats(slot, rarityId) {
    const rarity = RARITIES[rarityId] || RARITIES.common;
    const stats = {};
    const primary = slot.primary || [];
    const secondary = slot.secondary || [];
    const budget = rarity.budget;

    primary.forEach(function (key) {
      const per = key === 'maxHp' ? 6 : (key === 'speed' ? 2 : 1);
      stats[key] = Math.max(1, Math.round((budget * 0.62 * per) / primary.length));
    });
    if (secondary.length && budget >= 9) {
      const key = secondary[0];
      if (key === 'critChance' || key === 'evasion') {
        stats[key] = Math.min(0.14, Math.round((budget * 0.0022) * 1000) / 1000);
      } else if (key === 'maxHp') {
        stats[key] = Math.round(budget * 2.2);
      } else if (key === 'maxMp') {
        stats[key] = Math.round(budget * 1.4);
      } else {
        stats[key] = Math.max(1, Math.round(budget * 0.3));
      }
    }
    return stats;
  }

  /** 54 templates (9 slots × 6 rarities), generated from the tables above. */
  const TEMPLATES = {};
  SLOTS.forEach(function (slot) {
    RARITY_ORDER.forEach(function (rarityId) {
      const id = slot.id + '_' + rarityId;
      TEMPLATES[id] = {
        id: id,
        slot: slot.id,
        slotName: slot.name,
        glyph: slot.glyph,
        rarity: rarityId,
        name: RARITY_PREFIX[rarityId] + ' ' + slot.noun,
        stats: rollItemStats(slot, rarityId)
      };
    });
  });

  /** Upgrade rules: +1 … +15, each level adds 6% of the base stats. */
  const UPGRADE = {
    maxLevel: 15,
    statPerLevel: 0.06,
    costs: function (level) {
      return { upgradeStone: 1 + Math.floor(level / 3), coins: 120 * (level + 1) };
    },
    successChance: function (level) {
      if (level < 5) return 1;
      if (level < 10) return 0.9;
      if (level < 13) return 0.75;
      return 0.6;
    }
  };

  /* ---------------- Potions ---------------- */
  const POTIONS = {
    hpPotion: { id: 'hpPotion', name: 'HP Potion', glyph: '\u2764', color: '#ff5f6d', price: 60, restores: { hpPct: 0.35, hpFlat: 40 }, description: 'Restores 35% HP plus 40.' },
    mpPotion: { id: 'mpPotion', name: 'MP Potion', glyph: '\u2727', color: '#56b8ff', price: 55, restores: { mpPct: 0.4, mpFlat: 20 }, description: 'Restores 40% MP plus 20.' },
    fullPotion: { id: 'fullPotion', name: 'Full Recovery', glyph: '\u2726', color: '#f2c14e', price: 180, restores: { hpPct: 1, mpPct: 1 }, description: 'Fully restores HP and MP.' },
    energyPotion: { id: 'energyPotion', name: 'Energy Flask', glyph: '\u26A1', color: '#7ad06a', price: 220, restores: { energy: 40 }, description: 'Restores 40 energy.' }
  };

  /* ---------------- Materials ---------------- */
  const MATERIALS = [
    { id: 'upgradeStone', name: 'Upgrade Stone', glyph: '\u25C6', color: '#c9d4ea', tier: 1, description: 'Used to upgrade equipment.' },
    { id: 'ironOre', name: 'Iron Ore', glyph: '\u25A0', color: '#b9834a', tier: 1, description: 'Common smithing material.' },
    { id: 'beastHide', name: 'Beast Hide', glyph: '\u25B2', color: '#7ad06a', tier: 2, description: 'Tough hide from forest beasts.' },
    { id: 'stoneCore', name: 'Stone Core', glyph: '\u2B22', color: '#8a8f9c', tier: 3, description: 'The heart of a cavern golem.' },
    { id: 'frostShard', name: 'Frost Shard', glyph: '\u2744', color: '#7fdcff', tier: 4, description: 'Never melts, never warms.' },
    { id: 'sandGlass', name: 'Sand Glass', glyph: '\u25CB', color: '#e0c48a', tier: 5, description: 'Fused by the desert sun.' },
    { id: 'venomSac', name: 'Venom Sac', glyph: '\u25CF', color: '#9be36a', tier: 6, description: 'Handle with care.' },
    { id: 'demonHorn', name: 'Demon Horn', glyph: '\u2694', color: '#ff5f3a', tier: 7, description: 'Still warm to the touch.' },
    { id: 'dragonScale', name: 'Dragon Scale', glyph: '\u2B1F', color: '#ff7a3a', tier: 8, description: 'Nearly impossible to cut.' },
    { id: 'voidShard', name: 'Void Shard', glyph: '\u2726', color: '#c46bff', tier: 9, description: 'It hums when you look away.' },
    { id: 'mythicCore', name: 'Mythic Core', glyph: '\u2739', color: '#ffd76a', tier: 10, description: 'The last spark of Mythara.' }
  ];

  /* ---------------- Character unlocks ---------------- */
  const CHARACTER_UNLOCKS = {
    warrior: { unlocked: true, coins: 0, level: 1 },
    archer: { coins: 500, level: 5, fragments: 20 },
    fireMage: { coins: 1000, level: 10, fragments: 30 },
    iceMage: { coins: 1500, level: 15, fragments: 40 },
    assassin: { coins: 2000, level: 20, fragments: 50 },
    paladin: { coins: 2500, level: 25, fragments: 60 },
    priest: { coins: 3000, level: 30, fragments: 70 },
    berserker: { coins: 3500, level: 35, fragments: 80 },
    ninja: { coins: 4000, level: 40, fragments: 90 },
    dragonKnight: { coins: 5000, level: 50, fragments: 100 }
  };

  /* ---------------- Summon pool (optional gacha) ---------------- */
  const SUMMON = {
    singleCost: 100,          // gems
    tenCost: 900,
    rates: {
      common: 55, uncommon: 25, rare: 13, epic: 5.5, legendary: 1.3, mythic: 0.2
    },
    /** Which character each fragment type belongs to. */
    fragmentCharacters: ['archer', 'fireMage', 'iceMage', 'assassin', 'paladin', 'priest', 'berserker', 'ninja', 'dragonKnight'],
    fragmentAmounts: { common: 2, uncommon: 3, rare: 5, epic: 8, legendary: 12, mythic: 20 },
    gemAmounts: { common: 5, uncommon: 12, rare: 25, epic: 60, legendary: 150, mythic: 400 },
    equipmentRarityByRoll: {
      common: 'common', uncommon: 'uncommon', rare: 'rare',
      epic: 'epic', legendary: 'legendary', mythic: 'mythic'
    },
    minEquipmentRarity: 'uncommon'
  };

  /** Everything a single summon can produce, grouped by roll rarity. */
  function summonTable() {
    return ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'].map(function (rarity) {
      return { rarity: rarity, weight: RARITIES[rarity].weight };
    });
  }

  /* ---------------- Shop ---------------- */
  const SHOP = [
    { id: 'shopHpPotion', kind: 'potion', itemId: 'hpPotion', name: 'HP Potion', glyph: '\u2764', currency: 'coins', price: 60, bundle: 1, description: 'Restores 35% HP + 40.' },
    { id: 'shopMpPotion', kind: 'potion', itemId: 'mpPotion', name: 'MP Potion', glyph: '\u2727', currency: 'coins', price: 55, bundle: 1, description: 'Restores 40% MP + 20.' },
    { id: 'shopFullPotion', kind: 'potion', itemId: 'fullPotion', name: 'Full Recovery', glyph: '\u2726', currency: 'coins', price: 180, bundle: 1, description: 'Fully restores HP and MP.' },
    { id: 'shopEnergy', kind: 'potion', itemId: 'energyPotion', name: 'Energy Flask', glyph: '\u26A1', currency: 'gems', price: 15, bundle: 1, description: 'Restores 40 energy.' },
    { id: 'shopStones', kind: 'material', itemId: 'upgradeStone', name: 'Upgrade Stone ×5', glyph: '\u25C6', currency: 'coins', price: 500, bundle: 5, description: 'Materials for equipment upgrades.' },
    { id: 'shopGems', kind: 'gems', name: 'Gem Pouch', glyph: '\u{1F48E}', currency: 'coins', price: 2500, bundle: 50, description: 'Trade coins for 50 gems.' },
    { id: 'shopCoins', kind: 'coins', name: 'Coin Cache', glyph: '\u{1F4B0}', currency: 'gems', price: 30, bundle: 1500, description: 'Trade gems for 1,500 coins.' },
    { id: 'shopChestRare', kind: 'chest', rarity: 'rare', name: 'Rare Equipment Chest', glyph: '\u{1F381}', currency: 'coins', price: 1600, description: 'One guaranteed Rare item or better.' },
    { id: 'shopChestEpic', kind: 'chest', rarity: 'epic', name: 'Epic Equipment Chest', glyph: '\u{1F381}', currency: 'gems', price: 180, description: 'One guaranteed Epic item or better.' },
    { id: 'shopTicket', kind: 'ticket', name: 'Summon Ticket', glyph: '\u{1F3AB}', currency: 'gems', price: 120, bundle: 1, description: 'One free summon.' }
  ];

  /* ---------------- 7-day login rewards ---------------- */
  const DAILY_REWARDS = [
    { day: 1, label: 'Coins', kind: 'coins', amount: 500, glyph: '\u{1F4B0}' },
    { day: 2, label: 'HP Potions', kind: 'potion', itemId: 'hpPotion', amount: 5, glyph: '\u2764' },
    { day: 3, label: 'Gems', kind: 'gems', amount: 100, glyph: '\u{1F48E}' },
    { day: 4, label: 'Equipment Chest', kind: 'chest', rarity: 'rare', amount: 1, glyph: '\u{1F381}' },
    { day: 5, label: 'Summon Ticket', kind: 'ticket', amount: 1, glyph: '\u{1F3AB}' },
    { day: 6, label: 'Upgrade Materials', kind: 'material', itemId: 'upgradeStone', amount: 10, glyph: '\u25C6' },
    { day: 7, label: 'Character Fragments', kind: 'fragments', amount: 25, glyph: '\u2726' }
  ];

  /* ---------------- Daily quests ---------------- */
  const QUESTS = [
    { id: 'defeatMonsters', name: 'Defeat 10 monsters', target: 10, stat: 'monstersDefeated', rewards: { coins: 300, xp: 120, materials: [{ id: 'upgradeStone', count: 2 }] } },
    { id: 'clearStages', name: 'Complete 3 stages', target: 3, stat: 'stagesCleared', rewards: { coins: 450, xp: 200, potions: [{ id: 'hpPotion', count: 3 }] } },
    { id: 'arenaWin', name: 'Win 1 Arena battle', target: 1, stat: 'arenaWins', rewards: { gems: 60, coins: 300, xp: 150 } },
    { id: 'usePotions', name: 'Use 3 potions', target: 3, stat: 'potionsUsed', rewards: { coins: 220, xp: 90, potions: [{ id: 'mpPotion', count: 3 }] } },
    { id: 'upgradeGear', name: 'Upgrade equipment', target: 1, stat: 'equipmentUpgraded', rewards: { coins: 400, xp: 160, materials: [{ id: 'upgradeStone', count: 3 }] } }
  ];

  /* ---------------- Energy ---------------- */
  const ENERGY = {
    max: 100,
    startMax: 100,
    regenSeconds: 240,        // one point every 4 minutes
    refillCost: 50            // gems for a full refill
  };

  /* ---------------- Player level curve (1–100) ---------------- */
  const ACCOUNT_LEVEL = {
    max: 100,
    /** EXP required to advance FROM the given level. */
    expFor: function (level) {
      if (level >= 100) return Infinity;
      return Math.round(120 * Math.pow(1.085, level - 1) + level * 45);
    }
  };

  /** Character level curve (1–100) — separate from the account level. */
  const CHARACTER_LEVEL = {
    max: 100,
    expFor: function (level) {
      if (level >= 100) return Infinity;
      return Math.round(80 * Math.pow(1.11, level - 1) + level * 30);
    },
    /** Extra % applied to a character's base stats per level. */
    statGrowthPerLevel: 0.045,
    /** Skills unlock at these character levels (slot 1 / 2 / 3). */
    skillUnlockLevels: [1, 1, 5]
  };

  /** Combat power score used for stage recommendations and the Arena. */
  function powerScore(stats) {
    if (!stats) return 0;
    return Math.round(
      (stats.maxHp || 0) * 0.32 +
      (stats.attack || 0) * 3.1 +
      (stats.defense || 0) * 2.6 +
      (stats.magic || 0) * 2.2 +
      (stats.speed || 0) * 0.55 +
      (stats.critChance || 0) * 220 +
      (stats.evasion || 0) * 200
    );
  }

  const DATA = {
    RARITY_ORDER: RARITY_ORDER,
    RARITIES: RARITIES,
    SLOTS: SLOTS,
    TEMPLATES: TEMPLATES,
    UPGRADE: UPGRADE,
    POTIONS: POTIONS,
    MATERIALS: MATERIALS,
    CHARACTER_UNLOCKS: CHARACTER_UNLOCKS,
    SUMMON: SUMMON,
    SHOP: SHOP,
    DAILY_REWARDS: DAILY_REWARDS,
    QUESTS: QUESTS,
    ENERGY: ENERGY,
    ACCOUNT_LEVEL: ACCOUNT_LEVEL,
    CHARACTER_LEVEL: CHARACTER_LEVEL,
    STAT_LABELS: STAT_LABELS,

    template: function (id) { return TEMPLATES[id] || null; },
    slot: function (id) { return SLOTS.filter(function (s) { return s.id === id; })[0] || null; },
    rarity: function (id) { return RARITIES[id] || RARITIES.common; },
    rarityRank: function (id) { return RARITY_ORDER.indexOf(id); },
    material: function (id) { return MATERIALS.filter(function (m) { return m.id === id; })[0] || null; },
    potion: function (id) { return POTIONS[id] || null; },
    shopEntry: function (id) { return SHOP.filter(function (s) { return s.id === id; })[0] || null; },
    unlockCost: function (classId) { return CHARACTER_UNLOCKS[classId] || null; },
    summonTable: summonTable,
    powerScore: powerScore,
    /** Stat value on an item including its +N upgrade level. */
    itemStats: function (item) {
      const out = {};
      const level = Math.max(0, item.level || 0);
      const multiplier = 1 + UPGRADE.statPerLevel * level;
      Object.keys(item.stats || {}).forEach(function (key) {
        const value = item.stats[key] * multiplier;
        out[key] = (key === 'critChance' || key === 'evasion')
          ? Math.round(value * 1000) / 1000
          : Math.round(value);
      });
      return out;
    }
  };

  root.MYTHARA_ITEMS = DATA;
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;

})(typeof globalThis !== 'undefined' ? globalThis : this);
