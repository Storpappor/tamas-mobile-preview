// Browser gesture guard for the touch game surface.
//
// Why this exists: `touch-action` on an element only governs touches that START on that element,
// WebKit does not treat a pinch as blocked unless every finger started on a `none` element, and
// the HUD strip and page frame had no rule at all. A stray second finger or a double-tap on the HUD
// could therefore zoom the page, and because the playing surface blocks gestures, the player could
// not pinch back out. This module (1) refuses the browser's pinch and double-tap gestures that
// start inside the game, (2) lets single-finger panning through when a menu is open so overlays
// can still scroll, and (3) snaps the page back to scale 1 if a zoom slipped through while playing
// or after a rotation. Everything is observable for the ?touchlog=1 diagnostic.
export function installGestureGuard({ root, isPlaying = () => false, onRotate = null, doc = document, win = window }) {
  const stats = { blockedGestures: 0, blockedPinchMoves: 0, blockedPlayMoves: 0, zoomResets: 0, lastTarget: '', lastTouches: 0 };
  const inside = (node) => Boolean(node && root.contains(node));
  const name = (node) => {
    if (!node || !node.closest) return String(node && node.nodeName || '?');
    const c = node.closest('[data-btn],[data-pad],.kg-hud,.kg-overlay,.kg-stage,.kg-touch');
    if (!c) return node.nodeName.toLowerCase();
    return c.dataset.btn || (c.dataset.pad !== undefined ? 'pad' : c.className.split(' ')[0]);
  };

  // WebKit's proprietary pinch/rotate gesture events: refuse them when they start in the game.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    doc.addEventListener(type, (e) => {
      if (!inside(e.target)) return;
      e.preventDefault();
      if (type === 'gesturestart') { stats.blockedGestures += 1; stats.lastTarget = name(e.target); }
    }, { passive: false, capture: true });
  }

  doc.addEventListener('touchstart', (e) => {
    if (!inside(e.target)) return;
    stats.lastTarget = name(e.target);
    stats.lastTouches = e.touches.length;
  }, { passive: true, capture: true });

  // A move with two or more fingers in the game is a pinch: never let the browser have it.
  // A one-finger move while playing is the player's thumb: never a scroll. With a menu open a
  // single finger may pan, so overlays that are taller than the screen can still be scrolled.
  doc.addEventListener('touchmove', (e) => {
    let anyInside = false;
    for (const t of e.touches) if (inside(t.target)) { anyInside = true; break; }
    if (!anyInside) return;
    if (e.touches.length > 1) { e.preventDefault(); stats.blockedPinchMoves += 1; return; }
    if (isPlaying()) { e.preventDefault(); stats.blockedPlayMoves += 1; }
  }, { passive: false, capture: true });

  // Recovery: if the page is zoomed while playing (or right after a rotation), snap back to 1.
  // Rewriting the viewport meta makes the browser re-apply initial-scale; the original content is
  // restored on the next frame so a reader who zooms a menu on purpose keeps that freedom.
  const meta = doc.querySelector('meta[name="viewport"]');
  const original = meta ? meta.getAttribute('content') : null;
  let timer = null;
  const resetZoom = (reason) => {
    if (!meta || !original) return false;
    meta.setAttribute('content', `${original}, maximum-scale=1, user-scalable=no`);
    stats.zoomResets += 1;
    stats.lastReset = reason;
    win.requestAnimationFrame(() => meta.setAttribute('content', original));
    return true;
  };
  const scale = () => (win.visualViewport ? win.visualViewport.scale : 1);
  const check = (reason, force = false) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (scale() > 1.01 && (force || isPlaying())) resetZoom(reason);
    }, 250);
  };
  if (win.visualViewport) win.visualViewport.addEventListener('resize', () => check('viewport'));
  const rotated = () => {
    if (onRotate) onRotate();
    check('rotation', true);
  };
  if (win.screen && win.screen.orientation && win.screen.orientation.addEventListener) win.screen.orientation.addEventListener('change', rotated);
  else win.addEventListener('orientationchange', rotated);

  return {
    stats,
    scale,
    resetZoom: () => resetZoom('manual'),
    // One line for the diagnostic overlay.
    describe() {
      const vv = win.visualViewport;
      const z = vv ? `scale=${vv.scale.toFixed(2)} vv=${Math.round(vv.width)}x${Math.round(vv.height)} off=${Math.round(vv.offsetLeft)},${Math.round(vv.offsetTop)}` : 'no visualViewport';
      return `${z} win=${win.innerWidth}x${win.innerHeight} ${win.screen && win.screen.orientation ? win.screen.orientation.type : ''}\n` +
        `gestures blocked=${stats.blockedGestures} pinchMoves=${stats.blockedPinchMoves} playMoves=${stats.blockedPlayMoves} zoomResets=${stats.zoomResets}${stats.lastReset ? ` (${stats.lastReset})` : ''} last touch on ${stats.lastTarget || '-'} x${stats.lastTouches}`;
    },
  };
}
