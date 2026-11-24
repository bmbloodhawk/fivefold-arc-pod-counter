import { dialSideZones } from './dial-side-zones.js?v=2';
import { localFontKeys } from './appearance-fonts.js';

// Canvas measures visible ink, rather than the font's advance/line box.
// This keeps Georgia's descending numerals centered without per-digit nudges.
export function glyphCenterCorrection(metrics, baseline, height) {
  return {
    x: (metrics.width + metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2,
    y: height / 2 - baseline - (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2,
  };
}

// Decorative art can extend behind cards and control rows. Fit the visible
// readout into the area that remains clear at the center of the artwork.
export function buttonTextRegion(artwork, sideCards, controlTop = Infinity) {
  const bottom = Math.min(artwork.bottom, controlTop - 4);
  const centerX = (artwork.left + artwork.right) / 2;
  let halfWidth = artwork.width / 2 - 4;
  for (const card of sideCards) {
    if (card.bottom <= artwork.top || card.top >= bottom) continue;
    if (card.right <= centerX) halfWidth = Math.min(halfWidth, centerX - card.right - 4);
    if (card.left >= centerX) halfWidth = Math.min(halfWidth, card.left - centerX - 4);
  }
  return { width: Math.max(1, halfWidth * 2), height: Math.max(1, bottom - artwork.top) };
}

// Keep the circle near the middle of the corridor while preserving a
// centered readout above the nearest control and any feedback.
export function centeredButtonCircle(corridor, textHeight, feedbackHeight, preferredReadoutHeight = 64) {
  const { top, bottom, width } = corridor;
  const clearBottom = top + Math.max(1, textHeight - feedbackHeight);
  const readoutHalf = Math.min(preferredReadoutHeight, clearBottom - top) / 2;
  const centerY = Math.min((top + bottom) / 2, clearBottom - readoutHalf);
  const radius = Math.max(.5, Math.min(width / 2, centerY - top, bottom - centerY));
  return { centerY, diameter: radius * 2, readoutHeight: 2 * Math.min(radius, clearBottom - centerY) };
}

export function inkFitScale(metrics, width, height) {
  return Math.min(1, width / (metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight || 1),
    height / (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent || 1));
}

export function fitReadoutBounds(bounds, offsetX, offsetY, scale) {
  return { width: Math.max(1, (bounds.width - 2 * Math.abs(offsetX)) / scale),
    height: Math.max(1, (bounds.height - 2 * Math.abs(offsetY)) / scale) };
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
  const sideLabels = [game.querySelector('.dial-step-minus-label'), game.querySelector('.dial-step-plus-label')];
  const feedback = [...game.querySelectorAll('#lifeChangeIndicator, #statusMessage')];
  const buttonGeometryProperties = ['--button-circle-center-y', '--button-circle-diameter',
    '--counter-text-width', '--counter-text-height', '--counter-feedback-width', '--counter-feedback-top'];
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
      const adjustment = visibleRects('#adjustControls')[0];
      const gutter = parseFloat(getComputedStyle(stage).getPropertyValue('--button-art-gutter')) || 6;
      const turnBanner = visibleRects('#turnBanner')[0];
      const top = (turnBanner?.bottom ?? stageBox.top) + gutter;
      const bottom = Math.max(top + 1, (adjustment?.top ?? stageBox.bottom) - gutter);
      const corridor = { top, bottom, left: stageBox.left + gutter, right: stageBox.right - gutter,
        width: Math.max(1, stageBox.width - 2 * gutter) };
      const controlTop = Math.min(...visibleRects('#turnActions, #sourcePanel, #adjustControls').map(rect => rect.top));
      const region = buttonTextRegion(corridor, visibleRects('#sideSeats .pod-seat'), controlTop);
      assembly.style.setProperty('--counter-feedback-width', region.width + 'px');
      const message = feedback.find(node => !node.hidden);
      const feedbackHeight = Math.max(18, message?.getBoundingClientRect().height || 0);
      // Commander gets a taller centered readout as room opens above the
      // source and turn controls. The smallest layouts keep the usual minimum.
      const preferredReadoutHeight = game.dataset.counterMode === 'commander'
        ? Math.min(128, Math.max(64, region.height - feedbackHeight - 36)) : undefined;
      const circle = centeredButtonCircle(corridor, region.height, feedbackHeight, preferredReadoutHeight);
      assembly.style.setProperty('--button-circle-center-y', (circle.centerY - stageBox.top) + 'px');
      assembly.style.setProperty('--button-circle-diameter', circle.diameter + 'px');
      const art = assembly.getBoundingClientRect();
      const bounds = { width: region.width, height: circle.readoutHeight };
      const text = readout.getBoundingClientRect();
      const scale = text.width / parseFloat(getComputedStyle(readout).width) || 1;
      const fitted = fitReadoutBounds(bounds, (text.left + text.right - art.left - art.right) / 2,
        (text.top + text.bottom - art.top - art.bottom) / 2, scale);
      assembly.style.setProperty('--counter-text-width', fitted.width + 'px');
      assembly.style.setProperty('--counter-text-height', fitted.height + 'px');
      const feedbackCenterY = top + region.height - feedbackHeight / 2 - art.top;
      assembly.style.setProperty('--counter-feedback-top', feedbackCenterY + 'px');
    } else {
      for (const property of buttonGeometryProperties) assembly.style.removeProperty(property);
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
      const captionGap = Math.max(2, Math.min(6, text.height * .05));
      const height = Math.max(1, 2 * Math.min(y - title.bottom - captionGap, context.top - y - captionGap));
      const circleWidth = Math.max(1, assembly.getBoundingClientRect().width - 8);
      const fit = inkFitScale(metrics, Math.min(width, circleWidth) / valueScale, Math.min(text.height * .48, height) / valueScale);
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
        const labelStyle = sideLabels[index].style;
        Object.assign(labelStyle, { left: `${zone.left + zone.labelX - controlBox.left}px`,
          top: `${zone.top + zone.labelY - controlBox.top}px`, visibility: 'visible' });
        labelStyle.setProperty('--dial-side-label-gap', `${zone.gapWidth}px`);
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
    document.body.classList.toggle('dial-layout', !game.hidden && game.dataset.interfaceStyle === 'dial');
    document.body.classList.toggle('button-layout', !game.hidden && game.dataset.interfaceStyle === 'button');
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
  // A late local face can change metrics while every CSS font property stays
  // identical. Reset the caption reserve before measuring the actual glyphs.
  const fontsChanged = () => {
    if ([game.dataset.localFont,game.dataset.surfaceReadoutValueFamily,game.dataset.surfaceReadoutLabelFamily,game.dataset.surfaceReadoutBodyFamily].some(key=>localFontKeys.includes(key))) captionLayoutKey = null;
    update();
  };
  document.fonts.ready.then(fontsChanged);
  document.fonts.addEventListener('loadingdone', fontsChanged);
  return { update };
}
