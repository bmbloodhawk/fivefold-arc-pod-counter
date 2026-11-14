# Pods and Tournaments implementation evidence

## Baseline

- Fresh worktree: `C:/Users/nibay/.codex/worktrees/fivefold-arc-pods-tournaments`.
- Branch: `codex/pods-tournaments`.
- Fetched main at creation: `b299d8a74ef7dcf14427cd8b138692aa8423fc69`.
- Existing safe-update/recovery task files preserved.
- No deployment, remote push or live Firebase change authorized or performed.

## Completed checks

Final validation is recorded below. Earlier checkpoints are retained as historical
evidence; their counts and pending-work descriptions are not the final status.

## Later release gates

- Actual physical two-phone testing (mixed mobile platforms/background recovery).
- Live Firebase authentication, rules/index configuration and restart validation.
- Owner approval before any deployment, remote publication or live-data change.
## Scoring checkpoint

- RED: `node --test server/test/competition-scoring.test.js` failed because the
  scoring module did not exist. GREEN: all 12 behavioral tests passed.
- Full `npm test`: 197 server and 167 client tests passed, no failures/skips/todos.
- Includes exact tied event points for sizes 2–8, guest exclusion, opponent strength,
  correction replay and deterministic 1,200-game replay. This is simulation evidence.
- Engineering tuning: initial rating 1000, K=24, logistic scale 400, averaged
  pairwise comparisons. Equal four-player results give +12/+4/-4/-12. Rule version
  is frozen as `elo-placement-v1`; this is not an official Commander rating system.

## Backend checkpoint

- Full `npm test`: 242 server + 167 client tests passed, zero failures/skips/todos.
- Local HTTP checks exercise real route authentication, opt-in, account erasure,
  setup gates and account-optional guest entry. Fixture tokens are only in tests.
- Tests prove zero competition-store reads/writes during ordinary AND lethal life
  adjustments; independently verified personal seat results remain usable.
- Recovery tests repair a missing archive with the exact full recap, preserve original
  source/proofs, survive a fresh RoomService, and retry a reserved interrupted start.
- Regressions cover normal intermission, replacement host authority, ownership changing
  during an awaited claim, and a life tap invalidating a reset without losing the game.
- Local Firebase-shaped adapter reproduces null/empty child omission and numeric arrays.
  First-Pod creation, publication, erasure and receipt digests round-trip through it.
  This is not a live Firebase/emulator claim.
- Event tests cover multi-table/manual rounds, guest access rotation, co-hosts, late/early
  entries, no-show cancellation, exact tied points and a timed draw with turn tracking
  disabled. No fake winner; all surviving players share their remaining points.
- Storage contract checked against Firebase's official REST conditional requests and
  array behavior: https://firebase.google.com/docs/database/rest/save-data and
  https://firebase.blog/posts/2014/04/best-practices-arrays-in-firebase .
- Production wiring is disabled unless COMPETITIONS_ENABLED=true; no environment or live
  setting has been changed. Phone UI and runtime checks remain to be completed.

## Earlier phone browser checkpoint

- Two independent Chrome 140.0.7339.128 phone-sized contexts, 390x844, isolated
  storage, loopback QA server, Playwright-routed fixture auth; external HTTPS blocked.
  No real account provider was used. Browser tooling is in ignored `.local/qa`.
- Exercised create Pod -> private QR/link -> second account sign-in/accept -> create
  linked Table -> second phone joins -> start -> 13 real counter taps -> host-declared
  completion -> host full-order confirmation -> visible ratings 1012/988, both 1/10
  provisional. Capacity eight with two actual starters recorded exactly two players.
- With the Pod modal open, the second phone moved 40 -> 33 (10 down, three up).
  The first phone’s underlying authoritative roster showed 33 and the modal stayed open.
  Captured client traffic: **zero new competition requests from those life taps**.
- Reload/reclaim and signed-in invite return exercised; entered name survived sign-in.
  Browser page-error list was empty through the above flow.
- Screenshots: `.local/evidence/home-390.png`, `pod-open-during-live-updates-390.png`,
  `finishing-order-review-390.png`, `pod-confirmed-ratings-390.png`. Result/ranks images
  visually inspected. They are local evidence, not physical-device or production proof.
- Fresh-context UI review identified recovery discovery, cancelled-navigation/error
  display, guest/account capability precedence and Table cancellation numbering.
  Fixes are in progress; remaining inventory and final exact-source pass are required.

## Final local validation — 2026-11-11

- `npm test`: **263 server + 172 client = 435 passed**, zero failures, cancellations,
  skips or todos. Full output: `.local/evidence/npm-test-final.txt`.
- `git diff --check`: passed. Expected Windows LF/CRLF notices are not diff errors.
- `node qa/competition-performance.mjs`: passed all baseline source comparisons;
  JSON output `.local/evidence/competition-performance.json`, raw run output
  `.local/evidence/competition-performance-run.txt`.
