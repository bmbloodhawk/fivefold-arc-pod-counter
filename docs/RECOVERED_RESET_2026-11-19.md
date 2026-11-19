# Resetting a restored table

The user twice reported a reset error, then confirmed the new ES7KUY table displayed "Internal server error". A stale snapshot or offline guest alone did not explain the generic500 response.

Actual local HTTP reproduction found the recovery failure: Firebase-shaped serialization omits an empty `playtestNotes` array. A restarted server can restore that room, serve its snapshot, reclaim the host and play normally, but Reset calls `completePlaytest`, which calls `.map` on the missing notes. The resulting TypeError becomes HTTP500. Fresh rooms and recovered rooms with existing notes succeed.

The scoped fix normalizes missing/non-array notes to `[]` in `hydrateRecoveryRecord`, before any recovered finish handling. Existing note arrays remain unchanged. Shared note/recap completion paths now receive the expected array. No reset rules, connection ownership, counters, reward rules or live records are repaired or changed directly. The pre-existing early `ledgerCompletedAt` assignment in completion is not refactored.

## Evidence

Two repo regressions use the existing Firebase REST fixture and two real HTTP server instances sharing durable storage. The omitted-empty-array case initially returned500 and failed; the existing-note control passed. Both now verify successful recovery/reclaim, reset to lobby, retained players/commanders, starting life, persisted incomplete recap, submitted empty notes and normalized saved-playtest reads. The existing-note case verifies exact note preservation.

Focused tests pass2/2. Full server checks pass760/760 with no failures, skips or cancellations. Independent review is clear. The five-minute full run includes sequential intentional process crashes and authorization-expiry waits; it completed successfully. Client/menu checks are recorded with the adjacent menu change. No live Reset was performed by the agent.

The old offline-guest hypothesis was checked in isolated RoomService tests: an offline guest plus a current host snapshot resets successfully; a stale version returns409 and an expired host connection401. The recovered empty-notes failure reproduces the reported500 without relying on guest connectivity. A normal read-only Send feedback action in the live companion also returned500 from the shared notes-reading path; no feedback was submitted or table data changed. Exact original private live recovery-record contents were not inspected.

## Staging release

Release pins: App328 / styles252 / dial CSS5 / dial JS4 / cache395. The frontend entry/worker pins distinguish this server release from the preceding caption and menu candidates. Source docs for those changes remain separate.

Verify the exact served files and persistent Browser Test recovery in ES7KUY. Read-only feedback loading can verify the repaired notes path without resetting the user's game. The user will perform Reset manually after release, followed by the caption and menu phone checks. Production remains excluded. Rollback is a scoped revert; no storage migration or record rewrite is introduced.
