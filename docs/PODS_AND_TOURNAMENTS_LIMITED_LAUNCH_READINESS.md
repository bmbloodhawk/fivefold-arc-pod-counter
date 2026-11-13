# Pods and Tournaments: limited single-server launch preparation

Implementation update: atomic event/recovery persistence now passes focused durability
tests and enforced 8/16-client local timing gates. Browser testing also found and fixed
an invite-restoration race. The post-fix pass contains 63 assertions and a separately
verified local worker. The later approved public/staging comparison found a deployed
Commander entry fix missing locally and cache identifier collisions. Candidate-04
preserves that fix (seven focused browser checks) and uses app296/hub2/cache359.
The exact final artifact and
remaining hosted/two-phone gates are described in
`docs/PODS_AND_TOURNAMENTS_PILOT_HANDOFF.md`; final test/integrity status lives beside
the frozen artifact. The historical assessment and misses below are retained as
before-change evidence. Its earlier completion statement is not launch signoff.

Reviewed 2026-11-12 in `C:/Users/nibay/.codex/worktrees/fivefold-arc-scaling-foundations`,
branch `codex/scaling-foundations`, HEAD `0cd2f05263a8dae760d673304b8beac67ef8dd43`,
including all unfinished local edits. This launch goal supersedes the broader overnight
implementation goal. The scaling roadmap, code, unfinished tests and earlier evidence
are preserved; remaining scaling stages are not automatically launch requirements.

**Decision: prepare a small pilot using the existing competition storage path. Do not
deploy this entire checkout as it stands.** The current local checks found no additional
functional failure in that path. Release assembly, response-time acceptance, and hosted
and physical-phone verification remain open. Preparation is complete; launch is not approved.

## Actual blockers and evidence gaps

| Finding | Evidence and effect | Smallest next action |
| --- | --- | --- |
| The entire checkout is not a finished release candidate. | Fresh `npm test` ran 501 server checks: 500 passed, one test file failed to import the nonexistent `server/src/competition-game-store.js`. This is the preserved, unfinished new-storage slice, not a failure to save an existing-mode game. The npm chain stops before client tests; all 172 client tests passed separately. Nothing was deleted, skipped or disabled to get these numbers. | Select and review a complete release candidate that preserves the unfinished scaling work separately. Require its normal test command to pass. Do not ship this checkout or implement the entire storage redesign merely to remove this import error. No branch, commit or alternate checkout was created here. |
| The earlier proposed life HTTP p95 target of 250 ms is still missed at small sizes. | The separate 16-client run measured 284.08 ms during results. The 8-client run measured 253.70 ms for life-only traffic and 271.88 ms during results. Both runs were functionally correct, with no busy retries/errors. | Diagnose the acknowledgement/queue timing on the chosen runtime and validate the intended pilot on staging. Keep the existing durability guarantee. Do not lower the target or describe functional success as a complete performance pass. |
| Hosted authentication, storage, isolation and restart behavior are unverified for the release candidate. | Loopback fixtures reproduce conditional REST writes and synthetic account verification. They do not establish actual Firebase permissions, environment separation, token verification, durable recovery or hosting capacity. `/health` reports liveness and appearance readiness, not competition storage readiness. | After separately authorized staging preparation, prove an authenticated create/join/save/correct/erase/restart cycle with disposable data, actual conditional writes and the exact served build. |
| Physical-phone play and active update compatibility remain unverified. | Earlier browser evidence used isolated Chrome phone viewports. This review reran HTTP/SSE and automated tests, not physical iPhone/Android interaction. Timed Tables require draw-capable protocol-2 clients. | Run the two-phone script below, including background/reclaim, simultaneous finish traffic, timed draws, and actual service-worker activation. |

The timing findings are confirmed HTTP measurements. They do not prove visible life
taps or SSE rendering take that long: the recovery regression explicitly verifies that
SSE feedback arrives while the durable HTTP acknowledgement is still pending. Physical
responsiveness remains a separate gate. These findings do not demonstrate a need for
multiple servers, partitioned history, or a 1,000-client implementation before a pilot.

## Why the larger redesign can wait

`server/src/index.js` constructs the normal `Competitions` domain without an identity
or partitioned scope store. `COMPETITIONS_ENABLED=true` enables this existing path only
when authenticated account storage is available. The new native group mode is injected
by the loopback QA entrypoint with `COMPETITION_QA_NATIVE_GROUPS=true`; that setting
was explicitly false for the pilot checks here.

