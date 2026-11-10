// Level definition and wave scheduling. The player walks along the street and into the dojo;
// reaching a wave's `x` locks the camera until that wave has been beaten.
// `delay` is seconds since the wave started. `side` is the screen edge the enemy enters from.
export const LEVEL_1 = {
  name: 'Road to the Dojo',
  maxAlive: 5,
  zones: [
    // `exit` is the door in the back wall that leads on to the next zone.
    { name: 'SÖDERMALM', art: 'street', from: 0, to: 1000, exit: { x: 930, width: 44 } },
    { name: 'SANSHIN KAN', art: 'dojo', from: 1000, to: 1920 },
  ],
  waves: [
    { x: 170, spawns: [
      { delay: 0.3, side: 'right', type: 'striker' },
      { delay: 1.8, side: 'left', type: 'striker' },
    ] },
    { x: 440, spawns: [
      { delay: 0.3, side: 'right', type: 'striker' },
      { delay: 1.2, side: 'right', type: 'kicker' },
      { delay: 3.0, side: 'left', type: 'striker' },
    ] },
    { x: 720, spawns: [
      { delay: 0.3, side: 'right', type: 'kicker' },
      { delay: 1.0, side: 'left', type: 'striker' },
      { delay: 2.5, side: 'right', type: 'thrower' },
    ] },
    { x: 1160, spawns: [
      { delay: 0.3, side: 'left', type: 'kicker' },
      { delay: 0.8, side: 'right', type: 'kicker' },
      { delay: 2.6, side: 'right', type: 'striker' },
      { delay: 3.0, side: 'left', type: 'thrower' },
    ] },
    { x: 1380, spawns: [
      { delay: 0.3, side: 'right', type: 'striker' },
      { delay: 0.7, side: 'right', type: 'striker' },
      { delay: 2.0, side: 'left', type: 'kicker' },
      { delay: 3.2, side: 'left', type: 'thrower' },
    ] },
    { x: 1590, spawns: [
      { delay: 0.3, side: 'left', type: 'kicker' },
      { delay: 0.6, side: 'right', type: 'kicker' },
      { delay: 2.2, side: 'right', type: 'striker' },
      { delay: 2.6, side: 'left', type: 'striker' },
      { delay: 3.0, side: 'right', type: 'thrower' },
    ] },
    { x: 1720, spawns: [
      { delay: 1.6, side: 'right', type: 'boss' },
    ] },
  ],
};

// How far left of a wave's trigger the camera locks, so the player has room on both sides.
const LOCK_OFFSET = 110;

export function totalEnemies(level) {
  return level.waves.reduce((n, w) => n + w.spawns.length, 0);
}

// Drives the waves. Pure state machine: call update() and act on the returned spawn list.
export class Spawner {
  constructor(level = LEVEL_1) {
    this.level = level;
    this.waveIndex = 0;   // next wave to trigger
    this.active = null;   // { wave, time, index } while a wave is being fought
  }

  // Left edge the camera must hold while a wave is active; null when free to scroll.
  get lockX() {
    return this.active ? Math.max(0, this.active.wave.x - LOCK_OFFSET) : null;
  }

  get finished() {
    return !this.active && this.waveIndex >= this.level.waves.length;
  }

  // `alive` = enemies currently in the arena, `playerX` = the player's world position.
  update(dt, { playerX, alive }) {
    const next = this.level.waves[this.waveIndex];
    if (!this.active && next && playerX >= next.x) {
      this.active = { wave: next, time: 0, index: 0 };
      this.waveIndex += 1;
    }
    const out = [];
    if (!this.active) return out;

    const a = this.active;
    a.time += dt;
    while (a.index < a.wave.spawns.length && alive + out.length < this.level.maxAlive) {
      const s = a.wave.spawns[a.index];
      if (s.delay > a.time) break;
      out.push({ side: s.side, type: s.type });
      a.index += 1;
    }
    if (a.index >= a.wave.spawns.length && alive + out.length === 0) this.active = null;
    return out;
  }
}
