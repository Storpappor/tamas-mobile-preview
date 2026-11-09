// Fighters: the shared Fighter base, the Player (input-driven) and Enemy (AI-driven).
// Movement, timers and state machines live here; drawing lives in sprites.js.
import { ATTACKS, attackPhase, attackDuration } from './combat.js';
import { GROUND_Y, WORLD_WIDTH, DEPTH, START_Z, DEPTH_REACH, PHYSICS, PLAYER, KIAI, SPRINT, GRAB } from './constants.js';

let nextId = 1;
const MOVE_DIRS = ['left', 'right', 'up', 'down'];

export class Fighter {
  constructor({ x, z = START_Z, facing = 1, hp = 100, kind = 'fighter' }) {
    this.id = nextId++;
    this.kind = kind;
    this.x = x;
    this.y = GROUND_Y;      // feet height: GROUND_Y when standing, less while airborne
    this.z = z;             // depth on the floor: 0 = back wall, DEPTH = nearest the viewer
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.facing = facing;   // 1 = right, -1 = left
    this.hp = hp;
    this.maxHp = hp;
    this.state = 'idle';    // idle | walk | crouch | jump | attack | block | hurt | dead
    this.stateTime = 0;
    this.attack = null;     // { name, t, hits:Set }
    this.blocking = false;
    this.crouching = false;
    this.grounded = true;
    this.invulnerable = 0;
    this.hurtTimer = 0;
    this.knockVx = 0;
    this.dead = false;
    this.deadTimer = 0;
    this.remove = false;
    this.walkCycle = 0;
    this.flashTimer = 0;
    this.held = false;      // gripped for a throw: kept where the thrower puts it until released or thrown
    this.thrown = false;    // flying through the air after a throw
    this.down = false;      // lying on the floor after a throw, until hurtTimer runs out
    this.downTime = 0;
    this.lastEvent = null;  // set by takeHit so the game can trigger sounds/particles
  }

  get canAct() {
    return !this.dead && this.state !== 'hurt' && !this.attack;
  }

  get attackPhase() {
    return this.attack ? attackPhase(ATTACKS[this.attack.name], this.attack.t) : null;
  }

  startAttack(name) {
    this.attack = { name, t: 0, hits: new Set() };
    this.state = 'attack';
    this.stateTime = 0;
    this.blocking = false;
    // Airborne fighters keep their momentum so a jump kick carries forward.
    if (this.grounded) { this.vx = 0; this.vz = 0; }
  }

  // Apply damage/knockback from a resolved hit. Returns true if damage was taken.
  takeHit({ damage, blocked, direction, knockback }) {
    if (this.dead || this.invulnerable > 0) return false;
    if (blocked) {
      this.knockVx = direction * knockback * 0.3;
      this.lastEvent = 'block';
      return false;
    }
    this.hp = Math.max(0, this.hp - damage);
    this.attack = null;
    this.blocking = false;
    this.crouching = false;
    this.knockVx = direction * knockback;
    this.flashTimer = 0.08;
    this.applyDamageState();
    return true;
  }

  // Gripped for a throw: cannot act or move on its own until released or thrown.
  hold() {
    this.attack = null;
    this.blocking = false;
    this.crouching = false;
    this.knockVx = 0;
    this.vx = 0;
    this.vz = 0;
    this.held = true;
    this.state = 'hurt';
    this.stateTime = 0;
    this.hurtTimer = PHYSICS.hurtTime;
  }

  // Let go without a throw (the thrower was hit): staggers for the usual hurt time.
  release() {
    this.held = false;
    this.state = 'hurt';
    this.hurtTimer = PHYSICS.hurtTime;
  }

  // Thrown down: a short hop forward in `direction`, then the floor for a moment.
  takeThrow({ damage, direction, launchVy = GRAB.launchVy, throwSpeed = GRAB.throwSpeed, downTime = GRAB.downTime }) {
    if (this.dead) return false;
    this.hp = Math.max(0, this.hp - damage);
    this.attack = null;
    this.blocking = false;
    this.crouching = false;
    this.knockVx = 0;
    this.vx = direction * throwSpeed;
    this.vz = 0;
    this.vy = launchVy;
    this.y -= 1;
    this.grounded = false;
    this.facing = -direction;   // lands looking back at the thrower
    this.held = false;
    this.thrown = true;
    this.down = false;
    this.downTime = downTime;
    this.flashTimer = 0.08;
    this.applyDamageState();
    return true;
  }

