/* ============================================================
 * Mythara Online — server/auth.js
 * ------------------------------------------------------------
 * Credential rules + password hashing for the account server.
 *
 * Passwords are NEVER stored in plain text and never leave the
 * client in readable form over the wire until TLS is added (run
 * the server behind HTTPS in production — see README).
 *
 * Hashing: scrypt with a per-account random salt, compared with
 * timingSafeEqual. Tokens are 256-bit random hex strings.
 * ============================================================ */
'use strict';

const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Mirrors the client-side validation so both agree on the rules. */
function validateCredentials(payload) {
  const username = String((payload && payload.username) || '').trim();
  const email = String((payload && payload.email) || '').trim();
  const password = String((payload && payload.password) || '');
  const confirm = payload ? payload.confirm : undefined;

  if (!USERNAME_RE.test(username)) {
    return 'Username must be 3–16 characters (letters, numbers and underscores).';
  }
  if (payload && payload.email !== undefined && email && !EMAIL_RE.test(email)) {
    return 'Please enter a valid email address.';
  }
  if (password.length < 6) return 'Password must be at least 6 characters.';
  if (password.length > 128) return 'Password must be 128 characters or fewer.';
  if (confirm !== undefined && confirm !== password) return 'Passwords do not match.';
  return null;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt: salt, passwordHash: hashWith(password, salt) };
}

function hashWith(password, salt) {
  return crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p
  }).toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  let actual;
  try {
    actual = Buffer.from(hashWith(password, salt), 'hex');
  } catch (err) {
    return false;
  }
  const expected = Buffer.from(String(expectedHash), 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Shape sent to clients — secrets never leave the server. */
function publicAccount(account) {
  if (!account) return null;
  return {
    id: account.id,
    username: account.username,
    email: account.email || '',
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt,
    revision: account.revision,
    updatedAt: account.updatedAt,
    profile: account.profile
  };
}

module.exports = {
  validateCredentials: validateCredentials,
  hashPassword: hashPassword,
  verifyPassword: verifyPassword,
  createToken: createToken,
  publicAccount: publicAccount,
  SCRYPT: SCRYPT
};
