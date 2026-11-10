// Canvas renderer: draws the world into a small native-resolution buffer and
// scales it up with nearest-neighbour filtering for crisp pixels.
import { VIEW_W, VIEW_H, GROUND_Y, FLOOR_TOP, WORLD_WIDTH, COLORS, screenY } from './constants.js';
import { LEVEL_1 } from './level.js';
import { drawFighter, drawShuriken, drawText } from './sprites.js';
import { displayText } from './names.js';
import { heroFrameIndex, heroState, resolveFrame } from './heroSprite.js';
import { enemyState } from './enemySprite.js';
import { ART_SCALE } from './artScale.js';
import { validateBackground } from './background.js';

// Size of the draw buffer in art pixels.
const BUF_W = VIEW_W * ART_SCALE;
const BUF_H = VIEW_H * ART_SCALE;

// The street outside the real Sanshin Kan dojo on Södermalm, Stockholm.
const STREET = {
  plaster: '#cfc9ba', plasterShade: '#bdb7a8', stone: '#a9a596', stoneLine: '#97937f', stoneJoint: '#858170',
  frame: '#2e6b4b', glass: '#39434a', glassLight: '#5d6a70', awning: '#2a6345', awningLight: '#3c8058',
  wood: '#a8662e', woodDark: '#6f3f1c', woodPane: '#3a2a1e', shutter: '#d9d7d0', recess: '#4d493f',
  orange: '#d8963f', orangeShade: '#c4832f', surround: '#ece6d8', plinth: '#97958e', plinthDot: '#7f7d76', bars: '#23201e',
  pipe: '#17181c', sign: '#17161a', signText: '#f4f1e6', dot: '#c8372d',
  slab: '#b6b1a4', slabSeam: '#9b9689', kerb: '#8d897e', road: '#3a3b42', roadDot: '#4a4b52',
  night: 'rgba(16,22,58,0.14)', lit: '#e8c16a', redGlow: '#d8402f',
};

// The training hall: white walls, low ceiling with ducts, red padded pillars, red and sage mats.
const DOJO = {
  wall: '#f1e3dd', wallShade: '#dfcdc6', ceiling: '#efe4d8', ceilingShade: '#d8c9bb', duct: '#a9a49b', ductLight: '#c6c1b8',
  tube: '#ffffff', tubeGlow: '#fff6d8', red: '#d6402c', redDark: '#ad2f20', redLight: '#e4604c', stripe: '#f6f1ea', cap: '#3a3532',
  column: '#f5ebe6', columnShade: '#dccdc6', wood: '#5a3522', woodLight: '#7a4c30', staff: '#b98d57',
  frame: '#1f1a18', paper: '#efe6cf', ink: '#2a2523', mirror: '#d3dcda', mirrorLight: '#e6edeb', mirrorFrame: '#8f8a84',
  bag: '#1a1a1e', bagLight: '#34343a', skin: '#d6b08c', matRed: '#d8402c', matRedDark: '#bf3423', matGreen: '#9aa184', matGreenDark: '#858c70',
};

// Top of the street door in game units. The hand-drawn street (assets/backgrounds/street.png) paints
// its door leaves at art rows 140-243, so the opening is y 70-122 (52 units); the near-black fill
// drawn while Tamas walks in must cover exactly those leaves. The same height is used by the
// procedural street painter's doors, which only show when the image is missing. The dojo has no exit
// and does not use this value.
const DOOR_TOP = 70;

// Pixel size of the HUD-independent GO prompt, in native pixels.
const GO_X = VIEW_W - 58;
const GO_Y = 30;

// Run `paint` with drawing limited to one zone, so each zone's patterns stay inside it.
function inZone(g, zone, paint) {
  g.save();
  g.beginPath();
  g.rect(zone.from, 0, zone.to - zone.from, VIEW_H);
  g.clip();
  paint(zone.from, zone.to);
  g.restore();
}

function box(g, color, x, y, w, h) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

// ---- Street ---------------------------------------------------------------

// Green-framed window with a bare-branch reflection and an awning over it.
function greenWindow(g, x, y, w, h, awning, lit, litList) {
  if (awning) {
    box(g, STREET.awning, x - 3, y - 6, w + 6, 4);
    box(g, STREET.awningLight, x - 3, y - 6, w + 6, 1);
  }
  box(g, STREET.frame, x, y, w, h);
  box(g, STREET.glass, x + 2, y + 2, w - 4, h - 4);
  box(g, STREET.frame, x + Math.floor(w / 2), y + 2, 1, h - 4);
  if (lit) litList.push([x + 2, y + 2, w - 4, h - 4]);
  else for (let i = 0; i < 4; i++) box(g, STREET.glassLight, x + 4 + i * 4, y + h - 5 - i * 3, 1, 3 + i);
}

