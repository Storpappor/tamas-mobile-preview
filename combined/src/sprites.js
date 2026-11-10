// Procedural pixel-art fighters and a tiny bitmap font.
//
// ART PIPELINE NOTE: every fighter is drawn from a small "skeleton" (joint positions per
// pose) using filled pixel blocks, with a dark silhouette stamped behind it so it reads
// like the outlined hero sprite. To move to hand-drawn sprite sheets later, replace
// `drawFighter` with an image-based version that maps `poseFor(fighter)` to a sprite frame;
// nothing else in the game needs to change.
import { COLORS } from './constants.js';
import { HIGH_ATTACKS, LOW_ATTACKS } from './combat.js';

const OUTLINE = '#120c0a';

// Numbers describe the build and `head` the costume; every other string is a colour, and
// paint code must only use these so that a silhouette (see solidPalette) stays one colour.
const INK = { ink: OUTLINE };
// Black cloth keeps grey folds and edges, so it does not melt into the dark outline.
const BLACK_GI = { gi: '#25252b', giShade: '#121216', fold: '#4a4a55', trim: '#74747f' };
export const FIGHTER_PALETTES = {
  // Fallback only: the hero is normally drawn from his sprite sheet.
  player: {
    ...INK, head: 'brawler', scaleX: 1, scaleY: 1, armT: 4, legT: 5, headS: 9, torsoW: 12, sleeve: true, hakama: false,
    skin: COLORS.skin, skinShade: COLORS.skinShade, hair: COLORS.hairBrown, band: COLORS.giWhiteShade, bandolier: null,
    gi: COLORS.giWhite, giShade: COLORS.giWhiteShade, fold: COLORS.giWhiteShade, trim: COLORS.giWhiteShade, belt: COLORS.beltBlack,
    hand: COLORS.skin, shin: COLORS.giWhite, foot: COLORS.skin, eye: COLORS.eye,
  },
  // Every enemy is a karate student of the Shadow League in a black gi; size and style follow
  // what they fight like.
  // Striker: short and broad, sleeves torn off, taped fists, a long red headband. Hits up close.
  striker: {
    ...BLACK_GI, ...INK, head: 'brawler', scaleX: 1.15, scaleY: 0.92, armT: 6, legT: 7, headS: 9, torsoW: 18, sleeve: false, hakama: false,
    skin: '#e0a878', skinShade: '#b4774f', hair: '#17110e', band: '#d8402f', bandolier: null,
    belt: '#e07b2c', hand: '#ece6d6', shin: BLACK_GI.gi, foot: '#e0a878', eye: '#1a1210',
  },
  // Kicker: tall and lean with long legs, a ponytail and white shin pads. Reaches from afar.
  kicker: {
    ...BLACK_GI, ...INK, head: 'ponytail', scaleX: 0.95, scaleY: 1.14, armT: 3, legT: 5, headS: 8, torsoW: 11, sleeve: true, hakama: false,
    skin: '#e0a878', skinShade: '#b4774f', hair: '#3a2416', band: '#2f5fc4', bandolier: null,
    belt: '#2f5fc4', hand: '#e0a878', shin: '#e6e4dc', foot: '#e0a878', eye: '#1a1210',
  },
  // Thrower: small and wiry, with a flat-top and a white strap of stars across the chest.
  thrower: {
    ...BLACK_GI, ...INK, head: 'flattop', scaleX: 0.86, scaleY: 0.84, armT: 3, legT: 4, headS: 8, torsoW: 11, sleeve: true, hakama: false,
    skin: '#e0a878', skinShade: '#b4774f', hair: '#17110e', band: '#17110e', bandolier: '#dfe6ee',
    belt: '#e6c94a', hand: '#e0a878', shin: BLACK_GI.gi, foot: '#e0a878', eye: '#1a1210',
  },
  // Master Kage: the huge teacher, in a gold-edged gi and wide hakama, with white hair and burning eyes.
  boss: {
    ...BLACK_GI, ...INK, head: 'kage', scaleX: 1.35, scaleY: 1.25, armT: 6, legT: 7, headS: 10, torsoW: 19, sleeve: true, hakama: true,
    skin: '#d8c8b8', skinShade: '#a8947f', hair: '#ece8df', band: '#c8372d', bandolier: null,
    trim: '#e2a53b', belt: '#e2a53b', hand: '#d8c8b8', shin: BLACK_GI.gi, foot: '#d8c8b8', eye: '#ff4a2e',
  },
};

