// Keyboard and touch input, normalised into one action set.
// "held" actions are true while the key/button is down; "pressed" actions fire once per press.
//
// Every action is held by its *sources*: the keyboard counts as one source ('key') and each
// touch pointer is its own source (its pointerId). An action stays held while any source holds
// it, so lifting one thumb never cancels what another thumb, or a key, is still holding.
const KEY_MAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  KeyC: 'duck',
  Space: 'jump',
  KeyJ: 'punch',
  KeyK: 'kick',
  KeyL: 'block',
  KeyI: 'kiai',
};
// Fallback by key name for environments that do not report `code` (some virtual keyboards).
const KEY_NAME_MAP = {
  ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowDown: 'down', s: 'down',
  ArrowUp: 'up', w: 'up', c: 'duck', ' ': 'jump', j: 'punch', k: 'kick', l: 'block', i: 'kiai',
};
// `throw` is the touch panel's dedicated button: in the snapshot it becomes punch and kick on the
// same step, which is exactly the grab chord the game reads, so the game itself never sees it.
// `sprint` is the touch pad's "drag farther to run": held while the thumb is in the outer zone.
// The keyboard has no sprint key; it keeps the double-tap.
const ACTIONS = ['left', 'right', 'up', 'down', 'duck', 'block', 'jump', 'punch', 'kick', 'kiai', 'throw', 'sprint'];
const EDGE_ACTIONS = new Set(['jump', 'punch', 'kick', 'kiai', 'throw']);
const PAD_DIRECTIONS = ['left', 'right', 'up', 'down'];
const KEY_SOURCE = 'key';

// Movement pad geometry, as fractions of the pad's half size (its usable radius):
//  - inside `deadZone` nothing is held (stop);
//  - beyond `axisThreshold` on an axis that direction is held, so a thumb between two arrows holds
//    both (a diagonal);
//  - beyond `runEnter` the thumb asks for the sprint; it keeps it until it comes back inside
//    `runExit` (two thresholds so a thumb resting near the line does not flicker);
//  - the thumb may leave the pad; the pointer stays captured and the run stays on.
export const PAD = {
  deadZone: 0.28,
  axisThreshold: 0.38,
  runEnter: 0.80,
  runExit: 0.60,
};

function actionFor(e) {
  return KEY_MAP[e.code] || KEY_NAME_MAP[(e.key || '').toLowerCase()] || KEY_NAME_MAP[e.key] || null;
}

// Thumb position on the pad as a vector in units of the pad's half size, plus its length.
export function padVector(x, y, rect) {
  const hw = rect.width / 2, hh = rect.height / 2;
  if (!hw || !hh) return { dx: 0, dy: 0, d: 0 };
  const dx = (x - (rect.left + hw)) / hw;
  const dy = (y - (rect.top + hh)) / hh;
  return { dx, dy, d: Math.hypot(dx, dy) };
}

// Which directions a thumb at (x, y) holds on a pad whose box is `rect`.
export function padDirections(x, y, rect) {
  const { dx, dy, d } = padVector(x, y, rect);
  if (d < PAD.deadZone) return [];
  const dirs = [];
  if (dx <= -PAD.axisThreshold) dirs.push('left');
  else if (dx >= PAD.axisThreshold) dirs.push('right');
  if (dy <= -PAD.axisThreshold) dirs.push('up');
  else if (dy >= PAD.axisThreshold) dirs.push('down');
  return dirs;
}

// Whether the thumb is in the run zone, given whether it already was (hysteresis).
export function padRunning(d, wasRunning) {
  return wasRunning ? d >= PAD.runExit : d >= PAD.runEnter;
}

export class Input {
  constructor() {
    this.held = {};
    this.sources = {};
    for (const a of ACTIONS) { this.held[a] = false; this.sources[a] = new Set(); }
    this.pressed = { jump: false, punch: false, kick: false, kiai: false, throw: false };
    this.active = false;          // when false, game keys are not captured (page scrolls normally)
    this.onPause = null;
    this.onConfirm = null;
    this.touchUsed = false;
    this.onTouchDetected = null;
    this.onEvent = null;          // optional diagnostic hook: ({ type, action, source, held })
    this.resetHooks = [];         // the pad clears its own pointer state when everything is reset
  }

