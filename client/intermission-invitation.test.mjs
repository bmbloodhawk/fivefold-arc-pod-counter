import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');

function intermission({ capacity = 8, claimed = 2, host = true, local = false } = {}) {
  const nodes = new Map();
  const element = key => {
    if (!nodes.has(key)) nodes.set(key, { hidden: false, open: true, dataset: {}, querySelectorAll: () => [] });
    return nodes.get(key);
  };
  const dom = new Proxy({}, { get: (_, key) => element(key) });
  const state = {
    localSimulation: local, podCode: local ? 'LOCAL' : 'ABC123', hostSeatId: 0,
    seatCapacity: capacity, playerCount: capacity, ownerPlayerId: host ? 'P1' : 'P2',
    players: Array.from({ length: capacity }, (_, id) => ({ id: `P${id + 1}`, name: `Player ${id + 1}`, connectionStatus: id < claimed ? 'connected' : 'waiting' })),
    turn: { gameStarted: false },
    lifecycle: { status: 'intermission', seatIds: [0, 1], readySeatIds: [0, 1] },
  };
  const start = app.indexOf('function renderTurnFlow()');
  const end = app.indexOf('\nfunction renderEliminationUndo()', start);
  const render = runInNewContext(app.slice(start, end) + '\nrenderTurnFlow', {
    dom, state, commanderSetupDraft: null, pendingNextGameSetup: false, nextGameConfirmation: null, transport: { seatId: host ? 0 : 1, status: 'connected' },
    turnPlayer: () => state.players[0], renderEliminationUndo: () => ({}),
    displayName: player => player.name, escapeHtml: value => value,
    $: element, interfaceStyle: 'dial', cueMode: () => 'off',
    deviceTurnCuesEnabled: () => false, turnSound: () => 'single-ding', touchFeedbackEnabled: () => false,
    turnTicker: null, clearInterval() {},
  });
  render();
  return { dom, state };
}

test('a host can open invitations on an old two-seat table with no empty seats', () => {
  const { dom } = intermission({ capacity: 2 });
  assert.equal(dom.intermissionInvite.hidden, false);
  assert.equal(dom.intermissionInviteCode.textContent, 'ABC123');
  assert.equal(dom.intermissionDetail.textContent, '2/2 players ready.');
});

test('the eight-seat maximum explains how a place can become available', () => {
  const { dom } = intermission({ claimed: 8 });
  assert.equal(dom.intermissionInvite.hidden, true);
  assert.match(dom.intermissionDetail.textContent, /8 seats.*claimed.*leave/i);
  assert.doesNotMatch(dom.intermissionDetail.textContent, /start a new table/i);
});

for (const [label, settings] of [['guest', { host: false }], ['local simulation', { local: true }]]) {
  test(`${label} has no host invitation disclosure left open`, () => {
    const { dom } = intermission(settings);
    assert.equal(dom.intermissionInvite.hidden, true);
    assert.equal(dom.intermissionInvite.open, false);
  });
}

function expansion({ capacity = 2, result = {}, error } = {}) {
  const calls = [];
  const dom = { intermissionInvite: { open: true } };
  const context = {
    openingIntermissionSeatsCode: null,
    dom, state: { podCode: 'ABC123', seatCapacity: capacity, playerCount: capacity, lifecycle: { status: 'intermission' } },
    transport: { async openTableSeats() { calls.push('open seats'); if (error) throw error; return result; } },
    showTableActionError: message => calls.push(message), showTableRequestError: value => calls.push(value.message),
  };
  const start = app.indexOf('async function openIntermissionSeats(');
  assert.ok(start >= 0, 'the invitation disclosure must support opening seats on older tables');
  const end = app.indexOf('\ndom.intermissionInvite.addEventListener', start);
  const open = runInNewContext(app.slice(start, end) + '\nopenIntermissionSeats', context);
  return { open, calls, dom, context };
}

test('opening an invitation expands an older table and reuses the existing table', async () => {
  const { open, calls, dom } = expansion();
  await open();
  assert.deepEqual(calls, ['open seats']);
  assert.equal(dom.intermissionInvite.open, true);
});

test('opening invitations on a new eight-seat table needs no write', async () => {
  const { open, calls } = expansion({ capacity: 8 });
  await open();
  assert.deepEqual(calls, []);
});

test('an unsuccessful expansion closes the invite and gives a recoverable error', async () => {
  const { open, calls, dom } = expansion({ error: new Error('Connection lost') });
  await open();
  assert.deepEqual(calls, ['open seats', 'Connection lost']);
  assert.equal(dom.intermissionInvite.open, false);
});

test('rapidly closing and reopening an invitation shares one pending expansion', async () => {
  const { open, calls, dom, context } = expansion();
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  context.transport.openTableSeats = () => { calls.push('open seats'); return pending; };
  const first = open();
  dom.intermissionInvite.open = false;
  dom.intermissionInvite.open = true;
  const second = open();
  assert.equal(calls.length, 1);
  complete({});
  await Promise.all([first, second]);
  assert.equal(dom.intermissionInvite.open, true);
});

test('a late expansion error cannot interrupt a game that has already started', async () => {
  const { open, calls, context } = expansion();
  let fail;
  context.transport.openTableSeats = () => new Promise((_, reject) => { fail = reject; });
  const first = open();
  context.state.lifecycle.status = 'playing';
  fail(new Error('Late response'));
  await first;
  assert.deepEqual(calls, []);
});
