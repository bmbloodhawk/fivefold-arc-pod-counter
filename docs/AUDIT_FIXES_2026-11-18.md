# Remaining browser-audit fixes

Scope: finish the confirmed routine audit defects and prepare guided physical-phone testing. Deploy staging only. Production remains at `52017e8a2f4419915d5544663c58f269e241f1ed`. The preceding deck-save ownership fix is already staged at `a9e697b00b71e721cc79bf8f1abc27e3bf4bd671`.

## Changes

| Finding | Result and regression evidence |
|---|---|
| POD-AUDIT-03 | Clear private editor fields, edit target, library arrays/DOM, deck selectors and commander proof at successful owned account transitions. Failed/cancelled sign-out/deletion preserves the draft. Old provider/DELETE completions cannot clear a newer account. Retire work started during the provider wait as well. `deck-editor-reset.test.mjs`. |
| POD-AUDIT-02 | Capture submitted preferences before token acquisition and check account ownership after token, response and JSON awaits. Retired successes/failures cannot restore an old preferred name or skin. `preference-save-races.test.mjs`. |
| POD-AUDIT-04 | A commander-color lookup owns its request, count and submitted names. Old results cannot restore a removed partner, overwrite an edited commander, report stale errors or unlock a newer lookup. `deck-color-races.test.mjs`. |
| BUG-BATCH-LIMIT-01 | Serialize life batches as same-sign wire adjustments of at most 999, with an independent operation ID per chunk. Clear/lock/failure retires unsent work only for its owning generation. App response handling clears pending optimistic remainder and ignores retired sessions. `life-adjustment-batcher.test.mjs`. |
| TOUR-01 | Rejected clock actions restart the existing countdown and event refresh only while the same clock view/navigation/output remains current. Keep the original error message and retry control. `tournament-clock-errors.test.mjs`. |
| TOUR-02 | Completed linked tournament Tables use the existing postgame panel locally before the host begins shared intermission. Every eligible player can Review/Return; no-access guests get organizer guidance. Casual ready-up behavior and shared lifecycle remain intact. `tournament-postgame.test.mjs` and multi-player browser checks. |
| BUG-CARD-01 / BUG-CARD-02 | Card requests own the open dialog generation and complete submitted query. Check both card and interaction response boundaries; invalidate on input/edit/Close/reopen and clear previous output for a new lookup. `card-lookup-races.test.mjs`. |
| BUG-D20-01 | Announce a tie only for a subsequent actual roll round, independently of unused seat capacity. `game-start-races.test.mjs`. |
| CREATE-START-01 | One outstanding Start per Table/session, visible pending state and retry after failure. Recheck Table ownership after setup and suppress retired errors. `game-start-races.test.mjs`. |
| CREATE-NAV-01 | Back cancels before sending if the token is still pending. A create already accepted can finish into saved Tables without forcing navigation or rearming automatic return on reload. Later snapshots remain in the background until explicit Return. `create-navigation-races.test.mjs` and actual delayed-response browser checks. |
| CREATE-LOST-01 | Connection-bound, bounded retry recovery for an uncertain create, with one optional operation ID and matching request. Repeated responses return the same Table and original host credentials only while ownership is still valid. No durable secret cache or reload/restart recovery promise. Focused client/server recovery tests. |
| JOIN-FORMAT-01 (additional) | Casual/Custom joining claims directly from the name step, skips the empty Commander step and sends no stale hidden partner fields. Commander keeps four steps. `join-format-flow.test.mjs`. |

## Boundaries

STAGE-LAYOUT-01 remains deferred at the user's request until real-use evidence warrants a change. Radiation retains its existing automatic reminder popup. Shared Table seats and live counters survive account privacy cleanup.

Life batching preserves the exact requested net sum while the server continues to accept playing-state updates; each authoritative total still observes the server's existing range. If a first loss chunk finishes or locks a game, remaining input stops at that lock. Failed or uncertain remainder is never automatically replayed into a later game or Table. The transport retains responsibility for retrying an individual adjustment with the same operation ID.

Create recovery is limited to a live connection and this server process. Starting a different intent/session or allowing the connection to expire retires the old attempt. Definite HTTP failures retire the attempt; the explicit post-mutation `RECOVERY_SAVE_FAILED` response retains it for a deliberate retry after storage recovers, without automatically retrying that 503. It does not add durable credentials, a migration or a production setting.

## Verification and release

The external release record stores final exact commit, full-suite totals, focused browser results, deployed protocol checks, served-file hashes and the unchanged production proof. Evidence root: `C:/Users/nibay/.codex/visualizations/2026/11/17/01a1e853-7d23-7990-b202-57da465a684f/all-audit-fixes-20261118`.

Final full repository run: 758 server tests and 610 client tests passed, with zero failures or skips. A final combined client/creation-server run also passed 634 checks, including the real HTTP recovery-save regression. Both dependency audits reported zero vulnerabilities. Focused behavioral mutations were rejected, and independent source/security reviews found no remaining blocker. App320/cache385 updates changed module pins without taking over active service-worker clients. The guided phone plan is in `STAGING_PHONE_WALKTHROUGH_2026-11-18.md`; the user selected iPhone Safari, and physical results remain explicitly Not run until that session occurs.

Isolated browser checks use actual application/server code with controlled timing faults and fixture accounts where noted. They do not establish real provider, camera, installed-app, audio/vibration, all-device or long-duration expiry coverage. Staging rollback base is `a9e697b00b71e721cc79bf8f1abc27e3bf4bd671`; any rollback is staging only and should preserve records while accounting for active test games.
