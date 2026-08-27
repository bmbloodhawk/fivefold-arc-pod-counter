# Connected Prototype Test Plan

## Release decision

The remote-house alpha is a **GO** only when all P0 automated gates pass on the
deployed URL and the mixed-device field script passes on the actual phones and
network that will be used. A local demo is not a substitute.

## Test invariants

1. A seat token can mutate only that seat's player-owned state.
2. The defending player records commander damage received by their own seat;
   the attacking player cannot write it for them.
3. A seat has at most one owner. A token is scoped to one pod and seat.
4. The server is authoritative. Clients converge to a monotonically versioned
   snapshot. Simultaneous writes serialize: one succeeds and the other receives
   a 409 plus the winning snapshot, with no silent overwrite.
5. Shared mutations are disabled while disconnected. No offline shared edits
   are queued or replayed on reconnection.
6. Reset is a whole-pod privileged action with confirmation. It clears gameplay
   values but preserves player count, labels, starting life, each seat's
   `commanderCount`, and each device's seat association.
7. Each claimed seat owns one commander or a partner pair. Source IDs remain
   stable (`seat-{seatId}-commander-a|b`), sources are ordered by seat then slot,
   and a defender's damage map includes all and only active opposing sources.
8. Changing one commander to partners preserves A and existing unrelated
   damage while adding B at zero. Changing partners to one removes B and its
   damage deterministically without shifting another source's value.
9. Commander tax is tracked by stable commander source ID and owned by that
   commander's seat. A source begins at zero casts with next tax `+0`; each
   recorded cast from the command zone increments its count and makes the next
   additional cost `2 * castCount`.
10. Cast counts are authoritative gameplay state. Commander A and B remain
    independent, exact-version conflicts are never replayed automatically,
    reclaim preserves active counts, 1-to-2 preserves A and starts B at zero,
    2-to-1 deletes B, and reset zeros every retained source.
11. Player names are presentation-only. Seat identity remains `P#`; commander
    identity remains the stable source ID and `ownerSeatId`, including when two
    players choose the same display name or a player renames.
12. Names normalize to NFC with surrounding whitespace removed and internal
    whitespace collapsed. They contain 1–24 Unicode code points and no control
    or format characters. Omitted names fall back to `P#`.
13. Returning to setup is a host/local UI action, not a pod reset or ownership
    transfer. A subsequent shared create uses a fresh transport connection; the
    old connection cannot acquire another seat, and the old room is not mutated.
14. The permanent Commander tax summary is a read-only projection of the same
    active-seat source counts as the tax dialog. It never stores a second value:
    each displayed `+N` equals `2 * commanderCastCounts[sourceId]` from the
    current authoritative/local state.

## Automated black-box matrix

