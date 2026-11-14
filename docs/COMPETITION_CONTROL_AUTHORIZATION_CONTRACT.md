# Account-fenced control and interrupted Table setup

Status: signed-account control, indexed erasure and compound Table setup are
implemented and verified locally. Native activation remains off. Result/projection
storage, historical index completeness and compatible writer retirement remain activation
gates; this document does not claim those unfinished capabilities are complete.

## Reproduced problem

The loopback diagnostic in
`.local/scaling-full-20261112/account-control-erasure-gap.{mjs,json}` delays a
privileged group-head PUT, completes account erasure, then releases the PUT. The
endpoint returns 403 on its later view read, but the rename has already committed.
A second profile lookup cannot fence a write to a different record.

There is also an interrupted-link window: `CompetitionTables.bind` completes
`domain.claimTable`, including ticket cleanup, before admitting the group-control
change that records the Table and seats. Death there leaves a ready claim with no
complete durable group-setup payload. Registry repair cannot invent that payload.

## Required invariants

- Signed actor authorization must have a durable decision in the same account
  record that erasure closes. A closing/closed account cannot commit an undecided
  operation. Removed-group-member authority must be checked against the exact
  group version being reserved.
- No control child writes or visible group publication may occur while an account
  authorization decision is pending. Admitted references contain no personal
  aliases, raw account IDs or bearer/seat/host credentials.
- Already-committed decisions must finish exactly once despite process death or
  erasure. Erasure fences/cancels undecided work and finishes committed work before
  dropping its discoverable references and acknowledging deletion.
- Both the Table claim and the group setup must be recoverable before their shared
  account ticket is cleared. Preserve existing claim generations/cancellation
  fencing; never revive an older pending claim over another established claim.
- Every decision compares its operation ID, request hash and target. A stale
  request cannot commit a later ticket merely because an intent hash/target was
  reused. Matching retry receipts do not reauthorize an erased actor's new action.
- Recovery uses the ready index/registry plus exact account-decision references,
  not account-directory, historical-game or Table-claim collection scans.

## Candidate protocol

1. Read/authorize against a group snapshot, then register that scope in the active
   identity's existing per-identity scope index before reserving any group work.
   The index does not grant membership. Identity erasure must atomically freeze
   that index before it fences the listed groups; an initializer arriving after
   that freeze rejects. Repeat this step after every fresh group-version retry.
2. Reserve the group head against the observed base version with a complete frozen setup
   payload and a typed account-ticket reference. It is waiting for authorization,
   not an immediately applicable control operation. This discoverable private stub
   must precede the first account-ticket mutation. It carries the exact account/
   operation locator, hashes and a nonrenewing abort-eligibility deadline. It does
   not carry aliases, raw account IDs or credentials. Recheck domain/Room guards at
   reservation; group membership cannot change around a reserved head. Read and
   freeze the expected account admission revision before this reservation, so a
   missing-ticket initializer is identifiable and can also be fenced.
3. Create the exact pending account ticket while the account remains active,
   binding operation ID, group/base version, frozen request/payload hashes and any
   Table claim. The initial ticket write uses a frozen expected monotonic account
   admission revision. Admission, decisions, cancellation and retirement advance
   that revision; a paused old initializer cannot recreate a retired ticket.
   Existing Table tickets must be extended/reused, not bypassed. Reserve the
   existing per-Table claim for Table linking.
4. Conditionally commit the account decision while it remains active, verifying
   the exact group/claim reservations and current required live-owner guard. This
   is the cross-record actor-authorization decision; a helper must not invent one
   from a public room snapshot or a stale roster.
5. Publish the committed authorization into the group operation, finish its child
   writes/head, and publish the Table claim. A committed account decision retained
   through erasure can finish these steps without granting fresh caller access.
6. Clear the account ticket only after every referenced publication or cancellation
   fence is durable. A fresh worker can recover without an HTTP client retry or
   remembered group ID. All normal startup/disabled-feature erasers must understand
   the ticket shape before native activation.

## Cancellation and stale requests

An undecided operation must be safely cancelable even when its reservation PUT has
not reached storage. A possible minimal fence is an immutable cancelled-operation
receipt plus consuming the next group control version without applying child rows.
That prevents a delayed old-base PUT from being accepted after cancellation, using
the existing head-version/ETag fence; it avoids resetting a version or clearing a
reservation back to an indistinguishable state. Do not disturb a different pending
operation. An initial group creation cancelled before metadata publication must
remain unavailable, not become a corrupt visible group or endless recovery error.

