/* ============================================================
 * Mythara Online — js/render3d-world.js
 * ------------------------------------------------------------
 * The fantasy world itself: eleven hand-authored environments
 * (hub, ten chapter regions, arena) built from pure procedural 3D
 * geometry — terrain, rivers, rocks, trees, villages, castles,
 * ruins, caves, dungeons, crystals, braziers and weather.
 *
 * Design rules that keep the existing game mechanics intact:
 *   • the playable arena (game.js WORLD bounds) is always flat, so
 *     ranges, facing and collisions behave exactly as before;
 *   • scenery lives outside the walkable rect (hills, rivers, towns,
 *     fortresses) and is only drawn beyond a small clear margin;
 *   • every prop is generated from a seeded RNG so a region looks the
 *     same on every device and in every session.
 *
 * All designs are original to Mythara Online.
 * ============================================================ */
(function (root) {
  'use strict';

  const M = root.Mythara3D;
  const S = root.MytharaShapes3D;
  const v3 = M.v3;
  const Colour = M.Colour;
  const Noise = M.Noise;
  const clamp = M.clamp;
  const lerp = M.lerp;
  const TAU = M.TAU;

  /* The engine's playable rectangle (see data.js CONFIG.world). */
  const PLAY = { minX: 34, maxX: 926, minZ: 300, maxZ: 506 };
  const CELL = 30;                     // terrain cell size in world units
  const WORLD_EXT = { minX: -520, maxX: 1480, minZ: -760, maxZ: 1060 };

  /* ============================================================
   * 1. ENVIRONMENTS — one per chapter, plus hub and arena
   * ========================================================== */
  const THEMES = {
    hub: {
      grade: { colour: '#ffd9a0', alpha: 0.06, blend: 'overlay' },
      id: 'hub', name: 'Verdant Hollow',
      skyTop: '#3f6fae', skyBottom: '#cfe0ef', accent: '#f2c14e', fog: '#c3d2df', fogDensity: 0.0015,
      ground: { base: '#5f9c53', alt: '#4c8347', rock: '#7d7f86', path: '#a68f63', cliff: '#5d6b53' },
      weather: 'clear', cycle: true, sunStart: 0.34,
      props: { trees: 'broadleaf', treeCount: 96, rocks: 34, bushes: 40, water: 'river', village: 5, castle: 'tower', ruins: 6, torches: 4, fences: 8, flowers: true }
    },
    chapter1: {
      grade: { colour: '#fff0c0', alpha: 0.05, blend: 'overlay' },
      id: 'chapter1', name: 'Silverstone Beginning',
      skyTop: '#4a6fa8', skyBottom: '#bcd3ea', accent: '#f2c14e', fog: '#bccbdc', fogDensity: 0.0016,
      ground: { base: '#6cb35f', alt: '#559a4d', rock: '#8a8b90', path: '#b39a6b', cliff: '#647a55' },
      weather: 'clear', cycle: true, sunStart: 0.36,
      props: { trees: 'broadleaf', treeCount: 104, rocks: 30, bushes: 46, water: 'river', village: 6, castle: 'watchtower', ruins: 7, torches: 4, fences: 10, flowers: true }
    },
    chapter2: {
      grade: { colour: '#8fffb0', alpha: 0.07, blend: 'overlay' },
      id: 'chapter2', name: 'Ancient Forest',
      skyTop: '#2f5a44', skyBottom: '#8fc49a', accent: '#9be36a', fog: '#8fb59a', fogDensity: 0.0026,
      ground: { base: '#4f8a4a', alt: '#3c6f3a', rock: '#6e7266', path: '#7f6a44', cliff: '#3f5a3a' },
      weather: 'spores', cycle: true, sunStart: 0.34,
      props: { trees: 'giant', treeCount: 120, rocks: 22, bushes: 60, mushrooms: 26, water: 'pond', village: 0, castle: null, ruins: 5, torches: 3, fences: 0, spirits: 12 }
    },
    chapter3: {
      grade: { colour: '#4a7fff', alpha: 0.12, blend: 'overlay' },
      id: 'chapter3', name: 'Dark Caverns',
      skyTop: '#12161f', skyBottom: '#3a4250', accent: '#8fe3ff', fog: '#2a3242', fogDensity: 0.0034,
      ground: { base: '#4a4f5c', alt: '#3b404b', rock: '#5c6270', path: '#63676f', cliff: '#2f343d' },
      weather: 'drip', cycle: false, sunStart: 0.5, ceiling: true,
      props: { trees: 'none', treeCount: 0, rocks: 70, stalagmites: 44, crystals: 26, water: 'lake', village: 0, castle: null, ruins: 8, torches: 12, fences: 0, glowingMoss: true }
    },
    chapter4: {
      grade: { colour: '#cfeaff', alpha: 0.1, blend: 'overlay' },
      id: 'chapter4', name: 'Frozen Valley',
      skyTop: '#3f76a4', skyBottom: '#cfe6f8', accent: '#7fdcff', fog: '#bcd8ec', fogDensity: 0.0018,
      ground: { base: '#b9d2e6', alt: '#93b3cc', rock: '#7a8ea1', path: '#c6daea', cliff: '#68798c', sand: '#cfe0ee' },
      weather: 'snow', cycle: true, sunStart: 0.4,
      props: { trees: 'conifer', treeCount: 90, rocks: 34, bushes: 12, ice: 30, water: 'frozen', village: 3, castle: 'tower', ruins: 6, torches: 6, fences: 4 }
    },
    chapter5: {
      grade: { colour: '#ffcf7a', alpha: 0.055, blend: 'overlay' },
      id: 'chapter5', name: 'Desert Ruins',
      skyTop: '#c98f4a', skyBottom: '#f6e2b4', accent: '#ffb347', fog: '#e7cf9e', fogDensity: 0.0024,
      ground: { base: '#e0c48a', alt: '#cdae72', rock: '#b09468', path: '#d8bd83', cliff: '#a98b5c' },
      weather: 'sand', cycle: true, sunStart: 0.42,
      props: { trees: 'dead', treeCount: 16, rocks: 40, dunes: true, ruins: 34, pillars: 22, village: 2, castle: 'obelisk', obelisks: 8, bones: 8, torches: 4 }
    },
    chapter6: {
      grade: { colour: '#7fff8a', alpha: 0.08, blend: 'overlay' },
      id: 'chapter6', name: 'Haunted Swamp',
      skyTop: '#2f4a3a', skyBottom: '#7a9a6a', accent: '#9be36a', fog: '#5d7358', fogDensity: 0.0038,
      ground: { base: '#4f6b3a', alt: '#3e5730', rock: '#5a6350', path: '#5f5432', cliff: '#33452a' },
      weather: 'fog', cycle: true, sunStart: 0.3,
      props: { trees: 'dead', treeCount: 86, rocks: 24, bushes: 30, reeds: 44, water: 'swamp', gravestones: 24, village: 0, castle: null, ruins: 14, torches: 6, wisps: 14 }
    },
    chapter7: {
      grade: { colour: '#ff5a3a', alpha: 0.09, blend: 'overlay' },
      id: 'chapter7', name: 'Demon Castle',
      skyTop: '#3a1f24', skyBottom: '#8a4a4a', accent: '#ff5f3a', fog: '#5c3a38', fogDensity: 0.0030,
      ground: { base: '#4a2a2a', alt: '#3a2020', rock: '#4d3840', path: '#5a3f38', cliff: '#2b1a1c' },
      weather: 'ash', cycle: true, sunStart: 0.62,
      props: { trees: 'dead', treeCount: 30, rocks: 30, castle: 'fortress', village: 0, ruins: 20, braziers: 14, lava: true, banners: 10, spikes: 16 }
    },
    chapter8: {
      grade: { colour: '#ff7a2a', alpha: 0.11, blend: 'overlay' },
      id: 'chapter8', name: 'Dragon Mountain',
      skyTop: '#5c2a1c', skyBottom: '#d98a5a', accent: '#ff7a3a', fog: '#8a5a44', fogDensity: 0.0028,
      ground: { base: '#6b3f2a', alt: '#573222', rock: '#54403c', path: '#6f4a30', cliff: '#3d2419' },
      weather: 'ember', cycle: true, sunStart: 0.35,
      props: { trees: 'none', treeCount: 0, rocks: 62, spikes: 34, lava: true, bones: 14, castle: null, ruins: 10, braziers: 8, dragonbones: 5, mountains: true }
    },
    chapter9: {
      grade: { colour: '#a45cff', alpha: 0.13, blend: 'overlay' },
      id: 'chapter9', name: 'Shadow Realm',
      skyTop: '#1a1530', skyBottom: '#5c4a8a', accent: '#c46bff', fog: '#241c40', fogDensity: 0.0032,
      weather: 'void', cycle: false, sunStart: 0.5,
      ground: { base: '#2f2850', alt: '#251f42', rock: '#3a3358', path: '#403862', cliff: '#1b1633' },
      props: { trees: 'void', treeCount: 34, rocks: 40, crystals: 34, floating: 18, ruins: 20, torches: 6, wisps: 20, castle: null, village: 0, pillars: 16 }
    },
    chapter10: {
      grade: { colour: '#ff6ad0', alpha: 0.1, blend: 'overlay' },
      id: 'chapter10', name: "Mythara's End",
      grade: { colour: '#ff6ad0', alpha: 0.10, blend: 'overlay' },
      skyTop: '#2b1440', skyBottom: '#8a5cff', accent: '#ffd76a', fog: '#3a2456', fogDensity: 0.0028,
      weather: 'storm', cycle: false, sunStart: 0.5,
      ground: { base: '#3a1259', alt: '#2c0d46', rock: '#4a2f66', path: '#5b3a7a', cliff: '#1e0833' },
      props: { trees: 'void', treeCount: 20, rocks: 44, crystals: 26, floating: 26, ruins: 30, pillars: 24, braziers: 10, runes: true, spire: true }
    },
    arena: {
      grade: { colour: '#ffd9a0', alpha: 0.07, blend: 'overlay' },
      id: 'arena', name: 'Silverstone Arena',
      skyTop: '#20304f', skyBottom: '#7f93b4', accent: '#ffd76a', fog: '#6b7a95', fogDensity: 0.0018,
      weather: 'clear', cycle: false, sunStart: 0.68,
      ground: { base: '#9a8f78', alt: '#877d68', rock: '#8d8578', path: '#b0a58c', cliff: '#6e6555' },
      props: { trees: 'none', treeCount: 0, rocks: 18, arena: true, pillars: 14, braziers: 10, banners: 12, stands: true, castle: 'tower', village: 0, ruins: 0, torches: 6 }
    }
  };

  function theme(id) { return THEMES[id] || THEMES.hub; }

  /** Pick an environment for a chapter index (1-10). */
  function themeForChapter(index) {
    return THEMES['chapter' + (index || 1)] || THEMES.hub;
  }

  /**
   * Resolve the environment from the engine's zone banner text:
   * "C3 · Dark Caverns — Cavern Mouth" → chapter3, "Arena — …" → arena.
   */
  function themeForZoneName(zoneName) {
    if (!zoneName) return THEMES.hub;
    if (/arena|duel/i.test(zoneName)) return THEMES.arena;
    const match = /C(\d+)\s*·/.exec(zoneName);
    if (match) return themeForChapter(parseInt(match[1], 10));
    return THEMES.hub;
  }

  /* ============================================================
   * 2. TERRAIN
   * ========================================================== */
  function inPlayArea(x, z, margin) {
    const m = margin || 0;
    return x > PLAY.minX - m && x < PLAY.maxX + m && z > PLAY.minZ - m - 60 && z < PLAY.maxZ + m;
  }

  /**
   * Height field. The playable rectangle is deliberately flat (0) so that
   * movement, ranges and collisions are unchanged; everything outside
   * rolls into hills, cliffs and dunes.
   */
  function makeHeightField(theme_) {
    const seed = 1337 + theme_.id.length * 977;
    const t = theme_;
    const terraced = t.props && t.props.dunes;
    // Rolling ground everywhere — gentle hills and shallow valleys. The seed is
    // derived from the region id, so the map is identical on every device/boot.
    const amp = t.props && t.props.arena ? 0 : (t.id === 'chapter3' ? 2.6 : 5.6);
    const rolling = function (x, z) {
      return (Noise.fbm(x / 380, z / 380, seed + 401, 3) - 0.5) * 2 * amp
        + (Noise.fbm(x / 150, z / 150, seed + 733, 2) - 0.5) * 2 * amp * 0.3
        + (Noise.value(x / 62, z / 62, seed + 97) - 0.5) * 2 * amp * 0.12;
    };
    return function heightAt(x, z) {
      const inside = inPlayArea(x, z, 46);
      let h = rolling(x, z);
      if (inside) return h;                       // the battlefield rolls, it is not a plate
      const nx = (x - 480) / 260;
      const nz = (z - 400) / 260;
      const dist = Math.sqrt(nx * nx + nz * nz);
      const rise = M.smoothstep(clamp((dist - 0.95) / 2.2, 0, 1));
      h += rise * (16 + Noise.fbm(x / 420, z / 420, seed, 4) * 52);
      h += Noise.fbm(x / 150, z / 150, seed + 91, 3) * 4.2 * rise;
      const rim = clamp((Math.max(0, dist - 2.0) / 2.2), 0, 1);
      h += rim * rim * 190 * (0.5 + Noise.fbm(x / 620, z / 620, seed + 7, 3));
      const peaks = clamp((Math.max(0, dist - 3.1) / 2.2), 0, 1);
      h += peaks * peaks * 320 * (0.35 + Noise.fbm(x / 380, z / 380, seed + 23, 2) * 1.2);
      if (terraced) h = Math.round(h / 7) * 7;
      // keep a bowl around the arena, then a cliff lip on the north edge
      const lip = M.smoothstep(clamp((PLAY.minZ - 46 - z) / 90, 0, 1));
      h += lip * 6;
      // carve water beds so rivers, lakes and swamps sit in real channels
      const water = waterDepth(x, z, theme_);
      if (water > 0.02) {
        const type = theme_.props && theme_.props.water;
        const bed = type === 'lake' || type === 'frozen' ? 9 : type === 'swamp' ? 2 : type === 'pond' ? 7 : 5;
        h = lerp(bed - 3 * water, h, clamp(1 - water * 2.4, 0, 1));
      }
      return h;
    };
  }

  /** Dirt road that runs across the arena and off toward the horizon. */
  function roadCentre(x) {
    return 452 + Math.sin((x - 200) / 260) * 46 + Math.sin(x / 90) * 6;
  }

  /** Distance from a point to the road centreline (used to keep props off it). */
  function roadDistance(x, z) {
    return Math.abs(z - roadCentre(x));
  }

  /** Village plaza centre (Silverstone Beginning) — kept clear of scenery. */
  const VILLAGE = { x: 480, z: 214, r: 190 };

  /** Terrain material by position, height and theme. */
  function makeMaterials(theme_) {
    const g = theme_.ground;
    const props = theme_.props || {};
    const snowcaps = !['chapter3', 'chapter6', 'chapter7', 'chapter8'].some(function (id) { return theme_.id === id; });
    const snowLine = theme_.id === 'chapter5' ? 150 : theme_.id === 'chapter4' ? 60 : 120;
    return function materialAt(x, z, h) {
      const alt = Noise.fbm(x / 210, z / 210, 77, 3);
      const mottle = Noise.value(x / 58, z / 58, 91);
      const base = Colour.mix(g.base, g.alt, clamp(alt * 0.9 - 0.1, 0, 1));
      let colour = Colour.mix(base, g.base, mottle * 0.18);
      // Continuous ramps (grass → rock → cliff → snow). Hard height steps used to
      // paint flat white wedges wherever a hill crossed a threshold.
      if (h > 15) colour = Colour.mix(colour, g.rock, clamp((h - 15) / 30, 0, 1));
      if (h > 40) colour = Colour.mix(colour, g.cliff, clamp((h - 40) / 38, 0, 1));
      if (snowcaps && h > snowLine) colour = Colour.mix(colour, '#eef4fb', clamp((h - snowLine) / 80, 0, 0.8));
      // wet sand / gravel ringing every shoreline
      const w = waterDepth(x, z, theme_);
      if (w > 0.02) {
        const sand = g.sand || g.path || '#cbb083';
        colour = Colour.mix(colour, sand, clamp(1 - w * 1.6, 0, 1) * 0.8);
      }
      return colour;
    };
  }

  /**
   * Water mask: > 0 means water, the value is depth 0..1.
   * Rivers/ponds/lakes sit outside the arena so combat stays fair.
   */
  function waterDepth(x, z, theme_) {
    const type = theme_.props && theme_.props.water;
    if (!type) return 0;
    if (type === 'river') {
      // a river crossing the northern valley, well clear of the arena
      const centre = -170 + Math.sin(x / 240) * 42;
      const halfWidth = 44 + Math.sin(x / 90) * 10;
      const d = Math.abs(z - centre) / halfWidth;
      return clamp(1 - d, 0, 1);
    }
    if (type === 'pond') {
      const dx = (x - 1110) / 150, dz = (z - -120) / 110;
      return clamp(1 - Math.sqrt(dx * dx + dz * dz), 0, 1);
    }
    if (type === 'lake' || type === 'frozen') {
      const dx = (x - 1130) / 210, dz = (z - 210) / 160;
      return clamp(1 - Math.sqrt(dx * dx + dz * dz), 0, 1);
    }
    if (type === 'swamp') {
      const n = Noise.fbm(x / 210, z / 190, 999, 3);
      return clamp((n - 0.44) * 3.4, 0, 1);
    }
    return 0;
  }

  /* ============================================================
   * 3. PROP GENERATOR — seeded scenery per region
   * ========================================================== */
  function buildProps(theme_) {
    const rng = M.Noise;
    const seed = 4242 + theme_.id.length * 313;
    const props = theme_.props || {};
    const list = [];
    const detail = [];
    const heightAt = makeHeightField(theme_);

    function rand(i, salt) { return rng.hash2(i * 13 + (salt || 0), i * 7 + (salt || 1) * 3, seed + (salt || 0) * 17); }

    function place(type, count, cfg) {
      for (let i = 0; i < count; i++) {
        const a = rand(i, type.length) * TAU;
        const band = cfg.band || [200, 620];
        const r = band[0] + rand(i + 40, type.length + 5) * (band[1] - band[0]);
        let x = 480 + Math.cos(a) * r * (cfg.stretch ? cfg.stretch[0] : 1.55);
        let z = 400 + Math.sin(a) * r * (cfg.stretch ? cfg.stretch[1] : 0.95);
        x = clamp(x, WORLD_EXT.minX + 20, WORLD_EXT.maxX - 20);
        z = clamp(z, WORLD_EXT.minZ + 20, WORLD_EXT.maxZ - 20);
        if (cfg.avoidPlay && inPlayArea(x, z, cfg.avoidPlay)) continue;
        if (cfg.onlyOutside && inPlayArea(x, z, cfg.onlyOutside)) continue;
        // never drop scenery on the road, in the village plaza or in the arena ring
        if (!cfg.onRoad && roadDistance(x, z) < (cfg.roadGap || 36)) continue;
        if (cfg.plazaGap !== 0 && Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < (cfg.plazaGap || VILLAGE.r)) continue;
        if (waterDepth(x, z, theme_) > 0.25 && !cfg.onWater) continue;
        const h = heightAt(x, z);
        if (cfg.maxHeight !== undefined && h > cfg.maxHeight) continue;
        if (cfg.minHeight !== undefined && h < cfg.minHeight) continue;
        if (cfg.flat && h > 6) continue;
        list.push({
          type: type, x: x, z: z, y: h,
          s: (cfg.scaleMin || 0.85) + rand(i + 91, 3) * ((cfg.scaleMax || 1.25) - (cfg.scaleMin || 0.85)),
          rot: rand(i + 17, 9) * TAU,
          v: rand(i + 33, 11),
          i: i
        });
      }
    }

    /**
     * Field scatter: scenery *inside* the walkable field, so the battlefield is
     * a living landscape instead of an empty plate. Kept off the road corridor,
     * out of the village plaza and out of the central duelling circle.
     */
    function placeField(type, count, cfg) {
      const conf = cfg || {};
      for (let i = 0; i < count * 3 && placedField < count; i++) {
        const x = PLAY.minX + 12 + rand(i * 3 + 7, 81) * (PLAY.maxX - PLAY.minX - 24);
        const z = PLAY.minZ + 8 + rand(i * 5 + 11, 83) * (PLAY.maxZ - PLAY.minZ - 16);
        if (roadDistance(x, z) < (conf.roadGap || 42)) continue;
        if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < VILLAGE.r) continue;
        if (Math.hypot(x - 480, z - 402) < (conf.centre || 150)) continue;
        if (conf.edge) {
          const edge = Math.min(x - PLAY.minX, PLAY.maxX - x, z - PLAY.minZ, PLAY.maxZ - z);
          if (edge > (conf.edgeDepth || 70)) continue;
        }
        const h = heightAt(x, z);
        list.push({
          type: type, x: x, z: z, y: h,
          s: (conf.scaleMin || 0.8) + rand(i + 91, 3) * ((conf.scaleMax || 1.25) - (conf.scaleMin || 0.8)),
          rot: rand(i + 17, 9) * TAU,
          v: rand(i + 33, 11),
          i: i
        });
        placedField++;
      }
    }
    let placedField = 0;

    if (props.trees && props.trees !== 'none' && props.treeCount) {
      place('tree:' + props.trees, props.treeCount, { band: [200, 950], avoidPlay: 54 });
      // a handful of trees framing the field's rim
      placeField('tree:' + props.trees, Math.max(4, Math.round(props.treeCount * 0.12)), { edge: true, roadGap: 46, scaleMin: 0.9, scaleMax: 1.25 });
    }
    if (props.trees === 'none' && props.rocks) {
      // no trees: fill the outer ring with rock instead so the horizon is not empty
      place('rockBig', Math.round(props.rocks * 0.7), { band: [240, 960], avoidPlay: 50 });
    }
    if (props.rocks) place('rock', props.rocks, { band: [120, 900], avoidPlay: 26 });
    if (props.rocks) placeField('rock', Math.max(5, Math.round(props.rocks * 0.45)), { roadGap: 44, centre: 130, scaleMin: 0.7, scaleMax: 1.35 });
    if (props.bushes) place('bush', props.bushes, { band: [110, 620], avoidPlay: 34 });
    if (props.bushes) placeField('bush', Math.max(6, Math.round(props.bushes * 0.5)), { roadGap: 40, centre: 140, scaleMin: 0.8, scaleMax: 1.3 });
    placeField('rockBig', 6, { roadGap: 48, centre: 130, scaleMin: 0.6, scaleMax: 1.05 });
    if (props.stalagmites) place('stalagmite', props.stalagmites, { band: [110, 820], avoidPlay: 30 });
    if (props.crystals) place('crystal', props.crystals, { band: [130, 800], avoidPlay: 44 });
    if (props.ice) place('iceShard', props.ice, { band: [130, 760], avoidPlay: 40 });
    if (props.mushrooms) place('mushroom', props.mushrooms, { band: [130, 700], avoidPlay: 40 });
    if (props.reeds) place('reed', props.reeds, { band: [120, 520], avoidPlay: 60, onWater: true });
    if (props.gravestones) place('gravestone', props.gravestones, { band: [200, 720], avoidPlay: 60 });
    if (props.pillars) place('pillar', props.pillars, { band: [190, 820], avoidPlay: 50 });
    if (props.ruins) place('ruin', props.ruins, { band: [220, 860], avoidPlay: 56 });
    if (props.obelisks) place('obelisk', props.obelisks, { band: [240, 820], avoidPlay: 60 });
    if (props.bones) place('bones', props.bones, { band: [180, 780], avoidPlay: 50 });
    if (props.dragonbones) place('dragonbones', props.dragonbones, { band: [260, 780], avoidPlay: 60 });
    if (props.spikes) place('spike', props.spikes, { band: [140, 860], avoidPlay: 40 });
    if (props.floating) place('floatingRock', props.floating, { band: [200, 900], avoidPlay: 50 });
    if (props.wisps) place('wisp', props.wisps, { band: [160, 760], avoidPlay: 40 });
    if (props.spirits) place('spirit', props.spirits, { band: [160, 760], avoidPlay: 40 });

    // ---- near-field ground detail: the layer that makes the floor read as grass,
    // snow, sand or moss instead of a flat plane. Purely decorative.
    detail.push.apply(detail, buildDetail(theme_));

    // Avenues of braziers/torches around the arena — these frame the fight.
    const torches = props.torches || 0;
    for (let i = 0; i < torches; i++) {
      const a = (i / Math.max(1, torches)) * TAU + 0.4;
      const rx = 300, rz = 168;
      list.push({
        type: 'torch', x: 480 + Math.cos(a) * rx, z: 400 + Math.sin(a) * rz,
        y: heightAt(480 + Math.cos(a) * rx, 400 + Math.sin(a) * rz),
        s: 1, rot: a, v: 0.3 + i * 0.13, i: i
      });
    }
    if (props.braziers) {
      for (let i = 0; i < props.braziers; i++) {
        const a = (i / props.braziers) * TAU + 0.2;
        const rx = 320, rz = 182;
        const x = 480 + Math.cos(a) * rx, z = 400 + Math.sin(a) * rz;
        list.push({ type: 'brazier', x: x, z: z, y: heightAt(x, z), s: 1, rot: a, v: 0.2 + i * 0.11, i: i });
      }
    }
    /**
     * Village — houses ring the plaza, with a well, market stalls, a blacksmith,
     * fences, lanterns, a safe-zone ring and NPCs (quest giver, shop, healer).
     * All decorative: the walkable field and the combat rules are unchanged.
     */
    // Silverstone Beginning is the hometown: it gets the plaza, market,
    // blacksmith, safe zone and NPCs. Other regions with houses stay hamlets —
    // a market square in the desert or the swamp would be out of place.
    const HOMETOWN = theme_.id === 'hub' || theme_.id === 'chapter1';
    if (props.village) {
      const V = VILLAGE;
      for (let i = 0; i < props.village; i++) {
        const a = -1.15 + (i / Math.max(1, props.village)) * 1.5;
        const x = 480 + Math.cos(a) * (300 + rand(i, 21) * 90);
        const z = 400 - (250 + rand(i, 22) * 110);
        list.push({ type: 'house', x: x, z: z, y: heightAt(x, z), s: 0.9 + rand(i, 23) * 0.5, rot: rand(i, 24) * TAU, v: rand(i, 25), i: i, lamp: true });
      }
      const vy = heightAt(V.x, V.z);
      list.push({ type: 'well', x: V.x - 30, z: V.z - 6, y: heightAt(V.x - 30, V.z - 6), s: 1, rot: 0, v: 0.5, i: 0 });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.5;
        const x = V.x + Math.cos(a) * 88, z = V.z + Math.sin(a) * 74;
        list.push({ type: 'lantern', x: x, z: z, y: heightAt(x, z), s: 1, rot: 0, v: rand(i, 71), i: i + 11 });
      }
      if (HOMETOWN) {
        list.push({ type: 'plaza', x: V.x, z: V.z, y: vy, s: 1, rot: 0, v: 0.5, i: 1 });
        list.push({ type: 'safeZone', x: V.x, z: V.z, y: vy, r: 74, s: 1, rot: 0, v: 0.5, i: 2 });
        list.push({ type: 'blacksmith', x: V.x + 46, z: V.z + 26, y: heightAt(V.x + 46, V.z + 26), s: 1, rot: -0.5, v: 0.6, i: 3 });
        [[-26, 30, 0.2], [22, 34, 2.2], [-4, 44, 1.2]].forEach(function (c, i) {
          const x = V.x + c[0], z = V.z + c[1];
          list.push({ type: 'market', x: x, z: z, y: heightAt(x, z), s: 1, rot: c[2], v: i === 1 ? 0.8 : 0.3, i: i + 4 });
        });
        [
          { x: V.x - 34, z: V.z + 30, name: 'Warden Ilsa', mark: '!', v: 0.2 },
          { x: V.x + 34, z: V.z - 8, name: 'Trader Bex', mark: '$', v: 0.5 },
          { x: V.x - 30, z: V.z - 34, name: 'Healer Sora', mark: '+', v: 0.85 }
        ].forEach(function (n, i) {
          list.push({ type: 'npc', x: n.x, z: n.z, y: heightAt(n.x, n.z), s: 1, rot: 0, v: n.v, i: i + 1, name: n.name, mark: n.mark });
        });
      }
    }
    if (props.castle === 'tower' || props.castle === 'watchtower') {
      list.push({ type: props.castle, x: 1160, z: -300, y: heightAt(1160, -300), s: 1.15, rot: -0.3, v: 0.5, i: 0 });
    }
    if (props.castle === 'obelisk') {
      list.push({ type: 'obeliskBig', x: 1180, z: -340, y: heightAt(1180, -340), s: 1.5, rot: 0.2, v: 0.5, i: 1 });
    }
    if (props.castle === 'fortress') {
      list.push({ type: 'fortress', x: 1120, z: -360, y: heightAt(1120, -360), s: 1.25, rot: -0.35, v: 0.5, i: 2 });
    }
    if (props.arena) {
      list.push({ type: 'arenaRing', x: 480, z: 402, y: 0, s: 1, rot: 0, v: 0.5, i: 3 });
      for (let i = 0; i < (props.pillars || 12); i++) {
        const a = (i / (props.pillars || 12)) * TAU;
        const x = 480 + Math.cos(a) * 348, z = 402 + Math.sin(a) * 196;
        list.push({ type: 'pillar', x: x, z: z, y: heightAt(x, z), s: 1.1, rot: a, v: 0.5, i: i });
      }
    }
    if (props.caveMouth) {
      list.push({ type: 'caveMouth', x: 1200, z: 120, y: heightAt(1200, 120), s: 1.4, rot: -1.5, v: 0.5, i: 0 });
    }
    if (props.dungeonGate) {
      list.push({ type: 'dungeonGate', x: -360, z: 200, y: heightAt(-360, 200), s: 1.3, rot: 1.5, v: 0.5, i: 0 });
    }
    if (props.spire) {
      list.push({ type: 'spire', x: 1000, z: -420, y: heightAt(1000, -420), s: 1.6, rot: 0.4, v: 0.5, i: 0 });
    }
    if (props.fences) {
      for (let i = 0; i < props.fences; i++) {
        const x = 60 + rand(i, 61) * 840;
        const z = 470 + rand(i, 62) * 260;
        list.push({ type: 'fence', x: x, z: z, y: heightAt(x, z), s: 1, rot: rand(i, 63) * 0.6, v: rand(i, 64), i: i });
      }
    }
    // Road furniture: split-rail fence runs, signposts and lanterns either side
    // of the dirt road, all lifted onto the terrain.
    for (let x = 90; x <= 900; x += 74) {
      const c = roadCentre(x);
      const side = (Math.floor(x / 74) % 2) ? 1 : -1;
      const fx = x, fz = c + side * 30;
      list.push({ type: 'fence', x: fx, z: fz, y: heightAt(fx, fz), s: 1, rot: 0.06 * side, v: rand(x, 64), i: Math.round(x) });
      if (x % 148 < 40) {
        const lx = x, lz = c - side * 26;
        list.push({ type: 'lantern', x: lx, z: lz, y: heightAt(lx, lz), s: 1, rot: 0, v: rand(x, 72), i: Math.round(x) });
      }
      if (x % 222 < 40) {
        const sx = x, sz = c - side * 33;
        list.push({ type: 'signpost', x: sx, z: sz, y: heightAt(sx, sz), s: 1, rot: side > 0 ? -1.4 : 1.4, v: rand(x, 73), i: Math.round(x) });
      }
    }

    list.sort(function (a, b) { return a.z - b.z; });
    detail.sort(function (a, b) { return a.z - b.z; });
    return { props: list, detail: detail };
  }

  /* ============================================================
   * SOLID PROPS — what movement and line of fire must respect
   * ------------------------------------------------------------
   * Only genuinely solid scenery is listed (buildings, big rocks,
   * ruins, tree trunks). Fences, lanterns, bushes and signposts
   * stay decorative so the walkable field keeps its free-flowing
   * feel — the combat rules and the play area are unchanged.
   * ========================================================== */
  const BLOCKER_RADIUS = {
    house: 12, ruin: 10, well: 4.5, blacksmith: 11, market: 6.5,
    tower: 9, watchtower: 10, fortress: 30, spire: 14, obeliskBig: 9,
    pillar: 4, rock: 3.4, rockBig: 8, tree: 1.9, crystal: 3
  };
  const MAX_SLOPE = 0.5;              // walkable gradient; the playfield sits at 0.05

  function blockerRadius(p) {
    const key = String(p.type || '').split(':')[0];
    const base = BLOCKER_RADIUS[key] || BLOCKER_RADIUS[p.type];
    if (!base) return 0;
    return base * (p.s || 1);
  }

  /** Filter a built prop list down to the solid circles movement cares about. */
  function collectBlockers(list) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const r = blockerRadius(list[i]);
      if (r > 0) out.push({ x: list[i].x, z: list[i].z, r: r, type: list[i].type });
    }
    return out;
  }

  /**
   * Scatter thousands of tiny ground details across the region. They are held
   * in a uniform grid so the renderer only touches the few hundred nearest
   * the camera — detail where you look, none of the cost where you don't.
   */
  function buildDetail(theme_) {
    const props = theme_.props || {};
    const heightAt = makeHeightField(theme_);
    const out = [];
    const seed = 90210 + theme_.id.length * 71;
    const count = 2600;
    const kinds = [];
    const push = function (kind, weight) { kinds.push({ kind: kind, weight: weight }); };

    if (props.water === 'swamp') { push('moss', 4); push('reed', 3); push('puddle', 1); push('pebble', 1); }
    else if (theme_.id === 'chapter4') { push('snowdrift', 4); push('iceShard', 3); push('pebble', 2); push('moss', 1); }
    else if (theme_.id === 'chapter5') { push('pebble', 4); push('dune', 4); push('bone', 1); }
    else if (theme_.id === 'chapter3') { push('pebble', 4); push('moss', 3); push('crystalShard', 1); }
    else if (theme_.id === 'chapter7' || theme_.id === 'chapter8') { push('ash', 4); push('pebble', 3); push('emberRock', 2); push('bone', 1); }
    else if (theme_.id === 'chapter9' || theme_.id === 'chapter10') { push('voidGrass', 4); push('crystalShard', 3); push('pebble', 1); }
    else { push('grass', 6); push('flower', 2); push('pebble', 1); push('twig', 1); }

    const totalWeight = kinds.reduce(function (n, k) { return n + k.weight; }, 0);
    for (let i = 0; i < count; i++) {
      const x = -300 + M.Noise.hash2(i * 3 + 1, 7, seed) * 1700;
      const z = -520 + M.Noise.hash2(i * 5 + 2, 11, seed) * 1750;
      if (waterDepth(x, z, theme_) > 0.35 && props.water !== 'swamp') continue;
      let roll = M.Noise.hash2(i * 7 + 3, 13, seed) * totalWeight;
      let kind = kinds[0].kind;
      for (let k = 0; k < kinds.length; k++) { roll -= kinds[k].weight; if (roll <= 0) { kind = kinds[k].kind; break; } }
      out.push({
        type: kind, x: x, z: z, y: heightAt(x, z),
        s: 0.7 + M.Noise.hash2(i * 11 + 5, 17, seed) * 0.9,
        rot: M.Noise.hash2(i * 13 + 6, 19, seed) * TAU,
        v: M.Noise.hash2(i * 17 + 7, 23, seed)
      });
    }
    return out;
  }

  /* ============================================================
   * 4. PROP DRAWING — original low-poly fantasy props
   * ========================================================== */
  const PALETTE = {
    trunk: '#5a4026', trunkDark: '#3f2c1a', bark: '#6b4c2c',
    leaf: '#3f7a33', leafDark: '#2c5626', leafLight: '#5fa348',
    pine: '#2f5c3a', pineDark: '#20412a', snow: '#f2f8ff'
  };

  function treeConifer(P, p, t, theme_) {
    const h = 33 * p.s;
    const sway = Math.sin(t * 0.55 + p.v * 7) * 0.22;
    S.cylinder(P, { pos: v3(p.x + sway * 0.3, p.y + h * 0.13, p.z), radius: 1.3 * p.s, radiusTop: 0.9 * p.s, height: h * 0.3, sides: 6, color: PALETTE.trunkDark });
    // two broad crowns: a real pine silhouette rather than a thin rocket
    S.cone(P, {
      pos: v3(p.x + sway * 0.6, p.y + h * 0.44, p.z),
      radius: 8.4 * p.s, height: 17 * p.s, sides: 6,
      color: PALETTE.pineDark, yaw: p.rot
    });
    S.cone(P, {
      pos: v3(p.x + sway, p.y + h * 0.74, p.z),
      radius: 5.9 * p.s, height: 13 * p.s, sides: 6,
      color: PALETTE.pine, yaw: p.rot + 0.4
    });
    const snowy = theme_ && (theme_.id === 'chapter4' || theme_.id === 'hub');
    if (p.v > 0.62 && snowy) {
      S.cone(P, { pos: v3(p.x + sway, p.y + h * 0.93, p.z), radius: 3.4 * p.s, height: 3.2 * p.s, sides: 6, color: '#f4faff' });
    }
    void t;
  }

  function treeBroadleaf(P, p, t) {
    const h = 30 * p.s;
    const sway = Math.sin(t * 0.7 + p.v * 8) * 0.35;
    S.cylinder(P, { pos: v3(p.x + sway * 0.4, p.y + h * 0.22, p.z), radius: 1.6 * p.s, radiusTop: 1.0 * p.s, height: h * 0.46, sides: 6, color: PALETTE.trunk });
    // two big canopy lobes + a rim lobe so the silhouette is a crown, not a lollipop
    S.blob(P, {
      pos: v3(p.x + sway, p.y + h * 0.78, p.z), radii: v3(11.4 * p.s, 8.6 * p.s, 10.6 * p.s),
      slices: 6, rings: 2, color: Colour.mix(PALETTE.leaf, PALETTE.leafLight, p.v * 0.5), jitter: 0.22, seed: p.i + 3
    });
    S.blob(P, {
      pos: v3(p.x - 4.6 * p.s + sway, p.y + h * 0.66, p.z + 1.8 * p.s), radii: v3(7.0 * p.s, 5.6 * p.s, 6.6 * p.s),
      slices: 5, rings: 2, color: PALETTE.leafDark, jitter: 0.25, seed: p.i + 9
    });
    S.blob(P, {
      pos: v3(p.x + 4.2 * p.s + sway, p.y + h * 0.9, p.z - 2.2 * p.s), radii: v3(6.2 * p.s, 4.6 * p.s, 5.6 * p.s),
      slices: 4, rings: 2, color: Colour.mix(PALETTE.leaf, PALETTE.leafLight, 0.65), jitter: 0.24, seed: p.i + 17
    });
  }

  function treeGiant(P, p, t) {
    const h = 68 * p.s;
    const sway = Math.sin(t * 0.4 + p.v * 6) * 0.5;
    S.cylinder(P, { pos: v3(p.x, p.y + h * 0.3, p.z), radius: 3.4 * p.s, radiusTop: 2.2 * p.s, height: h * 0.66, sides: 7, color: PALETTE.bark });
    for (let i = 0; i < 3; i++) {
      S.blob(P, {
        pos: v3(p.x + sway + (i - 1) * 7 * p.s, p.y + h * (0.78 + i * 0.09), p.z + (i % 2 ? 4 : -3) * p.s),
        radii: v3((11 - i) * p.s, (7 - i * 0.6) * p.s, (10 - i) * p.s),
        slices: 6, rings: 2, color: i === 1 ? PALETTE.leafLight : PALETTE.leaf, jitter: 0.24, seed: p.i + i * 5
      });
    }
    if (p.v > 0.72) {
      S.cylinder(P, { pos: v3(p.x + 4 * p.s, p.y + h * 0.42, p.z), radius: 1.1 * p.s, radiusTop: 0.6 * p.s, height: 12 * p.s, sides: 5, color: PALETTE.bark, rot: v3(0, 0, 1.05) });
      S.blob(P, { pos: v3(p.x + 9 * p.s, p.y + h * 0.5, p.z), radii: v3(3.4 * p.s, 2.6 * p.s, 3.2 * p.s), slices: 5, rings: 2, color: PALETTE.leafDark, jitter: 0.2, seed: p.i });
    }
  }

  function treeDead(P, p, t) {
    const h = 30 * p.s;
    const sway = Math.sin(t * 0.9 + p.v * 9) * 0.5;
    S.cylinder(P, { pos: v3(p.x, p.y + h * 0.34, p.z), radius: 1.3 * p.s, radiusTop: 0.7 * p.s, height: h * 0.72, sides: 6, color: '#4a3a2c' });
    for (let i = 0; i < 4; i++) {
      const a = p.rot + i * 1.7;
      S.cylinder(P, {
        pos: v3(p.x + Math.cos(a) * 3.4 * p.s + sway, p.y + h * (0.62 + i * 0.07), p.z + Math.sin(a) * 3.4 * p.s),
        radius: 0.6 * p.s, radiusTop: 0.2 * p.s, height: 8 * p.s, sides: 4, color: '#40311f',
        rot: v3(Math.sin(a) * 0.9, 0, Math.cos(a) * 0.9)
      });
    }
  }

  function treeVoid(P, p, t) {
    const h = 38 * p.s;
    const pulse = 0.6 + Math.sin(t * 1.6 + p.v * 9) * 0.4;
    S.cylinder(P, { pos: v3(p.x, p.y + h * 0.24, p.z), radius: 1.2 * p.s, radiusTop: 0.6 * p.s, height: h * 0.52, sides: 5, color: '#2a2340' });
    S.blob(P, {
      pos: v3(p.x, p.y + h * 0.72, p.z), radii: v3(7 * p.s, 6 * p.s, 7 * p.s),
      slices: 6, rings: 3, color: '#4a3a7a', jitter: 0.3, seed: p.i + 11, glow: '#c46bff', glowAlpha: 0.25 * pulse
    });
  }

  function bush(P, p) {
    S.blob(P, {
      pos: v3(p.x, p.y + 1.6 * p.s, p.z), radii: v3(3.4 * p.s, 2.3 * p.s, 3.2 * p.s),
      slices: 5, rings: 2, color: Colour.mix(PALETTE.leafDark, PALETTE.leaf, p.v), jitter: 0.3, seed: p.i
    });
  }

  /**
   * Field rocks: a bedrock lump half-buried in the ground plus a couple of
   * companion boulders. Sunk low so they read as rock, not paper shards.
   */
  function rockSmall(P, p, theme_) {
    const g = (theme_ && theme_.ground) || {};
    const base = g.rock || '#7d7f86';
    const alt = Colour.shade(base, -0.22);
    S.blob(P, {
      pos: v3(p.x, p.y - 0.6 * p.s, p.z), radii: v3(2.9 * p.s, 2.5 * p.s, 2.7 * p.s),
      slices: 6, rings: 3, color: base, jitter: 0.34, seed: p.i, yaw: p.rot
    });
    S.blob(P, {
      pos: v3(p.x + 1.7 * p.s, p.y - 0.8 * p.s, p.z + 1.1 * p.s), radii: v3(1.7 * p.s, 1.4 * p.s, 1.6 * p.s),
      slices: 5, rings: 2, color: alt, jitter: 0.42, seed: p.i + 11, yaw: p.rot + 1.1
    });
    if (p.v > 0.6) {
      S.blob(P, {
        pos: v3(p.x - 1.9 * p.s, p.y - 0.9 * p.s, p.z - 1.3 * p.s), radii: v3(1.2 * p.s, 1.0 * p.s, 1.1 * p.s),
        slices: 4, rings: 2, color: base, jitter: 0.4, seed: p.i + 23
      });
    }
  }

  function rockBig(P, p, theme_) {
    const g = theme_.ground;
    S.blob(P, {
      pos: v3(p.x, p.y + 4.5 * p.s, p.z), radii: v3(7 * p.s, 6 * p.s, 6 * p.s),
      slices: 6, rings: 3, color: Colour.mix(g.rock, g.cliff, p.v), jitter: 0.42, seed: p.i, yaw: p.rot
    });
    S.blob(P, {
      pos: v3(p.x + 4 * p.s, p.y + 2.4 * p.s, p.z + 2 * p.s), radii: v3(3.6 * p.s, 2.8 * p.s, 3.4 * p.s),
      slices: 5, rings: 2, color: g.rock, jitter: 0.4, seed: p.i + 4
    });
  }

  function stalagmite(P, p) {
    const h = 12 * p.s;
    S.cone(P, { pos: v3(p.x, p.y + h / 2, p.z), radius: 2.2 * p.s, height: h, sides: 6, color: '#4d5361', yaw: p.rot, cap: false });
    if (p.v > 0.7) S.cone(P, { pos: v3(p.x, p.y + h * 1.45, p.z), radius: 1.4 * p.s, height: -h * 0.8, sides: 6, color: '#454b58', yaw: p.rot });
  }

  function crystal(P, p, theme_) {
    const colour = theme_.accent || '#8fe3ff';
    const h = 6 + p.v * 7;
    S.cone(P, { pos: v3(p.x, p.y + h / 2, p.z), radius: 1.5 * p.s, height: h * p.s, sides: 5, color: Colour.mix(colour, '#ffffff', 0.2), yaw: p.rot, glow: colour, glowAlpha: 0.22, cap: false });
    if (p.v > 0.5) {
      S.cone(P, { pos: v3(p.x + 1.6, p.y + h * 0.28, p.z + 0.8), radius: 1.0 * p.s, height: h * 0.6 * p.s, sides: 5, color: colour, yaw: p.rot + 0.5, rot: v3(0, 0, 0.3), glow: colour, glowAlpha: 0.18, cap: false });
    }
    S.billboard(P, { pos: v3(p.x, p.y + h * 0.5, p.z), width: 9 * p.s, height: 9 * p.s, color: colour, alpha: 0.16, soft: true });
  }

  function iceShard(P, p) {
    S.cone(P, { pos: v3(p.x, p.y + 3 * p.s, p.z), radius: 1.6 * p.s, height: 6 * p.s, sides: 5, color: '#dff2ff', yaw: p.rot, glow: '#bfe9ff', glowAlpha: 0.14, cap: false });
  }

  function mushroom(P, p) {
    S.cylinder(P, { pos: v3(p.x, p.y + 1.4 * p.s, p.z), radius: 0.5 * p.s, height: 2.8 * p.s, sides: 5, color: '#e8dcc0' });
    S.blob(P, { pos: v3(p.x, p.y + 3.1 * p.s, p.z), radii: v3(2.2 * p.s, 1.1 * p.s, 2.2 * p.s), slices: 6, rings: 2, color: '#c46bff', glow: '#c46bff', glowAlpha: 0.2 });
  }

  function reed(P, p, t) {
    const sway = Math.sin(t * 1.4 + p.v * 9) * 0.5;
    for (let i = 0; i < 4; i++) {
      const ox = (i - 1.5) * 0.7;
      S.cylinder(P, {
        pos: v3(p.x + ox + sway, p.y + 3 * p.s, p.z + ox * 0.4), radius: 0.16 * p.s, height: 6.2 * p.s,
        sides: 3, color: '#6f7a3f', rot: v3(sway * 0.1, 0, sway * 0.06)
      });
    }
  }

  function gravestone(P, p) {
    S.box(P, {
      pos: v3(p.x, p.y + 2.2 * p.s, p.z), size: v3(3.4 * p.s, 4.4 * p.s, 0.9 * p.s),
      colours: { top: '#6f7480', front: '#5f6470', side: '#565b66', bottom: '#3f434c' }, rot: v3(0, p.rot, (p.v - 0.5) * 0.12)
    });
  }

  function pillar(P, p, theme_) {
    const broken = p.v > 0.5;
    const h = broken ? 12 + p.v * 8 : 22;
    S.cylinder(P, { pos: v3(p.x, p.y + h / 2, p.z), radius: 2.3 * p.s, radiusTop: 2.0 * p.s, height: h, sides: 8, color: '#a99a80' });
    if (!broken) {
      S.box(P, { pos: v3(p.x, p.y + h + 0.6, p.z), size: v3(6.4 * p.s, 1.6, 6.4 * p.s), colours: { all: '#bfae90' }, rot: v3(0, p.rot, 0) });
    } else {
      S.box(P, { pos: v3(p.x, p.y + h - 1, p.z), size: v3(4.4 * p.s, 2.6, 4.4 * p.s), colours: { all: '#9c8f77' }, rot: v3(0.25 * p.v, p.rot, 0.2 * p.v) });
    }
    void theme_;
  }

  function ruin(P, p, theme_) {
    const rot = p.rot;
    S.box(P, { pos: v3(p.x, p.y + 1.4, p.z), size: v3(11 * p.s, 2.6, 9 * p.s), colours: { all: '#8c8371' }, rot: v3(0, rot, 0) });
    const h = 8 + p.v * 9;
    S.cylinder(P, { pos: v3(p.x - 3.4 * p.s, p.y + h / 2 + 2, p.z - 2 * p.s), radius: 1.5, height: h, sides: 7, color: '#a4967c' });
    S.cylinder(P, { pos: v3(p.x + 3.4 * p.s, p.y + (h * 0.7) / 2 + 2, p.z + 2 * p.s), radius: 1.5, height: h * 0.7, sides: 7, color: '#9a8d74' });
    if (p.v > 0.6) {
      S.box(P, {
        pos: v3(p.x, p.y + h + 3.4, p.z), size: v3(10 * p.s, 1.8, 3.4), colours: { all: '#8f8370' }, rot: v3(0, rot, 0.06)
      });
    }
    void theme_;
  }

  function obelisk(P, p, theme_) {
    const h = 16 * p.s;
    S.box(P, {
      pos: v3(p.x, p.y + h / 2, p.z), size: v3(3.2 * p.s, h, 3.2 * p.s),
      colours: { top: '#e6d3a0', front: '#cdb987', side: '#b8a473', bottom: '#8f7f56' }, rot: v3(0, p.rot, 0)
    });
    S.box(P, {
      pos: v3(p.x, p.y + h + 1.6, p.z), size: v3(2.4 * p.s, 3.2, 2.4 * p.s),
      colours: { all: theme_.accent || '#f2c14e' }, rot: v3(0, p.rot, 0), glow: theme_.accent, glowAlpha: 0.25
    });
  }

  function bones(P, p) {
    S.cylinder(P, { pos: v3(p.x, p.y + 0.6, p.z), radius: 0.7 * p.s, height: 7 * p.s, sides: 5, color: '#e8e2cf', rot: v3(0, 0, Math.PI / 2 + (p.v - 0.5) * 0.5) });
    S.blob(P, { pos: v3(p.x + 3.4 * p.s, p.y + 0.9, p.z), radii: v3(1.6, 1.4, 1.4), slices: 5, rings: 2, color: '#efe9d6' });
  }

  function dragonbones(P, p, theme_) {
    for (let i = 0; i < 5; i++) {
      const a = p.rot + i * 0.42;
      S.cylinder(P, {
        pos: v3(p.x + Math.cos(a) * 6 * i * 0.5, p.y + 4 - i * 0.5, p.z + Math.sin(a) * 6 * i * 0.5),
        radius: 1.1 - i * 0.1, height: 3.4, sides: 4, color: '#cbbfa4', rot: v3(0.5, a, 0.4)
      });
    }
    S.blob(P, { pos: v3(p.x - 4, p.y + 2.4, p.z), radii: v3(3.2, 2.6, 3.4), slices: 6, rings: 3, color: '#d8cdb4', jitter: 0.15, seed: p.i });
    void theme_;
  }

  function spike(P, p, theme_) {
    const h = 8 + p.v * 14;
    S.cone(P, { pos: v3(p.x, p.y + h / 2, p.z), radius: 2.6 * p.s, height: h, sides: 5, color: Colour.mix('#3a2b2b', theme_.ground.rock, 0.4), yaw: p.rot, cap: false });
  }

  function floatingRock(P, p, t) {
    const bob = Math.sin(t * 0.8 + p.v * 8) * 2.2;
    const y = p.y + 26 + p.v * 22 + bob;
    S.blob(P, {
      pos: v3(p.x, y, p.z), radii: v3(4.6 * p.s, 3.6 * p.s, 4.4 * p.s),
      slices: 6, rings: 3, color: '#3f3560', jitter: 0.36, seed: p.i, glow: '#8a5cff', glowAlpha: 0.12
    });
    S.billboard(P, { pos: v3(p.x, y - 5, p.z), width: 7 * p.s, height: 7 * p.s, color: '#c46bff', alpha: 0.1, soft: true });
  }

  function wisp(P, p, t, theme_) {
    const bob = Math.sin(t * 1.3 + p.v * 9) * 2.4;
    const drift = Math.sin(t * 0.5 + p.i) * 5;
    S.billboard(P, {
      pos: v3(p.x + drift, p.y + 10 + bob, p.z), width: 3.4 * p.s, height: 3.4 * p.s,
      color: theme_.accent || '#9be36a', alpha: 0.7, soft: true
    });
  }

  function spirit(P, p, t) {
    const bob = Math.sin(t * 0.9 + p.v * 7) * 1.8;
    S.billboard(P, { pos: v3(p.x, p.y + 7 + bob, p.z), width: 4.4 * p.s, height: 5.6 * p.s, color: '#dff5b0', alpha: 0.32, soft: true });
  }

  function torch(P, p, t, theme_) {
    const flame = 0.7 + Math.sin(t * 7 + p.v * 12) * 0.3;
    S.cylinder(P, { pos: v3(p.x, p.y + 4, p.z), radius: 0.4, height: 8, sides: 5, color: '#4a3a26' });
    S.billboard(P, { pos: v3(p.x, p.y + 8.8, p.z), width: 2.2 * flame, height: 3.6 * flame, color: '#ffb347', alpha: 0.95, soft: true });
    S.billboard(P, { pos: v3(p.x, p.y + 8.4, p.z), width: 7.5, height: 7.5, color: '#ff9b3a', alpha: 0.3, soft: true });
    void theme_;
  }

  function brazier(P, p, t, theme_) {
    const colour = theme_.accent || '#ff7a3a';
    const flame = 0.75 + Math.sin(t * 8 + p.v * 14) * 0.25;
    S.cylinder(P, { pos: v3(p.x, p.y + 1.2, p.z), radius: 1.8, radiusTop: 2.4, height: 2.4, sides: 7, color: '#3c3a44' });
    S.cylinder(P, { pos: v3(p.x, p.y + 0.3, p.z), radius: 2.6, radiusTop: 1.6, height: 0.6, sides: 7, color: '#2e2c34' });
    S.billboard(P, { pos: v3(p.x, p.y + 4.6 * flame, p.z), width: 4 * flame, height: 6 * flame, color: '#ff8a3a', alpha: 0.95, soft: true });
    S.billboard(P, { pos: v3(p.x, p.y + 4.4, p.z), width: 16, height: 16, color: colour, alpha: 0.22, soft: true });
  }

  function house(P, p, t, theme_) {
    const w = 16 * p.s, d = 13 * p.s, h = 10 * p.s;
    const wall = Colour.mix('#cbb894', '#9c8a6a', p.v * 0.6);
    S.box(P, { pos: v3(p.x, p.y + h / 2, p.z), size: v3(w, h, d), colours: { front: wall, back: wall, left: wall, right: wall, top: '#8a7a5e', bottom: '#5f5544' }, rot: v3(0, p.rot, 0) });
    // roof: two slanted slabs
    S.box(P, { pos: v3(p.x, p.y + h + 3.4 * p.s, p.z), size: v3(w * 1.12, 1.6, d * 0.62), colours: { all: '#8a3f2c' }, rot: v3(0, p.rot, 0) });
    S.box(P, { pos: v3(p.x - w * 0.28 * Math.cos(p.rot), p.y + h + 1.9 * p.s, p.z + w * 0.28 * Math.sin(p.rot)), size: v3(w * 0.62, 1.4, d * 1.1), colours: { all: '#7a3726' }, rot: v3(0, p.rot, 0.5) });
    S.box(P, { pos: v3(p.x + w * 0.28 * Math.cos(p.rot), p.y + h + 1.9 * p.s, p.z - w * 0.28 * Math.sin(p.rot)), size: v3(w * 0.62, 1.4, d * 1.1), colours: { all: '#7a3726' }, rot: v3(0, p.rot, -0.5) });
    // door + windows (warm at night)
    const litAlpha = P.light && P.light.night ? 0.95 : 0.4;
    S.box(P, { pos: v3(p.x + Math.sin(p.rot) * d * 0.52, p.y + 3.4 * p.s, p.z + Math.cos(p.rot) * d * 0.52), size: v3(4 * p.s, 6.4 * p.s, 0.6), colours: { all: '#4a3524' }, rot: v3(0, p.rot, 0) });
    S.billboard(P, { pos: v3(p.x - Math.cos(p.rot) * w * 0.3 + Math.sin(p.rot) * d * 0.53, p.y + 6.4 * p.s, p.z + Math.sin(p.rot) * w * 0.3 * 0.2 + Math.cos(p.rot) * d * 0.53), width: 2.6 * p.s, height: 2.6 * p.s, color: '#ffcb6a', alpha: litAlpha, soft: true });
    // chimney
    S.box(P, { pos: v3(p.x - 4 * p.s, p.y + h + 6 * p.s, p.z - 3 * p.s), size: v3(2.6 * p.s, 5 * p.s, 2.6 * p.s), colours: { all: '#7d7466' } });
    void t;
  }

  function well(P, p) {
    S.cylinder(P, { pos: v3(p.x, p.y + 2.4, p.z), radius: 3.4, radiusTop: 3.4, height: 4.8, sides: 8, color: '#8d8474' });
    S.cylinder(P, { pos: v3(p.x, p.y + 5, p.z), radius: 2.4, height: 0.5, sides: 8, color: '#2a2f3a' });
    S.cylinder(P, { pos: v3(p.x - 3, p.y + 8, p.z), radius: 0.4, height: 7, sides: 4, color: '#5a4026' });
    S.cylinder(P, { pos: v3(p.x + 3, p.y + 8, p.z), radius: 0.4, height: 7, sides: 4, color: '#5a4026' });
    S.box(P, { pos: v3(p.x, p.y + 11.6, p.z), size: v3(9, 1.4, 5.4), colours: { all: '#7a3726' }, rot: v3(0, 0.2, 0) });
  }

  function fence(P, p) {
    for (let i = 0; i < 3; i++) {
      const x = p.x + i * 5 * Math.cos(p.rot);
      const z = p.z + i * 5 * Math.sin(p.rot);
      S.cylinder(P, { pos: v3(x, p.y + 2.4, z), radius: 0.4, height: 4.8, sides: 4, color: '#6b5233' });
    }
    S.box(P, { pos: v3(p.x + 5 * Math.cos(p.rot), p.y + 4, p.z + 5 * Math.sin(p.rot)), size: v3(12, 0.5, 0.5), colours: { all: '#7a5f3c' }, rot: v3(0, p.rot, 0) });
    void p.v;
  }

  function watchtower(P, p) {
    const h = 46 * p.s;
    S.cylinder(P, { pos: v3(p.x, p.y + h / 2, p.z), radius: 7 * p.s, radiusTop: 6 * p.s, height: h, sides: 8, color: '#9a9384' });
    S.cylinder(P, { pos: v3(p.x, p.y + h + 2.4, p.z), radius: 8.4 * p.s, radiusTop: 8.4 * p.s, height: 4.6, sides: 8, color: '#89826f' });
    S.cone(P, { pos: v3(p.x, p.y + h + 11, p.z), radius: 9.4 * p.s, height: 12, sides: 8, color: '#6b3a2c' });
    S.box(P, { pos: v3(p.x, p.y + h * 0.62, p.z), size: v3(2.2, 3.2, 0.6), colours: { all: '#4a3a2a' }, rot: v3(0, p.rot, 0) });
  }

  function fortress(P, p, theme_) {
    const base = p.y;
    S.box(P, { pos: v3(p.x, base + 16, p.z), size: v3(64, 32, 40), colours: { front: '#4a3a3c', back: '#3f3032', side: '#443436', top: '#2f2426', bottom: '#1f1819' }, rot: v3(0, p.rot, 0) });
    for (let i = 0; i < 4; i++) {
      const a = p.rot + Math.PI / 4 + i * Math.PI / 2;
      const tx = p.x + Math.cos(a) * 36, tz = p.z + Math.sin(a) * 26;
      S.cylinder(P, { pos: v3(tx, base + 26, tz), radius: 8, radiusTop: 7, height: 52, sides: 8, color: '#3d2f31' });
      S.cone(P, { pos: v3(tx, base + 56, tz), radius: 8.4, height: 14, sides: 8, color: theme_.accent || '#ff5f3a' });
      S.billboard(P, { pos: v3(tx, base + 62, tz), width: 5, height: 8, color: theme_.accent || '#ff5f3a', alpha: 0.25, soft: true });
    }
    S.box(P, { pos: v3(p.x, base + 38, p.z), size: v3(26, 16, 24), colours: { all: '#463537' }, rot: v3(0, p.rot, 0) });
    S.box(P, { pos: v3(p.x, base + 48, p.z), size: v3(6, 6, 6), colours: { all: '#2a1f21' } });
    for (let i = 0; i < 6; i++) {
      S.billboard(P, {
        pos: v3(p.x + Math.cos(p.rot) * (i * 8 - 20), base + 26, p.z + Math.sin(p.rot) * (i * 8 - 20)),
        width: 3.4, height: 7.4, color: '#b81432', alpha: 0.85
      });
    }
  }

  function obeliskBig(P, p, theme_) {
    const h = 54 * p.s;
    S.box(P, { pos: v3(p.x, p.y + h / 2, p.z), size: v3(9, h, 9), colours: { front: '#e6d3a0', side: '#c9b483', top: '#f0e2b8', bottom: '#8f7f56' }, rot: v3(0, p.rot, 0) });
    S.cone(P, { pos: v3(p.x, p.y + h + 5, p.z), radius: 6, height: 10, sides: 4, color: theme_.accent || '#f2c14e', yaw: p.rot + 0.8, glow: theme_.accent, glowAlpha: 0.3 });
  }

  function spire(P, p, theme_) {
    S.cylinder(P, { pos: v3(p.x, p.y + 40, p.z), radius: 16, radiusTop: 7, height: 80, sides: 9, color: '#3f2b5c' });
    S.cone(P, { pos: v3(p.x, p.y + 92, p.z), radius: 10, height: 26, sides: 9, color: theme_.accent || '#ffd76a', glow: theme_.accent, glowAlpha: 0.35 });
    for (let i = 0; i < 5; i++) {
      S.box(P, {
        pos: v3(p.x + Math.cos(i * 1.4) * 22, p.y + 24 + i * 12, p.z + Math.sin(i * 1.4) * 22),
        size: v3(10, 3, 6), colours: { all: '#4a3568' }, rot: v3(0, i * 1.4, 0.2)
      });
    }
  }

  function caveMouth(P, p) {
    S.blob(P, { pos: v3(p.x, p.y + 8, p.z), radii: v3(26, 18, 20), slices: 7, rings: 3, color: '#5b6068', jitter: 0.3, seed: 5 });
    S.blob(P, { pos: v3(p.x + 8, p.y + 4, p.z + 4), radii: v3(10, 8, 9), slices: 6, rings: 3, color: '#4a5058', jitter: 0.3, seed: 8 });
    S.billboard(P, { pos: v3(p.x - 2, p.y + 7, p.z - 10), width: 14, height: 16, color: '#05070c', alpha: 0.92 });
    S.billboard(P, { pos: v3(p.x - 2, p.y + 7, p.z - 12), width: 22, height: 22, color: '#8fe3ff', alpha: 0.12, soft: true });
  }

  function gate(P, p, theme_) {
    const accent = (theme_ && theme_.accent) || '#8fe3ff';
    S.box(P, { pos: v3(p.x - 7, p.y + 8, p.z), size: v3(6, 16, 8), colours: { all: '#5c5c66' } });
    S.box(P, { pos: v3(p.x + 7, p.y + 8, p.z), size: v3(6, 16, 8), colours: { all: '#5c5c66' } });
    S.box(P, { pos: v3(p.x, p.y + 18, p.z), size: v3(20, 4, 8), colours: { all: '#4f4f59' } });
    S.box(P, { pos: v3(p.x, p.y + 6, p.z), size: v3(12, 12, 1.2), colours: { all: '#20161f' } });
    S.billboard(P, { pos: v3(p.x, p.y + 6.5, p.z + 1.4), width: 10, height: 10, color: accent, alpha: 0.16, soft: true });
    for (let i = 0; i < 3; i++) {
      S.billboard(P, { pos: v3(p.x - 4 + i * 4, p.y + 19.6, p.z), width: 1.6, height: 1.6, color: accent, alpha: 0.7, soft: true });
    }
  }

  function arenaRing(P, p) {
    const cx = p.x, cz = p.z;
    S.cylinder(P, { pos: v3(cx, -1.6, cz), radius: 320, height: 3.2, sides: 26, color: '#b0a58c' });
    S.ring(P, { x: cx, z: cz, radius: 318, thickness: 10, y: 1.6, color: '#e2d3a8', alpha: 0.35, squash: 1 });
    for (let i = 0; i < 3; i++) {
      S.ring(P, { x: cx, z: cz, radius: 120 + i * 70, thickness: 3, y: 0.9, color: '#cbbb90', alpha: 0.18 });
    }
  }

  /* ============================================================
   * 5. WORLD OBJECT
   * ========================================================== */
  function createWorld(themeId) {
    const theme_ = typeof themeId === 'string' ? theme(themeId) : (themeId || THEMES.hub);
    const heightAt = makeHeightField(theme_);
    const materialAt = makeMaterials(theme_);
    const built = buildProps(theme_);
    const props = built.props;
    const detail = built.detail;
    const terrain = { buckets: [] };
    for (let b = 0; b < 40; b++) terrain.buckets.push([]);
    const weather3d = { particles: [], splashes: [], flash: 0, wind: 0.4, lastKind: null };
    /** Ambient life: fireflies after dark, drifting leaves / dust motes by day. */
    const ambient = { built: false, fireflies: [], motes: [] };
    function ensureAmbient() {
      if (ambient.built) return;
      ambient.built = true;
      for (let i = 0; i < 34; i++) {
        ambient.fireflies.push({
          x: 480 + (Math.random() - 0.5) * 900, z: 400 + (Math.random() - 0.5) * 700,
          y: 4 + Math.random() * 16, ph: Math.random() * TAU, sp: 0.5 + Math.random()
        });
      }
      for (let i = 0; i < 40; i++) {
        ambient.motes.push({
          x: 480 + (Math.random() - 0.5) * 950, z: 400 + (Math.random() - 0.5) * 760,
          y: 6 + Math.random() * 30, ph: Math.random() * TAU, sp: 0.4 + Math.random() * 0.8,
          s: 0.6 + Math.random() * 0.9
        });
      }
    }

    function updateAmbient(dt, time) {
      ensureAmbient();
      const night = !!(P_lightRef && P_lightRef.night);
      const list = night ? ambient.fireflies : ambient.motes;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        p.ph += dt * (night ? 1.6 : 0.5) * p.sp;
        if (night) {
          p.x += Math.sin(p.ph * 0.7) * 5 * dt;
          p.z += Math.cos(p.ph * 0.9) * 5 * dt;
          p.y += Math.sin(p.ph * 1.3) * 3 * dt;
        } else {
          p.x += (8 + weather3d.wind * 14) * dt * p.sp;         // blown along the wind
          p.y += Math.sin(p.ph) * 2.4 * dt;
          if (p.x > 960) p.x = -60;
        }
      }
      void time;
    }

    /** Light reference for ambient systems (set at the start of each frame). */
    let P_lightRef = null;

    function drawAmbient(P) {
      ensureAmbient();
      const night = !!(P.light && P.light.night);
      const list = night ? ambient.fireflies : ambient.motes;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const groundY = heightAt(p.x, p.z);
        const y = groundY + (night ? p.y : p.y + 14);
        const flick = 0.55 + 0.45 * Math.sin(p.ph * 2.2);
        if (night) {
          S.billboard(P, { pos: v3(p.x, y, p.z), width: 3.2, height: 3.2, color: '#ffe98a', alpha: 0.5 * flick + 0.15, soft: true, blend: 'lighter' });
          S.billboard(P, { pos: v3(p.x, y, p.z), width: 8, height: 8, color: '#c9ff7a', alpha: 0.12 * flick, soft: true, blend: 'lighter' });
        } else {
          const colour = theme_.props && (theme_.props.water === 'swamp' || theme_.id === 'chapter2') ? '#9fd06a' : '#d9c98a';
          S.billboard(P, { pos: v3(p.x, y, p.z), width: 1.8 * p.s, height: 1.8 * p.s, color: colour, alpha: 0.42, soft: true });
        }
      }
    }

    // precompute the static terrain quads (positions + colour), grouped for culling
    const quads = [];
    for (let x = WORLD_EXT.minX; x < WORLD_EXT.maxX; x += CELL) {
      for (let z = WORLD_EXT.minZ; z < WORLD_EXT.maxZ; z += CELL) {
        const x1 = x + CELL, z1 = z + CELL;
        const h00 = heightAt(x, z), h10 = heightAt(x1, z), h01 = heightAt(x, z1), h11 = heightAt(x1, z1);
        const cx = (x + x1) / 2, cz = (z + z1) / 2;
        const ch = (h00 + h10 + h01 + h11) / 4;
        const depth = waterDepth(cx, cz, theme_);
        const isWater = depth > 0.05 && ch < 14;
        const colour = isWater ? null : materialAt(cx, cz, ch);
        quads.push({
          x: x, z: z, x1: x1, z1: z1,
          y00: h00, y10: h10, y01: h01, y11: h11,
          cx: cx, cz: cz, ch: ch,
          colour: colour,
          water: isWater ? depth : 0
        });
      }
    }

    // coarse mesh for the far field: a quarter of the quads for the same silhouette
    const quadsFar = (function buildFarMesh() {
      const out = [];
      const BIG = CELL * 2;
      for (let x = WORLD_EXT.minX; x < WORLD_EXT.maxX; x += BIG) {
        for (let z = WORLD_EXT.minZ; z < WORLD_EXT.maxZ; z += BIG) {
          const x1 = x + BIG, z1 = z + BIG;
          const h00 = heightAt(x, z), h10 = heightAt(x1, z), h01 = heightAt(x, z1), h11 = heightAt(x1, z1);
          const cx = (x + x1) / 2, cz = (z + z1) / 2;
          const ch = (h00 + h10 + h01 + h11) / 4;
          const depth = waterDepth(cx, cz, theme_);
          const isWater = depth > 0.05 && ch < 14;
          out.push({
            x: x, z: z, x1: x1, z1: z1,
            y00: h00, y10: h10, y01: h01, y11: h11,
            cx: cx, cz: cz, ch: ch,
            colour: isWater ? null : materialAt(cx, cz, ch),
            water: isWater ? depth : 0
          });
        }
      }
      return out;
    })();

    function drawTerrain(P, time, cam) {
      const farPlane = 1500;
      const nearRange = 430;            // beyond this the coarse mesh takes over
      drawMesh(P, time, cam, quads, 0, nearRange);
      drawMesh(P, time, cam, quadsFar, nearRange, farPlane);
    }

    function drawMesh(P, time, cam, mesh, minDist, maxDist) {
      P.tag && P.tag('terrain');
      const bucketSize = 40;
      const buckets = terrain.buckets;
      for (let i = 0; i < buckets.length; i++) buckets[i].length = 0;
      const eye = cam.state.eye;
      const vp = P.vp;
      const forward = cam.state.basis.forward;
      const min2 = minDist * minDist, max2 = maxDist * maxDist;
      for (let i = 0; i < mesh.length; i++) {
        const q = mesh[i];
        const dx = q.cx - eye.x, dz = q.cz - eye.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > max2 || d2 < min2) continue;
        // cheap behind-camera rejection before the (more expensive) projection
        const depth = dx * forward.x + (q.ch - eye.y) * forward.y + dz * forward.z;
        if (depth < 6) continue;
        const s = cam.projectInto(SCRATCH[4], v3(q.cx, q.ch, q.cz), vp);
        if (!s.visible) continue;
        // Screen-space cull for the far field only. Near cells are heavily
        // foreshortened — their centre projects small while their corners cover
        // the whole screen bottom, so a centre-based radius test punched
        // sky-through holes in the floor. The near ring is a few dozen quads, so
        // it is simply always drawn; distant cells use a radius scaled by the
        // quad's projected size.
        if (d2 > 300 * 300) {
          const rpx = s.scale * (CELL * 0.8 + OVERLAP) + 8;
          if (s.x + rpx < -32 || s.x - rpx > vp.width + 32 || s.y + rpx < -32 || s.y - rpx > vp.height + 32) continue;
        }
        const b = Math.min(buckets.length - 1, Math.floor(Math.sqrt(d2) / bucketSize));
        buckets[b].push(q);
      }
      for (let b = buckets.length - 1; b >= 0; b--) {          // far → near
        const list = buckets[b];
        for (let i = 0; i < list.length; i++) drawQuad(P, list[i], time);
      }
    }

    const tmpPts = [v3(), v3(), v3(), v3()];
    const OVERLAP = 1.2;                  // hide antialiasing seams between cells
    const SCRATCH = [{ x: 0, y: 0, depth: 0, scale: 0, focal: 0, visible: false },
      { x: 0, y: 0, depth: 0, scale: 0, focal: 0, visible: false },
      { x: 0, y: 0, depth: 0, scale: 0, focal: 0, visible: false },
      { x: 0, y: 0, depth: 0, scale: 0, focal: 0, visible: false },
      { x: 0, y: 0, depth: 0, scale: 0, focal: 0, visible: false }];

    function drawQuad(P, q, time) {
      tmpPts[0].x = q.x - OVERLAP; tmpPts[0].y = q.y00; tmpPts[0].z = q.z - OVERLAP;
      tmpPts[1].x = q.x1 + OVERLAP; tmpPts[1].y = q.y10; tmpPts[1].z = q.z - OVERLAP;
      tmpPts[2].x = q.x1 + OVERLAP; tmpPts[2].y = q.y11; tmpPts[2].z = q.z1 + OVERLAP;
      tmpPts[3].x = q.x - OVERLAP; tmpPts[3].y = q.y01; tmpPts[3].z = q.z1 + OVERLAP;

      // smooth analytic normal from the cell's height gradient (shared edges →
      // neighbouring cells shade continuously, so no diagonal banding)
      const dHdx = ((q.y10 + q.y11) - (q.y00 + q.y01)) * 0.5 / CELL;
      const dHdz = ((q.y01 + q.y11) - (q.y00 + q.y10)) * 0.5 / CELL;
      const nl = Math.sqrt(dHdx * dHdx + 1 + dHdz * dHdz);
      const normal = { x: -dHdx / nl, y: 1 / nl, z: -dHdz / nl };

      if (q.water > 0.05) {
        drawWaterQuad(P, q, time, normal);
        return;
      }
      const base = q.rgb || (q.rgb = Colour.toRgb(q.colour));
      const amount = P.lightAmount(normal, {});
      // subtle per-quad variation keeps large fields from looking flat
      const v = q.shade || (q.shade = 0.975 + Noise.value(q.cx / 130, q.cz / 130, 31) * 0.05);
      const rgb = { r: base.r * amount * v, g: base.g * amount * v, b: base.b * amount * v };
      if (P.state.wedgeDebug && base.r + base.g + base.b > 470) {
        rgb.r = 255; rgb.g = 0; rgb.b = 255;      // dev: flag suspiciously pale quads
      }
      const eye = P.cam.state.eye;
      const dx = q.cx - eye.x, dz = q.cz - eye.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const pts = SCRATCH;
      for (let i = 0; i < 4; i++) {
        if (!P.cam.projectInto(pts[i], tmpPts[i], P.vp).visible) return;
      }
      P.polyScreen(pts, { fill: Colour.css(P.fogMix(rgb, dist)) });
      P.state.stats.polys++;
    }

    /** Still-water surface height for this theme (the carved channel level). */
    function waterSurface() {
      const type = theme_.props && theme_.props.water;
      const bed = type === 'lake' || type === 'frozen' ? 9 : type === 'swamp' ? 2 : type === 'pond' ? 7 : 5;
      return bed - 2.4;
    }

    function drawWaterQuad(P, q, time, normal) {
      const w = q.water;
      const dist = M.v3dist(P.cam.state.eye, v3(q.cx, q.ch, q.cz));
      const themeWater = theme_.id === 'chapter6' ? '#3f4a2a' : theme_.id === 'chapter8' ? '#ff6a2a'
        : theme_.id === 'chapter4' ? '#cfeaf7' : theme_.id === 'chapter3' ? '#1d2a3a' : '#2f5f8a';
      const shimmer = 0.5 + 0.5 * Math.sin(time * 1.7 + q.cx * 0.05 + q.cz * 0.07);
      // a flat water plane with a gentle swell — banks rise out of it naturally
      const level = waterSurface();
      const y = level + Math.sin(time * 0.9 + q.cx * 0.02) * 0.16;
      const base = Colour.toRgb(Colour.mix(themeWater, theme_.skyBottom, 0.22 + shimmer * 0.18));
      const sun = Colour.toRgb(P.light.sun);
      const spec = Math.pow(shimmer, 3) * 0.5 * (theme_.id === 'chapter8' ? 1.4 : 1);
      const rgb = {
        r: base.r * (0.75 + shimmer * 0.2) + sun.r * spec,
        g: base.g * (0.75 + shimmer * 0.2) + sun.g * spec,
        b: base.b * (0.75 + shimmer * 0.25) + sun.b * spec
      };
      // shoreline foam: cells that are barely submerged read as a pale rim
      if (w < 0.3) {
        const foam = clamp(1 - w / 0.3, 0, 1) * 0.55;
        const shore = Colour.toRgb('#eaf6ff');
        rgb.r = lerp(rgb.r, shore.r, foam);
        rgb.g = lerp(rgb.g, shore.g, foam);
        rgb.b = lerp(rgb.b, shore.b, foam);
      }
      const pts = SCRATCH;
      for (let i = 0; i < 4; i++) {
        tmpPts[i].y = y;
        if (!P.cam.projectInto(pts[i], tmpPts[i], P.vp).visible) return;
      }
      P.polyScreen(pts, { fill: Colour.css(P.fogMix(rgb, dist)), alpha: 0.92 });
      if (w > 0.4 && shimmer > 0.72) {
        P.polyScreen(pts, { fill: 'rgba(255,255,255,0.05)' });
      }
      P.state.stats.polys++;
    }

    /* ---------- sky, horizon, weather ---------- */
    const skyCache = {};
    function drawSky(P, light, time) {
      const ctx = P.ctx;
      const vp = P.vp;
      const c = ctx;
      const top = light.skyTop, bottom = light.skyBottom;
      // cached sky gradient (rebuilt only when the palette actually changes)
      if (!skyCache.gradient || skyCache.top !== top || skyCache.bottom !== bottom || skyCache.width !== vp.width || skyCache.height !== vp.height) {
        const g = c.createLinearGradient(0, 0, 0, vp.height * 0.86);
        g.addColorStop(0, top);
        g.addColorStop(0.55, Colour.mix(top, bottom, 0.7));
        g.addColorStop(1, bottom);
        skyCache.gradient = g;
        skyCache.top = top;
        skyCache.bottom = bottom;
        skyCache.width = vp.width;
        skyCache.height = vp.height;
      }
      c.save();
      c.fillStyle = skyCache.gradient;
      c.fillRect(0, 0, vp.width, vp.height);
      c.restore();

      // stars at night
      if (light.night) {
        const starAlpha = clamp(light.dayAmount * -1 + 0.85, 0.25, 0.9);
        c.save();
        for (let i = 0; i < 90; i++) {
          const sx = ((i * 7919) % 1000) / 1000 * vp.width;
          const sy = ((i * 104729) % 1000) / 1000 * vp.height * 0.6;
          const tw = 0.5 + 0.5 * Math.sin(time * 1.4 + i);
          c.globalAlpha = starAlpha * (0.25 + tw * 0.6);
          c.fillStyle = i % 7 === 0 ? '#ffe9b0' : '#e8f0ff';
          c.fillRect(sx, sy, i % 5 === 0 ? 2 : 1.4, i % 5 === 0 ? 2 : 1.4);
        }
        c.restore();
      }

      // sun / moon disc + bloom, drawn at its projected direction
      const sunWorld = v3(P.cam.state.eye.x + light.dir.x * 1800, P.cam.state.eye.y + light.dir.y * 1800, P.cam.state.eye.z + light.dir.z * 1800);
      const sp = P.cam.project(sunWorld, vp);
      const disc = light.night ? '#dbe6ff' : '#fff6d8';
      if (sp.visible) {
        P.radial(sp.x, sp.y, vp.height * (light.night ? 0.24 : 0.5), light.night ? '#9dc0ff' : (light.dusk > 0.4 ? '#ff9b52' : '#ffe9b0'), light.night ? 0.35 : 0.5);
        c.save();
        c.fillStyle = disc;
        c.beginPath();
        c.arc(sp.x, sp.y, vp.height * (light.night ? 0.022 : 0.03), 0, TAU);
        c.fill();
        c.restore();
      }

      // clouds — soft billboards on a high plane, drifting with the wind
      if (root.__MM_NO_CLOUDS__) return;
      const cloudColour = light.night ? '#2a3358' : (light.dusk > 0.35 ? '#ffb98a' : '#ffffff');
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU + time * 0.012 * (0.6 + (i % 3) * 0.2);
        const r = 900 + (i % 4) * 320;
        const cx = 480 + Math.cos(a) * r;
        const cz = 400 + Math.sin(a) * r - 200;
        const cy = 200 + (i % 5) * 34 + Math.sin(time * 0.18 + i) * 6;
        const s = P.cam.project(v3(cx, cy, cz), vp);
        if (!s.visible) continue;
        const size = clamp(s.scale * 90, 20, 260);
        P.glowBlit(s.x, s.y, size, cloudColour, (light.night ? 0.22 : 0.4) * 0.9, 'source-over');
      }
    }

    /** Distant mountain ranges — screen-space silhouettes that parallax with yaw. */
    function drawHorizon(P, light, time) {
      const ctx = P.ctx;
      const vp = P.vp;
      const base = Colour.mix(light.skyBottom, '#0d1020', light.night ? 0.72 : 0.42);
      const far = Colour.mix(base, light.skyTop, 0.35);
      const offset = (P.cam.yaw / TAU) * vp.width * 2.2;
      const layers = [
        { colour: far, height: 0.2, seed: 3, speed: 0.6, y: 0.62 },
        { colour: base, height: 0.14, seed: 11, speed: 1, y: 0.655 }
      ];
      layers.forEach(function (layer) {
        ctx.save();
        ctx.fillStyle = Colour.css(Colour.toRgb(layer.colour));
        ctx.beginPath();
        ctx.moveTo(-10, vp.height * layer.y + 40);
        const step = 90;
        for (let x = -10; x <= vp.width + step; x += step) {
          const wx = x + (offset * layer.speed) % (step * 2);
          const n = Noise.fbm(wx / 260, layer.seed * 7, layer.seed, 3);
          const peak = vp.height * layer.y - n * vp.height * layer.height - Math.sin(x / 180) * 6;
          ctx.lineTo(x + 4, peak);
        }
        ctx.lineTo(vp.width + 10, vp.height * layer.y + 40);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
      void time;
    }

    /* ---------- weather ---------- */
    function ensureWeather(kind, count) {
      if (weather3d.lastKind !== kind) {
        weather3d.lastKind = kind;
        weather3d.particles.length = 0;
        for (let i = 0; i < count; i++) {
          weather3d.particles.push({
            x: Math.random() * 1900 - 480,
            y: Math.random() * 260,
            z: Math.random() * 1500 - 560,
            v: 0.6 + Math.random() * 0.8,
            s: 0.5 + Math.random(),
            ph: Math.random() * TAU
          });
        }
      }
    }

    function updateWeather(dt, time) {
      const kind = theme_.weather;
      if (weather3d.flash > 0) weather3d.flash = Math.max(0, weather3d.flash - dt * 2.2);
      if (kind === 'clear' || !kind) return;
      weather3d.wind = 0.35 + Math.sin(time * 0.12) * 0.25;
      const list = weather3d.particles;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const fall = (kind === 'snow' ? 8 : kind === 'ash' ? 9 : kind === 'ember' ? 12 : kind === 'sand' ? 4 : 34) * p.v;
        p.y -= fall * dt;
        p.x += (kind === 'sand' || kind === 'ash' ? 26 : 12) * weather3d.wind * dt * p.v;
        p.z += Math.cos(time * 0.7 + p.ph) * 2 * dt;
        if (p.y < -8) {
          p.y = 190 + Math.random() * 80;
          p.x = 480 + (Math.random() - 0.5) * 1900;
          p.z = 400 + (Math.random() - 0.5) * 1500;
        }
      }
      if (kind === 'storm' && Math.random() < dt * 0.22) weather3d.flash = 1;
    }

    function drawWeather(P, dt, time) {
      const kind = theme_.weather;
      if (!kind || kind === 'clear') return;
      const ctx = P.ctx;
      const vp = P.vp;
      const counts = { rain: 420, snow: 300, ash: 260, sand: 200, spores: 160, fog: 0, drip: 160, ember: 220, void: 180, storm: 460 };
      ensureWeather(kind, counts[kind] || 160);

      if (kind === 'fog') {
        ctx.save();
        const g = ctx.createLinearGradient(0, vp.height * 0.35, 0, vp.height);
        const fogColour = Colour.toRgb(P.light.fog);
        g.addColorStop(0, Colour.css(fogColour, 0));
        g.addColorStop(0.5, Colour.css(fogColour, 0.35));
        g.addColorStop(1, Colour.css(fogColour, 0.6));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, vp.width, vp.height);
        for (let i = 0; i < 7; i++) {
          const x = ((i * 137 + time * 8 * (1 + i % 3)) % (vp.width + 420)) - 210;
          const y = vp.height * (0.42 + (i % 4) * 0.12);
          P.radial(x, y, 190 + (i % 3) * 60, P.light.fog, 0.16);
        }
        ctx.restore();
      }

      if (kind === 'rain' || kind === 'storm') {
        ctx.save();
        ctx.strokeStyle = 'rgba(190,215,240,0.5)';
        ctx.lineWidth = 1.4;
        for (let i = 0; i < weather3d.particles.length; i++) {
          const p = weather3d.particles[i];
          const s = P.cam.project(v3(p.x, p.y, p.z), vp);
          if (!s.visible) continue;
          const len = clamp(s.scale * 26, 8, 46);
          ctx.globalAlpha = 0.28 + p.s * 0.3;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x + len * 0.18, s.y + len);
          ctx.stroke();
        }
        ctx.restore();
      }

      const colourFor = {
        snow: '#ffffff', ash: '#c9c2bb', sand: '#e8cf9a', spores: '#c9f0a0',
        ember: '#ff9b4a', void: '#c46bff', drip: '#9fd7ff'
      };
      const soft = kind === 'snow' || kind === 'spores' || kind === 'void' || kind === 'ember' || kind === 'drip';
      const colour = colourFor[kind];
      if (colour) {
        for (let i = 0; i < weather3d.particles.length; i++) {
          const p = weather3d.particles[i];
          const s = P.cam.project(v3(p.x, p.y, p.z), vp);
          if (!s.visible) continue;
          const size = clamp(s.scale * (kind === 'snow' ? 2.4 : kind === 'ember' ? 1.8 : 2.0) * p.s, 0.6, 8);
          if (kind === 'snow') {
            ctx.save();
            ctx.globalAlpha = 0.75;
            ctx.fillStyle = colour;
            ctx.beginPath();
            ctx.arc(s.x, s.y, size, 0, TAU);
            ctx.fill();
            ctx.restore();
          } else if (kind === 'sand') {
            ctx.save();
            ctx.globalAlpha = 0.3;
            ctx.strokeStyle = colour;
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(s.x + size * 6, s.y + size * 0.6);
            ctx.stroke();
            ctx.restore();
          } else {
            if (soft) P.radial(s.x, s.y, size * 3.4, colour, kind === 'spores' ? 0.35 : 0.5);
            else {
              ctx.save();
              ctx.globalAlpha = 0.8;
              ctx.fillStyle = colour;
              ctx.fillRect(s.x, s.y, size, size);
              ctx.restore();
            }
          }
        }
      }

      if (kind === 'storm' && weather3d.flash > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = weather3d.flash * 0.5;
        ctx.fillStyle = '#cfe0ff';
        ctx.fillRect(0, 0, vp.width, vp.height);
        ctx.restore();
      }
    }

    /** Post pass: colour grade, vignette, cave ceiling, under-canvas grain. */
    function drawPost(P, light, time) {
      const ctx = P.ctx;
      const vp = P.vp;
      // colour grade
      if (theme_.grade) {
        ctx.save();
        ctx.globalCompositeOperation = theme_.grade.blend || 'overlay';
        ctx.globalAlpha = theme_.grade.alpha || 0.14;
        ctx.fillStyle = theme_.grade.colour;
        ctx.fillRect(0, 0, vp.width, vp.height);
        ctx.restore();
      }
      if (light.night) {
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = '#0a1030';
        ctx.fillRect(0, 0, vp.width, vp.height);
        ctx.restore();
      }
      // cave ceiling
      if (theme_.ceiling) {
        ctx.save();
        const g = ctx.createLinearGradient(0, 0, 0, vp.height * 0.42);
        g.addColorStop(0, 'rgba(6,8,14,0.98)');
        g.addColorStop(0.6, 'rgba(10,13,20,0.72)');
        g.addColorStop(1, 'rgba(10,13,20,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, vp.width, vp.height * 0.44);
        for (let i = 0; i < 14; i++) {
          const x = (i / 14) * vp.width + Math.sin(time * 0.3 + i) * 6;
          const h = 40 + ((i * 97) % 60);
          ctx.fillStyle = 'rgba(5,7,12,0.95)';
          ctx.beginPath();
          ctx.moveTo(x - 26, 0);
          ctx.lineTo(x, h);
          ctx.lineTo(x + 26, 0);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
      // vignette
      const vg = ctx.createRadialGradient(vp.width / 2, vp.height * 0.52, vp.height * 0.3, vp.width / 2, vp.height * 0.52, vp.height * 0.95);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(4,5,12,0.55)');
      ctx.save();
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, vp.width, vp.height);
      ctx.restore();
    }

    /* ---------- props ---------- */
    /**
     * Small village/road furniture is only worth drawing up close: it is tiny
     * on screen but expensive per instance. Kept in one list so the far field
     * stays cheap no matter how much decoration the village has.
     */
    const NEAR_ONLY = {
      fence: 1, lantern: 1, signpost: 1, market: 1, npc: 1, plaza: 1, well: 1, safeZone: 1,
      bones: 1, gravestone: 1, stalagmite: 1, mushroom: 1, reed: 1, spike: 1, iceShard: 1, bush: 1
    };

    /**
     * Density LOD: distant scenery is thinned with a stable per-prop hash, so
     * the far field costs a fraction of the near field and nothing pops between
     * frames (the same props are always the ones dropped).
     */
    const DENSITY_LOD = {
      'tree:broadleaf': 1, 'tree:conifer': 1, 'tree:giant': 1, 'tree:dead': 1, 'tree:void': 1,
      rock: 1, rockBig: 1, bush: 1, ruin: 1, gravestone: 1, stalagmite: 1, crystal: 1, iceShard: 1,
      pillar: 1, spike: 1, reed: 1, mushroom: 1, bones: 1
    };

    function keepProp(p, dist, detailLevel) {
      if (!DENSITY_LOD[p.type]) return true;
      if (dist < 560) return true;
      const keep = dist < 950 ? (detailLevel >= 3 ? 0.62 : detailLevel === 2 ? 0.45 : 0.3)
        : (detailLevel >= 3 ? 0.34 : detailLevel === 2 ? 0.22 : 0.12);
      return Noise.value(p.x * 0.37 + p.z * 0.11, p.z * 0.29, 1234) < keep;
    }

    function drawProps(P, time, cam, maxDist, nearDist, detailLevel) {
      P.tag && P.tag('props');
      const eye = cam.state.eye;
      const far = maxDist || 1700;
      const near = nearDist || far;
      const far2 = far * far, near2 = near * near;
      const lod = detailLevel === undefined ? 3 : detailLevel;
      for (let i = 0; i < props.length; i++) {
        const p = props[i];
        const dx = p.x - eye.x, dz = p.z - eye.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > (NEAR_ONLY[p.type] ? near2 : far2)) continue;
        if (!keepProp(p, Math.sqrt(d2), lod)) continue;
        const s = cam.project(v3(p.x, p.y + 6, p.z), P.vp);
        if (!s.visible) continue;
        const rp = s.scale * 22 * (p.s || 1) + 8;       // prop bounding radius on screen
        if (s.x + rp < -8 || s.x - rp > P.vp.width + 8 || s.y + rp < -8 || s.y - rp > P.vp.height + 8) continue;
        drawProp(P, p, time, theme_);
      }
    }

    function drawProp(P, p, time, theme__) {
      const y = p.y;
      const props2 = p;
      // shadows first (they sit on the ground, under everything)
      switch (props2.type) {
        case 'tree:conifer': case 'tree:giant': case 'tree:broadleaf': case 'tree:dead': case 'tree:void':
        case 'rockBig': case 'ruin': case 'house': case 'watchtower': case 'fortress':
        case 'pillar': case 'obelisk': case 'obeliskBig': case 'spire': case 'dragonbones':
        case 'caveMouth': case 'gate': case 'floatingRock':
          P.sunShadow(p.x, p.z, props2.type === 'pillar' ? 4 : 7 * p.s, 16 * p.s, y + 0.4);
          break;
        default:
          P.shadow(p.x, p.z, 3 * p.s, 2 * p.s, 0.32, y + 0.35);
      }
      switch (props2.type) {
        case 'tree:conifer': treeConifer(P, p, time, theme__); break;
        case 'tree:broadleaf': treeBroadleaf(P, p, time); break;
        case 'tree:giant': treeGiant(P, p, time); break;
        case 'tree:dead': treeDead(P, p, time); break;
        case 'tree:void': treeVoid(P, p, time); break;
        case 'bush': bush(P, p); break;
        case 'rock': rockSmall(P, p, theme__); break;
        case 'rockBig': rockBig(P, p, theme__); break;
        case 'stalagmite': stalagmite(P, p); break;
        case 'crystal': crystal(P, p, theme__); break;
        case 'iceShard': iceShard(P, p); break;
        case 'mushroom': mushroom(P, p); break;
        case 'reed': reed(P, p, time); break;
        case 'gravestone': gravestone(P, p); break;
        case 'pillar': pillar(P, p, theme__); break;
        case 'ruin': ruin(P, p, theme__); break;
        case 'obelisk': obelisk(P, p, theme__); break;
        case 'bones': bones(P, p); break;
        case 'dragonbones': dragonbones(P, p, theme__); break;
        case 'spike': spike(P, p, theme__); break;
        case 'floatingRock': floatingRock(P, p, time); break;
        case 'wisp': wisp(P, p, time, theme__); break;
        case 'spirit': spirit(P, p, time); break;
        case 'torch': torch(P, p, time, theme__); break;
        case 'brazier': brazier(P, p, time, theme__); break;
        case 'house': house(P, p, time, theme__); break;
        case 'well': well(P, p); break;
        case 'market': marketStall(P, p, time); break;
        case 'blacksmith': blacksmith(P, p, time); break;
        case 'plaza': plaza(P, p); break;
        case 'signpost': signpost(P, p, time); break;
        case 'lantern': lantern(P, p, time); break;
        case 'npc': npc(P, p, time); break;
        case 'safeZone': safeZone(P, p, time); break;
        case 'fence': fence(P, p); break;
        case 'watchtower': watchtower(P, p); break;
        case 'fortress': fortress(P, p, theme__); break;
        case 'obeliskBig': obeliskBig(P, p, theme__); break;
        case 'spire': spire(P, p, theme__); break;
        case 'caveMouth': caveMouth(P, p); break;
        case 'dungeonGate': case 'gate': gate(P, p, theme__); break;
        case 'arenaRing': arenaRing(P, p); break;
        default: break;
      }
    }

    /* ---------- village furniture: original Mythara designs ---------- */

    /** Market stall: canvas awning on four poles, crates and produce. */
    function marketStall(P, p, time) {
      const w = 11 * p.s, d = 8 * p.s, h = 7.6 * p.s;
      const wood = '#7d5c37', awning = p.v > 0.5 ? '#b5432f' : '#2f6f8a';
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c) {
        S.cylinder(P, { pos: v3(p.x + c[0] * w * 0.42, p.y + h * 0.5, p.z + c[1] * d * 0.42), radius: 0.35 * p.s, height: h, sides: 4, color: wood });
      });
      S.box(P, { pos: v3(p.x, p.y + h * 0.98, p.z), size: v3(w * 1.06, 0.6, d * 1.12), colours: { all: awning }, rot: v3(0.06, p.rot, 0) });
      S.box(P, { pos: v3(p.x, p.y + h * 0.62, p.z + d * 0.3), size: v3(w * 0.9, 2.6, 1.0), colours: { all: wood }, rot: v3(0, p.rot, 0) });
      // produce: little spheres of fruit/veg on the counter
      for (let i = 0; i < 3; i++) {
        S.billboard(P, {
          pos: v3(p.x - w * 0.28 + i * w * 0.28, p.y + h * 0.7 + 1.2, p.z + d * 0.3),
          width: 2.2, height: 2.2, color: i % 2 ? '#d8542f' : '#c9a13a', alpha: 0.95, soft: true
        });
      }
      S.billboard(P, { pos: v3(p.x, p.y + h * 0.72, p.z), width: 9, height: 9, color: '#ffd76a', alpha: 0.08, soft: true });
      void time;
    }

    /** Blacksmith: stone forge with a glowing mouth, anvil and weapon rack. */
    function blacksmith(P, p, time) {
      const s = p.s;
      // forge hut
      S.box(P, { pos: v3(p.x, p.y + 4.4 * s, p.z), size: v3(13 * s, 8.8 * s, 11 * s), colours: { front: '#6f6455', back: '#5c5245', left: '#665c4f', right: '#665c4f', top: '#4e463c', bottom: '#3a342c' }, rot: v3(0, p.rot, 0) });
      S.box(P, { pos: v3(p.x, p.y + 10 * s, p.z), size: v3(14.4 * s, 1.8 * s, 12.4 * s), colours: { all: '#4a3f34' }, rot: v3(0, p.rot, 0) });
      const glowing = time ? 0.55 + Math.sin(time * 3.1 + p.i) * 0.12 : 0.55;
      S.billboard(P, { pos: v3(p.x + Math.sin(p.rot) * 5.8 * s, p.y + 3.4 * s, p.z + Math.cos(p.rot) * 5.8 * s), width: 5 * s, height: 5 * s, color: '#ff8a3a', alpha: glowing, soft: true });
      S.cylinder(P, { pos: v3(p.x, p.y + 6.6 * s, p.z), radius: 1.3 * s, height: 5 * s, sides: 5, color: '#544a40' });   // chimney
      // anvil
      S.box(P, { pos: v3(p.x + 9 * s, p.y + 2.4 * s, p.z - 2 * s), size: v3(4.6 * s, 1.4 * s, 2.2 * s), colours: { all: '#3d424c' } });
      S.box(P, { pos: v3(p.x + 9 * s, p.y + 1.2 * s, p.z - 2 * s), size: v3(2.0 * s, 1.4 * s, 1.4 * s), colours: { all: '#2f333c' } });
      S.billboard(P, { pos: v3(p.x + 9 * s, p.y + 3.6 * s, p.z - 2 * s), width: 4 * s, height: 4 * s, color: '#ffb347', alpha: 0.22, soft: true });
      // weapon rack
      [-1, 1].forEach(function (side) {
        S.cylinder(P, { pos: v3(p.x - 8 * s + side * 2.4 * s, p.y + 2.6 * s, p.z), radius: 0.4 * s, height: 5.2 * s, sides: 4, color: '#6b5233' });
      });
      S.box(P, { pos: v3(p.x - 8 * s, p.y + 4.4 * s, p.z), size: v3(5.6 * s, 0.5 * s, 0.5 * s), colours: { all: '#6b5233' } });
      for (let i = 0; i < 3; i++) {
        S.box(P, { pos: v3(p.x - 10 * s + i * 2 * s, p.y + 5.6 * s, p.z), size: v3(0.4 * s, 3.4 * s, 0.9 * s), colours: { all: '#c3cbd8' } });
      }
    }

    /** Central plaza: flagstones, a fountain and a market banner ring. */
    function plaza(P, p) {
      const stone = '#9a9182';
      const dark = '#8b8274';
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU;
        const r0 = 5 + (i % 3) * 3.4, r1 = r0 + 3.2;
        const ca = Math.cos(a), sa = Math.sin(a) * 0.78;
        S.plate(P, [
          v3(p.x + ca * r0 - sa * 2.2, p.y + 0.32, p.z + sa * r0 + ca * 2.2),
          v3(p.x + ca * r1 - sa * 2.2, p.y + 0.32, p.z + sa * r1 + ca * 2.2),
          v3(p.x + ca * r1 + sa * 2.2, p.y + 0.32, p.z + sa * r1 - ca * 2.2),
          v3(p.x + ca * r0 + sa * 2.2, p.y + 0.32, p.z + sa * r0 - ca * 2.2)
        ], { color: i % 2 ? stone : dark });
      }
      // fountain: basin + water + spout
      S.cylinder(P, { pos: v3(p.x, p.y + 1.5, p.z), radius: 5.6, radiusTop: 5.9, height: 3, sides: 10, color: '#8d8474' });
      S.cylinder(P, { pos: v3(p.x, p.y + 3.1, p.z), radius: 5.0, height: 0.6, sides: 10, color: '#3f7fa8', alpha: 0.85 });
      S.cylinder(P, { pos: v3(p.x, p.y + 5.4, p.z), radius: 0.8, radiusTop: 0.5, height: 5, sides: 6, color: '#a89e8c' });
      S.blob(P, { pos: v3(p.x, p.y + 8.4, p.z), radii: v3(1.9, 1.2, 1.9), slices: 5, rings: 2, color: '#bfe4f5', jitter: 0.2, seed: 7 });
      // banner poles
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (c, i) {
        const bx = p.x + c[0] * 15, bz = p.z + c[1] * 12;
        S.cylinder(P, { pos: v3(bx, p.y + 6, bz), radius: 0.5, height: 12, sides: 5, color: '#6b5233' });
        S.box(P, { pos: v3(bx + 1.8, p.y + 10.4, bz), size: v3(3.4, 2.6, 0.2), colours: { all: i % 2 ? '#2f6f8a' : '#b5432f' } });
      });
    }

    /** Roadside signpost with a plank and a lantern hook. */
    function signpost(P, p, time) {
      S.cylinder(P, { pos: v3(p.x, p.y + 4.4, p.z), radius: 0.45, height: 8.8, sides: 5, color: '#6b5233' });
      S.box(P, { pos: v3(p.x + 2.6, p.y + 8.0, p.z), size: v3(7.4, 1.9, 0.4), colours: { all: '#c9b184' }, rot: v3(0, p.rot, 0) });
      S.box(P, { pos: v3(p.x - 2.4, p.y + 5.8, p.z), size: v3(6.2, 1.7, 0.4), colours: { all: '#b9a071' }, rot: v3(0, p.rot + 0.6, 0) });
      lantern(P, { x: p.x + 4.2, z: p.z, y: p.y + 6.6, s: 1, i: p.i, v: p.v }, time);
    }

    /** Iron lantern on a post — glows at night. */
    function lantern(P, p, time) {
      const night = P.light && P.light.night ? 1 : 0.25;
      const flicker = 0.86 + Math.sin((time || 0) * 5.3 + (p.v || 0) * 9) * 0.14;
      S.cylinder(P, { pos: v3(p.x, p.y + 3, p.z), radius: 0.32, height: 6, sides: 4, color: '#3c3a42' });
      S.box(P, { pos: v3(p.x, p.y + 6.6, p.z), size: v3(1.9, 2.4, 1.9), colours: { all: '#4a4750' } });
      S.box(P, { pos: v3(p.x, p.y + 8, p.z), size: v3(2.4, 0.5, 2.4), colours: { all: '#3c3a42' } });
      S.billboard(P, { pos: v3(p.x, p.y + 6.6, p.z), width: 8, height: 8, color: '#ffc46a', alpha: 0.18 + night * 0.3 * flicker, soft: true });
      S.billboard(P, { pos: v3(p.x, p.y + 6.4, p.z), width: 3.2, height: 3.2, color: '#fff0c0', alpha: 0.3 + night * 0.5 * flicker, soft: true });
    }

    /**
     * Village NPC: a robed figure with a floating name tag, plus a bobbing
     * marker ("!" quest giver, "$" shop, "+" healer) above the head.
     */
    function npc(P, p, time) {
      const t = time || 0;
      const bob = Math.sin(t * 1.4 + p.i) * 0.4;
      const y = p.y + bob;
      const robe = p.v < 0.34 ? '#d9cfa8' : p.v < 0.67 ? '#2f6f8a' : '#7a3f8a';
      const trim = p.v < 0.34 ? '#f2c14e' : p.v < 0.67 ? '#bfe4f5' : '#e0b0ff';
      S.blob(P, { pos: v3(p.x, y + 6.4, p.z), radii: v3(3.4, 6.6, 3.2), slices: 6, rings: 3, color: robe, jitter: 0.12, seed: p.i + 2 });
      S.blob(P, { pos: v3(p.x, y + 12.6, p.z), radii: v3(2.1, 2.2, 2.1), slices: 6, rings: 3, color: '#f2c79c', jitter: 0.1, seed: p.i + 4 });
      S.box(P, { pos: v3(p.x, y + 4.4, p.z), size: v3(6.4, 1.0, 5.6), colours: { all: trim } });
      S.box(P, { pos: v3(p.x, y + 10.4, p.z), size: v3(4.6, 1.0, 4.2), colours: { all: trim } });
      S.billboard(P, { pos: v3(p.x, y + 14.4, p.z), width: 4.4, height: 4.4, color: trim, alpha: 0.22, soft: true });
      // marker
      const mark = p.mark || '!';
      const my = y + 22 + Math.sin(t * 3 + p.i) * 0.7;
      S.billboard(P, { pos: v3(p.x, my, p.z), width: 5.4, height: 5.4, color: mark === '!' ? '#ffd76a' : mark === '$' ? '#8fe3a0' : '#ff9ec4', alpha: 0.26, soft: true });
      P.label(v3(p.x, my, p.z), mark, { size: 17, weight: '900', color: mark === '!' ? '#ffd76a' : mark === '$' ? '#8fe3a0' : '#ff9ec4' });
      P.label(v3(p.x, y + 17.2, p.z), p.name || 'Villager', { size: 10, weight: '700', color: '#f0e9dc', alpha: 0.95 });
    }

    /** Safe-zone ring on the plaza: a soft gold boundary plus ground glow. */
    function safeZone(P, p, time) {
      const pulse = 0.55 + Math.sin((time || 0) * 1.2) * 0.12;
      S.ring(P, { x: p.x, z: p.z, radius: p.r, thickness: 2.6, color: '#ffd76a', alpha: 0.44 * pulse, segments: 54, y: p.y + 0.6 });
      S.ring(P, { x: p.x, z: p.z, radius: p.r - 4, thickness: 1.2, color: '#fff0c0', alpha: 0.22 * pulse, segments: 54, y: p.y + 0.7 });
      P.ellipseGround(p.x, p.z, p.r * 0.96, p.r * 0.78, '#ffd76a', 0.06 * pulse, p.y + 0.5);
    }

    /* --- detail grid: 128-unit buckets so culling is O(neighbourhood) --- */
    const detailGrid = {};
    props.detail = null;
    (function indexDetail() {
      const CELL2 = 128;
      for (let i = 0; i < detail.length; i++) {
        const d = detail[i];
        const key = Math.floor(d.x / CELL2) + ':' + Math.floor(d.z / CELL2);
        (detailGrid[key] || (detailGrid[key] = [])).push(d);
      }
    })();

    function drawDetail(P, cam, radius) {
      P.tag && P.tag('detail');
      const eye = cam.state.eye;
      const CELL2 = 128;
      const cx = Math.floor(eye.x / CELL2);
      const cz = Math.floor(eye.z / CELL2);
      const span = Math.max(1, Math.ceil(radius / CELL2));
      const r2 = radius * radius;
      for (let gx = cx - span; gx <= cx + span; gx++) {
        for (let gz = cz - span; gz <= cz + span; gz++) {
          const bucket = detailGrid[gx + ':' + gz];
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const d = bucket[i];
            const dx = d.x - eye.x, dz = d.z - eye.z;
            if (dx * dx + dz * dz > r2) continue;
            drawDetailItem(P, d);
          }
        }
      }
    }

    function drawDetailItem(P, d) {
      const kind = d.type;
      if (kind === 'grass' || kind === 'voidGrass' || kind === 'moss') {
        const colour = kind === 'voidGrass' ? '#6b4fa8' : kind === 'moss' ? '#4f6b3a' : (d.v > 0.6 ? '#5fa348' : '#3f7a33');
        for (let i = 0; i < 3; i++) {
          const a = d.rot + i * 1.05;
          const h = 3.6 * d.s * (0.7 + (i % 2) * 0.45);
          S.blade(P, {
            pos: v3(d.x + Math.cos(a) * 0.7 * d.s, d.y, d.z + Math.sin(a) * 0.7 * d.s),
            width: 0.9 * d.s, height: h, angle: a,
            lean: h * (0.12 + d.v * 0.22), leanDir: a + 1.2,
            color: colour, alpha: 0.95, lit: true
          });
        }
      } else if (kind === 'flower') {
        S.blade(P, { pos: v3(d.x, d.y, d.z), width: 0.3, height: 2.6 * d.s, angle: d.rot, lean: 0.3, color: '#3f7a33', alpha: 0.9 });
        S.billboard(P, { pos: v3(d.x + 0.2, d.y + 2.8 * d.s, d.z), width: 1.5 * d.s, height: 1.5 * d.s, color: d.v > 0.5 ? '#ffe9a8' : '#f7a8d0', alpha: 0.95, round: true });
      } else if (kind === 'pebble') {
        S.blob(P, { pos: v3(d.x, d.y + 0.5 * d.s, d.z), radii: v3(1.5 * d.s, 0.9 * d.s, 1.4 * d.s), slices: 5, rings: 2, color: d.v > 0.5 ? theme_.ground.rock : Colour.shade(theme_.ground.alt, -0.12), jitter: 0.3, seed: d.v * 9, yaw: d.rot });
      } else if (kind === 'twig') {
        S.cylinder(P, { pos: v3(d.x, d.y + 0.4, d.z), radius: 0.3, height: 3.4 * d.s, sides: 4, color: '#5a4026', rot: v3(0, 0, Math.PI / 2 + (d.v - 0.5) * 0.4), yaw: d.rot });
      } else if (kind === 'snowdrift') {
        S.blob(P, { pos: v3(d.x, d.y + 0.35 * d.s, d.z), radii: v3(3.4 * d.s, 1.15 * d.s, 2.8 * d.s), slices: 6, rings: 2, color: d.v > 0.45 ? '#eef7ff' : '#d3e4f2', jitter: 0.18, seed: d.v * 11, yaw: d.rot, lit: true });
      } else if (kind === 'iceShard') {
        S.cone(P, { pos: v3(d.x, d.y + 1.4 * d.s, d.z), radius: 0.9 * d.s, height: 2.8 * d.s, sides: 5, color: '#dff2ff', glow: '#bfe9ff', glowAlpha: 0.15, cap: false, yaw: d.rot });
      } else if (kind === 'dune') {
        S.blob(P, { pos: v3(d.x, d.y + 0.5 * d.s, d.z), radii: v3(4.6 * d.s, 1.4 * d.s, 3.4 * d.s), slices: 6, rings: 2, color: '#e6cf9a', jitter: 0.12, seed: d.v * 13, yaw: d.rot });
      } else if (kind === 'bone') {
        S.cylinder(P, { pos: v3(d.x, d.y + 0.5, d.z), radius: 0.42, height: 3.0 * d.s, sides: 4, color: '#e8e2cf', rot: v3(0, 0, Math.PI / 2 + (d.v - 0.5) * 0.6), yaw: d.rot });
      } else if (kind === 'ash') {
        S.blob(P, { pos: v3(d.x, d.y + 0.3, d.z), radii: v3(2.6 * d.s, 0.5, 2.2 * d.s), slices: 5, rings: 2, color: '#4a4440', alpha: 0.9, jitter: 0.2, seed: d.v * 17 });
      } else if (kind === 'emberRock') {
        S.blob(P, { pos: v3(d.x, d.y + 0.7 * d.s, d.z), radii: v3(2.0 * d.s, 1.2 * d.s, 1.8 * d.s), slices: 5, rings: 2, color: '#5a3a30', jitter: 0.35, seed: d.v * 19, yaw: d.rot, glow: '#ff7a3a', glowAlpha: 0.16 });
      } else if (kind === 'crystalShard') {
        S.cone(P, { pos: v3(d.x, d.y + 1.6 * d.s, d.z), radius: 0.8 * d.s, height: 3.2 * d.s, sides: 4, color: theme_.accent, glow: theme_.accent, glowAlpha: 0.22, cap: false, yaw: d.rot });
      } else if (kind === 'puddle') {
        P.ellipseGround(d.x, d.z, 3.4 * d.s, 2.2 * d.s, '#3f4a2a', 0.55, d.y + 0.25);
      } else if (kind === 'reed') {
        for (let i = 0; i < 3; i++) {
          const a = d.rot + i * 0.8;
          S.blade(P, {
            pos: v3(d.x + Math.cos(a) * 0.8, d.y, d.z + Math.sin(a) * 0.8),
            width: 0.7, height: 7 * d.s, angle: a, lean: 0.9, taper: 0.2, color: '#7a8447', alpha: 0.92
          });
        }
      }
    }

    /** Smooth dirt road: overlapping ground strips with worn edges. */
    /**
     * Dirt road: short segments that follow the terrain instead of long flat
     * plates. Each segment samples the height field at its own corners, so the
     * path bends over hills and never floats above a dip or cuts through a rise.
     * The road stays inside the field — outside it the mountain rim takes over.
     */
    function drawRoad(P, time) {
      P.tag && P.tag('road');
      if (theme_.id === 'chapter3' || theme_.id === 'chapter9' || theme_.id === 'chapter10') return;
      const eye = P.cam.state.eye;
      const half = 14;
      const step = 15;                       // fine enough to hug the height field
      const x0 = PLAY.minX - 26, x1 = PLAY.maxX + 26;
      const endFade = 90;                    // dissolve into the grass at both ends
      // dirt, not chalk: shade the palette path down and keep it close to the
      // ground colour so it reads as trodden earth rather than a pale band
      const pathColour = Colour.mix(Colour.shade(theme_.ground.path, -0.16), theme_.ground.base, 0.34);
      const vergeColour = Colour.mix(theme_.ground.path, theme_.ground.base, 0.78);
      const y = function (px, pz) { return heightAt(px, pz) + 0.28; };
      for (let x = x0; x < x1; x += step) {
        const x2 = Math.min(x + step, x1);
        const c1 = roadCentre(x), c2 = roadCentre(x2);
        const midX = (x + x2) / 2, midZ = (c1 + c2) / 2;
        const dist = M.v3dist(eye, v3(midX, 0, midZ));
        if (dist > 820) continue;
        const fade = clamp(1 - dist / 820, 0, 1) *
          clamp(Math.min(x - x0, x1 - x) / endFade, 0, 1) *
          clamp(Math.min(midZ - PLAY.minZ, PLAY.maxZ - midZ) / 40, 0, 1) *
          clamp((dist - 55) / 55, 0, 1);       // don't smear right under the camera
        if (fade <= 0.02) continue;
        S.plate(P, [
          v3(x, y(x, c1 - half), c1 - half),
          v3(x2, y(x2, c2 - half), c2 - half),
          v3(x2, y(x2, c2 + half), c2 + half),
          v3(x, y(x, c1 + half), c1 + half)
        ], { color: pathColour, alpha: 0.6 * fade, lit: true });
        // soft worn verge on both sides (only where it is actually visible)
        if (dist > 420) continue;
        [-1, 1].forEach(function (side) {
          S.plate(P, [
            v3(x, y(x, c1 + side * half), c1 + side * half),
            v3(x2, y(x2, c2 + side * half), c2 + side * half),
            v3(x2, y(x2, c2 + side * (half + 7)), c2 + side * (half + 7)),
            v3(x, y(x, c1 + side * (half + 7)), c1 + side * (half + 7))
          ], { color: vergeColour, alpha: 0.24 * fade });
        });
      }
      void time;
    }

    const blockers = collectBlockers(props);

    /** Steepest local gradient — used to refuse walking up cliffs. */
    function slopeAt(x, z) {
      const s = 4;
      const gx = Math.abs(heightAt(x + s, z) - heightAt(x - s, z)) / (2 * s);
      const gz = Math.abs(heightAt(x, z + s) - heightAt(x, z - s)) / (2 * s);
      return Math.max(gx, gz);
    }

    /**
     * Move a circle from (fromX, fromZ) toward (toX, toZ), refusing cliffs
     * and sliding around solid props. Pure maths — the engine keeps owning
     * positions, this only says where the entity may legally stand.
     */
    function resolveMove(fromX, fromZ, toX, toZ, radius) {
      const r = radius === undefined ? 12 : radius;
      let x = toX;
      let z = toZ;
      let blocked = false;

      if (slopeAt(x, z) > MAX_SLOPE) {
        blocked = true;
        if (slopeAt(toX, fromZ) <= MAX_SLOPE) { x = toX; z = fromZ; }
        else if (slopeAt(fromX, toZ) <= MAX_SLOPE) { x = fromX; z = toZ; }
        else { return { x: fromX, z: fromZ, blocked: true }; }
      }

      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < blockers.length; i++) {
          const b = blockers[i];
          const dx = x - b.x;
          const dz = z - b.z;
          const rr = b.r + r;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr) continue;
          blocked = true;
          if (d2 < 1e-6) { x = b.x + rr; continue; }
          const d = Math.sqrt(d2);
          x = b.x + (dx / d) * rr;
          z = b.z + (dz / d) * rr;
        }
      }
      return { x: x, z: z, blocked: blocked };
    }

    /**
     * Is the straight line between two points clear? Terrain that rises
     * above the sight line (a ridge, the bowl lip) and solid props both
     * block it, so arrows and spells cannot cross a cliff or a house.
     */
    function lineBlocked(ax, az, bx, bz) {
      const ha = heightAt(ax, az);
      const hb = heightAt(bx, bz);
      for (let t = 0.12; t <= 0.881; t += 0.12) {
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        if (heightAt(x, z) - (ha + (hb - ha) * t) > 6) return true;
      }
      const dx = bx - ax;
      const dz = bz - az;
      const len2 = dx * dx + dz * dz || 1;
      for (let i = 0; i < blockers.length; i++) {
        const b = blockers[i];
        if (b.r < 2.2) continue;                 // tree trunks never stop a shot
        let t = ((b.x - ax) * dx + (b.z - az) * dz) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + dx * t - b.x;
        const pz = az + dz * t - b.z;
        if (px * px + pz * pz < b.r * b.r) return true;
      }
      return false;
    }

    // The safe ring only exists where the plaza does (Silverstone's hometown).
    const safeRing = (theme_.id === 'hub' || theme_.id === 'chapter1')
      ? { x: VILLAGE.x, z: VILLAGE.z, r: 74 } : null;

    return {
      theme: theme_,
      heightAt: heightAt,
      groundAt: heightAt,
      safeRing: safeRing,
      blockers: blockers,
      slopeAt: slopeAt,
      resolveMove: resolveMove,
      lineBlocked: lineBlocked,
      drawRoad: drawRoad,
      drawDetail: drawDetail,
      detailCount: detail.length,
      waterDepth: function (x, z) { return waterDepth(x, z, theme_); },
      props: props,
      quads: quads,
      drawSky: drawSky,
      drawHorizon: drawHorizon,
      drawTerrain: drawTerrain,
      drawProps: drawProps,
      updateWeather: updateWeather,
      updateAmbient: updateAmbient,
      drawAmbient: drawAmbient,
      drawWeather: drawWeather,
      drawPost: drawPost,
      isPlayArea: function (x, z) { return inPlayArea(x, z, 0); }
    };
  }

  root.MytharaWorld3D = {
    THEMES: THEMES,
    theme: theme,
    themeForChapter: themeForChapter,
    themeForZoneName: themeForZoneName,
    createWorld: createWorld,
    PLAY: PLAY,
    PALETTE: PALETTE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MytharaWorld3D;

})(typeof globalThis !== 'undefined' ? globalThis : this);
