/* ============================================================
 * Mythara Online — js/core.js
 * ------------------------------------------------------------
 * Framework-free foundation shared by every module:
 *   Bus      — tiny event bus (pub/sub)
 *   Storage  — namespaced persistence adapter with a memory
 *              fallback (swap for a REST/IndexedDB driver later)
 *   Format   — number/time/text helpers
 *   Dom      — element helpers
 *   Rng      — seeded + weighted random helpers
 * ============================================================ */
(function (root) {
  'use strict';

  const Core = { version: '0.3.0' };

  /* ---------------- Bus ---------------- */
  const Bus = (function () {
    const handlers = {};
    function on(event, handler) {
      if (typeof handler !== 'function') return function () {};
      (handlers[event] || (handlers[event] = [])).push(handler);
      return function off() { off2(event, handler); };
    }
    function off2(event, handler) {
      handlers[event] = (handlers[event] || []).filter(function (h) { return h !== handler; });
    }
    function once(event, handler) {
      const off = on(event, function (payload) { off(); handler(payload); });
      return off;
    }
    function emit(event, payload) {
      (handlers[event] || []).slice().forEach(function (h) {
        try { h(payload); } catch (err) { if (root.console) root.console.error('[bus:' + event + ']', err); }
      });
    }
    function clear(event) { if (event) delete handlers[event]; else Object.keys(handlers).forEach(function (k) { delete handlers[k]; }); }
    return { on: on, off: off2, once: once, emit: emit, clear: clear };
  })();

  /* ---------------- Storage ----------------
   * Every key is namespaced under `prefix`. When the browser blocks
   * storage (private mode, file:// with strict settings) we fall back to
   * an in-memory map so the game still runs — it just will not persist.
   * A future server backend can replace this object wholesale:
   *   Storage.driver = { get, set, remove, keys }
   * ------------------------------------------ */
  const Storage = (function () {
    const memory = {};
    let available = null;
    const prefix = 'mythara:';

    function probe() {
      if (available !== null) return available;
      try {
        const ls = root.localStorage;
        if (!ls) { available = false; return available; }
        ls.setItem(prefix + '__probe', '1');
        ls.removeItem(prefix + '__probe');
        available = true;
      } catch (err) {
        available = false;
      }
      return available;
    }

    function key(name) { return prefix + name; }

    function getRaw(name) {
      if (probe()) {
        try { return root.localStorage.getItem(key(name)); } catch (err) { /* fall through */ }
      }
      return Object.prototype.hasOwnProperty.call(memory, name) ? memory[name] : null;
    }

    function setRaw(name, value) {
      memory[name] = value;
      if (probe()) {
        try { root.localStorage.setItem(key(name), value); return true; } catch (err) { return false; }
      }
      return false;
    }

    function remove(name) {
      delete memory[name];
      if (probe()) { try { root.localStorage.removeItem(key(name)); } catch (err) { /* ignore */ } }
    }

    function keys() {
      const out = {};
      Object.keys(memory).forEach(function (k) { out[k] = true; });
      if (probe()) {
        try {
          const ls = root.localStorage;
          for (let i = 0; i < ls.length; i++) {
            const full = ls.key(i);
            if (full && full.indexOf(prefix) === 0) out[full.slice(prefix.length)] = true;
          }
        } catch (err) { /* ignore */ }
      }
      return Object.keys(out);
    }

    function getJSON(name, fallback) {
      const raw = getRaw(name);
      if (raw === null || raw === undefined) return fallback;
      try { return JSON.parse(raw); } catch (err) { return fallback; }
    }

    function setJSON(name, value) { return setRaw(name, JSON.stringify(value)); }

    return {
      get: getRaw, set: setRaw, remove: remove, keys: keys,
      getJSON: getJSON, setJSON: setJSON,
      isPersistent: probe,
      clearAll: function () {
        keys().forEach(function (k) { remove(k); });
        Object.keys(memory).forEach(function (k) { delete memory[k]; });
      }
    };
  })();

  /* ---------------- Format ---------------- */
  const Format = {
    /** Thousands-separated integer (alias of number()). */
    int: function (value) { return Format.number(value); },
    number: function (value) {
      const n = Math.round(value || 0);
      return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },
    compact: function (value) {
      const n = Number(value) || 0;
      if (n < 1000) return String(Math.round(n));
      if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'K';
      return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    },
    percent: function (ratio, digits) {
      return ((Number(ratio) || 0) * 100).toFixed(digits === undefined ? 0 : digits) + '%';
    },
    clock: function (seconds) {
      const total = Math.max(0, Math.floor(seconds || 0));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return m + ':' + (s < 10 ? '0' : '') + s;
    },
    duration: function (ms) {
      const total = Math.max(0, Math.floor((ms || 0) / 1000));
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      if (h > 0) return h + 'h ' + m + 'm';
      if (m > 0) return m + 'm ' + s + 's';
      return s + 's';
    },
    date: function (timestamp) {
      try { return new Date(timestamp).toLocaleDateString(); } catch (err) { return '—'; }
    },
    titleCase: function (text) {
      return String(text || '').replace(/(^|[\s-])([a-z])/g, function (m, pre, ch) { return pre + ch.toUpperCase(); });
    },
    roman: function (n) {
      const table = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
      let value = Math.max(0, Math.floor(n || 0));
      let out = '';
      table.forEach(function (pair) {
        while (value >= pair[0]) { out += pair[1]; value -= pair[0]; }
      });
      return out || 'I';
    }
  };

  /* ---------------- Dom ---------------- */
  const Dom = {
    qs: function (selector, scope) { return (scope || root.document).querySelector(selector); },
    qsa: function (selector, scope) { return Array.prototype.slice.call((scope || root.document).querySelectorAll(selector)); },
    id: function (id, scope) { return (scope || root.document).getElementById(id); },
    create: function (tag, className, text) {
      const node = root.document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = String(text);
      return node;
    },
    on: function (node, event, handler, options) {
      if (!node || !node.addEventListener) return function () {};
      node.addEventListener(event, handler, options);
      return function () { node.removeEventListener(event, handler, options); };
    },
    delegate: function (scope, selector, event, handler) {
      return Dom.on(scope, event, function (e) {
        const match = e.target && e.target.closest ? e.target.closest(selector) : null;
        if (match && scope.contains(match)) handler(e, match);
      });
    },
    clear: function (node) { if (node) node.innerHTML = ''; },
    show: function (node) { if (node) node.classList.remove('is-hidden'); },
    hide: function (node) { if (node) node.classList.add('is-hidden'); },
    toggle: function (node, visible) { if (node) node.classList.toggle('is-hidden', !visible); },
    setText: function (node, text) { if (node && node.textContent !== String(text)) node.textContent = String(text); },
    setWidth: function (node, ratio) {
      if (!node) return;
      node.style.width = (Math.max(0, Math.min(1, ratio || 0)) * 100).toFixed(2) + '%';
    },
    setClass: function (node, className, active) { if (node) node.classList.toggle(className, !!active); }
  };

  /* ---------------- Rng ---------------- */
  const Rng = (function () {
    let generator = Math.random;
    function random() { return generator(); }
    function range(min, max) { return min + random() * (max - min); }
    function int(min, max) { return Math.floor(range(min, max + 1)); }
    function pick(list) { return list[Math.floor(random() * list.length)]; }
    function chance(probability) { return random() < probability; }
    /** Pick from [{ weight, ... }] objects weighted by their `weight`. */
    function weighted(entries, weightKey) {
      const key = weightKey || 'weight';
      let total = 0;
      entries.forEach(function (entry) { total += Math.max(0, entry[key] || 0); });
      if (total <= 0) return entries[0] || null;
      let roll = random() * total;
      for (let i = 0; i < entries.length; i++) {
        roll -= Math.max(0, entries[i][key] || 0);
        if (roll <= 0) return entries[i];
      }
      return entries[entries.length - 1];
    }
    function shuffle(list) {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
      }
      return out;
    }
    function setGenerator(fn) { generator = typeof fn === 'function' ? fn : Math.random; }
    function reset() { generator = Math.random; }
    /** mulberry32 — deterministic sequences for tests and procedural art. */
    function seeded(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    return {
      random: random, range: range, int: int, pick: pick, chance: chance,
      weighted: weighted, shuffle: shuffle, setGenerator: setGenerator, reset: reset, seeded: seeded
    };
  })();

  Core.Bus = Bus;
  Core.Storage = Storage;
  Core.Format = Format;
  Core.Dom = Dom;
  Core.Rng = Rng;
  Core.clamp = function (v, min, max) { return v < min ? min : v > max ? max : v; };
  Core.uid = function (prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  };
  Core.deepClone = function (value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (err) { return value; }
  };
  /** Stable non-cryptographic digest — see Account for the password note. */
  Core.digest = function (text) {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    const str = String(text);
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 16777619) >>> 0;
      h2 = Math.imul(h2 + code, 2246822519) >>> 0;
      h2 = (h2 ^ (h2 >>> 13)) >>> 0;
    }
    return (h1.toString(16) + h2.toString(16)).padStart(16, '0');
  };

  root.MytharaCore = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;

})(typeof globalThis !== 'undefined' ? globalThis : this);
