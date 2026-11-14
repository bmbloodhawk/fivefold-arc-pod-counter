# Limited pilot candidate and remaining release gates

The local implementation addresses the demonstrated small-load storage delay and
invite-restoration failures. It does not authorize a launch. The target is one observed
session with eight invited players, two four-player Tables and at most three rounds,
on one authoritative server process. Sixteen-client local validation supplies limited
headroom evidence; it is not a hosted capacity or endurance guarantee.

## Exact local candidate

The final freeze after the authorized public/staging comparison is `candidate-04` under
`.local/pilot-launch-implementation/candidates/`. Its `manifest.json` identifies every
input by path, size and SHA-256, the base HEAD and dirty branch, plus every exclusion.
`pilot-candidate.zip` contains those inputs and the manifest; its hash is in
`pilot-candidate.zip.sha256`. `tracked-diff-from-head.patch` and the included untracked
files make the release reviewable. Later verification results belong in sidecar files
and do not alter the frozen source. Consult `status.json` and `integrity.json` before
using the artifact; this document is not a substitute for its final normal test result.
There is no release commit, new branch, Git checkout, publication or deployment.

The candidate excludes exactly these unfinished C5 files, retaining the originals:

- `server/src/competition-game-values.js`;
- `server/test/competition-game-values.test.js`;
- `server/test/competition-game-store.test.js`.

The last test imports the nonexistent `server/src/competition-game-store.js`. The
original tree therefore remains honestly RED: 511 server checks passed and this one
import failed in the implementation regression run; the npm chain then stops before
the client suite. All 172 client tests passed separately. Candidate-01/02 each passed
their normal `npm test` with 505 server and 172 client tests. Candidate-03 also passed
677 tests; the hosted comparison then exposed an omitted, already-deployed Commander
entry fix and reused staging cache identifiers. Those artifacts remain preserved as
superseded evidence. The final artifact must independently pass its normal command. No test was
deleted, skipped or weakened in the original checkout. Completed native scaling code
and tests remain included, while normal startup continues using existing competition
storage; native group activation and migration are deferred.

## Local evidence and exact limits

- Atomic event/recovery persistence: 39 focused tests, including frozen retry bytes,
  failed saves, repair/flush ordering, immediate SSE and actual SIGKILL/restart.
  See `docs/COUNTER_ATOMIC_PERSISTENCE.md`.
- Enforced active 8/16-client workloads: three rounds, 16 adjustments per player per
  round, one synthetic network, configured 5 ms fixture delay, zero busy retries.
  Life HTTP p95 during results was 127.75/127.79 ms against a 250 ms target; maximum
  measured SSE convergence was 32.70/33.79 ms against 2 s. Result confirmation p95 was
  159.60/215.55 ms against 5 s. Reports retain all failures and traffic measurements.
- A deliberately slow 100 ms fixture run remained functionally correct but failed
  the timing gate with exit code 1 (life HTTP p95 above 500 ms). It is preserved,
  along with the original before-change timing misses, rather than counted as success.
- Browser behavior: the earlier 63-assertion Pod/event pass had zero page/server
  errors, with phone-size/wide visual review. A subsequent seven-assertion two-phone
  loopback regression first failed on Commander reentry, then passed after copying
  the exact fix already deployed on both hosted sites. It covers a fresh entry,
  another phone's update, manual choice, reentry, changed turn, tracking off and 320px
  fit. The unchanged hub/server inputs connect the earlier coverage to this narrowly
  updated app; this does not claim that all 70 assertions were rerun together.
  A separate current local worker/cache hash check passes for app296/hub2/cache359. See
  `docs/PODS_AND_TOURNAMENTS_INVITE_RECOVERY.md`. This used synthetic accounts and
  disposable loopback data, not hosted auth or physical devices.
- Gameplay source guard: 12 protected methods and the complete life batcher unchanged;
  the one intentional storage hook is separately locked to its new exact fingerprint.

