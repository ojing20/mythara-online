/* ============================================================
 * Mythara Online — js/sfx.js
 * ------------------------------------------------------------
 * Tiny procedural sound-effect kit. Every sound is synthesised
 * with WebAudio at play time — no audio files, no downloads, no
 * build step, so it costs nothing until it is used.
 *
 *   • lazily creates the AudioContext on the first user gesture
 *     (browsers block audio before that)
 *   • honours Settings → "Sound effects" (account.settings.sfx)
 *   • throttles repeated sounds so a 10-monster fight cannot turn
 *     into a wall of noise or a CPU spike
 *   • degrades to a silent no-op where WebAudio is missing
 *     (headless tests, old browsers, locked-down webviews)
 *
 * The engine only calls MytharaSFX.play('hit') — nothing else in
 * the game needs to know how the sound is made.
 * ============================================================ */
(function (root) {
  'use strict';

  const SFX = (function () {
    let ctx = null;
    let master = null;
    let failed = false;
    let userEnabled = true;
    const lastAt = {};
    const THROTTLE = {           // minimum ms between repeats of one sound
      swing: 70, hit: 55, crit: 90, hurt: 90, miss: 90, cast: 90,
      loot: 60, coin: 60, select: 40, death: 160, level: 250, boss: 400
    };
    const MIN_VOLUME = 0.0001;

    /** Account setting wins; default is on. Safe before sign-in. */
    function enabled() {
      if (failed || userEnabled === false) return false;
      try {
        const A = root.MytharaAccount && root.MytharaAccount.Account;
        if (A && typeof A.isReady === 'function' && A.isReady()) {
          const profile = A.profile && A.profile();
          if (profile && profile.settings && profile.settings.sfx === false) return false;
        }
      } catch (err) { /* treat as enabled */ }
      return true;
    }

    function now() {
      const perf = root.performance;
      return perf && perf.now ? perf.now() : Date.now();
    }

    /** Create/resume the audio graph. Called on the first real sound. */
    function unlock() {
      if (ctx || failed) {
        if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume();
        return ctx;
      }
      const Ctor = root.AudioContext || root.webkitAudioContext;
      if (!Ctor) { failed = true; return null; }
      try {
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = 0.32;
        master.connect(ctx.destination);
      } catch (err) {
        failed = true;
        ctx = null;
      }
      return ctx;
    }

    /** One shaped oscillator note: attack → hold → exponential release. */
    function tone(o) {
      const c = ctx;
      const t0 = c.currentTime + (o.delay || 0);
      const dur = o.dur || 0.12;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = o.type || 'triangle';
      osc.frequency.setValueAtTime(o.from, t0);
      if (o.to && o.to !== o.from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur);
      const peak = Math.max(MIN_VOLUME, o.gain === undefined ? 0.5 : o.gain);
      gain.gain.setValueAtTime(MIN_VOLUME, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.02, dur * 0.25));
      gain.gain.exponentialRampToValueAtTime(MIN_VOLUME, t0 + dur);
      osc.connect(gain);
      if (o.filter) {
        const f = c.createBiquadFilter();
        f.type = o.filter;
        f.frequency.value = o.cutoff || 900;
        gain.connect(f);
        f.connect(master);
      } else {
        gain.connect(master);
      }
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    /** Filtered noise burst — impacts, swings, footsteps, magic air. */
    function noise(o) {
      const c = ctx;
      const t0 = c.currentTime + (o.delay || 0);
      const dur = o.dur || 0.12;
      const frames = Math.max(1, Math.floor(c.sampleRate * dur));
      const buffer = c.createBuffer(1, frames, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) {
        const fade = 1 - i / frames;
        data[i] = (Math.random() * 2 - 1) * fade * fade;
      }
      const src = c.createBufferSource();
      src.buffer = buffer;
      const filter = c.createBiquadFilter();
      filter.type = o.filter || 'bandpass';
      filter.frequency.setValueAtTime(o.from || 800, t0);
      if (o.to) filter.frequency.exponentialRampToValueAtTime(Math.max(60, o.to), t0 + dur);
      filter.Q.value = o.q === undefined ? 1.1 : o.q;
      const gain = c.createGain();
      gain.gain.setValueAtTime(Math.max(MIN_VOLUME, o.gain === undefined ? 0.4 : o.gain), t0);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    }

    /* ---------------- the sound bank ---------------- */
    const BANK = {
      swing: function () {
        noise({ dur: 0.14, from: 1800, to: 380, gain: 0.26, q: 0.8 });
      },
      hit: function () {
        noise({ dur: 0.1, from: 900, to: 200, gain: 0.42, q: 0.7 });
        tone({ type: 'sine', from: 190, to: 90, dur: 0.1, gain: 0.3 });
      },
      crit: function () {
        noise({ dur: 0.16, from: 2400, to: 300, gain: 0.45, q: 0.9 });
        tone({ type: 'square', from: 420, to: 160, dur: 0.16, gain: 0.22 });
        tone({ type: 'sine', from: 900, to: 1500, dur: 0.12, gain: 0.12, delay: 0.02 });
      },
      miss: function () {
        noise({ dur: 0.16, from: 2600, to: 900, gain: 0.16, q: 0.6 });
      },
      hurt: function () {
        noise({ dur: 0.14, from: 500, to: 120, gain: 0.34, q: 0.5 });
        tone({ type: 'sawtooth', from: 150, to: 70, dur: 0.18, gain: 0.22 });
      },
      cast: function () {
        tone({ type: 'sine', from: 260, to: 900, dur: 0.22, gain: 0.2 });
        noise({ dur: 0.24, from: 600, to: 2200, gain: 0.14, q: 0.7 });
      },
      death: function () {
        tone({ type: 'sawtooth', from: 300, to: 60, dur: 0.5, gain: 0.26 });
        noise({ dur: 0.4, from: 700, to: 90, gain: 0.3, q: 0.4 });
      },
      downed: function () {
        tone({ type: 'triangle', from: 220, to: 70, dur: 0.8, gain: 0.3 });
        tone({ type: 'sine', from: 110, to: 55, dur: 0.9, gain: 0.22 });
      },
      revive: function () {
        tone({ type: 'sine', from: 300, to: 700, dur: 0.3, gain: 0.22 });
        tone({ type: 'sine', from: 450, to: 900, dur: 0.35, gain: 0.18, delay: 0.12 });
      },
      level: function () {
        tone({ type: 'triangle', from: 620, to: 640, dur: 0.16, gain: 0.24 });
        tone({ type: 'triangle', from: 780, to: 800, dur: 0.18, gain: 0.22, delay: 0.13 });
        tone({ type: 'triangle', from: 980, to: 1000, dur: 0.3, gain: 0.2, delay: 0.27 });
      },
      loot: function () {
        tone({ type: 'triangle', from: 700, to: 1150, dur: 0.1, gain: 0.2 });
      },
      coin: function () {
        tone({ type: 'square', from: 1100, to: 1200, dur: 0.06, gain: 0.14 });
        tone({ type: 'square', from: 1500, to: 1600, dur: 0.09, gain: 0.12, delay: 0.05 });
      },
      potion: function () {
        tone({ type: 'sine', from: 380, to: 720, dur: 0.2, gain: 0.22 });
        noise({ dur: 0.16, from: 400, to: 1400, gain: 0.12, q: 0.6 });
      },
      select: function () {
        tone({ type: 'square', from: 900, to: 1150, dur: 0.05, gain: 0.1 });
      },
      boss: function () {
        tone({ type: 'sawtooth', from: 120, to: 80, dur: 0.9, gain: 0.3 });
        tone({ type: 'sawtooth', from: 180, to: 110, dur: 0.9, gain: 0.2, delay: 0.05 });
      }
    };

    /**
     * Play a named sound. Never throws, never blocks, silently ignored
     * when audio is unavailable or disabled.
     */
    function play(name, options) {
      const opts = options || {};
      const recipe = BANK[name];
      if (!recipe || !enabled()) return false;
      const clock = now();
      const gap = THROTTLE[name] === undefined ? 50 : THROTTLE[name];
      if (lastAt[name] !== undefined && clock - lastAt[name] < gap) return false;
      lastAt[name] = clock;
      if (!unlock()) return false;
      try {
        if (opts.volume !== undefined && master) master.gain.value = Math.max(0, Math.min(1, 0.32 * opts.volume));
        recipe();
      } catch (err) {
        failed = true;              // one broken sound disables the kit, not the game
        return false;
      }
      return true;
    }

    function setEnabled(on) { userEnabled = on !== false; if (userEnabled) unlock(); return userEnabled; }
    function isEnabled() { return enabled(); }
    function isAvailable() { return !failed; }

    return {
      play: play,
      unlock: unlock,
      setEnabled: setEnabled,
      isEnabled: isEnabled,
      isAvailable: isAvailable,
      sounds: BANK
    };
  })();

  root.MytharaSFX = SFX;
  if (typeof module !== 'undefined' && module.exports) module.exports = SFX;

})(typeof globalThis !== 'undefined' ? globalThis : this);
