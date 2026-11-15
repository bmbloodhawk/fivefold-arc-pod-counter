import assert from 'node:assert/strict';
import { readDialLayout, settleDial } from './dial-layout.browser.mjs';

export const buttonSizes = [
  { width: 320, height: 568 }, { width: 360, height: 640 },
  { width: 390, height: 844 }, { width: 430, height: 932 },
  { width: 768, height: 1024 }, { width: 1024, height: 768 },
  { width: 1440, height: 900 }, { width: 740, height: 360 },
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
      '#turnActions', '#endTurnButton', '#undoTurnButton', '#adjustControls', '#customLifeButton',
      '#sourcePanel', '.commander-tax-quick', '#modeNav'];
    const seats = [...document.querySelectorAll('#podStrip .pod-seat, #sideSeats .pod-seat')].map(node => {
      const r = rect(node);
      const hit = r && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { id: node.dataset.player || node.dataset.seatId || node.getAttribute('aria-label'),
        rect: r, hit: !!hit && (hit === node || node.contains(hit)), side: !!node.closest('#sideSeats') };
    });
    const face = rect(document.querySelector('.dial-face'));
    return { outer: Object.fromEntries(fixed.map(s => [s, rect(document.querySelector(s))])), seats,
      header: rect(document.querySelector('.brand-bar')),
      face, readout: rect(document.querySelector('.counter-readout')),
      ringCenter: face && { x: face.x + face.width / 2, y: face.y + face.height / 2 },
      modeTitle: rect(document.querySelector('#modeTitle')),
      style: document.querySelector('#gameView').dataset.interfaceStyle,
      value: document.querySelector('#mainValue').value,
      fontSize: parseFloat(getComputedStyle(document.querySelector('#mainValue')).fontSize),
      scrollY, viewport: { width: innerWidth, height: innerHeight } };
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
  for (const [name, box] of text) if (box && (box.x < -1 || box.right > layout.viewport.width + 1))
    issues.push(`${name} outside horizontal viewport`);
  return issues;
}
