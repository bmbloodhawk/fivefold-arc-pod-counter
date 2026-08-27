# Fivefold Arc realtime server

This is a dependency-free Node.js backend for the phone prototype. It keeps active rooms in memory, uses server-authoritative versions, and pushes complete state snapshots with Server-Sent Events (SSE). It has no accounts, chat, or analytics. When the three Firebase server environment variables are present, it additionally writes compact, private playtest notes and game recaps to Realtime Database.

## Run locally

Requires Node.js 20 or newer.

```text
cd server
npm test
npm start
```

The default address is `http://localhost:8787`. The runnable server also serves the sibling `client/` directory, so opening that address launches the phone app and keeps the API same-origin. Set `PORT` to choose another port and `ALLOWED_ORIGIN` to restrict browser access to the deployed web client's origin. The default `*` is convenient for local testing; production should set the exact HTTPS origin.

This process is not itself a public deployment. A web host must run it behind HTTPS and must support long-lived SSE connections. Hosting or creating an account may create cost or terms commitments and therefore requires owner approval.

## Authority model

- Rooms contain 2–8 fixed seats and use opaque six-character codes without ambiguous `0/O/1/I` characters.
- Starting life is exactly 20, 30, or 40. Each claimed seat has one or two commanders; omitting `commanderCount` defaults that seat to one.
- A room opens as a lobby: timers do not run while players join. The host may roll for first player; the server locks each d20 result and any tied-player rerolls in the snapshot before clients animate the reveal. The host may instead set a claimed first player manually, then starts the game. An optional `roundLimitMinutes` from 1 through 999 begins its countdown only at Start game; without one, clients show elapsed game time. Timers are informational only and never advance, end, or penalize a game.
- Every seat has a presentation-only display name. An omitted name falls back to `P1` through `P8`; names are never used as identity, authority, storage keys, or uniqueness constraints.
- A newly created room assigns seat 0 to the creating connection; seat 0 is the host and declares its `commanderCount` during creation.
- A connection can own at most one seat. The event loop makes seat claims atomic.
- First claim returns a high-entropy `reclaimToken`. The client stores it locally; it is never included in snapshots. A claimed seat cannot be taken without it.
- A joining player declares `commanderCount` on first claim. Reclaim binds the seat to the new connection immediately and invalidates the old owner, but it preserves the seat's declared count and commander cast counts. A reclaim request that supplies a different commander count is rejected; after reclaim, the owner can change it through the exact-version mutation.
- A player can mutate only their own seat: life, radiation, poison, energy, generic, and commander damage **received by that seat**. There is no endpoint for editing another player.
- Commander source IDs are stable and seat-bound, such as `seat-1-commander-a`; they are not array positions. A defender never stores damage from their own commander source or sources.
- Each claimed seat owns a cast count for each of its active commander source IDs. Counts start at `0`; the server derives the next additional commander tax as `castCount * 2`. Another seat cannot edit these counts, and clients cannot submit derived tax values.
- Only the current owner of host seat 0 can reset the game. Reset zeros counters, commander damage, and commander cast counts without discarding commander setup, claims, or reconnect tokens.
- When at least two seats are claimed and tracked counters leave one survivor, the server records a shared `last_player_standing` result. The host can declare a winner for alternate win conditions that counters cannot infer.
- Every accepted claim, mutation, reset, disconnect expiry, or reconnect increments the room version. Writes require the exact `baseVersion`; a stale write gets `409 VERSION_CONFLICT` plus the current snapshot.
- Routine live counter adjustments use a separate atomic delta endpoint, so simultaneous life/counter taps from different seats are applied against the newest server state instead of failing due to an old displayed total. Structural edits still use exact versions.
- Only the active seat owner may hand off the turn. The server records the handoff timestamp and advances to the next living claimed seat; only the player who handed off may undo it, for 15 seconds. The host can pause/resume timers or turn tracking off entirely. Turn actions use exact versions and are broadcast over SSE.
- Clients must never queue gameplay mutations while offline. After reconnecting, obtain/reclaim a connection, accept the newest snapshot, and let the player perform any still-needed action again. The exact-version check rejects stale queued requests.
- Connections expire after 90 seconds without heartbeat/API activity. Seats remain reserved by their token. Rooms expire after six inactive hours. Restarting the process deletes every active room; a configured Firebase ledger retains records successfully written before that restart.

## HTTP protocol

All JSON API calls set `Content-Type: application/json`. Authenticated calls send the opaque connection identifier in `X-Connection-Id`. A connection identifier is transport authority, not an account and not a durable identity.

