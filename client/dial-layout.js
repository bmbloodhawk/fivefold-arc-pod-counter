// Canvas measures visible ink, rather than the font's advance/line box.
// This keeps Georgia's descending numerals centered without per-digit nudges.
export function glyphCenterCorrection(metrics, baseline, height) {
  return {
    x: (metrics.width + metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2,
    y: height / 2 - baseline - (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2,
  };
}

// CSS owns dimensions and anchors. Runs in the game and live Studio renderer;
// value/turn changes only schedule one measurement, never change game state.
export function createDialLayout(game, value) {
  const canvas = document.createElement('canvas').getContext('2d');
  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'display:inline-block;width:0;height:0;line-height:0;vertical-align:baseline';
  let frame = null;
  const alignInk = () => {
    frame = null;
    if (game.hidden || game.dataset.interfaceStyle !== 'dial' || !canvas) return;
    value.style.setProperty('--dial-glyph-x', '0px');
    value.style.setProperty('--dial-glyph-y', '0px');
    const style = getComputedStyle(value);
    canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    canvas.fontKerning = style.fontKerning;
    canvas.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
    const metrics = canvas.measureText(value.value);
    const height = parseFloat(style.height);
    const box = value.getBoundingClientRect();
    const scaleY = box.height / height || 1;
    const originalHeight = value.style.height;
    // A baseline probe can enlarge a line with negative font leading. Keep
    // the existing box while measuring so its percentage anchor cannot move.
    value.style.height = `${height}px`;
    value.append(probe);
    const baseline = (probe.getBoundingClientRect().top - box.top) / scaleY;
    probe.remove();
    value.style.height = originalHeight;
    const correction = glyphCenterCorrection(metrics, baseline, height);
    value.style.setProperty('--dial-glyph-x', `${correction.x}px`);
    value.style.setProperty('--dial-glyph-y', `${correction.y}px`);
  };
  const update = () => {
    const active = !game.hidden && game.dataset.interfaceStyle === 'dial';
    document.body.classList.toggle('dial-layout', active);
    if (!active) return;
    value.style.setProperty('--dial-digit-factor', String(Math.max(1, String(value.value).length / 2)));
    if (frame !== null) return;
    frame = requestAnimationFrame(alignInk);
  };
  const resizeObserver = new ResizeObserver(update);
  resizeObserver.observe(game.querySelector('.dial-assembly'));
  // A downloaded skin can change digit metrics without changing the stage.
  // Observe the number's untransformed box as well; optical translations do
  // not resize it, so applying the correction cannot create an observer loop.
  resizeObserver.observe(value);
  document.fonts.ready.then(update);
  document.fonts.addEventListener('loadingdone', update);
  return { update };
}
