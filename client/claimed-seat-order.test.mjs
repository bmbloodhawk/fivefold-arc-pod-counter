import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const labels = app.slice(app.indexOf('function tablePositionLabel('), app.indexOf('function displaySource('));
const roster = app.slice(app.indexOf('  const renderSeatOrder ='), app.indexOf('  const lobbyRosterIds ='));

function screen(seatIds, intermission = false) {
  const players = [{ id: 'P1', name: 'Alex' }, { id: 'P2', name: 'Sam' }, { id: 'P4', name: 'Morgan' }];
  const container = { innerHTML: '', querySelectorAll: () => [] };
  const context = {
    state: { players, hostSeatId: 0, lifecycle: { seatIds, readySeatIds: [] } },
    transport: { seatId: 0 }, container, rosterIds: seatIds, intermission,
    escapeHtml: value => String(value),
  };
  const displayed = runInNewContext(labels + roster + '\nrenderSeatOrder(container, rosterIds, { intermission }); state.players.map(displayPlayer);', context);
  return { html: container.innerHTML, displayed: Array.from(displayed) };
}

test('a partially filled lobby displays the claimed P4 rather than renaming it P2', () => {
  const view = screen([0, 3]);
  assert.match(view.html, /<strong>P4 · Morgan<\/strong>/);
  assert.equal(view.displayed[2], 'Morgan · P4');
});

test('host reordering changes displayed order without changing claimed seat labels', () => {
  for (const intermission of [false, true]) {
    const view = screen([3, 0, 1], intermission);
    const labels = [...view.html.matchAll(/<strong>(.*?)<\/strong>/g)].map(match => match[1]);
    assert.deepEqual(labels, ['P4 · Morgan', 'P1 · Alex', 'P2 · Sam']);
    assert.deepEqual(view.displayed, ['Alex · P1', 'Sam · P2', 'Morgan · P4']);
    assert.match(view.html, /data-move-seat="3"/);
  }
});

test('default player names do not acquire a contradictory second P number', () => {
  const value = runInNewContext(labels + '\ndisplayPlayer({ id: "P4", name: "P4" });', { state: { lifecycle: { seatIds: [0, 3] } } });
  assert.equal(value, 'P4');
});
