# Local phone QA inventory

Use only isolated Playwright contexts, loopback QA server and fixture auth module.
No real sign-ins, outbound email, live database, deployment or publication.

## Claims and checks

| Visible claim / control | Functional check | Visual state / evidence |
| --- | --- | --- |
| Casual Table remains primary; Pod/event optional | Create/join ordinary Table without account; disabled config hides hub actions | Home at 390x844 and 320x700 |
| Pod create and explicit invite opt-in | Two account contexts, preview, join, revoke/expired failure | Create form, preview, clean ranked names |
| Multiple independent Pods | Create second Pod; switch/list; ratings remain scoped | My Pods list |
| Clean Pod history drill-down | History -> date -> games -> result; load older pages | Empty, pending, confirmed, correction details |
| Host reviews full order and ties | Declare winner, fill unknown places; confirmation/retry; correction reason | Order editor and visible standings after save |
| Guest/no-show distinction | Pod unlinked guest; tournament self-name/host name/access; no personal grant | Guest badges, pending late entry, left early |
| Membership/admin operations | Leave/return; remove/readmit; optional admin; vacancy takeover; erased identity | Pod menu/audit/permission failure |
| Tournament standalone | Create with fixed rounds/size/priority/timer; no Pod change | Create form and rules |
| Assignments/manual round starts | Seed suggestion, legal host edits, stale error; multi-table play/confirm | Draft seating, own Table, all Tables |
| Event host/co-host/entry controls | Add guest, invite, co-host cycle, approve late entry, leave early, cancel unplayed | Host menu, participant view, final joint places |
| Timed procedure | Actual started source; time/current turn/five extra turns; shared survivor result | Clock, phase text, draw presentation |
| Table context preserves connection | Open hub while another phone changes life; close and resume same seat | Open modal stays visible; underlying counters converge |
| No per-life competition traffic | Capture network around rapid ordinary and lethal adjustments | Request counts, no competition request triggered by playing snapshots |
| Accessible phone layout | Keyboard Tab/Escape, focus return; all primary controls >=44px; no horizontal overflow | 320/390/wide screenshots and bounds |
| Loading/errors/returns | Invalid/revoked invite, missing positions, sign-in return, refresh/reclaim | Inline error; form values retained |

Exploratory checks: switch Pods while a Table is live; background/reload/reclaim;
change attendance while a draft is being reviewed; retry after a failed confirmation;
host handoff between consecutive games. Use normal inputs for signoff; DOM reads
and API-only probes supplement those interactions.

Physical iPhone/Android, actual venue networks, Google/Firebase providers and live
Firebase conditional writes are later release gates, not claims from this exercise.

Final observed coverage: 54 unique browser checks in the local evidence JSON, plus
435 automated tests. Multi-table events, very large seating, invite expiration,
privacy erasure and real process restart are backend/HTTP checks; the completed
tournament phone flow used one four-player Table. The phone flow exercised variable
attendance through rejoin/leave and UI roles, not a large venue tournament. See the
evidence document for exact outcomes and limits rather than treating this inventory
as proof that every scenario ran on a physical device.