  applyDamageState() {
    if (this.hp <= 0) {
      this.dead = true;
      this.state = 'dead';
      this.stateTime = 0;
      this.deadTimer = 0;
      this.lastEvent = 'ko';
    } else {
      this.state = 'hurt';
      this.stateTime = 0;
      this.hurtTimer = PHYSICS.hurtTime;
      this.lastEvent = 'hurt';
    }
  }

  // Shared physics for every fighter: gravity, knockback decay, timers.
  integrate(dt, minX, maxX) {
    if (this.invulnerable > 0) this.invulnerable -= dt;
    if (this.flashTimer > 0) this.flashTimer -= dt;
    this.stateTime += dt;

    if (this.attack) {
      this.attack.t += dt;
      if (this.attack.t >= attackDuration(ATTACKS[this.attack.name])) {
        this.attack = null;
        if (!this.dead) this.state = this.grounded ? 'idle' : 'jump';
      }
    }
    // A thrown fighter stays hurt until it has landed; the floor time starts then. A held one waits.
    if (this.state === 'hurt' && !this.thrown && !this.held) {
      this.hurtTimer -= dt;
      if (this.hurtTimer <= 0) { this.state = 'idle'; this.down = false; }
    }
    if (this.dead && !this.thrown) {
      this.deadTimer += dt;
    }

    // Knockback is a separate velocity so it stacks on top of walking.
    const totalVx = this.vx + this.knockVx;
    this.knockVx *= Math.pow(0.001, dt); // fast exponential decay
    if (Math.abs(this.knockVx) < 1) this.knockVx = 0;

    this.x += totalVx * dt;
    this.z = Math.min(DEPTH, Math.max(0, this.z + this.vz * dt));
    this.vy += PHYSICS.gravity * dt;
    this.y += this.vy * dt;
    if (this.y >= GROUND_Y) {
      const wasAirborne = !this.grounded;
      this.y = GROUND_Y;
      this.vy = 0;
      this.grounded = true;
      if (wasAirborne) {
        if (this.state === 'jump') this.state = 'idle';
        if (this.thrown) {
          // Ground impact: the floor time starts now (a dead fighter just stays down).
          this.thrown = false;
          this.vx = 0;
          this.down = true;
          this.lastEvent = 'slam';
          if (!this.dead) this.hurtTimer = this.downTime;
        } else {
          this.lastEvent = this.lastEvent || 'land';
        }
      }
    } else {
      this.grounded = false;
    }
    this.x = Math.min(maxX, Math.max(minX, this.x));
  }
}

export class Player extends Fighter {
  constructor(x) {
    super({ x, facing: 1, hp: PLAYER.maxHp, kind: 'player' });
    this.kiaiTimer = 0;     // seconds of Kiai mode left
    this.kiaiCooldown = 0;  // seconds until Kiai can be used again
    this.minX = 10;         // walkable range; the game narrows it to what the camera shows
    this.maxX = WORLD_WIDTH - 10;
    this.sprinting = false;
    this.sprintDir = null;  // the double-tapped direction; releasing it ends the sprint
    this.sprintHeld = false; // the sprint comes from a held `sprint` input (touch pad), not a double-tap
    this.tapTimers = { left: 0, right: 0, up: 0, down: 0 };
    this.heldMove = { left: false, right: false, up: false, down: false };
  }

  get kiaiActive() {
    return this.kiaiTimer > 0;
  }

  get kiaiReady() {
    return this.kiaiCooldown <= 0 && !this.dead;
  }

  // Fraction for the HUD meter: draining while active, refilling while cooling down.
  get kiaiFraction() {
    if (this.kiaiActive) return this.kiaiTimer / KIAI.duration;
    if (this.kiaiCooldown > 0) return 1 - this.kiaiCooldown / KIAI.cooldown;
    return 1;
  }

  activateKiai() {
    if (!this.kiaiReady || this.kiaiActive) return false;
    this.kiaiTimer = KIAI.duration;
    this.kiaiCooldown = KIAI.duration + KIAI.cooldown;
    this.lastEvent = 'kiai';
    return true;
  }

  startAttack(name) {
    super.startAttack(name);
    this.lastEvent = 'attack';
  }

  tickKiai(dt) {
    if (this.kiaiTimer > 0) this.kiaiTimer = Math.max(0, this.kiaiTimer - dt);
    if (this.kiaiCooldown > 0) this.kiaiCooldown = Math.max(0, this.kiaiCooldown - dt);
  }

