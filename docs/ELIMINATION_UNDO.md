# Elimination undo

An affected player has 15 seconds to undo the entry that eliminated them.
The control uses the same placement and `undo-turn-button` style as Undo handoff.
There is no result-confirmation step.

- Earlier eliminations allow play to continue. Undo restores only the affected
  player's eliminating entry, including compound life/commander/radiation effects
  and the entry's statistics. Other players' changes and the current living turn
  remain intact. A later own mutation invalidates the previous undo record.
- A final-survivor elimination creates a pending finish. The game clock pauses,
  other game writes are held, and no completed-game facts, saves or awards are
  exposed until the original deadline expires. The result then finalizes once
  and follows the existing result flow automatically.
- Undo can also reverse a host-marked alternate elimination, but only the affected
  player can request it. Explicitly declared winners and timed draws keep their
  existing deliberate-result behavior.
- Undo restores the entry, not an entire previous turn. If an earlier eliminated
  player returns during a pending finish, a still-eliminated active seat is skipped
  to a living player; later living turns and actions are preserved.

## Shared-table contract

Snapshots expose `pendingFinish: null | { winnerSeatId, expiresAt }` and, per seat,
`eliminationUndo: null | { id, expiresAt }`. Private rollback data is not exposed.

`POST /api/rooms/:code/undo-elimination` requires the affected seat's connection
and `{ baseVersion, eliminationId }`. A stale version returns the latest snapshot;
expired, wrong-owner or replayed undo records cannot apply twice.

The server owns the deadline. Reload/reclaim retains the original deadline.
A timer finalizes an active room without a further player action. Recovery rearms
the remaining timer or enforces an expired deadline before serving the room.
Room recovery is lazy, so after a server restart with no returning clients the
expired finish is enforced when that room is recovered; there is no new global
pending-room index.

The single-phone simulation follows the same window locally and preserves its
deadline in the existing saved simulation state. Shared-table expiry remains
server authoritative.

## Verification

Regression coverage includes owner authority, exact expiry, single use, compound
counter/stat reversal, unrelated player actions, retained turn/reclaim facts,
restart recovery, stale timer isolation, deferred durable completion, and client
retry/early-snapshot races. The client announces availability once rather than
announcing the countdown every second. Native phone-sized checks cover 320px
and 390px, two- and three-player tables, and automatic result progression.
