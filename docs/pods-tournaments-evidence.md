# Pods and Tournaments implementation evidence

## Baseline

- Fresh worktree: `C:/Users/nibay/.codex/worktrees/fivefold-arc-pods-tournaments`.
- Branch: `codex/pods-tournaments`.
- Fetched main at creation: `b299d8a74ef7dcf14427cd8b138692aa8423fc69`.
- Existing safe-update/recovery task files preserved.
- No deployment, remote push or live Firebase change authorized or performed.

## Completed checks

Implementation checks will be added with their exact command, scope and outcome.
Creating this specification is not evidence the feature works.

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

