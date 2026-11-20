# Dial labels and other-player inspection

The phone walkthrough reached a connected Commander game at39/40. The user found the name and temporary life-change message hard to read over the dial art. They reviewed local phone-sized samples and approved the unboxed inset treatment, then explicitly authorized staging implementation for physical-phone testing.

Base: `3296d0cdcbe3e6b899022c70c89a6a31be3a815d`. Candidate pins: App326 / styles251 / dial CSS4 / dial JS3 / cache392. Production main remains `52017e8a2f4419915d5544663c58f269e241f1ed`.

## Change

- The dial's mode label sits0.5rem lower and has stronger contrast. The name sits12px below the rendered value, using cream lettering, a dark letter edge and a feathered art fade. The fade sits below the readout and cannot darken its number. There is no caption panel, border or outline.
- The name beneath the number omits YOU. Local simulation keeps SIMULATED for the other simulated seats. Commander source information remains in its existing source card.
- Inspecting another player's counter puts VIEW ONLY beneath their name in the existing feedback area. It adds no inspection strip. Warnings share that one visible output with VIEW ONLY; they are not discarded or duplicated.
- Commander damage details appear only while inspecting another player's Commander tab in a Commander game. Existing source/tax controls and mutation guards remain.
- Caption geometry follows the rendered number and transformed readout. Sibling feedback and artwork use assembly coordinates. Button mode retains its DOM ancestry and existing layout behavior. Long names/warnings can wrap; dense screens scroll rather than clip critical text.

## Verification

Eight initial actual-render cases produced seven expected baseline failures and one simulation pass; a round-trip cleanup case and an owned-warning expiry case complete the ten-case readability suite. With the inspection-dialog case, focused checks pass11/11. Full client checks pass724/724 and card-index checks pass4/4. An obsolete variable-name assertion and stylesheet pin assertion were updated; actual rendering and timer tests preserve the former behavior contract.

Independent in-memory mutations show that dropping the Commander-tab guard fails the relevant regression and disabling persistent view-only feedback fails the label/warning/transition cases. No test is skipped or disabled. No backend or dependency change is included; unchanged slow backend suites are outside this client-only change. The repository has no client build/lint/type-check command.

Real browser checks pass298/298 across Chrome and WebKit at320/390, with all six counter modes owned/inspected, stable feedback expiry, Button ancestry/layout,44px touch centers, and read-only keyboard/drag producing no mutation request. Zero uncaught page errors were observed. A24-character name and60-character unbroken commander warning fully wrap at320, leaving16.73px before the first control. Root inspected ordinary own/other screenshots and the dense warning case. Browser evidence lives in `dial-label-implementation-20261119`; client and served-release evidence lives in `game-readability-20261119`.

The first supported-transform probe found that +20px readout translation doubled the name gap from12to32px. Coordinate conversion now keeps12px with translation and11.98px with translation plus1.2scale. The authored scaled readout itself can extend beyond the mobile viewport; caption geometry follows it, and this change does not add containment or redesign authored placements. Physical iPhone testing remains the user's next checkpoint.

## Modern Web Guidance

I use rem-based name/feedback sizing and minimum block sizes with wrapping, following `typography`: "Let the content set the height". This keeps longer text visible instead of forcing it into a clipped caption box. Fixed minimums protect the dial's readable content in dense layouts.

## Release and rollback

Publish only this approved change to the existing staging branch. Verify14 served asset hashes against the exact candidate, including dial CSS/JS and the worker marker, then perform one normal companion-browser reload. Retain the existing table,39/40 values and turn; do not adjust counters/setup or leave. Production main and four served production assets must remain at the baseline.

Rollback is a scoped revert of this change on staging and another verified deployment; no record repair or deletion is included. A source push alone is not release verification. The next phone check is refreshing staging and inspecting the new name/title/view-only placement before resuming counter tests.
