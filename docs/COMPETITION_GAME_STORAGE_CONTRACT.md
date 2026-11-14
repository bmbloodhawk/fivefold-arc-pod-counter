# Partitioned immutable game storage

Status: design checkpoint for slice 5. Not implemented or activated yet. Slices
6–8 must still supply real caller authorization, result delivery/projections and
the honest saved/updating UI. The wider goal and its latency gates are unchanged.

## Component boundary

Build an internal `CompetitionGameStore` over the existing conditional record and
bounded-page interface. It owns accepted-start evidence, original completion data,
individual confirmation revisions, retry receipts, chronological history and
durable operation/processing references. It does not change life counters, grant
caller permissions, calculate ratings or accept client-supplied completion sources.

Trusted system capture must match a durable accepted start and the server's frozen
completion evidence. Confirmation publication requires an injected durable decision
resolver and finisher, with a nonpersonal opaque decision locator retained through
publication/cleanup. Without that provider, confirmation admission fails closed.
Component tests may supply an explicit fixture decision store; that is not proof
of the later real account/guest authorization flow. Do not expose new result routes
until slice 6 proves erasure/removal and guest-host authority against actual APIs.

## Records and bounds

All paths below are relative to `competitions-v2/groups/{groupId}`:

- `rows/starts/{gameId}.json`: immutable accepted-start proof, stored as a bounded
  canonical JSON envelope. It can later be a child of an authorized control
  operation without being retained in the active-key manifest or downloaded in
  every group read. It freezes Table/session/game identity, actual participant /
  seat ownership proofs, original host, eligibility and assignment.
- `games/{gameId}/original.json`: immutable validated source digest plus numerical
  completed-game view. Keep no account IDs, aliases, player names, bearer tokens,
  reclaim credentials or correction free text.
- `games/{gameId}/head.json`: small current state: operation version, captured flag,
  immutable source hash, effective revision number, processed revision prefix and
  at most one pending intent/settlement reference. Never store revision arrays or
  historical games here. Capture is effective revision zero; cancellation advances
  operation version without adding a revision.
- `games/{gameId}/revisions/revision_{fixedWidthNumber}.json`: one immutable host
  order, standard reason code, opaque participant author, server timestamp and
  request/payload digests. Full-order validation uses the existing pure rules,
  including timed-draw survivors. Existing rules and eligibility do not change.
- `games/{gameId}/requests/{requestDigest}.json` and `operations/{operationId}.json`:
  immutable retry/publication receipts. Matching client input returns the original
  outcome; conflicting reuse rejects. Freeze the first admitted server timestamp
  separately from the client request digest, so retries do not invent a revision.
- `history/game_{fixedWidthCompletionTime}_{gameId}.json`: immutable compact pointer
  and immutable list metadata. Status/revision comes from each selected game's
  small head, not by rewriting all historical pointers.
- `game-work/{operationId}.json`: nonidentifying active operation and processing
  locator: game ID, operation ID, base/target version, request digest, deadline and
  intended effective revision. Use one key per operation, not a replaceable latest
  pointer shared by different requests. Completed locators are removed only after
  publication/authorization cleanup and verified processing acknowledgement.

Accepted starts/originals are at most 64 KiB each; revision payloads at most 8 KiB;
pending operation envelopes at most 256 KiB. Participant/starter lists remain
2–8, with distinct stable IDs and unique seat proofs. IDs/paths/finite timestamps,
reason codes and all known field sets are validated before admission. JSON
envelopes preserve canonical bytes despite RTDB empty/null/array shaping. Record
growth depends on one game/order, never the group's accumulated history.

## Admission, publication and discovery

1. Observe the game's current head before the retry receipt. A matching receipt
   reports an old outcome; a later head cannot reuse a formerly absent operation
   ID with new input. Client request IDs determine stable operation IDs; they are
   not stored as arbitrary free text in numerical records.
