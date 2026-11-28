// Actual renderer, disposable loopback server, no catalog writes or credentials.
// PLAYWRIGHT_TOOLING points to package.json beside playwright-core.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRealtimeServer } from '../server/src/app.js';

const require = createRequire(process.env.PLAYWRIGHT_TOOLING || new URL('./package.json', import.meta.url));
const { chromium } = require('playwright-core');
const { server } = createRealtimeServer({
  staticDir: fileURLToPath(new URL('../client/', import.meta.url)), appEnv: 'test',
  durableRecoveryEnabled: false, autoRecoverRooms: false,
  fetchImpl: async () => { throw new Error('No external connections in this regression.'); },
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
const targets = [
  { name: 'End Turn', selector: '#endTurnButton', state: 'turn' },
  { name: 'life step', selector: '.adjust-controls button', state: 'turn', buttonOnly: true },
  { name: 'custom life', selector: '#customLifeButton', state: 'turn', buttonOnly: true },
  { name: 'commander tax', selector: '#commanderTaxQuickButton', state: 'turn' },
  { name: 'navigation', selector: '#modeNav button:not(.active)', state: 'turn' },
  { name: 'game menu', selector: '#gameMenu button:not(:disabled)', state: 'menu' },
  { name: 'dialog input', selector: '#customLifeAmount', state: 'dialog' },
];
const materialSurfaces = ['playerCards', 'primaryActions', 'lifeControls', 'commanderTools', 'navigation', 'gameMenu', 'dialogs', 'inputs'];
const base = { id: 'material-focus-fixture', name: 'Material focus fixture', rendererVersion: 2, previewReadOnly: true, useGameBase: true };
const failures = [], errors = [], writes = [];
const reportDirectory = process.env.STUDIO_REPORT_DIR && resolve(process.env.STUDIO_REPORT_DIR);
if (reportDirectory) await mkdir(reportDirectory, { recursive: true });
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, serviceWorkers: 'block' });
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.method() + ' ' + new URL(request.url()).pathname); });
  await page.goto(origin + '/index.html?appearance-preview=1');
  await page.waitForSelector('#gameView .pod-seat');
  async function show(layout, state, shadow, id = base.id) {
    const surfaces = shadow ? Object.fromEntries(materialSurfaces.map(name => [name, { shadow }])) : undefined;
    await page.evaluate(skin => window.postMessage({ type: 'fivefold-arc:appearance-skin', skin }, location.origin), {
      ...base, id, interfaceStyle: layout, previewState: state, previewMode: 'life', previewPlayers: 4,
      ...(surfaces ? { surfaceDesign: { surfaces } } : {}),
    });
    await page.waitForFunction(({ state, layout }) => document.documentElement.dataset.previewFixture === state && document.querySelector('#gameView').dataset.interfaceStyle === layout, { state, layout });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      // Studio samples are intentionally inert. Permit focus in this disposable
      // test document to inspect the shared production CSS; never activate a command.
      document.querySelectorAll('[inert]').forEach(node => { node.inert = false; });
    });
  }
  async function appearance(target, focus) {
    const node = page.locator(target.selector).first();
    if (focus) await node.focus();
    else await node.evaluate(node => node.blur());
    return node.evaluate(async node => {
      getComputedStyle(node).boxShadow;
      await Promise.all(node.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
      const css = getComputedStyle(node);
      return { focused: node.matches(':focus-visible'), shadow: css.boxShadow, outline: css.outline, color: css.color, opacity: css.opacity, disabled: node.disabled };
    });
  }
  for (const layout of ['button', 'dial']) {
    const applicable = targets.filter(target => !target.buttonOnly || layout === 'button');
    const native = new Map(), defaultReference = new Map();
    for (const target of applicable) {
      await show(layout, target.state, undefined, '__neutral_arc__');
      defaultReference.set(target.name, await appearance(target, true));
      await show(layout, target.state);
      const focused = await appearance(target, true);
      assert.equal(focused.focused, true, `${layout} native ${target.name} receives keyboard focus`);
      assert.notEqual(focused.shadow, 'none', `${layout} native ${target.name} has its existing focus ring`);
      native.set(target.name, focused);
    }
    for (const shadow of ['none', 'soft', 'lifted', 'inset', 'glow']) {
      for (const target of applicable) {
        await show(layout, target.state, shadow);
        const focused = await appearance(target, true), expected = native.get(target.name);
        if (!focused.focused || focused.shadow !== expected.shadow || focused.outline !== expected.outline) failures.push({ layout, shadow, target: target.name, expected, actual: focused });
        if (reportDirectory && layout === 'button' && shadow === 'none' && target.name === 'End Turn') await page.screenshot({ path: join(reportDirectory, 'material-none-keyboard-focus.png'), scale: 'css' });
        checks++;
      }
    }
    // Resetting surface overrides must restore the same native projection.
    for (const target of applicable) {
      await show(layout, target.state);
      assert.deepEqual(await appearance(target, true), native.get(target.name), `${layout} ${target.name} restores its native focus and state`);
      checks++;
      await show(layout, target.state, undefined, '__neutral_arc__');
      assert.deepEqual(await appearance(target, true), defaultReference.get(target.name), `${layout} ${target.name} restores the built-in game default`);
      checks++;
    }
    const disabledState = () => page.locator('#endTurnButton').evaluate(node => { node.disabled = true; node.focus(); const css = getComputedStyle(node); return { disabled: node.disabled, focused: node.matches(':focus-visible'), color: css.color, opacity: css.opacity }; });
    await show(layout, 'turn'); const nativeDisabled = await disabledState();
    await show(layout, 'turn', 'none'); const disabled = await disabledState();
    assert.equal(disabled.disabled, true); assert.equal(disabled.focused, false); assert.deepEqual(disabled, nativeDisabled, 'A material shadow must preserve native disabled feedback');
    checks++;
  }
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  console.log(JSON.stringify({ checks, failureCount: failures.length, failures: failures.slice(0, 8), errors, writes }, null, 2));
  assert.equal(failures.length, 0, 'Author material shadows must not replace the existing keyboard focus ring.');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
