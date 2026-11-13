// Owned-process storage proof only. No live credentials, Firebase or OAuth.
import { FirebasePlaytestLedger } from '../server/src/playtest-ledger.js';
import { CompetitionIdentityStore } from '../server/src/competition-identity-store.js';
import { competitionStoreForEnvironment } from '../server/src/competitions.js';

const databaseUrl = process.env.IDENTITY_QA_DATABASE_URL;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(databaseUrl || '')) throw new Error('Identity QA requires an owned loopback database.');
const [operation, accountId] = process.argv.slice(2);
if (!['identity', 'erase', 'resume'].includes(operation)
  || (operation !== 'resume' && !/^qa-[a-z0-9_-]{1,50}$/.test(accountId || ''))) throw new Error('Invalid synthetic identity operation.');
const ledger = new FirebasePlaytestLedger({ databaseUrl, clientEmail: 'fixture@example.invalid',
  privateKey: 'unused-local-fixture-key', logger: { error() {} } });
ledger.accessToken = async () => 'local-fixture-only';
const identities = new CompetitionIdentityStore({ store: competitionStoreForEnvironment(ledger, 'qa') });
const result = operation === 'identity' ? { identityId: await identities.identity(accountId, 'Synthetic player') }
  : operation === 'erase' ? await identities.eraseAccount(accountId) : await identities.resumeErasures({ limit: 100 });
console.log('IDENTITY_QA_RESULT ' + JSON.stringify(result));
