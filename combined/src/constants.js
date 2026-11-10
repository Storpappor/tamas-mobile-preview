// Central tuning values for Master Tamas: Siege of Sanshin.
// All distances are in "world pixels" at the game's native low resolution.

export const VIEW_W = 320;       // native canvas width (scaled up on screen)
export const VIEW_H = 180;       // native canvas height
export const WORLD_WIDTH = 1920; // total length of the level
export const STEP = 1 / 60;      // fixed physics step in seconds

// A fighter has three coordinates: x along the level, z into the floor (0 = back wall,
// DEPTH = nearest the viewer) and y for height. y equals GROUND_Y when standing and shrinks
// during a jump, so it is NOT a screen position: use screenY() to draw.
export const GROUND_Y = 150;     // y of a fighter standing on the floor
export const FLOOR_TOP = 122;    // screen y where the floor meets the back wall
export const DEPTH = 48;         // depth of the walkable floor
export const START_Z = DEPTH / 2;
export const DEPTH_REACH = 7;    // attacks connect when fighters are this close in depth

export function screenY(y, z) {
  return y - GROUND_Y + FLOOR_TOP + z;
}

export const PHYSICS = {
  gravity: 560,
  playerSpeed: 72,
  playerDepthSpeed: 50,
  playerJumpVelocity: -205,
  hurtTime: 0.35,
  invulnerableTime: 0.7,
  deathLingerTime: 0.9,
};

export const SHURIKEN_SPEED = 140;

// Double-tap a direction to sprint that way; the sprint lasts while that key stays held.
export const SPRINT = {
  tapWindow: 0.25,        // seconds between the two taps
  speedMultiplier: 1.75,
};

// Punch and kick together grab the fighter in front. Tamas holds them for the throw's start-up,
// then turns them down onto the floor just in front of him (the throw's active phase).
export const GRAB = {
  damage: 20,
  holdDistance: 12,       // grip distance: the held fighter stands chest to chest (hurtboxes touching)
  launchVy: -56,          // the small hop that lets the victim leave the grip and come down
  throwSpeed: 60,         // forward speed while coming down: 0.2 s in the air covers 12 units
  downTime: 0.9,          // seconds spent on the floor after landing
};

// Holding the direction away from an incoming strike or star blocks it, without the block key.
// A star counts from the moment it flies at the player; a strike counts inside this range.
export const AUTO_BLOCK = {
  strikeRange: 40,        // how near an attacking enemy must be, along the level
};

export const PLAYER = {
  maxHp: 100,
};

// Kiai mode: a short burst of doubled damage that also breaks guards, then a cooldown.
export const KIAI = {
  duration: 4,
  cooldown: 14,
  damageMultiplier: 2,
  knockbackMultiplier: 1.4,
};

// Consecutive hits without taking damage raise the score multiplier (easy to play, hard to master).
export const COMBO = {
  tiers: [[12, 3], [8, 2], [4, 1.5]], // [hits needed, multiplier], checked top-down
};

// Colours are kept in one place so a real art pass can swap palettes later.
export const COLORS = {
  skin: '#f2c9a0',
  skinShade: '#d39c70',
  hairDark: '#2b1d16',
  hairBrown: '#6a3d22',
  eye: '#1a1210',
  giWhite: '#f4f1e6',
  giWhiteShade: '#cfc8b6',
  giGray: '#5b5f68',
  giGrayShade: '#3f434a',
  giBlue: '#3a5ba8',
  giBlueShade: '#2a4177',
  giBlack: '#2c2a30',
  giBlackShade: '#1a191d',
  beltBlack: '#1a1a1a',
  beltRed: '#c8372d',
  beltBlue: '#2f5fc4',
  beltWhite: '#efefef',
  kiai: '#ffb347',
  headbandRed: '#d8402f',
  flash: '#ffffff',
  shadow: 'rgba(0,0,0,0.28)',
};

export const SCORE = {
  hit: 10,
  healthBonusPerPoint: 10,
  timeBonusPerSecond: 20,
  timeBonusLimit: 120,
};