// Wooden double door with rows of small panes, as at the dojo entrance.
function woodenDoor(g, x, w) {
  const top = DOOR_TOP, h = FLOOR_TOP - top;
  box(g, STREET.recess, x - 2, top - 2, w + 4, h + 2);
  box(g, STREET.wood, x, top, w, h);
  box(g, STREET.woodDark, x + Math.floor(w / 2), top, 1, h);
  const leaf = Math.floor(w / 2);
  for (const lx of [x, x + leaf]) {
    for (let px = lx + 3; px < lx + leaf - 3; px += 4) box(g, STREET.woodPane, px, top + 4, 2, 14);
    box(g, STREET.woodDark, lx + 2, top + 21, leaf - 4, 1);
  }
}

function beigeBuilding(g, x, w, lits, { door = null } = {}) {
  box(g, STREET.plaster, x, 0, w, 84);
  box(g, STREET.plasterShade, x, 80, w, 4);
  // Stone-clad ground floor with fine horizontal veining.
  box(g, STREET.stone, x, 84, w, FLOOR_TOP - 84);
  for (let y = 86; y < FLOOR_TOP; y += 3) box(g, STREET.stoneLine, x, y, w, 1);
  for (let jx = x + 14; jx < x + w; jx += 34) box(g, STREET.stoneJoint, jx, 84, 1, FLOOR_TOP - 84);

  for (let wx = x + 18, i = 0; wx < x + w - 44; wx += 66, i++) {
    greenWindow(g, wx, 6, 40, 22, false, i % 3 === 1, lits);
    greenWindow(g, wx, 42, 40, 30, true, i % 4 === 3, lits);
  }

  if (door) {
    const doorX = door.x - door.width / 2;
    woodenDoor(g, doorX, door.width);
    // The neighbouring entrance and white shutter.
    woodenDoor(g, doorX - 88, 36);
    box(g, STREET.shutter, doorX - 42, 92, 30, FLOOR_TOP - 92);
    box(g, STREET.recess, doorX - 42, 90, 30, 2);
  } else {
    woodenDoor(g, x + Math.floor(w / 2) - 18, 36);
  }
}

function orangeBuilding(g, x, w, lits) {
  box(g, STREET.orange, x, 0, w, 98);
  box(g, STREET.orangeShade, x, 92, w, 6);
  // Plain upper windows in white surrounds.
  for (let wx = x + 22, i = 0; wx < x + w - 38; wx += 62, i++) {
    box(g, STREET.surround, wx - 3, 5, 34, 34);
    box(g, STREET.glass, wx, 8, 28, 28);
    box(g, STREET.surround, wx + 13, 8, 2, 28);
    if (i % 2 === 0) lits.push([wx, 8, 13, 28]);
    // Arched windows on the floor below.
    box(g, STREET.surround, wx - 3, 54, 34, 36);
    box(g, STREET.surround, wx + 1, 50, 26, 4);
    box(g, STREET.surround, wx + 5, 47, 18, 3);
    box(g, STREET.glass, wx, 58, 28, 30);
    box(g, STREET.glass, wx + 3, 54, 22, 4);
    box(g, STREET.glass, wx + 7, 51, 14, 3);
    box(g, STREET.surround, wx + 13, 52, 2, 36);
  }
  // Rough grey plinth with a barred basement window.
  box(g, STREET.plinth, x, 98, w, FLOOR_TOP - 98);
  for (let py = 100; py < FLOOR_TOP; py += 4) {
    for (let px = x + (py % 8 === 0 ? 2 : 6); px < x + w; px += 8) box(g, STREET.plinthDot, px, py, 1, 1);
  }
  for (let wx = x + 28; wx < x + w - 34; wx += 124) {
    box(g, STREET.redGlow, wx, 104, 22, 12);
    for (let bx = wx; bx < wx + 22; bx += 4) box(g, STREET.bars, bx, 104, 1, 12);
  }
}

