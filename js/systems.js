/* ============================================================
 * Mythara Online — js/systems.js
 * ------------------------------------------------------------
 * Reusable game systems that sit between the saved account and
 * the UI. Nothing here touches the DOM or the canvas: each system
 * is a small, testable API.
 *
 *   Quests     — daily objectives, live progress, claiming
 *   Daily      — 7-day login rewards
 *   Shop       — coin / gem purchases
 *   Summon     — optional gacha (free tickets + earned gems only)
 *   Gear       — inventory / equipment / upgrade actions
 *   Arena      — bot duel ranks and opponent previews
 *   Rewards    — shared reward formatting + toasts
 * ============================================================ */
(function (root) {
  'use strict';

  const Core = root.MytharaCore;
  const Items = root.MYTHARA_ITEMS;
  const Enemies = root.MYTHARA_ENEMIES;
  const AccountRef = root.MytharaAccount;
  const Account = AccountRef.Account;
  const Bus = Core.Bus;
  const Rng = Core.Rng;
  const Format = Core.Format;

  /* ============================================================
   * Quests — daily objectives
   * ========================================================== */
  const Quests = (function () {
    let installed = false;

    /** Wire the generic engine events into quest counters. */
    function install() {
      if (installed) return;
      installed = true;
      // Only the counters Account does not already track itself belong
      // here — recordStageClear()/recordPvp()/usePotion() count their own
      // quest stats, so hooking those events again would double-count.
      Bus.on('enemy:killed', function () { Account.trackQuest('monstersDefeated', 1); });
    }

    function list() { return Account.questList(); }
    function claimable() { return list().filter(function (entry) { return entry.complete && !entry.claimed; }); }
    function claim(id) { return Account.claimQuest(id); }
    function refresh() { Account.refreshQuests(); }

    return { install: install, list: list, claimable: claimable, claim: claim, refresh: refresh };
  })();

  /* ============================================================
   * Daily login rewards
   * ========================================================== */
  const Daily = (function () {
    function state() { return Account.dailyState(); }
    function canClaim() { return state().canClaim; }
    function claim() { return Account.claimDaily(); }
    function schedule() { return Items.DAILY_REWARDS; }
    return { state: state, canClaim: canClaim, claim: claim, schedule: schedule };
  })();

  /* ============================================================
   * Shop
   * ========================================================== */
  const Shop = (function () {
    function entries() {
      return Items.SHOP.map(function (entry) {
        const currency = entry.currency === 'gems' ? 'gems' : 'coins';
        return {
          def: entry,
          currency: currency,
          affordable: Account.canAfford(currency, entry.price),
          owned: entry.kind === 'potion' ? Account.potionCount(entry.itemId) : 0
        };
      });
    }

    function buy(entryId, quantity) {
      const def = Items.SHOP.filter(function (entry) { return entry.id === entryId; })[0];
      if (!def) return { ok: false, error: 'Unknown shop item.' };
      const times = Math.max(1, Math.min(99, quantity || 1));
      const currency = def.currency === 'gems' ? 'gems' : 'coins';
      const total = def.price * times;
      if (!Account.canAfford(currency, total)) return { ok: false, error: 'Not enough ' + currency + '.' };
      Account.spend(currency, total);

      const granted = { label: def.name, count: 0, currency: currency, spent: total };
      if (def.kind === 'potion') { Account.addPotion(def.itemId, def.bundle * times); granted.count = def.bundle * times; }
      else if (def.kind === 'material') { Account.addMaterial(def.itemId, def.bundle * times); granted.count = def.bundle * times; }
      else if (def.kind === 'ticket') { Account.addTickets(def.bundle * times); granted.count = def.bundle * times; }
      else if (def.kind === 'energy') { Account.addEnergy(def.bundle * times); granted.count = def.bundle * times; }
      else if (def.kind === 'chest') {
        const item = Account.rollItem({ minRarity: def.rarity });
        granted.item = item;
      }
      Account.save();
      Bus.emit('shop:purchased', { entry: def, quantity: times, granted: granted });
      return { ok: true, granted: granted };
    }

    return { entries: entries, buy: buy };
  })();

  /* ============================================================
   * Summon (optional — tickets and earned gems only)
   * ========================================================== */
  const Summon = (function () {
    const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

    function rates() {
      return RARITY_ORDER.map(function (rarity) {
        return { rarity: rarity, chance: Items.SUMMON.rates[rarity], label: Items.RARITIES[rarity].name };
      });
    }

    function canPull(count) {
      const multi = count === 10;
      const cost = multi ? Items.SUMMON.tenCost : Items.SUMMON.singleCost;
      const tickets = Account.profile().tickets || 0;
      const gems = Account.profile().gems || 0;
      return {
        count: multi ? 10 : 1,
        cost: cost,
        tickets: tickets,
        gems: gems,
        useTicket: tickets > 0,
        affordable: tickets > 0 || gems >= cost
      };
    }

    /** Roll a single reward. Rarity drives every payout type. */
    function rollOne() {
      const rarity = Rng.weighted(RARITY_ORDER.map(function (id) {
        return { rarity: id, weight: Items.SUMMON.rates[id] };
      })).rarity;

      const roll = Rng.int(0, 99);
      const fragmentAmount = Items.SUMMON.fragmentAmounts[rarity] || 2;

      // 45% fragments · 30% equipment · 15% gems · 10% consumables
      if (roll < 45) {
        const classId = Rng.pick(Items.SUMMON.fragmentCharacters);
        Account.addFragments(classId, fragmentAmount);
        return {
          kind: 'fragment', rarity: rarity, classId: classId, amount: fragmentAmount,
          label: Mythara.Classes[classId].name + ' Fragments', glyph: '\u2726', color: Items.RARITIES[rarity].color
        };
      }
      if (roll < 75) {
        const item = Account.rollItem({ minRarity: Items.SUMMON.minEquipmentRarity });
        return {
          kind: 'equipment', rarity: rarity, item: item, label: ItemLabels.name(item), glyph: '⚔︎',
          color: Items.RARITIES[rarity].color
        };
      }
      if (roll < 90) {
        const amount = Items.SUMMON.gemAmounts[rarity] || 5;
        Account.addGems(amount);
        return { kind: 'gems', rarity: rarity, amount: amount, label: amount + ' Gems', glyph: '💎', color: Items.RARITIES[rarity].color };
      }
      const potion = Rng.pick(Object.keys(Items.POTIONS).map(function (id) { return Items.POTIONS[id]; }));
      Account.addPotion(potion.id, 3);
      return { kind: 'potion', rarity: rarity, potion: potion, amount: 3, label: potion.name + ' x3', glyph: potion.glyph || '❤', color: Items.RARITIES[rarity].color };
    }

    function pull(count) {
      const multi = count === 10;
      const cost = multi ? Items.SUMMON.tenCost : Items.SUMMON.singleCost;
      const state = canPull(count);
      if (!state.affordable) return { ok: false, error: 'Not enough gems (need ' + cost + ').' };

      if (state.useTicket) Account.spend('tickets', 1);
      else Account.spend('gems', cost);

      const results = [];
      for (let i = 0; i < state.count; i++) results.push(rollOne());
      Account.profile().stats.summons += state.count;
      Account.save();
      Bus.emit('summon:rolled', { results: results, cost: cost, usedTicket: state.useTicket });
      return { ok: true, results: results, usedTicket: state.useTicket, cost: state.useTicket ? 0 : cost };
    }

    return { rates: rates, canPull: canPull, pull: pull, _rollOne: rollOne };
  })();

  /* ============================================================
   * Gear — inventory, equipment and upgrades
   * ========================================================== */
  const ItemLabels = (function () {
    function name(item) {
      if (!item) return 'Unknown';
      const template = Items.template(item.templateId);
      const base = template ? template.name : Items.SLOTS.filter(function (slot) { return slot.id === item.slot; })[0].name;
      return base + (item.level ? ' +' + item.level : '');
    }
    function slot(item) {
      const found = Items.SLOTS.filter(function (entry) { return entry.id === item.slot; })[0];
      return found ? found.name : item.slot;
    }
    function stats(item) { return Items.itemStats(item); }
    function compare(item) {
      const stats = Items.itemStats(item);
      return Object.keys(stats).map(function (key) { return { key: key, value: stats[key] }; });
    }
    return { name: name, slot: slot, stats: stats, compare: compare };
  })();

  const Gear = (function () {
    function inventory(options) {
      const opts = options || {};
      const equipped = Account.equippedItems();
      const equippedUids = Object.keys(equipped).map(function (slotId) { return equipped[slotId] && equipped[slotId].uid; });
      return Account.profile().inventory
        .filter(function (item) { return !opts.slot || item.slot === opts.slot; })
        .filter(function (item) { return !opts.rarity || item.rarity === opts.rarity; })
        .map(function (item) {
          const upgrade = Account.upgradeCost(item.uid);
          return {
            item: item,
            name: ItemLabels.name(item),
            slotName: ItemLabels.slot(item),
            rarity: Items.RARITIES[item.rarity],
            equipped: equippedUids.indexOf(item.uid) !== -1,
            upgrade: upgrade,
            power: Items.powerScore(Items.itemStats(item))
          };
        })
        .sort(function (a, b) {
          const rank = Items.rarityRank(b.item.rarity) - Items.rarityRank(a.item.rarity);
          return rank !== 0 ? rank : (b.item.level || 0) - (a.item.level || 0);
        });
    }

    function equip(uid) {
      const result = Account.equip(uid);
      if (result.ok) Bus.emit('gear:changed', { uid: uid, slot: result.slot });
      return result;
    }
    function unequip(slotId) {
      const result = Account.unequip(slotId);
      if (result.ok) Bus.emit('gear:changed', { slot: slotId });
      return result;
    }
    function upgrade(uid) {
      const result = Account.upgradeItem(uid);
      Bus.emit('gear:upgraded', { uid: uid, result: result });
      return result;
    }
    function sell(uid) {
      const item = Account.item(uid);
      if (!item) return { ok: false, error: 'Item not found.' };
      const price = Math.round((Items.RARITIES[item.rarity].sell || 50) * (1 + (item.level || 0) * 0.35));
      Account.removeItem(uid);
      Account.addCoins(price);
      Bus.emit('gear:sold', { uid: uid, coins: price });
      return { ok: true, coins: price };
    }
    function equipped() { return Account.equippedItems(); }
    function bonuses() { return Account.equipmentBonuses(); }

    return { inventory: inventory, equip: equip, unequip: unequip, upgrade: upgrade, sell: sell, equipped: equipped, bonuses: bonuses };
  })();

  /* ============================================================
   * Arena — 1v1 versus a BOT opponent (never online PvP)
   * ========================================================== */
  const Arena = (function () {
    function rankedTiers() { return Enemies.PVP_TIERS; }

    function tier(now) {
      const rating = (now === undefined ? Account.profile().pvp.rating : now);
      let current = Enemies.PVP_TIERS[0];
      Enemies.PVP_TIERS.forEach(function (entry) { if (rating >= entry.min) current = entry; });
      const index = Enemies.PVP_TIERS.indexOf(current);
      const next = Enemies.PVP_TIERS[index + 1] || null;
      return { tier: current, next: next, rating: rating, progress: next ? Core.clamp((rating - current.min) / (next.min - current.min), 0, 1) : 1 };
    }

    function difficulties() {
      const playerLevel = (Account.character(Account.activeCharacterId()) || { level: 1 }).level;
      const classic = Enemies.ARENA_DIFFICULTIES.filter(function (entry) { return entry.id !== 'bossTier' || playerLevel >= 30; });
      return classic.map(function (entry) {
        return {
          def: entry,
          botLevel: Math.max(1, playerLevel + entry.levelOffset),
          ai: entry.ai,
          rewards: entry.rewards,
          rating: entry.rating
        };
      });
    }

    function previewOpponent(difficultyId) {
      const difficulty = Enemies.arenaDifficulty(difficultyId);
      const playerLevel = (Account.character(Account.activeCharacterId()) || { level: 1 }).level;
      const classIds = Object.keys(Mythara.Classes);
      const classId = Rng.pick(classIds);
      return {
        difficulty: difficulty,
        classId: classId,
        className: Mythara.Classes[classId].name,
        level: Math.max(1, playerLevel + difficulty.levelOffset),
        note: 'BOT opponent — no online players involved.'
      };
    }

    function stats() {
      const pvp = Account.profile().pvp;
      const total = pvp.wins + pvp.losses;
      return {
        rating: pvp.rating, best: pvp.best, wins: pvp.wins, losses: pvp.losses,
        streak: pvp.streak,
        winRate: total ? Math.round((pvp.wins / total) * 100) : 0,
        tier: tier()
      };
    }

    return { tiers: rankedTiers, tier: tier, difficulties: difficulties, previewOpponent: previewOpponent, stats: stats };
  })();

  /* ============================================================
   * Rewards — shared formatting + toast scheduling
   * ========================================================== */
  const Rewards = (function () {
    const ORDER = ['coins', 'gems', 'xp', 'tickets', 'material', 'materials', 'potions', 'fragments', 'equipment'];

    function materialName(id) {
      const def = Items.material(id);
      return def ? def.name : id;
    }

    function icon(key) {
      return {
        coins: '🪙', gems: '💎', xp: '✦', tickets: '🎫', material: '◆', materials: '◆',
        potions: '🧪', potion: '🧪', fragments: '✧', equipment: '⚔︎', stars: '★'
      }[key] || '•';
    }

    function label(key) {
      return {
        coins: 'Coins', gems: 'Gems', xp: 'EXP', tickets: 'Tickets', material: 'Materials',
        materials: 'Materials', potions: 'Potions', potion: 'Potions', fragments: 'Fragments',
        equipment: 'Equipment', stars: 'Stars'
      }[key] || key;
    }

    /** Normalise any reward payload into [{key,label,icon,text}] rows. */
    function rows(reward) {
      if (!reward) return [];
      const out = [];
      ORDER.forEach(function (key) {
        if (reward[key] === undefined || reward[key] === null) return;
        out.push({ key: key, label: label(key), icon: icon(key), value: reward[key] });
      });
      return out;
    }

    /** Human text for a single reward payload, e.g. "+300 Coins". */
    function text(reward) {
      const parts = [];
      if (!reward) return '';
      if (reward.coins) parts.push('+' + Format.int(reward.coins) + ' Coins');
      if (reward.gems) parts.push('+' + Format.int(reward.gems) + ' Gems');
      if (reward.xp) parts.push('+' + Format.int(reward.xp) + ' EXP');
      if (reward.tickets) parts.push('+' + Format.int(reward.tickets) + ' Ticket' + (reward.tickets > 1 ? 's' : ''));
      if (reward.material) parts.push('+' + reward.material.amount + ' ' + materialName(reward.material.id));
      (reward.materials || []).forEach(function (entry) { parts.push('+' + entry.count + ' ' + materialName(entry.id)); });
      (reward.potions || []).forEach(function (entry) { parts.push('+' + entry.count + ' ' + Items.potion(entry.id).name); });
      if (reward.potion) parts.push('+' + reward.potion.amount + ' ' + Items.potion(reward.potion.id).name);
      if (reward.fragments) parts.push('+' + reward.fragments + ' Fragments');
      if (reward.equipment) {
        const list = Array.isArray(reward.equipment) ? reward.equipment : [reward.equipment];
        list.forEach(function (item) { if (item) parts.push(ItemLabels.name(item)); });
      }
      return parts.join('  ·  ');
    }

    return { rows: rows, text: text, icon: icon, label: label, ORDER: ORDER };
  })();

  /* ============================================================
   * Systems facade — installs event wiring once at startup
   * ========================================================== */
  const Systems = {
    Quests: Quests,
    Daily: Daily,
    Shop: Shop,
    Summon: Summon,
    Gear: Gear,
    Arena: Arena,
    Rewards: Rewards,
    Items: ItemLabels,

    install: function () {
      Quests.install();
      return true;
    }
  };

  root.MytharaSystems = Systems;
  if (typeof module !== 'undefined' && module.exports) module.exports = Systems;

})(typeof globalThis !== 'undefined' ? globalThis : this);
