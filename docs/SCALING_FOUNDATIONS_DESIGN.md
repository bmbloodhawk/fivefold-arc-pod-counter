# Concurrent-player scaling foundations

Status: working technical design for the active unattended goal, November 11, 2026.
Baseline: fetched `origin/staging` at `d3f8442a131380d7ab500a751c21b881bec7e65d`.
Worktree: `fivefold-arc-scaling-foundations`, branch `codex/scaling-foundations`.

## Product contract and capacity target

Latest steering is authoritative: this is adoption/concurrency capacity for a life
counter, with straightforward capacity increases as usage grows. It is not a
shared worldwide rating system. The original saved goal's broader wording is
interpreted through these clarified requirements and the task list below.

This work prepares Fivefold Arc to serve many people and independent Tables at
once, with capacity that can be increased without rebuilding gameplay. Plan for
10,000 adopters. Adoption is not simultaneous load: first prove a 1,000-client
local concurrency milestone, then report measured limits and the hosting/cost path
for larger peaks. Never present a local fixture result as hosted global capacity.

Pod ratings remain private and independent. Tournaments remain separate. This
does not add a global rating, leaderboard, rating algorithm, location collection,
account requirement for casual play, or new tournament rules. Approved behavior
is in `docs/PODS_AND_TOURNAMENTS_SPEC.md`; subsequent user authorization permits
staging releases and this scaling work, superseding that file's original local-only
release boundary. Production, paid services, Firebase configuration/rules and bulk
or destructive data migrations remain outside authorization.

Preserve immediate local life feedback, seat/reclaim authority, existing counter
semantics and SSE transport. Competition processing must add zero reads or writes
to a life tap. Ordinary game recovery/diagnostics already write; those writes are
not competition tracking. A result is acknowledged as saved only after durable
acceptance; standings may visibly remain updating until processing completes.

## Capability map

| Module id | Responsibility | Depends on |
| --- | --- | --- |
| record-storage | Conditional single-record writes, bounded key pagination, namespace isolation | existing REST adapter |
| game-write-scheduling | Bounded, ordered recovery/diagnostic writes across Tables and complete drain evidence | existing REST adapter |
| competition-identities | Per-account identity indexes, per-identity aliases/membership lookup, erasure fencing | record-storage |
| competition-control | Group metadata, separate members/invites/table bindings and recoverable control operations | record-storage, competition-identities |
| competition-results | Immutable source/confirmation records, timeline and durable processing work | competition-control |
| competition-projections | Incremental standings, correction replay, resumable checkpoints and history pages | competition-results |
| table-ownership | One authoritative node per Table, fenced ownership, routing and restart recovery | record-storage, existing room recovery |
| capacity-evidence | Small/large HTTP+SSE tests, two actual app processes, long history and failure tests | preceding modules |

Build in that order, keeping table-ownership independent of competition membership.
Measure and address game-write scheduling before the active 1,000-client gate.
Existing incomplete `tasks/plan.md` / `tasks/todo.md` belong to other work and stay
untouched. This goal uses `tasks/scaling-foundations-plan.md` as its task list.

## Confirmed current boundaries

- `server/src/competitions.js`: `directoryPath`, `directory`, `changeDirectory`
  read/write one global identity/membership/alias/table-claim document. `changeScope`
  conditionally rewrites a whole Pod/event, including games and accumulated captures.
- `server/src/competition-tables.js`: `capture`, `confirm`, `history`, `reconcile`
  depend on that scope shape. Confirmation replays all Pod games or all event points.
  Accepted starts and source archives already provide durable completion evidence.
- `server/src/competition-write-coordinator.js`: the staging save fix orders updates
  per document within one process; ETags still arbitrate different processes.
- `server/src/competition-recovery.js`: startup scans the directory's Table claims;
  source-capture recovery is independent of the live counter path.
- `server/src/app.js`: `RoomService.rooms` and `.connections` own live state locally.
  `recoveryRecord` removes connection authority; `hydrateRecoveryRecord` requires
  renewed seat claims. Adding another server without routing/ownership can diverge.
- `server/src/playtest-ledger.js`: `update` provides REST ETag conditional PUT with
  eight attempts. This worktree now adds a bounded `$key` page contract; the
  baseline deployment did not have one.

An initial local drain probe of the existing normal game writer applied 200 life
changes in 14ms and persisted 408 diagnostic/recovery/checkpoint writes in 12.5s
with 5ms artificial delay per REST request (about 16 commands/second of drained
storage work). This is not a hosted-capacity number. The deployed baseline
serializes every Table through one promise; the larger gate must include that
work and its backlog. The local foundation now uses FIFO per Table with eight
independent operations in flight; see [scheduling contract and measurements](COUNTER_WRITE_SCHEDULING.md).
The eight-Table version of the same 200-command probe drains in 857–867ms, retaining
all 408 writes. A single-Table burst still drains in about 12.2s. This bounds active
requests, not backlog memory, and does not establish durable-before-ack ownership.
`qa/counter-storage-probe.mjs` makes the measurement reproducible and checks that
every event and the final recovery state actually persisted. The older competition
load harness kills its owned app in cleanup, so its result does not establish that
all background diagnostics drained.

