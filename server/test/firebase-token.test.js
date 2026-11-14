import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { FirebasePlaytestLedger } from '../src/playtest-ledger.js';

// Disposable signing key; requests are intercepted and never reach OAuth.
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('concurrent Firebase operations share one credential exchange and refresh once after expiry', async (t) => {
  let now = 1_800_000_000_000, requests = 0, release;
  const blocked = new Promise(resolve => { release = resolve; }); t.after(() => release());
  const ledger = new FirebasePlaytestLedger({ clientEmail: 'fixture@example.invalid', privateKey, now: () => now,
    fetchImpl: async url => {
      assert.equal(url, 'https://oauth2.googleapis.com/token');
      requests++; await blocked;
      return Response.json({ access_token: `fixture_${requests}`, expires_in: 120 });
    } });
  const attempts = Array.from({ length: 16 }, () => ledger.accessToken());
  await tick(); assert.equal(requests, 1);
  release(); assert.deepEqual(await Promise.all(attempts), Array(16).fill('fixture_1'));
  assert.equal(await ledger.accessToken(), 'fixture_1'); assert.equal(requests, 1);
  now += 61_000;
  assert.deepEqual(await Promise.all(Array.from({ length: 16 }, () => ledger.accessToken())), Array(16).fill('fixture_2'));
  assert.equal(requests, 2);
});

test('a failed credential exchange releases its body and allows a later shared retry', async () => {
  let requests = 0; const responses = [];
  const ledger = new FirebasePlaytestLedger({ clientEmail: 'fixture@example.invalid', privateKey,
    fetchImpl: async () => {
      const response = ++requests === 1 ? Response.json({ error: 'fixture failure' }, { status: 503 })
        : Response.json({ access_token: 'fixture_ok', expires_in: 3600 });
      responses.push(response); return response;
    } });
  const failed = await Promise.allSettled(Array.from({ length: 8 }, () => ledger.accessToken()));
  assert.equal(requests, 1);
  assert.equal(failed.every(result => result.status === 'rejected' && /503/.test(result.reason.message)), true);
  assert.equal(responses[0].bodyUsed, true);
  assert.deepEqual(await Promise.all(Array.from({ length: 8 }, () => ledger.accessToken())), Array(8).fill('fixture_ok'));
  assert.equal(requests, 2);
});
