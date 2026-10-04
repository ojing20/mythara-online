/* ============================================================
 * Mythara Online — tools/build-standalone.js
 * ------------------------------------------------------------
 * Writes a single-file copy of the game (styles + scripts inlined)
 * to mythara-standalone.html in the repository root. Double-click
 * the result and it runs offline — no server, no network, no CDN.
 *
 *   node tools/build-standalone.js
 *   node tools/build-standalone.js --out=/tmp/mythara.html
 *
 * The build is the same inliner the headless test harness uses, so
 * the standalone file is byte-for-byte the code the suites verify.
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { buildInlineHtml, REPO } = require('./lib/inline.js');

const args = {};
process.argv.slice(2).forEach(function (a) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
});

const out = args.out || path.join(REPO, 'mythara-standalone.html');

const html = buildInlineHtml();
if (html.indexOf('src="js/') !== -1) {
  console.error('build failed: a <script src> survived inlining');
  process.exit(1);
}
if (html.indexOf('href="style') !== -1) {
  console.error('build failed: a stylesheet link survived inlining');
  process.exit(1);
}

fs.writeFileSync(out, html, 'utf8');
const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
console.log('wrote ' + out + '  (' + kb + ' KB, fully self-contained)');
console.log('open it directly in a browser — the game runs offline.');
