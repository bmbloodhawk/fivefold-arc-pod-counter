# Fix 01: isolate pending deck saves

Audit item: **POD-AUDIT-01 (P1)**. Base/staging before this fix: `26d60735f556cc4be84e25263f8286e81121e5ea`. Release target: staging only. Production stays at `52017e8a2f4419915d5544663c58f269e241f1ed`.

## Problem and resulting behavior

A deck save acquired account A's token, awaited commander lookup, then read the shared editor again. If the person signed out and account B filled that editor in the meantime, A's pending request could persist B's name, notes and favorite state under A. Its completion could also erase B's draft.

The save now captures the entire submitted draft, edit target and profile generation before waiting. Lookup resolves only those captured commander names without changing the live editor. Token and lookup results are checked before a write starts; success, failure and follow-up reads are checked before updating the current screen. An older attempt cannot take over a newer save's controls.

The editor clears only while it still contains that submitted draft, including an equivalent canonical name/color update from its normal blur lookup. Newer edits remain intact. The post-save library read has an optional ownership guard; ordinary library callers retain their existing behavior. Profile reset restores the Find Colors button, and old profile blur responses cannot change the next profile's fields or controls. Manual color fallback and paired-commanders remain supported.

A request already dispatched before sign-out may finish saving A's own captured draft. This fix cannot reverse an accepted server write; it prevents reading B's later draft or updating B's screen.

## Scope

This resolves the pending-save account race. The separately recorded normal editor-reset privacy issue (POD-AUDIT-03), preference-save issue (02) and same-profile commander-count lookup issue (04) remain open. No backend authorization, storage schema, dependency, Table protocol or production configuration changed.

## Verification

- Original browser reproduction persisted B's private fixture notes in A's library. The same delayed lookup/account switch now sends zero stale writes and preserves B's complete draft and UI.
- **20 new behavioral deck regressions** cover delayed token/lookup/write/library success and failure, immutable edit targets/payloads, newer drafts/attempts, normal create/edit, canonical blur, paired commanders, manual fallback and profile reset. Original eight races and three additional ownership edges failed before their fixes. Controlled VM-only guard mutations were detected by the regressions.
- Final full client suite: **494 passed**, no failures/skips. Related account-history/account-control server suite: **36 passed**, no failures/skips. These are not a rerun of the whole server suite.
- **Nine browser checks** passed on the actual app with isolated local storage/fixture auth, including old already-committed POST responses after switching, normal create/edit/fallback, a combined blur/save race and an old library response while a newer save is pending. No unhandled application page errors. The preserved draft also fit the checked 320px view.
- The existing journey test retains its editor/lookup checks. Two assertions that required the unsafe live-DOM save shape were replaced by actual payload/fallback regression coverage.
- Dependency audit: zero vulnerabilities. Syntax and diff checks passed. App **319**, worker cache **384**; unchanged competition modules retain their existing pins.

Evidence: `C:\Users\nibay\.codex\visualizations\2026\11\17\01a1e853-7d23-7990-b202-57da465a684f\issue-01-deck-save-account-race`. Additional retained RED/mutation logs: `multiplayer-browser-audit-20261118\fixes\POD-AUDIT-01` under the same parent evidence directory.

The browser evidence uses fixture accounts and phone-sized Chrome. It does not establish physical iPhone/Android or live identity-provider behavior. Account B's editor was explicitly prepared for the race checks; the separate ordinary editor-reset defect is not claimed fixed.

## Staging and rollback

After the authorized staging push, verify the committed served-file hashes, health and existing protocol checks. Record the exact commit and results in the external issue handoff. Rollback base: `26d60735f556cc4be84e25263f8286e81121e5ea`, with any staging restart scheduled around games and records preserved.

Modern Web Guidance: the forms guidance says to "disable the button after a valid submission is clicked". Save is disabled before the first asynchronous wait; only its current attempt/profile can restore its control state. This preserves the existing status announcements without adding a new form flow.
