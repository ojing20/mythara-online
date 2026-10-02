/* ============================================================
 * Mythara Online — js/battle.js
 * ------------------------------------------------------------
 * Drives every fight on the canvas playfield:
 *   • Adventure stages — 4 mob waves + a final wave, or a boss
 *     encounter with phases, adds and telegraphed specials.
 *   • Arena — a 1v1 duel against a BOT-controlled opponent
 *     (this is not online multiplayer; it is AI-only).
 *
 * The engine (game.js) owns movement, damage and rendering; this
 * module owns fight structure, objectives, stars, rewards and the
 * arena opponent's decision making.
 * ============================================================ */
(function (root) {
  'use strict';

  const Core = root.MytharaCore;
  const Enemies = root.MYTHARA_ENEMIES;
  const Stages = root.MYTHARA_STAGES;
  const Items = root.MYTHARA_ITEMS;
  const Mythara = root.Mythara;
  const Account = root.MytharaAccount ? root.MytharaAccount.Account : null;

  const Bus = Core.Bus;
  const Rng = Core.Rng;
  const Format = Core.Format;

  const Battle = (function () {
    /** Live fight state (null when not in a battle). */
    let fight = null;
    let systemRegistered = false;

    function game() { return Mythara.Game; }
    function engineState() { return Mythara.Game.state; }

    /* ============================================================
     * Shared fight lifecycle
     * ========================================================== */
    function beginFight(config) {
      const Game = game();
      const state = engineState();

      fight = {
        kind: config.kind,                 // 'stage' | 'arena'
        stage: config.stage || null,
        difficulty: config.difficulty || null,
        arena: config.arena || null,
        waveIndex: 0,
        waveLabel: '',
        totalWaves: 0,
        startedAt: Date.now(),
        elapsedMs: 0,
        lowHpPct: 1,
        deaths: 0,
        revivedOnce: false,
        potionsUsed: 0,
        damageTaken: 0,
        damageDealt: 0,
        kills: 0,
        finished: false,
        running: true
      };

      Game.setMode(config.kind === 'arena' ? 'arena' : (config.stage && config.stage.isBoss ? 'boss' : 'stage'), fight);
      Game.clearEnemies();
      Game.rearmBattleProgress();

      // route kill payouts into the saved account
      state.rewardSink = function (payload) {
        if (!fight || fight.finished) return;
        Account.addCoins(payload.coins);
        Account.addExp(Math.round(payload.xp * 0.6));
        const active = Account.activeCharacterId();
        Account.addCharacterExp(active, payload.xp);
        fight.kills += 1;
        if (payload.isBoss) Account.profile().stats.bossesDefeated += 1;
      };

      bindEngineEvents();
      Bus.emit('battle:start', { fight: fight, stage: fight.stage, kind: fight.kind });
      return fight;
    }

    /* ============================================================
     * Adventure stages
     * ========================================================== */
    function startStage(stageId) {
      const stage = Stages.stage(stageId);
      if (!stage) return { ok: false, error: 'Unknown stage.' };
      if (!Account.stageUnlocked(stageId)) return { ok: false, error: 'Clear the previous stage first.' };
      if (!Account.spendEnergy(stage.energy)) return { ok: false, error: 'Not enough energy (needs ' + stage.energy + ').' };

      preparePlayer();
      const fight_ = beginFight({ kind: 'stage', stage: stage });
      fight_.totalWaves = stage.waves.length;
      spawnWave(0);
      Bus.emit('battle:ready', { fight: fight_ });
      return { ok: true, fight: fight_ };
    }

    /** Rebuild the player actor from the saved account (level + equipment). */
    function preparePlayer() {
      const Game = game();
      const classId = Account.activeCharacterId();
      const characterState = Account.character(classId) || { level: 1 };
      const player = Game.createCharacter({
        classId: classId,
        name: Account.profile().characterName || 'Jingle',
        level: characterState.level,
        equipmentBonus: Account.equipmentBonuses()
      });
      return player;
    }

    function spawnWave(index) {
      const Game = game();
      const state = engineState();
      if (!fight || !fight.stage) return;

      const wave = fight.stage.waves[index];
      if (!wave) return;

      fight.waveIndex = index;
      fight.waveLabel = wave.label;

      const spawnPoints = formation(wave.enemies, index);
      let cursor = 0;
      const created = [];

      wave.enemies.forEach(function (entry) {
        const enemyDef = Enemies.get(entry.id);
        if (!enemyDef) return;
        for (let i = 0; i < entry.count; i++) {
          const point = spawnPoints[cursor % spawnPoints.length];
          cursor += 1;
          const enemy = Game.createEnemy(enemyDef, fight.stage.level, {
            boss: !!entry.boss || enemyDef.tier === 'boss',
            spawn: { x: point.x, y: point.y }
          });
          if (!enemy) continue;
          if (enemy.isBoss) {
            enemy.name = enemyDef.name;
            Bus.emit('battle:boss', { monster: enemy });
          }
          created.push(enemy);
        }
      });

      Game.spawnEnemies(created);
      Game.rearmBattleProgress();
      state.waveIndex = index;
      Bus.emit('battle:wave', { index: index, total: fight.stage.waves.length, label: wave.label, isBoss: !!wave.boss, enemies: created });
      return created;
    }

    /** Spread enemies so they do not stack on top of each other. */
    function formation(entries, waveIndex) {
      const total = entries.reduce(function (sum, entry) { return sum + entry.count; }, 0);
      const points = [];
      const startX = Math.min(760, 520 + waveIndex * 18);
      for (let i = 0; i < total; i++) {
        const col = i % 4;
        const row = Math.floor(i / 4);
        points.push({
          x: Math.max(120, startX + col * 82 - row * 14) + Rng.int(-14, 14),
          y: 320 + row * 62 + Rng.int(-12, 12)
        });
      }
      return Rng.shuffle(points);
    }

    /* ============================================================
     * Arena — 1v1 against a bot
     * ========================================================== */
    function startArena(difficultyId) {
      const difficulty = Enemies.arenaDifficulty(difficultyId);
      const playerLevel = (Account.character(Account.activeCharacterId()) || { level: 1 }).level;
      const botLevel = Math.max(1, playerLevel + difficulty.levelOffset);
      const bot = createBot(botLevel, difficulty);

      const fight_ = beginFight({ kind: 'arena', difficulty: difficulty, arena: { bot: bot, ratingBefore: Account.profile().pvp.rating } });
      fight_.totalWaves = 1;
      fight_.waveLabel = 'Duel';
      fight_.arena.bot = bot;

      game().spawnEnemies([bot]);
      game().rearmBattleProgress();
      Bus.emit('battle:wave', { index: 0, total: 1, label: 'Duel', isBoss: false, enemies: [bot] });
      return { ok: true, fight: fight_ };
    }

    /** Build the AI opponent from a random class kit. */
    function createBot(level, difficulty) {
      const Game = game();
      const classIds = Object.keys(Mythara.Classes);
      const classId = Rng.pick(classIds);
      const classDef = Mythara.Classes[classId];

      const bot = Game.createEnemy(
        {
          id: 'arenaBot',
          name: 'Rival ' + classDef.name,
          body: 'humanoid',
          tier: 'elite',
          size: 1,
          base: { maxHp: 120, attack: 9, defense: 3, speed: 150, xp: 0, coins: 0 },
          palette: { primary: classDef.look.primary, secondary: classDef.look.secondary, dark: classDef.look.cloth, eye: '#ff9aa2' }
        },
        level,
        { spawn: { x: 700, y: 380 }, reward: false }
      );

      bot.kind = 'duelist';
      bot.isDuelist = true;
      bot.name = 'Rival ' + classDef.name;
      bot.title = classDef.name;
      bot.classId = classId;
      bot.look = classDef.look;
      bot.attackType = classDef.attackType;
      bot.radius = 16;
      bot.speed = Math.round((classDef.base.speed || 180) * difficulty.ai.speedPct);
      bot.def.attackRange = 20;
      bot.def.aggroRange = 900;
      bot.isBoss = false;
      bot.skills = (classDef.skillIds || []).map(function (id) { return Mythara.DATA.getSkill(id); }).filter(Boolean);
      bot.skillCooldowns = {};
      bot.ai = Object.assign({
        thinkMs: 0,
        mode: 'approach',
        strafeDir: Rng.chance(0.5) ? 1 : -1,
        strafeMs: 0,
        ultimateReady: true
      }, difficulty.ai);
      bot.ai = Object.assign(bot.ai, difficulty.ai);
      bot.difficulty = difficulty;
      bot.facing = { x: -1, y: 0 };
      bot.moving = false;
      bot.walkPhase = 0;
      bot.anim = { state: 'idle', t: 0, durationMs: 0, progress: 0 };
      return bot;
    }

    /* ============================================================
     * Engine event wiring
     * ========================================================== */
    let bound = false;
    function bindEngineEvents() {
      if (bound) return;
      bound = true;

      Bus.on('battle:cleared', function () {
        if (!fight || !fight.running || fight.finished) return;

        if (fight.kind === 'arena') { endFight(true); return; }

        const nextIndex = fight.waveIndex + 1;
        if (nextIndex < fight.stage.waves.length) {
          spawnWave(nextIndex);
        } else {
          endFight(true);
        }
      });

      Bus.on('battle:playerDown', function () {
        if (!fight || !fight.running || fight.finished) return;
        fight.deaths += 1;

        // one "second wind" keeps a rough run alive — and caps it at 1 star
        if (!fight.revivedOnce) {
          fight.revivedOnce = true;
          const player = engineState().player;
          player.downed = false;
          player.hp = Math.round(player.maxHp * 0.35);
          player.mp = Math.round(player.maxMp * 0.5);
          player.respawnTimer = 0;
          player.hurtTimer = 0;
          Mythara.Anim.set(player, 'idle');
          Mythara.Effects.burst(player.pos.x, player.pos.y - 10, '#ffe9a8', 30, { speedMax: 200, lift: 90 });
          Mythara.Effects.showBanner('Second Wind!');
          Mythara.Log.push('Second wind! ' + player.name + ' fights on at 35% HP.', 'log--level');
          Bus.emit('battle:revive', { fight: fight });
          return;
        }
        endFight(false);
      });

      Bus.on('arena:botDown', function () {
        if (fight && fight.kind === 'arena' && fight.running) endFight(true);
      });
    }

    /* ============================================================
     * Per-frame update for arena AI (registered as an engine system)
     * ========================================================== */
    function registerSystem() {
      if (systemRegistered) return;
      systemRegistered = true;
      game().registerSystem({
        update: function (dt) {
          if (!fight || !fight.running || fight.finished) return;
          fight.elapsedMs += dt * 1000;
          trackPlayerState(dt);
          if (fight.kind === 'arena' && fight.arena && fight.arena.bot) updateBot(fight.arena.bot, dt);
        }
      });
    }

    function trackPlayerState(dt) {
      const player = engineState().player;
      if (!player) return;
      const ratio = player.maxHp ? player.hp / player.maxHp : 0;
      if (ratio < fight.lowHpPct) fight.lowHpPct = ratio;
      void dt;
    }

    /* ---------------- bot brain ---------------- */
    function updateBot(bot, dt) {
      const state = engineState();
      const player = state.player;
      if (!bot.alive || !player) return;

      bot.hitFlash = Math.max(0, bot.hitFlash - dt * 3);
      bot.attackAnim = Math.max(0, bot.attackAnim - dt * 4);
      bot.attackCooldown = Math.max(0, bot.attackCooldown - dt * 1000);
      Object.keys(bot.skillCooldowns).forEach(function (key) {
        bot.skillCooldowns[key] = Math.max(0, bot.skillCooldowns[key] - dt * 1000);
      });
      if (bot.telegraphMs > 0) {
        bot.telegraphMs -= dt * 1000;
        if (bot.telegraphMs <= 0 && bot.telegraph) {
          resolveBotSkill(bot, bot.telegraph, player);
          bot.telegraph = null;
        }
        return;
      }

      Mythara.Statuses.update(bot, dt);
      if (Mythara.Statuses.isIncapacitated(bot)) return;

      const distance = Math.hypot(player.pos.x - bot.pos.x, player.pos.y - bot.pos.y);
      const reach = bot.radius + player.radius + 20;
      const speedMul = Mythara.Statuses.speedMultiplier(bot);
      const ranged = bot.attackType === 'ranged';
      const preferred = ranged ? 240 : 0;

      bot.ai.thinkMs -= dt * 1000;
      if (bot.ai.thinkMs <= 0) {
        bot.ai.thinkMs = bot.ai.reactionMs || 450;
        decide(bot, player, distance);
      }

      // movement
      let moveX = 0, moveY = 0;
      if (bot.ai.mode === 'approach') {
        const target = ranged ? preferred : reach * 0.8;
        if (distance > target + 20) { moveX = player.pos.x - bot.pos.x; moveY = player.pos.y - bot.pos.y; }
        else if (distance < target - 40) { moveX = bot.pos.x - player.pos.x; moveY = bot.pos.y - player.pos.y; }
      } else if (bot.ai.mode === 'strafe') {
        moveX = -(player.pos.y - bot.pos.y) * bot.ai.strafeDir;
        moveY = (player.pos.x - bot.pos.x) * bot.ai.strafeDir;
      } else if (bot.ai.mode === 'retreat') {
        moveX = bot.pos.x - player.pos.x;
        moveY = bot.pos.y - player.pos.y;
        bot.ai.strafeMs -= dt * 1000;
        if (bot.ai.strafeMs <= 0) bot.ai.mode = 'approach';
      }

      const length = Math.hypot(moveX, moveY);
      if (length > 4) {
        const step = bot.speed * speedMul * dt;
        bot.pos.x += (moveX / length) * Math.min(step, length);
        bot.pos.y += (moveY / length) * Math.min(step, length);
        bot.walkPhase += dt * 9;
        bot.moving = true;
        if (!Mythara.Anim.isBusy(bot)) Mythara.Anim.set(bot, 'run');
      } else {
        bot.moving = false;
        if (!Mythara.Anim.isBusy(bot)) Mythara.Anim.set(bot, 'idle');
      }
      bot.facing = { x: player.pos.x - bot.pos.x, y: player.pos.y - bot.pos.y };
      Mythara.Anim.update(bot, dt, bot.moving ? 'walk' : 'idle');

      // keep the bot inside the arena and out of the player's body
      clampEntity(bot);
      if (distance < bot.radius + player.radius) {
        const push = (bot.radius + player.radius - distance) / (distance || 1);
        bot.pos.x += (bot.pos.x - player.pos.x) * push;
        bot.pos.y += (bot.pos.y - player.pos.y) * push;
      }

      // basic attack
      if (distance <= reach + (ranged ? 240 : 0) && bot.attackCooldown <= 0) {
        botBasicAttack(bot, player, distance, reach);
      }
    }

    function decide(bot, player, distance) {
      const ai = bot.ai;
      const reach = bot.radius + player.radius + 20;

      // dodge a telegraphed player attack
      const playerWindingUp = player.anim && (player.anim.state === 'attack' || player.anim.state === 'skill' || player.anim.state === 'ultimate');
      if (playerWindingUp && distance < 140 && Rng.chance(ai.dodgeChance)) {
        bot.ai.mode = 'strafe';
        bot.ai.strafeDir = Rng.chance(0.5) ? 1 : -1;
        bot.ai.strafeMs = 420;
        return;
      }

      // ultimate
      const ultimate = bot.skills.filter(function (skill) { return skill.ultimate; })[0];
      if (ultimate && (bot.skillCooldowns[ultimate.id] || 0) <= 0 && Rng.chance(ai.ultimateChance) && distance < (bot.attackType === 'ranged' ? 420 : 260)) {
        startBotSkill(bot, ultimate);
        return;
      }

      // regular skills
      const ready = bot.skills.filter(function (skill) { return (bot.skillCooldowns[skill.id] || 0) <= 0; });
      if (ready.length && Rng.chance(ai.skillChance)) {
        startBotSkill(bot, Rng.pick(ready));
        return;
      }

      // heals when hurt
      const hurt = bot.hp / bot.maxHp < 0.4;
      if (hurt && Rng.chance(0.6)) {
        const healSkill = bot.skills.filter(function (skill) { return skill.kind === 'heal' && (bot.skillCooldowns[skill.id] || 0) <= 0; })[0];
        if (healSkill) { startBotSkill(bot, healSkill); return; }
      }

      if (distance > (bot.attackType === 'ranged' ? 300 : reach + 30)) bot.ai.mode = 'approach';
      else if (distance < reach * 0.6) bot.ai.mode = Rng.chance(0.4) ? 'retreat' : 'approach';
      else bot.ai.mode = 'approach';
      if (bot.ai.mode === 'retreat') bot.ai.strafeMs = 320;

      void ai.aggression;
    }

    function startBotSkill(bot, skill) {
      bot.skillCooldowns[skill.id] = skill.cooldownMs;
      bot.attackAnim = 1;
      Mythara.Anim.set(bot, skill.ultimate ? 'ultimate' : 'skill', { durationMs: skill.ultimate ? 1500 : 720 });
      bot.telegraph = skill;
      bot.telegraphMs = skill.ultimate ? 900 : 450;
      bot.telegraphTotal = bot.telegraphMs;
      Mythara.Effects.addFloater(bot.pos.x, bot.pos.y - 70, skill.name, { color: '#ff9aa2', size: 13, life: bot.telegraphMs + 200, vy: -8 });
    }

    function resolveBotSkill(bot, skill, player) {
      const params = skill.params || {};
      if (!bot.alive || fight.finished) return;

      if (skill.kind === 'heal') {
        const healed = Math.round(bot.maxHp * (params.percent || 0.3));
        bot.hp = Math.min(bot.maxHp, bot.hp + healed);
        Mythara.Effects.addFloater(bot.pos.x, bot.pos.y - 70, '+' + healed, { color: '#b8f5c0', size: 16 });
        return;
      }
      if (skill.kind === 'buff') {
        bot.attack = Math.round(bot.attack * (1 + ((params.mods && params.mods.attackPct) || 0.15)));
        Mythara.Effects.burst(bot.pos.x, bot.pos.y - 10, '#cbb2ff', 16, { speedMax: 120, lift: 60 });
        Mythara.Effects.addFloater(bot.pos.x, bot.pos.y - 74, skill.name + '!', { color: '#cbb2ff', size: 14, life: 900 });
        return;
      }
      if (skill.kind === 'stealth') {
        Mythara.Effects.burst(bot.pos.x, bot.pos.y - 10, '#9aa6c4', 18, { speedMax: 120, lift: 40 });
        return;
      }
      if (skill.kind === 'projectile' || (bot.attackType === 'ranged' && skill.kind === 'dash')) {
        const def = Mythara.DATA.PROJECTILES[params.projectile || 'arrow'] || Mythara.DATA.PROJECTILES.arrow;
        const angle = Math.atan2(player.pos.y - bot.pos.y, player.pos.x - bot.pos.x);
        const count = params.count || 1;
        for (let i = 0; i < count; i++) {
          const offset = count === 1 ? 0 : (i - (count - 1) / 2) * (params.spread || 0.2);
          Mythara.Projectiles.spawn(def, bot.pos.x, bot.pos.y - 8, angle + offset, {
            hostile: true,
            multiplier: params.multiplier || def.damageMultiplier || 1,
            owner: bot
          });
        }
        return;
      }
      if (skill.kind === 'dash') {
        const angle = Math.atan2(player.pos.y - bot.pos.y, player.pos.x - bot.pos.x);
        const gap = Math.max(0, Math.hypot(player.pos.x - bot.pos.x, player.pos.y - bot.pos.y) - (bot.radius + player.radius));
        bot.pos.x += Math.cos(angle) * Math.min(params.distance || 150, gap);
        bot.pos.y += Math.sin(angle) * Math.min(params.distance || 150, gap);
        Mythara.Effects.burst(bot.pos.x, bot.pos.y - 8, '#cfe0ff', 14, { speedMax: 90 });
        damagePlayerFrom(bot, params.multiplier || 1.4, skill.name);
        clampEntity(bot);
        return;
      }

      // melee strike / area / inflict style skills
      const radius = params.radius || 70;
      const distance = Math.hypot(player.pos.x - bot.pos.x, player.pos.y - bot.pos.y);
      Mythara.Effects.burst(bot.pos.x, bot.pos.y - 8, params.color || '#ffb347', 20, { speedMax: 200, lift: 50 });
      if (distance <= radius + player.radius) {
        damagePlayerFrom(bot, params.multiplier || 1.5, skill.name);
        if (params.apply) {
          Mythara.Statuses.apply(player, params.apply, bot, {});
        }
      }
    }

    function botBasicAttack(bot, player, distance, reach) {
      bot.attackCooldown = 900 - (bot.difficulty ? bot.difficulty.levelOffset * 20 : 0);
      bot.attackAnim = 1;
      Mythara.Anim.set(bot, 'attack', { durationMs: 400 });

      const rangedReach = bot.attackType === 'ranged' ? 260 : 0;
      if (distance > reach + rangedReach) return;

      if (bot.attackType === 'ranged') {
        const def = Mythara.DATA.PROJECTILES[(Mythara.DATA.getClass(bot.classId) || {}).basicProjectile || 'arrow'];
        if (def) {
          const angle = Math.atan2(player.pos.y - bot.pos.y, player.pos.x - bot.pos.x);
          Mythara.Projectiles.spawn(def, bot.pos.x, bot.pos.y - 8, angle, {
            hostile: true,
            multiplier: def.damageMultiplier || 1,
            owner: bot
          });
        }
        return;
      }
      damagePlayerFrom(bot, 1, null);
    }

    /** Shared damage application from the bot to the player actor. */
    function damagePlayerFrom(bot, multiplier, skillName) {
      const player = engineState().player;
      if (!player || player.downed || fight.finished) return;
      if (Rng.chance(player.evasion || 0)) {
        Mythara.Effects.addFloater(player.pos.x, player.pos.y - 64, 'MISS', { color: '#bfefff', size: 16, life: 700 });
        return;
      }
      const result = Mythara.Combat.rollDamage(bot, player, { multiplier: multiplier });
      const damage = Mythara.Combat.mitigate(player, result.damage);
      player.hp = Math.max(0, player.hp - damage);
      player.hitFlash = 1;
      player.hurtTimer = Mythara.DATA.COMBAT.outOfCombatRegenDelayMs;
      Mythara.Anim.set(player, 'hurt');
      fight.damageTaken += damage;

      Mythara.Effects.addFloater(player.pos.x, player.pos.y - 64, '-' + damage, { color: '#ff8080', size: 18 });
      Mythara.Effects.burst(player.pos.x, player.pos.y - 6, '#ff9b9b', 6);
      Mythara.Effects.addShake(3);
      if (skillName) Mythara.Log.push(bot.name + ' hits ' + player.name + ' with ' + skillName + ' for ' + damage + ' damage.', 'log--hurt');
      if (player.hp <= 0) Mythara.Game.knockDownPlayer(player);
    }

    function clampEntity(entity) {
      const world = Mythara.DATA.CONFIG.world;
      entity.pos.x = Core.clamp(entity.pos.x, world.margin, world.width - world.margin);
      entity.pos.y = Core.clamp(entity.pos.y, (world.floorTop || world.margin), world.height - world.margin);
    }

    /* ============================================================
     * Ending a fight
     * ========================================================== */
    function endFight(victory) {
      if (!fight || fight.finished) return null;
      fight.finished = true;
      fight.running = false;

      const summary = {
        kind: fight.kind,
        victory: !!victory,
        elapsedMs: fight.elapsedMs,
        kills: fight.kills,
        deaths: fight.deaths,
        potionsUsed: fight.potionsUsed,
        lowHpPct: fight.lowHpPct,
        stars: 0,
        rewards: null,
        stage: fight.stage,
        difficulty: fight.difficulty,
        ratingChange: 0,
        ratingAfter: null
      };

      if (fight.kind === 'stage') {
        if (victory) {
          summary.stars = computeStars(fight);
          summary.rewards = grantStageRewards(fight.stage, summary.stars, fight);
          Account.recordStageClear(fight.stage.id, { stars: summary.stars, timeMs: fight.elapsedMs });
        } else {
          summary.rewards = { coins: Math.round(fight.stage.rewards.coins * 0.15), xp: Math.round(fight.stage.rewards.xp * 0.15), gems: 0, materials: [] };
          Account.addCoins(summary.rewards.coins);
          Account.addExp(Math.round(summary.rewards.xp * 0.6));
          Account.addCharacterExp(Account.activeCharacterId(), summary.rewards.xp);
        }
        Mythara.Log.push(victory
          ? 'Stage cleared! ' + summary.stars + '★ — ' + fight.stage.name
          : 'Defeat... ' + fight.stage.name + ' remains unconquered.', victory ? 'log--kill' : 'log--down');
      }

      if (fight.kind === 'arena') {
        const difficulty = fight.difficulty;
        const ratingChange = victory ? difficulty.rating : Math.round(difficulty.rating * 0.6);
        Account.recordPvp({ won: victory, rating: ratingChange, difficulty: difficulty.id });
        summary.ratingChange = victory ? ratingChange : -ratingChange;
        summary.ratingAfter = Account.profile().pvp.rating;
        const scale = victory ? 1 : 0.25;
        summary.rewards = {
          coins: Math.round(difficulty.rewards.coins * scale),
          xp: Math.round(difficulty.rewards.xp * scale),
          gems: Math.round(difficulty.rewards.gems * scale),
          materials: victory ? [{ id: 'upgradeStone', count: 1 }] : []
        };
        Account.addCoins(summary.rewards.coins);
        Account.addGems(summary.rewards.gems);
        Account.addExp(Math.round(summary.rewards.xp * 0.6));
        Account.addCharacterExp(Account.activeCharacterId(), summary.rewards.xp);
        summary.rewards.materials.forEach(function (entry) { Account.addMaterial(entry.id, entry.count); });
      }

      engineState().rewardSink = null;
      Account.save();
      Bus.emit('battle:end', summary);
      return summary;
    }

    /**
     * Star rules:
     *   3★ — cleared without falling, never dropped below 70% HP
     *   2★ — cleared without falling
     *   1★ — cleared, but only after using the one Second Wind revive
     */
    function computeStars(fight) {
      if (fight.deaths === 0 && fight.lowHpPct >= 0.7) return 3;
      if (fight.deaths === 0) return 2;
      return 1;
    }

    function grantStageRewards(stage, stars, fight) {
      const record_ = Account.stageRecord(stage.id);
      const firstClear = record_.clears === 0;
      const starMultiplier = 0.7 + stars * 0.2;          // 1★ = 0.9, 3★ = 1.3
      const rewards = {
        coins: Math.round(stage.rewards.coins * starMultiplier),
        xp: Math.round(stage.rewards.xp * starMultiplier),
        gems: stage.rewards.gems + (firstClear ? 10 : 0) + (stars === 3 ? 5 : 0),
        materials: stage.rewards.materials.map(function (entry) {
          return { id: entry.id, count: Math.max(1, Math.round(entry.count * (0.8 + stars * 0.2))) };
        }),
        tickets: (stage.rewards.tickets || 0) + (firstClear && stage.isBoss ? 1 : 0),
        equipment: null
      };

      Account.addCoins(rewards.coins);
      Account.addGems(rewards.gems);
      if (rewards.tickets) Account.addTickets(rewards.tickets);
      Account.addExp(Math.round(rewards.xp * 0.6));
      Account.addCharacterExp(Account.activeCharacterId(), rewards.xp);
      Account.addMaterial('upgradeStone', stage.isBoss ? 3 : 1);
      rewards.materials.forEach(function (entry) { Account.addMaterial(entry.id, entry.count); });

      // equipment drops scale with stars and chapter
      const dropChance = stage.rewards.equipmentChance * (0.6 + stars * 0.25);
      const drops = [];
      if (Rng.chance(dropChance)) {
        const item = Account.rollItem({
          minRarity: stage.isBoss ? (stage.chapterIndex >= 6 ? 'epic' : 'rare') : null
        });
        if (item) drops.push(item);
      }
      if (firstClear && stage.isBoss) {
        const bonus = Account.rollItem({ minRarity: 'rare' });
        if (bonus) drops.push(bonus);
      }
      rewards.equipment = drops;
      rewards.firstClear = firstClear;
      rewards.starMultiplier = starMultiplier;
      void fight;
      return rewards;
    }

    /* ============================================================
     * In-battle helpers used by the UI
     * ========================================================== */
    function usePotion(potionId) {
      if (!fight || fight.finished) return { ok: false, error: 'Not in a battle.' };
      const result = Account.usePotion(potionId, engineState().player);
      if (result.ok) {
        fight.potionsUsed += 1;
        Mythara.Effects.addFloater(engineState().player.pos.x, engineState().player.pos.y - 84,
          result.potion.name, { color: result.potion.color, size: 14, life: 900 });
        Bus.emit('battle:potion', { id: potionId, result: result });
      }
      return result;
    }

    /** Abandon the current fight (no rewards, energy already spent). */
    function leave() {
      if (!fight) return false;
      fight.running = false;
      fight.finished = true;
      const state = engineState();
      state.rewardSink = null;
      Mythara.Game.setMode('free', null);
      Mythara.Game.clearEnemies();
      Bus.emit('battle:left', { fight: fight });
      fight = null;
      return true;
    }

    function current() { return fight; }
    function isActive() { return !!(fight && fight.running && !fight.finished); }
    function waveInfo() {
      if (!fight) return null;
      return { index: fight.waveIndex + 1, total: fight.totalWaves, label: fight.waveLabel };
    }
    function boss() {
      return (engineState().monsters || []).filter(function (m) { return m.isBoss && m.alive; })[0] || null;
    }
    function elapsedSeconds() { return fight ? fight.elapsedMs / 1000 : 0; }

    return {
      startStage: startStage,
      startArena: startArena,
      registerSystem: registerSystem,
      usePotion: usePotion,
      leave: leave,
      current: current,
      isActive: isActive,
      waveInfo: waveInfo,
      boss: boss,
      elapsedSeconds: elapsedSeconds,
      computeStars: computeStars,
      preparePlayer: preparePlayer,
      _endFight: endFight,           // test hook
      _spawnWave: spawnWave
    };
  })();

  root.MytharaBattle = Battle;
  if (typeof module !== 'undefined' && module.exports) module.exports = Battle;

})(typeof globalThis !== 'undefined' ? globalThis : this);
