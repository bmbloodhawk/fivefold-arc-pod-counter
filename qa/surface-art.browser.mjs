// Disposable scoped-art/entitlement browser proof. All artwork, accounts, awards
// and rooms are synthetic in memory. Every external browser request is blocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRealtimeServer } from '../server/src/app.js';
import { AccountHistory, MemoryAccountHistoryStore } from '../server/src/account-history.js';
import { APPEARANCE_ACHIEVEMENTS } from '../server/src/appearance-milestones.js';
import { SURFACE_ART_SLOTS } from '../client/appearance-surface-art.js';

function originalFixturePng() {
  const crc32 = bytes => { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ -1) >>> 0; };
  const chunk = (kind, bytes) => { const type = Buffer.from(kind), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([type, bytes]))); return Buffer.concat([length, type, bytes, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(64, 0); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(64 * (64 * 4 + 1));
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const position = y * 257 + 1 + x * 4, gold = ((x + y) >> 3) % 2; pixels.set(gold ? [250, 190, 50, 255] : [35, 130, 215, 255], position); }
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const png = originalFixturePng(), base = { rendererVersion: 2, background: '#0b1018', surface: '#162332', text: '#f2f5ed', muted: '#c8d5df', accent: '#e4bc72' };
const surfaceArt = Object.fromEntries(Object.keys(SURFACE_ART_SLOTS).map(slot => [slot, { assetId: 'panel-art', opacity: 35, fit: slot === 'gameHeader' ? 'contain' : 'cover', scale: 110, positionX: 35, positionY: 65 }]));
const study = { ...base, id: 'surface-study', name: 'Surface art study', status: 'Approved', surfaceArt };
const legacyId = Object.keys(APPEARANCE_ACHIEVEMENTS).find(id => id !== 'field-notes');
const visual = { schemaVersion: 1, treatment: 'grid', background: '#080808', surface: '#161616', accent: '#d8ae61', text: '#f4ecd9', muted: '#afa590', border: '#d8ae61' };
const blobs = new Map([['panel-art', { id: 'panel-art', name: 'Original stripe study', source: 'Generated synthetic QA artwork', placement: 'panel', status: 'Approved', data: png }]]);
let catalog = { revision: 0, schemaVersion: 1, selected: 'surface-draft', skins: [study, { ...study, id: 'surface-draft', name: 'Authoring draft', status: 'Draft' }], assets: [...blobs.values()].map(({ data, ...asset }) => asset), gameDefaultLayout: null };
const accountHistory = new AccountHistory({ store: new MemoryAccountHistoryStore() }), ownerId = await accountHistory.ensureAccount('owner');
await accountHistory.savePreferences(ownerId, { personalSkinId: 'field-notes', usePersonalSkin: true, interfaceStyle: 'button' });
accountHistory.earnedSkinAwards = async id => id === ownerId ? Object.fromEntries(['field-notes', legacyId].map(skinId => [APPEARANCE_ACHIEVEMENTS[skinId].id, 'unlocked'])) : {};
const appearanceCatalog = { read: async () => structuredClone(catalog), async write(value) { catalog = structuredClone(value); return structuredClone(catalog); }, readAsset: async id => blobs.get(id), async writeAsset(id, value) { blobs.set(id, value); return value; }, async deleteAsset(id) { blobs.delete(id); } };
const { server, service } = createRealtimeServer({ staticDir: fileURLToPath(new URL('../client/', import.meta.url)), appearanceCatalog, feedbackPortalKey: 'scoped-art-fixture-key', appEnv: 'test', durableRecoveryEnabled: false, autoRecoverRooms: false, accountHistory, accountVerifier: { async verify(token) { if (token !== 'qa-owner') throw Object.assign(new Error('Sign in'), { status: 401 }); return { providerSubject: 'owner' }; } }, appearanceSkins: [{ ...study, id: 'field-notes', visual }, { id: legacyId, name: 'Legacy collection fixture', visual }], lookupCommanderIdentity: async () => null, fetchImpl: async () => { throw new Error('External data disabled'); } });
const requestHandler = server.listeners('request')[0]; server.removeListener('request', requestHandler);
server.on('request', (req, res) => { if (req.url === '/review') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<script>sessionStorage.setItem("fivefold-arc:developer-key","scoped-art-fixture-key");location.replace("/appearance-studio.html")</script>'); } else requestHandler.call(server, req, res); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, directory = resolve(process.env.STUDIO_REPORT_DIR || resolve(tmpdir(), 'surface-art-proof-20261123'));
await mkdir(directory, { recursive: true });
const require = createRequire(process.env.PLAYWRIGHT_TOOLING || new URL('./package.json', import.meta.url)), { chromium } = require('playwright-core');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const auth = await readFile(new URL('./competition-auth-fixture.mjs', import.meta.url), 'utf8'), report = { checks: [], errors: [], externalRequests: [], geometry: [], limitations: ['Chromium emulation at 393×852; no physical-phone or live-service claim.', 'Synthetic account verifier and award records test the owned/shared adapter, not earning/login providers.'] };
async function pageFor(owner = false, width = 393) {
  const context = await browser.newContext({ viewport: { width, height: 852 }, serviceWorkers: 'block', isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); report.externalRequests.push(new URL(route.request().url()).origin); return route.abort(); });
  await context.route('**/account-auth.js*', route => route.fulfill({ contentType: 'text/javascript', body: auth }));
  await context.addInitScript(owned => { localStorage.setItem('fivefold-arc:interface-style', 'button'); if (owned) sessionStorage.setItem('fivefold-arc:qa-account', 'qa-owner'); }, owner);
  const page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => report.errors.push(error.message)); return page;
}
const check = label => report.checks.push(label);
async function skin(page, id) { await page.waitForFunction(value => document.documentElement.dataset.gameSkin === value, id); }
async function menu(page, open) { const visible = await page.locator('#gameMenu').isVisible(); if (open && !visible) await page.locator('#moreButton').click(); if (!open && visible) await page.locator('#closeGameMenuButton').click(); }
async function personal(page, id) { await menu(page, true); await page.locator('#deviceAppearanceChoice').selectOption(id); await menu(page, false); }
async function settle(page) { await page.evaluate(async () => {
  await document.fonts.ready;
  let last = '', stable = 0;
  for (let frame = 0; frame < 40 && stable < 5; frame++) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const rect = document.querySelector('#mainValue').getBoundingClientRect(), next = JSON.stringify([rect.x,rect.y,rect.width,rect.height]);
    stable = next === last ? stable + 1 : 0; last = next;
  }
}); }
let owner, guest, preview, studio;
try {
  owner = await pageFor(true); guest = await pageFor();
  await owner.goto(origin); await guest.goto(origin);
  await owner.locator('#createPodButton').click(); await owner.locator('#createStepOneNext').click(); await owner.locator('#createName').fill('Art owner'); await owner.locator('#createStepTwoNext').click(); await owner.locator('#createStepThreeSkip').click(); await owner.locator('#createForm button[type=submit]').click();
  await owner.locator('#lobbyInviteCode').waitFor(); const code = (await owner.locator('#lobbyInviteCode').innerText()).trim();
  await guest.locator('#joinPodButton').click(); await guest.locator('#podCode').fill(code); await guest.locator('#joinCodeForm button[type=submit]').click(); await guest.locator('#joinSeat').selectOption('P2'); await guest.locator('#joinStepTwoNext').click(); await guest.locator('#joinName').fill('Art guest'); await guest.locator('#joinStepThreeNext').click(); await guest.locator('#joinForm button[type=submit]').click(); await guest.locator('#lobbyView').waitFor({ state: 'visible' });
  await owner.locator('#startGameButton').click(); await owner.locator('#gameView').waitFor({ state: 'visible' }); await guest.locator('#gameView').waitFor({ state: 'visible' });
  await skin(owner, 'field-notes'); await owner.waitForFunction(() => document.querySelectorAll('.appearance-surface-art').length >= 8 && [...document.querySelectorAll('.appearance-surface-art')].every(node => !node.hidden));
  assert.equal(await owner.locator('html').getAttribute('data-renderer-version'), '2');
  assert.equal(await guest.locator('.appearance-surface-art').count(), 0);
  assert.equal((await fetch(origin + '/api/game-skins/field-notes')).status, 404);
  await owner.locator('#adjustControls [data-delta="1"]').tap(); await owner.waitForFunction(() => document.querySelector('#mainValue').value === '41');
  await owner.locator('#adjustControls [data-delta="-1"]').tap(); await owner.waitForFunction(() => document.querySelector('#mainValue').value === '40');
  check('Authorized v2 earned appearance renders scoped art; unowned browser and anonymous detail do not receive it.');
  check('Touch taps still reach the normal +1 and −1 game controls through decorative artwork.');
  const authority = service.room(code).seats.map(seat => [seat.ownerConnectionId, seat.counters.life]);
  await menu(owner, true); const share = owner.waitForResponse(response => new URL(response.url()).pathname === `/api/rooms/${code}/table-skin` && response.request().method() === 'POST'); await owner.locator('#tableSkinMenu').selectOption('field-notes'); assert.equal((await share).status(), 200); await menu(owner, false);
  await skin(guest, 'field-notes'); await guest.waitForFunction(() => document.querySelectorAll('.appearance-surface-art').length >= 8);
  assert.deepEqual(service.room(code).seats.map(seat => [seat.ownerConnectionId, seat.counters.life]), authority);
  check('Host-authorized shared v2 reward renders on the owning guest connection without changing life or seat ownership.');
  await personal(guest, 'standard'); await guest.waitForFunction(() => !document.documentElement.hasAttribute('data-game-skin') && !document.documentElement.hasAttribute('data-collection-treatment') && !document.querySelector('.appearance-surface-art'));
  await personal(owner, legacyId); await owner.waitForFunction(() => document.documentElement.hasAttribute('data-collection-treatment') && !document.documentElement.hasAttribute('data-renderer-version') && !document.querySelector('.appearance-surface-art'));
  check('Explicit Standard clears collection plus expanded decoration; selecting legacy reward retains the old collection-only path.');
  preview = await pageFor(); await preview.goto(origin + '/index.html?appearance-preview=1');
  const publicSkin = (await (await fetch(origin + '/api/game-skins/surface-study')).json()).skin;
  const send = async value => { await preview.evaluate(value => { delete document.documentElement.dataset.previewFixture; window.postMessage({ type: 'fivefold-arc:appearance-skin', skin: value }, location.origin); }, value); await preview.waitForFunction(state => document.documentElement.dataset.previewFixture === state, value.previewState); await settle(preview); };
  const metrics = () => Object.fromEntries(['#turnBanner', '#modeNav', '#gameView .game-topline', '#gameView .counter-stage', '#customLifeDialog > form', '#victoryDialog .victory-winner-copy', '#mainValue'].map(selector => { const element = document.querySelector(selector), box = element.getBoundingClientRect(); return [selector, { x: box.x, y: box.y, width: box.width, height: box.height, text: element.textContent.trim() }]; }));
  for (const state of ['turn', 'dialog', 'end']) {
    const plain = { ...publicSkin, surfaceArt: undefined, surfaceArtData: undefined, useGameBase: true, previewState: state, previewPlayers: 4, previewMode: 'life' };
    await send(plain); const before = await preview.evaluate(metrics);
    await send({ ...plain, surfaceArt: publicSkin.surfaceArt, surfaceArtData: publicSkin.surfaceArtData });
    await preview.waitForFunction(() => [...document.querySelectorAll('.appearance-surface-art')].every(node => !node.hidden && node.querySelector('img').complete && node.querySelector('img').naturalWidth > 0));
    await settle(preview); const after = await preview.evaluate(metrics); report.geometry.push({ state, before, after });
    for (const [selector, expected] of Object.entries(before)) {
      assert.equal(after[selector].text, expected.text, selector + ' label in ' + state);
      for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(after[selector][key] - expected[key]) < .02, selector + ' ' + key + ' must stay fixed in ' + state);
    }
    assert.equal(await preview.evaluate(() => [...document.querySelectorAll('.appearance-surface-art')].every(node => getComputedStyle(node).pointerEvents === 'none' && node.getAttribute('aria-hidden') === 'true')), true);
    if (state === 'end') assert.equal(await preview.evaluate(() => {
      const target = document.querySelector('[data-surface-art="resultHeader"]'), layer = target.querySelector('.appearance-surface-art');
      return layer.getBoundingClientRect().height <= target.getBoundingClientRect().height * .43 && !document.querySelector('.personal-match-moment .appearance-surface-art');
    }), true, 'Result-heading art must stay in its text band and leave collection award artwork alone');
    report.geometry.push({ state, unchanged: true }); await preview.screenshot({ path: resolve(directory, `surface-art-${state}.png`), fullPage: true });
  }
  check('Actual-renderer turn/dialog/result fixtures preserve control rectangles within .02px and exact labels while all scoped art stays inert.');
  studio = await pageFor(false, 1400); await studio.goto(origin + '/review'); await studio.locator('#surfaceArtSlot').waitFor({state:'attached'}); await studio.locator('[aria-controls="edit-artwork"]').click();
  await studio.locator('#surfaceArtSlot').selectOption('navigation'); await studio.locator('#surfaceArtAsset').selectOption('panel-art'); await studio.locator('#surfaceArtFit').selectOption('contain'); await studio.locator('#surfaceArt-positionX').press('Home'); await studio.locator('#surfaceArt-scale').press('End');
  const saving = studio.waitForResponse(response => new URL(response.url()).pathname === '/api/appearance-studio/catalog' && response.request().method() === 'PUT'); await studio.locator('#saveButton').click(); const saved = await saving; assert.equal(saved.status(), 200); const written = (await saved.json()).catalog.skins.find(row => row.id === 'surface-draft');
  assert.deepEqual([written.surfaceArt.navigation.fit, written.surfaceArt.navigation.positionX, written.surfaceArt.navigation.scale], ['contain', 0, 160]);
  assert.ok(written.surfaceArt.turnBar); assert.equal(Object.hasOwn(written, 'surfaceArtData'), false);
  check('Studio editor saves only named asset IDs and bounded fit/crop/scale; unrelated surfaces remain intact.');
  await studio.locator('.surface-art-actions button').filter({ hasText: 'Reset this area' }).click(); assert.equal(await studio.locator('#surfaceArtAsset').inputValue(), '');
  await studio.locator('.surface-art-actions button').filter({ hasText: 'Import original surface art' }).click(); await studio.locator('#assetFile').waitFor({ state: 'visible' }); assert.equal(await studio.locator('#assetPlacement').inputValue(), 'panel');
  check('Reset clears one area; import link opens the existing central artwork workflow with the correct role.');
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); report.passed = true;
} catch (error) { report.passed = false; report.failure = { message: error.message, stack: error.stack }; for (const [name, page] of [['owner', owner], ['preview', preview], ['studio', studio]]) if (page) await page.screenshot({ path: resolve(directory, `failure-${name}.png`), fullPage: true }).catch(() => {}); throw error; }
finally { await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2)); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, errors: report.errors, report: resolve(directory, 'report.json') })); }