## Storage and consistency decisions

1. Add explicit record/pagination interfaces to the existing service-authenticated
   adapter, preserving existing `read`/`update` behavior. Timeline keys include a
   fixed-width completion timestamp and game ID. Use `$key` range queries with
   bounded limits; sort REST responses locally. Do not require a Firebase rules or
   index configuration change. Reject invalid paths/cursors/limits before I/O.
2. Replace global directory writes for the new format with per-account indexes,
   per-identity mutable aliases and membership indexes, individual guest aliases,
   and immutable Table-session claim records. Account erasure leaves non-identifying
   tombstones that fence delayed writes. Identifying values must not enter immutable
   game or control-operation history. Resolve only identities needed by a request.
3. Use separate metadata/member/invite/active-Table records. Serialize an authorized
   control change through a small per-group conditional operation record containing
   its pending writes, then apply those writes idempotently and commit its version.
   Any process may finish an interrupted operation. Child records carry versions;
   delayed helpers must never overwrite newer values or resurrect erased data.
   Readers help/await pending work and verify a stable committed control version.
   No operation may copy accumulated game history into that record.
4. Store accepted starts, original completion evidence, each confirmed revision,
   confirmation retry keys and chronological history indexes independently. Only a
   host-confirmed full order enters standings. Persist durable processing work with
   publication through the control operation, so a crash cannot strand a saved result.
   Duplicate request IDs with identical payloads do no new work; conflicting reuse
   rejects. A deleted/removed actor must not gain access through a delayed request.
5. Process work at least once; effective results remain exactly once. Each replay
   captures a fixed confirmed sequence cutoff, chooses each game's revision at or
   before that cutoff, and persists draft progress at that cutoff. Normal later
   chronological additions apply incrementally. New confirmations do not repeatedly
   invalidate an in-progress replay. Publish a coherent, labeled as-of snapshot,
   retaining its updating state if newer work exists, then catch up. Older cutoffs
   cannot overwrite newer published state. Late arrivals/corrections in the tail
   schedule a subsequent bounded replay rather than restart the current one.
   Game-level rating changes remain derived records.
   Tournament round advancement/seating must wait for current combined standings.
6. Remove historical guest/capture accumulation from active Pod control records.
   Historical guests and accepted starts remain accessible through their game
   records. Maintain pending counts and active-work references without scanning history.

The detailed operation and projection invariants must be challenged by independent
review and failing tests before integration. A process-local queue alone is not a
cross-process lock; a background task alone is not a durable outbox.

### Durable discovery and erasure across formats

- Register each new group in a non-identifying, key-paged registry before creating
  its control state. Conditional control intent is the durable operation source.
  A ready-work index accelerates discovery, but is not the only record of work:
  a bounded, rotating sweep of registered control heads repairs missing tickets.
  Both scans persist cursors and use a per-tick work budget; neither downloads old
  games, historical Table claims or a global identity directory. A stale helper may
  redeliver completed work, but cannot repeat its effect or publish stale state.
  Test real process death before/after intent, child writes, ticket publication and
  acknowledgement, then restart with no remembered group IDs and no client retry.
- Reuse a legacy account's opaque identity when it exists. New-format membership
  indexes and old-format membership indexes are merged and deduplicated for My Pods;
  format changes cannot manufacture another member/rating entry. New accounts use
  per-account/per-identity records. A closed legacy or new account never falls back
  to the other store to recreate its identity.
- The feature-disabled eraser and compatible rollback build must erase both layouts.
  First close the account and durably record erasure work; clear/fence identifying
  values and account links in both layouts before acknowledging app-data deletion.
  Retain only non-identifying tombstones and numeric shared results. The existing
  legacy erasure operation is allowed when the account requests deletion; this is
  not a bulk migration. Test interrupted erasure, delayed alias/index writers, an
  account belonging to both formats, disabled competitions and compatible rollback.

## Compatibility, rollout and rollback

Use an explicit storage-format marker. New groups can use the new format while
legacy groups remain readable and playable. Compatibility code must understand the
new format before it is enabled for creation. Roll back to that compatible build,
not to a binary that cannot read newly accepted data. No automatic bulk conversion,
deletion or silent truncation of legacy histories. Any conversion dependency must
be prepared as a concrete per-group/rollout proposal for separate approval.

