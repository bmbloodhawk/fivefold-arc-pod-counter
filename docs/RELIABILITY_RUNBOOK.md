# Fivefold Arc reliability checks

Run `node qa/reliability-report.mjs` from the repository root. It starts a disposable server on an OS-selected loopback port and reports JSON to stdout. The intentionally injected HTTP 500 produces one `request_failed` JSON line on stderr. The probe uses synthetic seats, makes no external calls, and writes no telemetry records. A failed assertion reports the probe phase and exits nonzero.

## What the local report measures

- Seat leases and open streams before a forced socket close, after it, and after reclaim. A seat can remain owned while its stream is closed.
- 200 sequential shared-life adjustments in a started two-seat game. It checks every version and peer snapshot against the HTTP acknowledgement, then tests same-operation replay, stale authority rejection, and a synthetic 500. It verifies that the 500 leaves authoritative state unchanged.
- p50, p95, p99 and sample count for request-to-acknowledgement, server apply-to-confirmation, confirmation-to-SSE receipt, and request-to-SSE receipt. The confirmation timestamp is taken before fanout on the same monotonic clock as receipt. The injected fanout delay is reported separately from normal samples. SSE receipt marks parsed data in Node.
- Fresh claim and initial snapshot after a disconnect with a missed change. The snapshot must match an authoritative read, and the old connection must lose write authority. This is a forced rejoin by the probe.
- Served app, realtime and life-batching modules, CSS, and worker cache versions with shell consistency and asset reachability. Process RSS is a single sample for the probe and server combined.

The baseline has two seats and one write in flight. For the eight-seat concurrency gate and the mixed-device checks, use the [QA test plan](../qa/TEST_PLAN.md) and [staging release script](../qa/STAGING_RUNBOOK.md). The report has no browser, provider storage, or carrier data.

## Flows and release targets

| Flow | Questions to answer | Release evidence |
| --- | --- | --- |
| Life, damage and turn changes | Was feedback visible promptly? Did the server confirm exactly once? Did the peer show the confirmed version? | Existing QA gate is p95 acknowledgement below 500 ms for 200 concurrent adjustments across eight seats. Existing phone gate is a peer update within 2 seconds. Check both life and turn changes. |
| Join, foreground return, reconnect and reclaim | Did the stream reopen? Did current ownership and a fresh snapshot return? Did the old owner lose write access? | Existing field gate is convergence within 2 seconds after reconnection. Record attempt-to-convergence and time waiting for the network separately. Verify authoritative state equality and no replay of blocked edits. |
| Completion, next game and safe update | Did both peers agree on the result and next game? Did a waiting worker activate at the safe boundary? | Walk the post-game flow and start a second game on staging. Observe one controller change at the safe boundary and preserve the current game until then. |
| Display and dependencies | Could the player see and tap critical controls? Which dependency blocked core play? | Check small phone widths and actual iOS and Android touch. Record overlaps, asset failures, JS errors, and optional lookup failures separately from core table outages. |

The current app shows optimistic life feedback before acknowledgement and batches shared-life requests after a 300 ms quiet period. Measure that batching wait separately. Establish the input-to-frame and p99 objectives from physical iPhone/Safari and Android/Chrome samples. Show count and p50/p95/p99 for each supported segment. Treat p99 as exploratory below 100 observations and avoid cross-device percentile claims from one table.

## Staging instrumentation proposal

1. Begin with the shared-life path. Time input-to-feedback, batch wait, HTTP send-to-acknowledgement, server apply, SSE receive-to-render, and time to rejoin with a confirmed snapshot. Use Event Timing where supported and label an animation-frame estimate as a proxy. Keep each duration on one monotonic clock. When measuring end-to-end across devices, use a controlled common-clock test or explicitly account for clock uncertainty. Peer data can arrive before the writer's HTTP response. [Event Timing specification](https://www.w3.org/TR/event-timing/)
2. Keep fixed buckets and counts in memory for this trial. Track attempts, successes, expected conflicts/rejections, transport failures, timeouts, duplicate suppression and superseded actions separately. Attach one short-lived random ID to a sampled action across HTTP, server handling, SSE metadata and peer render. Join using an exact confirmed version and label coalesced or superseded renders separately. The ID belongs only in sampled traces. Log bounded timestamps, feature, stage, outcome, build and coarse viewport/browser/visibility categories. Exclude room codes, tokens, raw paths, content and stacks. Never use IDs as metric labels.
3. Count stream open, close and reconnect outcomes independently of leases. Keep a small pending incident count during an outage so attempted recovery is visible on return. Track missing reports as unknown. Separate retry, full reclaim and authoritative resync. Record stable failure classes and latency for Firebase recovery and critical asset fetches at their actual call sites. Optional card services can have their own panel.
4. Keep performance aggregates separate from retained game diagnostics. The current client diagnostic endpoint needs a connected seat and writes through the playtest ledger, which also queues a recovery record. It cannot be a denominator for failed joins or total outages. Measure browser errors and allowlisted control visibility/overlap flags at known layout transitions on staging, with no screenshots, DOM text or arbitrary selectors in telemetry. Collect browser and service-worker controller versions independently of what the origin serves.

