import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext, Script } from 'node:vm';
const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const start = app.indexOf('function leaveReplacedTournamentTable(');
assert.ok(start >= 0, 'replacement departure is integrated');
let source;
for (let end = app.indexOf('}', start); end >= 0; end = app.indexOf('}', end + 1)) {
  try { const candidate = app.slice(start, end + 1); new Script(`(${candidate})`); source = candidate; break; } catch { /* Find complete body. */ }
}
function harness() {
  const calls = [];
  const scope = { state: { podCode: 'OLD111', turn: { gameStarted: false } }, transport: { roomCode: 'OLD111' },
    tournamentTableContext: { code: 'OLD111', kind: 'tournament', released: true, linked: true },
    forgetCurrentTable() { calls.push('forget'); }, leaveTable() { calls.push('leave'); } };
  return { scope, calls, leave: runInNewContext(source + '\nleaveReplacedTournamentTable', scope) };
}
test('a confirmed released setup departs locally without rewriting the old Table', () => {
  const f = harness(); f.leave('OLD111'); assert.deepEqual(f.calls, ['forget', 'leave']);
});
test('a replacement action cannot clear a different Table opened meanwhile', () => {
  const f = harness(); f.scope.transport.roomCode = 'NEW222';
  assert.throws(() => f.leave('OLD111'), /changed|released/i); assert.deepEqual(f.calls, []);
});
test('unreleased and started Tables cannot use the setup replacement shortcut', () => {
  for (const started of [true, false]) {
    const f = harness(); f.scope.state.turn.gameStarted = started; f.scope.tournamentTableContext.released = started;
    assert.throws(() => f.leave('OLD111'), /changed|released/i); assert.deepEqual(f.calls, []);
  }
});
