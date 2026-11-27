// Compare renderer baselines against a tracked candidate without changing any
// checkout or using an existing fixture. Both loopback servers use private RAM.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRealtimeServer } from '../server/src/app.js';

const root = fileURLToPath(new URL('../', import.meta.url)), candidate = process.argv[2] || '09f402d';
assert.match(candidate, /^[A-Za-z0-9_./-]+$/, 'Use a local Git revision.');
const priorCommit = execFileSync('git', ['rev-parse', '--verify', candidate + '^{commit}'], { cwd: root, encoding: 'utf8' }).trim();
const directory = resolve(process.env.STUDIO_REPORT_DIR || resolve(tmpdir(), 'appearance-baseline-parity-20261123'));
await mkdir(directory, { recursive: true });
const snapshot = await mkdtemp(resolve(tmpdir(), 'appearance-prior-')), archive = resolve(snapshot, 'client.tar');
execFileSync('git', ['archive', '--format=tar', '--output=' + archive, priorCommit, 'client'], { cwd: root });
execFileSync('tar', ['-xf', archive, '-C', snapshot]);
const currentSnapshot = await mkdtemp(resolve(tmpdir(), 'appearance-current-'));
await cp(resolve(root, 'client'), resolve(currentSnapshot, 'client'), { recursive: true });
const sourceFiles = ['app.js', 'dial-layout.js', 'dial-layout.css', 'styles.css', 'index.html', 'renderer-bridge.js', 'renderer-theme.css', 'appearance-validation.js'];
const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(resolve(currentSnapshot, 'client', file))).digest('hex')])));

