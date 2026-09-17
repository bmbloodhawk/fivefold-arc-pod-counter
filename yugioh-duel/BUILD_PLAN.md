# Fivefold Arc Duel — Parity Build Plan

## Meaning of parity

Parity does not mean copying Magic features. It means giving Yu-Gi-Oh! tabletop players the same product seriousness: secure player-owned inputs, confirmed shared state, reconnect and correction paths, compact mobile controls, useful table utilities, durable Match context, accessibility, and field-tested reliability.

## Build order

1. **Duel core — in progress**: two-phone room, 8,000 LP, player-owned updates, live state, correction record, phase flow, and Single Duel/Best-of-3 Match state. Gate: two real phones complete a three-Duel Match and recover from deliberate LP and phase-entry mistakes without a state dispute.
2. **Table reliability**: reclaim credentials, secure reconnect, paused offline inputs, room recovery, conflict messages, and bounded Duel archive. Gate: background/reconnect and restart recovery protect state and credentials.
3. **Yu-Gi-Oh! instruments**: shared coin/die randomizer, named counters, deliberate shared/private notes, and a player-entered Token reference helper. No automated card rulings or state enforcement. Gate: players do not mistake utilities for rules authority.
4. **Match and event support**: optional Match timer, outcome choices including draw/concession, recap/export, and organizer-safe read-only views. Gate: casual Matches work without incorrect policy imposition.
5. **Polish and qualification**: installable PWA, reduced motion, touch feedback, 320x700/393x852 checks, accessibility, original visual system, and structured real-table feedback. Gate: repeat tables report no unresolved app-caused state dispute.

## Guardrails

- All work stays within `yugioh-duel/`; neither `client/` nor `server/` of the MTG app is a dependency or edit target.
- No Yu-Gi-Oh! logos, card art, character art, or official affiliation language without rights/permission review.
- A full product must remain understandable at physical-table distance before decorative features are added.