function paintStreet(g, from, to, zone) {
  const lits = [];
  // The street ends at the dojo's own building, right next to the way in.
  const dojoW = 340;
  const buildings = [
    [from, 216, 'orange'],
    [from + 216, 240, 'beige'],
    [from + 456, 204, 'orange'],
    [to - dojoW, dojoW, 'dojo'],
  ];
  for (const [x, w, kind] of buildings) {
    if (kind === 'orange') orangeBuilding(g, x, w, lits);
    else beigeBuilding(g, x, w, lits, { door: kind === 'dojo' ? zone.exit : null });
    box(g, STREET.pipe, x + w - 2, 0, 2, FLOOR_TOP);
  }

  // Light stone pavement, kerb, then the road.
  box(g, STREET.slab, from, FLOOR_TOP, to - from, 24);
  for (let y = FLOOR_TOP, row = 0; y < FLOOR_TOP + 24; y += 8, row++) {
    box(g, STREET.slabSeam, from, y, to - from, 1);
    for (let x = from + (row % 2 ? 12 : 0); x < to; x += 24) box(g, STREET.slabSeam, x, y, 1, 8);
  }
  box(g, STREET.kerb, from, FLOOR_TOP + 24, to - from, 2);
  box(g, STREET.road, from, FLOOR_TOP + 26, to - from, VIEW_H - FLOOR_TOP - 26);
  for (let y = FLOOR_TOP + 28, row = 0; y < VIEW_H; y += 3, row++) {
    for (let x = from + (row * 7) % 11; x < to; x += 11) box(g, STREET.roadDot, x, y, 1, 1);
  }

  // Midnight in Stockholm: dim everything, then let the lit windows and the club sign shine through.
  box(g, STREET.night, from, 0, to - from, VIEW_H);
  for (const [x, y, w, h] of lits) box(g, STREET.lit, x, y, w, h);
  const signX = zone.exit.x - 40; // centred over the dojo door
  box(g, STREET.sign, signX, 72, 80, 15);
  box(g, STREET.dot, signX + 38, 74, 4, 3);
  drawText(g, 'SANSHIN KAN KARATE', signX + 40, 79, { color: STREET.signText, align: 'center' });
}

// ---- Dojo -----------------------------------------------------------------

function framedPaper(g, x, y, w, h) {
  box(g, DOJO.frame, x, y, w, h);
  box(g, DOJO.paper, x + 1, y + 1, w - 2, h - 2);
  box(g, DOJO.ink, x + 3, y + 3, w - 6, 1);
  box(g, DOJO.ink, x + 3, y + 6, w - 8, 1);
}

// Red padded pillar with two white bands, vertical lettering and a dark foot.
function pillar(g, x, belts) {
  const w = 18, top = 26, bottom = FLOOR_TOP + 7;
  box(g, DOJO.column, x, 12, w, top - 12);
  box(g, DOJO.columnShade, x, 12, 3, top - 12);
  box(g, DOJO.red, x, top, w, bottom - top);
  box(g, DOJO.redDark, x, top, 3, bottom - top);
  box(g, DOJO.redLight, x + w - 2, top, 2, bottom - top);
  box(g, DOJO.cap, x, top, w, 3);
  box(g, DOJO.cap, x, bottom - 3, w, 3);
  box(g, DOJO.stripe, x, 86, w, 4);
  box(g, DOJO.stripe, x, 94, w, 4);
  for (let y = 34; y < 80; y += 7) box(g, DOJO.stripe, x + 8, y, 3, 4);
  if (belts) {
    const colors = ['#1a1a1e', '#2f5fc4', '#7a2f8f', '#1a1a1e'];
    colors.forEach((c, i) => box(g, c, x + 11 + i * 2, 34, 2, 60 + (i % 2) * 6));
  }
}

function clubBanner(g, x) {
  const w = 176, h = 24, y = 24;
  box(g, DOJO.redDark, x - 1, y - 1, w + 2, h + 2);
  box(g, DOJO.red, x, y, w, h);
  box(g, DOJO.stripe, x + 8, y, 4, h);
  // The club name between two white emblems.
  for (const [cx, inner] of [[x + 34, DOJO.red], [x + 154, DOJO.stripe]]) {
    box(g, DOJO.stripe, cx - 4, y + 6, 8, 12);
    box(g, DOJO.stripe, cx - 6, y + 8, 12, 8);
    box(g, DOJO.red, cx - 3, y + 8, 6, 8);
    box(g, inner, cx - 1, y + 10, 2, 4);
  }
  drawText(g, 'SANSHIN KAN', x + w / 2 + 6, y + 7, { color: DOJO.stripe, scale: 2, align: 'center' });
}

