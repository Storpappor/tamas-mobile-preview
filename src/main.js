// Entry point: wires the DOM, input, audio, renderer and game loop together.
import { STEP, VIEW_W, VIEW_H } from './constants.js';
import { Input } from './input.js';
import { Sound } from './sound.js';
import { MusicMixer, MUSIC } from './music.js';
import { createAudioDirector } from './audioDirector.js';
import { Renderer } from './renderer.js';
import { Game } from './game.js';
import { createUi } from './ui.js';
import { HeroSprite, SpriteSheet } from './heroSprite.js';
import { ENEMY_SHEETS } from './enemySprite.js';
import { ART_SCALE } from './artScale.js';
import { BACKGROUNDS, loadBackground } from './background.js';

const SPRITE_URL = new URL('../assets/tamas-hero-spritesheet.png', import.meta.url).href;
const HERO_SHEET_URL = new URL('../assets/sprites/tamas.json', import.meta.url).href;

// Opening story, one card per entry. Lines are drawn exactly as written.
export const INTRO_SCREENS = [
  ['STOCKHOLM. MIDNIGHT.'],
  ['BUDAPEST 1942. ALGERIA 1960.', 'STOCKHOLM TONIGHT.'],
  ['TWO ARMIES. ONE DOJO.', 'HE IS NOT DONE.'],
  ['HIS BEST STUDENT LEFT.', 'HE TOOK FIVE DOJOS WITH HIM.'],
  ['THEY CALL THEMSELVES', 'THE SHADOW LEAGUE.'],
  ['TONIGHT THEY COME FOR', 'THE SANSHINKAN NAME.'],
  ['THREE HEARTS:', 'COURAGE. FOCUS. DISCIPLINE.'],
  ['AT 84, TAMAS WEBER', 'TIES HIS BELT ONE MORE TIME.'],
];

const SOUND_KEY = 'karate-challenge-sound';

