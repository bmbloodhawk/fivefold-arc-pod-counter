import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FirebasePlaytestLedger, createPlaytestLedgerFromEnv } from "../src/playtest-ledger.js";

test("creates the Firebase ledger from a protected service-account file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fivefold-firebase-"));
  const credentialPath = join(directory, "staging-service-account.json");
  await writeFile(credentialPath, JSON.stringify({
    client_email: "staging@example.test",
    private_key: "-----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----\\n",
  }));

  try {
    const ledger = createPlaytestLedgerFromEnv({
      FIREBASE_DATABASE_URL: "https://staging.firebaseio.test",
      FIREBASE_SERVICE_ACCOUNT_FILE: credentialPath,
    });

    assert.ok(ledger instanceof FirebasePlaytestLedger);
    assert.equal(ledger.clientEmail, "staging@example.test");
    assert.match(ledger.privateKey, /BEGIN PRIVATE KEY/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
