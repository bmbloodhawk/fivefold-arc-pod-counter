# Guided staging phone check

Use https://fivefold-arc-pod-counter-staging.onrender.com/ and confirm the TEST ENVIRONMENT banner. Production is outside this test. These are planned physical-phone checks, not claims of completed device coverage.

We will do one flow at a time. After each checkpoint, record pass/fail, phone/browser, screen orientation, what was tapped and what appeared. On a failure, stop that flow and capture the exact screen/message before retrying. Keep private invite codes, viewer links and account credentials out of screenshots shared publicly.

The user will test on iPhone with Safari. Open the staging link in Safari first; if it is also installed on the Home Screen, test that separately after the browser flow. The agent can supply additional isolated browser players. A second real phone is useful for native-camera QR scanning and actual lock/background behavior. We will first use one phone, then add other players as needed.

| Order | Flow and checkpoint | Physical result |
|---|---|---|
| 1 | Open staging in the normal phone browser. Confirm banner, load, scroll, Back, legal links and no unexpected return to an old Table. Record phone/browser. | Not run |
| 2 | Account: email sign-in, password visibility, invalid credentials, Cancel/Back, session restore, sign-out and retry after a failed connection. Test Google separately with the real provider. | Not run |
| 3 | Profile: preferred name, game defaults, appearance settings, save and reopen. Sign out and confirm private preferences do not return from a delayed save. | Not run |
| 4 | Decks: create a single commander, find colors, manual fallback, names/notes/favorite, edit, archive/restore, remove, summary export and game statistics. Paired commanders: combine colors, change to one during lookup and save. | Not run |
| 5 | Account privacy: edit a private deck, sign out, sign into a second test account. Check editor, notes, colors, library and setup deck selectors are empty for that account. A failed sign-out keeps the draft available. | Not run |
| 6 | Create: Commander, Casual and Custom; names, optional commanders, saved deck, appearance, round limit, all Back/Next steps and validation. Test custom life 1/999 and invalid 0/fraction/1000. Cancel a slow create; return using its saved Table if it completed. | Not run |
| 7 | Join: code/link, native camera QR, in-app scanner/photo, camera permission denial, invalid QR, code correction, sign-in midway and saved-seat reclaim. Claim another seat from another phone/browser. Verify the correct staging domain. | Not run |
| 8 | Lobby: one-player Start disabled; two-player Start; selected first player; real d20 first roll/tie/reroll; coin toss; quick repeated Start. Check seat names, open seats and full Table response. | Not run |
| 9 | Play: all six counter modes; Dial and Button; ±1/±5 and Custom Add/Subtract/Cancel; mixed rapid taps; custom 999 plus a quick +1. Check every other player sees the confirmed life total. | Not run |
| 10 | Commander: one/two commanders, change setup, tax/casts and undo, incoming damage sources, inspection of another seat and no ability to edit its counters. | Not run |
| 11 | Turns: start/end/undo handoff, active-player cue, device sound/vibration settings, tracking and pause/resume, round limit. Radiation retains its existing automatic popup; resolve zero/positive nonlands and reject invalid amounts. | Not run |
| 12 | Recovery: lock all phones while playing, unlock/resume, switch app, reload, go offline, attempt a change, reconnect and confirm authoritative totals. A different tab reclaim must not let an old tab keep writing. | Not run |
| 13 | Helpers: single card lookup, two-card interaction, invalid new card after a valid result, changing a pending query, Close/reopen, coin toss and any available share/clipboard paths. | Not run |
| 14 | Finish: life/poison/commander elimination, undo window, manual elimination, declared winner and alternate win, timed draw, frozen counters, winner/accolade/achievement stages and saved history/deck credit. | Not run |
| 15 | Next game: each player dismisses their own celebration, updates deck/setup, ready/unready, host seating/starter confirmation, remove/add a player, start next game, Leave and saved-seat return. Casual remains a ready-up flow. | Not run |
| 16 | Private Pod: create, invite link and real-camera QR, join/sign-in/name preservation, member approval/alias/roles, remove/leave/reinvite. Returning members retain their own game credit. | Not run |
| 17 | Pod play/records/activity: create/link Table, join through Pod, playing/open/full state, phones locked during an ongoing game, declared winner then everyone leaves without another game. Check completed/closed activity, record confirmation/correction/ties and history. | Not run |
| 18 | Tournament entry: organizer creation, member/self-entered guest/attested guest, attendance, withdrawal and return. Check private access and non-playing organizer behavior. | Not run |
| 19 | Tournament games: seating, edit/release/replace assignment, host validation, start, official clock, early Call time rejection followed by continuing countdown, pause independence, current/final turns and draw. | Not run |
| 20 | Tournament postgame: non-host dismisses first while host celebration stays open. Review the finish and return to event immediately; confirm/correct result, depart explicitly, next round and final standings. | Not run |
| 21 | Private spectator: create/share link on another phone, unsigned board, select a Table, live life/counters/damage/turn/result, switch Table, Back/Close, lock/unlock, replacement/revocation and failure. Viewer remains read-only and does not claim a playing seat. | Not run |
| 22 | Appearance and storage: default/personal/shared skin, Dial/Button remembered preference, screen awake support, installed app if used, offline shell, update after closing/reopening. Real sound/camera/vibration/clipboard permissions are device checks. | Not run |
| 23 | Account completeness with a disposable test account: registration/validation, password-reset delivery, data export, history/deck removal, account-data deletion and cleanup. Confirm the disposable account before any irreversible action. | Not run |

Small-screen Button layout changes remain deferred until actual play shows a problem. Record layout evidence during the checks without changing the approved scope. Natural long-duration expiry, all browser/OS combinations, venue-scale load and provider outages cannot be certified from one phone session. Existing automated and simulated-browser evidence is recorded separately from these physical results.
