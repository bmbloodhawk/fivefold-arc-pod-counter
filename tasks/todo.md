# Safe updates, durable rooms, and reclaim recovery

## Task 1: Define durable room-store contract

**Acceptance criteria:**
- [x] A room record has a schema version and durable version.
- [x] Writes use compare-and-swap semantics and expose conflicts without partial mutation.
- [x] Existing no-Firebase mode remains unchanged.

**Verify:** focused server store tests.

**Dependencies:** None

**Files likely touched:** `server/src/playtest-ledger.js`, new `server/src/room-store.js`, `server/test/server.test.js`

## Task 2: Persist authoritative room mutations

**Acceptance criteria:**
- [x] Each accepted shared mutation is durably committed before its success response/SSE broadcast.
- [x] A fresh server service can load an active room and permit normal seat reclaim.
- [x] Existing host-recovery compatibility remains intact.

**Verify:** server replacement and competing-write tests.

**Dependencies:** Task 1

**Files likely touched:** `server/src/app.js`, `server/src/index.js`, `server/test/server.test.js`

## Task 3: Add exact latest-table recovery

**Acceptance criteria:**
- [x] Reload reclaims only the latest successfully active table.
- [x] QR A then Table B then reload reclaims B.
- [x] Explicit Leave clears recovery; temporary offline failure does not.

**Verify:** focused client reclaim tests.

**Dependencies:** None

**Files likely touched:** `client/app.js`, `client/realtime.js`, new or existing client test file

## Checkpoint: Durable recovery

- [x] Server and client focused tests pass.
- [x] Full `npm test` passes.
- [x] Restart/reclaim test passes locally without browser credentials.

## Task 4: Add deferred-release coordinator

**Acceptance criteria:**
- [x] A waiting worker is detected but cannot reload/activate a playing table.
- [x] Safe lifecycle states can offer a deliberate refresh.
- [x] Current and prior release caches remain available during normal worker transition.

**Verify:** worker/coordinator unit tests and manual local worker update simulation.

**Dependencies:** Task 3

**Files likely touched:** `client/sw.js`, new `client/release-update.js`, `client/app.js`, client tests

## Task 5: Add fixed-layout update status treatment

**Acceptance criteria:**
- [x] Playing notice is non-blocking and does not create a scrollable extra row.
- [x] At 320px width it preserves counter-stage/player-card geometry and control access.
- [x] Safe-boundary refresh action is keyboard and screen-reader accessible.

**Verify:** client tests plus real-browser screenshots/console checks at phone width.

**Dependencies:** Task 4

**Files likely touched:** `client/index.html`, `client/styles.css`, `client/app.js`, client tests

## Task 6: Add durable-store readiness and deploy diagnostics

**Acceptance criteria:**
- [x] Health endpoint can report not-ready if enabled durable storage is unavailable.
- [x] Shutdown/reconnect behavior has a stable reason and client recovery remains quiet.
- [ ] No Render or Firebase live configuration is changed.

**Verify:** server health/restart tests and full suite.

**Dependencies:** Task 2, Task 3

**Files likely touched:** `server/src/app.js`, `server/src/index.js`, server tests, documentation

## Checkpoint: Completion

- [x] `npm test` passes.
- [ ] Browser verification has clean console, accessible status, and 320px screenshots.
- [ ] Normal update, deferred update, QR A→B reclaim, offline retry, and simulated server replacement pass locally.
- [x] Production infrastructure actions are listed separately for approval.