  // Double-tap detection: a direction pressed twice inside the tap window starts a sprint.
  trackTaps(dt, input) {
    for (const d of MOVE_DIRS) {
      if (this.tapTimers[d] > 0) this.tapTimers[d] = Math.max(0, this.tapTimers[d] - dt);
      const held = Boolean(input[d]);
      if (held && !this.heldMove[d]) {
        if (this.tapTimers[d] > 0 && !this.sprinting) {
          this.sprinting = true;
          this.sprintDir = d;
          this.tapTimers[d] = 0;
          if (!this.dead) this.lastEvent = 'sprint';
        } else {
          this.tapTimers[d] = SPRINT.tapWindow;
        }
      }
      this.heldMove[d] = held;
    }
    if (this.sprinting && !input[this.sprintDir]) { this.sprinting = false; this.sprintDir = null; }
    // A held `sprint` input (the touch pad's outer zone) runs for as long as it is held together
    // with a direction; the direction may change without ending the run. Letting go of the zone
    // ends it. Same speed, facing and guard rules as the double-tap sprint, which is untouched.
    if (input.sprint) {
      const dir = MOVE_DIRS.find((d) => input[d]);
      if (dir) {
        if (!this.sprinting && !this.dead) this.lastEvent = 'sprint';
        this.sprinting = true;
        this.sprintDir = dir;
        this.sprintHeld = true;
      }
    } else if (this.sprintHeld) {
      this.sprintHeld = false;
      this.sprinting = false;
      this.sprintDir = null;
    }
  }

  // `input` is a snapshot: { left, right, up, down, duck, jump, punch, kick, block } where
  // jump/punch/kick are "just pressed" edges and the rest are "held".
  // The game adds what the player is up against: `nearDir` (1, -1 or 0) when an enemy is close in
  // front, so holding away backs off without turning; `threatDir` when a strike or star is about to
  // land from that side, so holding away blocks it.
  update(dt, input, { threatDir = 0, nearDir = 0 } = {}) {
    this.tickKiai(dt);
    this.trackTaps(dt, input);
    if (this.dead) {
      this.vx = 0;
      this.vz = 0;
      this.integrate(dt, this.minX, this.maxX);
      return;
    }
    if (input.kiai) this.activateKiai();
    if (this.state === 'hurt') {
      this.vx = 0;
      this.vz = 0;
      this.integrate(dt, this.minX, this.maxX);
      return;
    }

    if (this.attack) {
      // Punch and kick pressed almost together: the first strike's wind-up turns into a grab.
      const name = this.attack.name;
      const other = name === 'punch' ? input.kick : name === 'kick' ? input.punch : false;
      if (other && this.grounded && this.attackPhase === 'startup') this.startAttack('grab');
      // Committed to the attack; can still drift in the air.
      if (this.grounded) { this.vx = 0; this.vz = 0; }
      this.integrate(dt, this.minX, this.maxX);
      return;
    }

    if (this.grounded) {
      // Holding away from a strike that is coming in from the front blocks it.
      const backHeld = threatDir > 0 ? Boolean(input.left) : threatDir < 0 ? Boolean(input.right) : false;
      this.blocking = Boolean(input.block) || backHeld;
      this.crouching = !this.blocking && Boolean(input.duck);
    }

    if (this.blocking) {
      this.vx = 0;
      this.vz = 0;
      this.state = 'block';
    } else if (this.crouching) {
      this.vx = 0;
      this.vz = 0;
      this.state = 'crouch';
      if (input.punch) this.startAttack('crouchPunch');
      else if (input.kick) this.startAttack('crouchKick');
    } else {
      const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const dirZ = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      // Squared up with an enemy, stepping away keeps the eyes on them.
      if (dir !== 0 && dir !== -nearDir) this.facing = dir;
      const pace = this.sprinting ? SPRINT.speedMultiplier : 1;
      this.vx = dir * PHYSICS.playerSpeed * pace;
      this.vz = dirZ * PHYSICS.playerDepthSpeed * pace;
      if (this.grounded) {
        const moving = dir !== 0 || dirZ !== 0;
        this.state = moving ? 'walk' : 'idle';
        if (moving) this.walkCycle += dt * 9 * pace; else this.walkCycle = 0;
        if (input.jump) {
          this.vy = PHYSICS.playerJumpVelocity;
          this.grounded = false;
          this.state = 'jump';
          this.lastEvent = 'jump';
        }
      } else {
        this.state = 'jump';
      }
      if (input.punch && input.kick && this.grounded) this.startAttack('grab');
      else if (input.punch) this.startAttack('punch');
      else if (input.kick) this.startAttack('kick');
    }
    this.integrate(dt, this.minX, this.maxX);
  }
}