Never cancel after child writes have been authorized. A committed account decision
must be completed, while a pending account decision can be cancelled atomically
against that same account record. Preserve another operation's newer ticket.

A stub with no account ticket is also abortable. Its helper first updates the
account record: cancel an exact pending ticket if one appeared, finish an exact
committed ticket if commitment won, or advance the admission revision beyond the
stub's frozen expected revision when the ticket is absent. A matching terminal
cancelled decision, or the monotonic fence for an absent initializer, remains
effective until group/claim fencing is durable. An absent ticket
with an already advanced revision cannot be recreated from the old initializer.
Only after that account-side fence may a helper consume the group version. Never
cancel the group first and subsequently race an active account decision.

An advanced account revision proves an absent initializer cannot run again; it
does not by itself prove cancellation. Re-observe the exact group terminal receipt
after the account fence. A committed-and-retired operation remains committed.
Receipt comparisons include outcome, payload hash and a one-way authorization
reference digest; helpers never rewrite an existing committed outcome as cancelled.

## Identity erasure and discovery-stub cleanup

Erasure closes the account first, then atomically freezes each owned identity's
scope index while removing names and preventing further alias/scope registrations.
Persist the frozen group references as erasure work before reducing that identity
to its final tombstone. For each group, settle this actor's exact pending stub,
including one whose account-ticket write has not arrived, and fence/remove current
signed-member authority. Before acknowledging deletion, confirm every such group
fence and every account ticket is terminal; inspect the current references in the
final CAS. The existing scope index therefore covers the pre-ticket stub without
requiring a global scan or leaving an account-linked pending head after deletion.

The ordering matters: each candidate's group snapshot precedes successful active
scope registration; the identity freezes before the erasure group fence. A paused
pre-freeze candidate has an older group version. A fresh retry after the fence must
repeat scope registration and is rejected by the frozen/closed identity. Removed
member/inviter authority must also be reflected in group control so an unrelated
guest invitation cannot reuse a stale active-inviter view.

The frozen index includes the union of native and legacy scope references before
either is removed. This alone does not prove historical completeness: older joins
can publish membership before recording a scope reference. Strong indexed erasure
therefore applies only to relationships created under the new registration-first
protocol until a bounded compatibility inventory/repair has proved older groups
complete. That inventory and its writer fence are activation requirements, not
implicitly completed migrations. Legacy-only groups retain their existing path
until that requirement is satisfied; do not claim this native protocol fixes their
independent historical race.

Use a permanent `erased` member authority state, revoke its invite authority, and
reject it in member/admin/cohost/inviter admission checks against the reserved
group version. Merely marking a tournament admin `left` is insufficient because
left admins intentionally retain organizer authority. Historical participant
references may remain without preserving current authority.

## Account-free Table setup

A guest assigned as Table host still needs a durable setup decision. Before
claiming a Table, reserve the complete group setup and exact claim-generation
reference under that guest's verified current group/seat authority. A genuine
request may commit that decision after reserving the claim and rechecking its live
Room guard; helpers may finish a committed frozen decision or abort an undecided
one after the same nonrenewing deadline. They cannot manufacture a new live guard.
The guest decision is stored in the exact reserved group head, where roster/version
changes arbitrate it; it does not require an account or persist bearer credentials.
Both group setup and claim must finish before retirement. The old direct
claim-then-setup order is not an acceptable native guest fallback. Native Table
binding uses the implemented signed and guest variants described and proved in
`docs/COMPETITION_TABLE_SETUP_CONTRACT.md`; normal activation remains gated by the
remaining result/projection and compatible-writer requirements.

## Liveness and sampled seat authority

Use one server-created, nonrenewing abort-eligibility deadline (candidate default
30 seconds). Before it, helpers leave undecided work alone. After it, helpers may
only CAS pending to cancelled; they never commit pending seat-bound work. A real
request may commit with its genuine live guard until cancellation actually wins.
A committed decision never expires. Process death and a long pause are not
distinguishable, so a healthy delayed request can lose to a safe abort. Clock skew
can cause unnecessary aborts; it cannot grant permission or bypass terminal fences.
Measured recovery bounds still depend on storage progress, clock assumptions and
fair bounded revisits; this deadline alone is not an enforced storage expiry.

Preserve the existing sampled-authority boundary: the genuine live RoomService
guard runs immediately before each account decision PUT submission/retry. This
does not claim the in-memory seat is locked until a delayed remote PUT commits.
Committed work replays frozen proofs, never invented connection authority. Stronger
multi-node command/ownership fencing remains the later dedicated contract.

