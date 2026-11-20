import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext, runInNewContext } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');

function fixture(save = async () => ({})) {
  const elements = Object.fromEntries(['adjustTableOrderButton', 'tableOrderDialog', 'tableOrderRoster', 'tableOrderStatus', 'saveTableOrderButton', 'cancelTableOrderButton'].map(id => [id, { hidden: false, disabled: false, textContent: '', innerHTML: '', open: false, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, showModal() { this.open = true; }, close() { this.open = false; } }]));
  const calls = [];
  const context = createContext({
    ...elements, calls,
    state: { podCode: 'LOCAL1', hostSeatId: 0, players: [], lifecycle: { status: 'playing', seatIds: [0, 1, 3] }, turn: { gameStarted: true, gameStartedAt: 100, turnStartedAt: 200, activeSeatId: 1, turnNumber: 2 } },
    transport: { seatId: 0, status: 'connected', async reorderNextGameSeats(order) { calls.push(Array.from(order)); return save(order); } },
    dom: { moreButton: { focus() {} } }, closeGameMenu() {}, render() {}, showError() {},
  });
  const start = app.indexOf('let tableOrderDraft = null;');
  assert.ok(start >= 0, 'the in-game order editor must be implemented');
  runInContext(app.slice(start, app.indexOf('async function confirmNextGameStart(', start)) + '\nrenderTableOrderDraft = () => {};', context);
  return { context, elements, calls };
}

test('only the host of an active game can open the order editor', () => {
  const { context: c, elements: e } = fixture();
  c.transport.seatId = 1; c.openTableOrder(); assert.equal(e.tableOrderDialog.open, false);
  c.transport.seatId = 0; c.state.gameResult = {}; c.openTableOrder(); assert.equal(e.tableOrderDialog.open, false);
  c.state.gameResult = null; c.openTableOrder(); assert.equal(e.tableOrderDialog.open, true);
});

test('a pending final result closes the order editor and blocks saving its draft', async () => {
  const { context: c, elements: e, calls } = fixture();
  c.openTableOrder();
  c.state.pendingFinish = { winnerSeatId: 0, undoUntil: 20000 };
  c.syncTableOrderControls();
  assert.equal(e.tableOrderDialog.open, false);
  assert.equal(e.adjustTableOrderButton.hidden, true);
  await c.saveTableOrder();
  assert.equal(calls.length, 0);
});

test('draft moves and cancelling do not change shared order; reopening discards the draft', () => {
  const { context: c, elements: e, calls } = fixture();
  c.openTableOrder(); c.moveTableOrderSeat(3, -1);
  assert.deepEqual(c.state.lifecycle.seatIds, [0, 1, 3]); assert.equal(calls.length, 0);
  e.tableOrderDialog.close(); c.openTableOrder();
  assert.equal(runInContext('JSON.stringify(tableOrderDraft.seatIds)', c), '[0,1,3]');
});

test('saving sends the draft once, shows pending feedback and preserves the current turn', async () => {
  let finish;
  const page = fixture(() => new Promise(resolve => { finish = resolve; }));
  const c = page.context, before = structuredClone(c.state.turn);
  c.openTableOrder(); c.moveTableOrderSeat(3, -1);
  const pending = c.saveTableOrder(); await c.saveTableOrder();
  assert.deepEqual(page.calls, [[0, 3, 1]]);
  assert.equal(page.elements.saveTableOrderButton.disabled, true);
  assert.equal(page.elements.saveTableOrderButton.textContent, 'Saving…');
  finish({}); await pending;
  assert.deepEqual(c.state.turn, before); assert.equal(page.elements.tableOrderDialog.open, false);
});

test('a failed save keeps the draft and permits retry', async () => {
  let attempts = 0;
  const page = fixture(async () => { if (++attempts === 1) throw new Error('Connection unavailable. Try again.'); return {}; });
  const c = page.context; c.openTableOrder(); c.moveTableOrderSeat(3, -1); await c.saveTableOrder();
  assert.equal(page.elements.tableOrderDialog.open, true); assert.match(page.elements.tableOrderStatus.textContent, /Connection unavailable/);
  assert.equal(page.elements.saveTableOrderButton.disabled, false); await c.saveTableOrder();
  assert.deepEqual(page.calls, [[0, 3, 1], [0, 3, 1]]);
});

test('a conflicting or disconnected save stays open and never reports success', async () => {
  for (const result of [{ conflict: true }, { blocked: true }, { ignored: true }]) {
    const page = fixture(async () => result); page.context.openTableOrder(); await page.context.saveTableOrder();
    assert.equal(page.elements.tableOrderDialog.open, true); assert.ok(page.elements.tableOrderStatus.textContent);
  }
});

test('a draft cannot be saved into a different game', async () => {
  const page = fixture(); page.context.openTableOrder(); page.context.state.turn.gameStartedAt = 999;
  await page.context.saveTableOrder(); assert.equal(page.calls.length, 0);
});

test('native dismissal during a pending save retains conflict feedback and retry', async () => {
  let finish;
  const page = fixture(() => new Promise(resolve => { finish = resolve; }));
  page.context.openTableOrder(); const pending = page.context.saveTableOrder();
  let prevented = false;
  assert.equal(typeof page.elements.tableOrderDialog.handlers.cancel, 'function');
  page.elements.tableOrderDialog.handlers.cancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); finish({ conflict: true }); await pending;
  assert.equal(page.elements.tableOrderDialog.open, true);
  assert.match(page.elements.tableOrderStatus.textContent, /Review the order/);
  assert.equal(page.elements.saveTableOrderButton.disabled, false);
});

test('local simulation handoffs follow the corrected table order too', async () => {
  const state = {
    localSimulation: true, activePlayerId: 'P1', turnSeatId: 'P1', lifecycle: { seatIds: [0, 2, 1] },
    turn: { gameStarted: true, turnStartedAt: 100, turnNumber: 1, startingPlayerSeatId: 0 },
    players: [1, 2, 3].map(id => ({ id: `P${id}`, connectionStatus: 'connected' })),
  };
  await runInNewContext(app.slice(app.indexOf('async function handoffTurn('), app.indexOf('async function chooseStartingPlayer(')) + '\nhandoffTurn();', {
    state, transport: { status: 'local' }, evaluatePlayer() {}, showTurnHandoff() {}, render() {},
  });
  assert.equal(state.turnSeatId, 'P3');
});