| ID | Priority | Scenario | Pass condition |
|---|---:|---|---|
| NET-01 | P0 | Create 2/4/8-seat pods | Exact seat count; correct 40-life defaults; valid snapshot |
| AUTH-01 | P0 | Player-owned edit | P1 changes P1; P1 attempt on P2 returns 403 and P2 is unchanged |
| AUTH-02 | P0 | Commander damage direction | Defender token accepted; attacker token rejected; map key is attacker commander ID |
| AUTH-03 | P0 | Missing/invalid/cross-pod token | 401/403 and zero state mutation |
| CLAIM-01 | P0 | Two simultaneous P1 claims | Exactly one succeeds; loser cannot mutate P1 |
| SYNC-01 | P0 | P1 and P2 simultaneous life edits | One commits; loser gets 409 and exact authoritative snapshot; user can retry intentionally |
| SYNC-02 | P0 | Repeated stale absolute write | Rejected by version check and never silently replayed |
| SYNC-03 | P0 | Two SSE observers | Both receive a snapshot identical to authoritative GET |
| OFF-01 | P0 | Stale/offline mutation | Server rejects stale revision; state remains unchanged |
| RESET-01 | P0 | Reset altered pod | All counters/warnings/lethal clear; preferences and seat associations remain |
| INT-01 | P0 | Create form in shared mode | Calls the live create-room API and displays its server-issued code, not a generated placeholder |
| INT-02 | P0 | Join form | Inspects/claims selected open seat and renders the returned authoritative snapshot |
| INT-03 | P0 | Counter and reset controls | Call the adapter's mutate/reset methods; no missing-method runtime errors |
| RULE-01 | P0 | Life at 5/0 | Low-life warning at 5; lethal at 0 |
| RULE-02 | P0 | Poison at 8/9/10 | warning at 8–9; lethal at 10; never below zero |
| RULE-03 | P0 | Commander at 18/20/21 | source-specific warning; lethal at 21 from one source only |
| RULE-04 | P0 | Multiple lethal causes | Commander > poison > life priority |
| RULE-05 | P1 | Radiation/energy/generic decrement | Floor is zero; no lethal state |
| CMDR-01 | P0 | One/partner labels and source topology | Single source is `P1`; partners are `P2 A`/`P2 B`; stable IDs and seat/slot order |
| CMDR-02 | P0 | Defender source choices | Damage map contains every active claimed opponent source and excludes every own source |
| CMDR-03 | P0 | Change 1→2 | Existing A/unrelated damage preserved; B added at zero; all clients converge |
| CMDR-04 | P0 | Change 2→1 | B source and B damage removed; A and unrelated damage remain under the same IDs |
| CMDR-05 | P0 | Reclaim and reset | Reclaim/reset preserve each seat's count; reset zeros all retained source damage |
| CMDR-06 | P0 | Simultaneous count/damage writes | Exactly one commits; loser gets 409 plus winner snapshot; deliberate retry converges |
| CMDR-07 | P0 | Invalid/reclaim-mismatch count | Values outside integer 1/2 get 400; mismatched reclaim gets 409; no mutation |
| TAX-01 | P0 | Initial and first cast | Each active source begins at count 0 / next `+0`; first recorded cast becomes count 1 / next `+2` |
| TAX-02 | P0 | Partner independence | Recording A and B separately changes only the selected source and derives each next tax from its own count |
| TAX-03 | P0 | Cast authority | Only the seat that owns a commander source can change its count; another seat gets 400/403 and no mutation |
| TAX-04 | P0 | Invalid source identity | Unknown, foreign, self-invented, inactive B, and legacy/numeric IDs are rejected with no mutation |
| TAX-05 | P0 | Exact-version conflict | Two writes at one base version yield one 200 and one 409 with the winning snapshot; the losing cast is not replayed |
| TAX-06 | P0 | Change 1↔2 | A count survives both directions; B starts at zero when added and is removed, including its count, when collapsed |
| TAX-07 | P0 | Reclaim and reset | Reclaim preserves active source counts; reset returns all active counts to 0 / next `+0` |
| TAX-08 | P0 | SSE convergence | All observers receive the same authoritative cast-count snapshot and derived tax after an accepted cast |
| NAME-01 | P0 | Create/join/rename sync | Normalized `seats[].name` and derived commander labels converge to every SSE observer |
| NAME-02 | P0 | Invalid names | Blank, null/non-text, >24-code-point, control, and format input gets 400 with no reservation or mutation |
| NAME-03 | P0 | Safe printable input | Unicode, punctuation, emoji, and HTML-like text remain inert display text and never execute markup |
| NAME-04 | P0 | Duplicate names | Duplicate display names are allowed; seat IDs, source IDs, ownerSeatId, damage, casts, and mutation authority remain distinct |
| NAME-05 | P0 | Rename identity stability | Labels update to the new name and partner A/B suffixes; stable IDs, ownership, damage, and casts do not move |
| NAME-06 | P0 | Reclaim/reset | Omitted reclaim name preserves the current name; reset preserves every name and derived commander label |
| NAME-07 | P0 | UI fallback and scoping | Blank optional field becomes P#; tiles, detail, inspection, and tax show Name with P# context and never substitute a name for identity |
| NAV-01 | P0 | Direct Commander tax entry | A phone-visible gameplay button opens contextual own/opponent/local tax details without opening the overflow menu; the menu contains no duplicate tax action |
| NAV-02 | P0 | Back to setup authority | Visible and operable only for local games and the shared host; a non-host has no visible, focusable, or invokable action |
| NAV-03 | P0 | Back to setup state cleanup | Open menu/dialog state closes before setup appears; all landing/create controls remain clickable |
| NAV-04 | P0 | New pod after return | Host can create another pod without reload or `CONNECTION_HAS_SEAT`; a fresh connection is used and the old room remains unchanged |
| NAV-05 | P0 | Narrow phone layout | At 320/360/390/430 CSS px and 200% zoom, direct tax and setup controls do not overflow, overlap, or obscure the counter, seat strip, +/- controls, or mode navigation |
| TAX-SUM-01 | P0 | Initial and repeated casts | Permanent summary shows each active source at `+0`; first and second command-zone casts update it to `+2` and `+4` without opening the dialog |
| TAX-SUM-02 | P0 | Partner independence | Partner A/B values are both visible and update independently without label or source-ID swapping |
| TAX-SUM-03 | P0 | Undo/reset/topology | Undo decrements only its source; reset returns retained summaries to `+0`; 1↔2 preserves A, initializes/removes B exactly like authoritative cast counts |
| TAX-SUM-04 | P0 | Context and authority | Local active seat and shared selected seat drive the labels/values; own/local opens editable controls, inspected opponent opens read-only details |
| TAX-SUM-05 | P0 | SSE convergence | Accepted remote casts, Undo, reset, and topology changes update the permanent summary while preserving the selected inspected player |
| TAX-SUM-06 | P0 | Phone entry and readability | The summary box is a single clickable dialog entry, remains readable/in bounds at 320 CSS px, and does not overlap or disable tax, +/-, seat, menu, or mode controls |
| LIMIT-01 | P0 | Invalid 0/9 players or commander count outside 1–2 | 4xx; no pod created or changed |
| LOAD-01 | P1 | 8 seats, 200 concurrent adjustments | No lost accepted operations; p95 acknowledgement under 500 ms |

