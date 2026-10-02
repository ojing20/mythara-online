/* ============================================================
 * Mythara Online — js/render3d-core.js
 * ------------------------------------------------------------
 * A dependency-free software 3D core for the canvas renderer:
 *
 *   Math3   — tiny vec3 / mat4 helpers (no allocations in hot paths)
 *   Noise3  — seeded value noise + fbm, used for terrain and props
 *   Colour  — hex/rgb mixing, shading, fog blending
 *   Light   — sun / moon / ambient model driven by the day cycle
 *   Camera  — third-person orbit camera with follow, zoom, lock-on
 *   Painter — depth-sorted polygon painter with flat shading, fog,
 *             glow and screen-space post effects
 *
 * Everything below is original code for Mythara Online. It renders to
 * a plain 2D canvas context, so the game keeps working on any device
 * with no WebGL requirement and no external libraries.
 * ============================================================ */
(function (root) {
  'use strict';

  const Core = root.MytharaCore || {};

  /* ============================================================
   * 1. MATH
   * ========================================================== */
  const clamp = function (v, min, max) { return v < min ? min : v > max ? max : v; };
  const lerp = function (a, b, t) { return a + (b - a) * t; };
  const smoothstep = function (t) { return t * t * (3 - 2 * t); };
  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;

  function v3(x, y, z) { return { x: x || 0, y: y || 0, z: z || 0 }; }
  function v3add(a, b) { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
  function v3sub(a, b) { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
  function v3mul(a, s) { return v3(a.x * s, a.y * s, a.z * s); }
  function v3dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function v3len(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
  function v3dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
  function v3norm(a) {
    const l = v3len(a) || 1;
    return v3(a.x / l, a.y / l, a.z / l);
  }
  function v3cross(a, b) {
    return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }
  function v3lerp(a, b, t) { return v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t)); }

  /* --- 4x4 matrices, row-major, m[row * 4 + col] --- */
  function m4identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }

  function m4multiply(a, b) {
    const out = new Array(16);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        out[r * 4 + c] =
          a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
      }
    }
    return out;
  }

  function m4translate(x, y, z) { return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]; }
  function m4scale(x, y, z) {
    return [x, 0, 0, 0, 0, y === undefined ? x : y, 0, 0, 0, 0, z === undefined ? x : z, 0, 0, 0, 0, 1];
  }
  function m4rotX(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
  }
  function m4rotY(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
  }
  function m4rotZ(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  /** Compose translation * rotY * rotX * rotZ * scale (the order rigs expect). */
  function m4compose(t, r, s) {
    let m = m4translate(t.x, t.y, t.z);
    if (r.y) m = m4multiply(m, m4rotY(r.y));
    if (r.x) m = m4multiply(m, m4rotX(r.x));
    if (r.z) m = m4multiply(m, m4rotZ(r.z));
    if (s && (s.x !== 1 || s.y !== 1 || s.z !== 1)) m = m4multiply(m, m4scale(s.x, s.y, s.z));
    return m;
  }

  function m4transformPoint(m, p) {
    return {
      x: m[0] * p.x + m[1] * p.y + m[2] * p.z + m[3],
      y: m[4] * p.x + m[5] * p.y + m[6] * p.z + m[7],
      z: m[8] * p.x + m[9] * p.y + m[10] * p.z + m[11]
    };
  }

  function m4transformDir(m, p) {
    return {
      x: m[0] * p.x + m[1] * p.y + m[2] * p.z,
      y: m[4] * p.x + m[5] * p.y + m[6] * p.z,
      z: m[8] * p.x + m[9] * p.y + m[10] * p.z
    };
  }

  /* ============================================================
   * 2. NOISE (seeded, deterministic per world)
   * ========================================================== */
  const Noise3 = (function () {
    function hash2(x, z, seed) {
      let h = (x * 374761393 + z * 668265263 + (seed || 0) * 2147483647) | 0;
      h = (h ^ (h >>> 13)) * 1274126177;
      h = h ^ (h >>> 16);
      return (h >>> 0) / 4294967296;
    }
    function smooth(t) { return t * t * (3 - 2 * t); }
    function value(x, z, seed) {
      const xi = Math.floor(x), zi = Math.floor(z);
      const xf = x - xi, zf = z - zi;
      const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed);
      const c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
      const u = smooth(xf), w = smooth(zf);
      return lerp(lerp(a, b, u), lerp(c, d, u), w);
    }
    function fbm(x, z, seed, octaves, gain) {
      let amp = 0.5, freq = 1, sum = 0, norm = 0;
      for (let i = 0; i < (octaves || 4); i++) {
        sum += value(x * freq, z * freq, (seed || 0) + i * 37) * amp;
        norm += amp;
        amp *= (gain || 0.5);
        freq *= 2;
      }
      return norm > 0 ? sum / norm : 0;
    }
    return { hash2: hash2, value: value, fbm: fbm };
  })();

  /* ============================================================
   * 3. COLOUR
   * ========================================================== */
  const Colour = (function () {
    const cache = {};

    function toRgb(hex) {
      if (typeof hex !== 'string') return { r: 128, g: 128, b: 128 };
      const key = hex;
      if (cache[key]) return cache[key];
      let h = hex.trim().replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      const num = parseInt(h, 16);
      const out = { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
      cache[key] = out;
      return out;
    }

    function toHex(r, g, b) {
      const c = function (v) {
        const n = clamp(Math.round(v), 0, 255);
        return (n < 16 ? '0' : '') + n.toString(16);
      };
      return '#' + c(r) + c(g) + c(b);
    }

    /**
     * Colour strings are cached because building one per polygon wastes time.
     * The cache swaps in a fresh object when it grows too large — deleting the
     * keys one by one used to stall a frame for hundreds of milliseconds.
     */
    let cssCache = {};
    let cssCacheCount = 0;
    const CSS_CACHE_MAX = 90000;
    function css(rgb, alpha) {
      const r = rgb.r < 0 ? 0 : rgb.r > 255 ? 255 : (rgb.r + 0.5) | 0;
      const g = rgb.g < 0 ? 0 : rgb.g > 255 ? 255 : (rgb.g + 0.5) | 0;
      const b = rgb.b < 0 ? 0 : rgb.b > 255 ? 255 : (rgb.b + 0.5) | 0;
      if (alpha === undefined || alpha >= 1) {
        const key = r + ',' + g + ',' + b;
        const hit = cssCache[key];
        if (hit !== undefined) return hit;
        if (cssCacheCount > CSS_CACHE_MAX) { cssCache = {}; cssCacheCount = 0; }
        cssCacheCount++;
        return (cssCache[key] = 'rgb(' + r + ',' + g + ',' + b + ')');
      }
      const a = Math.round(alpha * 100) / 100;
      const key2 = r + ',' + g + ',' + b + ',' + a;
      const hit2 = cssCache[key2];
      if (hit2 !== undefined) return hit2;
      if (cssCacheCount > CSS_CACHE_MAX) { cssCache = {}; cssCacheCount = 0; }
      cssCacheCount++;
      return (cssCache[key2] = 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')');
    }

    /** Colour string from an already-computed rgb triple (cached). */
    function cssFast(rgb, alpha) { return css(rgb, alpha); }

    /** shade('#4a8a3a', -0.3) darkens, +0.3 lightens toward white. */
    function shade(hex, amount) {
      const c = toRgb(hex);
      if (amount >= 0) {
        return toHex(lerp(c.r, 255, amount), lerp(c.g, 255, amount), lerp(c.b, 255, amount));
      }
      return toHex(c.r * (1 + amount), c.g * (1 + amount), c.b * (1 + amount));
    }

    function mix(a, b, t) {
      const ca = toRgb(a), cb = toRgb(b);
      return toHex(lerp(ca.r, cb.r, t), lerp(ca.g, cb.g, t), lerp(ca.b, cb.b, t));
    }

    function rgbMix(a, b, t) {
      return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
    }

    function rgba(hex, alpha) { return css(toRgb(hex), alpha); }

    /** Multiply a colour by a light amount (used by every lit face). */
    function lit(hex, amount) {
      const c = toRgb(hex);
      return { r: clamp(c.r * amount, 0, 255), g: clamp(c.g * amount, 0, 255), b: clamp(c.b * amount, 0, 255) };
    }

    return { toRgb: toRgb, toHex: toHex, css: css, cssFast: cssFast, shade: shade, mix: mix, rgbMix: rgbMix, rgba: rgba, lit: lit };
  })();

  /* ============================================================
   * 4. LIGHT + DAY CYCLE
   * ========================================================== */
  const Light = (function () {
    /** timeOfDay: 0 = midnight, 0.5 = noon (fractions of a full day). */
    function sunDirection(timeOfDay) {
      const angle = (timeOfDay - 0.25) * TAU;      // sunrise at 0.25
      return v3norm(v3(Math.cos(angle) * 0.55, Math.sin(angle), Math.cos(angle) * 0.35 + 0.18));
    }

    function phaseName(timeOfDay) {
      if (timeOfDay < 0.22) return 'night';
      if (timeOfDay < 0.32) return 'dawn';
      if (timeOfDay < 0.68) return 'day';
      if (timeOfDay < 0.78) return 'dusk';
      return 'night';
    }

    /**
     * Build the environment lighting block for a frame.
     * theme supplies the palette; timeOfDay drives sun/moon/ambient/fog.
     */
    function build(theme, timeOfDay, weather) {
      const dir = sunDirection(timeOfDay);
      const elevation = clamp(dir.y, -0.35, 1);
      const dayAmount = clamp(elevation * 2.1, 0, 1);
      const duskAmount = clamp(1 - Math.abs(elevation) * 3.4, 0, 1);

      const phase = phaseName(timeOfDay);
      const night = phase === 'night';
      const moonDir = v3mul(dir, -1);
      const lightDir = night ? v3norm(v3(moonDir.x, Math.abs(moonDir.y) * 0.8 + 0.25, moonDir.z)) : dir;

      const daySun = '#fff3d0';
      const duskSun = '#ff9b52';
      const nightSun = '#9dc0ff';

      let sunColour = Colour.mix(daySun, duskSun, duskAmount * 0.85);
      if (night) sunColour = nightSun;

      const sunIntensity = night ? 0.34 : lerp(0.35, 1.12, dayAmount) * (1 - duskAmount * 0.25);
      const ambient = night ? 0.42 : lerp(0.55, 0.82, dayAmount);
      const skyFill = night ? 0.16 : lerp(0.2, 0.42, dayAmount);

      // aerial perspective: distance haze drifts toward the horizon sky colour,
      // so far-off land reads as landscape instead of grey soup
      const baseFog = theme.fog || '#a8bcd0';
      let fogColour = night
        ? Colour.mix('#0b1026', baseFog, 0.22)
        : Colour.mix(baseFog, theme.skyBottom, 0.55);
      if (!night && duskAmount > 0.05) fogColour = Colour.mix(fogColour, '#ffb277', duskAmount * 0.45);
      if (weather && weather.fogBoost) fogColour = Colour.mix(fogColour, '#c9d3dd', weather.fogBoost * 0.6);

      const fogDensity = (theme.fogDensity || 0.0016) * 0.34
        * (1 + (weather && weather.fogBoost ? weather.fogBoost : 0));

      return {
        dir: lightDir,
        sun: sunColour,
        sunIntensity: sunIntensity,
        ambient: ambient,
        skyFill: skyFill,
        fog: fogColour,
        fogDensity: fogDensity,
        dayAmount: dayAmount,
        dusk: duskAmount,
        night: night,
        phase: phase,
        timeOfDay: timeOfDay,
        // sky keyframes per phase
        skyTop: night ? Colour.mix(theme.skyTop, '#05060f', 0.82)
          : Colour.mix(theme.skyTop, theme.skyBottom, duskAmount * 0.35),
        skyBottom: night ? Colour.mix(theme.skyBottom, '#0b1030', 0.7)
          : Colour.mix(theme.skyBottom, '#ffb277', duskAmount * 0.55),
        horizonGlow: night ? '#1b2350' : Colour.mix('#ffd9a0', theme.accent, duskAmount * 0.4)
      };
    }

    return { build: build, sunDirection: sunDirection, phaseName: phaseName };
  })();

  /* ============================================================
   * 5. CAMERA — third-person MMORPG orbit camera
   * ========================================================== */
  function createCamera(options) {
    const opts = options || {};
    const cam = {
      target: v3(opts.x || 480, opts.y || 0, opts.z || 420),
      look: v3(opts.x || 480, 12, opts.z || 420),
      yaw: opts.yaw !== undefined ? opts.yaw : 0,
      pitch: opts.pitch !== undefined ? opts.pitch : 0.36,
      dist: opts.dist || 340,
      minDist: 120,
      maxDist: 720,
      minPitch: 0.06,
      maxPitch: 1.15,
      fov: opts.fov || 52,
      near: 12,
      far: 2600,
      eye: v3(),
      basis: { right: v3(1, 0, 0), up: v3(0, 1, 0), forward: v3(0, 0, 1) },
      // follow behaviour
      desiredYaw: opts.yaw !== undefined ? opts.yaw : 0,
      manualHold: 0,
      shake: 0,
      lockOn: false,
      bounds: opts.bounds || { minX: 0, maxX: 960, minZ: 0, maxZ: 540 }
    };

    /** Snap the camera to the target (no easing) — used on boot/teleport. */
    function snap() {
      cam.yaw = cam.desiredYaw;
      updateEye();
      cam.look = v3(cam.target.x, cam.target.y + 20, cam.target.z);
    }

    function updateEye() {
      const cp = Math.cos(cam.pitch);
      const offset = v3(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
      cam.eye = v3add(cam.look, v3mul(offset, cam.dist));

      const forward = v3norm(v3sub(cam.look, cam.eye));
      let right = v3cross(forward, v3(0, 1, 0));
      if (v3len(right) < 0.0001) right = v3(1, 0, 0);
      right = v3norm(right);
      const up = v3cross(right, forward);
      cam.basis = { right: right, up: up, forward: forward };
    }

    /** Mouse/touch drag: yaw + pitch, with a manual-control hold timer. */
    function orbit(dx, dy) {
      cam.yaw -= dx * 0.0062;
      cam.pitch = clamp(cam.pitch + dy * 0.0055, cam.minPitch, cam.maxPitch);
      cam.manualHold = 2.4;
      return cam;
    }

    function zoomBy(factor) {
      cam.dist = clamp(cam.dist * factor, cam.minDist, cam.maxDist);
      return cam;
    }

    function setDist(d) { cam.dist = clamp(d, cam.minDist, cam.maxDist); return cam; }

    /** Follow an actor: keep the target on the actor with a soft vertical lift. */
    function follow(actor, dt, opts) {
      const o = opts || {};
      const lift = o.lift !== undefined ? o.lift : 24;
      const ease = clamp((dt || 0.016) * (o.speed || 7), 0, 1);
      cam.target.x = lerp(cam.target.x, actor.pos.x, ease);
      cam.target.z = lerp(cam.target.z, actor.pos.y, ease);
      cam.target.y = lerp(cam.target.y, (actor.pos.y * 0) + (o.groundY || 0), ease);

      const lookEase = clamp((dt || 0.016) * 9, 0, 1);
      cam.look.x = lerp(cam.look.x, actor.pos.x, lookEase);
      cam.look.z = lerp(cam.look.z, actor.pos.y, lookEase);
      const lookHeight = lift + (actor.kind === 'monster' ? actor.scale * 8 : 0);
      cam.look.y = lerp(cam.look.y, lookHeight, lookEase);

      if (cam.manualHold > 0) cam.manualHold -= (dt || 0.016);

      // Lock-on: swing the camera behind the player looking at the target.
      if (cam.lockOn && o.target && o.target.pos) {
        const dx = o.target.pos.x - actor.pos.x;
        const dz = o.target.pos.y - actor.pos.y;
        cam.desiredYaw = Math.atan2(-dx, -dz);
      } else if (!o.freeLook && !o.keepYaw && cam.manualHold <= 0) {
        // chase: ease behind the player's facing direction while moving
        const facing = o.facing;
        if (facing && (Math.abs(facing.x) > 0.01 || Math.abs(facing.y) > 0.01)) {
          cam.desiredYaw = Math.atan2(-facing.x, -facing.y);
        }
      }

      if (cam.manualHold <= 0 || cam.lockOn) {
        let delta = cam.desiredYaw - cam.yaw;
        while (delta > Math.PI) delta -= TAU;
        while (delta < -Math.PI) delta += TAU;
        cam.yaw += delta * clamp((dt || 0.016) * (cam.lockOn ? 5.5 : 2.4), 0, 1);
      }
      updateEye();
    }

    function distanceTo(p) { return v3dist(cam.eye, p); }

    /**
     * Allocation-free projection: writes into a caller-owned object.
     * The renderer projects thousands of points per frame, so this matters.
     */
    function projectInto(out, p, vp) {
      const e = cam.eye, f = cam.basis.forward, r = cam.basis.right, u = cam.basis.up;
      const rx = p.x - e.x, ry = p.y - e.y, rz = p.z - e.z;
      const depth = rx * f.x + ry * f.y + rz * f.z;
      if (depth <= cam.near) {
        out.depth = depth;
        out.visible = false;
        out.scale = 0;
        return out;
      }
      const focal = (vp.height * 0.5) / Math.tan((cam.fov * DEG) / 2);
      out.depth = depth;
      out.scale = focal / depth;
      out.focal = focal;
      out.x = vp.width * 0.5 + ((rx * r.x + ry * r.y + rz * r.z) / depth) * focal;
      out.y = vp.height * 0.5 - ((rx * u.x + ry * u.y + rz * u.z) / depth) * focal;
      out.visible = true;
      return out;
    }

    /** Project a world point into viewport pixels (allocates — convenience API). */
    function project(p, vp) {
      return projectInto({ x: 0, y: 0, depth: 0, scale: 0, focal: 0, visible: false }, p, vp);
    }

    return {
      state: cam,
      snap: snap,
      updateEye: updateEye,
      orbit: orbit,
      zoomBy: zoomBy,
      setDist: setDist,
      follow: follow,
      distanceTo: distanceTo,
      project: project,
      projectInto: projectInto,
      get yaw() { return cam.yaw; },
      set yaw(v) { cam.yaw = v; cam.desiredYaw = v; }
    };
  }

  /* ============================================================
   * 6. PAINTER — depth-sorted polygons + shading + fog
   * ========================================================== */
  function createPainter() {
    const P = {
      ctx: null,
      cam: null,
      vp: { width: 960, height: 540 },
      light: null,
      theme: null,
      list: [],
      stats: { polys: 0, deferred: 0, skipped: 0, fills: 0 },
      clip: null
    };

    function begin(ctx, cam, vp, light, theme) {
      P.ctx = ctx;
      P.cam = cam;
      P.vp = vp;
      P.light = light;
      P.theme = theme || {};
      P.list.length = 0;
      P.stats.polys = 0;
      P.stats.deferred = 0;
      P.stats.fills = 0;
      return P;
    }

    /** Queue a drawable; `depth` decides paint order (far first). */
    function add(depth, fn) {
      P.list.push({ depth: depth, fn: fn });
      P.stats.deferred++;
    }

    function flush() {
      const list = P.list;
      if (list.length > 1) list.sort(function (a, b) { return b.depth - a.depth; });
      for (let i = 0; i < list.length; i++) list[i].fn();
      list.length = 0;
    }

    function project(p) { return P.cam.project(p, P.vp); }

    /** Distance-fog mix for a world point, using the light's fog colour. */
    function fogMix(rgb, dist, override) {
      const l = P.light;
      if (!l) return rgb;
      const density = (override !== undefined ? override : l.fogDensity);
      const f = 1 - Math.exp(-dist * density);
      if (f <= 0.004) return rgb;
      const fc = Colour.toRgb(l.fog);
      return { r: lerp(rgb.r, fc.r, f), g: lerp(rgb.g, fc.g, f), b: lerp(rgb.b, fc.b, f) };
    }

    /**
     * Flat lambert shading: ambient + sun + sky fill, normalised so a
     * fully-lit flat surface lands at ~1.0 (no blown-out ground).
     */
    function lightAmount(normal, opts) {
      const l = P.light;
      if (!l) return 1;
      const o = opts || {};
      if (o.flat) return clamp(lerp(l.ambient, 1, 0.4), 0.35, 1.1);
      const nd = Math.max(0, normal.x * l.dir.x + normal.y * l.dir.y + normal.z * l.dir.z);
      const upness = clamp(normal.y * 0.5 + 0.5, 0, 1);
      const amount = l.ambient * 0.62 + l.sunIntensity * nd * 0.5 + l.skyFill * upness * 0.24;
      return clamp(amount, 0.16, 1.12);
    }

    /**
     * Draw an already-shaded polygon from projected points.
     * style: { fill, alpha, stroke, strokeWidth, glow, glowSize, blend, shadow }
     */
    function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

    function polyScreen(pts, style) {
      if (!pts || pts.length < 3) return;
      const c = P.ctx;
      if (!c) return;
      const st = style || {};
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!p || !isFinite(p.x) || !isFinite(p.y)) return;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      if (maxX < -40 || maxY < -40 || minX > P.vp.width + 40 || minY > P.vp.height + 40) return;

      const LR = P.slowLog;
      const t = LR ? [nowMs()] : null;
      c.save();
      if (st.blend && st.blend !== 'source-over') c.globalCompositeOperation = st.blend;
      if (st.alpha !== undefined) c.globalAlpha = clamp(st.alpha, 0, 1);
      c.beginPath();
      c.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
      c.closePath();
      if (t) t.push(nowMs());
      if (st.fill) {
        c.fillStyle = st.fill;
        c.fill();
        if (t) t.push(nowMs());
        P.stats.fills++;
      }
      if (st.glow) {
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = (st.alpha === undefined ? 1 : st.alpha) * (st.glowAlpha === undefined ? 0.4 : st.glowAlpha);
        c.fillStyle = st.glow;
        c.fill();
        c.restore();
      }
      if (t) t.push(nowMs());
      if (st.stroke) {
        c.lineWidth = st.strokeWidth || 1;
        c.strokeStyle = st.stroke;
        c.stroke();
      }
      c.restore();
      if (t) {
        t.push(nowMs());
        const total = t[t.length - 1] - t[0];
        if (total > 6) LR.push({ ms: +total.toFixed(1), save: +(t[1] - t[0]).toFixed(1), fill: t.length > 2 ? +(t[2] - t[1]).toFixed(1) : 0, glow: t.length > 3 ? +((t[t.length - 2]) - t[2]).toFixed(1) : 0, rest: +(t[t.length - 1] - t[t.length - 2]).toFixed(1), w: Math.round(maxX - minX), h: Math.round(maxY - minY), ex: Math.round(Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY))), n: pts.length });
      }
    }

    /**
     * Draw a world-space convex polygon with flat shading + fog.
     * `normal` lights the face; everything here reuses scratch objects and
     * cached colour strings because this runs thousands of times per frame.
     */
    const POLY_MAX = 12;
    const POLY_SLOTS = [];
    for (let i = 0; i < POLY_MAX; i++) POLY_SLOTS.push({ x: 0, y: 0, depth: 0, scale: 0, focal: 0, visible: false });

    const POLY_OUT = [];
    function poly3(points, normal, style) {
      const cam = P.cam.state ? P.cam.state : P.cam;
      const vp = P.vp;
      const n = points.length;
      if (n < 3 || n > POLY_MAX) return null;
      let sumDepth = 0;
      for (let i = 0; i < n; i++) {
        const p = points[i];
        if (!p) return null;
        // inline projection (same maths as projectInto, no property lookups)
        const e = cam.eye, f = cam.basis.forward, r = cam.basis.right, u = cam.basis.up;
        const rx = p.x - e.x, ry = p.y - e.y, rz = p.z - e.z;
        const depth = rx * f.x + ry * f.y + rz * f.z;
        const slot = POLY_SLOTS[i];
        if (depth <= cam.near) { P.stats.skipped++; return null; }
        const focal = (vp.height * 0.5) / Math.tan((cam.fov * DEG) / 2);
        slot.depth = depth;
        slot.scale = focal / depth;
        slot.x = vp.width * 0.5 + ((rx * r.x + ry * r.y + rz * r.z) / depth) * focal;
        slot.y = vp.height * 0.5 - ((rx * u.x + ry * u.y + rz * u.z) / depth) * focal;
        slot.visible = true;
        sumDepth += depth;
      }
      const depth = sumDepth / n;
      const st = style || {};
      const base = typeof st.color === 'object' ? st.color : Colour.toRgb(st.color || '#888888');
      let rgb = base;
      if (st.lit !== false) {
        const amount = lightAmount(normal || UP, st);
        rgb = { r: base.r * amount, g: base.g * amount, b: base.b * amount };
      }
      if (st.fog !== false) rgb = fogMix(rgb, depth);
      if (st.tint) {
        const t = Colour.toRgb(st.tint);
        rgb = { r: rgb.r * t.r / 255, g: rgb.g * t.g / 255, b: rgb.b * t.b / 255 };
      }
      POLY_OUT.length = 0;
      for (let i = 0; i < n; i++) POLY_OUT.push(POLY_SLOTS[i]);
      polyScreen(POLY_OUT, {
        fill: Colour.cssFast(rgb, 1),
        alpha: st.alpha,
        stroke: st.stroke ? Colour.cssFast(fogMix(Colour.toRgb(st.stroke), depth), 1) : null,
        strokeWidth: st.strokeWidth,
        glow: st.glow ? Colour.cssFast(fogMix(Colour.toRgb(st.glow), depth * 0.4), 1) : null,
        glowAlpha: st.glowAlpha,
        blend: st.blend
      });
      P.stats.polys++;
      return { depth: depth, points: POLY_SLOTS, rgb: rgb, count: n };
    }

    const UP = v3(0, 1, 0);

    /* --- silhouette helpers (for shadows / decals) --- */
    function ellipseGround(cx, cz, rx, rz, colour, alpha, y) {
      const cam = P.cam, vp = P.vp;
      const centre = cam.project(v3(cx, y || 0.6, cz), vp);
      if (!centre.visible) return;
      const segs = 14;
      const pts = [];
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * TAU;
        const s = cam.project(v3(cx + Math.cos(a) * rx, y || 0.6, cz + Math.sin(a) * rz), vp);
        if (!s.visible) return;
        pts.push(s);
      }
      polyScreen(pts, { fill: Colour.css(Colour.toRgb(colour), 1), alpha: alpha });
    }

    /** Soft contact shadow: a few stacked ellipses for a gradient edge. */
    function shadow(cx, cz, rx, rz, alpha, y) {
      const layers = 3;
      for (let i = layers; i >= 1; i--) {
        const t = i / layers;
        ellipseGround(cx, cz, rx * (0.55 + t * 0.5), rz * (0.5 + t * 0.55),
          '#05070d', alpha * (0.5 / i), y);
      }
    }

    /** Projected directional shadow of a body (sun-cast ellipse offset away from light). */
    function sunShadow(cx, cz, rx, height, y) {
      const l = P.light;
      if (!l) return;
      const strength = clamp(0.5 - l.ambient * 0.35 + l.sunIntensity * 0.28, 0.08, 0.42) * (l.night ? 0.4 : 1);
      const dir = l.dir;
      const flat = Math.max(0.22, Math.abs(dir.y));
      const ox = (dir.x / flat) * height * 0.5;
      const oz = (dir.z / flat) * height * 0.5;
      const squash = clamp(1 - Math.abs(dir.y) * 0.45, 0.4, 1);
      ellipseGround(cx + ox, cz + oz, rx * 1.15, rx * 1.15 * squash, '#06080f', strength, y);
    }

    /** A vertical gradient billboard band (used for glows, water shimmer, auras). */
    function glowSprite(worldPos, radius, colour, alpha, opts) {
      const o = opts || {};
      const cam = P.cam, vp = P.vp;
      const s = cam.project(worldPos, vp);
      if (!s.visible) return;
      const r = Math.max(2, radius * s.scale);
      glowBlit(s.x, s.y, r, colour, alpha, o.blend || 'lighter');
    }

    /** Screen-space text with a dark outline (damage numbers, name plates). */
    function label(worldPos, text, opts) {
      const o = opts || {};
      const cam = P.cam, vp = P.vp;
      const s = cam.project(worldPos, vp);
      if (!s.visible) return null;
      const c = P.ctx;
      const size = Math.max(7, Math.min(42, (o.size || 15) * clamp(s.scale / 0.5, 0.55, 1.6)));
      c.save();
      c.font = (o.weight || '700') + ' ' + size.toFixed(1) + 'px ' + (o.font || '"Segoe UI", Roboto, sans-serif');
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      if (o.alpha !== undefined) c.globalAlpha = clamp(o.alpha, 0, 1);
      if (o.outline !== false) {
        c.lineWidth = Math.max(2, size * 0.22);
        c.strokeStyle = 'rgba(6,8,16,0.85)';
        c.strokeText(text, s.x, s.y);
      }
      c.fillStyle = o.color || '#ffffff';
      c.fillText(text, s.x, s.y);
      c.restore();
      return s;
    }

    /* --- cached glow sprites ---
     * A soft glow is the same radial gradient every time; baking it once into
     * a small canvas and blitting it is several times cheaper than rebuilding
     * a gradient per particle (which is what phones notice first).
     */
    const sprites = {};
    let spriteSupport = null;

    function bakeSprite(colour) {
      const size = 64;
      const canvas = root.document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const c = canvas.getContext('2d');
      if (!c) return null;
      const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      const rgb = Colour.toRgb(colour);
      const rgba = function (a) { return 'rgba(' + Math.round(rgb.r) + ',' + Math.round(rgb.g) + ',' + Math.round(rgb.b) + ',' + a + ')'; };
      g.addColorStop(0, rgba(1));
      g.addColorStop(0.45, rgba(0.45));
      g.addColorStop(1, rgba(0));
      c.fillStyle = g;
      c.fillRect(0, 0, size, size);
      return canvas;
    }

    function spriteFor(colour) {
      const key = String(colour);
      if (sprites[key] !== undefined) return sprites[key];
      if (spriteSupport === false) { sprites[key] = null; return null; }
      let sprite = null;
      try {
        sprite = bakeSprite(key);
        // verify it can actually be drawn (some headless canvases cannot)
        if (sprite) {
          P.ctx.save();
          P.ctx.globalAlpha = 0;
          P.ctx.drawImage(sprite, -100, -100, 1, 1);
          P.ctx.restore();
        }
      } catch (err) {
        sprite = null;
      }
      if (!sprite) spriteSupport = false;
      sprites[key] = sprite;
      return sprite;
    }

    /** Blit a cached soft glow, sized in screen pixels (gradient fallback). */
    function glowBlit(x, y, radius, colour, alpha, blend) {
      const c = P.ctx;
      if (!c || radius <= 0.2) return;
      const a = clamp(alpha === undefined ? 1 : alpha, 0, 1);
      const sprite = spriteFor(colour);
      if (sprite) {
        c.save();
        if (blend && blend !== 'source-over') c.globalCompositeOperation = blend;
        c.globalAlpha = a;
        c.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
        c.restore();
        P.stats.fills++;
        return;
      }
      // fallback: draw the gradient directly
      const g = c.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, Colour.rgba(colour, 0.95));
      g.addColorStop(0.5, Colour.rgba(colour, 0.35));
      g.addColorStop(1, Colour.rgba(colour, 0));
      c.save();
      if (blend && blend !== 'source-over') c.globalCompositeOperation = blend;
      c.globalAlpha = a;
      c.fillStyle = g;
      c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      c.restore();
      P.stats.fills++;
    }

    /* --- composite helpers used by the world module --- */
    function rect(x, y, w, h, style) {
      const c = P.ctx;
      c.save();
      if (style.blend) c.globalCompositeOperation = style.blend;
      if (style.alpha !== undefined) c.globalAlpha = style.alpha;
      c.fillStyle = style.fill;
      c.fillRect(x, y, w, h);
      c.restore();
    }

    function radial(cx, cy, r, colour, alpha, blend) {
      glowBlit(cx, cy, r, colour, alpha, blend || 'lighter');
    }

    const facade = {
      state: P,
      begin: begin,
      add: add,
      flush: flush,
      project: project,
      poly3: poly3,
      polyScreen: polyScreen,
      fogMix: fogMix,
      lightAmount: lightAmount,
      ellipseGround: ellipseGround,
      shadow: shadow,
      sunShadow: sunShadow,
      glowSprite: glowSprite,
      label: label,
      rect: rect,
      radial: radial,
      glowBlit: glowBlit,
      spriteFor: spriteFor,
      Colour: Colour,
      Colour3: null
    };
    // live accessors so modules can read painter.cam / .vp / .ctx / .light directly
    ['ctx', 'cam', 'vp', 'light', 'theme', 'list', 'stats'].forEach(function (key) {
      Object.defineProperty(facade, key, {
        enumerable: true,
        get: function () { return P[key]; }
      });
    });
    return facade;
  }

  const Mythara3D = {
    version: '1.0.0',
    clamp: clamp,
    lerp: lerp,
    smoothstep: smoothstep,
    DEG: DEG,
    TAU: TAU,
    v3: v3,
    v3add: v3add,
    v3sub: v3sub,
    v3mul: v3mul,
    v3dot: v3dot,
    v3len: v3len,
    v3dist: v3dist,
    v3norm: v3norm,
    v3cross: v3cross,
    v3lerp: v3lerp,
    mat4: {
      identity: m4identity,
      multiply: m4multiply,
      translate: m4translate,
      scale: m4scale,
      rotX: m4rotX,
      rotY: m4rotY,
      rotZ: m4rotZ,
      compose: m4compose,
      transformPoint: m4transformPoint,
      transformDir: m4transformDir
    },
    Noise: Noise3,
    Colour: Colour,
    Light: Light,
    createCamera: createCamera,
    createPainter: createPainter
  };

  root.Mythara3D = Mythara3D;
  if (typeof module !== 'undefined' && module.exports) module.exports = Mythara3D;

})(typeof globalThis !== 'undefined' ? globalThis : this);
