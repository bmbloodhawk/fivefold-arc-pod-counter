import assert from 'node:assert/strict';

export async function createDialTable(browser, base, count, viewport = { width: 390, height: 844 }, format = 'commander') {
  assert.equal(new URL(base).hostname, '127.0.0.1', 'only disposable loopback tables');
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const streams = [];
  try {
    await page.goto(base);
    await page.locator('#createPodButton').click();
    await page.locator(`input[name="gameFormat"][value="${format}"]`).check();
    if (format === 'custom') await page.locator('#customStartingLife').fill('30');
    await page.locator('#createStepOneNext').click();
    await page.getByRole('radio', { name: String(count), exact: true }).check();
    await page.locator('#createStepTwoNext').click();
    await page.locator('#createName').fill('Dial Review');
    await page.locator('#createStepThreeNext').click();
    if (await page.locator('#createStepFourSkip').isVisible()) await page.locator('#createStepFourSkip').click();
    await page.getByRole('button', { name: 'Create table', exact: true }).click();
    await page.locator('#lobbyView').waitFor({ state: 'visible' });
    const code = (await page.locator('#lobbyInviteCode').textContent()).trim();
    for (let seatId = 1; seatId < count; seatId++) {
      const connection = await fetch(`${base}/api/connections`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(response => response.json());
      const claim = await fetch(`${base}/api/rooms/${code}/claim`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-connection-id': connection.connectionId },
        body: JSON.stringify({ seatId, commanderCount: seatId % 2 ? 2 : 1, name: `Player ${seatId + 1}` }),
      });
      assert.equal(claim.ok, true, await claim.text());
      const abort = new AbortController();
      const response = await fetch(`${base}/api/rooms/${code}/events?connectionId=${connection.connectionId}`, { signal: abort.signal });
      assert.equal(response.ok, true, 'local guest stream is connected');
      streams.push({ abort, response });
    }
    await page.locator('#startGameButton').click();
    await page.locator('#gameView').waitFor({ state: 'visible' });
    await page.locator('#syncBanner').waitFor({ state: 'hidden' });
    await settleDial(page);
    return { page, context, errors, close: async () => { streams.forEach(stream => stream.abort.abort()); await context.close(); } };
  } catch (error) {
    streams.forEach(stream => stream.abort.abort());
    await context.close();
    throw error;
  }
}

export async function settleDial(page) {
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.waitForFunction(() => parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue('--app-viewport-height')) === Math.round(visualViewport?.height || innerHeight));
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.querySelector('#gameView').getAnimations({ subtree: true })
      .filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
      .map(animation => animation.finished.catch(() => {})));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

export const dialSizes = [
  { width: 320, height: 568 }, { width: 360, height: 640 },
  { width: 390, height: 844 }, { width: 430, height: 932 },
  { width: 768, height: 1024 }, { width: 1280, height: 900 },
  { width: 740, height: 360 },
];

export async function checkDialSizes(page, count, sizes = dialSizes) {
  const cases = [];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await settleDial(page);
    for (const mode of ['life', 'commander', 'radiation', 'poison', 'energy', 'generic']) {
      await page.locator(`#modeNav [data-mode="${mode}"]`).click();
      await page.evaluate(() => scrollTo(0, 0));
      await settleDial(page);
      const layout = await readDialLayout(page);
      assertDialLayout(layout);
      cases.push({ count, size, mode, scroll: layout.pageHeight > size.height + 1, layout });
    }
  }
  return cases;
}

