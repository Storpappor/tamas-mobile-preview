// The audio director: turns what the game does into music changes and sound cues.
//
// It runs in the page (main.js calls `update()` once per frame, after the simulation steps)
// but touches no DOM, so it is tested headless. It reads the game's public state and the raw
// events the game sent to `sound.play(name)`, and resolves each into one cue:
//
//   raw event    resolved by                        cue
//   start        a run just began / a door opened   gameStart / doorEnter / waveClear
//   pause        suppressed for automatic pauses    pauseCue (or nothing)
//   punch        the player's attack is a grab      grabReach / whooshLight
//   kick                                            whooshHeavy
//   kiai                                            kiaiStrike
//   hit          the last strike was a kick         kickHit / punchHit
//   hitHeavy     a thrown fighter just landed       throwLand / kiaiHit
//   enemyDown    a thrown fighter just landed       throwLand / enemyKo
//   bossAppear                                      bossEnter (the boss track waits for Kage's dialogue)
//   hurt, block, jump, land, shuriken, kiaiStart, victory, gameOver: one cue each
//
// Moments the game raises no event for are read from state changes instead: the grip taking
// hold (the throw's start-up), the throw's release, an enemy starting a strike, and the resume
// after a pause. See "Missing hooks" in docs/music/README.md.

const RAW_TO_CUE = {
  hurt: 'playerHurt', block: 'block', jump: 'jump', land: 'land', shuriken: 'shuriken',
  kiaiStart: 'kiaiStart', bossAppear: 'bossEnter', victory: 'victory', gameOver: 'gameOver', pause: 'pauseCue',
};

const inRun = (s) => s === 'playing' || s === 'dialogue';
const isMenu = (s) => s === 'start' || s === 'gameover' || s === 'victory';

export function createAudioDirector({ game, sound, music }) {
  const seen = {
    state: game.state,
    ending: game.ending,
    transition: game.transition,
    bossAlive: Boolean(game.boss && !game.boss.dead),
    bossPresent: Boolean(game.boss && !game.boss.remove),
    encounter: false,        // the boss theme has started this run
    attackName: null,
    released: false,
    lastStrike: 'punch',
    thrown: new Map(),       // enemy -> was flying last frame
    enemyAttack: new Map(),  // enemy -> attack name last frame
  };

  const bossAlive = () => Boolean(game.boss && !game.boss.dead);
  const bossPresent = () => Boolean(game.boss && !game.boss.remove);

  // Which track the current moment wants, or null when it wants silence.
  function followMusic() {
    const { state, ending } = game;
    if (ending && !seen.ending) music.fadeOut();                       // the result jingle plays over the fade
    else if (state !== seen.state) {
      if (inRun(state) && !inRun(seen.state)) {
        if (seen.state === 'paused') { music.resume(); sound.cue('resumeCue'); }
        else { seen.encounter = false; music.play('stage', { fromStart: true }); }  // a new run starts from the top
      } else if (state === 'paused') music.pause();
      else if (!inRun(state) && !ending) music.fadeOut();
    }
    if (inRun(state) && !ending) {
      // The encounter begins, musically, when Master Kage's introductory dialogue opens: not when
      // the dojo is entered or when he is spawned (both happen with the stage track running), and
      // not on another dialogue. Once per run; the dialogue closing and the fight leave it alone.
      const alive = bossAlive();
      if (alive && state === 'dialogue' && !seen.encounter) {
        seen.encounter = true;
        music.play('boss', { fromStart: true });
      } else if (!bossPresent() && seen.bossPresent && music.current === 'boss') {
        // Kage gone without the run ending (his defeat ends it, in the same step, and the
        // ending fade above takes over): back to the stage track where it left off.
        music.play('stage');
      }
    }
    // The menu theme runs across the intro, the title and the result screens without restarting.
    if (isMenu(state)) music.play('menu');
  }

  function resolve(ev, ctx) {
    const p = game.player;
    switch (ev.name) {
      case 'start': return ctx.runStarted ? 'gameStart' : ctx.doorOpened ? 'doorEnter' : 'waveClear';
      case 'punch': {
        // A grab's start arrives as a punch. By the time a frame's steps are done the grab may
        // already hold its victim (attack name 'throw'), so both names mean the reach.
        const name = p.attack?.name || 'punch';
        seen.lastStrike = name;
        return name === 'grab' || name === 'throw' ? 'grabReach' : 'whooshLight';
      }
      case 'kick': seen.lastStrike = 'kick'; return 'whooshHeavy';
      case 'kiai': seen.lastStrike = p.attack?.name || 'punch'; return 'kiaiStrike';
      case 'hit': return /kick/i.test(seen.lastStrike) ? 'kickHit' : 'punchHit';
      case 'hitHeavy': return ctx.slammed ? 'throwLand' : 'kiaiHit';
      case 'enemyDown': return ctx.slammed ? 'throwLand' : 'enemyKo';
      default: return RAW_TO_CUE[ev.name] || null;
    }
  }

  function update() {
    const p = game.player;
    const ctx = {
      runStarted: inRun(game.state) && !inRun(seen.state) && seen.state !== 'paused',
      doorOpened: Boolean(game.transition) && !seen.transition,
      slammed: false,
    };
    const thrownNow = new Map();
    for (const e of game.enemies) {
      if (seen.thrown.get(e) && !e.thrown) ctx.slammed = true;
      thrownNow.set(e, Boolean(e.thrown));
    }

    followMusic();

    for (const ev of sound.drain()) {
      if (ev.suppressed) continue;
      const cue = resolve(ev, ctx);
      if (cue) sound.cue(cue);
    }

    // Moments without an event, read from the fighters' state.
    if (inRun(game.state) && p) {
      const name = p.attack?.name || null;
      if (name === 'throw' && seen.attackName !== 'throw') sound.cue('grabHold');
      const released = Boolean(p.attack?.released);
      if (name === 'throw' && released && !seen.released) sound.cue('throwToss');
      seen.attackName = name;
      seen.released = released;
      const enemyAttack = new Map();
      for (const e of game.enemies) {
        const a = e.attack?.name || null;
        if (a && a !== seen.enemyAttack.get(e) && !e.dead && !e.held && a !== 'enemyThrow') sound.cue('enemyWhoosh');
        enemyAttack.set(e, a);
      }
      seen.enemyAttack = enemyAttack;
    }

    seen.state = game.state;
    seen.ending = game.ending;
    seen.transition = game.transition;
    seen.bossAlive = bossAlive();
    seen.bossPresent = bossPresent();
    seen.thrown = thrownNow;
  }

  return {
    update,
    // Pause without the cue (the tab was hidden or the window lost focus).
    pauseSilently(fn) {
      sound.suppress('pause', true);
      try { fn(); } finally { sound.suppress('pause', false); }
    },
    // Menu interactions: 'move' on a selection change, 'confirm', 'back'.
    menu(kind) {
      sound.cue(kind === 'move' ? 'menuMove' : kind === 'back' ? 'menuBack' : 'menuConfirm');
    },
  };
}