// Same body and costume shapes, but every colour replaced: used for outlines and hit flashes.
const solidCache = new Map();
function solidPalette(kind, pal, color) {
  const key = `${kind}:${color}`;
  let solid = solidCache.get(key);
  if (!solid) {
    solid = Object.fromEntries(Object.entries(pal).map(([k, v]) => [k, typeof v === 'string' && k !== 'head' ? color : v]));
    solidCache.set(key, solid);
  }
  return solid;
}

// Joint positions relative to the feet, for a fighter facing right.
// lead = limbs on the side facing the opponent, rear = the other side.
// arm: [elbow, hand], leg: [knee, foot].
const POSES = {
  idle:   { head: [0, -36], sh: [0, -30], hip: [0, -18], lead: { arm: [[4, -25], [8, -31]], leg: [[3, -10], [5, 0]] }, rear: { arm: [[-3, -24], [2, -29]], leg: [[-3, -10], [-5, 0]] } },
  walk1:  { head: [0, -36], sh: [0, -30], hip: [0, -18], lead: { arm: [[3, -25], [7, -30]], leg: [[5, -10], [8, 0]] }, rear: { arm: [[-4, -24], [1, -28]], leg: [[-4, -9], [-7, 0]] } },
  walk2:  { head: [0, -37], sh: [0, -31], hip: [0, -19], lead: { arm: [[4, -25], [8, -31]], leg: [[2, -10], [3, 0]] }, rear: { arm: [[-3, -24], [2, -29]], leg: [[-1, -10], [-2, 0]] } },
  walk3:  { head: [0, -36], sh: [0, -30], hip: [0, -18], lead: { arm: [[4, -25], [8, -30]], leg: [[-1, -10], [-3, 0]] }, rear: { arm: [[-3, -24], [1, -28]], leg: [[3, -9], [6, 0]] } },
  walk4:  { head: [0, -37], sh: [0, -31], hip: [0, -19], lead: { arm: [[4, -25], [8, -31]], leg: [[1, -10], [1, 0]] }, rear: { arm: [[-3, -24], [2, -29]], leg: [[0, -10], [-1, 0]] } },
  crouch: { head: [0, -26], sh: [0, -21], hip: [0, -12], lead: { arm: [[4, -16], [8, -22]], leg: [[6, -7], [6, 0]] }, rear: { arm: [[-3, -15], [2, -19]], leg: [[-6, -7], [-6, 0]] } },
  jump:   { head: [0, -38], sh: [0, -32], hip: [0, -20], lead: { arm: [[5, -28], [7, -35]], leg: [[4, -12], [3, -6]] }, rear: { arm: [[-4, -27], [-6, -34]], leg: [[-3, -12], [-5, -7]] } },
  punchWind: { head: [-1, -36], sh: [-1, -30], hip: [0, -18], lead: { arm: [[-4, -27], [-6, -31]], leg: [[4, -10], [6, 0]] }, rear: { arm: [[-3, -25], [1, -29]], leg: [[-3, -10], [-6, 0]] } },
  punch:  { head: [1, -36], sh: [2, -30], hip: [0, -18], lead: { arm: [[9, -30], [16, -30]], leg: [[5, -10], [8, 0]] }, rear: { arm: [[-4, -26], [-2, -21]], leg: [[-4, -9], [-8, 0]] } },
  kickWind: { head: [-1, -36], sh: [-1, -30], hip: [0, -18], lead: { arm: [[3, -25], [6, -30]], leg: [[6, -18], [5, -11]] }, rear: { arm: [[-4, -24], [-1, -28]], leg: [[-2, -9], [-3, 0]] } },
  kick:   { head: [-2, -36], sh: [-2, -30], hip: [0, -18], lead: { arm: [[3, -25], [6, -30]], leg: [[8, -20], [19, -21]] }, rear: { arm: [[-5, -24], [-2, -28]], leg: [[-2, -9], [-3, 0]] } },
  highKick: { head: [-4, -35], sh: [-3, -29], hip: [0, -18], lead: { arm: [[1, -24], [4, -29]], leg: [[7, -23], [18, -35]] }, rear: { arm: [[-6, -24], [-4, -28]], leg: [[-2, -9], [-3, 0]] } },
  crouchPunch: { head: [1, -26], sh: [1, -21], hip: [0, -12], lead: { arm: [[8, -21], [15, -20]], leg: [[6, -7], [6, 0]] }, rear: { arm: [[-4, -18], [-2, -14]], leg: [[-6, -7], [-6, 0]] } },
  crouchKick: { head: [-1, -26], sh: [-1, -21], hip: [0, -12], lead: { arm: [[4, -16], [8, -22]], leg: [[9, -11], [20, -12]] }, rear: { arm: [[-3, -15], [2, -19]], leg: [[-5, -7], [-6, 0]] } },
  block:  { head: [0, -35], sh: [0, -29], hip: [0, -17], lead: { arm: [[5, -23], [5, -33]], leg: [[4, -9], [6, 0]] }, rear: { arm: [[3, -21], [7, -28]], leg: [[-4, -9], [-6, 0]] } },
  // Grab: both hands reach forward at chest height (also the grip during the hold); throw: the body
  // turns and both arms swing down past the hip (the throw-down); throwDone: settled over the victim.
  grab:   { head: [1, -36], sh: [2, -30], hip: [0, -18], lead: { arm: [[8, -29], [14, -27]], leg: [[5, -10], [8, 0]] }, rear: { arm: [[6, -27], [13, -25]], leg: [[-4, -9], [-7, 0]] } },
  throw:  { head: [3, -34], sh: [3, -28], hip: [0, -18], lead: { arm: [[9, -22], [15, -16]], leg: [[6, -10], [10, 0]] }, rear: { arm: [[7, -21], [13, -15]], leg: [[-4, -9], [-8, 0]] } },
  throwDone: { head: [1, -35], sh: [1, -29], hip: [0, -18], lead: { arm: [[6, -22], [9, -17]], leg: [[5, -10], [8, 0]] }, rear: { arm: [[-3, -23], [-2, -17]], leg: [[-4, -9], [-7, 0]] } },
  // The victim of a throw: held upright in the grip, pulled onto the toes; turned over backwards
  // with the legs coming up (hips rising, then nearly flat); kneeling up again after the floor.
  held:   { head: [2, -35], sh: [1, -29], hip: [0, -18], lead: { arm: [[6, -26], [9, -31]], leg: [[4, -9], [6, -1]] }, rear: { arm: [[-2, -24], [2, -29]], leg: [[-3, -9], [-5, 0]] } },
  thrownDown1: { head: [-7, -28], sh: [-5, -24], hip: [2, -16], lead: { arm: [[-2, -30], [1, -35]], leg: [[7, -14], [12, -12]] }, rear: { arm: [[-11, -22], [-14, -26]], leg: [[5, -12], [9, -6]] } },
  thrownDown2: { lying: true, head: [-15, -15], sh: [-9, -14], hip: [3, -12], lead: { arm: [[-4, -20], [-2, -26]], leg: [[10, -16], [16, -12]] }, rear: { arm: [[-12, -10], [-16, -6]], leg: [[9, -14], [14, -9]] } },
  getUp:  { head: [3, -25], sh: [2, -20], hip: [-3, -10], lead: { arm: [[6, -13], [8, -8]], leg: [[6, -8], [8, 0]] }, rear: { arm: [[-6, -12], [-10, -3]], leg: [[-7, -4], [-11, 0]] } },
  hurt:   { head: [-3, -36], sh: [-2, -30], hip: [0, -18], lead: { arm: [[4, -27], [7, -23]], leg: [[4, -10], [6, 0]] }, rear: { arm: [[-5, -28], [-9, -25]], leg: [[-3, -9], [-6, 0]] } },
  fallen: { lying: true, head: [-14, -4], sh: [-8, -5], hip: [2, -5], lead: { arm: [[-6, -9], [-10, -11]], leg: [[7, -7], [13, -5]] }, rear: { arm: [[-4, -3], [-8, -2]], leg: [[6, -3], [12, -2]] } },
};

