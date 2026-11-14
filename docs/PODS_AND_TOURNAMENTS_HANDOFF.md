# Pods and standalone Tournaments: local handoff

Local implementation only. Branch `codex/pods-tournaments`, worktree
`C:/Users/nibay/.codex/worktrees/fivefold-arc-pods-tournaments`, based on fetched
`origin/main` at `b299d8a74ef7dcf14427cd8b138692aa8423fc69`.
No push, deployment, live Firebase change, external service or outbound message.
The old reliability checkout and its unrelated task files were not modified.

The interview replaced Circle + Season with ongoing **Pods**, and added separate
**Tournaments**. A **Table** remains the ordinary shared playing session. There is
no season cutoff, attendance decay, best-N total, bracket or public directory.

## Confirmed existing capabilities and source boundaries

These capabilities were verified from the fetched baseline, then preserved:

| Capability | Current source |
| --- | --- |
| Account-optional shared Table creation, claimed seats and owner-only changes | `server/src/app.js` — `RoomService.createRoom`, `claimSeat`, `adjustOwnSeat`, `mutateOwnSeat` |
| Authoritative snapshots/SSE, reconnect and reclaim | `server/src/app.js` — `snapshot`, `attachStream`, `broadcast`; `client/realtime.js` |
| Rapid life batching/dial interaction | `client/life-adjustment-batcher.js`; `client/app.js` — `adjust` and existing dial controls |
| Verified completion and connection-scoped seat results | `server/src/app.js` — `recordCompletion`, `completedSeat`, `completedGameFacts`, `personalMatchMoment` |
| Private saved games, decks, achievements, placement/win facts and deletion | `server/src/account-history.js` — `ensureAccount`, `saveCompletedGame`, `summary`, `export`, `deleteAccount`; authenticated routes in `server/src/app.js` |
| Existing completion archives and private room recovery | `server/src/playtest-ledger.js`; `server/src/app.js` — `recoveryRecord`, `hydrateRecoveryRecord` |

The baseline had no shared group/membership/attendance/standings/pairing system.
The new modules below implement that layer; existing private history is not imported
or exposed to group members.

## Implemented data model

Records live under a separate environment namespace. Nonproduction uses an explicit
environment prefix; production uses the existing root convention. A separate adapter
and queue keep competition operations apart from normal room recovery/private saves.

| Record | Fields and purpose | Source |
| --- | --- | --- |
| Identity directory | Hashed opaque-account index, removable identity/name aliases, membership index, erasure tombstones, immutable Table-session-to-scope claims | `server/src/competitions.js` |
| Pod | ID/name/creation/version, member records/roles/status, invites, table bindings, completed ledger and derived independent ratings | `server/src/competitions.js` |
| Membership | Opaque participant ID, removable identity link, active/left/removed status, role, removal generation; returning membership preserves numerical history | `server/src/competitions.js` |
| Private invite | Hashed secret, issuer, expiry, revocation and admin-issued generation; raw capability only returned to creator | `server/src/competitions.js` |
| Accepted start | Reserved real game ID, frozen actual starter proofs, eligibility, historical host, durable status/reset intent | `server/src/competition-tables.js` |
| Original completed source | Actual starter seats/proofs, format, original timestamps/outcome/order; identity-free private archive envelope and digest | `server/src/competition-source.js`; `server/src/playtest-ledger.js` |
| Numerical game ledger | Source ID/digest, original outcome, starter participant IDs, eligibility and append-only confirmed order revisions with actor/reason/retry ID | `server/src/competition-tables.js` |
| Derived Pod standings | Rating, played/rated game counts, wins, provisional status; replayed chronologically from effective revisions | `server/src/competition-scoring.js` |
| Tournament | Standalone settings/status, account or guest entrants/roles/attendance, rounds, assignments, ledger and exact points | `server/src/tournaments.js` |
| Round/assignment | Persisted random seed and numeric seating inputs/rule version, reviewed tables, selected hosts, manual start, completion/cancellation, optional clock tied to the actual game | `server/src/tournaments.js`; `server/src/tournament-seating.js` |

A Pod has no required game-night/season entity. Its dated history groups completed
games by the viewer's local date. Tournament rounds are explicit events with multiple
Tables. This follows the later ongoing-rating decision and avoids attendance-only
records becoming penalties.

Original sources and confirmed revisions are retained. A correction appends a revision
and replays the affected Pod's complete chronology. Replayed standings and the revision
commit in the same conditional scope write, avoiding a partially applied publication.
Two identical retries have one effective result; conflicting reuse is rejected.

Only actual accepted starters count. A six-character Table code is not a game ID.
Source capture survives the RoomService three-completion cache, reset/intermission,
an interrupted accepted start and an actual application-process restart. The independent
worker retries known completed IDs; it never invents a completion or an unplayed win.