export async function checkDialInput(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await settleDial(page);
  for (const mode of ['life', 'commander', 'radiation', 'poison', 'energy', 'generic']) {
    await page.locator(`#modeNav [data-mode="${mode}"]`).click();
    const before = Number(await page.locator('#mainValue').textContent());
    await page.getByRole('button', { name: 'Increase counter by one', exact: true }).tap();
    await page.waitForFunction(value => document.querySelector('#mainValue').value === String(value), before + 1);
    await settleDial(page);
    assertDialLayout(await readDialLayout(page));
    await page.getByRole('button', { name: 'Decrease counter by one', exact: true }).click();
    await page.waitForFunction(value => document.querySelector('#mainValue').value === String(value), before);
  }
  const before = Number(await page.locator('#mainValue').textContent());
  await page.locator('#dialGesture').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(value => document.querySelector('#mainValue').value === String(value), before + 1);
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(value => document.querySelector('#mainValue').value === String(value), before);
  await page.locator('#dialGesture').scrollIntoViewIfNeeded();
  const dial = await page.locator('#dialGesture').boundingBox();
  const centerX = dial.x + dial.width / 2, centerY = dial.y + dial.height / 2, radius = dial.width * .3;
  await page.mouse.move(centerX, centerY - radius);
  await page.mouse.down();
  await page.mouse.move(centerX + Math.sin(Math.PI / 6) * radius, centerY - Math.cos(Math.PI / 6) * radius, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(value => document.querySelector('#mainValue').value === String(value), before + 1);
  assert.equal(await page.locator('body').evaluate(element => element.classList.contains('dial-dragging')), false);
  return { modes: 6, touchAndMouse: true, keyboard: true, drag: true };
}

export async function checkDialWarning(page) {
  await page.setViewportSize({ width: 320, height: 568 });
  await settleDial(page);
  await page.locator('#modeNav [data-mode="commander"]').click();
  const sourceButton = page.locator('#changeCommanderSourceButton');
  if (await sourceButton.count()) await sourceButton.click();
  else await page.locator('#sourcePanel [aria-pressed="true"]').click();
  await page.locator('#commanderSourceDialog [data-source-choice="seat-1-commander-b"]').click();
  const before = Number(await page.locator('#mainValue').textContent());
  for (let value = before + 1; value <= 18; value++) {
    await page.getByRole('button', { name: 'Increase counter by one', exact: true }).tap();
    await page.waitForFunction(expected => document.querySelector('#mainValue').value === String(expected), value);
  }
  await page.locator('#lifeChangeIndicator').waitFor({ state: 'hidden' });
  await page.locator('#statusMessage').waitFor({ state: 'visible' });
  await settleDial(page);
  const settled = await readDialLayout(page);
  assertDialLayout(settled);
  // Display stress only: no invented card is sent to the game or a service.
  await page.locator('#statusMessage span').first().evaluate(element => {
    element.textContent = 'Asmoranomardicadaistinaculdacar, the Longest Commander Name';
  });
  assertDialLayout(await readDialLayout(page));
  await page.locator('#modeNav [data-mode="commander"]').click();
  return { settled, longText: true };
}

export async function checkDialReadoutTotals(page, totals = [-5, 0, 9, 40, 999, 1234]) {
  const cases = [];
  for (const total of totals) {
    // Display-only stress. The next real render restores authoritative state.
    // Resize the assembly to exercise the real layout observer after changing
    // the displayed text; no counters, ownership or storage are mutated.
    await page.evaluate(async number => {
      const assembly = document.querySelector('.dial-assembly');
      document.querySelector('#mainValue').value = String(number);
      const height = assembly.style.height;
      assembly.style.height = `${assembly.getBoundingClientRect().height - 1}px`;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      assembly.style.height = height;
    }, total);
    await settleDial(page);
    const layout = await readDialLayout(page);
    assertDialLayout(layout);
    cases.push({ total, layout });
  }
  return cases;
}

// Browser checks use a disposable loopback table. They never read stored credentials.
export async function readDialLayout(page) {
  return page.evaluate(() => {
    const visible = element => element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
    const box = element => {
      if (!visible(element)) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height, right: x + width, bottom: y + height };
    };
    const selectors = ['.game-topline', '#podStrip', '#turnBanner', '#inspectionNotice',
      '.counter-stage', '.dial-assembly', '.counter-sigil', '.lethal-mark', '#eliminationOutcome', '#mainValue', '.counter-mode',
      '#counterContext', '#lifeChangeIndicator', '#statusMessage', '#turnActions',
      '#endTurnButton', '#undoTurnButton', '#sideSeats', '#sourcePanel',
      '.commander-tax-quick', '#modeNav', '.dial-step-minus', '.dial-step-plus', '.dial-gesture'];
    const assembly = document.querySelector('.dial-assembly');
    const face = getComputedStyle(assembly.querySelector('.dial-face'), '::after');
    const matrix = new DOMMatrix(face.transform === 'none' ? undefined : face.transform);
    const borderWidth = face.boxSizing === 'border-box' ? 0 : parseFloat(face.borderLeftWidth) + parseFloat(face.borderRightWidth);
    const borderHeight = face.boxSizing === 'border-box' ? 0 : parseFloat(face.borderTopWidth) + parseFloat(face.borderBottomWidth);
    const assemblyBox = box(assembly);
    const ringCenter = assemblyBox && {
      x: assemblyBox.x + parseFloat(face.left) + (parseFloat(face.width) + borderWidth) / 2 + matrix.e,
      y: assemblyBox.y + parseFloat(face.top) + (parseFloat(face.height) + borderHeight) / 2 + matrix.f,
    };
    const value = document.querySelector('#mainValue');
    let ink = null;
    if (visible(value)) {
      const style = getComputedStyle(value);
      const canvas = document.createElement('canvas').getContext('2d');
      canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      canvas.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
      const metrics = canvas.measureText(value.value);
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0;line-height:0;vertical-align:baseline';
      const rect = value.getBoundingClientRect();
      const scale = rect.height / parseFloat(style.height);
      const originalHeight = value.style.height;
      value.style.height = style.height;
      value.append(probe);
      const x = rect.x + rect.width / 2 + (metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft - metrics.width) * scale / 2;
      const baseline = probe.getBoundingClientRect().top;
      probe.remove();
      value.style.height = originalHeight;
      const y = baseline + (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) * scale / 2;
      const width = (metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight) * scale;
      const height = (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) * scale;
      ink = { x: x - width / 2, y: y - height / 2, width, height, right: x + width / 2, bottom: y + height / 2 };
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      mode: document.querySelector('#gameView').dataset.counterMode,
      boxes: Object.fromEntries(selectors.map(selector => [selector, box(document.querySelector(selector))])),
      ink, ringCenter,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      pageHeight: document.documentElement.scrollHeight,
    };
  });
}

