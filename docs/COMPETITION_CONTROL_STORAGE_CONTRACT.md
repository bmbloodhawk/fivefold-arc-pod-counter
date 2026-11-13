# Versioned competition control operations

This is an internal, opt-in storage component. It does not run from a life change,
enable native storage in normal startup, or authorize an HTTP caller on its own.
The existing account-fenced Table authorization must be preserved in integration.

## Durable records and admission

Use `competitions-v2/group-registry/{id}` before admitting any group intent. The
non-identifying registry contains only kind and opaque ID. A group head at
`competitions-v2/groups/{id}/head` holds a committed version, the keys of current
control rows, and at most one pending operation. Separate versioned child rows
hold metadata, members, invites, active Tables, rounds and work references.
Completed games, revisions and standing-history payloads are not control rows.
Administrative audit events are append-only rows outside the active-key manifest;
stable reads load only the requested recent audit page.

`begin(kind, id, {operationId, baseVersion, changes}, {guard})` conditionally admits
one operation against the exact committed version. The caller has checked domain
permissions against that version; the synchronous guard is checked again on every
conditional retry. A different pending operation or stale base version rejects so
the caller must obtain fresh state and reauthorize. Helpers finish an admitted
decision; they do not invent an authorization decision. Cross-record account
erasure fencing remains an integration requirement, not an implied promise of
this low-level API.

The default admission API freezes canonical JSON bytes and their hash before network I/O. A
durable per-operation receipt is written before the head commits. Same-ID retries
require identical input; reuse with different input rejects. A receipt is not
reported committed until the head has reached its version. Historical receipts
are read by exact ID, never downloaded as one collection.

The trusted native scope adapter may supply a synchronous `prepare` callback. It
publishes the successful admission callback's row values (including current seat
proofs and timestamps), preserving the existing REST-CAS callback semantics. A
separate payload hash validates those canonical bytes; the original frozen request
hash still identifies retries. Immutable audit keys must match the preflight set;
new-admission immutable checks run only after the observed/requested head version
and matching-pending checks. A matching pending retry keeps its already-admitted
payload. Both guard and prepare receive detached head snapshots and cannot mutate
publication state. Rejected promises from invalid asynchronous callbacks are
consumed before the synchronous-callback error is returned.

## Publication and readers

`resume` applies pending rows idempotently, persists progress, writes the receipt,
then conditionally advances the head and removes that operation. Row versions
never move backwards. Deletion leaves a versioned tombstone, so a delayed helper
cannot resurrect an older value. Current row keys change atomically with the head;
routine reads therefore do not walk historical tombstones. Old helpers cannot
change a newer head or remove a newer ready-work ticket.

`read` helps pending work and verifies the committed head before and after child
reads. It returns a coherent version, or an explicit retryable error under ongoing
contention; it never presents a partially published change as committed. The head
key manifest is bounded by the active roster/control state, not completed-game
count. Individual rows are at most 64 KiB; an operation has at most 512 distinct
row changes and 1 MiB of canonical payload. Each collection has at most 4,096 live
keys. These are explicit safety limits, not demonstrated hosting capacity.

## Restart discovery and work budgets

A ready ticket at `competitions-v2/group-work/{id}` accelerates work discovery.
Intent remains authoritative: death after intent but before ticket publication
must not strand work. `recover` reads bounded key pages of both ready tickets and
the durable registry. It persists rotating cursors per worker, reserves a child-
write budget for both channels and resumes only those group heads. It never scans
the global directory, historical games, operation receipts or old Table claims.
Different worker IDs have independent cursors; conditional publication remains
correct with overlapping helpers. Storage errors remain visible.

Personal names, raw account IDs and bearer/seat/host credentials must stay outside
operation payloads. Known identifying/credential field names are rejected; domain
serializers still own semantic data classification. Group metadata may contain a
group title. Helpers must not copy personal aliases into immutable receipts.

## Required proof before integration

Use actual loopback REST/ETag storage and independent adapters. Prove admission and
read consistency, same/different-ID retries, stale base versions, independent group
progress, delayed helper writes after newer updates/deletes, missing-ticket repair,
bounded discovery with persisted cursors, explicit storage failures, and actual
process termination/restart without remembered group IDs. Then integrate current
domain permissions and account erasure boundaries; component tests alone do not
establish native app readiness.

## Initial local component evidence

