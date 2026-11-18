import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext, Script } from 'node:vm';
import { tournamentTableFlow } from './tournament-table-flow.mjs';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const start = app.indexOf('async function leaveFinishedTournamentTable(');
let source;
for (let end = app.indexOf('}', start); end >= 0; end = app.indexOf('}', end + 1)) {
  try { const candidate = app.slice(start, end + 1); new Script(`(${candidate})`); source = candidate; break; } catch { /* Read the full function. */ }
}
assert.ok(source);

function harness({ refreshResult = {}, leaveResult = { left: true }, intermission = false, disconnectOnLeave = false } = {}) {
  const calls = [];
  const state = { podCode: 'OLD111', gameResult: { winnerSeatId: 0 }, lifecycle: { status: intermission ? 'intermission' : 'complete' } };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const scope = {
    state, tournamentTableContext: { linked: true, kind: 'tournament', code: 'OLD111' }, tournamentTableFlow,
    awardProfileEpoch: 0,
    transport: { roomCode: 'OLD111', seatId: 0, sessionEpoch: 1, status: 'connected', refreshRoom: async () => { await gate; return refreshResult; }, leaveIntermission: async () => { calls.push('serverLeave'); if (disconnectOnLeave) scope.transport.status = 'disconnected'; return leaveResult; } },
    forgetCurrentTable: () => calls.push('forgot:' + scope.state.podCode), leaveTable: () => calls.push('left:' + scope.state.podCode),
  };
  const leave = runInNewContext(source + '\nleaveFinishedTournamentTable', scope);
  return { calls, scope, release, leave };
}

test('finished Table departure never clears a different session opened during refresh', async () => {
  const f = harness(); const pending = f.leave();
  f.scope.transport.roomCode = 'NEW222'; f.scope.transport.sessionEpoch++;
  f.scope.state = { ...f.scope.state, podCode: 'NEW222' };
  f.scope.tournamentTableContext = { ...f.scope.tournamentTableContext, code: 'NEW222' };
  f.release(); await assert.rejects(pending, /changed|again/i); assert.deepEqual(f.calls, []);
});
test('ignored refresh cannot release or forget a Table', async () => {
  const f = harness({ refreshResult: { ignored: true } }); const pending = f.leave(); f.release();
  await assert.rejects(pending, /changed|again/i); assert.deepEqual(f.calls, []);
});
test('a genuine finished intermission departure frees the seat before forgetting it', async () => {
  const f = harness({ intermission: true }); const pending = f.leave(); f.release(); await pending;
  assert.deepEqual(f.calls, ['serverLeave', 'forgot:OLD111', 'left:OLD111']);
});
test('a conflicting intermission leave preserves the current session', async () => {
  const f = harness({ intermission: true, leaveResult: { conflict: true } }); const pending = f.leave(); f.release();
  await assert.rejects(pending, /changed/i); assert.deepEqual(f.calls, ['serverLeave']);
});
test('the normal server stream closure after a successful leave does not prevent continuing', async () => {
  const f = harness({ intermission: true, disconnectOnLeave: true }); const pending = f.leave(); f.release(); await pending;
  assert.deepEqual(f.calls, ['serverLeave', 'forgot:OLD111', 'left:OLD111']);
});
