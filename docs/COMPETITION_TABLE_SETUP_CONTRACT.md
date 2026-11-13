# Durable compound Table setup

Status: implemented and locally verified in the opt-in native path.
No normal activation or live actions.
This extends the locally tested account-control protocol; it does not replace the
unfinished Table tickets, reservation generations or guest authority rules.

## Required outcome

Linking a Table must retain its complete authorized group/seat setup before any
claim can become ready. A fresh process must finish an approved setup or cancel an
undecided setup without reconstructing a live connection. No ticket/reference may
retire until both group setup and the Table claim are published or safely fenced.
Signed and guest Table hosts need the same crash guarantee without requiring
guests to create accounts. No competition work enters life adjustment or SSE.

## Frozen reservation

`CompetitionScopeStore.change` will accept a server-supplied Table setup descriptor
alongside the existing actor and genuine Room guard. It contains the Table key,
binding `{kind,id,roomCode}`, existing intent digest and a preallocated claim
operation nonce. Its claim request digest includes the control operation ID so a
retired or different setup cannot be reauthorized through a reused intent.

The head first reserves the complete successful admission callback payload plus
that exact typed claim reference, all bound by the operation/authentication hashes.
It is waiting and cannot publish child rows. The descriptor must target the same
group and the frozen payload must contain the corresponding nondeleted Table row
and matching room code. Neither descriptor nor operation contains bearer tokens,
raw account IDs, seat credentials, host recovery keys or personal names.

Only after the head is discoverable may the driver admit an account ticket or
reserve the Table claim. Death before the stub can leave no new claim; a delayed
stub remains discoverable through the existing registry and is still undecided.

## Signed decision

Extend/reuse `account.tableClaims`, preserving its key, binding, `claim_` nonce,
state and request-digest checks. A compound ticket additionally identifies its exact
control operation. The per-account CAS admits this ticket and its control-operation
reference together, using the already frozen account admission revision. There are
two indexes into one atomic account decision; their states must not diverge.

The existing ordinary Table-ticket APIs must reject a compound ticket rather than
commit or retire it independently. Existing noncompound tickets retain their
protocol and remain erasable. Do not silently attach a new group edit to an older
committed decision. A previously ready claim to the same binding may be reused,
while another binding or an unrelated pending nonce cannot be overwritten.

After reserving the exact claim, the real request commits both indexed states in
one account CAS while the account remains active. It must verify the exact group
stub and claim reservation and run its genuine Room guard immediately before each
conditional decision PUT submission/retry. The sampled-guard boundary is unchanged;
this does not claim a process-local seat lock lasts until a delayed remote commit.

Erasure/expiry atomically cancels an exact undecided account decision or fences its
absent pinned initializer. If commitment won, complete it. An old receipt or an
already advanced revision may report the old outcome; it cannot approve a new
request or recreate a retired ticket. Retain terminal-outcome checks and reference
digests from the account-control component.

## Guest decision

A guest setup uses an explicitly typed account-free authorization reference in
the exact reserved group head. Its participant ID, claim reference, payload hashes,
version and nonrenewing deadline are frozen; its bearer capability is never stored.
The callback validates the guest's current group/assignment authority against that
reserved roster/version. The stub starts with an undecided phase.

The real driver reserves the Table claim, then CASes that exact head phase to
committed while rechecking its genuine Room guard. This head CAS is the durable
guest decision. A helper cannot commit an undecided guest phase. After the same
30-second abort-eligibility deadline, a helper may CAS only undecided to cancelled;
commit and cancellation arbitrate in the same head. A committed phase never expires.
Other group operations cannot replace a reserved pending head.

Cancelled-claim reuse must authorize the exact guest group stub and claim nonce,
using the existing generation-sensitive retry loop. A paused old reservation must
recheck that stub after a generation change. It cannot reuse a cancelled group
decision or revive an older claim over a later established binding. This extends
the current account-only reuse check without manufacturing account credentials.

## Publication, cancellation and retirement

For either actor type, only a committed decision releases the frozen control child
writes and group head publication. Keep the private settlement reference in the
head. Settlement publishes the exact Table claim, verifies its terminal binding,
then retires the compound account indexes when present and finally clears the
head's settlement reference/ready ticket. If storage fails, the existing bounded
ready/registry worker revisits the retained reference without a remembered group
ID, HTTP client retry or scan of Table claims/history.

Cancellation must first win the authoritative account/head decision. Before
consuming the cancelled group version, fence the exact pending/missing Table claim
with its existing cancellation/generation protocol. Preserve another operation's
ready claim or unrelated pending nonce. Only then publish a cancelled group receipt
without applying setup rows and retire terminal references. Never reverse a
committed decision or an immutable committed receipt.

The settlement verifier always checks the current setup's exact group receipt,
frozen reference, request/payload hashes and authoritative decision. Its Table
outcome has three explicit forms:

- Owned: the exact claim nonce is ready at the intended binding, or cancelled with
  its generation fence. Retain exact nonce/target checks for this case.
- Reused: an existing ready claim has the same binding. Accept it unchanged even
  if its nonce is older or absent in a legacy-ready record. This does not reuse
  that older account authorization: the new group setup still needs its own exact
  durable decision and Room guard. Compatible writers preserve ready bindings.
