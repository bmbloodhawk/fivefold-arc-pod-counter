# Fivefold Arc reward integrity and pacing

## End-of-game flow

Winner → personal accolade → newly earned profile achievements, when present → next-game setup.

- The server freezes each participating seat’s result, counters, duration, and reward facts at the finish. It retains the last three finishes in the room for delayed saves and recovery.
- A standout card includes the fact that qualified it. Quiet finishes use recorded completion facts such as the opening order, the format, or the seat’s closing life total. The table selector reserves different accolade families for different seats. It also checks for duplicate display titles from older title variants.
- The selector looks back at five room cards per seat. On a signed-in save, it also checks the account’s last five saved accolades across rooms. Each seat’s alternatives are reserved for that seat. If all of them are recent, the save uses the least recently shown eligible card to keep the table’s cards distinct. A confirmed finish without retrievable card details can still display Arc Complete.
- The first eligible profile to save can claim its seat’s result, which supports signing in after play. Each profile receives one record per game. Same-table profile milestones count that profile’s own verified saves.
- A verified game save and its new achievements commit together. Each unlock records its triggering game and rule version. Paced unlocks also record their measured value and threshold. Existing achievements and recorded progress carry forward.
- An already eligible paced tier waits for a saved game that contributes to that track. Flash Victory needs a recorded turn handoff. Aborted resets, open pauses, undone turns, and practice finishes are excluded where they would otherwise produce incorrect progress.

## Repeat-play evidence

Three synthetic profiles each saved 2,000 verified games through the room and account services. Each played three games per UTC date. The fixture varied wins, deck use, table size, game duration, and close calls. These are cumulative profile awards before and after adding Table Days.

| Profile | Game 5 | Game 25 | Game 100 | Game 250 | Game 500 | Game 1,000 | Game 1,500 | Game 2,000 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Steady saved deck | 11 | 21 | 30 | 43 → 44 | 51 → 55 | 61 → 72 | 65 → 79 | 67 → 84 |
| Varied decks and tables, few wins | 8 | 14 | 21 | 28 → 29 | 35 → 39 | 43 → 54 | 49 → 63 | 53 → 70 |
| Longer sessions | 12 | 22 | 34 | 44 → 45 | 52 → 56 | 62 → 73 | 68 → 82 | 72 → 89 |

| Profile | Longest gap in games 101–1,000 | Longest gap in games 1,001–2,000 |
| --- | ---: | ---: |
| Steady saved deck | 99 → 74 games | 399 → 151 games |
| Varied decks and tables, few wins | 129 → 74 games | 219 → 147 games |
| Longer sessions | 199 → 74 games | 299 → 151 games |

The new Table Days track recognizes coming back to play across 19 tiers. Its first tier takes 50 distinct dates with verified finishes. Four later tiers at 450, 550, 600, and 650 dates close stretches identified by extending the replay past 1,000 games. Up to one finish per UTC date counts, regardless of result or deck. Existing verified dates count toward the total. Legacy saves without verified completion dates do not supply dates. The original achievement tracks keep their thresholds, and the one-long-term-award limit per saved game still applies.

These numbers describe the modeled schedules. The pace changes when players cluster games on fewer dates. Whether the rewards feel meaningful over a long run still needs player feedback.

Staging uses the same reward rules and screen sequence, so it can exercise both the earned and no-unlock paths.

## Verification

- `npm test` covers the reward flow, distinct and fresh cards across sixteen quiet games at an eight-seat table, competing standouts, concurrent saves, retries, seat and account boundaries, restart recovery, and valid evidence. The new Table Days tests cover below, at, and above all 19 thresholds plus duplicate dates and legacy history.
- `node qa/reward-progression-replay.mjs` reproduces the 2,000-game checkpoints and reports the games that earned new awards. The comparison used the account-history rules at `488e533` with the same room actions and fixture.
- Local Chrome at 320 × 700 and 390 × 844 walked through a quiet completion, an illustrated recovery followed by Settling In, and the next-game screen with and without a new achievement. The walkthrough used synthetic sign-in and in-memory storage. The 390-pixel walkthrough also ran against a local staging configuration. Physical phones and live Firebase remain unverified.

A release needs the matching server and web client for the verified save request. The local branch has updated client asset and service-worker versions.
