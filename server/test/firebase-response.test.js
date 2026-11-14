import assert from 'node:assert/strict';
import test from 'node:test';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';
import { sourceArchive } from '../src/competition-source.js';

function ledgerWith(fetchImpl) {
  const ledger = new FirebasePlaytestLedger({ databaseUrl: 'https://fixture.invalid',
    clientEmail: 'fixture', privateKey: 'fixture', fetchImpl, logger: { error() {} } });
  ledger.accessToken = async () => 'fixture';
  return ledger;
}
const truncatedResponse = status => new Response(new ReadableStream({ start(controller) {
  controller.error(new Error('truncated fixture response'));
} }), { status });

test('unused successful Firebase write bodies are consumed before returning', async () => {
  const response = Response.json({ padding: 'x'.repeat(128 * 1024) });
  const ledger = ledgerWith(async () => response);
  await ledger.write('fixture.json', { saved: true });
  assert.equal(response.bodyUsed, true);
});

for (const operation of ['write', 'read', 'conditional-read', 'conditional-write', 'archive']) {
  test(`failed Firebase ${operation} releases its response body`, async () => {
    const response = Response.json({ error: 'fixture failure' }, { status: 503 });
    const ledger = ledgerWith(async (_url, options = {}) => operation === 'conditional-write' && !options.method
      ? Response.json(null) : response);
    const actions = {
      write: () => ledger.write('fixture.json', {}),
      read: () => ledger.read('fixture.json'),
      'conditional-read': () => ledger.update('fixture.json', () => ({})),
      'conditional-write': () => ledger.update('fixture.json', () => ({})),
      archive: () => ledger.createSourceArchive({ gameId: 'qa-fixture' }),
    };
    await assert.rejects(actions[operation], /503/);
    assert.equal(response.bodyUsed, true);
  });
}

test('conditional retries release conflict bodies and preserve concurrent data', async () => {
  const responses = [];
  const ledger = ledgerWith(async (_url, options = {}) => {
    if (responses.length) assert.equal(responses.at(-1).bodyUsed, true, 'Release the last response before another request.');
    const conflict = responses.length < 2;
    const response = !options.method
      ? Response.json({ values: conflict ? ['first'] : ['first', 'other'] }, { headers: { etag: '"fixture"' } })
      : conflict ? Response.json({ values: ['first', 'other'] }, { status: 412 })
        : Response.json(JSON.parse(options.body));
    responses.push(response); return response;
  });
  const saved = await ledger.update('fixture.json', current => ({ values: [...current.values, 'ours'] }));
  assert.deepEqual(saved.values, ['first', 'other', 'ours']);
  assert.equal(responses.every(response => response.bodyUsed), true);
});

test('immutable archive conflicts release the body before checking the existing source', async () => {
  const recap = sourceArchive({ schemaVersion: 1, gameId: 'qa-fixture', completedAt: 100,
    starters: [], inferredOrder: null, originalOutcome: { winnerSeatId: null, finishingOrder: null } });
  const conflict = Response.json(recap, { status: 412 });
  const ledger = ledgerWith(async (_url, options = {}) => {
    if (options.method === 'PUT') return conflict;
    assert.equal(conflict.bodyUsed, true);
    return Response.json(recap);
  });
  await ledger.createSourceArchive(recap);
});

test('a truncated conflict echo still retries the conditional update against current data', async () => {
  let writes = 0;
  const ledger = ledgerWith(async (_url, options = {}) => {
    if (!options.method) return Response.json({ values: writes ? ['other'] : [] }, { headers: { etag: '"fixture"' } });
    return ++writes === 1 ? truncatedResponse(412) : Response.json(JSON.parse(options.body));
  });
  assert.deepEqual(await ledger.update('fixture.json', current => ({ values: [...current.values, 'ours'] })), { values: ['other', 'ours'] });
  assert.equal(writes, 2);
});

test('a truncated conflict echo still verifies the original immutable archive', async () => {
  const recap = sourceArchive({ schemaVersion: 1, gameId: 'qa-fixture', completedAt: 100,
    starters: [], inferredOrder: null, originalOutcome: { winnerSeatId: null, finishingOrder: null } });
  let reads = 0;
  const ledger = ledgerWith(async (_url, options = {}) => {
    if (options.method === 'PUT') return truncatedResponse(412);
    reads++; return Response.json(recap);
  });
  await ledger.createSourceArchive(recap);
  assert.equal(reads, 1);
});

test('a truncated response fails visibly and queued work retries before continuing', async () => {
  let attempts = 0, failures = 0;
  const ledger = ledgerWith(async () => {
    attempts++;
    return attempts <= 3 ? truncatedResponse(200) : new Response(null, { status: 204 });
  });
  ledger.logger = { error() { failures++; } };
  ledger.recovery({ roomCode: 'QA', version: 1 });
  ledger.recovery({ roomCode: 'QA', version: 2 });
  await ledger.flush();
  assert.equal(attempts, 4);
  assert.equal(failures, 1);
});
