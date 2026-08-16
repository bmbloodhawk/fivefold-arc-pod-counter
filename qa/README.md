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
