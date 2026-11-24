# Saved-deck HTTP handlers

`server/src/account-decks-http.js` owns the four saved-deck request handlers: create, list, update and remove. It receives the existing authentication, body reader and account-history service, then returns response data to the shared HTTP dispatcher. Unmatched requests return `null` without touching authentication, request bodies or account storage.

`app.js` still owns the global spectator restriction, CORS/security headers, account identity, JSON parsing, response formatting and error masking. The adjacent saved-game deletion handler and deck domain/storage implementation remain unchanged. No client code, cache pins, dependencies, data structures or service configuration changed.

The extraction preserves current request semantics: exact collection paths for GET/POST, filtered item segments for PATCH/DELETE, encoded IDs remaining encoded, archives included only by `archived=all`, authentication before body parsing, and completed account operations before success responses. Existing validation errors remain masked by the shared handler; foreign valid-ID DELETE remains a no-op with status 204. Those behaviors are characterized rather than changed here.

Verification completed before and after extraction:

- Nineteen new loopback HTTP tests passed against the unchanged dispatcher at base `8e11c7a`, then passed after extraction. They cover missing/invalid authentication, all four spectator denials, account isolation, CRUD/archive responses, malformed and oversized JSON, unchanged storage after failed requests, response headers/error masking, path behavior and saved-game deletion fallthrough.
- Seven direct-module tests first failed because the new module did not exist. They now verify side-effect-free fallthrough, delayed write acknowledgments and propagation of failed create/update/remove operations.
- The focused run, including existing account-history tests, passed 50/50. Syntax and diff checks passed.
- Full `npm test` passed on Node 24.19.0: server 799/799 and client 787/787, totaling 1,586 tests with no failures, skips or cancellations. All four source/test hashes remained unchanged during the run.
- Independent review found no actionable issue. Artifact copies passed all 19 HTTP tests against immutable base `8e11c7a` and all 26 HTTP/module tests against the candidate. The tests rejected an authentication bypass (nine failures) and an omitted DELETE await (four failures). Active source/test hashes stayed unchanged.

All request tests use local loopback servers, synthetic identities and in-memory records. This is backend-only local verification; no physical-device testing or live account activity is involved. The work remains local for review, without a push or deployment.
