import assert from 'node:assert/strict';
import test from 'node:test';
import { createRealtimeServer } from '../src/app.js';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';

const original = { noteId: 'note-a', gameId: 'a-original', text: 'Keep the correct next player',
  createdAt: 10, authorName: 'Player', authorSeatId: 0, roomCode: 'ABC123' };
const review = { noteId: original.noteId, gameId: original.gameId, status: 'addressed',
  ownerNote: '2026-11-18: verified', updatedAt: 100 };

function fixture(playtests = {}) {
  const data = structuredClone(playtests);
  let failWrites = false;
  const ledger = new FirebasePlaytestLedger({ databaseUrl: 'https://fixture.invalid',
    clientEmail: 'fixture@example.test', privateKey: 'fixture-only', logger: { error() {} },
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (!options.method) {
        assert.equal(path, '/playtests.json');
        return Response.json(data);
      }
      const match = /^\/playtests\/([^/]+)\/feedback\/([^/]+)\.json$/.exec(path);
      assert.ok(match, path);
      assert.equal(options.method, 'PUT');
      const value = JSON.parse(options.body);
      if (typeof failWrites === 'function' ? failWrites(value) : failWrites) return new Response(null, { status: 503 });
      const game = data[decodeURIComponent(match[1])] ||= {};
      (game.feedback ||= {})[decodeURIComponent(match[2])] = value;
      return Response.json({ saved: true });
    },
  });
  ledger.accessToken = async () => 'fixture-token';
  return { ledger, data, setFailure(value) { failWrites = value; } };
}

for (const reverse of [false, true]) {
  test(`feedback review survives carried recap in either storage order (${reverse})`, async () => {
    const entries = [
      ['a-original', { notes: { 'note-a': original }, feedback: { 'note-a': review } }],
      ['z-later', { recap: { roomCode: 'ABC123', notes: [{ ...original }] } }],
    ];
    const { ledger, data } = fixture(Object.fromEntries(reverse ? entries.reverse() : entries));
    const before = structuredClone(data);
    assert.deepEqual(await ledger.listFeedback(), [{ ...original,
      status: review.status, ownerNote: review.ownerNote, updatedAt: review.updatedAt }]);
    assert.deepEqual(data, before, 'reading never rewrites original history');
  });
}

test('review also survives a later standalone copy of the same note', async () => {
  const { ledger } = fixture({
    'a-original': { notes: { 'note-a': original }, feedback: { 'note-a': review } },
    'z-later': { notes: { 'note-a': { ...original } } },
  });
  assert.equal((await ledger.listFeedback())[0].ownerNote, review.ownerNote);
});

for (const reverse of [false, true]) {
  test(`latest review wins without changing original context (${reverse})`, async () => {
    const newer = { ...review, gameId: 'z-later', status: 'open', ownerNote: 'Needs device test',
      updatedAt: 200, text: 'Must not replace feedback', createdAt: 999, authorName: 'Wrong author' };
    const entries = [
      ['a-original', { notes: { 'note-a': original }, feedback: { 'note-a': review } }],
      ['z-later', { recap: { notes: [{ ...original }] }, feedback: { 'note-a': newer } }],
    ];
    const { ledger } = fixture(Object.fromEntries(reverse ? entries.reverse() : entries));
    assert.deepEqual(await ledger.listFeedback(), [{ ...original, status: 'open',
      ownerNote: newer.ownerNote, updatedAt: newer.updatedAt }]);
  });
}

test('equally dated reviews deterministically prefer the original game', async () => {
  const later = { ...review, gameId: 'z-later', status: 'dismissed', ownerNote: 'Legacy copy' };
  const entries = [
    ['z-later', { recap: { notes: [{ ...original }] }, feedback: { 'note-a': later } }],
    ['a-original', { notes: { 'note-a': original }, feedback: { 'note-a': review } }],
  ];
  for (const ordered of [entries, [...entries].reverse()]) {
    const { ledger } = fixture(Object.fromEntries(ordered));
    assert.equal((await ledger.listFeedback())[0].ownerNote, review.ownerNote);
  }
});

test('unrelated or mismatched reviews do not create or replace a feedback note', async () => {
  const { ledger } = fixture({ 'a-original': { notes: { 'note-a': original }, feedback: {
    'note-a': { ...review, noteId: 'different-note' },
    orphan: { ...review, noteId: 'orphan' },
  } } });
  assert.deepEqual(await ledger.listFeedback(), [original]);
});

test('failed review write rejects and can be explicitly retried', async () => {
  const { ledger, setFailure } = fixture({ 'a-original': { notes: { 'note-a': original } } });
  setFailure(true);
  await assert.rejects(ledger.updateFeedback(review), /Firebase ledger write failed/);
  assert.deepEqual(await ledger.listFeedback(), [original]);
  setFailure(false);
  await ledger.updateFeedback(review);
  assert.equal((await ledger.listFeedback())[0].status, 'addressed');
});

test('a failed concurrent review rejects without blocking the next save for that note', async () => {
  const { ledger, setFailure } = fixture({ 'a-original': { notes: { 'note-a': original } } });
  setFailure(value => value.ownerNote === 'Rejected update');
  const nextReview = { ...review, ownerNote: 'Next update saved', updatedAt: 200 };
  const results = await Promise.allSettled([
    ledger.updateFeedback({ ...review, ownerNote: 'Rejected update' }),
    ledger.updateFeedback(nextReview),
  ]);
  assert.equal(results[0].status, 'rejected');
  assert.match(results[0].reason.message, /Firebase ledger write failed/);
  assert.equal(results[1].status, 'fulfilled');
  assert.equal((await ledger.listFeedback())[0].ownerNote, nextReview.ownerNote);
  setFailure(false);
  await ledger.updateFeedback({ ...review, ownerNote: 'Subsequent update saved', updatedAt: 300 });
  assert.equal((await ledger.listFeedback())[0].ownerNote, 'Subsequent update saved');
});

test('feedback PATCH reports a failed durable write, then saves and reads back after retry', async t => {
  const { ledger, setFailure } = fixture({
    'a-original': { notes: { 'note-a': original } },
    'z-later': { recap: { notes: [{ ...original }] } },
  });
  const { server } = createRealtimeServer({ ledger, feedbackPortalKey: 'fixture-owner' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = { 'content-type': 'application/json', 'x-feedback-portal-key': 'fixture-owner' };
  const save = () => fetch(base + '/api/feedback/note-a', { method: 'PATCH', headers,
    body: JSON.stringify({ gameId: original.gameId, status: 'addressed', ownerNote: 'Verified retry' }) });
  assert.equal((await fetch(base + '/api/feedback')).status, 403);
  setFailure(true);
  assert.equal((await save()).status, 500);
  setFailure(false);
  assert.equal((await save()).status, 200);
  const read = await fetch(base + '/api/feedback', { headers }).then(response => response.json());
  assert.equal(read.notes.length, 1);
  assert.equal(read.notes[0].status, 'addressed');
  assert.equal(read.notes[0].ownerNote, 'Verified retry');
  assert.equal(read.notes[0].gameId, original.gameId);
  assert.equal(read.notes[0].text, original.text);
});