Thirteen wire-level tests and six real worker-process kill/restart cases pass.
The kills cover intent, ticket publication, child writes, receipt, head commit and
ticket cleanup. The fresh recovery process receives no group ID and does not rely
on an HTTP client retry; a later same-ID retry is checked separately for no repeat
effect. A delayed older REST request is allowed to reach storage after its worker
dies, so conditional tags and row-version fences are exercised rather than mocked.

Additional failing-then-passing cases found and fixed two admission races in the
new component: caller mutation of a base version during I/O, and a duplicate whose
receipt read preceded another helper's commit. Known personal-field rejection is
case-insensitive. A mutation removing the stale-row version fence is rejected by
the regression, and the exact source is restored afterward.

The full suite passes 415 server and 172 client tests. Logs are retained under
`.local/scaling-full-20261112/control-*.log`. This is component/self-review evidence;
the native app still uses its previous control layout and its startup discovery
gap remains until the next integration slice. Cross-record account authorization,
independent review, mixed-writer rollout and actual native HTTP recovery are still
integration gates. No normal startup flag, client life path or live service changed.

## Native control integration

`CompetitionScopeStore` adapts current group-control callbacks to separate rows.
It creates the new format only when explicitly injected, can still read/change
legacy groups, serializes same-process edits by group and reauthorizes from fresh
state after a head-version conflict. Direct game-history or standings rewrites are
rejected: those require the separate result/projection repositories. Normal
startup still does not select this format.

Native `CompetitionRecovery` runs bounded ready/registry discovery on every tick,
processes at most twenty discovered scopes and rotates remaining work. It does
not call the global identity directory. The loopback QA entry point listens before
starting recovery, matching the production entry point's nonblocking lifecycle.
A real replacement-process test holds startup metadata writes, proves health and
a durable casual life change remain available, then verifies the interrupted
HTTP rename finishes before a client requests its group.

Independent reviewers ran three bounded adversarial cycles on the journal and
scope integration. Their concrete findings received failing-then-passing tests:
operation-ID reuse after a stale receipt, RTDB numeric manifest holes, next-version
overflow, stale callback payloads, concurrent audit/version ordering, prepared
audit retries, rejected asynchronous guards, and mutable head callback arguments.
The final callback-isolation finding was fixed and verified after the third cycle;
it was not represented as a fourth independent approval. Cross-model review was
skipped for this non-interactive run; no external CLI was invoked.

Remaining gates include cross-record account-closure authorization, recovery of
Table linking across claim publication/group admission, native immutable results
and projections, mixed-writer activation/rollback and the wider capacity gates.
The control-HTTP/restart proof does not establish those remaining capabilities.

Current verification: twenty journal tests, seven journal-process cases, nine native
HTTP cases, one native app-process case and the existing recovery checks pass in the
focused 39-test run. The full suite passes 433 server plus 172 client tests with no
skips. A mutation removing the receipt-observation/head-version fence is rejected;
the exact source is restored. Evidence is retained in
`.local/scaling-full-20261112/partitioned-reviewed-{focused,full}.log` and the
`independent-review-*` / `receipt-version-fence-mutation.log` files.

The next account-authorization gate is a confirmed cross-record race, not a passed
capability: a delayed privileged group-head write can commit after the actor's
account erasure finishes, even though the endpoint's later read returns 403.
The diagnostic is `account-control-erasure-gap.{mjs,json}` in that evidence folder.
Do not enable native storage until account closure fences uncommitted group work
and Table setup can recover across claim publication and group admission. A fresh
profile read cannot fence an already-in-flight write to a different record.

## Subsequent local authorization and setup completion

The account-closure and half-link findings above record the earlier integration
checkpoint. They are now addressed in the opt-in native path by the account and
compound setup contracts: `docs/COMPETITION_CONTROL_AUTHORIZATION_CONTRACT.md` and
`docs/COMPETITION_TABLE_SETUP_CONTRACT.md`. Scoped identity/claim integration and
versioned control are complete locally; normal startup remains disabled pending
the result/projection and compatible-writer gates.

The current full suite passes 494 server plus 172 client tests with no skips. Its
168-file source manifest matches the tested tree. Eighteen real app SIGKILL cases
cover signed/guest setup phases, reused ready links without nonces and superseded
cancellations, with independent replacement discovery and retained casual life
availability. Evidence/audit: `.local/scaling-full-20261112/compound-table-full.log`
and `compound-table-checkpoint.json`. These local proofs do not establish hosted
capacity, real phones or multi-node live-Room ownership; the full goal remains active.