The included skeleton implements the central P0 flows. RULE boundary and load
cases should be completed once the adapter is aligned with the running API.

## Human usability protocol

Recruit 5 testers unfamiliar with the build and 3 regular Commander players.
Do not coach after handing them the URL. Record screen, time, errors, and one
post-task confidence score (1–5).

| Task | Metric and gate |
|---|---|
| Open link, create four-player pod, claim seats, begin | Median under 60 s; at least 7/8 succeed unaided |
| Repeat with eight seats | At least 6/8 succeed unaided; no wrong-seat claim |
| Change own life by -7 | 8/8 succeed in under 5 s; zero opponent edits |
| Record 6 commander damage from P3 into own seat | 7/8 choose correct source and direction unaided |
| Change P2 from one commander to partners, then back | 7/8 identify A/B correctly; other phones update within 2 s; no damage moves between sources |
| Record casts for P2 A and P2 B | 7/8 use their own commander controls, keep A/B independent, and correctly predict the displayed next tax |
| Identify lethal player in eight-seat view | 8/8 correct in under 3 s; skull is not sole indicator for accessibility |
| Reset next game | 8/8 see confirmation; counters clear; setup remains |
| Simulated disconnect during play | Controls visibly disable within 2 s; status is announced; no apparent success |

Measure setup from initial page load until every participating phone displays
the same pod revision. Do not stop the clock merely when the creator taps
"Start." Record 2-, 4-, and 8-seat results separately.

## Phone readability and accessibility gate

Test at minimum widths 320, 360, 390, and 430 CSS px and browser zoom 200%.

- No horizontal scrolling in gameplay or setup.
- Life total remains visible without scrolling in 2/4/8-seat layouts.
- Interactive targets are at least 44 by 44 CSS px with separation.
- Text contrast is at least 4.5:1; large text at least 3:1.
- Status is never conveyed only by color or skull icon; visible text and an
  accessible name describe warning, elimination cause, and connection state.
- Keyboard focus is visible and follows visual order. Screen reader announces
  counter label, value, owning player, and button effect.
- Rapid updates use a restrained live region and do not flood announcements.
- Portrait and landscape remain usable; safe areas do not cover controls.

