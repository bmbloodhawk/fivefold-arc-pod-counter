# Security & Reliability Hardening — Independent Review Addendum

## Findings added August 25, 2026

### Confirmed durability and recovery gaps

1. **P1 — completed records were not retrievable after a room expired.** The
   Firebase ledger wrote records, but the app exposed only an in-memory recap.
   A host could not compile completed playtests from the app after expiry.

2. **P1 — queued ledger writes could be lost on a process shutdown.** Writes
   were asynchronous and had no bounded finalization path for a room removal or
   normal process termination.

3. **P1 — lobby-only notes were not finalized.** Room expiry and reset only
   completed a ledger packet after a game had started, leaving setup feedback
   without a final recap.

4. **P2 — hidden duplicate turn controls remained in the overflow markup.**
   They were not interactive, but should be removed rather than retained as
   hidden duplicate UI.

### Review boundary

These are verified code findings, not evidence that production Firebase writes
have failed. The hardening work keeps active rooms in memory and does not add
account, payment, analytics, or persistent live-room recovery.
