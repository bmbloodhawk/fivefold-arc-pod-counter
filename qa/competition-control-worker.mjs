// Disposable REST fixture only. This helper never loads live credentials.
import { FirebasePlaytestLedger } from '../server/src/playtest-ledger.js';
import { competitionStoreForEnvironment } from '../server/src/competitions.js';
import { CompetitionControlStore } from '../server/src/competition-control-store.js';

const [databaseUrl, action] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(databaseUrl || '') || !['apply', 'recover', 'async-guard'].includes(action)) throw new Error('Loopback fixture and supported action required.');
const nativeFetch = fetch;
const ledger = new FirebasePlaytestLedger({ databaseUrl, clientEmail: 'fixture', privateKey: 'fixture',
  fetchImpl: (url, options) => {
    if (new URL(url).origin !== databaseUrl) throw new Error('External storage access refused.');
    return nativeFetch(url, options);
  } });
ledger.accessToken = async () => 'local-fixture-only';
const control = new CompetitionControlStore({ store: competitionStoreForEnvironment(ledger, 'qa') });
let result;
if (action === 'async-guard') {
  try {
    await control.begin('pod', 'pod_async_guard', { operationId: 'control_async_guard', baseVersion: 0,
      changes: [{ section: 'metadata', key: 'group', value: { id: 'pod_async_guard', kind: 'pod' } }] }, {
      guard: async () => { throw new Error('Authorization lookup failed'); },
    });
    throw new Error('An asynchronous guard unexpectedly succeeded.');
  } catch (error) { result = { code: error.code }; }
  await new Promise(resolve => setImmediate(resolve));
} else if (action === 'recover') {
  const ticks = [];
  for (let index = 0; index < 3; index++) ticks.push(await control.recover({ workerId: 'fresh_process', limit: 3, maxWrites: 8 }));
  result = { ticks };
} else {
  const id = 'pod_process_crash';
  const admission = await control.begin('pod', id, { operationId: 'control_process_create', baseVersion: 0, changes: [
    { section: 'metadata', key: 'group', value: { id, kind: 'pod', title: 'Synthetic process Pod' } },
    { section: 'members', key: 'member_owner', value: { id: 'member_owner', identityId: 'identity_owner', role: 'admin', status: 'active' } },
  ] });
  result = { admission, resumed: await control.resume('pod', id) };
}
console.log(JSON.stringify(result));
