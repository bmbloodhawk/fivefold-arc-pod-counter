# Fivefold Arc Duel — Pre-Live Checklist

## Complete locally

- Separate standalone server/client; no MTG imports or deployment changes.
- Two-phone seat ownership, confirmed state, correction record, phase flow, Match state, reconnect reclaim, and restart recovery.
- Recovery credentials are stored only on the claiming phone; server persistence contains credential hashes.
- Server tests cover LP ownership/correction, phase/Match transitions, reclaim takeover, and restart recovery.
- Mobile controls prevent rapid double-tap zoom and input fields use a non-focus-zooming text size.

## Required before a private hosted test

- Configure a separate service and URL for `yugioh-duel/`.
- Set `DUEL_DATA_FILE` to storage that survives service restart and redeploy. Do not use the default local path on ephemeral hosting.
- Set the host's port environment as required by its platform.
- Confirm HTTPS, long-lived event-stream connections, and a healthy `/health` response from the hosted URL.
- Run two physical phones through create, join, LP change, correction, phase handoff, best-of-three Match, refresh reclaim, and restart recovery.

## Required before public availability

- Confirm production persistence and backup/retention policy.
- Add a privacy notice explaining the local reclaim credential and server-side Match data.
- Add remaining table instruments: shared coin/die, named counters, shared/private notes, and Token reference aid.
- Test 320 x 700 and 393 x 852 phone layouts in the deployed app, including keyboard/input and reconnect states.
- Run a small real-table pilot and record every app-caused state dispute before calling the app release-ready.

## Deliberate boundaries

This is a Yu-Gi-Oh! tabletop aid. It does not validate decks, enforce effects, automate card rulings, or replace judges, organizers, or required event records.
