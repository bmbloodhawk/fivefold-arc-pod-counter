# Fivefold Arc QA

This directory contains release gates and an implementation-neutral black-box
test harness for the connected phone prototype. It uses only Node's built-in
test runner, `fetch`, and Server-Sent Events; no paid services or installed packages
are required.

## Run

From this directory:

```powershell
npm test
```

With no target, live tests are intentionally skipped. To test a running build:

```powershell
$env:QA_BASE_URL = 'http://127.0.0.1:3000'
npm run test:live
```

The target must be disposable test data, never production. The suite creates
ephemeral rooms through the public API and does not require a cleanup endpoint.

From the repository root, `node qa/reliability-report.mjs` starts a separate
loopback server and prints a latency, delivery and reclaim report. See the
[reliability runbook](../docs/RELIABILITY_RUNBOOK.md) for what it measures.

## Contract boundary

`blackbox/adapter.mjs` is the only implementation-facing file. It maps the
server's HTTP and Server-Sent Events protocol. If routes or response envelopes
change, update the adapter rather than weakening the behavioral assertions.

## Evidence levels

- Automated: state, authorization, per-seat one/partner commander topology,
  owner-scoped command-zone cast counts and derived next tax, conflict, reset,
  reclaim, normalized player display names, stable identity under duplicate or
  renamed labels, safe fresh-connection room creation after setup return, and
  SSE convergence against a running deployment.
- Instrumented human test: setup time, comprehension, readability, touch
  target use, permanent Commander tax summary projection/context, and perceived
  speed.
- Real-world gate: mixed iOS/Android phones on a different home network.

Passing the automated suite is not evidence that the app is readable on real
phones, survives mobile browser suspension, or works at another house.
# Local Pods / Tournaments load simulation

`node qa/competition-load.mjs` starts its own loopback application child process and
disposable conditional-REST database. It uses synthetic account identities, not Firebase
or real accounts. There is no remote-target option, so it cannot load-test production
or add synthetic events to staging.

```powershell
# Existing default budgets: 32 players on one network, eight Tables
node qa/competition-load.mjs --players=32 --networks=1 --delay-ms=5 --adjustments=16 --rounds=1

# Two rounds, 64 players over two simulated networks, sixteen Tables per round
node qa/competition-load.mjs --players=64 --networks=2 --delay-ms=5 --adjustments=16 --rounds=2

# Opt-in higher budgets: 128 players on one network, 32 Tables
node qa/competition-load.mjs --players=128 --networks=1 --streams-per-network=128 --streams-global=256 --delay-ms=5 --adjustments=16 --rounds=1

# Release gate: no application-level busy retries; include slower artificial storage
node qa/competition-load.mjs --players=128 --networks=1 --streams-per-network=128 --streams-global=256 --delay-ms=50 --busy-retries=0
```

Partitioned-storage component checks run locally with the disposable REST fixture:

```powershell
node --test server/test/database-key-page.test.js server/test/database-key-page-rest.test.js
node --test server/test/competition-identity-store.test.js server/test/competition-identity-process.test.js
node --test server/test/competition-directory-view.test.js server/test/competition-table-claims.test.js
```

`identity-local-worker.mjs` accepts only an owned loopback database and synthetic
account IDs. The process tests kill owned workers and resume opening/erasure from
shared storage. These are storage-component proofs, not hosted app/phone tests.
Scoped name views and Table claims follow the
[internal storage contract](../docs/SCOPED_COMPETITION_STORAGE_CONTRACT.md).
They remain unwired until the domain/HTTP and compatible-writer rollout gates pass.

Measure normal counter diagnostic/recovery write drain separately:

```powershell
node qa/counter-storage-probe.mjs --commands=200 --players=4 --delay-ms=5
node qa/counter-storage-probe.mjs --commands=200 --players=4 --tables=8 --delay-ms=5
```

This probe verifies every event and the final recovery state after the writer
drains. It does not measure phone/SSE latency. The older competition-load cleanup
kills its child process, so that benchmark alone is not a full background-write
drain or restart-durability proof.
`--commands` is the total across all Tables. See the
[scheduling evidence and limits](../docs/COUNTER_WRITE_SCHEDULING.md) before making
capacity claims; concurrent execution does not bound the pending backlog.

The harness checks real HTTP/SSE updates, exact counter changes and convergence,
reclaim/stale-phone authority, life changes during other Tables' result traffic,
concurrent confirmed results, duplicate-request idempotency, points and game counts.
Life-only activity must leave competition records unchanged. Each actual mutation has
a unique operation ID; the busy-phase counter verifies all 64 control mutations applied.

Reports are under `.local/evidence/competition-load-<players>-<networks>.json`. Timing
percentiles are per HTTP attempt; `operationP95Ms` includes automatic test-harness retries
and backoff. Retryable `503 HISTORY_BUSY` responses remain visible in the status counts.
They are not counted as instant successes. The historical default allows four busy
retries with the same immutable request ID. Use `--busy-retries=0` for the result-save
release gate: any busy response then fails the run. Duplicate confirmations still
run explicitly, to check lost-response safety; these are not automatic busy retries.

The old defaults remain 32 live streams per network and 64 per server. Per-service
`MAX_LIVE_STREAMS_PER_IP` and `MAX_LIVE_STREAMS_GLOBAL` can raise them (integers 1–1024,
network budget no greater than server budget). The per-connection limit remains two.
Staging is configured for 128 / 256; production settings have not been changed.

These are local measurements, not Render hardware, real phone rendering, OAuth,
live Firebase or venue Wi-Fi evidence. Storage delay is artificial and the REST fixture
implements only the adapter contract. Competition writes to the same document now
wait in arrival order within one app process. Independent documents do not share a
queue, and cross-process ETag checks remain active. This is not a distributed worker
or a global capacity guarantee. Use the staging phone checklist before any production
release. No benchmark result authorizes a production change.