// Enemy archetypes. Each one has a distinct, readable behaviour:
//  - striker: walks straight at you and throws a mid punch. Fragile.
//  - kicker: keeps distance, throws a high kick (duck under it!), then steps back.
//  - thrower: hangs back, lines up with you and throws shuriken. Weak if you catch it.
//  - boss: faster, mixes punches and high kicks, and sometimes blocks your attacks.
export const ENEMY_TYPES = {
  striker: { hp: 30, speed: 48, range: 20, keepAway: 0, attacks: ['enemyPunch'], cooldown: [0.5, 1.0], retreatTime: 0, score: 100, canBlock: false, boss: false, label: 'Striker' },
  // Kicker mixes a high kick (duck it) with a low sweep (jump it); the wind-ups look different.
  kicker:  { hp: 50, speed: 40, range: 27, keepAway: 12, attacks: ['enemyHighKick', 'enemyLowSweep'], attackWeights: [0.6, 0.4], cooldown: [0.7, 1.2], retreatTime: 0.5, score: 200, canBlock: false, boss: false, label: 'Kicker' },
  thrower: { hp: 30, speed: 44, range: 120, keepAway: 60, attacks: ['enemyThrow'], cooldown: [1.5, 2.3], retreatTime: 0, score: 250, canBlock: false, boss: false, ranged: true, label: 'Thrower' },
  // The Master blocks, counters right after a block, and speeds up below 40% health.
  boss:    { hp: 180, speed: 62, range: 25, keepAway: 8, attacks: ['bossPunch', 'bossKick'], cooldown: [0.4, 0.75], retreatTime: 0.25, score: 1000, canBlock: true, blockChance: 0.65, counters: true, rageBelow: 0.4, boss: true, label: 'Master Kage' },
};

// Enemies line up a little inside the reach so a small player step does not break their attack.
const LINE_UP_Z = DEPTH_REACH - 2;
// Depth speed relative to walking speed, matching the player's narrower floor movement.
const DEPTH_SPEED_FACTOR = 0.7;
// Beyond this distance an enemy walks its own lane, so groups arrive spread out over the floor.
const LANE_DISTANCE = 50;

export class Enemy extends Fighter {
  constructor(type, x, facing, rng = Math.random, z = START_Z) {
    const cfg = ENEMY_TYPES[type];
    super({ x, z, facing, hp: cfg.hp, kind: type });
    this.cfg = cfg;
    this.rng = rng;
    this.cooldown = 0.4 + rng() * 0.4; // brief pause after entering
    this.lane = (rng() - 0.5) * 24;    // depth offset kept while still far from the player
    this.enterDir = 0;                 // non-zero while walking in from outside the screen
    this.minX = -40;                   // walkable range; the game narrows it to what the camera shows
    this.maxX = WORLD_WIDTH + 40;
    this.retreatTimer = 0;
    this.blockTimer = 0;
    this.blockCooldown = 0;
    this.attackIndex = 0;
  }

  // Weighted random choice when weights are given, otherwise cycle through the list.
  pickAttack() {
    const cfg = this.cfg;
    if (cfg.attackWeights) {
      let r = this.rng();
      for (let i = 0; i < cfg.attacks.length; i++) {
        r -= cfg.attackWeights[i];
        if (r <= 0) return cfg.attacks[i];
      }
      return cfg.attacks[cfg.attacks.length - 1];
    }
    const name = cfg.attacks[this.attackIndex % cfg.attacks.length];
    this.attackIndex += 1;
    return name;
  }

