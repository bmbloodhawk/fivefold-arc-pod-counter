import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { eliminationUndoPresentation } from './elimination-undo.js';
import { captureLocalElimination, rememberLocalElimination, undoLocalElimination } from './local-elimination-undo.js';

const [app, html] = await Promise.all(['app.js', 'index.html'].map(name => readFile(new URL(name, import.meta.url), 'utf8')));
function section(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'The elimination action is integrated into the game');
  return app.slice(from, to);
}
function harness(send) {
  const calls = { sends: [], renders: 0, clears: 0, errors: [], closedOverlays: 0 };
  const owner = { id: 'P1', eliminated: true, eliminationUndo: { id: 'own-elimination', expiresAt: Date.now() + 15000 } };
  const context = {
    state: { ownerPlayerId: 'P1', activePlayerId: 'P2', lifecycle: { status: 'playing' }, players: [owner] },
    pendingEliminationUndoId: null, announcedEliminationUndoId: null,
    transport: { status: 'connected', async undoElimination(id) { calls.sends.push(id); return send(); } },
    eliminationUndoPresentation, render() { calls.renders++; },
    dom: { undoEliminationButton: {}, eliminationUndoStatus: {} },
    lifeBatcher: { clear() { calls.clears++; } }, optimisticLifeDelta: -1,
    lifeChange: {}, lifeChangeTimer: null, clearTimeout() {},
    showTableRequestError(error) { calls.errors.push(error.message); },
    showTableActionError(message) { calls.errors.push(message); },
    closeGameOverlays() { calls.closedOverlays++; }, closeGameMenu() {},
  };
  const api = runInNewContext(section('function renderEliminationUndo(', 'function radiationTurnKey(') + '\n({renderEliminationUndo, undoElimination})', context);
  return { api, calls, context };
}

