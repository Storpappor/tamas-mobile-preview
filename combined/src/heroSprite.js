// Tamas Weber's sprite sheet: loading, frame detection, pre-scaling and drawing.
//
// The sheet is 4 columns x 2 rows (idle, step, punch, kick / block, hit, knockdown, victory).
// Cells are nominally imageWidth/4 by imageHeight/2, but a drawn sheet can spill a fist or a
// heel across the cell border, so each row is scanned for four separate blobs of opaque
// pixels instead of being cut blindly on the grid. Every frame is anchored at the feet so the
// character never shifts between poses, and the gameplay hitbox is unaffected by the artwork.
import { poseFor, throwPhase } from './sprites.js';
import { PHYSICS } from './constants.js';

export const HERO_COLUMNS = 4;
export const HERO_ROWS = 2;
export const HERO_FRAMES = ['idle', 'step', 'punch', 'kick', 'block', 'hit', 'knockdown', 'victory'];
export const HERO_HEIGHT = 40; // game units for the idle frame; matches the hand-drawn fighters

// The sprint sheet plays at 12 cells per second. The fighter's walk counter advances 15.75 per
// second while sprinting (9 per second x 1.75), so the renderer scales it; a drawing decision only.
export const SPRINT_CELL_RATE = 12 / 15.75;

// Pure function so it can be unit tested without a browser.
export function detectFrames(alpha, width, height, { columns = HERO_COLUMNS, rows = HERO_ROWS, threshold = 20, mergeGap = 12 } = {}) {
  const frames = [];
  const cellH = height / rows;
  const cellW = width / columns;
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor(r * cellH);
    const y1 = r === rows - 1 ? height : Math.floor((r + 1) * cellH);

    // Column occupancy for this row, then runs of occupied columns (small gaps merged).
    const occ = new Uint32Array(width);
    for (let y = y0; y < y1; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) if (alpha[row + x] > threshold) occ[x]++;
    }
    let runs = [];
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const v = x < width ? occ[x] : 0;
      if (v && start < 0) start = x;
      if (!v && start >= 0) {
        if (runs.length && start - runs[runs.length - 1][1] < mergeGap) runs[runs.length - 1][1] = x - 1;
        else runs.push([start, x - 1]);
        start = -1;
      }
    }
    if (runs.length !== columns) {
      // Unexpected layout: fall back to the plain grid for this row.
      runs = [];
      for (let c = 0; c < columns; c++) runs.push([Math.floor(c * cellW), Math.floor((c + 1) * cellW) - 1]);
    }

    for (const [x0, x1] of runs) {
      let top = -1, bottom = -1;
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        let any = false;
        for (let x = x0; x <= x1; x++) if (alpha[row + x] > threshold) { any = true; break; }
        if (any) { if (top < 0) top = y; bottom = y; }
      }
      if (top < 0) { top = y0; bottom = y1 - 1; }
      // Feet anchor: centre of the opaque pixels in the bottom slice of the figure.
      const band = Math.max(4, Math.floor((bottom - top) * 0.06));
      let fx0 = Infinity, fx1 = -Infinity;
      for (let y = Math.max(top, bottom - band); y <= bottom; y++) {
        const row = y * width;
        for (let x = x0; x <= x1; x++) if (alpha[row + x] > threshold) { if (x < fx0) fx0 = x; if (x > fx1) fx1 = x; }
      }
      const anchorX = fx0 <= fx1 ? (fx0 + fx1) / 2 - x0 : (x1 - x0) / 2;
      frames.push({ x: x0, y: top, w: x1 - x0 + 1, h: bottom - top + 1, anchorX });
    }
  }
  return frames;
}

// Which sheet frame to show for the player's current state.
//  idle 0 · walking alternates 0/1 · punch 2 · kick 3 · block 4 · hit 5 · knockdown 6 · victory 7
//  Jumping and throwing borrow the victory pose (arm raised); crouching borrows the low hit-reaction pose;
//  the grab borrows the punch (arm out).
export function heroFrameIndex(fighter, { victory = false } = {}) {
  if (victory && !fighter.dead) return 7;
  if (fighter.state === 'walk' && fighter.grounded && !fighter.attack) {
    return Math.floor(fighter.walkCycle * 0.75) % 2 ? 1 : 0;
  }
  switch (poseFor(fighter)) {
    case 'punchWind': case 'punch': case 'crouchPunch': case 'grab': return 2;
    case 'kickWind': case 'kick': case 'highKick': case 'crouchKick': return 3;
    case 'block': return 4;
    case 'hurt': case 'crouch': return 5;
    case 'fallen': return 6;
    case 'jump': case 'throw': return 7;
    case 'throwDone': return 0;
    default: return 0;
  }
}

