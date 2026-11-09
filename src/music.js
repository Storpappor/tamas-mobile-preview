// Background music: looping tracks on their own Web Audio graph, kept apart from the sound
// effects so that music volume, ducking and fades never touch the effects.
//
// Each track plays as a decoded buffer rather than an <audio> element: buffer loops are
// gapless and sample-accurate, the loop points can sit inside the file (so the original
// recording stays untouched), and the gain node works on iOS, where element volume is fixed.
// The game never calls this module directly; the audio director drives it from the game's state.

// Everything about the tracks in one place. Paths are resolved relative to this file by main.js,
// so they also work under the GitHub Pages path. A track with `src: null` is pending: it is
// never requested, and asking the mixer to play it leaves the current track alone.
export const MUSIC = {
  volume: 0.15,         // stage gain; menu and boss carry their own below, balanced by measured loudness
  fadeOut: 0.5,         // seconds; used when a run ends and when tracks hand over
  tracks: {
    // The 92 % tempo render (121.4 BPM) of "Triumph in the Ring"; the source tempo file sits next
    // to it. The loop points belong to this file: see docs/music/README.md before switching.
    stage: { src: '../assets/audio/triumph-in-the-ring-92.mp3', loopStart: 1.28667, loopEnd: 125.84646 },
    // Menu theme (133 BPM): the intro cards, the title and the result screens. The two-beat pickup
    // plays once; the loop runs from the entry downbeat to the downbeat of the final hit.
    menu: { src: '../assets/audio/menu-theme.mp3', volume: 0.10, loopStart: 1.98873, loopEnd: 116.48144 },
    // Boss theme (131 BPM): takes over from the stage track when Master Kage appears. The 7.7 s
    // build plays once; the loop runs from the groove's entry to the downbeat of the final hit.
    boss: { src: '../assets/audio/boss-theme.mp3', volume: 0.12, loopStart: 7.70581, loopEnd: 129.62725 },
  },
};

function defaultContext() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  return AC ? new AC() : null;
}

async function defaultFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.arrayBuffer();
}

// One looping track. `url: null` makes an inert track that never loads or plays.
export class Music {
  constructor({
    url = null, enabled = true, volume = MUSIC.volume, loopStart = 0, loopEnd = 0,
    fadeOut = MUSIC.fadeOut, createContext = defaultContext, fetchBytes = defaultFetch, onError = () => {},
  } = {}) {
    this.url = url;
    this.enabled = enabled;
    this.volume = volume;
    this.loopStart = loopStart;
    this.loopEnd = loopEnd;
    this.fadeSeconds = fadeOut;
    this.createContext = createContext;
    this.fetchBytes = fetchBytes;
    this.onError = onError;

    this.ctx = null;
    this.gain = null;
    this.bytes = null;      // encoded file, once fetched
    this.buffer = null;     // decoded track, once a context exists
    this.decoding = false;
    this.failed = false;

    // What the game wants from the track. A source node exists only while the intent is
    // 'playing' and nothing holds it back, so a track that finishes loading late starts
    // only if it is still wanted.
    this.intent = 'stopped';  // stopped | playing | paused
    this.pageActive = true;   // false while the tab is hidden
    this.position = 0;        // seconds into the track to (re)start from
    this.source = null;       // the one live source node
    this.startedAt = 0;       // context time when `source` started
    this.startOffset = 0;     // track position `source` started from
    this.fading = null;       // a source that is fading out and will stop on its own
  }

  // A track with a file that has not failed to load.
  get available() { return Boolean(this.url) && !this.failed; }

  // Fetch the file early; decoding waits for a context. Safe to call once at boot.
  load() {
    if (!this.url || this.bytes || this.failed) return Promise.resolve();
    return this.fetchBytes(this.url)
      .then((bytes) => { this.bytes = bytes; this.decode(); })
      .catch((err) => { this.failed = true; this.onError(err); });
  }