## Permissions

| Action | Active Pod member | Pod admin | Tournament entrant / guest | Tournament host / signed-in cohost |
| --- | --- | --- | --- | --- |
| View Pod roster/ratings/shared history | Own Pod | Own Pod | No permission from event entry | No permission from event role |
| Invite/host a Pod Table | Yes | Yes | No | No permission from event role |
| Confirm/correct result | Their originally hosted Pod game | Any game in own Pod | Their assigned hosted event game | Any game in own event |
| Rename/remove/appoint admins | No | Yes | No | No permission over a Pod |
| Take admin vacancy | Yes, only with no active admin identity | Same rule | No | No permission over a Pod |
| View own event/points | Requires separate entry | Requires separate entry | Yes, including left/pending access where appropriate | Yes, including when they stop playing |
| Enter/leave play | Separate event opt-in | Separate event opt-in | Guest or account; early points remain | May host without playing |
| Assign/start/cancel unplayed Tables, approve late entry | No event permission | No event permission | No | Yes |

Pod joining requires signed-in explicit acceptance. An admin-removed member needs a
fresh admin invite issued after removal; a voluntary leaver can use an active member's
invite. Being offline does not create an admin vacancy. The original event creator
cannot be demoted by a cohost. Guests receive equal event points but no account awards.

All ACLs are checked server-side. A display name is never account proof. Setup binds
the verified account or event capability to a seat's existing ownership proof. Signed-in
entrants link their own seat; an actual host may attest an event guest's claimed seat.

## Scoring and attendance tradeoffs

Pod ratings start at 1000. Each eligible member is compared with every other eligible
member using pregame ratings. Ahead/tied/behind is 1/0.5/0, with logistic expectation
`1/(1+10^((opponent-player)/400))`; averaged comparisons use K=24. Equal-rated four-player
finishes change by +12, +4, -4, -12. Stronger opponents count more; ties and 2–8 starters
are supported. Guests are omitted from rating comparisons; at least two eligible
members are needed. The first ten rated games show Provisional. No absence penalty,
reset or inactivity decay; return resumes the same record.

These are versioned engineering defaults, not official Commander ratings. Averaging
keeps one eight-player game from having seven times a duel's weight. It also means
deck strength, collusion and selective attendance can affect ratings; this is a private
social record, not a cheat-proof skill measurement. Inactive members retain an old
rating, and provisional ratings are less certain. No artificial attendance reward is
added to address those tradeoffs.

Tournament points use `3*(n-averageRank)/(n-1)`: four players score 3/2/1/0 and tied
players average the occupied positions. Integer units (840 per point) preserve exact
ties across sizes 2–8. All played rounds count; joint final winners are allowed. Late
entrants start at zero and need between-round host approval. Early leavers keep points
and final placing eligibility, but get no later assignments. No-shows generate no
fabricated results. Tournament games do not change any Pod.

## Phone pathways

1. Home keeps **Create a table / Join a table** primary. **My Pods / Tournaments** sit
   beside profile/decks. Casual guests need no account.
2. My Pods → Create → name/own name → clean ranks. Pod menu contains invite, leave,
   admin actions and name editing. Manage invites lists previously issued links so
   their issuer/admin can revoke them after reopening. Any active member can host or invite.
3. An invite link/QR → private name/inviter preview → sign in if needed → explicit
   acceptance. Links work both at launch and when the app is already open. Secrets
   use URL fragments, which are removed after reading. The app displays sharing
   controls; it does not send invitations itself.
4. Pod → Play → ordinary Table setup. Other signed-in members join and link their own
   seat. The same Table stays assigned to that Pod for successive games.
5. Completed Table → Review result → inspect inferred order → fill/correct/tie every
   starter → Confirm. Only then do shared standings change. Signed-in participants
   receive their own standing contribution automatically.
6. Pod → History → date → game → order/rating changes/original/revisions. Corrections
   keep an explicit reason. New members can drill into the same shared history.
7. Pod menu → Leave → confirm. Rating/history remain for a later invited return.
8. Tournaments → Create → fixed rounds/size/seating priority/optional minutes. Host can
   enter as player or only organize. Invite guests/accounts, optionally appoint cohost,
   prepare/review/edit seating, create assigned Tables, then manually start the round.
   The Table lobby has a direct event return so this does not strand the organizer.
9. Event view leads with own assignment and standings, with other Tables and management
   one level deeper. Later seating uses cumulative points and prefers new opponents by
   default; the host can choose standings first. The bounded heuristic is not presented
   as a global optimum. Saved inputs make suggestions replayable.
10. Optional timed round → call time after duration → finish current turn → record five
    additional actual turns total, including extra-turn effects → host confirms surviving
    players tied → review full order. A draw has no invented winner. Untimed is default.

