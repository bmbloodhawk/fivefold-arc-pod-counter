# Pods and standalone Tournaments

Status: approved product decisions consolidated for local implementation, 2026-11-11.
Baseline: origin/main `b299d8a74ef7dcf14427cd8b138692aa8423fc69`.
Branch: `codex/pods-tournaments`. No release or live-data changes are authorized.

## Purpose and vocabulary

A **Pod** is a private recurring group with persistent, independent member ratings.
A **Table** is the shared playing session, which may host successive games.
A **Tournament** is a standalone event with its own attendance, tables and points.
Tournament results never enter Pod standings. Circle, seasons and best-N scoring
were superseded during the product interview. No brackets, public directories,
public leaderboards, location collection, or mandatory accounts for casual play.

## Hard boundaries

- Work only in the new worktree. Preserve every other checkout and unrelated task.
- Local code, disposable storage/emulators, browsers and git checkpoints are authorized.
- No deployment, push/publication, live Firebase mutation/configuration, new external
  service, spending, or external messaging without separate approval.
- Preserve the dial, life batcher, existing adjust/mutate methods and SSE transport.
  There must be **zero new competition storage/network operations per life change**.
  Normal diagnostics/recovery already write; do not describe those as absent.
- Competition work occurs at setup, completed-game capture, explicit confirmation,
  correction and group/event administration. Never add group fields to a room object
  that is spread into every recovery record or expose membership through snapshots.
- Failure of competition storage must not delay adjustments or private profile saves.
- Actual physical phones and live Firebase are later release gates, not local claims.

## Approved Pod rules

P01. One account can create/join multiple Pods; memberships and ratings are independent.
Tables launched from a Pod count for that Pod only. Ordinary tables remain casual;
there is no redundant Rated/Casual selector inside a Pod.

P02. Membership requires explicit acceptance and sign-in. Any active member may
create a private invite and host a Table. Invitation preview shows Pod and inviter,
not the private roster/history. Sharing is through a copied link or QR; the app
does not send unsolicited messages or offer a player search directory.

P03. The creator may appoint admins, optionally. Admins manage settings, membership,
invitations and Pod-wide result corrections. A normal host corrects their own hosted
games. Admin-removed members require an admin's invite to return; voluntary leavers
can use any active member's invite. Redemption is safe to retry and rechecks current
issuer/redeemer permissions, expiry and revocation on the server.

P04. If the last admin leaves/deletes their account, a remaining active member may
volunteer as admin. The change is recorded and visible. Being offline is not leaving.
Competing takeover requests must not create inconsistent roles.

P05. Each new member starts at 1000 and is marked Provisional for the first ten rated
games. Rating changes begin with game one. No inactivity decay or periodic reset.
Returning members resume the prior rating, game count and provisional progress.
Leaving ends group access but preserves historical results. A game already started
while eligible still counts when it completes; leaving cannot erase an ongoing game.

P06. Full finishing order matters. For the first engineering version, use normalized
pairwise Elo-style placement updates: compare each eligible Pod member with the
other eligible members using pre-game ratings, then average comparisons into one
game's change. Finishing ahead scores 1, tied scores 0.5, behind scores 0. Expected
score uses `1/(1+10^((opponentRating-playerRating)/400))`. Initial responsiveness is
24, versioned `elo-placement-v1`; this is an engineering tuning choice, not a claim
that chess's official table is used or that player skill is separated from deck power.
Simulate and document bounded changes, symmetry, zero-sum behavior and replay.

P07. Guests are clearly labeled. Guest attendance and placement contribute to the
actual table roster, but only eligible Pod members enter rating comparisons, requiring
at least two. Attested guest records never grant personal-account awards. Preserve
the existing independently verified personal-save path; group confirmation is not a
way for a host to write another person's private profile.

P08. All active members, including newcomers, can view completed Pod-game history:
date, participants, confirmed order and rating changes. Other Pods, private account
history and deck notes are not shared. History lasts for the life of the Pod.

P09. Account-data deletion removes names and account links from shared records and
displays Deleted member, while retaining numerical outcomes/ratings for other
members' history. Keep personal identity maps separate from immutable numerical
results. This is pseudonymization, not a promise of anonymity or automatic restoration
after erasure. Leaving and deleting personal data are distinct operations.

## Completion integrity

C01. A completed source game's identity is the RoomService gameId, not a six-character
room code, current seat occupant, or the separately generated profile gameId.
Freeze actual starter seat IDs, owner proofs, format, timestamps and original outcome.
Never count configured-but-empty seats, no-shows or an incomplete reset as games.

C02. The app prefills its inferred order. The host must confirm/correct a complete
order covering each original starter exactly once; explicit ordered tie groups are
supported. Missing order stays pending. A declared winner may lack placement data.
The existing automatic-elimination list can retain a corrected elimination, so its
order is a prefill, not unquestionable evidence.

