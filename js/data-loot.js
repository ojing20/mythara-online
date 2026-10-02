/* ============================================================
 * Mythara Online — js/data-loot.js
 * ------------------------------------------------------------
 * Drop tables for world monsters: what falls out of a kill, how
 * often, and how rare it is. Pure data + one roll function — the
 * engine (game.js) turns the result into loot on the ground.
 *
 *   kind      coins | potion | material | item
 *   tiers     mob · elite · boss      (see js/data-enemies.js)
 *   rarity    common … mythic         (colours from js/data-items.js)
 *
 * Every creature is an original Mythara design; drops are themed
 * per tier, not per franchise.
 * ============================================================ */
(function (root) {
  'use strict';

  const Items = root.MYTHARA_ITEMS || (typeof module !== 'undefined' && module.exports && null);

  /** Rarity colours (mirrors data-items.js so the renderer needs no lookups). */
  const RARITY_COLOUR = {
    common: '#b9c2d6',
    uncommon: '#7ad06a',
    rare: '#56b8ff',
    epic: '#b07bff',
    legendary: '#f2c14e',
    mythic: '#ff5fd7'
  };
  const RARITY_RANK = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

  /**
   * Per-tier behaviour. `weights` decides what each roll produces; a boss is
   * guaranteed at least one piece of equipment on top of its rolls.
   */
  const TIERS = {
    mob: {
      rolls: 1, chance: 0.8, minRarity: 'common', maxRarity: 'rare',
      coins: [12, 40], guaranteeItem: false,
      weights: { coins: 40, potion: 25, material: 25, item: 10 }
    },
    elite: {
      rolls: 2, chance: 0.92, minRarity: 'uncommon', maxRarity: 'epic',
      coins: [40, 110], guaranteeItem: false,
      weights: { coins: 30, potion: 20, material: 26, item: 24 }
    },
    boss: {
      rolls: 3, chance: 1, minRarity: 'rare', maxRarity: 'legendary',
      coins: [140, 320], guaranteeItem: true,
      weights: { coins: 26, potion: 14, material: 26, item: 34 }
    }
  };

  /** Materials gated by the region/chapter so loot matches the world. */
  const MATERIAL_BY_TIER = {
    1: ['upgradeStone', 'ironOre'],
    2: ['beastHide', 'upgradeStone'],
    3: ['stoneCore', 'ironOre'],
    4: ['frostShard', 'stoneCore'],
    5: ['sandGlass', 'frostShard'],
    6: ['venomSac', 'beastHide'],
    7: ['demonHorn', 'venomSac'],
    8: ['dragonScale', 'demonHorn'],
    9: ['voidShard', 'dragonScale'],
    10: ['mythicCore', 'voidShard']
  };

  const POTIONS = ['hpPotion', 'mpPotion', 'fullPotion'];

  function randRange(rng, min, max) { return min + rng() * (max - min); }
  function pick(rng, list) { return list[Math.floor(rng() * list.length) % list.length]; }

  /** Roll a rarity across the tier's allowed band. */
  function rollRarity(rng, minRarity, maxRarity) {
    const lo = Math.max(0, RARITY_RANK.indexOf(minRarity));
    const hi = Math.max(lo, RARITY_RANK.indexOf(maxRarity));
    const weights = [55, 25, 13, 5.5, 1.3, 0.2].slice(lo, hi + 1);
    const total = weights.reduce(function (a, b) { return a + b; }, 0);
    let roll = rng() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return RARITY_RANK[lo + i];
    }
    return RARITY_RANK[lo];
  }

  /**
   * Roll the loot for one kill.
   * @returns {Array<{kind,id,name,rarity,colour,amount,glyph}>}
   */
  function roll(enemy, level, rng) {
    const random = rng || Math.random;
    const def = (enemy && enemy.def) || enemy || {};
    const tierId = def.tier === 'boss' ? 'boss' : def.tier === 'elite' ? 'elite' : 'mob';
    const tier = TIERS[tierId];
    const out = [];
    const chapter = Math.min(10, Math.max(1, Math.round(((enemy && enemy.level) || level || 1) / 5)));

    if (random() > tier.chance) return out;

    const makeCoins = function () {
      const amount = Math.round(randRange(random, tier.coins[0], tier.coins[1]));
      return { kind: 'coins', id: 'coins', name: amount + ' gold', rarity: 'common', colour: '#f2c14e', amount: amount, glyph: '\u25C6' };
    };
    const makePotion = function () {
      const potionId = pick(random, POTIONS.slice(0, tierId === 'mob' ? 2 : 3));
      const potion = (Items && Items.potion && Items.potion(potionId)) || { name: potionId, color: '#ff5f6d', glyph: '\u2764' };
      return {
        kind: 'potion', id: potionId, name: potion.name,
        rarity: potionId === 'fullPotion' ? 'rare' : 'common',
        colour: potion.color || '#ff5f6d', amount: 1, glyph: potion.glyph || '\u2764'
      };
    };
    const makeMaterial = function () {
      const pool = MATERIAL_BY_TIER[chapter] || MATERIAL_BY_TIER[1];
      const materialId = pool[random() < 0.35 ? 0 : 1] || pool[0];
      const material = (Items && Items.material && Items.material(materialId)) || { name: materialId, color: '#c9d4ea', glyph: '\u25C6' };
      const rarity = materialId === pool[0] ? (chapter >= 5 ? 'rare' : 'uncommon') : 'common';
      return {
        kind: 'material', id: materialId, name: material.name, rarity: rarity,
        colour: material.color || RARITY_COLOUR[rarity], amount: random() < 0.25 ? 2 : 1, glyph: material.glyph || '\u25C6'
      };
    };
    const makeItem = function (minRarity) {
      const rarity = rollRarity(random, minRarity || tier.minRarity, tier.maxRarity);
      return {
        kind: 'item', id: null, rarity: rarity, amount: 1,
        name: (Items && Items.rarity ? Items.rarity(rarity).name : rarity) + ' equipment',
        colour: RARITY_COLOUR[rarity], glyph: '\u2694'
      };
    };

    const kinds = ['coins', 'potion', 'material', 'item'];
    for (let i = 0; i < tier.rolls; i++) {
      const total = kinds.reduce(function (sum, k) { return sum + tier.weights[k]; }, 0);
      let roll = random() * total;
      let kind = kinds[kinds.length - 1];
      for (let k = 0; k < kinds.length; k++) {
        roll -= tier.weights[kinds[k]];
        if (roll <= 0) { kind = kinds[k]; break; }
      }
      if (kind === 'coins') out.push(makeCoins());
      else if (kind === 'potion') out.push(makePotion());
      else if (kind === 'material') out.push(makeMaterial());
      else out.push(makeItem());
    }

    // A boss always leaves something worth equipping behind.
    if (tier.guaranteeItem && !out.some(function (entry) { return entry.kind === 'item'; })) {
      out.push(makeItem(tier.minRarity));
    }
    return out;
  }

  const api = {
    RARITY_COLOUR: RARITY_COLOUR,
    RARITY_RANK: RARITY_RANK,
    TIERS: TIERS,
    MATERIAL_BY_TIER: MATERIAL_BY_TIER,
    roll: roll,
    rarityColour: function (id) { return RARITY_COLOUR[id] || RARITY_COLOUR.common; }
  };

  root.MytharaLootData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof globalThis !== 'undefined' ? globalThis : this);
