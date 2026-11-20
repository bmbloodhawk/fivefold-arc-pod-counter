# Pod experience and private activity — local candidate

Implemented following the user's scope approval and explicit choice of **Private Pod activity first**. Production and staging are unchanged. This candidate starts from staging `56e65d3` and is ready for a staging publication decision.

## Resulting flow

- Pod home exposes Invite members and Tables now. Invitation copy distinguishes Pod membership from a Table code; unsigned preview and entered-name preservation still work.
- Play offers Create Table or Join Table by code. Seated hosts/members return to their current Table in lobby, play and intermission. An eligible host can still explicitly link an existing unlinked Table, preserving its code and seats.
- Outward navigation waits for the native dialog close event. A canceled creation intent is cleared by direct-code and Home Join routes; it cannot leak into a subsequently joined Table. A late reuse completion respects newer navigation.
- Pre-start context explains proof-linked members versus guests and the credit deadline. Existing sealed-game eligibility and returning-member credit remain unchanged.
- Awaiting results opens a direct pending list. `status=pending` filters on the server before pagination; older pending records cannot disappear behind newer confirmed games. Changed history/pending cursors have explicit restart actions; Back retains the selected history day and loaded date list.
- Confirmed results show a saved summary and rating changes. Original hosts/admins explicitly choose Correct order; full order, reasons, revision conflicts, immutable originals and identical lost-response retries remain intact. Shared tournament result permissions were checked too.
- Invalid invitations offer Use another invite. Sharing success/cancel/failure and clipboard denial finish cleanly, and late results cannot overwrite another screen. Member actions name their target, retain the refreshed Members view and show completion feedback; owner succession and history remain unchanged.

## Private Tables now

Signed `GET /api/competitions/pod/:id/activity` is available only to active Pod members. It intersects exact durable Pod/Table bindings with currently loaded server rooms and fresh claimed-seat connections. Response fields are `asOf`, `presenceWindowMs` and Tables with code, lifecycle, claimed/capacity/available seat counts, recent connection counts and member names/freshness. Proof-linked member aliases are used; unlinked guests are simply Guest. No credentials, account IDs, owner hashes, counters or commander details are returned.

The page shows setting up, playing and between-game states. New members join available lobby/intermission seats through the normal seat flow; seated users receive a Return guard. Playing Tables explain that new players can join between games.

Presence uses the existing connection TTL, normally90seconds. Refresh is explicit and the checked time is shown. Reads do not renew room/connection activity, revive recovery records or persist presence. Tables without recent seat connections are omitted. The list is server-local: after restart, rooms appear as phones reconnect. This is recent app connectivity, **not physical attendance**, a store check-in or a public venue directory. Public store pages, locations and public player names are outside this candidate.

## Verification

- Full server suite: **684 passed**, zero failed/skipped. Full/final client suite: **408 passed**, zero failed/skipped. Local room protocol: **64 passed**. Dependency audit: zero known vulnerabilities. Syntax/whitespace checks passed.
- Seventeen new server regressions cover pending filtering before pagination/date bounds and private activity authorization, exact binding despite reused codes, freshness/TTL/reserved seats, current proof/erasure, restart/reclaim and read-only behavior. Their initial RED runs failed before implementation.
- Independent browser regressions first reproduced the missing direct-invite action. Further failing checks caught the missing existing-Table reuse option and the Home Join bypass of intent clearing; both now pass.
- Real local handlers and loopback conditional REST storage with a simulated account provider covered unsigned invitation/sign-in, Create/Join/Return, linked member/guest credit, ordinary and lethal completion, reload recovery, successive records, pending confirmation, correction retry, removal/readmission, appointed owner succession, invalid invites, share/copy outcomes and late responses.
- Activity checks covered open/playing Tables, Refresh, joining from the list as an unseated member, seated-player guarding, generic guest names and 320/390/430px layouts. Native Escape preserved the current seat. A history-response fault supplied a bad cursor; the next real server request rejected it and the UI restarted successfully.
- Shared tournament browser checks covered registration, account/self-named/attested guests, Table setup, saved confirmation, explicit correction and a guest's read-only result. No unhandled page errors occurred in completed walkthroughs.
- Independent final diff review found no remaining blocking issue. Original workspace and integration worktree's659 baseline tracked files retained their hashes/HEADs/status; the prior fixes worktree remains clean at56e65d3.

These are automated tests and phone-sized Chrome, not physical-phone, Safari, screen-reader or real Firebase-provider certification. The server's process-kill/recovery tests take several minutes. QA helpers were updated to expect automatic saved-seat recovery, the fifteen-second elimination undo interval and current owner succession, and to select duplicate-named Pods by ID where needed. A shared-browser request counter was isolated from unrelated test pages before asserting zero gameplay competition traffic.

## Source and evidence

Implementation commits: `cc3b620` (private activity/pending endpoint behavior) and `7e59d38` (Pod UI, cache and browser regressions). This document's commit is the candidate tip. App314, competition UI6/CSS2, worker cache379; shared Table protocol and rating rules are unchanged.

Worktree: `C:\Users\nibay\.codex\worktrees\fivefold-arc-pod-experience-20261117`, branch `codex/pod-experience-20261117`. Approved spec: `SPEC-pod-experience.md`; checklist: `tasks/pod-experience/todo.md`.

Evidence: `C:\Users\nibay\.codex\visualizations\2026\11\17\01a1e853-7d23-7990-b202-57da465a684f\pod-experience\implementation`. See full-suite.log, client-final.log, protocol-local.log, audit.json, browser-final.json, browser-broad.json, browser-tournament.json, screenshots and preservation-final.json. Backend focused logs also reside in the parent pod-experience directory. The disposable loopback server entry is local-server.mjs in the evidence folder; no live credentials are read by it.

## Publication decision

Only after authorization: fast-forward staging to this candidate, verify served bundle hashes/marker and health after Render updates, then run the64 deployed protocol checks with fresh synthetic Tables. Signed-in Pod/provider and physical-phone checks remain manual staging checks. Risk is changed navigation/activity behavior; current staging `56e65d3` is the code rollback target after test games are safely finished. Receipt/history data is not deleted or rolled back. Do not push main, alter production services, migrate storage, enable native creation, or clean up records.

Modern Web Guidance applied: native modal/close behavior and dialog/backdrop scroll containment; native labeled forms,48px controls,16px minimum inputs and polite result feedback. No new dependency, custom focus trap or root-page scroll lock was added.
