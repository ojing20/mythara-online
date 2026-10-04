/* ============================================================
 * Mythara Online — server/tests/api.test.js
 * ------------------------------------------------------------
 * Account-server test suite. Runs with Node's built-in runner:
 *
 *     node --test                     (from the repository root)
 *
 * It boots the real HTTP server against a throwaway database and
 * drives the full cross-device story: register on device A, play,
 * save, then log in from device B and see the same account data.
 * ============================================================ */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { start } = require('../server');
const auth = require('../auth');
const { createDb } = require('../db');

let server = null;
let base = '';
let dbFile = '';

test.before(async function () {
  dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mythara-test-')), 'db.json');
  const out = await start({ port: 0, host: '127.0.0.1', dbFile: dbFile });
  server = out.server;
  base = 'http://127.0.0.1:' + out.port;
});

test.after(function () {
  if (server) server.close();
});

/* ---------------- helpers ---------------- */
function post(url, body, token) {
  return fetch(base + url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: JSON.stringify(body || {})
  }).then(async function (res) { return { status: res.status, body: await res.json() }; });
}

function put(url, body, token) {
  return fetch(base + url, {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: JSON.stringify(body || {})
  }).then(async function (res) { return { status: res.status, body: await res.json() }; });
}

function get(url, token) {
  return fetch(base + url, {
    headers: token ? { Authorization: 'Bearer ' + token } : {}
  }).then(async function (res) { return { status: res.status, body: await res.json() }; });
}

function sampleProfile(coins) {
  return {
    level: 7,
    exp: 420,
    coins: coins === undefined ? 1500 : coins,
    gems: 90,
    tickets: 1,
    activeCharacter: 'archer',
    characterName: 'Jingle',
    characters: {
      warrior: { unlocked: true, level: 12, exp: 300, fragments: 0 },
      archer: { unlocked: true, level: 9, exp: 120, fragments: 20 }
    },
    inventory: [{ uid: 'it_test_1', templateId: 'ring_epic', slot: 'ring', rarity: 'epic', level: 3 }],
    equipment: { ring: 'it_test_1' },
    stageProgress: { 'c1-1': { stars: 3, clears: 2, cleared: true, bestTimeMs: 41200 } },
    pvp: { rating: 1120, wins: 4, losses: 1, best: 1120, streak: 2 },
    potions: { hpPotion: 5 },
    materials: { upgradeStone: 12 },
    quests: { progress: { monstersDefeated: 7 }, claimed: {}, resetAt: Date.now() }
  };
}

/* ---------------- tests ---------------- */

test('health endpoint reports the service', async function () {
  const res = await get('/api/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.service, 'mythara-server');
  assert.ok(res.body.accounts >= 0);
});

test('static hosting serves the game and hides the server folder', async function () {
  const page = await fetch(base + '/');
  assert.strictEqual(page.status, 200);
  const html = await page.text();
  assert.match(html, /MYTHARA|Mythara/);
  assert.match(html, /js\/app\.js/);

  const secret = await fetch(base + '/server/db.js');
  assert.strictEqual(secret.status, 403, 'server internals must not be downloadable');

  const traversal = await fetch(base + '/../package.json');
  assert.ok(traversal.status === 404 || traversal.status === 403);
});

test('register creates an account and never leaks the password hash', async function () {
  const res = await post('/api/register', {
    username: 'jingle',
    email: 'jingle@mythara.gg',
    password: 'swordfish7',
    profile: sampleProfile()
  });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.ok, true);
  assert.ok(res.body.token && res.body.token.length >= 32);
  assert.strictEqual(res.body.account.username, 'jingle');
  assert.strictEqual(res.body.account.profile.coins, 1500);
  assert.strictEqual(res.body.account.passwordHash, undefined);
  assert.strictEqual(res.body.account.salt, undefined);
});

test('duplicate username and email are rejected', async function () {
  const sameName = await post('/api/register', { username: 'jingle', password: 'swordfish7' });
  assert.strictEqual(sameName.status, 409);
  const sameEmail = await post('/api/register', { username: 'other', email: 'jingle@mythara.gg', password: 'swordfish7' });
  assert.strictEqual(sameEmail.status, 409);
});