// Resolve a fighter's drawing state for a JSON-mapped sheet: the state key from the asset
// spec plus how far through it the fighter is. Attacks report their phase so a 3-frame state
// shows wind-up / hit / recover in step with the attack table; walks report a loop counter.
export function heroState(f, { victory = false } = {}) {
  if (f.dead) {
    return f.deadTimer < 0.25 ? { state: 'hurt', progress: 0 } : { state: 'knockdown', progress: Math.min(1, (f.deadTimer - 0.25) / 0.3) };
  }
  if (victory) return { state: 'victory', progress: 0 };
  if (f.state === 'hurt') return { state: 'hurt', progress: Math.max(0, Math.min(1, 1 - f.hurtTimer / PHYSICS.hurtTime)) };
  if (f.attack) {
    const name = f.attack.name;
    const isKick = /kick/i.test(name);
    const low = name.startsWith('crouch');
    const phase = f.attackPhase;
    if (name === 'grab') return { state: name, phase, progress: 0 };
    if (name === 'throw') return { state: name, phase: throwPhase(f), progress: 0 };
    if (low && phase === 'startup') return { state: 'crouch', progress: 0 };
    const state = low ? (isKick ? 'crouchKick' : 'crouchPunch') : (isKick ? 'kick' : 'punch');
    return { state, phase, progress: 0 };
  }
  if (f.state === 'block') return { state: 'block', progress: 0 };
  if (!f.grounded) return { state: 'jump', progress: f.vy < 0 ? 0 : 1 };
  if (f.crouching) return { state: 'crouch', progress: 0 };
  if (f.state === 'walk') {
    if (f.sprinting) return { state: 'sprint', loop: f.walkCycle * SPRINT_CELL_RATE, fallback: 'walk' };
    return { state: 'walk', loop: f.walkCycle };
  }
  return { state: 'idle', progress: 0 };
}

// Cell for a resolved hero state on a JSON-mapped sheet, trying the state's fallback (for example
// `walk` for a sprint) before giving up; null means the caller should use other artwork.
export function resolveFrame(sheet, hs) {
  const index = sheet.frameFor(hs.state, hs);
  if (index !== null || !hs.fallback) return index;
  return sheet.frameFor(hs.fallback, hs);
}

// A sprite sheet described by a JSON frame map (see the asset spec): fixed cells, one anchor,
// and a list of cell indices per state. Sheets are authored at art resolution and drawn 1:1.
// A state missing from the map returns null so the caller can fall back to other artwork.
export class SpriteSheet {
  constructor({ map = null } = {}) {
    this.image = null;
    this.ready = false;
    this.cache = new Map();
    this.map = null;
    if (map) this.applyMap(map);
  }

  applyMap(map) {
    if (!map.cell || !map.anchor || !map.states) throw new Error('Sprite map needs cell, anchor and states');
    this.map = map;
    this.cell = map.cell;
    this.anchor = map.anchor;
    this.columns = map.columns || 1;
    this.states = map.states;
  }