const overlaps = (a, b) => a && b && Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1
  && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;

export function assertDialLayout(layout) {
  const boxes = layout.boxes;
  for (const selector of ['#turnActions', '#sideSeats', '#sourcePanel', '.commander-tax-quick', '#modeNav', '#podStrip', '#turnBanner']) {
    assert.ok(!overlaps(boxes['#mainValue'], boxes[selector]), `counter overlaps ${selector}`);
  }
  assert.equal(layout.horizontalOverflow, false, 'no horizontal scrolling');
  for (const selector of ['.dial-step-minus', '.dial-step-plus']) {
    const target = boxes[selector];
    if (target) assert.ok(target.width >= 44 && target.height >= 44, `${selector} keeps a 44px touch target`);
  }
  const assembly = boxes['.dial-assembly'];
  assert.ok(assembly && assembly.width >= 128, 'readable dial minimum');
  const center = { x: assembly.x + assembly.width / 2, y: assembly.y + assembly.height / 2 };
  const near = (actual, expected, name) => assert.ok(Math.abs(actual - expected) < .35, `${name}: ${actual} vs ${expected}`);
  near(layout.ringCenter.x, center.x, 'ring x');
  near(layout.ringCenter.y, center.y, 'ring y');
  for (const selector of ['.counter-sigil', '.dial-gesture', '.lethal-mark']) {
    const part = boxes[selector];
    if (part) {
      near(part.x + part.width / 2, center.x, `${selector} x`);
      near(part.y + part.height / 2, center.y, `${selector} y`);
    }
  }
  for (const [selector, fraction] of [['.counter-mode', .22], ['#counterContext', .77]]) {
    const label = boxes[selector];
    near(label.x + label.width / 2, center.x, `${selector} x`);
    near(label.y + label.height / 2, assembly.y + assembly.height * fraction, `${selector} y`);
    assert.ok(!overlaps(layout.ink, label), `visible number overlaps ${selector}`);
  }
  if (layout.ink) {
    near(layout.ink.x + layout.ink.width / 2, center.x, 'visible number x');
    near(layout.ink.y + layout.ink.height / 2, assembly.y + assembly.height * .478, 'visible number y');
  }
  if (boxes['#eliminationOutcome']) {
    const outcome = boxes['#eliminationOutcome'];
    near(outcome.x + outcome.width / 2, center.x, 'elimination outcome x');
    near(outcome.y + outcome.height / 2, assembly.y + assembly.height * .478, 'elimination outcome y');
    assert.ok(!overlaps(outcome, boxes['.counter-mode']), 'elimination outcome clears mode label');
    assert.ok(!overlaps(outcome, boxes['#counterContext']), 'elimination outcome clears context');
  }
  for (const selector of ['#lifeChangeIndicator', '#statusMessage']) {
    const message = boxes[selector];
    if (!message) continue;
    assert.ok(!overlaps(message, boxes['#turnActions']), `${selector} overlaps turn controls`);
    assert.ok(!overlaps(message, boxes['#counterContext']), `${selector} overlaps player context`);
  }
}