Existing-mode confirmation stores the revision and standings within one conditional
group update; duplicate retries are checked against their original payload. Private
membership, account/guest permissions, result corrections, timed draws, erasure with
the feature off, and real process restart were covered by the passing tests. No new
application bug in these behaviors was demonstrated by this review.

Whole-group history reads/writes and replay remain known growth costs. Keep the
partitioned game store, incremental projections, large-history optimization, routing,
multi-server ownership and 1,000-client milestones on the preserved scaling roadmap.
The unfinished native group mode must stay inactive: the current scope bridge rejects
game/standings changes and its replacement result store is not implemented. Do not
migrate any live records or mix new-format writers with the legacy erasure/rollback path.

## Fresh local validation

Evidence directory: `.local/limited-launch-20261112/`.

- `npm test`: **500 server checks passed, one import failure, zero skipped/cancelled**;
  `npm-test.log` contains the complete failure and output. Duration approximately 314 s.
- `node --test client/*.test.mjs`: **172 passed, zero failures/skips**; `client-tests.log`.
- The server run includes private ACLs, guest entry, timed procedure, corrections,
  exactly-once confirmation, actual process restart, 20 acknowledged life changes
  surviving SIGKILL, source recovery, flag-off erasure and immediate SSE feedback.
- No source or test was edited. SHA-256 fingerprints for all 350 pre-existing,
  non-ignored files are in `before-source-hashes.json`; final preservation verification
  is in `preservation.json`. The only new repository document is this report.
- `git diff --check` was run after preparation; see `diff-check.log` and `preservation.json`.

The existing `qa/competition-load.mjs` ran with one synthetic network, 5 ms artificial
storage delay, 16 adjustments per client per round, three rounds, default 32/64 stream
budgets and **zero automatic busy retries**. Each run used a fresh loopback fixture and
owned child application; neither a remote address nor real account credentials was used.

| Run | Tables per round / completed games | Life HTTP p95 | Life during results p95 | Confirmation p95 | Functional outcome |
| --- | --- | --- | --- | --- | --- |
| 16 clients, regression suite also running | 4 / 12 | 188.41 ms | 281.86 ms | 234.54 ms | Passed |
| 16 clients, after regression suite finished | 4 / 12 | 191.88 ms | 284.08 ms | 235.71 ms | Passed |
| 8 clients, after both previous runs finished | 2 / 6 | 253.70 ms | 271.88 ms | 160.17 ms | Passed |

Reports are `pilot-16.json`, `pilot-16-quiet.json`, and `pilot-8-quiet.json`, with
corresponding `.log` files. All three verify HTTP/SSE convergence, exact life changes,
unchanged competition records during life-only traffic, stale-connection rejection,
concurrent results, duplicate confirmation safety, and final points/game counts. Each
reported zero unexpected failures and zero server errors. The harness's `passed` field
does not enforce the latency target; the misses above remain open. The variation also
means smaller client counts cannot be treated as a proven latency cure.

These short runs are not endurance, real OAuth, live Firebase, venue Wi-Fi or phone
rendering evidence. Their cleanup kills the owned app; separate regression tests and
the earlier 128-client endurance evidence establish the stated recovery claims, not
the load harness cleanup. The earlier 30-minute result is retained in
`docs/LOCAL_SCALING_READINESS_2026-11-12.md`; another 30-minute run is not required merely
to identify these launch blockers. Earlier historical native-mode defects in that report
must be read alongside the later scaling checkpoints, not treated as current defects.

Reproduction, from the required working directory:

```powershell
npm test
node --test client/*.test.mjs
$env:COMPETITION_QA_NATIVE_GROUPS = 'false'
node qa/competition-load.mjs --players=16 --networks=1 --delay-ms=5 --adjustments=16 --rounds=3 --busy-retries=0
node qa/competition-load.mjs --players=8 --networks=1 --delay-ms=5 --adjustments=16 --rounds=3 --busy-retries=0
```

The harness writes a fixed report filename per size. Earlier files at those paths were
copied into this evidence directory before reuse; earlier scaling evidence was retained.

## Proposed first pilot and minimal release scope

