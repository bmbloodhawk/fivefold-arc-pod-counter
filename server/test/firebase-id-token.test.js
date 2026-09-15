import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { FirebaseIdTokenVerifier } from "../src/firebase-id-token.js";

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

test("Firebase ID verifier accepts only a signed token for its project", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 }); const now = 1_000_000_000_000;
  const header = encode({ alg: "RS256", kid: "test" }); const claims = encode({ aud: "fivefold-arc-playtest", iss: "https://securetoken.google.com/fivefold-arc-playtest", sub: "opaque-subject", iat: now / 1000, exp: now / 1000 + 3600 });
  const token = `${header}.${claims}.${sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), privateKey).toString("base64url")}`;
  const verifier = new FirebaseIdTokenVerifier({ projectId: "fivefold-arc-playtest", now: () => now, fetchImpl: async () => new Response(JSON.stringify({ test: publicKey.export({ type: "spki", format: "pem" }) }), { headers: { "cache-control": "max-age=60" } }) });
  assert.deepEqual(await verifier.verify(token), { providerSubject: "opaque-subject" });
  await assert.rejects(verifier.verify(`${header}.${claims}.bad`), { code: "ACCOUNT_AUTH_INVALID" });
});