test('weak credentials are rejected with a readable message', async function () {
  const short = await post('/api/register', { username: 'ab', password: 'swordfish7' });
  assert.strictEqual(short.status, 400);
  assert.match(short.body.error, /Username/);
  const badPass = await post('/api/register', { username: 'validname', password: '123' });
  assert.strictEqual(badPass.status, 400);
  assert.match(badPass.body.error, /Password/);
  const mismatch = await post('/api/register', { username: 'validname2', password: 'swordfish7', confirm: 'swordfish8' });
  assert.strictEqual(mismatch.status, 400);
  assert.match(mismatch.body.error, /match/);
});

test('login works with username or email and rejects bad passwords', async function () {
  const byName = await post('/api/login', { identifier: 'jingle', password: 'swordfish7' });
  assert.strictEqual(byName.status, 200);
  assert.ok(byName.body.token);

  const byEmail = await post('/api/login', { identifier: 'jingle@mythara.gg', password: 'swordfish7' });
  assert.strictEqual(byEmail.status, 200);

  const wrong = await post('/api/login', { identifier: 'jingle', password: 'nope-nope' });
  assert.strictEqual(wrong.status, 401);
  assert.match(wrong.body.error, /Incorrect password/);

  const missing = await post('/api/login', { identifier: 'ghost', password: 'swordfish7' });
  assert.strictEqual(missing.status, 401);
});

test('device A plays, saves, and device B pulls the same account', async function () {
  const deviceA = await post('/api/login', { identifier: 'jingle', password: 'swordfish7' });
  const tokenA = deviceA.body.token;

  const pulled = await get('/api/account', tokenA);
  assert.strictEqual(pulled.status, 200);

  // play a stage on device A: coins, items and stars move forward
  const updated = pulled.body.account;
  updated.profile.coins = 2750;
  updated.profile.inventory.push({ uid: 'it_test_2', templateId: 'boots_rare', slot: 'boots', rarity: 'rare', level: 1 });
  updated.profile.stageProgress['c1-2'] = { stars: 3, clears: 1, cleared: true, bestTimeMs: 38120 };
  updated.profile.characters.archer.level = 13;

  const saved = await put('/api/account', { account: updated, baseRevision: pulled.body.revision }, tokenA);
  assert.strictEqual(saved.status, 200);
  assert.ok(saved.body.revision > pulled.body.revision);

  // device B (phone) logs in with the same credentials
  const deviceB = await post('/api/login', { identifier: 'jingle', password: 'swordfish7' });
  const after = await get('/api/account', deviceB.body.token);
  assert.strictEqual(after.body.account.profile.coins, 2750, 'same coins');
  assert.strictEqual(after.body.account.profile.characters.archer.level, 13, 'same character level');
  assert.strictEqual(after.body.account.profile.stageProgress['c1-2'].stars, 3, 'same stage progress');
  assert.ok(after.body.account.profile.inventory.some(function (item) { return item.uid === 'it_test_2'; }), 'same items');
});

test('a stale revision from another device is reported as a conflict', async function () {
  const deviceA = await post('/api/login', { identifier: 'jingle', password: 'swordfish7' });
  const deviceB = await post('/api/login', { identifier: 'jingle', password: 'swordfish7' });
  const baseAccount = await get('/api/account', deviceA.body.token);
  const baseRevision = baseAccount.body.revision;

  // device A saves first
  const firstSave = await put('/api/account', { account: baseAccount.body.account, baseRevision: baseRevision }, deviceA.body.token);
  assert.strictEqual(firstSave.status, 200);

  // device B still holds the old revision → must be told to merge
  const staleAccount = baseAccount.body.account;
  staleAccount.profile.coins = 9999;
  const conflict = await put('/api/account', { account: staleAccount, baseRevision: baseRevision }, deviceB.body.token);
  assert.strictEqual(conflict.status, 409);
  assert.strictEqual(conflict.body.conflict, true);
  assert.ok(conflict.body.account, 'server returns its copy so the client can merge');

  // forcing the write (client decided its copy is newer) is allowed
  const forced = await put('/api/account', { account: staleAccount, baseRevision: baseRevision, force: true }, deviceB.body.token);
  assert.strictEqual(forced.status, 200);
  assert.strictEqual(forced.body.revision, conflict.body.revision + 1);
});

