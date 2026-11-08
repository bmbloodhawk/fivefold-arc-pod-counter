# Fivefold Arc reward integrity and pacing

A new profile unlock needs a completed result from the server and a qualifying game or history threshold. A personal accolade names a standout play and the recorded fact that supports it. A routine finish gets a game recap.

## What changed

- The server freezes each participating seat's result, counters, duration, and reward facts at the finish. It retains the last three finishes in the room for delayed saves and recovery.
- The first eligible profile to save can claim a seat's result, so a guest can sign in after play. Each profile receives one record per game. Same-table profile progress counts that profile's own verified saves.
- A game save and its new awards commit together. The award decision records the triggering game and rule version. Paced awards also record their measured value and threshold. Historical saves carry their existing progress forward with their original evidence.
- An already-ready paced tier waits for another game that contributes to that track. Flash Victory needs a recorded turn handoff. Aborted resets, open pauses, undone turns, and practice finishes are excluded where they would otherwise produce incorrect progress.
- A stronger moment takes priority over routine facts. Related accolades share a recency window of five saved games on a profile and two completed games at a seat. Quiet games advance those windows. Table Trilogy and Familiar Seats can appear at their exact table milestones. Monthly Ritual stays earned and uses UTC save dates for new awards.

## Repeat-play evidence

One synthetic seat played 100 four-player games, each with 48 minutes of recorded play and six turns per seat. The previous selector returned an accolade after all 100 games. The new selector returned 98 recaps and two table milestones, on the third and fifth finishes.

Two other synthetic replays each saved 100 verified finishes. Both gave the first recovery a specific card, showed a recap for the close repeats, and recognized the recovery again after quiet games.

| Profile in the replay | Awards at game 5 | Awards at game 25 | Awards at game 100 | Wins at game 100 |
| --- | ---: | ---: | ---: | ---: |
| Steady saved-deck player | 14 | 21 | 27 | 48 |
| Varied player with few wins | 11 | 15 | 20 | 3 |

The second profile reached endurance and resilience milestones with zero wins at game 25. These replays check the rules and reward cadence. The long-term feel still needs feedback from real players.

## Verification

- Run the full suite with `npm test`. Run the two 100-game fixtures with `node --test server/test/repeat-play-rewards.test.js`.
- All 180 below, at, and above boundary checks for the 60 long-term tiers matched the catalog through the new save path. The automated suite covers concurrent saves, interrupted writes, account and seat boundaries, resets, pause time, restart recovery, and turn undo.
- In local Chrome at 390 × 844 with synthetic sign-in, a 45-minute finish showed a plain recap and the applicable first profile awards. A 61-minute game with a recovery from 4 life showed an illustrated recovery accolade, followed by Settling In. Both saves returned 201 and the browser reported no runtime exceptions.
- The storage conflict tests simulate Firebase responses. The browser used synthetic accounts and a phone-sized viewport. Live Firebase and physical phones remain unverified.

A release needs the matching web client so it can send the completion reference. Cached clients that still send the old save format need a refresh. The local branch has the updated service worker and asset versions.