function mirror(g, x, w, reflection) {
  const y = 30, h = FLOOR_TOP - y - 8;
  box(g, DOJO.mirrorFrame, x - 1, y - 1, w + 2, h + 2);
  box(g, DOJO.mirror, x, y, w, h);
  // Mats and a pillar seen in the glass.
  box(g, DOJO.matRed, x, y + h - 14, w, 14);
  box(g, DOJO.matGreen, x + 4, y + h - 10, w - 16, 5);
  box(g, DOJO.red, x + reflection, y + 8, 10, h - 22);
  box(g, DOJO.stripe, x + reflection, y + 44, 10, 2);
  box(g, DOJO.stripe, x + reflection, y + 48, 10, 2);
  for (let i = 0; i < 3; i++) box(g, DOJO.mirrorLight, x + w - 22 + i * 6, y + 4 + i * 3, 2, 12);
}

function heavyBag(g, x) {
  box(g, DOJO.bag, x, 66, 13, 50);
  box(g, DOJO.bagLight, x + 9, 66, 2, 50);
  box(g, DOJO.red, x, 106, 13, 5);
  box(g, DOJO.bag, x - 3, 116, 19, 7);
}

// Training dummy in a red chest protector beside the flag.
function dummyAndFlag(g, x) {
  box(g, DOJO.stripe, x - 28, 36, 20, 54);
  box(g, DOJO.wallShade, x - 28, 36, 2, 54);
  box(g, DOJO.red, x - 22, 46, 8, 8);
  box(g, DOJO.skin, x + 2, 50, 8, 9);
  box(g, DOJO.red, x - 2, 59, 16, 24);
  box(g, DOJO.stripe, x + 2, 59, 8, 3);
  box(g, DOJO.bag, x + 3, 83, 6, 28);
  box(g, DOJO.bag, x - 3, 111, 18, 12);
}

// Weapon rack with staffs, dark wooden panelling, belt rank board and framed papers.
function displayWall(g, x) {
  for (let i = 0; i < 5; i++) framedPaper(g, x + i * 22, 16, 18, 13);
  box(g, DOJO.wood, x - 6, 33, 132, 3);
  box(g, DOJO.wood, x, 40, 4, 64);
  box(g, DOJO.wood, x + 34, 40, 4, 64);
  for (let y = 46; y < 100; y += 9) box(g, DOJO.staff, x - 4, y, 48, 2);
  box(g, DOJO.wood, x + 52, 40, 72, 50);
  box(g, DOJO.woodLight, x + 54, 42, 68, 46);
  framedPaper(g, x + 57, 46, 16, 20);
  framedPaper(g, x + 57, 70, 16, 14);
  box(g, DOJO.frame, x + 78, 44, 16, 40);
  ['#f4f1e6', '#e6c94a', '#e07b2c', '#3f8f4a', '#2f5fc4', '#7a4c30', '#1a1a1e'].forEach((c, i) => box(g, c, x + 80, 46 + i * 5, 12, 4));
  framedPaper(g, x + 100, 46, 18, 16);
  framedPaper(g, x + 100, 66, 18, 16);
  box(g, DOJO.wallShade, x - 6, 104, 132, 2);
}

