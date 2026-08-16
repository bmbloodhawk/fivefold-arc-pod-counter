# Fivefold Arc phone prototype

This directory is a no-build, installable web prototype for the Version 3 pod counter brief.

## Local test

Serve this directory over HTTP (service workers do not run from `file://`) and open it on a phone or browser. For example, any static web server can serve `client/`. The **Try a 4-player local table** path works without a backend or account.

## Shared pod integration

`realtime.js` is the only transport boundary. It uses the same origin as the page by default. To test against a separate API, put its base address in the query string:

`https://your-static-site.example/?api=https://your-pod-server.example`

The adapter follows `server/README.md`: short-lived connections, create/claim/reclaim, SSE snapshots, heartbeat, exact-version mutations, host reset, and 409 conflict snapshots. It stores only the reclaim token in local browser storage. Shared mutations are disabled while disconnected and are never queued or replayed. The local simulation is deliberately allowed to switch seats.

## Commander sources

Each claimed seat declares one or two commanders while creating or joining. Shared snapshots supply `seats[].commanderCount` and a deterministic `commanderSources` list with stable IDs, labels, and owner seat IDs. The client always sends commander-damage mutations by source ID, never by an array position, and hides a defender's own commander source(s). The in-game **My commanders** menu invokes the adapter's `setCommanderCount(count)` method, which sends `commanderCount` with the latest snapshot version and displays the replacement snapshot after a success or conflict.

For local simulation, every simulated seat can use that same menu while it is the active simulated seat. This keeps the one-phone test path able to exercise both one- and two-commander seats and immediately remaps the table-wide source list.

This frontend does not create an account, store online data, or deploy anything.
