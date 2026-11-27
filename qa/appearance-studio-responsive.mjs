// Read-only reflow and keyboard checks against the disposable loopback Studio.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const origin = new URL(process.argv[2] || 'http://127.0.0.1:8788/review');
assert.equal(origin.hostname, '127.0.0.1');
const require = createRequire(process.env.PLAYWRIGHT_TOOLING || new URL('./package.json', import.meta.url));
const playwright = require('playwright-core');
const engine = process.env.STUDIO_BROWSER || 'chromium';
const directory = resolve(process.env.STUDIO_REPORT_DIR || resolve(tmpdir(), 'appearance-studio-responsive-20261123', engine));
await mkdir(directory, { recursive: true });
const browser = await playwright[engine].launch(engine === 'chromium' ? { executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true } : { headless: true });
const sizes = [{ name: 'phone-320', width: 320, height: 700 }, { name: 'phone-393', width: 393, height: 852 }, { name: 'tablet-768', width: 768, height: 1024 }, { name: 'zoom-200-equivalent', width: 640, height: 450, deviceScaleFactor: 2 }, { name: 'laptop-1366', width: 1366, height: 768 }];
const results = [], failures = [], errors = [], writes = [];
try {
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.deviceScaleFactor || 1 });
    page.on('pageerror', error => errors.push({ size: size.name, error: error.message }));
    page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push({ method: request.method(), url: new URL(request.url()).pathname }); });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort());
    await page.goto(origin.href);
    await page.waitForSelector('body.studio-workspace');
    await page.waitForSelector('[data-skin="ember-library"]', { state: 'attached' });
    const measurement = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, inspectorTop: document.querySelector('#inspectorTitle').getBoundingClientRect().top, libraryVisible: !!document.querySelector('.library-panel').getClientRects().length, compactVisible: !!document.querySelector('#compactSection')?.getClientRects().length }));
    if (measurement.documentWidth > size.width) failures.push(`${size.name}: initial horizontal overflow ${measurement.documentWidth}`);
    if (size.width < 900 && (!measurement.compactVisible || measurement.libraryVisible || measurement.inspectorTop >= size.height - 80)) failures.push(`${size.name}: editor must be reachable without scrolling through library`);
    const sections = ['foundation', 'typography', 'components', 'layout', 'artwork', 'symbols', 'assets', 'history', 'review'];
    const sectionWidths = {};
    for (const section of sections) {
      if (measurement.compactVisible) await page.locator('#compactSection').selectOption(section);
      else await page.locator(`#studioNavigation [aria-controls="edit-${section}"]`).click();
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      sectionWidths[section] = width;
      if (width > size.width) failures.push(`${size.name}/${section}: horizontal overflow ${width}`);
    }
    if (measurement.compactVisible) {
      await page.locator('#compactSection').focus();
      await page.locator('#compactSection').selectOption('foundation');
      assert.equal(await page.locator('#compactSection').evaluate(node => node === document.activeElement), true);
      await page.locator('#compactEditorLink').focus(); await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'inspectorTitle');
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => document.querySelector('#studioInspector').contains(document.activeElement)), 'Tab after skipping reaches the visible inspector.');
      await page.locator('#compactLibraryButton').focus(); await page.keyboard.press('Space');
      assert.equal(await page.locator('#compactLibraryButton').getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('.library-panel').isVisible(), true);
      const openWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      if (openWidth > size.width) failures.push(`${size.name}/open-library: horizontal overflow ${openWidth}`);
      await page.locator('#compactLibraryButton').press('Space');
      assert.equal(await page.locator('.library-panel').isVisible(), false);
      await page.locator('#compactPreviewLink').focus(); await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'studioPreviewTitle');
      await page.locator('#compactEditorLink').click();
    } else {
      await page.locator('#studioNavigation [aria-controls="edit-foundation"]').focus(); await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'inspectorTitle');
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: resolve(directory, size.name + '.png'), fullPage: false });
    if (measurement.compactVisible) {
      await page.locator('#compactSection').focus();
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.waitForFunction(() => document.querySelector('#compactSection').closest('nav').hidden);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'inspectorTitle', 'Widening must not leave focus in the hidden compact toolbar.');
    }
    results.push({ ...size, ...measurement, sectionWidths });
    await page.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  const report = { passed: failures.length === 0, engine, results, failures, errors, writes, limits: ['Viewport and keyboard automation; no physical phone or assistive-technology user certification.', '200% equivalent uses a 640×450 CSS-pixel viewport at 2× display scale, equivalent to reflow of a 1280×900 window.'] };
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, engine, results, failures, report: resolve(directory, 'report.json') }));
  assert.deepEqual(failures, []);
} finally { await browser.close(); }
