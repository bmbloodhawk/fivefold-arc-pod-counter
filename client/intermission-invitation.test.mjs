import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { tournamentTableFlow } from './tournament-table-flow.mjs';
import { renderSeatOrder } from './seat-order.js';
import { renderIntermissionPanel } from './intermission-panel.js';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');

function intermission({
  capacity = 8, claimed = 2, host = true, local = false, tournament = false, access = true,
  integration = false, status = 'connected', pendingSetup = false, rosterIds = [0, 1], readyIds = [0, 1],
  ownerPlayerId = host ? 'P1' : 'P2', seatId = host ? 0 : 1,
} = {}) {
  const nodes = new Map();
  const element = key => {
    if (!nodes.has(key)) nodes.set(key, { hidden: false, disabled: false, open: true, textContent: '', innerHTML: '', dataset: {}, querySelectorAll: () => [] });
    return nodes.get(key);
  };
  const dom = new Proxy({}, { get: (_, key) => element(key) });
  const state = {
    localSimulation: local, podCode: local ? 'LOCAL' : 'ABC123', hostSeatId: 0,
    seatCapacity: capacity, playerCount: capacity, ownerPlayerId,
    players: Array.from({ length: capacity }, (_, id) => ({ id: `P${id + 1}`, name: `Player ${id + 1}`, connectionStatus: id < claimed ? 'connected' : 'waiting' })),
    turn: { gameStarted: false },
    lifecycle: { status: 'intermission', seatIds: rosterIds, readySeatIds: readyIds },
  };
  const tournamentContext = tournament ? { linked: true, kind: 'tournament', code: 'ABC123', canAccess: access } : null;
  const seatOrderOptions = () => ({
    players: state.players, readyIds: state.lifecycle.readySeatIds, isHost: local || seatId === state.hostSeatId,
    hostSeatId: state.hostSeatId, displayName: player => player.name, escapeHtml: value => value,
    onSkipSeat() {}, onMoveSeat() {},
  });
  let render = () => renderIntermissionPanel(dom, state, {
    seatId, status, pendingSetup, eventFlow: tournamentTableFlow(state, tournamentContext), seatOrderOptions: seatOrderOptions(),
  });
  if (integration) {
    // These two tests retain app-level event navigation coverage; the other
    // presentation cases call the extracted renderer through its public API.
    const start = app.indexOf('function renderTurnFlow()');
    const end = app.indexOf('\nfunction renderEliminationUndo()', start);
    render = runInNewContext(app.slice(start, end) + '\nrenderTurnFlow', {
      tournamentTableFlow, tournamentTableContext: tournamentContext,
      tournamentRoundButton: element('tournamentRoundButton'), returnToTournamentButton: element('returnToTournamentButton'),
      dom, state, commanderSetupDraft: null, pendingNextGameSetup: pendingSetup, nextGameConfirmation: null, transport: { seatId, status },
      turnPlayer: () => state.players[0], renderEliminationUndo: () => ({}),
      syncTableOrderControls() {}, renderSeatOrder, renderIntermissionPanel, skipNextGameSeat() {}, moveNextGameSeat() {},
      displayName: player => player.name, escapeHtml: value => value,
      $: element, interfaceStyle: 'dial', cueMode: () => 'off',
      deviceTurnCuesEnabled: () => false, turnSound: () => 'single-ding', touchFeedbackEnabled: () => false,
      turnTicker: null, clearInterval() {},
    });
  }
  render();
  return { dom, state, render };
}

test('a finished Tournament offers the event and hides casual next-game controls', () => {
  const { dom } = intermission({ tournament: true, integration: true });
  assert.equal(dom.intermissionTitle.textContent, 'Tournament game complete');
  for (const name of ['intermissionReadyButton', 'intermissionSetupButton', 'intermissionStartButton', 'intermissionInvite', 'intermissionRoster']) assert.equal(dom[name].hidden, true, name);
  assert.equal(dom.returnToTournamentButton.hidden, false);
});

test('an attested Tournament guest gets organizer guidance without private event navigation', () => {
  const { dom } = intermission({ tournament: true, host: false, access: false, integration: true });
  assert.equal(dom.returnToTournamentButton.hidden, true);
  assert.match(dom.intermissionDetail.textContent, /organizer/);
  assert.equal(dom.intermissionReadyButton.hidden, true);
});

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