- Superseded cancellation: preserve another operation's claim and record/verify
  that this setup is cancelled, its old pinned initializer is fenced, and the
  claim's monotonic generation rejects any earlier conditional PUT. Any later
  reservation retry must reauthorize this exact setup and reject its cancelled
  account/group decision. Keep a durable supersession outcome/proof with this
  setup's cancellation receipt; the unrelated pending record itself is not this
  setup's terminal claim. Do not delete references based only on its existence.

The final verifier must distinguish these outcomes rather than require a fresh
nonce on a legitimately reused ready claim or falsely call an unrelated pending
claim this setup's terminal document. A stale finisher must preserve a newer
operation's settlement. Each worker visit remains bounded by the existing
group/page/write budgets plus a constant number of claim/account requests.

## Required evidence and compatibility gates

Use actual app HTTP and REST/ETag storage, independent writers and real SIGKILL.
For signed and guest hosts, interrupt at stub, ticket/claim reservation, decision,
child publication, committed head, claim publication and retirement. A fresh app
receives only the fixture address. It must finish approved work exactly once and
abort unapproved work after the default deadline, while casual life remains usable.
Hold late old PUTs through cancellation/retirement and verify they cannot resurrect
a claim or ticket. Cover changed seat proofs, same-intent/new-nonce reuse, erasure
on both sides of the decision, competing group bindings, same-binding retries,
lost responses, another group's progress, guest assignment rules and private DTOs.
Include fresh-process retirement for owned, reused-ready (including legacy without
a nonce), and superseded-cancellation outcomes.

Keep normal startup disabled until the compound paths, native immutable result
repository and compatible-writer/rollback gates are complete. Historical missing
identity-scope refs still require the separate bounded inventory/repair and writer
fence; this setup protocol does not claim that work is finished. No commits,
deployments, live services, paid services or physical-phone claims are authorized.

## Design review and reproduced starting state

Two bounded fresh-context review cycles identified and clarified reuse and
supersession verification. The second review found no actionable design issue;
this is a reviewed proposal, not implementation or crash-proof evidence.

At the start of this slice, the native app reproduced the interrupted-setup gap for
both actor types through actual loopback HTTP. Paused immediately before group
setup, a signed host and an assigned guest host each already have a ready Table
claim, no pending group intent, no published Table row and no outstanding account
ticket. Evidence: `.local/scaling-full-20261112/table-setup-gap.{mjs,json,log}`.
That diagnostic records the earlier open gate, not current passing behavior.

## Local implementation and evidence

`CompetitionTableSetup` now supplies decision/recovery/retirement to the control
store. Native bind passes a complete Table descriptor into `CompetitionScopeStore`
and reserves its successful callback payload before either account admission or
claim reservation. A repeated same-value bind still freezes the complete Table row.
Legacy-group binding retains its existing path.

Signed admission/commit/cancellation update `controlOperations` and the extended
existing `tableClaims` index in one account CAS. Ordinary Table-ticket APIs reject
compound tickets. Guest decisions use the exact reserved head's pending/committed/
cancelled phase with a genuine Room guard; no account or bearer token is invented.
Recovery never approves an undecided operation. Cancellation records an owned,
reused or superseded claim proof before the group version is consumed; settlement
verifies that proof or the ready binding before retiring either index/reference.

Erasure uses the same compound provider and reads current Table tickets after
finishing control operations. A surviving compound reference cannot fall through
ordinary-ticket deletion. A malformed undecided guest payload can be cancelled
without publishing it; admission/commit additionally require its frozen Table host
to match the guest participant reference.

Current focused evidence:

- Sixteen actual REST/ETag component cases pass: both actor types, pre-claim intent,
  deadline abort, old held PUTs, reused-ready claims without nonces, supersession,
  ordinary-ticket isolation, erasure before/after commitment, a mixed ordinary
  ticket, guard recheck after a genuine account ETag retry, and malformed cleanup.
- Four native HTTP cases pass: signed and guest hosts freeze the complete setup
  before the first claim PUT, and a real seat reclaim before decision cancels
  the old request. Existing guest/host rules remain exercised by regressions.
- Fourteen real app SIGKILL cases passed: signed/guest setup killed at stub, claim,
  decision, child, head, claim publication and retirement. A replacement receives
  only the disposable storage address, recovers before a group GET/client retry,
  rejects held old writes, and permits casual life changes during recovery.
- Four additional real app SIGKILL cases passed: each actor type can retire a
  reused ready record without a nonce, or a superseded cancellation while
  preserving another pending claim. The original Table tickets remain intact.

Raw evidence is under `.local/scaling-full-20261112/`:
`compound-table-{setup-final-focused,http-guards,process,process-outcomes}.log`.
The failing-before-fix logs are `compound-table-{setup-red,http-red,malformed-red}.log`.
Two fresh decision-review cycles and one fresh integration review found no
outstanding actionable issue. The full suite passes 494 server plus 172 client
tests, no failures/skips, and matches the 168-file source manifest. Final evidence:
`compound-table-full.log`, `compound-table-source-fingerprints.json` and
`compound-table-checkpoint.json` in that folder. The original untracked scoped HTTP
tests and original Table-ticket cases are preserved; the latter received additional
regressions. Client files, `app.js` and `playtest-ledger.js` remain unchanged from
the full-handoff baseline.
All evidence uses synthetic identities, loopback REST storage and local processes;
it does not prove production, physical-phone, storage-power-loss or multi-node
live-Room ownership behavior. The wider result/projection, compatibility, ownership,
latency, capacity and release gates remain open.