Preserve existing API DTOs where possible. Add an explicit projection-updating
state only where it explains a real wait; never claim Saved before durable acceptance.
History pagination must happen at storage, not by downloading every game then slicing.
Legacy compatibility costs must be reported separately from new-format measurements.

## Multiple-server Table foundation

Keep one authoritative owner per Table and route every phone at that Table to it.
Use shared, conditional ownership records with increasing fencing epochs. Ownership
loss/expiry must stop an old owner serving mutations before a replacement accepts
them. Acknowledged state and operation-ID deduplication must survive owner failure.
Connections and SSE authority must not be invented from a public snapshot; recovery
requires valid seat/host credentials and invalidates stale connection authority.

The proof must run two real app processes against shared wire-level storage, route
phones through both, force a contested ownership change and actual process death,
and verify converged counters and stale-owner rejection. A local lease unit test or
one-process exception is insufficient. Peer routing needs a fixed allowlist and
authenticated internal requests, bounded forwarding, disconnect cleanup and no
arbitrary client-chosen backend URL. Do not enable multi-instance hosting on the
single-instance staging service or create external credentials/services for this proof.

The exact durable game-command commit and forwarding contract is a separate review
checkpoint before implementation: persisting only occasionally cannot promise
recovery of acknowledged taps, and broadcasting uncommitted state is not safe failover.
Keep the current single-node path unchanged until the opt-in foundation is verified.
That checkpoint must include a paused former owner resuming after takeover, delayed
old recovery writes, lost responses after commit and commit-before-broadcast. Define
the operation-ID retry horizon explicitly. Test account-free and competition-disabled
Tables as well as competition-linked play.

## Verification and capacity evidence

Use Node's existing tests and actual loopback HTTP/ETag fixtures. Protect access,
invite/reclaim, guests/no-shows, erasure, correction chronology, duplicate completions,
multi-table events and private-account awards. Test failures at real process/storage
boundaries. Prove pagination bounds and record-size growth at 1,000 and 10,000 games.
Compare a 4–8-player Table, a 128-player event, and progressively larger independent
groups toward 1,000 connected synthetic clients. Record life-update and completion
latency, busy errors, bytes, memory/CPU and exact applied mutation counts; disable
busy retries for the result-save gate. Stop and report a load-generator hardware
limit rather than substituting it for a server-capacity conclusion.

Engineering gates (targets, not current measured claims):

- Small and 128-client runs: at least 60 seconds of actual mutations; p95 accepted
  life-update HTTP latency <=250ms at 5ms artificial storage delay, with every SSE
  observer converging within 2 seconds of an accepted update. Record 50ms-delay
  behavior separately; do not substitute that scenario's timing for the 5ms gate.
- 1,000-client milestone: 250 four-player Tables connected for 10 minutes, each
  client issuing one unique accepted life mutation per 10 seconds on staggered
  schedules (at least 100 mutations/second). Add a separate synchronized burst
  phase; publish its workload and result. Sustained p95 mutation latency <=500ms,
  SSE convergence <=2 seconds, exact mutation totals, zero unexpected errors and
  zero competition I/O on life-only activity. Include actual recovery/diagnostic
  writes and require their backlog to drain within 60 seconds after activity ends.
- 128-client confirmed-result burst: no application-level busy retries or unexpected
  errors; durable confirmation p95 <=5 seconds at 5ms fixture delay and <=10 seconds
  at 50ms. All completed standings must catch up within 60 seconds after the burst.
- Correct/replay 10,000 games while continuing at least one new confirmation/second
  for 60 seconds, including a late arrival, two workers and an actual process kill.
  Published sequence must advance, older checkpoints cannot overwrite it, and the
  projection must become current within 180 seconds after that run without pausing
  result submissions for replay. Snapshot correctness is checked against canonical
  chronological replay at its exact cutoff, not an arbitrary eventually matching total.
- If a target fails, diagnose and report it. Do not lower it silently or call a run
  with idle sockets the concurrency milestone. Identify whether the constraint is
  the app, real storage, the load generator or the current paid-capacity boundary.

Before a staging release: full tests, source-boundary check, compatible rollback,
exact running commit, delayed health, asset bytes and hosted protocol checks. Real
phones, real Firebase peak load, paid hosting and multi-region capacity remain
distinct evidence categories. Produce a concise two-phone checklist and a capacity
plan for 10,000 adopters with measured concurrency assumptions and approval costs.

Official constraints: [Firebase conditional writes](https://firebase.google.com/docs/database/rest/save-data),
[Firebase query bounds and response ordering](https://firebase.google.com/docs/database/rest/retrieve-data),
[Render multi-instance scaling](https://render.com/docs/scaling),
[Render shutdown during deploys](https://render.com/docs/deploys).
