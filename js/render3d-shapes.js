/* ============================================================
 * Mythara Online — js/render3d-shapes.js
 * ------------------------------------------------------------
 * Reusable 3D primitives drawn through Mythara3D's painter:
 *
 *   box        — faceted cuboid (the workhorse: armour, props, walls)
 *   plate      — a single quad (banners, water, ground decals)
 *   cylinder   — tapered tube (limbs, trunks, pillars, towers)
 *   cone       — canopy / roof / spike / mountain
 *   blob       — rounded ellipsoid (heads, slimes, foliage, cores)
 *   billboard  — camera-facing quad (glow, leaves, sparks, smoke)
 *   ribbon     — serial quad strip (weapon swings, trails, arcs)
 *   ring       — flat ground ring (target circles, spell markers)
 *
 * Every primitive shade-blends with the active Light and fades into the
 * scene fog, then either draws immediately or queues into the painter's
 * depth-sorted list (`defer: true`), which is what keeps the world
 * correctly layered behind and in front of actors.
 * ============================================================ */
(function (root) {
  'use strict';

  const M = root.Mythara3D;
  const v3 = M.v3;
  const Colour = M.Colour;
  const TAU = M.TAU;

  /* Face tables for a unit cube centred on the origin. */
  const CUBE_FACES = [
    { n: v3(0, 0, 1), c: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]], key: 'front', shade: 1.0 },
    { n: v3(0, 0, -1), c: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]], key: 'back', shade: 0.82 },
    { n: v3(1, 0, 0), c: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]], key: 'right', shade: 0.9 },
    { n: v3(-1, 0, 0), c: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]], key: 'left', shade: 0.78 },
    { n: v3(0, 1, 0), c: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]], key: 'top', shade: 1.12 },
    { n: v3(0, -1, 0), c: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]], key: 'bottom', shade: 0.55 }
  ];

  function normaliseColours(colours) {
    if (typeof colours === 'string') {
      return { front: colours, back: colours, left: colours, right: colours, top: colours, bottom: colours };
    }
    const c = colours || {};
    if (c.all) {
      return { front: c.all, back: c.all, left: c.all, right: c.all, top: c.all, bottom: c.all };
    }
    const base = c.base || c.front || '#9aa0ae';
    return {
      front: c.front || base,
      back: c.back || c.front || base,
      left: c.left || c.side || c.front || base,
      right: c.right || c.side || c.side && c.side || c.front || base,
      top: c.top || Colour.shade(base, 0.12),
      bottom: c.bottom || Colour.shade(base, -0.3)
    };
  }

  /**
   * Draw a cuboid.
   * o: { pos, size {x,y,z}, rot {x,y,z}, matrix, colours, trim, alpha, glow,
   *      defer, light, yaw, tilt, w, h, d }
   */
  function box(P, o) {
    const opts = o || {};
    const pos = opts.pos || v3(opts.x || 0, opts.y || 0, opts.z || 0);
    const size = opts.size || v3(opts.w || 1, opts.h || 1, opts.d || 1);
    const rot = opts.rot || v3(0, opts.yaw || 0, 0);
    const bind = opts.matrix || M.mat4.compose(pos, rot, v3(1, 1, 1));

    const colours = normaliseColours(opts.colours);

    const faces = [];
    for (let f = 0; f < CUBE_FACES.length; f++) {
      const face = CUBE_FACES[f];
      const pts = [];
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < 4; i++) {
        const lc = face.c[i];
        const wp = M.mat4.transformPoint(bind, v3(lc[0] * size.x, lc[1] * size.y, lc[2] * size.z));
        pts.push(wp);
        cx += wp.x; cy += wp.y; cz += wp.z;
      }
      const centre = v3(cx / 4, cy / 4, cz / 4);
      const normal = M.v3norm(M.mat4.transformDir(bind, face.n));
      const toEye = M.v3sub(P.cam.state.eye, centre);
      if (M.v3dot(normal, toEye) <= 0) continue;                      // backface
      faces.push({ pts: pts, normal: normal, centre: centre, colour: colours[face.key], shade: face.shade });
    }

    faces.sort(function (a, b) { return P.cam.distanceTo(b.centre) - P.cam.distanceTo(a.centre); });

    const draw = function () {
      for (let i = 0; i < faces.length; i++) {
        const f = faces[i];
        const style = {
          color: f.colour,
          shade: f.shade,
          alpha: opts.alpha,
          glow: opts.glow,
          glowAlpha: opts.glowAlpha,
          stroke: opts.trim,
          strokeWidth: opts.trimWidth || 1,
          lit: opts.lit,
          tint: opts.tint,
          flat: opts.flat
        };
        const base = Colour.toRgb(f.colour);
        const amount = (opts.flat ? 1 : P.lightAmount(f.normal, opts)) * (f.shade || 1);
        const rgb = { r: base.r * amount, g: base.g * amount, b: base.b * amount };
        P.poly3(f.pts, f.normal, {
          color: f.shade === 1 ? f.colour : Colour.shade(f.colour, (f.shade - 1) * 0.55),
          alpha: style.alpha,
          glow: style.glow,
          glowAlpha: style.glowAlpha,
          stroke: style.stroke,
          strokeWidth: style.strokeWidth,
          lit: opts.lit,
          tint: opts.tint,
          flat: opts.flat
        });
      }
    };

    if (opts.defer === false) { draw(); return; }
    P.add(P.cam.distanceTo(opts.anchor || pos), draw);
    return faces.length;
  }

  /** A single quad from four world points (ground patches, water, banners). */
  function plate(P, points, o) {
    const opts = o || {};
    const normal = opts.normal || v3(0, 1, 0);
    const draw = function () {
      P.poly3(points, normal, {
        color: opts.color || '#7fa85f',
        alpha: opts.alpha,
        glow: opts.glow,
        glowAlpha: opts.glowAlpha,
        stroke: opts.stroke,
        strokeWidth: opts.strokeWidth,
        lit: opts.lit,
        fog: opts.fog,
        tint: opts.tint,
        flat: opts.flat
      });
    };
    if (opts.defer === false) { draw(); return; }
    let depth = 0;
    for (let i = 0; i < points.length; i++) depth += P.cam.distanceTo(points[i]);
    P.add(depth / points.length, draw);
  }

  /**
   * Tapered cylinder along the local Y axis.
   * o: { pos, radius, radiusTop, height, sides, colours, rot, matrix, alpha, glow, defer }
   */
  function cylinder(P, o) {
    const opts = o || {};
    const pos = opts.pos || v3();
    const rot = opts.rot || v3(0, opts.yaw || 0, 0);
    const matrix = opts.matrix || M.mat4.compose(pos, rot, v3(1, 1, 1));
    const sides = Math.max(3, opts.sides || 7);
    const h = opts.height === undefined ? 1 : opts.height;
    const rBottom = opts.radius === undefined ? 0.5 : opts.radius;
    const rTop = opts.radiusTop === undefined ? rBottom : opts.radiusTop;
    const colours = normaliseColours(opts.colours || opts.color || '#8a8f9c');
    const half = h / 2;

    const ring = function (r, y) {
      const out = [];
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * TAU;
        out.push(M.mat4.transformPoint(matrix, v3(Math.cos(a) * r, y, Math.sin(a) * r)));
      }
      return out;
    };

    const bottom = ring(rBottom, -half);
    const top = ring(rTop, half);
    const walls = [];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const a = bottom[i], b = bottom[j], c = top[j], d = top[i];
      const centre = v3((a.x + b.x + c.x + d.x) / 4, (a.y + b.y + c.y + d.y) / 4, (a.z + b.z + c.z + d.z) / 4);
      const normal = M.v3norm(M.v3cross(M.v3sub(b, a), M.v3sub(d, a)));
      walls.push({ pts: [a, b, c, d], centre: centre, normal: normal, colour: colours.left });
    }
    walls.sort(function (a, b) { return P.cam.distanceTo(b.centre) - P.cam.distanceTo(a.centre); });

    const draw = function () {
      for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        const toEye = M.v3sub(P.cam.state.eye, w.centre);
        if (M.v3dot(w.normal, toEye) <= 0) continue;
        P.poly3(w.pts, w.normal, {
          color: w.colour, alpha: opts.alpha, glow: opts.glow, glowAlpha: opts.glowAlpha,
          stroke: opts.trim, strokeWidth: opts.trimWidth, tint: opts.tint, lit: opts.lit
        });
      }
      if (opts.caps !== false) {
        P.poly3(top, M.mat4.transformDir(matrix, v3(0, 1, 0)), { color: colours.top, alpha: opts.alpha, tint: opts.tint });
        P.poly3(bottom.slice().reverse(), M.mat4.transformDir(matrix, v3(0, -1, 0)), { color: colours.bottom, alpha: opts.alpha, tint: opts.tint });
      }
    };

    if (opts.defer === false) { draw(); return; }
    P.add(P.cam.distanceTo(pos), draw);
  }

  /** Cone (canopy, roof, spike, distant mountain). */
  function cone(P, o) {
    const opts = o || {};
    const pos = opts.pos || v3();
    const rot = opts.rot || v3(0, opts.yaw || 0, 0);
    const matrix = opts.matrix || M.mat4.compose(pos, rot, v3(1, 1, 1));
    const sides = Math.max(3, opts.sides || 8);
    const h = opts.height === undefined ? 1 : opts.height;
    const r = opts.radius === undefined ? 0.6 : opts.radius;
    const colours = normaliseColours(opts.colours || opts.color || '#3f7a33');
    const apex = M.mat4.transformPoint(matrix, v3(0, h / 2, 0));
    const base = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * TAU;
      base.push(M.mat4.transformPoint(matrix, v3(Math.cos(a) * r, -h / 2, Math.sin(a) * r)));
    }
    const tris = [];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const centre = v3((base[i].x + base[j].x + apex.x) / 3, (base[i].y + base[j].y + apex.y) / 3, (base[i].z + base[j].z + apex.z) / 3);
      const normal = M.v3norm(M.v3cross(M.v3sub(base[j], base[i]), M.v3sub(apex, base[i])));
      tris.push({ pts: [base[i], base[j], apex], centre: centre, normal: normal });
    }
    const draw = function () {
      for (let i = 0; i < tris.length; i++) {
        const t = tris[i];
        const toEye = M.v3sub(P.cam.state.eye, t.centre);
        if (M.v3dot(t.normal, toEye) <= 0) continue;
        P.poly3(t.pts, t.normal, {
          color: colours.top, alpha: opts.alpha, glow: opts.glow, glowAlpha: opts.glowAlpha,
          tint: opts.tint, lit: opts.lit, stroke: opts.trim, strokeWidth: opts.trimWidth
        });
      }
      if (opts.cap !== false) P.poly3(base.slice().reverse(), M.mat4.transformDir(matrix, v3(0, -1, 0)), { color: colours.bottom, alpha: opts.alpha });
    };
    if (opts.defer === false) { draw(); return; }
    P.add(P.cam.distanceTo(pos), draw);
  }

  /** Rounded ellipsoid built from stacked rings — heads, slimes, foliage, cores. */
  function blob(P, o) {
    const opts = o || {};
    const pos = opts.pos || v3();
    const radii = opts.radii || v3(opts.r || 0.5, opts.r || 0.5, opts.r || 0.5);
    const slices = Math.max(4, opts.slices || 7);
    const rings = Math.max(2, opts.rings || 3);
    const colour = opts.color || '#8a8f9c';
    const jitter = opts.jitter || 0;
    const seed = opts.seed || 1;
    const yaw = opts.yaw || 0;
    const ringsPts = [];
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;                              // 0 bottom → 1 top
      const phi = t * Math.PI;
      const ringR = Math.sin(phi);
      const y = -Math.cos(phi) * radii.y;
      const pts = [];
      for (let i = 0; i < slices; i++) {
        const a = (i / slices) * TAU + yaw;
        const wobble = jitter ? 1 + (M.Noise.value(Math.cos(a) * 3 + seed, Math.sin(a) * 3 + r, seed) - 0.5) * jitter : 1;
        pts.push(v3(pos.x + Math.cos(a) * radii.x * ringR * wobble, pos.y + y, pos.z + Math.sin(a) * radii.z * ringR * wobble));
      }
      ringsPts.push(pts);
    }
    const quads = [];
    for (let r = 0; r < rings; r++) {
      for (let i = 0; i < slices; i++) {
        const j = (i + 1) % slices;
        const a = ringsPts[r][i], b = ringsPts[r][j], c = ringsPts[r + 1][j], d = ringsPts[r + 1][i];
        const centre = v3((a.x + b.x + c.x + d.x) / 4, (a.y + b.y + c.y + d.y) / 4, (a.z + b.z + c.z + d.z) / 4);
        quads.push({ pts: [a, b, c, d], centre: centre, normal: M.v3norm(M.v3sub(centre, pos)) });
      }
    }
    quads.sort(function (a, b) { return P.cam.distanceTo(b.centre) - P.cam.distanceTo(a.centre); });
    const draw = function () {
      const eye = P.cam.state.eye;
      for (let i = 0; i < quads.length; i++) {
        const q = quads[i];
        // back-face cull: a closed shell only needs its camera-facing half
        if (q.normal.x * (eye.x - q.centre.x) + q.normal.y * (eye.y - q.centre.y) + q.normal.z * (eye.z - q.centre.z) <= 0) continue;
        P.poly3(q.pts, q.normal, {
          color: colour, alpha: opts.alpha, glow: opts.glow, glowAlpha: opts.glowAlpha,
          tint: opts.tint, lit: opts.lit, flat: opts.flat
        });
      }
    };
    if (opts.defer === false) { draw(); return; }
    P.add(P.cam.distanceTo(pos), draw);
  }

  /** Camera-facing quad — cheap and perfect for glows, leaves, sparks, smoke. */
  function billboard(P, o) {
    const opts = o || {};
    const pos = opts.pos;
    const s = P.cam.project(pos, (P.vp || P.state.vp));
    if (!s.visible) return;
    const w = (opts.width || 1) * s.scale;
    const h = (opts.height || 1) * s.scale;
    const rot = opts.rotate || 0;
    const c = P.ctx;
    c.save();
    if (opts.blend) c.globalCompositeOperation = opts.blend;
    c.globalAlpha = opts.alpha === undefined ? 1 : opts.alpha;
    const colour = opts.color || '#ffffff';
    if (opts.soft) {
      // cached glow sprite — one gradient bake per colour, blitted thereafter
      c.restore();
      P.glowBlit(s.x, s.y, Math.max(w, h) * 0.5, colour, opts.alpha === undefined ? 1 : opts.alpha, opts.blend || 'lighter');
      return;
    } else {
      c.translate(s.x, s.y);
      c.rotate(rot);
      const r = opts.round ? Math.min(w, h) * 0.5 : 0;
      if (r) {
        c.fillStyle = Colour.rgba(colour, 1);
        c.beginPath();
        c.arc(0, 0, r, 0, TAU);
        c.fill();
      } else {
        c.fillStyle = Colour.rgba(colour, 1);
        c.fillRect(-w / 2, -h / 2, w, h);
      }
    }
    c.restore();
    P.state.stats.fills++;
  }

  /** Ribbon strip through world points — weapon arcs, trails, magic streams. */
  function ribbon(P, points, o) {
    const opts = o || {};
    if (!points || points.length < 2) return;
    const widths = opts.widths;
    const cam = P.cam, vp = P.vp || P.state.vp;
    const left = [], right = [];
    const centre = v3();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      const dir = M.v3norm(M.v3sub(next, prev));
      let side = M.v3cross(dir, M.v3sub(p, cam.state.eye));
      if (M.v3len(side) < 0.0001) side = M.v3(1, 0, 0);
      side = M.v3norm(side);
      const w = widths ? (widths[i] || opts.width || 0.2) : (opts.width || 0.2);
      left.push(M.v3add(p, M.v3mul(side, w * 0.5)));
      right.push(M.v3sub(p, M.v3mul(side, w * 0.5)));
      centre.x += p.x; centre.y += p.y; centre.z += p.z;
    }
    centre.x /= points.length; centre.y /= points.length; centre.z /= points.length;

    const draw = function () {
      const c = P.ctx;
      c.save();
      c.globalCompositeOperation = opts.blend || 'lighter';
      c.globalAlpha = opts.alpha === undefined ? 0.85 : opts.alpha;
      const colour = opts.color || '#ffe6a0';
      const colour2 = opts.color2 || colour;
      for (let i = 0; i < points.length - 1; i++) {
        const a = cam.project(left[i], vp), b = cam.project(right[i], vp);
        const cc = cam.project(right[i + 1], vp), d = cam.project(left[i + 1], vp);
        if (!a.visible || !b.visible || !cc.visible || !d.visible) continue;
        const t = i / Math.max(1, points.length - 2);
        const g = c.createLinearGradient(a.x, a.y, d.x, d.y);
        g.addColorStop(0, Colour.rgba(Colour.mix(colour, colour2, t), 0.05));
        g.addColorStop(0.55, Colour.rgba(Colour.mix(colour, colour2, t), 0.85));
        g.addColorStop(1, Colour.rgba(colour2, 0.1));
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.lineTo(cc.x, cc.y);
        c.lineTo(d.x, d.y);
        c.closePath();
        c.fill();
      }
      c.restore();
      P.state.stats.fills++;
    };
    P.add(cam.distanceTo(centre) - 4, draw);
  }

  /**
   * Upright quad, rotated about its base — grass blades, reeds, flames,
   * banners. Two or three crossed quads read as real volume from any angle
   * and never look like floating squares the way camera-facing billboards do.
   */
  function blade(P, o) {
    const opts = o || {};
    const pos = opts.pos || v3(opts.x || 0, opts.y || 0, opts.z || 0);
    const w = opts.width || 0.6;
    const h = opts.height || 3;
    const angle = opts.angle || 0;
    const lean = opts.lean || 0;
    const leanDir = opts.leanDir === undefined ? angle + Math.PI / 2 : opts.leanDir;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const lx = Math.cos(leanDir) * lean, lz = Math.sin(leanDir) * lean;
    const hw = w * 0.5;
    const pts = [
      v3(pos.x - ca * hw, pos.y, pos.z - sa * hw),
      v3(pos.x + ca * hw, pos.y, pos.z + sa * hw),
      v3(pos.x + ca * hw * (opts.taper === undefined ? 0.35 : opts.taper) + lx, pos.y + h, pos.z + sa * hw * (opts.taper === undefined ? 0.35 : opts.taper) + lz),
      v3(pos.x - ca * hw * (opts.taper === undefined ? 0.35 : opts.taper) + lx, pos.y + h, pos.z - sa * hw * (opts.taper === undefined ? 0.35 : opts.taper) + lz)
    ];
    const normal = v3(-sa, opts.upNormal === false ? 0.35 : 0.75, ca);
    const draw = function () {
      P.poly3(pts, normal, {
        color: opts.color || '#4f8a3a',
        alpha: opts.alpha,
        glow: opts.glow,
        glowAlpha: opts.glowAlpha,
        lit: opts.lit === undefined ? true : opts.lit,
        flat: opts.flat
      });
    };
    if (opts.defer === false) { draw(); return; }
    P.add(P.cam.distanceTo(v3(pos.x, pos.y + h * 0.5, pos.z)) + (opts.bias || 0), draw);
  }

  /** Flat ring on the ground plane — target lock, spell telegraphs. */
  function ring(P, o) {
    const opts = o || {};
    const cx = opts.x || 0, cz = opts.z || 0, y = opts.y === undefined ? 0.5 : opts.y;
    const r = opts.radius || 1;
    const thickness = opts.thickness || 0.18;
    const segs = opts.segments || 24;
    const inner = Math.max(0, r - thickness);
    const cam = P.cam, vp = P.vp || P.state.vp;
    const outerPts = [], innerPts = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * TAU + (opts.phase || 0);
      const co = Math.cos(a), si = Math.sin(a);
      const so = cam.project(v3(cx + co * r, y, cz + si * r * (opts.squash || 1)), vp);
      const sni = cam.project(v3(cx + co * inner, y, cz + si * inner * (opts.squash || 1)), vp);
      if (!so.visible || !sni.visible) return;
      outerPts.push(so);
      innerPts.push(sni);
    }
    const draw = function () {
      const c = P.ctx;
      c.save();
      c.globalCompositeOperation = opts.blend || 'lighter';
      c.globalAlpha = opts.alpha === undefined ? 0.6 : opts.alpha;
      c.beginPath();
      c.moveTo(outerPts[0].x, outerPts[0].y);
      for (let i = 1; i < outerPts.length; i++) c.lineTo(outerPts[i].x, outerPts[i].y);
      for (let i = innerPts.length - 1; i >= 0; i--) c.lineTo(innerPts[i].x, innerPts[i].y);
      c.closePath();
      c.fillStyle = opts.color || '#ffd76a';
      c.fill();
      c.restore();
      P.state.stats.fills++;
    };
    P.add(cam.distanceTo(v3(cx, y, cz)) - 2, draw);
  }

  root.MytharaShapes3D = {
    box: box,
    blade: blade,
    plate: plate,
    cylinder: cylinder,
    cone: cone,
    blob: blob,
    billboard: billboard,
    ribbon: ribbon,
    ring: ring,
    CUBE_FACES: CUBE_FACES
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MytharaShapes3D;

})(typeof globalThis !== 'undefined' ? globalThis : this);