function paintDojo(g, from, to) {
  box(g, DOJO.wall, from, 0, to - from, FLOOR_TOP);
  box(g, DOJO.wallShade, from, FLOOR_TOP - 4, to - from, 4);

  // Low white ceiling with ventilation ducts and fluorescent tubes.
  box(g, DOJO.ceiling, from, 0, to - from, 11);
  box(g, DOJO.ceilingShade, from, 10, to - from, 2);
  box(g, DOJO.duct, from, 2, to - from, 4);
  box(g, DOJO.ductLight, from, 2, to - from, 1);
  for (let x = from + 14; x < to; x += 54) box(g, DOJO.ceilingShade, x, 1, 2, 6);
  for (let x = from + 60; x < to; x += 150) {
    box(g, DOJO.tubeGlow, x - 3, 11, 50, 3);
    box(g, DOJO.tube, x, 8, 44, 3);
  }

  // The door from the street, seen from the inside.
  box(g, STREET.woodDark, from + 3, 84, 24, FLOOR_TOP - 84);
  box(g, STREET.wood, from + 5, 86, 20, FLOOR_TOP - 86);
  box(g, STREET.woodDark, from + 15, 86, 1, FLOOR_TOP - 86);

  displayWall(g, from + 34);
  dummyAndFlag(g, from + 214);
  clubBanner(g, from + 270);
  for (let i = 0; i < 3; i++) framedPaper(g, from + 330 + i * 26, 14, 16, 8);
  mirror(g, from + 470, 110, 60);
  heavyBag(g, from + 610);
  mirror(g, from + 650, 96, 20);
  heavyBag(g, from + 766);
  displayWall(g, to - 130);

  // Mats: red base with blocks of sage-green tatami.
  box(g, DOJO.matRed, from, FLOOR_TOP, to - from, VIEW_H - FLOOR_TOP);
  for (let y = FLOOR_TOP + 1; y < VIEW_H; y += 2) {
    for (let x = from + (y % 4 === 1 ? 0 : 2); x < to; x += 4) box(g, DOJO.matRedDark, x, y, 1, 1);
  }
  const rows = [[FLOOR_TOP + 5, 19, 0], [FLOOR_TOP + 30, 26, 74]];
  for (const [y, h, offset] of rows) {
    for (let x = from - 60 + offset; x < to; x += 212) {
      box(g, DOJO.matGreen, x, y, 148, h);
      box(g, DOJO.matGreenDark, x + 74, y, 1, h);
      box(g, DOJO.matGreenDark, x, y + h - 1, 148, 1);
    }
  }

  // Pillars stand out on the floor, so they go on top of the wall and the mats.
  pillar(g, from + 150, false);
  pillar(g, from + 440, true);
  pillar(g, from + 730, false);
}

const PAINTERS = { street: paintStreet, dojo: paintDojo };

// Pre-render the whole level once; the camera just slides across it.
// A zone with a valid hand-drawn background is blitted 1:1 at its art column; every other zone is
// painted procedurally in game units, with the scale transform turning them into art pixels.
export function buildWorld(createCanvas, zones, images = null) {
  const c = createCanvas(WORLD_WIDTH * ART_SCALE, VIEW_H * ART_SCALE);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  for (const zone of zones) {
    const img = images && images[zone.art];
    if (img && validateBackground(img, zone) === null) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(img, zone.from * ART_SCALE, 0);
    } else {
      g.setTransform(ART_SCALE, 0, 0, ART_SCALE, 0, 0);
      inZone(g, zone, (from, to) => PAINTERS[zone.art](g, from, to, zone));
    }
  }
  return c;
}

export class Renderer {
  constructor(displayCanvas, { reducedMotion = false, createCanvas, hero = null, heroSheet = null, enemySheets = {} } = {}) {
    this.hero = hero;           // legacy hero sheet: fallback for states the new sheet lacks
    this.heroSheet = heroSheet; // JSON-mapped production sheet (may cover only some states)
    this.enemySheets = enemySheets; // JSON-mapped sheet per enemy kind; a kind without one is drawn procedurally
    this.display = displayCanvas;
    this.ctx = displayCanvas.getContext('2d');
    this.createCanvas = createCanvas || ((w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; });
    this.buffer = this.createCanvas(BUF_W, BUF_H);
    this.bctx = this.buffer.getContext('2d');
    this.world = buildWorld(this.createCanvas, LEVEL_1.zones);
    this.backgrounds = {};
    this.reducedMotion = reducedMotion;
    this.zoom = ART_SCALE;  // display pixels per game unit
    this.camX = 0;
  }

  // Install hand-drawn zone backgrounds once they have loaded. An image of the wrong size is refused
  // with a warning and that zone keeps its painter; the live world is replaced only after the new one
  // has been built completely, so a failure leaves the current picture untouched.
  setBackgrounds(images) {
    const accepted = {};
    for (const zone of LEVEL_1.zones) {
      const img = images && images[zone.art];
      if (!img) continue;
      const problem = validateBackground(img, zone);
      if (problem) { console.warn(`Background ignored: ${problem}`); continue; }
      accepted[zone.art] = img;
    }
    let world;
    try { world = buildWorld(this.createCanvas, LEVEL_1.zones, accepted); }
    catch (err) { console.warn(`Background world not rebuilt: ${err.message}`); return false; }
    this.backgrounds = accepted;
    this.world = world;
    return Object.keys(accepted).length > 0;
  }

