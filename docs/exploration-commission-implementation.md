# Exploration Commission — local implementation

Implemented from clean owning release worktree
`C:/Users/nibay/.codex/worktrees/appearance-release-all-20261126`, branch
`codex/release-studio-and-skins-20261126`, commit
`184262bdcfbac0cf2113283078c1d2bfc108c538`.
Work is isolated in `C:/Users/nibay/.codex/worktrees/exploration-commission-local-20261127`
on `codex/exploration-commission-local-20261127`. The main project has unrelated
changes and was not edited.

## Exact mission rules

There is one new rare achievement, `exploration-commission`, titled
**Exploration Commission**, with description “Complete Command Rotation, Survey
Record, and Return Voyages.” Its three objectives are mission progress, not
additional general achievements:

1. **Command Rotation, 0/2:** two distinct eligible canonical card identities
   represented in separate completed games with different canonical starting
   lineups. A single game, even with two eligible partners, fills at most one
   slot. Full lineups are deduplicated without regard to order. Replaying or
   reversing a pair, changing a printing, or using another exact alias of the
   same card does not create a new lineup. Different actual cards depicting the
   same character are distinct identities.
2. **Survey Record, 0/25:** sum only the frozen personal
   `achievementFacts.turnCount` from qualifying games. Missing facts add zero.
   Table turns, rounds, elapsed time, and interaction counts supply no turns.
   Existing turn recording and undo logic is unchanged.
3. **Return Voyages, 0/3:** three distinct play dates, not necessarily
   consecutive, derived from trusted server completion instants in the track's
   captured IANA timezone. The player explicitly begins the mission; the server
   validates and canonicalizes that named zone and retains it. Fixed offsets,
   ambiguous abbreviations, and invalid names are rejected. Each credited
   date is stored once, so delayed saves, future device timezone changes, and
   future timezone database changes do not re-date earlier credit.

All three objectives must be complete. One game can advance all three. Wins,
losses, and completed draws are equal. The three-date objective deliberately
prevents completion on fewer than three play dates. Displayed counters cap at
2, 25, and 3.

Only authenticated saves of the room service's verified, completed **standard
Commander** games qualify. A participating seat's existing ownership proof
protects the result. Practice/development runs, local simulations, abandoned
games, casual/custom formats, and manual history cannot supply mission credit.
The save API still accepts only room/game/deck references, never client-authored
commander evidence, turn facts, or timestamps. This reuses the application's
existing verified-game model; it does not add deck-list legality validation or
claim to verify a physical card printing.

## Canonical starting evidence and eligibility

At game start, the server freezes each starting seat's entire commander lineup,
list version, and exact matched name. Reviewed Trek identities use Scryfall
Oracle IDs. Other recognized lineup members use their exact canonical name
from the existing bundled MTGJSON index, with its source digest retained.
Unknown or ambiguous names fail closed for this reward. The snapshot is copied
into the trusted frozen completion and survives durable recovery; rematches
capture a fresh snapshot. Existing commander editing continues to work and
cannot change the mission's frozen starting lineup.

Version `star-trek-commanders-v1-2026-11-27` reviews **228 canonical identities,
229 exact eligible names, and 423 English paper printings**:

- 197 native TRK/TRC identities;
- 23 explicitly named SDS Trek reskins;
- eight explicitly named Secret Lair Trek reskins.

Native reprints share a canonical identity. Reskins require their reviewed Trek
display name in the starting evidence: Tendi can qualify, generic Thrasios
cannot establish Trek eligibility, and both still resolve to the same identity
for lineup deduplication. Loran is excluded despite appearing in TRC. There is
no loose name matching or runtime product-membership filter. The exact reviewed
scope, publisher sources, API queries and hashes, alias rules, exclusions, and
one publisher naming discrepancy are documented in
[the eligibility review](star-trek-commander-eligibility.md).

## Persistence, existing awards, and historical limits

Enrollment has its own immutable, conditional-update record. It neither dates
nor initializes existing achievement evidence and cannot be erased by a stale
account preference write. Mission credit and the new award commit atomically
with the verified game. Canonical source-game keys deduplicate reconnects,
retries, and concurrent saves. Existing removed-game tombstones prevent replay.
Account erasure closes enrollment and removes its timezone, preventing an
in-flight begin from recreating it.

The new award is appended after both existing award selectors. It never enters
their one-award selection pools. The Studio achievement catalog appends it after
the original catalog, retaining the original entries' relative order.
Achievements can therefore continue to earn normally on the same game.

Mission credits and completion evidence persist separately from visible history.
The award records its rule/list version, retained timezone, and objective totals;
the existing Studio mechanism records permanent skin receipts. Removing game
history does not revoke this earned achievement or an awarded skin.

**No automatic historical backfill is performed.** Games must have started on
or after successful mission enrollment and have a trusted starting snapshot.
Previously saved games, pre-enrollment games, old recovery records lacking
that snapshot, final commander names, and editable deck records supply no
retroactive eligibility. Localized names beyond the explicitly reviewed names
require another reviewed list version.

## Reward connection and pause boundary

Exploration Commission is selectable through the Studio's existing achievement
catalog. A future reviewed reward can use:

```json
{"allOf":["exploration-commission"]}
```

The real planned starship-interface skin remains paused. No real skin was
finished, published, activated, or assigned a new reward. Existing defaults,
drafts, assets, reward rules, and owners were not modified.