Extend the owner-only Diagnostics view if a deployment is approved. Lead with an explicit environment, release and measurement window. Show active leases beside open streams, mutation success and reconnect success with counts, latency percentiles by stage, actionable failure classes, served and controlling versions, and contextual event-loop delay, memory and dependency timeouts. Use `Unknown` for absent data and show age and sample count. Use the local report before enabling the first field trial. No new production collection or alert routing is active.

## Proposed alert runbooks

The trigger values below are staging trial rules. Use 5-minute windows and evaluate by release and feature. Rate rules need at least 20 eligible attempts per window. With lower traffic, use the synthetic checks and manual review. Validate thresholds with physical-phone data before enabling notification delivery. A rollback of a hosted release requires owner approval. Confirm which tables are active and what recovery state is available before any restart.

### Failed shared writes

Trigger when unexpected errors or timeouts exceed 5% for two consecutive windows. Players may see an optimistic change revert or fail to synchronize. First group `/adjust` and turn mutations by outcome and release. Match a `request_failed` line to its `x-request-id`, then compare server apply and dependency timings. Escalate to the app owner if reproducible. If tied to a new build, prepare the last verified build for rollback after assessing active tables.

### Slow confirmation or peer update

Trigger when p95 acknowledgement exceeds 500 ms or p95 peer update exceeds 2 seconds for two consecutive windows, with at least 100 samples per window. Players may repeat inputs or act on an old counter. First separate batch wait, acknowledgement, server apply, stream receipt and peer render. Run the loopback report, then the staging peer test on two phones. Escalate the stage that regressed and roll back the implicated release only after reproducing the regression.

### Reconnect or state mismatch

Trigger when at least 10% of reconnect attempts fail for two consecutive windows, or two independent synthetic checks within 10 minutes disagree with authoritative state after resync. A player may be unable to act or may see the wrong state. First compare open streams, reclaim outcomes and snapshot versions. Check whether recovery read failed, authority expired, or a stale response crossed a session boundary. Escalate a reproducible mismatch immediately, stop release promotion, and prepare rollback if the current release introduced it.

### Critical asset or dependency failure

Trigger when two independent staging or production read-only smoke checks fail within 10 minutes, or when a core asset, render or dependency failure exceeds 5% for two consecutive windows. Players may be unable to open or recover a table. First compare expected origin assets to served bytes and the controller version. For a recovery dependency, check timeouts and distinguish a readable stale checkpoint from a failed read. Escalate to the owner of the failing component. For an asset regression, prepare the last known-good shell and module set together. For a provider outage, escalate the provider incident and preserve recovery evidence before considering a restart.

## Open findings and acceptance checks

| Finding and impact | Evidence and limits | Smallest follow-up and acceptance |
| --- | --- | --- |
| High if triggered. Restart recovery can apply a life operation twice. | Two local server instances shared a memory ledger. One accepted `−3` changed life from 40 to 37. After restore and reclaim, explicitly reissuing the same ID changed it to 34. Recovery snapshots exclude the per-seat operation ID cache. The test did not reproduce an automatic browser replay. | Test a lost response during restart and automatic reconnect on staging. A fix must preserve exactly-once behavior within the supported retry window through restore, including legacy records and rejected stale credentials. See `server/src/app.js` recovery and adjustment methods. |
| Room recovery save confirmation. Staging restart validation pending. | A rejected Firebase write leaves the previous confirmed timestamp and room version in place. The local failure test restored the scores from that version. The Firebase emulator verified that the timestamp is stored with the recovery record. | In private Diagnostics, check the save time and compare the saved and live versions before restarting. Use the [two-phone restart test](../qa/STAGING_RUNBOOK.md#room-recovery-restart-test) to confirm both seats and scores recover. |
| Medium. A seat lease can be counted as a connected player during an outage. | Loopback probe shows leases unchanged with the live stream count at zero. | Show leases and open streams separately in the private dashboard. Disconnect and reclaim must change the stream gauge while a valid lease remains. |
| Measurement gap. Installed versions and phone display can differ from the origin. | A local Chrome profile with the old worker reused old module bytes after the origin updated behind the same URLs. Phone safe areas, suspension and mixed-network behavior require field evidence. | Verify an installed PWA upgrades across a real safe game boundary with expected app and worker versions. Run the staging release script on iPhone/Safari and Android/Chrome, including backgrounding past the 25-second keepalive, Wi-Fi-to-cellular change, and a new-game transition. |