- Current-source JavaScript syntax checks passed. No package or lockfile changes.
- Separate read-only reviewers found concrete startup, membership-list, cross-Pod
  intent, guest navigation/race and disabled-feature erasure defects. Fixes were
  re-probed and focused tests passed; no P1/P2 remained in their final reviewed deltas.

### Backend integrity and actual restart

`server/test/competition-process-restart.test.js` starts a real child application
process against the loopback conditional-REST fixture, completes/resets five games
(evicting the first beyond the three-game cache), kills that owned process, starts a
new process against the same fixture and verifies all sources remain capturable.
Four concurrent identical confirmations cause actual ETag conflicts and one effective
revision/game; conflicting retry payloads fail. A replacement connection reclaims the
saved host seat. Personal-account awards are not granted by group publication.

`competition-recovery.test.js` holds optional discovery indefinitely while casual
health/adjust HTTP calls succeed, prevents overlapping recovery, then tests retry
after discovery failure. `competition-http.test.js` also proves account erasure still
redacts existing shared names while competition routes/config are disabled.

Behavioral suites cover private tenant ACLs, invite expiry/revocation/admin readmission,
reclaim/proof races, returning ratings, vacancy takeover, name changes, source repair,
idempotency/concurrency, historical host handoff, reset races, immutable revisions,
chronological replay, erasure fencing and DTO minimization. Tournament tests cover
multiple independent Tables, combined standings, seating priorities and saved inputs,
2–8-player/tied exact points, guest provenance/access, optional cohosts, late/early
attendance, unplayed cancellation, actual-game clocks, current+five total turns and
surviving-player draws. Existing Pod data is byte-for-byte unchanged by tournament
publication. Erasing the organizer preserves unrelated guest names.

### Browser evidence

Chrome **140.0.7339.128**, isolated phone contexts at **390×844**, **320×700**, plus
**1024×768**. Loopback-only QA server and routed fixture account module; external
HTTPS blocked, service workers blocked for the interaction checks. These are simulated
phone viewports on this computer. No physical phone, real OAuth, Firebase or venue
network was used.

**54 unique functional/layout checks passed; zero page errors.** Recorded in
`.local/evidence/browser-final.json`. Repeatable helpers:
`qa/competition-browser-checks.mjs`, fixture entrypoint `qa/competition-local-server.mjs`.

- Two-phone Pod: create/invite/sign-in/explicit accept (name retained), seat linking,
  actual two starters in capacity eight, rapid life entry while another phone keeps
  the hub open, declared completion/full-order review and automatic member ratings.
- Reload/reclaim during play, normal next-game setup, lethal completion while hub
  stays open, deferred personal finish and exactly one second rated game.
- Client request capture showed **zero competition requests from 13 ordinary life
  taps and 40 lethal life taps**. The authoritative other-phone roster converged.
- History date→game drill-down, tie correction, deliberately lost successful response,
  retained form and retry producing exactly one additional immutable revision.
- Admin appointment/removal, old invite rejection after member removal, fresh admin
  readmission, voluntary leave/return with rating/count, vacancy takeover and visible
  audit, invite revocation, independent second Pod and admin-only name editing.
- Four-phone tournament: signed-in host/member, self-named guest and host-attested
  guest; editable assignments, selected Table host, lobby→event return/manual round
  start, actual four-player game and role-restricted clock.
- Time cannot be called early. Current turn plus five total recorded turns, tied
  survivor order, distinct guest provenance, all four at 1.5 points/joint first place,
  draw presentation without an invented winner, guest own standings, unchanged Pod.
- Storage failure/Retry, invalid/deep/same-document invites, delayed-preview Close,
  cancelled guest entry access/reclaim, explicit guest→account choice, signed-in
  early-leaver event resume. Holding an older guest response until after a newer
  account entry did not overwrite the new choice when released.
- Cross-Pod reuse cannot replace an existing Table link or poison its next start.
  Escape restores entry-point focus, Tab stays in the dialog, 320px primary controls
  meet 44px bounds without horizontal overflow, wider dialog stays bounded.
- With competition UI disabled, two unsigned guest phones still create/join/start,
  change life and finish an ordinary Table.
- Previously shared Pod/event invites were reopened after a full page reload, listed
  without raw secrets, revoked through Manage invites, then rejected on another phone.

Screenshots retained under `.local/evidence/`: `pod-standings-320.png`,
`finishing-order-review-390.png`, `pod-correction-history-390.png`,
`tournament-round-started-390.png`, `tournament-five-turns-390.png`,
`tournament-tied-order-390.png`, `tournament-standings-320.png`,
`tournament-draw-390.png`, `invalid-invite-390.png`, `pods-wide-1024.png`,
`pod-renamed-390.png`. Pod and tournament narrow screenshots were visually inspected.
The full tournament screenshots predate the final singular “1 game” copy correction;
that copy-only change did not alter scoring/layout behavior.

