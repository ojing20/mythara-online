/* ============================================================
 * Mythara Online — tools/lib/inline.js
 * ------------------------------------------------------------
 * Builds a fully-inlined copy of index.html (styles + scripts) so
 * jsdom can boot the game. jsdom never fetches external files, so
 * every <link rel="stylesheet"> and <script src> is replaced by the
 * file contents — the same thing the single-file standalone build does.
 *
 * Dev tool only: nothing here ships with the game.
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

/** Repository root (tools/lib → ../../). MYTHARA_REPO overrides for testing. */
const REPO = process.env.MYTHARA_REPO || path.resolve(__dirname, '..', '..');

function buildInlineHtml() {
  let html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

  html = html.replace(/<link rel="stylesheet" href="([^"]+)"\s*\/?>/g, function (match, href) {
    const file = path.join(REPO, href);
    if (!fs.existsSync(file)) return match;
    return '<style>\n' + fs.readFileSync(file, 'utf8') + '\n</style>';
  });

  html = html.replace(/<script src="([^"]+)"><\/script>/g, function (match, src) {
    const file = path.join(REPO, src);
    if (!fs.existsSync(file)) throw new Error('missing script ' + src);
    const js = fs.readFileSync(file, 'utf8').replace(/<\/script/g, '<\\/script');
    return '<script>\n/* ==== ' + src + ' ==== */\n' + js + '\n</script>';
  });

  return html;
}

module.exports = { buildInlineHtml, REPO };