  attachKeyboard(target = window) {
    target.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP' || e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (this.active && this.onPause) { e.preventDefault(); this.onPause(); }
        return;
      }
      if ((e.code === 'Enter' || e.key === 'Enter') && this.onConfirm) { this.onConfirm(); return; }
      const action = actionFor(e);
      if (!action) return;
      if (!this.active) return;
      e.preventDefault();
      if (e.repeat) return;
      this.press(action, KEY_SOURCE);
    });
    target.addEventListener('keyup', (e) => {
      const action = actionFor(e);
      if (action) this.release(action, KEY_SOURCE);
    });
    // Losing focus must release every key or the fighter keeps walking.
    const win = typeof window !== 'undefined' ? window : target;
    win.addEventListener('blur', () => this.reset());
  }

  // `buttons` maps action name -> element (missing ones are skipped). `pad` is one element for
  // movement: the thumb's position on it decides the direction and the run, and it may slide
  // without lifting.
  attachTouch(buttons, pad = null) {
    for (const [action, el] of Object.entries(buttons)) {
      if (!el) continue;
      const down = (e) => {
        e.preventDefault();
        this.noteTouch();
        el.classList.add('is-active');
        try { el.setPointerCapture(e.pointerId); } catch { /* not all browsers support capture */ }
        this.press(action, e.pointerId);
      };
      const up = (e) => {
        e.preventDefault();
        this.release(action, e.pointerId);
        if (!this.sources[action].size) el.classList.remove('is-active');
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    if (pad) this.attachPad(pad);
  }

  attachPad(pad) {
    const pointers = new Map(); // pointerId -> { dirs, running, dx, dy }
    const apply = (e) => {
      const rect = pad.getBoundingClientRect();
      const v = padVector(e.clientX, e.clientY, rect);
      const dirs = padDirections(e.clientX, e.clientY, rect);
      const before = pointers.get(e.pointerId) || { dirs: [], running: false };
      const running = dirs.length > 0 && padRunning(v.d, before.running);
      for (const d of before.dirs) if (!dirs.includes(d)) this.release(d, e.pointerId);
      for (const d of dirs) if (!before.dirs.includes(d)) this.press(d, e.pointerId);
      if (running && !before.running) this.press('sprint', e.pointerId);
      if (!running && before.running) this.release('sprint', e.pointerId);
      pointers.set(e.pointerId, { dirs, running, dx: v.dx, dy: v.dy });
      this.paintPad(pad, v);
    };
    const down = (e) => {
      e.preventDefault();
      this.noteTouch();
      try { pad.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      apply(e);
    };
    const move = (e) => { if (pointers.has(e.pointerId)) apply(e); };
    const up = (e) => {
      e.preventDefault();
      const state = pointers.get(e.pointerId);
      if (!state) return;
      for (const d of state.dirs) this.release(d, e.pointerId);
      if (state.running) this.release('sprint', e.pointerId);
      pointers.delete(e.pointerId);
      this.paintPad(pad, null);
    };
    pad.addEventListener('pointerdown', down);
    pad.addEventListener('pointermove', move);
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    pad.addEventListener('lostpointercapture', up);
    pad.addEventListener('contextmenu', (e) => e.preventDefault());
    // A reset (pause, blur, rotation) forgets the thumbs: the next move must start with a press.
    this.resetHooks.push(() => { pointers.clear(); this.paintPad(pad, null); });
  }

  // Pad feedback: one class per held direction, `is-running` in the run zone, and the nub follows
  // the thumb (clamped to the pad's edge) through two CSS variables. Drawn by CSS.
  paintPad(pad, v) {
    let any = false;
    for (const d of PAD_DIRECTIONS) {
      const on = this.held[d];
      any = any || on;
      pad.classList.toggle(`is-${d}`, on);
    }
    pad.classList.toggle('is-active', any);
    pad.classList.toggle('is-running', this.held.sprint);
    if (v && any) {
      const k = v.d > 1 ? 1 / v.d : 1;
      pad.style.setProperty('--kg-nub-x', `${(v.dx * k * 30).toFixed(1)}%`);
      pad.style.setProperty('--kg-nub-y', `${(v.dy * k * 30).toFixed(1)}%`);
    } else {
      pad.style.removeProperty('--kg-nub-x');
      pad.style.removeProperty('--kg-nub-y');
    }
  }

  noteTouch() {
    if (!this.touchUsed) { this.touchUsed = true; this.onTouchDetected?.(); }
  }

  press(action, source = KEY_SOURCE) {
    const set = this.sources[action];
    if (!set) return;
    set.add(source);
    if (!this.held[action]) {
      this.held[action] = true;
      if (EDGE_ACTIONS.has(action)) this.pressed[action] = true;
    }
    this.onEvent?.({ type: 'press', action, source, held: set.size });
  }

  release(action, source = KEY_SOURCE) {
    const set = this.sources[action];
    if (!set || !set.has(source)) return;
    set.delete(source);
    this.held[action] = set.size > 0;
    this.onEvent?.({ type: 'release', action, source, held: set.size });
  }

  // Snapshot for one simulation frame; edges are then consumed. The shape is the game's input
  // set: `throw` is folded into punch+kick (the grab chord) and never appears by itself; `sprint`
  // is the pad's run request, read by the player next to the keyboard's double-tap.
  snapshot() {
    const p = this.pressed;
    const s = {
      left: this.held.left, right: this.held.right, up: this.held.up, down: this.held.down,
      duck: this.held.duck, block: this.held.block,
      jump: p.jump, punch: p.punch || p.throw, kick: p.kick || p.throw, kiai: p.kiai,
      sprint: this.held.sprint,
    };
    p.jump = p.punch = p.kick = p.kiai = p.throw = false;
    return s;
  }

  reset() {
    for (const a of ACTIONS) { this.held[a] = false; this.sources[a].clear(); }
    for (const k of Object.keys(this.pressed)) this.pressed[k] = false;
    for (const hook of this.resetHooks) hook();
  }
}
