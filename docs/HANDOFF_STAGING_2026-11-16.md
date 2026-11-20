# Game-flow handoff integration for staging

The user authorized finishing the handoff integration, checking the app, publishing the verified candidate to staging, and then reviewing Pods from membership through recorded games. Production and retention/deletion work remain outside this release.

## Included behavior

- The five accepted local commits through `49507c3`: fifteen-second elimination undo, readable result text, joined-roster table sizes, next-game commander/deck editing, and automatic next-game starter rotation with host override.
- Ported `e83b092` and `3a1cfb8` behavior: stable claimed P labels, sorted initial lobby claims unless the host arranged them, and host Adjust table order during play. Saving preserves the current player, timer, counters, handoff history, and completion records. Pending final results still block reordering. The corrected order feeds the existing next-game starter policy.
- Restored earlier approved Create table safeguards against premature and repeated submissions, adapted to the current four-step Commander / three-step Casual and Custom flows. Failure permits retry; ignored responses do not reopen a cancelled table.
- Full-app fault checking reproduced the saved commander-tax HTTP503 retry issue. Refresh its controls after a write settles so a failed cast can be retried without closing the dialog.
- Updated cache/import versions for the changed frontend. Kept native modal behavior and Tap anywhere on result screens.

Home/sign-in fixes, starting-life presets, lobby wording/exit, and active-table refresh recovery already had equivalents. Earlier capacity UI is superseded by joined-roster sizing. The separate privacy wording drafts remain preserved and parked.

## Verification

- Full server suite: 647 passed. Final frontend suite after the retry/cache changes: 408 passed; no skipped checks.
- Local black-box protocol suite: 64 passed. Dependency audit reported zero known vulnerabilities.
- Added regression tests failed on the pre-integration code. An in-memory mutation removing the pending-final guard failed its intended test; tracked source was never mutated for that experiment.
- Independent review caught a First player selector label mismatch; corrected it and added matching selector/roster assertions.
- Phone-sized Chrome checks cover 320/390/430-pixel order dialogs, creation progression/progress/error/retry, claimed labels, shared turn order, commander entry, saved preferences/decks, Pod ratings, and tournament registration/table setup.
- Evidence is in the calling chat's `handoff-integration` visualization folder. Deployment identity and the subsequent detailed Pod findings are recorded separately after the actual staging deployment.

These are automated/local-browser checks, not physical-phone, Safari, screen-reader, real provider-login, or production certification. Local signed-in checks use an isolated identity-provider fixture with real app account handlers.

## Release boundary and recovery

Only push this candidate to `staging`; its previous baseline is `8b4fdca6963c6183cb0e35549bed39671b1bbba9`. Verify health and normalized frontend hashes after Render updates, then run staging protocol checks using fresh synthetic test tables. Do not touch production branches or existing user records.

If staging verification fails, preserve diagnostics and hold the release. The prior staging code is the rollback target after test games are safely finished; rollback does not authorize deleting stored records or reverting shared history. Original worktrees and the main workspace's unrelated edits remain preserved.
