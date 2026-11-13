# Scaling foundations: ordered implementation and evidence

Contract: [design and capability map](../docs/SCALING_FOUNDATIONS_DESIGN.md).
Scope: many concurrent life-counter users; plan for 10,000 adopters and prove a
first 1,000-connected-client local milestone. No global player rating system.
Preserve unrelated plans. Staging only; no paid services or live data migrations.

## Completed preparation

- [x] Fetch current refs; preserve staging save fix and production commit.
- [x] Create fresh `codex/scaling-foundations` worktree from staging `d3f8442`.
- [x] Inspect source ownership, storage/recovery paths and approved product rules.
- [x] Record latest user clarification, module boundaries, risks and verification.

## Ordered slices

Capacity prerequisite before the 1,000-client gate:

- [x] Diagnose ordinary recovery/diagnostic writer pressure with actual REST I/O.
  Initial 200-command local probe: 408 writes, 12.5s drain at 5ms artificial delay.
- [x] Verify reproducible `qa/counter-storage-probe.mjs`: 200 commands, 408 writes,
  1,515,205 bytes, 12.53s drain; every event and the final recovery state persisted.
- [x] Implement bounded in-flight scheduling across independent Tables, preserving per-Table
  ordering, full event persistence, retry/error visibility and latest recovery state.
  Include response-body cleanup and credential-refresh behavior in review/tests.
  Competition I/O and asynchronous hooks must stay outside the life mutation path.
  - [x] RED/GREEN for order, independent progress, concurrency, flush admission,
    response cleanup/truncation, immutable archive acknowledgement and token refresh.
  - [x] Re-measure 200 commands across eight Tables: 408 writes, 12.54s → 0.86s,
    repeat 0.87s; verify every event and final recovery state. Single-Table FIFO
    still takes about 12.2s. This does not bound backlog or prove live capacity.
  - [x] Reconcile independent review: preserve 412 retry on truncated echoes;
    require room identity on every queued Table record. RED/GREEN regressions pass.
  - [x] 340 server + 172 client tests; protected life/SSE source unchanged; an
    order-breaking mutation was rejected and restored. Local 8/128-client HTTP/SSE
    smoke tests pass without application busy retries; these do not prove full
    background drain or the later sustained-load gate.

1. [x] Bounded storage-query contract. Files: REST adapter, namespace wrapper,
   query helper/tests and wire fixture. Dependency: none.
   Accept: validated `$key` cursor queries transfer at most a bounded page, sorting
   matches Firebase, inclusive boundaries never duplicate/skip items, and existing
   conditional writes/no-op behavior remain unchanged. Verify focused RED/GREEN tests.
   - [x] Pure request/result contract RED/GREEN: response bounds, cursor deletion,
     ascending/descending order, numeric-key shapes and invalid inputs (10 tests).
   - [x] Actual REST requests and pagination through namespace/write wrappers (5 tests),
     including bounded wire bytes from 10,000 records and deleted cursor boundaries.
2. [x] Per-account identity/erasure store. Files: identity store and focused tests.
   Dependency: 1. Accept: no global-directory read/write in new-format identity flows;
   concurrent identity creation deduplicates; erasure tombstones defeat delayed
   alias/account-link resurrection. Verify CAS races and interrupted-operation replay.
   Mixed legacy/new-format identity, list and erasure storage follows the design's
   dual-format contract. Feature-disabled HTTP and rollback deletion proof remain
   in integration slices 3 and 9; this component is not enabled in the app yet.
   - [x] Storage component and 25 wire-level cases: canonical IDs, scoped native I/O,
     alias no-ops, mixed legacy data, ownership collisions and delayed/lost responses.
   - [x] Three actual worker-process cases: concurrent creation, initialization kill,
     and fresh-process erasure discovery with no remembered account ID.
   - [x] Independent implementation review reconciled; legacy-only collision,
     foreign-identity erasure and late final-ID fencing regressions fixed.
     Root-only writer retirement/ETag/protocol proof remains an activation gate.
     Domain/HTTP/rollback evidence remains required in slices 3 and 9.