  // Loads `<name>.json` and the PNG next to it (or the map's `image` path).
  async load(jsonUrl) {
    const res = await fetch(jsonUrl);
    if (!res.ok) throw new Error(`Could not load sprite map: ${jsonUrl}`);
    this.applyMap(await res.json());
    const pngUrl = this.map.image ? new URL(this.map.image, jsonUrl).href : jsonUrl.replace(/\.json$/, '.png');
    this.image = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`Could not load sprite sheet: ${pngUrl}`));
      i.src = pngUrl;
    });
    this.ready = true;
    return this;
  }

  has(state) {
    return Boolean(this.states && this.states[state] && this.states[state].length);
  }

  // Cell index for a state, or null when the sheet has no art for it.
  // `phase` (startup/active/recovery) spreads attack frames over the attack's own timing;
  // `loop` cycles frames (walks); otherwise `progress` 0..1 picks a frame evenly.
  frameFor(state, { phase = null, progress = 0, loop = null } = {}) {
    const frames = this.states && this.states[state];
    if (!frames || !frames.length) return null;
    if (loop !== null && loop !== undefined) return frames[((Math.floor(loop) % frames.length) + frames.length) % frames.length];
    if (phase) {
      if (frames.length >= 3) return phase === 'startup' ? frames[0] : phase === 'active' ? frames[1] : frames[frames.length - 1];
      if (frames.length === 2) return phase === 'recovery' ? frames[1] : frames[0];
      return frames[0];
    }
    return frames[Math.max(0, Math.min(frames.length - 1, Math.floor(progress * frames.length)))];
  }

  cellRect(index) {
    const col = index % this.columns, row = Math.floor(index / this.columns);
    return { x: col * this.cell.w, y: row * this.cell.h, w: this.cell.w, h: this.cell.h };
  }

  // Cell copied 1:1 (no resampling); `color` gives a flat silhouette for flash/outline effects.
  frameCanvas(index, color = null) {
    const key = `${index}:${color || ''}`;
    let c = this.cache.get(key);
    if (c) return c;
    const r = this.cellRect(index);
    c = document.createElement('canvas');
    c.width = r.w;
    c.height = r.h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(this.image, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    if (color) {
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = color;
      g.fillRect(0, 0, r.w, r.h);
    }
    this.cache.set(key, c);
    return c;
  }

  // Draw a cell with its anchor pixel on the feet position (x, y) in art pixels; facing -1 mirrors.
  // The anchor row lands on the row just above y, matching how the fallback hero sits on the floor.
  draw(ctx, index, x, y, facing, { alpha = 1, flash = null, outline = null } = {}) {
    if (!this.ready) return;
    const c = this.frameCanvas(index, flash);
    const ox = -this.anchor.x, oy = -this.anchor.y - 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(x), Math.round(y));
    if (facing < 0) ctx.scale(-1, 1);
    if (outline && !flash) {
      const s = this.frameCanvas(index, outline);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.drawImage(s, ox + dx, oy + dy);
    }
    ctx.drawImage(c, ox, oy);
    ctx.restore();
  }
}

export class HeroSprite {
  // `artScale` = art pixels per game unit; frames are pre-scaled so the idle frame is
  // HERO_HEIGHT * artScale pixels tall and drawn 1:1 into the art buffer.
  constructor({ artScale = 1 } = {}) {
    this.artScale = artScale;
    this.image = null;
    this.frames = null;
    this.scale = 1;
    this.ready = false;
    this.cache = new Map();
  }

  async load(url) {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`Could not load sprite sheet: ${url}`));
      i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    const alpha = new Uint8Array(c.width * c.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];

    this.frames = detectFrames(alpha, c.width, c.height);
    this.frames[6].anchorX = this.frames[6].w / 2; // the lying figure is centred, not stood on its feet
    this.image = img;
    this.scale = (HERO_HEIGHT * this.artScale) / this.frames[0].h;
    this.ready = true;
    return this;
  }

  // Frame pre-scaled with nearest-neighbour sampling; `color` gives a flat silhouette (flash/outline).
  frameCanvas(index, color = null) {
    const key = `${index}:${color || ''}`;
    let c = this.cache.get(key);
    if (c) return c;
    const f = this.frames[index];
    const w = Math.max(1, Math.round(f.w * this.scale));
    const h = Math.max(1, Math.round(f.h * this.scale));
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(this.image, f.x, f.y, f.w, f.h, 0, 0, w, h);
    if (color) {
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = color;
      g.fillRect(0, 0, w, h);
    }
    this.cache.set(key, c);
    return c;
  }

  // Draw a frame with the feet at (x, y), both in art pixels. facing -1 mirrors it for left-facing.
  draw(ctx, index, x, y, facing, { alpha = 1, flash = null, outline = null } = {}) {
    if (!this.ready) return;
    const f = this.frames[index];
    const c = this.frameCanvas(index, flash);
    const ax = Math.round(f.anchorX * this.scale);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(x), Math.round(y));
    if (facing < 0) ctx.scale(-1, 1);
    if (outline && !flash) {
      const s = this.frameCanvas(index, outline);
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.drawImage(s, -ax + ox, -c.height + oy);
    }
    ctx.drawImage(c, -ax, -c.height);
    ctx.restore();
  }

  // Paint one frame onto a DOM canvas at an integer zoom (used by the victory screen).
  paintTo(canvas, index, zoom = 3) {
    if (!this.ready) return;
    const c = this.frameCanvas(index);
    canvas.width = c.width * zoom;
    canvas.height = c.height * zoom;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(c, 0, 0, canvas.width, canvas.height);
  }
}
