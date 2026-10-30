# Implementation Plan: Safe updates, durable rooms, and reclaim recovery

## Overview

Make live table state durable through the existing optional Firebase Realtime Database integration; preserve the current Node server as the only public game API and SSE broadcaster. Add exact latest-table reclaim and a release-aware PWA coordinator that defers refresh during play. No live Firebase, Render, or deployment configuration will change in this plan's code work.

## Architecture decisions

- **Durable state first:** a `RoomStore` owns durable room snapshots and compare-and-swap writes; `RoomService.rooms` becomes a short-lived cache/SSE routing aid, not the authority.
- **One writer contract:** routes validate a request against the newest stored room, conditionally commit its next version, then broadcast only the committed snapshot.
- **Recovery is exact:** one local `last-active-table` pointer, not a saved-table scan. QR is an explicit higher-priority destination.
- **Worker safety over immediacy:** no `skipWaiting` or `clients.claim`; only a safe-boundary user refresh may move to a waiting release.
- **Fixed game geometry:** the update signal lives in existing overlay/rail geometry, never normal document flow.

## Dependency graph

```text
RoomStore conditional-write contract
  ├─ RoomService durable load/commit and restart recovery
  │   └─ client reclaim after server replacement
  └─ readiness health check

Latest-table pointer
  └─ reload/reclaim flow

Release coordinator
  └─ lifecycle-aware fixed-layout update notice
```

## Task list

See [todo.md](todo.md) for ordered implementation tasks and verification.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Firebase is not configured in the live environment | Keep durable mode opt-in; use the existing in-memory behavior unless explicit environment credentials are present. |
| Concurrent writes corrupt a room | Conditional ETag writes, version assertions, and tests with competing mutations. |
| A server deployment disconnects SSE | Reclaim latest table and replace local state from the durable snapshot. |
| A worker update changes game layout | Defer all refresh while `playing`; use an absolute-positioned status chip and phone-width visual checks. |
| Existing Firebase recovery records differ from live-room records | Version the durable record format and retain host-recovery compatibility. |

## Infrastructure approval gate

After local verification, any actual Firebase credential/rule change, Render environment update, auto-deploy setting change, or production deployment requires separate explicit approval.
