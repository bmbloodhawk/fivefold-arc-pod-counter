// Curved tap regions use the existing circle's rendered bounds; they never size it.
export function dialSideZones(circle, viewport, clearance = 6) {
  const center = circle.left + circle.width / 2;
  const radiusX = circle.width / 2 + clearance, radiusY = circle.height / 2 + clearance;
  const halfHeight = circle.height / 2;
  const edge = y => radiusX * Math.sqrt(Math.max(0, 1 - ((y - halfHeight) / radiusY) ** 2));
  const make = (side, left, width) => {
    const centerX = center - left;
    const cut = centerX + side * edge(0);
    const outer = side < 0 ? 0 : width;
    const gapWidth = Math.max(0, side < 0 ? circle.left - left : left + width - circle.left - circle.width);
    return { left, top: circle.top, width, height: circle.height,
      path: `M ${outer} 0 L ${cut} 0 A ${radiusX} ${radiusY} 0 0 ${side < 0 ? 0 : 1} ${cut} ${circle.height} L ${outer} ${circle.height} Z`,
      labelX: side < 0 ? gapWidth / 2 : width - gapWidth / 2, labelY: halfHeight, gapWidth,
    };
  };
  return { minus: make(-1, viewport.left, Math.max(0, center - viewport.left)),
    plus: make(1, center, Math.max(0, viewport.right - center)) };
}

// Side taps allow page scrolling. Only a small, uncancelled release on the same
// region counts; touch's implicit pointer capture must not bypass the hit test.
export function bindDialSideTaps(controls, onStep, {
  hitTest = (x, y) => document.elementFromPoint(x, y), scrollTarget = globalThis,
} = {}) {
  let start = null;
  const buttonAt = node => node?.closest?.('.dial-step[data-delta]');
  const distance = event => Math.hypot(event.clientX - start.x, event.clientY - start.y);
  const cancel = () => { start = null; };
  const handlers = {
    pointerdown(event) {
      const button = buttonAt(event.target);
      if (start || event.isPrimary === false || event.button !== 0 || !button || button.disabled) return cancel();
      start = { id: event.pointerId, button, x: event.clientX, y: event.clientY };
      button.setPointerCapture?.(event.pointerId);
    },
    pointermove(event) { if (start && event.pointerId === start.id && distance(event) > 8) cancel(); },
    pointerup(event) {
      if (!start) return;
      const button = start.button;
      const valid = event.pointerId === start.id && !button.disabled && distance(event) <= 8
        && buttonAt(hitTest(event.clientX, event.clientY)) === button;
      cancel();
      if (valid) { event.preventDefault(); onStep(Number(button.dataset.delta)); }
    },
    pointercancel: cancel,
    lostpointercapture: cancel,
    click(event) {
      const button = buttonAt(event.target);
      // Pointer activation was handled at release. Native keyboard/AT activation
      // has detail zero and needs its own route, without double-counting taps.
      if (event.detail === 0 && button && !button.disabled) onStep(Number(button.dataset.delta));
    },
  };
  for (const [type, handler] of Object.entries(handlers)) controls.addEventListener(type, handler);
  scrollTarget.addEventListener('scroll', cancel, true);
  return () => {
    cancel();
    for (const [type, handler] of Object.entries(handlers)) controls.removeEventListener(type, handler);
    scrollTarget.removeEventListener('scroll', cancel, true);
  };
}
