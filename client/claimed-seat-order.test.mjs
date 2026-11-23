import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { renderSeatOrder } from './seat-order.js';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
// Player-label helpers remain in app.js and are outside this extraction.
const labels = app.slice(app.indexOf('function tablePositionLabel('), app.indexOf('function displaySource('));
const escapeHtml = value => String(value).replace(/[&<>\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const decode = value => value.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

function rosterContainer() {
  let html = '', buttons = [];
  return {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value;
      buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, markup, text]) => {
        const attributes = Object.fromEntries([...markup.matchAll(/([\w-]+)="([^"]*)"/g)]
          .map(([, name, value]) => [name, decode(value)]));
        const listeners = new Map();
        return {
          dataset: Object.fromEntries(Object.entries(attributes).filter(([name]) => name.startsWith('data-'))
            .map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
          disabled: /\bdisabled(?:\s|$|=)/.test(markup), textContent: text,
          getAttribute(name) { return attributes[name] ?? null; },
          addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(listener);
          },
          click() { if (!this.disabled) for (const listener of listeners.get('click') || []) listener(); },
        };
      });
    },
    querySelectorAll(selector) {
      const attribute = /^\[([^\]]+)\]$/.exec(selector)?.[1];
      return buttons.filter(button => attribute && button.getAttribute(attribute) !== null);
    },
  };
}

function screen(rosterIds, options = {}) {
  const players = options.players || [{ id: 'P1', name: 'Alex' }, { id: 'P2', name: 'Sam' }, { id: 'P4', name: 'Morgan' }];
  const playerLabels = runInNewContext(labels + '\n({ displayName, displayPlayer });', {
    state: { players, lifecycle: { seatIds: rosterIds } },
  });
  const container = rosterContainer(), moves = [], skipped = [];
  const settings = {
    players, isHost: true, hostSeatId: 0, displayName: playerLabels.displayName, escapeHtml,
    onMoveSeat: (...args) => moves.push(args), onSkipSeat: seatId => skipped.push(seatId), ...options,
  };
  const render = (ids = rosterIds, changes = {}) => renderSeatOrder(container, ids, { ...settings, ...changes });
  render();
  return {
    container, moves, skipped, render,
    get html() { return container.innerHTML; },
    displayed: players.map(player => playerLabels.displayPlayer(player)),
    moveButtons: () => container.querySelectorAll('[data-move-seat]'),
    removeButtons: () => container.querySelectorAll('[data-skip-next-seat]'),
  };
}

test('a partially filled lobby displays the claimed P4 rather than renaming it P2', () => {
  const view = screen([0, 3]);
  assert.match(view.html, /<strong>P4 · Morgan<\/strong>/);
  assert.equal(view.displayed[2], 'Morgan · P4');
});

test('host reordering changes displayed order without changing claimed seat labels', () => {
  for (const intermission of [false, true]) {
    const view = screen([3, 0, 1], { intermission });
    assert.deepEqual([...view.html.matchAll(/<strong>(.*?)<\/strong>/g)].map(match => match[1]), ['P4 · Morgan', 'P1 · Alex', 'P2 · Sam']);
    assert.deepEqual(view.displayed, ['Alex · P1', 'Sam · P2', 'Morgan · P4']);
    assert.match(view.html, /data-move-seat="3"/);
  }
});

test('default player names do not acquire a contradictory second P number', () => {
  const value = runInNewContext(labels + '\ndisplayPlayer({ id: "P4", name: "P4" });', { state: { lifecycle: { seatIds: [0, 3] } } });
  assert.equal(value, 'P4');
});

test('the host lobby shows order controls while intermission shows each seat readiness', () => {
  const lobby = screen([3, 0, 1], { readyIds: [0, 3] });
  assert.equal(lobby.moveButtons().length, 6);
  assert.equal(lobby.removeButtons().length, 0);
  assert.deepEqual([...lobby.html.matchAll(/<small>(.*?)<\/small>/g)].map(match => match[1]), ['Table order', 'Table order', 'Table order']);
  const next = screen([3, 0, 1], { intermission: true, readyIds: [0, 3] });
  assert.deepEqual([...next.html.matchAll(/<small>(.*?)<\/small>/g)].map(match => match[1]), ['Ready', 'Ready', 'Waiting for ready']);
});

test('a non-host sees roster labels but no move or Remove actions in either phase', () => {
  for (const intermission of [false, true]) {
    const view = screen([0, 3], { isHost: false, intermission });
    assert.match(view.html, /<strong>P1 · Alex<\/strong>/);
    assert.match(view.html, /<strong>P4 · Morgan<\/strong>/);
    assert.equal(view.moveButtons().length, 0);
    assert.equal(view.removeButtons().length, 0);
  }
});

test('host intermission offers Remove only for seats other than the actual host', () => {
  const view = screen([3, 0, 1], { intermission: true, hostSeatId: 3 });
  assert.deepEqual(view.removeButtons().map(button => button.dataset.skipNextSeat), ['0', '1']);
  assert.ok(view.removeButtons().every(button => button.textContent === 'Remove'));
});

test('arrow boundaries follow roster positions rather than numeric seat labels', () => {
  const view = screen([3, 0, 1]);
  assert.deepEqual(view.moveButtons().map(button => [button.dataset.moveSeat, button.dataset.direction, button.disabled]), [
    ['3', '-1', true], ['3', '1', false], ['0', '-1', false], ['0', '1', false], ['1', '-1', false], ['1', '1', true],
  ]);
  assert.equal(view.moveButtons()[0].getAttribute('aria-label'), 'Move Morgan earlier');
  assert.equal(view.moveButtons()[1].getAttribute('aria-label'), 'Move Morgan later');
  assert.ok(screen([3]).moveButtons().every(button => button.disabled));
});

test('actions pass numeric callback arguments once, including after rerender', () => {
  const view = screen([3, 0, 1], { intermission: true });
  view.moveButtons()[0].click(); // Native disabled buttons do not dispatch clicks.
  view.moveButtons()[1].click();
  view.moveButtons()[4].click();
  view.removeButtons().find(button => button.dataset.skipNextSeat === '3').click();
  assert.deepEqual(view.moves, [[3, 1], [1, -1]]);
  assert.deepEqual(view.skipped, [3]);
  view.render();
  view.moveButtons()[1].click();
  view.removeButtons().find(button => button.dataset.skipNextSeat === '3').click();
  assert.deepEqual(view.moves, [[3, 1], [1, -1], [3, 1]]);
  assert.deepEqual(view.skipped, [3, 3]);
  assert.equal(view.moveButtons().length, 6);
  assert.equal(view.removeButtons().length, 2);
});

test('names are escaped in visible labels and accessible movement labels', () => {
  const name = '<img src=x onerror="boom"> & "Guest"';
  const view = screen([3], { players: [{ id: 'P4', name }] });
  assert.ok(view.html.includes(`<strong>P4 · ${escapeHtml(name)}</strong>`));
  assert.ok(view.html.includes(`aria-label="Move ${escapeHtml(name)} earlier"`));
  assert.equal(view.html.includes('<img'), false);
  assert.equal(view.moveButtons()[0].getAttribute('aria-label'), `Move ${name} earlier`);
});

test('an empty roster clears previously rendered rows and actions', () => {
  const view = screen([0, 3], { intermission: true });
  view.render([]);
  assert.equal(view.html, '');
  assert.equal(view.moveButtons().length, 0);
  assert.equal(view.removeButtons().length, 0);
});
