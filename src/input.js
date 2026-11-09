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
const ACTIONS = ['left', 'right', 'up', 'down', 'duck', 'block', 'jump', 'punch', 'kick', 'kiai', 'throw'];
// `throw` is the touch panel's dedicated button: in the snapshot it becomes punch and kick on the
// same step, which is exactly the grab chord the game reads, so the game itself never sees it.
const EDGE_ACTIONS = new Set(['jump', 'punch', 'kick', 'kiai', 'throw']);
const PAD_DIRECTIONS = ['left', 'right', 'up', 'down'];
const KEY_SOURCE = 'key';

// Movement pad geometry: the thumb's offset from the pad centre, as a fraction of the half size.
// Inside the dead zone nothing is held; beyond the axis threshold that axis is held, so a thumb
// between two arrows holds both (a diagonal). The thumb may leave the pad; the pointer stays captured.
export const PAD = {
  deadZone: 0.28,
  axisThreshold: 0.38,
};

function actionFor(e) {
  return KEY_MAP[e.code] || KEY_NAME_MAP[(e.key || '').toLowerCase()] || KEY_NAME_MAP[e.key] || null;
}

// Which directions a thumb at (x, y) holds on a pad whose box is `rect`.
export function padDirections(x, y, rect) {
  const hw = rect.width / 2, hh = rect.height / 2;
  if (!hw || !hh) return [];
  const dx = (x - (rect.left + hw)) / hw;
  const dy = (y - (rect.top + hh)) / hh;
  if (Math.hypot(dx, dy) < PAD.deadZone) return [];
  const dirs = [];
  if (dx <= -PAD.axisThreshold) dirs.push('left');
  else if (dx >= PAD.axisThreshold) dirs.push('right');
  if (dy <= -PAD.axisThreshold) dirs.push('up');
  else if (dy >= PAD.axisThreshold) dirs.push('down');
  return dirs;
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
  // movement: the thumb's position on it decides the direction, and it may slide without lifting.
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
    const pointers = new Map(); // pointerId -> directions currently held by that pointer
    const apply = (e) => {
      const dirs = padDirections(e.clientX, e.clientY, pad.getBoundingClientRect());
      const before = pointers.get(e.pointerId) || [];
      for (const d of before) if (!dirs.includes(d)) this.release(d, e.pointerId);
      for (const d of dirs) if (!before.includes(d)) this.press(d, e.pointerId);
      pointers.set(e.pointerId, dirs);
      this.paintPad(pad);
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
      const dirs = pointers.get(e.pointerId);
      if (!dirs) return;
      for (const d of dirs) this.release(d, e.pointerId);
      pointers.delete(e.pointerId);
      this.paintPad(pad);
    };
    pad.addEventListener('pointerdown', down);
    pad.addEventListener('pointermove', move);
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    pad.addEventListener('lostpointercapture', up);
    pad.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Pad feedback: one class per held direction, drawn by CSS.
  paintPad(pad) {
    let any = false;
    for (const d of PAD_DIRECTIONS) {
      const on = this.held[d];
      any = any || on;
      pad.classList.toggle(`is-${d}`, on);
    }
    pad.classList.toggle('is-active', any);
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
  // set: `throw` is folded into punch+kick (the grab chord) and never appears by itself.
  snapshot() {
    const p = this.pressed;
    const s = {
      left: this.held.left, right: this.held.right, up: this.held.up, down: this.held.down,
      duck: this.held.duck, block: this.held.block,
      jump: p.jump, punch: p.punch || p.throw, kick: p.kick || p.throw, kiai: p.kiai,
    };
    p.jump = p.punch = p.kick = p.kiai = p.throw = false;
    return s;
  }

  reset() {
    for (const a of ACTIONS) { this.held[a] = false; this.sources[a].clear(); }
    for (const k of Object.keys(this.pressed)) this.pressed[k] = false;
  }
}