C03. Distinguish server-verified completion/seat ownership from host-attested order.
Keep original evidence and every confirmed revision. Corrections require a reason,
authorized actor and base revision. Changes update competition results and replay
affected ratings; they must not rewrite the original source or grant account awards.
Eligibility, game identity, starter roster and actual table size cannot be invented
through an order correction. One account cannot occupy two rated entries in one game.

C04. Confirmed contributions are immutable append-only records; duplicate completion,
lost response, retry or concurrent confirmation produces one effective game. Conflicting
payload reuse returns a conflict. A table cannot be counted in multiple competitions.
Use explicit durable pending projection work so a crash between publication and cache
update is recoverable. Standings are derived and rebuildable, not increment-only truth.

C05. RoomService retains only three frozen completions. Capture a durable competition
receipt promptly, outside the live mutation request, including the whole original
roster. Do not depend on a future browser remembering to save or on the three-game
cache after several more games. Only acknowledge durable confirmation after storage
accepts it. Unconfirmed capture failures must remain visible/retryable; never fabricate.

C06. Setup links an authenticated member or event participant to a proven seat and
an immutable room identity. Names do not identify accounts. Reclaim changes connections,
not participant identity. A replacement seat owner cannot claim the old player's result.
Former members must not regain roster/history access just because a started game can
still finish. Erasure fences pending work from recreating identifying mappings.

## Approved standalone Tournament rules

T01. Separate participants, roles, ledger, standings and seating. No Pod membership
requirement and no Pod updates, even when the same people belong to a Pod.
Guests can type their name or be added by the host; equal event points and placings.
Distinguish guest records and name provenance; table hosts still attest the result.

T02. Before start, host chooses total rounds and preferred table size (default four,
supported actual sizes two through eight). Balance attendance sensibly and expose
suggested assignments for host review; never seat someone twice in one round.
Host/co-host can adjust assignments before play, not move a playing Table silently.

T03. First round is random. Later rounds use combined event standings with a setting
chosen at setup. **New opponents first** is default: prioritize avoiding repeat
opponents, then similar standings. **Standings first** reverses that priority.
Unavoidable rematches favor fewer previous meetings. Use deterministic saved seeds
and inputs for retries/replay; do not claim a heuristic is a mathematical global optimum.

T04. Host manually starts each round after all table results are confirmed. Attendance
can change between rounds. Late admission requires host approval and starts with zero
points. Early departures keep earned points and final placing eligibility, are labeled
Left early, and receive no future table assignment. Do not invent forfeits or extra games.

T05. A signed-in co-host is optional and may manage entries, assignments and starts.
No co-host is required. These are event permissions, not Pod administration.

T06. Points are `3*(n-r)/(n-1)`. For tied groups use the mean occupied rank. Retain
exact internal precision (a common integer unit supports all sizes through eight).
Four players: 3/2/1/0; three: 3/1.5/0. Equal final totals share rank, including winners.
All played rounds count; no best-N selection. Guests are eligible for points/placings.

T07. Timed rounds are optional; untimed is default. At time, finish the active turn,
then play FIVE additional turns in total following actual turn order. Extra-turn
effects consume the same five. If no winner, survivors share the remaining top-place
points and eliminated players keep their places. Host confirms the timed draw.
No auto-points solely because a countdown reaches zero and no highest-life shortcut.
The adopted turn procedure and custom placement scoring are disclosed before entry.

T08. Extending an explicit game-completion endpoint/presentation to record a timed
draw is allowed; changing the live adjustment methods or SSE transport is not.
The app can expose an explicit final-turn counter for the host; it must count real
turns, including extra turns, not merely infer them from seat wraparounds or round
numbers. It performs no tracking during a life tap. Test disabled normal turn tracking.

## Phone-first interaction contract

U01. Home's existing Create/Join a pod labels become Create/Join a table, consistently
for casual play, sharing and recovery copy. Keep internal room/reclaim identifiers
stable. Add My Pods/Tournaments secondary actions by My profile/My decks.

U02. My Pods shows memberships plus create/invite-join. Selected Pod home is clean:
ranked member name/rating, Play and History. Management/invite actions live in a menu.
History -> dates -> games on that date -> order/rating changes and correction details.
Use existing surface/color/type tokens, native controls, keyboard/focus support,
44px-class touch targets, meaningful loading/empty/error/permission states.

U03. Tournament entry supports create, private code/link/QR join and resume own events.
Participant view leads with own table and standings. Only authorized hosts see controls.
Guest join does not require an account; administrative creation/co-hosting does.