3. [x] Integrate scoped identity lookup and Table claims. Files: domain, Table and
   tournament adapters plus contract tests. Dependency: 2.
   Accept: multiple Pods, invite/readmission/guest permissions and private DTOs stay
   identical; independent users never contend on one global directory record.
   - [x] Pure `lookup` and requested-scope name profiles, with no opening/deletion
     helping from screen reads. Foreign canonical mappings fail closed.
   - [x] Scoped directory/guest-name component: selected participants only, bounded
     lookups, owned guest names remain erasable, first-name guest retries and visible
     storage failures. Read through exact legacy leaves; no global directory scan.
   - [x] Per-Table claim component: independent-key CAS, same-target no-op, guard
     retry, lost-response recovery and legacy conflict checks. Preserve current
     `event_` tournament IDs. 50 component/worker cases pass.
   - [x] Independent review reconciled: real tournament ID mismatch and accidental
     erasure helping from scoped reads received RED/GREEN regressions. Full server
     362 + unchanged client 172 pass; swallowed-write-failure mutation is rejected.
   - [x] Wire these components through domain/Table/tournament and guest setup APIs;
     prove native HTTP permissions and feature-disabled shared-data erasure.
     Components are not enabled in the app or staging yet. Rollout/fence proof remains 9.
     - [x] Native HTTP happy flows: memberships/readmission, guests/cohosts, timed
       shared draws, standalone event points, late/early attendance and no life I/O.
     - [x] Review regressions: refresh incomplete scoped membership views on CAS
       retry; preserve the erased-before-attestation label without copying a name.
     - [x] Fence delayed Table claims against account erasure using durable account
       tickets. Native/legacy races, late initializers, exact ticket decisions and
       killed-erasure-worker recovery pass. Compound native setup and guest-host
       interruption proofs are completed below. Activation still requires slice 9.
4. [x] Versioned group-control operations. Files: scope store and tests. Dependency: 1.
   Accept: separate metadata/member/invite/active-Table rows; recoverable authorized
   operations; stable reads; stale helper and permission races reject. Verify actual
   two-writer REST races and restart with pending writes at each boundary.
   Restart discovery must use the ready index plus bounded registry repair, without
   prior in-memory group IDs, client retries or historical-game/Table-claim scans.
   - [x] Local control-store component: frozen bounded intents, separate versioned
     child rows/tombstones, exact operation receipts, stable reads, active-key
     manifests, ready tickets and bounded rotating registry repair. Thirteen
     actual REST tests and six real-process kill windows pass; fresh discovery
     receives no group ID. Stale-helper fence mutation is rejected and restored.
     Full suite: 415 server + 172 client, no failures/skips. Component contract:
     `docs/COMPETITION_CONTROL_STORAGE_CONTRACT.md`; evidence:
     `.local/scaling-full-20261112/control-*.log`.
   - [x] Opt-in native group creation/control adapters and ongoing bounded worker
     discovery now work through actual Pod/tournament HTTP. Legacy groups remain
     readable/writable. A real app SIGKILL/replacement recovers an interrupted
     rename without a group GET/client retry; blocked startup recovery leaves
     health and durable casual life HTTP usable. Historical audit rows are immutable
     and recent pages remain bounded with 10,000 stored entries.
   - [x] Three independent adversarial review cycles reconciled. Regressions cover
     reused-ID receipt races, numeric RTDB manifests, overflow, successful callback
     payloads, concurrent audits, prepared retries, rejected async guards and
     detached head callbacks. The last callback-isolation fix is self-verified after
     the third review, not represented as another independent approval. Full suite:
     433 server + 172 client; all pass, no skips. Evidence:
     `.local/scaling-full-20261112/partitioned-reviewed-*.log` and
     `independent-review-*.log`. Receipt/head-fence mutation is rejected/restored.
   - [x] Finish cross-record signed-actor/account-closure authorization and Table
     setup recovery locally. The earlier loopback gap erased an actor while
     a group-head PUT is delayed; the endpoint later denies access but its earlier
     privileged rename still committed. Historical diagnostic (not a passing gate):
     `.local/scaling-full-20261112/account-control-erasure-gap.{mjs,json}`.
     A Table claim could also publish before its group-control intent existed; death
     there lacked a complete setup payload. Existing tickets now participate in a
     fenced reservation/decision/cancellation protocol. A second profile read alone
     did not close the race. The implemented authorization contract is
     `docs/COMPETITION_CONTROL_AUTHORIZATION_CONTRACT.md`. Identity-only transitional startup and mixed
     legacy recovery remain compatibility gates. Native mode stays disabled normally.
     - [x] Signed native control now reserves a complete discoverable intent before
       per-account admission, pins a monotonic account revision and requires an exact
       durable account decision before child publication. Undecided work aborts after
       one nonrenewing deadline; committed work never expires. Settlement references
       remain discoverable until ticket retirement, with digest-only receipts.
     - [x] Indexed erasure freezes native plus legacy scope references, retains them
       through handoff failure, finishes/cancels exact group decisions and permanently
       erases organizer/inviter authority. Real HTTP deletion races pass; the earlier
       diagnostic above records pre-fix behavior, not the current signed native path.
       Revocation batches respect operation count/byte limits and retain progress
       through a final-marker failure; a fresh eraser finishes the 511-invite case.
       Historical index completeness still needs the compatibility gate in slice 9.
     - [x] A real app SIGKILL before account admission recovers through bounded
       background discovery with no remembered group ID. It cancels after the default
       30-second deadline, rejects the old delayed PUT and permits casual life changes
       during the wait. A focused 38-case component/process run passes. Core account
       decision and integration reviews each completed two cycles. The full suite
       passes 456 server + 172 client tests, no failures/skips. Evidence:
       `.local/scaling-full-20261112/account-control-reviewed-full.log`,
       `account-control-checkpoint.json` and `account-control-review-reconciliation.json`.
     - [x] Couple the existing Table claim ticket to complete group setup for signed
       and guest hosts. Both publications/fences precede retirement. Sixteen REST
       cases, four native HTTP cases and eighteen actual app SIGKILL cases pass,
       including old ready links and superseded cancellations. The implementation
       contract is `docs/COMPETITION_TABLE_SETUP_CONTRACT.md`. Normal activation
       stays off; the larger goal continues after this passing slice.
       Its two design-review cycles clarified reused-ready and superseded claims.
       The earlier half-link diagnostic is `table-setup-gap.{mjs,json,log}`; current
       passing proofs are `compound-table-{setup-final-focused,http-guards,process,
       process-outcomes,full}.log`. Full suite: 494 server + 172 client, no failures
       or skips; its 168-file source manifest matches the tested worktree.

