# Tournament flow and private spectator board

Historical release record. The follow-up [private live Watch Table release](TOURNAMENT_LIVE_WATCH_STAGING_2026-11-18.md) adds actual gameplay totals to the private spectator experience described here.

Authorized release target: staging only, from `151b2d7`. Production must remain at `52017e8a2f4419915d5544663c58f269e241f1ed`.

## Changes

- Saving unchanged seating preserves assignment IDs and linked Tables. Changes affecting a linked assignment require explicitly releasing its verified unstarted setup. Started/captured games cannot be replaced; the old room keeps its claim and cannot start or be rebound.
- Tournament creation honors its existing retry identifier, including concurrent coordinators and a fresh process. Changed payloads cannot reuse the identifier.
- Withdrawn entrants can return before/between rounds, preserving their identity and points. A return after play has begun needs approval. Finished events do not offer or accept an early withdrawal.
- Registration surfaces invitations, attendance and pending approvals. Guest entry is explicit; signing in retains the entered name. Back remains in Tournaments.
- The play screen displays the authoritative event countdown, including on an attested guest's phone. Pausing the Table's turn timer does not pause the event deadline. The final-turn procedure remains manual.
- Tournament postgame offers result review and return to the event. The next assignment has an explicit leave-finished-seat-and-continue action. Released setup replacement has its own confirmed departure. Both paths preserve records and reject stale sessions. Finished casual and Pod Tables can also use the explicit continuation when changing to a competition assignment; active games remain protected.
- Event/standings/viewer screens refresh at a bounded 15-second interval while visible. Forms, ordinary counter changes and hidden/closed views do not drive this polling. Errors and stale updates cannot revive an old view.
- The whole-app review found delayed deck reads could restore private deck details after sign-out. Profile-epoch guards now protect the deck library, setup picker and save-game picker, including late failures.

## Private spectator board

An organizer opens **Private spectator link**, creates a link, and shares it with chosen viewers. One link is active per event; it expires after 24 hours. Replacement invalidates the old link. Revocation removes access on the next read, within 15 seconds for a visible connected board.

Viewing requires no account or event entry. It shows event/round status, official time, assigned aliases, result status and confirmed standings. Pending results contribute no points. The board does not expose normal room codes, identity IDs, entrant access keys, private revisions or life totals. It does not create an entrant, own a seat, keep a room alive or recover an expired room.

Viewer access uses a separate capability. It cannot authorize entry, member changes, seat claims, counters, clocks or result confirmation, even if combined with otherwise valid account/connection credentials. JSON is not cached. The URL fragment is cleared and the viewer capability is kept in memory; after a full browser reload, reopen the original private link. The board's own Refresh control retains access.

Organizers who stop playing retain their organizer access. Removing an issuing co-host's role or erasing its identity invalidates that issuer's link. Explicit revocation/expiry is checked on every read. Live viewing of an individual Table is outside this release.

## Verification

- Assembled full suite: **716 server tests passed**, zero failed/skipped. Two additional native spectator-storage compatibility cases passed after that run.
- Final client suite: **455 tests passed**, including the final released-setup guard and replacement UI.
- Local black-box Table protocol: **64 passed**, zero failed/skipped.
- Independent privacy checks: **110 passed**; account race tests reproduced the old failures, then passed after the fixes.
- A mutation of the Table-context identity guard was caught by its behavioral regressions and restored before further work.
- Four phone-sized contexts completed two Tournament rounds: a timed four-way draw followed by an explicitly ranked finish. Final points were 4.5, 3.5, 2.5 and 1.5, two games each. The next round used the guided transition without the old casual-next-game detour.
- An unsigned viewer saw registration, play, awaiting-confirmation, final standings and revoked access. Host/guest entry, unchanged seating, lost-create-response retry, withdrawal restoration and released setup reload/replacement were exercised through actual app controls.
- Broader browser checks covered casual unsigned Tables, Commander source/turn controls, Pod invitations/activity/confirmation/correction/membership/returning credit, offline counter protection, reconnect without replay, and reload/saved-seat recovery. The evidence separates the 63 main checks, seven offline checks and six recovery checks.
- Representative 320px and 390px screens were inspected after viewport settling. The 320px game retained its footer within 700px, and End Turn / round-clock buttons were 44px high. No unhandled page errors were recorded.

This evidence uses isolated local auth/storage and phone-sized Chrome. It does not establish physical iPhone/Android behavior, live provider authentication, venue load or every device/browser combination. Native storage cases verify link persistence/revocation before play; existing partitioned completed-history migration is not enabled or changed by this release.

## Staging check sequence

1. Create a Tournament; optionally enter as its organizer. Invite an account entrant and a guest.
2. Check attendance, prepare/review seating and select Table hosts. Create the assigned Table, then save unchanged seating again: the code must remain linked.
3. Link all assigned seats, start the event round, then start the actual game. Every seated phone should see the same official deadline.
4. Create a private viewer link. Open it unsigned: aliases/status/confirmed points only; no Join or player controls.
5. Complete a game and inspect the viewer board before host confirmation. It must say awaiting confirmation without adding points.
6. Confirm the complete order. Return to the Tournament, prepare the next round and use the explicit finished-seat continuation.
7. Finish the final round. Check final standings, no early-leave controls, and saved records. Revoke the viewer link and verify access disappears.
8. In a separate unstarted setup, test withdrawal/restoration and replacement. A started game must reject replacement.

## Release and rollback

App 317, competition UI 8, competition model 2, competition CSS 3 and worker cache 382 identify this candidate. New local modules are pinned in the offline graph. Table protocol is unchanged. No dependencies were added.

Before pushing, require a clean diff check, passing final checks and independent review. After the authorized staging fast-forward, verify served-file hashes, `/health`, private viewer denial without a capability and all 64 deployed protocol checks. Record exact final commit and results in the handoff/evidence. Code rollback target is `151b2d7` after staging games finish safely; do not delete records or reverse historical results.

Evidence: `C:\Users\nibay\.codex\visualizations\2026\11\17\01a1e853-7d23-7990-b202-57da465a684f\pod-experience\tournament-staging-implementation`.

Guidance applied: accessibility — “Manage focus correctly to and from updated content” and “Debounce frequently-changing regions”; background processing — “Pause heavy background tasks when a component is not being rendered”. Visible refresh preserves focus/scroll/details and stops in the background.