test('a save without a baseRevision cannot silently clobber another device', async function () {
  const one = await post('/api/login', { identifier: 'jingle', password: 'swordfish7' });
  const two = await post('/api/login', { identifier: 'jingle', password: 'swordfish7' });
  const current = await get('/api/account', one.body.token);

  // no baseRevision at all → "never synced", so the server protects the copy
  const blind = await put('/api/account', { account: { profile: current.body.account.profile } }, two.body.token);
  assert.strictEqual(blind.status, 409, 'a blind write must not overwrite another device');
  assert.strictEqual(blind.body.conflict, true);
  assert.ok(blind.body.account, 'the server returns its copy to merge');

  // baseRevision 0 (fresh device / cleared storage) is the same story
  const zero = await put('/api/account', { account: { profile: current.body.account.profile }, baseRevision: 0 }, two.body.token);
  assert.strictEqual(zero.status, 409);

  // the revision the client actually holds goes through
  const good = await put('/api/account', { account: { profile: current.body.account.profile }, baseRevision: current.body.revision }, two.body.token);
  assert.strictEqual(good.status, 200);
  assert.strictEqual(good.body.revision, current.body.revision + 1);

  // force:true remains the explicit "my copy wins" override
  const forced = await put('/api/account', { account: { profile: current.body.account.profile }, baseRevision: 0, force: true }, two.body.token);
  assert.strictEqual(forced.status, 200);
});

test('tokens are required and can be revoked by logging out', async function () {
  const login = await post('/api/login', { identifier: 'jingle', password: 'swordfish7' });
  const token = login.body.token;

  const noToken = await get('/api/account');
  assert.strictEqual(noToken.status, 401);
  const badToken = await get('/api/account', 'deadbeef');
  assert.strictEqual(badToken.status, 401);

  const session = await get('/api/session', token);
  assert.strictEqual(session.body.account.username, 'jingle');

  const out = await post('/api/logout', {}, token);
  assert.strictEqual(out.status, 200);
  const afterLogout = await get('/api/account', token);
  assert.strictEqual(afterLogout.status, 401, 'token must stop working after logout');
});

test('changing the password keeps the account but drops other sessions', async function () {
  const one = await post('/api/login', { identifier: 'jingle', password: 'swordfish7' });
  const two = await post('/api/login', { identifier: 'jingle', password: 'swordfish7' });

  const changed = await post('/api/password', { current: 'swordfish7', next: 'newsword99', confirm: 'newsword99' }, one.body.token);
  assert.strictEqual(changed.status, 200);

  const otherDevice = await get('/api/account', two.body.token);
  assert.strictEqual(otherDevice.status, 401, 'other devices must re-authenticate');

  const oldPassword = await post('/api/login', { identifier: 'jingle', password: 'swordfish7' });
  assert.strictEqual(oldPassword.status, 401);
  const newPassword = await post('/api/login', { identifier: 'jingle', password: 'newsword99' });
  assert.strictEqual(newPassword.status, 200);

  // progress survived the password change
  const stillThere = await get('/api/account', newPassword.body.token);
  assert.ok(stillThere.body.account.profile.inventory.length >= 2);
});

test('passwords are hashed with a per-account salt, never stored in plain text', async function () {
  const raw = fs.readFileSync(dbFile, 'utf8');
  assert.ok(raw.indexOf('newsword99') === -1, 'database must not contain the password');
  assert.ok(raw.indexOf('swordfish7') === -1, 'database must not contain the original password');
  assert.match(raw, /"salt":/);
  assert.match(raw, /"passwordHash":/);

  const db = createDb({ file: dbFile });
  const account = db.findByUsername('jingle');
  assert.ok(account.salt && account.salt.length >= 16);
  assert.ok(account.passwordHash.length === 128, 'scrypt output is 64 bytes of hex');
  assert.strictEqual(auth.verifyPassword('newsword99', account.salt, account.passwordHash), true);
  assert.strictEqual(auth.verifyPassword('swordfish7', account.salt, account.passwordHash), false);
});

test('the database survives a server restart', async function () {
  await new Promise(function (resolve) { server.close(resolve); });
  const restarted = await start({ port: 0, host: '127.0.0.1', dbFile: dbFile });
  server = restarted.server;
  base = 'http://127.0.0.1:' + restarted.port;

  const login = await post('/api/login', { identifier: 'jingle', password: 'newsword99' });
  assert.strictEqual(login.status, 200);
  const account = await get('/api/account', login.body.token);
  assert.strictEqual(account.body.account.profile.coins, 9999);
  assert.ok(account.body.account.profile.inventory.length >= 2);
});