export function boot(root) {
  const canvas = root.querySelector('canvas');
  const stage = root.querySelector('[data-stage]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let soundOn = true;
  try { soundOn = localStorage.getItem(SOUND_KEY) !== 'off'; } catch { /* storage may be blocked */ }

  // Effects and music share one AudioContext (created on the first gesture) but have separate
  // gains. The game only sees `audio`; the director below turns its events into cues and music.
  const audio = new Sound({ enabled: soundOn, onError: (err) => console.warn('Sound effect failed.', err) });
  audio.onDuck = () => music.duck();
  // The music is optional: a track that fails to load, or is not supplied yet, is simply skipped.
  const musicErrors = {};
  const music = new MusicMixer({
    tracks: MUSIC.tracks, enabled: soundOn, createContext: () => audio.ctx,
    resolveUrl: (src) => new URL(src, import.meta.url).href,
    onError: (name, err) => {
      musicErrors[name] = (err && (err.message || err.name)) || String(err);
      console.warn(`Music track "${name}" unavailable; playing without it.`, err);
    },
  });
  music.load();
  const input = new Input();
  const ui = createUi(root);
  const hero = new HeroSprite({ artScale: ART_SCALE });
  const heroSheet = new SpriteSheet();
  const enemySheets = {};
  const renderer = new Renderer(canvas, { reducedMotion, hero, heroSheet, enemySheets });
  // The hand-drawn backgrounds are optional: until one loads, and if it fails or is the wrong size,
  // the renderer keeps that zone's procedural painter. Each image that arrives rebuilds the
  // pre-rendered world once, with every image accepted so far.
  const loadedBackgrounds = {};
  for (const [art, path] of Object.entries(BACKGROUNDS)) {
    loadBackground(new URL(path, import.meta.url).href)
      .then((img) => {
        loadedBackgrounds[art] = img;
        if (renderer.setBackgrounds(loadedBackgrounds)) root.karateBackgrounds = { ...renderer.backgrounds };
      })
      .catch((err) => console.warn(`${err.message}; keeping the procedural ${art}.`));
  }
  // The production sheet is optional: any state it lacks is drawn from the fallback sheet.
  heroSheet.load(HERO_SHEET_URL).catch((err) => console.warn('Production hero sheet not loaded; using fallback art.', err));
  // Enemy sheets are optional, one per type: a type whose sheet is missing or does not load keeps its
  // procedural art, which is the normal state until that type's artwork is staged. The renderer picks
  // a sheet up the moment it is installed here, so a sheet that arrives mid-fight simply takes over.
  for (const [kind, path] of Object.entries(ENEMY_SHEETS)) {
    const sheet = new SpriteSheet();
    sheet.load(new URL(path, import.meta.url).href)
      .then(() => { enemySheets[kind] = sheet; })
      .catch(() => { /* no sheet for this type yet: procedural art */ });
  }
  const game = new Game({ input, audio, ui, reducedMotion });
  const director = createAudioDirector({ game, sound: audio, music });
  ui.onMenu = (kind) => director.menu(kind);

  // The hero artwork must be present: the game cannot start without it.
  const startButtons = [...root.querySelectorAll('[data-action="start"]')];
  const loadNote = root.querySelector('[data-load-note]');
  for (const b of startButtons) b.disabled = true;
  hero.load(SPRITE_URL).then(() => {
    for (const b of startButtons) b.disabled = false;
    if (loadNote) loadNote.hidden = true;
    ui.heroPainter = (canvasEl, name) => hero.paintTo(canvasEl, name === 'victory' ? 7 : 0, 3);
  }).catch((err) => {
    console.error(err);
    if (loadNote) loadNote.textContent = 'Hero artwork missing: add karate-game/assets/tamas-hero-spritesheet.png';
  });

  const playIntro = (onDone) => ui.showStory(INTRO_SCREENS, { onDone, skippable: true, hint: 'Enter · Space · tap to continue · Esc to skip' });

  ui.setSound(soundOn);
  input.attachKeyboard(window);
  // Movement is one pad element (slide, no lifting); the actions are buttons. DUCK and BLOCK exist
  // only as alternatives under evaluation: ?controls=duck,block shows them.
  const params = new URLSearchParams(window.location.search);
  input.attachTouch({
    jump: root.querySelector('[data-btn="jump"]'),
    punch: root.querySelector('[data-btn="punch"]'),
    kick: root.querySelector('[data-btn="kick"]'),
    throw: root.querySelector('[data-btn="throw"]'),
    kiai: root.querySelector('[data-btn="kiai"]'),
    duck: root.querySelector('[data-btn="duck"]'),
    block: root.querySelector('[data-btn="block"]'),
  }, root.querySelector('[data-pad]'));
  ui.showTouchAlternatives((params.get('controls') || '').split(',').map((s) => s.trim()).filter(Boolean));

  const unlockAudio = () => { audio.unlock(); music.unlock(); };
  // The first key press or tap anywhere in the game unlocks audio, so the menu theme can start
  // on the intro cards without an extra step.
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, unlockAudio, { capture: true, passive: true });
  const startGame = () => { if (!hero.ready) return; unlockAudio(); game.start(); };
  for (const b of root.querySelectorAll('[data-action="intro"]')) b.addEventListener('click', () => { director.menu('confirm'); playIntro(() => ui.showOverlay('start')); });
  for (const b of root.querySelectorAll('[data-action="start"]')) b.addEventListener('click', startGame);
  for (const b of root.querySelectorAll('[data-action="resume"]')) b.addEventListener('click', () => { unlockAudio(); game.resume(); });
  for (const b of root.querySelectorAll('[data-action="pause"]')) b.addEventListener('click', () => game.togglePause());
  for (const b of root.querySelectorAll('[data-action="sound"]')) {
    b.addEventListener('click', () => {
      soundOn = !soundOn;
      if (soundOn) unlockAudio();
      audio.setEnabled(soundOn);
      music.setEnabled(soundOn);
      ui.setSound(soundOn);
      try { localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); } catch { /* ignore */ }
      if (soundOn) director.menu('confirm');
    });
  }

  input.onPause = () => game.togglePause();
  input.onConfirm = () => {
    if (ui.storyActive) return; // the story cards handle Enter themselves
    if (['start', 'gameover', 'victory'].includes(game.state)) startGame();
    else if (game.state === 'paused') game.resume();
  };

  // Touch controls: shown on coarse pointers, or as soon as a touch is detected.
  ui.setTouchVisible(window.matchMedia('(pointer: coarse)').matches);
  input.onTouchDetected = () => ui.setTouchVisible(true);
  // Stop the page from scrolling/zooming while thumbs are on the controls.
  const touchArea = root.querySelector('[data-touch]');
  for (const el of [touchArea, stage]) {
    if (el) el.addEventListener('touchmove', (e) => { if (game.state === 'playing') e.preventDefault(); }, { passive: false });
  }

  // Pause when the tab is hidden or the window loses focus: silently, unlike a manual pause.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) director.pauseSilently(() => game.pause());
    music.setPageActive(!document.hidden);
  });
  window.addEventListener('blur', () => director.pauseSilently(() => game.pause()));

  // Menu navigation sound when Tab or an arrow key moves the focus to another overlay button
  // (an overlay focusing its own button when it opens is not a selection change).
  const NAV_KEYS = ['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  let lastNavKeyAt = -1;
  let lastFocused = null;
  window.addEventListener('keydown', (e) => { if (NAV_KEYS.includes(e.key)) lastNavKeyAt = performance.now(); }, true);
  root.addEventListener('focusin', (e) => {
    const b = e.target.closest ? e.target.closest('.kg-overlay button') : null;
    if (b && b !== lastFocused && performance.now() - lastNavKeyAt < 150) director.menu('move');
    lastFocused = b;
  });

  // Responsive, pixel-perfect scaling. The stage is normally as wide as the page and 16:9; in
  // phone landscape its height is what is limited, so the picture is sized by whichever is tighter.
  const resize = () => {
    const byHeight = stage.clientHeight ? (stage.clientHeight * VIEW_W) / VIEW_H : Infinity;
    renderer.resize(Math.min(stage.clientWidth, byHeight), window.devicePixelRatio || 1);
  };
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stage);
  window.addEventListener('resize', resize);
  resize();

  // Fixed-step game loop; rendering runs every animation frame.
  let last = null;
  let acc = 0;
  let wasPlaying = false;
  const frame = (now) => {
    if (last !== null && game.state === 'playing') {
      acc += Math.min(0.1, (now - last) / 1000);
      let steps = 0;
      while (acc >= STEP && steps < 6) { game.step(STEP); acc -= STEP; steps++; }
    } else {
      acc = 0;
    }
    last = now;
    // While playing, the whole game area is a touch surface (no scroll or zoom gestures).
    const playing = game.state === 'playing';
    if (playing !== wasPlaying) { root.classList.toggle('kg-root--playing', playing); wasPlaying = playing; }
    // Music and sound cues follow the state the steps just produced.
    director.update();
    renderer.render(game, now / 1000);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Opening story plays once, then the title card.
  playIntro(() => ui.showOverlay('start'));

  root.karateHero = hero; // exposed for debugging alongside root.karateGame
  root.karateRenderer = renderer;
  root.karateMusic = music;
  root.karateSound = audio;
  // Audio diagnostics for devices without a console: open the game with ?audiodebug=1.
  if (new URLSearchParams(window.location.search).has('audiodebug')) {
    const box = document.createElement('pre');
    box.className = 'kg-audiodebug';
    box.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:9999;margin:0;padding:6px 8px;max-width:95vw;font:11px/1.35 monospace;color:#fff;background:rgba(0,0,0,.75);white-space:pre-wrap;pointer-events:none;';
    document.body.appendChild(box);
    const fmt = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v));
    setInterval(() => {
      const ctx = audio.ctx;
      const lines = [`audio ${ctx ? `${ctx.state} @${ctx.sampleRate}Hz t=${fmt(ctx.currentTime)}` : 'no context yet (tap or press a key)'} sound=${audio.enabled ? 'on' : 'off'} game=${game.state} current=${music.current}`];
      for (const [name, t] of Object.entries(music.tracks)) {
        lines.push(`${name.padEnd(5)} bytes=${t.bytes ? Math.round(t.bytes.byteLength / 1024) + 'k' : '-'} decoding=${t.decoding} ready=${t.ready} failed=${t.failed} intent=${t.intent} playing=${t.playing} pos=${fmt(t.playing ? t.currentPosition() : t.position)} gain=${t.gain ? fmt(t.gain.gain.value) : '-'}${musicErrors[name] ? ` error=${musicErrors[name]}` : ''}`);
      }
      box.textContent = lines.join('\n');
    }, 500);
  }
  // Touch diagnostics for phones (no console): open the game with ?touchlog=1. Shows the last
  // pointer and key events as the input layer saw them, which actions are held and by how many
  // sources, and the pointers the browser reports, so a dropped or stuck input can be read off.
  if (params.has('touchlog')) {
    const box = document.createElement('pre');
    box.className = 'kg-touchlog';
    box.style.cssText = 'position:fixed;right:4px;top:4px;z-index:9999;margin:0;padding:6px 8px;max-width:46vw;max-height:60vh;overflow:hidden;font:10px/1.3 monospace;color:#fff;background:rgba(0,0,0,.72);white-space:pre-wrap;pointer-events:none;';
    document.body.appendChild(box);
    const log = [];
    const t0 = performance.now();
    const stamp = () => ((performance.now() - t0) / 1000).toFixed(2).padStart(6);
    input.onEvent = (ev) => { log.push(`${stamp()} ${ev.type.padEnd(7)} ${String(ev.action).padEnd(5)} by ${ev.source} (${ev.held} src)`); if (log.length > 14) log.shift(); };
    const raw = [];
    for (const type of ['pointerdown', 'pointerup', 'pointercancel']) {
      window.addEventListener(type, (e) => {
        const target = e.target && e.target.closest ? e.target.closest('[data-btn],[data-pad]') : null;
        const name = target ? (target.dataset.btn || 'pad') : (e.target && e.target.className ? String(e.target.className).slice(0, 18) : '?');
        raw.push(`${stamp()} ${type.padEnd(13)} id=${e.pointerId} ${e.pointerType} on ${name}`);
        if (raw.length > 8) raw.shift();
      }, true);
    }
    setInterval(() => {
      const held = Object.entries(input.sources).filter(([, s]) => s.size).map(([a, s]) => `${a}:${s.size}`).join(' ') || 'nothing';
      box.textContent = [`held ${held}`, `game=${game.state} ${window.innerWidth}x${window.innerHeight} ${screen.orientation ? screen.orientation.type : ''}`, '--- input layer ---', ...log, '--- browser ---', ...raw].join('\n');
    }, 100);
  }
  root.karateHeroSheet = heroSheet;
  root.karateEnemySheets = enemySheets;
  root.karateInput = input;
  return game;
}

const root = document.getElementById('karate-game');
// The game instance is attached to its element (not a global) for debugging and automated tests.
if (root) root.karateGame = boot(root);
