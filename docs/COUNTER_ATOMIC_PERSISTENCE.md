# Atomic counter event and recovery persistence

This is a local pilot candidate change. No deployment or live data change has
been performed. It keeps the existing database paths and the single-server model.

## Measured cause

The earlier 8/16-client scenarios were functionally correct but missed the proposed
250 ms life HTTP p95 target. An eight-client, two-Table trace separated queue time
from network/storage work: 128 life commands admitted 260 writes, including four
periodic checkpoints. Queue wait p95 was 141.87 ms; job work p95 was 33.42 ms.
Response consumption added little beyond receipt of response headers.

The fixture requests 5 ms delay using a timer. A 32-sample timer probe on this
Windows host observed roughly 15.96 ms median and 16.07 ms p95. Parameter value
5 therefore does not establish an actual 5 ms storage response. An explanatory
zero-delay trace reduced HTTP p95 from 193.93 to 63.42 ms. That trace is not an
acceptance run and does not replace the configured-delay scenarios.

The specific avoidable work was two serial storage round trips per mutation in
the same Table FIFO: its event and recovery snapshot, plus occasional checkpoint.
The original admitted snapshots and diagnostic records must all remain saved.

## Storage change

`FirebasePlaytestLedger.recordWithRecovery(event, record, checkpoint)` admits one
queued multi-location PATCH containing:

- `playtests/{gameId}/events/{sequence}`;
- `recovery/{roomCode}`, including the existing server timestamp;
- `playtests/{gameId}/checkpoints/{sequence}` when a checkpoint is due.

Each location receives the same record type as before. No history migration,
competition operation, new client permission, extra normal read, snapshot
coalescing or event deletion is introduced. The app's storage hook uses this
optional method; memory/null and other existing ledgers keep their old interface.
This persistence change leaves mutation, batching, seat authority and snapshot/broadcast
behavior unchanged. Separate invite-restoration and preservation of an already-deployed
Commander-entry fix are documented in
`docs/PODS_AND_TOURNAMENTS_INVITE_RECOVERY.md`.

Firebase documents [REST multi-path PATCH updates](https://firebase.google.com/docs/database/rest/save-data#section-patch)
and the [atomic all-or-nothing behavior of multi-location updates](https://firebase.google.com/docs/database/web/read-and-write#update_specific_fields).
This uses Firebase multi-location update semantics, not RFC JSON Patch. Actual
hosted behavior and configuration still require the approved staging gate.

## Durability and failure behavior

The complete request bytes are frozen before the queued job waits. It keeps the
same per-Table FIFO lane and the existing global queued-write concurrency limit.
Every admitted snapshot is still written. HTTP success still waits for the
corresponding recovery promise; optimistic and SSE feedback remain immediate.
The frozen full batch is retried exactly as before when its latest receipt failed.
An older failed receipt cannot replace a newer saved snapshot.

If all full-batch attempts fail, the same admitted job tries a frozen
**diagnostic-only** repair. The original recovery receipt still fails, even when
the diagnostic repair succeeds. Repair contains the event and optional checkpoint,
never an older recovery snapshot. Keeping it inside the original job means a
concurrent `flush()` includes the repair rather than returning before it finishes.

If diagnostic repair also fails, its immutable paths remain in a failure-only
per-Table repair map. Subsequent queued writes check this map at execution time
and must persist those diagnostics before a newer recovery can be acknowledged.
This includes standalone recovery saves and jobs admitted before the failure.
Only confirmed diagnostic repairs are removed. Errors remain logged and recovery
failures remain errors; no retry is counted as a new life operation.

The map and the pre-existing write backlog can grow during sustained storage
outages. This change does not establish a global backlog bound or make
unacknowledged, memory-only work durable across process loss. Stop the pilot for
ongoing storage errors/backlog rather than accumulating unlimited traffic. It is
not multi-process Table ownership or a distributed durable-command implementation.

## Verification and source protection

`server/test/counter-atomic-persistence.test.js` first reproduced separate writes
and the missing API, then exposed the repair/flush race and an already-queued
newer-save failure case. Its tests cover one-write normal and due-checkpoint
behavior, held/failed acknowledgements, independent Tables, frozen retry bytes,
preserved older events, latest recovery, standalone recovery, FIFO, unrelated data,
invalid identities and repair inclusion in a concurrent flush.

The focused 39-test run additionally covers the existing recovery, queue, ledger
and Firebase-shape suites, including immediate SSE and an actual SIGKILL/restart.
Logs and before/after traces are under `.local/pilot-launch-implementation/`.
The small trace used 128 queued writes after the change and measured 81.11 ms
HTTP p95, versus 260 writes and 193.93 ms before it; every event and final recovery
was checked. This trace alone is not hosted or physical-phone evidence.

`qa/competition-performance.mjs` originally required every protected method to
match the old gameplay baseline exactly. Its old guard correctly failed on
`recordLedger`: that one storage hook is intentionally changed here. The guard
now locks this hook to its exact new SHA-256 and also checks its old fingerprint;
it does not silently omit the method. The other 12 protected methods and the
whole life batcher still compare unchanged with the original baseline. The new
hook is reported separately from `unchangedMethods`, with this contract and the
behavioral tests. No gameplay source guard or latency target was removed.

## Pilot performance gate

Use `qa/competition-load.mjs --pilot-gates=1 --busy-retries=0` with the documented
8/16-client active workloads. This mode makes timing misses fail the run: life-only
and life-during-results HTTP p95 at most 250 ms, result confirmation p95 at most
5 s, and every measured command-to-phone SSE convergence at most 2 s. Arrival
times are observed by the SSE reader, independently of the HTTP save reply.
Functional success and timing acceptance are reported separately; a timing failure
retains the full measurements rather than overwriting them with an empty error.

The first enforced three-round runs at configured 5 ms storage delay and zero busy
retries passed all gates:

| Synthetic clients | Life HTTP p95 | Life during results p95 | Confirmation p95 | Maximum SSE convergence |
| --- | --- | --- | --- | --- |
| 8 | 109.28 ms | 127.75 ms | 159.60 ms | 32.70 ms (2,304 observations) |
| 16 | 65.53 ms | 127.79 ms | 215.55 ms | 33.79 ms (3,840 observations) |

Raw reports: `.local/pilot-launch-implementation/pilot-8-gated.json` and
`pilot-16-gated.json`. Earlier before/fix-only runs remain in the same evidence
directory; do not interpret these short runs as endurance or hardware capacity.

No real OAuth, Firebase, phone rendering, venue network or production claim follows
from these loopback runs. The launch goal remains open for the complete artifact,
full candidate tests and required authorized hosted/device evidence.
