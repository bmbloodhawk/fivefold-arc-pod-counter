// Two isolated real clients against a disposable localhost-only in-memory room.
// No signed-in browser profile, external requests, or live services are used.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRealtimeServer } from '../server/src/app.js';

const require = createRequire(process.env.PLAYWRIGHT_TOOLING || new URL('./package.json', import.meta.url));
const { chromium } = require('playwright-core');
const reportDirectory = resolve(process.env.STUDIO_REPORT_DIR || resolve(tmpdir(), 'appearance-sharing-20261123'));
await mkdir(reportDirectory, { recursive: true });
const rawCatalog = { skins: [{ id: 'qa-private-draft', name: 'Private draft', status: 'Draft' }, { id: 'neutral', name: 'Carl fixture', status: 'Approved' }, { id: 'qa-enhanced', name: 'Enhanced fixture', status: 'Approved', rendererVersion: 2, background: '#101520', surface: '#192237', text: '#f0f5ff', muted: '#c4d1e5', accent: '#e8bf7a' }], assets: [] };
const { server, service } = createRealtimeServer({ staticDir: fileURLToPath(new URL('../client/', import.meta.url)), appEnv: 'test', appearanceCatalog: { read: async () => structuredClone(rawCatalog), write: async value => value }, durableRecoveryEnabled: false, autoRecoverRooms: false, lookupCommanderIdentity: async () => null, fetchImpl: async () => { throw new Error('External data disabled in appearance-sharing QA.'); } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const auth = await readFile(new URL('./competition-auth-fixture.mjs', import.meta.url), 'utf8');
const report = { origin, browser: 'Chromium', viewport: { width: 393, height: 852 }, checks: [], pageErrors: [], blockedExternalRequests: [], authority: [], limitations: ['Local disposable room only; no physical phone or live multiplayer certification.', 'Personal override exercised through the real per-device selector; signed-in saved-account preferences are covered by existing protocol tests.'] };
const connections = {}, writes = [];
const nativeBackground = new WeakMap();
const record = label => report.checks.push(label);
let host, guest, code;
const room = () => service.room(code);
const authority = () => ({ hostSeatId: room().hostSeatId, startingLife: room().config.startingLife, gameFormat: room().config.gameFormat, turnSeat: room().turn.activeSeatId, turnNumber: room().turn.turnNumber, seats: room().seats.map(seat => ({ seatId: seat.seatId, ownerConnectionId: seat.ownerConnectionId, claimed: seat.claimed, counters: structuredClone(seat.counters), commanderCount: seat.commanderCount })) });
async function client(name) {
  const context = await browser.newContext({ viewport: report.viewport, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    report.blockedExternalRequests.push(new URL(route.request().url()).origin); return route.abort();
  });
  await context.route('**/account-auth.js*', route => route.fulfill({ contentType: 'text/javascript', body: auth }));
  await context.addInitScript(() => localStorage.setItem('fivefold-arc:interface-style', 'button'));
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.pageErrors.push({ client: name, message: error.message }));
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push({ client: name, method: request.method(), path: new URL(request.url()).pathname }); });
  page.on('response', async response => { if (new URL(response.url()).pathname === '/api/connections' && response.ok()) connections[name] = (await response.json()).connectionId; });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#createPodButton');
  await page.waitForFunction(() => document.querySelector('#tableSkin').options.length >= 3);
  return page;
}
async function menu(page, open) {
  const visible = await page.locator('#gameMenu').isVisible();
  if (open && !visible) await page.locator('#moreButton').click();
  if (!open && visible) await page.locator('#closeGameMenuButton').click();
}
async function expectSkin(page, id) {
  const colors = { 'staging-slate': '#101b2c', 'staging-ember': '#25170f', 'qa-enhanced': '#101520' };
  await page.waitForFunction(({ expected, background }) => document.documentElement.getAttribute('data-game-skin') === expected && getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase() === background, { expected: id || null, background: colors[id] || nativeBackground.get(page) });
}
async function hostOffer(id) {
  const before = authority();
  await menu(host, true);
  const response = host.waitForResponse(value => new URL(value.url()).pathname === `/api/rooms/${code}/table-skin` && value.request().method() === 'POST');
  await host.locator('#tableSkinMenu').selectOption(id);
  assert.equal((await response).status(), 200);
  await menu(host, false);
  assert.deepEqual(authority(), before, 'Changing the offered skin must preserve counters, turn and ownership.');
}
async function deviceChoice(page, id) {
  const before = authority(), version = room().version, beforeWrites = writes.length;
  await menu(page, true); await page.locator('#deviceAppearanceChoice').selectOption(id); await menu(page, false);
  assert.deepEqual(authority(), before);
  assert.equal(room().version, version);
  assert.equal(writes.slice(beforeWrites).some(write => /\/table-skin$/.test(write.path)), false);
}
try {
  host = await client('host'); guest = await client('guest');
  await host.locator('#createPodButton').click();
  await host.locator('#createStepOneNext').click();
  await host.locator('#createName').fill('Host Audit');
  await host.locator('#createStepTwoNext').click(); await host.locator('#createStepThreeSkip').click();
  await host.locator('#createForm button[type=submit]').click();
  await host.locator('#lobbyInviteCode').waitFor(); code = (await host.locator('#lobbyInviteCode').innerText()).trim();
  await guest.locator('#joinPodButton').click(); await guest.locator('#podCode').fill(code);
  await guest.locator('#joinCodeForm button[type=submit]').click(); await guest.locator('#joinSeat').selectOption('P2');
  await guest.locator('#joinStepTwoNext').click(); await guest.locator('#joinName').fill('Guest Audit'); await guest.locator('#joinStepThreeNext').click();
  await guest.locator('#joinForm button[type=submit]').click(); await guest.locator('#lobbyView').waitFor({ state: 'visible' });
  await host.locator('#startGameButton').click();
  await Promise.all([host.locator('#gameView').waitFor({ state: 'visible' }), guest.locator('#gameView').waitFor({ state: 'visible' })]);
  for (const page of [host, guest]) nativeBackground.set(page, await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase()));
  assert.equal(room().seats.filter(seat => seat.claimed).length, 2);
  record('Two isolated browser contexts joined and started the same local room through real UI and SSE.');

  await hostOffer('staging-slate'); await Promise.all([expectSkin(host, 'staging-slate'), expectSkin(guest, 'staging-slate')]);
  record('Host Slate offer reached the following guest without changing counters, turn or ownership.');
  await deviceChoice(guest, 'staging-ember'); await expectSkin(guest, 'staging-ember'); await expectSkin(host, 'staging-slate');
  record('Guest Ember override changed only its own screen and generated no shared appearance write.');
  await hostOffer('staging-ember'); await expectSkin(guest, 'staging-ember');
  await hostOffer('qa-enhanced'); await expectSkin(host, 'qa-enhanced'); await expectSkin(guest, 'staging-ember');
  assert.equal(await host.locator('html').getAttribute('data-renderer-version'), '2');
  assert.equal(await guest.locator('html').getAttribute('data-renderer-version'), '1');
  await hostOffer('staging-slate'); await expectSkin(guest, 'staging-ember');
  await hostOffer(''); await expectSkin(guest, 'staging-ember'); await expectSkin(host, null);
  record('Guest explicit choice survived host offer changes and removal; host returned to Neutral.');
  await hostOffer('staging-slate'); await deviceChoice(guest, '');
  await expectSkin(guest, 'staging-slate');
  assert.equal(await guest.evaluate(() => localStorage.getItem('fivefold-arc:device-appearance')), null);
  await hostOffer(''); await expectSkin(guest, null);
  record('Clearing guest override followed the current host appearance, then Neutral when the offer was removed.');
  await hostOffer('staging-slate'); await deviceChoice(guest, 'standard'); await expectSkin(guest, null);
  await hostOffer('staging-ember'); await expectSkin(guest, null); await expectSkin(host, 'staging-ember');
  record('Explicit Standard appearance stayed Neutral while the host changed the offer.');

  const beforeGuestAction = authority();
  const adjustment = guest.waitForResponse(value => new URL(value.url()).pathname === `/api/rooms/${code}/adjust` && value.request().method() === 'POST');
  await guest.locator('#adjustControls [data-delta="1"]').click();
  assert.equal((await adjustment).status(), 200);
  await guest.waitForFunction(() => document.querySelector('#mainValue').textContent.trim() === '41');
  await host.waitForFunction(() => document.querySelector('#podStrip [data-seat="P2"] .seat-life')?.textContent.trim() === '41');
  assert.equal(room().seats[1].counters.life, 41); assert.equal(room().seats[0].counters.life, 40);
  assert.deepEqual(authority().seats.map(seat => seat.ownerConnectionId), beforeGuestAction.seats.map(seat => seat.ownerConnectionId));
  record('After appearance changes, guest life control updated only its owned seat and retained both seat owners.');
  const guestHostAttempt = await fetch(`${origin}/api/rooms/${code}/table-skin`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-connection-id': connections.guest }, body: JSON.stringify({ baseVersion: room().version, tableSkinId: 'staging-slate' }) });
  assert.equal(guestHostAttempt.status, 403);
  record('Server rejected the guest attempting a host-only shared appearance change.');
  for (const id of ['qa-private-draft', 'neutral', 'field-notes']) assert.equal((await fetch(`${origin}/api/game-skins/${id}`)).status, 404);
  record('Public skin detail withheld draft, invitation and unavailable achievement artwork.');
  const beforeInvalidOffer = authority(), offerVersion = room().version;
  for (const [tableSkinId, expected] of [['qa-private-draft', 400], ['missing-skin', 400], ['neutral', 403], ['field-notes', 400]]) {
    const response = await fetch(`${origin}/api/rooms/${code}/table-skin`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-connection-id': connections.host }, body: JSON.stringify({ baseVersion: room().version, tableSkinId }) });
    assert.equal(response.status, expected);
    assert.equal(room().version, offerVersion); assert.equal(room().config.tableSkinId, 'staging-ember'); assert.deepEqual(authority(), beforeInvalidOffer);
  }
  record('Server refused draft, missing, invitation and unavailable achievement host offers without changing shared appearance or authority.');
  await host.screenshot({ path: resolve(reportDirectory, 'host-offered-ember.png'), fullPage: true });
  await guest.screenshot({ path: resolve(reportDirectory, 'guest-explicit-neutral.png'), fullPage: true });
  report.authority = { life: room().seats.filter(seat => seat.claimed).map(seat => seat.counters.life), sameOwners: true, sameStartingLife: room().config.startingLife === 40, currentTableSkin: room().config.tableSkinId };
  report.finalAppearance = { host: await host.evaluate(() => ({ skin: document.documentElement.dataset.gameSkin, background: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() })), guest: await guest.evaluate(() => ({ skin: document.documentElement.dataset.gameSkin || null, background: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() })) };
  assert.deepEqual(report.pageErrors, []);
  report.passed = true;
} catch (error) { report.passed = false; report.failure = { message: error.message, stack: error.stack }; if (host) await host.screenshot({ path: resolve(reportDirectory, 'failure-host.png'), fullPage: true }).catch(() => {}); throw error; }
finally {
  report.writes = writes;
  await writeFile(resolve(reportDirectory, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, pageErrors: report.pageErrors.length, report: resolve(reportDirectory, 'report.json') }));
}