const servers = [];
async function fixture(staticDir) {
  const catalog = { schemaVersion: 1, revision: 0, skins: [], assets: [], selected: '__neutral_arc__', gameDefaultLayout: null };
  const { server } = createRealtimeServer({ staticDir, appEnv: 'test', appearanceCatalog: { read: async () => structuredClone(catalog) }, durableRecoveryEnabled: false, autoRecoverRooms: false, lookupCommanderIdentity: async () => null, fetchImpl: async () => { throw new Error('No external calls in renderer comparison.'); } });
  const normal = server.listeners('request')[0]; server.removeListener('request', normal);
  server.on('request', (req, res) => {
    if (req.url !== '/parity') return normal.call(server, req, res);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%}iframe{display:block;width:100%;height:100%;border:0}</style><iframe id="parityFrame" src="/index.html?appearance-preview=1"></iframe><script>window.parityAcks={};addEventListener("message",event=>{if(event.origin===location.origin&&event.source===document.querySelector("iframe").contentWindow&&event.data?.type==="fivefold-arc:appearance-rendered")window.parityAcks[event.data.requestId]=event.data;});</script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
  return 'http://127.0.0.1:' + server.address().port;
}
const control = process.env.STUDIO_PARITY_CONTROL === '1';
const origins = { prior: await fixture(resolve(control ? currentSnapshot : snapshot, 'client')), current: await fixture(resolve(currentSnapshot, 'client')) };
const require = createRequire(process.env.PLAYWRIGHT_TOOLING || new URL('./package.json', import.meta.url)), { chromium } = require('playwright-core');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const report = { priorCommit, currentHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), currentIncludesUncommittedWork: true, origins, cases: [], differences: [], errors: [], externalRequests: [], limitations: ['Same current in-memory server serves current working client versus tracked prior client snapshot.', 'Chromium emulation; no physical-phone or live-service claim.'] };
report.control = control;
report.freshDocumentPerCase = true;
report.sourceSha256 = sourceSha256;
report.currentSnapshotDirectory = currentSnapshot;
report.phases = ['cold', 'postResize'];
report.stability = [];
report.unsettled = [];
const modes = ['life', 'commander', 'radiation', 'poison', 'energy', 'generic'];
const palette = { background: '#1c1015', surface: '#35202b', accent: '#ffb88a', secondary: '#ae6375', text: '#fff0e6', muted: '#dec7c6', backgroundTreatment: 'grain' };
const cases = {
  native: { id: '__neutral_arc__' },
  unversioned: { id: 'prior-approved', ...palette, seatRadius: 10, lifeNumberScale: 110, symbolScale: { radiation: 110 } },
  authoredV2: { id: 'prior-expanded', rendererVersion: 2, ...palette, fontFamily: 'mono', fontWeight: 600, variants: { dial: 'engraved', navigation: 'framed', numerals: 'tabular' }, modeLayouts: { button: { seatRadius: 12, buttonRadius: 5 }, dial: { seatRadius: 6, buttonRadius: 10 } }, symbolScale: { radiation: 110 } },
};
const selectors = ['#turnBanner', '#podStrip', '.pod-seat', '.seat-name', '.seat-life', '.counter-stage', '.dial-assembly', '.counter-mode', '.counter-context', '#mainValue', '.counter-sigil', '#modeNav', '#adjustControls', '#endTurnButton', '#customLifeButton'];
const measure = selectors => {
  const box = node => { const value = node.getBoundingClientRect(); return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, value[key]])); };
  const style = node => { const value = getComputedStyle(node); return Object.fromEntries(['color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'transform', 'translate', 'scale', 'borderRadius'].map(key => [key, value[key]])); };
  return {
    elements: Object.fromEntries(selectors.map(selector => { const node = document.querySelector(selector); return [selector, { box: box(node), style: style(node) }]; })),
    nav: [...document.querySelectorAll('#modeNav [data-mode]')].map(node => { const label = node.querySelector('small'), icon = node.querySelector('svg,img,span'); return { mode: node.dataset.mode, label: label.textContent, box: box(node), labelBox: box(label), iconBox: box(icon), style: style(icon), glyph: icon.tagName.toLowerCase() === 'svg' ? [...icon.querySelectorAll('*')].map(part => [part.tagName.toLowerCase(), Object.fromEntries([...part.attributes].filter(attr => attr.name !== 'style').map(attr => [attr.name, attr.value]).sort())]) : icon.textContent }; }),
  };
};
async function settle(frame) {
  return await frame.evaluate(async selectors => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getTiming().iterations)).map(animation => animation.finished.catch(() => {})));
    let previous = '', stable = 0, count = 0;
    for (; count < 120 && (count < 12 || stable < 8); count++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const next = JSON.stringify(selectors.map(selector => { const rect = document.querySelector(selector).getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height]; }));
      stable = next === previous ? stable + 1 : 0; previous = next;
    }
    return { frames: count, stable };
  }, selectors);
}
let requestSequence = 0;
async function show(page, frame, skin) {
  await page.bringToFront();
  const requestId = 'parity-' + ++requestSequence;
  await page.evaluate(skin => document.querySelector('#parityFrame').contentWindow.postMessage({ type: 'fivefold-arc:appearance-skin', skin }, location.origin), { ...skin, previewRequestId: requestId });
  await page.waitForFunction(({ requestId, mode, players }) => { const ack = window.parityAcks[requestId]; return ack?.requestId === requestId && ack.state === 'turn' && ack.mode === mode && ack.players === players; }, { requestId, mode: skin.previewMode, players: skin.previewPlayers });
  await frame.waitForFunction(skin => {
    const root = document.documentElement, game = document.querySelector('#gameView'), native = skin.id === '__neutral_arc__';
    return root.dataset.previewFixture === 'turn' && root.dataset.previewMode === skin.previewMode && root.dataset.previewPlayers === String(skin.previewPlayers) && game.dataset.interfaceStyle === skin.interfaceStyle && (native ? !root.dataset.rendererVersion && !root.dataset.gameSkin : root.dataset.rendererVersion === String(skin.rendererVersion || 1) && root.dataset.gameSkin === skin.id);
  }, skin);
  return { requestId, ...await settle(frame) };
}
function compare(a, b, path = '') {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= .02 ? [] : [`${path}: ${a} → ${b}`];
  if (typeof a === 'string' && typeof b === 'string' && path.includes('.style.')) {
    const scalar = /-?\d*\.?\d+(?:e[+-]?\d+)?/g, left = a.match(scalar), right = b.match(scalar);
    if (left?.length && left.length === right?.length && a.replace(scalar, '#') === b.replace(scalar, '#') && left.every((value, index) => Math.abs(Number(value) - Number(right[index])) <= .02)) return [];
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => compare(a[key], b[key], path + '.' + key));
  return a === b ? [] : [`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`];
}
try {
  const pages = {};
  for (const [version, origin] of Object.entries(origins)) {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); report.externalRequests.push({ version, origin: new URL(route.request().url()).origin }); return route.abort(); });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => report.errors.push({ version, error: error.message }));
    pages[version] = page;
  }
  for (const width of [375, 393]) {
    for (const page of Object.values(pages)) await page.setViewportSize({ width, height: width === 375 ? 667 : 852 });
    for (const [name, values] of Object.entries(cases)) for (const interfaceStyle of ['button', 'dial']) for (const mode of modes) {
      const skin = { ...values, interfaceStyle, useGameBase: true, previewReadOnly: true, previewState: 'turn', previewMode: mode, previewPlayers: 4 }, key = `${width}-${name}-${interfaceStyle}-${mode}`, valuesByVersion = {}, navBuffers = {}, settling = {};
      for (const [version, page] of Object.entries(pages)) {
        const height = width === 375 ? 667 : 852;
        await page.goto(origins[version] + '/parity');
        const frame = await (await page.locator('#parityFrame').elementHandle()).contentFrame();
        await frame.locator('#gameView').waitFor({ state: 'visible' });
        settling[version] = { cold: await show(page, frame, skin) };
        valuesByVersion[version] = { cold: await frame.evaluate(measure, selectors) };
        navBuffers[version] = { cold: await frame.locator('#modeNav').screenshot() };
        await page.setViewportSize({ width: width + 1, height }); await settle(frame);
        await page.setViewportSize({ width, height }); settling[version].postResize = await settle(frame);
        valuesByVersion[version].postResize = await frame.evaluate(measure, selectors);
        navBuffers[version].postResize = await frame.locator('#modeNav').screenshot();
        const drift = compare(valuesByVersion[version].cold, valuesByVersion[version].postResize);
        if (drift.length) report.stability.push({ key, version, differences: drift });
        for (const phase of report.phases) if (settling[version][phase].stable < 8) report.unsettled.push({ key, version, phase, ...settling[version][phase] });
        if (name === 'authoredV2' && mode === 'radiation') await page.screenshot({ path: resolve(directory, key + '-postResize-' + version + '.png') });
      }
      const phases = Object.fromEntries(report.phases.map(phase => [phase, { differences: compare(valuesByVersion.prior[phase], valuesByVersion.current[phase]), glyphPixelsEqual: navBuffers.prior[phase].equals(navBuffers.current[phase]), navPngSha256: Object.fromEntries(Object.entries(navBuffers).map(([version, bytes]) => [version, createHash('sha256').update(bytes[phase]).digest('hex')])), radiationLabels: Object.fromEntries(Object.entries(valuesByVersion).map(([version, value]) => [version, value[phase].nav.find(item => item.mode === 'radiation').label])) }]));
      const row = { key, width, name, interfaceStyle, mode, phases, settling, metrics: valuesByVersion };
      report.cases.push(row);
      for (const [phase, measured] of Object.entries(phases)) {
        if (measured.differences.length || !measured.glyphPixelsEqual) {
          report.differences.push({ key, phase, ...measured });
          if (!measured.glyphPixelsEqual) for (const [version, buffers] of Object.entries(navBuffers)) await writeFile(resolve(directory, key + '-' + phase + '-' + version + '-nav.png'), buffers[phase]);
        }
        if (mode === 'radiation') for (const [version, label] of Object.entries(measured.radiationLabels)) assert.equal(label, interfaceStyle === 'dial' ? 'Rad' : 'Radiation', key + ' ' + phase + ' ' + version + ' radiation label');
      }
      if (report.cases.length % 12 === 0) console.log(JSON.stringify({ completed: report.cases.length, differences: report.differences.length, unsettled: report.unsettled.length }));
    }
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); assert.equal(report.differences.length, 0, 'Renderer differences were recorded in report.json');
  report.passed = true;
} catch (error) { report.passed = false; report.failure = { message: error.message, stack: error.stack }; throw error; }
finally {
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close(); for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, differences: report.differences.length, errors: report.errors.length, report: resolve(directory, 'report.json') }));
}
