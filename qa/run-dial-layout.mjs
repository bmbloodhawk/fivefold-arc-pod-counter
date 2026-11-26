import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRealtimeServer } from '../server/src/app.js';
import { assertDialLayout, checkDialInput, checkDialReadoutTotals, checkDialSizes,
  checkDialWarning, createDialTable, readDialLayout, settleDial, stepDial } from './dial-layout.browser.mjs';

// Always owns its loopback server and fresh browser contexts. There is no
// remote-target option, saved browser profile or production account access.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(process.env.DIAL_QA_OUTPUT || `${tmpdir()}/fivefold-arc-dial-qa`);
await mkdir(output, { recursive: true });
const { server, service } = createRealtimeServer({
  staticDir: fileURLToPath(new URL('../client/', import.meta.url)), appEnv: 'local',
  durableRecoveryEnabled: false, feedbackPortalKey: '', accountHistory: null, accountVerifier: null,
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const report = { sizes: [], input: null, warning: null, elimination: null, numeric: [], skinFonts: [], errors: [] };
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.DIAL_BROWSER_EXECUTABLE ? { executablePath: process.env.DIAL_BROWSER_EXECUTABLE } : {}) });
  for (let count = 2; count <= 8; count++) {
    const fixture = await createDialTable(browser, base, count);
    try {
      report.sizes.push(...await checkDialSizes(fixture.page, count));
      if (count === 2) {
        report.input = await checkDialInput(fixture.page);
        await fixture.page.locator('#modeNav [data-mode="life"]').click();
        assert.equal(await fixture.page.locator('[data-mode="radiation"] small').textContent(), 'Rad');
        assert.equal(await fixture.page.getByRole('button', { name: 'Radiation', exact: true }).count(), 1);
        for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
          await fixture.page.setViewportSize(size);
          await fixture.page.evaluate(() => scrollTo(0, 0));
          await settleDial(fixture.page);
          assertDialLayout(await readDialLayout(fixture.page));
          await fixture.page.screenshot({ path: resolve(output, `two-player-${size.width}.png`), fullPage: true });
        }
      }
      if (count === 8) {
        report.warning = await checkDialWarning(fixture.page);
        await fixture.page.screenshot({ path: resolve(output, 'warning-320.png'), fullPage: true });
        for (let value = 19; value <= 21; value++) {
          await stepDial(fixture.page, 1);
          await fixture.page.waitForFunction(expected => document.querySelector('#mainValue').value === String(expected), value);
        }
        await fixture.page.locator('#lethalMark').waitFor({ state: 'visible' });
        await fixture.page.locator('#lethalMark img').evaluate(image => image.decode());
        await settleDial(fixture.page);
        report.elimination = await readDialLayout(fixture.page);
        assertDialLayout(report.elimination);
        await fixture.page.screenshot({ path: resolve(output, 'elimination-320.png'), fullPage: true });
      }
      report.errors.push(...fixture.errors);
      console.log(`${count} players: 42 size/mode checks passed`);
    } finally { await fixture.close(); }
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(`${base}/?appearance-preview=1`);
  const skin = { useGameBase: true, interfaceStyle: 'dial', previewPlayers: 4, background: '#080808',
    surface: '#161616', accent: '#d8ae61', secondary: '#6e552a', text: '#f4ecd9', muted: '#afa590' };
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(size);
    for (const mode of ['life', 'commander', 'radiation', 'poison', 'energy', 'generic']) {
      await page.evaluate(payload => postMessage({ type: 'fivefold-arc:appearance-skin', skin: payload }, location.origin),
        { ...skin, previewMode: mode });
      await page.waitForFunction(expected => document.querySelector('#gameView').dataset.counterMode === expected, mode);
      await settleDial(page);
      report.numeric.push(...(await checkDialReadoutTotals(page)).map(sample => ({ ...sample, size, mode })));
    }
  }
  await page.setViewportSize({ width: 320, height: 568 });
  for (const treatment of ['grid', 'inlay', 'glass', 'radial', 'weave', 'facet']) {
    await page.evaluate(async name => {
      const { applyCollectionVisual } = await import('./collection-visual.js?v=4');
      applyCollectionVisual(document.documentElement, { schemaVersion: 1, treatment: name, background: '#080808',
        surface: '#161616', accent: '#d8ae61', text: '#f4ecd9', muted: '#afa590', border: '#d8ae61' });
    }, treatment);
    await settleDial(page);
    assertDialLayout(await readDialLayout(page));
    report.skinFonts.push(...(await checkDialReadoutTotals(page)).map(sample => ({ ...sample, treatment })));
  }
  assert.deepEqual(report.errors, []);
  await context.close();
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Passed 294 size/mode cases, 108 numeric cases, 36 skin/font cases, input, settled warning and elimination checks. Report: ${output}`);
} finally {
  await browser?.close();
  for (const connection of service.connections.values()) service.closeStreams(connection, 'dial_qa_finished');
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
