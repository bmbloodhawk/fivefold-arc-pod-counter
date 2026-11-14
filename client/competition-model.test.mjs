import assert from 'node:assert/strict';
import test from 'node:test';
import { orderFromChoices, finishingChoices, localDateKey, parseCompetitionFragment, setupObservationKey, contextObservationKey } from './competition-model.mjs';

test('finishing order UI requires every starter; equal choices form explicit ordered ties', () => {
  assert.deepEqual(orderFromChoices(['a', 'b', 'c', 'd'], { a: 1, b: 1, c: 3, d: 4 }), [['a', 'b'], ['c'], ['d']]);
  assert.throws(() => orderFromChoices(['a', 'b'], { a: 1 }), /every/);
  assert.throws(() => orderFromChoices(['a', 'b'], { a: 0, b: 1 }), /position/);
  assert.deepEqual(finishingChoices([['a', 'b'], ['c'], ['d']]), { a: 1, b: 1, c: 3, d: 4 });
});
test('history date keys use the viewer’s local calendar without a location request', () => {
  const date = new Date(2026, 10, 11, 0, 1);
  assert.equal(localDateKey(date.getTime()), '2026-11-11');
});
test('invite and event guest fragments are bounded private capabilities, never arbitrary navigation', () => {
  assert.deepEqual(parseCompetitionFragment('#invite=pod.pod_123.secret'), { invite: 'pod.pod_123.secret' });
  assert.deepEqual(parseCompetitionFragment('#event=event_123&guest=guest_secret'), { eventId: 'event_123', guestToken: 'guest_secret' });
  assert.equal(parseCompetitionFragment('#event=../../private&guest=secret'), null);
  assert.equal(parseCompetitionFragment('#invite=' + 'a'.repeat(500)), null);
  assert.equal(parseCompetitionFragment('#unrelated'), null);
});
test('life changes never trigger setup observation requests; actual setup and reclaim transitions do', () => {
  const snapshot = { code: 'TABLE1', lifecycle: { status: 'lobby', seatIds: [0, 1] }, hostSeatId: 0,
    seats: [{ seatId: 0, claimed: true }, { seatId: 1, claimed: true }], version: 1 };
  const key = setupObservationKey(snapshot, 0, 'connection_one', 1);
  assert.equal(setupObservationKey({ ...snapshot, version: 99, seats: snapshot.seats.map(seat => ({ ...seat, counters: { life: 3 } })) }, 0, 'connection_one', 1), key);
  assert.notEqual(setupObservationKey(snapshot, 0, 'connection_two', 1), key);
  assert.notEqual(setupObservationKey({ ...snapshot, lifecycle: { ...snapshot.lifecycle, status: 'intermission' } }, 0, 'connection_one', 1), key);
  assert.equal(setupObservationKey({ ...snapshot, lifecycle: { status: 'playing' } }, 0, 'connection_one', 1), null);
});

test('a reclaimed live Table receives one context discovery, independent of all life/version changes', () => {
  const snapshot = { code: 'TABLE1', lifecycle: { status: 'playing' }, version: 1 };
  const key = contextObservationKey(snapshot, 0, 'reclaimed_connection', 1);
  assert.ok(key);
  assert.equal(contextObservationKey({ ...snapshot, version: 88, seats: [{ counters: { life: 1 } }] }, 0, 'reclaimed_connection', 1), key);
  assert.notEqual(contextObservationKey(snapshot, 0, 'another_connection', 1), key);
  assert.notEqual(contextObservationKey(snapshot, 0, 'reclaimed_connection', 2), key);
});
