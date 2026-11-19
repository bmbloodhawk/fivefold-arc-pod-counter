import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { tournamentTableFlow } from './tournament-table-flow.mjs';
const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const start = app.indexOf('function tableViewForState()');
const source = app.slice(start, app.indexOf('\n', start)) + '\ntableViewForState();';
for (const role of ['host', 'non-host']) test(`a completed tournament ${role} has direct postgame navigation before host intermission`, () => {
  const state = { podCode: 'ABC123', lifecycle: { status: 'complete' }, turn: { gameStarted: true }, gameResult: { winnerSeatId: 1 } };
  const context = { linked: true, kind: 'tournament', code: 'ABC123', canAccess: true };
  const dom = { game: 'game', lobby: 'lobby', intermission: 'postgame' };
  assert.equal(runInNewContext(source, { state, tournamentTableContext: context, tournamentTableFlow, dom }), 'postgame');
  assert.equal(state.lifecycle.status, 'complete', 'Choosing a local postgame view must not mutate the shared lifecycle.');
});
for (const context of [null, { linked: true, kind: 'pod', code: 'ABC123' }, { linked: true, kind: 'tournament', code: 'OTHER1' }]) {
  test(`casual or stale tournament context keeps completed game navigation (${context?.kind || 'none'}/${context?.code || 'none'})`, () => {
    assert.equal(runInNewContext(source, { state: { podCode: 'ABC123', lifecycle: { status: 'complete' }, turn: { gameStarted: true } },
      tournamentTableContext: context, tournamentTableFlow, dom: { game: 'game', intermission: 'postgame' } }), 'game');
  });
}
