#!/usr/bin/env node
/* ============================================================
 * Mythara Online — server/server.js
 * ------------------------------------------------------------
 * One command hosts the game AND the account database:
 *
 *     node server/server.js              # → http://localhost:8123
 *     PORT=9000 node server/server.js    # custom port
 *
 * Then open the printed Network URL on your phone or tablet
 * and log in with the same username — same account, same
 * items, same progress on every device.
 *
 * Zero dependencies: Node's own http/fs/crypto modules only.
 * ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createDb } = require('./db');
const api = require('./api');

const VERSION = '0.4.0-cloud';
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || process.argv[2] || 8123);
const HOST = process.env.HOST || '0.0.0.0';
const QUIET = !!process.env.QUIET;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function log(message) {
  if (!QUIET) console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + message);
}

/* ============================================================
 * Static file serving (the game itself)
 * ========================================================== */
function resolveStaticPath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const relative = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  const target = path.resolve(ROOT, relative);
  // never escape the project directory
  if (target !== ROOT && target.indexOf(ROOT + path.sep) !== 0) return null;
  if (relative.split('/').some(function (part) { return part === '..' || part === 'server' || part.indexOf('.') === 0 && part !== '.well-known'; })) {
    // server/ and dotfiles stay private (the DB lives there)
    if (relative.indexOf('server/') === 0 || relative.split('/').some(function (part) { return part.indexOf('.') === 0; })) return null;
  }
  return target;
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    api.send(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }
  const target = resolveStaticPath(req.url);
  if (!target) { api.send(res, 403, { ok: false, error: 'Forbidden.' }); return; }

  fs.stat(target, function (err, stat) {
    if (err || !stat.isFile()) {
      api.send(res, 404, { ok: false, error: 'Not found: ' + req.url });
      return;
    }
    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(target).pipe(res);
  });
}

/* ============================================================
 * Server
 * ========================================================== */
function createServer(options) {
  const opts = options || {};
  const db = createDb({ file: opts.dbFile, onError: function (err) { log('db error: ' + err.message); } });

  const ctx = {
    db: db,
    version: VERSION,
    log: opts.quiet ? function () {} : log,
    onError: function (err) {
      log('ERROR ' + (err && err.stack || err));
    }
  };

  const server = http.createServer(function (req, res) {
    // Devices on the same Wi-Fi load the game and the API from the same
    // origin, but permissive CORS lets you host the UI anywhere.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    api.route(ctx, req, res).then(function (handled) {
      if (handled) return;
      serveStatic(req, res);
    }).catch(function (err) {
      ctx.onError(err);
      if (!res.headersSent) api.send(res, 500, { ok: false, error: 'Server error.' });
    });
  });

  server.on('close', function () { db.flush(); });
  server.ctx = ctx;
  server.db = db;
  return server;
}

/** Every address this machine can be reached on (for phone/tablet links). */
function lanAddresses() {
  const out = [];
  const interfaces = os.networkInterfaces();
  Object.keys(interfaces).forEach(function (name) {
    (interfaces[name] || []).forEach(function (entry) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address);
    });
  });
  return out;
}

function start(options) {
  const opts = options || {};
  const server = createServer(opts);
  const port = opts.port === undefined || opts.port === null ? PORT : opts.port;
  return new Promise(function (resolve) {
    server.listen(port, opts.host || HOST, function () {
      const actual = server.address().port;
      resolve({ server: server, port: actual });
    });
  });
}

if (require.main === module) {
  start().then(function (out) {
    const stats = out.server.db.stats();
    console.log('');
    console.log('  ⚔  MYTHARA SERVER ' + VERSION);
    console.log('  ─────────────────────────────────────────────');
    console.log('  PC      : http://localhost:' + out.port);
    lanAddresses().forEach(function (address) {
      console.log('  Phone   : http://' + address + ':' + out.port + '   (same Wi-Fi)');
    });
    console.log('  Tablet  : same URL — log in as the same account');
    console.log('  Database: ' + path.relative(ROOT, stats.file) + '  (' + stats.accounts + ' accounts)');
    console.log('  Stop    : Ctrl+C');
    console.log('');
    console.log('  Same account · same items · same progress on every device.');
    console.log('');
  });

  process.on('SIGINT', function () {
    console.log('\n  Saving database and shutting down…');
    process.exit(0);
  });
  process.on('SIGTERM', function () { process.exit(0); });
}

module.exports = { createServer: createServer, start: start, ROOT: ROOT, VERSION: VERSION, lanAddresses: lanAddresses };
