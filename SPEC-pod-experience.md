# Spec Delta: Pod experience — V1

Status: implemented and verified locally after user approval on November 17, 2026. Production and staging remain unchanged; publication requires authorization.

## Objective

Make existing Pod tasks easy to find, complete and recover from on a phone: invite people, sign in and join, create/join/return to a Table, check game-credit eligibility, play, confirm results, browse records, correct mistakes, and manage membership.

The goal remains active. This proposal is a bounded improvement to the existing Pod hub, not a redesign of its rules or data model. The user authorized optimization and testing; publication of this new scope has not been authorized.

## Baseline and evidence

- Start from verified staging `56e65d3e367cbfef8af74007206db6d1b957938f`, including the returning-member seat-proof and creation-retry fixes. Production `main` remains `52017e8a2f4419915d5544663c58f269e241f1ed`.
- Isolated worktree: `C:\Users\nibay\.codex\worktrees\fivefold-arc-pod-experience-20261117`; branch `codex/pod-experience-20261117`.
- A fresh local walkthrough passed invitation/sign-in draft preservation, account-linked Table play, confirmation and both ratings, 320px standings fit, and named owner succession to an appointed admin. Ordinary life changes generated no competition requests. No unhandled page errors occurred.
- Runtime friction confirmed: a one-member Pod shows Play/History/Pod menu with invitation hidden inside the menu; a revoked deep invite offers only Try again; removal confirmation omits the member's name; a confirmed result immediately presents Save corrected order; successful sharing leaves Working… (share API simulated at the platform boundary).
- Follow-up runtime tracing confirmed non-host Play in actual intermission opens Create briefly, then returns to intermission about 3ms later. `launchTable` saves creation intent and opens Create, but the dialog's delayed close event invokes `adapter.onClose`, whose existing-Table render overwrites that view. The noncredential pending intent remains set with `forRoomCode:null`. See `current-table-return-diagnosis.json`. No seat loss or unintended Table binding was reproduced.
- Source review confirms Home Join and seat claim do not clear that intent; `beforeStart` can later attach it to the current room. Existing server guards protect already-linked Tables. Binding an unlinked Table after subsequent host succession remains a call-path risk, not an observed outcome. Cover transition ordering and intent isolation with regressions.
- Independent source reviews covered membership/ownership and Table/results/history. Both support the scope below with its stated safeguards.
- Evidence directory: `C:\Users\nibay\.codex\visualizations\2026\11\17\01a1e853-7d23-7990-b202-57da465a684f\pod-experience`. See `baseline-review.json`, `QA_INVENTORY.json`, screenshots and preservation hashes. These are loopback real-handler/storage checks with simulated account-provider boundaries, not physical phones or live provider sign-in.

## Existing capability and boundaries

One existing capability, `pod-flow`, owns the shared competition hub navigation, Pod screens and their existing Table/account adapters. Reuse its current server authorization and result/history services. No new service, storage collection, identity system or dependency is proposed.

Flow order: get members in → create/join/return to a Table → check credit and play → confirm/read/correct records → manage the group.

## Proposed behavior and acceptance criteria

### 1. Clear Pod entry and invitation

- Expose Invite members directly on Pod home. A one-active-member hint can explain inviting the group and creating a Table, without implying the Pod has no past history or blocking guest play.
- Distinguish a **Pod invite** (membership and records) from a **Table code** (a seat in a game). Private membership still requires sign-in; preview remains available unsigned and acceptance remains explicit.
- Preserve entered names through sign-in and existing membership/creation retry behavior.

### 2. Explicit Table actions and return

- Make Create Table and Join Table by code distinct choices using the existing setup/seat forms. Offer Return to Table whenever the player already owns a current seat; apply current-Table guards to hosts and non-hosts in lobby, play and intermission.
- Joining must clear abandoned creation intent. It must preserve the Table's actual server binding, never bind/rebind it to the Pod from which the join flow was opened. Explain that the host chooses the Table's Pod and display the actual linked group after joining.
- Back/Close, failed lookup, an occupied seat and a different linked Pod must leave a clear route to the current Table or Pod. No public discovery/directory of private Tables is added.
- A delayed dialog close event must not overwrite an intended outward navigation. Test both the visible transition and the pending-intent state; a momentary Create flash followed by returning to the Table is not a successful creation route.
- Acceptance: complete Create and Join from Pod entry, return with the same seat/code across all lifecycle states, and verify a stale create intent cannot bind a subsequently joined Table. Preserve cross-Pod protection.

### 3. Explain credit before starting

- Use the existing proof-based context roster to summarize linked members and guests before start. Explain that guests can play but need membership/sign-in and a linked seat before the game starts for Pod credit.
- Account restoration must update the current proof/link state. Once a game starts, eligibility remains sealed; current roster changes must not imply retroactive credit.
- Preserve gameplay without extra competition traffic on life/counter taps. Do not block normal guest play or introduce automatic membership.

### 4. Reach pending results directly

- The awaiting-confirmation action opens pending games directly, with original-host/admin guidance and an honest empty state after reconciliation.
- Add an optional `status=pending` filter to the existing authorized history endpoint, applied **before** existing pagination. Keep the unfiltered history contract and date bounds. Load older pending pages explicitly; do not filter only the newest 20 games or eagerly fetch all history.
- Preserve history browsing position/date when returning from a game where practical within the current navigation structure. Handle a changed/invalid cursor with a clear restart route.
- Acceptance: an older pending result beyond 20 newer confirmed games is reachable; a confirmation removes it from pending while retaining it in history; ordinary members receive accurate permission guidance; unauthorized/cross-Pod reads remain denied.

