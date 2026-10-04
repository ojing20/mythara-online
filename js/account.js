/* ============================================================
 * Mythara Online — js/account.js
 * ------------------------------------------------------------
 * Accounts, authentication and every piece of player progression.
 *
 * AUTH / SECURITY NOTE
 *   This prototype is offline, so credentials live in the browser.
 *   Passwords are NEVER stored in plain text: we keep a random
 *   per-account salt plus a 600-round salted digest. That is
 *   tamper-obvious but NOT cryptographically strong — a real
 *   deployment must move `Auth.register/login` to a server that
 *   hashes with bcrypt/argon2 and returns a session token.
 *   Swap `Auth.setBackend(backend)` to do exactly that; the rest of
 *   the game only ever talks to `Auth` and `Account`.
 * ============================================================ */
(function (root) {
  'use strict';

  const Core = root.MytharaCore;
  const Items = root.MYTHARA_ITEMS;
  if (!Core || !Items) throw new Error('account.js requires core.js and data-items.js');

  const Storage = Core.Storage;
  const Rng = Core.Rng;

  const KEYS = {
    index: 'accounts.index',
    account: function (id) { return 'account.' + id; }
  };

  /* ============================================================
   * Password hashing (prototype only — see file header)
   * ========================================================== */
  const Hasher = {
    rounds: 600,
    salt: function () {
      return Core.uid('s') + Rng.int(100000, 999999).toString(36);
    },
    hash: function (password, salt) {
      let digest = String(salt) + '|' + String(password);
      for (let i = 0; i < Hasher.rounds; i++) {
        digest = Core.digest(digest + ':' + i + ':' + salt);
      }
      return digest;
    },
    verify: function (password, salt, expected) {
      return Hasher.hash(password, salt) === expected;
    }
  };

  /* ============================================================
   * Account document — schema + defaults
   * ========================================================== */
  function defaultCharacterState(classId) {
    return {
      unlocked: classId === 'warrior',
      level: 1,
      exp: 0,
      fragments: 0,
      unlockedAt: classId === 'warrior' ? Date.now() : null
    };
  }

  function defaultProfile() {
    const characters = {};
    Object.keys((root.Mythara && root.Mythara.Classes) || {}).forEach(function (classId) {
      characters[classId] = defaultCharacterState(classId);
    });
    if (!characters.warrior) characters.warrior = defaultCharacterState('warrior');

    return {
      /* account level (1–100) */
      level: 1,
      exp: 0,

      /* currency */
      coins: 800,
      gems: 300,
      tickets: 2,

      /* energy */
      energy: { current: Items.ENERGY.max, lastRegenAt: Date.now() },

      characters: characters,
      activeCharacter: 'warrior',
      characterName: 'Jingle',

      inventory: [],
      equipment: { weapon: null, helmet: null, armor: null, gloves: null, pants: null, boots: null, necklace: null, ring: null, wings: null },
      potions: { hpPotion: 5, mpPotion: 3, fullPotion: 1, energyPotion: 1 },
      materials: { upgradeStone: 10, ironOre: 4 },

      stageProgress: {},
      chaptersUnlocked: 1,

      pvp: { rating: 1000, wins: 0, losses: 0, streak: 0, best: 1000, history: [] },

      quests: { resetAt: 0, progress: {}, claimed: {} },
      daily: { lastClaimAt: 0, streak: 0, totalClaims: 0 },

      /* legacy canvas-build save already imported into this account (or null) */
      legacyImport: null,

      stats: {
        monstersDefeated: 0, stagesCleared: 0, arenaWins: 0,
        potionsUsed: 0, equipmentUpgraded: 0, bossesDefeated: 0, summons: 0
      },

      settings: { sfx: true, music: true, touchControls: false, damageNumbers: true },

      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  /* ============================================================
   * Auth — local backend, swappable for a REST/SQL backend later
   * ========================================================== */
  const Auth = (function () {
    let backend = null;
    let session = null;         // { id, username, remember }

    /** Local backend: persists accounts in Storage. */
    const localBackend = {
      kind: 'local',

      listAccounts: function () {
        return Storage.getJSON(KEYS.index, []);
      },

      saveAccount: function (record) {
        Storage.setJSON(KEYS.account(record.id), record);
        const index = localBackend.listAccounts().filter(function (entry) { return entry.id !== record.id; });
        index.push({ id: record.id, username: record.username, email: record.email, updatedAt: Date.now() });
        Storage.setJSON(KEYS.index, index);
      },

      findAccount: function (identifier) {
        const needle = String(identifier || '').trim().toLowerCase();
        if (!needle) return null;
        const match = localBackend.listAccounts().filter(function (entry) {
          return entry.username.toLowerCase() === needle || (entry.email || '').toLowerCase() === needle;
        })[0];
        if (!match) return null;
        return Storage.getJSON(KEYS.account(match.id), null);
      },

      register: function (payload) {
        const username = String(payload.username || '').trim();
        const email = String(payload.email || '').trim();
        const password = String(payload.password || '');

        const problems = validateCredentials({ username: username, email: email, password: password, confirm: payload.confirm });
        if (problems) return { ok: false, error: problems };

        const existing = localBackend.listAccounts().filter(function (entry) {
          return entry.username.toLowerCase() === username.toLowerCase();
        })[0];
        if (existing) return { ok: false, error: 'That username is already taken.' };

        const salt = Hasher.salt();
        const record = {
          id: 'u_' + username.toLowerCase().replace(/[^a-z0-9]/g, '') + '_' + Rng.int(1000, 9999),
          username: username,
          email: email,
          salt: salt,
          passwordHash: Hasher.hash(password, salt),
          createdAt: Date.now(),
          lastLoginAt: Date.now(),
          profile: defaultProfile()
        };
        localBackend.saveAccount(record);
        return { ok: true, account: record };
      },

      login: function (payload) {
        const record = localBackend.findAccount(payload.identifier);
        if (!record) return { ok: false, error: 'No account found for that username or email.' };
        if (!Hasher.verify(String(payload.password || ''), record.salt, record.passwordHash)) {
          return { ok: false, error: 'Incorrect password.' };
        }
        record.lastLoginAt = Date.now();
        localBackend.saveAccount(record);
        return { ok: true, account: record };
      },

      save: function (record) { localBackend.saveAccount(record); return true; },
      findById: function (id) { return Storage.getJSON(KEYS.account(id), null); }
    };

    function validateCredentials(payload) {
      const username = payload.username;
      const email = payload.email;
      const password = payload.password;
      const confirm = payload.confirm;

      if (!username || username.length < 3) return 'Username must be at least 3 characters.';
      if (username.length > 16) return 'Username must be 16 characters or fewer.';
      if (!/^[A-Za-z0-9_]+$/.test(username)) return 'Username can only use letters, numbers and underscores.';
      if (payload.email !== undefined) {
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'Please enter a valid email address.';
      }
      if (!password || password.length < 6) return 'Password must be at least 6 characters.';
      if (confirm !== undefined && confirm !== password) return 'Passwords do not match.';
      return null;
    }

    /**
     * Swap the auth backend. Pass null to go back to the built-in
     * offline backend — that is what js/sync.js does when the Mythara
     * server is not reachable and the game must keep working.
     */
    function setBackend(custom) {
      if (custom !== null && (!custom || typeof custom.login !== 'function' || typeof custom.register !== 'function')) {
        throw new Error('Auth backend must implement register() and login()');
      }
      backend = custom || null;
      return backend;
    }

    function driver() { return backend || localBackend; }

    function backendKind() { return driver().kind || 'custom'; }

    /** Adopt the account a backend returned (also used for promises). */
    function adopt(result, payload) {
      if (result && result.ok && result.account) {
        session = { id: result.account.id, username: result.account.username, remember: !!(payload && payload.remember) };
      }
      return result;
    }

    function register(payload) {
      const result = driver().register(payload);
      // A network backend answers with a promise; the offline one is instant.
      if (result && typeof result.then === 'function') {
        return result.then(function (resolved) {
          adopt(resolved, payload);
          if (resolved && resolved.ok && resolved.account) Core.Bus.emit('auth:registered', { username: resolved.account.username });
          if (resolved && resolved.ok && resolved.account) Core.Bus.emit('auth:login', { username: resolved.account.username });
          return resolved;
        });
      }
      adopt(result, payload);
      if (result && result.ok && result.account) {
        Core.Bus.emit('auth:registered', { username: result.account.username });
        Core.Bus.emit('auth:login', { username: result.account.username });
      }
      return result;
    }

    function login(payload) {
      const result = driver().login(payload);
      if (result && typeof result.then === 'function') {
        return result.then(function (resolved) {
          adopt(resolved, payload);
          if (resolved && resolved.ok && resolved.account) Core.Bus.emit('auth:login', { username: resolved.account.username });
          return resolved;
        });
      }
      adopt(result, payload);
      if (result && result.ok && result.account) Core.Bus.emit('auth:login', { username: result.account.username });
      return result;
    }

    function logout() {
      session = null;
      Core.Bus.emit('auth:logout', {});
    }

    /** Continue a remembered session, if one exists. */
    function restoreSession() {
      const remembered = Storage.getJSON('session', null);
      if (!remembered || !remembered.id) return null;
      const record = driver().findById ? driver().findById(remembered.id) : null;
      if (!record) { Storage.remove('session'); return null; }
      session = { id: record.id, username: record.username, remember: true };
      return session;
    }

    function rememberSession(remember) {
      if (remember && session) Storage.setJSON('session', { id: session.id, username: session.username });
      else Storage.remove('session');
    }

    function currentSession() { return session; }

    return {
      register: register,
      login: login,
      logout: logout,
      restoreSession: restoreSession,
      rememberSession: rememberSession,
      currentSession: currentSession,
      setBackend: setBackend,
      backendKind: backendKind,
      validate: validateCredentials,
      listAccounts: function () { return localBackend.listAccounts(); },
      hashingRounds: Hasher.rounds
    };
  })();

  /* ============================================================
   * Account — progression API used by the whole game
   * ========================================================== */
  const Account = (function () {
    let record = null;      // full account document

    /**
     * Bring a pre-account (legacy build) character save into this profile.
     * Old saves only carried { classId, name } — honour both.
     *
     * `options.mode` decides how eager to be:
     *   'register' (default) — a brand-new account on this device: import.
     *   'login'              — only when the account has no progress yet, so
     *                          signing in on a second device (or reloading
     *                          the page) can never rewrite the character the
     *                          player picked in the account build.
     */
    function importLegacySave(saved, options) {
      if (!record || !saved || !saved.classId) return { ok: false, migrated: false };
      const classDef = root.Mythara && root.Mythara.Classes ? root.Mythara.Classes[saved.classId] : null;
      if (!classDef) return { ok: false, migrated: false };

      const p = profile();
      const name = saved.name ? String(saved.name).slice(0, 14) : null;

      // Import each legacy save exactly once. The engine keeps its own
      // `mythara.character.v1` save around, and re-importing it on every
      // login used to overwrite the character the player had since chosen
      // in the account build (and re-save the profile each time).
      const previous = p.legacyImport;
      if (previous && previous.classId === saved.classId && (previous.name || null) === name) {
        return { ok: true, migrated: false, alreadyImported: true, classId: saved.classId, name: p.characterName };
      }

      const mode = (options && options.mode) || 'register';
      const stageIds = Object.keys(p.stageProgress || {});
      const pristine = !previous &&
        (p.stats.stagesCleared || 0) === 0 && (p.stats.monstersDefeated || 0) === 0 &&
        (p.stats.arenaWins || 0) === 0 && (p.inventory || []).length === 0 &&
        (p.level || 1) <= 1 && !stageIds.some(function (id) { return p.stageProgress[id] && p.stageProgress[id].cleared; });
      if (mode === 'login' && !pristine) {
        return { ok: true, migrated: false, skipped: 'account-already-played', classId: saved.classId };
      }

      const state = character(saved.classId) || defaultCharacterState(saved.classId);
      p.characters[saved.classId] = state;
      if (!state.unlocked) { state.unlocked = true; state.unlockedAt = Date.now(); }
      p.activeCharacter = saved.classId;
      if (name) p.characterName = name;
      p.legacyImport = { classId: saved.classId, name: name, importedAt: Date.now() };
      p.stats.legacyImports = (p.stats.legacyImports || 0) + 1;
      save();
      Core.Bus.emit('account:imported', { classId: saved.classId, name: p.characterName });
      return { ok: true, migrated: true, classId: saved.classId, name: p.characterName };
    }

    /** Fetch a saved account by id and make it the active one. */
    function load(accountId) {
      const found = Storage.getJSON(KEYS.account(accountId), null);
      if (!found) return null;
      return attach(found);
    }

    function attach(newRecord) {
      record = newRecord;
      if (!record.profile) record.profile = defaultProfile();
      migrate();
      return record;
    }

    /** Fill in anything a save from an older build is missing. */
    function migrate() {
      if (!record || !record.profile) return;
      const p = record.profile;
      const defaults = defaultProfile();
      Object.keys(defaults).forEach(function (key) {
        if (p[key] === undefined) p[key] = defaults[key];
      });
      ['coins', 'gems', 'tickets', 'level', 'exp', 'activeCharacter', 'characterName'].forEach(function (key) {
        if (typeof p[key] !== 'number' && typeof p[key] !== 'string') p[key] = defaults[key];
      });
      const classIds = Object.keys((root.Mythara && root.Mythara.Classes) || {});
      (classIds.length ? classIds : ['warrior']).forEach(function (classId) {
        if (!p.characters[classId]) p.characters[classId] = defaultCharacterState(classId);
      });
      Object.keys(defaults.potions).forEach(function (id) { if (p.potions[id] === undefined) p.potions[id] = 0; });
      ['inventory', 'materials'].forEach(function (key) { if (!Array.isArray(p[key]) && typeof p[key] !== 'object') p[key] = defaults[key]; });
      if (!p.energy || typeof p.energy.current !== 'number') p.energy = defaults.energy;
      if (!Array.isArray(p.inventory)) p.inventory = [];
      if (!p.equipment) p.equipment = defaults.equipment;
      Items.SLOTS.forEach(function (slot) { if (p.equipment[slot.id] === undefined) p.equipment[slot.id] = null; });
      if (!p.quests) p.quests = defaults.quests;
      if (!p.daily) p.daily = defaults.daily;
      if (!p.stats) p.stats = defaults.stats;
      if (!p.settings) p.settings = defaults.settings;
      if (!p.pvp) p.pvp = defaults.pvp;
      if (!p.stageProgress) p.stageProgress = {};
      if (p.legacyImport === undefined) p.legacyImport = null;
    }

    function isReady() { return !!record; }
    /** The live account document (used by js/sync.js so a push never sends a stale copy). */
    function raw() { return record; }
    function detach() { record = null; }
    function profile() { return record ? record.profile : null; }
    function username() { return record ? record.username : ''; }
    function email() { return record ? record.email : ''; }
    function id() { return record ? record.id : null; }

    function save() {
      if (!record) return false;
      record.profile.updatedAt = Date.now();
      record.profile.level = Math.min(Items.ACCOUNT_LEVEL.max, record.profile.level);
      const session = Auth.currentSession();
      const ok = session ? Storage.setJSON(KEYS.account(session.id), record) : false;
      if (ok) {
        // keep the account index's timestamp fresh for the "last played" list
        const index = Storage.getJSON(KEYS.index, []);
        index.forEach(function (entry) { if (entry.id === record.id) entry.updatedAt = Date.now(); });
        Storage.setJSON(KEYS.index, index);
      }
      Core.Bus.emit('account:saved', { at: Date.now() });
      return ok;
    }

    /* ---------------- currency ---------------- */
    function addCoins(amount) {
      const p = profile();
      p.coins = Math.max(0, p.coins + Math.round(amount));
      Core.Bus.emit('currency:coins', { amount: amount, total: p.coins });
      return p.coins;
    }
    function addGems(amount) {
      const p = profile();
      p.gems = Math.max(0, p.gems + Math.round(amount));
      Core.Bus.emit('currency:gems', { amount: amount, total: p.gems });
      return p.gems;
    }
    function addTickets(amount) {
      const p = profile();
      p.tickets = Math.max(0, p.tickets + Math.round(amount));
      return p.tickets;
    }
    function canAfford(currency, amount) {
      const p = profile();
      return currency === 'gems' ? p.gems >= amount : currency === 'tickets' ? p.tickets >= amount : p.coins >= amount;
    }
    function spend(currency, amount) {
      if (!canAfford(currency, amount)) return false;
      if (currency === 'gems') addGems(-amount);
      else if (currency === 'tickets') addTickets(-amount);
      else addCoins(-amount);
      return true;
    }

    /* ---------------- energy ---------------- */
    function refreshEnergy(now) {
      const p = profile();
      const time = now || Date.now();
      const elapsed = Math.max(0, (time - (p.energy.lastRegenAt || time)) / 1000);
      const gained = Math.floor(elapsed / Items.ENERGY.regenSeconds);
      if (gained > 0 && p.energy.current < Items.ENERGY.max) {
        p.energy.current = Math.min(Items.ENERGY.max, p.energy.current + gained);
        p.energy.lastRegenAt = (p.energy.lastRegenAt || time) + gained * Items.ENERGY.regenSeconds * 1000;
      } else if (p.energy.current >= Items.ENERGY.max) {
        p.energy.lastRegenAt = time;
      }
      return p.energy.current;
    }
    function spendEnergy(amount) {
      refreshEnergy();
      const p = profile();
      if (p.energy.current < amount) return false;
      p.energy.current -= amount;
      if (p.energy.current === Items.ENERGY.max - amount) p.energy.lastRegenAt = Date.now();
      return true;
    }
    function addEnergy(amount) {
      refreshEnergy();
      const p = profile();
      p.energy.current = Math.min(Items.ENERGY.max, p.energy.current + amount);
      return p.energy.current;
    }
    function energySecondsToNext(now) {
      const p = profile();
      if (p.energy.current >= Items.ENERGY.max) return 0;
      const elapsed = ((now || Date.now()) - (p.energy.lastRegenAt || Date.now())) / 1000;
      return Math.max(0, Items.ENERGY.regenSeconds - (elapsed % Items.ENERGY.regenSeconds));
    }

    /* ---------------- account level ---------------- */
    function addExp(amount) {
      const p = profile();
      const gained = Math.max(0, Math.round(amount));
      p.exp += gained;
      let levels = 0;
      while (p.level < Items.ACCOUNT_LEVEL.max && p.exp >= Items.ACCOUNT_LEVEL.expFor(p.level)) {
        p.exp -= Items.ACCOUNT_LEVEL.expFor(p.level);
        p.level += 1;
        levels += 1;
      }
      Core.Bus.emit('account:exp', { gained: gained, levels: levels, level: p.level });
      return levels;
    }
    function expToNext() {
      const p = profile();
      return p.level >= Items.ACCOUNT_LEVEL.max ? 0 : Items.ACCOUNT_LEVEL.expFor(p.level);
    }

    /* ---------------- characters ---------------- */
    function character(classId) { return profile().characters[classId] || null; }
    function activeCharacterId() { return profile().activeCharacter; }
    function setActiveCharacter(classId) {
      const state = character(classId);
      if (!state || !state.unlocked) return false;
      profile().activeCharacter = classId;
      Core.Bus.emit('character:active', { classId: classId });
      return true;
    }
    function addCharacterExp(classId, amount) {
      const state = character(classId);
      if (!state) return { levels: 0, level: 1 };
      state.exp += Math.max(0, Math.round(amount));
      let levels = 0;
      while (state.level < Items.CHARACTER_LEVEL.max && state.exp >= Items.CHARACTER_LEVEL.expFor(state.level)) {
        state.exp -= Items.CHARACTER_LEVEL.expFor(state.level);
        state.level += 1;
        levels += 1;
      }
      if (levels > 0) Core.Bus.emit('character:levelUp', { classId: classId, level: state.level, gained: levels });
      return { levels: levels, level: state.level };
    }
    function characterExpToNext(classId) {
      const state = character(classId);
      if (!state) return 0;
      return state.level >= Items.CHARACTER_LEVEL.max ? 0 : Items.CHARACTER_LEVEL.expFor(state.level);
    }
    function addFragments(classId, amount) {
      const state = character(classId);
      if (!state || amount <= 0) return 0;
      state.fragments = (state.fragments || 0) + Math.round(amount);
      return state.fragments;
    }
    function unlockedCharacters() {
      const p = profile();
      return Object.keys(p.characters).filter(function (classId) { return p.characters[classId].unlocked; });
    }
    /** Requirement check for a locked character (coins + level, or fragments). */
    function unlockStatus(classId) {
      const p = profile();
      const state = p.characters[classId];
      const cost = Items.unlockCost(classId);
      if (!state || !cost) return { known: false };
      if (state.unlocked) return { known: true, unlocked: true };
      const fragments = state.fragments || 0;
      return {
        known: true,
        unlocked: false,
        coins: cost.coins,
        level: cost.level,
        fragmentsRequired: cost.fragments,
        fragments: fragments,
        canAffordCoins: p.coins >= cost.coins,
        meetsLevel: p.level >= cost.level,
        canUnlockWithCoins: p.coins >= cost.coins && p.level >= cost.level,
        canUnlockWithFragments: fragments >= cost.fragments,
        canUnlock: (p.coins >= cost.coins && p.level >= cost.level) || fragments >= cost.fragments
      };
    }
    function unlockCharacter(classId, method) {
      const status = unlockStatus(classId);
      if (!status.known) return { ok: false, error: 'Unknown character.' };
      if (status.unlocked) return { ok: false, error: 'Already unlocked.' };

      if (method === 'fragments') {
        if (!status.canUnlockWithFragments) return { ok: false, error: 'Not enough fragments.' };
        character(classId).fragments -= status.fragmentsRequired;
      } else {
        if (!status.canUnlockWithCoins) return { ok: false, error: 'Requires level ' + status.level + ' and ' + Core.Format.number(status.coins) + ' coins.' };
        addCoins(-status.coins);
      }
      const state = character(classId);
      state.unlocked = true;
      state.unlockedAt = Date.now();
      Core.Bus.emit('character:unlocked', { classId: classId, method: method || 'coins' });
      save();
      return { ok: true, classId: classId };
    }

    /* ---------------- inventory & equipment ---------------- */
    function addItem(templateId, options) {
      const opts = options || {};
      const template = Items.template(templateId);
      if (!template) return null;
      const item = {
        uid: Core.uid('it'),
        templateId: template.id,
        slot: template.slot,
        rarity: opts.rarity || template.rarity,
        name: opts.name || template.name,
        level: opts.level || 0,
        stats: Core.deepClone(opts.stats || template.stats),
        characterId: opts.characterId || null,
        acquiredAt: Date.now()
      };
      profile().inventory.push(item);
      Core.Bus.emit('inventory:item', { item: item });
      return item;
    }
    /** Random item of a slot/rarity, honouring a minimum rarity. */
    function rollItem(options) {
      const opts = options || {};
      const slots = opts.slot ? [opts.slot] : Items.SLOTS.map(function (s) { return s.id; });
      const slot = opts.slot || Rng.pick(slots);
      const entries = Items.RARITY_ORDER.map(function (rarity, index) {
        const boost = opts.minRarity ? Items.rarityRank(opts.minRarity) : 0;
        const weight = index < boost ? 0 : Items.RARITIES[rarity].weight;
        return { rarity: rarity, weight: weight };
      });
      const rolled = Rng.weighted(entries) || { rarity: 'common' };
      return addItem(slot + '_' + rolled.rarity, { rarity: rolled.rarity });
    }
    function item(uid) {
      return profile().inventory.filter(function (entry) { return entry.uid === uid; })[0] || null;
    }
    function removeItem(uid) {
      const p = profile();
      const index = p.inventory.map(function (entry) { return entry.uid; }).indexOf(uid);
      if (index === -1) return null;
      const removed = p.inventory.splice(index, 1)[0];
      Items.SLOTS.forEach(function (slot) {
        if (p.equipment[slot.id] === uid) p.equipment[slot.id] = null;
      });
      return removed;
    }
    function equip(uid) {
      const found = item(uid);
      if (!found) return { ok: false, error: 'Item not found.' };
      const p = profile();
      const previous = p.equipment[found.slot];
      p.equipment[found.slot] = uid;
      Core.Bus.emit('equipment:changed', { slot: found.slot, uid: uid });
      save();
      return { ok: true, slot: found.slot, replaced: previous };
    }
    function unequip(slotId) {
      const p = profile();
      if (!p.equipment[slotId]) return { ok: false };
      p.equipment[slotId] = null;
      Core.Bus.emit('equipment:changed', { slot: slotId, uid: null });
      return { ok: true };
    }
    function equippedItems() {
      const p = profile();
      const out = {};
      Items.SLOTS.forEach(function (slot) {
        out[slot.id] = p.equipment[slot.id] ? item(p.equipment[slot.id]) : null;
      });
      return out;
    }
    /** Total stat bonuses from all equipped gear (upgrade levels included). */
    function equipmentBonuses() {
      const totals = {};
      const equipped = equippedItems();
      Object.keys(equipped).forEach(function (slotId) {
        const gear = equipped[slotId];
        if (!gear) return;
        const stats = Items.itemStats(gear);
        Object.keys(stats).forEach(function (key) {
          totals[key] = (totals[key] || 0) + stats[key];
        });
      });
      return totals;
    }
    function upgradeCost(uid) {
      const found = item(uid);
      if (!found) return null;
      if ((found.level || 0) >= Items.UPGRADE.maxLevel) return { maxed: true };
      const cost = Items.UPGRADE.costs(found.level || 0);
      const p = profile();
      return {
        maxed: false,
        level: found.level || 0,
        next: (found.level || 0) + 1,
        chance: Items.UPGRADE.successChance(found.level || 0),
        stones: cost.upgradeStone,
        coins: cost.coins,
        hasStones: (p.materials.upgradeStone || 0) >= cost.upgradeStone,
        hasCoins: p.coins >= cost.coins
      };
    }
    function upgradeItem(uid) {
      const found = item(uid);
      if (!found) return { ok: false, error: 'Item not found.' };
      const cost = upgradeCost(uid);
      if (!cost || cost.maxed) return { ok: false, error: 'Already at +' + Items.UPGRADE.maxLevel + '.' };
      if (!cost.hasStones) return { ok: false, error: 'Not enough upgrade stones.' };
      if (!cost.hasCoins) return { ok: false, error: 'Not enough coins.' };

      addMaterial('upgradeStone', -cost.stones);
      addCoins(-cost.coins);
      const success = Rng.chance(cost.chance);
      if (success) {
        found.level = cost.next;
        profile().stats.equipmentUpgraded += 1;
        trackQuest('equipmentUpgraded', 1);
      }
      Core.Bus.emit('equipment:upgraded', { item: found, success: success, level: found.level });
      save();
      return { ok: true, success: success, item: found, chance: cost.chance };
    }

    /* ---------------- consumables & materials ---------------- */
    function addPotion(id, amount) {
      const p = profile();
      if (!Items.potion(id)) return 0;
      p.potions[id] = Math.max(0, (p.potions[id] || 0) + Math.round(amount));
      return p.potions[id];
    }
    function addMaterial(id, amount) {
      const p = profile();
      p.materials[id] = Math.max(0, (p.materials[id] || 0) + Math.round(amount));
      return p.materials[id];
    }
    function materialCount(id) { return profile().materials[id] || 0; }
    function potionCount(id) { return profile().potions[id] || 0; }
    /**
     * Use a potion. `actor` is the live battle actor ({hp, maxHp, mp, maxMp}).
     * Returns a description of what was restored.
     */
    function usePotion(id, actor) {
      const potion = Items.potion(id);
      if (!potion) return { ok: false, error: 'Unknown potion.' };
      if (potionCount(id) <= 0) return { ok: false, error: 'None left.' };

      const restores = potion.restores || {};
      let hp = 0, mp = 0, energy = 0;
      if (actor) {
        if (restores.hpPct || restores.hpFlat) {
          const amount = Math.round((actor.maxHp || 0) * (restores.hpPct || 0) + (restores.hpFlat || 0));
          hp = Math.min(amount, Math.max(0, (actor.maxHp || 0) - (actor.hp || 0)));
          actor.hp = Math.min(actor.maxHp, (actor.hp || 0) + amount);
        }
        if (restores.mpPct || restores.mpFlat) {
          const amount = Math.round((actor.maxMp || 0) * (restores.mpPct || 0) + (restores.mpFlat || 0));
          mp = Math.min(amount, Math.max(0, (actor.maxMp || 0) - (actor.mp || 0)));
          actor.mp = Math.min(actor.maxMp, (actor.mp || 0) + amount);
        }
      }
      if (restores.energy) {
        energy = restores.energy;
        addEnergy(energy);
      }
      addPotion(id, -1);
      profile().stats.potionsUsed += 1;
      trackQuest('potionsUsed', 1);
      Core.Bus.emit('potion:used', { id: id, hp: hp, mp: mp, energy: energy });
      return { ok: true, hp: hp, mp: mp, energy: energy, potion: potion };
    }

    /* ---------------- stage progress ---------------- */
    function stageRecord(stageId) {
      const p = profile();
      if (!p.stageProgress[stageId]) {
        p.stageProgress[stageId] = { stars: 0, bestTimeMs: 0, clears: 0, cleared: false };
      }
      return p.stageProgress[stageId];
    }
    function recordStageClear(stageId, options) {
      const opts = options || {};
      const record_ = stageRecord(stageId);
      const stars = Math.max(0, Math.min(3, opts.stars || 1));
      const improved = stars > record_.stars;
      record_.stars = Math.max(record_.stars, stars);
      record_.clears += 1;
      record_.cleared = true;
      if (opts.timeMs && (!record_.bestTimeMs || opts.timeMs < record_.bestTimeMs)) record_.bestTimeMs = opts.timeMs;

      // unlock the next chapter when this chapter's boss stage falls
      const stage = root.MYTHARA_STAGES.stage(stageId);
      if (stage && stage.isBoss) {
        profile().chaptersUnlocked = Math.max(profile().chaptersUnlocked, Math.min(10, stage.chapterIndex + 1));
      }
      profile().stats.stagesCleared += 1;
      trackQuest('stagesCleared', 1);
      Core.Bus.emit('stage:cleared', { stageId: stageId, stars: stars, improved: improved });
      return record_;
    }
    function chapterUnlocked(chapterIndex) {
      return chapterIndex <= (profile().chaptersUnlocked || 1);
    }
    function stageUnlocked(stageId) {
      const stage = root.MYTHARA_STAGES.stage(stageId);
      if (!stage) return false;
      if (!chapterUnlocked(stage.chapterIndex)) return false;
      if (stage.index === 1) return true;
      const prev = root.MYTHARA_STAGES.stage('c' + stage.chapterIndex + '-' + (stage.index - 1));
      return !!(prev && stageRecord(prev.id).cleared);
    }

    /* ---------------- PvP ---------------- */
    function recordPvp(options) {
      const opts = options || {};
      const pvp = profile().pvp;
      if (opts.won) {
        pvp.rating += opts.rating || 25;
        pvp.wins += 1;
        pvp.streak = Math.max(1, pvp.streak + 1);
        profile().stats.arenaWins += 1;
        trackQuest('arenaWins', 1);
      } else {
        pvp.rating = Math.max(0, pvp.rating - Math.round((opts.rating || 25) * 0.6));
        pvp.losses += 1;
        pvp.streak = Math.min(-1, pvp.streak - 1);
      }
      pvp.best = Math.max(pvp.best, pvp.rating);
      pvp.history.unshift({ won: !!opts.won, rating: pvp.rating, difficulty: opts.difficulty || 'normal', at: Date.now() });
      pvp.history = pvp.history.slice(0, 12);
      save();
      return pvp;
    }

    /* ---------------- quests ---------------- */
    function questProgress(questId) {
      const quest = Items.QUESTS.filter(function (q) { return q.id === questId; })[0];
      if (!quest) return 0;
      return profile().quests.progress[quest.stat] || 0;
    }
    function trackQuest(stat, amount) {
      const p = profile();
      p.quests.progress[stat] = (p.quests.progress[stat] || 0) + amount;
    }
    function refreshQuests(now) {
      const p = profile();
      const time = now || Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      if (!p.quests.resetAt || time - p.quests.resetAt >= dayMs) {
        p.quests.resetAt = time;
        p.quests.progress = {};
        p.quests.claimed = {};
        Core.Bus.emit('quests:reset', {});
      }
    }
    function questList() {
      refreshQuests();
      const p = profile();
      return Items.QUESTS.map(function (quest) {
        const progress = Math.min(quest.target, p.quests.progress[quest.stat] || 0);
        return {
          quest: quest,
          progress: progress,
          complete: progress >= quest.target,
          claimed: !!p.quests.claimed[quest.id]
        };
      });
    }
    function claimQuest(questId) {
      const entry = questList().filter(function (item_) { return item_.quest.id === questId; })[0];
      if (!entry) return { ok: false, error: 'Unknown quest.' };
      if (entry.claimed) return { ok: false, error: 'Already claimed.' };
      if (!entry.complete) return { ok: false, error: 'Not complete yet.' };
      profile().quests.claimed[questId] = true;
      grantRewards(entry.quest.rewards);
      save();
      Core.Bus.emit('quest:claimed', { questId: questId });
      return { ok: true, rewards: entry.quest.rewards };
    }

    /* ---------------- daily login rewards ---------------- */
    function dailyState(now) {
      const p = profile();
      const time = now || Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const sinceClaim = time - (p.daily.lastClaimAt || 0);
      const canClaim = !p.daily.lastClaimAt || sinceClaim >= dayMs;
      // streak resets if the player misses more than a day
      const streak = (!p.daily.lastClaimAt || sinceClaim < dayMs * 2) ? (p.daily.streak || 0) : 0;
      const nextDay = (streak % 7) + 1;
      return {
        canClaim: canClaim,
        streak: streak,
        nextDay: nextDay,
        nextInMs: canClaim ? 0 : dayMs - sinceClaim,
        rewards: Items.DAILY_REWARDS
      };
    }
    function claimDaily(now) {
      const state = dailyState(now);
      const p = profile();
      if (!state.canClaim) return { ok: false, error: 'Already claimed today.', nextInMs: state.nextInMs };
      const reward = Items.DAILY_REWARDS[state.nextDay - 1];
      p.daily.streak = state.streak + 1;
      p.daily.lastClaimAt = now || Date.now();
      p.daily.totalClaims = (p.daily.totalClaims || 0) + 1;
      applyReward(reward);
      save();
      Core.Bus.emit('daily:claimed', { day: state.nextDay, reward: reward });
      return { ok: true, day: state.nextDay, reward: reward };
    }

    /* ---------------- generic reward granting ---------------- */
    function applyReward(reward) {
      if (!reward) return null;
      const granted = { coins: 0, gems: 0, tickets: 0, materials: [], potions: [], items: [], fragments: 0 };
      if (reward.coins) { addCoins(reward.coins); granted.coins = reward.coins; }
      if (reward.gems) { addGems(reward.gems); granted.gems = reward.gems; }
      if (reward.tickets) { addTickets(reward.tickets); granted.tickets = reward.tickets; }
      if (reward.xp) addExp(reward.xp);
      if (reward.material) { addMaterial(reward.material.id, reward.material.amount); granted.materials.push(reward.material); }
      if (reward.materials) {
        reward.materials.forEach(function (entry) { addMaterial(entry.id, entry.count); granted.materials.push({ id: entry.id, amount: entry.count }); });
      }
      if (reward.potion) { addPotion(reward.potion.id, reward.potion.amount); granted.potions.push(reward.potion); }
      if (reward.potions) {
        reward.potions.forEach(function (entry) { addPotion(entry.id, entry.count); granted.potions.push({ id: entry.id, amount: entry.count }); });
      }
      if (reward.kind === 'potion' && reward.itemId) { addPotion(reward.itemId, reward.amount); granted.potions.push({ id: reward.itemId, amount: reward.amount }); }
      if (reward.kind === 'material' && reward.itemId) { addMaterial(reward.itemId, reward.amount); granted.materials.push({ id: reward.itemId, amount: reward.amount }); }
      if (reward.kind === 'coins') { addCoins(reward.amount); granted.coins += reward.amount; }
      if (reward.kind === 'gems') { addGems(reward.amount); granted.gems += reward.amount; }
      if (reward.kind === 'ticket') { addTickets(reward.amount); granted.tickets += reward.amount; }
      if (reward.kind === 'chest') { granted.items.push(rollItem({ minRarity: reward.rarity })); }
      if (reward.kind === 'fragments') {
        const classId = Rng.pick(Items.SUMMON.fragmentCharacters);
        addFragments(classId, reward.amount);
        granted.fragments = reward.amount;
        granted.fragmentCharacter = classId;
      }
      if (reward.equipment) granted.items.push(rollItem(reward.equipment));
      return granted;
    }
    function grantRewards(reward) { return applyReward(reward); }

    /* ---------------- settings ---------------- */
    function settings() { return profile().settings; }
    function setSetting(key, value) {
      profile().settings[key] = value;
      save();
      Core.Bus.emit('settings:changed', { key: key, value: value });
      return value;
    }

    return {
      attach: attach, detach: detach, raw: raw, load: load, migrate: migrate, importLegacySave: importLegacySave, isReady: isReady, profile: profile,
      save: save, username: username, email: email, id: id,
      addCoins: addCoins, addGems: addGems, addTickets: addTickets,
      canAfford: canAfford, spend: spend,
      refreshEnergy: refreshEnergy, spendEnergy: spendEnergy, addEnergy: addEnergy, energySecondsToNext: energySecondsToNext,
      addExp: addExp, expToNext: expToNext,
      character: character, characterExpToNext: characterExpToNext, addCharacterExp: addCharacterExp,
      addFragments: addFragments, unlockedCharacters: unlockedCharacters,
      unlockStatus: unlockStatus, unlockCharacter: unlockCharacter,
      activeCharacterId: activeCharacterId, setActiveCharacter: setActiveCharacter,
      addItem: addItem, rollItem: rollItem, item: item, removeItem: removeItem,
      equip: equip, unequip: unequip, equippedItems: equippedItems, equipmentBonuses: equipmentBonuses,
      upgradeCost: upgradeCost, upgradeItem: upgradeItem,
      addPotion: addPotion, potionCount: potionCount, usePotion: usePotion,
      addMaterial: addMaterial, materialCount: materialCount,
      stageRecord: stageRecord, recordStageClear: recordStageClear,
      chapterUnlocked: chapterUnlocked, stageUnlocked: stageUnlocked,
      recordPvp: recordPvp,
      questList: questList, trackQuest: trackQuest, claimQuest: claimQuest, refreshQuests: refreshQuests,
      dailyState: dailyState, claimDaily: claimDaily,
      grantRewards: grantRewards, applyReward: applyReward,
      settings: settings, setSetting: setSetting,
      defaultProfile: defaultProfile,
      Hasher: Hasher,
      KEYS: KEYS
    };
  })();

  root.MytharaAccount = { Auth: Auth, Account: Account, defaultProfile: defaultProfile };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MytharaAccount;

})(typeof globalThis !== 'undefined' ? globalThis : this);
