# Candidate phone acceptance record

Status: **NOT RUN on physical devices**. Prepared November 25, 2026.

Use a fresh staging table only. Keep physical counters or paper with both totals.
Never restart or reset an existing player's table.

## Record before starting

- Staging URL: https://fivefold-arc-pod-counter-staging.onrender.com
- Currently verified hosted revision: `872e5e2a61a0db14b6a3590f543e7e42060ff741`.
- Proposed local runtime revision: `21ab3b2c716e843fe508f6a970f1ce0d5440a513`.
- Tested revision from fresh `/health`: __________ (must match approved candidate).
- HTML app/worker-cache markers: __________ (candidate expects App352/cache427).
- Phone A model / OS / browser / installed or tab: __________
- Phone B model / OS / browser / installed or tab: __________
- Network(s), local start time, tester: __________

## One full table loop

For each line record pass/fail, exact values, delay and any banner/error text.

| Step | Required observation | Result |
|---|---|---|
| Create/join | Both own different seats in the same new table; unauthorized controls are disabled. | Not run |
| Life | Each phone changes its own life; peer matches within 2s. | Not run |
| Commander | Separate partner sources; damage updates defender life; source follows turn by default; manual choice stays until leaving mode. | Not run |
| Lethal | 21 from one commander and life zero are handled correctly; host/non-host elimination checked separately. | Not run |
| Background | Background B for 30s+, return and change once from both phones; totals converge. | Not run |
| Refresh | Reload B; same seat/table/latest state returns; no duplicate change. | Not run |
| Network | Switch Wi-Fi/cellular; controls pause during disconnection, then converge; blocked edits do not replay. Separate network wait from recovery time. | Not run |
| Finish | Agree on result; guest dismisses first and waits safely for host. | Not run |
| Second game | Both ready/start with correct reset totals and starter rotation. | Not run |
| Leave | Deliberate Leave and reload return to Home; create a new table. | Not run |

## Installed update at a safe boundary

Arrange an old controlled app before the approved staging candidate deploy; use a
disposable table and obtain deployment approval first. Capture both installed
controller/cache versions separately from what `/health` and origin assets serve.

1. Keep a game active while the replacement worker installs/waits. No controller
   switch, reload, scoring interruption or new control overlap may occur.
2. Finish and reach intermission/lobby. The current app has no promised update
   notice or **Refresh now** button. Close **all** tabs and installed app windows
   controlled by the old worker on that device; an open second tab can keep it waiting.
3. Reopen and verify the intended app/controller/cache; reclaim the correct table
   if applicable and start a second game. Do not invoke `skipWaiting`.
4. Record before/during/after version evidence and result: __________

## Hosted checkpoint/restart

Follow `qa/STAGING_RUNBOOK.md#room-recovery-restart-test`. Requires explicit approval
for the restart and confirmation no other staging tables are in use.

- Before: both totals 37/35, live version __________, confirmed saved version/time __________.
- Approved restart event/revision/time: __________.
- After: same seats/table/totals __________, one new adjustment seen exactly once __________.
- New confirmed save version/time __________; recovery delay / network wait __________.
- Stop on any mismatch, preserve diagnostics and paper totals; result __________.

## Account and feedback checks

Use controlled staging accounts; do not delete real data. Verify a normal deck and
account export, then a delayed export followed by sign-out/account switch; no stale
download or stale error may reach the next profile. Confirm feedback saves and
remains visible after reload in the private inbox. Synthetic local tests already
cover these code paths; authenticated hosted-provider evidence remains separate.

- Accounts/scenario/results without tokens or private content: __________.
- Feedback result and owner-only reload confirmation: __________.

Acceptance is **No-go** until required rows pass, or the owner explicitly narrows
the alpha scope and accepts a documented limitation. Emulation does not fill a
physical-device row.
