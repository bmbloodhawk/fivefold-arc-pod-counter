# Fivefold Arc Duel — Two-Phone Private Test

Run this only against the hosted HTTPS URL after persistent storage is configured.

1. On phone A, create a Best of 3 Match as `Duelist A`.
2. On phone B, join the displayed code as `Duelist B`.
3. On A, record `-1200 LP` with a note. Confirm B sees the same LP total and record entry.
4. On A, correct that entry by `+200 LP`. Confirm the original entry remains and the correction is visibly linked.
5. Advance through the six phase labels. Confirm only the active Duelist can advance, then deliberately use Undo once.
6. Refresh phone A. Confirm it automatically reclaims A's seat and the stale connection cannot change LP.
7. Restart the hosted service. Confirm both phones show the recovered Duel, then each reclaims only its own seat.
8. Finish a Duel, record a winner, start the next Duel, and confirm Match score remains while LP returns to 8,000.
9. At 320 x 700 and 393 x 852, check that no control is obscured, inputs do not trigger browser zoom, and the LP record can be read.

Record any app-caused state dispute, failed reclaim, unclear ownership message, or unreadable control. A private test is not a public-release pass until every finding is resolved and retested.
