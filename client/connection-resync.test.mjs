import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { connectionPresentation } from './connection-state.js';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
// Execute the production renderer with simple DOM/timer boundaries. This tests
// its state transitions without replacing the connection policy with a mock.
const renderer = app.slice(app.indexOf('function renderConnection('), app.indexOf('function saveLocal('));
function fixture() {
  const element = () => ({ hidden: true, dataset: {}, textContent: '' });
  const context = vm.createContext({
    state: null, awaitingConfirmedResync: false, optimisticLifeDelta: 0,
    syncBannerTimer: null, transport: { status: 'local' },
    connectionPresentation, clearTimeout() {}, lifeBatcher: { clear() {} },
    dom: { connectionButton: element(), connectionText: element(), disconnectBanner: element(), connectionDetail: element(), syncBanner: element() },
  });
  vm.runInContext(renderer, context);
  return context;
}

test('first table connection never schedules a later resync notice', () => {
  const ui = fixture();
  ui.renderConnection('waiting');
  assert.equal(ui.awaitingConfirmedResync, false);
  ui.state = { localSimulation: false };
  ui.renderConnection('connected');
  assert.equal(ui.awaitingConfirmedResync, false);
});

test('a genuine shared-table reconnect retains its pending confirmed acknowledgement', () => {
  const ui = fixture();
  ui.state = { localSimulation: false };
  ui.dom.syncBanner.hidden = false;
  ui.renderConnection('disconnected');
  assert.equal(ui.awaitingConfirmedResync, true);
  assert.equal(ui.dom.syncBanner.hidden, true);
  ui.renderConnection('waiting');
  ui.renderConnection('connected');
  assert.equal(ui.awaitingConfirmedResync, true);
  assert.equal(ui.dom.disconnectBanner.hidden, true);
});

test('leaving a shared session clears its pending notice before a local or new game', () => {
  const ui = fixture();
  ui.state = { localSimulation: false };
  ui.awaitingConfirmedResync = true;
  ui.dom.syncBanner.hidden = false;
  ui.renderConnection('local');
  assert.equal(ui.awaitingConfirmedResync, false);
  assert.equal(ui.dom.syncBanner.hidden, true);
  ui.state = null;
  ui.renderConnection('waiting');
  assert.equal(ui.awaitingConfirmedResync, false);
});

test('a local preview cannot leave a shared resync acknowledgement pending', () => {
  const ui = fixture();
  ui.state = { localSimulation: true };
  ui.renderConnection('disconnected');
  assert.equal(ui.awaitingConfirmedResync, false);
});
