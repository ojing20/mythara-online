/* ============================================================
 * Mythara Online — js/sync.js
 * ------------------------------------------------------------
 * Optional cloud sync. One account, many devices:
 *
 *      MYTHARA SERVER  →  DATABASE  →  Phone · PC · Tablet
 *
 * How it fits together
 *   • The game always plays against the local account store
 *     (js/account.js). That never changes, so the build still runs
 *     offline and from file://.
 *   • When the page is served over http(s) by server/server.js —
 *     or a server URL is configured — `Sync.install()` swaps the
 *     Auth backend to the cloud one and the local store becomes a
 *     cache of the account on the server.
 *   • Every save is written locally first, then pushed with a
 *     revision number. Two devices can never silently clobber each
 *     other: a stale revision gets a 409 and the two copies are
 *     merged instead (see mergeProfiles).
 *
 * Conflict policy (prototype)
 *   Progress is never dropped: stars, clears, levels, unlocks and
 *   items are the union of both copies; counters and currencies take
 *   the higher value. That is friendly but not cheat-proof — a
 *   production server would store an operation log instead. It is
 *   written down here, in the README and in the toast so nobody is
 *   misled about what this does.
 * ============================================================ */
(function (root) {
  'use strict';

  const Core = root.MytharaCore;
  const AccountRef = root.MytharaAccount;
  if (!Core || !AccountRef) throw new Error('sync.js requires core.js and account.js');

  const Bus = Core.Bus;
  const Storage = Core.Storage;
  const Auth = AccountRef.Auth;
  const AccountStore = AccountRef.Account;   // exports KEYS (account.<id>)

  const KEYS = {
    server: 'sync.server',       // where the Mythara server lives ('' = same origin)
    token: 'sync.token',         // { accountId, token } for the remembered session
    meta: 'sync.meta',           // { revision, lastSyncAt, accountId }
    pending: 'sync.pending'      // true when local changes are waiting to be pushed
  };

  const PROBE_TIMEOUT_MS = 2600;
  const REQUEST_TIMEOUT_MS = 8000;
  const PUSH_DEBOUNCE_MS = 1200;
  const MAX_PUSH_ATTEMPTS = 3;

  /* ============================================================
   * Small state machine
   * ========================================================== */
  let mode = 'local';            // 'local' | 'cloud'
  let server = '';               // '' = same origin, or 'http://host:port'
  let status = 'offline';        // offline | connecting | online | syncing | conflict | error
  let lastError = '';
  let lastSyncAt = 0;
  let bootPromise = null;
  let pushTimer = null;
  let pushInFlight = false;

  function emit(next, detail) {
    if (next) status = next;
    if (detail !== undefined) lastError = detail || '';
    Bus.emit('sync:status', status_());
  }

  function status_() {
    const meta = Storage.getJSON(KEYS.meta, {}) || {};
    return {
      mode: mode,
      status: mode === 'cloud' ? status : 'offline',
      server: server || 'same origin',
      lastError: lastError,
      lastSyncAt: lastSyncAt || meta.lastSyncAt || 0,
      revision: meta.revision || 0,
      pending: !!Storage.getJSON(KEYS.pending, false)
    };
  }

  /* ============================================================
   * Where is the server?
   * ========================================================== */
  function resolveServer() {
    // 1) ?server=http://192.168.1.20:8123 (handy when the game runs from file://)
    const search = (root.location && root.location.search) || '';
    const match = /[?&]server=([^&]+)/.exec(search);
    if (match) {
      const value = decodeURIComponent(match[1]).replace(/\/+$/, '');
      Storage.setJSON(KEYS.server, value);
      return value;
    }
    // 2) a previously configured server
    const saved = Storage.getJSON(KEYS.server, '');
    if (saved) return String(saved).replace(/\/+$/, '');
    // 3) same origin, when the page is not opened from the file system
    const protocol = (root.location && root.location.protocol) || '';
    if (protocol === 'http:' || protocol === 'https:') return '';
    return null;   // file:// with no server configured → offline only
  }

  function setServer(url) {
    server = url || '';
    Storage.setJSON(KEYS.server, server);
    emit();
    return server;
  }

  function url(path) { return server + path; }

  function canNetwork() { return typeof root.fetch === 'function' && !!globalThis.AbortController; }

  /* ============================================================
   * HTTP helpers
   * ========================================================== */
  function request(method, path, body, options) {
    const opts = options || {};
    const headers = { 'Content-Type': 'application/json' };
    if (opts.token) headers.Authorization = 'Bearer ' + opts.token;

    const controller = new globalThis.AbortController();
    const timer = setTimeout(function () { controller.abort(); }, opts.timeout || REQUEST_TIMEOUT_MS);
    const init = { method: method, headers: headers, signal: controller.signal };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (opts.keepalive) init.keepalive = true;

    return root.fetch(url(path), init).then(function (res) {
      clearTimeout(timer);
      return res.json().catch(function () { return {}; }).then(function (payload) {
        return { status: res.status, body: payload, ok: res.ok };
      });
    }).catch(function (error) {
      clearTimeout(timer);
      const aborted = error && error.name === 'AbortError';
      return { status: 0, ok: false, networkError: aborted ? 'The Mythara server did not answer in time.' : 'Cannot reach the Mythara server.', body: {} };
    });
  }

  function probe() {
    if (!canNetwork() || server === null) return Promise.resolve(false);
    return request('GET', '/api/health', undefined, { timeout: PROBE_TIMEOUT_MS }).then(function (res) {
      return !!(res.ok && res.body && res.body.service === 'mythara-server');
    });
  }

  /* ============================================================
   * Local cache helpers — the account document also lives in
   * Storage so the game keeps working when the server is away.
   * ========================================================== */
  function cacheAccount(account) {
    if (!account || !account.id) return null;
    Storage.setJSON(AccountStore.KEYS.account(account.id), account);
    const index = Storage.getJSON(AccountStore.KEYS.index, []).filter(function (entry) { return entry.id !== account.id; });
    index.push({ id: account.id, username: account.username, email: account.email, updatedAt: Date.now() });
    Storage.setJSON(AccountStore.KEYS.index, index);
    return account;
  }

  function readCached(accountId) {
    if (!accountId) return null;
    return Storage.getJSON(AccountStore.KEYS.account(accountId), null);
  }

  /**
   * The freshest copy of an account we can get: the live in-memory
   * document when it is the active one (it can be ahead of localStorage,
   * e.g. after addCoins/recordStageClear which do not save), otherwise the
   * cached copy.
   */
  function liveAccount(accountId) {
    const live = AccountRef.Account;
    if (live && typeof live.raw === 'function' && live.isReady && live.isReady() && live.id() === accountId) {
      return live.raw();
    }
    return readCached(accountId);
  }

  function storeToken(accountId, token) {
    if (token) Storage.setJSON(KEYS.token, { accountId: accountId, token: token });
    else Storage.remove(KEYS.token);
  }

  function readToken() { return Storage.getJSON(KEYS.token, null); }

  function setMeta(patch) {
    const meta = Storage.getJSON(KEYS.meta, {}) || {};
    Object.keys(patch).forEach(function (key) { meta[key] = patch[key]; });
    Storage.setJSON(KEYS.meta, meta);
    return meta;
  }

  function markPending(value) {
    Storage.setJSON(KEYS.pending, !!value);
    emit();
  }

  /* ============================================================
   * Merge — combine two copies without losing progress
   * ========================================================== */
  function newer(a, b) { return (b || 0) > (a || 0); }
  function maxNum() {
    let best = 0;
    Array.prototype.forEach.call(arguments, function (value) { if (typeof value === 'number' && value > best) best = value; });
    return best;
  }

  function mergeRecords(remote, local) {
    if (!remote) return local;
    if (!local) return remote;
    return {
      id: local.id || remote.id,
      username: local.username || remote.username,
      email: local.email || remote.email,
      revision: remote.revision || local.revision || 0,
      createdAt: Math.min(remote.createdAt || local.createdAt || Date.now(), local.createdAt || remote.createdAt || Date.now()),
      lastLoginAt: maxNum(remote.lastLoginAt, local.lastLoginAt),
      profile: mergeProfiles(remote.profile || {}, local.profile || {})
    };
  }

  /** Union of both profiles: nothing earned on either device is lost. */
  function mergeProfiles(a, b) {
    const remoteNewer = newer(a.updatedAt, b.updatedAt);
    const merged = JSON.parse(JSON.stringify(remoteNewer ? a : b));   // start from the newest copy

    /* currencies, levels and counters take the higher value */
    ['level', 'exp', 'coins', 'gems', 'tickets'].forEach(function (key) {
      merged[key] = maxNum(a[key], b[key]);
    });
    merged.energy = {
      current: maxNum((a.energy || {}).current, (b.energy || {}).current),
      lastRegenAt: maxNum((a.energy || {}).lastRegenAt, (b.energy || {}).lastRegenAt)
    };

    /* characters: per-class union */
    merged.characters = {};
    const classIds = Object.keys(a.characters || {}).concat(Object.keys(b.characters || {}));
    classIds.forEach(function (classId) {
      if (merged.characters[classId]) return;
      const x = (a.characters || {})[classId] || {};
      const y = (b.characters || {})[classId] || {};
      merged.characters[classId] = {
        unlocked: !!(x.unlocked || y.unlocked),
        level: maxNum(x.level, y.level, 1),
        exp: maxNum(x.exp, y.exp, 0),
        fragments: maxNum(x.fragments, y.fragments, 0),
        unlockedAt: Math.min(x.unlockedAt || y.unlockedAt || Date.now(), y.unlockedAt || x.unlockedAt || Date.now())
      };
    });

    /* stage progress: best stars, most clears, fastest time */
    merged.stageProgress = {};
    const stageIds = Object.keys(a.stageProgress || {}).concat(Object.keys(b.stageProgress || {}));
    stageIds.forEach(function (stageId) {
      if (merged.stageProgress[stageId]) return;
      const x = (a.stageProgress || {})[stageId] || {};
      const y = (b.stageProgress || {})[stageId] || {};
      const times = [x.bestTimeMs, y.bestTimeMs].filter(function (value) { return typeof value === 'number' && value > 0; });
      merged.stageProgress[stageId] = {
        stars: maxNum(x.stars, y.stars),
        clears: maxNum(x.clears, y.clears),
        cleared: !!(x.cleared || y.cleared),
        bestTimeMs: times.length ? Math.min.apply(Math, times) : 0
      };
    });
    merged.chaptersUnlocked = maxNum(a.chaptersUnlocked, b.chaptersUnlocked, 1);

    /* inventory: union by uid, so a drop on either device survives */
    const seen = {};
    merged.inventory = [];
    (b.inventory || []).concat(a.inventory || []).forEach(function (item) {
      if (!item || !item.uid || seen[item.uid]) return;
      seen[item.uid] = true;
      merged.inventory.push(item);
    });
    /* equipment follows the newer copy — it points at inventory uids */
    merged.equipment = (remoteNewer ? a : b).equipment || (b.equipment || a.equipment);

    ['potions', 'materials'].forEach(function (bag) {
      const x = a[bag] || {};
      const y = b[bag] || {};
      const out = {};
      Object.keys(x).concat(Object.keys(y)).forEach(function (key) { out[key] = maxNum(x[key], 0, y[key]); });
      merged[bag] = out;
    });

    /* stats and pvp records */
    const stats = {};
    Object.keys(a.stats || {}).concat(Object.keys(b.stats || {})).forEach(function (key) {
      stats[key] = maxNum((a.stats || {})[key], (b.stats || {})[key]);
    });
    merged.stats = stats;
    const pa = a.pvp || {}; const pb = b.pvp || {};
    merged.pvp = {
      rating: maxNum(pa.rating, pb.rating, 1000),
      wins: maxNum(pa.wins, pb.wins),
      losses: maxNum(pa.losses, pb.losses),
      streak: remoteNewer ? (pa.streak || 0) : (pb.streak || 0),
      best: maxNum(pa.best, pb.best, 1000),
      history: (remoteNewer ? (pa.history || []) : (pb.history || [])).slice(0, 12)
    };

    /* quests/daily: claimed flags are a union */
    const qa = a.quests || {}; const qb = b.quests || {};
    merged.quests = {
      resetAt: maxNum(qa.resetAt, qb.resetAt),
      progress: Object.assign({}, qb.progress || {}, qa.progress || {}),
      claimed: Object.assign({}, qb.claimed || {}, qa.claimed || {})
    };
    const da = a.daily || {}; const db = b.daily || {};
    merged.daily = {
      lastClaimAt: maxNum(da.lastClaimAt, db.lastClaimAt),
      streak: maxNum(da.streak, db.streak),
      totalClaims: maxNum(da.totalClaims, db.totalClaims)
    };

    /* presentation follows the newest copy */
    merged.activeCharacter = (remoteNewer ? a : b).activeCharacter || b.activeCharacter || a.activeCharacter;
    merged.characterName = (remoteNewer ? a : b).characterName || b.characterName || a.characterName;
    merged.settings = Object.assign({}, b.settings || {}, (remoteNewer ? a : b).settings || {});
    merged.createdAt = Math.min(a.createdAt || Infinity, b.createdAt || Infinity);
    if (!isFinite(merged.createdAt)) merged.createdAt = Date.now();
    merged.updatedAt = Date.now();
    return merged;
  }

  /* ============================================================
   * The cloud Auth backend
   * ========================================================== */
  function authFailure(res, fallback) {
    return { status: res.status, ok: false, error: (res.body && res.body.error) || res.networkError || fallback, offline: res.status === 0 };
  }

  const cloudBackend = {
    kind: 'cloud',

    listAccounts: function () { return Storage.getJSON(AccountStore.KEYS.index, []); },

    findById: function (accountId) { return readCached(accountId); },

    register: function (payload) {
      emit('syncing');
      return request('POST', '/api/register', {
        username: payload.username,
        email: payload.email,
        password: payload.password,
        confirm: payload.confirm
      }).then(function (res) {
        if (!res.ok || !res.body.ok) { emit(res.status === 0 ? 'error' : 'online', authFailure(res, 'Registration failed.').error); return authFailure(res, 'Registration failed.'); }
        const account = cacheAccount(res.body.account);
        storeToken(account.id, res.body.token);
        setMeta({ revision: res.body.account.revision || 1, accountId: account.id });
        markPending(false);
        lastSyncAt = Date.now();
        emit('online');
        return { ok: true, account: account };
      });
    },

    login: function (payload) {
      emit('syncing');
      return request('POST', '/api/login', {
        identifier: payload.identifier,
        password: payload.password
      }).then(function (res) {
        if (!res.ok || !res.body.ok) { emit(res.status === 0 ? 'error' : 'online', authFailure(res, 'Login failed.').error); return authFailure(res, 'Login failed.'); }
        const account = cacheAccount(res.body.account);
        storeToken(account.id, res.body.token);
        setMeta({ revision: res.body.account.revision || 1, accountId: account.id });
        lastSyncAt = Date.now();
        emit('online');
        return { ok: true, account: account };
      });
    },

    /* Auth has no separate "save" hook — Account.save() already wrote the
       local copy, so a save only has to schedule the push. */
    save: function (record) {
      cacheAccount(record);
      schedule();
      return true;
    }
  };

  /* ============================================================
   * Push / pull / reconcile
   * ========================================================== */
  function token() {
    const stored = readToken();
    return stored && stored.token ? stored.token : '';
  }

  /**
   * Push an account copy. The caller decides which copy is authoritative:
   * flush()/reconcile() pass the live one, and a merge result is pushed
   * back through this same function — so never re-resolve it here.
   */
  function push(account, baseRevision, attempt) {
    const tries = attempt || 1;
    if (!canNetwork() || mode !== 'cloud' || !account || !token()) {
      markPending(true);
      return Promise.resolve({ ok: false, queued: true });
    }
    pushInFlight = true;
    emit('syncing');
    return request('PUT', '/api/account', {
      account: { profile: account.profile },
      baseRevision: baseRevision,
      force: !!account.force
    }, { token: token() }).then(function (res) {
      pushInFlight = false;

      if (res.status === 409 && res.body && res.body.conflict) {
        // another device wrote first — merge and try again
        const remote = res.body.account || {};
        const merged = mergeRecords(remote, liveAccount(account.id) || account);
        cacheAccount(merged);
        setMeta({ revision: res.body.revision || 0, accountId: account.id });
        emit('conflict', 'Another device saved first — merging progress.');
        if (tries >= MAX_PUSH_ATTEMPTS) { markPending(true); return { ok: false, merged: merged, error: lastError }; }
        return push(merged, res.body.revision || 0, tries + 1).then(function (out) {
          if (out && !out.merged) out.merged = merged;   // let the caller adopt the merged copy
          return out;
        });
      }
      if (!res.ok || !res.body.ok) {
        const message = (res.body && res.body.error) || res.networkError || 'Save failed.';
        markPending(true);
        emit(res.status === 0 ? 'error' : 'online', message);
        return { ok: false, error: message };
      }

      account.revision = res.body.revision;
      setMeta({ revision: res.body.revision, lastSyncAt: Date.now(), accountId: account.id });
      lastSyncAt = Date.now();
      markPending(false);
      emit('online');
      return { ok: true, revision: res.body.revision };
    });
  }

  function pull(accountId) {
    if (!canNetwork() || mode !== 'cloud' || !token()) return Promise.resolve(null);
    return request('GET', '/api/account', undefined, { token: token() }).then(function (res) {
      if (res.status === 401) { storeToken(null); return null; }
      if (!res.ok || !res.body || !res.body.account) return null;
      const account = res.body.account;
      cacheAccount(account);
      setMeta({ revision: res.body.revision || account.revision || 0, lastSyncAt: Date.now(), accountId: account.id });
      lastSyncAt = Date.now();
      return account;
    });
  }

  /** Decide who wins, then make the server and the local cache agree. */
  function reconcile(options) {
    const opts = options || {};
    if (mode !== 'cloud' || !canNetwork() || !token()) return Promise.resolve({ ok: false, offline: true });

    const local = liveAccount(opts.accountId || (readToken() || {}).accountId);
    if (!local) return pull(opts.accountId).then(function (account) { return { ok: !!account, pulled: !!account }; });

    if (isInBattle() && !opts.force) return Promise.resolve({ ok: false, deferred: true });

    emit('syncing');
    return request('GET', '/api/account', undefined, { token: token() }).then(function (res) {
      if (res.status === 401) { storeToken(null); emit('error', 'Session expired — log in again.'); return { ok: false, auth: false }; }
      if (!res.ok || !res.body || !res.body.account) { emit('error', lastError || 'Sync failed.'); return { ok: false }; }

      const remote = res.body.account;
      const remoteRevision = res.body.revision || remote.revision || 0;
      const localUpdated = (local.profile || {}).updatedAt || 0;
      const remoteUpdated = (remote.profile || {}).updatedAt || 0;
      const meta = Storage.getJSON(KEYS.meta, {}) || {};
      // Unsaved local changes always win the right to be pushed: pushing is
      // what triggers the 409 merge below, so offline progress is never
      // discarded just because another device saved more recently.
      const dirty = !!Storage.getJSON(KEYS.pending, false);

      /* same revision on both sides → nothing to do */
      if (!dirty && remoteRevision === meta.revision && remoteUpdated === localUpdated) {
        lastSyncAt = Date.now();
        markPending(false);
        emit('online');
        return { ok: true, unchanged: true, revision: remoteRevision };
      }

      if (!dirty && (remoteUpdated > localUpdated || opts.force === 'pull')) {
        cacheAccount(remote);
        setMeta({ revision: remoteRevision, lastSyncAt: Date.now(), accountId: remote.id });
        lastSyncAt = Date.now();
        markPending(false);
        emit('online');
        applyPulled(remote);
        return { ok: true, pulled: true, revision: remoteRevision, account: remote };
      }

      /*
       * Local is newer, or has unsynced edits. When it is dirty the copy is
       * based on the revision we last synced (meta.revision), so push with
       * that number: if another device saved in the meantime the server
       * answers 409 and push() merges instead of overwriting the other
       * device's work.
       */
      const baseRevision = dirty ? (meta.revision || 0) : remoteRevision;
      return push(local, baseRevision).then(function (out) {
        if (out.merged) applyPulled(out.merged);
        return out;
      });
    });
  }

  /** Show account-level changes a pull brought in. */
  function applyPulled(account) {
    if (!account) return;
    const current = AccountRef.Account.id();
    if (!current || current !== account.id) return;
    if (isInBattle()) return;                     // never swap the profile mid-fight
    AccountRef.Account.attach(account);           // reload derived state
    Storage.setJSON('session', { id: account.id, username: account.username });
    Bus.emit('account:changed', { reason: 'sync' });
  }

  function isInBattle() {
    const body = root.document && root.document.body;
    return !!(body && body.classList && body.classList.contains('in-battle'));
  }

  /* ============================================================
   * Scheduling
   * ========================================================== */
  function schedule() {
    if (mode !== 'cloud') return;
    markPending(true);
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushTimer = null; flush(); }, PUSH_DEBOUNCE_MS);
  }

  /** Push right now (used on page hide, where fetch needs keepalive). */
  function flush(options) {
    const opts = options || {};
    if (mode !== 'cloud' || !canNetwork() || !token() || pushInFlight) return Promise.resolve({ ok: false });
    const account = liveAccount(opts.accountId || (readToken() || {}).accountId);
    if (!account) return Promise.resolve({ ok: false });
    const meta = Storage.getJSON(KEYS.meta, {}) || {};
    if (!opts.force && !Storage.getJSON(KEYS.pending, false)) return Promise.resolve({ ok: true, unchanged: true });
    if (opts.keepalive) {
      // last-gasp save while the tab closes — no response handling
      try {
        root.fetch(url('/api/account'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
          body: JSON.stringify({ account: { profile: account.profile }, baseRevision: meta.revision || 0 }),
          keepalive: true
        }).catch(function () {});
      } catch (error) { /* nothing else we can do while unloading */ }
      return Promise.resolve({ ok: true, keepalive: true });
    }
    return push(account, meta.revision || 0);
  }

  /* ============================================================
   * Boot + teardown
   * ========================================================== */
  function refreshRememberedSession() {
    const remembered = Storage.getJSON('session', null);
    const stored = readToken();
    if (!stored || !stored.token || (remembered && remembered.id !== stored.accountId)) return Promise.resolve(false);
    return request('GET', '/api/session', undefined, { token: stored.token }).then(function (res) {
      if (!res.ok || !res.body || !res.body.account) { storeToken(null); return false; }
      cacheAccount(res.body.account);
      setMeta({ revision: res.body.revision || res.body.account.revision || 0, accountId: res.body.account.id });
      return true;
    });
  }

  function install(options) {
    if (bootPromise) return bootPromise;
    const opts = options || {};
    server = opts.server !== undefined ? opts.server : resolveServer();

    if (opts.offline || server === null || !canNetwork()) {
      mode = 'local';
      emit('offline');
      bootPromise = Promise.resolve(status_());
      return bootPromise;
    }

    mode = 'cloud';                 // optimistic: swap the backend, then probe
    emit('connecting');
    Auth.setBackend(cloudBackend);

    bootPromise = probe().then(function (alive) {
      if (!alive) {
        mode = 'local';
        Auth.setBackend(null);      // back to the built-in offline backend
        emit('offline', 'Mythara server not reachable — playing offline on this device.');
        return status_();
      }
      return refreshRememberedSession().then(function () {
        lastSyncAt = Date.now();
        emit('online');
        return status_();
      });
    });

    Bus.on('account:saved', function () { schedule(); });

    if (root.document && root.document.addEventListener) {
      root.document.addEventListener('visibilitychange', function () {
        if (root.document.visibilityState === 'hidden') flush({ keepalive: true });
        else if (root.document.visibilityState === 'visible') flush();
      });
      root.addEventListener('pagehide', function () { flush({ keepalive: true }); });
    }
    root.addEventListener('online', function () { if (mode === 'cloud') flush(); });
    root.addEventListener('offline', function () { if (mode === 'cloud') emit('error', 'This device went offline; progress is saved locally.'); });

    return bootPromise;
  }

  /** Resolve the boot probe, but never let it hold the game hostage. */
  function ready(timeoutMs) {
    const limit = timeoutMs === undefined ? 4000 : timeoutMs;
    if (!bootPromise) install();
    return Promise.race([
      bootPromise,
      new Promise(function (resolve) { setTimeout(function () { resolve(status_()); }, limit); })
    ]).catch(function () { return status_(); });
  }

  function logout() {
    if (mode === 'cloud' && canNetwork() && token()) {
      try {
        root.fetch(url('/api/logout'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
          body: '{}',
          keepalive: true
        }).catch(function () {});
      } catch (error) { /* offline logout still works locally */ }
    }
    storeToken(null);
    Storage.remove(KEYS.pending);
    // the cached account document and index stay, so the device still
    // knows this player offline; only the session token is gone.
  }

  const Sync = {
    install: install,
    ready: ready,
    refreshSession: refreshRememberedSession,
    reconcile: reconcile,
    flush: flush,
    schedule: schedule,
    logout: logout,
    probe: probe,
    serverUrl: function () { return server; },
    setServer: setServer,
    isCloud: function () { return mode === 'cloud'; },
    status: status_,
    mergeProfiles: mergeProfiles,
    localStorageKeys: KEYS
  };

  root.MytharaSync = Sync;
  if (typeof module !== 'undefined' && module.exports) module.exports = Sync;

})(typeof globalThis !== 'undefined' ? globalThis : this);
