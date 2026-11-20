import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRealtimeServer } from '../server/src/app.js';
import { createDialTable, settleDial } from './dial-layout.browser.mjs';
import { buttonModes, buttonSizes, chooseInterface, readButtonLayout,
  compareButtonOuter, buttonReadabilityIssues } from './button-layout.browser.mjs';

// Owns a disposable loopback server and fresh profiles; no remote-target option.
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = resolve(process.env.BUTTON_QA_OUTPUT || `${tmpdir()}/fivefold-arc-button-qa`);
const counts = process.env.BUTTON_QA_PLAYERS
  ? process.env.BUTTON_QA_PLAYERS.split(',').map(Number) : [2, 3, 4, 5, 6, 7, 8];
assert.ok(counts.length && counts.every(n => Number.isInteger(n) && n >= 2 && n <= 8));
const before = process.env.BUTTON_QA_BASELINE
  ? JSON.parse(await readFile(process.env.BUTTON_QA_BASELINE, 'utf8')) : null;
await mkdir(output, { recursive: true });
const { server, service } = createRealtimeServer({
  staticDir: fileURLToPath(new URL('../client/', import.meta.url)), appEnv: 'local',
  durableRecoveryEnabled: false, feedbackPortalKey: '', accountHistory: null, accountVerifier: null,
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const report = { cases: [], errors: [], baselineCompared: !!before, pass: false };
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.BUTTON_BROWSER_EXECUTABLE ? { executablePath: process.env.BUTTON_BROWSER_EXECUTABLE } : {}) });
  for (const count of counts) {
    const fixture = await createDialTable(browser, base, count);
    try {
      const { page } = fixture;
      await chooseInterface(page, 'button');
      for (const size of buttonSizes) {
        await page.setViewportSize(size);
        for (const mode of buttonModes) {
          await page.locator(`#modeNav [data-mode="${mode}"]`).click();
          await page.evaluate(() => scrollTo(0, 0));
          await settleDial(page);
          const initial = await readButtonLayout(page);
          const initialIssues = buttonReadabilityIssues(initial);
          if (before) {
            const reference = before.find(row => row.count === count && row.mode === mode
              && row.size.width === size.width && row.size.height === size.height);
            assert.ok(reference, `missing baseline: ${count}/${size.width}/${mode}`);
            assert.deepEqual(compareButtonOuter(reference.layout, initial), [], 'approved outer positions unchanged');
          }
          let viewed = initial;
          if (initialIssues.length) {
            // Existing Button views scroll; do not count covered initial content
            // as a viewport-fit pass. Verify the counter after the required scroll.
            assert.ok(initial.pageHeight > size.height && initialIssues.every(issue => issue.includes('#modeNav')),
              initialIssues.join('; '));
            await page.evaluate(() => {
              const stage = document.querySelector('.counter-stage').getBoundingClientRect();
              scrollTo(0, scrollY + stage.top - 8);
            });
            await settleDial(page);
            viewed = await readButtonLayout(page);
          }
          assert.deepEqual(buttonReadabilityIssues(viewed), [], 'viewed text clears cards, controls and other text');
          const { ink, readout, face } = viewed;
          const near = (a, b) => assert.ok(Math.abs(a - b) < .6, `${a} vs ${b}`);
          near(ink.x + ink.width / 2, readout.x + readout.width / 2);
          near(ink.y + ink.height / 2, readout.y + readout.height * .478);
          near(readout.x + readout.width / 2, face.x + face.width / 2);
          near(readout.y + readout.height / 2, face.y + face.height / 2);
          for (const box of await page.locator('#adjustControls button').evaluateAll(nodes =>
            nodes.map(node => { const r = node.getBoundingClientRect(); return { width: r.width, height: r.height }; })))
            assert.ok(box.width >= 44 && box.height >= 44, 'Button touch targets remain at least 44px');
          report.cases.push({ count, size, mode, initialIssues, requiredScroll: !!initialIssues.length,
            initial, viewed });
          if (mode === 'life') await page.screenshot({ path: resolve(output,
            `button-${count}-${size.width}x${size.height}${initialIssues.length ? '-scrolled' : ''}.png`), scale: 'css' });
        }
      }
      report.errors.push(...fixture.errors);
      console.log(`${count} players: ${buttonSizes.length * buttonModes.length} Button size/mode cases passed`);
    } finally { await fixture.close(); }
  }
  assert.deepEqual(report.errors, []);
  report.pass = true;
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  for (const connection of service.connections.values()) service.closeStreams(connection, 'button_qa_finished');
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
