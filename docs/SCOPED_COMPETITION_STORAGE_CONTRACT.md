# Scoped identity views and Table claims

Consumers are the competition domain, Table setup/result adapters and tournament
administration. These internal stores do not authorize HTTP callers or run from
life changes. Domain membership, host/reclaim and original-seat checks remain
required. This slice is local until the compatible-writer activation gate passes.

## Scope directory view

`CompetitionDirectoryView.read(scope, auth, { participantIds })` builds only the
identity/name lookup needed for that scope. The returned shape has `accounts`,
`identities` and `aliases`, preserving the existing DTO/actor interface. It is
server-private and must never be returned as an HTTP payload. No global directory,
account collection, identity collection or alias collection is downloaded.

Default participants are signed-in Pod members, or all tournament entrants. A game
detail can additionally request its recorded participants/revision actors. Old Pod
guest history is not fetched merely to display member ranks. The caller still
loads the current legacy scope until the separate group-control/game slices land.
Bound concurrent identity/name lookups; no process-lifetime identity/name cache.
Actor resolution uses the non-helping `lookup(accountId)` API. An interrupted
opening/deletion stays pending; a screen read must not resume it or download the
legacy root. Explicit setup and the erasure worker own that recovery work.

`CompetitionIdentityStore.scopeProfile(identityId, scopeId, participantIds)` returns
only `{ identityId, names }` for an active identity, or null for a closed one. It
reads one profile per identity and legacy alias leaves only when needed. It does
not return account keys, other-scope names or the membership index.

Guest aliases use `competitions-v2/guest-aliases/{scopeId}/{participantId}.json`.
Unowned guests store a mutable name. A guest tied to a former member stores only
an opaque owner identity pointer; its name belongs in that identity's erasable
alias record. A delayed guest writer cannot restore a deleted member's name.
Legacy guest aliases are read by exact leaf with the same owner/closed checks.
`setGuestAlias(scopeId, participantId, name, { identityId, preserveExisting })`
keeps ownership immutable; first-name preservation applies to unowned guest-entry
retries. Domain callers must first authorize the corresponding setup operation.

No numeric/game evidence contains names. Incomplete name writes can show a generic
fallback and be resumed with the same IDs; recoverable operation discovery belongs
to the next group-control slice. Name records do not grant membership or awards.

## Table claim

`CompetitionTableClaims.read(tableKey)` resolves the exact new claim and legacy
Table leaf. New claims live at `competitions-v2/table-claims/{tableKey}.json`, with
`{ schemaVersion: 2, kind, id, roomCode }`; `tableKey` is the existing SHA-256 Table
identity, not a location or public room listing. Existing legacy claims are read
without copying or scanning the directory.

`claim(tableKey, { kind, id, roomCode }, { guard })` conditionally claims that one
key. Same target retries are no-ops; a different target rejects with
`TABLE_ALREADY_LINKED`. Re-run the synchronous host/seat/roster guard inside every
CAS callback. A failed claim must not be treated as authorization or release the
winner. A lost success response can be retried from a fresh adapter.
Preserve the current ID forms: `pod_…` for Pods and `event_…` for tournaments
(`server/src/tournaments.js`), rather than deriving a prefix from the kind label.

A new/legacy owner mismatch fails closed. Per-key CAS alone cannot prevent an
unaware root-only legacy writer from publishing a conflicting claim. Before new
claims or identity values are enabled, retire pre-compatible writers, invalidate
their outstanding legacy PUTs with the root protocol/ETag fence, and require every
compatible writer to honor the shared claim protocol. This is an activation gate,
not a reason to silently select one of two owners or bulk-convert old records.

Table claims do not replace fenced application-process ownership. Durable start
operations and bounded restart discovery are still required; discovering work by
scanning all historical Table claims is prohibited by the scaling design.

### Account-fenced Table authorization

Integration review reproduced a permission race: erasure can finish after an
actor-profile read but before a different Table-claim record commits. A second
profile read is insufficient to fence that delayed write. Native binding therefore
requires a recoverable authorization decision in the same account control record
that erasure closes.

1. Reserve a stable intent hash in the active account's `tableClaims` map. The
   reserved operation ID is unique and reused by overlapping retries of that
   intent. Include Table identity, target, actor membership/seat proof and round
   assignment in the intent; store no names or raw account IDs in the claim.
2. Write a per-Table reservation with that operation ID. Recheck the Table host
   guard at each CAS attempt. A reservation may route setup retries but cannot
   authorize a game start or a different pending bind.
3. Conditionally change the account decision from pending to committed while the
   account is active. This is the authorization boundary. A closing account rejects
   an uncommitted operation. Publish the authorized claim, then clear the finished
   account ticket. Existing shared claims remain independent of their creator.
4. Erasure atomically carries unfinished tickets into its closing record. Before
   acknowledging completion, fence pending reservations (including writes that
   have not arrived yet) and publish already-committed decisions. Conditional claim
   tags defeat a late pre-fence PUT. Preserve other operations/established claims.
   Retain tickets across interruption; a fresh eraser must finish them before the
   final account tombstone drops their links.

This adds no life-path work. Native activation remains blocked until the new
authorization protocol, interrupted erasure and compatibility tests pass. Group
operation discovery and application-node fencing remain separate required slices.

## Proof

Use real loopback REST/ETag storage with independent adapters. Verify scoped byte
bounds with a large unrelated directory; deleted/closing identities; account-owned
guest redaction; first-name guest retry behavior; concurrent same/different claims;
guard changes during CAS retry; legacy/new conflict; and a committed-but-lost claim
response followed by a fresh adapter. Existing domain/HTTP permission and
feature-disabled erasure tests must pass again when these components are wired in.

Current local proof: 30 identity cases, three real identity-worker process cases,
nine scoped-directory cases and eight Table-claim wire cases pass. Large unrelated
alias data is excluded from scoped reads; a closing actor causes zero writes and
no root read. Review found the actual event-ID mismatch and an actor lookup that
helped erasure; both received failing tests before fixes. A mutation swallowing
owned name-write failures is rejected by the regression test and restored before
the full server run. The full server suite passes 362 tests; unchanged client code
passes its 172 tests. Evidence is in `.local/evidence/scoped-storage-*.log` and
`table-claims-*.log`. Protected life/SSE source remains unchanged.

Domain/HTTP wiring, disabled-feature erasure, compatible rollback, durable group
work discovery and activation are not established by these component checks.
Single-model adversarial review found no remaining component issue after fixes;
cross-model review is skipped for this unattended run. No external review service,
live data change or paid tool is used.