The full-screen hub leaves the current Table connected. Its context button, lobby
return and intermission result button restore the same seat. Modal navigation is
fenced from stale requests; successful guest access survives Close, and an older guest
response cannot override a newer explicit account entry.

## Performance and privacy

`qa/competition-performance.mjs` compares actual method bodies with the fetched baseline:
server adjust/mutate, ledger-event/recovery/snapshot/broadcast/SSE methods, client
adjust/mutate/SSE/reconnect methods, the app adjustment function and whole life batcher.
They are unchanged. Setup alone extends the handshake to [1,2] and may attach account
authorization to seat claim. Timed Tables require protocol 2 on every phone so legacy
clients cannot misread a null winner; ordinary Tables remain protocol 1.

**No new competition read, write or HTTP request occurs because of a life tap**, ordinary
or lethal. Existing room diagnostics/recovery writes still occur. Completion adds compact
identity-free evidence to the existing archive write; acknowledged archives drop their
bulky repair recap. The independent worker may be active at the same wall-clock time,
but is not called by counter mutations. Its discovery cannot delay server listening.

Local eight-seat recovery measurement after four games: about 41.4KB with the flag off,
44.2KB with evidence on (three compact cached receipts). JSON serialization measured
about 0.070ms vs 0.076ms per record on this machine. This measures bytes/CPU, not network
latency or actual phone performance.

Whole-scope confirmation is the deliberate small-group tradeoff. Synthetic two-player
history measured about 1.34MB / 21ms for 1,000 games and 13.38MB / 212ms for 10,000 games
in disposable memory. REST transfer, contention, retries and richer rosters cost more.
Large replay can block the Node event loop briefly. These measurements are not a
production capacity promise. Load-test intended alpha size before release; partitioned
immutable game storage/checkpointed projections are the next scale improvement if
large groups/history require it. There is no history TTL or attendance decay.

Private names/account links live apart from numerical records and are removed on account
deletion. Shared numbers remain as Deleted member; this is pseudonymization. Controlled
reason codes avoid new identifying free text. Source proofs are private and stripped from
public archive/diagnostic DTOs. Group history contains no private decks/notes or outside
games. No location API, public player search or public leaderboard was added.

Privacy erasure remains wired even when the competition flag is off. It closes/removes
shared identities before private account deletion, preventing in-flight work from
recreating names. The flag-off privacy domain has no group routes, worker or setup hook.
Current private export remains private-account export; shared history is viewed within
the authorized group/event. Guest entries are independent of accounts. Existing provider
authentication records are not deleted by saved-data deletion.

## Validation and remaining approval boundary

See `docs/pods-tournaments-evidence.md` for commands, final counts and artifacts, and
`docs/pods-tournaments-qa-inventory.md` for the browser inventory. Backend tests cover
ACLs/invites/reclaim, corrections/replay/erasure, actual process restart, concurrent ETag
conflicts, multi-table rounds, attendance, exact points/seating/timing and failure isolation.
Separate phone-sized Chrome contexts exercise Pod and four-player tournament completion.
They are not physical iPhone/Android or live Firebase evidence.

Engineering defaults chosen locally: 7-day invites; 128 entrants, 20 rounds; K=24/scale400;
15-second recovery; controlled correction reasons; explicit host cancellation of an
unplayed Table. These are documented choices within the approved design. Owner review
is still appropriate before release; none implies permission to publish or enable it.

Before staging, obtain approval for the concrete local commit and exact environment.
Use disposable test accounts/data under that environment only; verify Firebase REST
conditional writes, server-only database access/rules, environment prefixes and source
retention. Verify served asset bytes against the chosen commit: HTML loads app v293,
app loads realtime v88 and competition UI v1, and the worker cache marker is v355.
Check delayed `/health` after restart and actual worker activation on a safe phone;
downloaded assets or a healthy endpoint do not prove an active phone update.
Then run the physical-phone script below. Production needs separate approval
after that evidence. Do not infer provider/rule correctness from local fixture success.

Physical-phone script: iPhone/Safari + Android/Chrome, join the same private Pod with
separate accounts, create/join/start a Table, rapid +/- and commander damage on each,
background/lock/rejoin one phone, complete/review full order, verify both standings once,
repeat through intermission, then run a timed guest event and verify no Pod change.
Record OS/browser/build IDs, failures and both screens. Keep physical counters available.

Rollback preparation: choose a quiet window and finish/drain active timed Tables before
disabling the feature or reverting protocol-2 support. Preserve all shared ledgers and
identity-erasure support; do not delete data or reset ratings. Flag-off hides routes/UI
but does not undo results, and future ordinary games are no longer group tracked.
Do not downgrade an active timed Table to a client that cannot display a draw.

No external release action is part of this completed local task.
