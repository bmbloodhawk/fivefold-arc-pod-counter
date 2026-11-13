# Partitioned identity store contract

Provider: `competition-identity-store`. Consumer: competition domain, scoped
directory views and the feature-disabled eraser. This is an internal storage
contract; it adds no player-facing identity, account or rating system.

## Records and API

- `competitions-v2/accounts/{accountKey}.json`: one conditional control record per
  SHA-256 account key. States: `opening`, `active`, `closing`, `closed`. Opening
  reserves one opaque identity ID; active publishes it; closing records IDs still
  needing redaction; closed retains no identity/account link or identifying value.
  Opening keeps all provisional/resolved IDs until unused values have been fenced.
- `competitions-v2/identities/{identityId}.json`: active account-key link, mutable
  names under nested scope/participant keys and a membership index. Names are
  per-identity, not global and not part of immutable game evidence. A closed value
  drops identifying fields and permanently fences stale writes to that ID.
- `identity(accountId, createName?)`: explicit sign-in required. Read-only lookup
  never creates an identity. Creation reserves the account record before any
  identity value; any process can finish an interrupted opening using its reserved
  ID. Validate names before I/O. Concurrent creation returns one effective ID.
- `lookup(accountId)`: observation only for private views/lists. Return the active
  canonical ID or null; never finish opening, resume erasure or write data. Opening,
  closing and closed accounts grant no view identity. Reject foreign canonical
  mappings. Explicit setup/recovery continues to use `identity`/erasure helpers.
- `profile(identityId)`, `alias(identityId, scopeId, participantId)` and
  `memberships(identityId)`: resolve only this identity and the requested legacy
  leaves. Closed/closing accounts grant no names or membership access. Merge and
  deduplicate legacy membership IDs with new IDs; never restore an erased identity.
- `setAlias(identityId, scopeId, participantId, name)`: verify the current account
  and conditionally update the identity value. A delayed writer cannot recreate a
  closed value. An identical alias/index write is a no-op.
- `eraseAccount(accountId)`: durably close the account first; fence legacy creation
  with its existing per-account closed flag; redact owned identity values; scrub
  any existing legacy account/identity/alias/index records; finally publish a
  non-identifying closed account tombstone. Do not acknowledge success early.
- `resumeErasures({limit,cursor})`: bounded account-control pages finish interrupted
  closing records without knowing raw account IDs or relying on browser retries.

## Canonical identity and mixed-format rollout

A legacy ID wins whenever it already exists. The normal partitioned mode creates
and updates independent account records without writing the global directory.
An explicit `legacyBridge` creation mode uses the old directory CAS to resolve a
concurrent legacy creator, then publishes the same resolved ID in the new control
record *before* creating a new identity value. Helpers honor the opening record's
stored mode rather than choosing again from their current feature flag.

Native and bridge creators claim their candidate in the same per-ID value record
before the bridge publishes a legacy owner. Account-opening state prevents that
claim from exposing names or granting membership access. Existing legacy ownership
and closed IDs are checked before publication. If a same-account legacy creator
selects a different canonical ID, record both IDs durably, initialize the canonical
value and permanently close the unused provisional value before publishing active.

Bridge mode is transitional and must not be described as removal of the legacy
creation bottleneck. Native mode can be activated only after every live/rollback
writer understands the canonical account record. Before enabling any new identifying
values, deploy a compatible binary whose disabled-feature eraser understands both
layouts. Prove overlapping-version creation, alias writes, deletion and Table
claims at the later integration/rollout checkpoint. An untouched pre-compatibility
binary must not coexist with new identifying values it cannot erase.

Every permitted creator in **both modes** must also use the shared per-ID claim
protocol. A root-only legacy writer that ignores it can race a different account
and leave conflicting owners; bridge mode is not permission to run such a writer.
The same-account root-only test is a defensive legacy-interleaving reproduction,
not an activation compatibility guarantee. On mismatch, name access fails closed;
do not automatically choose one owner or erase the other account's data.

The rollout checkpoint must retire pre-compatible writers, invalidate outstanding
legacy conditional writes with a legacy-root protocol/ETag fence, and make remaining
compatible callbacks recheck that protocol version on every CAS retry before they
create an identity. Prove that a retired process's delayed PUT cannot commit after
activation and that an older compatible instance switches to the shared protocol.
No new identifying values may be enabled until those proofs pass.

## Failure and erasure invariants

- Reserve opening state before creating an identity value. Bridge resolution may
  change the provisional ID only while opening and before value initialization.
- Never reopen `closing`/`closed` accounts or `closed` identity IDs. If erasure wins
  while an opener is delayed, its value write sees the permanent tombstone and
  fails; if the value write wins first, erasure clears it before acknowledging.
- Erasure records every reserved/published ID it owns. A colliding/corrupt identity
  value belonging to a different account is never overwritten or erased.
- Close the legacy flag before inspecting/scrubbing its final ID. Existing legacy
  root ETags make a creator with an earlier view retry and observe that flag.
- Append any final owned legacy ID to closing work after that flag is closed, then
  fence it before removing the legacy link. Check ownership in both layouts before
  tombstoning a missing/new value or deleting old records. A foreign legacy-only
  identity must not be disabled merely because its ID appears in a corrupt mapping.
- Failed erasure remains closing and recoverable. Personal account deletion must
  wait for successful shared-record redaction in the domain integration.
- Legacy lookup is by individual leaves, never a fallback download of the entire
  identity directory. Existing legacy redaction may still use its old root CAS;
  measure/report that transitional cost separately.
- Names and links are absent from closed tombstones. Numeric shared ratings/game
  records remain unchanged, as required by the approved Pod rules.
  Opaque keys and numeric records remain pseudonymous; this is not an anonymity claim.

## Proof before integration

Use actual loopback REST/ETag storage. Test concurrent native creation, different
accounts in parallel, legacy/native-bridge simultaneous creation, interrupted
opening and closing, one canonical identity across modes, retained memberships,
closed legacy fallback rejection, a delayed alias PUT after erasure, and no-op alias
writes. Verify names/account links disappear while unrelated users and numerical
records remain intact. Later integration must additionally prove feature-disabled
HTTP deletion, compatible rollback and real process restart boundaries.

Current component proof includes actual worker-process kills during initialization
and erasure, followed by a fresh process resuming from shared REST storage without
the deleted account ID. Full application-route and mixed-version rollback proof
remain at integration. Review regressions also cover legacy-only ID collisions,
closed-ID reuse, native/bridge simultaneous candidate ownership, foreign legacy-only
erasure, a final legacy ID arriving during deletion, and committed/lost responses.
