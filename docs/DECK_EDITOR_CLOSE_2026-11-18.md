# Saved-deck Close navigation

DECK-CLOSE-01 follows the user's physical iPhone Safari report: saving `Phone Test Deck` with `Krenko, Mob Boss` and notes `Safari test` succeeded, but Close dismissed My decks to Home and reopening resumed the unsaved editor. The earlier draft-retention behavior was intentional in the previous release; the user's current instruction supersedes it.

Base: `78e542b31022cc24d85ad0e250e6220744f573c1`. Staging-only follow-up; production remains `52017e8a2f4419915d5544663c58f269e241f1ed`. Release pins: App324 / styles251 / cache390. Styles are unchanged.

## Behavior

- Close in Add/Edit discards unsaved changes and returns to the saved My decks list inside the open dialog. It preserves the search query and saved records, and sends no deck mutation.
- Close from the list dismisses My decks. Reopening starts at the list. Escape uses the same two-level navigation through the native cancel event.
- Draft reset retires pending lookups/saves and old choice buttons. A request already dispatched may finish its original authorized save; its delayed response cannot reopen the abandoned editor or alter a replacement draft.
- An actual native dialog dismissal clears an abandoned editor. Queued close events from an older dismissal cannot clear an already reopened dialog.

## Verification

Baseline reproduced in the real local browser. Updated focused tests first produced 14 expected failures out of 98 cases. After implementation, all 98 focused tests and the full 707-test client suite pass, with zero failures/skips/cancellations. Syntax and diff-whitespace checks pass. Behavioral tests exercise actual button/dialog bindings and replace only the superseded draft-retention expectations.

All 78 unique actual Chrome/WebKit assertions pass at390x844 and320x700, with zero page errors. Coverage includes Add/Edit Close, saved-record/search preservation, clean next Add, library dismissal/reopen, native Escape and delayed lookup/accepted-save/detached-button ownership. Narrow-screen library/editor screenshots were inspected; no horizontal overflow was observed. Independent review has no actionable findings; a mutation reversing Close routing failed seven tests. No build/lint/typecheck command is defined for this static client, and unchanged backend tests were not rerun.

Final test/browser/release results are recorded in `deck-editor-close-20261118` under the existing external evidence root. Owned browser/server cleanup is recorded there.

Phone-sized Chrome/WebKit evidence remains separate from physical iPhone confirmation. The user has reported the earlier commander-selection/Red and successful-save checkpoints passing. Close retesting, reload persistence and Search decks remain pending.

## Modern Web Guidance

I kept the native modal and visible Close button. I intercept only the editor's native cancel request to navigate back to the list: "use `cancel` to intercept `Esc` and `request-close`" (`dialog`). I retained ordinary modal dismissal from the list and did not depend on the newer `closedby` attribute (`platform-controls-dismiss-dialog`: "there is no fallback necessary").

## Release and rollback

The existing user authorization covers confirmed routine fixes and staging releases. Verify all 12 served staging assets, health/config and the four unchanged production assets. Rollback is a revert of this scoped follow-up on staging; existing records are retained. No backend, dependency, CSS, production, tournament, Pod, radiation or deferred layout change is included.
