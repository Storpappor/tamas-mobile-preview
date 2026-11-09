// Combat rules: attack timings, hit boxes and hit resolution.
// Everything here is pure (no DOM), so it is easy to unit test and tune.
import { DEPTH_REACH } from './constants.js';

// Boxes are relative to a fighter's feet position, for a fighter facing right.
// x grows forward (toward the enemy), y grows downward (so heads are negative).
export const ATTACKS = {
  // Player attacks
  punch:       { startup: 0.07, active: 0.10, recovery: 0.16, damage: 10, knockback: 35, box: { x: 6, y: -34, w: 15, h: 9 } },
  kick:        { startup: 0.14, active: 0.12, recovery: 0.26, damage: 16, knockback: 70, box: { x: 6, y: -28, w: 20, h: 11 } },
  crouchPunch: { startup: 0.07, active: 0.10, recovery: 0.16, damage: 8,  knockback: 30, box: { x: 6, y: -24, w: 14, h: 8 } },
  crouchKick:  { startup: 0.12, active: 0.12, recovery: 0.24, damage: 12, knockback: 60, box: { x: 6, y: -16, w: 20, h: 8 } },
  // Grab: reaches for the fighter in front; a guard does not stop it. On contact it becomes a throw.
  grab:        { startup: 0.08, active: 0.08, recovery: 0.28, damage: 0, knockback: 0, box: { x: 2, y: -34, w: 16, h: 30 }, grab: true },
  // The throw has no hitbox. Start-up is the hold (the victim stands in the grip), the victim is
  // turned down during the active phase and lies in front of Tamas while he recovers.
  throw:       { startup: 0.20, active: 0.20, recovery: 0.30, damage: 0, knockback: 0, box: { x: 0, y: 0, w: 0, h: 0 }, ranged: true },
  // Enemy attacks (slower and clearly telegraphed)
  enemyPunch:    { startup: 0.40, active: 0.12, recovery: 0.45, damage: 10, knockback: 40, box: { x: 6, y: -34, w: 15, h: 9 } },
  enemyHighKick: { startup: 0.52, active: 0.14, recovery: 0.55, damage: 14, knockback: 65, box: { x: 6, y: -42, w: 21, h: 12 } },
  enemyLowSweep: { startup: 0.46, active: 0.14, recovery: 0.50, damage: 10, knockback: 55, box: { x: 4, y: -12, w: 22, h: 10 } },
  bossPunch:     { startup: 0.30, active: 0.12, recovery: 0.34, damage: 12, knockback: 45, box: { x: 6, y: -34, w: 16, h: 9 } },
  bossKick:      { startup: 0.44, active: 0.14, recovery: 0.48, damage: 18, knockback: 75, box: { x: 6, y: -42, w: 23, h: 12 } },
  // Throwing arm: `ranged` means the motion itself never connects; it releases a shuriken.
  enemyThrow:    { startup: 0.50, active: 0.08, recovery: 0.40, damage: 0, knockback: 0, box: { x: 0, y: 0, w: 0, h: 0 }, ranged: true },
  // The shuriken in flight, flying at head height: block it, duck it or step out of its path.
  shuriken:      { startup: 0, active: 0, recovery: 0, damage: 8, knockback: 30, box: { x: -3, y: -36, w: 6, h: 6 } },
};

// Attacks that pass over a crouching fighter (they aim at head height).
export const HIGH_ATTACKS = new Set(['enemyHighKick', 'bossKick']);
// Attacks that skim the floor: jump over them (crouching does not help).
export const LOW_ATTACKS = new Set(['enemyLowSweep']);

export const HURTBOX = {
  standing: { x: -6, y: -40, w: 12, h: 40 },
  crouching: { x: -7, y: -28, w: 14, h: 28 },
};

export function attackDuration(attack) {
  return attack.startup + attack.active + attack.recovery;
}

// Which phase an attack is in at time t since it started.
export function attackPhase(attack, t) {
  if (t < attack.startup) return 'startup';
  if (t < attack.startup + attack.active) return 'active';
  if (t < attackDuration(attack)) return 'recovery';
  return 'done';
}

export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Convert a fighter-relative box to a world-space rect, mirroring for facing.
export function worldBox(box, fighterX, fighterY, facing) {
  const x = facing >= 0 ? fighterX + box.x : fighterX - box.x - box.w;
  return { x, y: fighterY + box.y, w: box.w, h: box.h };
}

export function hurtboxFor(fighter) {
  const box = fighter.crouching ? HURTBOX.crouching : HURTBOX.standing;
  return worldBox(box, fighter.x, fighter.y, 1);
}

// Decide whether an attack from `attacker` connects with `defender` right now.
// Returns { hit, blocked, damage, direction }.
export function resolveHit(attacker, defender, attackName) {
  const attack = ATTACKS[attackName];
  // Fighters on different parts of the floor walk past each other: depth is checked first.
  if (Math.abs((attacker.z ?? 0) - (defender.z ?? 0)) > DEPTH_REACH) {
    return { hit: false, blocked: false, damage: 0, direction: attacker.facing };
  }
  const hitbox = worldBox(attack.box, attacker.x, attacker.y, attacker.facing);
  const hurtbox = hurtboxFor(defender);
  if (!rectsOverlap(hitbox, hurtbox)) {
    return { hit: false, blocked: false, damage: 0, direction: attacker.facing };
  }
  const attackerInFront = Math.sign(attacker.x - defender.x) === defender.facing;
  const blocked = Boolean(defender.blocking) && attackerInFront && !attack.grab;
  return {
    hit: true,
    blocked,
    damage: blocked ? 0 : attack.damage,
    direction: attacker.facing,
  };
}