## Checkpoint A: storage contracts

- [x] Independent adversarial design review reconciled against source and tests.
- [x] Existing tests remain green; new regressions prove changed behavior. Current
  full suite: 494 server + 172 client, no failures/skips.
- [x] No new competition I/O in life paths; no service/data migration performed.
  Client files, `app.js` and `playtest-ledger.js` match the full-handoff baseline;
  held-recovery/HTTP life checks pass. This does not establish later capacity gates.

5. [ ] Immutable completed-game repository. Files: game store and focused tests.
   Dependency: 1, 4. Accept: original source and revisions are append-only; conflicting
   source/request IDs reject; publication includes recoverable work; history pages
   remain bounded at 10,000 games. Verify source-size invariants and commit crash points.
6. [ ] Integrate capture/confirmation/history. Files: Table/domain/HTTP adapters and
   API tests. Dependency: 3–5. Accept: host-confirmed full order only, exactly one
   effective result, original seat identity/eligibility retained, legacy access intact.
7. [ ] Incremental standings and replay worker. Files: projection module/recovery and
   tests. Dependency: 5. Accept: append cost independent of prior game count; corrections
   and late results replay bounded pages; draft progress survives process kill and
   older cutoffs cannot overwrite newer projections. Verify points/ratings against
   existing pure rules. Fixed-cutoff replay must advance during continuing
   confirmations/late arrivals, publishing labeled as-of state before catching up.
8. [ ] Integrate projection state and event readiness. Files: domain/tournaments/UI
   and client tests. Dependency: 6–7. Accept: Saved follows durable acceptance; pending
   processing is clear; later seating uses complete combined standings; guest and
   personal-account award boundaries remain unchanged.
9. [ ] Compatible format rollout. Files: creation/wiring, compatibility tests and
   rollback notes. Dependency: 3–8. Accept: old groups playable, new-format records
   understood by the rollback build, no bulk conversion or lost historical data.
   Every permitted identity writer must share per-ID claims. Retire pre-compatible
   writers and fence delayed old root PUTs; compatible CAS callbacks must switch
   protocol on retry. Prove these gates before enabling any new identifying values.

## Checkpoint B: partitioned competition flow

- [ ] Full end-to-end source → host order → standings → history on the new format.
- [ ] 4–8-player feel checks and 128-player concurrent result gate with no busy retries.
- [ ] Long-history byte/read bounds and privacy/idempotency regressions pass.
- [ ] Reconcile fresh review findings before a compatible staging release.

10. [ ] Table-ownership/command durability contract. Files: ownership design/test
    specification. Dependency: 1. Accept: explicit linearization and fencing rules,
    no acknowledged-state loss claim based on asynchronous snapshots, peer-auth and
    connection/SSE routing defined. Verify adversarial failure timelines before code.
11. [ ] Shared ownership and durable command store. Files: ownership module and tests.
    Dependency: 10. Accept: one effective owner, monotonically fenced writes,
    operation-ID deduplication and exact recovery of acknowledged state.
12. [ ] Opt-in routing and connection handling. Files: router/server wiring and tests.
    Dependency: 11. Accept: two real app processes share a Table, same-owner routing,
    stale authority rejected, bounded forwarding/SSE cleanup, single-node fallback
    unchanged. Verify actual HTTP/SSE with owner SIGKILL and contested takeover.