Recommend starting with **one observed session, eight invited players total, two
four-player Tables, fresh Pods/events, and at most three tournament rounds**. This is
a conservative proposed operating envelope, not validated hosted capacity or permission
to launch. Count all casual and competition connections on the server, not only one
event. Review that session before widening to 16 or running long-lived large histories.

The source defaults are 32 streams per IP and 64 globally; `render.staging.yaml` lists
128/256. Neither file establishes current live settings. Verify configuration and
reconnect headroom rather than raising limits for this pilot. Keep one authoritative
app process; do not add replicas to compensate for latency without room ownership.

The feature flag is server-wide. Private invitations restrict individual groups; they
are not a beta-account allowlist or an enforced eight-player cap. Decide how to control
the pilot audience before enabling a public endpoint. Do not silently promise a hard
enrollment limit that the current application does not enforce.

The release scope is the completed existing Pod/tournament UI and domain behavior,
the same-event save coordination, independent counter-write scheduling, and the narrow
crash-acknowledgement fix with its regressions. Preserve immediate local life feedback,
SSE updates, normal recovery persistence, guest restrictions, seat/host authority and
the flag-off privacy eraser. Do not activate new storage or change gameplay/scoring.

The 350-file fingerprint manifest identifies the inspected bytes, not a deployable
commit. A later candidate must identify its exact runtime/client inputs, relevant
tests, commit/build and diff, with the incomplete scaling slice safely retained. This
review does not certify an unassembled candidate, current production, or other branches.

## Staging and two-phone release gate

No staging or live action was performed. Once a complete candidate exists, prepare a
separately approved staging action specifying the environment, exact build, disposable
accounts/data, expected evidence, risk and rollback. The required evidence is:

1. Verify the actual one-process deployment, database namespace and server-only access,
   authentication, competition config and durable recovery. Prove a conditional-write
   conflict cannot overwrite a newer result. Verify no incompatible new-format writer
   or records would bypass the chosen erasure path. Do not infer this from `/health`.
2. Compare served assets to the candidate hashes. Current inspected references are app
   `v293`, realtime `v88`, competition UI/CSS/model `v1`, worker cache `fivefold-arc-v356`.
   Inspect active worker/controller state after the safe update flow; a downloaded
   script alone does not establish activation on either phone.
3. On iPhone/Safari and Android/Chrome with separate accounts: create/invite/explicitly
   join a private Pod; create/join/start its Table; change life rapidly and apply commander
   damage while the other phone has the hub open. Record both visible counters and HTTP
   acknowledgement timing, including while another Table confirms a result.
4. Background/lock/reload one phone, reclaim its seat and reject stale ownership. Finish,
   review full order, confirm, repeat a lost-response retry and a correction. Verify both
   standings exactly once, then play the next game through normal intermission.
5. Run a small standalone event including a guest and a timed draw. Verify current turn
   plus five actual turns, survivor ties, correct event points and unchanged Pod ratings.
6. Restart the owned staging process with disposable active/finished Tables; verify
   acknowledged counters, sources, guest reclaim and confirmed standings persist. Erase
   a disposable account with the feature on and off; shared names disappear while
   numerical results and unrelated guest names remain.

Record build/OS/browser, participant/stream totals, errors, duplicate requests, observed
counter/SSE delay, result latency and successful recovery. Use existing host CPU/memory,
logs and error diagnostics; collect no new personal data. Keep the proposed 250 ms HTTP
life p95, 2 s convergence bound and 5 s result confirmation target visible and separate
from subjective phone feel. Do not approve the pilot by averaging away missing outcomes
or a timing miss. Local short-run timing does not substitute for this hosted evidence.

## Stop conditions and rollback

Stop expansion for any acknowledged-state loss, mismatched counter, duplicate result,
wrong standings, unauthorized access, failed erasure, busy/error accumulation, sustained
latency miss or growing recovery backlog. Keep physical counters available for the pilot.

For a functional rollback, finish or drain active timed Tables first, then disable
competitions on the same compatible release through an explicitly approved service
change. The flag hides competition UI/routes while retaining stored data and the privacy
eraser. Keep protocol-2/draw support and the crash-recovery fix; do not downgrade active
timed Tables, delete shared ledgers, reset ratings or migrate live data as rollback.

**Next action:** resolve the complete candidate boundary and the small-load HTTP timing
gate locally, then request approval for that exact candidate's staging/phone check.
No broad scaling implementation, publication, commit, deployment, external message,
spending, live access or live data change was part of this preparation.