  // Browsers only allow audio after a user gesture; call this from the same handlers that
  // unlock the sound effects. The context may be shared with them.
  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = this.createContext();
      } catch (err) {
        this.failed = true;
        this.onError(err);
      }
      if (!this.ctx) return;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
      this.decode();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  decode() {
    if (!this.ctx || !this.bytes || this.buffer || this.decoding) return;
    this.decoding = true;
    Promise.resolve()
      .then(() => this.ctx.decodeAudioData(this.bytes.slice(0)))
      .then((buffer) => { this.buffer = buffer; this.decoding = false; this.sync(); })
      .catch((err) => { this.decoding = false; this.failed = true; this.onError(err); });
  }

  get ready() { return !!this.buffer; }
  get playing() { return !!this.source; }

  // Begin from the top, replacing whatever was playing or fading.
  start() {
    this.stopSource(this.fading);
    this.fading = null;
    this.stopSource(this.source);
    this.source = null;
    this.position = 0;
    this.intent = 'playing';
    this.sync();
  }

  pause() {
    this.cutFade();
    if (this.intent !== 'playing') return;
    this.position = this.currentPosition();
    this.intent = 'paused';
    this.sync();
  }

  // Silence a fade-out tail at once (a pause, the mute or a hidden tab must leave nothing playing).
  cutFade() {
    if (!this.fading) return;
    this.stopSource(this.fading);
    this.fading = null;
    if (this.gain && !this.source) { this.gain.gain.cancelScheduledValues(this.ctx.currentTime); this.gain.gain.value = this.volume; }
  }

  resume() {
    if (this.intent !== 'paused') return;
    this.intent = 'playing';
    this.sync();
  }

  // Fade on this track's own gain over `fadeOut` seconds, then stop. With `keep`, the track
  // remembers where it was and `resume()` continues from there (a hand-over, not an ending).
  fadeOut({ keep = false } = {}) {
    if (this.intent === 'stopped' || (keep && this.intent === 'paused')) return;
    this.position = keep ? this.currentPosition() : 0;
    this.intent = keep ? 'paused' : 'stopped';
    if (this.source && this.ctx) {
      const t = this.ctx.currentTime;
      const g = this.gain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(this.volume, t);
      g.linearRampToValueAtTime(0, t + this.fadeSeconds);
      this.stopSource(this.fading);
      const src = this.source;
      this.fading = src;
      this.source = null;
      src.onended = () => { if (this.fading === src) this.fading = null; };
      try { src.stop(t + this.fadeSeconds); } catch { /* already stopped */ }
    } else {
      this.sync();
    }
  }

  stop() {
    this.intent = 'stopped';
    this.position = 0;
    this.stopSource(this.fading);
    this.fading = null;
    this.sync();
  }

  // The sound toggle. Off silences and holds the track; on resumes it only if still wanted.
  setEnabled(on) {
    this.enabled = on;
    this.sync();
  }

  // Hold the track while the tab is hidden; it continues where it was when the tab returns.
  setPageActive(active) {
    this.pageActive = active;
    this.sync();
  }

  setVolume(v) {
    this.volume = v;
    if (this.gain && !this.fading) this.gain.gain.value = v;
  }

  // Dip the track briefly under an important sound effect, then come back.
  duck(amount = 0.5, seconds = 0.35) {
    if (!this.source || this.fading || !this.gain) return;
    const t = this.ctx.currentTime;
    const g = this.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(this.volume * amount, t);
    g.linearRampToValueAtTime(this.volume, t + seconds);
  }

  // Track position of the live source, folded into the loop.
  currentPosition() {
    if (!this.source || !this.ctx) return this.position;
    let pos = this.startOffset + (this.ctx.currentTime - this.startedAt);
    const end = this.loopEnd > 0 ? this.loopEnd : this.buffer.duration;
    const len = end - this.loopStart;
    if (pos >= end && len > 0) pos = this.loopStart + ((pos - this.loopStart) % len);
    return pos;
  }

  // Make the live source match the intent. All state changes end here.
  sync() {
    const wanted = this.intent === 'playing' && this.enabled && this.pageActive;
    if (wanted && !this.source && this.buffer && this.ctx) {
      // A source still fading on this gain would jump back up with it: cut it now.
      this.stopSource(this.fading);
      this.fading = null;
      const t = this.ctx.currentTime;
      const g = this.gain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(this.volume, t);
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.loop = true;
      src.loopStart = this.loopStart;
      src.loopEnd = this.loopEnd > 0 ? this.loopEnd : this.buffer.duration;
      src.connect(this.gain);
      const offset = Math.min(this.position, Math.max(0, this.buffer.duration - 0.01));
      try {
        src.start(t, offset);
      } catch (err) {
        this.onError(err);
        return;
      }
      this.source = src;
      this.startedAt = t;
      this.startOffset = offset;
    } else if (!wanted && this.source) {
      if (this.intent === 'playing') this.position = this.currentPosition(); // held, not paused
      this.stopSource(this.source);
      this.source = null;
    }
    if (!this.enabled || !this.pageActive) this.cutFade();
  }

  stopSource(src) {
    if (!src) return;
    try { src.stop(); } catch { /* never started or already stopped */ }
    try { src.disconnect(); } catch { /* ignore */ }
  }
}

