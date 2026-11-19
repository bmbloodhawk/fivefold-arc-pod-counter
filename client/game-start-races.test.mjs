import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const extract = (from, to) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function startFixture() {
  const before = deferred(), response = deferred();
  const context = createContext({ state: { podCode: 'ABC123', turn: { gameStarted: false }, lifecycle: { status: 'lobby' } },
    gameStartRequest: null, calls: 0, errors: [], renderTurnFlow() {},
    competitionHub: { beforeStart: () => before.promise },
    transport: { sessionEpoch: 1, startGame() { context.calls++; return response.promise; } },
    showError: error => context.errors.push(error.message), showTableRequestError: error => context.errors.push(error.message),
    showTableActionError: message => context.errors.push(message),
  });
  runInContext(extract('async function startGame(', 'async function undoTurnHandoff('), context);
  return { context, before, response };
}
test('two initial Start taps submit one start while tournament setup is pending', async () => {
  const f = startFixture(), a = f.context.startGame(), b = f.context.startGame();
  f.before.resolve(); f.response.resolve({}); await Promise.all([a, b]);
  assert.equal(f.context.calls, 1); assert.deepEqual(f.context.errors, []);
});
test('an initial start cannot apply after the player leaves that Table during setup', async () => {
  const f = startFixture(), pending = f.context.startGame();
  f.context.transport.sessionEpoch++; f.context.state.podCode = 'OTHER1'; f.before.resolve(); f.response.resolve({}); await pending;
  assert.equal(f.context.calls, 0);
});
test('a failed initial Start allows a deliberate retry', async () => {
  const f = startFixture(), pending = f.context.startGame(); f.before.resolve(); f.response.reject(new Error('Offline')); await pending;
  f.context.transport.startGame = async () => { f.context.calls++; return {}; };
  await f.context.startGame(); assert.equal(f.context.calls, 2); assert.deepEqual(f.context.errors, ['Offline']);
});
test('an old Start failure does not show a connection error in a new Table', async () => {
  const f = startFixture(), pending = f.context.startGame(); f.before.resolve(); await new Promise(resolve => setImmediate(resolve));
  f.context.transport.sessionEpoch++; f.context.state.podCode = 'OTHER1'; f.response.reject(new Error('Old failure')); await pending;
  assert.deepEqual(f.context.errors, []);
});
function rollFixture() {
  const context = createContext({ state: { ownerPlayerId: 'P1', players: Array.from({ length: 8 }, (_, i) => ({ id: `P${i + 1}` })) },
    localStartingRollKey: null, pendingStartingRoll: null,
    dom: { startingRollDialog: { open: true }, rollMyD20Button: {}, startingRollStatus: {} },
    renderStartingRollDice() {}, displayName: player => player.id, render() {},
  });
  runInContext(extract('function showStartingPlayerRoll(', 'async function rollMyStartingD20('), context); return context;
}
test('the first d20 round with two claimed seats in eight slots does not announce a tie', () => {
  const c = rollFixture(); c.showStartingPlayerRoll({ startedAt: 1, status: 'rolling', rounds: [{ contenderSeatIds: [0, 1], rolls: [] }] });
  assert.equal(c.dom.startingRollStatus.textContent, 'ROLL WHEN YOU ARE READY');
});
test('a real second d20 round announces the reroll', () => {
  const c = rollFixture(); c.showStartingPlayerRoll({ startedAt: 1, status: 'rolling', rounds: [{ contenderSeatIds: [0, 1], rolls: [{ seatId: 0, value: 10 }, { seatId: 1, value: 10 }] }, { contenderSeatIds: [0, 1], rolls: [] }] });
  assert.equal(c.dom.startingRollStatus.textContent, 'TIE — ROLL AGAIN');
});
