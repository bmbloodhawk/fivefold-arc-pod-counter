# Saved-deck commander choices

DECK-MATCH-01 fixes a saved-deck editor bug found during the physical iPhone Safari walkthrough: typing `kranko mob boss` received a valid suggested `Krenko, Mob Boss` from the card index, but the editor hid the choice. Save also treated that response as a generic lookup failure and could store the typo using manual colors. The typo-save reproduction used an isolated local fixture, not the user's account.

Staging-only release, based on `858083086ab1e33f1266c4b81b1e5411cbef9d55`. Pins: App323 / styles251 / cache389. Production main remains `52017e8a2f4419915d5544663c58f269e241f1ed`.

## Behavior

- Each saved commander has an initially hidden, named choice group. A selection response exposes up to five native buttons using text labels. Punctuation-free exact names still canonicalize directly.
- Find and Save await both commander lookups. Canonical names and combined colors apply together after all required lookups succeed. Neither a rejected selection nor a mixed selection/network failure is accepted through manual fallback. A suggestion-rendering failure also stops Save without writing the typo.
- Choosing a suggestion changes only its field and reruns exact verification. It sends no deck write. A later explicit Save is required. Genuine lookup/network failures without suggestions retain manual-color fallback.
- Choices own their account epoch, lookup attempt, draft predicate, open editor/dialog and button containment. Input/count changes, new lookups/saves, Add/Edit/Cancel, successful saves and account cleanup remove or retire old buttons. Queued detached clicks cannot change a later same-valued editor.
- The immutable submitted Save payload and completion signature remain intact. A Save response can offer choices only for its original unchanged draft. Once offered, a commander choice remains usable after editing notes, deck name, favorite or manual colors; those changes require their own explicit Save.
- Native Close/Escape retains the current draft and its choices, including choices arriving while closed. Closed-dialog clicks remain inert. Suggestions revealed from footer Save are scrolled into view without moving focus. Selecting a choice focuses its commander field before removing the button.

## Verification

Final results and release verification are recorded in the external evidence folder:
`C:/Users/nibay/.codex/visualizations/2026/11/17/01a1e853-7d23-7990-b202-57da465a684f/commander-match-choices-20261118`.

The original 21 actual-source regressions produced 16 failures and 5 passes before implementation. Additional cases cover bounded choices, closed clicks, new lookups, successful save cleanup, metadata edits and delayed native Close/reopen. Compatibility fixture updates preserve prior assertions. The old structural Promise.all assertion now checks allSettled and both hidden, named groups.

The full client suite passes 695 tests with no failures, skips or cancellations. The 111 focused commander/save/color/privacy/library tests and 4 card-index tests pass; syntax and diff-whitespace checks pass. No build, linter or typecheck command is defined for this static JavaScript client. Unchanged slow backend suites were not rerun.

Chrome and Playwright WebKit pass 94 unique browser assertions at 390x844 and 320x700 using isolated loopback fixture accounts, with zero page errors. One early empty-library check ran during Loading and passed after waiting for readiness (95 recorded executions). Coverage includes actual matching, partner colors, metadata changes, explicit writes, stale replies/buttons, account reset, manual fallback and native Close/reopen. The final exception-boundary edit is covered by unit tests; it does not change normal browser UI behavior.

An initial WebKit320 footer-Save screenshot showed choices above the viewport; this evidence motivated the scoped reveal. Before/after screenshots were inspected; the final first choice is visible, controls wrap and no horizontal overflow was observed. Owned browsers/server were closed. Browser emulation is separate from physical iPhone Safari evidence. Physical selection/save/search confirmation remains pending.

Independent review identified the metadata activation and closed-response resume defects; both have dedicated regressions. No backend, matcher/index data, eligibility rule, dependency, production, Pod, tournament, radiation or deferred Button-mode layout change is part of this fix. No existing deck record is repaired or deleted.

## Modern Web Guidance

- `forms`: I used secondary native buttons so choosing a suggestion cannot submit the editor: "explicitly set `type=\"button\"` on secondary or helper buttons". I kept validation on the existing change/Find/Save paths, with input used only to clear stale results.
- `accessibility`: I used native buttons and focused the selected field before removing its button: "Prefer HTML elements and attributes to ARIA". The groups have descriptive accessible names; the existing polite status announces the result.

## Release and rollback

The handoff carries the user's existing approval for routine fixes and staging deployment. Commit only this fix and its tests/docs, push the working branch, and non-force update staging. Verify health/config and all 12 served asset hashes against that commit, then compare production index/app/styles/worker with unchanged main. Deployment evidence lives outside the repository so it can record the exact release commit.

If the release needs rollback, revert this scoped commit on staging and deploy the revert, retaining records. Production and unrelated original-workspace changes remain outside the release. Physical test continuation: refresh staging in iPhone Safari, My decks → Add deck → `kranko mob boss` → Find commander colors → choose `Krenko, Mob Boss` and verify Red before saving `Phone Test Deck` with notes `Safari test`.