  update(dt, player) {
    const { minX, maxX } = this;
    if (this.dead || this.state === 'hurt') {
      // A thrown fighter keeps flying until it lands.
      if (!this.thrown) { this.vx = 0; this.vz = 0; }
      this.integrate(dt, minX, maxX);
      return;
    }
    if (this.attack) {
      this.vx = 0;
      this.vz = 0;
      // A ranged attack lets go once, the moment it turns active. Getting hit first cancels it.
      if (ATTACKS[this.attack.name].ranged && this.attackPhase === 'active' && !this.attack.released) {
        this.attack.released = true;
        this.lastEvent = 'throw';
      }
      this.integrate(dt, minX, maxX);
      return;
    }

    // Walk onto the screen first: nobody may fight from where the player cannot reach them.
    if (this.enterDir) {
      this.facing = this.enterDir;
      this.vx = this.enterDir * this.cfg.speed;
      this.vz = 0;
      this.state = 'walk';
      this.walkCycle += dt * 8;
      this.integrate(dt, minX, maxX);
      return;
    }

    const dx = player.x - this.x;
    const dist = Math.abs(dx);
    const dz = player.z - this.z;
    const absDz = Math.abs(dz);
    const cfg = this.cfg;
    this.facing = dx >= 0 ? 1 : -1;
    this.vx = 0;
    this.vz = 0;

    const enraged = cfg.rageBelow ? this.hp / this.maxHp <= cfg.rageBelow : false;
    const speed = enraged ? cfg.speed + 12 : cfg.speed;
    const depthSpeed = speed * DEPTH_SPEED_FACTOR;

    if (this.blockTimer > 0) {
      this.blockTimer -= dt;
      this.blocking = this.blockTimer > 0;
      this.state = this.blocking ? 'block' : 'idle';
      // Guard dropped: a counter-attacking boss strikes straight away if you are still close.
      if (!this.blocking && cfg.counters && dist <= cfg.range + 4 && absDz <= DEPTH_REACH && !player.dead) this.cooldown = 0;
      this.integrate(dt, minX, maxX);
      return;
    }
    this.blocking = false;
    if (this.blockCooldown > 0) this.blockCooldown -= dt;

    // The boss reads the player's wind-up and sometimes raises a guard.
    if (cfg.canBlock && this.blockCooldown <= 0 && player.attack && player.attackPhase === 'startup'
        && dist < 34 && absDz <= DEPTH_REACH && !player.dead && this.rng() < (cfg.blockChance || 0.5)) {
      this.blockTimer = 0.5;
      this.blockCooldown = 1.6;
      this.blocking = true;
      this.state = 'block';
      this.integrate(dt, minX, maxX);
      return;
    }

    if (this.retreatTimer > 0) {
      this.retreatTimer -= dt;
      this.vx = -this.facing * speed * 0.8;
      this.state = 'walk';
      this.walkCycle += dt * 8;
    } else if (this.cooldown > 0) {
      this.cooldown -= enraged ? dt * 1.4 : dt;
      if (dist < cfg.keepAway) {
        this.vx = -this.facing * speed * 0.6;
        this.state = 'walk';
        this.walkCycle += dt * 8;
      } else if (absDz > LINE_UP_Z && (cfg.ranged || dist < LANE_DISTANCE)) {
        this.vz = Math.sign(dz) * depthSpeed;
        this.state = 'walk';
        this.walkCycle += dt * 8;
      } else {
        this.state = 'idle';
      }
    } else if (player.dead) {
      this.state = 'idle';
    } else if (dist > cfg.range || absDz > LINE_UP_Z) {
      if (dist > cfg.range) this.vx = this.facing * speed;
      const keepLane = dist > LANE_DISTANCE && !cfg.ranged;
      const targetZ = keepLane ? Math.min(DEPTH, Math.max(0, player.z + this.lane)) : player.z;
      const toTarget = targetZ - this.z;
      if (Math.abs(toTarget) > 1) this.vz = Math.sign(toTarget) * depthSpeed;
      this.state = 'walk';
      this.walkCycle += dt * 8;
    } else {
      const name = this.pickAttack();
      this.startAttack(name);
      this.cooldown = cfg.cooldown[0] + this.rng() * (cfg.cooldown[1] - cfg.cooldown[0]);
      this.retreatTimer = cfg.retreatTime;
    }
    this.integrate(dt, minX, maxX);
  }
}

// Gently push fighters apart so they do not stand inside each other.
// Fighters on different parts of the floor can pass each other freely.
export function separate(a, b, minDist) {
  if (a.dead || b.dead || !a.grounded || !b.grounded || a.held || b.held) return;
  if (Math.abs(a.z - b.z) > DEPTH_REACH) return;
  const dx = b.x - a.x;
  const overlap = minDist - Math.abs(dx);
  if (overlap <= 0) return;
  const dir = dx === 0 ? 1 : Math.sign(dx);
  a.x -= dir * overlap / 2;
  b.x += dir * overlap / 2;
}
