// DOM side of the game: HUD values, overlays and the sound/touch toggles.
// Values are cached so the DOM is only touched when something changes.
export function createUi(root) {
  const q = (sel) => root.querySelector(sel);
  const overlays = [...root.querySelectorAll('[data-overlay]')];
  const hud = {
    health: q('[data-hud="health"]'),
    healthText: q('[data-hud="health-text"]'),
    score: q('[data-hud="score"]'),
    enemies: q('[data-hud="enemies"]'),
    bossWrap: q('[data-hud="boss-wrap"]'),
    boss: q('[data-hud="boss"]'),
    kiai: q('[data-hud="kiai"]'),
    kiaiText: q('[data-hud="kiai-text"]'),
    comboWrap: q('[data-hud="combo-wrap"]'),
    combo: q('[data-hud="combo"]'),
    kiaiButton: q('[data-btn="kiai"]'),
    touchKiaiFill: q('[data-touch-kiai-fill]'),
    touchKiaiText: q('[data-touch-kiai-text]'),
  };
  const soundButtons = [...root.querySelectorAll('[data-action="sound"]')];
  const touch = q('[data-touch]');
  let last = {};

  // ---- Story / dialogue cards (NES-style text screens) ----------------------
  const story = q('[data-overlay="story"]');
  const storyText = story && story.querySelector('[data-story-text]');
  const storyHint = story && story.querySelector('[data-story-hint]');
  const skipButton = story && story.querySelector('[data-action="skip-story"]');
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TYPE_MS = 32;
  let active = null; // { screens, index, onDone, skippable, full, shown, timer }

  function stopTyping() {
    if (active && active.timer) { clearInterval(active.timer); active.timer = null; }
    storyText.classList.remove('is-typing');
  }

  function renderScreen() {
    stopTyping();
    const lines = active.screens[active.index];
    active.full = lines.join('\n');
    if (reducedMotion) {
      storyText.textContent = active.full;
      return;
    }
    active.shown = 0;
    storyText.textContent = '';
    storyText.classList.add('is-typing');
    active.timer = setInterval(() => {
      active.shown += 1;
      storyText.textContent = active.full.slice(0, active.shown);
      if (active.shown >= active.full.length) stopTyping();
    }, TYPE_MS);
  }

  function finishStory(skipped = false) {
    if (!active) return;
    stopTyping();
    const done = active.onDone;
    active = null;
    story.hidden = true;
    window.removeEventListener('keydown', onStoryKey);
    if (skipped && api.onMenu) api.onMenu('back');
    if (done) done();
  }

  function advanceStory() {
    if (!active) return;
    if (active.timer) { // still typing: reveal the whole screen first
      stopTyping();
      storyText.textContent = active.full;
      return;
    }
    active.index += 1;
    if (active.index >= active.screens.length) finishStory();
    else { renderScreen(); if (api.onMenu) api.onMenu('move'); }
  }

  function onStoryKey(e) {
    if (!active) return;
    if (e.code === 'Enter' || e.code === 'Space' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advanceStory(); }
    else if ((e.code === 'Escape' || e.key === 'Escape') && active.skippable) { e.preventDefault(); finishStory(true); }
  }

  if (story) {
    story.addEventListener('click', (e) => {
      if (skipButton && skipButton.contains(e.target)) { finishStory(true); return; }
      advanceStory();
    });
  }

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  const api = {
    // Optional painter for hero canvases inside overlays (set by main.js once the sprite is loaded).
    heroPainter: null,
    // Optional listener for menu interactions: 'move' when a story card advances, 'back' on skip.
    onMenu: null,

    get storyActive() {
      return Boolean(active);
    },

    // Show a sequence of text screens. Each screen is an array of lines.
    showStory(screens, { onDone = null, skippable = true, hint = 'Enter · Space · tap to continue' } = {}) {
      if (!story) { if (onDone) onDone(); return; }
      finishStory();
      for (const el of overlays) if (el !== story) el.hidden = true;
      active = { screens, index: 0, onDone, skippable, full: '', shown: 0, timer: null };
      if (skipButton) skipButton.hidden = !skippable;
      if (storyHint) storyHint.textContent = hint;
      story.hidden = false;
      window.addEventListener('keydown', onStoryKey);
      renderScreen();
    },

    // In-game exchange: same cards, no skip button, calls back when finished.
    showDialogue(lines, done) {
      this.showStory(lines, { onDone: done, skippable: false, hint: 'Enter · Space · tap' });
    },

    showOverlay(name, data) {
      if (active && name !== 'story') finishStory();
      for (const el of overlays) {
        if (el === story) continue;
        const show = el.dataset.overlay === name;
        el.hidden = !show;
        if (show && data) {
          const score = el.querySelector('[data-result="score"]');
          const time = el.querySelector('[data-result="time"]');
          const bonus = el.querySelector('[data-result="bonus"]');
          if (score) score.textContent = data.score.toLocaleString();
          if (time) time.textContent = fmtTime(data.elapsed);
          if (bonus && data.bonus) bonus.textContent = `Health bonus ${data.bonus.healthBonus.toLocaleString()} · Time bonus ${data.bonus.timeBonus.toLocaleString()}`;
        }
        if (show) {
          const heroCanvas = el.querySelector('[data-hero-canvas]');
          if (heroCanvas && this.heroPainter) this.heroPainter(heroCanvas, name);
          const btn = el.querySelector('button');
          if (btn) setTimeout(() => btn.focus({ preventScroll: true }), 0);
        }
      }
    },

    setHud({ hp, maxHp, score, remaining, boss, kiai, combo = 0, multiplier = 1 }, force = false) {
      if (force || last.hp !== hp) {
        const pct = Math.max(0, (hp / maxHp) * 100);
        hud.health.style.width = `${pct}%`;
        hud.health.classList.toggle('is-low', pct <= 30);
        if (hud.healthText) hud.healthText.textContent = `${hp} / ${maxHp}`;
      }
      if (force || last.score !== score) hud.score.textContent = score.toLocaleString();
      if (force || last.remaining !== remaining) hud.enemies.textContent = String(remaining);
      const bossHp = boss ? boss.hp : null;
      if (force || last.bossHp !== bossHp) {
        hud.bossWrap.hidden = !boss;
        if (boss) hud.boss.style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%`;
      }
      if (kiai && hud.kiai) {
        const pct = Math.round(kiai.fraction * 100);
        const mode = kiai.active ? 'active' : kiai.ready ? 'ready' : 'cooling';
        if (force || last.kiaiPct !== pct) {
          hud.kiai.style.width = `${pct}%`;
          // The touch meter is the Kiai button itself: its fill shows the same charge.
          if (hud.touchKiaiFill) hud.touchKiaiFill.style.width = `${pct}%`;
        }
        if (force || last.kiaiMode !== mode) {
          const label = mode === 'active' ? 'AJSICH!' : mode === 'ready' ? 'Ready' : 'Charging';
          hud.kiai.classList.toggle('is-ready', mode === 'ready');
          hud.kiai.classList.toggle('is-active', mode === 'active');
          if (hud.kiaiText) {
            hud.kiaiText.textContent = label;
            hud.kiaiText.classList.toggle('is-ready', mode === 'ready');
            hud.kiaiText.classList.toggle('is-active', mode === 'active');
          }
          if (hud.kiaiButton) {
            hud.kiaiButton.classList.toggle('is-ready', mode === 'ready');
            hud.kiaiButton.classList.toggle('is-active', mode === 'active');
            hud.kiaiButton.classList.toggle('is-cooling', mode === 'cooling');
          }
          if (hud.touchKiaiText) hud.touchKiaiText.textContent = mode === 'ready' ? 'Kiai: tap!' : mode === 'active' ? 'Kiai active' : 'Kiai charging';
        }
        last.kiaiPct = pct; last.kiaiMode = mode;
      }
      if (hud.comboWrap && (force || last.combo !== combo || last.multiplier !== multiplier)) {
        hud.comboWrap.hidden = combo < 2;
        hud.combo.textContent = `${combo} hits · x${multiplier}`;
      }
      last = { ...last, hp, score, remaining, bossHp, combo, multiplier };
    },

    setSound(on) {
      for (const b of soundButtons) {
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.textContent = on ? 'Sound: On' : 'Sound: Off';
      }
    },

    setTouchVisible(on) {
      if (touch) touch.hidden = !on;
      root.classList.toggle('kg-root--touch', on);
      // The page frame gives up its padding in phone landscape so the picture can fill the screen.
      const body = root.ownerDocument && root.ownerDocument.body;
      if (body) body.classList.toggle('kg-page--touch', on);
    },

    // Alternatives under evaluation (DUCK, BLOCK): hidden unless asked for by name.
    showTouchAlternatives(names) {
      const alt = q('[data-touch-alt]');
      const wanted = names.filter((n) => ['duck', 'block'].includes(n));
      if (alt) alt.hidden = wanted.length === 0;
      for (const n of ['duck', 'block']) {
        const b = q(`[data-btn="${n}"]`);
        if (b) b.hidden = !wanted.includes(n);
      }
    },
  };
  return api;
}
