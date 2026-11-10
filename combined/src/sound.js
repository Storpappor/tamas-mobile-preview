// Sound effects: a small Web Audio synthesizer with one cue per game moment (no audio files).
//
// This is the `audio` object injected into the game. The game only knows the event names in
// audio.js (`punch`, `hit`, `start`, ...); several of them stand for more than one moment, so
// `play(name)` does not make a sound by itself: it queues the raw event, and the audio director
// (audioDirector.js) resolves each one against the game's state into exactly one cue, which it
// plays with `cue(name)`. Effects share one AudioContext with the music but have their own
// master gain, so the music's fades and ducking never touch them.
//
// Repeated cues get a little pitch and level variation, and each cue has a minimum gap and a
// voice limit so a crowd of hits never piles up into noise.

const CUE = {
  // ---- menu ---------------------------------------------------------------------------------
  menuMove:    { gap: 0.05, duck: false, play: (s, v) => s.tone({ freq: 1180 * v.pitch, dur: 0.025, type: 'square', vol: 0.09 * v.vol }) },
  menuConfirm: { gap: 0.08, play: (s, v) => { s.tone({ freq: 660, dur: 0.05, type: 'square', vol: 0.18 * v.vol }); s.tone({ freq: 990, dur: 0.08, type: 'square', vol: 0.18 * v.vol, delay: 0.05 }); } },
  menuBack:    { gap: 0.08, play: (s, v) => s.tone({ freq: 520, end: 340, dur: 0.09, type: 'triangle', vol: 0.18 * v.vol }) },
  gameStart:   { gap: 0.3, duck: true, vary: false, play: (s) => {
    [440, 660, 880].forEach((f, i) => s.tone({ freq: f, dur: 0.08, type: 'square', vol: 0.3, delay: i * 0.075 }));
    s.tone({ freq: 1320, dur: 0.3, type: 'square', vol: 0.28, delay: 0.23 });
    s.tone({ freq: 220, end: 110, dur: 0.3, type: 'triangle', vol: 0.3, delay: 0.23 });
    s.noise({ dur: 0.2, vol: 0.12, freq: 1800, end: 400, delay: 0.23 });
  } },

  // ---- player movement and strikes ----------------------------------------------------------
  whooshLight: { group: 'whoosh', voices: 2, gap: 0.05, play: (s, v) => s.noise({ dur: 0.07, vol: 0.2 * v.vol, freq: 2000 * v.pitch, end: 900 }) },
  whooshHeavy: { group: 'whoosh', voices: 2, gap: 0.05, play: (s, v) => { s.noise({ dur: 0.11, vol: 0.28 * v.vol, freq: 1300 * v.pitch, end: 450 }); s.tone({ freq: 170 * v.pitch, end: 90, dur: 0.09, type: 'triangle', vol: 0.22 * v.vol }); } },
  kiaiStrike:  { group: 'whoosh', voices: 2, gap: 0.05, play: (s, v) => { s.tone({ freq: 330 * v.pitch, end: 420 * v.pitch, dur: 0.07, type: 'sawtooth', vol: 0.45 * v.vol }); s.tone({ freq: 420 * v.pitch, end: 180, dur: 0.16, type: 'sawtooth', vol: 0.5 * v.vol, delay: 0.07 }); s.noise({ dur: 0.1, vol: 0.25, freq: 1200, delay: 0.05 }); } },
  jump:        { gap: 0.1, play: (s, v) => s.tone({ freq: 260 * v.pitch, end: 620 * v.pitch, dur: 0.14, type: 'square', vol: 0.28 * v.vol }) },
  land:        { gap: 0.1, play: (s, v) => s.noise({ dur: 0.04, vol: 0.18 * v.vol, freq: 300 }) },
  kiaiStart:   { gap: 0.3, duck: true, vary: false, play: (s) => { s.tone({ freq: 260, end: 520, dur: 0.12, type: 'sawtooth', vol: 0.5 }); s.tone({ freq: 520, end: 200, dur: 0.3, type: 'sawtooth', vol: 0.55, delay: 0.12 }); s.noise({ dur: 0.2, vol: 0.3, freq: 1000, delay: 0.1 }); } },

  // ---- grabs and throws ---------------------------------------------------------------------
  grabReach:   { group: 'whoosh', voices: 2, gap: 0.05, play: (s, v) => { s.noise({ dur: 0.06, vol: 0.2 * v.vol, freq: 2300 * v.pitch, end: 1400 }); s.tone({ freq: 300 * v.pitch, end: 380 * v.pitch, dur: 0.05, type: 'square', vol: 0.14 * v.vol }); } },
  grabHold:    { group: 'impact', gap: 0.1, play: (s, v) => { s.tone({ freq: 200 * v.pitch, end: 130, dur: 0.1, type: 'square', vol: 0.3 * v.vol }); s.noise({ dur: 0.05, vol: 0.22 * v.vol, freq: 700 }); } },
  throwToss:   { group: 'whoosh', voices: 2, gap: 0.1, play: (s, v) => { s.noise({ dur: 0.2, vol: 0.3 * v.vol, freq: 600 * v.pitch, end: 2600 }); s.tone({ freq: 220 * v.pitch, end: 460 * v.pitch, dur: 0.16, type: 'triangle', vol: 0.16 * v.vol }); } },
  throwLand:   { group: 'impact', gap: 0.08, duck: true, play: (s, v) => { s.tone({ freq: 110 * v.pitch, end: 35, dur: 0.26, type: 'square', vol: 0.7 * v.vol }); s.noise({ dur: 0.17, vol: 0.55 * v.vol, freq: 280 }); s.noise({ dur: 0.04, vol: 0.3, freq: 2600 }); } },

  // ---- impacts ------------------------------------------------------------------------------
  punchHit:    { group: 'impact', gap: 0.04, play: (s, v) => { s.tone({ freq: 170 * v.pitch, end: 70, dur: 0.1, type: 'square', vol: 0.55 * v.vol }); s.noise({ dur: 0.06, vol: 0.4 * v.vol, freq: 900 * v.pitch }); } },
  kickHit:     { group: 'impact', gap: 0.04, play: (s, v) => { s.tone({ freq: 130 * v.pitch, end: 45, dur: 0.16, type: 'square', vol: 0.65 * v.vol }); s.noise({ dur: 0.1, vol: 0.5 * v.vol, freq: 500 * v.pitch }); } },
  kiaiHit:     { group: 'impact', gap: 0.04, duck: true, play: (s, v) => { s.tone({ freq: 120 * v.pitch, end: 40, dur: 0.18, type: 'square', vol: 0.7 * v.vol }); s.noise({ dur: 0.12, vol: 0.5 * v.vol, freq: 400 }); s.noise({ dur: 0.04, vol: 0.3, freq: 2400 }); } },
  enemyKo:     { group: 'impact', gap: 0.06, duck: true, play: (s, v) => { s.tone({ freq: 420 * v.pitch, end: 60, dur: 0.3, type: 'square', vol: 0.45 * v.vol }); s.noise({ dur: 0.12, vol: 0.35 * v.vol, freq: 400 }); } },
  block:       { group: 'impact', gap: 0.05, play: (s, v) => { s.tone({ freq: 900 * v.pitch, end: 700, dur: 0.05, type: 'square', vol: 0.35 * v.vol }); s.tone({ freq: 1400 * v.pitch, end: 1000, dur: 0.06, type: 'square', vol: 0.2 * v.vol, delay: 0.03 }); } },
  playerHurt:  { group: 'impact', gap: 0.08, duck: true, play: (s, v) => { s.tone({ freq: 220 * v.pitch, end: 80, dur: 0.22, type: 'sawtooth', vol: 0.5 * v.vol }); s.noise({ dur: 0.1, vol: 0.3 * v.vol, freq: 500 }); } },

  // ---- enemies ------------------------------------------------------------------------------
  enemyWhoosh: { group: 'whoosh', voices: 2, gap: 0.06, play: (s, v) => s.noise({ dur: 0.07, vol: 0.11 * v.vol, freq: 1400 * v.pitch, end: 700 }) },
  shuriken:    { gap: 0.08, play: (s, v) => { s.noise({ dur: 0.14, vol: 0.35 * v.vol, freq: 3200 * v.pitch }); s.tone({ freq: 1500 * v.pitch, end: 2400, dur: 0.1, type: 'triangle', vol: 0.12 * v.vol }); } },
  bossEnter:   { gap: 1, duck: true, vary: false, play: (s) => {
    [110, 110, 98, 82].forEach((f, i) => s.tone({ freq: f, dur: 0.2, type: 'square', vol: 0.4, delay: i * 0.22 }));
    s.noise({ dur: 0.9, vol: 0.25, freq: 120 });
    s.tone({ freq: 55, dur: 0.9, type: 'sawtooth', vol: 0.25 });
  } },

  // ---- level flow ---------------------------------------------------------------------------
  waveClear:   { gap: 0.3, vary: false, play: (s) => [523, 659, 784].forEach((f, i) => s.tone({ freq: f, dur: 0.09, type: 'square', vol: 0.28, delay: i * 0.08 })) },
  doorEnter:   { gap: 0.3, vary: false, play: (s) => { s.tone({ freq: 392, dur: 0.1, type: 'triangle', vol: 0.25 }); s.tone({ freq: 523, dur: 0.14, type: 'triangle', vol: 0.25, delay: 0.1 }); s.noise({ dur: 0.3, vol: 0.14, freq: 400 }); } },
  pauseCue:    { gap: 0.2, vary: false, play: (s) => { s.tone({ freq: 660, dur: 0.08, type: 'square', vol: 0.25 }); s.tone({ freq: 440, dur: 0.12, type: 'square', vol: 0.25, delay: 0.09 }); } },
  resumeCue:   { gap: 0.2, vary: false, play: (s) => { s.tone({ freq: 440, dur: 0.08, type: 'square', vol: 0.25 }); s.tone({ freq: 660, dur: 0.12, type: 'square', vol: 0.25, delay: 0.09 }); } },
  victory:     { gap: 1, vary: false, play: (s) => { [523, 659, 784, 1046].forEach((f, i) => s.tone({ freq: f, dur: 0.16, type: 'square', vol: 0.35, delay: i * 0.14 })); s.tone({ freq: 1046, dur: 0.5, type: 'square', vol: 0.3, delay: 0.6 }); } },
  gameOver:    { gap: 1, vary: false, play: (s) => [392, 349, 311, 262].forEach((f, i) => s.tone({ freq: f, dur: 0.28, type: 'triangle', vol: 0.4, delay: i * 0.26 })) },
};

