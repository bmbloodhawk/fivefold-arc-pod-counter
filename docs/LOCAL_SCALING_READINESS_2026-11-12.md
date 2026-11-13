# Local scaling readiness — November 12, 2026

The crash-recovery fix passed its full local validation. The larger scaling project remains unfinished. Heavy bursts exceed the proposed HTTP latency target, and the new competition storage mode still needs startup recovery before activation.

Scope: finish the 128-client long test, then review what is proven, what remains, and the next bounded step. This includes the readiness review added by the user before bed. All work used `C:/Users/nibay/.codex/worktrees/fivefold-arc-scaling-foundations`, branch `codex/scaling-foundations`, HEAD `0cd2f05263a8dae760d673304b8beac67ef8dd43` with the existing uncommitted work. No application/client/test source changed during this overnight validation. No commit, branch switch, worktree creation, deployment, production access, or paid service was performed.

## What passed

- 128 synthetic HTTP/SSE clients across 32 four-player Tables; 96 completed warm-up games. The target was 1,800 seconds of paced traffic; measured duration was 1,805.83 seconds. The full scenario, including setup and restart checks, took 1,879.4 seconds.
- Exactly 23,040 paced life changes, plus 512 midpoint-burst changes, 2,048 additional burst changes, and 64 control-Table changes during 20 seconds of simultaneous results. No application busy retries or unexpected errors.
- All final recovery versions and life values matched 32 authoritative Tables. All 26,177 admitted diagnostic events were present. All observed room-write attempts settled successfully. Nothing remained queued at the final drain; the already-caught-up drain took 0.13 ms.
- A replacement process recovered all 32 Tables; all 128 clients reclaimed seats. Thirty-two in-play reconnects also passed, including rejection of superseded connections.
- In a separate crash probe, twenty HTTP-confirmed changes all survived actual SIGKILL without a post-command flush. A fresh process read the same disposable storage fixture. The earlier unfixed run lost all twenty. This tests application-process failure while storage remains available.
- The existing full suite has 396 server plus 172 client tests passing, none skipped. All 143 files in the long-run manifest match the final-source slower-storage run. The existing held-storage regression proves SSE feedback arrives before HTTP acknowledgement; the protected life/SSE functions and client batcher remain unchanged. Physical phone rendering has not been tested.

## Timing and resource evidence

The fixture adds 5 ms storage delay. Values below are HTTP p95: 95% of the measured replies finished within that time.

| Workload | p95 | Proposed local target | Result |
|---|---:|---:|---|
| Paced life changes | 91.93 ms | 250 ms | Pass |
| Midpoint life burst | 598.23 ms | 250 ms | Miss |
| Additional synchronized life burst | 560.56 ms | 250 ms | Miss |
| Life changes during game results | 285.59 ms | 250 ms | Miss |
| Result confirmation | 1,689.62 ms | 5,000 ms | Pass |

Observed life-update convergence was at most 619.08 ms, below the proposed 2-second bound. This harness's request-to-convergence measurement includes awaiting the HTTP response; it is not a measurement of browser rendering or individual tap feel. Its functional `passed` flag does not enforce every latency target; the misses above remain visible.

The new HTTP acknowledgement waits for the existing per-Table FIFO recovery write. This intentionally exposes storage/queue delay previously hidden by an early success response. No normal extra recovery write or read is added. Source and regression evidence explain that boundary; these measurements do not isolate CPU, fixture serialization, and storage scheduling costs individually.

Compared with the earlier 30-minute run, ordinary HTTP p95 increased from 24.38 to 91.93 ms, while peak queued room jobs fell from 4,121 to 282 and peak frozen payload bytes fell from 74,905,890 to 4,849,052. The two runs have slightly different control-command totals, so these are workload comparisons, not a precise causal benchmark. Durability must not be removed to manufacture faster acknowledgements.

During the original process's sustained phase, RSS rose from 131.09 to 290.14 MiB, peaking at 295.52 MiB. Its final ten minutes ranged from 286.78 to 293.20 MiB. Heap rose from 18.99 to 62.94 MiB, peaking at 78.14 MiB. Replacement-process samples are excluded. This shows no continuing RSS ramp in that final interval; it does not prove leak-free or bounded long-term memory. Through the initial process's final drain, the room writer sent 54,481 PUTs totaling 898,582,606 request-body bytes; replacement-process traffic is additional. This is a local wire-volume measurement, not a hosting bill or adoption estimate.

## What remains in the scaling work

