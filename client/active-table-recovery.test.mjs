import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createContext, runInContext } from 'node:vm';
import { parseCompetitionFragment } from './competition-model.mjs';

const app = (await readFile(new URL('./app.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
function segment(from, to) {
  const start = app.indexOf(from), end = app.indexOf(to, start);
  return start < 0 || end < 0 ? '' : app.slice(start, end);
}
const source = [
  app.match(/^const (?:SAVED_TABLES_KEY|ACTIVE_TABLE_KEY) = .*;$/gm).join('\n'),
  segment('function showView(view)', 'function latestRecoverableHostTable()'),
  segment('async function recoverActiveTable()', 'let joinQrScanner'),
  segment('function clearPastTables(event)', 'async function openJoinCode(code)'),
  segment('function beginLocalGame(config)', 'function clearDeepJoinCode()'),
  segment('function leaveTable()', 'async function leaveNextGameTable()'),
  segment('const deepJoinCode =', '\nif (!appearancePreviewMode) {\n  void loadGameDefaultLayout();'),
].join('\n');
const activeKey = 'fivefold-arc:active-table', historyKey = 'fivefold-arc:saved-tables';
const target = { code: 'NEW222', seatId: 1, updatedAt: 200 };
const previous = { code: 'OLD111', seatId: 0, lastUsedAt: 300 };
const confirmed = { code: target.code, seats: [{}, { counters: { life: 37 } }] };

function startPage({ active = target, search = '', hash = '', claim = async () => confirmed } = {}) {
  const stored = new Map([[historyKey, JSON.stringify([previous])]]);
  if (active) stored.set(activeKey, JSON.stringify(active));
  const calls = [], shown = [], invites = [], listeners = new Map();
  const landing = { hidden: false }, create = {}, join = {}, game = {}, registrationView = {};
  const transport = {
    roomCode: null, seatId: 1, sessionEpoch: 0,
    async claimRoom(request) {
      this.sessionEpoch++;
      calls.push({ ...request });
      const snapshot = await claim();
      this.snapshot = snapshot;
      return { snapshot };
    },
    clearSession() { this.sessionEpoch++; this.roomCode = null; },
    useLocal() { this.clearSession(); },
  };
  const context = createContext({
    URLSearchParams, parseCompetitionFragment, location: { search, hash }, transport, state: null,
    activeTableRecoveryEpoch: null, awaitingConfirmedResync: false, appearancePreviewMode: false,
    dom: { landing, create, join, game, views: [landing, create, join, game, registrationView], gameMenu: {}, moreButton: { setAttribute() {} } }, registrationView,
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    window: { addEventListener: (type, listener) => listeners.set(type, listener), scrollTo() {} },
    openJoinCode: code => invites.push(code), showSharedGame: snapshot => shown.push(snapshot),
    competitionHub: { isOpen: () => false }, dialLayout: { update() {} }, syncGameWakeLock() {},
    displayName: player => player.name, showTableView() {}, render() {}, applySelectedAppearance() {},
    createState: config => ({ localSimulation: true, ...config }), clearPastTablesDialog: { close() {} },
    latestRecoverableHostTable: () => null, renderSavedTables() {}, $: () => ({ focus() {} }),
    closeGameOverlays() {}, clearStartingRollTimers() {}, clearTimeout() {}, clearInterval() {},
    coinTossTimer: null, coinFlipTimer: null, turnTicker: null, lifeBatcher: { clear() {} }, optimisticLifeDelta: 0,
  });
  runInContext(source, context);
  return { stored, calls, shown, invites, listeners, context };
}

test('reload returns to the exact active seat and authoritative life, not newest history', async () => {
  const page = startPage();
  await setImmediate();
  assert.deepEqual(page.calls, [{ code: 'NEW222', seatId: 1, reclaimOnly: true }]);
  assert.equal(page.shown[0].seats[1].counters.life, 37);
});

test('saved history alone never starts automatic return', async () => {
  const page = startPage({ active: null });
  await setImmediate();
  assert.deepEqual(page.calls, []);
});

for (const entry of [{ search: '?join=QR0001' }, { hash: '#invite=pod.id.secret' }, { hash: '#event=event_one&guest=guest1234' }]) {
  test(`an explicit table or competition invite takes priority: ${JSON.stringify(entry)}`, async () => {
    const page = startPage(entry);
    await setImmediate();
    assert.deepEqual(page.calls, []);
    if (entry.search) assert.deepEqual(page.invites, ['QR0001']);
  });
}

test('a transient failure preserves the active target and retries when online', async () => {
  let attempts = 0;
  const page = startPage({ claim: async () => {
    if (++attempts === 1) throw new Error('Temporary network failure');
    return confirmed;
  } });
  await setImmediate();
  assert.deepEqual(JSON.parse(page.stored.get(activeKey)), target);
  assert.deepEqual(page.shown, []);
  await page.listeners.get('online')();
  assert.deepEqual(page.shown, [confirmed]);
});

for (const code of ['ROOM_NOT_FOUND', 'RECLAIM_UNAVAILABLE', 'SEAT_RESERVED', 'INVALID_INPUT']) {
  test(`a permanent recovery failure clears only automatic return: ${code}`, async () => {
    const page = startPage({ claim: async () => { throw Object.assign(new Error('Unavailable'), { code }); } });
    await setImmediate();
    assert.equal(page.stored.has(activeKey), false);
    assert.deepEqual(JSON.parse(page.stored.get(historyKey)), [previous]);
  });
}

for (const action of ['showView(dom.create)', 'showView(dom.join)', 'showView(registrationView)', 'beginLocalGame({})']) {
  test(`a late return cannot override deliberate navigation: ${action}`, async () => {
    const { promise, resolve } = Promise.withResolvers();
    const page = startPage({ claim: () => promise });
    runInContext(action, page.context);
    resolve(confirmed);
    await setImmediate();
    assert.equal(page.stored.has(activeKey), false);
    assert.deepEqual(page.shown, []);
  });
}

test('a new competition invite cancels an in-flight automatic return', async () => {
  const { promise, resolve } = Promise.withResolvers();
  const page = startPage({ claim: () => promise });
  page.context.location.hash = '#invite=pod.id.secret';
  page.listeners.get('hashchange')?.();
  resolve(confirmed);
  await setImmediate();
  assert.equal(page.stored.has(activeKey), false);
  assert.deepEqual(page.shown, []);
});

test('saving the current shared seat records a separate active marker', async () => {
  const page = startPage({ active: null });
  page.context.state = { localSimulation: false, podCode: 'OWN333', ownerPlayerId: 'P2', hostSeatId: 0, players: [{ id: 'P2', name: 'Player Two' }] };
  runInContext('saveTable()', page.context);
  const active = JSON.parse(page.stored.get(activeKey));
  assert.equal(active.code, 'OWN333');
  assert.equal(active.seatId, 1);
  assert.equal(Number.isFinite(active.updatedAt), true);
});

for (const action of ['leaveTable()', 'forgetCurrentTable()', "clearPastTables({submitter:{value:'confirm'},preventDefault(){}})"]) {
  test(`deliberate exit or forgetting clears automatic return: ${action}`, async () => {
    const page = startPage();
    await setImmediate();
    page.context.state = { localSimulation: false, podCode: target.code };
    runInContext(action, page.context);
    assert.equal(page.stored.has(activeKey), false);
  });
}