const WALK_FRAMES = ['walk1', 'walk2', 'walk3', 'walk4'];
// A fighter on the floor kneels up for the last part of its floor time (drawing only).
export const GET_UP_TIME = 0.25;

// Drawing phase of a throw. The victim's hop takes one simulation frame longer than the attack's
// active phase, so on the recovery's first frame the victim is still in the air: keep showing the
// throw-down until the actual touchdown, then the GROUND IMPACT pose. Presentation only.
export function throwPhase(f) {
  const v = f.attack && f.attack.victim;
  return f.attackPhase === 'recovery' && v && v.thrown ? 'active' : f.attackPhase;
}

// Map a fighter's current state to a pose name.
export function poseFor(f) {
  if (f.held) return 'held';
  if (f.thrown) return f.vy < 0 ? 'thrownDown1' : 'thrownDown2';
  if (f.dead) return f.down || f.deadTimer >= 0.25 ? 'fallen' : 'hurt';
  if (f.state === 'hurt') return f.down ? (f.hurtTimer < GET_UP_TIME ? 'getUp' : 'fallen') : 'hurt';
  if (f.attack) {
    const name = f.attack.name;
    if (name === 'grab') return 'grab';
    if (name === 'throw') { const ph = throwPhase(f); return ph === 'startup' ? 'grab' : ph === 'active' ? 'throw' : 'throwDone'; }
    const isKick = /kick/i.test(name);
    const isCrouch = name.startsWith('crouch') || LOW_ATTACKS.has(name);
    if (f.attackPhase === 'startup') {
      if (isCrouch) return 'crouch';
      return isKick ? 'kickWind' : 'punchWind';
    }
    if (isCrouch) return isKick ? 'crouchKick' : 'crouchPunch';
    if (isKick) return HIGH_ATTACKS.has(name) ? 'highKick' : 'kick';
    return 'punch';
  }
  if (f.state === 'block') return 'block';
  if (!f.grounded) return 'jump';
  if (f.crouching) return 'crouch';
  if (f.state === 'walk') return WALK_FRAMES[Math.floor(f.walkCycle) % WALK_FRAMES.length];
  return 'idle';
}

