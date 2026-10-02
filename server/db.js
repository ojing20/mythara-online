/* ============================================================
 * Mythara Online — server/db.js
 * ------------------------------------------------------------
 * Tiny durable JSON database with the same shape a real SQL
 * deployment would have, so the API layer never changes:
 *
 *   accounts : { id, username, email, salt, passwordHash,
 *                createdAt, lastLoginAt, revision, updatedAt,
 *                profile }
 *   sessions : { token, accountId, createdAt, lastSeenAt }
 *
 * Writes are debounced and atomic (write temp file, then rename)
 * so a crash mid-save can never corrupt the store.
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days
const SAVE_DEBOUNCE_MS = 120;

function createDb(options) {
  const opts = options || {};
  const file = opts.file || path.join(__dirname, 'data', 'mythara-db.json');
  const dir = path.dirname(file);

  let state = { version: 1, accounts: {}, sessions: {}, nextAccountNumber: 1 };
  let saveTimer = null;
  let dirty = false;

  function load() {
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          state = {
            version: 1,
            accounts: parsed.accounts || {},
            sessions: parsed.sessions || {},
            nextAccountNumber: parsed.nextAccountNumber || 1
          };
        }
      }
    } catch (err) {
      // A corrupt file must not stop the server: keep a copy and start fresh.
      try {
        if (fs.existsSync(file)) fs.renameSync(file, file + '.corrupt-' + Date.now());
      } catch (e) { /* ignore */ }
      state = { version: 1, accounts: {}, sessions: {}, nextAccountNumber: 1 };
    }
    pruneSessions();
    return state;
  }

  function writeNow() {
    if (!dirty) return true;
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, file);
      dirty = false;
      return true;
    } catch (err) {
      if (opts.onError) opts.onError(err);
      return false;
    }
  }

  function save() {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      writeNow();
    }, SAVE_DEBOUNCE_MS);
    if (saveTimer.unref) saveTimer.unref();
  }

  /* ---------------- accounts ---------------- */
  function accountList() { return Object.keys(state.accounts).map(function (id) { return state.accounts[id]; }); }

  function accountById(id) { return state.accounts[id] || null; }

  function findByUsername(username) {
    const needle = String(username || '').trim().toLowerCase();
    if (!needle) return null;
    return accountList().filter(function (account) { return account.username.toLowerCase() === needle; })[0] || null;
  }

  function findByEmail(email) {
    const needle = String(email || '').trim().toLowerCase();
    if (!needle) return null;
    return accountList().filter(function (account) { return (account.email || '').toLowerCase() === needle; })[0] || null;
  }

  /** Username or email lookup (what the login form accepts). */
  function findByIdentifier(identifier) {
    return findByUsername(identifier) || findByEmail(identifier);
  }

  function nextId(username) {
    const slug = String(username || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'hero';
    let id;
    do {
      id = 'u_' + slug + '_' + state.nextAccountNumber++;
    } while (state.accounts[id]);
    return id;
  }

  function createAccount(fields) {
    const account = {
      id: nextId(fields.username),
      username: fields.username,
      email: fields.email || '',
      salt: fields.salt,
      passwordHash: fields.passwordHash,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
      revision: 1,
      updatedAt: Date.now(),
      profile: fields.profile
    };
    state.accounts[account.id] = account;
    save();
    return account;
  }

  function updateAccount(account) {
    state.accounts[account.id] = account;
    save();
    return account;
  }

  function deleteAccount(id) {
    if (!state.accounts[id]) return false;
    delete state.accounts[id];
    Object.keys(state.sessions).forEach(function (token) {
      if (state.sessions[token].accountId === id) delete state.sessions[token];
    });
    save();
    return true;
  }

  /* ---------------- sessions ---------------- */
  function createSession(accountId, token) {
    const session = { token: token, accountId: accountId, createdAt: Date.now(), lastSeenAt: Date.now() };
    state.sessions[token] = session;
    save();
    return session;
  }

  function findSession(token) {
    const session = state.sessions[token];
    if (!session) return null;
    if (Date.now() - session.lastSeenAt > SESSION_TTL_MS) {
      delete state.sessions[token];
      save();
      return null;
    }
    session.lastSeenAt = Date.now();
    save();
    return session;
  }

  /** Drop every session of an account (optionally keeping one token). */
  function deleteSessionsFor(accountId, exceptToken) {
    let removed = 0;
    Object.keys(state.sessions).forEach(function (token) {
      if (state.sessions[token].accountId !== accountId) return;
      if (exceptToken && token === exceptToken) return;
      delete state.sessions[token];
      removed++;
    });
    if (removed) save();
    return removed;
  }

  function deleteSession(token) {
    if (!state.sessions[token]) return false;
    delete state.sessions[token];
    save();
    return true;
  }

  function pruneSessions(now) {
    const time = now || Date.now();
    let removed = 0;
    Object.keys(state.sessions).forEach(function (token) {
      if (time - state.sessions[token].lastSeenAt > SESSION_TTL_MS) { delete state.sessions[token]; removed++; }
    });
    if (removed) save();
    return removed;
  }

  function stats() {
    return { accounts: Object.keys(state.accounts).length, sessions: Object.keys(state.sessions).length, file: file };
  }

  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    dirty = true;
    return writeNow();
  }

  load();

  return {
    file: file,
    load: load,
    save: save,
    flush: flush,
    stats: stats,
    accountList: accountList,
    accountById: accountById,
    findByUsername: findByUsername,
    findByEmail: findByEmail,
    findByIdentifier: findByIdentifier,
    createAccount: createAccount,
    updateAccount: updateAccount,
    deleteAccount: deleteAccount,
    createSession: createSession,
    findSession: findSession,
    deleteSession: deleteSession,
    deleteSessionsFor: deleteSessionsFor,
    pruneSessions: pruneSessions,
    SESSION_TTL_MS: SESSION_TTL_MS
  };
}

module.exports = { createDb: createDb, SESSION_TTL_MS: SESSION_TTL_MS };