  // Choose how many display pixels one game unit gets (`zoom`), in this order of preference:
  //  1. a whole number of display pixels per ART pixel (perfectly square art pixels),
  //  2. else a whole number per GAME unit (the world grid stays exact; fine art detail alternates
  //     between two sizes), which is exactly what the game did before the art scale,
  //  3. else fill the container (used only on very narrow screens).
  // A fit is accepted when it covers at least 80% of the container width.
  resize(containerCssWidth, dpr = 1) {
    const device = containerCssWidth * dpr;
    const fits = (px) => px >= device * 0.8;
    const k = Math.floor(device / BUF_W);
    const n = Math.floor(device / VIEW_W);
    let zoom;
    if (k >= 1 && fits(BUF_W * k)) zoom = k * ART_SCALE;
    else if (n >= ART_SCALE && fits(VIEW_W * n)) zoom = n;
    else zoom = device / VIEW_W;
    this.zoom = zoom;
    this.display.width = Math.round(VIEW_W * zoom);
    this.display.height = Math.round(VIEW_H * zoom);
    this.display.style.width = `${this.display.width / dpr}px`;
    this.display.style.height = `${this.display.height / dpr}px`;
  }

  render(game, time) {
    const g = this.bctx;
    const camX = Math.round(game.camX);
    this.camX = camX;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.world, -camX * ART_SCALE, 0);

    // Everything below is drawn in game units; the scale transform makes them art pixels.
    g.save();
    g.scale(ART_SCALE, ART_SCALE);
    g.translate(-camX, 0);

    // The door stands open while the player goes through it.
    const zone = game.zone;
    if (game.transition && game.transition.phase !== 'fadeIn' && zone?.exit) {
      const { x, width } = zone.exit;
      box(g, '#14100e', x - width / 2, DOOR_TOP, width, FLOOR_TOP - DOOR_TOP);
    }

    const fighters = [...game.enemies, game.player].filter((f) => !f.remove);
    // Shadows stay on the floor even when a fighter jumps.
    g.fillStyle = COLORS.shadow;
    for (const f of fighters) {
      const w = f.dead && f.deadTimer > 0.25 ? 30 : 14;
      g.fillRect(Math.round(f.x - w / 2), Math.round(screenY(GROUND_Y, f.z)) - 1, w, 2);
    }

    // Whoever stands nearer the viewer is drawn last, on top; a fighter in Tamas's grip is drawn
    // over him so the grab stays readable.
    fighters.sort((a, b) => a.z - b.z || (a.held ? 1 : 0) - (b.held ? 1 : 0));
    for (const f of fighters) this.drawOne(g, f, time, f === game.player && game.ending === 'victory');

    // Shuriken in flight, with a floor shadow that shows which depth lane they fly along.
    const spin = this.reducedMotion ? 0 : Math.floor(time * 16) % 2;
    for (const s of game.projectiles) {
      g.fillStyle = COLORS.shadow;
      g.fillRect(Math.round(s.x) - 3, Math.round(screenY(GROUND_Y, s.z)) - 1, 6, 2);
      drawShuriken(g, s.x, screenY(s.y, s.z) - 33, spin);
    }

