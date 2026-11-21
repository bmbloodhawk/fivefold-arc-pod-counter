import assert from 'node:assert/strict';
import { readDialLayout, settleDial } from './dial-layout.browser.mjs';

export const buttonSizes = [
  { width: 320, height: 568 }, { width: 353, height: 659 },
  { width: 360, height: 640 }, { width: 390, height: 844 },
  { width: 427, height: 915 }, { width: 430, height: 932 },
];
export const buttonModes = ['life', 'commander', 'radiation', 'poison', 'energy', 'generic'];

export async function chooseInterface(page, style) {
  if (await page.locator('#gameView').getAttribute('data-interface-style') === style) return;
  await page.locator('#moreButton').click();
  await page.locator('#toggleInterfaceStyleButton').click();
  if (await page.locator('#closeGameMenuButton').isVisible()) await page.locator('#closeGameMenuButton').click();
  assert.equal(await page.locator('#gameView').getAttribute('data-interface-style'), style);
  await settleDial(page);
}

export async function readButtonLayout(page) {
  const dial = await readDialLayout(page);
  const details = await page.evaluate(() => {
    const visible = node => node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    const rect = node => {
      if (!visible(node)) return null;
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const fixed = ['.app-header', '.game-topline', '#podStrip', '#turnBanner', '.counter-stage',
      '#turnActions', '#endTurnButton', '#undoTurnButton', '#undoEliminationButton', '#adjustControls', '#customLifeButton',
      '#sourcePanel', '.commander-tax-quick', '#modeNav'];
    const seats = [...document.querySelectorAll('#podStrip .pod-seat, #sideSeats .pod-seat')].map(node => {
      const r = rect(node);
      const hit = r && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { id: node.dataset.seat || node.dataset.player || node.dataset.seatId || node.getAttribute('aria-label'),
        rect: r, hit: !!hit && (hit === node || node.contains(hit)), side: !!node.closest('#sideSeats') };
    });
    const face = rect(document.querySelector('.dial-face'));
    const targets = [...document.querySelectorAll('#podStrip button, #sideSeats button, #turnActions button, #adjustControls button, #customLifeButton, #sourcePanel button, #commanderTaxQuickButton, #modeNav button')]
      .filter(visible).map(node => {
        const bounds = rect(node);
        const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        const sourceHits = node.closest('#sourcePanel') ? [[bounds.x + 6, bounds.y + 6],
          [bounds.right - 6, bounds.y + 6], [bounds.x + 6, bounds.bottom - 6], [bounds.right - 6, bounds.bottom - 6]]
          .map(([x, y]) => { const found = document.elementFromPoint(x, y); return !!found && (found === node || node.contains(found)); }) : [];
        return { id: node.id || node.dataset.seat || node.dataset.mode || node.dataset.delta || node.getAttribute('aria-label'),
          rect: bounds, hit: !!hit && (hit === node || node.contains(hit)), sourceHits,
          adjustment: !!node.closest('#adjustControls') };
      });
    return { outer: Object.fromEntries(fixed.map(s => [s, rect(document.querySelector(s))])), seats,
      header: rect(document.querySelector('.brand-bar')),
      face, readout: rect(document.querySelector('.counter-readout')),
      ringCenter: face && { x: face.x + face.width / 2, y: face.y + face.height / 2 },
      modeTitle: rect(document.querySelector('#modeTitle')),
      style: document.querySelector('#gameView').dataset.interfaceStyle,
      value: document.querySelector('#mainValue').value,
      fontSize: parseFloat(getComputedStyle(document.querySelector('#mainValue')).fontSize),
      targets, sourceBeforeAdjust: document.querySelector('#sourcePanel').nextElementSibling === document.querySelector('#adjustControls'),
      pageWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
      scrollX, scrollY, viewport: { width: innerWidth, height: innerHeight } };
  });
  return { ...dial, ...details };
}

const overlaps = (a, b) => a && b && Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1
  && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;

export function compareButtonOuter(before, after, tolerance = 1) {
  const changes = [];
  const compare = (key, a, b) => {
    if (!a || !b) { if (!!a !== !!b) changes.push({ key, before: a, after: b }); return; }
    for (const dimension of ['x', 'y', 'width', 'height']) if (Math.abs(a[dimension] - b[dimension]) > tolerance)
      changes.push({ key, dimension, before: a[dimension], after: b[dimension] });
  };
  for (const key of Object.keys(before.outer)) compare(key, before.outer[key], after.outer[key]);
  assert.equal(after.seats.length, before.seats.length, 'same number of player cards');
  before.seats.forEach((seat, i) => compare(`seat-${i}`, seat.rect, after.seats[i].rect));
  return changes;
}

export function buttonReadabilityIssues(layout) {
  const issues = [];
  if (layout.horizontalOverflow) issues.push('horizontal overflow');
  const text = [['number ink', layout.ink], ['mode title', layout.modeTitle],
    ['context', layout.boxes['#counterContext']], ['outcome', layout.boxes['#eliminationOutcome']],
    ['preview', layout.boxes['#lifeChangeIndicator']], ['warning', layout.boxes['#statusMessage']]];
  const obstacles = [...layout.seats.map((seat, i) => [`seat-${i}`, seat.rect]),
    ...['#turnActions', '#adjustControls', '#customLifeButton', '#sourcePanel', '.commander-tax-quick', '#modeNav']
      .map(key => [key, layout.outer[key]])];
  for (const [name, box] of text) {
    for (const [obstacle, bounds] of obstacles) if (overlaps(box, bounds)) issues.push(`${name} overlaps ${obstacle}`);
  }
  for (let i = 0; i < text.length; i++) for (let j = i + 1; j < text.length; j++)
    if (overlaps(text[i][1], text[j][1])) issues.push(`${text[i][0]} overlaps ${text[j][0]}`);
  for (const [name, box] of text) if (box) {
    if (box.x < -1 || box.right > layout.viewport.width + 1) issues.push(`${name} outside horizontal viewport`);
    if (box.y < -1 || box.bottom > layout.viewport.height + 1) issues.push(`${name} outside vertical viewport`);
  }
  return issues;
}

// Normal portrait gameplay must fit on its first view; scrolling cannot make a
// covered control or caption count as a pass. Cards may cover decorative art.
export function buttonPortraitIssues(layout) {
  const issues = buttonReadabilityIssues(layout);
  const within = box => box && box.x >= -1 && box.y >= -1
    && box.right <= layout.viewport.width + 1 && box.bottom <= layout.viewport.height + 1;
  const face = layout.face;
  if (layout.viewport.width >= layout.viewport.height) issues.push('fixture is not portrait');
  if (layout.pageHeight > layout.viewport.height + 1) issues.push('vertical page overflow');
  if (layout.pageWidth > layout.clientWidth + 1) issues.push('horizontal page overflow');
  if (Math.abs(layout.scrollX || 0) > 1 || Math.abs(layout.scrollY || 0) > 1) issues.push('initial view has scrolled');
  for (const key of ['.game-topline', '#podStrip', '#turnBanner', '#adjustControls', '.commander-tax-quick', '#modeNav'])
    if (!within(layout.outer[key])) issues.push(`${key} outside initial viewport`);
  for (const key of ['#sourcePanel', '#customLifeButton', '#endTurnButton', '#undoTurnButton', '#undoEliminationButton'])
    if (layout.outer[key] && !within(layout.outer[key])) issues.push(`${key} outside initial viewport`);
  if (!within(face)) issues.push('artwork outside initial viewport');
  if (!face || face.width <= 0 || face.height <= 0) issues.push('artwork has no visible area');
  if (face && Math.abs(face.width - face.height) > .6) issues.push('artwork is not circular');
  if (face && layout.outer['#turnBanner']?.bottom > face.y + 1) issues.push('artwork above turn bar');
  if (face && face.bottom > layout.outer['#adjustControls']?.y + 1) issues.push('artwork below adjustment row');
  const touchesCircle = box => {
    if (!face || !box) return false;
    const x = face.x + face.width / 2, y = face.y + face.height / 2;
    return Math.hypot(x - Math.max(box.x, Math.min(x, box.right)),
      y - Math.max(box.y, Math.min(y, box.bottom))) < face.width / 2 - 1;
  };
  for (const [index, seat] of layout.seats.entries()) {
    if (!within(seat.rect) || !seat.hit) issues.push(`seat-${index} unreachable in initial viewport`);
  }
  for (const key of ['#turnBanner', '#adjustControls', '#customLifeButton', '#undoTurnButton', '#undoEliminationButton', '.commander-tax-quick', '#modeNav'])
    if (touchesCircle(layout.outer[key])) issues.push(`artwork overlaps ${key}`);
  for (const target of layout.targets || []) {
    if (!within(target.rect) || !target.hit) issues.push(`${target.id} center unreachable`);
    if (target.sourceHits?.some(hit => !hit)) issues.push(`${target.id} source corners unreachable`);
    if (target.rect.width < 44 - .1 || target.rect.height < 44 - .1) issues.push(`${target.id} target smaller than 44px`);
  }
  if ((layout.targets || []).filter(target => target.adjustment).length !== 4) issues.push('four visible adjustment targets required');
  for (let i = 0; i < (layout.targets || []).length; i++) for (let j = i + 1; j < layout.targets.length; j++)
    if (overlaps(layout.targets[i].rect, layout.targets[j].rect)) issues.push(`${layout.targets[i].id} overlaps ${layout.targets[j].id}`);
  const tax = layout.outer['.commander-tax-quick'], nav = layout.outer['#modeNav'];
  if (nav && Math.abs(nav.bottom - layout.viewport.height) > 1) issues.push('tabs are not at viewport bottom');
  if (tax && nav && tax.bottom > nav.y + 1) issues.push('commander tax is not above tabs');
  const source = layout.outer['#sourcePanel'], adjust = layout.outer['#adjustControls'];
  if (layout.mode === 'commander' && !source) issues.push('Commander source missing');
  if (layout.mode === 'life' && !layout.outer['#customLifeButton']) issues.push('custom Life control missing');
  if (source && (!layout.sourceBeforeAdjust || source.bottom > adjust.y + 1)) issues.push('commander source is not directly above adjustments');
  if (tax && tax.y < (layout.outer['#customLifeButton'] || adjust).bottom - 1) issues.push('commander tax precedes counter controls');
  return issues;
}
