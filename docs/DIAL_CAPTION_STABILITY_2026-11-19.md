# Stable caption beneath changing totals

The physical phone check approved the stronger name and LIFE label and the other inspection changes. It also exposed movement of the name as numerals changed. The previous release placed the caption below the number's optically corrected box, so Georgia's differing numeral shapes moved the caption too. A local Chrome320 sequence reproduced a14.5px range while the dial size stayed unchanged.

This follow-up reserves one fixed two-digit reference band around the number's uncorrected center. The band uses `88` at the normal font size, reversing the existing digit-count reduction. The name, feedback and fades therefore keep their position when numeral shapes change or99 becomes100. The number keeps its existing optical centering. Authored placement/scale and visible elimination-outcome clearance remain supported.

The stable band exposed a dense-warning overlap: a long warning extended7.45px beneath End turn. A measured clearance guard now grows the stage minimum only when needed, allowing a short scroll rather than covering controls or shrinking text. That space is retained through feedback expiry and reset on mode/viewport changes or Button. Ordinary caption placement is unchanged by this guard. No controls or authority rules are changed.

Base: `d43a65c676582688dda73b8a3f76ea297de829f9`. Pins: App327 / styles251 / dial CSS5 / dial JS4 / cache393. Staging only; production remains `52017e8a2f4419915d5544663c58f269e241f1ed`.

## Checks

One actual `createDialLayout` regression holds stage/readout/base font constant while varying numeral metrics and99→100 font sizing. It requires stable caption/feedback/fade anchors while allowing the number's optical correction to change. Baseline layout checks had8passes/1expected failure. A second actual-module case covers warning clearance and reservation through expiry; the final layout suite passes10/10. Full client checks pass726/726 with no failures, skips or cancellations. An in-memory mutation restoring the old anchor fails the new regression. Independent code review found no actionable issues.

Bounded Chrome/WebKit checks pass37/37 across48 numeric/viewport states at320/390. One/two-digit totals are identical in position;99→100 has at most0.344px rounding versus the14.5px baseline jump. Button, authored translate/scale, elimination, expiry and read-only authority subsets pass with zero uncaught page errors. Dense warning expiry keeps name and301px stage stable, with10.64px End-turn clearance and reachable bottom navigation after scrolling. Root inspected ordinary and dense screenshots. Browser evidence is in `dial-label-stability-20261119`; tests and served-release proof are in `caption-anchor-20261119`.

The modern-web-guidance searches for text/canvas metrics did not yield an applicable implementation guide. This uses the existing Canvas text-measurement path; [measureText](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/measureText) supplies ink metrics for the fixed reference instead of the current counter text. No new API dependency or CSS pattern is introduced.

## Runtime continuity and release

A browser automation call exceeded its time limit and reset the Node REPL, losing the original staging companion process. This was an automation failure, separate from the caption defect. The original table remained intact at version40, P1 life52 and P2 life40. Its guest credential was unavailable; no old-seat repair or replacement was attempted. The user explicitly created new table ES7KUY. Browser Test then joined it once through normal UI as P2, with Tymna/WB and Thrasios/UG. Both players are connected at40 in the lobby. A dedicated normal persistent browser profile retains the new guest session outside repository/evidence; no credentials are exported.

Verify exact served files and reload the new persistent guest normally after the staging push. Do not start the game or adjust counters/turn/setup on the user's behalf. The physical phone check must confirm the name stays still across a minus/plus pair returning to the starting total. The user explicitly wants the chat handoff only after this fix is confirmed working. Rollback is a scoped revert of this follow-up, retaining the approved readability design and records.

The user's separate KBY9HY reset report recalled a connection error but no exact text. Read-only source/in-memory checks confirmed offline guests do not block reset; stale versions return409 and expired host connections return401. The exact reported cause remains unproven. No reset logic is changed in this release.
