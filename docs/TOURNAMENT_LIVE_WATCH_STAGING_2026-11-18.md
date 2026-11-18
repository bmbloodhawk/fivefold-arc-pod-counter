# Private live Tournament Tables

Release target: staging only. Base: `bbe3e6b7e1cac14363f7e4f6f219fbd4a28f559b`. Production remains at `52017e8a2f4419915d5544663c58f269e241f1ed`.

## What changed

The private event board now links to **Watch Table** for each round assignment. The selected Table displays a compact life overview, player aliases, commander names/cast count/tax, other counters, incoming commander damage, eliminations, active turn, game/turn clocks, official round time and result status. Secondary counters and damage expand beneath each player's details. The overview uses two columns on phones and four on wider screens.

Visible selected Tables refresh about every two seconds; the event overview remains on its existing 15-second interval. Slow networks can delay updates. Refresh preserves expanded details, focus and scroll. Closing, hiding, navigating away or losing access stops updates; an explicit retry can reopen an unavailable view.

This uses the existing private event link: no account, entry or seat is required. Links expire after 24 hours and can be replaced/revoked by the issuing organizer. Viewer reads send only the private viewer capability. They do not acquire a seat, change a counter, recover a room or renew its activity/expiry. Opening a viewer link preserves a player's saved return marker and existing connected seat. The loading dialog opens before configuration completes, preventing reconnect from automatically reclaiming a saved seat during viewer entry.

The server allowlists gameplay fields only after checking the issuing organizer, exact assignment, room identity, accepted/captured game, sealed roster and seat ownership proof. Selected reads load only the issuer and assigned participants, rather than the full event directory. Room codes, account/entrant IDs, recovery secrets and private notes are excluded. JSON is not cached. The capability leaves the address bar before network access and is retained only in memory; after a full reload, reopen the original link.

## Finished or unavailable games

- The actual elimination undo window remains visible before a result is finalized. A reported winner remains awaiting host confirmation; standings count only confirmed results.
- A confirmed correction supplies the authoritative winner/order. Confirmed zero-point players remain in standings; entrants with no confirmed games are omitted from confirmed standings.
- Final live counters remain visible while the completed game still retains them. Entering intermission resets counters without changing game ID; after that, Watch Table shows the result and participants without presenting reset counters as final totals. Immutable final counter snapshots are not stored by this release.
- Disconnected phones do not make a loaded, unexpired game unavailable. Watching cannot extend the room's lifetime. A missing/expired room or mismatched/replaced game shows unavailable; viewing cannot recover it or reveal a different game that reused a room code.

## Verification

- Final assembled server suite: **734 passed**, no failures/skips. Final client suite after the last UI/startup fixes: **474 passed**, no failures/skips.
- Local black-box protocol: **64 passed**, no failures/skips. New HTTP checks exercise the actual private Table route, malformed/duplicate selectors, missing/invalid credentials, forbidden viewer writes and revocation.
- **19 browser checks** through actual app controls with isolated loopback storage/auth and phone-sized Chrome. A host and guest created/linked an event Table, played, changed counters/commander/turn state, completed a game, confirmed the finish and revoked access. A life change reached the watcher in approximately **1.94 seconds** in this local run.
- Browser checks cover read-only request headers, saved player-seat preservation, paused game clocks versus running official time, expanded details, network failure/retry, revocation and closing during delayed configuration. No unhandled page errors were recorded.
- Settled **320×700** and **390×844** views had no horizontal content overflow and no visible button/input/select below 44px height. Both life totals fit near the top of the two-player overview. Eight-player overview ordering/escaping is covered by renderer tests.
- Independent review found and fixed a clock selector issue and the pending-configuration seat recovery race. A controlled removal of the capture's room-identity check made its regression fail; exact source bytes were restored and the test passed.
- `npm audit --omit=dev --json`: **0 vulnerabilities**. Syntax checks and `git diff --check` passed. No dependencies or Table protocol changes.

This is not physical iPhone/Android evidence, live provider-auth verification or a claim that every app path/device has been tested. Prior whole-app coverage is recorded in the preceding release document; this follow-up verifies its affected paths and reruns the complete automated suites.

## Phone check sequence

1. On staging, create a Tournament, enter players and start its linked Table/game. The host opens **Private spectator link** and shares the link with a separate phone/browser.
2. Open the private event board unsigned, then **Watch Table**. Check all life totals in the overview. Change life, poison, commander casts and damage from a playing phone; watch updates arrive automatically.
3. Expand counter/damage details and change turns. The selected player and clocks should follow play without closing the expanded details. Pause the Table timer: official event time should continue.
4. Lock the playing phones briefly while keeping the viewer open. The loaded in-progress game should remain watchable. Watching should offer no Join, seat or game-edit controls.
5. Finish a game. Check awaiting confirmation, then have the host confirm the full order. Standings should update; returning to setup must not label reset life as final totals.
6. Revoke the private link. The visible watcher should clear private content on its next successful access check, normally about two seconds for a selected Table. Try a slow/offline connection and explicit retry as well.

## Release and rollback

App **318**, competition UI **9**, spectator module **2**, refresh helper **2**, competition CSS **4** and worker cache **383** identify this release. The offline dependency graph pins the updated modules.

The authorized push fast-forwards staging only. Verify served-file hashes against the committed files, `/health`, unauthenticated private-route denial and all 64 deployed protocol checks. Exact deployed commit and results are recorded in the external handoff/evidence after rollout. Code rollback base is `bbe3e6b7e1cac14363f7e4f6f219fbd4a28f559b`; schedule any restart around games and retain all records. Production configuration, branch and services are unchanged.

Evidence directory: `C:\Users\nibay\.codex\visualizations\2026\11\17\01a1e853-7d23-7990-b202-57da465a684f\pod-experience\tournament-live-watch`.

Guidance applied: existing Page Visibility guards pause hidden refreshes; native lists retain their accessibility semantics; repeated Table controls have round-specific accessible names. Existing focus, scroll and expanded-details preservation is retained during updates.
