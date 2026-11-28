import assert from 'node:assert/strict';
import test from 'node:test';
import { createStartingCommanderEvidenceResolver, startingCommanderEvidenceFor } from '../src/starting-commander-evidence.js';
import { RoomService } from '../src/app.js';
import { MemoryPlaytestLedger } from '../src/playtest-ledger.js';

const eligibility = {
  version: 'test-v1',
  cards: [
    { oracleId: 'eligible-a', name: 'Commander A', aliases: ['Printed Alias A'] },
    { oracleId: 'eligible-b', name: 'Commander B', aliases: [] },
  ],
};
const cardIndex = { sourceSha256: 'test-index', cards: [{ name: 'Partner C', aliases: ['Alias C'] }] };
const resolveEvidence = createStartingCommanderEvidenceResolver({ eligibility, cardIndex });

test('starting evidence uses exact reviewed aliases and canonical identities, independent of printing or partner order', () => {
  const canonical = resolveEvidence(['Commander A', 'Commander B']);
  const reversed = resolveEvidence(['Commander B', 'Printed Alias A']);
  assert.equal(canonical.resolved, true);
  assert.equal(canonical.eligibilityVersion, 'test-v1');
  assert.deepEqual(canonical.cards.map(card => card.identity).sort(), reversed.cards.map(card => card.identity).sort());
  assert.deepEqual(canonical.cards.map(card => card.oracleId), ['eligible-a', 'eligible-b']);
  assert.equal(resolveEvidence(['commander a']).cards[0].oracleId, 'eligible-a');
  assert.equal(resolveEvidence(['Commander A extra']).resolved, false);
  assert.equal(resolveEvidence(['Commander']).resolved, false);
  assert.equal(resolveEvidence(['Commander A', 'Unknown Partner']).resolved, false);
});

test('mixed partner lineups retain the exact canonical identity of an ineligible card', () => {
  const evidence = resolveEvidence(['Printed Alias A', 'Alias C']);
  assert.equal(evidence.resolved, true);
  assert.deepEqual(evidence.cards, [
    { identity: 'oracle:eligible-a', oracleId: 'eligible-a', name: 'Commander A', matchedName: 'printed alias a' },
    { identity: 'name:Partner C', name: 'Partner C', matchedName: 'alias c' },
  ]);
  assert.deepEqual(resolveEvidence(['Partner C', 'Commander A']).cards.map(card => card.identity).sort(), evidence.cards.map(card => card.identity).sort());
  assert.equal(resolveEvidence(['Commander A', 'Printed Alias A']).resolved, false);
});

test('ambiguous aliases fail closed instead of choosing a card identity', () => {
  const resolve = createStartingCommanderEvidenceResolver({ eligibility: {
    version: 'ambiguous', cards: [{ oracleId: 'one', name: 'One', aliases: ['Shared'] }, { oracleId: 'two', name: 'Two', aliases: ['Shared'] }],
  }, cardIndex });
  assert.equal(resolve(['Shared']).resolved, false);
});

test('actual Trek partner reskins share their canonical identities with mechanical names while retaining which name started', () => {
  const trek = startingCommanderEvidenceFor(['Tendi, Exploring the Future', 'Rutherford, Rebuilding the Past']);
  const mechanical = startingCommanderEvidenceFor(['Silas Renn, Seeker Adept', 'Thrasios, Triton Hero']);
  assert.equal(trek.resolved, true);
  assert.equal(mechanical.resolved, true);
  assert.deepEqual(trek.cards.map(card => card.identity).sort(), mechanical.cards.map(card => card.identity).sort());
  assert.equal(trek.cards[0].matchedName, 'tendi, exploring the future');
  assert.equal(mechanical.cards[1].matchedName, 'thrasios, triton hero');
  const ascii = startingCommanderEvidenceFor(['Vox, Child of the Collective']);
  const accented = startingCommanderEvidenceFor(['Võx, Child of the Collective']);
  assert.equal(ascii.cards[0].identity, accented.cards[0].identity);
  assert.equal(startingCommanderEvidenceFor(['Loran of the Third Path']).cards[0].oracleId, undefined);
});

function fixture() {
  let now = Date.UTC(2026, 10, 27, 12);
  const ledger = new MemoryPlaytestLedger();
  const service = new RoomService({ ledger, now: () => now, connectionTtlMs: 7 * 86_400_000, startingCommanderEvidenceFor: resolveEvidence });
  const owners = Array.from({ length: 2 }, () => service.createConnection());
  const created = service.createRoom(owners[0].connectionId, { playerCount: 2, startingLife: 40, name: 'Host', commanderNames: ['Commander A'] });
  const code = created.snapshot.code;
  service.claimSeat(code, owners[1].connectionId, { seatId: 1, name: 'Partner', commanderNames: ['Commander B'] });
  const room = service.room(code);
  const act = (method, seatId = 0, input = {}) => service[method](code, owners[seatId].connectionId, { baseVersion: room.version, ...input });
  return { service, ledger, owners, code, room, act, setNow: value => { now = value; } };
}