test('ready and unready host views keep deck editing and Start aligned with the roster', () => {
  const view = intermission({ readyIds: [1] });
  assert.equal(view.dom.intermissionTitle.textContent, 'Set up the next game');
  assert.equal(view.dom.intermissionReadyButton.hidden, false);
  assert.equal(view.dom.intermissionReadyButton.textContent, 'I’m ready');
  assert.equal(view.dom.intermissionSetupButton.hidden, false);
  assert.equal(view.dom.intermissionStartButton.disabled, true);
  assert.equal(view.dom.intermissionStartButton.textContent, 'Waiting for every player · 1/2 ready');
  view.state.lifecycle.readySeatIds = [0, 1];
  view.render();
  assert.equal(view.dom.intermissionReadyButton.textContent, 'I need to make a change');
  assert.equal(view.dom.intermissionSetupButton.hidden, true);
  assert.equal(view.dom.intermissionStartButton.hidden, false);
  assert.equal(view.dom.intermissionStartButton.disabled, false);
  assert.equal(view.dom.intermissionStartButton.textContent, 'Start next game · 2 players');
  assert.match(view.dom.intermissionRoster.innerHTML, /<strong>P2 · Player 2<\/strong>/);
});

test('a guest can withdraw readiness without gaining the host Start control', () => {
  const { dom } = intermission({ host: false });
  assert.equal(dom.intermissionReadyButton.hidden, false);
  assert.equal(dom.intermissionReadyButton.disabled, false);
  assert.equal(dom.intermissionReadyButton.textContent, 'I need to make a change');
  assert.equal(dom.intermissionStartButton.hidden, true);
  assert.equal(dom.intermissionRoster.hidden, false);
});

test('disconnected shared players cannot ready, edit setup, Start, or Leave', () => {
  const { dom } = intermission({ status: 'disconnected' });
  for (const name of ['intermissionReadyButton', 'intermissionSetupButton', 'intermissionStartButton', 'intermissionLeaveButton']) {
    assert.equal(dom[name].disabled, true, name);
  }
});

test('a pending setup disables Ready and setup without changing existing Start or Leave policy', () => {
  const { dom } = intermission({ pendingSetup: true });
  assert.equal(dom.intermissionReadyButton.disabled, true);
  assert.equal(dom.intermissionSetupButton.disabled, true);
  assert.equal(dom.intermissionStartButton.disabled, false);
  assert.equal(dom.intermissionLeaveButton.disabled, false);
});

test('a player outside the next roster has no Ready or setup control', () => {
  const { dom } = intermission({ host: false, rosterIds: [0, 3], readyIds: [0, 1] });
  assert.equal(dom.intermissionReadyButton.hidden, true);
  assert.equal(dom.intermissionSetupButton.hidden, true);
  assert.equal(dom.intermissionStartButton.disabled, true, 'A ready list with the same length is insufficient when a roster member is unready.');
});

test('an eight-seat table with a waiting seat can still invite a player', () => {
  const { dom } = intermission({ capacity: 8, claimed: 7 });
  assert.equal(dom.intermissionInvite.hidden, false);
  assert.doesNotMatch(dom.intermissionDetail.textContent, /All 8 seats are claimed/);
});

test('local readiness follows the owned player rather than transport seat and stays usable offline', () => {
  const view = intermission({ local: true, ownerPlayerId: 'P4', seatId: 0, rosterIds: [0, 3], readyIds: [3], status: 'disconnected' });
  assert.equal(view.dom.intermissionReadyButton.textContent, 'I need to make a change');
  assert.equal(view.dom.intermissionReadyButton.disabled, false);
  assert.equal(view.dom.intermissionSetupButton.hidden, true);
  assert.equal(view.dom.intermissionLeaveButton.disabled, false);
  const before = structuredClone(view.state);
  view.render();
  assert.deepEqual(view.state, before, 'Presentation must not change shared or local game state.');
});

test('an empty next-game roster cannot become ready or start', () => {
  const { dom } = intermission({ rosterIds: [], readyIds: [] });
  assert.equal(dom.intermissionReadyButton.hidden, true);
  assert.equal(dom.intermissionSetupButton.hidden, true);
  assert.equal(dom.intermissionStartButton.disabled, true);
  assert.equal(dom.intermissionDetail.textContent, '0/0 players ready.');
});

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