### Start a connection

`POST /api/connections`

Returns `{ connectionId, expiresInMs }`. Send `POST /api/connections/heartbeat` with `X-Connection-Id` at least every 45 seconds while the app is foregrounded.

### Create a room

`POST /api/rooms` with `X-Connection-Id`:

```json
{ "playerCount": 4, "startingLife": 40, "commanderCount": 2, "name": "Nissa" }
```

`name` is optional. Returns `{ snapshot, seatId: 0, reclaimToken }`. Persist the token only in local browser storage on that player's phone.

### View or claim

- `GET /api/rooms/:code` returns `{ snapshot }` and is useful before selecting an open seat.
- `POST /api/rooms/:code/claim` with a connection header and `{ "seatId": 2, "name": "Ajani", "commanderCount": 2 }` claims an open seat. `name` is optional and otherwise remains the seat's `P#` fallback. `commanderCount` may be `1` or `2` and defaults to `1`.
- To reconnect, create a new connection and send `{ "seatId": 2, "reclaimToken": "locally stored token" }` to the same claim endpoint. Omitting `name` preserves the current display name; supplying one renames the reclaimed seat.

A snapshot includes the declared count on every seat and a derived active source list:

```json
{
  "commanderSources": [
    { "id": "seat-0-commander-a", "label": "Nissa", "ownerSeatId": 0 },
    { "id": "seat-1-commander-a", "label": "Ajani A", "ownerSeatId": 1 },
    { "id": "seat-1-commander-b", "label": "Ajani B", "ownerSeatId": 1 }
  ],
  "seats": [
    {
      "seatId": 0,
      "name": "Nissa",
      "commanderCount": 1,
      "commanderCastCounts": {
        "seat-0-commander-a": 2
      },
      "nextCommanderTax": {
        "seat-0-commander-a": 4
      },
      "commanderDamageReceived": {
        "seat-1-commander-a": 0,
        "seat-1-commander-b": 0
      }
    }
  ]
}
```

Only claimed seats contribute active sources. Ordering is deterministic by owner seat, then commander `A`/`B`. A single commander uses the owner's current display name as its label; partners append deterministic ` A` and ` B` suffixes. Renaming changes only presentation labels and `seats[].name`: stable source IDs, seat ownership, damage keys, and cast-count keys do not change. Duplicate display names are allowed, so clients must use IDs rather than labels for state or identity.

Each seat's `commanderCastCounts` contains only that seat's own active source IDs; `nextCommanderTax` has the same keys and is regenerated from the count on every snapshot. Unclaimed seats expose empty maps.

Display names are normalized to Unicode NFC, leading/trailing whitespace is removed, and every remaining whitespace run (including tabs and line breaks) becomes one ordinary space. The result must contain 1–24 Unicode code points and no remaining control or invisible format characters. Printable Unicode, emoji, spaces, and punctuation are otherwise accepted. A non-string, empty, overlength, non-whitespace-control-containing, or format-containing value is rejected with `400 INVALID_INPUT`.

The `a` source remains stable when its owner changes between one and two commanders. Its cast count and every unaffected damage value are preserved. Changing from one to two commanders adds the `b` source with cast count and tax `0`; changing back to one removes `b` from the owner's count/tax maps and from every defender's damage map.

### Receive snapshots

Open `GET /api/rooms/:code/events?connectionId=...` with `EventSource`. The server sends `event: snapshot` immediately and after each version change. EventSource cannot set a custom header, so the short-lived connection ID is in this URL; reclaim tokens never are.

Always replace local shared state with a received snapshot when its `version` is newer. The server can send `event: close` with reason `reclaimed`, `expired`, or `room_expired`.

### Mutate the current player's seat

`PATCH /api/rooms/:code/me` with the connection header and a partial set of absolute values:

```json
{
  "baseVersion": 6,
  "name": "Tamiyo",
  "counters": { "life": 35, "energy": 2 },
  "commanderDamageReceived": {
    "seat-0-commander-a": 5,
    "seat-3-commander-b": 2
  },
  "commanderCastCounts": {
    "seat-2-commander-a": 1,
    "seat-2-commander-b": 3
  }
}
```

Commander keys must be active stable source IDs owned by another claimed seat. The values describe damage received by the caller's own seat. Self-owned, inactive, unknown, and legacy numeric source keys are rejected.