The evidence directory is `.local/pilot-launch-implementation/`. `browser-final.json`,
`local-worker-proof-359.json`, `pilot-8-gated.json`, `pilot-16-gated.json`, the negative
control, candidate test logs and preservation/integrity sidecars are authoritative for
their stated scope. After explicit approval, public/staging static files, health and
hosting metadata were read. No service setting, live record or hosted build was changed.

## Approved read-only public/staging comparison

The user approved the preflight and requested that staging mostly mirror public,
with new changes for testing. Observations at 2026-11-13 07:28 UTC:

| Setting | Public | Staging |
| --- | --- | --- |
| Deployed branch/revision | main / da4d8d0 | staging / 4d2b445 |
| Service | One Free Node instance, Oregon | One Free Node instance, Oregon |
| Build/start/auto-deploy | npm install --prefix server / npm start / On Commit | Same |
| Health-check path | /health | Blank in actual dashboard |
| Stream limits | 32/IP, 64 global in deployed source | 128/IP, 256 global in actual environment |
| Database host | fivefold-arc-playtest-default-rtdb.firebaseio.com | fivefold-arc-staging-default-rtdb.firebaseio.com |
| Served app / worker | app295 / cache358 | app294 / cache357 |
| Competition config endpoint | 404; deployed server lacks this feature | enabled:true |

The staging environment is explicitly marked and uses separate recovery/ledger storage.
Both clients use the same sign-in project; authentication and private credential access
were not exercised. Public uses environment credentials while staging references a
secret service-account file; no private credential was revealed. These mechanisms need
not be identical. Keep separate data, origins and secrets rather than copying production
credentials. Six common client modules, including life batching, match byte-for-byte
between the two deployed sites and match normalized local source. Sixteen served assets
were checked against the exact Git blobs identified by the dashboard revisions.

Both deployments contain the same Commander entry fix missing from candidate-03.
It has now been copied exactly into the local app, which differs from staging's
`app.js` only by importing the fixed hub v2. New app296/cache359 identifiers avoid
colliding with either deployed build. Worker activation policy is unchanged. The
initial long worker observation timed out/reset its test kernel; owned process absence
was verified before a fresh run successfully proved the new active cache and hashes.

The repository's proposed target is
`https://fivefold-arc-pod-counter-staging.onrender.com` with `APP_ENV=staging` and
`COMPETITIONS_ENABLED=true`. `render.staging.yaml` describes a Git-backed `staging`
branch with auto-deploy and stream limits 128/IP and 256 globally, now confirmed in
the dashboard. Its YAML health path does not match the actual blank setting.
Evidence is `.local/pilot-launch-implementation/hosted-readonly-20261112/`, including
`hosting-inventory.json`, `served-assets.json` and the anonymous GET reports. Initial
staging GETs timed out; a later attempt succeeded after its documented free-tier
spin-up. This is not a measured hosted storage latency result.

## Next external action requires separate approval

After candidate-04 passes, prepare an update of the **existing staging branch/service
only**, bound to the frozen manifest and current remote branch head. Render auto-deploy
means a commit on that branch publishes and restarts the staging app. Current permission
still forbids commits and deployment. Any publication therefore needs an explicit
exception for one reviewed staging commit; never force-update the branch, modify main,
switch this worktree, or overwrite unexpected newer staging work. Verify Git-normalized
asset hashes as part of that publication route, not only this Windows artifact's bytes.

For representative pilot acceptance, propose setting staging's health path to `/health`
and temporarily using the public-equivalent 32/IP and 64-global budgets. The higher
128/256 settings belong to the earlier larger scaling experiment and remain preserved
in source/evidence. These are proposed staging configuration changes, not authorization
or changes already made. No new service, account, paid plan or production configuration
is needed. Drain disposable staging sessions before an approved deployment; expected
evidence is the exact served build, active worker and the hosted/device checks below.
Risks include interruption of staging sessions and real storage/auth differences not
covered locally. Capture its prior revision/config first. Restore configuration only
under the applicable approval; for a functional rollback keep a compatible recovery
build and disable competition features as described below. Do not delete records or
downgrade active timed Tables as rollback.