2. Register the complete nonidentifying `game-work` locator before reserving the
   game head. The locator freezes the attempt's base version, request digest and
   a nonrenewing abort-eligibility deadline. It must be discoverable without the
   request process, a remembered game ID or a historical-game scan.
3. CAS the exact base head to a complete frozen pending payload. For confirmations
   it is waiting for the external durable decision; no immutable child is written
   while undecided. Trusted capture is applicable only after validating its
   accepted-start/source evidence. A conflicting current head/receipt rejects.
4. Any worker may finish a committed intent: write immutable children, history /
   retry metadata and the operation receipt, then publish the head's version and
   effective revision. Child identity/digests and stale-head fences must prevent
   an old helper from changing newer data or advancing its processed prefix.
5. Retain the private settlement locator until the decision finisher completes.
   A crash after head publication must still be discoverable. Positive saved
   responses require durable publication and decision cleanup; projection delivery
   may remain explicitly pending.

The ready-first window is part of the protocol. If a registered head PUT never
arrives, a helper may cancel only after its nonrenewing deadline (or an explicit
authoritative cancellation). It must first consume/fence that attempt's old head
version and write a terminal receipt before removing the locator. A delayed PUT
cannot arrive after cleanup and restore an indistinguishable state. Preserve a
different pending intent; do not delete its locator or fabricate caller permission.
If an old locator is reintroduced by a delayed registration PUT, its terminal head /
receipt must make it harmless and removable; it cannot reauthorize or reapply work.

Use bounded rotating `game-work` pages for known registered groups. The existing
group registry/worker supplies group discovery; do not enumerate all game heads,
completed history or Table claims. A failed write retains its source of work.
Pending decisions wait before the deadline; only the owning durable decision
protocol may approve them. A committed decision never expires.

## Processing boundary and reads

Keep a committed operation's locator until its exact event is durably acknowledged
by the later ordered result stream. `markProcessed` must validate an immutable
event matching operation/game/version/revision/digests, not accept an arbitrary
sequence number. Advance only the per-game contiguous processed prefix: capture,
first confirmation, then each correction. A stale worker cannot skip a revision,
overwrite newer progress or erase another operation's pending locator. This is
delivery bookkeeping, not the standings projection or its cutoff proof.

Game detail reads help/await its own pending work and verify a stable head before
returning original/latest data. Revision pages have an explicit total revision
number and bounded cursor; a truncated array length must not masquerade as that
total. History queries page in storage, with validated time bounds/cursors and at
most 100 selected heads. Do not read the history root, then sort/slice it locally.

The raw history tie order follows its storage keys. Canonical Pod replay still
uses the existing `gameId.localeCompare` rule at equal timestamps. Slice 7 must
preserve that exact rule with bounded ordering; a raw ID index is not a license to
silently change ratings or weaken canonical comparison tests.

## Verification and remaining integration

Use actual REST/ETag storage with independent writers. Prove original/start and
revision immutability, complete order / eligibility / source matching, same-request
deduplication, conflicting reuse and frozen timestamps, a stale receipt, two
helpers, waiting/approved/cancelled decisions, ready-before-head abort, every
publication/settlement crash window and fresh-worker discovery. Hold old PUTs
through cancellation/cleanup. Show unrelated games/groups progress independently.
At 10,000 stored games, verify bounded history/revision wire bytes and unchanged
single-game/head sizes. Use actual process kills where the claimed boundary is a
process restart, not merely a reconstructed object.

Later integration must replace historical Table captures/guests with these records
and active references, preserve legacy access and privacy, and deliver accurate
pending counts / saved/updating / event readiness. Measure confirmation admission
against the existing 5 ms and 50 ms burst gates; naively serializing whole saves
through the group's entire control lane is an unproven latency risk. Do not lower
the targets or retry away application busy responses. Normal activation remains
off until these integration and compatible-writer/rollback gates are proved.