| Area | Current evidence and boundary | Disposition |
|---|---|---|
| New identity/Table authorization | Account tickets, reservation/commit/publication, cancellation generations, erasure races, and a killed-erasure-worker test already exist in the unfinished files. Some checklist text predates this code. | Preserve and finish review/integration proof; do not reimplement tickets because of an unchecked box. |
| Native competition startup recovery | A fresh local REST fixture reproduces failure: `CompetitionRecovery.discover()` calls `domain.directory()` without a group; native mode requires a group and returns `400 COMPETITION_INPUT`. Legacy discovery succeeds. | Confirmed activation blocker for the new mode. Implement durable, bounded discovery of unfinished work and prove recovery in a fresh process without remembered group IDs. |
| Long group history and standings | Group updates still write whole scope records. Pod confirmation replays confirmed games; tournament standings iterate game history. Tonight's 128-client test uses the existing competition mode and a short event history. | Growing-history cost is visible in source but not measured here at 10,000 games. Partition/incremental-processing work remains separate. |
| Multiple app servers | Live rooms remain in a process-local Map. Competition Table claims explicitly concern setup, not application-node ownership. | This fix proves one-process recovery only. Fenced ownership and two-process takeover are still needed before multiple active servers can safely share a Table. |
| Connection limits and hosting | Source defaults are 32 streams per IP and 64 globally. This test explicitly used 128 and 256 on one synthetic network. Live settings were not inspected. | Raising configuration limits is not capacity proof. Hosted storage/network behavior and venue Wi-Fi still need evidence. |
| Wider adoption | The measured steady rate is roughly 12.8 unique life commands/second from 128 clients. No 1,000-client gate or live-adopter guarantee was established. | Choose peak simultaneous use separately from total adopters; do not translate this result into “supports 10,000 users.” |

Relevant owning source: [startup recovery](C:/Users/nibay/.codex/worktrees/fivefold-arc-scaling-foundations/server/src/competition-recovery.js:7), [scoped directory validation](C:/Users/nibay/.codex/worktrees/fivefold-arc-scaling-foundations/server/src/competition-directory-view.js:40), [authorization tickets](C:/Users/nibay/.codex/worktrees/fivefold-arc-scaling-foundations/server/src/competition-identity-store.js:229), [Pod replay](C:/Users/nibay/.codex/worktrees/fivefold-arc-scaling-foundations/server/src/competition-tables.js:427), [tournament standings](C:/Users/nibay/.codex/worktrees/fivefold-arc-scaling-foundations/server/src/tournaments.js:226), [queue admission](C:/Users/nibay/.codex/worktrees/fivefold-arc-scaling-foundations/server/src/keyed-write-queue.js:15), and [connection defaults](C:/Users/nibay/.codex/worktrees/fivefold-arc-scaling-foundations/server/src/live-stream-limits.js:11). The queue limits concurrent writes, not total pending admissions; tonight's caught-up queue is workload evidence, not a general backlog bound.

## Recommended next step

For the unfinished local scaling work, make the next goal bounded native recovery discovery and interrupted Table-setup recovery. Keep the new mode disabled until that proof and compatible-writer/rollback checks pass. Do not expand that goal into the entire architecture plan.

Before releasing the crash fix, review its narrow diff and test it on existing staging with real phones, including quick life taps, a simultaneous game finish, and reconnect. Investigate burst-confirmation latency with hosted evidence. Those external actions require a later authorization. Current evidence does not justify requiring multiple application servers simply to attempt a 128-client event.

## Evidence and preservation

The long run uses loopback-only disposable REST storage, synthetic authentication and real local app HTTP/SSE routes. The observer adds payload-size serialization. No live Firebase, hosting service, physical phones, venue network, or machine/storage power-loss durability was tested.

- [Raw long-run report](C:/Users/nibay/.codex/worktrees/fivefold-arc-scaling-foundations/.local/evidence/crash-fix-128-2026-11-12T08-17-12-934Z/report.json)
- [Derived validation summary](C:/Users/nibay/.codex/worktrees/fivefold-arc-scaling-foundations/.local/evidence/crash-fix-128-2026-11-12T08-17-12-934Z/validation-summary.json)
- [Native startup reproduction](C:/Users/nibay/.codex/worktrees/fivefold-arc-scaling-foundations/.local/evidence/crash-fix-128-2026-11-12T08-17-12-934Z/readiness-startup-discovery.json)
- [Full test output](C:/Users/nibay/.codex/worktrees/fivefold-arc-scaling-foundations/.local/capacity-128/crash-recovery-final-full-tests.log)
- [Long-run command output](C:/Users/nibay/.codex/worktrees/fivefold-arc-scaling-foundations/.local/capacity-128/crash-fix-128-1800s-overnight.log)

Checksums confirm all twelve pre-existing unfinished files, including both previously untracked competition tests, are unchanged. The load run also verified its complete source manifest was unchanged. Tonight added this report, appended final measurements to the crash-fix notes, and retained ignored QA evidence; it made no further application changes.