`name` changes only the caller's own display name and uses the same normalization rules as create/claim. Like every owner mutation it requires the exact `baseVersion`, increments the room version on success, appears in the returned snapshot, and is broadcast over SSE. Invalid names do not partially apply other fields in the same request.

`commanderCastCounts` is also a partial set of absolute values, but its keys must be the caller's own active stable commander source IDs. Values must be integers from `0` through `999`. Foreign, inactive, unknown, legacy, negative, fractional, string, and out-of-range values are rejected with `400 INVALID_INPUT`. `nextCommanderTax` is read-only derived snapshot state; sending it in a mutation is rejected. A count source must be active both before and after the mutation, so first activate a new `b` source with a `commanderCount` mutation, accept the returned snapshot/version, and then update its cast count in a subsequent request.

The owner may change their own commander setup with the same endpoint:

```json
{ "baseVersion": 7, "commanderCount": 2 }
```

`commanderCount` must be `1` or `2`. Every accepted change increments the room version, reconciles every defender's damage keys, returns `{ snapshot }`, and broadcasts that authoritative snapshot over SSE. `409 VERSION_CONFLICT` includes the current `snapshot`; do not automatically replay the mutation.

### Adjust a current counter

`POST /api/rooms/:code/adjust` is the live gameplay path for a single ± counter entry. It uses the caller's connection header but deliberately does not require `baseVersion`: the server applies the delta to the newest authoritative value, increments the room version, and broadcasts the snapshot. It is not an offline queue; a disconnected request is never held or replayed.

```json
{ "counter": "life", "delta": -5 }
```

For commander damage, send `counter: "commanderDamage"`, the defender-owned `commanderSourceId`, and a delta. The server applies the damage delta and the inverse life delta atomically.

### Reset

`POST /api/rooms/:code/reset` with `{ "baseVersion": 8 }` and the host connection header. Counters, existing commander-damage values, and active commander cast counts reset to their starting values; display names, seat reservations, commander counts, and active source identities remain.

### Turn flow

- `POST /api/rooms/:code/choose-starting-player` with `{ "baseVersion": 8 }` is host-only and, without `startingSeatId`, locks a d20 roll for each claimed player and rerolls only ties until there is a highest result. It accepts a claimed `startingSeatId` when the host chooses manually. It requires at least two claimed players and works only before a game starts.
- `POST /api/rooms/:code/start-game` with `{ "baseVersion": 9 }` is host-only. It starts game/turn timing only after at least two seats are claimed; without a roll-off or manual selection, the host's seat remains first.
- `POST /api/rooms/:code/turn-handoff` with `{ "baseVersion": 8 }` ends the current owner's turn and advances the active table seat. The response includes the new authoritative snapshot.
- `POST /api/rooms/:code/turn-handoff/undo` with `{ "baseVersion": 9 }` returns to the prior player only if the same player initiated the most recent handoff within 15 seconds.
- `POST /api/rooms/:code/turn-tracking` with `{ "baseVersion": 9, "enabled": true|false }` is host-only and shows or hides turn prompts without changing gameplay ownership.
- `POST /api/rooms/:code/turn-pause` with `{ "baseVersion": 9, "paused": true|false }` is host-only and pauses/resumes both turn and game/round timers.
- Snapshots contain `turn.activeSeatId`, `gameStartedAt`, `turnStartedAt`, optional `roundEndsAt`, `trackingEnabled`, `pausedAt`, and the most recent `lastHandoff`. Clients calculate display time from these timestamps; no client controls turn advancement automatically.

### Game result

- A snapshot's optional `gameResult` contains `winnerSeatId`, `reason` (`last_player_standing` or `declared_winner`), and `decidedAt`.
- `POST /api/rooms/:code/declare-winner` with `{ "baseVersion": 8, "winnerSeatId": 2 }` is host-only and records an alternate-win result for a claimed seat.
- Reset clears the result. A recorded result does not lock counters, so the table may continue tracking until the host chooses to reset or return to setup.

### Errors and health

Errors are `{ "error": { "code": "...", "message": "..." } }`; version conflicts also include `snapshot`. `GET /health` returns `{ "ok": true }`.

## Security and prototype limits

Join codes are discoverability aids, not secrets. Display names are untrusted presentation text, not authentication or unique identifiers. Reclaim tokens are capabilities and must not be logged, put in URLs, or shared. This prototype assumes HTTPS at deployment. Its in-memory single-process design is deliberate for testing and cannot synchronize across multiple server instances. Do not scale it horizontally without shared atomic state and publish/subscribe infrastructure.
