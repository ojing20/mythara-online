/* ============================================================
 * Mythara Online — server/api.js
 * ------------------------------------------------------------
 * REST API for cross-device accounts. Every device plays the
 * same JINGLE: same account, same items, same progress.
 *
 *   GET    /api/health                 service info
 *   POST   /api/register               create account → token + account
 *   POST   /api/login                  username/email + password → token + account
 *   POST   /api/logout                 drop the session
 *   GET    /api/session                who is this token?
 *   GET    /api/account                pull the saved account
 *   PUT    /api/account                push the account (revision checked)
 *   POST   /api/password               change password
 *
 * The API is intentionally thin so it can be re-implemented on
 * top of SQL/Redis without the game client noticing.
 * ============================================================ */
'use strict';

const auth = require('./auth');

const MAX_BODY_BYTES = 1024 * 1024;         // 1 MB is plenty for a profile
const MAX_PROFILE_BYTES = 512 * 1024;

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      if (!chunks.length) { resolve({}); return; }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/** Resolve the session (and account) behind the request token. */
function withAccount(db, req) {
  const token = bearerToken(req);
  if (!token) return { error: { status: 401, body: { ok: false, error: 'Missing session token.' } } };
  const session = db.findSession(token);
  if (!session) return { error: { status: 401, body: { ok: false, error: 'Session expired — please log in again.' } } };
  const account = db.accountById(session.accountId);
  if (!account) return { error: { status: 401, body: { ok: false, error: 'Account no longer exists.' } } };
  return { token: token, session: session, account: account };
}

function accountStats(profile) {
  if (!profile) return '';
  const characters = profile.characters || {};
  const level = Object.keys(characters).reduce(function (max, id) {
    return Math.max(max, characters[id].level || 1);
  }, 1);
  return 'Lv. ' + level + ' · ' + (profile.coins || 0) + ' coins';
}

/* ============================================================
 * Route handlers
 * ========================================================== */
function handleHealth(ctx) {
  const stats = ctx.db.stats();
  return {
    status: 200,
    body: {
      ok: true,
      service: 'mythara-server',
      version: ctx.version,
      accounts: stats.accounts,
      sessions: stats.sessions,
      database: 'json-file',
      time: Date.now()
    }
  };
}

async function handleRegister(ctx, req) {
  const body = await readBody(req);
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim();
  const problems = auth.validateCredentials({ username: username, email: email, password: body.password, confirm: body.confirm });
  if (problems) return { status: 400, body: { ok: false, error: problems } };

  if (ctx.db.findByUsername(username)) return { status: 409, body: { ok: false, error: 'That username is already taken.' } };
  if (email && ctx.db.findByEmail(email)) return { status: 409, body: { ok: false, error: 'That email is already registered.' } };

  const secrets = auth.hashPassword(body.password);
  const account = ctx.db.createAccount({
    username: username,
    email: email,
    salt: secrets.salt,
    passwordHash: secrets.passwordHash,
    profile: body.profile && typeof body.profile === 'object' ? body.profile : null
  });

  const token = auth.createToken();
  ctx.db.createSession(account.id, token);
  ctx.log('registered ' + account.username + ' (' + account.id + ')');
  return { status: 201, body: { ok: true, token: token, account: auth.publicAccount(account) } };
}

async function handleLogin(ctx, req) {
  const body = await readBody(req);
  const identifier = String(body.identifier || body.username || body.email || '').trim();
  if (!identifier) return { status: 400, body: { ok: false, error: 'Enter a username or email.' } };

  const account = ctx.db.findByIdentifier(identifier);
  if (!account) return { status: 401, body: { ok: false, error: 'No account found for that username or email.' } };
  if (!auth.verifyPassword(body.password, account.salt, account.passwordHash)) {
    return { status: 401, body: { ok: false, error: 'Incorrect password.' } };
  }

  account.lastLoginAt = Date.now();
  ctx.db.updateAccount(account);
  const token = auth.createToken();
  ctx.db.createSession(account.id, token);
  ctx.log('login ' + account.username + ' (' + accountStats(account.profile) + ')');
  return { status: 200, body: { ok: true, token: token, account: auth.publicAccount(account) } };
}

function handleLogout(ctx, req) {
  const token = bearerToken(req);
  if (token) ctx.db.deleteSession(token);
  return { status: 200, body: { ok: true } };
}

function handleSession(ctx, req) {
  const found = withAccount(ctx.db, req);
  if (found.error) return found.error;
  return { status: 200, body: { ok: true, account: auth.publicAccount(found.account), revision: found.account.revision } };
}