### 5. Give results a clear completed state

- Confirmed results open as a saved summary with order and rating changes. Eligible original hosts/admins explicitly choose Correct order before the correction form appears. Pending results still expose the necessary order editor to eligible actors.
- Retain ties, required complete placement, correction reasons, original order, immutable revisions, base-revision conflicts and request IDs. Save returns to the completed summary; a lost response retains the draft and permits an identical retry without another revision.
- Preserve read-only access for members who cannot edit and a clear route back to Pod/current Table. Tournament behavior must remain compatible where shared rendering is touched.

### 6. Recover from invitation failures and sharing outcomes

- An unavailable/revoked/expired invite offers Use another invite and clears the old fragment/retry intent. Retain retry for temporary failures. Make fresh-link guidance understandable before sign-in.
- Share success, user cancellation and clipboard failure finish with neutral/actionable feedback. Keep the selectable link as fallback. Do not leave Working… or turn an ordinary share cancellation into an alarming error.
- Async completion may update only its still-current screen; Close/Back or another route must not receive stale feedback. QR/sign-in help uses the existing generated address; do not claim the earlier unidentified dead link is fixed.

### 7. Make membership actions easy to verify

- Name the selected member in removal confirmation and action labels. Keep controls bound to the correct member ID, including duplicate display names; do not infer/expose additional identity details.
- After role/removal changes, show the refreshed Members view with clear completion feedback. Use existing audit targets where available and preserve Deleted member fallbacks.
- Preserve server-enforced owner/admin/member permissions, owner-appointed succession, last-owner restrictions, removal/rejoin rules, erasure and existing history. Update the old browser helper that assumes ordinary-member takeover to test current owner succession.
- Keep existing leave/delete explanations and typed deletion confirmation. No live deletion, ownership transfer or cleanup is part of implementation/testing.

## UI and implementation constraints

### Approved addition: private Pod activity

The user approved private Pod activity first on November 17. Add a members-only Tables now view backed by exact existing Pod/Table bindings and currently loaded rooms. Show setting up/playing/between games, claimed capacity, seats actually available to join, and proof-matched member aliases with recent connection labels. Guests remain generic. Recent means the server's existing connection TTL (normally90seconds); reads must not renew activity, recover abandoned rooms or persist new presence data. Omit Tables with no recent seat connection. Clearly state that app connectivity is not store attendance, and that absence from this list is not evidence that nobody is there. No venue association, public directory or public player names are authorized. Verify access denial, reused codes, stale connections/reserved seats, restart/reclaim and read-only behavior.

- Retain the current visual language, native modal behavior and Tap anywhere completion screens. Use existing semantic buttons/forms, focus transitions and live status messages. Keep new controls comfortable on phones (48px where practical), fields at least 16px, and no horizontal overflow at 320/390/430px.
- Preserve keyboard navigation, visible focus, screen-reader labels and native validation timing. Do not announce errors on every keystroke or disable valid retries.
- Scope expected source changes to `client/competition-ui.js`, minimal `client/competition.css`/app adapter changes if necessary, and the optional history predicate in `server/src/competition-tables.js`. Cache/import changes happen only when preparing the final candidate. Tests and QA helpers belong beside their existing equivalents.
- Follow existing style, for example: `bind('#podHistory', () => historyScreen('pod', id));`. Avoid a new navigation framework or broad refactor.

## Verification

Use failing behavioral regressions before changing logic. Cover creation/join intent isolation, lifecycle return guards, pending pagination, explicit correction entry and lost-response replay, invitation recovery, late async feedback and membership targeting. Reuse the current server and browser fixtures; mock only provider/platform boundaries.

Commands from the isolated worktree:

```powershell
npm test
node --test --test-reporter=spec server/test/pod-returning-credit.test.js server/test/pod-create-retry.test.js server/test/competition-tables.test.js
$env:QA_BASE_URL='http://127.0.0.1:50966'
npm --prefix qa run test:live
git diff --check
```

The test suite is native Node; there is no separate frontend build step. Browser QA uses the persistent Playwright REPL, `qa/competition-browser-checks.mjs` and disposable loopback REST/account fixtures. Adjust that helper for the changed user-visible controls and current owner policy.

Before signoff, run the full server/client suites without new skips, local room protocol tests, an independent diff review and a complete host/member phone-sized walkthrough. Include negative permission/other-Pod, failed request/retry, cancellation/late response, old pending records and keyboard checks. Inspect screenshots separately from functional assertions. Recheck protected worktree hashes/status and record actual evidence and any unavailable checks.

## Scope exclusions and completion

No rating formula or eligibility-policy change; no automatic confirmation, retroactive credit, duplicate-Pod cleanup, schema migration, native-storage rollout, external messages, new telemetry, public Pod discovery, or production release. Preserve unrelated work and dependency junctions.

This version is ready when the approved local changes meet the acceptance criteria, the verified candidate and handoff are concrete, and any publication decision can be made from that result. Physical phones/Safari/live provider sign-in remain explicit manual checks. A later staging push needs authorization for this new scope; rollback would target current staging `56e65d3` without deleting records.

The earlier Pod fixes remain the baseline. This scope is approved for implementation and testing. The user's store/activity idea is being evaluated separately; it does not authorize public exposure of private Pod membership or attendance.