`node qa/exploration-commission-local.mjs` runs a disposable loopback,
in-memory, metadata-only reward preset through the actual completion/save and
Studio entitlement paths. Its win/loss/draw sequence produces:

| Completed result | Commander variety | Personal turns | Dates | Test reward |
| --- | --- | --- | --- | --- |
| Win | 1/2 | 9/25 | 1/3 | Locked |
| Loss | 2/2 | 18/25 | 2/3 | Locked |
| Draw | 2/2 | 25/25 | 3/3 | Earned |

It then removes all three saved games and asserts that test reward ownership
remains. The preset has no real skin art or external service connection.

The browser fixture separately selects the achievement in the actual Studio
editor and exercises its existing reward preview. That fixture draft is never
saved; the in-memory catalog remains identical to its original value.

## Verification

Focused coverage includes all 229 eligible names, rejection of all 31 generic
reskin names, Loran and loose guesses, reprints/Unicode/ASCII aliases, actual
Tendi/Rutherford partners, reversed and repeated pairs, alias eligibility shifts
within one pair, duplicate/concurrent saves, midgame edits, persisted recovery,
rematches, personal turns and undo, UTC instants around midnight and both DST
transitions, delayed saves, retained timezone, all objectives, permanent rewards,
authentication, client evidence rejection, stale account writes, and erasure races.

An 80-game paired fixture compares mission enrollment against the existing
pipeline: existing award order, earned evidence, profile achievements, and skin
grants are identical. A fixed SHA-256 fixture verifies all **178 original Studio
achievement definitions and their order**, including IDs, names, descriptions,
rarities, and tier definitions. Existing reward/achievement tests remain intact.

The actual client app and Studio renderer passed **Chromium and WebKit** at
**320×700 and 393×852**: zero/partial/earned mission states, keyboard Begin,
48-pixel Begin target, labelled native progress bars, retained timezone text,
no mission-panel horizontal overflow, and no page exceptions. These are
**browser emulation results; no physical-phone testing was performed**.
A second actual browser context in `Pacific/Auckland` retained the begun
mission's `America/Los_Angeles` zone and unchanged progress at both sizes in
both engines.

Browser reports and screenshots are in
`C:/Users/nibay/.codex/tmp/exploration-commission-qa/{chromium,webkit}/`.
Reproduce with `PLAYWRIGHT_TOOLING` pointing at a package manifest whose
dependencies include `playwright-core`, then run
`node qa/exploration-commission.browser.mjs`; set `STUDIO_BROWSER=webkit` for
WebKit. No new dependency or lockfile change was needed.

The first broad client run exposed six VM harness failures: the extracted
profile function needed the newly imported mission renderer and minimal DOM
creation/append support. The harness now uses the actual renderer dependency;
all existing assertions are retained and an additional mission-placement
assertion is included. The client suite then passed 1002/1002.

Final `npm test`: **897/897 server tests and 1002/1002 client tests passed**
(1899 total; zero failures or skips). The 31 focused server mission/evidence
checks also passed together. The local run log is
`output-exploration-final-tests.log`. There is no separate build, lint, or type
check script configured in this repository. `git diff --check` passed.
An independent review covered input/authentication boundaries, atomic credit,
legacy award preservation, lineup deduplication, permanent ownership, stale
writes, and deletion races; its identified issues were fixed and regression
tests added.

Modern Web Guidance `progress` supplied “Use a native <progress> element” and
`forms` supplied “disable the button after a valid submission is clicked to
prevent double-posts.” The result uses semantic labels, browser-native progress
fallback, and duplicate submission prevention.

## Changed files

| Files | Change |
| --- | --- |
| `server/src/exploration-commission.js` | Definition, timezone validation, credit reducer, objective view |
| `server/src/starting-commander-evidence.js` | Exact canonical starting-lineup resolver |
| `server/src/account-history.js` | Enrollment, atomic credit/award, profile view, Studio selector, erasure |
| `server/src/app.js` | Starting snapshot, frozen completion copy, authenticated begin route |
| `server/static-data/star-trek-commanders.v1.json` | Fixed reviewed eligibility/provenance data |
| `server/test/exploration-commission.test.js` | Mission/date/permanence/existing-award comparison |
| `server/test/exploration-commission-http.test.js` | API trust boundary and real reward preset |
| `server/test/exploration-enrollment-races.test.js` | Enrollment/account-write/erasure races |
| `server/test/star-trek-eligibility.test.js` | Full eligibility scope and alias/partner qualification |
| `server/test/starting-commander-evidence.test.js` | Freeze/edit/recovery/rematch/turn-undo evidence |
| `client/exploration-commission.js` | Mission rendering and begin action |
| `client/exploration-commission.test.mjs` | Progress, API, retry and escaping checks |
| `client/app.js` | Mount mission inside existing Achievements panel |
| `client/styles.css` | Mission-only responsive styling |
| `client/index.html`, `client/sw.js` | Shell/module cache version wiring |
| `client/profile-opening.test.mjs` | Harness dependency/DOM support and mission-placement assertion |
| `qa/exploration-commission-local.mjs` | Disposable real-server reward preset |
| `qa/exploration-commission.browser.mjs` | Actual renderer/Studio viewport fixture |
| `docs/star-trek-commander-eligibility.md` | Reviewed list scope and authoritative sources |
| `docs/exploration-commission-implementation.md` | Rules, implementation, verification, and limits |

All work is local. No push, deployment, live catalog update, live service
change, purchase, or external message was performed.
