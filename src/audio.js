// Tiny synthesized sound effects using the Web Audio API (no audio files).
// To use recorded audio later, keep the `play(name)` interface and swap the bodies.
const SOUNDS = {
  punch:     (s) => s.noise({ dur: 0.06, vol: 0.5, freq: 1800 }),
  kick:      (s) => { s.noise({ dur: 0.09, vol: 0.55, freq: 900 }); s.tone({ freq: 180, end: 90, dur: 0.09, type: 'triangle', vol: 0.5 }); },
  hit:       (s) => { s.tone({ freq: 150, end: 60, dur: 0.12, type: 'square', vol: 0.6 }); s.noise({ dur: 0.08, vol: 0.4, freq: 600 }); },
  block:     (s) => { s.tone({ freq: 900, end: 700, dur: 0.05, type: 'square', vol: 0.35 }); s.tone({ freq: 1400, end: 1000, dur: 0.06, type: 'square', vol: 0.2, delay: 0.03 }); },
  jump:      (s) => s.tone({ freq: 260, end: 620, dur: 0.14, type: 'square', vol: 0.3 }),
  land:      (s) => s.noise({ dur: 0.04, vol: 0.2, freq: 300 }),
  shuriken:  (s) => { s.noise({ dur: 0.14, vol: 0.35, freq: 3200 }); s.tone({ freq: 1500, end: 2400, dur: 0.1, type: 'triangle', vol: 0.12 }); },
  hurt:      (s) => { s.tone({ freq: 220, end: 80, dur: 0.22, type: 'sawtooth', vol: 0.5 }); s.noise({ dur: 0.1, vol: 0.3, freq: 500 }); },
  enemyDown: (s) => { s.tone({ freq: 420, end: 60, dur: 0.3, type: 'square', vol: 0.45 }); },
  bossAppear:(s) => { [110, 110, 98, 82].forEach((f, i) => s.tone({ freq: f, dur: 0.2, type: 'square', vol: 0.4, delay: i * 0.22 })); },
  victory:   (s) => { [523, 659, 784, 1046].forEach((f, i) => s.tone({ freq: f, dur: 0.16, type: 'square', vol: 0.35, delay: i * 0.14 })); s.tone({ freq: 1046, dur: 0.5, type: 'square', vol: 0.3, delay: 0.6 }); },
  gameOver:  (s) => { [392, 349, 311, 262].forEach((f, i) => s.tone({ freq: f, dur: 0.28, type: 'triangle', vol: 0.4, delay: i * 0.26 })); },
  start:     (s) => { s.tone({ freq: 440, dur: 0.08, type: 'square', vol: 0.3 }); s.tone({ freq: 880, dur: 0.12, type: 'square', vol: 0.3, delay: 0.09 }); },
  pause:     (s) => s.tone({ freq: 600, end: 400, dur: 0.1, type: 'square', vol: 0.25 }),
  hitHeavy:  (s) => { s.tone({ freq: 120, end: 40, dur: 0.18, type: 'square', vol: 0.7 }); s.noise({ dur: 0.12, vol: 0.5, freq: 400 }); },
  // A short synthesized shout: a gritty sawtooth with a falling pitch, like "KI-AI".
  kiai:      (s) => { s.tone({ freq: 330, end: 420, dur: 0.07, type: 'sawtooth', vol: 0.45 }); s.tone({ freq: 420, end: 180, dur: 0.16, type: 'sawtooth', vol: 0.5, delay: 0.07 }); s.noise({ dur: 0.1, vol: 0.25, freq: 1200, delay: 0.05 }); },
  kiaiStart: (s) => { s.tone({ freq: 260, end: 520, dur: 0.12, type: 'sawtooth', vol: 0.5 }); s.tone({ freq: 520, end: 200, dur: 0.3, type: 'sawtooth', vol: 0.55, delay: 0.12 }); s.noise({ dur: 0.2, vol: 0.3, freq: 1000, delay: 0.1 }); },
};

export class Sfx {
  constructor({ enabled = true } = {}) {
    this.enabled = enabled;
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
  }

  // Browsers only allow audio after a user gesture; call this from a click handler.
  unlock() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
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

  play(name) {
    if (!this.enabled || !this.ctx || !SOUNDS[name]) return;
    try { SOUNDS[name](this); } catch { /* audio must never break the game */ }
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

  noise({ dur = 0.1, vol = 0.4, freq = 1000, delay = 0 }) {
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 0.8;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }
}