function handleGetAccount(ctx, req) {
  const found = withAccount(ctx.db, req);
  if (found.error) return found.error;
  const account = found.account;
  return {
    status: 200,
    body: {
      ok: true,
      account: auth.publicAccount(account),
      revision: account.revision,
      updatedAt: account.updatedAt
    }
  };
}

/**
 * Save the account. `baseRevision` lets the client detect that another
 * device wrote first; the caller then merges (see js/sync.js).
 *
 * A missing/0 baseRevision means "I have never synced this account", so
 * it can never silently overwrite a copy another device already saved —
 * it gets the 409 + the server copy and merges like everyone else.
 * `force: true` stays available as the explicit override.
 */
async function handlePutAccount(ctx, req) {
  const found = withAccount(ctx.db, req);
  if (found.error) return found.error;
  const body = await readBody(req);
  const account = found.account;
  const incoming = body.account && typeof body.account === 'object' ? body.account : null;
  if (!incoming || !incoming.profile || typeof incoming.profile !== 'object') {
    return { status: 400, body: { ok: false, error: 'Missing account profile.' } };
  }
  if (Buffer.byteLength(JSON.stringify(incoming.profile)) > MAX_PROFILE_BYTES) {
    return { status: 413, body: { ok: false, error: 'Profile is too large.' } };
  }

  const parsedBase = Number(body.baseRevision);
  const baseRevision = Number.isFinite(parsedBase) ? parsedBase : 0;
  const force = !!body.force;
  if (!force && baseRevision < account.revision) {
    return {
      status: 409,
      body: {
        ok: false,
        conflict: true,
        error: 'Another device saved more recently.',
        revision: account.revision,
        updatedAt: account.updatedAt,
        account: auth.publicAccount(account)
      }
    };
  }

  account.profile = incoming.profile;
  account.profile.updatedAt = Date.now();
  account.revision += 1;
  account.updatedAt = account.profile.updatedAt;
  ctx.db.updateAccount(account);
  ctx.log('saved ' + account.username + ' rev ' + account.revision + ' (' + accountStats(account.profile) + ')');
  return { status: 200, body: { ok: true, revision: account.revision, updatedAt: account.updatedAt } };
}

async function handlePassword(ctx, req) {
  const found = withAccount(ctx.db, req);
  if (found.error) return found.error;
  const body = await readBody(req);
  const account = found.account;
  if (!auth.verifyPassword(body.current, account.salt, account.passwordHash)) {
    return { status: 401, body: { ok: false, error: 'Current password is incorrect.' } };
  }
  const problems = auth.validateCredentials({ username: account.username, password: body.next, confirm: body.confirm });
  if (problems) return { status: 400, body: { ok: false, error: problems } };

  const secrets = auth.hashPassword(body.next);
  account.salt = secrets.salt;
  account.passwordHash = secrets.passwordHash;
  account.updatedAt = Date.now();
  account.revision += 1;
  ctx.db.updateAccount(account);

  // every other device must log in again with the new password
  const dropped = ctx.db.deleteSessionsFor(account.id, found.token);
  ctx.log('password changed for ' + account.username + ' (other sessions dropped: ' + dropped + ')');
  return { status: 200, body: { ok: true } };
}

const ROUTES = [
  { method: 'GET', path: '/api/health', handler: handleHealth, open: true },
  { method: 'POST', path: '/api/register', handler: handleRegister, open: true },
  { method: 'POST', path: '/api/login', handler: handleLogin, open: true },
  { method: 'POST', path: '/api/logout', handler: handleLogout, open: true },
  { method: 'GET', path: '/api/session', handler: handleSession, open: true },
  { method: 'GET', path: '/api/account', handler: handleGetAccount, open: true },
  { method: 'PUT', path: '/api/account', handler: handlePutAccount, open: true },
  { method: 'POST', path: '/api/password', handler: handlePassword, open: true }
];

/**
 * Returns true when the request was an API call (handled here),
 * false when the static file server should take over.
 */
async function route(ctx, req, res) {
  const url = req.url.split('?')[0];
  if (url.indexOf('/api/') !== 0) return false;

  const match = ROUTES.filter(function (entry) {
    return entry.method === req.method && entry.path === url;
  })[0];

  if (!match) {
    send(res, 404, { ok: false, error: 'Unknown endpoint ' + req.method + ' ' + url });
    return true;
  }

  try {
    const result = await match.handler(ctx, req);
    send(res, result.status, result.body);
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    if (ctx.onError) ctx.onError(err);
    send(res, status, { ok: false, error: status === 500 ? 'Server error.' : err.message });
  }
  return true;
}

module.exports = { route: route, send: send, readBody: readBody, MAX_BODY_BYTES: MAX_BODY_BYTES };