test('elimination undo uses the handoff button style and placement', () => {
  const controls = html.match(/<section id="turnActions"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(controls, /id="undoEliminationButton" class="undo-turn-button" type="button"/);
  assert.match(html, /id="eliminationUndoStatus"[^>]*role="status"/);
});

test('elimination render shows a live countdown without repeating its announcement', () => {
  const { api, context } = harness(async () => ({}));
  api.renderEliminationUndo();
  assert.equal(context.dom.undoEliminationButton.hidden, false);
  assert.equal(context.dom.undoEliminationButton.disabled, false);
  assert.match(context.dom.undoEliminationButton.textContent, /Undo elimination · 15s/);
  const firstAnnouncement = context.dom.eliminationUndoStatus.textContent;
  context.state.players[0].eliminationUndo.expiresAt -= 5000;
  api.renderEliminationUndo();
  assert.match(context.dom.undoEliminationButton.textContent, /Undo elimination · 10s/);
  assert.equal(context.dom.eliminationUndoStatus.textContent, firstAnnouncement);
});

test('only one undo request runs; success returns inspection to own seat and clears stale life preview', async () => {
  let resolve;
  const { api, calls, context } = harness(() => new Promise(done => { resolve = done; }));
  const first = api.undoElimination();
  await api.undoElimination();
  assert.deepEqual(calls.sends, ['own-elimination']);
  resolve({ snapshot: {} });
  await first;
  assert.equal(context.pendingEliminationUndoId, null);
  assert.equal(context.state.activePlayerId, 'P1');
  assert.equal(context.optimisticLifeDelta, 0);
  assert.equal(context.lifeChange, null);
  assert.equal(calls.clears, 1);
});

test('failed undo leaves the action retryable and preserves the confirmed state', async () => {
  const { api, calls, context } = harness(async () => { throw Object.assign(new Error('Temporary error'), { status: 503 }); });
  await api.undoElimination();
  assert.equal(context.pendingEliminationUndoId, null);
  assert.equal(context.state.activePlayerId, 'P2');
  assert.equal(calls.clears, 0);
  assert.deepEqual(calls.errors, ['Temporary error']);
  api.renderEliminationUndo();
  assert.equal(context.dom.undoEliminationButton.disabled, false);
});

test('disconnected and expired elimination buttons never submit', async () => {
  const { api, calls, context } = harness(async () => ({}));
  context.transport.status = 'disconnected';
  await api.undoElimination();
  context.transport.status = 'connected';
  context.state.players[0].eliminationUndo.expiresAt = Date.now() - 1;
  await api.undoElimination();
  assert.equal(calls.sends.length, 0);
});

test('an expired or stale response shows authoritative state without a second undo', async () => {
  const { api, calls, context } = harness(async () => ({ conflict: true }));
  await api.undoElimination();
  assert.equal(context.pendingEliminationUndoId, null);
  assert.equal(calls.sends.length, 1);
  assert.equal(calls.clears, 0);
  assert.match(calls.errors[0], /latest|window|changed/i);
});

test('an early restored snapshot cannot accept a new life edit before undo acknowledgement', async () => {
  let resolve;
  const { api, context } = harness(() => new Promise(done => { resolve = done; }));
  const pending = api.undoElimination();
  const added = [];
  const player = context.state.players[0];
  player.eliminated = false; player.life = 9;
  context.state.mode = 'life';
  context.state.activePlayerId = 'P1';
  context.state.pendingFinish = null;
  context.activePlayer = () => player;
  context.currentValue = () => 9;
  context.lifeBatcher.add = delta => added.push(delta);
  context.showLifeChange = () => {};
  context.countersLocked = runInNewContext(section('function countersLocked(', 'function renderMutationAvailability(') + '\ncountersLocked', context);
  const adjust = runInNewContext(section('async function adjust(', 'function remapLocalDamage(') + '\nadjust', context);
  await adjust(1);
  assert.equal(added.length, 0, 'New counter entry stays blocked until Undo is acknowledged');
  resolve({ snapshot: {} });
  await pending;
});

test('local simulation undo restores the eliminating entry without sending shared transport', async () => {
  const { api, context, calls } = harness(async () => ({}));
  const owner = context.state.players[0];
  owner.poison = 10;
  owner.eliminationUndo.before = captureLocalElimination({ ...owner, poison: 9, eliminated: false });
  context.state.localSimulation = true;
  context.state.ownerPlayerId = 'P2';
  context.state.activePlayerId = 'P1';
  context.state.turn = { gameStarted: true };
  context.undoLocalElimination = undoLocalElimination;
  await api.undoElimination();
  assert.equal(owner.poison, 9);
  assert.equal(owner.eliminated, false);
  assert.equal(context.state.activePlayerId, 'P1');
  assert.equal(calls.sends.length, 0);
});

test('the real local counter entry creates a fifteen-second elimination undo', async () => {
  const { context } = harness(async () => ({}));
  const player = context.state.players[0];
  Object.assign(player, { poison: 9, life: 40, eliminated: false, eliminationUndo: null });
  Object.assign(context.state, { localSimulation: true, activePlayerId: 'P1', mode: 'poison', turn: { gameStarted: true, gameStartedAt: Date.now(), turnStartedAt: Date.now() } });
  context.transport.status = 'local';
  context.activePlayer = () => player; context.currentValue = () => player.poison;
  context.countersLocked = () => false;
  context.captureLocalElimination = captureLocalElimination;
  context.rememberLocalElimination = rememberLocalElimination;
  context.evaluatePlayer = p => { p.eliminated = p.poison >= 10; };
  const adjust = runInNewContext(section('async function adjust(', 'function remapLocalDamage(') + '\nadjust', context);
  await adjust(1);
  assert.equal(player.poison, 10);
  assert.ok(player.eliminationUndo?.expiresAt > Date.now() + 14000);
  assert.equal(player.eliminationUndo.before.poison, 9);
  assert.equal(context.state.gameResult, undefined);
});

test('a new elimination exposes Undo by closing blocking overlays once', () => {
  const { api, calls } = harness(async () => ({}));
  api.renderEliminationUndo();
  api.renderEliminationUndo();
  assert.equal(calls.closedOverlays, 1);
});

test('turn tracking cannot unpause a local finish while Undo is available', async () => {
  const context = { state: { localSimulation: true, pendingFinish: { expiresAt: Date.now() + 15000 }, turn: { trackingEnabled: true, pausedAt: 123, turnStartedAt: 100 } }, transport: { status: 'local' }, dom: { gameMenu: {}, moreButton: { setAttribute() {} } }, render() {} };
  const toggle = runInNewContext(section('async function toggleTurnTracking(', 'function openTurnCueDialog(') + '\ntoggleTurnTracking', context);
  await toggle();
  assert.equal(context.state.turn.pausedAt, 123);
  assert.equal(context.state.turn.trackingEnabled, true);
});

test('blocking radiation and name-edit dialogs close when elimination exposes Undo', () => {
  const dialog = () => ({ open: true, close() { this.open = false; } });
  const dom = { radiationDialog: dialog(), editPlayerNameDialog: dialog() };
  const source = app.match(/function closeGameOverlays\(\) \{[^\n]+\}/)?.[0];
  assert.ok(source);
  runInNewContext(source + '\ncloseGameOverlays()', { dom });
  assert.equal(dom.radiationDialog.open, false);
  assert.equal(dom.editPlayerNameDialog.open, false);
});