// Several tracks, one of them current. Handing over fades the old track on its own gain and
// remembers its position, so the menu theme continues between menu views and the stage track
// can come back after a boss. Pending or failed tracks are never requested and never played:
// asking for one leaves the current track alone.
export class MusicMixer {
  constructor({ tracks = MUSIC.tracks, resolveUrl = (src) => src, enabled = true, volume = MUSIC.volume,
    fadeOut = MUSIC.fadeOut, createContext = defaultContext, fetchBytes = defaultFetch, onError = () => {} } = {}) {
    this.tracks = {};
    for (const [name, cfg] of Object.entries(tracks)) {
      this.tracks[name] = new Music({
        url: cfg.src ? resolveUrl(cfg.src) : null, enabled, volume: cfg.volume ?? volume,
        loopStart: cfg.loopStart ?? 0, loopEnd: cfg.loopEnd ?? 0, fadeOut, createContext, fetchBytes,
        onError: (err) => onError(name, err),
      });
    }
    this.current = null;
  }

  get currentTrack() { return this.current ? this.tracks[this.current] : null; }
  get playing() { return Boolean(this.currentTrack?.playing); }
  available(name) { return Boolean(this.tracks[name]?.available); }
  pending() { return Object.keys(this.tracks).filter((n) => !this.tracks[n].url); }

  load() { return Promise.all(Object.values(this.tracks).map((t) => t.load())); }
  unlock() { for (const t of Object.values(this.tracks)) t.unlock(); }

  // Make `name` the current track: from the top, or from where it was left. Returns false when
  // the track is unavailable (nothing changes).
  play(name, { fromStart = false } = {}) {
    if (!this.available(name)) return false;
    const next = this.tracks[name];
    if (this.current !== name) {
      const prev = this.currentTrack;
      if (prev) prev.fadeOut({ keep: true });
      this.current = name;
    }
    if (fromStart || next.intent === 'stopped') next.start();
    else if (next.intent === 'paused') next.resume();
    return true;
  }

  pause() { for (const t of Object.values(this.tracks)) t.cutFade(); this.currentTrack?.pause(); }
  resume() { this.currentTrack?.resume(); }
  // End the current track (a run is over); the others keep their held positions.
  fadeOut() { this.currentTrack?.fadeOut(); this.current = null; }
  stop() { for (const t of Object.values(this.tracks)) t.stop(); this.current = null; }
  duck() { this.currentTrack?.duck(); }
  setEnabled(on) { for (const t of Object.values(this.tracks)) t.setEnabled(on); }
  setPageActive(active) { for (const t of Object.values(this.tracks)) t.setPageActive(active); }
}
