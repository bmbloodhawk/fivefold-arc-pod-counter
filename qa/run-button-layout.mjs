import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRealtimeServer } from '../server/src/app.js';
import { settleDial } from './dial-layout.browser.mjs';
import { buttonModes, buttonSizes, chooseInterface, readButtonLayout,
  compareButtonOuter, buttonPortraitIssues } from './button-layout.browser.mjs';

// Owns a disposable loopback server and fresh profiles; no remote-target option.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(process.env.BUTTON_QA_OUTPUT || `${tmpdir()}/fivefold-arc-button-qa`);
const counts = process.env.BUTTON_QA_PLAYERS
  ? process.env.BUTTON_QA_PLAYERS.split(',').map(Number) : [2, 3, 4, 5, 6, 7, 8];
assert.ok(counts.length && counts.every(n => Number.isInteger(n) && n >= 2 && n <= 8));
const sizes = process.env.BUTTON_QA_SIZES ? process.env.BUTTON_QA_SIZES.split(',').map(value => {
  const match = /^(\d+)x(\d+)$/.exec(value.trim());
  assert.ok(match, `invalid portrait viewport: ${value}`);
  return { width: Number(match[1]), height: Number(match[2]) };
}) : buttonSizes;
assert.ok(sizes.length && sizes.every(size => size.width >= 320 && size.height > size.width), 'portrait fixtures only');
const modes = process.env.BUTTON_QA_MODES ? process.env.BUTTON_QA_MODES.split(',').map(value => value.trim()) : buttonModes;
assert.ok(modes.length && modes.every(mode => buttonModes.includes(mode)), 'known counter modes only');
const before = process.env.BUTTON_QA_BASELINE
  ? JSON.parse(await readFile(process.env.BUTTON_QA_BASELINE, 'utf8')) : null;
const baselineCases = before && (Array.isArray(before) ? before : before.cases);
if (before) assert.ok(Array.isArray(baselineCases), 'baseline contains case rows');
await mkdir(output, { recursive: true });
const { server, service } = createRealtimeServer({
  staticDir: fileURLToPath(new URL('../client/', import.meta.url)), appEnv: 'local',
  durableRecoveryEnabled: false, feedbackPortalKey: '', accountHistory: null, accountVerifier: null,
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
// Connected setup reserves eight seats; the claimed roster supplies the case
// size. Keep this current-flow fixture local to the Button runner.
async function createButtonTable(browser, count, viewport) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [], streams = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base);
    await page.locator('#createPodButton').click();
    await page.locator('input[name="gameFormat"][value="commander"]').check();
    await page.locator('#createStepOneNext').click();
    await page.locator('#createName').fill('Dial Review');
    await page.locator('#createStepTwoNext').click();
    await page.locator('#createStepThreeSkip').click();
    await page.getByRole('button', { name: 'Create table', exact: true }).click();
    await page.locator('#lobbyView').waitFor({ state: 'visible' });
    const code = (await page.locator('#lobbyInviteCode').textContent()).trim();
    for (let seatId = 1; seatId < count; seatId++) {
      const connection = await fetch(`${base}/api/connections`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(response => response.json());
      const claim = await fetch(`${base}/api/rooms/${code}/claim`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-connection-id': connection.connectionId },
        body: JSON.stringify({ seatId, commanderCount: seatId % 2 ? 2 : 1, name: `Player ${seatId + 1}` }) });
      assert.ok(claim.ok, await claim.text());
      const abort = new AbortController();
      streams.push(abort);
      const response = await fetch(`${base}/api/rooms/${code}/events?connectionId=${connection.connectionId}`, { signal: abort.signal });
      assert.ok(response.ok, 'local guest stream connected');
    }
    await page.locator('#startGameButton').click();
    await page.locator('#gameView').waitFor({ state: 'visible' });
    await page.locator('#syncBanner').waitFor({ state: 'hidden' });
    await settleDial(page);
    return { page, errors, close: async () => { streams.forEach(stream => stream.abort()); await context.close(); } };
  } catch (error) {
    streams.forEach(stream => stream.abort());
    await context.close();
    throw error;
  }
}
const report = { scope: 'Initial portrait viewport; disposable loopback tables only', counts, sizes, modes,
  authFixture: 'Signed-out provider stub; account behavior is outside this layout check',
  cases: [], errors: [], baselineCompared: !!before, pass: false };
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.BUTTON_BROWSER_EXECUTABLE ? { executablePath: process.env.BUTTON_BROWSER_EXECUTABLE } : {}) });
  const fixtureBrowser = { newContext: async options => {
    const context = await browser.newContext(options);
    await context.route(`${base}/account-auth.js*`, route => route.fulfill({ contentType: 'text/javascript',
      body: 'export const currentAccountToken=async()=>null,restoredAccountToken=async()=>null,googleAccountToken=async()=>null,emailAccountToken=async()=>null,sendAccountPasswordReset=async()=>{},signOutAccount=async()=>{},validateAccountPassword=async()=>({isValid:true});' }));
    return context;
  } };
  for (const count of counts) {
    for (const size of sizes) {
      const fixture = await createButtonTable(fixtureBrowser, count, size);
      try {
        const { page } = fixture;
        await chooseInterface(page, 'button');
        for (const mode of modes) {
          await page.locator(`#modeNav [data-mode="${mode}"]`).click();
          await page.evaluate(() => scrollTo(0, 0));
          await settleDial(page);
          const initial = await readButtonLayout(page);
          const initialIssues = buttonPortraitIssues(initial);
          report.cases.push({ count, size, mode, initialIssues, requiredScroll: false, initial, viewed: initial });
          assert.equal(initial.mode, mode, 'requested counter tab rendered');
          assert.equal(initial.seats.length, count, 'every claimed player card rendered');
          if (before) {
            const reference = baselineCases.find(row => row.count === count && row.mode === mode
              && row.size.width === size.width && row.size.height === size.height);
            assert.ok(reference, `missing baseline: ${count}/${size.width}/${mode}`);
            assert.deepEqual(compareButtonOuter(reference.layout || reference.initial || reference.viewed, initial), [], 'approved outer positions unchanged');
          }
          assert.deepEqual(initialIssues, [], 'initial portrait view fits with readable text and reachable controls');
          const { ink, readout, face } = initial;
          const near = (a, b) => assert.ok(Math.abs(a - b) < .6, `${a} vs ${b}`);
          near(ink.x + ink.width / 2, face.x + face.width / 2);
          near(ink.y + ink.height / 2, face.y + face.height / 2);
          assert.ok(readout.y >= face.y - 1 && readout.bottom <= face.bottom + 1,
            'readout stays in artwork while reserving space above End Turn');
          for (const box of await page.locator('#adjustControls button').evaluateAll(nodes =>
            nodes.map(node => { const r = node.getBoundingClientRect(); return { width: r.width, height: r.height }; })))
            assert.ok(box.width >= 44 && box.height >= 44, 'Button touch targets remain at least 44px');
          if (mode === 'life') await page.screenshot({ path: resolve(output,
            `button-${count}-${size.width}x${size.height}.png`), scale: 'css' });
        }
        report.errors.push(...fixture.errors);
        console.log(`${count} players ${size.width}x${size.height}: ${modes.length} portrait cases passed`);
      } finally { await fixture.close(); }
    }
  }
  assert.deepEqual(report.errors, []);
  report.pass = true;
} catch (error) {
  report.failure = error.message;
  throw error;
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  for (const connection of service.connections.values()) service.closeStreams(connection, 'button_qa_finished');
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