### Commander tax UI field checklist

- The field is labelled **Cast from command zone** (or the equally explicit
  **Casts from command zone**), never **commander died**, **deaths**, or wording
  that implies moving zones automatically increases tax.
- The displayed count and derived **Next tax +N** are associated with a named
  commander source; partner commanders A and B have separate fields.
- Only the current seat's commander cast controls are editable. Other players'
  values are visibly read-only.
- The first recorded cast changes count `0` / next tax `+0` to count `1` / next
  tax `+2`.
- Undo/decrement is disabled at zero and cannot make the displayed or submitted
  count negative, including after repeated taps, reconnect, or stale response.
- While offline/reconnecting, record and Undo controls are disabled and no tap
  is queued for later replay.
- Screen-reader names include the commander label, current cast count, next tax,
  and the effect of Record/Undo.

### Player name UI checklist

- Create and Join expose an optional **Your name** field and communicate the
  24-code-point limit consistently with the server.
- Blank input falls back to the claimed seat label (`P1`–`P8`) without sending
  an empty name.
- Player-controlled text is inserted as text, never HTML. Verify an input such
  as `<b>Ada</b>` is shown literally and creates no element or event handler.
- Seat tiles and detail views retain visible or accessible `P#` context so two
  players named `Alex` remain distinguishable.
- Single commanders use the display name; partners use readable deterministic
  `Name A` and `Name B` labels while their source IDs remain unchanged.
- Names do not widen phone layouts, hide life totals, overlap status, or create
  horizontal scrolling at 320 CSS px and 200% zoom.
- Reconnect, incoming SSE snapshots, opponent inspection, and reset preserve the
  same name and do not switch the selected or editable seat.

### Direct tax and setup navigation checklist

- The main game surface has one direct **Commander tax** action. It is visible
  and clickable without opening the `...` menu or horizontally scrolling.
- The overflow menu contains commander setup and authorized reset/setup actions,
  but no second Commander tax item.
- In a shared game, the action starts as the owner's editable tax. Selecting a
  claimed opponent changes it to clearly scoped read-only inspection with no
  Record/Undo controls. Selecting the owner restores editable controls.
- In local/demo play, the action follows the simulated active seat and remains
  editable for that seat's active commander source(s).
- At 320 CSS px, assert bounding rectangles for the direct action, game menu,
  seat strip, +/- controls, and fixed mode navigation remain inside the viewport
  and do not intersect controls that must be tapped.
- **Back to setup** is visible only in local/demo play and to the shared host.
  A non-host must have no visible or keyboard-focusable copy and cannot invoke
  the action through a stale menu state.
- Invoke Back while each modal and the overflow menu are open. Every dialog is
  closed, `aria-expanded` is false, the menu is hidden, and the landing setup is
  immediately interactive.
- From a shared host game, Back stops SSE/reconnect timers and abandons the
  current transport connection without resetting or deleting the old room. A
  subsequent Create starts a fresh connection and succeeds without reload or
  `CONNECTION_HAS_SEAT`; the old room's authoritative snapshot is unchanged.
- After returning and creating/joining again, seat tiles, direct tax, +/-,
  counter modes, connection status, and authorized overflow actions all remain
  clickable with no console error or invisible backdrop.

### Permanent Commander tax summary checklist

- Before opening the tax dialog, the game surface visibly associates each
  active commander label with its derived next tax. Initial is `+0`; one cast is
  `+2`; two casts is `+4`.
- With partners, A and B appear as separate labelled values. Record A once and
  B twice, then Undo B: expect A `+2`, B `+2`; no update may move between IDs.
- The whole summary container is a keyboard- and touch-operable dialog entry,
  with one accessible name that includes the selected player and current values.
  It must not create nested or duplicate interactive targets.
- Local/demo selection follows the simulated active seat. Shared selection
  starts on the owner, follows deliberate opponent inspection, survives SSE,
  and returns to the owner when their tile is selected.
- Opening an own/shared-owner or local summary exposes **Cast from command zone**
  and bounded Undo. Opening an inspected opponent exposes the same values as
  read-only, with no Record/Undo controls.
