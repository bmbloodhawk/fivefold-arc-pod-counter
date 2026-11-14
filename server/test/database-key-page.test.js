import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseKeyCompare, keyPageRequest, keyPageResult } from '../src/database-key-page.js';

test('key-page requests always bound the database response, including a lookahead row', () => {
  const request = keyPageRequest('staging/competitions-v2/history/pod_one.json');
  const url = new URL(request.path, 'https://fixture.invalid/');
  assert.equal(url.pathname, '/staging/competitions-v2/history/pod_one.json');
  assert.equal(url.searchParams.get('orderBy'), '"$key"');
  assert.equal(url.searchParams.get('limitToFirst'), '51');
  assert.equal(url.searchParams.has('limitToLast'), false);
  assert.equal(request.maximumEntries, 51);
});

test('descending pages encode inclusive cursors safely and reserve one boundary row', () => {
  const request = keyPageRequest('competitions-v2/history/pod_one.json', { limit: 2, cursor: 'g_00012_"quoted', direction: 'desc' });
  const url = new URL(request.path, 'https://fixture.invalid/');
  assert.equal(url.searchParams.get('orderBy'), '"$key"');
  assert.equal(url.searchParams.get('endAt'), JSON.stringify('g_00012_"quoted'));
  assert.equal(url.searchParams.get('limitToLast'), '4');
  assert.equal(url.searchParams.has('limitToFirst'), false);
});

test('invalid paths, cursor characters and unbounded query options reject', () => {
  for (const path of ['', '/private.json', '../private.json', 'a/../b.json', 'a//b.json',
    'https://other.invalid/a.json', 'a.json?shallow=true', 'a%2fb.json', 'a.txt', 'a\\b.json']) {
    assert.throws(() => keyPageRequest(path), TypeError, path);
  }
  for (const options of [null, [], { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: '2' },
    { direction: 'sideways' }, { cursor: '' }, { cursor: 12 }, { cursor: 'bad/key' },
    { cursor: 'bad.key' }, { cursor: 'bad\u0000key' }, { cursor: 'é'.repeat(385) }, { orderBy: 'rating' }]) {
    assert.throws(() => keyPageRequest('groups/example.json', options), TypeError, JSON.stringify(options));
  }
});

test('unordered REST responses return a sorted bounded page and continuation cursor', () => {
  const request = keyPageRequest('history/pod_one.json', { limit: 2 });
  assert.deepEqual(keyPageResult({ g_c: { game: 3 }, g_a: { game: 1 }, g_b: { game: 2 } }, request), {
    items: [{ key: 'g_a', value: { game: 1 } }, { key: 'g_b', value: { game: 2 } }], nextCursor: 'g_b',
  });
});

test('Firebase integer-looking keys precede string keys with numeric and length tie ordering', () => {
  const keys = ['z', '10', '0002', '2', '-1', '2147483648', '2147483647', '02', '0', '-2147483648', '-2147483649'];
  assert.deepEqual(keys.sort(databaseKeyCompare), ['-2147483648', '-1', '0', '2', '02', '0002', '10',
    '2147483647', '-2147483649', '2147483648', 'z']);
});

test('ascending continuation excludes its inclusive boundary whether that row still exists or was deleted', () => {
  const request = keyPageRequest('history/pod_one.json', { limit: 2, cursor: 'g_b' });
  assert.deepEqual(keyPageResult({ g_e: 5, g_c: 3, g_b: 2, g_d: 4 }, request), {
    items: [{ key: 'g_c', value: 3 }, { key: 'g_d', value: 4 }], nextCursor: 'g_d',
  });
  assert.deepEqual(keyPageResult({ g_c: 3, g_d: 4 }, request), {
    items: [{ key: 'g_c', value: 3 }, { key: 'g_d', value: 4 }], nextCursor: null,
  });
});

test('descending continuation never repeats its boundary and preserves newest-first order', () => {
  const request = keyPageRequest('history/pod_one.json', { limit: 2, cursor: 'g_d', direction: 'desc' });
  assert.deepEqual(keyPageResult({ g_b: 2, g_d: 4, g_a: 1, g_c: 3 }, request), {
    items: [{ key: 'g_c', value: 3 }, { key: 'g_b', value: 2 }], nextCursor: 'g_b',
  });
  assert.deepEqual(keyPageResult({ g_b: 2, g_c: 3 }, request), {
    items: [{ key: 'g_c', value: 3 }, { key: 'g_b', value: 2 }], nextCursor: null,
  });
});

test('empty Firebase shapes terminate pagination and numeric-key arrays stay supported', () => {
  const request = keyPageRequest('history/pod_one.json', { limit: 2 });
  assert.deepEqual(keyPageResult(null, request), { items: [], nextCursor: null });
  assert.deepEqual(keyPageResult({}, request), { items: [], nextCursor: null });
  assert.deepEqual(keyPageResult([null, { game: 'one' }, { game: 'two' }], request), {
    items: [{ key: '1', value: { game: 'one' } }, { key: '2', value: { game: 'two' } }], nextCursor: null,
  });
});

test('a malformed or unexpectedly unbounded response fails instead of silently slicing the entire history', () => {
  const request = keyPageRequest('history/pod_one.json', { limit: 2 });
  assert.throws(() => keyPageResult('not a collection', request), /collection/i);
  assert.throws(() => keyPageResult({ 'bad.key': 1 }, request), /key/i);
  const entireHistory = Object.fromEntries(Array.from({ length: 10000 }, (_, index) => [`g_${String(index).padStart(5, '0')}`, index]));
  assert.throws(() => keyPageResult(entireHistory, request), /bound/i);
});

test('ambiguous integer-looking keys cannot silently disappear at a cursor boundary', () => {
  const request = keyPageRequest('history/pod_one.json', { limit: 2, cursor: '-0' });
  assert.throws(() => keyPageResult({ '00': 'different key with equal integer order' }, request), /ambiguous/i);
  const first = keyPageRequest('history/pod_one.json', { limit: 2 });
  assert.throws(() => keyPageResult({ '-0': 1, '00': 2 }, first), /ambiguous/i);
});
