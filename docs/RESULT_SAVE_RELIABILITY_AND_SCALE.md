# Result-save reliability and growth assessment

Scope: staging-only result-save fix, November 11, 2026. Production is excluded.

## Confirmed cause and change

Each Pod or tournament currently stores its control state, completed-game evidence,
revisions and standings in one document. Concurrent table confirmations and source
captures competed for that document. The Firebase REST adapter permits eight
conditional-write attempts before returning `503 HISTORY_BUSY`. Raising stream
limits admitted more players but did not remove that write contention.

`server/src/competition-write-coordinator.js` now orders competition updates by
storage path within an app process. Domains using the same store share the queue.
Another Pod, another event, directory reads and ordinary gameplay do not wait on
that document. Rejected operations release their place; later operations still run.
Database ETags remain the authority when independent processes write concurrently.
No adapter retry budget or HTTP timeout was increased.

`server/src/competitions.js` accepts an explicit unchanged result from scope
mutators. `server/src/competition-tables.js` uses it for an already captured source
and an identical confirmation request. They retain their evidence and version and
skip the conditional PUT. Conflicting source evidence and conflicting request-ID
reuse still reject.

## Verification

The local 128-player scenario has 32 four-player tables, one simulated network,
128 live SSE streams, 2,048 life mutations, seat reclaim and stale-phone rejection,
and a 64-mutation control table while the other tables complete and confirm.
It verifies every final game count and point total and resends each confirmation
to prove one revision per game. `--busy-retries=0` disables harness recovery.

With 5ms artificial delay per database request, the previous implementation failed
that strict scenario with `HISTORY_BUSY`. Its earlier retry-enabled run had 38 busy
responses on original confirmations and 21 on duplicate confirmations; confirmation
operation p95 was 6,662ms including recovery. The first fixed strict run had zero
busy responses and zero conditional conflicts; confirmation p95 was 2,095ms.
The corresponding life-during-results p95 was 49ms, versus 68ms in the older run.
These are single local runs, not a statistical hardware-capacity comparison.

The fixed 64-player, two-round scenario also passed with busy retries disabled.
With 50ms artificial storage delay per request, the 128-player scenario passed
with zero busy responses: confirmation p95 was 4,931ms, capture maximum 9,537ms
and life-during-results p95 55ms. Higher latency still increases queue wait; this
does not promise instant finishes or unlimited bursts. Detailed JSON and logs are
in the ignored `.local/evidence/` directory.

Regression coverage includes simultaneous same-Pod saves across domain instances,
independent Pod progress while another save stalls, queue recovery after failure,
no-op evidence/version retention, duplicate capture/confirmation writes, and live
life adjustment while the competition store is blocked. A real two-process restart
test forces both processes to submit the same old ETag; one write conflicts, both
receive the same single revision, and a further duplicate causes no PUT. Existing
access, erasure, reclaim, correction, guest, no-show and tournament tests remain.

The inverted unchanged-scope guard was rejected by its regression test and then
restored. The full suite passes 274 server and 172 client tests (446 total),
including rejection when an earlier queued membership departure revokes access.

## Life-tap boundary

No competition read or write occurs during a life tap. A regression blocks a real
competition update, adjusts life immediately, and observes no additional competition
I/O. The HTTP/SSE load scenario also verifies that life-only activity leaves the
competition database subtree byte-for-byte equivalent. Source comparisons in
`qa/competition-performance.mjs` confirm the protected mutation/SSE methods and the
complete life-adjustment batcher are unchanged from the gameplay baseline.

## Can this serve a global market?

Yes as a product direction; the current deployment is not validated for global
concurrent traffic. Registered accounts, concurrent players, and simultaneous
finishes in one event are different capacity questions. A local 128-client test
cannot establish a worldwide capacity number.

Confirmed architectural limits:

| Current source | Limit | Future change to design and approve |
| --- | --- | --- |
| `server/src/competitions.js`, `directoryPath` / `changeDirectory` | One directory contains identity, invite/membership lookup and table claims; unrelated setup writes eventually contend globally. | Partition identity, membership, invite and table-claim records with indexed, bounded reads and erasure support. |
| `server/src/competitions.js`, `changeScope`; `server/src/competition-tables.js`, `confirm` | A growing scope is downloaded, cloned and rewritten; Pod corrections replay history. This queue reduces collisions but not growth cost. | Store immutable games/revisions separately; maintain small projections/checkpoints with durable, ordered processing per Pod/event and idempotent work. Preserve correction/replay and privacy invariants. |
| `server/src/app.js`, `RoomService` rooms/connections maps | Live room authority and SSE ownership are process-local. Adding replicas alone does not share them. | Explicit room routing/ownership, durable recovery, reconnect/failover and cross-instance event delivery. Keep competition work outside life mutations. |
| `render.staging.yaml` and staging dashboard | Current staging is a single free instance; no regional or paid-capacity evidence was gathered. | Measured paid capacity, CDN/static delivery, regional room routing without collecting player location, backup/failover, abuse controls and operational budgets. |

The local full-scope CPU fixture measured about 1.34MB / 21ms at 1,000 synthetic
two-player games and 13.38MB / 209ms at 10,000, before REST transfer or contention.
Those simplified records understate richer real history. This supports splitting
history before long-lived groups become large; it is not a retention limit or a
proposal to erase old games.

Firebase documents a single-database write-rate guideline of 1,000 writes/second
and a 64MB/minute bytes-written limit. Whole-history rewrites can reach bandwidth
constraints before an attractive user-count estimate. Its documented multi-database
approach allows independent groups to be sharded. Our phones connect to app SSE;
Firebase's direct database connection limit is not the app's player capacity.
[Firebase limits](https://firebase.google.com/docs/database/usage/limits),
[Firebase sharding](https://firebase.google.com/docs/database/usage/sharding).

Render supports multiple paid instances with load balancing; free services cannot
scale beyond one instance. The room-ownership change must precede relying on
horizontal app scaling. [Render scaling](https://render.com/docs/scaling).

Recommended growth gates, requiring later approval:

1. Run a real small multi-phone staging night and a controlled real-Firebase load
   check with disposable accounts/data. Measure completion latency, busy errors,
   bytes transferred, CPU/memory and life-update latency. Agree on a target and cost
   budget before raising admission limits further.
2. Split competition history/directory records and add recoverable, idempotent
   completion processing; prove crash recovery and correction replay at long history.
3. Build and test multi-instance room ownership/reconnect, then measure paid hosting
   and failure recovery with concurrent groups in multiple regions.
4. Expand gradually against measured concurrent-player targets and operating cost.
   Do not derive global readiness from a higher configurable connection cap.

No new service, paid plan, production deployment, Firebase rules change, data
migration, public directory or location collection is part of this fix.

## Rollout and rollback

Deploy only the tested staging branch. Keep the existing 128/network and 256/server
staging connection budgets. No client asset or worker version change is needed for
this server-only behavior change. Before calling it deployed, verify Render's
running commit, delayed health, expected asset bytes and staging protocol tests.

Rollback is a normal staging-only revert of the fix (or Render redeploy of prior
staging commit `2f07f797bf59b4206460ea181dbb378bed1d15ab`). Data shape is unchanged;
confirmed results do not need deletion or migration. A restart can interrupt active
staging tables. Production branch, service, settings and data remain excluded.