Guest capabilities continue to use server-validated group/seat authority, not a new
mandatory account. Trusted system completion work remains separate from signed
actor operations. Neither path adds competition I/O to a life change.

## Required verification

Use actual REST/ETag storage, independent writers and real process interruption.
Cover erasure before reservation arrival, after reservation/before decision, after
decision/before publication, and before ticket cleanup; delayed old PUTs and paused
owners resuming after abort; reused intents with new operation IDs; group removal
during reservation; other groups making progress; complete Table setup recovery;
no false success on failure; and unchanged casual HTTP/SSE responsiveness.
Do not lower the existing latency/load gates or replace integrated app proofs with
only ticket-component tests.

## Local implementation checkpoint

`CompetitionAccountControl` owns per-account decisions. Preparation registers a
scope before a reservation; admission pins a monotonic account revision; commit
requires the exact account ticket and current supplied live guard. Recovery leaves
an undecided operation alone before its nonrenewing deadline and only cancels it
afterward. A missing-ticket initializer is fenced by advancing its pinned account
revision. Committed decisions never expire. A head retains its private settlement
reference until durable publication and account-ticket retirement finish, so a
crash between those steps remains discoverable. Permanent receipts store only a
digest of that private reference, not its account locator.

`CompetitionIdentityStore` freezes native plus legacy scope references before
dropping identity values, persists erasure work, and checks current outstanding
references in its final account CAS. `CompetitionErasureControl` processes only
those exact groups, cancels undecided work, finishes committed work, and marks
current member authority `erased` while revoking its invites. It fences a missing
creation with an unavailable versioned head. Historical index completeness is
still the separate compatibility requirement above.

Revocation uses resumable batches of at most 512 row changes and 900,000 serialized
change bytes, leaving room below the operation payload limit. Already-published
erased/revoked rows are skipped. The completeness marker is written only in a final
fitting batch; account scope references remain until that marker is published.
An eight-attempt call may return `ERASURE_PENDING` with progress retained for the
next eraser. Independent review reproduced a valid 511-invite group exceeding the
old single-operation limit. The regression now passes, including failure before
the final marker and completion by a fresh eraser using its durable scope refs.

Pod and tournament signed control routes now use the account decision provider.
Seat-bound signed group operations pass their genuine Room guards at decision
submission. Those are sampled checks, not a claim that an in-memory seat remains
locked until a delayed remote PUT commits. Historical result storage remains
unfinished; compound Table/group publication is now locally verified in the setup
contract. Normal startup remains off.

Failing-then-passing local cases cover stale Table ticket commitment and initializer
ABA, undecided child-write blocking, abort/commit races, missing-ticket abort,
terminal-outcome preservation, account erasure at reservation/admission boundaries,
frozen-index handoff failure, permanent organizer removal, and a stale settlement
helper preserving a newer operation. Fresh reviewers found no actionable issue in
the account-decision component after two bounded review cycles; integration review
is separate. Three design cycles exposed and clarified the absent-ticket terminal
case; its final clarification is self-tested, not represented as a fourth approval.

The real app-process test kills the requester before account admission, starts a
replacement with only the disposable database address, exercises casual life
changes during recovery, waits for the default 30-second deadline, and verifies
background cancellation plus rejection of the late killed-process PUT. The focused
38-case component/process run passed. Its first run observed publication before
settlement completed; the test now waits for both stages within the original
deadline. This is local REST/ETag and process-crash evidence, not hosted or phone
evidence. Logs: `.local/scaling-full-20261112/control-account-reviewed-process.log`,
`account-control-*-red.log`, and the corresponding focused green logs.

Current full regression: 456 server plus 172 client tests pass, no failures or
skips. `.local/scaling-full-20261112/account-control-reviewed-full.log` matches the
164-file source manifest in `account-control-source-fingerprints.json`. The
integration reviewer completed two cycles; its sole actionable finding was the
batch limit above and no further issue was found after that fix. Preservation and
review reconciliation are recorded in `account-control-checkpoint.json` and
`account-control-review-reconciliation.json`. Client files, `server/src/app.js`
and `server/src/playtest-ledger.js` remain identical to the full-handoff baseline.

Compound setup is completed locally in `docs/COMPETITION_TABLE_SETUP_CONTRACT.md`.
Its later full regression passes 494 server plus 172 client tests. The wider goal
remains active: immutable results/projections,
compatibility/writer fences, ownership/routing, latency/capacity gates and the
staging approval package remain open.
