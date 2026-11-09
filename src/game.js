// Game orchestration: state machine (start → playing → paused/gameover/victory),
// wave spawning, hit resolution between fighters, camera, particles and scoring.
// This file has no DOM access so the whole simulation can run in tests.
import { VIEW_W, WORLD_WIDTH, GROUND_Y, DEPTH, DEPTH_REACH, SHURIKEN_SPEED, screenY, PHYSICS, SCORE, KIAI, COMBO, GRAB, AUTO_BLOCK } from './constants.js';
import { Player, Enemy, separate } from './entities.js';
import { Spawner, LEVEL_1, totalEnemies } from './level.js';
import { ATTACKS, resolveHit } from './combat.js';

const NO_INPUT = { left: false, right: false, up: false, down: false, duck: false, block: false, jump: false, punch: false, kick: false, kiai: false };
const NULL_UI = { showOverlay() {}, setHud() {}, showDialogue(lines, done) { done(); } };

// Exchange shown immediately before the final battle.
export const KAGE_DIALOGUE = [
  ['TAMAS: DU DITT SVIN SOM ÄTER', 'MAKRILL I KLUBBEN.'],
  ['TAMAS: DU ÄR INTE VÄLKOMMEN', 'I LOKALEN.'],
  ['MASTER KAGE: POWER CREATES RESPECT.'],
  ['TAMAS: DET ÄR JÄVLA SHIT.', 'RESPEKT SKAPAR KRAFT.'],
];
// What Tamas says on arriving in a zone, keyed by the zone's art; shown once the door transition ends.
export const ZONE_CARDS = {
  dojo: [['TAMAS: DET HÄR ÄR MIN LOKAL.', 'DRA TILLBAKA BENET. GÅ.']],
};
const NULL_AUDIO = { play() {} };

// How far inside the screen edge enemies must stay once they have walked in.
const ENEMY_MARGIN = 8;

// Door transition: how near the back wall counts as reaching the door, and how long each part takes.
const DOOR_REACH_Z = 10;
const DOOR_HINT_DISTANCE = 100;
const DOOR_WALK_TIME = 1.2;
const DOOR_FADE_TIME = 0.4;
const ARRIVE_X = 30;      // where the player appears inside the next zone
const ARRIVE_Z = 8;

// Where floating text and particles appear, in screen coordinates.
const feet = (f) => screenY(f.y, f.z);

export class Game {
  constructor({ input, audio = NULL_AUDIO, ui = NULL_UI, reducedMotion = false, rng = Math.random, level = LEVEL_1 }) {
    this.input = input;
    this.audio = audio;
    this.ui = ui;
    this.reducedMotion = reducedMotion;
    this.rng = rng;
    this.level = level;
    this.state = 'start';   // start | playing | dialogue | paused | gameover | victory
    this.reset();
  }

  reset() {
    this.player = new Player(90);
    this.enemies = [];
    this.projectiles = [];  // shuriken in flight: { x, y, z, facing }
    this.spawner = new Spawner(this.level);
    this.score = 0;
    this.elapsed = 0;
    this.defeated = 0;
    this.particles = [];
    this.texts = [];
    this.camX = 0;
    this.shake = 0;
    this.banner = null;
    this.boss = null;
    this.ending = null;     // 'victory' | 'gameover' while the end animation plays
    this.endTimer = 0;
    this.bonus = null;
    this.combo = 0;         // consecutive hits landed without taking damage
    this.zoneIndex = 0;
    this.transition = null; // { phase, t } while walking through a door into the next zone
    this.fade = 0;          // 0 = clear, 1 = black screen
  }

  get zone() {
    return this.level.zones?.[this.zoneIndex] ?? null;
  }

  // The door out of this zone, once every fight in the zone has been won; otherwise null.
  get openExit() {
    const zone = this.zone;
    if (!zone?.exit || this.spawner.active) return null;
    const next = this.level.waves[this.spawner.waveIndex];
    return !next || next.x >= zone.to ? zone.exit : null;
  }

