import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AccountHistory } from '../server/src/account-history.js';
import { completionProofsFromDiagnostics } from '../server/src/appearance-history-recovery.js';
import { APPEARANCE_ACHIEVEMENTS } from '../server/src/appearance-milestones.js';
import { createPlaytestLedgerFromEnv } from '../server/src/playtest-ledger.js';

export const RECOVERY_RUN = 'legacy-commander-v1';
const awardIds = Object.values(APPEARANCE_ACHIEVEMENTS).map(award => award.id);
const recordPath = (kind, id) => `account-history/${kind}/${id}.json`;

export async function repairAppearanceAccount({ store, accountId, diagnostics, auditDir, apply = false, runId = RECOVERY_RUN }) {
  if (!/^acct_[A-Za-z0-9-]{1,120}$/.test(accountId || '') || !/^[a-z0-9-]{1,80}$/.test(runId)) throw Error('Invalid recovery target');
  const kinds = ['accounts', 'games', 'decks', 'verified-progress'];
  const records = await Promise.all(kinds.map(kind => store.read(recordPath(kind, accountId))));
  const backup = Object.fromEntries(kinds.map((kind, index) => [kind, records[index]]));
  const legacyGames = Object.values(backup.games || {});
  const completionProofs = completionProofsFromDiagnostics(legacyGames, diagnostics);
  // Bound every write to this one account's existing progression transaction.
  const guardedStore = {
    read: path => store.read(path),
    write() { throw Error('Recovery cannot replace profile, history or deck records'); },
    update(path, change) {
      if (path !== recordPath('verified-progress', accountId)) throw Error('Recovery write outside account progression');
      return store.update(path, change);
    },
  };
  const history = new AccountHistory({ store: guardedStore });
  const options = { completionProofs, appearanceAchievementIds: awardIds, runId };
  const plan = await history.recoverAppearanceHistory(accountId, options);
  if (!apply) return plan;
  if (!auditDir) throw Error('A private backup directory is required before applying');
  await mkdir(auditDir, { recursive: true });
  const stamp = Date.now();
  const backupFile = resolve(auditDir, `${accountId}-${runId}-${stamp}-before.json`);
  await writeFile(backupFile, JSON.stringify({ accountId, runId, savedAt: stamp, records: backup }, null, 2), { flag: 'wx', mode: 0o600 });
  const report = await history.recoverAppearanceHistory(accountId, { ...options, apply: true });
  const current = await store.read(recordPath('verified-progress', accountId));
  assert.equal(current?.appearanceRecovery?.runId, runId, 'Recovery marker was not persisted');
  const access = await history.earnedSkinAwards(accountId, awardIds);
  for (const id of report.newAchievementIds) assert.ok(access[id], 'Recovered award has no skin access');
  for (const [key, game] of Object.entries(backup['verified-progress']?.games || {})) assert.deepEqual(current.games[key], game, 'Existing verified game changed');
  for (const [id, award] of Object.entries(backup['verified-progress']?.awards || {})) assert.deepEqual(current.awards[id], award, 'Existing award changed');
  const notice = await history.appearanceCatchUp(accountId);
  if (report.newAchievementIds.length) assert.deepEqual(notice?.achievementIds, report.newAchievementIds, 'Catch-up notice does not match restored awards');
  assert.deepEqual(await history.appearanceCatchUp(accountId), notice, 'Reading a catch-up notice consumed it');
  assert.deepEqual((await history.recoverAppearanceHistory(accountId, options)).newAchievementIds, [], 'Recovery is not idempotent');
  const verification = { ...report, verified: true, verifiedAt: Date.now(), backupFile,
    availableAchievementIds: Object.keys(access), noticeId: notice?.id || null };
  const verificationFile = resolve(auditDir, `${accountId}-${runId}-verified.json`);
  await writeFile(verificationFile, JSON.stringify(verification, null, 2), { mode: 0o600 });
  return { ...verification, verificationFile };
}

export async function repairRemainingAccounts({ store, diagnostics, pilotAccountId, pilotVerificationFile, auditDir, runId = RECOVERY_RUN }) {
  const verified = JSON.parse(await readFile(pilotVerificationFile, 'utf8'));
  if (verified.accountId !== pilotAccountId || verified.runId !== runId || verified.verified !== true) throw Error('Verified pilot is required before all accounts');
  const pilotProgress = await store.read(recordPath('verified-progress', pilotAccountId));
  if (pilotProgress?.appearanceRecovery?.runId !== runId || pilotProgress.closed) throw Error('Pilot recovery is not currently present');
  const accounts = await store.read('account-history/accounts.json') || {};
  const reports = [];
  // Sequential, bounded account transactions make a partial run safe to resume.
  for (const accountId of Object.keys(accounts).sort()) {
    if (accountId === pilotAccountId) continue;
    const result = await repairAppearanceAccount({ store, accountId, diagnostics, auditDir, runId, apply: true });
    reports.push(result);
    await writeFile(resolve(auditDir, `${runId}-remaining-progress.json`), JSON.stringify(reports, null, 2), { mode: 0o600 });
  }
  return reports;
}

async function main() {
  const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
  if (!args.includes('--evidence') || !args.includes('--audit-dir')) throw Error('Supply --evidence <private archive JSON> --audit-dir <private directory>');
  const diagnostics = JSON.parse(await readFile(resolve(option('--evidence')), 'utf8'));
  const store = createPlaytestLedgerFromEnv();
  if (typeof store.accessToken !== 'function') throw Error('Use the existing server-only Firebase environment');
  const auditDir = resolve(option('--audit-dir'));
  let reports;
  if (args.includes('--all')) {
    if (!args.includes('--pilot') || !args.includes('--pilot-verification')) throw Error('Supply --pilot and --pilot-verification for the checked pilot');
    reports = await repairRemainingAccounts({ store, diagnostics, auditDir, pilotAccountId: option('--pilot'), pilotVerificationFile: option('--pilot-verification') });
  } else {
    if (!args.includes('--account')) throw Error('Supply --account <internal account id>; dry-run is the default');
    reports = [await repairAppearanceAccount({ store, diagnostics, auditDir, accountId: option('--account'), apply: args.includes('--apply') })];
  }
  console.log(JSON.stringify({ reports }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