- After Undo, reset, 1→2, 2→1, reclaim, conflict snapshot, and incoming SSE,
  compare every summary value to `seats[].nextCommanderTax` for the selected
  seat's active source IDs; stale or removed B values must disappear.
- At 320 CSS px, every summary label and `+N` remains visible without horizontal
  scroll or clipping. Its rectangle stays between the +/- controls and fixed
  mode navigation with a non-overlapping gap, and the main controls remain
  clickable before and after closing the dialog.
- Reload through the current service-worker shell and repeat one summary click,
  one cast, one Undo, and one +/- adjustment with zero console errors. This is
  the cache-skew/click regression gate.

Automated accessibility checks are useful triage, not a substitute for VoiceOver
and TalkBack testing on actual devices.

## Remote-house deployment gates

Before travel, verify from a phone with Wi-Fi disabled (cellular only):

1. The public HTTPS URL loads with no certificate warning.
2. A second phone on unrelated Wi-Fi joins via short code/QR without LAN access.
3. The HTTPS event stream reconnects after airplane mode and app background.
4. During disconnection, all shared mutation controls are disabled and no taps
   are replayed after reconnection.
5. Refreshing restores the same claimed seat safely without exposing its token
   in the URL, logs, QR code, or another player's browser.
6. A fresh browser cannot claim an occupied seat or mutate without credentials.
7. All phones converge within 2 seconds after reconnection.
8. The host survives at least one full 3-hour session with 8 connected phones.
9. The deployment has a documented free-tier ceiling, expiry/idle behavior, and
   fallback plan. Any paid upgrade remains owner-approved.

## Mixed-device field script

Use at least one recent iPhone/Safari and one Android/Chrome; add an older/small
phone if available.

1. Create a 4-seat pod on phone A; join P2 on phone B.
2. Make 20 alternating life changes and confirm both displays agree each time.
3. Make simultaneous changes on separate seats ten times; compare snapshots.
4. Take phone B offline. Attempt three changes: controls must refuse locally.
5. Change P1 on phone A, reconnect B, and verify B receives the new snapshot
   without applying its three offline taps.
6. Background B for 10 minutes, resume, and repeat convergence check.
7. Trigger poison and commander warnings, then simultaneous lethal conditions;
   confirm visible and spoken cause priority.
8. Change P2 from one commander to partners. Confirm every phone shows `P2 A`
   and `P2 B`, then record different damage from each into P1.
9. Change P2 back to one commander. Confirm A damage remains, B disappears,
   and damage from every other player is unchanged.
10. With P2 on partners, record one cast for A and two for B. Confirm every phone
    shows A count 1 / next `+2` and B count 2 / next `+4`; Undo B three times and
    confirm it stops at zero rather than becoming negative.
11. Reclaim P2 on a refreshed phone and confirm both active cast counts persist.
    Change P2 to one commander and back to partners: A persists and removed B
    returns at zero.
12. Reset, then confirm commander counts, setup, and seat ownership persist on
    both phones while all commander damage and cast counts return to zero.
13. Create as `Alex`, join as another `Alex`, and confirm both phones retain P1/P2
    context. Rename one seat, reconnect it, then reset; names and stable commander
    ownership must remain correct throughout.
14. Enter a long allowed Unicode name and `<b>Ada</b>`. Confirm safe literal
    rendering, readable partner A/B labels, no horizontal scrolling, and no
    script-generated elements or browser console errors.

## Claims explicitly prohibited before field evidence

Until the mixed-device script is completed at the other house, we cannot claim:

- reliable cross-network connectivity or reconnection;
- iOS Safari and Android Chrome compatibility;
- that mobile background/sleep behavior preserves the session;
- no queued offline writes at the UI layer;
- readable or accessible 8-player play on real screens;
- battery efficiency, low data use, or three-hour-session stability;
- setup under 60 seconds for real players;
- production security, privacy, scalability, or tournament readiness.

Record device model, OS/browser versions, network type, deployment version,
timestamps, failures, and screenshots in the release evidence. A pass without
that evidence is not release-ready.