U04. A context return is in the Table menu. Opening/closing the hub must preserve the
active transport and seat. Incoming snapshots must not steal navigation or dismiss
the hub. A full-screen accessible in-app dialog can cover the existing Table view
without modifying its SSE navigation consumer. Test sign-in and deep-invite return.

U05. Date grouping uses the viewer's local calendar from UTC timestamps; do not collect
location/time zone to implement it. Fetch older summaries progressively and fetch game
details only after drilling in. A new member does not auto-import private old games.

## Candidate architecture and source anchors

- New competition domain/store/router modules, separate from RoomService and profile
  awards. Reuse server-only REST conditional updates with explicit environment prefix.
  Use a dedicated queue/store instance so competition work cannot backlog recovery.
- Keep bounded control/projection state separate from per-game source receipts and
  numerical ledger packets. Atomically reserve publication/idempotency intent; persist
  pending work with confirmation; only acknowledge successful cache application safely.
- The existing once-per-completion archive PUT carries a private identity-free source
  receipt when competitions are enabled. It is first-write-wins with a storage-stable
  digest. The existing completion recovery write retains that exact receipt and recap
  for repair. No extra storage call is added to any counter mutation, including lethal
  changes. Archive/diagnostic DTOs strip the private receipt.
- A durable accepted-start command reserves the real game ID and fixes eligibility,
  owner proofs and historical host at that boundary. RoomService applies that same ID;
  an interrupted command is retried without inventing a completed game. A separate
  15-second recovery worker reconciles known IDs. Every setup progression route captures
  an existing completion before allowing cache eviction. Reset uses a durable intent
  and applied-reset acknowledgement; failed reset validation never abandons a game.
- One conditional scope write commits immutable numeric revisions and their replayed
  projection together. This replaces the candidate multi-record outbox. It deliberately
  reads/writes the scope history on confirmation/correction; measure its alpha scale
  before any release. Phone DTOs page summaries and load details on demand.
- A separate atomic directory is the sole owner of account mappings, names, scope
  indexes and immutable Table-session claims. Erasure closes the account generation
  before deleting mappings/names; pending numeric work cannot recreate them. Missing
  identities do not authorize actions or prevent admin succession. Correction reasons
  are controlled codes, not identifying free text.
  An erasure-only domain remains available when the optional feature is disabled,
  so a rollback cannot strand identifying aliases after private account deletion.
- Firebase omits empty/null children and can return numeric-key collections as arrays.
  Normalize schemas on reads and every conditional callback; source hashes ignore
  storage-equivalent null/absent fields. Local RTDB-shaped round-trip tests are required.
- Add readonly source access and explicit timed-draw completion only where needed.
  Preserve original proof and owner checks in `server/src/app.js:739,823` and private
  account claim rules in `server/src/account-history.js:358`.
- UI is additive in its own client modules/styles with small setup/postgame hooks.
  The batcher and server/client adjustment and SSE bodies stay unchanged. The
  transport's setup handshake advertises protocols 1 and 2, and an explicit seat
  claim may carry an optional account token. Only timed-event Tables use protocol 2
  so older phones cannot invent a winner from a draw's null winner seat.
- Existing `tasks/plan.md` and `tasks/todo.md` belong to other work; preserve them.

Architecture candidates require adversarial review and tests before standing. A clear
failure must be fixed, not explained away. This specification is the contract.

Implementation choices within the approved scope: events support up to 128 entrants
and 20 rounds; actual Tables still support 2–8 players. A host may explicitly cancel
an unplayed no-show Table with no points, but a started Table needs a real completion.
Hosts can issue/rotate a guest-only event access link for a host-recorded guest. It
never grants an account, Pod membership, private awards, or event administration.

## Evidence and completion gates

Use Node 24 and existing Node test conventions. Server has its own lockfile; install
with lifecycle scripts disabled. New pure logic tests run without external services.
Run focused RED/GREEN cases, broader integration and then the complete existing suite.

Required evidence: tenant ACL/guest isolation; invite expiry/revocation/readmission and
reclaim; unique seat/account proof; duplicate/conflicting/concurrent publication; actual
restart recovery; correction replay and privacy erasure fencing; multi-table events;
variable sizes/attendance, no-shows, late/early guests; both seating priorities;
timed draws and five actual turns; integer point ties; source-cache eviction survival;
zero new competition I/O in adjustment paths including a lethal adjustment;
competition storage failure isolation; unchanged casual/private-save behavior.

Verify two independent phone-sized browser sessions, 320px layout and wider layouts,
join/reclaim/background/navigation/completion flow, keyboard use, console/network
errors. Document actual physical two-phone and live Firebase checks as unperformed
release gates with a runnable script. Review full diff and keep local checkpoints.
Deliver source/tests, evidence, limitations, release preparation and rollback handoff.
Do not mark the goal complete until each requirement is demonstrably satisfied locally.
