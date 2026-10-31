# Spec: Safe release updates and latest-table reclaim

## Objective

Keep an active Fivefold Arc game running on its current client release while a newer PWA release downloads. A player who reloads, is backgrounded, or loses their browser process must reclaim the single most recently active table on that phone unless they explicitly chose **Leave table**. The app must never choose an older saved table merely because it has a reclaim token or an old QR URL.

Success means a waiting update is never allowed to interrupt live scoring or alter the fixed phone play surface, and a recovery load reconnects to the correct table using the server's authoritative snapshot.

## Confirmed constraints

- The server snapshot is the source of truth for shared game state and lifecycle.
- `playing` is unsafe for automatic page reload or worker activation; `intermission`, `lobby`, and no-room state are safe refresh boundaries.
- A completed result is not by itself permission to force refresh; the user may defer until they reach a safe boundary.
- A fresh `?join=CODE` QR link is an explicit target and has priority over stored recovery state. It is removed after a successful join.
- A normal client update must be protocol-compatible with clients still in a game on the prior release.
- The present server stores active rooms only in memory. A server deployment/restart can end an active room; this specification does not claim to solve that separate availability limit.

## Required behavior

### Release state

1. A release has one explicit `RELEASE_ID` shared by the app, service worker cache, and update diagnostics.
2. A new service worker may install in the background and remain `waiting`.
3. The app must not call `skipWaiting()`, `clients.claim()`, or `location.reload()` while the authoritative lifecycle is `playing`, reconnecting, or unknown.
4. Browser reload caused by the user or browser is allowed. It is recovery, not a forced app action.
5. A user-requested refresh at a safe boundary uses ordinary browser/worker lifecycle behavior; it must not globally force other tabs into a new worker.

### Latest-table reclaim

1. Persist exactly one `last-active-table` record after a successful shared-table join/reclaim and after each authoritative snapshot: `{ code, seatId, updatedAt }`.
2. The record points to the same seat's existing reclaim token; no token is copied into a URL, page history, diagnostic, or user-visible message.
3. At startup, priority is: valid fresh QR code, then `last-active-table`, then the manual saved-table list.
4. Automatic reclaim may target only that one exact `{ code, seatId }`; it may never enumerate reclaim tokens or choose the first/oldest saved table.
5. Do not clear the record on reload, backgrounding, offline state, failed temporary request, update waiting, or connection expiry.
6. Clear it only after the player confirms **Leave table**, deliberately begins a different table/join flow, or the server confirms the room is gone or the seat can no longer be reclaimed.
7. After successful reclaim, replace all local shared state with the newest server snapshot and show a compact recovery confirmation. Never replay local game mutations.

### Update notice and fixed phone geometry

1. The `playing` notice is non-modal, does not add a document-flow row, and cannot change the counter-stage height, player-card geometry, or page scroll position.
2. It must be a compact status treatment inside an existing fixed overlay/rail area, use existing visual tokens, and be announced once through a polite live region.
3. It has no action while playing beyond a non-destructive dismiss/defer option, if one is needed.
4. At `intermission`, `lobby`, or no room, a compact action may offer **Refresh now** and explain that the app will reload.
5. At 320px width, the notice must neither cover live counter controls nor create vertical scrolling.

### Compatibility and override policy

1. A normal server release is additive: old snapshot fields/events retain their meaning, old request shapes remain accepted, and new clients tolerate missing optional fields.
2. Any incompatible protocol, data, or server-runtime release requires a maintenance plan; it cannot rely on client deferral alone.
3. A critical override is allowed only for documented security, legal, or data-integrity incidents. It must state the reason, expected game impact, rollback, and user-facing message before release.

## Commands

```text
Full test suite: npm test
Server tests: npm --prefix server test
Client tests: node --test client/*.test.mjs
Local app: npm start
```

## Project structure

- `client/sw.js` — service-worker install, cache, and activation behavior.
- `client/app.js` — lifecycle-aware UI, recovery orchestration, and service-worker registration.
- `client/realtime.js` — connection/reclaim boundary and authoritative snapshots.
- `client/styles.css` / `client/index.html` — fixed-geometry update status treatment.
- `client/*.test.mjs` — focused client behavior tests.
- `server/src/app.js` — existing authoritative room lifecycle and static cache headers, if required by the final cache strategy.

## Code style

Use the existing no-build ES-module style: small functions, explicit early returns, and server snapshots as the only shared-state authority.

```js
// Recovery must name its one target; it must not scan saved tables.
if (!target || target.code !== expectedCode || target.seatId !== expectedSeatId) return;
const result = await transport.claimRoom({ code: target.code, seatId: target.seatId });
```

## Testing strategy

- Start with failing focused tests for the old-table QR/reclaim regression and waiting-update deferral.
- Unit-test release/recovery decisions without real storage credentials.
- Test the server-backed reclaim path with an authoritative newer snapshot.
- Run the full suite after each completed slice.
- Manually inspect a 320px phone viewport and browser service-worker state for normal and deferred updates. This does not establish cross-browser or production evidence.

## Boundaries

- Always: preserve uncommitted work, retain existing reclaim-token privacy, keep live shared state server-authoritative, test each behavior change.
- Ask first: changing Render deployment behavior, publishing, changing production caches, server persistence, database schema, or the critical-override policy.
- Never: force `skipWaiting`, `clients.claim`, or a reload during active play; auto-select an older table; put reclaim tokens in URLs; alter live services without approval.

## Success criteria

- A waiting update during `playing` does not reload, switch controller, change counter geometry, or block scoring.
- A reload during the most recent table reclaims that exact table, including when an update is waiting.
- Joining A by QR and later joining B, then reloading, reclaims B rather than A.
- An explicit Leave prevents automatic reclaim; offline recovery retains the target and offers retry.
- The update indicator introduces no page scroll or counter-stage resize at 320px.
- All existing and new automated tests pass.

## Open decision

The client implementation can safely defer normal client updates, but a live server deployment can still delete in-memory rooms. Before any release process changes, decide whether to enforce an operational no-deploy-during-live-games rule or fund durable room persistence/rolling deployment.