    for (const p of game.particles) {
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    for (const t of game.texts) {
      drawText(g, t.text, Math.round(t.x), Math.round(t.y), { color: t.color, scale: t.scale || 1, align: 'center', shadow: '#1a1210' });
    }
    // An arrow over the door shows the way in once the street has been won.
    const exit = game.openExit;
    if (exit && !game.transition && !game.ending && (this.reducedMotion || Math.floor(time * 3) % 2 === 0)) this.drawDoorArrow(g, exit.x);
    g.restore();

    if (game.fade > 0) {
      g.fillStyle = `rgba(0,0,0,${game.fade})`;
      g.fillRect(0, 0, BUF_W, BUF_H);
    }

    g.save();
    g.scale(ART_SCALE, ART_SCALE);
    if (game.banner) {
      const a = Math.min(1, game.banner.life * 2);
      g.globalAlpha = a;
      g.fillStyle = 'rgba(20,12,8,0.75)';
      g.fillRect(0, 44, VIEW_W, 26);
      drawText(g, displayText(game.banner.text), VIEW_W / 2, 50, { color: '#ffd166', scale: 2, align: 'center', shadow: '#5a1e12' });
      g.globalAlpha = 1;
    }
    if (game.state === 'playing' && game.elapsed < 2.2) {
      g.globalAlpha = game.elapsed < 1.8 ? 1 : (2.2 - game.elapsed) / 0.4;
      drawText(g, 'FIGHT!', VIEW_W / 2, 78, { color: '#ffffff', scale: 3, align: 'center', shadow: '#5a1e12' });
      g.globalAlpha = 1;
    }
    if (game.showGo && (this.reducedMotion || Math.floor(time * 3) % 2 === 0)) this.drawGo(g);
    g.restore();

    // Blit to the visible canvas (with optional screen shake, measured in game units).
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.display.width, this.display.height);
    let sx = 0, sy = 0;
    if (game.shake > 0 && !this.reducedMotion) {
      sx = Math.round((Math.random() - 0.5) * 4) * this.zoom;
      sy = Math.round((Math.random() - 0.5) * 3) * this.zoom;
    }
    ctx.drawImage(this.buffer, sx, sy, this.display.width, this.display.height);
  }

  // A pixel arrow pointing down at the door. It sits at y 24-43 (art rows 48-86), above the sign the
  // street artwork paints at rows 100-135, and below nothing: the zone banner (y 44-70) is long gone
  // by the time the door opens.
  drawDoorArrow(g, x) {
    const top = 24, cx = Math.round(x);
    box(g, '#5a1e12', cx - 3, top, 8, 12);
    for (let i = 0; i < 8; i++) box(g, '#5a1e12', cx - 8 + i, top + 11 + i, 18 - i * 2, 2);
    box(g, '#ffd166', cx - 2, top, 5, 12);
    for (let i = 0; i < 7; i++) box(g, '#ffd166', cx - 7 + i, top + 11 + i, 15 - i * 2, 1);
  }

  // "GO" with a pixel arrow pointing the way forward.
  drawGo(g) {
    drawText(g, 'GO', GO_X, GO_Y, { color: '#ffd166', scale: 3, shadow: '#5a1e12' });
    const ax = GO_X + 26, ay = GO_Y + 7;
    g.fillStyle = '#5a1e12'; g.fillRect(ax + 1, ay - 1, 10, 4);
    g.fillStyle = '#ffd166'; g.fillRect(ax, ay - 2, 10, 4);
    for (let i = 0; i < 6; i++) g.fillRect(ax + 9 + i, ay - 7 + i, 1, 14 - i * 2);
  }

  drawOne(g, f, time, victory = false) {
    let alpha = 1;
    // Beaten enemies fade out; the hero stays on the floor so the knockdown reads on the game-over screen.
    if (f.dead && f.deadTimer > 0.5 && f.kind !== 'player') alpha = Math.max(0, 1 - (f.deadTimer - 0.5) / 0.4);
    if (f.invulnerable > 0 && !f.dead) {
      if (this.reducedMotion) alpha = 0.6;
      else if (Math.floor(time * 24) % 2 === 0) return;
    }
    const flash = f.flashTimer > 0 && !this.reducedMotion;
    // Kiai aura: a warm outline that flickers (steady when reduced motion is preferred).
    let outline = null;
    if (f.kiaiActive) outline = this.reducedMotion || Math.floor(time * 12) % 3 !== 0 ? COLORS.kiai : '#ffe9b0';
    const y = screenY(f.y, f.z);
    // A JSON-mapped sheet, for Tamas or for an enemy kind that has one, is drawn in art pixels outside
    // the game-unit transform; a state the sheet does not map falls through to the other artwork.
    const sheet = f.kind === 'player' ? this.heroSheet : this.enemySheets[f.kind];
    if (sheet && sheet.ready) {
      const index = resolveFrame(sheet, f.kind === 'player' ? heroState(f, { victory }) : enemyState(f));
      if (index !== null) {
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        sheet.draw(g, index, (f.x - this.camX) * ART_SCALE, y * ART_SCALE, f.facing, { alpha, flash: flash ? '#fff' : null, outline });
        g.restore();
        return;
      }
    }
    if (f.kind === 'player' && this.hero && this.hero.ready) {
      // The hero sheet is pre-scaled to art pixels, so it is drawn outside the game-unit transform
      // to keep its full detail; its feet still land on the same game-unit position.
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      this.hero.draw(g, heroFrameIndex(f, { victory }), (f.x - this.camX) * ART_SCALE, y * ART_SCALE, f.facing, { alpha, flash: flash ? '#fff' : null, outline });
      g.restore();
      return;
    }
    drawFighter(g, f, { flash, alpha, outline, y });
  }
}
