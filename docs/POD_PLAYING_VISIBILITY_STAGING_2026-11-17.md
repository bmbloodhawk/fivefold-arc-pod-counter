# Playing Tables with inactive phones

The user authorized keeping a Pod Table visible while its game is in progress, even when every phone is locked, with changes on staging only. Baseline staging is `f778b99`; production is excluded.

## Behavior

A private Pod activity row is included if it has a recent seated connection **or** a genuine in-progress game: lifecycle is playing, the game has started, and no result has been recorded. Paused games and the elimination undo interval remain in progress. Completed games are not retained merely because their old started flag remains set. Legacy completed records without a lifecycle are identified from their result.

The90-second window still controls each player's connection label; it no longer controls visibility of a playing game. A playing Table with zero recent connections explicitly says **Game in progress · No recent phone connections**. Its reserved seats remain unavailable to newcomers. Completed, lobby and between-game Tables still need a recent connection.

The existing six-hour room inactivity expiry remains unchanged. Reads do not renew room lifetime, recover old rooms or persist new presence. Activity is still server-local and covers loaded rooms; after a server restart an unloaded Table may be absent until recovery loads it. A loaded recovered playing game is visible with zero recent connections. Explicitly leaving an unfinished game clears the client session without ending the server game, so that unfinished Table also remains subject to the same expiry. This change does not add abandonment controls, public attendance or physical-location claims.

## Verification

- Ten new regressions cover stale timestamps before sweep, all connections expired, paused games, quiet non-playing states, completion after reconnection, already loaded recovery, existing expiry, privacy/removal, the15-second undo/finalization interval, and legacy completion flags.
- Initial RED run:2passed/6expected failures. Related GREEN run:38passed, zero failures/skips. Whole-room read-only assertions preserve typed-array normalization rather than removing the immutability check.
- Actual local browser test: both seated contexts were forced offline for161seconds while a separate nonseated Pod member observed the real activity endpoint. The Table remained playing with zero recent connections, all member labels false, and zero open seats. Both phones reconnected to the same still-playing Table and became recent again. No activity response was mocked and no physical OS-lock test is claimed.
- The inactive-phone view fits320px and390px with no horizontal overflow or small controls; no unhandled page errors occurred. This is phone-sized Chrome with isolated account/storage fixtures.
- Full-suite, local/deployed protocol, bundle identity and production-reference results are recorded in the final evidence/handoff after release verification.

Evidence: `C:\Users\nibay\.codex\visualizations\2026\11\17\01a1e853-7d23-7990-b202-57da465a684f\pod-experience\locked-game-visibility`.

## Release boundary

Only the authorized staging branch is updated. App315, competition UI7, cache380 identify the frontend change; CSS and Table protocol remain unchanged. Verify served hashes/health and run the64 deployed room protocol checks. Rollback code target: `f778b99` after safely finishing staging tests; no Pod records or shared history are deleted or reverted. Production `main` must remain unchanged.