### Performance and privacy review

Thirteen protected method bodies plus the whole life batcher compare unchanged with
the fetched baseline, including the app adjustment function and both sides' SSE/live
mutation methods. `client/realtime.js` setup alone now advertises [1,2] and optionally
authorizes account seat claim. Timed Tables require protocol 2; casual Tables remain 1.
Store-spy tests prove zero added competition reads/writes for ordinary and lethal taps.
This does not mean existing room diagnostics/recovery writes disappear.

Latest local measurements: eight-seat recovery after four games ~41.4KB flag off vs
44.2KB with compact evidence; median JSON serialization ~0.070ms vs ~0.076ms. Acknowledged
archives leave zero bulky repair recaps. Pure 40-member replay medians: 1,000 games
~12ms, 10,000 ~105ms. Actual in-memory final confirmation against synthetic two-player
scope history: 1,000 ~1.34MB/~21ms; 10,000 ~13.38MB/~212ms. Richer records, REST latency,
CAS contention and phone/server load are additional. Full-scope replay/storage is a
known scale limit requiring a realistic staging load gate, not a production guarantee.

Names/account links are redactable separately from retained numerical results.
No group writes grant private awards. Private source proofs never appear in ordinary
archive/diagnostic DTOs. No location collection or public directory was introduced.
Privacy page/deletion confirmation explain shared retained numbers and pseudonymization;
the erasure path remains available when the optional feature is disabled.

See `docs/PODS_AND_TOURNAMENTS_HANDOFF.md` for the model, permissions, assumptions,
physical-phone script, release approvals and rollback constraints. All owned local QA
servers/browsers are stopped at handoff. Physical iPhone/Android and live Firebase
rules/auth/conditional-write validation remain unperformed release gates.

The final fresh-context overall review reproduced three additional edge cases. They
were fixed and re-probed: unfinished tournament games cannot be reset/cancelled to
erase the round; known never-applied start reservations remain cancellable; a recovered
casual seat-link failure cannot leave an unbound Table blocked; issued invites remain
manageable after reopening. The final review reported no remaining concrete P1/P2.

## Approved-requirement audit

| Contract | Local evidence |
| --- | --- |
| P01 multiple independent Pods | Membership ACL tests, explicit unchanged Pod bytes after event publication, second-Pod phone flow |
| P02 explicit private membership/invites | Authenticated HTTP opt-in, preview minimization, invite sign-in/accept and QR/link browser flow |
| P03 roles/readmission/invite management | Membership permission tests; fresh admin invite after removal; persisted list/revoke for own/admin invites; name-edit ACL |
| P04 real vacancy takeover | Atomic membership tests and visible phone audit; offline admin does not count as vacancy |
| P05 ongoing rating/return | Source eligibility at accepted start, provisional/count tests, leave/return phone flow |
| P06 opponent-sensitive normalized rating | Pure 2–8/tie/strong-opponent/zero-sum tests, versioned 1,200-game simulation and replay measurements |
| P07 guests/private awards | Verified-seat/capture tests; event guest provenance; group publication leaves personal counters untouched |
| P08 shared dated history | Authorized history APIs and phone date→game→revision drill-down, no private notes/decks in DTOs |
| P09 erasure | Alias fencing, deleted-member retained numbers, erased-admin succession, disabled-feature DELETE and unrelated guest-name tests |
| C01–C03 actual full-order evidence | Frozen starter/owner/format/time source, actual capacity-vs-starters check, complete/tied host review, controlled immutable correction |
| C04–C06 durability/idempotency/reclaim | Concurrent/duplicate/conflict tests, actual child-process restart/ETags, cache eviction and repair, host/seat/reset race tests |
| T01 standalone/account-optional | Existing Pod unchanged, signed + guest + attested four-phone flow, no private grant from guest ledger |
| T02–T03 seating | Balanced exact partitions2–8, manual editor, seeded persisted inputs, both priorities and repeat preferences tested |
| T04–T05 attendance/roles | Multi-table/manual lifecycle, late zero approval, retained early points/list access, cohost and unplayed cancellation tests |
| T06 exact points | 840-unit normalized placement/tie tests and four joint 1.5-point phone winners |
| T07–T08 timing/protocol | Actual-game-bound clock, disabled normal turn tracking, current+five turns, shared survivors and draw-capable protocol tests/phone flow |
| U01–U05 phone access | Secondary hub, primary account-free Table flow, return/reclaim/navigation/error/keyboard/bounds checks, local calendar unit tests |
| Reliability/privacy/release scope | Protected source comparison, ordinary/lethal zero-I/O spies + real request capture, optional-store failure checks, flag-off erasure, local-only commits |

No physical-device or live-service claim is implied by this audit.

