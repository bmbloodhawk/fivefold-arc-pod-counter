import { dialSideZones } from './dial-side-zones.js?v=1';

// Canvas measures visible ink, rather than the font's advance/line box.
// This keeps Georgia's descending numerals centered without per-digit nudges.
export function glyphCenterCorrection(metrics, baseline, height) {
  return {
    x: (metrics.width + metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2,
    y: height / 2 - baseline - (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2,
  };
}

// Decorations may overlap the surrounding cards; visible text uses their
// actual gap and stops above the first action, independent of viewport size.
export function buttonReadoutBounds(stage, cards, controls, gutter = 8) {
  const x = (stage.left + stage.right) / 2, y = (stage.top + stage.bottom) / 2;
  let halfWidth = stage.width / 2 - gutter;
  for (const card of cards) {
    if (card.bottom <= stage.top || card.top >= stage.bottom) continue;
    if (card.right <= x) halfWidth = Math.min(halfWidth, x - card.right - gutter);
    if (card.left >= x) halfWidth = Math.min(halfWidth, card.left - x - gutter);
  }
  let bottom = stage.bottom;
  for (const control of controls) if (control.top > y) bottom = Math.min(bottom, control.top);
  const diameter = Math.min(stage.width - 12, 400);
  return { width: Math.max(1, Math.min(halfWidth * 2, diameter)),
    height: Math.max(1, Math.min(diameter, 2 * Math.min(y - stage.top - gutter, bottom - y - gutter))),
    diameter };
}

export function inkFitScale(metrics, width, height) {
  return Math.min(1, width / (metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight || 1),
    height / (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent || 1));
}

export function fitReadoutBounds(bounds, offsetX, offsetY, scale) {
  return { width: Math.max(1, (bounds.width - 2 * Math.abs(offsetX)) / scale),
    height: Math.max(1, (bounds.height - 2 * Math.abs(offsetY)) / scale) };
}

export function feedbackBands(stage, cards, bottom, gutter = 8) {
  const width = Math.min(stage.width - 2 * gutter, 400);
  return [
    { top: Math.max(stage.top, ...cards.map(card => card.bottom)) + gutter, bottom, width },
    { top: stage.top + gutter, bottom: Math.min(bottom + gutter, ...cards.map(card => card.top)) - gutter, width },
  ];
}

// CSS owns dimensions and anchors. Runs in the game and live Studio renderer;
// value/turn changes only schedule one measurement, never change game state.
export function createDialLayout(game, value) {
  const canvas = document.createElement('canvas').getContext('2d');
  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'display:inline-block;width:0;height:0;line-height:0;vertical-align:baseline';
  let frame = null;
  let captionLayoutKey = null;
  let captionMinHeight = 0;
  const stage = game.querySelector('.counter-stage');
  const assembly = game.querySelector('.dial-assembly');
  const readout = game.querySelector('.counter-readout');
  const controls = game.querySelector('#dialControls');
  const sideButtons = [game.querySelector('.dial-step-minus'), game.querySelector('.dial-step-plus')];
  const feedback = [...game.querySelectorAll('#lifeChangeIndicator, #statusMessage')];
  const visibleRects = selector => [...game.querySelectorAll(selector)]
    .filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')
    .map(node => node.getBoundingClientRect());
  const measure = (style, text = value.value, fontSize = style.fontSize) => {
    canvas.font = `${style.fontStyle} ${style.fontWeight} ${fontSize} ${style.fontFamily}`;
    canvas.fontKerning = style.fontKerning;
    canvas.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
    return canvas.measureText(text);
  };
  const alignInk = () => {
    frame = null;
    if (game.hidden || !canvas) return;
    const button = game.dataset.interfaceStyle === 'button';
    const layoutKey = `${game.dataset.interfaceStyle}:${game.dataset.counterMode}:${globalThis.innerWidth || 0}:${globalThis.innerHeight || 0}`;
    if (layoutKey !== captionLayoutKey) {
      captionLayoutKey = layoutKey;
      captionMinHeight = 0;
      stage.style.removeProperty('--counter-caption-min-height');
    }
    if (button) {
      const stageBox = stage.getBoundingClientRect();
      const cards = visibleRects('#sideSeats .pod-seat');
      const bounds = buttonReadoutBounds(stageBox, cards,
        visibleRects('#sourcePanel, #turnActions, #adjustControls, #customLifeButton'));
      const text = readout.getBoundingClientRect();
      const scale = text.width / parseFloat(getComputedStyle(readout).width) || 1;
      const fitted = fitReadoutBounds(bounds, (text.left + text.right - stageBox.left - stageBox.right) / 2,
        (text.top + text.bottom - stageBox.top - stageBox.bottom) / 2, scale);
      stage.style.setProperty('--counter-text-width', `${fitted.width}px`);
      stage.style.setProperty('--counter-text-height', `${fitted.height}px`);
      stage.style.setProperty('--counter-art-size', `${bounds.diameter}px`);
      stage.style.setProperty('--counter-feedback-width', `${bounds.width}px`);
      stage.style.setProperty('--counter-feedback-top', `${stageBox.height / 2 + bounds.height * .42}px`);
      const message = feedback.find(node => !node.hidden);
      if (message) {
        const bottom = (stageBox.top + stageBox.bottom + bounds.height) / 2;
        const title = readout.querySelector('.counter-mode').getBoundingClientRect();
        const context = readout.querySelector('.counter-context').getBoundingClientRect();
        for (const [index, band] of feedbackBands(stageBox, cards, bottom).entries()) {
          stage.style.setProperty('--counter-feedback-width', `${band.width}px`);
          const height = message.getBoundingClientRect().height;
          const top = index === 0 ? Math.max(band.top, context.bottom + 8) : band.top;
          const end = index === 0 ? band.bottom : Math.min(band.bottom, title.top - 8);
          if (height <= end - top) {
            const center = index === 0 ? end - height / 2 : top + height / 2;
            stage.style.setProperty('--counter-feedback-top', `${center - stageBox.top}px`);
            break;
          }
          stage.style.setProperty('--counter-feedback-width', `${bounds.width}px`);
        }
      }
    } else {
      for (const name of ['--counter-text-width', '--counter-text-height', '--counter-art-size',
        '--counter-feedback-width', '--counter-feedback-top']) stage.style.removeProperty(name);
    }
    value.style.setProperty('--dial-glyph-x', '0px');
    value.style.setProperty('--dial-glyph-y', '0px');
    value.style.setProperty('--counter-ink-fit', '1');
    let style = getComputedStyle(value);
    let metrics = measure(style);
    if (button) {
      const text = readout.getBoundingClientRect();
      const box = value.getBoundingClientRect();
      const valueScale = box.height / parseFloat(style.height) || 1;
      const x = (box.left + box.right) / 2, y = (box.top + box.bottom) / 2;
      const title = readout.querySelector('.counter-mode').getBoundingClientRect();
      const context = readout.querySelector('.counter-context').getBoundingClientRect();
      // Authored offsets remain meaningful; fit the ink around that intended
      // center, rather than scaling or clearing the skin's translation.
      const width = Math.max(1, 2 * Math.min(x - text.left, text.right - x) - 4);
      const height = Math.max(1, 2 * Math.min(y - title.bottom - 6, context.top - 6 - y));
      const fit = inkFitScale(metrics, width / valueScale, Math.min(text.height * .36, height) / valueScale);
      value.style.setProperty('--counter-ink-fit', String(fit));
      style = getComputedStyle(value);
      metrics = measure(style);
    }
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
    if (button) {
      readout.style.removeProperty('--counter-context-top');
      for (const name of ['--counter-label-top', '--counter-label-left', '--counter-label-width',
        '--counter-context-height', '--counter-info-height', '--counter-mode-top', '--counter-mode-left']) assembly.style.removeProperty(name);
    } else {
      const assemblyBox = assembly.getBoundingClientRect();
      const controlBox = controls.getBoundingClientRect();
      const controlStyle = getComputedStyle(controls);
      const viewport = globalThis.visualViewport;
      // Resize can report the previous visual width for a frame. Never let a
      // side region widen the document and feed back into mobile viewport size.
      const layoutWidth = document.documentElement.clientWidth;
      const viewportLeft = Math.max(0, Math.min(layoutWidth, viewport?.offsetLeft || 0));
      const viewportRight = Math.min(layoutWidth, viewportLeft + (viewport?.width || layoutWidth));
      const zones = dialSideZones(assemblyBox, {
        left: viewportLeft + (parseFloat(controlStyle.getPropertyValue?.('--dial-safe-left')) || 0),
        right: viewportRight - (parseFloat(controlStyle.getPropertyValue?.('--dial-safe-right')) || 0),
      });
      for (const [index, zone] of Object.values(zones).entries()) {
        const buttonStyle = sideButtons[index].style;
        Object.assign(buttonStyle, { left: `${zone.left - controlBox.left}px`, top: `${zone.top - controlBox.top}px`,
          width: `${zone.width}px`, height: `${zone.height}px`, clipPath: `path("${zone.path}")`, visibility: 'visible' });
        buttonStyle.setProperty('--dial-side-label-x', `${zone.labelX}px`);
        buttonStyle.setProperty('--dial-side-label-y', `${zone.labelY}px`);
      }
      const readoutBox = readout.getBoundingClientRect();
      const readoutScaleY = readoutBox.height / parseFloat(getComputedStyle(readout).height) || 1;
      // Reserve one fixed two-digit band around the uncorrected number center.
      // The caption must not follow changing glyph shapes or three-digit sizing.
      const digitFactor = parseFloat(value.style.getPropertyValue('--dial-digit-factor')) || 1;
      const reference = measure(style, '88', `${parseFloat(style.fontSize) * digitFactor}px`);
      const referenceBottom = (box.top + box.bottom) / 2
        + (reference.actualBoundingBoxAscent + reference.actualBoundingBoxDescent) * scaleY / 2;
      const outcome = readout.querySelector('.elimination-outcome');
      const outcomeBottom = outcome && !outcome.hidden ? outcome.getBoundingClientRect().bottom : referenceBottom;
      // The name is inside the authored readout transform; feedback and fades
      // are assembly siblings and need the final physical coordinates instead.
      readout.style.setProperty('--counter-context-top', `${(Math.max(referenceBottom, outcomeBottom) + 12 - readoutBox.top) / readoutScaleY}px`);
      const contextBox = readout.querySelector('.counter-context').getBoundingClientRect();
      assembly.style.setProperty('--counter-label-top', `${contextBox.top - assemblyBox.top}px`);
      assembly.style.setProperty('--counter-label-left', `${(contextBox.left + contextBox.right) / 2 - assemblyBox.left}px`);
      assembly.style.setProperty('--counter-label-width', `${contextBox.width}px`);
      assembly.style.setProperty('--counter-context-height', `${contextBox.height}px`);
      const message = feedback.find(node => !node.hidden);
      const infoStyle = getComputedStyle(feedback[0]);
      const infoHeight = Math.max(parseFloat(infoStyle.minHeight) || 18, message?.getBoundingClientRect().height || 0);
      assembly.style.setProperty('--counter-info-height', `${infoHeight}px`);
      const modeBox = readout.querySelector('.counter-mode').getBoundingClientRect();
      assembly.style.setProperty('--counter-mode-top', `${(modeBox.top + modeBox.bottom) / 2 - assemblyBox.top}px`);
      assembly.style.setProperty('--counter-mode-left', `${(modeBox.left + modeBox.right) / 2 - assemblyBox.left}px`);
      // Keep long warnings above the following controls. Retain any extra
      // space until the mode/viewport changes, including after feedback expires.
      const infoTop = parseFloat(infoStyle.top);
      const infoBottom = message ? message.getBoundingClientRect().bottom
        : (Number.isFinite(infoTop) ? assemblyBox.top + infoTop : contextBox.bottom + 2) + infoHeight;
      const controlTop = Math.min(...visibleRects('#turnActions, #sourcePanel, .commander-tax-quick')
        .filter(rect => rect.top > (box.top + box.bottom) / 2).map(rect => rect.top));
      const deficit = infoBottom + 8 - controlTop;
      if (deficit > .25) {
        captionMinHeight = Math.max(captionMinHeight, Math.ceil(stage.getBoundingClientRect().height + deficit * 2.5));
        stage.style.setProperty('--counter-caption-min-height', `${captionMinHeight}px`);
      }
    }
  };
  const update = () => {
    const active = !game.hidden && game.dataset.interfaceStyle === 'dial';
    document.body.classList.toggle('dial-layout', active);
    if (game.hidden) return;
    value.style.setProperty('--dial-digit-factor', String(Math.max(1, String(value.value).length / 2)));
    if (frame !== null) return;
    frame = requestAnimationFrame(alignInk);
  };
  const resizeObserver = new ResizeObserver(update);
  resizeObserver.observe(assembly);
  resizeObserver.observe(stage);
  resizeObserver.observe(readout.querySelector('.counter-context'));
  const outcome = readout.querySelector('.elimination-outcome');
  if (outcome) resizeObserver.observe(outcome);
  feedback.forEach(node => resizeObserver.observe(node));
  // A downloaded skin can change digit metrics without changing the stage.
  // Observe the number's untransformed box as well; optical translations do
  // not resize it, so applying the correction cannot create an observer loop.
  resizeObserver.observe(value);
  globalThis.visualViewport?.addEventListener('resize', update);
  globalThis.visualViewport?.addEventListener('scroll', update);
  document.fonts.ready.then(update);
  document.fonts.addEventListener('loadingdone', update);
  return { update };
}