**Storage isolation is a hard preflight condition.** Account/competition environment
prefixes do not isolate the ledger's top-level `playtests/` and `recovery/` paths.
`server/src/index.js` also has a staging auth-project fallback. Verify the actual
database and credential permissions, including ledger/recovery isolation, before any
test write. The distinct configured database hosts are now verified; real credential
permissions and provider behavior remain unproven.
Stop if the target could share production recovery records. Do not solve that by
migrating or deleting data, silently using production credentials, or assuming the
staging hostname guarantees a separate database. Real provider proof cannot be
substituted with the QA server's synthetic auth.

## Later staging and physical-phone checks

Only after a separately approved isolated staging action, record the exact candidate
ID, archive hash and served asset hashes. Verify one app process, durable recovery,
server-only storage access, actual token verification and conditional writes. Check
the flag-on private create/invite/join flow, two-account ACL rejection, guest entry,
Table start/reclaim, a stale conditional update rejected without overwriting a newer
result, correction/duplicate/lost-response behavior and equal-point timed draws.

Use disposable staging accounts and Tables for the approved restart and erasure
tests. Recheck acknowledged life state, sources, guest reclaim and standings after
restart. With the feature both on and off, erasure must remove shared account names
while preserving numerical history and unrelated guest names. Keep test data and
commands scoped to the verified isolated environment; any cleanup/deletion also
requires the applicable approval. `/health` alone proves none of these storage facts.

On an actual iPhone/Safari and Android/Chrome, record OS/browser/build and active
worker/controller/cache state: app `v296`, hub `v2`, worker `fivefold-arc-v359`.
After the safe update flow, play a private Pod through invitation, rapid life taps,
commander damage, background/lock/reload/reclaim, full-order confirmation, a correction
and the next game. Keep another phone's hub open during life changes. Run a standalone
timed event with a guest, current turn plus five turns, tied survivors and unchanged
Pod ratings. Include simultaneous results at two Tables. Capture visible counter
agreement and errors separately from HTTP acknowledgement timing. A new worker file
download is not proof that an installed phone activated it safely.

## Operating limits, stop and rollback

Private invitations restrict membership but are neither a beta account allowlist nor
an enforced eight-person server cap. Choose an approved audience control before any
public enablement. Count all casual and event streams, reconnects and observers, not
just registered players. Keep the actual limits and reconnect headroom visible; the
code defaults are 32/IP and 64 globally, separate from the unverified staging YAML.

Use existing server CPU/memory, errors, storage/recovery backlog, connection counts
and request timings. Keep the 250 ms life HTTP p95, 2 s convergence and 5 s result
confirmation targets; do not average missing outcomes or retry busy errors into a
pass. The failure-only diagnostic repair map and existing write backlog can grow
during a sustained outage. Stop expansion for persistent storage errors/backlog,
acknowledged-state loss, mismatched counters, duplicate results, incorrect standings,
unauthorized access, failed erasure, accumulating busy errors or a sustained timing
miss. Keep physical counters available during the pilot.

Before any approved deployment, capture the currently deployed compatible revision
and redacted config for rollback. If competition behavior fails, drain or finish
active timed Tables and disable the competition feature on a compatible release by
an approved service change. Preserve the privacy eraser, protocol-2/draw support and
crash-acknowledgement fix. Do not downgrade active timed Tables, reset ratings, delete
ledgers or migrate records as rollback. A failure of the shared counter persistence
path requires a separately reviewed compatible build; feature-off alone does not
remove that storage hook. No rollback/service change is currently authorized.

The goal remains open until the exact candidate passes and authorized hosted/two-phone
evidence meets these gates. A finished local artifact alone is not launch approval.
