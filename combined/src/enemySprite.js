// Native sprite sheets for the opponents: which file each enemy type loads, and how an enemy's
// state machine maps onto the states of a JSON-mapped sheet (the same `SpriteSheet` as Tamas's).
//
// Every enemy type is drawn procedurally today (`drawFighter` in sprites.js). A type gets image
// artwork the moment its sheet exists at the path below; a type without one, or a state the sheet
// does not map, keeps the procedural drawing. Nothing here touches the simulation: `enemyState`
// only reads the fighter, and it stays DOM-free so the tests can run it in Node.
import { PHYSICS, GRAB } from './constants.js';
import { ATTACKS } from './combat.js';
import { GET_UP_TIME } from './sprites.js';

// Sheet map per enemy kind, relative to src/. The PNG sits next to the JSON (see tamas.json).
export const ENEMY_SHEETS = {
  striker: '../assets/sprites/striker.json',
  kicker: '../assets/sprites/kicker.json',
  thrower: '../assets/sprites/thrower.json',
  boss: '../assets/sprites/boss.json',
};

// How long a dead fighter keeps the hit reaction before it topples, and how long the topple
// takes: the same split Tamas's sheet uses (`heroState`), so one convention serves every sheet.
const DEATH_HIT_TIME = 0.25;
const DEATH_FALL_TIME = 0.3;

const unit = (v) => Math.max(0, Math.min(1, v));

// Resolve an enemy's drawing state for its sheet: the state key plus how far through it the
// fighter is, in the shape `SpriteSheet.frameFor` reads (`phase` for attacks, `loop` for walks,
// `progress` 0..1 otherwise). State keys:
//   idle, walk                      the usual stance and the walk cycle (loop = walkCycle, 8 per second)
//   <attack name>                   each entry of ENEMY_TYPES[kind].attacks verbatim (enemyPunch,
//                                   enemyHighKick, enemyLowSweep, enemyThrow, bossPunch, bossKick),
//                                   with the attack phase so a 3-cell state shows wind-up / hit / recover
//   block                           the raised guard (Master Kage)
//   hurt                            the hit reaction, progress over PHYSICS.hurtTime
//   knockdown                       beaten: hurt for the first 0.25 s, then the topple over 0.3 s; a
//                                   fighter that dies in a throw lies on its last cell from the touchdown
//   held, thrownDown1, thrownDown2, fallen, getUp
//                                   the victim of Tamas's throw, one state per procedural pose (`poseFor`):
//                                   gripped (progress over the hold), rising, falling, lying, kneeling up
// The order of the checks follows `poseFor`, so a sheet and the procedural art never disagree on
// which pose a frame is in.
export function enemyState(f) {
  if (f.held) return { state: 'held', progress: unit(f.stateTime / ATTACKS.throw.startup) };
  if (f.thrown) {
    // The hop is symmetric: vy runs from the launch speed up to 0 at the apex, then back down.
    const launch = -GRAB.launchVy;
    if (f.vy < 0) return { state: 'thrownDown1', progress: unit(1 - (-f.vy) / launch) };
    return { state: 'thrownDown2', progress: unit(f.vy / launch) };
  }
  if (f.dead) {
    if (f.down) return { state: 'knockdown', progress: 1 };
    if (f.deadTimer < DEATH_HIT_TIME) return { state: 'hurt', progress: 0 };
    return { state: 'knockdown', progress: unit((f.deadTimer - DEATH_HIT_TIME) / DEATH_FALL_TIME) };
  }
  if (f.state === 'hurt') {
    if (f.down) {
      if (f.hurtTimer < GET_UP_TIME) return { state: 'getUp', progress: unit(1 - f.hurtTimer / GET_UP_TIME) };
      const lying = Math.max(GET_UP_TIME, f.downTime || GRAB.downTime) - GET_UP_TIME;
      return { state: 'fallen', progress: unit(1 - (f.hurtTimer - GET_UP_TIME) / lying) };
    }
    return { state: 'hurt', progress: unit(1 - f.hurtTimer / PHYSICS.hurtTime) };
  }
  if (f.attack) return { state: f.attack.name, phase: f.attackPhase, progress: 0 };
  if (f.state === 'block' || f.blocking) return { state: 'block', progress: 0 };
  if (f.state === 'walk') return { state: 'walk', loop: f.walkCycle };
  return { state: 'idle', progress: 0 };
}
