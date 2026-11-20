// Compatibility guard for native touch scrolling. Rotation remains exclusively
// in the existing Pointer Events path; this module never changes a counter.
export function bindDialTouchGuard(surface) {
  let identifier = null;
  const clear = () => { identifier = null; };
  const enabled = () => surface.getAttribute('aria-disabled') !== 'true';
  const preventScroll = event => { if (event.cancelable) event.preventDefault(); };
  const handlers = {
    touchstart(event) {
      if (!enabled() || event.touches.length !== 1) return clear();
      identifier = event.touches[0].identifier;
      preventScroll(event);
    },
    touchmove(event) {
      if (identifier === null) return;
      if (!enabled() || event.touches.length !== 1 || event.touches[0].identifier !== identifier) return clear();
      preventScroll(event);
    },
    touchend: clear,
    touchcancel: clear,
  };
  // Register both blocking listeners before any input begins. Installing a move
  // listener during touchstart can be too late for Safari's gesture arbitration.
  for (const [type, handler] of Object.entries(handlers))
    surface.addEventListener(type, handler, { passive: type !== 'touchstart' && type !== 'touchmove' });
  return () => {
    clear();
    for (const [type, handler] of Object.entries(handlers)) surface.removeEventListener(type, handler);
  };
}