function rect(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function limb(ctx, a, b, t, color) {
  const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
  const off = Math.floor(t / 2);
  ctx.fillStyle = color;
  for (let i = 0; i <= steps; i++) {
    const px = Math.round(a[0] + (b[0] - a[0]) * i / steps);
    const py = Math.round(a[1] + (b[1] - a[1]) * i / steps);
    ctx.fillRect(px - off, py - off, t, t);
  }
}

// A limb with a darker lower edge, so it reads as rounded instead of flat.
function shadedLimb(ctx, a, b, t, color, shade) {
  limb(ctx, a, b, t, shade);
  limb(ctx, [a[0], a[1] - 1], [b[0], b[1] - 1], t - 1, color);
}

function paintArm(ctx, pal, shoulder, arm, S, rear) {
  const elbow = S(arm[0]), hand = S(arm[1]);
  const color = pal.sleeve ? (rear ? pal.giShade : pal.gi) : (rear ? pal.skinShade : pal.skin);
  const shade = pal.sleeve ? pal.giShade : pal.skinShade;
  shadedLimb(ctx, shoulder, elbow, pal.armT, color, shade);
  shadedLimb(ctx, elbow, hand, pal.armT, color, shade);
  if (pal.sleeve) rect(ctx, pal.trim, hand[0] - 2, hand[1] - 2, pal.armT, 1);
  // A big fist makes the strike easy to read at this resolution.
  rect(ctx, pal.hand, hand[0] - 2, hand[1] - 2, pal.armT + 1, pal.armT);
  rect(ctx, pal.skinShade, hand[0] - 2, hand[1] + pal.armT - 3, pal.armT + 1, 1);
}

function paintLeg(ctx, pal, hip, leg, S, rear) {
  const knee = S(leg[0]), foot = S(leg[1]);
  const color = rear ? pal.giShade : pal.gi;
  shadedLimb(ctx, hip, knee, pal.legT, color, pal.giShade);
  shadedLimb(ctx, knee, foot, pal.legT - 1, pal.shin, pal.giShade);
  // A crease down the front of the trouser.
  if (!rear) limb(ctx, [hip[0] + 1, hip[1] + 1], [knee[0] + 1, knee[1]], 1, pal.fold);
  rect(ctx, pal.foot, foot[0] - 2, foot[1] - 2, pal.legT + 2, 3);
}

function paintTorso(ctx, pal, sh, hip) {
  const height = hip[1] - sh[1];
  const shoulderW = pal.torsoW + 1, waistW = pal.torsoW - 3;
  for (let i = 0; i < height; i++) {
    const w = Math.round(shoulderW + (waistW - shoulderW) * i / height);
    const cx = Math.round(sh[0] + (hip[0] - sh[0]) * i / height);
    const x = cx - Math.floor(w / 2);
    rect(ctx, pal.gi, x, sh[1] + i, w, 1);
    rect(ctx, pal.giShade, x, sh[1] + i, 3, 1);
    rect(ctx, pal.fold, x + w - 1, sh[1] + i, 1, 1);
    // Lapels meet in a V on the chest.
    const lapel = Math.min(i, 5);
    rect(ctx, pal.trim, cx + 3 - lapel, sh[1] + i, 1, 1);
    if (i < 6) rect(ctx, pal.skin, cx + 4 - lapel, sh[1] + i, Math.max(1, lapel), 1);
  }
  const beltW = waistW + 1;
  rect(ctx, pal.belt, hip[0] - Math.floor(beltW / 2), hip[1] - 3, beltW, 3);
  rect(ctx, pal.belt, hip[0] + 1, hip[1], 2, 5);
  rect(ctx, pal.belt, hip[0] - 2, hip[1], 2, 4);
}

function paintHead(ctx, pal, head, flutter) {
  const s = pal.headS;
  const x = head[0] - Math.floor(s / 2), y = head[1] - Math.floor(s / 2);
  rect(ctx, pal.skin, x, y, s, s);
  rect(ctx, pal.skinShade, x, y + s - 1, s, 1);
  rect(ctx, pal.skinShade, x, y, 2, s);

  if (pal.head === 'ponytail') {
    // Hair pulled back into a tail that swings, with a focused look.
    rect(ctx, pal.hair, x - 1, y - 1, s + 1, 3);
    rect(ctx, pal.hair, x - 1, y, 3, s - 3);
    rect(ctx, pal.band, x - 2, y + 1, 2, 2);
    rect(ctx, pal.hair, x - 6, y + 1 + flutter, 5, 2);
    rect(ctx, pal.hair, x - 8, y + 3 + flutter, 3, 4);
    rect(ctx, pal.ink, x + s - 4, y + 3, 3, 1);
    rect(ctx, pal.eye, x + s - 2, y + 4, 1, 1);
  } else if (pal.head === 'flattop') {
    // A square flat-top and a sharp, narrow stare.
    rect(ctx, pal.hair, x - 1, y - 3, s + 1, 4);
    rect(ctx, pal.hair, x - 1, y + 1, 2, 3);
    rect(ctx, pal.ink, x + s - 4, y + 3, 4, 1);
    rect(ctx, pal.eye, x + s - 2, y + 4, 1, 1);
    rect(ctx, pal.skinShade, x + s - 3, y + s - 2, 2, 1);
  } else if (pal.head === 'kage') {
    // White hair swept back to the shoulders.
    rect(ctx, pal.hair, x - 1, y - 2, s, 3);
    rect(ctx, pal.hair, x - 3, y, 4, s);
    rect(ctx, pal.hair, x - 5, y + 4 + flutter, 3, s - 3);
    rect(ctx, pal.skinShade, x - 2, y + 1, 1, s - 2);
    rect(ctx, pal.skinShade, x - 4, y + 6 + flutter, 1, s - 6);
    // Heavy brow, burning eye, red warpaint and a pointed beard.
    rect(ctx, pal.ink, x + s - 6, y + 2, 6, 1);
    rect(ctx, pal.eye, x + s - 4, y + 3, 3, 2);
    rect(ctx, pal.band, x + s - 7, y + 3, 1, 4);
    rect(ctx, pal.hair, x + 3, y + s - 2, s - 3, 2);
    rect(ctx, pal.hair, x + s - 4, y + s, 3, 3);
  } else {
    // Spiky hair, a tied headband with long tails, and an angry face.
    rect(ctx, pal.hair, x - 1, y - 1, s + 1, 3);
    for (let i = 0; i < 3; i++) rect(ctx, pal.hair, x + i * 3, y - 3 + (i % 2), 2, 2);
    rect(ctx, pal.band, x - 1, y + 2, s + 1, 2);
    rect(ctx, pal.band, x - 5, y + 2 + flutter, 4, 1);
    rect(ctx, pal.band, x - 9, y + 3 - flutter, 5, 1);
    rect(ctx, pal.ink, x + s - 5, y + 4, 4, 1);
    rect(ctx, pal.eye, x + s - 3, y + 5, 2, 1);
    rect(ctx, pal.skinShade, x + s - 4, y + s - 2, 3, 1);
  }
}

// Maps pose joints to this fighter's build: wide or narrow, short or tall.
const scaler = (pal) => (p) => [Math.round(p[0] * pal.scaleX), Math.round(p[1] * pal.scaleY)];

// One complete fighter, drawn relative to its feet and facing right.
function paintBody(ctx, pose, pal, flutter) {
  const S = scaler(pal);
  const sh = S(pose.sh), hip = S(pose.hip), head = S(pose.head);
  const shoulderX = Math.floor(pal.torsoW / 2) - 3;

  paintArm(ctx, pal, [sh[0] - shoulderX, sh[1] + 2], pose.rear.arm, S, true);
  paintLeg(ctx, pal, [hip[0] - 2, hip[1]], pose.rear.leg, S, true);

  if (pal.hakama && !pose.lying) {
    // Wide pleated trousers that hang from the belt to below the knee.
    const top = hip[1], bottom = Math.round(-5 * pal.scaleY), half = 11 + flutter;
    rect(ctx, pal.gi, hip[0] - half, top, half * 2, bottom - top);
    for (let px = hip[0] - half + 3; px < hip[0] + half; px += 5) rect(ctx, pal.fold, px, top + 1, 1, bottom - top - 1);
    rect(ctx, pal.giShade, hip[0] - half, bottom - 1, half * 2, 1);
  }

  if (pose.lying) {
    rect(ctx, pal.gi, sh[0], sh[1] - 5, hip[0] - sh[0], 10);
    rect(ctx, pal.giShade, sh[0], sh[1] + 3, hip[0] - sh[0], 2);
    rect(ctx, pal.belt, hip[0] - 3, sh[1] - 5, 3, 10);
  } else {
    paintLeg(ctx, pal, [hip[0] + 2, hip[1]], pose.lead.leg, S, false);
    paintTorso(ctx, pal, sh, hip);
    if (pal.bandolier) {
      // A strap of stars slung across the chest.
      limb(ctx, [sh[0] - 4, sh[1] + 1], [hip[0] + 4, hip[1] - 4], 2, pal.bandolier);
      limb(ctx, [sh[0] - 2, sh[1] + 3], [hip[0] + 2, hip[1] - 4], 1, pal.ink);
    }
  }
  if (pose.lying) paintLeg(ctx, pal, [hip[0] + 2, hip[1]], pose.lead.leg, S, false);

  paintHead(ctx, pal, head, flutter);
  paintArm(ctx, pal, [sh[0] + shoulderX, sh[1] + 2], pose.lead.arm, S, false);
}

// Draw a fighter with its feet at (f.x, y) in canvas space; `y` is the on-screen feet position.
export function drawFighter(ctx, f, { flash = false, alpha = 1, outline = null, y = f.y } = {}) {
  const pal = FIGHTER_PALETTES[f.kind] || FIGHTER_PALETTES.player;
  const pose = POSES[poseFor(f)];
  // Cloth tails swap between two positions as the fighter moves.
  const flutter = pose.lying ? 0 : Math.floor(f.walkCycle / 2) % 2;
  const edge = flash ? (typeof flash === 'string' ? flash : '#fff') : (outline || OUTLINE);
  const silhouette = solidPalette(f.kind, pal, edge);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(Math.round(f.x), Math.round(y));
  if (f.facing < 0) ctx.scale(-1, 1);

  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    ctx.translate(ox, oy);
    paintBody(ctx, pose, silhouette, flutter);
    ctx.translate(-ox, -oy);
  }
  paintBody(ctx, pose, flash ? silhouette : pal, flutter);
  // The star is shown in the raised hand during the wind-up, so the throw can be read in time.
  if (f.attack?.name === 'enemyThrow' && f.attackPhase === 'startup' && !flash) {
    const [hx, hy] = scaler(pal)(pose.lead.arm[1]);
    drawShuriken(ctx, hx, hy - 3, 0);
  }
  ctx.restore();
}