## Checkpoint C: capacity and release

13. [ ] Extend isolated load harness in a separate slice. Verify 4–8, 128, then
    progressively up to 1,000 synthetic connected clients across independent groups;
    record resource bounds, life/result p95, exact mutations and all failures.
    Use the design's explicit active workload, duration, latency/convergence and
    backlog bounds; include actual recovery/diagnostic writes, not only SSE sockets.
14. [ ] Review final diff and run full tests, protected-source comparison, two-process
    recovery proof, long-history and load gates. Stop to fix regressions; do not
    weaken assertions, increase busy retries or lower load to manufacture success.
15. [ ] Deploy compatible slices only to existing staging, verify running commit,
    delayed health, asset bytes and hosted protocol tests; confirm production intact.
16. [ ] Write staging handoff, remaining limits, approval-ready hosting/cost path for
    10,000 adopters, rollback and a concise real two-phone checklist. Distinguish
    simulated, hosted, physical-phone and paid-capacity evidence.

## Completion audit

- [ ] Every objective requirement maps to inspected source/runtime evidence.
- [ ] New-format partitioned records, durable processing and two-process table
  ownership/recovery all work through actual app routes, not isolated stubs.
- [ ] User rules and responsive small-group play retained; no public/global ranking.
- [ ] Staging release verified; no production changes, spending or bulk migrations.
- [ ] Evidence limitations and external approval dependencies are concrete and honest.

## Independent review reconciliation

First adversarial review found four actionable design gaps: restart discovery,
mixed-format identity erasure, replay liveness and meaningful load acceptance.
All four have explicit contracts and tests above; implementation must prove them.
Command/lease and peer-routing details remain at the dedicated checkpoint before
code. No external-model CLI or paid service was invoked for this unattended review.

Second review found no further design contradiction. Required implementation
proofs remain: simultaneous legacy/new identity creation, cross-format competing
Table binding and its crash window, and game-detail rating changes labeled with
the exact projected revision/cutoff. Include mixed-version rollout races before
enabling new writes; an older binary with only legacy erasure must never coexist
with new identifying values it cannot erase. Do not infer this safety from a
format marker alone.

## Full-handoff overnight continuation — November 12

The user explicitly expanded the active chat goal to the whole handoff, continuing
until completion or a user pivot. The earlier 30-minute validation/readiness goal
is complete; it is evidence for this larger goal, not completion of this checklist.
The current readiness report is `docs/LOCAL_SCALING_READINESS_2026-11-12.md`.

Work only in this existing scaling worktree and branch. Preserve the unfinished
implementation; do not replace it with an easier alternative. The starting 17 dirty
files, checksums and exact diff are saved under `.local/scaling-full-20261112/`.
Do not edit the unrelated `tasks/plan.md` or `tasks/todo.md`.

Continue the existing dependency order in tested slices:

- [x] Finish local scoped identity/Table integration and interrupted-operation proof;
  account tickets and cancellation generations already exist and must be retained.
- [x] Complete versioned, partitioned group-control operations and durable discovery:
  ready-work tickets plus bounded registry repair, stable reads, stale-helper fences,
  and real restart recovery with no remembered group IDs or historical scans.
- [ ] Complete immutable source/revision/history storage, durable result processing,
  incremental standings, bounded correction replay and honest pending/saved UI.
- [ ] Prove cross-format identity erasure, compatible writer fencing and rollback
  before any activation. No bulk conversion or live data changes.
- [ ] Define the ownership/command durability contract before implementing opt-in
  peer routing; prove two real app processes, contested takeover, stale-owner
  rejection, exact recovery, deduplication and credential-safe HTTP/SSE.
- [ ] Diagnose and fix burst/result-period latency without dropping the recovery
  acknowledgement boundary, changing life semantics or adding competition I/O to
  counter mutations. Preserve complete diagnostics and recovery persistence.
- [ ] Pass meaningful 4–8, 128 and 1,000 active-client gates plus 10,000-game bounded
  history/replay tests, retaining all counts, resource limits and failure evidence.
- [ ] Finish full regression/review/completion audit and prepare a concrete staging
  release/rollback package, capacity assumptions and real two-phone checklist.

The user's existing external-action boundary still applies. No commits, branch
switches, other worktrees, deployments, production/live-service access or changes,
paid services, external messages, or live data migrations/deletions are authorized
by this continuation. Staging/physical-device work remains an explicit dependency
for later approval/testing; do all authorized local work and preparation first.
Do not mark the entire goal complete by silently dropping an unmet requirement,
lowering a target, relabeling a component test as integrated evidence, or ending at
one passing slice. Carry remaining work across goal turns.
