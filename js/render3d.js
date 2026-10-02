/* ============================================================
 * Mythara Online — js/render3d.js
 * ------------------------------------------------------------
 * The presentation layer that replaces the flat canvas backdrop:
 *
 *   • frame pipeline — sky → horizon → terrain → props + actors
 *     (depth sorted) → combat VFX → weather → labels → post grade
 *   • third-person MMORPG camera: follows the hero, mouse/touch drag
 *     orbits, wheel/pinch zooms, Q/E rotate, R locks onto the target
 *   • day/night cycle + weather, both driven by the region theme
 *   • adaptive quality so phones keep a smooth frame rate
 *   • minimap renderer and the 3D class-preview used on the
 *     character-selection screen
 *
 * The engine keeps ownership of movement, damage and progression —
 * this module only draws, observes and passes camera input through.
 * ============================================================ */
(function (root) {
  'use strict';

  const M = root.Mythara3D;
  const S = root.MytharaShapes3D;
  const World = root.MytharaWorld3D;
  const Actors = root.MytharaActors3D;
  const VFX = root.MytharaVFX3D;
  const v3 = M.v3;
  const Colour = M.Colour;
  const clamp = M.clamp;
  const lerp = M.lerp;
  const TAU = M.TAU;

  const DAY_SECONDS = 300;                      // one full cycle when the region animates time
  const QUALITY_PRESETS = {
    high: { level: 3, renderScale: 1, propDist: 1450, terrainDist: 1500, detailDist: 330, maxActors: 40, weatherScale: 1 },
    medium: { level: 2, renderScale: 0.85, propDist: 1050, terrainDist: 1100, detailDist: 240, maxActors: 30, weatherScale: 0.7 },
    low: { level: 1, renderScale: 0.68, propDist: 760, terrainDist: 820, detailDist: 170, maxActors: 22, weatherScale: 0.45 }
  };

  const Render3D = (function () {
    const state = {
      ready: false,
      profile: {},
      canvas: null,
      ctx: null,
      vp: { width: 960, height: 540, dpr: 1, cssWidth: 960, cssHeight: 540 },
      camera: null,
      painter: M.createPainter(),
      world: null,
      worldId: null,
      theme: World.theme('hub'),
      timeOfDay: 0.36,
      cycle: true,
      quality: 'auto',
      qualityLevel: QUALITY_PRESETS.high,
      frameTime: 16,
      frames: 0,
      lastStats: null,
      lockOn: true,
      lockTarget: null,
      showNames: true,
      manualZoom: false,
      dragState: null,
      footstep: { x: 0, z: 0, dist: 0, inWater: false },
      pinch: null,
      bound: false,
      minimapTimer: 0,
      hudTimer: 0,
      enabled: true
    };

    /* ---------------- setup ---------------- */
    function optionsFromUrl() {
      const search = (root.location && root.location.search) || '';
      const q = /[?&]quality=(low|medium|high)/i.exec(search);
      const render = /[?&]render=(2d|3d)/i.exec(search);
      const tod = /[?&]time=([0-9.]+)/.exec(search);
      return {
        quality: q ? q[1].toLowerCase() : 'auto',
        render2d: render ? render[1].toLowerCase() === '2d' : false,
        timeOfDay: tod ? parseFloat(tod[1]) : null
      };
    }

    function attach(canvas) {
      if (!canvas || !canvas.getContext) return null;
      const opts = optionsFromUrl();
      if (opts.render2d) { state.enabled = false; return null; }
      const context2d = canvas.getContext ? canvas.getContext('2d') : null;
      if (!context2d) return null;                     // no canvas support → keep the 2D fallback
      state.canvas = canvas;
      state.ctx = context2d;
      state.quality = opts.quality;
      state.camera = M.createCamera({
        x: 480, z: 430, yaw: 0, pitch: 0.32, dist: 150, fov: 46,
        bounds: { minX: 0, maxX: 960, minZ: 0, maxZ: 540 }
      });
      state.camera.state.minDist = 95;
      state.camera.state.maxDist = 520;
      state.camera.snap();
      state.ready = true;
      VFX.install();
      resize();
      bindInput();
      if (opts.timeOfDay !== null && !isNaN(opts.timeOfDay)) {
        state.timeOfDay = clamp(opts.timeOfDay, 0, 1);
        state.cycle = false;
      }
      return state.ctx;
    }

    /**
     * Point actors + combat VFX at the active height field so nothing hovers.
     * Called whenever the region changes (worlds are cached per theme).
     */
    function attachGround(world) {
      const sample = world && world.heightAt ? function (x, z) { return world.heightAt(x, z); } : null;
      if (Actors && Actors.setGround) Actors.setGround(sample);
      if (VFX && VFX.setGround) VFX.setGround(sample);
      if (state.camera) state.camera.groundAt = sample;
    }

    function useWorld(theme_) {
      const id = theme_.id;
      if (state.worldId === id && state.world) return state.world;
      state.world = World.createWorld(theme_);
      state.worldId = id;
      state.theme = theme_;
      attachGround(state.world);
      return state.world;
    }

    /** Called by the engine whenever a stage/zone theme is applied. */
    function setPalette(palette, zoneName) {
      const theme_ = World.themeForZoneName(zoneName || '');
      state.theme = theme_;
      if (palette && palette.accent) state.theme = Object.assign({}, theme_, { accent: palette.accent });
      useWorld(state.theme);
      state.cycle = state.theme.cycle !== false;
      if (!state.cycle) state.timeOfDay = state.theme.sunStart === undefined ? 0.4 : state.theme.sunStart;
      return state.theme.id;
    }

    function setTimeOfDay(t, cycle) {
      state.timeOfDay = clamp(t, 0, 1);
      if (cycle !== undefined) state.cycle = !!cycle;
      return state.timeOfDay;
    }

    function setQuality(mode) {
      if (mode && QUALITY_PRESETS[mode]) state.qualityLevel = QUALITY_PRESETS[mode];
      state.quality = mode || 'auto';
      resize();
      return state.quality;
    }

    /** Size the backing store to the CSS box (crisp on phones and desktops). */
    function resize() {
      const canvas = state.canvas;
      if (!canvas) return;
      const parent = canvas.parentElement;
      const cssW = (parent && parent.clientWidth) || canvas.clientWidth || 960;
      const cssH = (parent && parent.clientHeight) || canvas.clientHeight || Math.round(cssW * 540 / 960);
      const dpr = Math.min(root.devicePixelRatio || 1, 2) * (state.qualityLevel.renderScale || 1);
      state.vp.cssWidth = cssW;
      state.vp.cssHeight = cssH;
      state.vp.dpr = dpr;
      state.vp.width = Math.max(320, Math.round(cssW * dpr));
      state.vp.height = Math.max(200, Math.round(cssH * dpr));
      canvas.width = state.vp.width;
      canvas.height = state.vp.height;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      const ctx = state.ctx;
      if (ctx && ctx.setTransform) ctx.setTransform(1, 0, 0, 1, 0, 0);
      return state.vp;
    }

    /* ---------------- input ---------------- */
    function bindInput() {
      if (state.bound) return;
      state.bound = true;
      const canvas = state.canvas;
      const doc = root.document;
      const cam = state.camera;

      const onDown = function (event) {
        if (event.touches && event.touches.length === 2) {
          const a = event.touches[0], b = event.touches[1];
          state.pinch = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), camDist: cam.state.dist };
          return;
        }
        state.dragState = {
          x: event.clientX !== undefined ? event.clientX : (event.touches && event.touches[0].clientX),
          y: event.clientY !== undefined ? event.clientY : (event.touches && event.touches[0].clientY),
          id: event.pointerId
        };
      };
      const onMove = function (event) {
        if (event.touches && event.touches.length === 2 && state.pinch) {
          const a = event.touches[0], b = event.touches[1];
          const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          if (d > 0 && state.pinch.dist > 0) {
            cam.setDist(state.pinch.camDist * (state.pinch.dist / d));
            state.manualZoom = true;
          }
          event.preventDefault();
          return;
        }
        if (!state.dragState) return;
        const x = event.clientX !== undefined ? event.clientX : (event.touches && event.touches[0] && event.touches[0].clientX);
        const y = event.clientY !== undefined ? event.clientY : (event.touches && event.touches[0] && event.touches[0].clientY);
        if (x === undefined || y === undefined) return;
        const dx = x - state.dragState.x;
        const dy = y - state.dragState.y;
        state.dragState.x = x;
        state.dragState.y = y;
        if (Math.abs(dx) + Math.abs(dy) > 1) cam.orbit(dx, dy);
        if (event.cancelable && event.touches) event.preventDefault();
      };
      const onUp = function () {
        state.dragState = null;
        state.pinch = null;
      };

      canvas.addEventListener('mousedown', onDown);
      root.addEventListener('mousemove', onMove);
      root.addEventListener('mouseup', onUp);
      canvas.addEventListener('touchstart', onDown, { passive: true });
      canvas.addEventListener('touchmove', onMove, { passive: false });
      canvas.addEventListener('touchend', onUp);
      canvas.addEventListener('wheel', function (event) {
        cam.zoomBy(event.deltaY > 0 ? 1.08 : 0.92);
        state.manualZoom = true;
        if (event.cancelable) event.preventDefault();
      }, { passive: false });
      canvas.addEventListener('dblclick', function () { state.lockOn = !state.lockOn; });

      if (doc && doc.addEventListener) {
        doc.addEventListener('keydown', function (event) {
          if (event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName || '')) return;
          if (event.code === 'KeyQ') cam.orbit(40, 0);
          else if (event.code === 'KeyE') cam.orbit(-40, 0);
          else if (event.code === 'KeyR') { state.lockOn = !state.lockOn; }
          else if (event.code === 'Equal' || event.code === 'NumpadAdd') cam.zoomBy(0.9);
          else if (event.code === 'Minus' || event.code === 'NumpadSubtract') cam.zoomBy(1.1);
          else return;
          if (event.cancelable) event.preventDefault();
        });
      }
      if (root.addEventListener) {
        root.addEventListener('resize', function () { resize(); });
        if (root.ResizeObserver && canvas.parentElement) {
          try {
            const ro = new root.ResizeObserver(function () { resize(); });
            ro.observe(canvas.parentElement);
          } catch (err) { /* ResizeObserver unavailable — window resize covers it */ }
        }
      }
    }

    /* ---------------- frame ---------------- */
    function resolveTimeOfDay(dt, state_) {
      const theme_ = state.theme;
      if (theme_.cycle === false || !state.cycle) {
        state.timeOfDay = theme_.sunStart === undefined ? state.timeOfDay : theme_.sunStart;
        return state.timeOfDay;
      }
      const speed = dt / DAY_SECONDS;
      state.timeOfDay = (state.timeOfDay + speed) % 1;
      void state_;
      return state.timeOfDay;
    }

    function render(gameState, dt) {
      if (!state.enabled || !state.ready) return false;
      const ctx = state.ctx;
      if (!ctx) return false;
      const step = dt === undefined ? 0.016 : dt;
      const time = (gameState && gameState.time) || 0;

      const theme_ = state.theme;
      const world = useWorld(theme_);
      const tod = resolveTimeOfDay(step, gameState);
      const light = M.Light.build(theme_, tod, { fogBoost: theme_.weather === 'fog' ? 0.8 : 0 });
      const P = state.painter;
      P.begin(ctx, state.camera, state.vp, light, theme_);

      const player = gameState && gameState.player;
      const monsters = (gameState && gameState.monsters) || [];
      const aliveMonsters = monsters.filter(function (m) { return m.alive; });

      // lock-on target: keep the current one until it dies
      if (state.lockTarget && (!state.lockTarget.alive || monsters.indexOf(state.lockTarget) === -1)) state.lockTarget = null;
      if (!state.lockTarget || !state.lockTarget.alive) {
        const primary = aliveMonsters[0] || null;
        const boss = aliveMonsters.filter(function (m) { return m.isBoss; })[0];
        state.lockTarget = boss || primary;
      }

      // camera follow
      if (player) {
        state.camera.state.lockOn = !!state.lockOn && !!state.lockTarget && !state.lockTarget.isDuelist;
        // gentle action framing: pull back a little when the fight is far away
        const nearest = aliveMonsters.length
          ? Math.min.apply(null, aliveMonsters.map(function (m) { return M.v3dist(v3(player.pos.x, 0, player.pos.y), v3(m.pos.x, 0, m.pos.y)); }))
          : 400;
        const want = clamp(104 + nearest * 0.2, 118, 215);
        const camDist = state.camera.state.dist;
        if (!state.manualZoom && Math.abs(camDist - want) > 6) {
          state.camera.setDist(camDist + (want - camDist) * clamp(step * 1.4, 0, 1));
        }
        const groundY = world.heightAt(player.pos.x, player.pos.y);
        state.camera.follow(player, step, {
          facing: player.facing,
          target: state.lockTarget,
          keepYaw: state.manualZoom,
          lift: 22,
          groundY: groundY
        });
      } else {
        state.camera.updateEye();
      }
      // screen shake straight from the engine
      const shake = root.Mythara && root.Mythara.Effects && root.Mythara.Effects.getShake ? root.Mythara.Effects.getShake() : 0;
      if (shake > 0.05) {
        ctx.save();
        ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      }

      const SKIP = root.__MM_SKIP__ || {};
      if (root.__MM_WEDGE__) debugWedge(P, world);
      const prof = root.__MM_PROFILE__ ? state.profile : null;
      const tRender = prof ? (root.__MM_CLOCK__ || function () { return Date.now(); })() : 0;
      const clock = root.__MM_CLOCK__ || function () { return root.performance && root.performance.now ? root.performance.now() : Date.now(); };
      const mark = function (name, t0) { if (prof) prof[name] = (prof[name] || 0) + (clock() - t0); };
      let t0 = prof ? clock() : 0;
      if (!SKIP.sky) world.drawSky(P, light, time);
      if (!SKIP.horizon) world.drawHorizon(P, light, time);
      mark('sky', t0);
      t0 = prof ? clock() : 0;
      if (!SKIP.terrain) world.drawTerrain(P, time, state.camera);
      mark('terrain', t0);
      t0 = prof ? clock() : 0;
      if (!SKIP.road && world.drawRoad) world.drawRoad(P, time);
      if (!SKIP.detail) world.drawDetail(P, state.camera, state.qualityLevel.detailDist || 340);
      if (!SKIP.detail && world.drawAmbient) world.drawAmbient(P);      // fireflies / leaves
      mark('ground', t0);
      t0 = prof ? clock() : 0;

      if (player && gameState.screen === 'game') footstepEffects(world, player, step);
      VFX.update(step, gameState);
      world.updateWeather(step, time);
      if (world.updateAmbient) world.updateAmbient(step, time);

      // actors + props + effects share one depth-sorted list
      if (player && gameState.screen === 'game') {
        world.drawProps(P, time, state.camera, state.qualityLevel.propDist, Math.min(560, state.qualityLevel.propDist), state.qualityLevel.level);
        drawActors(P, gameState, player, aliveMonsters, time);
        VFX.drawProjectiles(P, time);
        VFX.draw(P, time);
      }
      mark('actors', t0);
      t0 = prof ? clock() : 0;
      P.flush();
      mark('flush', t0);
      t0 = prof ? clock() : 0;

      world.drawWeather(P, step, time);

      mark('weather', t0);
      t0 = prof ? clock() : 0;
      if (player && gameState.screen === 'game') {
        Actors.drawOverlays(P, gameState, {
          time: time,
          target: state.lockTarget,
          lockTarget: state.lockOn ? state.lockTarget : null,
          showAllNames: state.qualityLevel.level >= 3
        });
        VFX.drawParticles(P);
        VFX.drawFloaters(P, gameState);
      }

      mark('labels', t0);
      t0 = prof ? clock() : 0;
      world.drawPost(P, light, time);
      mark('post', t0);
      if (shake > 0.05) ctx.restore();

      mark('total', tRender);
      state.lastStats = {
        theme: theme_.id,
        weather: theme_.weather,
        timeOfDay: tod,
        phase: light.phase,
        polys: P.state.stats.polys,
        fills: P.state.stats.fills,
        deferred: P.state.stats.deferred,
        quality: state.quality === 'auto' ? 'auto:' + state.qualityLevel.level : state.quality,
        actors: aliveMonsters.length + (player ? 1 : 0),
        effects: VFX.count()
      };
      autoQuality(step);
      return true;
    }

    /**
     * Footstep feedback: small dust puffs on dry ground, splashes in water.
     * Purely cosmetic and rate-limited by distance travelled, so it costs
     * nothing while standing still.
     */
    function footstepEffects(world, player, dt) {
      const f = state.footstep;
      const dx = player.pos.x - f.x, dz = player.pos.y - f.z;
      const moved = Math.sqrt(dx * dx + dz * dz);
      f.x = player.pos.x;
      f.z = player.pos.y;
      if (dt <= 0) return;
      const inWater = world.waterDepth ? world.waterDepth(player.pos.x, player.pos.y) > 0.08 : false;
      f.dist += moved;
      const stride = inWater ? 26 : 20;
      if (f.dist < stride) return;
      f.dist = 0;
      const moving = (player.moving || (player.anim && player.anim.current === 'walk') || (player.anim && player.anim.current === 'run'));
      if (!moving) return;
      const groundY = world.heightAt ? world.heightAt(player.pos.x, player.pos.y) : 0;
      const back = player.facing ? -player.facing.x * 6 : 0;
      const backZ = player.facing ? -player.facing.y * 6 : 0;
      if (inWater) {
        VFX.burstEffect(player.pos.x + back, player.pos.y + backZ, '#cfe9ff', { count: 5, y: 4, rise: 8, spread: 12, life: 0.45 });
        VFX.ringEffect(player.pos.x, player.pos.y, '#bfe4f5', { radius: 26, thickness: 3, life: 0.4 });
      } else {
        VFX.burstEffect(player.pos.x + back, player.pos.y + backZ, '#cbb894', { count: 3, y: 1.5, rise: 5, spread: 9, life: 0.4 });
      }
      void groundY;
      f.inWater = inWater;
    }

    function drawActors(P, gameState, player, aliveMonsters, time) {
      const list = [];
      for (let i = 0; i < aliveMonsters.length; i++) list.push(aliveMonsters[i]);
      if (player && !player.downed) list.push(player);
      // arena bots arrive as monsters with kind 'duelist'
      const dead = (gameState.monsters || []).filter(function (m) { return !m.alive && (m.deathTimer || 0) > 0; });
      for (let i = 0; i < dead.length; i++) list.push(dead[i]);

      const eye = state.camera.state.eye;
      const drawList = [];
      for (let i = 0; i < list.length; i++) {
        const actor = list[i];
        const d2 = (actor.pos.x - eye.x) * (actor.pos.x - eye.x) + (actor.pos.y - eye.z) * (actor.pos.y - eye.z);
        if (d2 > 1500 * 1500) continue;
        drawList.push(actor);
      }
      const equipment = Actors.equipment();
      drawList.forEach(function (actor) {
        Actors.drawActor(P, actor, {
          time: time,
          equipment: equipment,
          target: actor === player ? null : null
        });
      });
    }

    function autoQuality(dt) {
      if (state.quality !== 'auto') return;
      const ms = dt * 1000;
      state.frameTime = state.frameTime * 0.9 + Math.min(ms, 120) * 0.1;
      state.frames++;
      if (state.frames % 90 !== 0) return;
      const level = state.qualityLevel.level;
      if (state.frameTime > 34 && level > 1) {
        state.qualityLevel = QUALITY_PRESETS[level === 3 ? 'medium' : 'low'];
        resize();
      } else if (state.frameTime < 20 && level < 3) {
        state.qualityLevel = QUALITY_PRESETS[level === 1 ? 'medium' : 'high'];
        resize();
      }
    }

    /* ---------------- character-select preview ---------------- */
    function drawPreviewHero(ctx, canvas, classDef, time) {
      if (!ctx || !canvas || !classDef) return false;
      const w = canvas.width || 300;
      const h = canvas.height || 360;
      const cam = M.createCamera({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0.2, dist: 86, fov: 40 });
      cam.state.look = v3(0, 25, 0);
      cam.state.eye = v3(0, 34, 90);
      cam.state.basis = {
        forward: M.v3norm(M.v3sub(cam.state.look, cam.state.eye)),
        right: v3(1, 0, 0),
        up: v3(0, 1, 0)
      };
      const light = M.Light.build({ skyTop: '#2b2350', skyBottom: '#0d0b1a', accent: classDef.look.accent || '#f2c14e', fog: '#1a1630', fogDensity: 0.0009 }, 0.36, null);
      const P = state.painter;
      P.begin(ctx, cam, { width: w, height: h }, light, {});

      // backdrop
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#221c40');
      g.addColorStop(0.55, '#15122c');
      g.addColorStop(1, '#0b0918');
      ctx.save();
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
      // ground dais
      P.ellipseGround(0, 4, 46, 20, '#2a2440', 0.85, 0);
      P.ellipseGround(0, 4.2, 34, 14, Colour.mix(classDef.look.accent || '#f2c14e', '#ffffff', 0.3), 0.18, 0.2);
      // class-coloured rim glow
      P.radial(w / 2, h * 0.42, w * 0.55, classDef.look.accent || '#f2c14e', 0.14);

      const cycle = time % 4.2;
      const actor = {
        kind: 'player',
        classId: classDef.id,
        look: classDef.look,
        pos: { x: 0, y: 0 },
        facing: { x: -0.52, y: 0.86 },     // three-quarter view: front armour + weapon visible
        walkPhase: 0,
        moving: false,
        running: false,
        attackType: classDef.attackType,
        radius: 16,
        bob: 0.2,
        anim: { state: cycle > 2.6 && cycle < 3.3 ? 'attack' : 'idle', t: 0, progress: 0, durationMs: 0 },
        attackAnim: cycle > 2.9 && cycle < 3.35 ? 1 - (cycle - 2.9) / 0.45 : 0
      };
      Actors.drawActor(P, actor, { time: time, equipment: {} });
      // weapon glow ring for magic classes
      if (classDef.look.aura) {
        P.radial(w / 2, h * 0.52, 96, classDef.look.aura, 0.2);   // elemental glow for casters
      }
      P.flush();
      return true;
    }

    /**
     * Development hook: paint every terrain quad that is much brighter than its
     * neighbours magenta, so colour/shading artifacts are obvious in a frame.
     * Enabled with __MM_WEDGE__ (render harness only).
     */
    function debugWedge() {
      // the highlight is produced inside the painter + terrain (see render3d-core/world)
      state.wedgeDebug = true;
      state.painter.brightDebug = true;
      const world = state.world;
      if (world) world.wedgeDebug = true;
    }

    /* ---------------- minimap ---------------- */
    function renderMinimap(ctx, w, h, gameState) {
      if (!ctx) return false;
      const theme_ = state.theme;
      const g = ctx;
      g.clearRect(0, 0, w, h);
      g.save();
      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, Colour.mix(theme_.ground.base, '#0a0c14', 0.35));
      bg.addColorStop(1, Colour.mix(theme_.ground.alt, '#0a0c14', 0.5));
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);

      const rect = { minX: -120, maxX: 1080, minZ: -320, maxZ: 900 };
      const toX = function (x) { return ((x - rect.minX) / (rect.maxX - rect.minX)) * w; };
      const toY = function (z) { return ((z - rect.minZ) / (rect.maxZ - rect.minZ)) * h; };

      // scenery dots
      const world = state.world;
      if (world && world.props) {
        for (let i = 0; i < world.props.length; i += 2) {
          const p = world.props[i];
          if (p.x < rect.minX || p.x > rect.maxX || p.z < rect.minZ || p.z > rect.maxZ) continue;
          const type = p.type;
          g.fillStyle = /tree/.test(type) ? 'rgba(70,120,70,0.75)'
            : /house|watchtower|fortress|spire|well|fence/.test(type) ? 'rgba(200,180,140,0.8)'
              : /ruin|pillar|obelisk|gravestone/.test(type) ? 'rgba(160,160,170,0.7)'
                : /crystal|floating|wisp|brazier|torch/.test(type) ? 'rgba(190,150,255,0.8)'
                  : 'rgba(120,120,130,0.55)';
          g.fillRect(toX(p.x) - 1, toY(p.z) - 1, 2, 2);
        }
      }
      // water hint
      if (theme_.props && theme_.props.water) {
        g.fillStyle = 'rgba(70,130,190,0.35)';
        for (let i = 0; i < 40; i++) {
          const x = rect.minX + (i / 40) * (rect.maxX - rect.minX);
          const z = -170 + Math.sin(x / 240) * 42;
          g.fillRect(toX(x) - 1, toY(z) - 3, 2, 6);
        }
      }
      // playable ring
      g.strokeStyle = 'rgba(242,193,78,0.35)';
      g.lineWidth = 1;
      g.strokeRect(toX(34), toY(300), toX(926) - toX(34), toY(506) - toY(300));

      const monsters = (gameState && gameState.monsters) || [];
      monsters.forEach(function (m) {
        if (!m.alive) return;
        const x = toX(m.pos.x), y = toY(m.pos.y);
        if (m.isBoss) {
          g.fillStyle = '#ff5f3a';
          g.beginPath();
          g.arc(x, y, 5, 0, TAU);
          g.fill();
          g.strokeStyle = '#ffd76a';
          g.lineWidth = 1.4;
          g.stroke();
        } else {
          g.fillStyle = m.tier === 'elite' ? '#ffb347' : '#e05a4a';
          g.beginPath();
          g.arc(x, y, 3, 0, TAU);
          g.fill();
        }
      });
      const player = gameState && gameState.player;
      if (player) {
        const x = toX(player.pos.x), y = toY(player.pos.y);
        const yaw = Math.atan2(player.facing ? player.facing.x : 0, player.facing ? -(player.facing.y || 1) : -1);
        g.save();
        g.translate(x, y);
        g.rotate(yaw);
        g.fillStyle = '#ffe9a0';
        g.beginPath();
        g.moveTo(0, -6);
        g.lineTo(4.4, 5);
        g.lineTo(0, 3);
        g.lineTo(-4.4, 5);
        g.closePath();
        g.fill();
        g.restore();
      }
      // frame
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = 2;
      g.strokeRect(1, 1, w - 2, h - 2);
      g.restore();
      return true;
    }

    /** Small DOM HUD extras that read live game state (quests, gems, potions). */
    function updateHud(gameState) {
      const doc = root.document;
      if (!doc) return;
      const Account = root.MytharaAccount && root.MytharaAccount.Account;
      const Battle = root.MytharaBattle;
      const gemsEl = doc.getElementById('gems-value');
      if (gemsEl && Account && Account.isReady && Account.isReady()) {
        const profile = Account.profile();
        const text = String(profile.gems || 0);
        if (gemsEl.textContent !== text) gemsEl.textContent = text;
        const coinsEl = doc.getElementById('coins-value');
        if (coinsEl && coinsEl.textContent !== String(profile.coins || 0)) coinsEl.textContent = String(profile.coins || 0);
        const potionEl = doc.getElementById('hud-potions');
        if (potionEl && root.MYTHARA_ITEMS && Account.potionCount) {
          const hp = Account.potionCount('hpSmall') + Account.potionCount('hpLarge') + Account.potionCount('hpMega');
          const text2 = String(hp);
          if (potionEl.textContent !== text2) potionEl.textContent = text2;
        }
      }
      const questEl = doc.getElementById('quest-tracker-body');
      if (questEl && Account && Account.isReady && Account.isReady()) {
        const Systems = root.MytharaSystems;
        if (Systems && Systems.Quests && Systems.Quests.list) {
          const quests = Systems.Quests.list();
          const active = quests.filter(function (q) { return !q.claimed; }).slice(0, 3);
          const signature = active.map(function (q) { return q.id + ':' + (q.progress || 0); }).join('|');
          if (questEl.getAttribute('data-sig') !== signature) {
            questEl.setAttribute('data-sig', signature);
            questEl.innerHTML = '';
            active.forEach(function (q) {
              const row = doc.createElement('div');
              row.className = 'quest-row' + (q.complete ? ' is-complete' : '');
              const name = doc.createElement('span');
              name.className = 'quest-row__name';
              name.textContent = q.name || q.id;
              const prog = doc.createElement('span');
              prog.className = 'quest-row__prog';
              prog.textContent = (q.progress || 0) + '/' + (q.target || 1);
              row.appendChild(name);
              row.appendChild(prog);
              questEl.appendChild(row);
            });
            if (!active.length) {
              const row = doc.createElement('div');
              row.className = 'quest-row quest-row--empty';
              row.textContent = 'All quests complete';
              questEl.appendChild(row);
            }
          }
        }
      }
      const objective = doc.getElementById('hud-objective');
      if (objective && Battle && Battle.current) {
        const fight = Battle.current();
        if (fight && fight.running) {
          const info = Battle.waveInfo ? Battle.waveInfo() : null;
          const text3 = info ? info.label + ' ' + info.index + '/' + info.total : '';
          if (objective.textContent !== text3) objective.textContent = text3;
        }
      }
      void gameState;
    }

    function tickHud(dt, gameState) {
      state.hudTimer -= dt;
      if (state.hudTimer > 0) return;
      state.hudTimer = 0.25;
      updateHud(gameState);
      const canvas = root.document && root.document.getElementById('minimap-canvas');
      if (canvas && canvas.getContext) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width || 132;
        const h = canvas.height || 132;
        renderMinimap(ctx, w, h, gameState);
      }
    }

    function toggleLock() { state.lockOn = !state.lockOn; return state.lockOn; }
    function setLock(on) { state.lockOn = !!on; return state.lockOn; }
    function camera() { return state.camera; }
    function stats() { return state.lastStats; }
    function isReady() { return !!(state.ready && state.enabled); }
    function setEnabled(on) { state.enabled = !!on; return state.enabled; }
    function themeId() { return state.theme.id; }

    return {
      attach: attach,
      resize: resize,
      render: render,
      setPalette: setPalette,
      setTimeOfDay: setTimeOfDay,
      setQuality: setQuality,
      setLock: setLock,
      toggleLock: toggleLock,
      drawPreviewHero: drawPreviewHero,
      renderMinimap: renderMinimap,
      tickHud: tickHud,
      updateHud: updateHud,
      camera: camera,
      painter: state.painter,
      stats: stats,
      isReady: isReady,
      setEnabled: setEnabled,
      themeId: themeId,
      qualityPresets: QUALITY_PRESETS,
      state: state,
      DAY_SECONDS: DAY_SECONDS
    };
  })();

  root.MytharaRender3D = Render3D;
  if (typeof module !== 'undefined' && module.exports) module.exports = Render3D;

})(typeof globalThis !== 'undefined' ? globalThis : this);