test('game start freezes evidence and midgame commander edits leave it and frozen completion untouched', () => {
  const f = fixture();
  f.act('startGame');
  const starting = structuredClone(f.room.turn.startingCommanderEvidence);
  f.act('mutateOwnSeat', 0, { commanderNames: ['Commander B'] });
  assert.equal(f.room.seats[0].commanderNames[0], 'Commander B');
  assert.deepEqual(f.room.turn.startingCommanderEvidence, starting);
  f.setNow(Date.UTC(2026, 10, 28, 0, 0));
  f.act('declareWinner', 0, { winnerSeatId: 1, winCondition: 'other_declared' });
  const complete = f.service.completedSeat(f.code, f.owners[0].connectionId, f.room.gameId);
  assert.equal(complete.game.commanderName, 'Commander B');
  assert.deepEqual(complete.game.startingCommanderEvidence, starting[0]);
  assert.equal(complete.completedAt, Date.UTC(2026, 10, 28, 0, 0));
  assert.equal(complete.game.achievementFacts.turnCount, 0);
  f.setNow(Date.UTC(2026, 10, 29, 0, 0));
  assert.equal(f.service.completedSeat(f.code, f.owners[0].connectionId, f.room.gameId).completedAt, complete.completedAt);
});

test('starting proof survives durable recovery and a rematch freezes a new lineup', async () => {
  const f = fixture(); f.act('startGame');
  const starting = structuredClone(f.room.turn.startingCommanderEvidence);
  const recovered = new RoomService({ ledger: f.ledger, now: f.service.now, autoRecoverRooms: true, startingCommanderEvidenceFor: resolveEvidence });
  await recovered.ensureRoom(f.code);
  assert.deepEqual(recovered.room(f.code).turn.startingCommanderEvidence, starting);
  f.act('declareWinner', 0, { winnerSeatId: 0, winCondition: 'other_declared' });
  const previous = structuredClone(f.room.completedGames[0].seats[0].game.startingCommanderEvidence);
  f.act('beginIntermission');
  f.act('setNextGameSetup', 0, { commanderCount: 1, commanderNames: ['Commander B'], commanderColors: [[]] });
  f.act('setNextGameReady', 0); f.act('setNextGameReady', 1); f.act('startGame');
  assert.equal(f.room.turn.startingCommanderEvidence[0].cards[0].oracleId, 'eligible-b');
  assert.deepEqual(f.room.completedGames[0].seats[0].game.startingCommanderEvidence, previous);
});

test('legacy recovery without starting evidence never derives proof from mutable final names', () => {
  const f = fixture(); f.act('startGame');
  delete f.room.turn.startingCommanderEvidence;
  f.act('declareWinner', 0, { winnerSeatId: 0, winCondition: 'other_declared' });
  assert.equal(f.service.completedSeat(f.code, f.owners[0].connectionId, f.room.gameId).game.startingCommanderEvidence, undefined);
});

test('frozen mission inputs preserve recorded personal turns and handoff undo rather than table rounds', () => {
  const f = fixture(); f.act('startGame');
  const starting = structuredClone(f.room.turn.startingCommanderEvidence);
  f.act('handoffTurn', 0); f.act('undoTurnHandoff', 0);
  f.act('handoffTurn', 0); f.act('handoffTurn', 1); f.act('handoffTurn', 0);
  assert.equal(f.room.turn.turnNumber, 2);
  f.act('declareWinner', 0, { winnerSeatId: 0, winCondition: 'other_declared' });
  const host = f.service.completedSeat(f.code, f.owners[0].connectionId, f.room.gameId);
  const other = f.service.completedSeat(f.code, f.owners[1].connectionId, f.room.gameId);
  assert.equal(host.game.achievementFacts.turnCount, 2);
  assert.equal(other.game.achievementFacts.turnCount, 1);
  assert.equal(host.game.achievementFacts.tableTurnNumber, 2);
  assert.deepEqual(host.game.startingCommanderEvidence, starting[0]);
});

test('abandoned games supply no completion evidence and a reset cannot leak the old starting lineup', () => {
  const f = fixture(); f.act('startGame');
  const abandonedGameId = f.room.gameId;
  f.act('resetRoom');
  assert.throws(() => f.service.completedSeat(f.code, f.owners[0].connectionId, abandonedGameId), { code: 'COMPLETION_UNAVAILABLE' });
  assert.equal(f.room.turn.startingCommanderEvidence, undefined);
  f.act('mutateOwnSeat', 0, { commanderNames: ['Commander B'] });
  f.act('startGame');
  assert.equal(f.room.turn.startingCommanderEvidence[0].cards[0].oracleId, 'eligible-b');
});
