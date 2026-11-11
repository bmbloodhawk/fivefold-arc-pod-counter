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

