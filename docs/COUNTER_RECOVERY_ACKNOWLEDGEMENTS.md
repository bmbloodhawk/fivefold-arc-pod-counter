# Counter recovery acknowledgements

This local fix addresses acknowledged counter changes disappearing when an application
process is killed before its background recovery writes drain. It does not activate
native competition storage, distributed table ownership, or a deployment.

## Contract

- Successful HTTP room snapshots wait for that table's existing recovery write.
  This includes life/counter adjustments, absolute counter edits, creation, reclaim,
  and lifecycle routes returning snapshots. A successful save contains the normal
  hashed seat proofs and the existing bounded operation-ID window.
- No new storage request is added to a normal successful counter change. Diagnostic,
  recovery, checkpoint, and completion writes retain their per-table FIFO lane.
  Another table's pending writes do not impose a global flush.
- A storage failure or a five-second acknowledgement timeout returns
  503 RECOVERY_SAVE_FAILED, never a false success. A later room refresh or duplicate
  request can retry the latest failed recovery payload without applying another delta.
  Admission-time JSON is reused; an older failed save cannot replace a newer snapshot.
- The final completion recovery record is included in the acknowledgement boundary.
- Immediate local feedback and existing SSE broadcasting remain unchanged. Visible
  optimistic/SSE state can precede its HTTP confirmation. An unconfirmed request can
  still be lost in a crash; this is not a guarantee for every briefly displayed value.
- This is a single-process durability boundary. It does not fence concurrent live-room
  owners, extend the existing operation-ID retry window, or make memory-only ledgers
  survive a process exit. No storage paths or record schemas change.

## Verification

server/test/counter-recovery.test.js covers pending save acknowledgement, independent
table progress, concurrent duplicate requests, storage failure and refresh retry,
completion evidence, frozen retry bytes, no added normal I/O, bounded waits, stale
retry ordering, and an actual SIGKILL followed by a fresh process and seat reclaim.

The new regression first failed on the original code (life restored to 40 instead of
60 after twenty successful changes). It passes with this fix. Removing the wait is
rejected by the HTTP regression. The full suite passes 396 server and 172 client tests.
All thirteen protected life/SSE functions and the complete batcher match the starting
snapshot. Load/restart reports and logs are retained under .local/evidence/ and
.local/capacity-128/; synthetic REST fixtures do not establish Firebase, hosting,
physical-phone, or production capacity.

## Rollback

The existing recovery format remains readable by earlier code. Reverting this local
code would restore the earlier acknowledgement-loss risk. Production, service
settings, Firebase rules/data, and the unfinished competition integration are untouched.


## Local load measurements

The 128-client / 32-table repeat used the same normal write paths and a 5 ms
loopback REST fixture, with three completed warm-up games per table, 3,840 scheduled
life changes over 303.76 seconds (300-second target), synchronized traffic,
simultaneous game finishes, reconnects, complete drain and process replacement.
It recorded no unexpected errors. Normal life-request p95 was 90.89 ms; burst p95
was 531.86 ms; life-during-results p95 was 292.41 ms; confirmation p95 was 1,697.55 ms.
All final recovery versions/life and 6,985 diagnostic events were checked. The final
forced-kill probe lost zero of twenty acknowledged changes, versus twenty lost before.

The life-during-results result exceeds the earlier *proposed* 250 ms fixture goal.
Immediate local/SSE feedback remains unchanged and has a regression proving it
arrives while storage is blocked; this is a durability/functional pass, not a claim
that every proposed latency target has passed. HTTP confirmations now include storage
latency rather than ending before persistence.

That five-minute run preceded the additional competition-response routing guard.
The final guard is covered by its dedicated failing-then-passing regression, the full
568-test suite, and a subsequent eight-client run with 50 ms artificial storage delay.
The slower run also retained all twenty acknowledged changes across actual SIGKILL.
Its numeric delayMs parameter is authoritative; the harness's generic limits sentence
still mentions the default 5 ms delay. No metrics or assertions were rewritten.

Evidence:
- .local/evidence/crash-fix-128-2026-11-12T07-51-27-261Z/report.json
- .local/capacity-128/crash-recovery-final-full-tests.log
- .local/capacity-128/crash-recovery-final-focused-v2.log
- .local/capacity-128/crash-recovery-mutation.log
- .local/capacity-128/crash-recovery-source-boundary.log
- .local/capacity-128/crash-fix-8-slow-storage.log

## Thirty-minute final-source validation

The final source completed 1,805.83 seconds of sustained 128-client traffic, exactly
23,040 scheduled life changes, additional bursts and concurrent results. All 32
recovery records and 26,177 diagnostic events matched; no saves remained pending.
All 128 clients reclaimed after process replacement. A separate actual SIGKILL
probe again recovered all twenty acknowledged changes without a post-command flush.

Normal life HTTP p95 was 91.93 ms; synchronized burst p95 was 560.56 ms (midpoint
burst 598.23 ms); life during results was 285.59 ms; result confirmation was
1,689.62 ms. Thus the proposed 250 ms target still fails for bursts and life during
results. Immediate feedback remains unchanged. No further application edits were
made. See LOCAL_SCALING_READINESS_2026-11-12.md for memory, queue, interpretation,
unfinished native startup recovery, and the recommended next step.

Final evidence: .local/evidence/crash-fix-128-2026-11-12T08-17-12-934Z/report.json.