export const CUE_NAMES = Object.keys(CUE);

const VOICES = { impact: 3, whoosh: 2 };

function defaultContext() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  return AC ? new AC() : null;
}

export class Sound {
  constructor({ enabled = true, volume = 0.24, createContext = defaultContext, random = Math.random, onDuck = null, onError = () => {} } = {}) {
    this.enabled = enabled;
    this.volume = volume;
    this.createContext = createContext;
    this.random = random;
    this.onDuck = onDuck;
    this.onError = onError;
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.queue = [];          // raw game events since the last drain()
    this.suppressed = new Set();
    this.lastAt = {};         // cue name -> context time it last played
    this.voices = {};         // group -> end times of the cues playing in it
  }

  // Browsers only allow audio after a user gesture; call this from a click or key handler.
  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = this.createContext();
      } catch (err) {
        this.onError(err);
      }
      if (!this.ctx) return;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this.unlock();
  }

  // The game's side: record what happened; the director decides what it sounds like.
  play(name) {
    this.queue.push({ name, suppressed: this.suppressed.has(name) });
  }

  // While set, raw events of this name are recorded as suppressed (an automatic pause is silent).
  suppress(name, on = true) {
    if (on) this.suppressed.add(name); else this.suppressed.delete(name);
  }

  drain() {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  // Play one cue now. Returns false when it was skipped (disabled, too soon, or too many voices).
  cue(name) {
    const c = CUE[name];
    if (!c || !this.enabled || !this.ctx) return false;
    const t = this.ctx.currentTime;
    if (this.lastAt[name] !== undefined && t - this.lastAt[name] < (c.gap ?? 0.04)) return false;
    if (c.group) {
      const live = (this.voices[c.group] || []).filter((end) => end > t);
      if (live.length >= (c.voices ?? VOICES[c.group] ?? 3)) return false;
      live.push(t + 0.12);
      this.voices[c.group] = live;
    }
    this.lastAt[name] = t;
    const vary = c.vary !== false;
    const v = vary
      ? { pitch: 1 + (this.random() * 2 - 1) * 0.045, vol: 1 + (this.random() * 2 - 1) * 0.12 }
      : { pitch: 1, vol: 1 };
    try { c.play(this, v); } catch (err) { this.onError(err); }  // audio must never break the game
    if (c.duck && this.onDuck) this.onDuck(name);
    return true;
  }

  tone({ freq, end = freq, dur = 0.1, type = 'square', vol = 0.5, delay = 0 }) {
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // Band-passed noise; `end` sweeps the band for whooshes.
  noise({ dur = 0.1, vol = 0.4, freq = 1000, end = freq, delay = 0 }) {
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, t0);
    if (end !== freq) filter.frequency.exponentialRampToValueAtTime(Math.max(40, end), t0 + dur);
    filter.Q.value = 0.8;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }
}