// A four-pointed throwing star centred on (x, y). `spin` 0 or 1 selects the rotation frame.
export function drawShuriken(ctx, x, y, spin = 0) {
  const cx = Math.round(x), cy = Math.round(y);
  const points = spin
    ? [[-3, -3, 2, 2], [2, -3, 2, 2], [-3, 2, 2, 2], [2, 2, 2, 2], [-2, -2, 5, 5]]
    : [[0, -4, 1, 9], [-4, 0, 9, 1], [-1, -2, 3, 5], [-2, -1, 5, 3]];
  ctx.fillStyle = OUTLINE;
  for (const [px, py, w, h] of points) ctx.fillRect(cx + px - 1, cy + py - 1, w + 2, h + 2);
  ctx.fillStyle = '#dfe6ee';
  for (const [px, py, w, h] of points) ctx.fillRect(cx + px, cy + py, w, h);
  ctx.fillStyle = '#7f8a96';
  ctx.fillRect(cx, cy, 1, 1);
}

// ---- 3x5 bitmap font ----------------------------------------------------
const GLYPHS = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '001', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
  A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'],
  C: ['111', '100', '100', '100', '111'], D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'], F: ['111', '100', '110', '100', '100'],
  G: ['111', '100', '101', '101', '111'], H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'], J: ['001', '001', '001', '101', '111'],
  K: ['101', '110', '100', '110', '101'], L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'], N: ['110', '101', '101', '101', '101'],
  O: ['111', '101', '101', '101', '111'], P: ['111', '101', '111', '100', '100'],
  Q: ['111', '101', '101', '111', '001'], R: ['110', '101', '110', '101', '101'],
  S: ['111', '100', '111', '001', '111'], T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'], V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'], X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'], Z: ['111', '001', '010', '100', '111'],
  'Ö': ['101', '000', '111', '101', '111'],
  'Ä': ['101', '010', '111', '101', '101'], 'Å': ['010', '000', '111', '101', '101'],
  '+': ['000', '010', '111', '010', '000'], '-': ['000', '000', '111', '000', '000'],
  '>': ['100', '010', '001', '010', '100'], '/': ['001', '001', '010', '100', '100'],
  '!': ['010', '010', '010', '000', '010'], ':': ['000', '010', '000', '010', '000'],
  '.': ['000', '000', '000', '000', '010'], ' ': ['000', '000', '000', '000', '000'],
};

export function textWidth(text, scale = 1) {
  return text.length * 4 * scale - scale;
}

// Draws uppercase pixel text. align: 'left' | 'center' | 'right'.
export function drawText(ctx, text, x, y, { color = '#fff', scale = 1, align = 'left', shadow = null } = {}) {
  const str = String(text).toUpperCase();
  const w = textWidth(str, scale);
  let cx = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
  const draw = (ox, oy, col) => {
    ctx.fillStyle = col;
    let px = cx + ox;
    for (const ch of str) {
      const g = GLYPHS[ch] || GLYPHS[' '];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 3; c++) {
          if (g[r][c] === '1') ctx.fillRect(px + c * scale, y + oy + r * scale, scale, scale);
        }
      }
      px += 4 * scale;
    }
  };
  if (shadow) { const o = Math.max(1, Math.floor(scale / 2)); draw(o, o, shadow); }
  draw(0, 0, color);
}
