# Safe release operations

This is the operational companion to `SAFE_UPDATE_AND_RECLAIM_SPEC.md`. It describes the release boundary that has been implemented locally. It is not authorization to change Render, Firebase, or production caches.

## What the code now guarantees locally

- Each durable room is one versioned record at `live-rooms/{POD_CODE}`. A write reads the record's Firebase ETag, checks the room version, and conditionally writes the next complete snapshot. SSE broadcasts happen only after that commit.
- A restarting server reads that record before seat reclaim. Reclaim uses the same seat's local token and obtains a new authoritative snapshot; it never replays a local counter change.
- A durable room that is past the six-hour room TTL is conditionally deleted and cannot be revived by a later server restart.
- A waiting PWA worker is downloaded, but does not call `skipWaiting`, `clients.claim`, or reload a playing/reconnecting table. The player receives a compact, fixed-position notice. The only automatic route to a new release is a normal browser reload after the player selects **Refresh now** at lobby, intermission, or no-table state.

## Compatibility contract

Normal releases must remain compatible with the prior active client release for the whole room TTL.

| Boundary | Required rule |
|---|---|
| Client and realtime events | Add fields/events; do not rename, remove, or change meaning of existing fields/events. Old clients must safely ignore new optional fields. |
| HTTP requests | Keep accepted old request shapes and validation semantics while active older clients may reconnect. |
| Durable room record | Keep `schemaVersion: 1` readable, or add an explicit reader/migration before writing a new version. Never overwrite an old record with an incompatible shape. |
| Database changes | Expand first, deploy compatible readers/writers, migrate/backfill, then remove old fields in a later release after the active-room window. |
| Service worker assets | Bump every changed executable asset URL and precache the complete release. Do not use a mutable runtime asset cache for app modules. |

If a release cannot meet these rules, it is a maintenance release, not a normal rolling release. It needs a scheduled game-free window and an explicit player message.

## Normal release runbook

1. Run `npm test` and verify the new release worker installs in a local browser while a test table remains playable.
2. Confirm `/health` returns `200` with `roomStore: "ready"` when durable storage is enabled. A `503` / `unavailable` response is a hard stop.
3. Deploy only a compatible server/client pair. Render should start and health-check the new instance before it receives traffic.
4. During the handoff, existing SSE connections can close when the older instance receives `SIGTERM`. Clients must reconnect and reclaim/read the authoritative durable snapshot; this is not a reason to force a page update.
5. Observe reconnect/reclaim failures and `VERSION_CONFLICT` responses. Roll back before declaring the release complete if those are not understood.

## Rollback

- **Before traffic moves:** let the failed/new instance fail its health check; keep the old deployment serving.
- **After traffic moves:** roll back the Render release. Do not delete `live-rooms/*`; durable records are compatible through the active-room TTL.
- **Client issue:** publish a compatible corrective release. Do not force a worker takeover while tables are playing.
- **Critical override:** only security, legal, or demonstrated data-integrity incidents qualify. Before using one, record the incident, affected versions, exact player impact, rollback release, and a visible explanation. It may still interrupt a game, so it requires explicit release approval.

## Production approval gate

The current `render.yaml` remains a free, auto-deploying web service. Do not use a Render persistent disk for live rooms: it would prevent zero-downtime deployment and is single-instance storage. Use the existing Firebase Realtime Database integration (or another external transactional store) instead.

Before production activation, approve and verify all of the following in the real service:

1. The Firebase service-account environment values already used by the app are present and can read/write only the intended `live-rooms` path.
2. Render's health check sees durable-store readiness, and the service is not deployed when the check is `503`.
3. A staging or controlled production table survives a server replacement: active player reconnects, claims the same seat, and sees the latest life total.
4. The Render plan/deploy controls and the service shutdown allowance are appropriate for the expected table duration. Free services can spin down while idle, so this must be consciously accepted or replaced with a paid plan.
5. A deployment owner watches the first real release and has the prior deploy selected for rollback.

## Evidence to collect for each release

- release ID and Git commit;
- `/health` result before and after traffic shift;
- worker state (`active`, `waiting`, and controller version) from a test browser;
- one normal safe-boundary refresh and one active-game deferred-update observation;
- one latest-table reclaim after an intentional reload;
- any reconnect, conflict, or room-store error count.