  // Score multiplier earned by the current combo.
  get comboMultiplier() {
    for (const [hits, mult] of COMBO.tiers) if (this.combo >= hits) return mult;
    return 1;
  }

  get remainingEnemies() {
    return totalEnemies(this.level) - this.defeated;
  }

  // True while the way ahead is open and the player should keep walking.
  get showGo() {
    if (this.state !== 'playing' || this.ending || this.transition || this.elapsed <= 2.2) return false;
    if (this.spawner.active || this.spawner.finished) return false;
    // Close to an open door the arrow over the door takes over.
    const exit = this.openExit;
    return !(exit && this.player.x > exit.x - DOOR_HINT_DISTANCE);
  }

  start() {
    this.reset();
    this.state = 'playing';
    if (this.input) { this.input.active = true; this.input.reset(); }
    this.ui.showOverlay(null);
    if (this.level.zones?.length) this.banner = { text: this.level.zones[0].name, life: 2 };
    this.audio.play('start');
    this.syncHud(true);
  }

  pause() {
    if (this.state !== 'playing' || this.ending) return;
    this.state = 'paused';
    if (this.input) this.input.reset();
    this.ui.showOverlay('paused');
    this.audio.play('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    if (this.input) this.input.reset();
    this.ui.showOverlay(null);
  }

  togglePause() {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  // One fixed simulation step. `inputOverride` lets tests drive the player.
  step(dt, inputOverride = null) {
    if (this.state !== 'playing') return;
    this.elapsed += dt;
    const p = this.player;
    if (this.transition) {
      this.stepTransition(dt);
      this.updateEffects(dt);
      this.syncHud();
      return;
    }
    const snap = this.ending ? NO_INPUT : (inputOverride || (this.input ? this.input.snapshot() : NO_INPUT));

    // The player can never leave the visible part of the level or walk out of the zone.
    p.minX = this.camX + 10;
    p.maxX = Math.min(this.camX + VIEW_W, this.zone?.to ?? WORLD_WIDTH) - 10;
    p.update(dt, snap, this.guardContext());
    this.consumeEvent(p);

    const alive = this.enemies.filter((e) => !e.dead).length;
    const waveWasActive = Boolean(this.spawner.active);
    for (const s of this.spawner.update(dt, { playerX: p.x, alive })) this.spawn(s);
    if (waveWasActive && !this.spawner.active && !this.spawner.finished) this.audio.play('start');

    for (const e of this.enemies) {
      this.confineEnemy(e);
      e.update(dt, p);
      this.consumeEvent(e);
    }

    // Keep fighters from standing inside each other.
    for (const e of this.enemies) separate(p, e, 11);
    for (let i = 0; i < this.enemies.length; i++) {
      for (let j = i + 1; j < this.enemies.length; j++) separate(this.enemies[i], this.enemies[j], 9);
    }
    p.x = Math.min(p.maxX, Math.max(p.minX, p.x));

    this.updateThrow();
    this.resolveCombat();
    this.updateProjectiles(dt);

    for (const e of this.enemies) {
      if (e.dead && e.deadTimer > PHYSICS.deathLingerTime) e.remove = true;
    }
    this.enemies = this.enemies.filter((e) => !e.remove);

    this.updateCamera(dt);
    this.checkExit();
    this.updateEffects(dt);
    this.checkEnd(dt);
    this.syncHud();
  }

  // What the player is squared up against, for blocking by holding back:
  //  nearDir   (1, -1 or 0): an enemy is close in front, so holding away walks backward without turning;
  //  threatDir (1, -1 or 0): a strike or star is about to land from the front, so holding away blocks it.
  guardContext() {
    const p = this.player;
    const inFront = (x) => Math.sign(x - p.x) === p.facing;
    let nearDir = 0, threatDir = 0;
    for (const e of this.enemies) {
      if (e.dead || e.held || e.thrown || e.down || !inFront(e.x) || Math.abs(e.z - p.z) > DEPTH_REACH) continue;
      if (Math.abs(e.x - p.x) >= AUTO_BLOCK.strikeRange) continue;
      nearDir = p.facing;
      if (e.attack && e.attackPhase !== 'recovery' && !ATTACKS[e.attack.name].ranged) threatDir = p.facing;
    }
    for (const s of this.projectiles) {
      const towards = Math.sign(p.x - s.x) === s.facing;
      if (towards && inFront(s.x) && Math.abs(s.z - p.z) <= DEPTH_REACH) { nearDir = p.facing; threatDir = p.facing; }
    }
    return { nearDir, threatDir };
  }

  // Walking up to an open door starts the way through it.
  checkExit() {
    const exit = this.openExit;
    const p = this.player;
    if (!exit || this.ending || p.dead || !p.grounded || p.attack) return;
    if (Math.abs(p.x - exit.x) <= exit.width / 2 && p.z <= DOOR_REACH_Z) {
      this.transition = { phase: 'enter', t: 0 };
      if (this.input) this.input.reset();
      this.audio.play('start');
    }
  }

  // Walk into the door, fade to black, appear in the next zone, fade back in.
  stepTransition(dt) {
    const tr = this.transition;
    const p = this.player;
    tr.t += dt;
    if (tr.phase === 'enter') {
      const exit = this.zone.exit;
      const dx = exit.x - p.x;
      p.update(dt, { ...NO_INPUT, up: p.z > 0, right: dx > 2, left: dx < -2 });
      if ((p.z <= 0 && Math.abs(dx) <= 2) || tr.t >= DOOR_WALK_TIME) { tr.phase = 'fadeOut'; tr.t = 0; }
    } else if (tr.phase === 'fadeOut') {
      p.update(dt, NO_INPUT);
      this.fade = Math.min(1, tr.t / DOOR_FADE_TIME);
      if (tr.t >= DOOR_FADE_TIME) {
        this.enterNextZone();
        tr.phase = 'fadeIn';
        tr.t = 0;
      }
    } else {
      // Step into the room while the picture comes back.
      p.update(dt, { ...NO_INPUT, right: true });
      this.fade = Math.max(0, 1 - tr.t / DOOR_FADE_TIME);
      if (tr.t >= DOOR_FADE_TIME) {
        this.fade = 0;
        this.transition = null;
        const card = ZONE_CARDS[this.zone.art];
        if (card) this.startDialogue(card);
      }
    }
  }

  enterNextZone() {
    const p = this.player;
    this.zoneIndex += 1;
    const zone = this.zone;
    this.enemies = [];
    this.projectiles = [];
    this.camX = zone.from;
    p.minX = zone.from + 10;
    p.maxX = zone.from + VIEW_W - 10;
    p.x = zone.from + ARRIVE_X;
    p.z = ARRIVE_Z;
    p.facing = 1;
    this.banner = { text: zone.name, life: 2 };
  }

  updateProjectiles(dt) {
    const p = this.player;
    this.projectiles = this.projectiles.filter((s) => {
      s.x += s.facing * SHURIKEN_SPEED * dt;
      if (s.x < this.camX - 16 || s.x > this.camX + VIEW_W + 16) return false;
      // A star passes through a player who is still blinking from the last hit.
      if (p.dead || p.invulnerable > 0) return true;
      const r = resolveHit(s, p, 'shuriken');
      if (!r.hit) return true;
      this.onEnemyHits(s, r, ATTACKS.shuriken);
      return false;
    });
  }

  // Once on screen an enemy stays there, so a locked fight can always be finished.
  confineEnemy(e) {
    const left = this.camX + ENEMY_MARGIN;
    const right = this.camX + VIEW_W - ENEMY_MARGIN;
    if (e.enterDir && e.x >= left && e.x <= right) e.enterDir = 0;
    if (!e.enterDir) { e.minX = left; e.maxX = right; }
  }

  // The camera only moves forward. It holds still at the wave's lock position during a fight.
  updateCamera(dt) {
    const p = this.player;
    const lock = this.spawner.lockX;
    const target = lock !== null ? lock : p.x - VIEW_W / 2 + p.facing * 14;
    const eased = this.camX + (target - this.camX) * Math.min(1, dt * 5);
    const end = this.zone?.to ?? WORLD_WIDTH;
    this.camX = Math.max(this.camX, Math.min(end - VIEW_W, eased));
  }

  spawn({ side, type }) {
    const p = this.player;
    let x = side === 'left' ? this.camX - 24 : this.camX + VIEW_W + 24;
    x = Math.max(-30, Math.min(WORLD_WIDTH + 30, x));
    const enemy = new Enemy(type, x, x < p.x ? 1 : -1, this.rng, this.rng() * DEPTH);
    enemy.enterDir = side === 'left' ? 1 : -1;
    this.enemies.push(enemy);
    if (enemy.cfg.boss) {
      this.boss = enemy;
      this.banner = { text: 'MASTER KAGE APPROACHES', life: 2.6 };
      this.audio.play('bossAppear');
      this.startDialogue(KAGE_DIALOGUE);
    }
  }

  // Freeze the fight while a short exchange is shown; the UI calls back when it is over.
  startDialogue(lines) {
    this.state = 'dialogue';
    if (this.input) { this.input.active = false; this.input.reset(); }
    this.ui.showDialogue(lines, () => {
      if (this.state !== 'dialogue') return;
      this.state = 'playing';
      if (this.input) { this.input.active = true; this.input.reset(); }
    });
  }

  resolveCombat() {
    const p = this.player;
    if (p.attack && p.attackPhase === 'active' && ATTACKS[p.attack.name].grab) {
      // A grab takes the first fighter it reaches; a fighter already in the air or on the floor cannot be grabbed.
      for (const e of this.enemies) {
        if (e.dead || e.held || !e.grounded || e.down) continue;
        if (!resolveHit(p, e, p.attack.name).hit) continue;
        this.onPlayerGrabs(e);
        break;
      }
    } else if (p.attack && p.attackPhase === 'active' && !ATTACKS[p.attack.name].ranged) {
      const atk = ATTACKS[p.attack.name];
      for (const e of this.enemies) {
        // Fighters in a grip, flying from a throw or lying on the floor are out of reach of strikes.
        if (e.dead || e.held || e.thrown || e.down || p.attack.hits.has(e.id)) continue;
        const r = resolveHit(p, e, p.attack.name);
        if (!r.hit) continue;
        p.attack.hits.add(e.id);
        this.onPlayerHits(e, r, atk);
      }
    }
    for (const e of this.enemies) {
      if (!e.attack || e.attackPhase !== 'active' || e.attack.hits.has(p.id) || p.dead) continue;
      if (ATTACKS[e.attack.name].ranged) continue;
      const r = resolveHit(e, p, e.attack.name);
      if (!r.hit) continue;
      e.attack.hits.add(p.id);
      this.onEnemyHits(e, r, ATTACKS[e.attack.name]);
    }
  }

  onPlayerHits(enemy, r, atk) {
    const p = this.player;
    const kiai = p.kiaiActive;
    // Kiai strikes cannot be blocked: they break the guard instead.
    if (r.blocked && !kiai) {
      enemy.takeHit({ damage: 0, blocked: true, direction: r.direction, knockback: atk.knockback });
      this.audio.play('block');
      this.addText('BLOCK', enemy.x, feet(enemy) - 48, '#9ad1ff');
      return;
    }
    const damage = Math.round(atk.damage * (kiai ? KIAI.damageMultiplier : 1));
    const knockback = atk.knockback * (kiai ? KIAI.knockbackMultiplier : 1);
    enemy.takeHit({ damage, blocked: false, direction: r.direction, knockback });
    enemy.lastEvent = null;
    if (r.blocked) this.addText('BREAK!', enemy.x, feet(enemy) - 52, '#ffb347');

    const mult = this.creditHit(enemy);
    this.score += Math.round(SCORE.hit * mult);
    this.shake = kiai ? 0.18 : 0.12;
    this.audio.play(enemy.dead ? 'enemyDown' : (kiai ? 'hitHeavy' : 'hit'));
    this.burst(enemy.x + r.direction * 4, feet(enemy) - 28, kiai ? '#ffb347' : '#fff3c4', kiai ? 10 : 6);
  }

  // The grab reached an enemy: take the grip. The throw's start-up is the hold.
  onPlayerGrabs(enemy) {
    const p = this.player;
    p.startAttack('throw');
    p.lastEvent = null;
    p.attack.victim = enemy;
    enemy.hold();
    enemy.lastEvent = null;
    this.placeHeld(enemy);
  }

  placeHeld(enemy) {
    const p = this.player;
    enemy.x = p.x + p.facing * GRAB.holdDistance;
    enemy.z = p.z;
    enemy.facing = -p.facing;
  }

  // The held fighter stays in the grip, is let go if the hold is broken (Tamas was hit), and is
  // turned down the moment the throw turns active.
  updateThrow() {
    const p = this.player;
    const held = this.enemies.find((e) => e.held);
    if (!held) return;
    if (!p.attack || p.attack.name !== 'throw' || p.attack.victim !== held) { held.release(); return; }
    if (p.attackPhase === 'startup') { this.placeHeld(held); return; }
    if (!p.attack.released) {
      p.attack.released = true;
      this.onPlayerThrows(held);
    }
  }

  // Throw down: the victim leaves the grip and comes down just in front of the player.
  onPlayerThrows(enemy) {
    const p = this.player;
    const kiai = p.kiaiActive;
    const damage = Math.round(GRAB.damage * (kiai ? KIAI.damageMultiplier : 1));
    enemy.takeThrow({ damage, direction: p.facing, throwSpeed: GRAB.throwSpeed * (kiai ? KIAI.knockbackMultiplier : 1) });
    enemy.lastEvent = null;
    this.addText('THROW!', p.x + p.facing * 6, feet(p) - 50, '#ffb347');
    const mult = this.creditHit(enemy);
    this.score += Math.round(SCORE.hit * 2 * mult);
  }

  // Combo, multiplier text and the points for a beaten enemy; returns the multiplier in force.
  creditHit(enemy) {
    const p = this.player;
    this.combo += 1;
    const prevMult = this.comboMultiplierFor(this.combo - 1);
    const mult = this.comboMultiplier;
    // Tamas names the combo the way he does on the mat.
    if (mult > prevMult) this.addText(prevMult > 1 ? 'DUBBEL TWIST! IGEN!' : 'DUBBEL TWIST!', p.x, feet(p) - 52, '#ffd166');
    if (enemy.dead) {
      this.defeated += 1;
      const points = Math.round(enemy.cfg.score * mult);
      this.score += points;
      this.addText(`+${points}`, enemy.x, feet(enemy) - 46, '#ffd166');
    }
    return mult;
  }

  comboMultiplierFor(hits) {
    for (const [need, mult] of COMBO.tiers) if (hits >= need) return mult;
    return 1;
  }

  onEnemyHits(enemy, r, atk) {
    const p = this.player;
    if (r.blocked) {
      p.takeHit({ damage: 0, blocked: true, direction: r.direction, knockback: atk.knockback });
      this.audio.play('block');
      this.addText('BLOCK', p.x, feet(p) - 48, '#9ad1ff');
      this.burst(p.x + r.direction * -4, feet(p) - 28, '#bfe3ff', 4);
      return;
    }
    const kicking = /kick/i.test(p.attack?.name || '');
    const took = p.takeHit({ damage: r.damage, blocked: false, direction: r.direction, knockback: atk.knockback });
    p.lastEvent = null;
    if (!took) return;
    this.combo = 0;
    // Caught mid-kick: the correction every Sanshin Kan student has heard.
    if (kicking) this.addText('DRA TILLBAKA BENET!', p.x, feet(p) - 56, '#ff8a7a');
    p.invulnerable = PHYSICS.invulnerableTime;
    this.shake = 0.2;
    this.audio.play('hurt');
    this.burst(p.x, feet(p) - 28, '#ff8a7a', 6);
  }

  // Sounds/particles for things fighters notice about themselves (jump, landing).
  consumeEvent(f) {
    const ev = f.lastEvent;
    f.lastEvent = null;
    if (!ev) return;
    if (ev === 'jump' && f === this.player) this.audio.play('jump');
    if (ev === 'sprint') this.burst(f.x, screenY(GROUND_Y, f.z) - 1, '#d9b27c', 5, 0.6);
    // Ground impact of a thrown fighter.
    if (ev === 'slam') {
      this.shake = 0.2;
      this.audio.play(f.dead ? 'enemyDown' : 'hitHeavy');
      this.burst(f.x, screenY(GROUND_Y, f.z) - 1, '#fff3c4', 8, 0.8);
    }
    if (ev === 'throw') {
      this.projectiles.push({ x: f.x + f.facing * 10, y: f.y, z: f.z, facing: f.facing });
      this.audio.play('shuriken');
    }
    if (ev === 'kiai') {
      this.audio.play('kiaiStart');
      this.addText('AJSICH!', f.x, feet(f) - 54, '#ffb347', 2);
      this.burst(f.x, feet(f) - 20, '#ffb347', 12);
    }
    if (ev === 'attack' && f === this.player) {
      if (f.kiaiActive) {
        this.audio.play('kiai');
        this.addText('AJSICH!', f.x + f.facing * 6, feet(f) - 50, '#ffb347');
      } else {
        this.audio.play(/kick/i.test(f.attack?.name || '') ? 'kick' : 'punch');
      }
    }
    if (ev === 'land') {
      if (f === this.player) this.audio.play('land');
      this.burst(f.x, screenY(GROUND_Y, f.z) - 1, '#d9b27c', 4, 0.5);
    }
  }

  burst(x, y, color, count, speed = 1) {
    const n = this.reducedMotion ? Math.ceil(count / 2) : count;
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2;
      const s = (20 + this.rng() * 40) * speed;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30 * speed, life: 0.35 + this.rng() * 0.2, color, size: this.rng() < 0.5 ? 1 : 2 });
    }
  }

  addText(text, x, y, color, scale = 1) {
    this.texts.push({ text, x, y, life: scale > 1 ? 1.1 : 0.8, color, scale });
  }

  updateEffects(dt) {
    for (const pt of this.particles) {
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 160 * dt;
    }
    this.particles = this.particles.filter((pt) => pt.life > 0);
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 18 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    if (this.banner) {
      this.banner.life -= dt;
      if (this.banner.life <= 0) this.banner = null;
    }
    if (this.shake > 0) this.shake -= dt;
  }

  checkEnd(dt) {
    const p = this.player;
    if (!this.ending) {
      if (p.dead) {
        this.ending = 'gameover';
        this.endTimer = 1.7;
        this.audio.play('gameOver');
      } else if (this.boss && this.boss.dead) {
        this.ending = 'victory';
        this.endTimer = 1.7;
        const healthBonus = p.hp * SCORE.healthBonusPerPoint;
        const timeBonus = Math.max(0, Math.round(SCORE.timeBonusLimit - this.elapsed)) * SCORE.timeBonusPerSecond;
        this.bonus = { healthBonus, timeBonus };
        this.score += healthBonus + timeBonus;
        this.audio.play('victory');
      }
      return;
    }
    this.endTimer -= dt;
    if (this.endTimer <= 0) {
      this.state = this.ending;
      if (this.input) this.input.active = false;
      this.ui.showOverlay(this.state, { score: this.score, elapsed: this.elapsed, bonus: this.bonus });
    }
  }

  syncHud(force = false) {
    const boss = this.boss && !this.boss.remove ? { hp: this.boss.hp, maxHp: this.boss.maxHp } : null;
    const p = this.player;
    const kiai = { active: p.kiaiActive, ready: p.kiaiReady && !p.kiaiActive, fraction: p.kiaiFraction };
    this.ui.setHud({ hp: p.hp, maxHp: p.maxHp, score: this.score, remaining: this.remainingEnemies, boss, kiai, combo: this.combo, multiplier: this.comboMultiplier }, force);
  }
}
